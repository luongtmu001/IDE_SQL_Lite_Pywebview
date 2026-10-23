# -*- coding: utf-8 -*-
"""
Metadata & Object Explorer API Mixins.
Handles database schemas, objects, intellisense metadata, linked servers,
Postgres dependency graph, and SQL object search.
"""
import logging

logger = logging.getLogger("luobtool.api.metadata")


class MetadataApiMixin:
    def get_databases(self, connection_id, search=None, accessible_only=False):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_databases(accessible_only=accessible_only)
            if search:
                s = search.strip().lower()
                items = [d for d in items if s in (d.get("name", d) if isinstance(d, dict) else str(d)).lower()]
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_schemas(self, connection_id, database=None, search=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_schemas(database)
            if search:
                s = search.strip().lower()
                items = [x for x in items if s in (x.get("name", x) if isinstance(x, dict) else str(x)).lower()]
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_objects(self, connection_id, database=None, schema=None, type="tables", search=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_objects(database, schema, type, search)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def refresh_metadata(self, connection_id, database=None, schema=None, type=None):
        try:
            conn = self._get_connection(connection_id)
            conn.metadata_service.invalidate(database=database, schema=schema, object_type=type)
            try:
                from app.database.syntax.semantic_analyzer import invalidate_physical_table_columns_cache
                invalidate_physical_table_columns_cache(connection_id, database, schema)
            except Exception:
                pass
            return {"success": True, "message": "Metadata cache invalidated successfully"}
        except Exception as exc:
            logger.exception("Failed to refresh metadata: %s", exc)
            return {"success": False, "error": str(exc)}


    def get_definition(self, connection_id, database=None, schema=None, name=None, type=None):
        try:
            conn = self._get_connection(connection_id)
            val = conn.metadata_service.get_object_definition(database, schema, name, type)
            return {"success": True, "definition": val}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def script_object(self, connection_id, database=None, schema=None, name=None, type="table", action="CREATE"):
        """Generates DDL/DML script for an object (CREATE, ALTER, DROP, SELECT, INSERT, UPDATE, DELETE)."""
        try:
            conn = self._get_connection(connection_id)
            script = conn.metadata_service.script_object(
                database=database,
                schema=schema,
                name=name,
                object_type=type,
                action=action,
            )
            return {"success": True, "script": script}
        except Exception as exc:
            logger.exception("Error scripting object %s.%s: %s", schema, name, exc)
            return {"success": False, "error": str(exc)}


    def get_object_children(self, connection_id, database=None, schema=None, name=None, type=None, child_type=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_object_children(database, schema, name, type, child_type)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_intellisense_objects(self, connection_id, database=None, schema=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.get_intellisense_objects(database, schema)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_intellisense_columns(self, connection_id, database=None, schema=None, table=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.get_intellisense_columns(database, schema, table)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_intellisense_parameters(self, connection_id, database=None, schema=None, name=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.get_intellisense_parameters(database, schema, name)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_intellisense_types(self, connection_id, database=None):
        try:
            conn = self._get_connection(connection_id)
            types_info = conn.metadata_service.get_supported_types(database=database)
            return {
                "success": True,
                "types": types_info.get("types", []),
                "user_types": types_info.get("user_types", []),
                "engine": types_info.get("engine", "")
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_foreign_keys(self, connection_id, database=None, schema=None, table=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.get_foreign_keys(database, schema, table)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_linked_servers(self, connection_id):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_linked_servers()
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_remote_databases(self, connection_id, server):
        try:
            if not server:
                return {"success": False, "error": "Parameter 'server' is required"}
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_remote_databases(server)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_remote_schemas(self, connection_id, server, database=None):
        try:
            if not server:
                return {"success": False, "error": "Parameter 'server' is required"}
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_remote_schemas(server, database)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_remote_objects(self, connection_id, server, database=None, schema=None):
        try:
            if not server:
                return {"success": False, "error": "Parameter 'server' is required"}
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_remote_objects(server, database, schema)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_remote_columns(self, connection_id, server, database=None, schema=None, table=None):
        try:
            if not server or not table:
                return {"success": False, "error": "Parameters 'server' and 'table' are required"}
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_remote_columns(server, database, schema, table)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def test_linked_server(self, connection_id, server):
        try:
            if not server:
                return {"success": False, "error": "Parameter 'server' is required"}
            conn = self._get_connection(connection_id)
            if hasattr(conn.adapter, "test_linked_server"):
                res = conn.adapter.test_linked_server(server)
                return res
            return {"success": False, "error": "Operation test_linked_server not supported for this database type"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_linked_server_script(self, connection_id, server, mode="create"):
        try:
            if not server:
                return {"success": False, "error": "Parameter 'server' is required"}
            conn = self._get_connection(connection_id)
            if hasattr(conn.adapter, "get_linked_server_script"):
                script = conn.adapter.get_linked_server_script(server, mode=mode)
                return {"success": True, "script": script}
            return {"success": False, "error": "Operation get_linked_server_script not supported for this database type"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def drop_linked_server(self, connection_id, server):
        try:
            if not server:
                return {"success": False, "error": "Parameter 'server' is required"}
            conn = self._get_connection(connection_id)
            if hasattr(conn.adapter, "drop_linked_server"):
                res = conn.adapter.drop_linked_server(server)
                if res.get("success"):
                    if hasattr(conn, "metadata_service"):
                        conn.metadata_service.invalidate(server=server)
                        conn.metadata_service.session.metadata_cache.pop(
                            conn.metadata_service._cache_key("linked_servers"), None
                        )
                return res
            return {"success": False, "error": "Operation drop_linked_server not supported for this database type"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_foreign_servers(self, connection_id):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_foreign_servers()
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_foreign_tables(self, connection_id, schema=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_foreign_tables(schema=schema)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}



class MainMetadataApiMixin:
    def get_tables(self, connection_id, database=None, schema=None, search=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_tables(database, schema)
            if search:
                s = search.strip().lower()
                items = [t for t in items if s in (t.get("name", t) if isinstance(t, dict) else str(t)).lower()]
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_table_columns(self, connection_id, database=None, schema=None, table_name=None):
        try:
            conn = self._get_connection(connection_id)
            items = conn.metadata_service.list_columns(table_name, database, schema)
            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_table_designer_metadata(self, connection_id, database=None, schema=None, table_name=None):
        return self.get_table_design(connection_id, database, schema, table_name)


    def pg_dependency_get_column(self, conn_id, schema, table, column, direction="dependents", depth=2, database=None, include_source=True):
        try:
            conn = self._get_connection(conn_id)
            if not conn and hasattr(self, 'cm') and self.cm:
                active_list = self.cm.list(self.owner_session_id)
                pg_conns = [c for c in active_list if (c.config.get("type") or "").lower() == "postgresql"]
                if pg_conns:
                    conn = pg_conns[0]
                elif active_list:
                    conn = active_list[0]
            if not conn or not conn.adapter:
                return {"success": False, "error": "Connection not found"}
            db_type = (conn.config.get("type") or getattr(conn.adapter, "db_type", "") or "").lower()
            if db_type != "postgresql":
                return {"success": False, "error": "PostgreSQL Dependency Graph is exclusively supported for PostgreSQL connections."}
            from app.services.postgres_dependency import PostgresDependencyService
            service = PostgresDependencyService(conn.adapter)
            graph = service.get_column_graph(
                schema=schema or "public",
                table_name=table,
                column_name=column,
                direction=direction or "dependents",
                depth_limit=int(depth or 2),
                database=database,
                include_source_analysis=bool(include_source)
            )
            return {
                "success": True,
                "graph": graph.to_dict(),
                "tree": graph.to_tree_projection()
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def pg_dependency_get_object(self, conn_id, obj_type, schema, name, direction="dependents", depth=2, database=None):
        try:
            conn = self._get_connection(conn_id)
            if not conn and hasattr(self, 'cm') and self.cm:
                active_list = self.cm.list(self.owner_session_id)
                pg_conns = [c for c in active_list if (c.config.get("type") or "").lower() == "postgresql"]
                if pg_conns:
                    conn = pg_conns[0]
                elif active_list:
                    conn = active_list[0]
            if not conn or not conn.adapter:
                return {"success": False, "error": "Connection not found"}
            db_type = (conn.config.get("type") or getattr(conn.adapter, "db_type", "") or "").lower()
            if db_type != "postgresql":
                return {"success": False, "error": "PostgreSQL Dependency Graph is exclusively supported for PostgreSQL connections."}
            from app.services.postgres_dependency import PostgresDependencyService
            service = PostgresDependencyService(conn.adapter)
            graph = service.get_object_graph(
                obj_type_str=obj_type or "view",
                schema=schema or "public",
                name=name,
                direction=direction or "dependents",
                depth_limit=int(depth or 2),
                database=database
            )
            return {
                "success": True,
                "graph": graph.to_dict(),
                "tree": graph.to_tree_projection()
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def pg_dependency_get_definition(self, conn_id, obj_type, schema, name, oid=None, database=None):
        try:
            conn = self._get_connection(conn_id)
            if not conn and hasattr(self, 'cm') and self.cm:
                active_list = self.cm.list(self.owner_session_id)
                pg_conns = [c for c in active_list if (c.config.get("type") or "").lower() == "postgresql"]
                if pg_conns:
                    conn = pg_conns[0]
                elif active_list:
                    conn = active_list[0]
            if not conn or not conn.adapter:
                return {"success": False, "error": "Connection not found"}
            from app.services.postgres_dependency import PostgresDependencyService
            service = PostgresDependencyService(conn.adapter)
            oid_int = int(oid) if oid and str(oid).isdigit() else None
            defn = service.get_object_definition(
                obj_type_str=obj_type or "view",
                schema=schema or "public",
                name=name,
                oid=oid_int,
                database=database
            )
            if not defn:
                return {"success": False, "error": f"Definition not found for {schema}.{name}"}
            return {
                "success": True,
                "object_type": obj_type,
                "schema": schema,
                "name": name,
                "definition": defn
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def pg_dependency_get_suggested_steps(self, conn_id, schema, table, column, action="ALTER", database=None):
        try:
            conn = self._get_connection(conn_id)
            if not conn and hasattr(self, 'cm') and self.cm:
                active_list = self.cm.list(self.owner_session_id)
                pg_conns = [c for c in active_list if (c.config.get("type") or "").lower() == "postgresql"]
                if pg_conns:
                    conn = pg_conns[0]
                elif active_list:
                    conn = active_list[0]
            if not conn or not conn.adapter:
                return {"success": False, "error": "Connection not found"}
            from app.services.postgres_dependency import PostgresDependencyService
            service = PostgresDependencyService(conn.adapter)
            steps = service.get_suggested_steps(
                schema=schema or "public",
                table=table,
                column=column,
                action=action or "ALTER",
                database=database
            )
            return {
                "success": True,
                "action": action,
                "target": f"{schema}.{table}.{column}",
                "steps": steps
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def sql_object_search(self, conn_id=None, keyword="", database=None, object_types=None, case_sensitive=False, whole_word=False, is_regex=False, schema=None):
        try:
            conn = None
            if conn_id:
                conn = self._get_connection(conn_id)
            if not conn and hasattr(self, 'cm') and self.cm:
                active_list = self.cm.list(self.owner_session_id)
                if active_list:
                    conn = active_list[0]
            if not conn or not conn.adapter:
                return {"success": False, "error": "Database connection is unavailable."}

            from app.services.object_search_service import ObjectSearchService
            service = ObjectSearchService(conn.adapter)
            return service.search(
                keyword=keyword,
                database=database,
                object_types=object_types,
                case_sensitive=bool(case_sensitive),
                whole_word=bool(whole_word),
                is_regex=bool(is_regex),
                schema=schema
            )
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def sql_object_ddl(self, conn_id=None, schema="dbo", name="", object_type="VIEW", database=None, keyword=None, case_sensitive=False, whole_word=False, is_regex=False):
        try:
            conn = None
            if conn_id:
                conn = self._get_connection(conn_id)
            if not conn and hasattr(self, 'cm') and self.cm:
                active_list = self.cm.list(self.owner_session_id)
                if active_list:
                    conn = active_list[0]
            if not conn or not conn.adapter:
                return {"success": False, "error": "Database connection is unavailable."}

            from app.services.object_search_service import ObjectSearchService
            service = ObjectSearchService(conn.adapter)
            return service.get_ddl(
                schema=schema,
                name=name,
                object_type=object_type,
                database=database,
                keyword=keyword,
                case_sensitive=bool(case_sensitive),
                whole_word=bool(whole_word),
                is_regex=bool(is_regex)
            )
        except Exception as exc:
            return {"success": False, "error": str(exc)}

