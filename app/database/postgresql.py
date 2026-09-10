from app.database.base import DatabaseAdapter

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

    def connect(self):
        if psycopg is None:
            raise RuntimeError("psycopg is not installed")

        c = self.config

        self.connection = psycopg.connect(
            host=c["host"],
            port=int(c.get("port", 5432)),
            dbname=c.get("database", "postgres"),
            user=c["username"],
            password=c["password"],
            connect_timeout=int(c.get("timeout", 10)),
        )

        self.connection.autocommit = True

    def close(self):
        if self.connection:
            self.connection.close()
            self.connection = None

    def execute(self, sql, params=None, limit=None, database=None):
        with self.connection.cursor() as cursor:
            cursor.execute(sql, params or ())

            results = []
            messages = []
            total_affected = 0

            while True:
                if cursor.description:
                    columns = [desc.name for desc in cursor.description]
                    fetch_limit = limit if limit is not None else int(self.config.get("max_rows", 1000))
                    if fetch_limit == 0:
                        raw_rows = cursor.fetchall()
                    else:
                        raw_rows = cursor.fetchmany(fetch_limit)

                    rows = [[serialize_cell(c) for c in r] for r in raw_rows]
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
                    else:
                        messages.append("Commands completed successfully.")

                try:
                    if not cursor.nextset():
                        break
                except Exception:
                    break

            first = results[0] if results else {"columns": [], "rows": [], "row_count": total_affected}
            return {
                "success": True,
                "columns": first["columns"],
                "rows": first["rows"],
                "row_count": first["row_count"],
                "results": results,
                "messages": messages,
                "message": "\n".join(messages) if messages else "Commands completed successfully.",
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
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('pg_toast')
            ORDER BY schema_name
            """
        )

        return [{"name": row[0]} for row in result["rows"]]

    def list_objects(self, database, schema, object_type, search=None):
        if object_type in ["procedures", "functions"]:
            sql = """
                SELECT routine_schema, routine_name, NULL as id
                FROM information_schema.routines
                WHERE routine_schema = %s
            """
            if object_type == "procedures":
                sql += "  AND routine_type = 'PROCEDURE'"
            else:
                sql += "  AND routine_type = 'FUNCTION'"
            params = [schema]
        else:
            if object_type == "tables":
                sql = """
                    SELECT table_schema, table_name, NULL as id
                    FROM information_schema.tables
                    WHERE table_schema = %s
                      AND table_type = 'BASE TABLE'
                """
                params = [schema]
            elif object_type == "views":
                sql = """
                    SELECT table_schema, table_name, NULL as id
                    FROM information_schema.views
                    WHERE table_schema = %s
                """
                params = [schema]
            else:
                sql = """
                    SELECT n.nspname, p.proname, p.oid
                    FROM pg_proc AS p
                    JOIN pg_namespace AS n
                      ON n.oid = p.pronamespace
                    WHERE n.nspname = %s
                """
                params = [schema]

        if search:
            sql += "  AND (routine_name ILIKE %s OR table_name ILIKE %s)" if object_type in ["procedures", "functions"] else "  AND p.proname ILIKE %s" if object_type not in ["tables", "views"] else "  AND table_name ILIKE %s"
            params.append(f"%{search}%")

        sql += "\n            ORDER BY 2"

        result = self.execute(sql, tuple(params))

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
        if object_type in {"functions", "procedures"}:
            result = self.execute(
                """
                SELECT pg_get_functiondef(p.oid)
                FROM pg_proc AS p
                JOIN pg_namespace AS n
                  ON n.oid = p.pronamespace
                WHERE n.nspname = %s
                  AND p.proname = %s
                LIMIT 1
                """,
                (schema, name),
            )

            return result["rows"][0][0] if result["rows"] else None

        if object_type == "views":
            result = self.execute(
                """
                SELECT
                    'CREATE OR REPLACE VIEW ' ||
                    quote_ident(schemaname) || '.' ||
                    quote_ident(viewname) || ' AS ' ||
                    definition
                FROM pg_views
                WHERE schemaname = %s
                  AND viewname = %s
                """,
                (schema, name),
            )

            return result["rows"][0][0] if result["rows"] else None

        if object_type in {"trigger", "triggers"}:
            result = self.execute(
                """
                SELECT pg_get_triggerdef(t.oid, true) || ';'
                FROM pg_trigger AS t
                JOIN pg_class AS c ON c.oid = t.tgrelid
                JOIN pg_namespace AS n ON n.oid = c.relnamespace
                WHERE n.nspname = %s
                  AND t.tgname = %s
                  AND NOT t.tgisinternal
                LIMIT 1
                """,
                (schema, name),
            )

            return result["rows"][0][0] if result["rows"] else None

        return None

    def get_intellisense_objects(self, database=None, schema=None):
        target_schema = schema or "public"
        items = []
        try:
            # 1. Tables and Views
            tv_query = """
                SELECT table_name, table_schema, table_type
                FROM information_schema.tables
                WHERE table_schema = %s
                ORDER BY table_name
            """
            res = self.execute(tv_query, [target_schema], limit=0, database=database)
            for row in res.get("rows", []):
                name, s_name, t_type = row[0], row[1], row[2]
                mapped_type = "table" if t_type == "BASE TABLE" else "view"
                items.append({
                    "name": name,
                    "schema": s_name,
                    "type": mapped_type,
                    "target_object": ""
                })

            # 2. Routines (Procedures / Functions)
            routines_query = """
                SELECT routine_name, routine_schema, routine_type
                FROM information_schema.routines
                WHERE routine_schema = %s
                ORDER BY routine_name
            """
            res_r = self.execute(routines_query, [target_schema], limit=0, database=database)
            for row in res_r.get("rows", []):
                name, s_name, r_type = row[0], row[1], (row[2] or "").lower()
                items.append({
                    "name": name,
                    "schema": s_name,
                    "type": r_type if r_type in ["procedure", "function"] else "function",
                    "target_object": ""
                })

            # 3. Triggers
            try:
                triggers_query = """
                    SELECT trigger_name, trigger_schema
                    FROM information_schema.triggers
                    WHERE trigger_schema = %s
                    ORDER BY trigger_name
                """
                res_t = self.execute(triggers_query, [target_schema], limit=0, database=database)
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
        target_schema = schema or "public"
        query = """
            SELECT c.column_name, c.data_type, c.character_maximum_length, c.is_nullable,
                   CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_pk
            FROM information_schema.columns c
            LEFT JOIN (
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = %s AND tc.table_name = %s
            ) pk ON c.column_name = pk.column_name
            WHERE c.table_schema = %s AND c.table_name = %s
            ORDER BY c.ordinal_position
        """
        try:
            res = self.execute(query, [target_schema, table_name, target_schema, table_name], limit=0, database=database)
            items = []
            for row in res.get("rows", []):
                col_name, data_type, max_len, is_null, is_pk = row[0], row[1], row[2], row[3] == "YES", bool(row[4])
                type_str = data_type
                if max_len:
                    type_str = f"{data_type}({max_len})"
                items.append({
                    "name": col_name,
                    "type": "column",
                    "schema": target_schema,
                    "data_type": type_str,
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
        if child_type == "columns":
            sql = """
                SELECT column_name, data_type, character_maximum_length, is_nullable
                FROM information_schema.columns
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position
            """
            res = self.execute(sql, (schema, name))
            for r in res["rows"]:
                items.append({"name": r[0], "type": r[1], "length": r[2], "nullable": r[3] == "YES"})
                
        elif child_type == "keys":
            sql = """
                SELECT constraint_name, constraint_type as type
                FROM information_schema.table_constraints
                WHERE table_schema = %s AND table_name = %s
                  AND constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
            """
            res = self.execute(sql, (schema, name))
            for r in res["rows"]:
                items.append({"name": r[0], "type": r[1]})
                
        elif child_type == "constraints":
            sql = """
                SELECT constraint_name, constraint_type as type
                FROM information_schema.table_constraints
                WHERE table_schema = %s AND table_name = %s
                  AND constraint_type = 'CHECK'
            """
            res = self.execute(sql, (schema, name))
            for r in res["rows"]:
                items.append({"name": r[0], "type": r[1]})
                
        elif child_type == "triggers":
            sql = """
                SELECT trigger_name
                FROM information_schema.triggers
                WHERE event_object_schema = %s AND event_object_table = %s
            """
            res = self.execute(sql, (schema, name))
            for r in res["rows"]:
                items.append({"name": r[0]})
                
        elif child_type == "indexes":
            sql = """
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = %s AND tablename = %s
            """
            res = self.execute(sql, (schema, name))
            for r in res["rows"]:
                items.append({"name": r[0]})
                
        elif child_type == "params":
            sql = """
                SELECT parameter_name, data_type
                FROM information_schema.parameters
                WHERE specific_schema = %s AND specific_name LIKE %s || '%%'
                ORDER BY ordinal_position
            """
            res = self.execute(sql, (schema, name))
            for r in res["rows"]:
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

