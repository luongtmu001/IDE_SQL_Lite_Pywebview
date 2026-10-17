# -*- coding: utf-8 -*-
import pytest
from app.api.connections_api import ConnectionsApiMixin
from app.services.connection_manager import ConnectionManager
from app.services.settings_store import CONNECTIONS_FILE, _read_json
from app.utils.crypto import encrypt_password, decrypt_password


class DummyApi(ConnectionsApiMixin):
    def __init__(self, cm):
        self.cm = cm
        self.owner_session_id = "test_user"


def test_create_connection_with_encrypted_password():
    cm = ConnectionManager()
    api = DummyApi(cm)

    # If payload contains encrypted password directly
    saved = _read_json(CONNECTIONS_FILE, [])
    local_pg = next((p for p in saved if p.get("name") == "PGE_Local"), None)
    if not local_pg:
        pytest.skip("PGE_Local profile not found")

    # Pass profile with encrypted password (ENC2:...)
    res = api.create_connection(local_pg)
    assert res.get("success") is True
    assert "connection" in res
    conn_id = res["connection"]["connection_id"]
    api.delete_connection(conn_id)


def test_reconnect_connection_stale_or_profile_id():
    cm = ConnectionManager()
    api = DummyApi(cm)

    saved = _read_json(CONNECTIONS_FILE, [])
    local_sql = next((p for p in saved if p.get("name") == "Local"), None)
    if not local_sql:
        pytest.skip("Local SQL profile not found")

    prof_id = local_sql["id"]

    # Reconnect with profile ID (not currently in cm)
    res = api.reconnect_connection(prof_id)
    assert res.get("success") is True
    assert "connection" in res
    conn_id = res["connection"]["connection_id"]

    # Reconnect with active session ID
    res2 = api.reconnect_connection(conn_id)
    assert res2.get("success") is True
    assert res2.get("reused") is True

    api.delete_connection(conn_id)
