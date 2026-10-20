# -*- coding: utf-8 -*-
"""
Google Sheets Service: Business logic layer.
Orchestrates projects, sheets, favorites, search, and workspace persistence.
"""

import time
import uuid
import logging
from typing import Dict, Any, List, Optional

from .url_parser import parse_google_sheets_url
from .registry import GoogleSheetsRegistry

logger = logging.getLogger("app.services.google_sheets.service")


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _generate_id(prefix: str = "id") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class GoogleSheetsService:
    """Core service for managing Google Sheets projects and worksheets."""

    def __init__(self, registry: Optional[GoogleSheetsRegistry] = None):
        self._registry = registry or GoogleSheetsRegistry()

    # ─── PROJECTS CRUD ────────────────────────────────────────────────────────

    def list_projects(self) -> List[Dict[str, Any]]:
        """Return list of all projects with summary info (sheet count, favorites)."""
        data = self._registry.load()
        projects = data.get("projects", [])
        result = []
        for p in projects:
            sheets = p.get("sheets", [])
            fav_count = sum(1 for s in sheets if s.get("favorite"))
            result.append({
                "id": p.get("id"),
                "name": p.get("name"),
                "description": p.get("description", ""),
                "color": p.get("color", "#3B82F6"),
                "sheetCount": len(sheets),
                "favoriteCount": fav_count,
                "createdAt": p.get("createdAt"),
                "updatedAt": p.get("updatedAt"),
                "sheets": sheets,
            })
        return result

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve full project details including all sheets."""
        data = self._registry.load()
        for p in data.get("projects", []):
            if p.get("id") == project_id:
                return p
        return None

    def create_project(self, name: str, description: str = "", color: str = "#3B82F6") -> Dict[str, Any]:
        """Create a new project container."""
        clean_name = (name or "").strip()
        if not clean_name:
            raise ValueError("Tên dự án không được để trống")

        data = self._registry.load()
        now = _now_iso()
        new_project = {
            "id": _generate_id("proj"),
            "name": clean_name,
            "description": (description or "").strip(),
            "color": color or "#3B82F6",
            "createdAt": now,
            "updatedAt": now,
            "sheets": []
        }

        data.setdefault("projects", []).append(new_project)
        self._registry.save(data)
        logger.info("[Service] Created project: %s (%s)", new_project["name"], new_project["id"])
        return new_project

    def update_project(
        self,
        project_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        color: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Update an existing project metadata."""
        data = self._registry.load()
        for p in data.get("projects", []):
            if p.get("id") == project_id:
                if name is not None:
                    clean_name = name.strip()
                    if not clean_name:
                        raise ValueError("Tên dự án không được để trống")
                    p["name"] = clean_name
                if description is not None:
                    p["description"] = description.strip()
                if color is not None:
                    p["color"] = color
                p["updatedAt"] = _now_iso()

                self._registry.save(data)
                logger.info("[Service] Updated project: %s", project_id)
                return p
        return None

    def delete_project(self, project_id: str) -> bool:
        """
        Delete a project.
        Guarantees that at least one project remains (or resets to default).
        """
        data = self._registry.load()
        projects = data.get("projects", [])
        idx = next((i for i, p in enumerate(projects) if p.get("id") == project_id), None)
        if idx is None:
            return False

        projects.pop(idx)

        # If no projects left, re-create an empty default one
        if not projects:
            now = _now_iso()
            projects.append({
                "id": "proj_default",
                "name": "Dự án mặc định",
                "description": "",
                "color": "#3B82F6",
                "createdAt": now,
                "updatedAt": now,
                "sheets": []
            })

        # Update workspace if current active project was deleted
        ws = data.get("workspace", {})
        if ws.get("lastProjectId") == project_id:
            ws["lastProjectId"] = projects[0]["id"]
            ws["lastOpenedSheetId"] = None

        self._registry.save(data)
        logger.info("[Service] Deleted project: %s", project_id)
        return True

    def reorder_projects(self, project_ids: List[str]) -> bool:
        """Reorder projects according to a list of IDs."""
        data = self._registry.load()
        projects = data.get("projects", [])
        proj_map = {p["id"]: p for p in projects if "id" in p}

        ordered = []
        for pid in project_ids:
            if pid in proj_map:
                ordered.append(proj_map.pop(pid))
        # Append any remaining not in the ID list
        ordered.extend(proj_map.values())

        data["projects"] = ordered
        return self._registry.save(data)

    # ─── SHEETS CRUD ──────────────────────────────────────────────────────────

    def add_sheet(
        self,
        project_id: str,
        title: str,
        url: str,
        tags: Optional[List[str]] = None,
        notes: Optional[str] = None,
        favorite: bool = False,
        grid_data: Optional[List[List[str]]] = None
    ) -> Dict[str, Any]:
        """
        Validate URL, normalize it, and add sheet to the specified project.
        """
        clean_title = (title or "").strip()
        if not clean_title:
            raise ValueError("Tiêu đề sheet không được để trống")

        parsed = parse_google_sheets_url(url)
        if not parsed["valid"]:
            raise ValueError(parsed["error"] or "URL Google Sheets không hợp lệ")

        data = self._registry.load()
        project = next((p for p in data.get("projects", []) if p.get("id") == project_id), None)
        if not project:
            raise ValueError(f"Không tìm thấy dự án với ID: {project_id}")

        now = _now_iso()
        sheet = {
            "id": _generate_id("sheet"),
            "title": clean_title,
            "type": parsed.get("type", "sheet"),
            "url": parsed["normalized_url"],
            "previewUrl": parsed.get("preview_url") or parsed["normalized_url"],
            "readOnly": bool(parsed.get("read_only", False)),
            "spreadsheetId": parsed["spreadsheet_id"] or parsed.get("doc_id"),
            "gid": parsed.get("gid"),
            "favorite": bool(favorite),
            "tags": [t.strip() for t in (tags or []) if t.strip()],
            "notes": (notes or "").strip(),
            "gridData": grid_data or [],
            "createdAt": now,
            "updatedAt": now,
        }

        project.setdefault("sheets", []).append(sheet)
        project["updatedAt"] = now
        self._registry.save(data)
        logger.info("[Service] Added item '%s' (%s) to project %s", sheet["title"], sheet["type"], project_id)
        return sheet

    def update_sheet(
        self,
        project_id: str,
        sheet_id: str,
        title: Optional[str] = None,
        url: Optional[str] = None,
        tags: Optional[List[str]] = None,
        notes: Optional[str] = None,
        favorite: Optional[bool] = None,
        grid_data: Optional[List[List[str]]] = None
    ) -> Optional[Dict[str, Any]]:
        """Update an existing sheet's metadata."""
        data = self._registry.load()
        project = next((p for p in data.get("projects", []) if p.get("id") == project_id), None)
        if not project:
            return None

        sheet = next((s for s in project.get("sheets", []) if s.get("id") == sheet_id), None)
        if not sheet:
            return None

        if title is not None:
            clean_title = title.strip()
            if not clean_title:
                raise ValueError("Tiêu đề sheet không được để trống")
            sheet["title"] = clean_title

        if url is not None:
            parsed = parse_google_sheets_url(url)
            if not parsed["valid"]:
                raise ValueError(parsed["error"] or "URL Google Sheets không hợp lệ")
            sheet["type"] = parsed.get("type", sheet.get("type", "sheet"))
            sheet["url"] = parsed["normalized_url"]
            sheet["previewUrl"] = parsed.get("preview_url") or parsed["normalized_url"]
            sheet["readOnly"] = bool(parsed.get("read_only", False))
            sheet["spreadsheetId"] = parsed["spreadsheet_id"] or parsed.get("doc_id")
            sheet["gid"] = parsed.get("gid")

        if tags is not None:
            sheet["tags"] = [t.strip() for t in tags if t.strip()]

        if notes is not None:
            sheet["notes"] = notes.strip()

        if favorite is not None:
            sheet["favorite"] = bool(favorite)

        if grid_data is not None:
            sheet["gridData"] = grid_data

        now = _now_iso()
        sheet["updatedAt"] = now
        project["updatedAt"] = now

        self._registry.save(data)
        logger.info("[Service] Updated sheet '%s' (%s)", sheet["title"], sheet_id)
        return sheet

    def save_sheet_grid(self, project_id: str, sheet_id: str, grid_data: List[List[str]]) -> bool:
        """Save direct grid edits for a sheet."""
        data = self._registry.load()
        project = next((p for p in data.get("projects", []) if p.get("id") == project_id), None)
        if not project:
            return False
        sheet = next((s for s in project.get("sheets", []) if s.get("id") == sheet_id), None)
        if not sheet:
            return False
        sheet["gridData"] = grid_data
        sheet["updatedAt"] = _now_iso()
        project["updatedAt"] = _now_iso()
        return self._registry.save(data)

    def fetch_remote_sheet_data(self, project_id: str, sheet_id: str) -> Dict[str, Any]:
        """
        Attempt to download live CSV data from Google Sheets export endpoint
        and populate sheet's gridData for direct editing in IDE.
        """
        import csv
        import io
        import urllib.request

        data = self._registry.load()
        project = next((p for p in data.get("projects", []) if p.get("id") == project_id), None)
        if not project:
            return {"success": False, "error": f"Không tìm thấy dự án: {project_id}"}

        sheet = next((s for s in project.get("sheets", []) if s.get("id") == sheet_id), None)
        if not sheet:
            return {"success": False, "error": f"Không tìm thấy sheet: {sheet_id}"}

        spreadsheet_id = sheet.get("spreadsheetId")
        if not spreadsheet_id:
            return {"success": False, "error": "Thiếu Spreadsheet ID"}

        gid = sheet.get("gid")
        export_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=csv"
        if gid:
            export_url += f"&gid={gid}"

        try:
            req = urllib.request.Request(
                export_url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) luoBTool-IDE/1.0"}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                content = resp.read().decode("utf-8-sig", errors="replace")

            reader = csv.reader(io.StringIO(content))
            rows = [row for row in reader]

            if rows:
                sheet["gridData"] = rows[:500]  # Cap at 500 rows for memory efficiency
                sheet["updatedAt"] = _now_iso()
                project["updatedAt"] = _now_iso()
                self._registry.save(data)
                return {"success": True, "rows": len(rows), "gridData": sheet["gridData"]}
            else:
                return {"success": False, "error": "Tài liệu trống hoặc không có dòng dữ liệu nào"}
        except urllib.error.HTTPError as he:
            if he.code in (401, 403):
                return {
                    "success": False,
                    "error": "Tài liệu yêu cầu quyền truy cập (Private). Vui lòng chuyển quyền sang 'Bất kỳ ai có liên kết' hoặc dùng tính năng 'Xem Trực Tiếp' / 'Mở Cửa Sổ Mới'."
                }
            return {"success": False, "error": f"Lỗi HTTP {he.code}: {he.reason}"}
        except Exception as exc:
            logger.warning("[Service] Could not fetch remote CSV: %s", exc)
            return {"success": False, "error": f"Không thể tải CSV: {str(exc)}"}

    def remove_sheet(self, project_id: str, sheet_id: str) -> bool:
        """Delete a sheet from a project."""
        data = self._registry.load()
        project = next((p for p in data.get("projects", []) if p.get("id") == project_id), None)
        if not project:
            return False

        sheets = project.get("sheets", [])
        idx = next((i for i, s in enumerate(sheets) if s.get("id") == sheet_id), None)
        if idx is None:
            return False

        sheets.pop(idx)
        project["updatedAt"] = _now_iso()

        # Clean workspace lastOpenedSheetId if needed
        ws = data.get("workspace", {})
        if ws.get("lastOpenedSheetId") == sheet_id:
            ws["lastOpenedSheetId"] = None

        self._registry.save(data)
        logger.info("[Service] Removed sheet %s from project %s", sheet_id, project_id)
        return True

    def toggle_favorite(self, project_id: str, sheet_id: str) -> Optional[bool]:
        """Toggle favorite status of a sheet, returns new status."""
        data = self._registry.load()
        project = next((p for p in data.get("projects", []) if p.get("id") == project_id), None)
        if not project:
            return None

        sheet = next((s for s in project.get("sheets", []) if s.get("id") == sheet_id), None)
        if not sheet:
            return None

        sheet["favorite"] = not bool(sheet.get("favorite"))
        sheet["updatedAt"] = _now_iso()
        project["updatedAt"] = _now_iso()
        self._registry.save(data)
        return sheet["favorite"]

    def move_sheet(self, source_project_id: str, target_project_id: str, sheet_id: str) -> bool:
        """Move a sheet from one project to another."""
        if source_project_id == target_project_id:
            return True

        data = self._registry.load()
        src = next((p for p in data.get("projects", []) if p.get("id") == source_project_id), None)
        tgt = next((p for p in data.get("projects", []) if p.get("id") == target_project_id), None)
        if not src or not tgt:
            return False

        idx = next((i for i, s in enumerate(src.get("sheets", [])) if s.get("id") == sheet_id), None)
        if idx is None:
            return False

        sheet = src["sheets"].pop(idx)
        now = _now_iso()
        sheet["updatedAt"] = now
        src["updatedAt"] = now
        tgt.setdefault("sheets", []).append(sheet)
        tgt["updatedAt"] = now

        return self._registry.save(data)

    # ─── SEARCH & FILTER ──────────────────────────────────────────────────────

    def search_sheets(
        self,
        query: str = "",
        tag: Optional[str] = None,
        favorite_only: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Search across all projects by title/notes/tags/spreadsheetId.
        Returns flattened list of sheets with project information attached.
        """
        data = self._registry.load()
        q = (query or "").lower().strip()
        t = (tag or "").lower().strip()

        results = []
        for p in data.get("projects", []):
            proj_id = p.get("id")
            proj_name = p.get("name")
            proj_color = p.get("color", "#3B82F6")

            for s in p.get("sheets", []):
                if favorite_only and not s.get("favorite"):
                    continue

                if t:
                    sheet_tags = [x.lower() for x in s.get("tags", [])]
                    if t not in sheet_tags:
                        continue

                if q:
                    title_match = q in s.get("title", "").lower()
                    notes_match = q in s.get("notes", "").lower()
                    tags_match = any(q in x.lower() for x in s.get("tags", []))
                    id_match = q in s.get("spreadsheetId", "").lower()
                    if not (title_match or notes_match or tags_match or id_match):
                        continue

                item = dict(s)
                item["projectId"] = proj_id
                item["projectName"] = proj_name
                item["projectColor"] = proj_color
                results.append(item)

        return results

    # ─── WORKSPACE ────────────────────────────────────────────────────────────

    def get_workspace(self) -> Dict[str, Any]:
        """Get the last active project and sheet."""
        data = self._registry.load()
        return data.get("workspace", {
            "lastProjectId": None,
            "lastOpenedSheetId": None
        })

    def save_workspace(
        self,
        last_project_id: Optional[str] = None,
        last_opened_sheet_id: Optional[str] = None
    ) -> bool:
        """Save user's current project and sheet selection."""
        data = self._registry.load()
        ws = data.setdefault("workspace", {})
        if last_project_id is not None:
            ws["lastProjectId"] = last_project_id
        if last_opened_sheet_id is not None:
            ws["lastOpenedSheetId"] = last_opened_sheet_id
        return self._registry.save(data)
