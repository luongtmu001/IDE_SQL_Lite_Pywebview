# -*- coding: utf-8 -*-
"""
Google Sheets API Mixin.
Bridges frontend JavaScript calls (window.pywebview.api.gs_*) to Python Google Sheets Service.
"""

import logging
from typing import Any, Dict, List, Optional

from app.services.google_sheets import (
    GoogleSheetsService,
    parse_google_sheets_url,
    get_window_manager,
)

logger = logging.getLogger("luobtool.api.google_sheets")


class GoogleSheetsApiMixin:
    """API mixin for Google Sheets integration."""

    _gs_service_instance: Optional[GoogleSheetsService] = None

    def _get_gs_service(self) -> GoogleSheetsService:
        if self._gs_service_instance is None:
            self._gs_service_instance = GoogleSheetsService()
        return self._gs_service_instance

    # ─── URL VALIDATION ───────────────────────────────────────────────────────

    def gs_validate_url(self, raw_url: str) -> Dict[str, Any]:
        """Validate and parse a Google Sheets URL."""
        try:
            parsed = parse_google_sheets_url(raw_url)
            return {"success": parsed["valid"], "data": parsed, "error": parsed["error"]}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # ─── PROJECTS ─────────────────────────────────────────────────────────────

    def gs_list_projects(self) -> Dict[str, Any]:
        """List all projects with metadata summary."""
        try:
            projects = self._get_gs_service().list_projects()
            return {"success": True, "projects": projects}
        except Exception as exc:
            logger.exception("Error in gs_list_projects: %s", exc)
            return {"success": False, "error": str(exc)}

    def gs_get_project(self, project_id: str) -> Dict[str, Any]:
        """Get full project details including sheet list."""
        try:
            project = self._get_gs_service().get_project(project_id)
            if not project:
                return {"success": False, "error": f"Không tìm thấy dự án: {project_id}"}
            return {"success": True, "project": project}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_create_project(self, name: str, description: str = "", color: str = "#3B82F6") -> Dict[str, Any]:
        """Create a new project container."""
        try:
            project = self._get_gs_service().create_project(name=name, description=description, color=color)
            return {"success": True, "project": project}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_update_project(
        self,
        project_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        color: Optional[str] = None
    ) -> Dict[str, Any]:
        """Update an existing project metadata."""
        try:
            updated = self._get_gs_service().update_project(project_id, name=name, description=description, color=color)
            if not updated:
                return {"success": False, "error": f"Không tìm thấy dự án: {project_id}"}
            return {"success": True, "project": updated}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_delete_project(self, project_id: str) -> Dict[str, Any]:
        """Delete a project."""
        try:
            deleted = self._get_gs_service().delete_project(project_id)
            return {"success": deleted}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_reorder_projects(self, project_ids: List[str]) -> Dict[str, Any]:
        """Reorder project sequence."""
        try:
            ok = self._get_gs_service().reorder_projects(project_ids)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # ─── SHEETS ───────────────────────────────────────────────────────────────

    def gs_add_sheet(
        self,
        project_id: str,
        title: str,
        url: str,
        tags: Optional[List[str]] = None,
        notes: Optional[str] = None,
        favorite: bool = False
    ) -> Dict[str, Any]:
        """Add a new sheet to a project."""
        try:
            sheet = self._get_gs_service().add_sheet(
                project_id=project_id,
                title=title,
                url=url,
                tags=tags,
                notes=notes,
                favorite=favorite
            )
            return {"success": True, "sheet": sheet}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_update_sheet(
        self,
        project_id: str,
        sheet_id: str,
        title: Optional[str] = None,
        url: Optional[str] = None,
        tags: Optional[List[str]] = None,
        notes: Optional[str] = None,
        favorite: Optional[bool] = None
    ) -> Dict[str, Any]:
        """Update metadata of an existing sheet."""
        try:
            sheet = self._get_gs_service().update_sheet(
                project_id=project_id,
                sheet_id=sheet_id,
                title=title,
                url=url,
                tags=tags,
                notes=notes,
                favorite=favorite
            )
            if not sheet:
                return {"success": False, "error": f"Không tìm thấy sheet: {sheet_id}"}
            return {"success": True, "sheet": sheet}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_save_sheet_grid(self, project_id: str, sheet_id: str, grid_data: List[List[str]]) -> Dict[str, Any]:
        """Save direct grid edits for a sheet."""
        try:
            ok = self._get_gs_service().save_sheet_grid(project_id, sheet_id, grid_data)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_fetch_sheet_data(self, project_id: str, sheet_id: str) -> Dict[str, Any]:
        """Fetch remote sheet data via CSV export and sync to gridData."""
        try:
            return self._get_gs_service().fetch_remote_sheet_data(project_id, sheet_id)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_remove_sheet(self, project_id: str, sheet_id: str) -> Dict[str, Any]:
        """Remove a sheet from a project and close its companion window if open."""
        try:
            get_window_manager().close_sheet_window(sheet_id)
            ok = self._get_gs_service().remove_sheet(project_id, sheet_id)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_toggle_favorite(self, project_id: str, sheet_id: str) -> Dict[str, Any]:
        """Toggle favorite status of a sheet."""
        try:
            new_fav = self._get_gs_service().toggle_favorite(project_id, sheet_id)
            if new_fav is None:
                return {"success": False, "error": f"Không tìm thấy sheet: {sheet_id}"}
            return {"success": True, "favorite": new_fav}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_move_sheet(self, source_project_id: str, target_project_id: str, sheet_id: str) -> Dict[str, Any]:
        """Move a sheet between projects."""
        try:
            ok = self._get_gs_service().move_sheet(source_project_id, target_project_id, sheet_id)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # ─── SEARCH ───────────────────────────────────────────────────────────────

    def gs_search_sheets(
        self,
        query: str = "",
        tag: Optional[str] = None,
        favorite_only: bool = False
    ) -> Dict[str, Any]:
        """Search sheets across all projects."""
        try:
            results = self._get_gs_service().search_sheets(query=query, tag=tag, favorite_only=favorite_only)
            return {"success": True, "results": results}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # ─── WORKSPACE ────────────────────────────────────────────────────────────

    def gs_get_workspace(self) -> Dict[str, Any]:
        """Get last active workspace state."""
        try:
            ws = self._get_gs_service().get_workspace()
            return {"success": True, "workspace": ws}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_save_workspace(
        self,
        last_project_id: Optional[str] = None,
        last_opened_sheet_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Save active project and sheet."""
        try:
            ok = self._get_gs_service().save_workspace(last_project_id, last_opened_sheet_id)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # ─── WEBVIEW2 HOST & BROWSER FALLBACK ─────────────────────────────────────

    def gs_open_sheet_window(self, project_id: str, sheet_id: str) -> Dict[str, Any]:
        """Open a sheet in a WebView2 companion window."""
        try:
            project = self._get_gs_service().get_project(project_id)
            if not project:
                return {"success": False, "error": f"Không tìm thấy dự án: {project_id}"}

            sheet = next((s for s in project.get("sheets", []) if s.get("id") == sheet_id), None)
            if not sheet:
                return {"success": False, "error": f"Không tìm thấy sheet: {sheet_id}"}

            # Update workspace state
            self._get_gs_service().save_workspace(
                last_project_id=project_id,
                last_opened_sheet_id=sheet_id
            )

            wm = get_window_manager()
            return wm.open_sheet_window(
                sheet_id=sheet_id,
                title=sheet.get("title", "Google Sheets"),
                url=sheet.get("url", ""),
                parent_api=self
            )
        except Exception as exc:
            logger.exception("Error in gs_open_sheet_window: %s", exc)
            return {"success": False, "error": str(exc)}

    def gs_close_sheet_window(self, sheet_id: str) -> Dict[str, Any]:
        """Close companion window for a sheet."""
        try:
            closed = get_window_manager().close_sheet_window(sheet_id)
            return {"success": closed}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_open_in_browser(self, url: str) -> Dict[str, Any]:
        """Open sheet in default system browser as fallback."""
        try:
            return get_window_manager().open_in_browser(url)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_get_open_sheet_ids(self) -> Dict[str, Any]:
        """Return list of sheet IDs that are currently open in companion windows."""
        try:
            ids = get_window_manager().get_open_sheet_ids()
            return {"success": True, "openSheetIds": ids}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def gs_open_manager_window(self) -> Dict[str, Any]:
        """Open or focus the dedicated Google Sheets Workspace subwindow."""
        try:
            from app.desktop.windows import open_google_sheets_window
            return open_google_sheets_window(self)
        except Exception as exc:
            logger.exception("Error in gs_open_manager_window: %s", exc)
            return {"success": False, "error": str(exc)}
