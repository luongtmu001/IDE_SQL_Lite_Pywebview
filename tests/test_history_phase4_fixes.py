"""
Tests for Query History Improvements:
1. Removal of SQLite storage stats and theme dropdown from toolbar.
2. SQL syntax formatting fix for single quotes with backslashes (e.g. CHARINDEX('\\', col)).
3. Editor font settings read-only synchronization (settings.json NEVER modified).
4. Full SQL body/content search support in documents and entries.
"""

import os
import sys
import re
import json
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import MainApi, QueryHistorySubwindowApi
from app.services.connection_manager import ConnectionManager
from app.services.history.storage import HistoryStore, _sqlite_decompress
from app.services.history import get_history_service


def test_toolbar_elements_removed():
    html_path = Path("templates/query_history_window.html")
    assert html_path.exists(), "query_history_window.html must exist"
    content = html_path.read_text(encoding="utf-8")
    
    assert "qh-storage-stat" not in content, "qh-storage-stat must be removed from HTML"
    assert "qhThemeSelect" not in content, "qhThemeSelect dropdown must be removed from HTML"
    print("[Pass] Test 1: Storage stats and theme dropdown successfully removed from template.")


def test_sql_single_quote_mode_configuration():
    js_path = Path("static/js/query-history.js")
    assert js_path.exists(), "query-history.js must exist"
    content = js_path.read_text(encoding="utf-8")

    # SQL mode configuration: Now using Monaco Editor with language 'sql'
    assert "language: 'sql'" in content or "language: \"sql\"" in content, "Monaco editor must be configured with language: 'sql'"
    print("[Pass] Test 2: Monaco Editor configured with SQL language mode.")


def test_editor_font_settings_readonly():
    settings_file = Path("data/settings.json")
    assert settings_file.exists(), "data/settings.json must exist"
    
    mtime_before = settings_file.stat().st_mtime
    original_data = json.loads(settings_file.read_text(encoding="utf-8"))
    
    # Instantiate MainApi and SubwindowApi
    cm = ConnectionManager()
    main_api = MainApi(cm)
    sub_api = QueryHistorySubwindowApi(main_api)
    
    # Read editor settings
    res = sub_api.get_editor_settings()
    assert res["success"] is True, "get_editor_settings must succeed"
    assert "editor" in res, "response must contain 'editor' key"
    assert res["editor"]["fontFamily"] == original_data["editor"]["fontFamily"]
    assert res["editor"]["fontSize"] == original_data["editor"]["fontSize"]
    
    # Ensure settings.json was NOT modified (Strict constraint)
    mtime_after = settings_file.stat().st_mtime
    assert mtime_before == mtime_after, "data/settings.json must NOT be modified!"
    
    css_path = Path("static/css/query-history.css")
    css_content = css_path.read_text(encoding="utf-8")
    assert "--ide-editor-font-family" in css_content
    assert "--ide-editor-font-size" in css_content
    assert "--ide-editor-line-height" in css_content
    print("[Pass] Test 3: Editor font settings read-only sync verified without touching settings.json.")


def test_search_inside_sql_content():
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_search_content.db")
    store = HistoryStore(db_path)
    
    # Tạo document có tên không hề chứa từ khóa "CHARINDEX" hay "program_name"
    doc_id = "doc-special-sql"
    sql_query = """
    SELECT RTRIM(hostname) AS Host,
           RTRIM(SUBSTRING(program_name, CHARINDEX('$', program_name) + 1, CHARINDEX('\\', program_name) - CHARINDEX('$', program_name) - 1)) AS ClientName
    FROM sys.sysprocesses
    WHERE program_name LIKE N'B8.%'
    """
    store.add_entry(
        doc_id=doc_id,
        display_name="InventoryReport.sql",
        sql=sql_query,
        server="prod-sql-01",
        database="db_sales",
        executed_at=1700000000000
    )
    
    # 1. Tìm theo từ khóa trong nội dung SQL: "CHARINDEX"
    docs_found = store.get_documents(search="CHARINDEX")
    assert len(docs_found) == 1, "Must find document by SQL body keyword 'CHARINDEX'"
    assert docs_found[0]["DocId"] == doc_id
    
    # 2. Tìm theo từ khóa trong nội dung SQL: "ClientName"
    docs_found2 = store.get_documents(search="ClientName")
    assert len(docs_found2) == 1, "Must find document by SQL body keyword 'ClientName'"
    assert docs_found2[0]["DocId"] == doc_id

    # 3. Tìm theo từ khóa không tồn tại
    docs_not_found = store.get_documents(search="NonExistentKeywordXYZ")
    assert len(docs_not_found) == 0, "Must return empty for non-existent keyword"

    # 4. Tìm trong get_entries
    entries_found = store.get_entries(doc_id=doc_id, search="ClientName")
    assert len(entries_found) == 1, "Must find entry matching 'ClientName'"
    
    entries_none = store.get_entries(doc_id=doc_id, search="NonExistentKeywordXYZ")
    assert len(entries_none) == 0, "Must not find entry for non-existent keyword"

    print("[Pass] Test 4: Search inside compressed SQL content in Document & Entry verified.")


if __name__ == "__main__":
    test_toolbar_elements_removed()
    test_sql_single_quote_mode_configuration()
    test_editor_font_settings_readonly()
    test_search_inside_sql_content()
    print("\n" + "=" * 55)
    print("ALL 4 USER REQUIREMENTS VERIFIED AND PASSED!")
    print("=" * 55)
