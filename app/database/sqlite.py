# -*- coding: utf-8 -*-
"""
SQLite Database Adapter (Mục 5.4).
Provides lightweight, zero-dependency, local file-based database support using Python's built-in sqlite3.
Supports:
- File-based databases (.db, .sqlite, .sqlite3, .db3) and in-memory (:memory:)
- Read-only enforcement via URI mode and PRAGMA query_only = ON
- Query cancellation via connection.interrupt()
- Statement splitting, progress streaming, error line tracking
- Schema and metadata discovery via PRAGMA and sqlite_master
- Table Designer metadata extraction
- Atomic multi-batch migration transactions
"""

import os
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.database.base import DatabaseAdapter
from app.database.sql_utils import quote_ident, quote_qualified
from app.utils.db_message import clean_db_message, parse_error_details
from app.utils.sql_splitter import split_statements


def serialize_cell(val: Any) -> Any:
    """Serializes a cell value to JSON/frontend compatible format."""
    if val is None:
        return None
    if isinstance(val, (int, float, bool, str)):
        return val
    if isinstance(val, (bytes, bytearray, memoryview)):
        return "0x" + bytes(val).hex()
    if isinstance(val, (dict, list)):
        import json
        return json.dumps(val, ensure_ascii=False, default=str)
    return str(val)


class SqliteAdapter(DatabaseAdapter):
    db_type = "sqlite"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._db_type = "sqlite"
        self._is_cancelled = False
        self._lock = threading.RLock()
        self._active_cursor = None
        self.timeout = float(config.get("timeout") or 30.0)

    @property
    def is_alive(self) -> bool:
        return self.ping()

    def connect(self):
        """Connects to a SQLite file or in-memory database."""
        with self._lock:
            if self.connection:
                try:
                    self.connection.close()
                except Exception:
                    pass
                self.connection = None

            db_path = str(
                self.config.get("database")
                or self.config.get("file_path")
                or self.config.get("path")
                or ":memory:"
            ).strip()

            is_memory = db_path.lower() in (":memory:", "memory")
            is_ro = bool(self.config.get("read_only", False))

            if not is_memory and db_path != ":memory:":
                target_p = Path(db_path).resolve()
                if not is_ro:
                    target_p.parent.mkdir(parents=True, exist_ok=True)
                resolved_str = target_p.as_posix()
            else:
                resolved_str = ":memory:"

            if is_ro and not is_memory and os.path.exists(resolved_str):
                uri_str = f"file:{resolved_str}?mode=ro"
                self.connection = sqlite3.connect(
                    uri_str,
                    uri=True,
                    check_same_thread=False,
                    timeout=self.timeout
                )
                try:
                    self.connection.execute("PRAGMA query_only = ON;")
                except Exception:
                    pass
            else:
                self.connection = sqlite3.connect(
                    resolved_str,
                    check_same_thread=False,
                    timeout=self.timeout
                )
                if is_ro:
                    try:
                        self.connection.execute("PRAGMA query_only = ON;")
                    except Exception:
                        pass
                else:
                    try:
                        self.connection.execute("PRAGMA foreign_keys = ON;")
                    except Exception:
                        pass

            # Standard autocommit behavior: isolation_level = None
            self.connection.isolation_level = None
            self._is_cancelled = False

    def close(self):
        """Closes the current database connection."""
        with self._lock:
            if self.connection:
                try:
                    self.connection.close()
                except Exception:
                    pass
                self.connection = None

    def ping(self) -> bool:
        """Verifies that the database connection is alive."""
        if not self.connection:
            return False
        with self._lock:
            try:
                cur = self.connection.cursor()
                cur.execute("SELECT 1;")
                cur.fetchone()
                cur.close()
                return True
            except Exception:
                return False

    def cancel(self) -> bool:
        """Interrupts currently executing SQLite queries."""
        self._is_cancelled = True
        with self._lock:
            if self.connection:
                try:
                    self.connection.interrupt()
                    return True
                except Exception:
                    pass
        return True

    def execute(self, sql: str, params=None, limit=None, database=None, schema=None, **kwargs) -> Dict[str, Any]:
        """
        Executes one or more SQL statements against SQLite.
        Returns unified results dictionary matching DatabaseAdapter contract.
        """
        if not self.connection:
            self.connect()

        self._is_cancelled = False
        t0 = time.perf_counter()

        cursor = self.connection.cursor()
        self._active_cursor = cursor

        try:
            statements_meta = split_statements(sql, dialect="sqlite")
            if not statements_meta:
                statements_meta = [{"sql": sql, "start_line": 1, "end_line": 1}]

            results: List[Dict[str, Any]] = []
            messages: List[str] = []
            errors: List[Dict[str, Any]] = []
            statements: List[Dict[str, Any]] = []
            total_affected = 0
            stop_on_error = kwargs.get("stop_on_error", True)
            progress_callback = kwargs.get("progress_callback")

            for s_info in statements_meta:
                if self._is_cancelled:
                    break

                stmt_sql = s_info["sql"].strip()
                if not stmt_sql:
                    continue

                stmt_start = s_info.get("start_line", 1)
                t_s0 = time.perf_counter()
                stmt_start_res_len = len(results)
                stmt_error_str = None
                stmt_affected_start = total_affected

                try:
                    if params and len(statements_meta) == 1:
                        cursor.execute(stmt_sql, params)
                    else:
                        cursor.execute(stmt_sql)

                    # Check for result set
                    if cursor.description:
                        columns = [desc[0] for desc in cursor.description]
                        fetch_limit = limit if limit is not None else int(self.config.get("max_rows", 1000))
                        res_index = len(results)

                        if progress_callback:
                            try:
                                progress_callback({
                                    "type": "columns",
                                    "result_index": res_index,
                                    "columns": columns,
                                })
                            except Exception:
                                pass

                            row_count = 0
                            first_chunk = True
                            while True:
                                if self._is_cancelled:
                                    break
                                chunk_size = 100 if first_chunk else 500
                                first_chunk = False
                                if fetch_limit > 0:
                                    remaining = fetch_limit - row_count
                                    if remaining <= 0:
                                        break
                                    chunk_size = min(chunk_size, remaining)

                                raw_rows = cursor.fetchmany(chunk_size)
                                if not raw_rows:
                                    break

                                serialized_chunk = [[serialize_cell(c) for c in r] for r in raw_rows]
                                row_count += len(serialized_chunk)

                                try:
                                    progress_callback({
                                        "type": "chunk",
                                        "result_index": res_index,
                                        "columns": columns,
                                        "rows": serialized_chunk,
                                        "total_so_far": row_count,
                                    })
                                except Exception:
                                    pass

                            results.append({
                                "columns": columns,
                                "rows": [],
                                "row_count": row_count,
                                "streamed": True,
                            })
                        else:
                            if fetch_limit == 0:
                                raw_rows = cursor.fetchall()
                            else:
                                raw_rows = cursor.fetchmany(fetch_limit)

                            rows = [[serialize_cell(c) for c in r] for r in (raw_rows or []) if r is not None]
                            row_count = len(rows)
                            results.append({
                                "columns": columns,
                                "rows": rows,
                                "row_count": row_count,
                            })
                    else:
                        affected = cursor.rowcount
                        if affected >= 0:
                            total_affected += affected
                            messages.append(f"({affected} row(s) affected)")

                except Exception as stmt_err:
                    is_cancel = self._is_cancelled or "interrupted" in str(stmt_err).lower()
                    if is_cancel:
                        messages.append("Query execution was cancelled by user.")
                    else:
                        err_detail = parse_error_details(sql, stmt_err, batch_start_line=stmt_start)
                        clean_msg = err_detail.get("clean_message") or str(stmt_err)
                        errors.append(err_detail)
                        stmt_error_str = clean_msg
                        line_info = f"Line {err_detail.get('line')}: " if err_detail.get("line") else ""
                        messages.append(f"Error: {line_info}{clean_msg}")

                s_ms = round((time.perf_counter() - t_s0) * 1000)
                s_results = results[stmt_start_res_len:]
                s_first_res = s_results[0] if s_results else {}
                statements.append({
                    "index": len(statements) + 1,
                    "sql": stmt_sql,
                    "start_line": stmt_start,
                    "rows": s_first_res.get("rows", []),
                    "columns": s_first_res.get("columns", []),
                    "rows_affected": total_affected - stmt_affected_start,
                    "duration_ms": s_ms,
                    "error": stmt_error_str
                })

                if stop_on_error and stmt_error_str:
                    break

            first = results[0] if results else {"columns": [], "rows": [], "row_count": total_affected}
            success = len(errors) == 0
            duration_ms = round((time.perf_counter() - t0) * 1000)

            return {
                "success": success,
                "columns": first.get("columns", []),
                "rows": first.get("rows", []),
                "row_count": first.get("row_count", 0),
                "results": results,
                "statements": statements,
                "total_rows_affected": total_affected,
                "duration_ms": duration_ms,
                "messages": messages,
                "errors": errors,
                "current_database": "main",
            }

        finally:
            self._active_cursor = None
            try:
                cursor.close()
            except Exception:
                pass

    def list_databases(self) -> List[Dict[str, Any]]:
        """Lists SQLite attached databases (main, temp, attached files)."""
        res = self.execute("PRAGMA database_list;", limit=0)
        items = []
        for row in res.get("rows", []):
            # row: [seq, name, file]
            name = row[1] if len(row) > 1 else "main"
            file_path = row[2] if len(row) > 2 else ""
            items.append({
                "name": name,
                "file": file_path or ":memory:",
                "state": "ONLINE"
            })
        if not items:
            items = [{"name": "main", "file": ":memory:", "state": "ONLINE"}]
        return items

    def list_schemas(self, database: str = None) -> List[Dict[str, Any]]:
        """SQLite only uses 'main' schema (or attached database name)."""
        db_name = database or "main"
        return [{"name": db_name}]

    def list_objects(self, database: str, schema: str, object_type: str, search: str = None, limit: int = 0) -> List[Dict[str, Any]]:
        """
        Lists tables, views, triggers, and indexes from sqlite_master.
        """
        db_prefix = f"{quote_ident(database, 'sqlite')}." if database and database != "main" else ""
        type_str = object_type.lower().rstrip("s")

        if type_str in ("table", "u"):
            sql = f"SELECT name FROM {db_prefix}sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        elif type_str in ("view", "v"):
            sql = f"SELECT name FROM {db_prefix}sqlite_master WHERE type='view'"
        elif type_str in ("trigger", "tr"):
            sql = f"SELECT name FROM {db_prefix}sqlite_master WHERE type='trigger'"
        elif type_str in ("index", "idx"):
            sql = f"SELECT name FROM {db_prefix}sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
        else:
            return []

        params = []
        if search:
            sql += " AND name LIKE ?"
            params.append(f"%{search}%")

        sql += " ORDER BY name"
        res = self.execute(sql, params=tuple(params) if params else None, limit=limit)
        return [{"schema": schema or "main", "name": r[0]} for r in res.get("rows", [])]

    def get_object_definition(self, database: str, schema: str, name: str, object_type: str) -> str:
        """Retrieves raw CREATE DDL from sqlite_master."""
        db_prefix = f"{quote_ident(database, 'sqlite')}." if database and database != "main" else ""
        sql = f"SELECT sql FROM {db_prefix}sqlite_master WHERE name = ?"
        res = self.execute(sql, params=(name,), limit=1)
        rows = res.get("rows", [])
        if rows and rows[0][0]:
            return str(rows[0][0])
        return ""

    def list_object_children(self, database: str, schema: str, name: str, object_type: str, child_type: str) -> List[Dict[str, Any]]:
        """Lists child objects (columns, keys, indexes, triggers) for a table or view."""
        items = []
        safe_name = quote_ident(name, "sqlite")

        if child_type == "columns":
            res = self.execute(f"PRAGMA table_info({safe_name});", limit=0)
            for r in res.get("rows", []):
                # [cid, name, type, notnull, dflt_value, pk]
                is_pk_col = bool(r[5])
                items.append({
                    "name": r[1],
                    "type": r[2] or "TEXT",
                    "nullable": False if is_pk_col else not bool(r[3]),
                    "is_pk": is_pk_col,
                    "default": r[4]
                })


        elif child_type == "keys":
            # 1. Primary keys
            res_info = self.execute(f"PRAGMA table_info({safe_name});", limit=0)
            pk_cols = [r[1] for r in res_info.get("rows", []) if r[5] > 0]
            if pk_cols:
                items.append({"name": f"PK_{name}", "type": "PK", "columns": pk_cols})

            # 2. Foreign keys
            res_fk = self.execute(f"PRAGMA foreign_key_list({safe_name});", limit=0)
            for r in res_fk.get("rows", []):
                items.append({
                    "name": f"FK_{name}_{r[0]}",
                    "type": "FK",
                    "from": r[3],
                    "ref_table": r[2],
                    "to": r[4]
                })

        elif child_type == "indexes":
            res = self.execute(f"PRAGMA index_list({safe_name});", limit=0)
            for r in res.get("rows", []):
                # [seq, name, unique, origin, partial]
                items.append({
                    "name": r[1],
                    "unique": bool(r[2]),
                    "origin": r[3]
                })

        elif child_type == "triggers":
            sql = "SELECT name, 'trigger' as type FROM sqlite_master WHERE type='trigger' AND tbl_name = ?"
            res = self.execute(sql, params=(name,), limit=0)
            for r in res.get("rows", []):
                items.append({"name": r[0], "type": r[1]})

        elif child_type == "constraints":
            # Return foreign keys and primary keys as constraints
            res_fk = self.execute(f"PRAGMA foreign_key_list({safe_name});", limit=0)
            for r in res_fk.get("rows", []):
                items.append({"name": f"FK_{name}_{r[0]}", "type": "FOREIGN KEY"})

        return items

    def get_table_design_metadata(self, database: str, schema: str, table: str) -> Optional[Dict[str, Any]]:
        """
        Returns full schema metadata for Table Designer and Table Data Editor.
        """
        safe_name = quote_ident(table, "sqlite")
        info_res = self.execute(f"PRAGMA table_info({safe_name});", limit=0)
        rows = info_res.get("rows", [])
        if not rows:
            return None

        # Parse column metadata
        columns = []
        pk_cols = []
        table_pk_name = None

        for r in rows:
            # [cid, name, type, notnull, dflt_value, pk]
            cid, col_name, raw_type, notnull, dflt_value, is_pk = r[0], r[1], r[2] or "TEXT", r[3], r[4], r[5]
            raw_upper = raw_type.upper().strip()

            # Parse size/precision/scale if exists (e.g. VARCHAR(100), DECIMAL(10, 2))
            length = None
            precision = None
            scale = None
            m_len = re.search(r"\((\d+)\)", raw_upper)
            if m_len:
                length = int(m_len.group(1))
            m_prec = re.search(r"\((\d+)\s*,\s*(\d+)\)", raw_upper)
            if m_prec:
                precision = int(m_prec.group(1))
                scale = int(m_prec.group(2))

            base_type = re.sub(r"\(.*?\)", "", raw_upper).strip()

            is_pk_bool = bool(is_pk > 0)
            if is_pk_bool:
                pk_cols.append(col_name)
                table_pk_name = f"PK_{table}"

            # In SQLite, INTEGER PRIMARY KEY is automatically an identity column (rowid alias)
            is_identity = is_pk_bool and "INT" in base_type

            columns.append({
                "column_id": cid + 1,
                "name": col_name,
                "type": base_type or "TEXT",
                "length": length or 0,
                "precision": precision or 0,
                "scale": scale or 0,
                "nullable": False if is_pk_bool else not bool(notnull),
                "is_pk": is_pk_bool,
                "is_identity": is_identity,
                "seed_value": 1,
                "increment_value": 1,
                "default_value": str(dflt_value) if dflt_value is not None else "",
                "default_constraint_name": "",
                "comment": "",
                "collation": ""
            })


        # 2. Indexes and Unique Constraints
        idx_res = self.execute(f"PRAGMA index_list({safe_name});", limit=0)
        indexes = []
        uniques = []

        for r in idx_res.get("rows", []):
            # [seq, name, unique, origin, partial]
            idx_name = r[1]
            is_unique = bool(r[2])
            origin = r[3] # 'c' = create index, 'u' = unique constraint, 'pk' = primary key

            col_res = self.execute(f"PRAGMA index_info({quote_ident(idx_name, 'sqlite')});", limit=0)
            idx_cols = [c[2] for c in col_res.get("rows", [])]

            if origin == "u":
                uniques.append({
                    "name": idx_name,
                    "fields": idx_cols,
                    "is_clustered": False,
                    "comment": ""
                })
            elif origin != "pk":
                indexes.append({
                    "name": idx_name,
                    "fields": [{"column": col, "desc": False} for col in idx_cols],
                    "index_type": "NONCLUSTERED",
                    "is_unique": is_unique,
                    "comment": ""
                })

        # 3. Foreign Keys
        fk_res = self.execute(f"PRAGMA foreign_key_list({safe_name});", limit=0)
        fk_map = {}
        for r in fk_res.get("rows", []):
            # [id, seq, table, from, to, on_update, on_delete, match]
            fk_id = r[0]
            if fk_id not in fk_map:
                fk_map[fk_id] = {
                    "name": f"FK_{table}_{r[2]}_{fk_id}",
                    "column": r[3],
                    "ref_schema": "main",
                    "ref_table": r[2],
                    "ref_column": r[4],
                    "on_update": r[5],
                    "on_delete": r[6]
                }
        foreign_keys = list(fk_map.values())

        # 4. Triggers
        trig_res = self.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name = ?",
            params=(table,),
            limit=0
        )
        triggers = []
        for r in trig_res.get("rows", []):
            triggers.append({
                "name": r[0],
                "fires": "After",
                "is_insert": True,
                "is_update": True,
                "is_delete": True,
                "is_enabled": True,
                "definition": r[1] or "",
                "comment": ""
            })

        return {
            "database": database or "main",
            "schema": schema or "main",
            "table": table,
            "engine": "sqlite",
            "pk_name": table_pk_name or f"PK_{table}",
            "columns": columns,
            "indexes": indexes,
            "foreign_keys": foreign_keys,
            "uniques": uniques,
            "checks": [],
            "triggers": triggers,
            "has_pk": len(pk_cols) > 0
        }

    def get_supported_types(self, database: str = None) -> List[str]:
        """Returns standard types supported in SQLite."""
        return [
            "INTEGER",
            "TEXT",
            "REAL",
            "BLOB",
            "NUMERIC",
            "BOOLEAN",
            "DATETIME",
            "DATE",
            "VARCHAR",
            "NVARCHAR",
            "FLOAT",
            "DECIMAL",
            "BIGINT",
            "TIMESTAMP"
        ]

    def get_foreign_keys(self, database: str = None, schema: str = None, table: str = None) -> List[Dict[str, Any]]:
        """Returns foreign keys for the given table or all tables."""
        if table:
            meta = self.get_table_design_metadata(database, schema, table)
            return meta.get("foreign_keys", []) if meta else []

        # All tables
        tables = self.list_objects(database or "main", schema or "main", "tables")
        all_fks = []
        for t in tables:
            t_name = t["name"]
            meta = self.get_table_design_metadata(database, schema, t_name)
            if meta and meta.get("foreign_keys"):
                all_fks.extend(meta["foreign_keys"])
        return all_fks

    def execute_migration_transaction(self, batches: List[str], database: str = None):
        """
        Executes a sequence of SQL statements inside an atomic transaction.
        If any statement fails, rolls back completely and raises the exception.
        """
        if not self.connection:
            self.connect()

        with self._lock:
            cursor = self.connection.cursor()
            try:
                cursor.execute("BEGIN TRANSACTION;")
                for batch in batches:
                    b_str = batch.strip()
                    if b_str:
                        cursor.execute(b_str)
                cursor.execute("COMMIT;")
            except Exception as e:
                try:
                    cursor.execute("ROLLBACK;")
                except Exception:
                    pass
                raise e
            finally:
                cursor.close()
