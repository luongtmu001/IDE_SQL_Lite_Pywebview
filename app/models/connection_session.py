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
    _validation_adapter: Any = field(default=None, repr=False)

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

    def get_validation_connection(self) -> Optional[Any]:
        """
        Get or lazily create an isolated auxiliary connection for background syntax validation.
        Prevents concurrency contention and guarantees user query session invariance.
        """
        with self.lock:
            if self._validation_adapter is not None:
                conn = getattr(self._validation_adapter, "connection", None)
                if conn is not None:
                    try:
                        if hasattr(self._validation_adapter, "ping") and not self._validation_adapter.ping():
                            self._validation_adapter = None
                        else:
                            return conn
                    except Exception:
                        self._validation_adapter = None

            if not self.config:
                return None

            try:
                from app.database.factory import create_adapter
                cfg = dict(self.config)
                app_name = cfg.get("application_name", "luoBTool")
                cfg["application_name"] = f"{app_name}_syntax"
                adapter = create_adapter(cfg)
                adapter.connect()
                val_conn = getattr(adapter, "connection", None)
                if val_conn:
                    if hasattr(val_conn, "autocommit"):
                        val_conn.autocommit = True
                    self._validation_adapter = adapter
                    return val_conn
            except Exception as ex:
                logger.debug("Could not create auxiliary validation connection: %s", ex)
                return None
            return None

    def close(self):
        with self.lock:
            if self.in_transaction:
                try:
                    self.rollback_transaction()
                except Exception as ex:
                    logger.warning("Error rolling back uncommitted transaction during session %s close: %s", self.connection_id, ex)
            if hasattr(self, "_validation_adapter") and self._validation_adapter is not None:
                if hasattr(self._validation_adapter, "close"):
                    try:
                        self._validation_adapter.close()
                    except Exception as ex:
                        logger.debug("Error closing auxiliary validation connection: %s", ex)
                self._validation_adapter = None
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
            "spid": getattr(self.adapter, "spid", None),
            "tab_id": getattr(self, "tab_id", None),
            "config": {
                "name":   self.config.get("name"),
                "type":   self.config.get("type"),
                "server": self.config.get("server") or self.config.get("host"),
                "environment": self.environment,
                "read_only": self.read_only,
            },
        }
