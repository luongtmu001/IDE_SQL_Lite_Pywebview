from app.database.base import DatabaseAdapter
from app.utils.db_message import clean_db_message, parse_error_details

try:
    import psycopg
except ImportError:
    psycopg = None

def serialize_cell(val):
    if val is None:
        return None
    if isinstance(val, (int, float, bool, str)):
        return val
    if isinstance(val, (bytes, bytearray, memoryview)):
        return "0x" + bytes(val).hex()
    return str(val)

class PostgreSqlAdapter(DatabaseAdapter):
    db_type = "postgresql"

    def connect(self):
        if psycopg is None:
            raise RuntimeError("psycopg is not installed")

        c = self.config
        app_name = c.get("application_name", "luoBTool")

        self.connection = psycopg.connect(
            host=c.get("host") or c.get("server") or "localhost",
            port=int(c.get("port", 5432)),
            dbname=c.get("database", "postgres"),
            user=c.get("username") or c.get("user") or "postgres",
            password=c.get("password", ""),
            connect_timeout=int(c.get("timeout", 10)),
            application_name=app_name,
        )

        self.connection.autocommit = True
        self._current_search_path = None

    def _build_conn_params(self):
        c = self.config
        return {
            "host": c.get("host", "localhost"),
            "port": int(c.get("port", 5432)),
            "dbname": c.get("database", "postgres"),
            "user": c.get("username", "postgres"),
            "password": c.get("password", ""),
            "connect_timeout": int(c.get("timeout", 10)),
            "application_name": c.get("application_name", "luoBTool"),
        }

    def close(self):
        if self.connection:
            self.connection.close()
            self.connection = None
            self._current_search_path = None

    def cancel(self):
        self._is_cancelled = True
        if self.connection:
            try:
                if hasattr(self.connection, "cancel_safe"):
                    self.connection.cancel_safe()
                elif hasattr(self.connection, "cancel"):
                    self.connection.cancel()
                return True
            except Exception:
                pass
        return False

    def execute(self, sql, params=None, limit=None, database=None, schema=None, **kwargs):
        self._is_cancelled = False
        progress_callback = kwargs.get("progress_callback")
        results = []
        messages = []
        errors = []
        total_affected = 0
        seen_notices = set()

        def notice_callback(diag):
            raw = getattr(diag, 'message_primary', None) or str(diag)
            cleaned = clean_db_message(raw)
            if cleaned and cleaned not in seen_notices:
                seen_notices.add(cleaned)
                messages.append(cleaned)

        has_handler = hasattr(self.connection, 'add_notice_handler')
        if has_handler:
            try:
                self.connection.add_notice_handler(notice_callback)
            except Exception:
                has_handler = False

        try:
            with self.connection.cursor() as cursor:
                # Set search_path only when changed
                target_schema = (schema or self.config.get("schema") or "").strip()
                if target_schema:
                    schemas_to_set = [f'"{target_schema}"']
                    if target_schema.lower() != "dbo":
                        schemas_to_set.append('"dbo"')
                    if target_schema.lower() != "public":
                        schemas_to_set.append("public")
                else:
                    schemas_to_set = ['"dbo"', 'public']

                cur_path = getattr(self, "_current_search_path", None)
                if cur_path != schemas_to_set:
                    set_path_sql = f'SET search_path TO {", ".join(schemas_to_set)}'
                    try:
                        cursor.execute(set_path_sql)
                        self._current_search_path = schemas_to_set
                    except Exception:
                        pass

                try:
                    cursor.execute(sql, params or ())
                    while True:
                        if self._is_cancelled:
                            break
                        if cursor.description:
                            columns = [desc.name for desc in cursor.description]
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

                                rows = []
                                first_chunk = True
                                while True:
                                    if self._is_cancelled:
                                        break
                                    chunk_size = 100 if first_chunk else 500
                                    first_chunk = False
                                    if fetch_limit > 0:
                                        remaining = fetch_limit - len(rows)
                                        if remaining <= 0:
                                            break
                                        chunk_size = min(chunk_size, remaining)

                                    raw_rows = cursor.fetchmany(chunk_size)
                                    if not raw_rows:
                                        break
                                    serialized_chunk = [[serialize_cell(c) for c in r] for r in raw_rows]
                                    rows.extend(serialized_chunk)

                                    try:
                                        progress_callback({
                                            "type": "chunk",
                                            "result_index": res_index,
                                            "columns": columns,
                                            "rows": serialized_chunk,
                                            "total_so_far": len(rows),
                                        })
                                    except Exception:
                                        pass
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

                        try:
                            if not cursor.nextset():
                                break
                        except Exception:
                            break

                except Exception as pg_err:
                    is_cancel = self._is_cancelled or "cancel" in str(pg_err).lower()
                    if is_cancel:
                        messages.append("Query execution was cancelled by user.")
                    else:
                        err_detail = parse_error_details(sql, pg_err)
                        if err_detail["clean_message"]:
                            errors.append(err_detail)
                            if err_detail.get("line"):
                                messages.append(f"Msg: Line {err_detail['line']}: {err_detail['clean_message']}")
                            else:
                                messages.append(f"Msg: {err_detail['clean_message']}")

        finally:
            if has_handler:
                try:
                    self.connection.remove_notice_handler(notice_callback)
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
            "messages": messages,
            "errors": errors,
            "cancelled": self._is_cancelled,
            "error": "\n".join(e["clean_message"] for e in errors) if errors else None,
            "message": "\n".join(messages) if messages else ("Commands completed successfully." if success else "\n".join(e["clean_message"] for e in errors)),
            "current_database": self.config.get("database", "postgres"),
        }

    def list_databases(self):
        result = self.execute(
            """
            SELECT datname, datallowconn
            FROM pg_database
            WHERE datistemplate = false
            ORDER BY datname
            """
        )

        return [
            {
                "name": row[0],
                "allow_connection": row[1],
            }
            for row in result["rows"]
        ]

    def list_schemas(self, database=None):
        result = self.execute(
            """
            SELECT nspname
            FROM pg_catalog.pg_namespace
            WHERE nspname NOT LIKE 'pg_toast%%'
              AND nspname NOT LIKE 'pg_temp%%'
            ORDER BY nspname
            """,
            limit=0,
            database=database
        )

        return [{"name": row[0]} for row in result["rows"]]

    def list_objects(self, database, schema, object_type, search=None):
        target_schema = (schema or "public").strip()

        if object_type in ["procedures", "functions"]:
            sql = """
                SELECT n.nspname, p.proname, p.oid
                FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
            """
            if object_type == "procedures":
                sql += "  AND p.prokind = 'p'"
            else:
                sql += "  AND p.prokind != 'p'"
            params = [target_schema, target_schema]
            if search:
                sql += "  AND p.proname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY p.proname"

        elif object_type in ["materialized_views", "mviews", "materialized_view"]:
            sql = """
                SELECT n.nspname, c.relname, c.oid
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND c.relkind = 'm'
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND c.relname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY c.relname"

        elif object_type == "views":
            sql = """
                SELECT n.nspname, c.relname, c.oid
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND c.relkind = 'v'
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND c.relname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY c.relname"

        elif object_type == "tables":
            sql = """
                SELECT n.nspname, c.relname, c.oid
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND c.relkind IN ('r', 'p')
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND c.relname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY c.relname"

        elif object_type == "triggers":
            sql = """
                SELECT n.nspname, t.tgname, t.oid
                FROM pg_catalog.pg_trigger t
                JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND NOT t.tgisinternal
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND t.tgname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY t.tgname"

        elif object_type == "sequences":
            sql = """
                SELECT n.nspname, c.relname, c.oid
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND c.relkind = 'S'
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND c.relname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY c.relname"

        elif object_type in ("user_types", "types"):
            sql = """
                SELECT n.nspname, t.typname, t.oid
                FROM pg_catalog.pg_type t
                JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND t.typtype IN ('c', 'd', 'e')
                  AND NOT EXISTS (
                      SELECT 1 FROM pg_catalog.pg_class c
                      WHERE c.oid = t.typrelid AND c.relkind != 'c'
                  )
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND t.typname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY t.typname"

        else:
            sql = """
                SELECT n.nspname, c.relname, c.oid
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
            """
            params = [target_schema, target_schema]
            if search:
                sql += "  AND c.relname ILIKE %s"
                params.append(f"%{search}%")
            sql += "\n            ORDER BY c.relname"

        result = self.execute(sql, tuple(params), limit=0, database=database)

        return [
            {
                "schema": row[0],
                "name": row[1],
                "id": row[2] if len(row) > 2 else None,
            }
            for row in result["rows"]
        ]

    def get_object_definition(
        self,
        database,
        schema,
        name,
        object_type,
    ):
        target_schema = schema or "public"
        norm_type = (object_type or "").lower().rstrip("s")

        if norm_type in {"function", "procedure", "routine"}:
            result = self.execute(
                """
                SELECT pg_catalog.pg_get_functiondef(p.oid)
                FROM pg_catalog.pg_proc AS p
                JOIN pg_catalog.pg_namespace AS n
                  ON n.oid = p.pronamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (p.proname = %s OR lower(p.proname) = lower(%s))
                ORDER BY p.pronargs ASC
                LIMIT 1
                """,
                (target_schema, target_schema, name, name),
                limit=1,
                database=database
            )
            return result["rows"][0][0] if result.get("rows") else None

        if norm_type in {"view", "materialized_view", "mview"}:
            result = self.execute(
                """
                SELECT 
                    CASE WHEN c.relkind = 'm' THEN 'CREATE MATERIALIZED VIEW ' ELSE 'CREATE OR REPLACE VIEW ' END ||
                    quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' AS' || E'\\n' ||
                    pg_catalog.pg_get_viewdef(c.oid, true)
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND c.relkind IN ('v', 'm')
                LIMIT 1
                """,
                (target_schema, target_schema, name, name),
                limit=1,
                database=database
            )
            if result.get("rows") and result["rows"][0][0]:
                return result["rows"][0][0]

            # Fallback matching by object name across schemas
            res_fb = self.execute(
                """
                SELECT 
                    CASE WHEN c.relkind = 'm' THEN 'CREATE MATERIALIZED VIEW ' ELSE 'CREATE OR REPLACE VIEW ' END ||
                    quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' AS' || E'\\n' ||
                    pg_catalog.pg_get_viewdef(c.oid, true)
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND c.relkind IN ('v', 'm')
                LIMIT 1
                """,
                (name, name),
                limit=1,
                database=database
            )
            return res_fb["rows"][0][0] if res_fb.get("rows") else None

        if norm_type == "trigger":
            result = self.execute(
                """
                SELECT pg_catalog.pg_get_triggerdef(t.oid, true) || ';'
                FROM pg_catalog.pg_trigger AS t
                JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
                JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
                WHERE n.nspname = %s
                  AND (t.tgname = %s OR lower(t.tgname) = lower(%s))
                  AND NOT t.tgisinternal
                LIMIT 1
                """,
                (target_schema, name, name),
                limit=1,
                database=database
            )
            return result["rows"][0][0] if result.get("rows") else None

        if norm_type in {"sequence", "sequences"}:
            result = self.execute(
                """
                SELECT 
                    'CREATE SEQUENCE ' || quote_ident(schemaname) || '.' || quote_ident(sequencename) || E'\\n' ||
                    '    START WITH ' || start_value || E'\\n' ||
                    '    INCREMENT BY ' || increment_by || E'\\n' ||
                    '    MINVALUE ' || min_value || E'\\n' ||
                    '    MAXVALUE ' || max_value || E'\\n' ||
                    CASE WHEN cycle THEN '    CYCLE;' ELSE '    NO CYCLE;' END
                FROM pg_catalog.pg_sequences
                WHERE (schemaname = %s OR lower(schemaname) = lower(%s))
                  AND (sequencename = %s OR lower(sequencename) = lower(%s))
                LIMIT 1
                """,
                (target_schema, target_schema, name, name),
                limit=1,
                database=database
            )
            if result.get("rows"):
                return result["rows"][0][0]

            result_fallback = self.execute(
                """
                SELECT 
                    '-- Sequence: ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || E'\\n' ||
                    'CREATE SEQUENCE ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ';'
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND c.relkind = 'S'
                LIMIT 1
                """,
                (target_schema, target_schema, name, name),
                limit=1,
                database=database
            )
            return result_fallback["rows"][0][0] if result_fallback.get("rows") else None

        if norm_type in {"user_type", "user_types", "type", "types"}:
            result = self.execute(
                """
                SELECT 
                    CASE t.typtype
                        WHEN 'e' THEN
                            'CREATE TYPE ' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) || ' AS ENUM (' ||
                            COALESCE((
                                SELECT string_agg(quote_literal(enumlabel), ', ' ORDER BY enumsortorder)
                                FROM pg_catalog.pg_enum WHERE enumtypid = t.oid
                            ), '') || ');'
                        WHEN 'd' THEN
                            'CREATE DOMAIN ' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) || ' AS ' ||
                            format_type(t.typbasetype, t.typtypmod) || ';'
                        ELSE
                            '-- Type: ' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) || E'\\n' ||
                            '-- Kind: ' || t.typtype
                    END
                FROM pg_catalog.pg_type t
                JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (t.typname = %s OR lower(t.typname) = lower(%s))
                LIMIT 1
                """,
                (target_schema, target_schema, name, name),
                limit=1,
                database=database
            )
            return result["rows"][0][0] if result.get("rows") else None

        return None

    def get_intellisense_objects(self, database=None, schema=None):
        target_schema = (schema or "public").strip()
        items = []
        try:
            # 1. Tables, Views, Materialized Views from pg_class
            tv_query = """
                SELECT c.relname, n.nspname,
                       CASE c.relkind
                           WHEN 'r' THEN 'table'
                           WHEN 'p' THEN 'table'
                           WHEN 'v' THEN 'view'
                           WHEN 'm' THEN 'materialized_view'
                           ELSE 'table'
                       END AS obj_type
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND c.relkind IN ('r', 'p', 'v', 'm')
                ORDER BY c.relname
            """
            res = self.execute(tv_query, [target_schema, target_schema], limit=0, database=database)
            for row in res.get("rows", []):
                items.append({
                    "name": row[0],
                    "schema": row[1],
                    "type": row[2],
                    "target_object": ""
                })

            # 2. Routines (Procedures / Functions from pg_proc)
            routines_query = """
                SELECT 
                    p.proname AS routine_name, 
                    n.nspname AS routine_schema, 
                    CASE 
                        WHEN p.prokind = 'p' THEN 'procedure'
                        ELSE 'function'
                    END AS routine_type
                FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                ORDER BY p.proname
            """
            res_r = self.execute(routines_query, [target_schema, target_schema], limit=0, database=database)
            for row in res_r.get("rows", []):
                name, s_name, r_type = row[0], row[1], (row[2] or "").lower()
                items.append({
                    "name": name,
                    "schema": s_name,
                    "type": r_type if r_type in ["procedure", "function"] else "function",
                    "target_object": ""
                })

            # 3. Triggers from pg_trigger
            try:
                triggers_query = """
                    SELECT t.tgname, n.nspname
                    FROM pg_catalog.pg_trigger t
                    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                    WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                      AND NOT t.tgisinternal
                    ORDER BY t.tgname
                """
                res_t = self.execute(triggers_query, [target_schema, target_schema], limit=0, database=database)
                for row in res_t.get("rows", []):
                    name, s_name = row[0], row[1]
                    items.append({
                        "name": name,
                        "schema": s_name,
                        "type": "trigger",
                        "target_object": ""
                    })
            except Exception:
                pass

            return items
        except Exception:
            return []

    def get_intellisense_columns(self, database=None, schema=None, table_name=None):
        if not table_name:
            return []
        target_schema = (schema or "public").strip()
        query = """
            SELECT 
                a.attname AS column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                NOT a.attnotnull AS is_nullable,
                CASE WHEN pk.attnum IS NOT NULL THEN 1 ELSE 0 END AS is_pk
            FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN (
                SELECT conrelid, unnest(conkey) AS attnum
                FROM pg_catalog.pg_constraint
                WHERE contype = 'p'
            ) pk ON pk.conrelid = c.oid AND pk.attnum = a.attnum
            WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
              AND (c.relname = %s OR lower(c.relname) = lower(%s))
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum
        """
        try:
            res = self.execute(query, [target_schema, target_schema, table_name, table_name], limit=0, database=database)
            items = []
            for row in res.get("rows", []):
                col_name, data_type, is_null, is_pk = row[0], row[1], bool(row[2]), bool(row[3])
                items.append({
                    "name": col_name,
                    "type": "column",
                    "schema": target_schema,
                    "data_type": data_type,
                    "is_nullable": is_null,
                    "is_pk": is_pk
                })
            return items
        except Exception:
            return []

    def get_intellisense_parameters(self, database=None, schema=None, object_name=None):
        if not object_name:
            return []
        target_schema = schema or "public"
        query = """
            SELECT parameter_name, data_type, parameter_mode
            FROM information_schema.parameters
            WHERE specific_schema = %s AND specific_name LIKE %s
            ORDER BY ordinal_position
        """
        try:
            res = self.execute(query, [target_schema, f"{object_name}%"], limit=0, database=database)
            params_list = []
            for row in res.get("rows", []):
                p_name, d_type, p_mode = row[0] or "param", row[1], row[2]
                params_list.append({
                    "name": p_name,
                    "data_type": d_type,
                    "is_output": p_mode in ["OUT", "INOUT"]
                })
            return params_list
        except Exception:
            return []

    def list_object_children(
        self,
        database,
        schema,
        name,
        object_type,
        child_type,
    ):
        items = []
        target_schema = (schema or "public").strip()

        if child_type == "columns":
            attr_sql = """
                SELECT 
                    a.attname AS column_name,
                    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                    NULL AS character_maximum_length,
                    NOT a.attnotnull AS is_nullable
                FROM pg_catalog.pg_attribute a
                JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND a.attnum > 0
                  AND NOT a.attisdropped
                ORDER BY a.attnum
            """
            attr_res = self.execute(attr_sql, (target_schema, target_schema, name, name), limit=0, database=database)
            for r in attr_res.get("rows", []):
                items.append({"name": r[0], "type": r[1], "length": r[2], "nullable": bool(r[3])})
                
        elif child_type == "keys":
            sql = """
                SELECT con.conname AS constraint_name,
                       CASE con.contype
                           WHEN 'p' THEN 'PRIMARY KEY'
                           WHEN 'f' THEN 'FOREIGN KEY'
                           WHEN 'u' THEN 'UNIQUE'
                           ELSE con.contype::text
                       END AS type
                FROM pg_catalog.pg_constraint con
                JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND con.contype IN ('p', 'f', 'u')
                ORDER BY con.conname
            """
            res = self.execute(sql, (target_schema, target_schema, name, name), limit=0, database=database)
            for r in res.get("rows", []):
                items.append({"name": r[0], "type": r[1]})
                
        elif child_type == "constraints":
            sql = """
                SELECT con.conname AS constraint_name, 'CHECK' AS type
                FROM pg_catalog.pg_constraint con
                JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND con.contype = 'c'
                ORDER BY con.conname
            """
            res = self.execute(sql, (target_schema, target_schema, name, name), limit=0, database=database)
            for r in res.get("rows", []):
                items.append({"name": r[0], "type": r[1]})
                
        elif child_type == "triggers":
            sql = """
                SELECT t.tgname AS trigger_name
                FROM pg_catalog.pg_trigger t
                JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND NOT t.tgisinternal
                ORDER BY t.tgname
            """
            res = self.execute(sql, (target_schema, target_schema, name, name), limit=0, database=database)
            for r in res.get("rows", []):
                items.append({"name": r[0]})
                
        elif child_type == "indexes":
            sql = """
                SELECT indexname
                FROM pg_catalog.pg_indexes
                WHERE (schemaname = %s OR lower(schemaname) = lower(%s))
                  AND (tablename = %s OR lower(tablename) = lower(%s))
                ORDER BY indexname
            """
            res = self.execute(sql, (target_schema, target_schema, name, name), limit=0, database=database)
            for r in res.get("rows", []):
                items.append({"name": r[0]})
                
        elif child_type == "params":
            sql = """
                SELECT parameter_name, data_type
                FROM information_schema.parameters
                WHERE (specific_schema = %s OR lower(specific_schema) = lower(%s))
                  AND (specific_name LIKE %s || '%%' OR lower(specific_name) LIKE lower(%s) || '%%')
                ORDER BY ordinal_position
            """
            res = self.execute(sql, (target_schema, target_schema, name, name), limit=0, database=database)
            for r in res.get("rows", []):
                name_val = r[0] if r[0] else 'Return/Arg'
                items.append({"name": name_val, "type": r[1]})
                
        return items

    def get_supported_types(self, database=None):
        user_types = []
        try:
            udt_sql = """
                SELECT t.typname
                FROM pg_type t
                JOIN pg_namespace n ON t.typnamespace = n.oid
                WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                  AND t.typtype IN ('d', 'e', 'c')
                ORDER BY t.typname
            """
            res = self.execute(udt_sql, database=database)
            if res and res.get("rows"):
                user_types = [r[0] for r in res["rows"] if r and r[0]]
        except Exception:
            pass

        return {
            "engine": "postgresql",
            "types": [
                "bigint", "bigserial", "bit", "boolean", "bytea", "char",
                "date", "double precision", "integer", "json", "jsonb", "numeric",
                "real", "serial", "smallint", "smallserial", "text", "time",
                "timestamp", "timestamptz", "uuid", "varchar", "xml"
            ],
            "user_types": user_types,
            "collations": [
                "default",
                "C",
                "POSIX",
                "en_US.utf8",
                "vi_VN.utf8"
            ]
        }

    def get_table_design_metadata(self, database, schema, table):
        schema_name = schema or "public"

        # Check table exists
        check_sql = """
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = %s AND table_name = %s
        """
        check_res = self.execute(check_sql, (schema_name, table), database=database)
        if not check_res.get("rows"):
            return None

        # 1. Columns
        col_sql = """
            SELECT 
                c.ordinal_position,
                c.column_name,
                c.data_type,
                c.udt_name,
                c.character_maximum_length,
                c.numeric_precision,
                c.numeric_scale,
                c.is_nullable,
                c.is_identity,
                c.column_default,
                c.collation_name,
                CASE WHEN pk_cols.attname IS NOT NULL THEN 1 ELSE 0 END AS is_pk,
                col_description(c_tbl.oid, c.ordinal_position) AS description
            FROM information_schema.columns c
            JOIN pg_class c_tbl ON c_tbl.relname = c.table_name
            JOIN pg_namespace n_tbl ON n_tbl.oid = c_tbl.relnamespace AND n_tbl.nspname = c.table_schema
            LEFT JOIN (
                SELECT a.attname
                FROM pg_index i
                JOIN pg_class c_pk ON c_pk.oid = i.indrelid
                JOIN pg_namespace n_pk ON n_pk.oid = c_pk.relnamespace
                JOIN pg_attribute a ON a.attrelid = c_pk.oid AND a.attnum = ANY(i.indkey)
                WHERE n_pk.nspname = %s AND c_pk.relname = %s AND i.indisprimary
            ) pk_cols ON pk_cols.attname = c.column_name
            WHERE c.table_schema = %s AND c.table_name = %s
            ORDER BY c.ordinal_position
        """
        col_res = self.execute(col_sql, (schema_name, table, schema_name, table), database=database)
        columns = []
        for r in col_res.get("rows", []):
            raw_type = (r[2] or "").lower()
            udt_name = (r[3] or "").lower()
            
            # Normalize display type
            if raw_type == "character varying":
                norm_type = "varchar"
            elif raw_type == "character":
                norm_type = "char"
            elif raw_type == "timestamp without time zone":
                norm_type = "timestamp"
            elif raw_type == "timestamp with time zone":
                norm_type = "timestamptz"
            elif raw_type == "time without time zone":
                norm_type = "time"
            elif raw_type == "time with time zone":
                norm_type = "timetz"
            elif raw_type == "USER-DEFINED":
                norm_type = udt_name
            else:
                norm_type = raw_type

            # Size
            size_str = ""
            if r[4] is not None:
                size_str = str(r[4])
            elif r[5] is not None and norm_type == "numeric":
                size_str = str(r[5])

            scale_str = str(r[6]) if r[6] is not None and norm_type == "numeric" else ""

            # Default and identity
            default_val = r[9] or ""
            is_identity = (r[8] == "YES") or ("nextval(" in default_val)
            if is_identity and "nextval(" in default_val:
                # Often serial in Postgres
                if norm_type == "integer":
                    norm_type = "serial"
                elif norm_type == "bigint":
                    norm_type = "bigserial"
                elif norm_type == "smallint":
                    norm_type = "smallserial"
            else:
                # Clean postgres cast e.g. "'-1'::integer" -> "-1", "0::numeric" -> "0"
                if "::" in default_val:
                    default_val = default_val.split("::")[0].strip()
                is_numeric = norm_type in ("int", "integer", "bigint", "smallint", "numeric", "decimal", "real", "double precision")
                if is_numeric:
                    while (default_val.startswith("'") and default_val.endswith("'")) or (default_val.startswith('"') and default_val.endswith('"')):
                        default_val = default_val[1:-1].strip()

            columns.append({
                "name": r[1],
                "type": norm_type,
                "size": size_str,
                "scale": scale_str,
                "nullable": (r[7] == "YES"),
                "is_pk": bool(r[11]),
                "is_identity": is_identity,
                "identity_seed": 1,
                "identity_increment": 1,
                "default_value": default_val,
                "collation": r[10] or "",
                "comment": r[12] or ""
            })

        # 2. Indexes
        idx_sql = """
            SELECT 
                i.relname AS index_name,
                am.amname AS index_type,
                ix.indisunique AS is_unique,
                ARRAY(
                    SELECT a.attname
                    FROM pg_attribute a
                    WHERE a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
                ) AS col_names
            FROM pg_index ix
            JOIN pg_class t ON t.oid = ix.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_am am ON am.oid = i.relam
            WHERE n.nspname = %s AND t.relname = %s 
              AND NOT ix.indisprimary
              AND NOT EXISTS (
                  SELECT 1 FROM pg_constraint c 
                  WHERE c.conindid = ix.indexrelid AND c.contype = 'u'
              )
            ORDER BY i.relname
        """
        idx_res = self.execute(idx_sql, (schema_name, table), database=database)
        indexes = []
        for r in idx_res.get("rows", []):
            raw_cols = r[3]
            cols = []
            if isinstance(raw_cols, list):
                cols = [{"column": str(c), "desc": False} for c in raw_cols]
            elif isinstance(raw_cols, str):
                # parse postgres array e.g. {col1,col2}
                cleaned = raw_cols.strip("{}").split(",")
                cols = [{"column": c.strip('"'), "desc": False} for c in cleaned if c]

            indexes.append({
                "name": r[0],
                "fields": cols,
                "index_type": (r[1] or "btree").upper(),
                "is_unique": bool(r[2]),
                "comment": ""
            })

        # 3. Foreign Keys
        fk_sql = """
            SELECT
                tc.constraint_name,
                kcu.column_name,
                ccu.table_schema AS ref_schema,
                ccu.table_name AS ref_table,
                ccu.column_name AS ref_column,
                rc.delete_rule,
                rc.update_rule
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            JOIN information_schema.referential_constraints rc
                ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
                AND tc.table_schema = %s AND tc.table_name = %s
            ORDER BY tc.constraint_name, kcu.ordinal_position
        """
        fk_res = self.execute(fk_sql, (schema_name, table), database=database)
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
                    "on_delete": r[5] or "NO ACTION",
                    "on_update": r[6] or "NO ACTION",
                    "is_enabled": True,
                    "not_for_replication": False,
                    "comment": ""
                }
            fk_map[fk_name]["fields"].append(r[1])
            fk_map[fk_name]["ref_fields"].append(r[4])
        foreign_keys = list(fk_map.values())

        # 4. Uniques
        uq_sql = """
            SELECT
                tc.constraint_name,
                kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'UNIQUE'
                AND tc.table_schema = %s AND tc.table_name = %s
            ORDER BY tc.constraint_name, kcu.ordinal_position
        """
        uq_res = self.execute(uq_sql, (schema_name, table), database=database)
        uq_map = {}
        for r in uq_res.get("rows", []):
            uq_name = r[0]
            if uq_name not in uq_map:
                uq_map[uq_name] = {
                    "name": uq_name,
                    "fields": [],
                    "is_clustered": False,
                    "comment": ""
                }
            uq_map[uq_name]["fields"].append(r[1])
        uniques = list(uq_map.values())

        # 5. Checks
        chk_sql = """
            SELECT
                tc.constraint_name,
                cc.check_clause
            FROM information_schema.table_constraints tc
            JOIN information_schema.check_constraints cc
                ON cc.constraint_name = tc.constraint_name AND cc.constraint_schema = tc.table_schema
            WHERE tc.constraint_type = 'CHECK'
                AND tc.table_schema = %s AND tc.table_name = %s
                AND tc.constraint_name NOT LIKE '%%_not_null'
            ORDER BY tc.constraint_name
        """
        chk_res = self.execute(chk_sql, (schema_name, table), database=database)
        checks = []
        for r in chk_res.get("rows", []):
            clause = r[1] or ""
            checks.append({
                "name": r[0],
                "check_clause": clause,
                "is_enabled": True,
                "not_for_replication": False,
                "comment": ""
            })

        # 6. Triggers
        trig_sql = """
            SELECT 
                tr.trigger_name,
                tr.action_timing,
                tr.event_manipulation,
                pg_get_triggerdef(pg_t.oid, true) as trigger_def
            FROM information_schema.triggers tr
            JOIN pg_class pg_c ON pg_c.relname = tr.event_object_table
            JOIN pg_namespace pg_n ON pg_n.oid = pg_c.relnamespace AND pg_n.nspname = tr.event_object_schema
            JOIN pg_trigger pg_t ON pg_t.tgrelid = pg_c.oid AND pg_t.tgname = tr.trigger_name
            WHERE tr.event_object_schema = %s AND tr.event_object_table = %s
            ORDER BY tr.trigger_name
        """
        trig_res = self.execute(trig_sql, (schema_name, table), database=database)
        trig_map = {}
        for r in trig_res.get("rows", []):
            t_name = r[0]
            timing = (r[1] or "AFTER").capitalize() # Before, After, Instead Of
            event = (r[2] or "").upper()
            if t_name not in trig_map:
                trig_map[t_name] = {
                    "name": t_name,
                    "fires": timing,
                    "is_insert": False,
                    "is_update": False,
                    "is_delete": False,
                    "is_enabled": True,
                    "definition": r[3] or "",
                    "comment": ""
                }
            if event == "INSERT":
                trig_map[t_name]["is_insert"] = True
            elif event == "UPDATE":
                trig_map[t_name]["is_update"] = True
            elif event == "DELETE":
                trig_map[t_name]["is_delete"] = True
        triggers = list(trig_map.values())

        return {
            "database": database,
            "schema": schema_name,
            "table": table,
            "engine": "postgresql",
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

        self.connection.autocommit = False
        try:
            with self.connection.cursor() as cursor:
                for b in batches:
                    clean_b = b.strip()
                    if not clean_b:
                        continue
                    cursor.execute(clean_b)
            self.connection.commit()
        except Exception as exc:
            try:
                self.connection.rollback()
            except Exception:
                pass
            raise exc
        finally:
            self.connection.autocommit = True

# Alias for compatibility
PostgresAdapter = PostgreSqlAdapter


