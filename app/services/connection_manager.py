from datetime import datetime, timezone
import logging
from threading import RLock
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from app.database.factory import create_adapter
from app.models.connection_session import ConnectionSession
from app.services.metadata_service import MetadataService
from app.services.query_service import QueryService

logger = logging.getLogger("luobtool.connection_manager")

class ConnectionManager:

    def __init__(self):
        self._connections = {}
        self._credential_cache = {}  # in-memory RAM cache for passwords (never written to disk)
        self._lock = RLock()

    def _make_credential_keys(self, config):
        keys = []
        c_type = str(config.get("type") or "").strip().lower()
        c_server = str(config.get("server") or config.get("host") or "").strip().lower()
        c_port = str(config.get("port") or "").strip()
        c_user = str(config.get("username") or "").strip()
        c_name = str(config.get("name") or "").strip().lower()

        if c_type and c_server and c_user:
            keys.append(f"{c_type}:{c_server}:{c_port}:{c_user}")
            if c_port:
                keys.append(f"{c_type}:{c_server}::{c_user}")

        if c_name and c_user:
            keys.append(f"name:{c_name}:{c_user}")
        elif c_name:
            keys.append(f"name:{c_name}")

        return keys

    def has_cached_password(self, config):
        if config.get("trusted_connection") or config.get("type") == "sqlite":
            return True
        with self._lock:
            for key in self._make_credential_keys(config):
                if key in self._credential_cache and self._credential_cache[key]:
                    return True
        return False

    def get_cached_password(self, config):
        with self._lock:
            for key in self._make_credential_keys(config):
                if key in self._credential_cache:
                    return self._credential_cache[key]
        return None

    def set_cached_password(self, config, password):
        if not password:
            return
        with self._lock:
            for key in self._make_credential_keys(config):
                self._credential_cache[key] = password

    def clear_cached_password(self, config):
        with self._lock:
            for key in self._make_credential_keys(config):
                self._credential_cache.pop(key, None)

    def create(self, owner_session_id, config):
        db_type = (config.get("type") or "").strip().lower()
        if db_type == "group_marker" or str(config.get("name", "")).startswith("__group__"):
            raise ValueError("Không thể tạo kết nối cho thư mục nhóm (group_marker).")

        config_to_use = dict(config)
        # If password not provided in payload, check in-memory RAM cache
        if not config_to_use.get("password") and not config_to_use.get("trusted_connection"):
            cached_pwd = self.get_cached_password(config_to_use)
            if cached_pwd:
                config_to_use["password"] = cached_pwd

        adapter = create_adapter(config_to_use)
        adapter.connect()

        # Connection succeeded: cache password in RAM
        if config_to_use.get("password"):
            self.set_cached_password(config_to_use, config_to_use["password"])

        connection_id = f"conn_{uuid4().hex}"

        safe_config = {
            key: value
            for key, value in config_to_use.items()
            if key != "password"
        }

        connection = ConnectionSession(
            connection_id=connection_id,
            owner_session_id=owner_session_id,
            config=safe_config,
            adapter=adapter,
            metadata_service=None,
            query_service=None,
            environment=config_to_use.get("environment"),
            read_only=bool(config_to_use.get("read_only", False)),
        )
        setattr(adapter, "session", connection)

        # For PostgreSQL: Set session characteristics if read-only
        if connection.read_only and db_type == "postgresql":
            try:
                conn_obj = getattr(adapter, "connection", None)
                if conn_obj:
                    with conn_obj.cursor() as cur:
                        cur.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;")
            except Exception as e:
                import logging
                logging.getLogger("luobtool").warning("Could not set PostgreSQL session to read-only: %s", e)

        connection.metadata_service = MetadataService(connection)
        connection.query_service = QueryService(connection)

        with self._lock:
            self._connections[connection_id] = connection

        return connection

    def create_or_get(self, owner_session_id, config):
        db_type = (config.get("type") or "").strip().lower()
        if db_type == "group_marker" or str(config.get("name", "")).startswith("__group__"):
            raise ValueError("Không thể tạo kết nối cho thư mục nhóm (group_marker).")

        with self._lock:
            for conn in self.list(owner_session_id):
                cfg = conn.config or {}
                if (
                    str(cfg.get("type", "")).lower() == str(config.get("type", "")).lower()
                    and str(cfg.get("server") or cfg.get("host") or "").lower() == str(config.get("server") or config.get("host") or "").lower()
                    and str(cfg.get("port") or "").strip() == str(config.get("port") or "").strip()
                    and str(cfg.get("database") or "").lower() == str(config.get("database") or "").lower()
                    and str(cfg.get("username") or "").lower() == str(config.get("username") or "").lower()
                    and bool(cfg.get("trusted_connection", False)) == bool(config.get("trusted_connection", False))
                ):
                    if "environment" in config:
                        conn.environment = config.get("environment")
                        conn.config["environment"] = config.get("environment")
                    if "read_only" in config:
                        conn.read_only = bool(config.get("read_only", False))
                        conn.config["read_only"] = conn.read_only
                    return conn, True

        conn = self.create(owner_session_id, config)
        return conn, False

    def get(self, owner_session_id, connection_id):
        with self._lock:
            connection = self._connections.get(connection_id)

        if connection is None:
            raise KeyError("Connection not found")

        if connection.owner_session_id != owner_session_id:
            raise PermissionError(
                "Connection does not belong to this session"
            )

        connection.touch()
        return connection

    def list(self, owner_session_id):
        with self._lock:
            return [
                connection
                for connection in self._connections.values()
                if connection.owner_session_id == owner_session_id
            ]

    def ping(self, owner_session_id, connection_id):
        try:
            conn = self.get(owner_session_id, connection_id)
            return conn.is_alive()
        except Exception as ex:
            logger.debug("Ping failed for connection %s: %s", connection_id, ex)
            return False

    def reconnect(self, owner_session_id, connection_id, password=None):
        conn = self.get(owner_session_id, connection_id)
        config_to_use = dict(conn.config or {})
        if password:
            config_to_use["password"] = password
            self.set_cached_password(config_to_use, password)
        elif not config_to_use.get("password") and not config_to_use.get("trusted_connection"):
            cached_pwd = self.get_cached_password(config_to_use)
            if cached_pwd:
                config_to_use["password"] = cached_pwd

        # Close old adapter if open
        with conn.lock:
            try:
                conn.adapter.close()
            except Exception as ex:
                logger.warning("Error closing old adapter during reconnect for %s: %s", connection_id, ex)

            # Create new adapter and connect
            adapter = create_adapter(config_to_use)
            adapter.connect()
            conn.adapter = adapter
            conn.touch()
            # Clear cached metadata if needed
            conn.metadata_cache.clear()

        return conn

    def close(self, owner_session_id, connection_id):
        connection = self.get(
            owner_session_id,
            connection_id,
        )

        try:
            with connection.lock:
                if getattr(connection, "adapter", None):
                    connection.adapter.close()
        except Exception as ex:
            logger.warning("Error closing adapter for connection %s: %s", connection_id, ex)
            raise
        finally:
            with self._lock:
                self._connections.pop(connection_id, None)

    def close_all(self, owner_session_id) -> int:
        closed_count = 0
        for connection in self.list(owner_session_id):
            try:
                self.close(
                    owner_session_id,
                    connection.connection_id,
                )
                closed_count += 1
            except Exception as ex:
                logger.warning("Error closing connection %s in close_all: %s", connection.connection_id, ex)
        return closed_count

    def close_all_for_window(self, window_id: str) -> int:
        """Closes all connections owned by a specific window or session ID."""
        return self.close_all(window_id)

    def close_all_sessions(self) -> int:
        """Closes all connections across all sessions/windows."""
        closed_count = 0
        with self._lock:
            all_conns = list(self._connections.values())

        for conn in all_conns:
            try:
                with conn.lock:
                    if getattr(conn, "adapter", None):
                        conn.adapter.close()
            except Exception as ex:
                logger.warning("Error closing connection %s in close_all_sessions: %s", conn.connection_id, ex)
            finally:
                with self._lock:
                    self._connections.pop(conn.connection_id, None)
                closed_count += 1
        return closed_count

    def cleanup_idle(self, max_idle_seconds: int = 3600, owner_session_id: Optional[str] = None) -> int:
        """
        Close connections that have been idle for >= max_idle_seconds.
        Connections in an active transaction (in_transaction=True) are skipped.
        Returns the number of connections closed.
        """
        if max_idle_seconds <= 0:
            return 0

        now = datetime.now(timezone.utc)
        to_close = []

        with self._lock:
            for conn in list(self._connections.values()):
                if owner_session_id and conn.owner_session_id != owner_session_id:
                    continue
                if getattr(conn, "in_transaction", False):
                    continue

                last_used = getattr(conn, "last_used_at", None)
                if last_used is None:
                    continue
                if last_used.tzinfo is None:
                    last_used = last_used.replace(tzinfo=timezone.utc)

                elapsed = (now - last_used).total_seconds()
                if elapsed >= max_idle_seconds:
                    to_close.append(conn)

        closed_count = 0
        for conn in to_close:
            try:
                with conn.lock:
                    if getattr(conn, "adapter", None):
                        conn.adapter.close()
            except Exception as ex:
                logger.warning("Error closing idle adapter for connection %s: %s", conn.connection_id, ex)
            finally:
                with self._lock:
                    self._connections.pop(conn.connection_id, None)
                closed_count += 1
                logger.info("Closed idle connection %s (idle >= %ss)", conn.connection_id, max_idle_seconds)

        return closed_count
