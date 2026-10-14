# -*- coding: utf-8 -*-
from dataclasses import dataclass, field
from datetime import datetime, timezone
import logging
from typing import Any, Optional
from contextlib import contextmanager
import threading

logger = logging.getLogger("luobtool.connection_session")


@dataclass
class ConnectionSession:
    connection_id: str
    owner_session_id: str
    config: dict[str, Any]
    adapter: Any
    metadata_service: Any
    query_service: Any
    environment: Optional[str] = None  # "dev", "test", "prod" or None
    read_only: bool = False
    in_transaction: bool = False
    tx_started_at: Optional[datetime] = None
    created_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    last_used_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    metadata_cache: dict[str, Any] = field(default_factory=dict)
    lock: threading.RLock = field(
        default_factory=threading.RLock,
        repr=False,
    )

    def __post_init__(self):
        if not self.environment and self.config:
            self.environment = self.config.get("environment")
        if not self.read_only and self.config:
            self.read_only = bool(self.config.get("read_only", False))

    def touch(self):
        self.last_used_at = datetime.now(timezone.utc)

    @contextmanager
    def exclusive(self):
        """Context manager to exclusively lock the session and connection, updating last_used_at."""
        with self.lock:
            self.touch()
            yield self

    def set_read_only(self, read_only: bool) -> dict:
        with self.lock:
            self.read_only = bool(read_only)
            if self.config:
                self.config["read_only"] = self.read_only
            adapter = self.adapter
            db_type = getattr(adapter, "db_type", None) or (self.config.get("type", "") if self.config else "")
            if str(db_type).lower() == "postgresql":
                conn = getattr(adapter, "connection", None)
                if conn:
                    try:
                        cursor = conn.cursor()
                        mode = "READ ONLY" if self.read_only else "READ WRITE"
                        cursor.execute(f"SET SESSION CHARACTERISTICS AS TRANSACTION {mode};")
                        conn.commit()
                    except Exception as ex:
                        logger.warning("Failed to set PostgreSQL session characteristics for %s: %s", self.connection_id, ex)
            self.touch()
            return {"success": True, "read_only": self.read_only, "connection_id": self.connection_id}

    def is_alive(self) -> bool:
        with self.lock:
            try:
                if hasattr(self.adapter, "ping"):
                    return bool(self.adapter.ping())
                return True
            except Exception as ex:
                logger.debug("is_alive check failed for connection %s: %s", self.connection_id, ex)
                return False

    def begin_transaction(self) -> dict:
        with self.lock:
            if self.read_only:
                return {"success": False, "error": "Kết nối đang ở chế độ CHỈ ĐỌC (Read-Only). Không thể mở Transaction ghi."}
            if self.in_transaction:
                return {"success": False, "error": "Transaction tường minh đã được mở trước đó."}
            adapter = self.adapter
            conn = getattr(adapter, "connection", None)
            if conn:
                try:
                    conn.autocommit = False
                except Exception as e:
                    return {"success": False, "error": f"Không thể bật transaction: {e}"}
            self.in_transaction = True
            self.tx_started_at = datetime.now(timezone.utc)
            self.touch()
            return {"success": True, "in_transaction": True}

    def commit_transaction(self) -> dict:
        with self.lock:
            if not self.in_transaction:
                return {"success": False, "error": "Không có transaction nào đang mở để Commit."}
            adapter = self.adapter
            conn = getattr(adapter, "connection", None)
            if conn:
                try:
                    conn.commit()
                    conn.autocommit = True
                except Exception as e:
                    return {"success": False, "error": f"Lỗi khi Commit transaction: {e}"}
            self.in_transaction = False
            self.tx_started_at = None
            self.touch()
            return {"success": True, "in_transaction": False}

    def rollback_transaction(self) -> dict:
        with self.lock:
            if not self.in_transaction:
                return {"success": False, "error": "Không có transaction nào đang mở để Rollback."}
            adapter = self.adapter
            conn = getattr(adapter, "connection", None)
            if conn:
                try:
                    conn.rollback()
                    conn.autocommit = True
                except Exception as e:
                    return {"success": False, "error": f"Lỗi khi Rollback transaction: {e}"}
            self.in_transaction = False
            self.tx_started_at = None
            self.touch()
            return {"success": True, "in_transaction": False}

    def close(self):
        with self.lock:
            if self.in_transaction:
                try:
                    self.rollback_transaction()
                except Exception as ex:
                    logger.warning("Error rolling back uncommitted transaction during session %s close: %s", self.connection_id, ex)
            if hasattr(self.adapter, "close"):
                try:
                    self.adapter.close()
                except Exception as ex:
                    logger.warning("Error closing adapter for session %s: %s", self.connection_id, ex)

    def public_info(self):
        tx_duration = None
        if self.in_transaction and self.tx_started_at:
            tx_duration = (datetime.now(timezone.utc) - self.tx_started_at).total_seconds()

        return {
            "connection_id": self.connection_id,
            "name": self.config.get("name"),
            "type": self.config.get("type"),
            "server": (
                self.config.get("server")
                or self.config.get("host")
            ),
            "port": self.config.get("port"),
            "database": self.config.get("database"),
            "schema": self.config.get("schema"),
            "username": self.config.get("username"),
            "environment": self.environment,
            "read_only": self.read_only,
            "in_transaction": self.in_transaction,
            "tx_duration_seconds": tx_duration,
            "config": {
                "name":   self.config.get("name"),
                "type":   self.config.get("type"),
                "server": self.config.get("server") or self.config.get("host"),
                "environment": self.environment,
                "read_only": self.read_only,
            },
        }
