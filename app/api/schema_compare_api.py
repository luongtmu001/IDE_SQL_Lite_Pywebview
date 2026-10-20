# -*- coding: utf-8 -*-
"""
Schema Compare API Mixin.
Exposes database schema comparison, snapshotting, and DDL migration script generation
to pywebview desktop bridges and frontend API dispatchers.
"""
import logging
from typing import Any, Dict, List, Optional, Union
from app.services.schema_compare_service import SchemaCompareService

logger = logging.getLogger("luobtool.api.schema_compare")


class SchemaCompareApiMixin:
    """API mixin for Schema Comparison and DDL Sync."""

    def schema_compare_get_connections(self) -> Dict[str, Any]:
        """
        Returns a list of all active connections and saved profiles suitable for schema comparison.
        """
        try:
            results = []
            active_ids = set()
            active_names = set()
            import re

            # 1. Active connections
            with self.cm._lock:
                for cid, conn in self.cm._connections.items():
                    cid_str = str(cid).strip().lower()
                    active_ids.add(cid_str)
                    cfg = getattr(conn, "config", {}) or {}
                    cfg_id = cfg.get("id")
                    if cfg_id:
                        active_ids.add(str(cfg_id).strip().lower())
                    cname = cfg.get("name") or cid
                    if cname:
                        cname_str = str(cname).strip().lower()
                        active_names.add(cname_str)
                        clean_cname = re.sub(r"\s*\([^)]*\)$", "", cname_str).strip().lower()
                        active_names.add(clean_cname)

                    db_type = getattr(conn.adapter, "db_type", cfg.get("type", "sqlserver"))
                    results.append({
                        "id": cid,
                        "name": cfg.get("name") or cid,
                        "db_type": db_type,
                        "database": getattr(conn.adapter, "database", cfg.get("database", "")) or cfg.get("default_database", ""),
                        "schema": cfg.get("schema") or getattr(conn.adapter, "default_schema", getattr(conn.adapter, "schema", "")) or cfg.get("default_schema", "") or "",
                        "server": cfg.get("server") or cfg.get("host") or "",
                        "is_active": True
                    })

            # 2. Saved profiles that are not yet active
            try:
                from app.services.settings_store import (
                    CONNECTIONS_FILE,
                    read_json,
                    get_saved_connections as load_saved_connections,
                )
                profiles = load_saved_connections(filter_groups=False) or []
                for p in profiles:
                    if not p or p.get("type") == "group_marker" or str(p.get("name", "")).startswith("__group__"):
                        continue
                    pid = p.get("id") or p.get("name")
                    pname = p.get("name") or pid
                    pid_str = str(pid).strip().lower()
                    pname_str = str(pname).strip().lower()
                    clean_name = re.sub(r"\s*\([^)]*\)$", "", pname_str).strip().lower()
                    if pid_str in active_ids or pid_str in active_names or pname_str in active_names or clean_name in active_names:
                        continue
                    results.append({
                        "id": pid,
                        "name": pname,
                        "db_type": p.get("type", "sqlserver"),
                        "database": p.get("database", "") or p.get("default_database", ""),
                        "schema": p.get("schema", "") or p.get("default_schema", ""),
                        "server": p.get("server") or p.get("host") or "",
                        "is_active": False
                    })
            except Exception as e:
                logger.debug("Could not load saved profiles: %s", e)

            return {"success": True, "connections": results}
        except Exception as exc:
            logger.exception("Error in schema_compare_get_connections: %s", exc)
            return {"success": False, "error": str(exc), "connections": []}

    def _resolve_connection(self, connection_id: str) -> Optional[Any]:
        """
        Resolves a connection object by connection_id or name.
        If the connection is a saved profile that is not currently active,
        automatically establishes a runtime connection with decrypted credentials.
        """
        self._last_resolve_error = None
        if not connection_id or str(connection_id).lower() in ("undefined", "null", "none"):
            return None

        raw_id = str(connection_id).strip()
        import re
        clean_target = re.sub(r"\s*\([^)]*\)$", "", raw_id).strip().lower()

        # 1. Check existing in-memory active connections (MATCH EXACTLY, NO ARBITRARY FALLBACK)
        with self.cm._lock:
            # Check by exact connection_id key
            conn = self.cm._connections.get(raw_id)
            if conn and getattr(conn, "is_alive", lambda: True)():
                return conn

            # Check by config id or name
            for c in self.cm._connections.values():
                cfg = getattr(c, "config", {}) or {}
                cid = str(cfg.get("id") or getattr(c, "connection_id", "")).strip()
                cname = str(cfg.get("name") or "").strip()
                c_clean = re.sub(r"\s*\([^)]*\)$", "", cname).strip().lower()

                if cid == raw_id or cname.lower() == raw_id.lower() or (c_clean and c_clean == clean_target):
                    if getattr(c, "is_alive", lambda: True)():
                        return c

        # 2. Search saved profiles to auto-connect
        try:
            from app.services.settings_store import (
                get_saved_connections as load_saved_connections,
            )
            from app.utils.crypto import decrypt_password

            saved = load_saved_connections(filter_groups=False) or []
            target_profile = None

            for p in saved:
                if not p or p.get("type") == "group_marker":
                    continue
                pid = str(p.get("id") or "").strip()
                pname = str(p.get("name") or "").strip()
                pclean = re.sub(r"\s*\([^)]*\)$", "", pname).strip().lower()

                if pid == raw_id or pname.lower() == raw_id.lower() or (pclean and pclean == clean_target):
                    target_profile = dict(p)
                    break

            if target_profile:
                cfg = dict(target_profile)
                if cfg.get("password") and not cfg.get("trusted_connection"):
                    try:
                        cfg["password"] = decrypt_password(cfg["password"])
                    except Exception as dec_err:
                        logger.warning("Failed to decrypt password for auto-connect: %s", dec_err)
                conn, _ = self.cm.create_or_get(self.owner_session_id, cfg)
                return conn
        except Exception as exc:
            self._last_resolve_error = str(exc)
            logger.exception("Failed to auto-resolve connection '%s': %s", connection_id, exc)

        return None

    def schema_compare_get_schemas(self, connection_id: str, database: Optional[str] = None) -> Dict[str, Any]:
        """
        Returns available databases and schemas for the given connection.
        Verifies connection health and returns default database and schema.
        """
        try:
            conn = self._resolve_connection(connection_id)
            if not conn:
                err_msg = getattr(self, "_last_resolve_error", None) or f"Không tìm thấy hoặc không thể kết nối tới: {connection_id}"
                return {"success": False, "error": err_msg}

            adapter = conn.adapter
            databases = []
            schemas = []

            cfg = getattr(conn, "config", {}) or {}
            saved_default_db = cfg.get("database") or cfg.get("default_database") or getattr(adapter, "database", None) or ""
            saved_default_schema = cfg.get("schema") or cfg.get("default_schema") or getattr(adapter, "default_schema", None) or getattr(adapter, "schema", None) or ""

            try:
                raw_dbs = adapter.list_databases()
                databases = [d.get("name") if isinstance(d, dict) else str(d) for d in raw_dbs]
            except Exception as e:
                logger.warning("Failed to list databases: %s", e)
                return {"success": False, "error": f"Lỗi kết nối khi tải danh sách Database: {e}"}

            selected_db = database or saved_default_db or (databases[0] if databases else "main")
            if databases and selected_db not in databases:
                match_db = next((d for d in databases if d.lower() == str(selected_db).lower()), None)
                if match_db:
                    selected_db = match_db
                elif databases:
                    selected_db = databases[0]

            try:
                db_type = getattr(adapter, "db_type", "sqlserver")
                if db_type == "postgresql" and database and database != getattr(adapter, "database", None):
                    try:
                        from app.database.postgresql import PostgreSQLAdapter
                        tmp_cfg = dict(getattr(adapter, "config", {}))
                        tmp_cfg["database"] = selected_db
                        tmp_cfg["dbname"] = selected_db
                        tmp_adapter = PostgreSQLAdapter(tmp_cfg)
                        tmp_adapter.connect()
                        raw_schemas = tmp_adapter.list_schemas()
                        schemas = [s.get("name") if isinstance(s, dict) else str(s) for s in raw_schemas]
                        tmp_adapter.close()
                    except Exception as pg_err:
                        logger.debug("Failed to list schemas for postgresql db %s: %s", selected_db, pg_err)
                        raw_schemas = adapter.list_schemas(selected_db)
                        schemas = [s.get("name") if isinstance(s, dict) else str(s) for s in raw_schemas]
                else:
                    raw_schemas = adapter.list_schemas(selected_db)
                    schemas = [s.get("name") if isinstance(s, dict) else str(s) for s in raw_schemas]
            except Exception as e:
                logger.debug("Failed to list schemas for db %s: %s", selected_db, e)
                schemas = []

            return {
                "success": True,
                "databases": databases,
                "schemas": schemas,
                "current_database": selected_db,
                "default_database": saved_default_db,
                "default_schema": saved_default_schema,
                "db_type": getattr(adapter, "db_type", "sqlserver")
            }
        except Exception as exc:
            logger.exception("Error in schema_compare_get_schemas: %s", exc)
            return {"success": False, "error": str(exc)}

    def schema_compare_connect_direct(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Creates an ad-hoc runtime connection directly without requiring a saved profile.
        Returns connection details, available databases, and schemas.
        """
        try:
            cfg = dict(config or {})
            raw_type = (cfg.get("type") or "sqlserver").lower()
            if raw_type in ("mssql", "sqlserver", "tsql"):
                cfg["type"] = "sqlserver"
            elif raw_type in ("postgres", "postgresql", "pgsql"):
                cfg["type"] = "postgresql"
            elif raw_type == "sqlite":
                cfg["type"] = "sqlite"

            # Auto-assign a recognizable direct connection name
            if not cfg.get("name"):
                target_label = cfg.get("database") or cfg.get("server") or cfg.get("host") or "Adhoc"
                cfg["name"] = f"[Trực tiếp] {target_label} ({cfg['type']})"

            # If sqlite and file_path provided, ensure database key matches
            if cfg["type"] == "sqlite":
                if not cfg.get("database") and cfg.get("file_path"):
                    cfg["database"] = cfg["file_path"]
                if not cfg.get("database"):
                    return {"success": False, "error": "Đường dẫn file SQLite không được để trống."}

            conn, _ = self.cm.create_or_get(self.owner_session_id, cfg)
            adapter = conn.adapter

            databases = []
            schemas = []
            try:
                raw_dbs = adapter.list_databases()
                databases = [d.get("name") if isinstance(d, dict) else str(d) for d in raw_dbs]
            except Exception as e:
                logger.debug("Direct conn list_databases error: %s", e)

            selected_db = getattr(adapter, "database", None) or (databases[0] if databases else "main")
            try:
                raw_schemas = adapter.list_schemas(selected_db)
                schemas = [s.get("name") if isinstance(s, dict) else str(s) for s in raw_schemas]
            except Exception as e:
                logger.debug("Direct conn list_schemas error: %s", e)

            return {
                "success": True,
                "connection": {
                    "id": conn.connection_id,
                    "name": cfg["name"],
                    "db_type": getattr(adapter, "db_type", cfg["type"]),
                    "database": selected_db,
                    "server": cfg.get("server") or cfg.get("host") or "",
                    "is_active": True,
                    "is_direct": True
                },
                "databases": databases,
                "schemas": schemas,
                "current_database": selected_db
            }
        except Exception as exc:
            logger.exception("Error in schema_compare_connect_direct: %s", exc)
            return {"success": False, "error": str(exc)}

    def schema_compare_cancel(self) -> Dict[str, Any]:
        """
        Cancels an ongoing schema comparison run.
        """
        try:
            if not hasattr(self, "_schema_compare_cancel_event") or self._schema_compare_cancel_event is None:
                import threading
                self._schema_compare_cancel_event = threading.Event()
            self._schema_compare_cancel_event.set()
            if hasattr(self, "_active_sc_adapters"):
                for adp in self._active_sc_adapters:
                    try:
                        adp.cancel()
                    except Exception as exc:
                        logger.debug("Error calling adapter.cancel(): %s", exc)
            return {"success": True}
        except Exception as exc:
            logger.exception("Error in schema_compare_cancel: %s", exc)
            return {"success": False, "error": str(exc)}

    def schema_compare_run(
        self,
        source_conn_id: str,
        source_db: str,
        source_schema: str,
        target_conn_id: str,
        target_db: str,
        target_schema: str,
        object_types: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Executes schema snapshot on both Source and Target, and computes comprehensive diff.
        Strictly enforces that Source and Target must be of the same database engine type.
        Supports selective object_types comparison (e.g. ['tables', 'views']).
        Supports cancellation via cancel_event.
        """
        import threading
        self._schema_compare_cancel_event = threading.Event()
        self._active_sc_adapters = []
        try:
            source_conn = self._resolve_connection(source_conn_id)
            if not source_conn:
                return {"success": False, "error": f"Không tìm thấy kết nối Nguồn (Source): {source_conn_id}"}

            target_conn = self._resolve_connection(target_conn_id)
            if not target_conn:
                return {"success": False, "error": f"Không tìm thấy kết nối Đích (Target): {target_conn_id}"}

            src_adapter = source_conn.adapter
            tgt_adapter = target_conn.adapter
            self._active_sc_adapters = [src_adapter, tgt_adapter]

            if self._schema_compare_cancel_event.is_set():
                return {"success": False, "cancelled": True, "error": "Đã hủy tiến trình so sánh."}

            # ENFORCE: Only compare databases of the same type
            src_type = (getattr(src_adapter, "db_type", None) or "").lower()
            tgt_type = (getattr(tgt_adapter, "db_type", None) or "").lower()
            if src_type != tgt_type:
                return {
                    "success": False,
                    "error": f"Chỉ hỗ trợ so sánh 2 database cùng loại. Nguồn là '{src_type}', Đích là '{tgt_type}'."
                }

            # Take snapshots (honoring selective object_types & cancellation)
            source_snap = SchemaCompareService.snapshot(
                src_adapter, database=source_db, schema=source_schema,
                cancel_event=self._schema_compare_cancel_event, object_types=object_types
            )
            if self._schema_compare_cancel_event.is_set():
                return {"success": False, "cancelled": True, "error": "Đã hủy tiến trình so sánh."}

            target_snap = SchemaCompareService.snapshot(
                tgt_adapter, database=target_db, schema=target_schema,
                cancel_event=self._schema_compare_cancel_event, object_types=object_types
            )
            if self._schema_compare_cancel_event.is_set():
                return {"success": False, "cancelled": True, "error": "Đã hủy tiến trình so sánh."}

            # Compute difference
            diff_result = SchemaCompareService.diff(source_snap, target_snap)

            if self._schema_compare_cancel_event.is_set():
                return {"success": False, "cancelled": True, "error": "Đã hủy tiến trình so sánh."}

            # Generate default migration script (excluding destructive drops by default)
            initial_script = SchemaCompareService.generate_migration_script(
                diff_result,
                selected_tables=None,
                options={"include_drop_tables": False, "wrap_transaction": True}
            )

            return {
                "success": True,
                "diff": diff_result,
                "migration_script": initial_script.get("sql", ""),
                "statement_count": initial_script.get("statement_count", 0),
                "summary": diff_result.get("summary", {})
            }
        except Exception as exc:
            if hasattr(self, "_schema_compare_cancel_event") and self._schema_compare_cancel_event.is_set():
                return {"success": False, "cancelled": True, "error": "Đã hủy tiến trình so sánh."}
            logger.exception("Error in schema_compare_run: %s", exc)
            return {"success": False, "error": str(exc)}
        finally:
            self._active_sc_adapters = []

    def schema_compare_generate_script(
        self,
        diff_data: Dict[str, Any],
        selected_tables: Optional[List[str]] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generates or regenerates migration DDL script based on user table selection and options.
        """
        try:
            if not isinstance(diff_data, dict):
                return {"success": False, "error": "diff_data must be a valid comparison dictionary."}

            res = SchemaCompareService.generate_migration_script(
                diff_data,
                selected_tables=selected_tables,
                options=options
            )
            return {
                "success": True,
                "sql": res.get("sql", ""),
                "statement_count": res.get("statement_count", 0),
                "has_destructive": res.get("has_destructive", False),
                "table_count": res.get("table_count", 0)
            }
        except Exception as exc:
            logger.exception("Error in schema_compare_generate_script: %s", exc)
            return {"success": False, "error": str(exc)}

    def open_schema_compare_window(
        self,
        source_conn_id: Optional[str] = None,
        source_db: Optional[str] = None,
        source_schema: Optional[str] = None,
        target_conn_id: Optional[str] = None,
        target_db: Optional[str] = None,
        target_schema: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Opens Schema Compare in an independent desktop window (Pop-out mode).
        """
        try:
            from app.desktop.windows import open_schema_compare_window
            return open_schema_compare_window(
                self,
                source_conn_id=source_conn_id,
                source_db=source_db,
                source_schema=source_schema,
                target_conn_id=target_conn_id,
                target_db=target_db,
                target_schema=target_schema
            )
        except Exception as exc:
            logger.exception("Error opening schema compare window: %s", exc)
            return {"success": False, "error": str(exc)}

    def schema_compare_bravo_layout_list(
        self,
        connection_id: str,
        database: Optional[str] = None,
        platform: str = "Win",
        version: str = "Bravo 10",
        search_term: str = "",
    ) -> Dict[str, Any]:
        """
        Retrieves Bravo Layout metadata grouped by FormName for Schema Compare window.
        """
        try:
            conn = self._resolve_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}

            from app.services.bravo_layout_compare_service import BravoLayoutCompareService
            return BravoLayoutCompareService.get_layout_list(
                conn=conn,
                database=database,
                platform=platform,
                version=version,
                search_term=search_term,
            )
        except Exception as exc:
            logger.exception("Error in schema_compare_bravo_layout_list: %s", exc)
            return {"success": False, "error": str(exc)}

    def schema_compare_bravo_layout_compare(
        self,
        source_connection_id: str,
        target_connection_id: str,
        source_database: Optional[str] = None,
        target_database: Optional[str] = None,
        platform: str = "Win",
        version: str = "Bravo 10",
        search_term: str = "",
    ) -> Dict[str, Any]:
        """
        Compares Bravo Layouts between Source and Target databases.
        """
        try:
            s_conn = self._resolve_connection(source_connection_id)
            if not s_conn:
                return {"success": False, "error": f"Không tìm thấy kết nối Nguồn: {source_connection_id}"}

            t_conn = self._resolve_connection(target_connection_id)
            if not t_conn:
                return {"success": False, "error": f"Không tìm thấy kết nối Đích: {target_connection_id}"}

            from app.services.bravo_layout_compare_service import BravoLayoutCompareService
            return BravoLayoutCompareService.compare_layout_metadata(
                source_conn=s_conn,
                target_conn=t_conn,
                source_database=source_database,
                target_database=target_database,
                platform=platform,
                version=version,
                search_term=search_term,
            )
        except Exception as exc:
            logger.exception("Error in schema_compare_bravo_layout_compare: %s", exc)
            return {"success": False, "error": str(exc)}

    def schema_compare_bravo_layout_pair_detail(
        self,
        source_connection_id: Optional[str] = None,
        target_connection_id: Optional[str] = None,
        source_layout_id: Optional[Union[int, str]] = None,
        target_layout_id: Optional[Union[int, str]] = None,
        source_database: Optional[str] = None,
        target_database: Optional[str] = None,
        platform: str = "Win",
        version: str = "Bravo 10",
    ) -> Dict[str, Any]:
        """
        Retrieves XML payloads from both Source and Target databases for side-by-side comparison.
        """
        try:
            s_conn = self._resolve_connection(source_connection_id) if source_connection_id else None
            t_conn = self._resolve_connection(target_connection_id) if target_connection_id else None

            from app.services.bravo_layout_compare_service import BravoLayoutCompareService
            return BravoLayoutCompareService.get_layout_pair_detail(
                source_conn=s_conn,
                target_conn=t_conn,
                source_layout_id=source_layout_id,
                target_layout_id=target_layout_id,
                source_database=source_database,
                target_database=target_database,
                platform=platform,
                version=version,
            )
        except Exception as exc:
            logger.exception("Error in schema_compare_bravo_layout_pair_detail: %s", exc)
            return {"success": False, "error": str(exc)}

    def schema_compare_bravo_layout_detail(
        self,
        connection_id: str,
        layout_id: Union[int, str],
        database: Optional[str] = None,
        platform: str = "Win",
        version: str = "Bravo 10",
    ) -> Dict[str, Any]:
        """
        Retrieves and decodes LayoutData and LastLayoutData for a specific Layout Id.
        """
        try:
            conn = self._resolve_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}

            from app.services.bravo_layout_compare_service import BravoLayoutCompareService
            return BravoLayoutCompareService.get_layout_detail(
                conn=conn,
                layout_id=layout_id,
                database=database,
                platform=platform,
                version=version,
            )
        except Exception as exc:
            logger.exception("Error in schema_compare_bravo_layout_detail: %s", exc)
            return {"success": False, "error": str(exc)}

    def schema_compare_bravo_layout_generate_script(
        self,
        connection_id: str,
        layout_id: Union[int, str],
        layout_xml: str,
        draft_layout_xml: Optional[str] = None,
        expected_modified_at: Optional[str] = None,
        form_name: str = "",
        layout_name: str = "",
        platform: str = "Win",
        version: str = "Bravo 10",
        database: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generates an atomic transactional SQL UPDATE script adhering to the reference script's rules.
        """
        try:
            conn = self._resolve_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}

            from app.services.bravo_layout_compare_service import BravoLayoutCompareService
            return BravoLayoutCompareService.generate_update_script(
                db_type_or_conn=conn,
                layout_id=layout_id,
                layout_xml=layout_xml,
                draft_layout_xml=draft_layout_xml,
                expected_modified_at=expected_modified_at,
                form_name=form_name,
                layout_name=layout_name,
                platform=platform,
                version=version,
                database=database,
            )
        except Exception as exc:
            logger.exception("Error in schema_compare_bravo_layout_generate_script: %s", exc)
            return {"success": False, "error": str(exc)}

    def schema_compare_bravo_layout_apply_update(
        self,
        connection_id: str,
        layout_id: Union[int, str],
        layout_xml: str,
        draft_layout_xml: Optional[str] = None,
        expected_modified_at: Optional[str] = None,
        database: Optional[str] = None,
        platform: str = "Win",
        version: str = "Bravo 10",
    ) -> Dict[str, Any]:
        """
        Executes atomic per-layout database update within a single transaction with concurrency checks.
        """
        try:
            conn = self._resolve_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}

            from app.services.bravo_layout_compare_service import BravoLayoutCompareService
            return BravoLayoutCompareService.apply_update_layout(
                conn=conn,
                layout_id=layout_id,
                layout_xml=layout_xml,
                draft_layout_xml=draft_layout_xml,
                expected_modified_at=expected_modified_at,
                database=database,
                platform=platform,
                version=version,
            )
        except Exception as exc:
            logger.exception("Error in schema_compare_bravo_layout_apply_update: %s", exc)
            return {"success": False, "error": str(exc)}

