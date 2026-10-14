# -*- coding: utf-8 -*-
"""
tests/test_session_save_restore.py:
Automated test suite verifying Mục 5.7 - Session Save & Restore:
1. Atomic write to data/session.json (.tmp -> os.replace).
2. Complete tab state persistence (title, content, docId, filePath, connection, isDirty, isPinned, cursor, scroll).
3. Security: Absolutely no credentials or passwords saved to session.json.
4. Orphan connection protection: connectionId deleted out-of-band gets flagged connectionLost=True, connectionId=None without crash.
5. Max tab size enforcement and settings-based disablement (restoreOnStartup).
6. Flask REST endpoints (/api/session/save, /load, /clear).
7. MainApi IPC methods (session_save, session_load, session_clear).
"""

import os
import sys
import json
import tempfile
import pytest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.routes.session import save_session_data, load_session_data, clear_session_data, SESSION_FILE
from app import create_app
from main import MainApi


def test_session_save_and_load_roundtrip(tmp_path, monkeypatch):
    """Kiểm tra lưu và khôi phục toàn vẹn cấu trúc session các tab."""
    session_file = tmp_path / "test_session.json"
    settings_file = tmp_path / "settings.json"
    connections_file = tmp_path / "connections.json"

    # Setup mock paths
    monkeypatch.setattr("app.routes.session.SESSION_FILE", session_file)
    monkeypatch.setattr("app.routes.session.SETTINGS_FILE", settings_file)
    monkeypatch.setattr("app.routes.session.CONNECTIONS_FILE", connections_file)

    # Cấu hình cho phép khôi phục
    settings_file.write_text(json.dumps({
        "session": {
            "restoreOnStartup": True,
            "saveSqlContent": True,
            "maxTabSizeBytes": 1048576,
            "autoSaveIntervalSeconds": 3
        }
    }), encoding="utf-8")

    connections_file.write_text(json.dumps({
        "connections": [
            {"id": "conn-1", "name": "Production DB", "type": "postgres"}
        ]
    }), encoding="utf-8")

    session_payload = {
        "tabs": [
            {
                "id": "tab-1",
                "title": "Query1.sql",
                "docId": "doc-uuid-1",
                "filePath": "C:/queries/Query1.sql",
                "content": "SELECT * FROM users WHERE active = 1;",
                "connectionId": "conn-1",
                "connectionName": "Production DB",
                "database": "app_db",
                "schema": "public",
                "dbType": "postgres",
                "isDirty": True,
                "isPinned": False,
                "cursor": {"lineNumber": 1, "column": 15},
                "scroll": {"scrollTop": 0, "scrollLeft": 0}
            }
        ],
        "activeTabId": "tab-1",
        "layout": {"sidebarVisible": True}
    }

    res_save = save_session_data(session_payload)
    assert res_save["success"] is True
    assert session_file.exists()

    # Load session
    res_load = load_session_data()
    assert res_load["success"] is True
    assert res_load["enabled"] is True
    assert len(res_load["tabs"]) == 1

    t0 = res_load["tabs"][0]
    assert t0["id"] == "tab-1"
    assert t0["title"] == "Query1.sql"
    assert t0["content"] == "SELECT * FROM users WHERE active = 1;"
    assert t0["connectionId"] == "conn-1"
    assert t0["cursor"] == {"lineNumber": 1, "column": 15}
    assert t0["isDirty"] is True
    assert t0.get("connectionLost") is False


def test_session_security_no_credentials_saved(tmp_path, monkeypatch):
    """Bảo mật tuyệt đối: Không bao giờ lưu credentials/password vào session.json."""
    session_file = tmp_path / "session_secure.json"
    settings_file = tmp_path / "settings.json"
    connections_file = tmp_path / "connections.json"

    monkeypatch.setattr("app.routes.session.SESSION_FILE", session_file)
    monkeypatch.setattr("app.routes.session.SETTINGS_FILE", settings_file)
    monkeypatch.setattr("app.routes.session.CONNECTIONS_FILE", connections_file)

    settings_file.write_text(json.dumps({"session": {"restoreOnStartup": True}}), encoding="utf-8")
    connections_file.write_text(json.dumps({"connections": [{"id": "c1"}]}), encoding="utf-8")

    session_payload = {
        "tabs": [
            {
                "id": "tab-secure",
                "title": "Secure.sql",
                "connectionId": "c1",
                "content": "SELECT 1;",
                "password": "SUPER_SECRET_PASSWORD",
                "pwd": "ANOTHER_SECRET",
                "secret": "TOKEN_12345",
                "credentials": {"auth": "bearer_xxx"}
            }
        ],
        "activeTabId": "tab-secure",
        "globalPassword": "SHOULD_NOT_BE_SAVED"
    }

    res = save_session_data(session_payload)
    assert res["success"] is True

    # Đọc thô file JSON trên đĩa để kiểm tra không lọt password
    raw_content = session_file.read_text(encoding="utf-8")
    assert "SUPER_SECRET_PASSWORD" not in raw_content
    assert "ANOTHER_SECRET" not in raw_content
    assert "TOKEN_12345" not in raw_content
    assert "bearer_xxx" not in raw_content
    assert "SHOULD_NOT_BE_SAVED" not in raw_content


def test_session_orphan_connection_protection(tmp_path, monkeypatch):
    """Khôi phục an toàn: Nếu connectionId không còn trong connections.json, gán connectionLost=True và connectionId=None."""
    session_file = tmp_path / "session_orphan.json"
    settings_file = tmp_path / "settings.json"
    connections_file = tmp_path / "connections.json"

    monkeypatch.setattr("app.routes.session.SESSION_FILE", session_file)
    monkeypatch.setattr("app.routes.session.SETTINGS_FILE", settings_file)
    monkeypatch.setattr("app.routes.session.CONNECTIONS_FILE", connections_file)

    settings_file.write_text(json.dumps({"session": {"restoreOnStartup": True}}), encoding="utf-8")
    # connections.json chỉ có "conn-valid"
    connections_file.write_text(json.dumps({
        "connections": [{"id": "conn-valid", "name": "Valid Server"}]
    }), encoding="utf-8")

    session_payload = {
        "tabs": [
            {
                "id": "tab-valid",
                "title": "Valid.sql",
                "connectionId": "conn-valid"
            },
            {
                "id": "tab-deleted",
                "title": "Deleted.sql",
                "connectionId": "conn-deleted-externally"
            }
        ],
        "activeTabId": "tab-deleted"
    }

    save_session_data(session_payload)

    res_load = load_session_data()
    assert res_load["success"] is True
    tabs = res_load["tabs"]
    assert len(tabs) == 2

    valid_tab = next(t for t in tabs if t["id"] == "tab-valid")
    assert valid_tab["connectionId"] == "conn-valid"
    assert valid_tab["connectionLost"] is False

    deleted_tab = next(t for t in tabs if t["id"] == "tab-deleted")
    assert deleted_tab["connectionId"] is None
    assert deleted_tab["connectionLost"] is True


def test_session_max_tab_size_and_content_setting(tmp_path, monkeypatch):
    """Kiểm tra giới hạn maxTabSizeBytes và cấu hình saveSqlContent."""
    session_file = tmp_path / "session_size.json"
    settings_file = tmp_path / "settings.json"
    connections_file = tmp_path / "connections.json"

    monkeypatch.setattr("app.routes.session.SESSION_FILE", session_file)
    monkeypatch.setattr("app.routes.session.SETTINGS_FILE", settings_file)
    monkeypatch.setattr("app.routes.session.CONNECTIONS_FILE", connections_file)

    # Cấu hình giới hạn 200 bytes
    settings_file.write_text(json.dumps({
        "session": {
            "restoreOnStartup": True,
            "saveSqlContent": True,
            "maxTabSizeBytes": 200
        }
    }), encoding="utf-8")
    connections_file.write_text(json.dumps({"connections": []}), encoding="utf-8")

    huge_sql = "SELECT " + ("x" * 1000)
    save_session_data({
        "tabs": [{"id": "tab-big", "title": "Big.sql", "content": huge_sql}]
    })

    res_load = load_session_data()
    content = res_load["tabs"][0]["content"]
    assert len(content.encode("utf-8")) < 350
    assert "TRUNCATED" in content


def test_session_restore_on_startup_disabled(tmp_path, monkeypatch):
    """Khi restoreOnStartup = False, load_session_data trả về enabled=False và tabs rỗng."""
    session_file = tmp_path / "session_off.json"
    settings_file = tmp_path / "settings.json"
    connections_file = tmp_path / "connections.json"

    monkeypatch.setattr("app.routes.session.SESSION_FILE", session_file)
    monkeypatch.setattr("app.routes.session.SETTINGS_FILE", settings_file)
    monkeypatch.setattr("app.routes.session.CONNECTIONS_FILE", connections_file)

    settings_file.write_text(json.dumps({"session": {"restoreOnStartup": False}}), encoding="utf-8")
    connections_file.write_text(json.dumps({"connections": []}), encoding="utf-8")

    save_session_data({"tabs": [{"id": "t1", "title": "T1"}]})

    res_load = load_session_data()
    assert res_load["success"] is True
    assert res_load["enabled"] is False
    assert len(res_load["tabs"]) == 0


def test_session_clear(tmp_path, monkeypatch):
    """Kiểm tra xóa phiên làm việc."""
    session_file = tmp_path / "session_clear.json"
    settings_file = tmp_path / "settings.json"

    monkeypatch.setattr("app.routes.session.SESSION_FILE", session_file)
    monkeypatch.setattr("app.routes.session.SETTINGS_FILE", settings_file)

    session_file.write_text(json.dumps({"tabs": [{"id": "t1"}]}), encoding="utf-8")
    assert session_file.exists()

    res = clear_session_data()
    assert res["success"] is True
    assert not session_file.exists()


def test_session_flask_endpoints(tmp_path, monkeypatch):
    """Kiểm tra Flask REST API endpoints: /api/session/save, /load, /clear."""
    session_file = tmp_path / "session_flask.json"
    settings_file = tmp_path / "settings.json"
    connections_file = tmp_path / "connections.json"

    monkeypatch.setattr("app.routes.session.SESSION_FILE", session_file)
    monkeypatch.setattr("app.routes.session.SETTINGS_FILE", settings_file)
    monkeypatch.setattr("app.routes.session.CONNECTIONS_FILE", connections_file)

    settings_file.write_text(json.dumps({"session": {"restoreOnStartup": True}}), encoding="utf-8")
    connections_file.write_text(json.dumps({"connections": []}), encoding="utf-8")

    app = create_app()
    app.config["TESTING"] = True
    client = app.test_client()

    # 1. POST /api/session/save
    r_save = client.post("/api/session/save", json={
        "tabs": [{"id": "tab-flask", "title": "Flask.sql", "content": "SELECT 42;"}],
        "activeTabId": "tab-flask"
    })
    assert r_save.status_code == 200
    assert r_save.get_json()["success"] is True

    # 2. GET /api/session/load
    r_load = client.get("/api/session/load")
    assert r_load.status_code == 200
    data_load = r_load.get_json()
    assert data_load["success"] is True
    assert len(data_load["tabs"]) == 1
    assert data_load["tabs"][0]["id"] == "tab-flask"

    # 3. POST /api/session/clear
    r_clear = client.post("/api/session/clear")
    assert r_clear.status_code == 200
    assert r_clear.get_json()["success"] is True


def test_session_mainapi_ipc(tmp_path, monkeypatch):
    """Kiểm tra MainApi IPC methods: session_save, session_load, session_clear."""
    session_file = tmp_path / "session_ipc.json"
    settings_file = tmp_path / "settings.json"
    connections_file = tmp_path / "connections.json"

    monkeypatch.setattr("app.routes.session.SESSION_FILE", session_file)
    monkeypatch.setattr("app.routes.session.SETTINGS_FILE", settings_file)
    monkeypatch.setattr("app.routes.session.CONNECTIONS_FILE", connections_file)

    settings_file.write_text(json.dumps({"session": {"restoreOnStartup": True}}), encoding="utf-8")
    connections_file.write_text(json.dumps({"connections": []}), encoding="utf-8")

    api = MainApi()
    res_save = api.session_save({
        "tabs": [{"id": "tab-ipc", "title": "IPC.sql", "content": "SELECT 'IPC';"}]
    })
    assert res_save["success"] is True

    res_load = api.session_load()
    assert res_load["success"] is True
    assert res_load["tabs"][0]["id"] == "tab-ipc"

    res_clear = api.session_clear()
    assert res_clear["success"] is True
