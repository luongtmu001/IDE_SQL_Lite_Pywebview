import base64
import logging
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Tuple, Union
import uuid

from app.utils.paths import get_user_data_dir
from .models import GenSession, WorkbookFileInfo

logger = logging.getLogger("app.services.report_layout_gen.session_store")


def _decode_bytes(file_data: Union[str, Path, bytes]) -> bytes:
    """Decode any representation of file content into raw bytes."""
    if isinstance(file_data, bytes):
        return file_data
    if isinstance(file_data, Path):
        return file_data.read_bytes()
    if isinstance(file_data, str):
        if file_data.startswith("data:") and ";base64," in file_data:
            b64_str = file_data.split(";base64,")[1]
            return base64.b64decode(b64_str)
        if len(file_data) < 260:
            try:
                p = Path(file_data)
                if p.exists() and p.is_file():
                    return p.read_bytes()
            except Exception:
                pass
        try:
            return base64.b64decode(file_data)
        except Exception:
            return Path(file_data).read_bytes()
    raise ValueError(f"Unsupported file data type: {type(file_data)}")


class SessionStore:
    """Manages active wizard sessions with a TTL (default 2 hours)."""

    def __init__(self, ttl_seconds: int = 7200):
        self.ttl_seconds = ttl_seconds
        self._sessions: Dict[str, Tuple[float, GenSession]] = {}
        self._sheet_cache: Dict[Tuple[str, str], Any] = {}
        self._temp_dir = get_user_data_dir() / "temp_report_gen"
        self._temp_dir.mkdir(parents=True, exist_ok=True)

    def get_cached_sheet(self, session_id: str, sheet_name: str, file_id: Optional[str] = None) -> Optional[Any]:
        if file_id:
            res = self._sheet_cache.get((session_id, f"{file_id}::{sheet_name}"))
            if res is not None:
                return res
        return self._sheet_cache.get((session_id, sheet_name))

    def cache_sheet(self, session_id: str, sheet_name: str, sheet_model: Any, file_id: Optional[str] = None) -> None:
        if file_id:
            self._sheet_cache[(session_id, f"{file_id}::{sheet_name}")] = sheet_model
        self._sheet_cache[(session_id, sheet_name)] = sheet_model

    def _save_file_to_disk(
        self,
        session_id: str,
        file_id: str,
        file_bytes_or_path: Union[str, Path, bytes],
        filename: Optional[str] = None,
    ) -> Tuple[Path, int]:
        ext = Path(filename).suffix if filename else ".xlsx"
        if not ext:
            ext = ".xlsx"
        clean_name = Path(filename).stem if filename else file_id
        clean_name = "".join(c for c in clean_name if c.isalnum() or c in ("-", "_", " ")).strip() or file_id
        temp_path = self._temp_dir / f"{session_id}_{file_id}_{clean_name}{ext}"

        content = _decode_bytes(file_bytes_or_path)
        temp_path.write_bytes(content)
        size = len(content)
        return temp_path, size

    def create_session(
        self,
        file_bytes_or_path: Union[str, Path, bytes],
        filename: Optional[str] = None,
    ) -> GenSession:
        """Create and register a new generation session with a single file."""
        return self.create_multi_file_session([{"content": file_bytes_or_path, "filename": filename}])

    def create_multi_file_session(
        self,
        files_data: List[Dict[str, Any]],
    ) -> GenSession:
        """Create a session supporting one or multiple uploaded files."""
        self.cleanup_expired()
        session_id = str(uuid.uuid4())[:8]
        from .workbook_reader import list_sheets

        file_infos: List[WorkbookFileInfo] = []
        for idx, item in enumerate(files_data):
            content = item.get("content")
            fname = item.get("filename") or f"report_{idx + 1}.xlsx"
            fid = f"file_{idx + 1}"
            temp_path, size_bytes = self._save_file_to_disk(session_id, fid, content, fname)
            try:
                sheets = list_sheets(str(temp_path))
            except Exception as e:
                logger.warning("Could not list sheets for %s: %s", fname, e)
                sheets = [{"name": "Sheet1", "max_row": 0, "max_col": 0, "merge_count": 0}]

            sheet_names = [s["name"] if isinstance(s, dict) else str(s) for s in sheets]
            first_sheet_name = sheet_names[0] if sheet_names else "Sheet1"

            file_info = WorkbookFileInfo(
                id=fid,
                filename=fname,
                workbook_path=str(temp_path),
                size_bytes=size_bytes,
                sheets=sheet_names,
                selected_sheet=first_sheet_name,
            )
            file_infos.append(file_info)

        first_file = file_infos[0] if file_infos else None
        session = GenSession(
            id=session_id,
            workbook_path=first_file.workbook_path if first_file else "",
            sheet=first_file.selected_sheet if first_file else None,
            filename=first_file.filename if first_file else None,
            files=file_infos,
            active_file_id=first_file.id if first_file else None,
        )
        self._sessions[session_id] = (time.time(), session)
        return session

    def add_files_to_session(self, session_id: str, files_data: List[Dict[str, Any]]) -> Optional[GenSession]:
        """Add more files to an existing session."""
        session = self.get_session(session_id)
        if not session:
            return None
        from .workbook_reader import list_sheets
        start_idx = len(session.files)
        for idx, item in enumerate(files_data):
            content = item.get("content")
            fname = item.get("filename") or f"report_{start_idx + idx + 1}.xlsx"
            fid = f"file_{start_idx + idx + 1}"
            temp_path, size_bytes = self._save_file_to_disk(session_id, fid, content, fname)
            try:
                sheets = list_sheets(str(temp_path))
            except Exception as e:
                logger.warning("Could not list sheets for %s: %s", fname, e)
                sheets = [{"name": "Sheet1", "max_row": 0, "max_col": 0, "merge_count": 0}]

            sheet_names = [s["name"] if isinstance(s, dict) else str(s) for s in sheets]
            first_sheet_name = sheet_names[0] if sheet_names else "Sheet1"

            file_info = WorkbookFileInfo(
                id=fid,
                filename=fname,
                workbook_path=str(temp_path),
                size_bytes=size_bytes,
                sheets=sheet_names,
                selected_sheet=first_sheet_name,
            )
            session.files.append(file_info)

        self.save_session(session)
        return session

    def remove_file_from_session(self, session_id: str, file_id: str) -> Optional[GenSession]:
        """Remove a file from session and delete its temp file on disk."""
        session = self.get_session(session_id)
        if not session:
            return None
        target = None
        for f in session.files:
            if f.id == file_id:
                target = f
                break
        if target:
            session.files.remove(target)
            try:
                p = Path(target.workbook_path)
                if p.exists():
                    p.unlink()
            except Exception as e:
                logger.warning("Error deleting file %s: %s", target.workbook_path, e)

            # Invalidate sheet caches for this file
            keys_to_remove = [k for k in self._sheet_cache if k[0] == session_id]
            for k in keys_to_remove:
                self._sheet_cache.pop(k, None)

            # If removed active file, switch to another
            if session.active_file_id == file_id:
                if session.files:
                    next_file = session.files[0]
                    session.active_file_id = next_file.id
                    session.workbook_path = next_file.workbook_path
                    session.sheet = next_file.selected_sheet
                    session.filename = next_file.filename
                    session.regions = list(next_file.regions)
                else:
                    session.active_file_id = None
                    session.workbook_path = ""
                    session.sheet = None
                    session.filename = None
                    session.regions = []

        self.save_session(session)
        return session

    def set_active_file(self, session_id: str, file_id: str) -> Optional[WorkbookFileInfo]:
        """Switch active file in session, saving previous state."""
        session = self.get_session(session_id)
        if not session:
            return None
        for f in session.files:
            if f.id == file_id:
                if session.active_file_id:
                    for old_f in session.files:
                        if old_f.id == session.active_file_id:
                            old_f.regions = list(session.regions)
                            if session.sheet:
                                old_f.sheet_regions[session.sheet] = list(session.regions)
                            old_f.selected_sheet = session.sheet
                            break
                session.active_file_id = f.id
                session.workbook_path = f.workbook_path

                sheet_name = f.selected_sheet
                if not sheet_name:
                    if f.sheets:
                        first = f.sheets[0]
                        sheet_name = first["name"] if isinstance(first, dict) else str(first)
                    else:
                        sheet_name = "Sheet1"

                session.sheet = sheet_name
                session.filename = f.filename
                if sheet_name in f.sheet_regions:
                    session.regions = list(f.sheet_regions[sheet_name])
                else:
                    session.regions = list(f.regions)
                self.save_session(session)
                return f
        return None

    def get_session(self, session_id: str) -> Optional[GenSession]:
        """Retrieve a session if still valid."""
        self.cleanup_expired()
        item = self._sessions.get(session_id)
        if not item:
            return None
        created_at, session = item
        if time.time() - created_at > self.ttl_seconds:
            self.delete_session(session_id)
            return None
        # Touch timestamp
        self._sessions[session_id] = (time.time(), session)
        return session

    def save_session(self, session: GenSession) -> None:
        """Update session state and refresh TTL."""
        self._sessions[session.id] = (time.time(), session)

    def delete_session(self, session_id: str) -> None:
        """Remove a session and delete all its temp files."""
        keys_to_remove = [k for k in self._sheet_cache if k[0] == session_id]
        for k in keys_to_remove:
            self._sheet_cache.pop(k, None)

        item = self._sessions.pop(session_id, None)
        if item:
            _, session = item
            for f in session.files:
                try:
                    p = Path(f.workbook_path)
                    if p.exists() and p.is_file():
                        p.unlink()
                except Exception as exc:
                    logger.warning("Failed to delete temp workbook %s: %s", f.workbook_path, exc)
            try:
                p = Path(session.workbook_path)
                if p.exists() and p.is_file():
                    p.unlink()
            except Exception:
                pass

    def cleanup_expired(self) -> None:
        """Purge sessions older than TTL."""
        now = time.time()
        expired_ids = [sid for sid, (ts, _) in self._sessions.items() if now - ts > self.ttl_seconds]
        for sid in expired_ids:
            self.delete_session(sid)


# Default singleton
_default_session_store: Optional[SessionStore] = None


def get_session_store() -> SessionStore:
    global _default_session_store
    if _default_session_store is None:
        _default_session_store = SessionStore()
    return _default_session_store
