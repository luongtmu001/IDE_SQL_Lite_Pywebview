from threading import RLock
from uuid import uuid4

from app.database.factory import create_adapter
from app.models.connection_session import ConnectionSession
from app.services.metadata_service import MetadataService
from app.services.query_service import QueryService

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
        )

        connection.metadata_service = MetadataService(connection)
        connection.query_service = QueryService(connection)

        with self._lock:
            self._connections[connection_id] = connection

        return connection

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

    def close(self, owner_session_id, connection_id):
        connection = self.get(
            owner_session_id,
            connection_id,
        )

        with connection.lock:
            connection.adapter.close()

        with self._lock:
            self._connections.pop(connection_id, None)

    def close_all(self, owner_session_id):
        for connection in self.list(owner_session_id):
            self.close(
                owner_session_id,
                connection.connection_id,
            )
