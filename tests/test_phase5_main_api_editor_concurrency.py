# -*- coding: utf-8 -*-
"""
Tests for Phase 5 Step 2: Concurrency & Lock Protection in Table Data Editor API wrappers.
Ensures MainApi / BravoApi editor wrappers acquire session.exclusive() / conn.lock,
preventing data race conditions or autocommit mangling during concurrent operations.
"""
import threading
import time
from unittest.mock import MagicMock, patch
from app.models.connection_session import ConnectionSession
from app.services.table_data_editor_service import TableDataEditorService
from main import MainApi


def test_main_api_fetch_table_data_acquires_exclusive_lock():
    api = MainApi()
    mock_adapter = MagicMock()
    mock_adapter.db_type = "sqlserver"
    mock_adapter.execute.return_value = {"rows": [], "columns": ["id"], "row_count": 0}

    session = ConnectionSession(
        connection_id="conn_conc_1",
        owner_session_id="desktop_user",
        config={"name": "TestDB", "type": "sqlserver"},
        adapter=mock_adapter,
        metadata_service=None,
        query_service=None,
    )

    api.cm._connections["conn_conc_1"] = session

    lock_held_during_fetch = False

    orig_fetch = TableDataEditorService.fetch_data
    def mock_fetch(*args, **kwargs):
        nonlocal lock_held_during_fetch
        # Check if session.lock is currently acquired by testing if another thread can acquire it
        test_acquired = False
        def check_thread():
            nonlocal test_acquired
            test_acquired = session.lock.acquire(timeout=0.05)
            if test_acquired:
                session.lock.release()

        th = threading.Thread(target=check_thread)
        th.start()
        th.join()
        # If test_acquired is False, it means session.lock is held by the calling thread!
        lock_held_during_fetch = (test_acquired is False)
        return {"rows": [], "columns": [], "total_count": 0}

    with patch.object(TableDataEditorService, "fetch_data", side_effect=mock_fetch):
        res = api.fetch_table_data("conn_conc_1", database="TestDB", schema="dbo", table="Users")
        assert res["success"] is True

    assert lock_held_during_fetch is True, "MainApi.fetch_table_data must hold session.lock during execution"


def test_main_api_submit_changes_acquires_exclusive_lock():
    api = MainApi()
    mock_adapter = MagicMock()
    mock_adapter.db_type = "sqlserver"

    session = ConnectionSession(
        connection_id="conn_conc_2",
        owner_session_id="desktop_user",
        config={"name": "TestDB", "type": "sqlserver"},
        adapter=mock_adapter,
        metadata_service=None,
        query_service=None,
    )
    api.cm._connections["conn_conc_2"] = session

    lock_held_during_submit = False

    def mock_submit(*args, **kwargs):
        nonlocal lock_held_during_submit
        test_acquired = False
        def check_thread():
            nonlocal test_acquired
            test_acquired = session.lock.acquire(timeout=0.05)
            if test_acquired:
                session.lock.release()

        th = threading.Thread(target=check_thread)
        th.start()
        th.join()
        lock_held_during_submit = (test_acquired is False)
        return {"success": True, "inserted": 0, "updated": 0, "deleted": 0}

    with patch.object(TableDataEditorService, "submit_changes", side_effect=mock_submit):
        res = api.submit_table_changes("conn_conc_2", database="TestDB", schema="dbo", table="Users", changes={})
        assert res["success"] is True

    assert lock_held_during_submit is True, "MainApi.submit_table_changes must hold session.lock during execution"


def test_concurrent_query_and_editor_do_not_interleave():
    api = MainApi()
    mock_adapter = MagicMock()
    mock_adapter.db_type = "sqlserver"

    session = ConnectionSession(
        connection_id="conn_conc_3",
        owner_session_id="desktop_user",
        config={"name": "TestDB", "type": "sqlserver"},
        adapter=mock_adapter,
        metadata_service=None,
        query_service=None,
    )
    api.cm._connections["conn_conc_3"] = session

    execution_timeline = []

    def mock_fetch(*args, **kwargs):
        execution_timeline.append("editor_fetch_start")
        time.sleep(0.05)
        execution_timeline.append("editor_fetch_end")
        return {"rows": [], "columns": [], "total_count": 0}

    def simulate_long_query():
        with session.exclusive():
            execution_timeline.append("query_start")
            time.sleep(0.1)
            execution_timeline.append("query_end")

    with patch.object(TableDataEditorService, "fetch_data", side_effect=mock_fetch):
        t_query = threading.Thread(target=simulate_long_query)
        t_editor = threading.Thread(target=lambda: api.fetch_table_data("conn_conc_3", database="TestDB", schema="dbo", table="Users"))

        t_query.start()
        time.sleep(0.02)  # ensure t_query acquires lock first
        t_editor.start()

        t_query.join()
        t_editor.join()

    # If exclusive lock is respected, editor_fetch should not interleave inside query_start and query_end
    assert execution_timeline == ["query_start", "query_end", "editor_fetch_start", "editor_fetch_end"], (
        f"Operations must not interleave. Actual timeline: {execution_timeline}"
    )
