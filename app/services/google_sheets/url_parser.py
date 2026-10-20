# -*- coding: utf-8 -*-
"""
Google Workspace URL Parser and Multi-format Validator.
Supports:
- Google Sheets (/spreadsheets/d/<ID>/...)
- Google Docs (/document/d/<ID>/...)
- Google Slides / PowerPoint (/presentation/d/<ID>/...)
- PDF Files (drive.google.com/file/d/<ID>/... or direct .pdf URLs)
- Google Tasks / Keep (calendar.google.com/.../tasks, keep.google.com, tasksboard.com)
"""

import re
import logging
from typing import Dict, Any, Optional
from urllib.parse import urlparse, parse_qs, urlunparse

logger = logging.getLogger("app.services.google_sheets.url_parser")

DOC_ID_REGEX = re.compile(r"^[a-zA-Z0-9_-]{15,}$")
SHEETS_PATH_REGEX = re.compile(r"^/spreadsheets/d/([a-zA-Z0-9_-]+)(?:/(edit|view|htmlview|preview|copy|htmlembed|pubhtml)?)?/?$")
DOCS_PATH_REGEX = re.compile(r"^/document/d/([a-zA-Z0-9_-]+)(?:/(edit|view|preview|copy)?)?/?$")
SLIDES_PATH_REGEX = re.compile(r"^/presentation/d/([a-zA-Z0-9_-]+)(?:/(edit|view|preview|embed|present)?)?/?$")
DRIVE_FILE_PATH_REGEX = re.compile(r"^/file/d/([a-zA-Z0-9_-]+)(?:/(view|preview)?)?/?$")


def parse_google_workspace_url(raw_url: str) -> Dict[str, Any]:
    """
    Parse, validate, and normalize a Google Workspace URL across multiple formats.
    Returns:
        - valid (bool): True if URL is recognized and valid
        - type (str): 'sheet' | 'doc' | 'slide' | 'pdf' | 'task'
        - type_name (str): Human readable type in Vietnamese
        - doc_id (str|None): Unique ID of the document/spreadsheet/presentation/file
        - spreadsheet_id (str|None): Backward compatibility for sheets
        - gid (str|None): Worksheet tab GID if sheet
        - normalized_url (str|None): Canonical URL for viewing/editing
        - preview_url (str|None): Direct embed/preview URL
        - read_only (bool): True if format is view-only (e.g. PDF)
        - error (str|None): Error message if invalid
    """
    result: Dict[str, Any] = {
        "valid": False,
        "type": "sheet",
        "type_name": "Google Sheets",
        "doc_id": None,
        "spreadsheet_id": None,
        "gid": None,
        "normalized_url": None,
        "preview_url": None,
        "read_only": False,
        "error": None,
    }

    if not raw_url or not isinstance(raw_url, str):
        result["error"] = "URL trống hoặc không đúng định dạng chuỗi"
        return result

    raw_url = raw_url.strip()

    if not raw_url.startswith("https://") and not raw_url.startswith("http://"):
        result["error"] = "URL phải bắt đầu bằng https://"
        return result

    try:
        parsed = urlparse(raw_url)
    except Exception as exc:
        result["error"] = f"Không thể phân tích URL: {exc}"
        return result

    hostname = (parsed.hostname or "").lower()
    path = parsed.path or ""

    # 1. Direct PDF URL (.pdf)
    if path.lower().endswith(".pdf") or "application/pdf" in raw_url:
        result["valid"] = True
        result["type"] = "pdf"
        result["type_name"] = "Tài liệu PDF (Chỉ xem)"
        result["doc_id"] = path.split("/")[-1].replace(".pdf", "") or "pdf_doc"
        result["normalized_url"] = raw_url
        result["preview_url"] = raw_url
        result["read_only"] = True
        return result

    # 2. Google Drive PDF / File (drive.google.com/file/d/<ID>/...)
    if "drive.google.com" in hostname:
        match = DRIVE_FILE_PATH_REGEX.match(path)
        file_id = match.group(1) if match else None
        if not file_id and "/open" in path:
            q = parse_qs(parsed.query)
            file_id = q.get("id", [None])[0]

        if file_id and DOC_ID_REGEX.match(file_id):
            result["valid"] = True
            result["type"] = "pdf"
            result["type_name"] = "Tài liệu PDF (Google Drive)"
            result["doc_id"] = file_id
            result["normalized_url"] = f"https://drive.google.com/file/d/{file_id}/preview"
            result["preview_url"] = f"https://drive.google.com/file/d/{file_id}/preview"
            result["read_only"] = True
            return result
        elif not file_id:
            result["error"] = "Đường dẫn Google Drive không hợp lệ (cần dạng /file/d/ID/view hoặc ?id=ID)"
            return result

    # 3. Google Tasks / Google Keep
    if ("calendar.google.com" in hostname and "tasks" in path) or ("keep.google.com" in hostname) or ("tasksboard.com" in hostname):
        result["valid"] = True
        result["type"] = "task"
        result["type_name"] = "Google Tasks / Keep"
        result["doc_id"] = "google_tasks"
        result["normalized_url"] = raw_url
        result["preview_url"] = raw_url
        result["read_only"] = False
        return result

    # Must be docs.google.com for Docs, Sheets, Slides
    if hostname != "docs.google.com":
        result["error"] = f"Hostname không thuộc dịch vụ Google Docs/Sheets/Drive: '{hostname}'"
        return result

    # 4. Google Sheets
    sheets_match = SHEETS_PATH_REGEX.match(path)
    if sheets_match:
        sheet_id = sheets_match.group(1)
        if not DOC_ID_REGEX.match(sheet_id):
            result["error"] = f"Spreadsheet ID không hợp lệ: '{sheet_id}'"
            return result

        gid: Optional[str] = None
        query_params = parse_qs(parsed.query)
        if "gid" in query_params and query_params["gid"][0].isdigit():
            gid = query_params["gid"][0]
        elif parsed.fragment:
            frag_match = re.search(r"gid=(\d+)", parsed.fragment)
            if frag_match:
                gid = frag_match.group(1)

        clean_path = f"/spreadsheets/d/{sheet_id}/edit"
        clean_query = f"gid={gid}" if gid else ""
        normalized = urlunparse(("https", "docs.google.com", clean_path, "", clean_query, ""))
        preview_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/htmlembed?widget=true&headers=true" + (f"&gid={gid}" if gid else "")

        result["valid"] = True
        result["type"] = "sheet"
        result["type_name"] = "Google Sheets"
        result["doc_id"] = sheet_id
        result["spreadsheet_id"] = sheet_id
        result["gid"] = gid
        result["normalized_url"] = normalized
        result["preview_url"] = preview_url
        result["read_only"] = False
        return result

    # 5. Google Docs
    docs_match = DOCS_PATH_REGEX.match(path)
    if docs_match:
        doc_id = docs_match.group(1)
        if not DOC_ID_REGEX.match(doc_id):
            result["error"] = f"Google Docs ID không hợp lệ: '{doc_id}'"
            return result

        result["valid"] = True
        result["type"] = "doc"
        result["type_name"] = "Google Docs (Văn bản)"
        result["doc_id"] = doc_id
        result["spreadsheet_id"] = doc_id
        result["normalized_url"] = f"https://docs.google.com/document/d/{doc_id}/edit"
        result["preview_url"] = f"https://docs.google.com/document/d/{doc_id}/preview"
        result["read_only"] = False
        return result

    # 6. Google Slides / PowerPoint
    slides_match = SLIDES_PATH_REGEX.match(path)
    if slides_match:
        slide_id = slides_match.group(1)
        if not DOC_ID_REGEX.match(slide_id):
            result["error"] = f"Google Slides ID không hợp lệ: '{slide_id}'"
            return result

        result["valid"] = True
        result["type"] = "slide"
        result["type_name"] = "Google Slides (Trình chiếu)"
        result["doc_id"] = slide_id
        result["spreadsheet_id"] = slide_id
        result["normalized_url"] = f"https://docs.google.com/presentation/d/{slide_id}/edit"
        result["preview_url"] = f"https://docs.google.com/presentation/d/{slide_id}/embed"
        result["read_only"] = False
        return result

    result["error"] = f"Đường dẫn không khớp với định dạng Google Sheets, Docs, Slides, Drive PDF hay Tasks: '{path}'"
    return result


def parse_google_sheets_url(raw_url: str) -> Dict[str, Any]:
    """Backward-compatible wrapper for Google Sheets and Google Workspace items."""
    return parse_google_workspace_url(raw_url)


def is_valid_google_sheets_url(raw_url: str) -> bool:
    """Convenience boolean check."""
    return parse_google_workspace_url(raw_url).get("valid", False)
