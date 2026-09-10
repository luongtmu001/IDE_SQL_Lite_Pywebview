import re
from app.database.base import DatabaseAdapter

try:
    import pyodbc
except ImportError:
    pyodbc = None

def serialize_cell(val):
    if val is None:
        return None
    if isinstance(val, (int, float, bool, str)):
        return val
    if isinstance(val, (bytes, bytearray, memoryview)):
        return "0x" + bytes(val).hex()
    return str(val)

class SqlServerAdapter(DatabaseAdapter):

    def connect(self):
        if pyodbc is None:
            raise RuntimeError("pyodbc is not installed")

        c = self.config
        requested_driver = c.get("driver")

        # Build server string with port if provided and not already included
        raw_server = str(c.get("server") or "localhost").strip()
        port = c.get("port")
        if port and "," not in raw_server and ":" not in raw_server:
            server = f"{raw_server},{port}"
        else:
            server = raw_server

        database = c.get("database") or "master"
        timeout = int(c.get("timeout") or 30)

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

        def _build_conn_str(drv):
            if c.get("trusted_connection"):
                return (
                    f"DRIVER={{{drv}}};"
                    f"SERVER={server};"
                    f"DATABASE={database};"
                    "Trusted_Connection=yes;"
                    f"Encrypt={encrypt};"
                    f"TrustServerCertificate={trust_cert};"
                )
            else:
                return (
                    f"DRIVER={{{drv}}};"
                    f"SERVER={server};"
                    f"DATABASE={database};"
                    f"UID={c.get('username', '')};"
                    f"PWD={c.get('password', '')};"
                    f"Encrypt={encrypt};"
                    f"TrustServerCertificate={trust_cert};"
                )

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
            conn_str = _build_conn_str(drv)
            try:
                self.connection = pyodbc.connect(
                    conn_str,
                    timeout=timeout,
                    autocommit=True,
                )
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

    def close(self):
        if self.connection:
            self.connection.close()
            self.connection = None

    def execute(self, sql, params=None, limit=None, database=None):
        cursor = self.connection.cursor()

        try:
            # Switch database context if database is specified and query doesn't explicitly start with USE
            if database and not re.match(r'^\s*USE\s+', sql, flags=re.IGNORECASE):
                try:
                    clean_db = str(database).replace("]", "]]")
                    cursor.execute(f"USE [{clean_db}]")
                except Exception:
                    pass

            # Handle SSMS batch separator GO
            raw_batches = re.split(r'^\s*GO\s*;?\s*(?:--.*)?$', sql, flags=re.MULTILINE | re.IGNORECASE)
            batches = []
            for b in raw_batches:
                b = b.strip()
                if not b:
                    continue
                # If a batch starts with USE [db]; followed by CREATE/ALTER on a new line, split it into two batches
                use_match = re.match(
                    r'^(\s*USE\s+(?:\[[^\]]+\]|[^\s;]+)\s*;?)\s*\r?\n\s*((?:CREATE|ALTER)\b[\s\S]*)$',
                    b,
                    flags=re.IGNORECASE
                )
                if use_match:
                    batches.append(use_match.group(1).strip())
                    batches.append(use_match.group(2).strip())
                else:
                    batches.append(b)

            if not batches:
                batches = [sql]

            results = []
            messages = []
            total_affected = 0

            for batch in batches:
                cursor.execute(batch, params or ())
                while True:
                    if cursor.description:
                        columns = [desc[0] for desc in cursor.description]
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
                        if rc != -1:
                            messages.append(f"({rc} row(s) affected)")
                            total_affected += rc
                        else:
                            messages.append("Commands completed successfully.")

                    try:
                        if not cursor.nextset():
                            break
                    except Exception:
                        break

            # Check for driver messages or PRINT outputs
            if hasattr(cursor, 'messages') and cursor.messages:
                for m in cursor.messages:
                    messages.append(str(m[1]) if isinstance(m, (list, tuple)) and len(m) > 1 else str(m))

            current_db = None
            try:
                cursor.execute("SELECT DB_NAME()")
                row = cursor.fetchone()
                if row:
                    current_db = row[0]
            except Exception:
                pass

            first = results[0] if results else {"columns": [], "rows": [], "row_count": total_affected}
            return {
                "success": True,
                "columns": first["columns"],
                "rows": first["rows"],
                "row_count": first["row_count"],
                "results": results,
                "messages": messages,
                "message": "\n".join(messages) if messages else "Commands completed successfully.",
                "current_database": current_db,
            }

        finally:
            cursor.close()

    def list_databases(self):
        result = self.execute(
            "SELECT name, state_desc "
            "FROM sys.databases ORDER BY name"
        )

        return [
            {"name": row[0], "state": row[1]}
            for row in result["rows"]
        ]

    def list_schemas(self, database=None):
        db_prefix = f"[{database}]." if database else ""
        result = self.execute(
            f"SELECT name FROM {db_prefix}sys.schemas ORDER BY name"
        )

        return [{"name": row[0]} for row in result["rows"]]

    def list_objects(self, database, schema, object_type, search=None):
        type_map = {
            "tables": "U",
            "views": "V",
            "procedures": "P",
            "triggers": "TR",
        }

        db_prefix = f"[{database}]." if database else ""
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

        result = self.execute(sql, tuple(params))

        return [
            {
                "schema": row[0],
                "name": row[1],
                "id": row[2],
            }
            for row in result["rows"]
        ]

    def get_intellisense_objects(self, database=None, schema=None):
        db_prefix = f"[{database}]." if database else ""
        schema_filter = "AND LOWER(s.name) = LOWER(?)" if schema else ""
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
        db_prefix = f"[{database}]." if database else ""
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
                CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_pk
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
                    "is_pk": is_pk
                })
            return items
        except Exception:
            return []

    def get_intellisense_parameters(self, database=None, schema=None, object_name=None):
        if not object_name:
            return []
        db_prefix = f"[{database}]." if database else ""
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
        db_prefix = f"[{database}]." if database else ""

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
            )
            if result["rows"]:
                return result["rows"][0][0]

        result = self.execute(
            f"""
            SELECT sm.definition
            FROM {db_prefix}sys.sql_modules AS sm
            JOIN {db_prefix}sys.objects AS o
              ON o.object_id = sm.object_id
            JOIN {db_prefix}sys.schemas AS s
              ON s.schema_id = o.schema_id
            WHERE s.name = ?
              AND o.name = ?
            """,
            (schema, name),
        )

        return result["rows"][0][0] if result["rows"] else None

    def list_object_children(
        self,
        database,
        schema,
        name,
        object_type,
        child_type,
    ):
        db_prefix = f"[{database}]." if database else ""
        obj_sql = f"""
            SELECT o.object_id 
            FROM {db_prefix}sys.objects o
            JOIN {db_prefix}sys.schemas s ON s.schema_id = o.schema_id
            WHERE s.name = ? AND o.name = ?
        """
        obj_res = self.execute(obj_sql, (schema, name))
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
            res = self.execute(sql, (object_id,))
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
            res = self.execute(sql, (object_id, object_id))
            for r in res["rows"]:
                items.append({"name": r[0], "type": r[1]})
                
        elif child_type == "constraints":
            sql = f"""
                SELECT c.name, 'CHECK' as type FROM {db_prefix}sys.check_constraints c WHERE c.parent_object_id = ?
                UNION ALL
                SELECT d.name, 'DEFAULT' as type FROM {db_prefix}sys.default_constraints d WHERE d.parent_object_id = ?
            """
            res = self.execute(sql, (object_id, object_id))
            for r in res["rows"]:
                items.append({"name": r[0], "type": r[1]})
                
        elif child_type == "triggers":
            sql = f"""
                SELECT tr.name FROM {db_prefix}sys.triggers tr WHERE tr.parent_id = ?
            """
            res = self.execute(sql, (object_id,))
            for r in res["rows"]:
                items.append({"name": r[0]})
                
        elif child_type == "indexes":
            sql = f"""
                SELECT i.name FROM {db_prefix}sys.indexes i WHERE i.object_id = ? AND i.type > 0
            """
            res = self.execute(sql, (object_id,))
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
            res = self.execute(sql, (object_id,))
            for r in res["rows"]:
                name_val = r[0] if r[0] else 'Return Value'
                items.append({"name": name_val, "type": r[1]})
                
        return items

    def get_supported_types(self, database=None):
        user_types = []
        try:
            db_prefix = f"[{database}]." if database else ""
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
                        user_types.append(f"[{r[0]}].[{r[1]}]")
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
        db_prefix = f"[{database}]." if database else ""
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
                t.name AS type_raw_name
            FROM {db_prefix}sys.columns c
            JOIN {db_prefix}sys.types t ON t.user_type_id = c.user_type_id
            JOIN {db_prefix}sys.schemas st ON st.schema_id = t.schema_id
            LEFT JOIN {db_prefix}sys.identity_columns ic 
                ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            LEFT JOIN (
                SELECT ic.column_id
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
        for r in col_res.get("rows", []):
            is_udt = bool(r[14]) if len(r) > 14 else False
            type_schema = r[15] if len(r) > 15 else ""
            type_raw_name = r[16] if len(r) > 16 else ""

            if is_udt and type_raw_name:
                type_name = f"[{type_schema}].[{type_raw_name}]"
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

            columns.append({
                "name": r[1],
                "type": type_name,
                "size": size_str,
                "scale": str(scale) if scale is not None and type_name in ("decimal", "numeric", "datetime2", "time") else "",
                "nullable": bool(r[6]),
                "is_pk": bool(r[12]),
                "is_identity": bool(r[7]),
                "identity_seed": int(r[8]) if r[8] is not None else 1,
                "identity_increment": int(r[9]) if r[9] is not None else 1,
                "default_value": def_val,
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
            clean_db = str(database).replace("]", "]]")
            try:
                cursor.execute(f"USE [{clean_db}]")
            except Exception:
                pass

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
