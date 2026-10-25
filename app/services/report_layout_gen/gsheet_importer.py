# -*- coding: utf-8 -*-
"""
Google Sheets Importer for Report Layout Generator.
Exports remote Google Sheet as .xlsx bytes preserving cell merges, column widths, and row heights.
"""
import logging
from typing import Optional, Tuple
import urllib.error
import urllib.request

from app.services.google_sheets.url_parser import parse_google_sheets_url

logger = logging.getLogger("app.services.report_layout_gen.gsheet_importer")

MAX_XLSX_SIZE = 25 * 1024 * 1024  # 25 MB


def fetch_gsheet_xlsx(url: str, timeout_sec: int = 15) -> Tuple[bytes, Optional[str]]:
    """
    Download remote Google Sheet workbook in .xlsx format.
    Returns: (xlsx_bytes, target_gid)
    Raises: ValueError with user-friendly Vietnamese error messages.
    """
    parsed = parse_google_sheets_url(url)
    if not parsed.get("valid"):
        raise ValueError(parsed.get("error") or "Đường dẫn Google Sheets không hợp lệ.")

    spreadsheet_id = parsed.get("spreadsheet_id")
    if not spreadsheet_id:
        raise ValueError("Không tìm thấy Spreadsheet ID trong liên kết.")

    target_gid = parsed.get("gid")
    export_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=xlsx"

    req = urllib.request.Request(
        export_url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as response:
            content_type = response.headers.get("Content-Type", "")
            # Check content length if available
            length_header = response.headers.get("Content-Length")
            if length_header and int(length_header) > MAX_XLSX_SIZE:
                raise ValueError(f"Dung lượng file vượt quá giới hạn cho phép ({MAX_XLSX_SIZE // (1024 * 1024)} MB).")

            data = response.read(MAX_XLSX_SIZE + 1)
            if len(data) > MAX_XLSX_SIZE:
                raise ValueError("Dung lượng file vượt quá giới hạn 25 MB.")

            # Basic validation that received content is a ZIP/OpenXML archive (starts with PK)
            if not data.startswith(b"PK\x03\x04"):
                if b"<html" in data.lower() or b"<!doctype" in data.lower():
                    raise ValueError(
                        "Bảng tính Google Sheets đang ở chế độ riêng tư hoặc yêu cầu đăng nhập. "
                        "Vui lòng bật quyền truy cập 'Bất kỳ ai có liên kết đều có thể xem' hoặc tải file Excel trực tiếp."
                    )
                raise ValueError("Nội dung tải về không phải là file Excel (.xlsx) hợp lệ.")

            return data, target_gid

    except urllib.error.HTTPError as err:
        if err.code in (401, 403):
            raise ValueError(
                "Không có quyền truy cập Google Sheet (HTTP 401/403). "
                "Vui lòng bật quyền 'Bất kỳ ai có liên kết' (Anyone with the link) hoặc tải file .xlsx lên."
            )
        elif err.code == 404:
            raise ValueError("Không tìm thấy bảng tính Google Sheets (HTTP 404). Vui lòng kiểm tra lại đường dẫn.")
        else:
            raise ValueError(f"Lỗi khi tải bảng tính từ Google (HTTP {err.code}): {err.reason}")
    except urllib.error.URLError as err:
        raise ValueError(f"Lỗi kết nối mạng khi tải Google Sheet: {err.reason}")
    except TimeoutError:
        raise ValueError(f"Quá thời gian tải bảng tính ({timeout_sec}s). Vui lòng kiểm tra lại mạng hoặc tải file trực tiếp.")
