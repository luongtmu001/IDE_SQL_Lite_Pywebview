# -*- coding: utf-8 -*-
"""
Google Sheets Registry: Data storage and persistence layer.
Handles atomic reading and writing of google_sheets.json.
Guarantees:
- Safe atomic file operations (temp file + rename)
- Thread-safe access via reentrant lock
- Automatic corrupt file recovery (backup + init clean)
- Independent from other IDE JSON configs
"""

import os
import json
import time
import shutil
import logging
import threading
from pathlib import Path
from typing import Dict, Any, Optional

from app.utils.paths import get_user_data_dir

logger = logging.getLogger("app.services.google_sheets.registry")

SCHEMA_VERSION = 1
CONFIG_FILENAME = "google_sheets.json"


def get_default_storage() -> Dict[str, Any]:
    """Return default empty schema structure with one initial default project."""
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return {
        "schemaVersion": SCHEMA_VERSION,
        "projects": [
            {
                "id": "proj_default",
                "name": "Dự án mặc định",
                "description": "Dự án lưu trữ Google Sheets chung",
                "color": "#3B82F6",
                "createdAt": now,
                "updatedAt": now,
                "sheets": []
            }
        ],
        "workspace": {
            "lastProjectId": "proj_default",
            "lastOpenedSheetId": None
        }
    }


class GoogleSheetsRegistry:
    """Manages persistence of Google Sheets metadata in google_sheets.json."""

    def __init__(self, data_file: Optional[Path] = None):
        if data_file:
            self._file_path = Path(data_file).resolve()
        else:
            self._file_path = get_user_data_dir() / CONFIG_FILENAME

        self._lock = threading.RLock()
        self._cache: Optional[Dict[str, Any]] = None
        self._ensure_file_exists()

    @property
    def file_path(self) -> Path:
        return self._file_path

    def _ensure_file_exists(self) -> None:
        """Create initial file if not present."""
        with self._lock:
            self._file_path.parent.mkdir(parents=True, exist_ok=True)
            if not self._file_path.exists():
                logger.info("[Registry] Initializing new storage at: %s", self._file_path)
                self.save(get_default_storage())

    def load(self, force_reload: bool = False) -> Dict[str, Any]:
        """
        Load storage dictionary from file or in-memory cache.
        If file is corrupted, creates a backup and resets to default.
        """
        with self._lock:
            if self._cache is not None and not force_reload:
                return self._cache

            if not self._file_path.exists():
                default_data = get_default_storage()
                self.save(default_data)
                self._cache = default_data
                return self._cache

            try:
                raw_content = self._file_path.read_text(encoding="utf-8")
                if not raw_content.strip():
                    raise ValueError("File trống")
                data = json.loads(raw_content)
                if not isinstance(data, dict):
                    raise ValueError("Dữ liệu gốc phải là JSON Object")

                # Validate minimum required keys
                if "projects" not in data or not isinstance(data["projects"], list):
                    data["projects"] = []
                if "workspace" not in data or not isinstance(data["workspace"], dict):
                    data["workspace"] = {}
                if "schemaVersion" not in data:
                    data["schemaVersion"] = SCHEMA_VERSION

                self._cache = data
                return self._cache

            except Exception as exc:
                logger.error("[Registry] Lỗi đọc %s (%s). Bắt đầu phục hồi an toàn...", self._file_path, exc)
                self._handle_corrupt_file()
                self._cache = get_default_storage()
                self.save(self._cache)
                return self._cache

    def save(self, data: Dict[str, Any]) -> bool:
        """
        Save storage dictionary atomically using temporary file swap.
        """
        with self._lock:
            try:
                self._file_path.parent.mkdir(parents=True, exist_ok=True)
                temp_file = self._file_path.with_name(f"{self._file_path.name}.tmp.{os.getpid()}.{int(time.time()*1000)}")

                serialized = json.dumps(data, ensure_ascii=False, indent=2)
                temp_file.write_text(serialized, encoding="utf-8")

                # Atomic replace
                temp_file.replace(self._file_path)
                self._cache = data
                logger.debug("[Registry] Saved metadata to: %s", self._file_path)
                return True
            except Exception as exc:
                logger.exception("[Registry] Lỗi ghi file cấu hình %s: %s", self._file_path, exc)
                return False

    def _handle_corrupt_file(self) -> None:
        """Backup corrupt file to avoid data loss."""
        try:
            if self._file_path.exists():
                ts = int(time.time())
                backup_path = self._file_path.with_name(f"{self._file_path.name}.corrupt.{ts}")
                shutil.copy2(self._file_path, backup_path)
                logger.warning("[Registry] Đã sao lưu file lỗi thành công: %s", backup_path)
        except Exception as e:
            logger.error("[Registry] Không thể sao lưu file lỗi: %s", e)
