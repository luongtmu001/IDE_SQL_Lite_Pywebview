import logging
import re
import time
from app.database.base import DatabaseAdapter
from app.utils.db_message import clean_db_message, parse_error_details
from app.database.sql_utils import quote_ident, quote_qualified

logger = logging.getLogger(__name__)

try:
    import pyodbc
except ImportError:
    pyodbc = None


def escape_odbc_value(val) -> str:
    """
    Escape an ODBC connection string value according to Microsoft ODBC specification.
    If the value contains ';', '{', '}', '=', or leading/trailing whitespace, wrap in '{...}'
    and escape any closing brace '}' as '}}'.
    """
    if val is None:
        return ""
    s = str(val)
    needs_braces = any(ch in s for ch in (";", "{", "}", "=")) or s.startswith(" ") or s.endswith(" ")
    if needs_braces:
        escaped = s.replace("}", "}}")
        return f"{{{escaped}}}"
    return s


def _convert_sql_variant(val):
    if val is None:
        return None
    if isinstance(val, bytes):
        try:
            return val.decode("utf-8")
        except UnicodeDecodeError:
            try:
                return val.decode("latin1")
            except Exception:
                return "0x" + val.hex()
    return str(val)

def serialize_cell(val):
    if val is None:
        return None
    if isinstance(val, (int, float, bool, str)):
        return val
    if isinstance(val, (bytes, bytearray, memoryview)):
        return "0x" + bytes(val).hex()
    return str(val)

def qualify_sql_with_schema(sql: str, schema: str) -> str:
    """
    Qualify unqualified table names in DQL/DML queries with target schema
    to enforce schema isolation in SQL Server (which otherwise falls back to 'dbo').
    """
    if not sql or not schema:
        return sql
    clean_schema = str(schema).strip().strip("[]")
    if not clean_schema or clean_schema.lower() in ("dbo", "sys", "information_schema"):
        return sql

    # Identify CTE names in WITH clause if any
    cte_names = set()
    with_match = re.search(r'^\s*WITH\s+([A-Za-z0-9_#$]+|\[[^\]]+\]|"[^"]+")\s+AS\s*\(', sql, re.IGNORECASE)
    if with_match:
        raw_cte = with_match.group(1).strip().strip('[]"')
        cte_names.add(raw_cte.lower())
        for extra in re.finditer(r',\s*([A-Za-z0-9_#$]+|\[[^\]]+\]|"[^"]+")\s+AS\s*\(', sql, re.IGNORECASE):
            cte_names.add(extra.group(1).strip().strip('[]"').lower())

    # Protect string literals and comments
    tokens = []
    def save_token(m):
        tokens.append(m.group(0))
        return f"__SQL_LITERAL_{len(tokens)-1}__"

    pattern_literals = r"('(?:''|[^'])*'|--[^\r\n]*|/\*[\s\S]*?\*/)"
    masked_sql = re.sub(pattern_literals, save_token, sql)

    built_in_table_funcs = {
        "string_split", "openjson", "openxml", "openrowset", "opendatasource",
        "generate_series", "f_table", "fn_get_sql", "values", "select",
        "sysobjects", "syscolumns", "sysindexes", "sysusers", "syscomments",
        "sysdatabases", "sysprocesses", "sysfiles"
    }

    # Match tokens after FROM, JOIN, UPDATE, INTO, TABLE, USING, or DELETE (not followed by FROM)
    clause_regex = re.compile(
        r'(\b(?:FROM|JOIN|UPDATE|INTO|TABLE|USING|DELETE(?!\s+FROM))\s+)'
        r'([A-Za-z0-9_#@$]+|\[[^\]]+\]|"[^"]+")'
        r'(\s*(?:\.|\())?',
        re.IGNORECASE
    )

    def replace_table(match):
        prefix = match.group(1)
        raw_table = match.group(2)
        following = match.group(3) or ""

        # If followed by '.', it's a database or schema prefix: db.schema or schema.table
        if following.strip().startswith("."):
            return match.group(0)

        # Temp table, table variable, subquery or numeric
        if raw_table.startswith("#") or raw_table.startswith("@") or raw_table.isdigit():
            return match.group(0)

        pure_table = raw_table.strip().strip('[]"')
        lower_table = pure_table.lower()

        # If it's a CTE or known built-in / system object
        if lower_table in cte_names or lower_table in built_in_table_funcs:
            return match.group(0)

        # If followed by '(', check if it's a function call (no space before '(') vs column list
        if following.strip().startswith("(") and not re.search(r'\bINTO\s+$', prefix, re.IGNORECASE):
            if not following.startswith(" ") or lower_table.startswith("fn_"):
                return match.group(0)

        return f"{prefix}{quote_qualified(clean_schema, pure_table, engine='sqlserver')}{following}"

    transformed_sql = clause_regex.sub(replace_table, masked_sql)

    # Restore string literals and comments
    for i, tok in enumerate(tokens):
        transformed_sql = transformed_sql.replace(f"__SQL_LITERAL_{i}__", tok)

    return transformed_sql

class SqlServerAdapter(DatabaseAdapter):
    db_type = "sqlserver"

    def connect(self):
        if pyodbc is None:
            raise RuntimeError("pyodbc is not installed")

        c = self.config
        requested_driver = c.get("driver")
        timeout = int(c.get("timeout") or 30)

        drivers_to_try = []
        if requested_driver:
            drivers_to_try.append(requested_driver)
        else:
            default_drv = "ODBC Driver 18 for SQL Server"
            drivers_to_try.append(default_drv)
            # Automatic fallback to Driver 17 if installed and Driver 18 fails
            try:
                available_drivers = pyodbc.drivers() if hasattr(pyodbc, "drivers") else []
                if "ODBC Driver 17 for SQL Server" in available_drivers:
                    drivers_to_try.append("ODBC Driver 17 for SQL Server")
            except Exception:
                pass

        last_exc = None
        for drv in drivers_to_try:
            conn_str = self._build_connection_string(drv)
            try:
                self.connection = pyodbc.connect(
                    conn_str,
                    timeout=timeout,
                    autocommit=True,
                )
                try:
                    self.connection.add_output_converter(-25, _convert_sql_variant)
                except Exception:
                    pass
                return
            except pyodbc.Error as exc:
                last_exc = exc
                if len(drivers_to_try) > 1 and ("08001" in str(exc) or "HYT00" in str(exc)):
                    continue
                raise exc
            except Exception as exc:
                last_exc = exc
                raise exc

        if last_exc:
            raise last_exc

    def _build_connection_string(self, driver=None):
        c = self.config
        raw_server = str(c.get("server") or "localhost").strip()
        port = c.get("port")
        if port and "," not in raw_server and ":" not in raw_server:
            server = f"{raw_server},{port}"
        else:
            server = raw_server

        database = c.get("database") or "master"
        drv = driver or c.get("driver") or "ODBC Driver 18 for SQL Server"

        raw_encrypt = c.get("encrypt", c.get("ssl", False))
        if isinstance(raw_encrypt, str):
            encrypt = "yes" if raw_encrypt.lower() in ("yes", "true", "1") else "no"
        else:
            encrypt = "yes" if raw_encrypt else "no"

        raw_trust_cert = c.get("trust_server_certificate", True)
        if isinstance(raw_trust_cert, str):
            trust_cert = "yes" if raw_trust_cert.lower() in ("yes", "true", "1") else "no"
        else:
            trust_cert = "yes" if raw_trust_cert else "no"

        if encrypt == "no":
            logger.warning(
                "SQL Server connection is using Encrypt=no. "
                "Data transmitted across the network is unencrypted. Consider enabling encryption."
            )
        if trust_cert == "yes":
            logger.warning(
                "SQL Server connection is using TrustServerCertificate=yes. "
                "Server certificate validation is disabled. Ensure this is intentional."
            )

        app_name = c.get("app_name") or "luoBTool"
        app_part = f"APP={escape_odbc_value(app_name)};"

        driver_part = f"DRIVER={{{drv}}};"
        server_part = f"SERVER={escape_odbc_value(server)};"
        db_part = f"DATABASE={escape_odbc_value(database)};"
        enc_part = f"Encrypt={encrypt};TrustServerCertificate={trust_cert};"

        if c.get("trusted_connection"):
            return (
                f"{driver_part}"
                f"{server_part}"
                f"{db_part}"
                "Trusted_Connection=yes;"
                f"{enc_part}"
                f"{app_part}"
            )
        else:
            uid = escape_odbc_value(c.get("username", ""))
            pwd = escape_odbc_value(c.get("password", ""))
            return (
                f"{driver_part}"
                f"{server_part}"
                f"{db_part}"
                f"UID={uid};"
                f"PWD={pwd};"
                f"{enc_part}"
                f"{app_part}"
            )

    def close(self):
        if self.connection:
            self.connection.close()
            self.connection = None

    def cancel(self):
        self._is_cancelled = True
        cur = getattr(self, "_active_cursor", None)
        if cur:
            try:
                cur.cancel()
                return True
            except Exception:
                pass
        return False

    def execute(self, sql, params=None, limit=None, database=None, schema=None, **kwargs):
        self._is_cancelled = False
        cursor = self.connection.cursor()
        self._active_cursor = cursor
        progress_callback = kwargs.get("progress_callback")

        try:
            # Switch database context if database is specified and query doesn't explicitly start with USE
            if database and not re.match(r'^\s*USE\s+', sql, flags=re.IGNORECASE):
                try:
                    cursor.execute(f"USE {quote_ident(database, 'sqlserver')}")
                except Exception as exc:
                    raise RuntimeError(f"Không thể chuyển ngữ cảnh sang database [{database}]: {exc}") from exc

            # Handle SSMS batch separator GO and track batch start lines
            raw_batches = re.split(r'^\s*GO\s*;?\s*(?:--.*)?$', sql, flags=re.MULTILINE | re.IGNORECASE)
            batches = []
            current_line = 1
            for b in raw_batches:
                b_str = b.strip()
                if not b_str:
                    current_line += b.count('\n') + 1
                    continue
                use_match = re.match(
                    r'^(\s*USE\s+(?:\[[^\]]+\]|[^\s;]+)\s*;?)\s*\r?\n\s*((?:CREATE|ALTER)\b[\s\S]*)$',
                    b,
                    flags=re.IGNORECASE
                )
                if use_match:
                    p1 = use_match.group(1).strip()
                    p2 = use_match.group(2).strip()
                    batches.append({"sql": p1, "start_line": current_line})
                    batches.append({"sql": p2, "start_line": current_line + p1.count('\n') + 1})
                else:
                    batches.append({"sql": b_str, "start_line": current_line})
                current_line += b.count('\n') + 1

            if not batches:
                batches = [{"sql": sql, "start_line": 1}]

            results = []
            messages = []
            errors = []
            statements = []
            total_affected = 0
            seen_messages = set()
            stop_on_error = kwargs.get("stop_on_error", True)

            def collect_messages():
                if hasattr(cursor, 'messages') and cursor.messages:
                    for item in cursor.messages:
                        raw = item[1] if isinstance(item, (list, tuple)) and len(item) > 1 else str(item)
                        cleaned = clean_db_message(raw)
                        if cleaned and cleaned not in seen_messages:
                            seen_messages.add(cleaned)
                            messages.append(cleaned)

            for b_info in batches:
                if self._is_cancelled:
                    break
                t_b0 = time.perf_counter()
                batch_sql = b_info["sql"]
                if schema and schema.strip().strip("[]").lower() not in ("dbo", "sys", "information_schema"):
                    batch_sql = qualify_sql_with_schema(batch_sql, schema)
                b_start = b_info["start_line"]
                batch_start_res_len = len(results)
                batch_error_str = None
                batch_affected_start = total_affected

                try:
                    cursor.execute(batch_sql, params or ())
                    collect_messages()
                    while True:
                        if self._is_cancelled:
                            break
                        if cursor.description:
                            columns = [(desc[0] if (desc[0] and str(desc[0]).strip()) else "(No column name)") for desc in cursor.description]
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

                                    raw_chunk = cursor.fetchmany(chunk_size)
                                    if not raw_chunk or not isinstance(raw_chunk, (list, tuple)):
                                        break
                                    serialized_chunk = [[serialize_cell(c) for c in r] for r in raw_chunk]
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
                                    "streamed": True
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
                                    "row_count": row_count
                                })
                            messages.append(f"({row_count} row(s) returned)")
                        else:
                            rc = cursor.rowcount
                            if rc != -1 and rc is not None:
                                messages.append(f"({rc} row(s) affected)")
                                total_affected += rc

                        collect_messages()
                        try:
                            if not cursor.nextset():
                                break
                        except Exception as nextset_err:
                            collect_messages()
                            is_cancel = self._is_cancelled or "operation cancelled" in str(nextset_err).lower() or "hy008" in str(nextset_err).lower()
                            if is_cancel:
                                messages.append("Query execution was cancelled by user.")
                            else:
                                err_detail = parse_error_details(sql, nextset_err, batch_start_line=b_start)
                                if err_detail["clean_message"]:
                                    errors.append(err_detail)
                                    batch_error_str = err_detail["clean_message"]
                                    if err_detail.get("line"):
                                        messages.append(f"Msg: Line {err_detail['line']}: {err_detail['clean_message']}")
                                    else:
                                        messages.append(f"Msg: {err_detail['clean_message']}")
                            break
                        collect_messages()

                except Exception as batch_err:
                    collect_messages()
                    is_cancel = self._is_cancelled or "operation cancelled" in str(batch_err).lower() or "hy008" in str(batch_err).lower()
                    if is_cancel:
                        messages.append("Query execution was cancelled by user.")
                    else:
                        err_detail = parse_error_details(sql, batch_err, batch_start_line=b_start)
                        if err_detail["clean_message"]:
                            errors.append(err_detail)
                            batch_error_str = err_detail["clean_message"]
                            if err_detail.get("line"):
                                messages.append(f"Msg: Line {err_detail['line']}: {err_detail['clean_message']}")
                            else:
                                messages.append(f"Msg: {err_detail['clean_message']}")

                b_ms = round((time.perf_counter() - t_b0) * 1000)
                b_results = results[batch_start_res_len:]
                b_first_res = b_results[0] if b_results else {}
                statements.append({
                    "index": len(statements) + 1,
                    "sql": batch_sql,
                    "start_line": b_start,
                    "rows": b_first_res.get("rows", []),
                    "columns": b_first_res.get("columns", []),
                    "rows_affected": total_affected - batch_affected_start,
                    "duration_ms": b_ms,
                    "error": batch_error_str
                })

                if stop_on_error and batch_error_str:
                    break

            current_db = None
            try:
                cursor.execute("SELECT DB_NAME()")
                row = cursor.fetchone()
                if row:
                    current_db = row[0]
            except Exception:
                pass

            first = results[0] if results else {"columns": [], "rows": [], "row_count": total_affected}
            success = len(errors) == 0

            return {
                "success": success,
                "columns": first["columns"],
                "rows": first["rows"],
                "row_count": first["row_count"],
                "results": results,
                "statements": statements,
                "messages": messages,
                "errors": errors,
                "cancelled": self._is_cancelled,
                "error": "\n".join(e["clean_message"] for e in errors) if errors else None,
                "message": "\n".join(messages) if messages else ("Commands completed successfully." if success else "\n".join(e["clean_message"] for e in errors)),
                "current_database": current_db,
            }

        finally:
            self._active_cursor = None
            cursor.close()

    def list_databases(self):
        result = self.execute(
            "SELECT name, state_desc "
            "FROM sys.databases ORDER BY name",
            limit=0
        )

        return [
            {"name": row[0], "state": row[1]}
            for row in result["rows"]
        ]

    def list_schemas(self, database=None):
        db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""
        try:
            result = self.execute(
                f"SELECT name FROM {db_prefix}sys.schemas ORDER BY name",
                database=database
            )
            rows = result.get("rows", [])
            if rows:
                return [{"name": row[0]} for row in rows]
        except Exception:
            pass

        try:
            result = self.execute(
                "SELECT name FROM sys.schemas ORDER BY name",
                database=database
            )
            return [{"name": row[0]} for row in result.get("rows", [])]
        except Exception:
            return []

    def list_objects(self, database, schema, object_type, search=None, limit=0):
        type_map = {
            "tables": "U",
            "views": "V",
            "procedures": "P",
            "triggers": "TR",
            "sequences": "SO",
            "sequence": "SO",
            "synonyms": "SN",
            "synonym": "SN",
        }

        db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""

        if object_type in ("sequences", "sequence"):
            sql = f"""
                SELECT s.name, sq.name, sq.object_id
                FROM {db_prefix}sys.sequences AS sq
                JOIN {db_prefix}sys.schemas AS s
                  ON s.schema_id = sq.schema_id
                WHERE 1=1
            """
            params = []
            if schema:
                clean_schema = schema.strip("[]")
                sql += " AND (s.name = ? OR LOWER(s.name) = LOWER(?))"
                params.extend([clean_schema, clean_schema])
            if search:
                sql += " AND sq.name LIKE ?"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY sq.name"

            rows = []
            try:
                result = self.execute(sql, tuple(params), limit=limit, database=database)
                rows = result.get("rows", [])
            except Exception:
                rows = []

            # Fallback without db_prefix if database was specified
            if not rows and database:
                fallback_sql = """
                    SELECT s.name, sq.name, sq.object_id
                    FROM sys.sequences AS sq
                    JOIN sys.schemas AS s
                      ON s.schema_id = sq.schema_id
                    WHERE 1=1
                """
                fb_params = []
                if schema:
                    clean_schema = schema.strip("[]")
                    fallback_sql += " AND (s.name = ? OR LOWER(s.name) = LOWER(?))"
                    fb_params.extend([clean_schema, clean_schema])
                if search:
                    fallback_sql += " AND sq.name LIKE ?"
                    fb_params.append(f"%{search}%")
                fallback_sql += "\n            ORDER BY sq.name"
                try:
                    result = self.execute(fallback_sql, tuple(fb_params), limit=limit, database=database)
                    rows = result.get("rows", [])
                except Exception:
                    pass

            # Secondary fallback to sys.objects with type 'SO'
            if not rows:
                so_sql = f"""
                    SELECT s.name, o.name, o.object_id
                    FROM {db_prefix}sys.objects AS o
                    JOIN {db_prefix}sys.schemas AS s
                      ON s.schema_id = o.schema_id
                    WHERE o.type = 'SO'
                """
                so_params = []
                if schema:
                    clean_schema = schema.strip("[]")
                    so_sql += " AND (s.name = ? OR LOWER(s.name) = LOWER(?))"
                    so_params.extend([clean_schema, clean_schema])
                if search:
                    so_sql += " AND o.name LIKE ?"
                    so_params.append(f"%{search}%")
                so_sql += "\n            ORDER BY o.name"
                try:
                    result = self.execute(so_sql, tuple(so_params), limit=limit, database=database)
                    rows = result.get("rows", [])
                except Exception:
                    pass

            return [
                {
                    "schema": row[0],
                    "name": row[1],
                    "id": row[2],
                }
                for row in rows
            ]

        elif object_type in ("user_types", "types", "user_type", "type"):
            sql = f"""
                SELECT s.name, t.name, t.user_type_id
                FROM {db_prefix}sys.types AS t
                JOIN {db_prefix}sys.schemas AS s
                  ON s.schema_id = t.schema_id
                WHERE t.is_user_defined = 1
            """
            params = []
            if schema:
                clean_schema = schema.strip("[]")
                sql += " AND (s.name = ? OR LOWER(s.name) = LOWER(?))"
                params.extend([clean_schema, clean_schema])
            if search:
                sql += " AND t.name LIKE ?"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY t.name"

            rows = []
            try:
                result = self.execute(sql, tuple(params), limit=limit, database=database)
                rows = result.get("rows", [])
            except Exception:
                rows = []

            if not rows and database:
                fallback_sql = """
                    SELECT s.name, t.name, t.user_type_id
                    FROM sys.types AS t
                    JOIN sys.schemas AS s
                      ON s.schema_id = t.schema_id
                    WHERE t.is_user_defined = 1
                """
                fb_params = []
                if schema:
                    clean_schema = schema.strip("[]")
                    fallback_sql += " AND (s.name = ? OR LOWER(s.name) = LOWER(?))"
                    fb_params.extend([clean_schema, clean_schema])
                if search:
                    fallback_sql += " AND t.name LIKE ?"
                    fb_params.append(f"%{search}%")
                fallback_sql += "\n            ORDER BY t.name"
                try:
                    result = self.execute(fallback_sql, tuple(fb_params), limit=limit, database=database)
                    rows = result.get("rows", [])
                except Exception:
                    pass

            return [
                {
                    "schema": row[0],
                    "name": row[1],
                    "id": row[2],
                }
                for row in rows
            ]

        elif object_type in ("synonyms", "synonym"):
            clean_schema = schema.strip("[]") if schema else None
            sql = f"""
                SELECT s.name, sy.name, sy.object_id, sy.base_object_name
                FROM {db_prefix}sys.synonyms AS sy
                JOIN {db_prefix}sys.schemas AS s
                  ON s.schema_id = sy.schema_id
                WHERE 1=1
            """
            params = []
            if clean_schema:
                sql += " AND (s.name = ? OR LOWER(s.name) = LOWER(?))"
                params.extend([clean_schema, clean_schema])
            if search:
                sql += " AND sy.name LIKE ?"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY sy.name"

            rows = []
            try:
                result = self.execute(sql, tuple(params), limit=limit, database=database)
                rows = result.get("rows", [])
            except Exception:
                rows = []

            # Fallback without db_prefix if database was specified
            if not rows and database:
                fallback_sql = """
                    SELECT s.name, sy.name, sy.object_id, sy.base_object_name
                    FROM sys.synonyms AS sy
                    JOIN sys.schemas AS s
                      ON s.schema_id = sy.schema_id
                    WHERE 1=1
                """
                fb_params = []
                if clean_schema:
                    fallback_sql += " AND (s.name = ? OR LOWER(s.name) = LOWER(?))"
                    fb_params.extend([clean_schema, clean_schema])
                if search:
                    fallback_sql += " AND sy.name LIKE ?"
                    fb_params.append(f"%{search}%")
                fallback_sql += "\n            ORDER BY sy.name"
                try:
                    result = self.execute(fallback_sql, tuple(fb_params), limit=limit, database=database)
                    rows = result.get("rows", [])
                except Exception:
                    pass

            return [
                {
                    "schema": row[0],
                    "name": row[1],
                    "id": row[2],
                    "base_object_name": row[3] if len(row) > 3 else None,
                }
                for row in rows
            ]

        sql = f"""
            SELECT s.name, o.name, o.object_id
            FROM {db_prefix}sys.objects AS o
            JOIN {db_prefix}sys.schemas AS s
              ON s.schema_id = o.schema_id
            WHERE s.name = ?
        """
        
        if object_type == "functions":
            sql += "  AND o.type IN ('FN', 'IF', 'TF', 'FS', 'FT')"
            params = (schema,)
        else:
            sql += "  AND o.type = ?"
            params = [schema, type_map.get(object_type, "U")]
            
        if search:
            sql += "  AND o.name LIKE ?"
            params.append(f"%{search}%")
            
        sql += "\n            ORDER BY o.name"

        result = self.execute(sql, tuple(params), limit=limit, database=database)

        return [
            {
                "schema": row[0],
                "name": row[1],
                "id": row[2],
            }
            for row in result["rows"]
        ]

    def get_intellisense_objects(self, database=None, schema=None):
        db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""
        schema_filter = "AND (LOWER(s.name) = LOWER(?) OR o.type = 'SN')" if schema else ""
        params = [schema] if schema else []

        query = f"""
            SELECT 
                o.name, 
                s.name AS schema_name, 
                RTRIM(o.type) AS type,
                base.base_object_name
            FROM {db_prefix}sys.objects o
            JOIN {db_prefix}sys.schemas s ON o.schema_id = s.schema_id
            LEFT JOIN {db_prefix}sys.synonyms base ON o.object_id = base.object_id
            WHERE o.type IN ('U', 'V', 'P', 'PC', 'X', 'FN', 'IF', 'TF', 'FS', 'FT', 'AF', 'TR', 'SN', 'SO')
              {schema_filter}
            UNION ALL
            SELECT
                tr.name,
                'dbo' AS schema_name,
                'TR' AS type,
                NULL AS base_object_name
            FROM {db_prefix}sys.triggers tr
            WHERE tr.parent_id = 0
            ORDER BY 1
        """
        try:
            res = self.execute(query, params, limit=0, database=database)
            type_mapping = {
                'U': 'table',
                'V': 'view',
                'P': 'procedure',
                'PC': 'procedure',
                'X': 'procedure',
                'FN': 'function',
                'IF': 'function',
                'TF': 'function',
                'FS': 'function',
                'FT': 'function',
                'AF': 'function',
                'TR': 'trigger',
                'SN': 'synonym',
                'SO': 'sequence',
            }
            items = []
            seen = set()
            for row in res.get("rows", []):
                obj_name = row[0]
                s_name = row[1]
                o_type = row[2].strip() if row[2] else ""
                synonym_base = row[3]
                mapped_type = type_mapping.get(o_type, "table")
                key = (obj_name.lower(), (s_name or "").lower(), mapped_type)
                if key in seen:
                    continue
                seen.add(key)
                items.append({
                    "name": obj_name,
                    "schema": s_name,
                    "type": mapped_type,
                    "target_object": synonym_base or ""
                })
            return items
        except Exception:
            return []

    def get_intellisense_columns(self, database=None, schema=None, table_name=None):
        if not table_name:
            return []
        db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""
        schema_filter = "AND LOWER(s.name) = LOWER(?)" if schema else ""
        params = [schema, table_name] if schema else [table_name]

        query = f"""
            SELECT 
                c.name, 
                t.name AS type_name,
                c.max_length,
                c.precision,
                c.scale,
                c.is_nullable,
                CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_pk,
                c.is_identity,
                c.is_computed
            FROM {db_prefix}sys.columns c
            JOIN {db_prefix}sys.types t ON c.user_type_id = t.user_type_id
            JOIN {db_prefix}sys.objects o ON c.object_id = o.object_id
            JOIN {db_prefix}sys.schemas s ON o.schema_id = s.schema_id
            LEFT JOIN (
                SELECT ic.object_id, ic.column_id
                FROM {db_prefix}sys.indexes i
                JOIN {db_prefix}sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                WHERE i.is_primary_key = 1
            ) pk ON c.object_id = pk.object_id AND c.column_id = pk.column_id
            WHERE 1=1 {schema_filter} AND o.name = ?
            ORDER BY c.column_id
        """
        try:
            res = self.execute(query, params, limit=0, database=database)
            items = []
            for row in res.get("rows", []):
                col_name = row[0]
                type_name = row[1]
                max_len = row[2]
                prec = row[3]
                scale = row[4]
                is_null = bool(row[5])
                is_pk = bool(row[6])
                is_identity = bool(row[7]) if len(row) > 7 else False
                is_computed = bool(row[8]) if len(row) > 8 else False

                type_str = type_name
                if type_name in ["varchar", "nvarchar", "char", "nchar", "varbinary", "binary"]:
                    len_str = "MAX" if max_len == -1 else str(max_len if "nchar" not in type_name and "nvarchar" not in type_name else max_len // 2)
                    type_str = f"{type_name}({len_str})"
                elif type_name in ["decimal", "numeric"]:
                    type_str = f"{type_name}({prec},{scale})"

                items.append({
                    "name": col_name,
                    "type": "column",
                    "schema": schema or "",
                    "data_type": type_str,
                    "is_nullable": is_null,
                    "is_pk": is_pk,
                    "is_identity": is_identity,
                    "is_computed": is_computed
                })

            # If no columns found directly, check if table_name is a SYNONYM (common in BRAVO ERP)
            if not items:
                try:
                    syn_order = "ORDER BY CASE WHEN LOWER(s.name) = LOWER(?) THEN 0 WHEN LOWER(s.name) = 'dbo' THEN 1 ELSE 2 END" if schema else "ORDER BY CASE WHEN LOWER(s.name) = 'dbo' THEN 0 ELSE 1 END"
                    syn_params = [table_name, schema] if schema else [table_name]
                    syn_query = f"""
                        SELECT 
                            PARSENAME(sn.base_object_name, 4) AS target_server,
                            PARSENAME(sn.base_object_name, 3) AS target_db,
                            PARSENAME(sn.base_object_name, 2) AS target_schema,
                            PARSENAME(sn.base_object_name, 1) AS target_table
                        FROM {db_prefix}sys.synonyms sn
                        JOIN {db_prefix}sys.schemas s ON sn.schema_id = s.schema_id
                        WHERE sn.name = ?
                        {syn_order}
                    """
                    syn_res = self.execute(syn_query, syn_params, limit=1, database=database)
                    syn_rows = syn_res.get("rows", [])
                    if syn_rows and syn_rows[0]:
                        target_srv, target_db, target_sch, target_tbl = syn_rows[0]
                        resolved_db = target_db or database
                        resolved_sch = target_sch or 'dbo'
                        resolved_tbl = target_tbl or table_name
                        if target_srv and hasattr(self, 'list_remote_columns'):
                            return self.list_remote_columns(target_srv, resolved_db, resolved_sch, resolved_tbl)
                        return self.get_intellisense_columns(database=resolved_db, schema=resolved_sch, table_name=resolved_tbl)
                except Exception:
                    pass

            return items
        except Exception:
            return []

    def get_intellisense_parameters(self, database=None, schema=None, object_name=None):
        if not object_name:
            return []
        db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""
        schema_filter = "AND LOWER(s.name) = LOWER(?)" if schema else ""
        params = [schema, object_name] if schema else [object_name]

        query = f"""
            SELECT 
                p.name,
                t.name AS type_name,
                p.max_length,
                p.is_output
            FROM {db_prefix}sys.parameters p
            JOIN {db_prefix}sys.types t ON p.user_type_id = t.user_type_id
            JOIN {db_prefix}sys.objects o ON p.object_id = o.object_id
            JOIN {db_prefix}sys.schemas s ON o.schema_id = s.schema_id
            WHERE 1=1 {schema_filter} AND o.name = ?
            ORDER BY p.parameter_id
        """
        try:
            res = self.execute(query, params, limit=0, database=database)
            params_list = []
            for row in res.get("rows", []):
                p_name, t_name, max_len, is_out = row[0], row[1], row[2], bool(row[3])
                params_list.append({
                    "name": p_name,
                    "data_type": t_name,
                    "is_output": is_out
                })
            return params_list
        except Exception:
            return []

    def get_object_definition(
        self,
        database,
        schema,
        name,
        object_type,
    ):
        db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""

        if object_type in ("trigger", "triggers"):
            result = self.execute(
                f"""
                SELECT sm.definition
                FROM {db_prefix}sys.sql_modules AS sm
                JOIN {db_prefix}sys.triggers AS tr
                  ON tr.object_id = sm.object_id
                JOIN {db_prefix}sys.tables AS t
                  ON t.object_id = tr.parent_id
                JOIN {db_prefix}sys.schemas AS s
                  ON s.schema_id = t.schema_id
                WHERE s.name = ?
                  AND tr.name = ?
                """,
                (schema, name),
                database=database,
            )
            if result["rows"]:
                return result["rows"][0][0]

            result = self.execute(
                f"""
                SELECT sm.definition
                FROM {db_prefix}sys.sql_modules AS sm
                JOIN {db_prefix}sys.triggers AS tr
                  ON tr.object_id = sm.object_id
                WHERE tr.name = ?
                """,
                (name,),
                database=database,
            )
            if result["rows"]:
                return result["rows"][0][0]

        if object_type in ("sequence", "sequences"):
            clean_schema = (schema or "dbo").strip("[] \t\r\n")
            clean_name = (name or "").strip("[] \t\r\n")
            db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""

            seq_sql = f"""
                SELECT 
                    'CREATE SEQUENCE ' + QUOTENAME(s.name) + '.' + QUOTENAME(sq.name) + CHAR(13) + CHAR(10) +
                    '    AS ' + COALESCE(TYPE_NAME(sq.user_type_id), TYPE_NAME(sq.system_type_id), 'bigint') + 
                    CASE 
                        WHEN TYPE_NAME(sq.system_type_id) IN ('decimal', 'numeric') 
                        THEN '(' + CAST(sq.precision AS VARCHAR(10)) + ', ' + CAST(sq.scale AS VARCHAR(10)) + ')' 
                        ELSE '' 
                    END + CHAR(13) + CHAR(10) +
                    '    START WITH ' + CAST(sq.start_value AS VARCHAR(35)) + CHAR(13) + CHAR(10) +
                    '    INCREMENT BY ' + CAST(sq.increment AS VARCHAR(35)) + CHAR(13) + CHAR(10) +
                    CASE 
                        WHEN sq.minimum_value IS NULL THEN '    NO MINVALUE' 
                        ELSE '    MINVALUE ' + CAST(sq.minimum_value AS VARCHAR(35)) 
                    END + CHAR(13) + CHAR(10) +
                    CASE 
                        WHEN sq.maximum_value IS NULL THEN '    NO MAXVALUE' 
                        ELSE '    MAXVALUE ' + CAST(sq.maximum_value AS VARCHAR(35)) 
                    END + CHAR(13) + CHAR(10) +
                    CASE WHEN sq.is_cycling = 1 THEN '    CYCLE' ELSE '    NO CYCLE' END + CHAR(13) + CHAR(10) +
                    CASE 
                        WHEN sq.is_cached = 0 THEN '    NO CACHE' 
                        WHEN sq.cache_size IS NOT NULL THEN '    CACHE ' + CAST(sq.cache_size AS VARCHAR(20)) 
                        ELSE '    CACHE' 
                    END + ';'
                FROM {db_prefix}sys.sequences AS sq
                JOIN {db_prefix}sys.schemas AS s ON s.schema_id = sq.schema_id
                WHERE (s.name = ? OR LOWER(s.name) = LOWER(?))
                  AND (sq.name = ? OR LOWER(sq.name) = LOWER(?))
            """
            try:
                result = self.execute(seq_sql, (clean_schema, clean_schema, clean_name, clean_name), database=database)
                if result.get("rows") and result["rows"][0][0]:
                    return result["rows"][0][0]
            except Exception:
                pass

            # Fallback without db_prefix
            fallback_sql = """
                SELECT 
                    'CREATE SEQUENCE ' + QUOTENAME(s.name) + '.' + QUOTENAME(sq.name) + CHAR(13) + CHAR(10) +
                    '    AS ' + COALESCE(TYPE_NAME(sq.user_type_id), TYPE_NAME(sq.system_type_id), 'bigint') + 
                    CASE 
                        WHEN TYPE_NAME(sq.system_type_id) IN ('decimal', 'numeric') 
                        THEN '(' + CAST(sq.precision AS VARCHAR(10)) + ', ' + CAST(sq.scale AS VARCHAR(10)) + ')' 
                        ELSE '' 
                    END + CHAR(13) + CHAR(10) +
                    '    START WITH ' + CAST(sq.start_value AS VARCHAR(35)) + CHAR(13) + CHAR(10) +
                    '    INCREMENT BY ' + CAST(sq.increment AS VARCHAR(35)) + CHAR(13) + CHAR(10) +
                    CASE 
                        WHEN sq.minimum_value IS NULL THEN '    NO MINVALUE' 
                        ELSE '    MINVALUE ' + CAST(sq.minimum_value AS VARCHAR(35)) 
                    END + CHAR(13) + CHAR(10) +
                    CASE 
                        WHEN sq.maximum_value IS NULL THEN '    NO MAXVALUE' 
                        ELSE '    MAXVALUE ' + CAST(sq.maximum_value AS VARCHAR(35)) 
                    END + CHAR(13) + CHAR(10) +
                    CASE WHEN sq.is_cycling = 1 THEN '    CYCLE' ELSE '    NO CYCLE' END + CHAR(13) + CHAR(10) +
                    CASE 
                        WHEN sq.is_cached = 0 THEN '    NO CACHE' 
                        WHEN sq.cache_size IS NOT NULL THEN '    CACHE ' + CAST(sq.cache_size AS VARCHAR(20)) 
                        ELSE '    CACHE' 
                    END + ';'
                FROM sys.sequences AS sq
                JOIN sys.schemas AS s ON s.schema_id = sq.schema_id
                WHERE (s.name = ? OR LOWER(s.name) = LOWER(?))
                  AND (sq.name = ? OR LOWER(sq.name) = LOWER(?))
            """
            try:
                result = self.execute(fallback_sql, (clean_schema, clean_schema, clean_name, clean_name), database=database)
                if result.get("rows") and result["rows"][0][0]:
                    return result["rows"][0][0]
            except Exception:
                pass

        if object_type in ("user_type", "user_types", "type", "types"):
            udt_sql = f"""
                SELECT 
                    'CREATE TYPE ' + QUOTENAME(s.name) + '.' + QUOTENAME(t.name) + ' FROM ' + 
                    TYPE_NAME(t.system_type_id) + 
                    CASE 
                        WHEN t.system_type_id IN (167, 175, 231, 239) THEN '(' + CASE WHEN t.max_length = -1 THEN 'MAX' ELSE CAST(CASE WHEN t.system_type_id IN (231, 239) THEN t.max_length/2 ELSE t.max_length END AS VARCHAR(10)) END + ')'
                        WHEN t.system_type_id IN (106, 108) THEN '(' + CAST(t.precision AS VARCHAR(10)) + ',' + CAST(t.scale AS VARCHAR(10)) + ')'
                        ELSE ''
                    END + 
                    CASE WHEN t.is_nullable = 1 THEN ' NULL;' ELSE ' NOT NULL;' END
                FROM {db_prefix}sys.types t
                JOIN {db_prefix}sys.schemas s ON s.schema_id = t.schema_id
                WHERE t.is_user_defined = 1 AND s.name = ? AND t.name = ?
            """
            result = self.execute(udt_sql, (schema, name), database=database)
            if result.get("rows"):
                return result["rows"][0][0]

        if object_type in ("synonym", "synonyms"):
            clean_schema = (schema or "dbo").strip("[] \t\r\n")
            clean_name = (name or "").strip("[] \t\r\n")
            db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""

            syn_sql = f"""
                SELECT 
                    'CREATE SYNONYM ' + QUOTENAME(s.name) + '.' + QUOTENAME(sy.name) + CHAR(13) + CHAR(10) +
                    'FOR ' + sy.base_object_name + ';'
                FROM {db_prefix}sys.synonyms AS sy
                JOIN {db_prefix}sys.schemas AS s ON s.schema_id = sy.schema_id
                WHERE (s.name = ? OR LOWER(s.name) = LOWER(?))
                  AND (sy.name = ? OR LOWER(sy.name) = LOWER(?))
            """
            try:
                result = self.execute(syn_sql, (clean_schema, clean_schema, clean_name, clean_name), database=database)
                if result.get("rows") and result["rows"][0][0]:
                    return result["rows"][0][0]
            except Exception:
                pass

            # Fallback without db_prefix
            fallback_sql = """
                SELECT 
                    'CREATE SYNONYM ' + QUOTENAME(s.name) + '.' + QUOTENAME(sy.name) + CHAR(13) + CHAR(10) +
                    'FOR ' + sy.base_object_name + ';'
                FROM sys.synonyms AS sy
                JOIN sys.schemas AS s ON s.schema_id = sy.schema_id
                WHERE (s.name = ? OR LOWER(s.name) = LOWER(?))
                  AND (sy.name = ? OR LOWER(sy.name) = LOWER(?))
            """
            try:
                result = self.execute(fallback_sql, (clean_schema, clean_schema, clean_name, clean_name), database=database)
                if result.get("rows") and result["rows"][0][0]:
                    return result["rows"][0][0]
            except Exception:
                pass

            # Secondary fallback: query raw metadata and construct safely
            try:
                raw_sql = f"""
                    SELECT s.name, sy.name, sy.base_object_name
                    FROM {db_prefix}sys.synonyms AS sy
                    JOIN {db_prefix}sys.schemas AS s ON s.schema_id = sy.schema_id
                    WHERE (s.name = ? OR LOWER(s.name) = LOWER(?))
                      AND (sy.name = ? OR LOWER(sy.name) = LOWER(?))
                """
                res = self.execute(raw_sql, (clean_schema, clean_schema, clean_name, clean_name), database=database)
                if res.get("rows") and res["rows"][0]:
                    s_name = res["rows"][0][0]
                    sy_name = res["rows"][0][1]
                    base_obj = res["rows"][0][2]
                    s_quoted = quote_ident(s_name, 'sqlserver')
                    sy_quoted = quote_ident(sy_name, 'sqlserver')
                    return f"CREATE SYNONYM {s_quoted}.{sy_quoted}\r\nFOR {base_obj};"
            except Exception:
                pass

        clean_schema = (schema or "dbo").strip("[] \t\r\n")
        clean_name = (name or "").strip("[] \t\r\n")

        result = self.execute(
            f"""
            SELECT sm.definition
            FROM {db_prefix}sys.sql_modules AS sm
            JOIN {db_prefix}sys.objects AS o
              ON o.object_id = sm.object_id
            JOIN {db_prefix}sys.schemas AS s
              ON s.schema_id = o.schema_id
            WHERE (s.name = ? OR LOWER(s.name) = LOWER(?))
              AND (o.name = ? OR LOWER(o.name) = LOWER(?))
            """,
            (clean_schema, clean_schema, clean_name, clean_name),
            database=database,
        )

        if result.get("rows") and result["rows"][0][0]:
            return result["rows"][0][0]

        # Fallback by object name alone
        fallback_res = self.execute(
            f"""
            SELECT sm.definition
            FROM {db_prefix}sys.sql_modules AS sm
            JOIN {db_prefix}sys.objects AS o
              ON o.object_id = sm.object_id
            WHERE (o.name = ? OR LOWER(o.name) = LOWER(?))
            """,
            (clean_name, clean_name),
            database=database,
        )
        return fallback_res["rows"][0][0] if fallback_res.get("rows") else None

    def list_object_children(
        self,
        database,
        schema,
        name,
        object_type,
        child_type,
    ):
        if object_type in ("sequence", "sequences", "user_type", "user_types", "type", "types"):
            return []

        db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""
        obj_sql = f"""
            SELECT o.object_id 
            FROM {db_prefix}sys.objects o
            JOIN {db_prefix}sys.schemas s ON s.schema_id = o.schema_id
            WHERE s.name = ? AND o.name = ?
        """
        obj_res = self.execute(obj_sql, (schema, name), limit=1, database=database)
        if not obj_res["rows"]:
            return []
            
        object_id = obj_res["rows"][0][0]
        items = []
        
        if child_type == "columns":
            sql = f"""
                SELECT c.name, TYPE_NAME(c.user_type_id) as type_name, c.max_length, c.is_nullable
                FROM {db_prefix}sys.columns c
                WHERE c.object_id = ?
                ORDER BY c.column_id
            """
            res = self.execute(sql, (object_id,), limit=0, database=database)
            for r in res["rows"]:
                items.append({"name": r[0], "type": r[1], "length": r[2], "nullable": r[3]})
                
        elif child_type == "keys":
            sql = f"""
                SELECT i.name, 'PK/UK' as type
                FROM {db_prefix}sys.key_constraints i
                WHERE i.parent_object_id = ?
                UNION ALL
                SELECT f.name, 'FK' as type
                FROM {db_prefix}sys.foreign_keys f
                WHERE f.parent_object_id = ?
            """
            res = self.execute(sql, (object_id, object_id), limit=0, database=database)
            for r in res["rows"]:
                items.append({"name": r[0], "type": r[1]})
                
        elif child_type == "constraints":
            sql = f"""
                SELECT c.name, 'CHECK' as type FROM {db_prefix}sys.check_constraints c WHERE c.parent_object_id = ?
                UNION ALL
                SELECT d.name, 'DEFAULT' as type FROM {db_prefix}sys.default_constraints d WHERE d.parent_object_id = ?
            """
            res = self.execute(sql, (object_id, object_id), limit=0, database=database)
            for r in res["rows"]:
                items.append({"name": r[0], "type": r[1]})
                
        elif child_type == "triggers":
            sql = f"""
                SELECT tr.name FROM {db_prefix}sys.triggers tr WHERE tr.parent_id = ?
            """
            res = self.execute(sql, (object_id,), limit=0, database=database)
            for r in res["rows"]:
                items.append({"name": r[0]})
                
        elif child_type == "indexes":
            sql = f"""
                SELECT i.name FROM {db_prefix}sys.indexes i WHERE i.object_id = ? AND i.type > 0
            """
            res = self.execute(sql, (object_id,), limit=0, database=database)
            for r in res["rows"]:
                if r[0]:  # sometimes nameless indexes exist
                    items.append({"name": r[0]})
                
        elif child_type == "params":
            sql = f"""
                SELECT p.name, TYPE_NAME(p.user_type_id) as type_name
                FROM {db_prefix}sys.parameters p
                WHERE p.object_id = ?
                ORDER BY p.parameter_id
            """
            res = self.execute(sql, (object_id,), limit=0, database=database)
            for r in res["rows"]:
                name_val = r[0] if r[0] else 'Return Value'
                items.append({"name": name_val, "type": r[1]})
                
        return items

    def get_supported_types(self, database=None):
        user_types = []
        try:
            db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""
            udt_sql = f"""
                SELECT s.name, t.name 
                FROM {db_prefix}sys.types t
                JOIN {db_prefix}sys.schemas s ON s.schema_id = t.schema_id
                WHERE t.is_user_defined = 1 
                ORDER BY s.name, t.name
            """
            res = self.execute(udt_sql, database=database)
            if res and res.get("rows"):
                user_types = []
                for r in res["rows"]:
                    if len(r) >= 2:
                        user_types.append(quote_qualified(r[0], r[1], engine='sqlserver'))
                    elif len(r) == 1:
                        user_types.append(r[0])
        except Exception:
            pass

        return {
            "engine": "sqlserver",
            "types": [
                "bigint", "binary", "bit", "char", "date", "datetime", "datetime2",
                "datetimeoffset", "decimal", "float", "image", "int", "money",
                "nchar", "ntext", "numeric", "nvarchar", "real", "smalldatetime",
                "smallint", "smallmoney", "text", "time", "tinyint", "uniqueidentifier",
                "varbinary", "varchar", "xml"
            ],
            "user_types": user_types,
            "collations": [
                "SQL_Latin1_General_CP1_CI_AS",
                "Vietnamese_CI_AS",
                "Latin1_General_CI_AS",
                "Latin1_General_BIN",
                "Japanese_CI_AS",
                "DATABASE_DEFAULT"
            ]
        }

    def get_table_design_metadata(self, database, schema, table):
        db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""
        obj_sql = f"""
            SELECT o.object_id 
            FROM {db_prefix}sys.tables o
            JOIN {db_prefix}sys.schemas s ON s.schema_id = o.schema_id
            WHERE s.name = ? AND o.name = ?
        """
        obj_res = self.execute(obj_sql, (schema, table), database=database)
        if not obj_res.get("rows"):
            return None
        object_id = obj_res["rows"][0][0]

        # 1. Columns
        col_sql = f"""
            SELECT 
                c.column_id,
                c.name,
                TYPE_NAME(c.user_type_id) AS type_name,
                c.max_length,
                c.precision,
                c.scale,
                c.is_nullable,
                c.is_identity,
                CAST(ISNULL(ic.seed_value, 1) AS NUMERIC(38, 0)) AS seed_val,
                CAST(ISNULL(ic.increment_value, 1) AS NUMERIC(38, 0)) AS inc_val,
                CAST(OBJECT_DEFINITION(c.default_object_id) AS NVARCHAR(MAX)) AS default_val,
                c.collation_name,
                CASE WHEN pk_cols.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_pk,
                CAST(ep.value AS NVARCHAR(MAX)) AS description,
                t.is_user_defined,
                st.name AS type_schema,
                t.name AS type_raw_name,
                c.is_computed,
                pk_cols.pk_name,
                OBJECT_NAME(c.default_object_id) AS default_constraint_name
            FROM {db_prefix}sys.columns c
            JOIN {db_prefix}sys.types t ON t.user_type_id = c.user_type_id
            JOIN {db_prefix}sys.schemas st ON st.schema_id = t.schema_id
            LEFT JOIN {db_prefix}sys.identity_columns ic 
                ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            LEFT JOIN (
                SELECT ic.column_id, kc.name AS pk_name
                FROM {db_prefix}sys.key_constraints kc
                JOIN {db_prefix}sys.index_columns ic 
                    ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
                WHERE kc.parent_object_id = ? AND kc.type = 'PK'
            ) pk_cols ON pk_cols.column_id = c.column_id
            LEFT JOIN {db_prefix}sys.extended_properties ep 
                ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
            WHERE c.object_id = ?
            ORDER BY c.column_id
        """
        col_res = self.execute(col_sql, (object_id, object_id), database=database)
        columns = []
        table_pk_name = ""
        for r in col_res.get("rows", []):
            is_udt = bool(r[14]) if len(r) > 14 else False
            type_schema = r[15] if len(r) > 15 else ""
            type_raw_name = r[16] if len(r) > 16 else ""

            if is_udt and type_raw_name:
                type_name = quote_qualified(type_schema, type_raw_name, engine='sqlserver')
            else:
                type_name = (r[2] or "").lower()

            raw_len = r[3]
            prec = r[4]
            scale = r[5]

            # Calculate user-facing size
            size_str = ""
            if not is_udt:
                if type_name in ("nvarchar", "nchar"):
                    size_str = "max" if raw_len == -1 else str(raw_len // 2)
                elif type_name in ("varchar", "char", "varbinary", "binary"):
                    size_str = "max" if raw_len == -1 else str(raw_len)
                elif type_name in ("decimal", "numeric"):
                    size_str = str(prec) if prec is not None else ""

            # Clean default value e.g. (('default')) -> 'default'
            raw_default = r[10] or ""
            def_val = raw_default.strip()
            while def_val.startswith("(") and def_val.endswith(")"):
                def_val = def_val[1:-1].strip()

            # For numeric columns, ensure no quotes around numbers (e.g. "'-1'" -> "-1")
            is_numeric = type_name in ("int", "bigint", "smallint", "tinyint", "decimal", "numeric", "float", "real", "bit", "money", "smallmoney", "integer")
            if is_numeric:
                while (def_val.startswith("'") and def_val.endswith("'")) or (def_val.startswith('"') and def_val.endswith('"')):
                    def_val = def_val[1:-1].strip()

            # Check if default value is a sequence (e.g. NEXT VALUE FOR [dbo].[SeqName])
            seq_match = re.search(r'NEXT\s+VALUE\s+FOR\s+([^\s\)]+)', raw_default, flags=re.IGNORECASE)
            seq_name = seq_match.group(1).strip("[]") if seq_match else ""

            col_pk_name = r[18] if len(r) > 18 and r[18] else ""
            col_def_name = r[19] if len(r) > 19 and r[19] else ""
            if col_pk_name and not table_pk_name:
                table_pk_name = col_pk_name

            columns.append({
                "name": r[1],
                "type": type_name,
                "size": size_str,
                "scale": str(scale) if scale is not None and type_name in ("decimal", "numeric", "datetime2", "time") else "",
                "nullable": bool(r[6]),
                "is_pk": bool(r[12]),
                "pk_name": col_pk_name,
                "is_identity": bool(r[7]),
                "is_computed": bool(r[17]) if len(r) > 17 else False,
                "identity_seed": int(r[8]) if r[8] is not None else 1,
                "identity_increment": int(r[9]) if r[9] is not None else 1,
                "sequence_name": seq_name,
                "default_value": def_val,
                "default_constraint_name": col_def_name,
                "collation": r[11] or "",
                "comment": r[13] or ""
            })

        # 2. Indexes
        idx_sql = f"""
            SELECT 
                i.index_id,
                i.name,
                i.type_desc,
                i.is_unique,
                c.name AS col_name,
                ic.is_descending_key
            FROM {db_prefix}sys.indexes i
            JOIN {db_prefix}sys.index_columns ic 
                ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            JOIN {db_prefix}sys.columns c 
                ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE i.object_id = ? AND i.type > 0 AND i.is_primary_key = 0 AND i.is_unique_constraint = 0
            ORDER BY i.index_id, ic.key_ordinal
        """
        idx_res = self.execute(idx_sql, (object_id,), database=database)
        idx_map = {}
        for r in idx_res.get("rows", []):
            iname = r[1]
            if not iname:
                continue
            if iname not in idx_map:
                idx_map[iname] = {
                    "name": iname,
                    "fields": [],
                    "index_type": r[2], # CLUSTERED, NONCLUSTERED
                    "is_unique": bool(r[3]),
                    "comment": ""
                }
            idx_map[iname]["fields"].append({
                "column": r[4],
                "desc": bool(r[5])
            })
        indexes = list(idx_map.values())

        # 3. Foreign Keys
        fk_sql = f"""
            SELECT 
                fk.name AS fk_name,
                lc.name AS local_col,
                rs.name AS ref_schema,
                rt.name AS ref_table,
                rc.name AS ref_col,
                fk.delete_referential_action_desc AS on_delete,
                fk.update_referential_action_desc AS on_update,
                fk.is_disabled,
                fk.is_not_for_replication
            FROM {db_prefix}sys.foreign_keys fk
            JOIN {db_prefix}sys.foreign_key_columns fkc 
                ON fkc.constraint_object_id = fk.object_id
            JOIN {db_prefix}sys.columns lc 
                ON lc.object_id = fkc.parent_object_id AND lc.column_id = fkc.parent_column_id
            JOIN {db_prefix}sys.tables rt 
                ON rt.object_id = fkc.referenced_object_id
            JOIN {db_prefix}sys.schemas rs 
                ON rs.schema_id = rt.schema_id
            JOIN {db_prefix}sys.columns rc 
                ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
            WHERE fk.parent_object_id = ?
            ORDER BY fk.name, fkc.constraint_column_id
        """
        fk_res = self.execute(fk_sql, (object_id,), database=database)
        fk_map = {}
        for r in fk_res.get("rows", []):
            fk_name = r[0]
            if fk_name not in fk_map:
                fk_map[fk_name] = {
                    "name": fk_name,
                    "fields": [],
                    "ref_schema": r[2],
                    "ref_table": r[3],
                    "ref_fields": [],
                    "on_delete": (r[5] or "NO_ACTION").replace("_", " "),
                    "on_update": (r[6] or "NO_ACTION").replace("_", " "),
                    "is_enabled": not bool(r[7]),
                    "not_for_replication": bool(r[8]),
                    "comment": ""
                }
            fk_map[fk_name]["fields"].append(r[1])
            fk_map[fk_name]["ref_fields"].append(r[4])
        foreign_keys = list(fk_map.values())

        # 4. Uniques
        uq_sql = f"""
            SELECT 
                kc.name AS constraint_name,
                i.type_desc AS index_type,
                c.name AS column_name
            FROM {db_prefix}sys.key_constraints kc
            JOIN {db_prefix}sys.indexes i 
                ON i.object_id = kc.parent_object_id AND i.index_id = kc.unique_index_id
            JOIN {db_prefix}sys.index_columns ic 
                ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            JOIN {db_prefix}sys.columns c 
                ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE kc.parent_object_id = ? AND kc.type = 'UQ'
            ORDER BY kc.name, ic.key_ordinal
        """
        uq_res = self.execute(uq_sql, (object_id,), database=database)
        uq_map = {}
        for r in uq_res.get("rows", []):
            uq_name = r[0]
            if uq_name not in uq_map:
                uq_map[uq_name] = {
                    "name": uq_name,
                    "fields": [],
                    "is_clustered": (r[1] == "CLUSTERED"),
                    "comment": ""
                }
            uq_map[uq_name]["fields"].append(r[2])
        uniques = list(uq_map.values())

        # 5. Checks
        chk_sql = f"""
            SELECT 
                cc.name,
                CAST(cc.definition AS NVARCHAR(MAX)) AS definition,
                cc.is_disabled,
                cc.is_not_for_replication
            FROM {db_prefix}sys.check_constraints cc
            WHERE cc.parent_object_id = ?
            ORDER BY cc.name
        """
        chk_res = self.execute(chk_sql, (object_id,), database=database)
        checks = []
        for r in chk_res.get("rows", []):
            chk_def = (r[1] or "").strip()
            while chk_def.startswith("(") and chk_def.endswith(")"):
                chk_def = chk_def[1:-1].strip()
            checks.append({
                "name": r[0],
                "check_clause": chk_def,
                "is_enabled": not bool(r[2]),
                "not_for_replication": bool(r[3]),
                "comment": ""
            })

        # 6. Triggers
        trig_sql = f"""
            SELECT 
                tr.name,
                tr.is_disabled,
                tr.is_instead_of_trigger,
                OBJECTPROPERTY(tr.object_id, 'ExecIsInsertTrigger') AS is_insert,
                OBJECTPROPERTY(tr.object_id, 'ExecIsUpdateTrigger') AS is_update,
                OBJECTPROPERTY(tr.object_id, 'ExecIsDeleteTrigger') AS is_delete,
                CAST(sm.definition AS NVARCHAR(MAX)) AS definition
            FROM {db_prefix}sys.triggers tr
            LEFT JOIN {db_prefix}sys.sql_modules sm ON sm.object_id = tr.object_id
            WHERE tr.parent_id = ?
            ORDER BY tr.name
        """
        trig_res = self.execute(trig_sql, (object_id,), database=database)
        triggers = []
        for r in trig_res.get("rows", []):
            triggers.append({
                "name": r[0],
                "fires": "Instead Of" if bool(r[2]) else "After",
                "is_insert": bool(r[3]),
                "is_update": bool(r[4]),
                "is_delete": bool(r[5]),
                "is_enabled": not bool(r[1]),
                "definition": r[6] or "",
                "comment": ""
            })

        return {
            "database": database,
            "schema": schema,
            "table": table,
            "engine": "sqlserver",
            "pk_name": table_pk_name,
            "columns": columns,
            "indexes": indexes,
            "foreign_keys": foreign_keys,
            "uniques": uniques,
            "checks": checks,
            "triggers": triggers
        }

    def execute_migration_transaction(self, batches: list[str], database: str = None):
        """Executes a list of SQL batches within a single atomic transaction.
        If any statement fails, rolls back completely and re-raises.
        """
        if not self.connection:
            self.connect()

        cursor = self.connection.cursor()
        if database and not re.match(r'^\s*USE\s+', batches[0] if batches else "", flags=re.IGNORECASE):
            try:
                cursor.execute(f"USE {quote_ident(database, 'sqlserver')}")
            except Exception as exc:
                raise RuntimeError(f"Không thể chuyển ngữ cảnh sang database [{database}]: {exc}") from exc

        # Temporarily disable autocommit to create an explicit transaction
        self.connection.autocommit = False
        try:
            for b in batches:
                clean_b = b.strip()
                if not clean_b:
                    continue
                cursor.execute(clean_b)
                while True:
                    try:
                        if not cursor.nextset():
                            break
                    except Exception:
                        break
            self.connection.commit()
        except Exception as exc:
            try:
                self.connection.rollback()
            except Exception:
                pass
            raise exc
        finally:
            self.connection.autocommit = True

    def get_foreign_keys(self, database=None, schema=None, table=None):
        db_prefix = f"{quote_ident(database, 'sqlserver')}." if database else ""

        sql = f"""
            SELECT 
                fk.name AS constraint_name,
                s_from.name AS from_schema,
                t_from.name AS from_table,
                c_from.name AS from_column,
                s_to.name AS to_schema,
                t_to.name AS to_table,
                c_to.name AS to_column,
                fkc.constraint_column_id
            FROM {db_prefix}sys.foreign_keys fk
            JOIN {db_prefix}sys.foreign_key_columns fkc 
                ON fkc.constraint_object_id = fk.object_id
            JOIN {db_prefix}sys.tables t_from 
                ON t_from.object_id = fkc.parent_object_id
            JOIN {db_prefix}sys.schemas s_from 
                ON s_from.schema_id = t_from.schema_id
            JOIN {db_prefix}sys.columns c_from 
                ON c_from.object_id = fkc.parent_object_id AND c_from.column_id = fkc.parent_column_id
            JOIN {db_prefix}sys.tables t_to 
                ON t_to.object_id = fkc.referenced_object_id
            JOIN {db_prefix}sys.schemas s_to 
                ON s_to.schema_id = t_to.schema_id
            JOIN {db_prefix}sys.columns c_to 
                ON c_to.object_id = fkc.referenced_object_id AND c_to.column_id = fkc.referenced_column_id
        """

        where_clauses = []
        params = []

        if table:
            clean_tbl = table.strip("[] \t\r\n")
            if schema:
                clean_sch = schema.strip("[] \t\r\n")
                where_clauses.append(
                    "(((s_from.name = ? OR LOWER(s_from.name) = LOWER(?)) AND (t_from.name = ? OR LOWER(t_from.name) = LOWER(?))) "
                    "OR ((s_to.name = ? OR LOWER(s_to.name) = LOWER(?)) AND (t_to.name = ? OR LOWER(t_to.name) = LOWER(?))))"
                )
                params.extend([clean_sch, clean_sch, clean_tbl, clean_tbl, clean_sch, clean_sch, clean_tbl, clean_tbl])
            else:
                where_clauses.append(
                    "((t_from.name = ? OR LOWER(t_from.name) = LOWER(?)) "
                    "OR (t_to.name = ? OR LOWER(t_to.name) = LOWER(?)))"
                )
                params.extend([clean_tbl, clean_tbl, clean_tbl, clean_tbl])
        elif schema:
            clean_sch = schema.strip("[] \t\r\n")
            where_clauses.append("(s_from.name = ? OR s_to.name = ?)")
            params.extend([clean_sch, clean_sch])

        if where_clauses:
            sql += " WHERE " + " AND ".join(where_clauses)

        sql += " ORDER BY fk.name, fkc.constraint_column_id"

        try:
            res = self.execute(sql, tuple(params) if params else None, limit=0, database=database)
            fk_map = {}
            for r in res.get("rows", []):
                c_name, f_sch, f_tbl, f_col, t_sch, t_tbl, t_col, _ = r
                key = f"{f_sch}::{f_tbl}::{c_name}::{t_sch}::{t_tbl}"
                if key not in fk_map:
                    fk_map[key] = {
                        "constraint_name": c_name,
                        "from_schema": f_sch,
                        "from_table": f_tbl,
                        "from_columns": [],
                        "to_schema": t_sch,
                        "to_table": t_tbl,
                        "to_columns": []
                    }
                fk_map[key]["from_columns"].append(f_col)
                fk_map[key]["to_columns"].append(t_col)

            return list(fk_map.values())
        except Exception:
            return []

    def list_linked_servers(self):
        sql = """
            SELECT 
                server_id,
                name AS [LinkedServerName],
                product AS [Product],
                provider AS [Provider],
                data_source AS [DataSource_IP_Or_Instance],
                modify_date AS [ModifiedDate],
                is_linked AS [IsLinked]
            FROM sys.servers
            WHERE is_linked = 1
            ORDER BY name
        """
        try:
            res = self.execute(sql, limit=0)
            results = []
            for row in res.get("rows", []):
                if isinstance(row, dict):
                    s_id = row.get("server_id")
                    s_name = row.get("LinkedServerName") or row.get("name")
                    s_prod = row.get("Product") or row.get("product")
                    s_prov = row.get("Provider") or row.get("provider")
                    s_ds = row.get("DataSource_IP_Or_Instance") or row.get("data_source")
                    s_mod = row.get("ModifiedDate") or row.get("modify_date")
                    s_link = row.get("IsLinked", row.get("is_linked", True))
                elif len(row) >= 7:
                    s_id, s_name, s_prod, s_prov, s_ds, s_mod, s_link = row[0], row[1], row[2], row[3], row[4], row[5], row[6]
                elif len(row) == 5:
                    s_id, s_name, s_prod, s_prov, s_ds, s_mod, s_link = 1, row[0], row[1], row[2], row[3], None, row[4]
                else:
                    s_id, s_name, s_prod, s_prov, s_ds, s_mod, s_link = None, row[0] if len(row) > 0 else "", "", "", "", None, True

                results.append({
                    "server_id": s_id,
                    "name": s_name,
                    "LinkedServerName": s_name,
                    "product": s_prod or "",
                    "Product": s_prod or "",
                    "provider": s_prov or "",
                    "Provider": s_prov or "",
                    "data_source": s_ds or "",
                    "DataSource_IP_Or_Instance": s_ds or "",
                    "modify_date": str(s_mod) if s_mod else None,
                    "ModifiedDate": str(s_mod) if s_mod else None,
                    "is_linked": bool(s_link),
                    "IsLinked": bool(s_link)
                })
            return results
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Failed to list linked servers: %s", exc)
            return []

    def test_linked_server(self, server_name):
        if not server_name:
            return {"success": False, "error": "Server name is required"}
        clean_server = server_name.strip("[] \t\r\n")
        try:
            self.execute("EXEC sp_testlinkedserver @servername = ?", (clean_server,))
            return {"success": True, "message": f"Connection to linked server '{clean_server}' was successful."}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_linked_server_script(self, server_name, mode="create"):
        if not server_name:
            return ""
        clean_server = server_name.strip("[] \t\r\n")
        sql_info = """
            SELECT 
                s.server_id, s.name, s.product, s.provider, s.data_source, 
                s.location, s.provider_string, s.catalog, s.is_linked
            FROM sys.servers s
            WHERE s.name = ?
        """
        info = {}
        try:
            res = self.execute(sql_info, (clean_server,), limit=1)
            rows = res.get("rows", [])
            if rows:
                r = rows[0]
                info = {
                    "server_id": r[0],
                    "name": r[1],
                    "product": r[2] or "",
                    "provider": r[3] or "",
                    "data_source": r[4] or "",
                    "location": r[5] or "",
                    "provider_string": r[6] or "",
                    "catalog": r[7] or "",
                    "is_linked": bool(r[8]) if len(r) > 8 else True,
                }
        except Exception:
            pass

        srv_name = info.get("name") or clean_server
        srv_product = info.get("product") or "SQL Server"
        srv_provider = info.get("provider") or "SQLNCLI"
        srv_datasource = info.get("data_source") or ""
        srv_location = info.get("location") or ""
        srv_provstring = info.get("provider_string") or ""
        srv_catalog = info.get("catalog") or ""

        drop_script = f"""-- =========================================================================
-- Script: Drop Linked Server [{srv_name}]
-- =========================================================================
USE [master]
GO

IF EXISTS (SELECT 1 FROM sys.servers WHERE name = N'{srv_name}' AND is_linked = 1)
BEGIN
    EXEC master.dbo.sp_dropserver @server = N'{srv_name}', @droplogins = 'droplogins';
    PRINT 'Linked Server [{srv_name}] dropped successfully.';
END
GO
"""

        create_lines = [
            f"-- =========================================================================",
            f"-- Script: Create Linked Server [{srv_name}]",
            f"-- =========================================================================",
            f"USE [master]",
            f"GO",
            f"",
            f"EXEC master.dbo.sp_addlinkedserver",
            f"    @server = N'{srv_name}',",
            f"    @srvproduct = N'{srv_product}',",
            f"    @provider = N'{srv_provider}'"
        ]
        if srv_datasource:
            create_lines.append(f"    ,@datasrc = N'{srv_datasource}'")
        if srv_location:
            create_lines.append(f"    ,@location = N'{srv_location}'")
        if srv_provstring:
            create_lines.append(f"    ,@provstr = N'{srv_provstring}'")
        if srv_catalog:
            create_lines.append(f"    ,@catalog = N'{srv_catalog}'")
        create_lines.append("GO\n")

        create_lines.extend([
            f"EXEC master.dbo.sp_serveroption @server = N'{srv_name}', @optname = N'data access', @optvalue = N'true';",
            f"GO",
            f"EXEC master.dbo.sp_serveroption @server = N'{srv_name}', @optname = N'rpc', @optvalue = N'true';",
            f"GO",
            f"EXEC master.dbo.sp_serveroption @server = N'{srv_name}', @optname = N'rpc out', @optvalue = N'true';",
            f"GO",
            f"EXEC master.dbo.sp_serveroption @server = N'{srv_name}', @optname = N'use remote collation', @optvalue = N'true';",
            f"GO"
        ])
        create_script = "\n".join(create_lines)

        mode_clean = (mode or "create").lower()
        if mode_clean in ("drop", "drop_to"):
            return drop_script
        elif mode_clean in ("drop_and_create", "drop_create", "drop_and_create_to"):
            return drop_script + "\n" + create_script
        else:
            return create_script

    def drop_linked_server(self, server_name):
        if not server_name:
            return {"success": False, "error": "Server name is required"}
        clean_server = server_name.strip("[] \t\r\n")
        try:
            self.execute("EXEC master.dbo.sp_dropserver @server = ?, @droplogins = 'droplogins'", (clean_server,))
            return {"success": True, "message": f"Linked Server '{clean_server}' was dropped successfully."}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def list_remote_databases(self, server):
        if not server:
            return []
        clean_server = server.strip("[] \t\r\n")
        try:
            res = self.execute("EXEC sp_catalogs @server_name = ?", (clean_server,), limit=0)
            items = []
            for row in res.get("rows", []):
                if row and row[0]:
                    items.append({"name": row[0]})
            return items
        except Exception:
            return []

    def list_remote_schemas(self, server, database=None):
        if not server:
            return []
        clean_server = server.strip("[] \t\r\n")
        clean_db = database.strip("[] \t\r\n") if database else None
        try:
            params = [clean_server]
            sql = "EXEC sp_tables_ex @table_server = ?"
            if clean_db:
                sql += ", @table_catalog = ?"
                params.append(clean_db)
            res = self.execute(sql, tuple(params), limit=0)
            schemas = set()
            for row in res.get("rows", []):
                if len(row) > 1 and row[1]:
                    schemas.add(row[1])
            if not schemas:
                schemas.add("dbo")
            return [{"name": s} for s in sorted(schemas)]
        except Exception:
            return [{"name": "dbo"}]

    def list_remote_objects(self, server, database=None, schema=None):
        if not server:
            return []
        clean_server = server.strip("[] \t\r\n")
        clean_db = database.strip("[] \t\r\n") if database else None
        clean_sch = schema.strip("[] \t\r\n") if schema else None
        try:
            params = [clean_server]
            sql = "EXEC sp_tables_ex @table_server = ?"
            if clean_db:
                sql += ", @table_catalog = ?"
                params.append(clean_db)
            if clean_sch:
                if not clean_db:
                    sql += ", @table_catalog = NULL"
                sql += ", @table_schema = ?"
                params.append(clean_sch)
            res = self.execute(sql, tuple(params), limit=0)
            items = []
            seen = set()
            for row in res.get("rows", []):
                if len(row) >= 3 and row[2]:
                    t_cat = row[0] if len(row) > 0 else clean_db
                    t_sch = row[1] if len(row) > 1 else (clean_sch or "dbo")
                    t_name = row[2]
                    t_type = (row[3] if len(row) > 3 else "TABLE") or "TABLE"
                    type_str = "remote_table" if "VIEW" not in t_type.upper() else "remote_view"
                    key = (t_name.lower(), (t_sch or "").lower())
                    if key in seen:
                        continue
                    seen.add(key)
                    items.append({
                        "name": t_name,
                        "schema": t_sch or "dbo",
                        "database": t_cat or clean_db,
                        "server": clean_server,
                        "type": type_str,
                        "sourceType": "REMOTE_TABLE"
                    })
            return items
        except Exception:
            return []

    def list_remote_columns(self, server, database=None, schema=None, table_name=None, table=None):
        target_tbl = table_name or table
        if not server or not target_tbl:
            return []
        clean_server = server.strip("[] \t\r\n")
        clean_db = database.strip("[] \t\r\n") if database else None
        clean_sch = schema.strip("[] \t\r\n") if schema else None
        clean_tbl = target_tbl.strip("[] \t\r\n")
        try:
            sql = "EXEC sp_columns_ex @table_server = ?"
            params = [clean_server]
            if clean_tbl:
                sql += ", @table_name = ?"
                params.append(clean_tbl)
            if clean_sch:
                sql += ", @table_schema = ?"
                params.append(clean_sch)
            if clean_db:
                sql += ", @table_catalog = ?"
                params.append(clean_db)
            res = self.execute(sql, tuple(params), limit=0)
            items = []
            for row in res.get("rows", []):
                if len(row) > 3 and row[3]:
                    col_name = str(row[3])
                    type_name = str(row[5] or "").lower() if len(row) > 5 else "varchar"
                    nullable = bool(row[10] == 1) if len(row) > 10 else True
                    items.append({
                        "name": col_name,
                        "data_type": type_name,
                        "is_nullable": nullable,
                        "is_pk": False
                    })
            return items
        except Exception:
            return []

