# -*- coding: utf-8 -*-
"""
Table Data Editor Service
Handles metadata retrieval, query building (criteria, TOP N),
and safe parameterized INSERT, UPDATE, DELETE for table data editing.
"""

from typing import Any, Dict, List, Optional, Tuple


def _quote_ident(name: str, engine: str) -> str:
    if not name:
        return ""
    if engine.lower() == "postgresql":
        return f'"{name}"'
    return f"[{name}]"


def _format_table_name(schema: str, table: str, engine: str, database: str = None) -> str:
    db_prefix = ""
    if database and engine.lower() != "postgresql":
        db_prefix = f"{_quote_ident(database, engine)}."
    s = schema or ("public" if engine.lower() == "postgresql" else "dbo")
    return f"{db_prefix}{_quote_ident(s, engine)}.{_quote_ident(table, engine)}"


def _param_placeholder(engine: str) -> str:
    return "%s" if engine.lower() == "postgresql" else "?"


class TableDataEditorService:

    # Metadata TTL cache: key=(adapter_id, db, schema, table) -> (meta, expire_time)
    _meta_cache: Dict[tuple, Any] = {}
    _META_TTL_SECONDS = 60  # Refresh metadata at most once per 60 seconds per table

    @classmethod
    def _meta_cache_key(cls, adapter, database, schema, table):
        return (id(adapter), str(database), str(schema), str(table))

    @classmethod
    def _get_cached_metadata(cls, adapter, database, schema, table):
        import time
        key = cls._meta_cache_key(adapter, database, schema, table)
        entry = cls._meta_cache.get(key)
        if entry:
            meta, expires = entry
            if time.time() < expires:
                return meta
        return None

    @classmethod
    def _set_cached_metadata(cls, adapter, database, schema, table, meta):
        import time
        key = cls._meta_cache_key(adapter, database, schema, table)
        cls._meta_cache[key] = (meta, time.time() + cls._META_TTL_SECONDS)

    @classmethod
    def invalidate_metadata_cache(cls, adapter=None, database=None, schema=None, table=None):
        """Invalidate cache on schema change or after submit_changes."""
        if adapter and database and schema and table:
            key = cls._meta_cache_key(adapter, database, schema, table)
            cls._meta_cache.pop(key, None)
        else:
            cls._meta_cache.clear()

    @classmethod
    def get_metadata(cls, adapter, database: str, schema: str, table: str) -> Dict[str, Any]:
        """
        Retrieves column metadata, identifying PKs, Identity, and Computed columns.
        Results are cached for _META_TTL_SECONDS to avoid repeated DB schema queries
        during cell-by-cell validation.
        """
        cached = cls._get_cached_metadata(adapter, database, schema, table)
        if cached is not None:
            return cached

        raw_meta = adapter.get_table_design_metadata(database, schema, table)
        if not raw_meta:
            raise ValueError(f"Table '{schema}.{table}' not found or cannot load metadata.")

        columns = []
        pk_columns = []
        identity_columns = []
        sequence_columns = []
        computed_columns = []

        for col in raw_meta.get("columns", []):
            name = col.get("name")
            type_name = str(col.get("type_name") or col.get("type") or "").lower()
            is_pk = bool(col.get("is_pk"))
            is_identity = bool(col.get("is_identity"))
            is_computed = bool(col.get("is_computed") or type_name in ("timestamp", "rowversion"))
            is_nullable = bool(col.get("nullable", col.get("is_nullable", True)))
            default_val = col.get("default_val") or col.get("default_value") or ""
            is_sequence = bool("next value for" in str(default_val).lower() or "nextval(" in str(default_val).lower())
            if is_sequence:
                is_identity = False

            col_info = {
                "name": name,
                "type": type_name,
                "is_pk": is_pk,
                "is_identity": is_identity,
                "is_sequence": is_sequence,
                "is_computed": is_computed,
                "is_nullable": is_nullable,
                "default_value": default_val,
                "max_length": col.get("max_length"),
                "precision": col.get("precision"),
                "scale": col.get("scale")
            }
            columns.append(col_info)

            if is_pk:
                pk_columns.append(name)
            if is_identity:
                identity_columns.append(name)
            if is_sequence:
                sequence_columns.append(name)
            if is_computed:
                computed_columns.append(name)

        # Build clean uniques
        uniques = []
        for uq in raw_meta.get("uniques", []):
            uniques.append({
                "name": uq.get("name") or uq.get("constraint_name") or "",
                "fields": uq.get("fields", [])
            })

        # Build clean unique indexes
        unique_indexes = []
        for idx in raw_meta.get("indexes", []):
            if idx.get("is_unique"):
                fields = [f.get("column") if isinstance(f, dict) else str(f) for f in idx.get("fields", [])]
                unique_indexes.append({
                    "name": idx.get("name") or "",
                    "fields": fields
                })

        # Build clean foreign keys
        foreign_keys = []
        for fk in raw_meta.get("foreign_keys", []):
            foreign_keys.append({
                "name": fk.get("name") or fk.get("fk_name") or "",
                "fields": fk.get("fields", []),
                "ref_schema": fk.get("ref_schema") or schema,
                "ref_table": fk.get("ref_table") or "",
                "ref_fields": fk.get("ref_fields", [])
            })

        # Build clean checks
        checks = []
        for chk in raw_meta.get("checks", []):
            checks.append({
                "name": chk.get("name") or chk.get("constraint_name") or "",
                "definition": chk.get("definition") or chk.get("check_clause") or ""
            })

        result = {
            "database": database,
            "schema": schema,
            "table": table,
            "engine": getattr(adapter, "db_type", "sqlserver").lower(),
            "columns": columns,
            "pk_columns": pk_columns,
            "identity_columns": identity_columns,
            "sequence_columns": sequence_columns,
            "computed_columns": computed_columns,
            "uniques": uniques,
            "unique_indexes": unique_indexes,
            "foreign_keys": foreign_keys,
            "checks": checks,
            "has_pk": len(pk_columns) > 0
        }
        cls._set_cached_metadata(adapter, database, schema, table, result)
        return result

    @classmethod
    def build_select_sql(
        cls,
        engine: str,
        schema: str,
        table: str,
        select_cols: Optional[List[str]] = None,
        criteria: Optional[List[Dict[str, Any]]] = None,
        top_n: int = 200,
        database: str = None
    ) -> str:
        """
        Builds SSMS-like SELECT query with TOP/LIMIT, WHERE criteria and ORDER BY.
        """
        engine = engine.lower()
        full_table = _format_table_name(schema, table, engine, database)

        # 1. Columns
        if select_cols and len(select_cols) > 0:
            cols_str = ", ".join(_quote_ident(c, engine) for c in select_cols)
        else:
            cols_str = "*"

        # 2. TOP clause
        top_part = ""
        limit_part = ""
        if top_n and int(top_n) > 0:
            if engine == "postgresql":
                limit_part = f"\nLIMIT {int(top_n)}"
            else:
                top_part = f"TOP ({int(top_n)}) "

        # 3. WHERE clause from Criteria
        where_clauses = []
        if criteria and isinstance(criteria, list):
            for row in criteria:
                col_name = row.get("column")
                if not col_name:
                    continue
                q_col = _quote_ident(col_name, engine)
                raw_filter = str(row.get("filter") or "").strip()
                or_filters = row.get("ors") or []

                col_conditions = []
                if raw_filter:
                    col_conditions.append(cls._parse_filter_expr(q_col, raw_filter))

                for or_f in or_filters:
                    or_f_str = str(or_f or "").strip()
                    if or_f_str:
                        col_conditions.append(cls._parse_filter_expr(q_col, or_f_str))

                if col_conditions:
                    if len(col_conditions) == 1:
                        where_clauses.append(col_conditions[0])
                    else:
                        combined = " OR ".join(col_conditions)
                        where_clauses.append(f"({combined})")

        where_part = ""
        if where_clauses:
            where_part = f"\nWHERE " + " AND ".join(where_clauses)

        # 4. ORDER BY from Criteria
        order_clauses = []
        if criteria and isinstance(criteria, list):
            # Sort by sort_order
            sorted_crit = sorted(
                [r for r in criteria if r.get("sort_type") in ("ASC", "DESC", "Ascending", "Descending")],
                key=lambda x: int(x.get("sort_order") or 999)
            )
            for r in sorted_crit:
                col_name = r.get("column")
                st = str(r.get("sort_type") or "ASC").upper()
                dir_str = "DESC" if "DESC" in st else "ASC"
                order_clauses.append(f"{_quote_ident(col_name, engine)} {dir_str}")

        order_part = ""
        if order_clauses:
            order_part = f"\nORDER BY " + ", ".join(order_clauses)

        return f"SELECT {top_part}{cols_str}\nFROM {full_table}{where_part}{order_part}{limit_part}"

    @classmethod
    def _parse_filter_expr(cls, quoted_col: str, expr: str) -> str:
        """
        Parses human-typed filter string like "= 'HD'", "> 100", "LIKE '%A%'", "IS NULL", "10"
        into valid SQL condition.
        """
        s = expr.strip()
        upper_s = s.upper()

        if upper_s.startswith("IS NULL") or upper_s.startswith("IS NOT NULL"):
            return f"{quoted_col} {s}"
        if upper_s.startswith("BETWEEN "):
            return f"{quoted_col} {s}"
        if upper_s.startswith("IN (") or upper_s.startswith("NOT IN ("):
            return f"{quoted_col} {s}"

        operators = ["=", "<>", "!=", ">=", "<=", ">", "<", "LIKE", "NOT LIKE"]
        for op in operators:
            if s.startswith(op):
                val = s[len(op):].strip()
                return f"{quoted_col} {op} {val}"

        # If user just typed a raw value without operator, default to =
        return f"{quoted_col} = {s}"

    @classmethod
    def fetch_data(
        cls,
        adapter,
        database: str,
        schema: str,
        table: str,
        select_cols: Optional[List[str]] = None,
        criteria: Optional[List[Dict[str, Any]]] = None,
        top_n: int = 200,
        custom_sql: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes SELECT query to load data into the Data Grid.
        """
        engine = getattr(adapter, "db_type", "sqlserver").lower()
        if custom_sql and custom_sql.strip():
            sql = custom_sql.strip()
        else:
            if not select_cols:
                try:
                    meta = cls.get_metadata(adapter, database, schema, table)
                    select_cols = [c["name"] for c in meta.get("columns", [])]
                except Exception:
                    pass
            sql = cls.build_select_sql(
                engine=engine,
                schema=schema,
                table=table,
                select_cols=select_cols,
                criteria=criteria,
                top_n=top_n,
                database=database
            )

        res = adapter.execute(sql, limit=None, database=database)
        if not res.get("success", True) and res.get("error"):
            raise RuntimeError(res["error"])

        return {
            "sql": sql,
            "columns": res.get("columns", []),
            "rows": res.get("rows", []),
            "row_count": res.get("row_count", 0),
            "messages": res.get("messages", [])
        }

    @classmethod
    def update_row(
        cls,
        adapter,
        database: str,
        schema: str,
        table: str,
        pk_conditions: Dict[str, Any],
        changes: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Performs safe parameterized UPDATE statement on a specific row.
        """
        if not changes:
            return {"success": True, "affected": 0, "message": "No changes to update"}
        if not pk_conditions:
            raise ValueError("Cannot update row: missing row identifier / primary key condition.")

        engine = getattr(adapter, "db_type", "sqlserver").lower()
        full_table = _format_table_name(schema, table, engine, database)
        placeholder = _param_placeholder(engine)

        set_clauses = []
        set_params = []
        preview_sets = []

        for col, new_val in changes.items():
            set_clauses.append(f"{_quote_ident(col, engine)} = {placeholder}")
            set_params.append(new_val)
            val_repr = "NULL" if new_val is None else f"'{new_val}'" if isinstance(new_val, str) else str(new_val)
            preview_sets.append(f"{_quote_ident(col, engine)} = {val_repr}")

        where_clauses = []
        where_params = []
        preview_wheres = []

        for col, val in pk_conditions.items():
            if val is None:
                where_clauses.append(f"{_quote_ident(col, engine)} IS NULL")
                preview_wheres.append(f"{_quote_ident(col, engine)} IS NULL")
            else:
                where_clauses.append(f"{_quote_ident(col, engine)} = {placeholder}")
                where_params.append(val)
                val_repr = f"'{val}'" if isinstance(val, str) else str(val)
                preview_wheres.append(f"{_quote_ident(col, engine)} = {val_repr}")

        sql = f"UPDATE {full_table}\nSET " + ", ".join(set_clauses) + "\nWHERE " + " AND ".join(where_clauses) + ";"
        preview_sql = f"UPDATE {full_table}\nSET " + ", ".join(preview_sets) + "\nWHERE " + " AND ".join(preview_wheres) + ";"

        all_params = tuple(set_params + where_params)
        res = adapter.execute(sql, params=all_params, database=database)

        if not res.get("success", True) and res.get("error"):
            raise RuntimeError(res["error"])

        return {
            "success": True,
            "affected": res.get("row_count", 1),
            "sql": preview_sql
        }

    @classmethod
    def delete_row(
        cls,
        adapter,
        database: str,
        schema: str,
        table: str,
        pk_conditions: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Performs safe parameterized DELETE statement for a specific row.
        """
        if not pk_conditions:
            raise ValueError("Cannot delete row: missing row identifier / primary key condition.")

        engine = getattr(adapter, "db_type", "sqlserver").lower()
        full_table = _format_table_name(schema, table, engine, database)
        placeholder = _param_placeholder(engine)

        where_clauses = []
        where_params = []
        preview_wheres = []

        for col, val in pk_conditions.items():
            if val is None:
                where_clauses.append(f"{_quote_ident(col, engine)} IS NULL")
                preview_wheres.append(f"{_quote_ident(col, engine)} IS NULL")
            else:
                where_clauses.append(f"{_quote_ident(col, engine)} = {placeholder}")
                where_params.append(val)
                val_repr = f"'{val}'" if isinstance(val, str) else str(val)
                preview_wheres.append(f"{_quote_ident(col, engine)} = {val_repr}")

        sql = f"DELETE FROM {full_table}\nWHERE " + " AND ".join(where_clauses) + ";"
        preview_sql = f"DELETE FROM {full_table}\nWHERE " + " AND ".join(preview_wheres) + ";"

        res = adapter.execute(sql, params=tuple(where_params), database=database)
        if not res.get("success", True) and res.get("error"):
            raise RuntimeError(res["error"])

        return {
            "success": True,
            "affected": res.get("row_count", 1),
            "sql": preview_sql
        }

    @classmethod
    def insert_row(
        cls,
        adapter,
        database: str,
        schema: str,
        table: str,
        values: Dict[str, Any],
        identity_columns: Optional[List[str]] = None,
        computed_columns: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Performs safe parameterized INSERT statement for a new row,
        automatically excluding identity and computed columns.
        """
        skip_cols_lower = {str(c).strip().lower() for c in ((identity_columns or []) + (computed_columns or []))}
        insert_data = {k: v for k, v in values.items() if k.strip().lower() not in skip_cols_lower}

        if not insert_data:
            # Table has only identity or default columns
            engine = getattr(adapter, "db_type", "sqlserver").lower()
            full_table = _format_table_name(schema, table, engine, database)
            if engine == "postgresql":
                sql = f"INSERT INTO {full_table} DEFAULT VALUES;"
            else:
                sql = f"INSERT INTO {full_table} DEFAULT VALUES;"
            res = adapter.execute(sql, database=database)
            return {"success": True, "affected": res.get("row_count", 1), "sql": sql}

        engine = getattr(adapter, "db_type", "sqlserver").lower()
        full_table = _format_table_name(schema, table, engine, database)
        placeholder = _param_placeholder(engine)

        cols = list(insert_data.keys())
        params = [insert_data[c] for c in cols]

        cols_str = ", ".join(_quote_ident(c, engine) for c in cols)
        placeholders_str = ", ".join(placeholder for _ in cols)

        preview_vals = []
        for c in cols:
            v = insert_data[c]
            preview_vals.append("NULL" if v is None else f"'{v}'" if isinstance(v, str) else str(v))
        preview_sql = f"INSERT INTO {full_table} ({cols_str})\nVALUES ({', '.join(preview_vals)});"

        sql = f"INSERT INTO {full_table} ({cols_str})\nVALUES ({placeholders_str});"

        res = adapter.execute(sql, params=tuple(params), database=database)
        if not res.get("success", True) and res.get("error"):
            raise RuntimeError(res["error"])

        return {
            "success": True,
            "affected": res.get("row_count", 1),
            "sql": preview_sql
        }

    @classmethod
    def submit_changes(
        cls,
        adapter,
        database: str,
        schema: str,
        table: str,
        changes: Dict[str, Any],
        concurrency_mode: str = "optimistic"
    ) -> Dict[str, Any]:
        """
        Executes inserts, updates, and deletes in a SINGLE ATOMIC TRANSACTION.
        
        Adheres to:
         1. Transaction Atomicity: All operations occur within 1 transaction; rolls back on any error.
         2. Optimistic Concurrency Control: Checks original values in WHERE, ensures rowcount > 0.
         3. Heap Table Handling: Fallbacks to Full-Row matching with IS NULL when table has no PK.
         4. Identity / Sequence: SET IDENTITY_INSERT ON/OFF for MSSQL; sequence sync for PostgreSQL.
         5. Parameter batching / safe parameterized execution.
        """
        if not changes:
            return {"success": True, "inserted": 0, "updated": 0, "deleted": 0, "total": 0, "message": "No changes"}

        engine = getattr(adapter, "db_type", "sqlserver").lower()
        full_table = _format_table_name(schema, table, engine, database)
        placeholder = _param_placeholder(engine)

        meta = cls.get_metadata(adapter, database, schema, table)
        identity_columns = set(meta.get("identity_columns", []))
        computed_columns = set(meta.get("computed_columns", []))
        identity_cols_lower = {str(c).strip().lower() for c in identity_columns}
        computed_cols_lower = {str(c).strip().lower() for c in computed_columns}
        pk_cols_lower = {str(c).strip().lower() for c in meta.get("pk_columns", [])}
        default_cols_lower = {str(c.get("name")).strip().lower() for c in meta.get("columns", []) if c.get("default_value")}
        skip_cols_lower = identity_cols_lower | computed_cols_lower

        inserts = changes.get("inserts", []) or []
        updates = changes.get("updates", []) or []
        deletes = changes.get("deletes", []) or []

        if not (inserts or updates or deletes):
            return {"success": True, "inserted": 0, "updated": 0, "deleted": 0, "total": 0, "message": "No changes"}

        # Obtain underlying connection and cursor
        conn = getattr(adapter, "connection", None)
        if not conn and hasattr(adapter, "connect"):
            adapter.connect()
            conn = getattr(adapter, "connection", None)

        if not conn:
            raise RuntimeError("Không thể kết nối đến cơ sở dữ liệu để thực thi giao dịch.")

        cursor = conn.cursor()
        old_autocommit = getattr(conn, "autocommit", True)

        try:
            # 1. Switch database for SQL Server if needed
            if engine != "postgresql" and database:
                clean_db = str(database).replace("]", "]]")
                try:
                    cursor.execute(f"USE [{clean_db}]")
                except Exception:
                    pass

            # 2. Begin explicit transaction
            conn.autocommit = False

            # 3. Check for explicit Identity Insert (MSSQL)
            # Only enable if user explicitly provided non-empty value for an identity column
            has_identity_insert = False
            if engine != "postgresql" and identity_columns:
                for ins in inserts:
                    ins_data = ins.get("data", {})
                    if any(k.strip().lower() in identity_cols_lower and ins_data.get(k) not in (None, "", "<Auto>") for k in ins_data):
                        has_identity_insert = True
                        break

            if has_identity_insert:
                cursor.execute(f"SET IDENTITY_INSERT {full_table} ON;")

            # 4. Execute INSERTS
            inserted_count = 0
            for ins in inserts:
                raw_data = ins.get("data", {})
                # Filter out computed columns
                ins_data = {k: v for k, v in raw_data.items() if k.strip().lower() not in computed_cols_lower}
                if not has_identity_insert:
                    ins_data = {k: v for k, v in ins_data.items() if k.strip().lower() not in identity_cols_lower}
                # Filter out PK columns or default columns if empty/None so database defaults or auto-increment apply
                ins_data = {
                    k: v for k, v in ins_data.items()
                    if not (k.strip().lower() in pk_cols_lower and (v is None or v == "" or v == "<Auto>"))
                    and not (k.strip().lower() in default_cols_lower and (v is None or v == ""))
                }

                if not ins_data:
                    cursor.execute(f"INSERT INTO {full_table} DEFAULT VALUES;")
                else:
                    cols = list(ins_data.keys())
                    params = [ins_data[c] for c in cols]
                    cols_str = ", ".join(_quote_ident(c, engine) for c in cols)
                    placeholders_str = ", ".join(placeholder for _ in cols)
                    sql = f"INSERT INTO {full_table} ({cols_str}) VALUES ({placeholders_str});"
                    cursor.execute(sql, tuple(params))
                inserted_count += 1

            if has_identity_insert:
                cursor.execute(f"SET IDENTITY_INSERT {full_table} OFF;")

            # PostgreSQL sequence synchronization if custom identity inserted
            if engine == "postgresql" and identity_columns:
                for ident_col in identity_columns:
                    try:
                        seq_sql = f"SELECT setval(pg_get_serial_sequence('{table}', '{ident_col}'), coalesce(max({_quote_ident(ident_col, engine)}), 1)) FROM {full_table};"
                        cursor.execute(seq_sql)
                    except Exception:
                        pass

            # 5. Execute UPDATES
            updated_count = 0
            for upd in updates:
                keys = upd.get("keys", {})
                orig_data = upd.get("original_data", {})
                mod_data = upd.get("modified_data", {})

                # Exclude computed columns from modifications
                mod_data = {k: v for k, v in mod_data.items() if k not in computed_columns}
                if not mod_data:
                    continue

                set_clauses = []
                set_params = []
                for c, v in mod_data.items():
                    set_clauses.append(f"{_quote_ident(c, engine)} = {placeholder}")
                    set_params.append(v)

                where_clauses = []
                where_params = []

                if keys:
                    for c, v in keys.items():
                        if v is None:
                            where_clauses.append(f"{_quote_ident(c, engine)} IS NULL")
                        else:
                            where_clauses.append(f"{_quote_ident(c, engine)} = {placeholder}")
                            where_params.append(v)

                # Optimistic locking: also compare original values
                if concurrency_mode == "optimistic" and orig_data:
                    for c, v in orig_data.items():
                        if c in keys or c in computed_columns:
                            continue
                        if v is None:
                            where_clauses.append(f"{_quote_ident(c, engine)} IS NULL")
                        else:
                            where_clauses.append(f"{_quote_ident(c, engine)} = {placeholder}")
                            where_params.append(v)
                elif not keys and orig_data:
                    # Heap table fallback (no PK)
                    for c, v in orig_data.items():
                        if c in computed_columns:
                            continue
                        if v is None:
                            where_clauses.append(f"{_quote_ident(c, engine)} IS NULL")
                        else:
                            where_clauses.append(f"{_quote_ident(c, engine)} = {placeholder}")
                            where_params.append(v)

                if not where_clauses:
                    raise ValueError(f"Không thể cập nhật dòng dữ liệu do thiếu điều kiện định danh khóa hoặc giá trị gốc: {upd}")

                update_sql = f"UPDATE {full_table} SET " + ", ".join(set_clauses) + " WHERE " + " AND ".join(where_clauses) + ";"
                cursor.execute(update_sql, tuple(set_params + where_params))

                if concurrency_mode == "optimistic" and cursor.rowcount == 0:
                    raise RuntimeError(
                        f"Xung đột ghi đè (Optimistic Concurrency Conflict): Dòng dữ liệu với khóa {keys} đã bị thay đổi hoặc xóa bởi phiên làm việc khác trước đó."
                    )
                updated_count += 1

            # 6. Execute DELETES
            deleted_count = 0
            for d in deletes:
                keys = d.get("keys", {})
                orig_data = d.get("original_data", {})

                where_clauses = []
                where_params = []

                if keys:
                    for c, v in keys.items():
                        if v is None:
                            where_clauses.append(f"{_quote_ident(c, engine)} IS NULL")
                        else:
                            where_clauses.append(f"{_quote_ident(c, engine)} = {placeholder}")
                            where_params.append(v)

                if concurrency_mode == "optimistic" and orig_data:
                    for c, v in orig_data.items():
                        if c in keys or c in computed_columns:
                            continue
                        if v is None:
                            where_clauses.append(f"{_quote_ident(c, engine)} IS NULL")
                        else:
                            where_clauses.append(f"{_quote_ident(c, engine)} = {placeholder}")
                            where_params.append(v)
                elif not keys and orig_data:
                    # Heap table fallback
                    for c, v in orig_data.items():
                        if c in computed_columns:
                            continue
                        if v is None:
                            where_clauses.append(f"{_quote_ident(c, engine)} IS NULL")
                        else:
                            where_clauses.append(f"{_quote_ident(c, engine)} = {placeholder}")
                            where_params.append(v)

                if not where_clauses:
                    raise ValueError(f"Không thể xóa dòng dữ liệu do thiếu điều kiện định danh khóa hoặc giá trị gốc: {d}")

                delete_sql = f"DELETE FROM {full_table} WHERE " + " AND ".join(where_clauses) + ";"
                cursor.execute(delete_sql, tuple(where_params))

                if concurrency_mode == "optimistic" and cursor.rowcount == 0:
                    raise RuntimeError(
                        f"Xung đột xóa dữ liệu (Optimistic Concurrency Conflict): Dòng dữ liệu với khóa {keys} không còn tồn tại hoặc đã bị thay đổi bởi phiên khác trước đó."
                    )
                deleted_count += 1

            # 7. Commit Transaction
            conn.commit()

            return {
                "success": True,
                "inserted": inserted_count,
                "updated": updated_count,
                "deleted": deleted_count,
                "total": inserted_count + updated_count + deleted_count,
                "message": f"Đã lưu thành công: {inserted_count} thêm mới, {updated_count} cập nhật, {deleted_count} xóa."
            }

        except Exception as exc:
            try:
                conn.rollback()
            except Exception:
                pass
            raise exc
        finally:
            try:
                conn.autocommit = old_autocommit
            except Exception:
                pass

    @classmethod
    def validate_insert_rows(
        cls,
        adapter,
        database: str,
        schema: str,
        table: str,
        rows: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Validates multiple rows sequentially against database constraints (FK, PK, Check, Not Null, Data types).
        For each row:
          - Attempts INSERT inside an isolated transaction
          - Catches any SQL exception and formats a clean error message
          - ALWAYS rolls back so no database changes persist
        Returns detailed per-row outcomes and summary counts.
        """
        if not rows:
            return {"success": True, "total": 0, "valid_count": 0, "error_count": 0, "results": []}

        meta = cls.get_metadata(adapter, database, schema, table)
        identity_columns = set(meta.get("identity_columns", []))
        computed_columns = set(meta.get("computed_columns", []))
        identity_cols_lower = {str(c).strip().lower() for c in identity_columns}
        computed_cols_lower = {str(c).strip().lower() for c in computed_columns}
        pk_cols_lower = {str(c).strip().lower() for c in meta.get("pk_columns", [])}
        default_cols_lower = {str(c.get("name")).strip().lower() for c in meta.get("columns", []) if c.get("default_value")}
        skip_cols_lower = identity_cols_lower | computed_cols_lower

        engine = getattr(adapter, "db_type", "sqlserver").lower()
        full_table = _format_table_name(schema, table, engine, database)
        placeholder = _param_placeholder(engine)

        conn = getattr(adapter, "connection", None)
        if not conn and hasattr(adapter, "connect"):
            adapter.connect()
            conn = getattr(adapter, "connection", None)

        if not conn:
            raise RuntimeError("Không thể kết nối đến cơ sở dữ liệu để kiểm tra ràng buộc.")

        cursor = conn.cursor()
        old_autocommit = getattr(conn, "autocommit", True)

        results = []
        try:
            if engine != "postgresql" and database:
                clean_db = str(database).replace("]", "]]")
                try:
                    cursor.execute(f"USE [{clean_db}]")
                except Exception:
                    pass

            conn.autocommit = False

            for idx, raw_row in enumerate(rows):
                # Filter out identity and computed columns, and empty PKs or default columns to let auto-increment/defaults apply
                insert_data = {
                    k: v for k, v in raw_row.items()
                    if k.strip().lower() not in skip_cols_lower
                }
                insert_data = {
                    k: v for k, v in insert_data.items()
                    if not (k.strip().lower() in pk_cols_lower and (v is None or v == "" or v == "<Auto>"))
                    and not (k.strip().lower() in default_cols_lower and (v is None or v == ""))
                }
                try:
                    if not insert_data:
                        cursor.execute(f"INSERT INTO {full_table} DEFAULT VALUES;")
                    else:
                        cols = list(insert_data.keys())
                        params = [insert_data[c] for c in cols]
                        cols_str = ", ".join(_quote_ident(c, engine) for c in cols)
                        placeholders_str = ", ".join(placeholder for _ in cols)
                        sql = f"INSERT INTO {full_table} ({cols_str}) VALUES ({placeholders_str});"
                        cursor.execute(sql, tuple(params))

                    # Always rollback this test row immediately
                    conn.rollback()
                    results.append({"row_index": idx, "valid": True, "data": raw_row})
                except Exception as ex:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    err_msg = _clean_sql_error(ex)
                    results.append({"row_index": idx, "valid": False, "error": err_msg, "data": raw_row})

            valid_count = sum(1 for r in results if r["valid"])
            error_count = len(results) - valid_count

            return {
                "success": True,
                "total": len(rows),
                "valid_count": valid_count,
                "error_count": error_count,
                "results": results
            }

        finally:
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                conn.autocommit = old_autocommit
            except Exception:
                pass

    @classmethod
    def validate_row(
        cls,
        adapter,
        database: str,
        schema: str,
        table: str,
        values: Dict[str, Any],
        keys: Optional[Dict[str, Any]] = None,
        is_new: bool = True,
        target_column: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Smart constraint checking for Table Data Editor:
        1. NOT NULL constraint on target_column (or cleared columns).
        2. Unique Constraints / Unique Indexes / PK:
           Only evaluates when ALL columns of the unique constraint have values.
           If duplicate found in DB -> returns valid=False, constraint_type, constraint_name, columns, values, error.
        3. Foreign Keys:
           If FK columns are filled, verifies existence in referenced table.
        4. Transactional validation for CHECK constraints and other database triggers.
        """
        meta = cls.get_metadata(adapter, database, schema, table)
        engine = getattr(adapter, "db_type", "sqlserver").lower()
        full_table = _format_table_name(schema, table, engine, database)
        placeholder = _param_placeholder(engine)

        conn = getattr(adapter, "connection", None)
        if not conn and hasattr(adapter, "connect"):
            adapter.connect()
            conn = getattr(adapter, "connection", None)

        if not conn:
            raise RuntimeError("Không thể kết nối đến cơ sở dữ liệu để kiểm tra ràng buộc.")

        cursor = conn.cursor()
        old_autocommit = getattr(conn, "autocommit", True)

        try:
            if engine != "postgresql" and database:
                clean_db = str(database).replace("]", "]]")
                try:
                    cursor.execute(f"USE [{clean_db}]")
                except Exception:
                    pass

            columns_by_name = {str(c["name"]).strip().lower(): c for c in meta.get("columns", [])}

            # 1. NOT NULL Check
            cols_to_check_not_null = [target_column] if target_column else list(values.keys())
            for c_name in cols_to_check_not_null:
                if not c_name:
                    continue
                c_meta = columns_by_name.get(str(c_name).strip().lower())
                if c_meta and not c_meta.get("is_nullable", True):
                    # Column is NOT NULL
                    # If it has default, identity, sequence, computed: it can be omitted/empty
                    if not (c_meta.get("is_identity") or c_meta.get("is_computed") or c_meta.get("is_sequence") or c_meta.get("default_value")):
                        v = values.get(c_meta["name"], values.get(c_name))
                        if v is None or v == "" or str(v).upper() == "NULL":
                            return {
                                "valid": False,
                                "constraint_type": "NOT_NULL",
                                "constraint_name": None,
                                "columns": [c_meta["name"]],
                                "values": {c_meta["name"]: None},
                                "error": f"Cột '{c_meta['name']}' không được phép để trống (Not NULL)."
                            }

            # 2. UNIQUE / PK Constraints Check
            unique_specs = []

            # Add PK if exists
            pk_cols = meta.get("pk_columns", [])
            if pk_cols:
                unique_specs.append({
                    "name": f"PK_{table}",
                    "fields": pk_cols,
                    "is_pk": True
                })

            for uq in meta.get("uniques", []):
                uq_fields = uq.get("fields", [])
                if uq_fields:
                    unique_specs.append({
                        "name": uq.get("name") or f"UQ_{table}",
                        "fields": uq_fields,
                        "is_pk": False
                    })

            for uidx in meta.get("unique_indexes", []):
                uidx_fields = uidx.get("fields", [])
                if uidx_fields:
                    if not any(set(s["fields"]) == set(uidx_fields) for s in unique_specs):
                        unique_specs.append({
                            "name": uidx.get("name") or f"UIDX_{table}",
                            "fields": uidx_fields,
                            "is_pk": False
                        })

            if target_column:
                t_col_lower = str(target_column).strip().lower()
                unique_specs = [s for s in unique_specs if any(str(f).strip().lower() == t_col_lower for f in s.get("fields", []))]

            for spec in unique_specs:
                spec_fields = spec["fields"]
                matched_values = {}
                has_all_values = True
                for f in spec_fields:
                    f_lower = str(f).strip().lower()
                    val = None
                    found = False
                    for vk, vv in (values or {}).items():
                        if str(vk).strip().lower() == f_lower:
                            val = vv
                            found = True
                            break
                    if not found or val is None or val == "" or str(val) == "<Auto>":
                        has_all_values = False
                        break
                    matched_values[f] = val

                # If NOT all fields have values, DO NOT trigger unique error yet! (Supports composite unique like A, B, C)
                if not has_all_values:
                    continue

                # All fields are filled! Check if record already exists in DB
                where_clauses = []
                where_params = []
                for f, fval in matched_values.items():
                    where_clauses.append(f"{_quote_ident(f, engine)} = {placeholder}")
                    where_params.append(fval)

                # If updating existing row, exclude current row using keys
                if not is_new and keys:
                    pk_exclude = []
                    for pk_c, pk_v in keys.items():
                        if pk_v is None:
                            pk_exclude.append(f"{_quote_ident(pk_c, engine)} IS NOT NULL")
                        else:
                            pk_exclude.append(f"{_quote_ident(pk_c, engine)} != {placeholder}")
                            where_params.append(pk_v)
                    if pk_exclude:
                        where_clauses.append("(" + " OR ".join(pk_exclude) + ")")

                if engine == "sqlserver":
                    check_sql = f"SELECT TOP 1 1 FROM {full_table} WHERE " + " AND ".join(where_clauses) + ";"
                else:
                    check_sql = f"SELECT 1 FROM {full_table} WHERE " + " AND ".join(where_clauses) + " LIMIT 1;"

                cursor.execute(check_sql, tuple(where_params))
                row_found = cursor.fetchone()
                if row_found:
                    # VIOLATION FOUND!
                    val_str = ", ".join(str(matched_values[f]) for f in spec_fields)
                    c_name = spec["name"]
                    c_type = "PRIMARY KEY" if spec["is_pk"] else "UNIQUE KEY"
                    if spec["is_pk"]:
                        err_msg = f"Violation of PRIMARY KEY constraint '{c_name}'. Cannot insert duplicate key in object '{schema}.{table}'. The duplicate key value is ({val_str})."
                    else:
                        err_msg = f"Violation of UNIQUE KEY constraint '{c_name}'. Cannot insert duplicate key in object '{schema}.{table}'. The duplicate key value is ({val_str})."
                    return {
                        "valid": False,
                        "constraint_type": c_type,
                        "constraint_name": c_name,
                        "columns": spec_fields,
                        "values": matched_values,
                        "error": err_msg
                    }

            # 3. Foreign Key Check
            fks_to_check = meta.get("foreign_keys", [])
            if target_column:
                t_col_lower = str(target_column).strip().lower()
                fks_to_check = [fk for fk in fks_to_check if any(str(f).strip().lower() == t_col_lower for f in (fk.get("fields") or []))]

            for fk in fks_to_check:
                fk_fields = fk.get("fields", [])
                ref_fields = fk.get("ref_fields", [])
                ref_table = fk.get("ref_table")
                ref_schema = fk.get("ref_schema") or schema
                if fk_fields and ref_fields and ref_table:
                    matched_fk = {}
                    has_all_fk = True
                    for idx_f, f in enumerate(fk_fields):
                        f_lower = str(f).strip().lower()
                        val = None
                        found = False
                        for vk, vv in (values or {}).items():
                            if str(vk).strip().lower() == f_lower:
                                val = vv
                                found = True
                                break
                        if not found or val is None or val == "" or str(val) == "<Auto>":
                            has_all_fk = False
                            break
                        matched_fk[ref_fields[idx_f]] = val

                    if has_all_fk:
                        ref_full = _format_table_name(ref_schema, ref_table, engine, database)
                        ref_where = [f"{_quote_ident(rf, engine)} = {placeholder}" for rf in matched_fk.keys()]
                        ref_params = list(matched_fk.values())
                        if engine == "sqlserver":
                            ref_sql = f"SELECT TOP 1 1 FROM {ref_full} WHERE " + " AND ".join(ref_where) + ";"
                        else:
                            ref_sql = f"SELECT 1 FROM {ref_full} WHERE " + " AND ".join(ref_where) + " LIMIT 1;"
                        cursor.execute(ref_sql, tuple(ref_params))
                        if not cursor.fetchone():
                            fk_name = fk.get("name") or "FK"
                            return {
                                "valid": False,
                                "constraint_type": "FOREIGN KEY",
                                "constraint_name": fk_name,
                                "columns": fk_fields,
                                "values": matched_fk,
                                "error": f"The statement conflicted with the FOREIGN KEY constraint '{fk_name}'. The conflict occurred in database '{database}', table '{ref_schema}.{ref_table}'."
                            }

            # 4. Check Transactional (for CHECK constraints, triggers, update concurrency)
            computed_columns = set(meta.get("computed_columns", []))
            identity_columns = set(meta.get("identity_columns", []))
            sequence_columns = set(meta.get("sequence_columns", []))
            skip_cols = {str(c).strip().lower() for c in (computed_columns | identity_columns)}
            default_cols_lower2 = {str(c.get("name")).strip().lower() for c in meta.get("columns", []) if c.get("default_value")}
            pk_cols_lower2 = {str(c).strip().lower() for c in meta.get("pk_columns", [])}
            seq_cols_lower2 = {str(c).strip().lower() for c in sequence_columns}

            if is_new and target_column is None:
                # Trial INSERT in isolated transaction (always rolled back)
                # Only runs during full-row validation (not per-cell), to detect CHECK constraints
                # and trigger errors that SELECT-based checks cannot catch
                trial_data = {}
                for k, v in (values or {}).items():
                    k_lower = k.strip().lower()
                    if k_lower in skip_cols:
                        continue
                    if k_lower in pk_cols_lower2 and (v is None or v == "" or v == "<Auto>"):
                        continue
                    if k_lower in default_cols_lower2 and (v is None or v == ""):
                        continue
                    if k_lower in seq_cols_lower2 and (v is None or v == ""):
                        continue
                    trial_data[k] = v

                if trial_data:
                    conn.autocommit = False
                    t_cols = list(trial_data.keys())
                    t_params = [trial_data[c] for c in t_cols]
                    t_cols_str = ", ".join(_quote_ident(c, engine) for c in t_cols)
                    t_ph_str = ", ".join(placeholder for _ in t_cols)
                    trial_sql = f"INSERT INTO {full_table} ({t_cols_str}) VALUES ({t_ph_str});"
                    cursor.execute(trial_sql, tuple(t_params))
                    conn.rollback()

            elif not is_new and keys and target_column is None:
                conn.autocommit = False
                set_clauses = []
                set_params = []
                for c, v in (values or {}).items():
                    if c.strip().lower() not in skip_cols:
                        set_clauses.append(f"{_quote_ident(c, engine)} = {placeholder}")
                        set_params.append(v)
                where_clauses = []
                where_params = []
                for c, v in keys.items():
                    if v is None:
                        where_clauses.append(f"{_quote_ident(c, engine)} IS NULL")
                    else:
                        where_clauses.append(f"{_quote_ident(c, engine)} = {placeholder}")
                        where_params.append(v)
                if set_clauses and where_clauses:
                    sql = f"UPDATE {full_table} SET " + ", ".join(set_clauses) + " WHERE " + " AND ".join(where_clauses) + ";"
                    cursor.execute(sql, tuple(set_params + where_params))
                conn.rollback()

            return {
                "valid": True,
                "error": None,
                "constraint_type": None,
                "constraint_name": None,
                "columns": []
            }

        except Exception as ex:
            try:
                conn.rollback()
            except Exception:
                pass
            raw_msg = str(ex)
            err_msg = _clean_sql_error(ex)
            constraint_type = "CHECK" if "CHECK constraint" in raw_msg else "DATABASE ERROR"
            constraint_name = None
            import re
            m = re.search(r"constraint ['\"]([^'\"]+)['\"]", raw_msg, re.IGNORECASE)
            if m:
                constraint_name = m.group(1)
            return {
                "valid": False,
                "constraint_type": constraint_type,
                "constraint_name": constraint_name,
                "columns": [target_column] if target_column else [],
                "error": err_msg
            }
        finally:
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                conn.autocommit = old_autocommit
            except Exception:
                pass

    @classmethod
    def validate_insert_row(
        cls,
        adapter,
        database: str,
        schema: str,
        table: str,
        values: Dict[str, Any],
        target_column: Optional[str] = None
    ) -> Dict[str, Any]:
        """Convenience method to validate a single insert row."""
        return cls.validate_row(adapter, database, schema, table, values, keys=None, is_new=True, target_column=target_column)


def _clean_sql_error(raw_err: Any) -> str:
    """Cleans up ODBC / Database driver wrapper messages into clear SQL error descriptions."""
    if not raw_err:
        return "Lỗi cơ sở dữ liệu không xác định."
    s = str(raw_err)
    import re
    # PyODBC format: [23000] [Microsoft][ODBC Driver 17 for SQL Server][SQL Server]The INSERT statement conflicted with the FOREIGN KEY constraint... (547) (SQLExecDirectW)
    if "[SQL Server]" in s:
        parts = s.split("[SQL Server]")
        msg = parts[-1]
        msg = re.sub(r"\(\d+\)\s*\([A-Za-z0-9_]+\).*$", "", msg).strip()
        msg = msg.rstrip("')\"").strip()
        return msg
    # Clean common prefixes
    for prefix in ["[Microsoft][ODBC Driver 17 for SQL Server]", "[ODBC SQL Server Driver]", "ERROR:"]:
        if prefix in s:
            s = s.replace(prefix, "").strip()
    return s.strip()

