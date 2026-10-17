import re
from typing import Any, Dict, List, Optional

from app.database.sql_utils import quote_ident, quote_qualified
from app.services.table_designer_service import TableDesignerService


class MetadataService:

    def __init__(self, connection_session):
        self.session = connection_session

    def _cache_key(self, *parts):
        return "::".join(
            "" if part is None else str(part)
            for part in parts
        )

    def list_databases(self):
        key = self._cache_key("databases")

        if key not in self.session.metadata_cache:
            with self.session.lock:
                self.session.metadata_cache[key] = (
                    self.session.adapter.list_databases()
                )

        return self.session.metadata_cache[key]

    def list_schemas(self, database=None):
        key = self._cache_key("schemas", database)

        if key not in self.session.metadata_cache:
            with self.session.lock:
                self.session.metadata_cache[key] = (
                    self.session.adapter.list_schemas(database)
                )

        return self.session.metadata_cache[key]

    def list_objects(self, database, schema, object_type, search=None, limit=0, refresh=False):
        key = self._cache_key(
            "objects",
            database,
            schema,
            object_type,
            search,
            limit,
        )

        if refresh:
            self.invalidate(database=database, schema=schema, object_type=object_type)
            with self.session.lock:
                for k in list(self.session.metadata_cache.keys()):
                    if str(k).startswith(f"intellisense_objects::{database}"):
                        self.session.metadata_cache.pop(k, None)

        if key not in self.session.metadata_cache:
            with self.session.lock:
                self.session.metadata_cache[key] = (
                    self.session.adapter.list_objects(
                        database,
                        schema,
                        object_type,
                        search,
                        limit=limit
                    )
                )

        return self.session.metadata_cache[key]

    def get_object_definition(
        self,
        database,
        schema,
        name,
        object_type,
    ):
        with self.session.lock:
            return self.session.adapter.get_object_definition(
                database,
                schema,
                name,
                object_type,
            )

    def list_object_children(self, database, schema, name, object_type, child_type):
        key = self._cache_key("children", database, schema, name, object_type, child_type)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                self.session.metadata_cache[key] = (
                    self.session.adapter.list_object_children(
                        database, schema, name, object_type, child_type
                    )
                )
        return self.session.metadata_cache[key]

    def get_table_design_metadata(self, database, schema, table):
        with self.session.lock:
            return self.session.adapter.get_table_design_metadata(database, schema, table)

    def get_supported_types(self, database=None):
        with self.session.lock:
            return self.session.adapter.get_supported_types(database=database)

    def get_intellisense_objects(self, database=None, schema=None):
        key = self._cache_key("intellisense_objects", database, schema)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "get_intellisense_objects"):
                    self.session.metadata_cache[key] = (
                        self.session.adapter.get_intellisense_objects(database, schema)
                    )
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def get_intellisense_columns(self, database=None, schema=None, table=None):
        key = self._cache_key("intellisense_columns", database, schema, table)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "get_intellisense_columns"):
                    self.session.metadata_cache[key] = (
                        self.session.adapter.get_intellisense_columns(database, schema, table)
                    )
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def get_intellisense_parameters(self, database=None, schema=None, name=None):
        key = self._cache_key("intellisense_parameters", database, schema, name)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "get_intellisense_parameters"):
                    self.session.metadata_cache[key] = (
                        self.session.adapter.get_intellisense_parameters(database, schema, name)
                    )
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def get_foreign_keys(self, database=None, schema=None, table=None):
        key = self._cache_key("foreign_keys", database, schema, table)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "get_foreign_keys"):
                    self.session.metadata_cache[key] = (
                        self.session.adapter.get_foreign_keys(database, schema, table)
                    )
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_linked_servers(self):
        key = self._cache_key("linked_servers")
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_linked_servers"):
                    self.session.metadata_cache[key] = self.session.adapter.list_linked_servers()
                elif hasattr(self.session.adapter, "list_foreign_servers"):
                    self.session.metadata_cache[key] = self.session.adapter.list_foreign_servers()
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_remote_databases(self, server):
        key = self._cache_key("remote_databases", server)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_remote_databases"):
                    self.session.metadata_cache[key] = self.session.adapter.list_remote_databases(server)
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_remote_schemas(self, server, database=None):
        key = self._cache_key("remote_schemas", server, database)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_remote_schemas"):
                    self.session.metadata_cache[key] = self.session.adapter.list_remote_schemas(server, database)
                else:
                    self.session.metadata_cache[key] = [{"name": "dbo"}]
        return self.session.metadata_cache[key]

    def list_remote_objects(self, server, database=None, schema=None):
        key = self._cache_key("remote_objects", server, database, schema)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_remote_objects"):
                    self.session.metadata_cache[key] = self.session.adapter.list_remote_objects(server, database, schema)
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_remote_columns(self, server, database=None, schema=None, table=None):
        key = self._cache_key("remote_columns", server, database, schema, table)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_remote_columns"):
                    self.session.metadata_cache[key] = self.session.adapter.list_remote_columns(server, database, schema, table)
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_foreign_servers(self):
        key = self._cache_key("foreign_servers")
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_foreign_servers"):
                    self.session.metadata_cache[key] = self.session.adapter.list_foreign_servers()
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_foreign_tables(self, schema=None):
        key = self._cache_key("foreign_tables", schema)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_foreign_tables"):
                    self.session.metadata_cache[key] = self.session.adapter.list_foreign_tables(schema=schema)
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def invalidate(self, database=None, schema=None, object_type=None):
        with self.session.lock:
            if not database and not schema and not object_type:
                self.session.metadata_cache.clear()
                return

            keys_to_remove = []
            db_clean = str(database).strip().lower() if database else None
            schema_clean = str(schema).strip().lower() if schema else None
            obj_type_clean = str(object_type).strip().lower() if object_type else None

            for k in list(self.session.metadata_cache.keys()):
                if isinstance(k, str):
                    parts = k.split("::")
                elif isinstance(k, tuple):
                    parts = list(k)
                else:
                    continue

                if not parts:
                    continue

                prefix = str(parts[0]).lower()

                # Always invalidate intellisense_objects if database matches (or no database specified)
                if prefix == "intellisense_objects":
                    k_db = str(parts[1]).strip().lower() if len(parts) > 1 and parts[1] else None
                    k_schema = str(parts[2]).strip().lower() if len(parts) > 2 and parts[2] else None
                    if db_clean and k_db and k_db != db_clean:
                        continue
                    if schema_clean and k_schema and k_schema != schema_clean:
                        continue
                    keys_to_remove.append(k)
                    continue

                # Check database matching if present
                if db_clean and len(parts) > 1 and parts[1]:
                    if str(parts[1]).strip().lower() != db_clean:
                        continue

                # Check schema matching if present
                if schema_clean and len(parts) > 2 and parts[2]:
                    if str(parts[2]).strip().lower() != schema_clean:
                        continue

                # Check object_type matching if present
                if obj_type_clean and len(parts) > 3 and parts[3]:
                    if str(parts[3]).strip().lower() != obj_type_clean:
                        continue

                keys_to_remove.append(k)

            for k in keys_to_remove:
                self.session.metadata_cache.pop(k, None)

    def _get_engine(self) -> str:
        """Determines whether the connection dialect is 'postgresql' or 'sqlserver'."""
        adapter = getattr(self.session, "adapter", None)
        db_type = getattr(adapter, "db_type", None)
        if not db_type and hasattr(self.session, "config") and self.session.config:
            db_type = self.session.config.get("type", "")
        db_type_str = str(db_type or "").strip().lower()
        if "postgre" in db_type_str or "pg" in db_type_str:
            return "postgresql"
        return "sqlserver"

    def _get_columns_for_object(
        self,
        database: Optional[str],
        schema: Optional[str],
        name: str,
        object_type: str = "table",
    ) -> List[Dict[str, Any]]:
        """Retrieves column list with metadata for table/view."""
        # 1. Try table designer metadata (has full column types and PK flags)
        try:
            tbl_meta = self.get_table_design_metadata(database, schema, name)
            if tbl_meta and isinstance(tbl_meta, dict) and tbl_meta.get("columns"):
                return tbl_meta["columns"]
        except Exception:
            pass

        # 2. Try intellisense columns
        try:
            intel_cols = self.get_intellisense_columns(database, schema, name)
            if intel_cols and isinstance(intel_cols, list) and len(intel_cols) > 0:
                res = []
                for c in intel_cols:
                    if isinstance(c, dict):
                        res.append({
                            "name": c.get("name") or c.get("column_name", ""),
                            "type": c.get("type") or c.get("data_type", "varchar"),
                            "nullable": c.get("nullable", True),
                            "is_pk": c.get("is_pk", False),
                            "is_identity": c.get("is_identity", False),
                        })
                    elif isinstance(c, str):
                        res.append({"name": c, "type": "varchar", "nullable": True, "is_pk": False})
                if res:
                    return res
        except Exception:
            pass

        # 3. Try object children
        try:
            children = self.list_object_children(database, schema, name, object_type, "columns")
            if children and isinstance(children, list) and len(children) > 0:
                res = []
                for c in children:
                    if isinstance(c, dict):
                        res.append({
                            "name": c.get("name") or "",
                            "type": c.get("type") or "varchar",
                            "nullable": c.get("nullable", True),
                            "is_pk": c.get("is_pk", False),
                            "is_identity": c.get("is_identity", False),
                        })
                if res:
                    return res
        except Exception:
            pass

        return []

    def script_object(
        self,
        database: Optional[str],
        schema: Optional[str],
        name: str,
        object_type: str = "table",
        action: str = "CREATE",
    ) -> str:
        """
        Generates SQL script for the specified object.
        Supported actions: CREATE, ALTER, DROP, DROP_AND_CREATE, SELECT, INSERT, UPDATE, DELETE, EXECUTE.
        Properly quotes identifiers based on dialect (SQL Server vs PostgreSQL).
        """
        engine = self._get_engine()
        default_schema = "public" if engine == "postgresql" else "dbo"
        effective_schema = schema or default_schema
        raw_name = (name or "").strip()
        norm_type = (object_type or "table").strip().lower().rstrip("s")
        if norm_type in ("user_table", "tables"):
            norm_type = "table"
        elif norm_type in ("views",):
            norm_type = "view"
        elif norm_type in ("procedures", "stored_procedure", "proc"):
            norm_type = "procedure"
        elif norm_type in ("functions", "func"):
            norm_type = "function"
        elif norm_type in ("types", "user_types"):
            norm_type = "type"

        act = (action or "CREATE").strip().upper()

        pure_name = raw_name
        identity_args = ""
        if norm_type in ("procedure", "function", "routine") and "(" in raw_name and raw_name.endswith(")"):
            p = raw_name.split("(", 1)
            pure_name = p[0].strip()
            identity_args = p[1].rstrip(")").strip()

        tbl_qualified = quote_qualified(effective_schema, pure_name, engine=engine)

        # ── ACTION: DROP ──────────────────────────────────────────────────────────
        if act == "DROP":
            if norm_type == "table":
                return f"DROP TABLE IF EXISTS {tbl_qualified};" if engine == "sqlserver" else f"DROP TABLE IF EXISTS {tbl_qualified} CASCADE;"
            elif norm_type in ("view", "materialized_view"):
                if norm_type == "materialized_view" and engine == "postgresql":
                    return f"DROP MATERIALIZED VIEW IF EXISTS {tbl_qualified} CASCADE;"
                return f"DROP VIEW IF EXISTS {tbl_qualified};" if engine == "sqlserver" else f"DROP VIEW IF EXISTS {tbl_qualified} CASCADE;"
            elif norm_type == "procedure":
                if engine == "postgresql":
                    args_clause = f"({identity_args})" if identity_args else ""
                    return f"DROP PROCEDURE IF EXISTS {tbl_qualified}{args_clause} CASCADE;"
                return f"DROP PROCEDURE IF EXISTS {tbl_qualified};"
            elif norm_type == "function":
                if engine == "postgresql":
                    args_clause = f"({identity_args})" if identity_args else ""
                    return f"DROP FUNCTION IF EXISTS {tbl_qualified}{args_clause} CASCADE;"
                return f"DROP FUNCTION IF EXISTS {tbl_qualified};"
            elif norm_type == "trigger":
                if engine == "postgresql":
                    # In Postgres, DROP TRIGGER requires ON table
                    return f'DROP TRIGGER IF EXISTS {quote_ident(raw_name, engine)} ON {tbl_qualified};'
                return f"DROP TRIGGER IF EXISTS {tbl_qualified};"
            elif norm_type == "sequence":
                return f"DROP SEQUENCE IF EXISTS {tbl_qualified};" if engine == "sqlserver" else f"DROP SEQUENCE IF EXISTS {tbl_qualified} CASCADE;"
            elif norm_type == "synonym":
                return f"DROP SYNONYM IF EXISTS {tbl_qualified};"
            elif norm_type == "type":
                return f"DROP TYPE IF EXISTS {tbl_qualified};" if engine == "sqlserver" else f"DROP TYPE IF EXISTS {tbl_qualified} CASCADE;"
            else:
                return f"DROP {norm_type.upper()} IF EXISTS {tbl_qualified};"

        # ── ACTION: CREATE ────────────────────────────────────────────────────────
        if act == "CREATE":
            if norm_type == "table":
                # Use TableDesignerService if metadata exists
                try:
                    meta = self.get_table_design_metadata(database, effective_schema, raw_name)
                    if meta and isinstance(meta, dict) and meta.get("columns"):
                        meta["engine"] = engine
                        meta["schema"] = effective_schema
                        meta["table"] = raw_name
                        ddl = TableDesignerService.generate_create_table_ddl(meta)
                        if ddl and ddl.strip():
                            return ddl.strip() + "\n"
                except Exception:
                    pass

                # Fallback from column list
                cols = self._get_columns_for_object(database, effective_schema, raw_name, norm_type)
                if cols:
                    col_defs = []
                    pk_cols = []
                    for c in cols:
                        col_name = quote_ident(c["name"], engine)
                        type_str = c.get("type", "varchar(100)").upper()
                        null_str = "NOT NULL" if not c.get("nullable", True) or c.get("is_pk") else "NULL"
                        col_defs.append(f"    {col_name} {type_str} {null_str}")
                        if c.get("is_pk"):
                            pk_cols.append(col_name)
                    if pk_cols:
                        pk_name = quote_ident(f"PK_{raw_name}", engine)
                        col_defs.append(f"    CONSTRAINT {pk_name} PRIMARY KEY ({', '.join(pk_cols)})")
                    return f"CREATE TABLE {tbl_qualified} (\n" + ",\n".join(col_defs) + "\n);\n"
                return f"-- Definition for table {tbl_qualified} could not be retrieved automatically.\n"

            # For view, procedure, function, trigger, sequence, synonym, type: fetch definition
            defn = self.get_object_definition(database, effective_schema, raw_name, norm_type)
            if not defn or not str(defn).strip():
                if pure_name != raw_name:
                    defn = self.get_object_definition(database, effective_schema, pure_name, norm_type)

            if defn and str(defn).strip():
                sql = str(defn).strip()
                # SQL Server: standardize ALTER or CREATE OR ALTER to CREATE for CREATE action
                if engine == "sqlserver":
                    if re.match(r"^\s*CREATE\s+OR\s+ALTER\b", sql, re.IGNORECASE):
                        sql = re.sub(r"^\s*CREATE\s+OR\s+ALTER\b", "CREATE", sql, count=1, flags=re.IGNORECASE)
                    elif re.match(r"^\s*ALTER\b", sql, re.IGNORECASE):
                        sql = re.sub(r"^\s*ALTER\b", "CREATE", sql, count=1, flags=re.IGNORECASE)
                return sql + "\n"

            return f"-- Definition for {norm_type} {tbl_qualified} could not be retrieved automatically.\n"

        # ── ACTION: ALTER ─────────────────────────────────────────────────────────
        if act == "ALTER":
            if norm_type in ("view", "procedure", "function", "trigger"):
                defn = self.get_object_definition(database, effective_schema, raw_name, norm_type)
                if not defn or not str(defn).strip():
                    if pure_name != raw_name:
                        defn = self.get_object_definition(database, effective_schema, pure_name, norm_type)

                if defn and str(defn).strip():
                    sql = str(defn).strip()
                    if engine == "sqlserver":
                        if re.match(r"^\s*CREATE\s+OR\s+ALTER\b", sql, re.IGNORECASE):
                            pass  # already CREATE OR ALTER
                        elif re.match(r"^\s*CREATE\b", sql, re.IGNORECASE):
                            sql = re.sub(r"^\s*CREATE\b", "CREATE OR ALTER", sql, count=1, flags=re.IGNORECASE)
                        elif re.match(r"^\s*ALTER\b", sql, re.IGNORECASE):
                            sql = re.sub(r"^\s*ALTER\b", "CREATE OR ALTER", sql, count=1, flags=re.IGNORECASE)
                    elif engine == "postgresql":
                        if norm_type in ("view", "procedure", "function"):
                            if re.match(r"^\s*CREATE\s+OR\s+REPLACE\b", sql, re.IGNORECASE):
                                pass
                            elif re.match(r"^\s*CREATE\b", sql, re.IGNORECASE):
                                sql = re.sub(r"^\s*CREATE\b", "CREATE OR REPLACE", sql, count=1, flags=re.IGNORECASE)
                        elif norm_type == "materialized_view":
                            sql = f"-- In PostgreSQL, to alter a materialized view definition, drop and recreate:\nDROP MATERIALIZED VIEW IF EXISTS {tbl_qualified};\n\n{sql}"
                        elif norm_type == "trigger":
                            sql = f"-- In PostgreSQL, triggers are altered by replacing the trigger function or DROP/CREATE:\n{sql}"
                    return sql + "\n"

            if norm_type == "table":
                new_col = quote_ident("NewColumn", engine)
                return (
                    f"-- Template to alter table {tbl_qualified}\n"
                    f"ALTER TABLE {tbl_qualified}\n"
                    f"    ADD {new_col} VARCHAR(100) NULL;\n"
                )

            return f"-- ALTER script for {norm_type} {tbl_qualified} not available.\n"

        # ── ACTION: DROP_AND_CREATE ───────────────────────────────────────────────
        if act in ("DROP_AND_CREATE", "DROP_CREATE"):
            drop_stmt = self.script_object(database, effective_schema, raw_name, norm_type, action="DROP")
            create_stmt = self.script_object(database, effective_schema, raw_name, norm_type, action="CREATE")
            if engine == "sqlserver":
                return f"{drop_stmt}\nGO\n\n{create_stmt}\nGO\n"
            else:
                return f"{drop_stmt}\n\n{create_stmt}"

        # ── ACTION: SELECT ────────────────────────────────────────────────────────
        if act == "SELECT":
            cols = self._get_columns_for_object(database, effective_schema, raw_name, norm_type)
            if cols:
                col_list = ",\n    ".join(quote_ident(c["name"], engine) for c in cols)
            else:
                col_list = "    *"

            if engine == "sqlserver":
                return (
                    f"SELECT TOP (1000)\n"
                    f"    {col_list}\n"
                    f"FROM {tbl_qualified};\n"
                )
            else:
                return (
                    f"SELECT\n"
                    f"    {col_list}\n"
                    f"FROM {tbl_qualified}\n"
                    f"LIMIT 1000;\n"
                )

        # ── ACTION: INSERT ────────────────────────────────────────────────────────
        if act == "INSERT":
            cols = self._get_columns_for_object(database, effective_schema, raw_name, norm_type)
            # Filter out identity / auto-increment columns if identifiable
            insert_cols = [
                c for c in cols
                if not c.get("is_identity") and str(c.get("type", "")).lower() not in ("serial", "bigserial", "smallserial")
            ]
            if not insert_cols and cols:
                insert_cols = cols

            if insert_cols:
                col_list = ",\n    ".join(quote_ident(c["name"], engine) for c in insert_cols)
                val_list = ",\n    ".join(
                    f"<{quote_ident(c['name'], engine)}, {c.get('type', 'value')}, {'NULL' if c.get('nullable', True) else 'NOT NULL'}>"
                    for c in insert_cols
                )
            else:
                col_list = "    <Column1>,\n    <Column2>"
                val_list = "    <Value1>,\n    <Value2>"

            return (
                f"INSERT INTO {tbl_qualified} (\n"
                f"    {col_list}\n"
                f")\n"
                f"VALUES (\n"
                f"    {val_list}\n"
                f");\n"
            )

        # ── ACTION: UPDATE ────────────────────────────────────────────────────────
        if act == "UPDATE":
            cols = self._get_columns_for_object(database, effective_schema, raw_name, norm_type)
            pk_cols = [c for c in cols if c.get("is_pk")]
            if not pk_cols and cols:
                # heuristic: look for 'id' column
                id_col = next((c for c in cols if c.get("name", "").lower() in ("id", f"{raw_name.lower()}_id")), None)
                if id_col:
                    pk_cols = [id_col]

            upd_cols = [c for c in cols if c not in pk_cols] if cols else []
            if not upd_cols and cols:
                upd_cols = cols

            if upd_cols:
                set_list = ",\n    ".join(
                    f"{quote_ident(c['name'], engine)} = <{c['name']}, {c.get('type', 'value')}>"
                    for c in upd_cols
                )
            else:
                set_list = "    <Column1> = <Value1>"

            if pk_cols:
                where_clause = " AND ".join(
                    f"{quote_ident(pk['name'], engine)} = <{pk['name']}, {pk.get('type', 'value')}>"
                    for pk in pk_cols
                )
            elif cols:
                where_clause = f"<Search Conditions,, {quote_ident(cols[0]['name'], engine)} = value>"
            else:
                where_clause = "<Search Conditions,,>"

            return (
                f"UPDATE {tbl_qualified}\n"
                f"SET\n"
                f"    {set_list}\n"
                f"WHERE {where_clause};\n"
            )

        # ── ACTION: DELETE ────────────────────────────────────────────────────────
        if act == "DELETE":
            cols = self._get_columns_for_object(database, effective_schema, raw_name, norm_type)
            pk_cols = [c for c in cols if c.get("is_pk")]
            if not pk_cols and cols:
                id_col = next((c for c in cols if c.get("name", "").lower() in ("id", f"{raw_name.lower()}_id")), None)
                if id_col:
                    pk_cols = [id_col]

            if pk_cols:
                where_clause = " AND ".join(
                    f"{quote_ident(pk['name'], engine)} = <{pk['name']}, {pk.get('type', 'value')}>"
                    for pk in pk_cols
                )
            elif cols:
                where_clause = f"<Search Conditions,, {quote_ident(cols[0]['name'], engine)} = value>"
            else:
                where_clause = "<Search Conditions,,>"

            return (
                f"DELETE FROM {tbl_qualified}\n"
                f"WHERE {where_clause};\n"
            )

        # ── ACTION: EXECUTE ───────────────────────────────────────────────────────
        if act in ("EXECUTE", "EXEC"):
            params = []
            try:
                raw_params = self.get_intellisense_parameters(database, effective_schema, raw_name)
                if not (isinstance(raw_params, list) and len(raw_params) > 0) and pure_name != raw_name:
                    raw_params = self.get_intellisense_parameters(database, effective_schema, pure_name)
                if isinstance(raw_params, list) and len(raw_params) > 0:
                    params = raw_params
            except Exception:
                pass

            if engine == "sqlserver":
                if params:
                    p_lines = []
                    for p in params:
                        p_name = p.get("name") or "@param"
                        p_type = p.get("type") or "varchar"
                        p_lines.append(f"    {p_name} = <{p_name}, {p_type}>")
                    param_str = ",\n".join(p_lines)
                    return f"EXEC {tbl_qualified}\n{param_str};\n"
                return f"EXEC {tbl_qualified};\n"
            else:
                if params:
                    val_placeholders = ", ".join(f"<{p.get('name', 'param')}, {p.get('type', 'val')}>" for p in params)
                elif identity_args:
                    val_placeholders = ", ".join(f"<{arg.strip()}>" for arg in identity_args.split(","))
                else:
                    val_placeholders = ""
                keyword = "SELECT" if norm_type == "function" else "CALL"
                return f"{keyword} {tbl_qualified}({val_placeholders});\n"

        raise ValueError(f"Unsupported action: '{action}' for object '{raw_name}' ({object_type})")


