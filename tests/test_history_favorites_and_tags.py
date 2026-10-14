# -*- coding: utf-8 -*-
"""
tests/test_history_favorites_and_tags.py:
Automated test suite verifying Mục 5.7 - History Favorites & Multi-Tags:
1. SQLite Schema Migration v3: IsFavorite column in HistoryEntry, Tag & HistoryTag tables, legacy tag migration.
2. Entry favorite toggle (set_entry_favorite).
3. Multi-tag association (add_entry_tag, remove_entry_tag, get_entry_tags, get_all_tags).
4. Entry filtering by favorite (favorite_only, is_favorite) and tag.
5. Retention Policy Absolute Protection: purge_old_entries and clear_all(keep_favorites=True) protect IsFavorite = 1.
6. Flask REST endpoints (/entry/<id>/favorite, /entry/<id>/tag, /tags, etc.).
7. IPC API bridge methods in QueryHistorySubwindowApi and MainApi.
"""

import os
import sys
import json
import sqlite3
import tempfile
import pytest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.services.history.storage import HistoryStore, SCHEMA_VERSION
from app.services.history.service import HistoryService
from app import create_app
from main import MainApi, QueryHistorySubwindowApi


def test_schema_migration_v3_and_legacy_tag_data():
    """Kiểm tra tự động nâng cấp DB từ Schema v2 lên v3 và migrate dữ liệu tag cũ."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_migration_v2_to_v3.db")

    # Tạo giả lập Schema v2
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA user_version = 2;")
        conn.execute("""
            CREATE TABLE HistoryDocument (
                DocId TEXT PRIMARY KEY,
                DisplayName TEXT NOT NULL,
                FilePath TEXT NULL,
                IsStarred INTEGER NOT NULL DEFAULT 0,
                CreatedAt INTEGER NOT NULL,
                LastRunAt INTEGER NOT NULL,
                LastServer TEXT NULL,
                LastDatabase TEXT NULL
            );
        """)
        conn.execute("""
            CREATE TABLE HistoryContent (
                SqlHash TEXT PRIMARY KEY,
                CompressedSql BLOB NOT NULL,
                RawSize INTEGER NOT NULL,
                RefCount INTEGER NOT NULL DEFAULT 1,
                FirstSeen INTEGER NOT NULL
            );
        """)
        conn.execute("""
            CREATE TABLE HistoryEntry (
                EntryId INTEGER PRIMARY KEY AUTOINCREMENT,
                DocId TEXT NOT NULL,
                SqlHash TEXT NOT NULL,
                ExecutedAt INTEGER NOT NULL,
                Server TEXT NULL,
                DatabaseName TEXT NULL,
                LoginName TEXT NULL,
                IsSelection INTEGER NOT NULL DEFAULT 0,
                DurationMs INTEGER NULL,
                Status INTEGER NULL,
                ErrorSummary TEXT NULL,
                RunCount INTEGER NOT NULL DEFAULT 1,
                Note TEXT NULL,
                Tag TEXT NULL,
                EntryType INTEGER NOT NULL DEFAULT 1
            );
        """)
        # Insert a sample entry with legacy comma-separated tags
        import zlib, hashlib
        raw_sql = "SELECT 'legacy';"
        h = hashlib.sha256(raw_sql.encode("utf-8")).hexdigest()
        blob = zlib.compress(raw_sql.encode("utf-8"))
        conn.execute("INSERT INTO HistoryContent VALUES (?, ?, ?, 1, 1000)", (h, blob, len(raw_sql)))
        conn.execute("INSERT INTO HistoryDocument VALUES ('doc-legacy', 'Legacy.sql', NULL, 0, 1000, 1000, 'srv', 'db')")
        conn.execute("""
            INSERT INTO HistoryEntry (DocId, SqlHash, ExecutedAt, Tag)
            VALUES ('doc-legacy', ?, 1000, 'Release, Hotfix')
        """, (h,))
        conn.commit()

    # Khởi tạo HistoryStore -> kích hoạt migration v3
    store = HistoryStore(db_path=db_path)
    with sqlite3.connect(db_path) as conn:
        ver = conn.execute("PRAGMA user_version;").fetchone()[0]
    assert ver == 3

    # Kiểm tra bảng Tag và HistoryTag đã được tạo và chứa dữ liệu legacy
    tags = store.get_all_tags()
    tag_names = [t.get("TagName") or t.get("name") for t in tags]
    assert "Release" in tag_names
    assert "Hotfix" in tag_names

    # Kiểm tra entry cũ có tags
    entry_tags = store.get_entry_tags(1)
    entry_tag_names = [t.get("TagName") or t.get("name") for t in entry_tags]
    assert "Release" in entry_tag_names
    assert "Hotfix" in entry_tag_names


def test_set_entry_favorite():
    """Kiểm tra đánh dấu và bỏ đánh dấu yêu thích lần chạy (HistoryEntry)."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_fav.db")
    store = HistoryStore(db_path=db_path)

    res = store.add_entry(doc_id="doc-1", display_name="Doc1.sql", sql="SELECT 1;", server="server1", database="db1")
    e1 = res["entry_id"]

    # Mặc định chưa yêu thích
    detail = store.get_entry_detail(e1)
    assert detail["IsFavorite"] == 0

    # Đánh dấu yêu thích
    val = store.set_entry_favorite(e1, True)
    assert val is True
    assert store.get_entry_detail(e1)["IsFavorite"] == 1

    # Bỏ yêu thích
    val = store.set_entry_favorite(e1, False)
    assert val is False
    assert store.get_entry_detail(e1)["IsFavorite"] == 0

    # Toggle (None)
    val = store.set_entry_favorite(e1, None)
    assert val is True
    assert store.get_entry_detail(e1)["IsFavorite"] == 1


def test_multi_tags_add_and_remove():
    """Kiểm tra gắn nhãn nhiều tag và gỡ tag cho lần chạy."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_tags.db")
    store = HistoryStore(db_path=db_path)

    res = store.add_entry(doc_id="doc-1", display_name="Doc1.sql", sql="SELECT 1;", server="server1", database="db1")
    e1 = res["entry_id"]

    # Gắn tag 1
    ok1 = store.add_entry_tag(e1, "Sprint42")
    assert ok1 is True
    # Gắn tag 2
    ok2 = store.add_entry_tag(e1, "Migration")
    assert ok2 is True

    # Lấy tags của entry
    tags = store.get_entry_tags(e1)
    entry_tag_names = [t.get("TagName") or t.get("name") for t in tags]
    assert "Sprint42" in entry_tag_names
    assert "Migration" in entry_tag_names

    # Lấy toàn bộ tags hệ thống
    all_tags = store.get_all_tags()
    tag_dict = {(t.get("TagName") or t.get("name")): (t.get("UsageCount") or t.get("usage_count")) for t in all_tags}
    assert tag_dict["Sprint42"] == 1
    assert tag_dict["Migration"] == 1

    # Gỡ tag Sprint42
    rem_ok = store.remove_entry_tag(e1, "Sprint42")
    assert rem_ok is True

    tags_after = store.get_entry_tags(e1)
    after_names = [t.get("TagName") or t.get("name") for t in tags_after]
    assert "Sprint42" not in after_names
    assert "Migration" in after_names


def test_filter_entries_by_favorite_and_tags():
    """Kiểm tra bộ lọc entries theo yêu thích và tag."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_filter.db")
    store = HistoryStore(db_path=db_path)

    r1 = store.add_entry(doc_id="doc-1", display_name="Doc1.sql", sql="SELECT 1;", server="server1", database="db1")
    r2 = store.add_entry(doc_id="doc-1", display_name="Doc1.sql", sql="SELECT 2;", server="server1", database="db1")
    r3 = store.add_entry(doc_id="doc-1", display_name="Doc1.sql", sql="SELECT 3;", server="server1", database="db1")
    e1, e2, e3 = r1["entry_id"], r2["entry_id"], r3["entry_id"]

    # Đánh dấu e2 và e3 là favorite
    store.set_entry_favorite(e2, True)
    store.set_entry_favorite(e3, True)

    # Gắn tag cho e2
    store.add_entry_tag(e2, "Critical")

    # Lọc favorite_only
    fav_entries = store.get_entries(doc_id="doc-1", favorite_only=True)
    fav_ids = [e["EntryId"] for e in fav_entries]
    assert e1 not in fav_ids
    assert e2 in fav_ids
    assert e3 in fav_ids

    # Lọc is_favorite = False
    non_fav_entries = store.get_entries(doc_id="doc-1", is_favorite=False)
    non_fav_ids = [e["EntryId"] for e in non_fav_entries]
    assert e1 in non_fav_ids
    assert e2 not in non_fav_ids
    assert e3 not in non_fav_ids

    # Lọc theo tag
    tagged_entries = store.get_entries(doc_id="doc-1", tag="Critical")
    tagged_ids = [e["EntryId"] for e in tagged_entries]
    assert tagged_ids == [e2]


def test_retention_policy_protects_favorites():
    """Chính sách lưu trữ bảo vệ tuyệt đối bản ghi Yêu thích (IsFavorite = 1)."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_retention.db")
    store = HistoryStore(db_path=db_path)

    entry_ids = []
    for i in range(10):
        res = store.add_entry(doc_id="doc-1", display_name="Doc1.sql", sql=f"SELECT {i};", server="server1", database="db1")
        entry_ids.append(res["entry_id"])

    # Giả sử entry 0 và entry 1 rất quan trọng -> đánh dấu Favorite
    fav_id_1 = entry_ids[0]
    fav_id_2 = entry_ids[1]
    store.set_entry_favorite(fav_id_1, True)
    store.set_entry_favorite(fav_id_2, True)

    # 1. Chạy purge với max_entries_per_doc = 3, max_age_days = 90
    # Giữ lại 3 bản ghi non-favorite mới nhất CỘNG VỚI 2 bản ghi Favorite cũ = 5 bản ghi!
    res_purge = store.purge_old_entries(max_age_days=90, max_entries_per_doc=3)
    remaining = store.get_entries(doc_id="doc-1", limit=100)
    remaining_ids = [e["EntryId"] for e in remaining]

    assert fav_id_1 in remaining_ids
    assert fav_id_2 in remaining_ids
    assert len(remaining_ids) == 5

    # 2. Chạy clear_all(keep_favorites=True)
    res_clear = store.clear_all(keep_favorites=True)
    after_clear = store.get_entries(doc_id="doc-1", limit=100)
    after_clear_ids = [e["EntryId"] for e in after_clear]

    assert fav_id_1 in after_clear_ids
    assert fav_id_2 in after_clear_ids
    # Các bản ghi không phải favorite đã bị xóa hoàn toàn
    assert len(after_clear_ids) == 2


def test_history_flask_routes_favorite_and_tags(monkeypatch, tmp_path):
    """Kiểm tra các endpoints Flask liên quan tới Favorite & Tags."""
    test_db = str(tmp_path / "routes_test.db")
    svc = HistoryService(db_path=test_db)
    store = svc.store

    monkeypatch.setattr("app.routes.history.get_history_service", lambda: svc)

    app = create_app()
    app.config["TESTING"] = True
    client = app.test_client()

    res = store.add_entry(doc_id="doc-api", display_name="API.sql", sql="SELECT 100;", server="srv", database="db")
    eid = res["entry_id"]

    # 1. POST /api/history/entry/<id>/favorite
    r_fav = client.post(f"/api/history/entry/{eid}/favorite", json={"is_favorite": True})
    assert r_fav.status_code == 200
    assert r_fav.get_json()["is_favorite"] is True

    # 2. POST /api/history/entry/<id>/tag
    r_tag = client.post(f"/api/history/entry/{eid}/tag", json={"tag_name": "API_Test"})
    assert r_tag.status_code == 200
    assert r_tag.get_json()["success"] is True

    # 3. GET /api/history/entry/<id>/tags
    r_tags = client.get(f"/api/history/entry/{eid}/tags")
    assert r_tags.status_code == 200
    entry_tags = r_tags.get_json()["tags"]
    tag_names = [t.get("TagName") or t.get("name") if isinstance(t, dict) else t for t in entry_tags]
    assert "API_Test" in tag_names

    # 4. GET /api/history/tags
    r_all_tags = client.get("/api/history/tags")
    assert r_all_tags.status_code == 200
    tag_names = [t.get("TagName") or t.get("name") if isinstance(t, dict) else t for t in r_all_tags.get_json()["tags"]]
    assert "API_Test" in tag_names

    # 5. GET /api/history/entries?favorite_only=1
    r_entries = client.get(f"/api/history/entries?doc_id=doc-api&favorite_only=1")
    assert r_entries.status_code == 200
    entries = r_entries.get_json()["entries"]
    assert len(entries) == 1
    assert entries[0]["IsFavorite"] == 1

    # 6. DELETE /api/history/entry/<id>/tag
    r_del_tag = client.delete(f"/api/history/entry/{eid}/tag", json={"tag_name": "API_Test"})
    assert r_del_tag.status_code == 200
    assert r_del_tag.get_json()["success"] is True


def test_ipc_api_favorite_and_tags(monkeypatch, tmp_path):
    """Kiểm tra IPC bridge methods trong QueryHistorySubwindowApi và MainApi."""
    test_db = str(tmp_path / "ipc_test.db")
    svc = HistoryService(db_path=test_db)
    store = svc.store

    monkeypatch.setattr("main.get_history_service", lambda: svc)

    class DummyConnectionManager:
        pass

    main_api = MainApi(DummyConnectionManager())
    sub_api = QueryHistorySubwindowApi(main_api)

    res = store.add_entry(doc_id="doc-ipc", display_name="IPC.sql", sql="SELECT 999;", server="srv", database="db")
    eid = res["entry_id"]

    # Subwindow API
    res_fav = sub_api.history_set_entry_favorite(eid, True)
    assert res_fav["success"] is True
    assert res_fav["is_favorite"] is True

    res_add_tag = sub_api.history_add_entry_tag(eid, "IPC_Tag")
    assert res_add_tag["success"] is True

    res_get_tags = sub_api.history_get_entry_tags(eid)
    assert res_get_tags["success"] is True
    tags = res_get_tags["tags"]
    tag_names = [t.get("TagName") or t.get("name") if isinstance(t, dict) else t for t in tags]
    assert "IPC_Tag" in tag_names

    res_all = sub_api.history_get_tags()
    assert res_all["success"] is True
    names = [t.get("TagName") or t.get("name") if isinstance(t, dict) else t for t in res_all["tags"]]
    assert "IPC_Tag" in names

    res_rem_tag = sub_api.history_remove_entry_tag(eid, "IPC_Tag")
    assert res_rem_tag["success"] is True

    # Main API
    res_main_fav = main_api.history_set_entry_favorite(eid, False)
    assert res_main_fav["success"] is True
    assert res_main_fav["is_favorite"] is False
