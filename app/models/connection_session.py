from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
import threading

@dataclass
class ConnectionSession:
    connection_id: str
    owner_session_id: str
    config: dict[str, Any]
    adapter: Any
    metadata_service: Any
    query_service: Any
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

    def touch(self):
        self.last_used_at = datetime.now(timezone.utc)

    def public_info(self):
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
            "username": self.config.get("username"),
            "config": {
                "name":   self.config.get("name"),
                "type":   self.config.get("type"),
                "server": self.config.get("server") or self.config.get("host"),
            },
        }
