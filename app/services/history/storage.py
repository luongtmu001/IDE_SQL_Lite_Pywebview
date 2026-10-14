"""
SQLite Storage Engine for Query History (Phase 1) — luoBTool IDE

Triển khai IHistoryStore:
- SQLite cục bộ (WAL mode, NORMAL synchronous, INCREMENTAL auto_vacuum)
- Schema versioning & migration qua PRAGMA user_version
- Dedup theo SHA-256 hash (Bảng Content)
- Nén zlib cho Body SQL (~70-90% tiết kiệm dung lượng)
- Gộp RunCount cho các lần chạy liên tiếp giống hệt
- Quản lý RefCount tự động và xóa an toàn
- Hỗ trợ đa luồng an toàn (threading.RLock)
"""

import os
import re
import time
import zlib
import hashlib
import sqlite3
import logging
import threading
from typing import Optional, List, Dict, Any, Tuple

logger = logging.getLogger("app.services.history.storage")

SCHEMA_VERSION = 3


def normalize_sql_text(sql: str) -> str:
    """Chuẩn hóa ký tự xuống dòng EOL (\\r\\n -> \\n, \\r -> \\n).
    Bảo toàn toàn bộ khoảng trắng và thụt lề bên trong code.
    """
    if not sql:
        return ""
    return sql.replace("\r\n", "\n").replace("\r", "\n")


def is_trivial_query(sql: str) -> bool:
    """Kiểm tra xem câu SQL có rỗng hoặc chỉ chứa khoảng trắng/comment không.
    Nếu rỗng hoặc chỉ có comment thì không cần lưu vào history.
    """
    if not sql:
        return True
    
    # Loại bỏ single-line comments (-- ...) và multi-line comments (/* ... */)
    cleaned = re.sub(r'--[^\n]*', '', sql)
    cleaned = re.sub(r'/\*[\s\S]*?\*/', '', cleaned)
    
    return len(cleaned.strip()) == 0


def compute_sha256(text: str) -> str:
    """Tính toán SHA-256 hash dạng hex string 64 ký tự."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compress_text(text: str, level: int = 6) -> bytes:
    """Nén văn bản UTF-8 bằng zlib."""
    return zlib.compress(text.encode("utf-8"), level=level)


def decompress_text(blob: bytes) -> str:
    """Giải nén blob zlib thành văn bản UTF-8."""
    if not blob:
        return ""
    return zlib.decompress(blob).decode("utf-8")


def normalize_file_path(path: Optional[str]) -> Optional[str]:
    """Chuẩn hóa đường dẫn file: chuyển tất cả dấu gạch chéo thành '/' để đồng nhất so sánh trên Windows."""
    if not path:
        return None
    try:
        return os.path.normpath(path).replace("\\", "/")
    except Exception:
        return str(path).replace("\\", "/")


def _sqlite_decompress(blob: Optional[bytes]) -> str:
    """Hàm giải nén an toàn được nhúng trực tiếp vào SQLite để tìm kiếm toàn văn nội dung SQL."""
    if not blob:
        return ""
    try:
        return zlib.decompress(blob).decode("utf-8", errors="ignore")
    except Exception:
        return ""


class HistoryStore:
    """SQLite Storage Engine quản lý Query History."""

    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
            data_dir = os.path.join(base_dir, "data")
            os.makedirs(data_dir, exist_ok=True)
            db_path = os.path.join(data_dir, "history.db")

        self.db_path = os.path.abspath(db_path)
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

        self._lock = threading.RLock()
        self._init_database()

    def _get_connection(self) -> sqlite3.Connection:
        """Tạo kết nối SQLite cấu hình tối ưu hiệu năng và an toàn dữ liệu."""
        conn = sqlite3.connect(
            self.db_path,
            timeout=5.0,
            check_same_thread=False
        )
        conn.row_factory = sqlite3.Row
        conn.create_function("decompress_sql", 1, _sqlite_decompress)
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA auto_vacuum = INCREMENTAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        return conn

    def _init_database(self):
        """Khởi tạo schema và migration qua PRAGMA user_version."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("PRAGMA user_version;")
                current_version = cur.fetchone()[0]

                if current_version < 1:
                    # 1. Bảng Document (mỗi tab/file là 1 dòng)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS Document (
                            DocId        TEXT PRIMARY KEY,
                            DisplayName  TEXT NOT NULL,
                            FilePath     TEXT NULL,
                            IsStarred    INTEGER NOT NULL DEFAULT 0,
                            CreatedAt    INTEGER NOT NULL,
                            LastRunAt    INTEGER NOT NULL,
                            LastServer   TEXT NULL,
                            LastDatabase TEXT NULL,
                            IsDeleted    INTEGER NOT NULL DEFAULT 0
                        );
                    """)
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_Document_LastRunAt ON Document(LastRunAt DESC);")
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_Document_FilePath ON Document(FilePath);")
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_Document_Starred ON Document(IsStarred, LastRunAt DESC);")

                    # 2. Bảng Content (lưu nội dung SQL 1 lần duy nhất theo SHA-256)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS Content (
                            Hash       TEXT PRIMARY KEY,
                            Body       BLOB NOT NULL,
                            RawSize    INTEGER NOT NULL,
                            RefCount   INTEGER NOT NULL DEFAULT 0
                        );
                    """)

                    # 3. Bảng HistoryEntry (mỗi lần F5 hoặc snapshot)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS HistoryEntry (
                            EntryId      INTEGER PRIMARY KEY AUTOINCREMENT,
                            DocId        TEXT NOT NULL REFERENCES Document(DocId) ON DELETE CASCADE,
                            ContentHash  TEXT NOT NULL REFERENCES Content(Hash),
                            EntryType    INTEGER NOT NULL,
                            ExecutedAt   INTEGER NOT NULL,
                            Server       TEXT NOT NULL,
                            DatabaseName TEXT NOT NULL,
                            LoginName    TEXT NULL,
                            IsSelection  INTEGER NOT NULL DEFAULT 0,
                            DurationMs   INTEGER NULL,
                            Status       INTEGER NULL,
                            ErrorSummary TEXT NULL,
                            RunCount     INTEGER NOT NULL DEFAULT 1,
                            Note         TEXT NULL,
                            Tag          TEXT NULL
                        );
                    """)
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_History_Doc_Time ON HistoryEntry(DocId, ExecutedAt DESC);")
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_History_ExecutedAt ON HistoryEntry(ExecutedAt DESC);")
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_History_ContentHash ON HistoryEntry(ContentHash);")
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_History_Server_Db ON HistoryEntry(Server, DatabaseName);")
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_History_Tag ON HistoryEntry(Tag);")

                if current_version < 2:
                    # Migration to Phase 5: Ghi chú (Note), Nhãn (Tag), Bộ lọc nâng cao
                    cur.execute("PRAGMA table_info(HistoryEntry);")
                    cols = {row[1] for row in cur.fetchall()}
                    if "Note" not in cols:
                        cur.execute("ALTER TABLE HistoryEntry ADD COLUMN Note TEXT NULL;")
                    if "Tag" not in cols:
                        cur.execute("ALTER TABLE HistoryEntry ADD COLUMN Tag TEXT NULL;")
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_History_Server_Db ON HistoryEntry(Server, DatabaseName);")
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_History_Tag ON HistoryEntry(Tag);")

                if current_version < 3:
                    # Migration to Version 3: Yêu thích (IsFavorite) & Đa nhãn (Tag / HistoryTag)
                    cur.execute("PRAGMA table_info(HistoryEntry);")
                    cols = {row[1] for row in cur.fetchall()}
                    if "IsFavorite" not in cols:
                        cur.execute("ALTER TABLE HistoryEntry ADD COLUMN IsFavorite INTEGER NOT NULL DEFAULT 0;")

                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS Tag (
                            TagId     INTEGER PRIMARY KEY AUTOINCREMENT,
                            TagName   TEXT UNIQUE NOT NULL,
                            Color     TEXT NULL,
                            CreatedAt INTEGER NOT NULL
                        );
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS HistoryTag (
                            EntryId   INTEGER NOT NULL REFERENCES HistoryEntry(EntryId) ON DELETE CASCADE,
                            TagId     INTEGER NOT NULL REFERENCES Tag(TagId) ON DELETE CASCADE,
                            CreatedAt INTEGER NOT NULL,
                            PRIMARY KEY (EntryId, TagId)
                        );
                    """)
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_History_IsFavorite ON HistoryEntry(IsFavorite, ExecutedAt DESC);")
                    cur.execute("CREATE INDEX IF NOT EXISTS IX_HistoryTag_TagId ON HistoryTag(TagId);")

                    # Di chuyển an toàn dữ liệu nhãn cũ từ HistoryEntry.Tag sang Tag & HistoryTag
                    try:
                        cur.execute("SELECT EntryId, Tag, ExecutedAt FROM HistoryEntry WHERE Tag IS NOT NULL AND TRIM(Tag) != '';")
                        old_rows = cur.fetchall()
                        now_ms = int(time.time() * 1000)
                        for r in old_rows:
                            e_id = r["EntryId"]
                            t_raw = r["Tag"].strip()
                            t_time = r["ExecutedAt"] or now_ms
                            tag_parts = [p.strip() for p in re.split(r'[,;]', t_raw) if p.strip()]
                            for t_name in tag_parts:
                                cur.execute("INSERT OR IGNORE INTO Tag (TagName, CreatedAt) VALUES (?, ?);", (t_name, t_time))
                                cur.execute("SELECT TagId FROM Tag WHERE TagName = ?;", (t_name,))
                                t_row = cur.fetchone()
                                if t_row:
                                    cur.execute("INSERT OR IGNORE INTO HistoryTag (EntryId, TagId, CreatedAt) VALUES (?, ?, ?);", (e_id, t_row[0], t_time))
                    except Exception as tag_mig_err:
                        logger.warning("[HistoryStore] Tag migration warning: %s", tag_mig_err)

                cur.execute(f"PRAGMA user_version = {SCHEMA_VERSION};")
                conn.commit()

    # ── Core Operations ───────────────────────────────────────────────────────

    def add_entry(
        self,
        doc_id: str,
        display_name: str,
        sql: str,
        server: str,
        database: str,
        login: Optional[str] = None,
        file_path: Optional[str] = None,
        is_selection: bool = False,
        entry_type: int = 1, # 1=Execution (F5), 2=Snapshot
        duration_ms: Optional[int] = None,
        status: Optional[int] = None, # 0=OK, 1=Error, 2=Cancelled
        error_summary: Optional[str] = None,
        executed_at: Optional[int] = None,
        max_entry_size: int = 1048576, # 1 MB
        note: Optional[str] = None,
        tag: Optional[str] = None,
        is_favorite: bool = False
    ) -> Optional[Dict[str, Any]]:
        """Ghi nhận một lượt thực thi/snapshot vào History.
        
        Quy trình:
        1. Chuẩn hóa EOL.
        2. Bỏ qua nếu rỗng/chỉ có comment.
        3. Cắt ngắn nếu vượt MaxEntrySize (giữ 64KB đầu).
        4. Tính SHA-256 hash.
        5. Nếu lần chạy trước của DocId cùng hash, server, database, is_selection -> gộp RunCount + 1.
        6. Nếu khác -> Thêm Content (hoặc tăng RefCount) và chèn HistoryEntry mới.
        7. Cập nhật Document (LastRunAt, LastServer, LastDatabase).
        """
        normalized = normalize_sql_text(sql)
        if is_trivial_query(normalized):
            return None

        # Truncate nếu vượt quá kích thước tối đa 1 MB
        if len(normalized.encode("utf-8")) > max_entry_size:
            normalized = normalized[:65536] + "\n-- [TRUNCATED: Script vượt quá giới hạn 1 MB] --\n"

        content_hash = compute_sha256(normalized)
        now_ms = executed_at if executed_at is not None else int(time.time() * 1000)
        clean_error = (error_summary[:300] if error_summary else None)
        clean_note = (note.strip() if note else None)
        clean_tag = (tag.strip() if tag else None)
        is_sel_val = 1 if is_selection else 0
        is_fav_val = 1 if is_favorite else 0

        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()

                # 1. Upsert Document
                clean_fp = normalize_file_path(file_path)
                cur.execute("SELECT DocId, FilePath, DisplayName FROM Document WHERE DocId = ?;", (doc_id,))
                doc_row = cur.fetchone()
                if doc_row is None:
                    cur.execute("""
                        INSERT INTO Document (
                            DocId, DisplayName, FilePath, IsStarred, CreatedAt,
                            LastRunAt, LastServer, LastDatabase, IsDeleted
                        ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0);
                    """, (doc_id, display_name, clean_fp, now_ms, now_ms, server, database))
                else:
                    new_fp = clean_fp if clean_fp is not None else doc_row["FilePath"]
                    new_dn = display_name if display_name else doc_row["DisplayName"]
                    cur.execute("""
                        UPDATE Document
                        SET DisplayName = ?,
                            FilePath = ?,
                            LastRunAt = ?,
                            LastServer = ?,
                            LastDatabase = ?,
                            IsDeleted = 0
                        WHERE DocId = ?;
                    """, (new_dn, new_fp, now_ms, server, database, doc_id))

                # 2. Kiểm tra gộp lần chạy liên tiếp giống hệt (RunCount)
                cur.execute("""
                    SELECT EntryId, ContentHash, Server, DatabaseName, IsSelection, EntryType, RunCount
                    FROM HistoryEntry
                    WHERE DocId = ?
                    ORDER BY ExecutedAt DESC, EntryId DESC
                    LIMIT 1;
                """, (doc_id,))
                last_entry = cur.fetchone()

                if (
                    last_entry is not None
                    and last_entry["ContentHash"] == content_hash
                    and last_entry["Server"] == server
                    and last_entry["DatabaseName"] == database
                    and last_entry["IsSelection"] == is_sel_val
                    and last_entry["EntryType"] == entry_type
                ):
                    # Gộp: UPDATE entry đó (tăng RunCount, cập nhật thời điểm và kết quả mới nhất)
                    new_run_count = last_entry["RunCount"] + 1
                    target_entry_id = last_entry["EntryId"]
                    cur.execute("""
                        UPDATE HistoryEntry
                        SET RunCount = ?,
                            ExecutedAt = ?,
                            DurationMs = COALESCE(?, DurationMs),
                            Status = COALESCE(?, Status),
                            ErrorSummary = COALESCE(?, ErrorSummary),
                            Note = COALESCE(?, Note),
                            Tag = COALESCE(?, Tag)
                        WHERE EntryId = ?;
                    """, (new_run_count, now_ms, duration_ms, status, clean_error, clean_note, clean_tag, target_entry_id))

                    if clean_tag:
                        tag_parts = [p.strip() for p in re.split(r'[,;]', clean_tag) if p.strip()]
                        for t_name in tag_parts:
                            cur.execute("INSERT OR IGNORE INTO Tag (TagName, CreatedAt) VALUES (?, ?);", (t_name, now_ms))
                            cur.execute("SELECT TagId FROM Tag WHERE TagName = ?;", (t_name,))
                            t_row = cur.fetchone()
                            if t_row:
                                cur.execute("INSERT OR IGNORE INTO HistoryTag (EntryId, TagId, CreatedAt) VALUES (?, ?, ?);", (target_entry_id, t_row[0], now_ms))

                    conn.commit()

                    return {
                        "entry_id": target_entry_id,
                        "doc_id": doc_id,
                        "content_hash": content_hash,
                        "is_new": False,
                        "run_count": new_run_count,
                        "executed_at": now_ms
                    }

                # 3. Tạo Entry mới -> Quản lý bảng Content (Dedup theo SHA-256)
                cur.execute("SELECT Hash, RefCount FROM Content WHERE Hash = ?;", (content_hash,))
                content_row = cur.fetchone()

                if content_row is None:
                    compressed_body = compress_text(normalized)
                    raw_size = len(normalized.encode("utf-8"))
                    cur.execute("""
                        INSERT INTO Content (Hash, Body, RawSize, RefCount)
                        VALUES (?, ?, ?, 1);
                    """, (content_hash, compressed_body, raw_size))
                else:
                    cur.execute("""
                        UPDATE Content
                        SET RefCount = RefCount + 1
                        WHERE Hash = ?;
                    """, (content_hash,))

                # 4. Chèn HistoryEntry mới
                cur.execute("""
                    INSERT INTO HistoryEntry (
                        DocId, ContentHash, EntryType, ExecutedAt, Server,
                        DatabaseName, LoginName, IsSelection, DurationMs,
                        Status, ErrorSummary, RunCount, Note, Tag, IsFavorite
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?);
                """, (
                    doc_id, content_hash, entry_type, now_ms, server,
                    database, login, is_sel_val, duration_ms, status, clean_error,
                    clean_note, clean_tag, is_fav_val
                ))

                new_entry_id = cur.lastrowid

                if clean_tag:
                    tag_parts = [p.strip() for p in re.split(r'[,;]', clean_tag) if p.strip()]
                    for t_name in tag_parts:
                        cur.execute("INSERT OR IGNORE INTO Tag (TagName, CreatedAt) VALUES (?, ?);", (t_name, now_ms))
                        cur.execute("SELECT TagId FROM Tag WHERE TagName = ?;", (t_name,))
                        t_row = cur.fetchone()
                        if t_row:
                            cur.execute("INSERT OR IGNORE INTO HistoryTag (EntryId, TagId, CreatedAt) VALUES (?, ?, ?);", (new_entry_id, t_row[0], now_ms))

                conn.commit()

                return {
                    "entry_id": new_entry_id,
                    "doc_id": doc_id,
                    "content_hash": content_hash,
                    "is_new": True,
                    "run_count": 1,
                    "executed_at": now_ms
                }

    record_execution = add_entry

    def update_entry_result(
        self,
        entry_id: int,
        duration_ms: Optional[int] = None,
        status: Optional[int] = None,
        error_summary: Optional[str] = None
    ) -> bool:
        """Cập nhật kết quả thực thi (thời gian chạy, trạng thái, lỗi) sau khi câu query chạy xong."""
        clean_error = error_summary[:300] if error_summary else None
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("""
                    UPDATE HistoryEntry
                    SET DurationMs = COALESCE(?, DurationMs),
                        Status = COALESCE(?, Status),
                        ErrorSummary = ?
                    WHERE EntryId = ?;
                """, (duration_ms, status, clean_error, entry_id))
                updated = cur.rowcount > 0
                conn.commit()
                return updated

    def get_documents(
        self,
        search: Optional[str] = None,
        favorites_only: bool = False,
        include_deleted: bool = False,
        server: Optional[str] = None,
        database: Optional[str] = None,
        from_timestamp: Optional[int] = None,
        to_timestamp: Optional[int] = None,
        limit: int = 200
    ) -> List[Dict[str, Any]]:
        """Lấy danh sách Document kèm số lần thực thi (entry_count) và hỗ trợ lọc nâng cao."""
        query = """
            SELECT 
                d.DocId,
                d.DisplayName,
                d.FilePath,
                d.IsStarred,
                d.CreatedAt,
                d.LastRunAt,
                d.LastServer,
                d.LastDatabase,
                d.IsDeleted,
                COUNT(h.EntryId) AS EntryCount
            FROM Document d
            LEFT JOIN HistoryEntry h ON h.DocId = d.DocId
            WHERE 1=1
        """
        params = []

        if not include_deleted:
            query += " AND d.IsDeleted = 0"

        if favorites_only:
            query += " AND d.IsStarred = 1"

        if server:
            query += " AND (LOWER(COALESCE(d.LastServer, '')) = LOWER(?) OR d.DocId IN (SELECT DISTINCT DocId FROM HistoryEntry WHERE LOWER(Server) = LOWER(?)))"
            params.extend([server, server])

        if database:
            query += " AND (LOWER(COALESCE(d.LastDatabase, '')) = LOWER(?) OR d.DocId IN (SELECT DISTINCT DocId FROM HistoryEntry WHERE LOWER(DatabaseName) = LOWER(?)))"
            params.extend([database, database])

        if from_timestamp is not None:
            query += " AND d.LastRunAt >= ?"
            params.append(from_timestamp)

        if to_timestamp is not None:
            query += " AND d.LastRunAt <= ?"
            params.append(to_timestamp)

        if search:
            s = f"%{search.strip().lower()}%"
            query += """ AND (
                LOWER(d.DisplayName) LIKE ? 
                OR LOWER(COALESCE(d.FilePath, '')) LIKE ? 
                OR LOWER(COALESCE(d.LastServer, '')) LIKE ? 
                OR LOWER(COALESCE(d.LastDatabase, '')) LIKE ?
                OR d.DocId IN (
                    SELECT DISTINCT h_sub.DocId 
                    FROM HistoryEntry h_sub 
                    JOIN Content c_sub ON h_sub.ContentHash = c_sub.Hash 
                    WHERE LOWER(decompress_sql(c_sub.Body)) LIKE ?
                )
            )"""
            params.extend([s, s, s, s, s])

        query += """
            GROUP BY d.DocId
            ORDER BY d.IsStarred DESC, d.LastRunAt DESC
            LIMIT ?;
        """
        params.append(limit)

        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute(query, params)
                rows = cur.fetchall()
                return [dict(r) for r in rows]

    def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        """Lấy thông tin một Document theo doc_id."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT * FROM Document WHERE DocId = ?;", (doc_id,))
                row = cur.fetchone()
                return dict(row) if row else None

    def get_document_by_path(self, file_path: str) -> Optional[Dict[str, Any]]:
        """Tìm Document theo đường dẫn file trên đĩa (để tái sử dụng DocId khi mở lại file)."""
        if not file_path:
            return None
        norm_path = normalize_file_path(file_path).lower()
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT * FROM Document 
                    WHERE (LOWER(FilePath) = ? OR REPLACE(LOWER(FilePath), '\\', '/') = ?) AND IsDeleted = 0
                    ORDER BY LastRunAt DESC
                    LIMIT 1;
                """, (norm_path, norm_path))
                row = cur.fetchone()
                return dict(row) if row else None

    def update_document(
        self,
        doc_id: str,
        display_name: Optional[str] = None,
        file_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """Cập nhật DisplayName hoặc FilePath của Document (khi Save, Save As, Rename).
        Nếu file_path đã liên kết với một Document khác trên đĩa:
        - Tự động gộp toàn bộ HistoryEntry của doc_id sang Document đích đó.
        - Xóa Document nguồn (doc_id) nếu không còn tham chiếu.
        - Trả về effective doc_id và cờ merged.
        """
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT * FROM Document WHERE DocId = ?;", (doc_id,))
                current_doc = cur.fetchone()

                norm_fp = normalize_file_path(file_path)

                if norm_fp:
                    # Kiểm tra xem có Document nào khác đã gắn đường dẫn file này không
                    cur.execute("""
                        SELECT DocId, DisplayName FROM Document 
                        WHERE (LOWER(FilePath) = ? OR REPLACE(LOWER(FilePath), '\\', '/') = ?) 
                          AND DocId != ? AND IsDeleted = 0
                        LIMIT 1;
                    """, (norm_fp.lower(), norm_fp.lower(), doc_id))
                    existing_doc = cur.fetchone()

                    if existing_doc:
                        target_id = existing_doc["DocId"]
                        # Gộp các HistoryEntry từ doc_id sang target_id
                        cur.execute("UPDATE HistoryEntry SET DocId = ? WHERE DocId = ?;", (target_id, doc_id))
                        
                        # Cập nhật LastRunAt và DisplayName cho target_id
                        cur.execute("""
                            UPDATE Document 
                            SET DisplayName = COALESCE(?, DisplayName),
                                FilePath = ?,
                                LastRunAt = MAX(LastRunAt, COALESCE((SELECT MAX(ExecutedAt) FROM HistoryEntry WHERE DocId = ?), LastRunAt))
                            WHERE DocId = ?;
                        """, (display_name, norm_fp, target_id, target_id))

                        # Xóa doc_id cũ nếu không còn entry
                        cur.execute("DELETE FROM Document WHERE DocId = ?;", (doc_id,))
                        conn.commit()

                        return {
                            "success": True,
                            "doc_id": target_id,
                            "target_doc_id": target_id,
                            "display_name": display_name or existing_doc["DisplayName"],
                            "file_path": norm_fp,
                            "merged": True
                        }

                # Trường hợp không gộp: tạo mới nếu chưa có hoặc cập nhật nếu đã có
                if current_doc is None:
                    now_ms = int(time.time() * 1000)
                    cur.execute("""
                        INSERT INTO Document (
                            DocId, DisplayName, FilePath, IsStarred, CreatedAt,
                            LastRunAt, LastServer, LastDatabase, IsDeleted
                        ) VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, 0);
                    """, (doc_id, display_name or "Untitled.sql", norm_fp, now_ms, now_ms))
                else:
                    cur.execute("""
                        UPDATE Document 
                        SET DisplayName = COALESCE(?, DisplayName),
                            FilePath = COALESCE(?, FilePath)
                        WHERE DocId = ?;
                    """, (display_name, norm_fp, doc_id))

                conn.commit()
                return {
                    "success": True,
                    "doc_id": doc_id,
                    "target_doc_id": doc_id,
                    "display_name": display_name or (current_doc["DisplayName"] if current_doc else "Untitled.sql"),
                    "file_path": norm_fp or (current_doc["FilePath"] if current_doc else None),
                    "merged": False
                }


    def toggle_star(self, doc_id: str, is_starred: Optional[bool] = None) -> bool:
        """Bật/tắt trạng thái yêu thích (Favorite) của document."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                if is_starred is None:
                    cur.execute("SELECT IsStarred FROM Document WHERE DocId = ?;", (doc_id,))
                    row = cur.fetchone()
                    if not row:
                        return False
                    new_val = 0 if row["IsStarred"] else 1
                else:
                    new_val = 1 if is_starred else 0

                cur.execute("UPDATE Document SET IsStarred = ? WHERE DocId = ?;", (new_val, doc_id))
                conn.commit()
                return bool(new_val)

    def set_entry_favorite(self, entry_id: int, is_favorite: Optional[bool] = None) -> bool:
        """Bật/tắt trạng thái yêu thích (Favorite) cho một lượt thực thi/entry."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                if is_favorite is None:
                    cur.execute("SELECT IsFavorite FROM HistoryEntry WHERE EntryId = ?;", (entry_id,))
                    row = cur.fetchone()
                    if not row:
                        return False
                    new_val = 0 if row["IsFavorite"] else 1
                else:
                    new_val = 1 if is_favorite else 0

                cur.execute("UPDATE HistoryEntry SET IsFavorite = ? WHERE EntryId = ?;", (new_val, entry_id))
                conn.commit()
                return bool(new_val)

    def add_entry_tag(self, entry_id: int, tag_name: str, color: Optional[str] = None) -> bool:
        """Gắn nhãn (Tag) cho một HistoryEntry."""
        if not tag_name or not str(tag_name).strip():
            return False
        clean_name = str(tag_name).strip()
        now_ms = int(time.time() * 1000)

        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT EntryId FROM HistoryEntry WHERE EntryId = ?;", (entry_id,))
                if not cur.fetchone():
                    return False

                cur.execute("INSERT OR IGNORE INTO Tag (TagName, Color, CreatedAt) VALUES (?, ?, ?);", (clean_name, color, now_ms))
                cur.execute("SELECT TagId FROM Tag WHERE TagName = ?;", (clean_name,))
                t_row = cur.fetchone()
                if not t_row:
                    return False
                tag_id = t_row[0]

                cur.execute("INSERT OR IGNORE INTO HistoryTag (EntryId, TagId, CreatedAt) VALUES (?, ?, ?);", (entry_id, tag_id, now_ms))

                cur.execute("""
                    SELECT GROUP_CONCAT(t.TagName, ', ') 
                    FROM HistoryTag ht 
                    JOIN Tag t ON t.TagId = ht.TagId 
                    WHERE ht.EntryId = ?;
                """, (entry_id,))
                all_tags_str = cur.fetchone()[0] or clean_name
                cur.execute("UPDATE HistoryEntry SET Tag = ? WHERE EntryId = ?;", (all_tags_str, entry_id))

                conn.commit()
                return True

    def remove_entry_tag(self, entry_id: int, tag_name: str) -> bool:
        """Gỡ một nhãn (Tag) khỏi một HistoryEntry."""
        if not tag_name or not str(tag_name).strip():
            return False
        clean_name = str(tag_name).strip()

        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT TagId FROM Tag WHERE LOWER(TagName) = LOWER(?);", (clean_name,))
                t_row = cur.fetchone()
                if not t_row:
                    return False
                tag_id = t_row[0]

                cur.execute("DELETE FROM HistoryTag WHERE EntryId = ? AND TagId = ?;", (entry_id, tag_id))

                cur.execute("""
                    SELECT GROUP_CONCAT(t.TagName, ', ') 
                    FROM HistoryTag ht 
                    JOIN Tag t ON t.TagId = ht.TagId 
                    WHERE ht.EntryId = ?;
                """, (entry_id,))
                res_tags = cur.fetchone()
                all_tags_str = res_tags[0] if res_tags else None
                cur.execute("UPDATE HistoryEntry SET Tag = ? WHERE EntryId = ?;", (all_tags_str, entry_id))

                conn.commit()
                return True

    def get_entry_tags(self, entry_id: int) -> List[Dict[str, Any]]:
        """Lấy danh sách các nhãn (Tag) của một HistoryEntry."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT t.TagId, t.TagName, t.Color, ht.CreatedAt
                    FROM HistoryTag ht
                    JOIN Tag t ON t.TagId = ht.TagId
                    WHERE ht.EntryId = ?
                    ORDER BY t.TagName;
                """, (entry_id,))
                return [dict(r) for r in cur.fetchall()]

    def get_all_tags(self) -> List[Dict[str, Any]]:
        """Lấy danh sách toàn bộ nhãn (Tag) cùng số lượt sử dụng."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT t.TagId, t.TagName, t.Color, COUNT(ht.EntryId) AS UsageCount
                    FROM Tag t
                    LEFT JOIN HistoryTag ht ON ht.TagId = t.TagId
                    GROUP BY t.TagId
                    ORDER BY UsageCount DESC, t.TagName ASC;
                """)
                return [dict(r) for r in cur.fetchall()]

    def get_entries(
        self,
        doc_id: str,
        status_filter: Optional[int] = None,
        search: Optional[str] = None,
        server: Optional[str] = None,
        database: Optional[str] = None,
        from_timestamp: Optional[int] = None,
        to_timestamp: Optional[int] = None,
        tag: Optional[str] = None,
        entry_type: Optional[int] = None,
        favorite_only: bool = False,
        is_favorite: Optional[bool] = None,
        limit: int = 200
    ) -> List[Dict[str, Any]]:
        """Lấy danh sách các lần thực thi của một Document (hỗ trợ lọc theo trạng thái, server, db, thời gian, tag, loại, yêu thích)."""
        query = """
            SELECT 
                h.EntryId, h.DocId, h.ContentHash, h.EntryType, h.ExecutedAt,
                h.Server, h.DatabaseName, h.LoginName, h.IsSelection,
                h.DurationMs, h.Status, h.ErrorSummary, h.RunCount,
                h.Note, h.Tag, h.IsFavorite,
                (
                    SELECT GROUP_CONCAT(t.TagName, '||')
                    FROM HistoryTag ht
                    JOIN Tag t ON t.TagId = ht.TagId
                    WHERE ht.EntryId = h.EntryId
                ) AS TagList
            FROM HistoryEntry h
            WHERE h.DocId = ?
        """
        params = [doc_id]

        if status_filter is not None:
            query += " AND h.Status = ?"
            params.append(status_filter)

        if favorite_only or is_favorite is True:
            query += " AND h.IsFavorite = 1"
        elif is_favorite is False:
            query += " AND h.IsFavorite = 0"

        if server:
            query += " AND LOWER(h.Server) = LOWER(?)"
            params.append(server)

        if database:
            query += " AND LOWER(h.DatabaseName) = LOWER(?)"
            params.append(database)

        if from_timestamp is not None:
            query += " AND h.ExecutedAt >= ?"
            params.append(from_timestamp)

        if to_timestamp is not None:
            query += " AND h.ExecutedAt <= ?"
            params.append(to_timestamp)

        if tag:
            query += """ AND (
                LOWER(COALESCE(h.Tag, '')) = LOWER(?)
                OR h.EntryId IN (
                    SELECT ht_sub.EntryId FROM HistoryTag ht_sub
                    JOIN Tag t_sub ON t_sub.TagId = ht_sub.TagId
                    WHERE LOWER(t_sub.TagName) = LOWER(?)
                )
            )"""
            params.extend([tag, tag])

        if entry_type is not None:
            query += " AND h.EntryType = ?"
            params.append(entry_type)

        if search:
            s = f"%{search.strip().lower()}%"
            query += """ AND (
                LOWER(COALESCE(h.ErrorSummary, '')) LIKE ?
                OR LOWER(COALESCE(h.Server, '')) LIKE ?
                OR LOWER(COALESCE(h.DatabaseName, '')) LIKE ?
                OR LOWER(COALESCE(h.Note, '')) LIKE ?
                OR LOWER(COALESCE(h.Tag, '')) LIKE ?
                OR h.ContentHash IN (
                    SELECT Hash FROM Content WHERE LOWER(decompress_sql(Body)) LIKE ?
                )
            )"""
            params.extend([s, s, s, s, s, s])

        query += " ORDER BY h.ExecutedAt DESC, h.EntryId DESC LIMIT ?;"
        params.append(limit)

        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute(query, params)
                rows = cur.fetchall()
                results = []
                for r in rows:
                    item = dict(r)
                    tag_list_str = item.pop("TagList", None)
                    if tag_list_str:
                        item["Tags"] = [t for t in tag_list_str.split("||") if t]
                    elif item.get("Tag"):
                        item["Tags"] = [p.strip() for p in re.split(r'[,;]', item["Tag"]) if p.strip()]
                    else:
                        item["Tags"] = []
                    results.append(item)
                return results

    def get_content(self, content_hash: str) -> Optional[str]:
        """Lấy và giải nén nội dung SQL tương ứng với SHA-256 hash."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT Body FROM Content WHERE Hash = ?;", (content_hash,))
                row = cur.fetchone()
                if not row or not row["Body"]:
                    return None
                return decompress_text(row["Body"])

    def get_entry_detail(self, entry_id: int) -> Optional[Dict[str, Any]]:
        """Lấy thông tin chi tiết một HistoryEntry cùng nội dung SQL đã giải nén và danh sách Tags."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT 
                        h.EntryId, h.DocId, h.ContentHash, h.EntryType, h.ExecutedAt,
                        h.Server, h.DatabaseName, h.LoginName, h.IsSelection,
                        h.DurationMs, h.Status, h.ErrorSummary, h.RunCount,
                        h.Note, h.Tag, h.IsFavorite,
                        c.RawSize, c.Body,
                        d.DisplayName, d.FilePath, d.IsStarred
                    FROM HistoryEntry h
                    JOIN Content c ON c.Hash = h.ContentHash
                    JOIN Document d ON d.DocId = h.DocId
                    WHERE h.EntryId = ?;
                """, (entry_id,))
                row = cur.fetchone()
                if not row:
                    return None

                data = dict(row)
                data["Sql"] = decompress_text(data.pop("Body"))

                # Lấy danh sách tags chi tiết
                cur.execute("""
                    SELECT t.TagId, t.TagName, t.Color
                    FROM HistoryTag ht
                    JOIN Tag t ON t.TagId = ht.TagId
                    WHERE ht.EntryId = ?
                    ORDER BY t.TagName;
                """, (entry_id,))
                tags_rows = cur.fetchall()
                if tags_rows:
                    data["Tags"] = [dict(tr) for tr in tags_rows]
                elif data.get("Tag"):
                    data["Tags"] = [{"TagId": 0, "TagName": p.strip(), "Color": None} for p in re.split(r'[,;]', data["Tag"]) if p.strip()]
                else:
                    data["Tags"] = []

                return data

    def delete_entry(self, entry_id: int) -> bool:
        """Xóa an toàn một HistoryEntry, giảm RefCount của Content tương ứng,
        và xóa Content nếu RefCount = 0.
        """
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT ContentHash, DocId FROM HistoryEntry WHERE EntryId = ?;", (entry_id,))
                entry_row = cur.fetchone()
                if not entry_row:
                    return False

                c_hash = entry_row["ContentHash"]
                doc_id = entry_row["DocId"]

                cur.execute("DELETE FROM HistoryEntry WHERE EntryId = ?;", (entry_id,))

                # Giảm RefCount của Content
                cur.execute("UPDATE Content SET RefCount = RefCount - 1 WHERE Hash = ?;", (c_hash,))
                cur.execute("DELETE FROM Content WHERE Hash = ? AND RefCount <= 0;", (c_hash,))

                # Kiểm tra nếu Document không còn entry nào và chưa lưu ra file thì có thể xóa hoặc giữ lại
                cur.execute("SELECT COUNT(1) FROM HistoryEntry WHERE DocId = ?;", (doc_id,))
                rem_entries = cur.fetchone()[0]
                if rem_entries == 0:
                    cur.execute("DELETE FROM Document WHERE DocId = ? AND FilePath IS NULL AND IsStarred = 0;", (doc_id,))

                conn.commit()
                return True

    def delete_document(self, doc_id: str, soft_delete: bool = False) -> bool:
        """Xóa lịch sử của toàn bộ một Document."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                if soft_delete:
                    cur.execute("UPDATE Document SET IsDeleted = 1 WHERE DocId = ?;", (doc_id,))
                    conn.commit()
                    return cur.rowcount > 0

                # Hard delete: Dọn sạch entries và ref_counts
                cur.execute("SELECT ContentHash FROM HistoryEntry WHERE DocId = ?;", (doc_id,))
                hashes = [r[0] for r in cur.fetchall()]

                cur.execute("DELETE FROM HistoryEntry WHERE DocId = ?;", (doc_id,))
                cur.execute("DELETE FROM Document WHERE DocId = ?;", (doc_id,))

                for h in set(hashes):
                    count = hashes.count(h)
                    cur.execute("UPDATE Content SET RefCount = RefCount - ? WHERE Hash = ?;", (count, h))
                    cur.execute("DELETE FROM Content WHERE Hash = ? AND RefCount <= 0;", (h,))

                conn.commit()
                return True

    def purge_old_entries(
        self,
        max_age_days: int = 90,
        max_entries_per_doc: int = 200,
        max_db_size_mb: int = 500
    ) -> Dict[str, int]:
        """Thực thi chính sách dọn dẹp chống phình dung lượng (Retention):
        1. Xóa các entry cũ hơn `max_age_days` (bảo vệ tuyệt đối Document được đánh dấu sao IsStarred=1 VÀ entry yêu thích IsFavorite=1).
        2. Giữ tối đa `max_entries_per_doc` entries mới nhất cho mỗi Document (bảo vệ IsFavorite=1).
        3. Dọn các Content mồ côi (RefCount <= 0).
        4. Tự động chạy incremental_vacuum.
        """
        cutoff_ms = int((time.time() - max_age_days * 86400) * 1000)
        purged_count = 0

        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()

                # 1. Tìm các entry quá hạn theo tuổi (không xóa entry đã gắn sao hoặc yêu thích)
                cur.execute("""
                    SELECT h.EntryId, h.ContentHash
                    FROM HistoryEntry h
                    JOIN Document d ON d.DocId = h.DocId
                    WHERE d.IsStarred = 0 AND h.IsFavorite = 0 AND h.ExecutedAt < ?;
                """, (cutoff_ms,))
                expired_entries = cur.fetchall()

                for r in expired_entries:
                    e_id, c_hash = r["EntryId"], r["ContentHash"]
                    cur.execute("DELETE FROM HistoryEntry WHERE EntryId = ?;", (e_id,))
                    cur.execute("UPDATE Content SET RefCount = RefCount - 1 WHERE Hash = ?;", (c_hash,))
                    purged_count += 1

                # 2. Xóa các entry vượt quá số lượng tối đa trên mỗi Document (chỉ xóa entry IsFavorite=0)
                cur.execute("SELECT DocId FROM Document;")
                all_docs = [r[0] for r in cur.fetchall()]

                for d_id in all_docs:
                    cur.execute("""
                        SELECT EntryId, ContentHash
                        FROM HistoryEntry
                        WHERE DocId = ? AND IsFavorite = 0
                        ORDER BY ExecutedAt DESC, EntryId DESC
                        LIMIT -1 OFFSET ?;
                    """, (d_id, max_entries_per_doc))
                    overflow_entries = cur.fetchall()

                    for r in overflow_entries:
                        e_id, c_hash = r["EntryId"], r["ContentHash"]
                        cur.execute("DELETE FROM HistoryEntry WHERE EntryId = ?;", (e_id,))
                        cur.execute("UPDATE Content SET RefCount = RefCount - 1 WHERE Hash = ?;", (c_hash,))
                        purged_count += 1

                # 3. Xóa các Content không còn ai tham chiếu
                cur.execute("DELETE FROM Content WHERE RefCount <= 0;")

                # 4. Xóa các Document rỗng không còn entry và không có FilePath / Star
                cur.execute("""
                    DELETE FROM Document
                    WHERE DocId NOT IN (SELECT DISTINCT DocId FROM HistoryEntry)
                      AND FilePath IS NULL
                      AND IsStarred = 0;
                """)

                conn.commit()

                # 5. Dọn dẹp phân mảnh SQLite
                cur.execute("PRAGMA incremental_vacuum;")

                # 6. Kiểm tra và áp dụng giới hạn tổng dung lượng tối đa DB (max_db_size_mb)
                # Nếu vượt quá, xóa lần lượt các entry cũ nhất thuộc Document không ⭐ và entry không ⭐ (IsStarred = 0 AND IsFavorite = 0)
                if max_db_size_mb and os.path.exists(self.db_path):
                    target_bytes = max_db_size_mb * 1024 * 1024
                    current_size = os.path.getsize(self.db_path)
                    batch_size = 200

                    while current_size > target_bytes:
                        cur.execute("""
                            SELECT h.EntryId, h.ContentHash
                            FROM HistoryEntry h
                            JOIN Document d ON d.DocId = h.DocId
                            WHERE d.IsStarred = 0 AND h.IsFavorite = 0
                            ORDER BY h.ExecutedAt ASC, h.EntryId ASC
                            LIMIT ?;
                        """, (batch_size,))
                        overflow_rows = cur.fetchall()
                        if not overflow_rows:
                            break

                        for r in overflow_rows:
                            e_id, c_hash = r["EntryId"], r["ContentHash"]
                            cur.execute("DELETE FROM HistoryEntry WHERE EntryId = ?;", (e_id,))
                            cur.execute("UPDATE Content SET RefCount = RefCount - 1 WHERE Hash = ?;", (c_hash,))
                            purged_count += 1

                        cur.execute("DELETE FROM Content WHERE RefCount <= 0;")
                        cur.execute("""
                            DELETE FROM Document
                            WHERE DocId NOT IN (SELECT DISTINCT DocId FROM HistoryEntry)
                              AND FilePath IS NULL
                              AND IsStarred = 0;
                        """)
                        conn.commit()
                        cur.execute("PRAGMA incremental_vacuum;")
                        current_size = os.path.getsize(self.db_path)

        return {"purged_entries": purged_count}

    def compact(self) -> Dict[str, Any]:
        """Tối ưu và thu gọn cơ sở dữ liệu SQLite (VACUUM + incremental_vacuum)."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM Content WHERE RefCount <= 0;")
                cur.execute("""
                    DELETE FROM Document
                    WHERE DocId NOT IN (SELECT DISTINCT DocId FROM HistoryEntry)
                      AND FilePath IS NULL
                      AND IsStarred = 0;
                """)
                conn.commit()
                cur.execute("PRAGMA incremental_vacuum;")
                cur.close()

                try:
                    old_iso = conn.isolation_level
                    conn.isolation_level = None
                    conn.execute("VACUUM;")
                    conn.isolation_level = old_iso
                except Exception as exc:
                    logger.warning("[HistoryStore] VACUUM exception: %s", exc)

        return self.get_storage_stats()

    def clear_all(self, keep_favorites: bool = False) -> Dict[str, Any]:
        """Xóa toàn bộ lịch sử truy vấn (tùy chọn giữ lại các Document ghim sao và các Entry yêu thích)."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                if keep_favorites:
                    # Giữ lại các entry thuộc Document IsStarred=1 HOẶC entry có IsFavorite=1
                    cur.execute("""
                        SELECT h.EntryId, h.ContentHash
                        FROM HistoryEntry h
                        JOIN Document d ON d.DocId = h.DocId
                        WHERE d.IsStarred = 0 AND h.IsFavorite = 0;
                    """)
                    unstarred_rows = cur.fetchall()
                    for r in unstarred_rows:
                        cur.execute("DELETE FROM HistoryEntry WHERE EntryId = ?;", (r["EntryId"],))
                        cur.execute("UPDATE Content SET RefCount = RefCount - 1 WHERE Hash = ?;", (r["ContentHash"],))

                    cur.execute("DELETE FROM Content WHERE RefCount <= 0;")
                    cur.execute("""
                        DELETE FROM Document
                        WHERE DocId NOT IN (SELECT DISTINCT DocId FROM HistoryEntry)
                          AND IsStarred = 0;
                    """)
                else:
                    cur.execute("DELETE FROM HistoryEntry;")
                    cur.execute("DELETE FROM Content;")
                    cur.execute("DELETE FROM Document;")
                    cur.execute("DELETE FROM Tag;")
                    cur.execute("DELETE FROM HistoryTag;")

                conn.commit()
                cur.execute("PRAGMA incremental_vacuum;")
                cur.close()

                try:
                    old_iso = conn.isolation_level
                    conn.isolation_level = None
                    conn.execute("VACUUM;")
                    conn.isolation_level = old_iso
                except Exception as exc:
                    logger.warning("[HistoryStore] VACUUM exception after clear_all: %s", exc)

        return self.get_storage_stats()

    def get_storage_stats(self) -> Dict[str, Any]:
        """Trả về thống kê dung lượng và tỷ lệ tiết kiệm nén của SQLite database."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT COUNT(1) FROM Document WHERE IsDeleted = 0;")
                total_docs = cur.fetchone()[0]

                cur.execute("SELECT COUNT(1) FROM HistoryEntry;")
                total_entries = cur.fetchone()[0]

                cur.execute("SELECT COUNT(1), COALESCE(SUM(RawSize), 0) FROM Content;")
                content_row = cur.fetchone()
                total_contents = content_row[0]
                total_raw_bytes = content_row[1]

                db_file_size = os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0

                cur.execute("SELECT COALESCE(SUM(LENGTH(Body)), 0) FROM Content;")
                compressed_bytes = cur.fetchone()[0]

                savings_pct = 0.0
                if total_raw_bytes > 0:
                    savings_pct = round((1.0 - (compressed_bytes / total_raw_bytes)) * 100.0, 1)

                return {
                    "db_path": self.db_path,
                    "db_file_size_bytes": db_file_size,
                    "db_file_size_mb": round(db_file_size / (1024 * 1024), 2),
                    "total_documents": total_docs,
                    "total_entries": total_entries,
                    "unique_contents": total_contents,
                    "total_raw_bytes": total_raw_bytes,
                    "total_compressed_bytes": compressed_bytes,
                    "compression_savings_pct": savings_pct
                }

    def update_entry_note(self, entry_id: int, note: Optional[str] = None, tag: Optional[str] = None) -> bool:
        """Cập nhật ghi chú (Note) và nhãn (Tag) cho một HistoryEntry, đồng thời đồng bộ vào Tag/HistoryTag."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                clean_note = note.strip() if note else None
                clean_tag = tag.strip() if tag else None

                cur.execute("""
                    UPDATE HistoryEntry
                    SET Note = ?, Tag = ?
                    WHERE EntryId = ?;
                """, (clean_note, clean_tag, entry_id))
                updated = cur.rowcount > 0

                if clean_tag:
                    now_ms = int(time.time() * 1000)
                    tag_parts = [p.strip() for p in re.split(r'[,;]', clean_tag) if p.strip()]
                    for t_name in tag_parts:
                        cur.execute("INSERT OR IGNORE INTO Tag (TagName, CreatedAt) VALUES (?, ?);", (t_name, now_ms))
                        cur.execute("SELECT TagId FROM Tag WHERE TagName = ?;", (t_name,))
                        t_row = cur.fetchone()
                        if t_row:
                            cur.execute("INSERT OR IGNORE INTO HistoryTag (EntryId, TagId, CreatedAt) VALUES (?, ?, ?);", (entry_id, t_row[0], now_ms))

                conn.commit()
                return updated

    def get_distinct_filters(self) -> Dict[str, List[str]]:
        """Lấy danh sách các Server, Database, Tag độc nhất trong lịch sử để phục vụ bộ lọc nâng cao."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT DISTINCT Server FROM HistoryEntry WHERE Server IS NOT NULL AND Server != '' ORDER BY Server;")
                servers = [r[0] for r in cur.fetchall()]

                cur.execute("SELECT DISTINCT DatabaseName FROM HistoryEntry WHERE DatabaseName IS NOT NULL AND DatabaseName != '' ORDER BY DatabaseName;")
                databases = [r[0] for r in cur.fetchall()]

                cur.execute("""
                    SELECT DISTINCT TagName FROM (
                        SELECT TagName FROM Tag WHERE TagName IS NOT NULL AND TRIM(TagName) != ''
                        UNION
                        SELECT Tag AS TagName FROM HistoryEntry WHERE Tag IS NOT NULL AND TRIM(Tag) != ''
                    ) ORDER BY TagName;
                """)
                tags = [r[0] for r in cur.fetchall()]

                return {
                    "servers": servers,
                    "databases": databases,
                    "tags": tags
                }

    def export_history(self, doc_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """Xuất dữ liệu lịch sử thành JSON dictionary (bao gồm giải nén toàn bộ SQL và thông tin Tags/IsFavorite)."""
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                if doc_ids:
                    placeholders = ",".join("?" for _ in doc_ids)
                    cur.execute(f"SELECT * FROM Document WHERE DocId IN ({placeholders}) AND IsDeleted = 0 ORDER BY LastRunAt DESC;", doc_ids)
                else:
                    cur.execute("SELECT * FROM Document WHERE IsDeleted = 0 ORDER BY LastRunAt DESC;")

                doc_rows = cur.fetchall()
                docs_export = []

                for d in doc_rows:
                    doc_dict = dict(d)
                    cur.execute("""
                        SELECT h.*, c.Body
                        FROM HistoryEntry h
                        JOIN Content c ON h.ContentHash = c.Hash
                        WHERE h.DocId = ?
                        ORDER BY h.ExecutedAt ASC, h.EntryId ASC;
                    """, (d["DocId"],))
                    entry_rows = cur.fetchall()
                    entries_export = []
                    for e in entry_rows:
                        e_dict = dict(e)
                        body_blob = e_dict.pop("Body", None)
                        e_dict["Sql"] = decompress_text(body_blob) if body_blob else ""
                        entries_export.append(e_dict)

                    doc_dict["Entries"] = entries_export
                    docs_export.append(doc_dict)

                return {
                    "version": SCHEMA_VERSION,
                    "exported_at": int(time.time() * 1000),
                    "total_documents": len(docs_export),
                    "documents": docs_export
                }

    def import_history(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Nhập dữ liệu lịch sử từ JSON export và đồng bộ vào database."""
        if not isinstance(data, dict) or "documents" not in data:
            raise ValueError("Dữ liệu không đúng định dạng export lịch sử (thiếu trường 'documents')")

        imported_docs = 0
        imported_entries = 0

        with self._lock:
            with self._get_connection() as conn:
                cur = conn.cursor()
                for doc in data.get("documents", []):
                    doc_id = doc.get("DocId")
                    if not doc_id:
                        continue
                    disp_name = doc.get("DisplayName") or "Imported.sql"
                    file_path = doc.get("FilePath")
                    is_starred = int(doc.get("IsStarred", 0))
                    created_at = int(doc.get("CreatedAt", int(time.time() * 1000)))
                    last_run_at = int(doc.get("LastRunAt", created_at))
                    last_server = doc.get("LastServer")
                    last_db = doc.get("LastDatabase")

                    # Upsert Document
                    cur.execute("""
                        INSERT INTO Document (DocId, DisplayName, FilePath, IsStarred, CreatedAt, LastRunAt, LastServer, LastDatabase, IsDeleted)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                        ON CONFLICT(DocId) DO UPDATE SET
                            DisplayName = excluded.DisplayName,
                            FilePath = COALESCE(excluded.FilePath, Document.FilePath),
                            IsStarred = MAX(Document.IsStarred, excluded.IsStarred),
                            LastRunAt = MAX(Document.LastRunAt, excluded.LastRunAt),
                            LastServer = COALESCE(excluded.LastServer, Document.LastServer),
                            LastDatabase = COALESCE(excluded.LastDatabase, Document.LastDatabase),
                            IsDeleted = 0;
                    """, (doc_id, disp_name, file_path, is_starred, created_at, last_run_at, last_server, last_db))
                    imported_docs += 1

                    for entry in doc.get("Entries", []):
                        sql_text = entry.get("Sql") or ""
                        if not sql_text and entry.get("ContentHash"):
                            c_hash = entry["ContentHash"]
                        else:
                            norm_sql = normalize_sql_text(sql_text)
                            if not norm_sql:
                                continue
                            c_hash = compute_sha256(norm_sql)
                            # Upsert Content
                            cur.execute("SELECT Hash, RefCount FROM Content WHERE Hash = ?;", (c_hash,))
                            crow = cur.fetchone()
                            if crow is None:
                                comp_body = compress_text(norm_sql)
                                r_size = len(norm_sql.encode("utf-8"))
                                cur.execute("INSERT INTO Content (Hash, Body, RawSize, RefCount) VALUES (?, ?, ?, 1);", (c_hash, comp_body, r_size))
                            else:
                                cur.execute("UPDATE Content SET RefCount = RefCount + 1 WHERE Hash = ?;", (c_hash,))

                        exec_at = int(entry.get("ExecutedAt", int(time.time() * 1000)))
                        srv = entry.get("Server") or last_server or "localhost"
                        db_name = entry.get("DatabaseName") or last_db or "master"
                        l_name = entry.get("LoginName")
                        is_sel = int(entry.get("IsSelection", 0))
                        dur = entry.get("DurationMs")
                        st = entry.get("Status")
                        err = entry.get("ErrorSummary")
                        rc = int(entry.get("RunCount", 1))
                        et = int(entry.get("EntryType", 1))
                        nt = entry.get("Note")
                        tg = entry.get("Tag")
                        is_fav = int(entry.get("IsFavorite", 0))

                        cur.execute("""
                            INSERT INTO HistoryEntry (
                                DocId, ContentHash, EntryType, ExecutedAt, Server,
                                DatabaseName, LoginName, IsSelection, DurationMs,
                                Status, ErrorSummary, RunCount, Note, Tag, IsFavorite
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                        """, (
                            doc_id, c_hash, et, exec_at, srv,
                            db_name, l_name, is_sel, dur,
                            st, err, rc, nt, tg, is_fav
                        ))
                        new_e_id = cur.lastrowid
                        imported_entries += 1

                        if tg:
                            tag_parts = [p.strip() for p in re.split(r'[,;]', tg) if p.strip()]
                            for t_name in tag_parts:
                                cur.execute("INSERT OR IGNORE INTO Tag (TagName, CreatedAt) VALUES (?, ?);", (t_name, exec_at))
                                cur.execute("SELECT TagId FROM Tag WHERE TagName = ?;", (t_name,))
                                t_row = cur.fetchone()
                                if t_row:
                                    cur.execute("INSERT OR IGNORE INTO HistoryTag (EntryId, TagId, CreatedAt) VALUES (?, ?, ?);", (new_e_id, t_row[0], exec_at))

                conn.commit()

        return {
            "success": True,
            "imported_documents": imported_docs,
            "imported_entries": imported_entries
        }

    def close(self):
        """Đóng tài nguyên nếu cần."""
        pass
