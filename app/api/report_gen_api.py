# -*- coding: utf-8 -*-
"""
Report Layout Generator API Mixin for pywebview desktop bridge.
Exposes rg_* methods on window.pywebview.api.
"""
import base64
import logging
from typing import Any, Dict, List, Optional, Union

from app.services.report_layout_gen import ReportLayoutGenService

logger = logging.getLogger("app.api.report_gen")


class ReportGenApiMixin:
    """API mixin for generating Bravo report layout and datasource XML from Excel."""

    def _get_report_gen_service(self) -> ReportLayoutGenService:
        srv = getattr(self, "_report_gen_service", None)
        if srv is None or srv.connection_manager is None:
            cm = getattr(self, "cm", None) or getattr(self, "connection_manager", None) or getattr(self, "_connection_manager", None)
            srv = ReportLayoutGenService(connection_manager=cm)
            self._report_gen_service = srv
        return srv

    def open_report_gen_window(self, initial_options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Open or focus the Report Layout Generator Wizard window."""
        try:
            from app.desktop.windows import open_report_gen_window
            return open_report_gen_window(self, initial_options=initial_options)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def rg_get_connections(self) -> Dict[str, Any]:
        """
        Returns active connections and saved profiles for SQL Server and PostgreSQL.
        Filters out SQLite since Bravo reports require stored procedures / functions.
        """
        try:
            conns = []
            if hasattr(self, "schema_compare_get_connections"):
                res = self.schema_compare_get_connections()
                conns = res.get("connections", [])
            elif hasattr(self, "cm") and self.cm:
                with self.cm._lock:
                    for cid, conn in self.cm._connections.items():
                        cfg = getattr(conn, "config", {}) or {}
                        db_t = getattr(conn.adapter, "db_type", cfg.get("type", "sqlserver"))
                        conns.append({
                            "id": cid,
                            "name": cfg.get("name") or cid,
                            "db_type": db_t,
                            "database": getattr(conn.adapter, "database", cfg.get("database", "")),
                            "schema": getattr(conn.adapter, "default_schema", cfg.get("schema", "")),
                            "server": cfg.get("server") or cfg.get("host") or "",
                            "is_active": True,
                        })

            filtered = [
                c for c in conns
                if str(c.get("db_type", "")).lower() in ("sqlserver", "postgresql", "postgres")
            ]
            return {"success": True, "connections": filtered}
        except Exception as exc:
            logger.exception("Error in rg_get_connections: %s", exc)
            return {"success": False, "error": str(exc), "connections": []}

    def rg_get_databases(self, connection_id: str) -> Dict[str, Any]:
        """List databases for the specified connection."""
        try:
            if hasattr(self, "schema_compare_get_schemas"):
                sc_res = self.schema_compare_get_schemas(connection_id)
                if sc_res.get("success"):
                    return {
                        "success": True,
                        "connection_id": sc_res.get("connection_id", connection_id),
                        "databases": sc_res.get("databases", []),
                        "default_database": sc_res.get("database"),
                    }
            resolved_id = self._rg_resolve_connection_id(connection_id)
            if hasattr(self, "get_databases"):
                res = self.get_databases(resolved_id)
                items = res.get("items", []) if isinstance(res, dict) else res
                db_names = [d.get("name", d) if isinstance(d, dict) else str(d) for d in items]
                return {"success": True, "databases": db_names}
            return {"success": True, "databases": []}
        except Exception as exc:
            logger.exception("Error in rg_get_databases: %s", exc)
            return {"success": False, "error": str(exc), "databases": []}

    def rg_get_schemas(self, connection_id: str, database: Optional[str] = None) -> Dict[str, Any]:
        """List schemas for the specified connection and database."""
        try:
            if hasattr(self, "schema_compare_get_schemas"):
                sc_res = self.schema_compare_get_schemas(connection_id, database=database)
                if sc_res.get("success"):
                    return {
                        "success": True,
                        "connection_id": sc_res.get("connection_id", connection_id),
                        "database": sc_res.get("database"),
                        "schemas": sc_res.get("schemas", []),
                        "default_schema": sc_res.get("schema"),
                    }
            resolved_id = self._rg_resolve_connection_id(connection_id)
            if hasattr(self, "get_schemas"):
                res = self.get_schemas(resolved_id, database=database)
                items = res.get("items", []) if isinstance(res, dict) else res
                schema_names = [s.get("name", s) if isinstance(s, dict) else str(s) for s in items]
                return {"success": True, "schemas": schema_names}
            return {"success": True, "schemas": ["dbo"]}
        except Exception as exc:
            logger.exception("Error in rg_get_schemas: %s", exc)
            return {"success": False, "error": str(exc), "schemas": ["dbo"]}

    def _rg_resolve_connection_id(self, connection_id: str) -> str:
        """Resolve a connection ID or saved profile name to an active runtime connection ID."""
        if not connection_id:
            return connection_id
        if hasattr(self, "_resolve_connection"):
            try:
                conn = self._resolve_connection(connection_id)
                if conn and hasattr(conn, "connection_id"):
                    return conn.connection_id
            except Exception as exc:
                logger.warning("Failed to auto-resolve connection '%s': %s", connection_id, exc)
        return connection_id

    def _decode_file_content(self, content_or_path: Union[str, bytes]) -> Union[str, bytes]:
        if isinstance(content_or_path, str):
            if content_or_path.startswith("data:") and ";base64," in content_or_path:
                b64_str = content_or_path.split(";base64,")[1]
                return base64.b64decode(b64_str)
            elif len(content_or_path) > 260 and not content_or_path.endswith((".xlsx", ".xlsm")):
                try:
                    return base64.b64decode(content_or_path)
                except Exception:
                    return content_or_path
        return content_or_path

    def rg_open_file(self, content_or_path: Union[str, bytes], filename: Optional[str] = None) -> Dict[str, Any]:
        """
        Open or upload an Excel workbook.
        content_or_path can be an absolute path, base64-encoded string, or raw bytes.
        """
        try:
            data = self._decode_file_content(content_or_path)
            res = self._get_report_gen_service().open_file(data, filename=filename)
            return {"success": True, **res}
        except Exception as exc:
            logger.exception("Error in rg_open_file: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_open_files(self, files: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Open or upload multiple Excel workbooks simultaneously.
        files: list of dicts with keys 'content' (base64 or path) and 'filename'.
        """
        try:
            processed = []
            for f in files:
                c = self._decode_file_content(f.get("content", ""))
                name = f.get("filename")
                processed.append({"content": c, "filename": name})

            res = self._get_report_gen_service().open_files(processed)
            return {"success": True, **res}
        except Exception as exc:
            logger.exception("Error in rg_open_files: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_add_files(self, session_id: str, files: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Add more files to an existing wizard session."""
        try:
            processed = []
            for f in files:
                c = self._decode_file_content(f.get("content", ""))
                name = f.get("filename")
                processed.append({"content": c, "filename": name})

            res = self._get_report_gen_service().add_files(session_id, processed)
            return {"success": True, **res}
        except Exception as exc:
            logger.exception("Error in rg_add_files: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_remove_file(self, session_id: str, file_id: str) -> Dict[str, Any]:
        """Remove a file from an active session."""
        try:
            res = self._get_report_gen_service().remove_file(session_id, file_id)
            return {"success": True, **res}
        except Exception as exc:
            logger.exception("Error in rg_remove_file: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_select_file(self, session_id: str, file_id: str) -> Dict[str, Any]:
        """Switch active Excel file in session to configure or view its layout."""
        try:
            res = self._get_report_gen_service().select_file(session_id, file_id)
            return {"success": True, **res}
        except Exception as exc:
            logger.exception("Error in rg_select_file: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_open_gsheet(self, url: str) -> Dict[str, Any]:
        """Download and initialize session from a Google Sheet link."""
        try:
            res = self._get_report_gen_service().open_gsheet(url)
            return {"success": True, **res}
        except Exception as exc:
            logger.exception("Error in rg_open_gsheet: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_get_sheet(self, session_id: str, sheet_name: Optional[str] = None) -> Dict[str, Any]:
        """Get sheet grid preview and suggested regions."""
        try:
            res = self._get_report_gen_service().get_sheet(session_id, sheet_name=sheet_name)
            return {"success": True, **res}
        except Exception as exc:
            logger.exception("Error in rg_get_sheet: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_set_regions(self, session_id: str, regions: List[Dict[str, Any]], sheet_name: Optional[str] = None) -> Dict[str, Any]:
        """Assign report regions and generate preliminary layout XML."""
        try:
            res = self._get_report_gen_service().set_regions(session_id, regions, sheet_name=sheet_name)
            return {"success": True, **res}
        except Exception as exc:
            logger.exception("Error in rg_set_regions: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_list_routines(
        self,
        connection_id: str,
        schema: Optional[str] = None,
        search: Optional[str] = None,
        database: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List routines available on the specified connection."""
        try:
            resolved_id = self._rg_resolve_connection_id(connection_id)
            owner_sid = getattr(self, "owner_session_id", "main")
            items = self._get_report_gen_service().list_routines(
                connection_id=resolved_id,
                schema=schema,
                search=search,
                database=database,
                owner_session_id=owner_sid,
            )
            return {"success": True, "routines": items}
        except Exception as exc:
            logger.exception("Error in rg_list_routines: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_describe_routine(
        self,
        session_id: str,
        connection_id: str,
        routine_name: str,
        schema: Optional[str] = None,
        database: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Inspect routine output sets and parameters statically without execution."""
        try:
            resolved_id = self._rg_resolve_connection_id(connection_id)
            owner_sid = getattr(self, "owner_session_id", "main")
            shape = self._get_report_gen_service().describe_routine(
                session_id=session_id,
                connection_id=resolved_id,
                routine_name=routine_name,
                schema=schema,
                database=database,
                owner_session_id=owner_sid,
            )
            return {"success": True, "shape": shape}
        except Exception as exc:
            logger.exception("Error in rg_describe_routine: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_apply_mapping(
        self,
        session_id: str,
        data_member: str,
        mapping: Dict[str, str],
        mode: str = "rename",
        unmapped_columns: Optional[List[str]] = None,
        sheet_name: Optional[str] = None,
        param_mappings: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Apply column mappings to the layout XML."""
        try:
            res = self._get_report_gen_service().apply_mapping(
                session_id=session_id,
                data_member=data_member,
                mapping=mapping,
                mode=mode,
                unmapped_columns=unmapped_columns,
                sheet_name=sheet_name,
                param_mappings=param_mappings,
            )
            return {"success": True, **res}
        except Exception as exc:
            logger.exception("Error in rg_apply_mapping: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_build(self, session_id: str) -> Dict[str, Any]:
        """Finalize layout and datasource XML."""
        try:
            res = self._get_report_gen_service().build(session_id)
            return {"success": True, **res}
        except Exception as exc:
            logger.exception("Error in rg_build: %s", exc)
            return {"success": False, "error": str(exc)}

    def rg_save_files(self, session_id: str, folder: str) -> Dict[str, Any]:
        """Save XML files to target folder."""
        try:
            res = self._get_report_gen_service().save_files(session_id, folder)
            return {"success": True, **res}
        except Exception as exc:
            logger.exception("Error in rg_save_files: %s", exc)
            return {"success": False, "error": str(exc)}
