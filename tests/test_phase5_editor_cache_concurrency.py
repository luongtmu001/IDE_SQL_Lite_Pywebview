# -*- coding: utf-8 -*-
"""
Tests for Phase 5 Step 3: Thread-safe metadata cache in TableDataEditorService.
Verifies caching by connection_id (avoiding id(adapter) collisions),
thread synchronization with locks, and TTL expiration cleanup.
"""
import threading
import time
from unittest.mock import MagicMock
from app.services.table_data_editor_service import TableDataEditorService


def test_cache_uses_connection_id_not_id_adapter():
    # Adapter A has connection_id = "conn_alpha"
    adapter_a = MagicMock()
    session_a = MagicMock()
    session_a.connection_id = "conn_alpha"
    adapter_a.session = session_a

    # Adapter B is a different object in memory, but represents the same connection_id
    adapter_b = MagicMock()
    session_b = MagicMock()
    session_b.connection_id = "conn_alpha"
    adapter_b.session = session_b

    # Adapter C is for a different connection
    adapter_c = MagicMock()
    session_c = MagicMock()
    session_c.connection_id = "conn_beta"
    adapter_c.session = session_c

    TableDataEditorService.invalidate_metadata_cache()

    sample_meta = {"columns": [{"name": "Id", "type": "int"}], "pk_columns": ["Id"]}
    TableDataEditorService._set_cached_metadata(adapter_a, "TestDb", "dbo", "Users", sample_meta)

    # adapter_b must hit the cache because connection_id matches!
    cached_for_b = TableDataEditorService._get_cached_metadata(adapter_b, "TestDb", "dbo", "Users")
    assert cached_for_b == sample_meta, "Cache should hit when connection_id matches even if adapter object is different"

    # adapter_c must NOT hit the cache because connection_id differs
    cached_for_c = TableDataEditorService._get_cached_metadata(adapter_c, "TestDb", "dbo", "Users")
    assert cached_for_c is None, "Cache should miss for different connection_id"


def test_cache_thread_safety_under_concurrent_access():
    TableDataEditorService.invalidate_metadata_cache()

    errors = []

    def writer(thread_id):
        try:
            for i in range(50):
                adapter = MagicMock()
                adapter.session = MagicMock(connection_id=f"conn_{thread_id}")
                meta = {"columns": [{"name": f"col_{i}"}]}
                TableDataEditorService._set_cached_metadata(adapter, "DB", "dbo", f"tbl_{i % 5}", meta)
                if i % 10 == 0:
                    TableDataEditorService.invalidate_metadata_cache(adapter, "DB", "dbo", f"tbl_{i % 5}")
        except Exception as e:
            errors.append(e)

    def reader(thread_id):
        try:
            for i in range(50):
                adapter = MagicMock()
                adapter.session = MagicMock(connection_id=f"conn_{thread_id}")
                TableDataEditorService._get_cached_metadata(adapter, "DB", "dbo", f"tbl_{i % 5}")
        except Exception as e:
            errors.append(e)

    threads = []
    for tid in range(4):
        threads.append(threading.Thread(target=writer, args=(tid,)))
        threads.append(threading.Thread(target=reader, args=(tid,)))

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"Concurrent cache access threw errors: {errors}"


def test_cache_ttl_cleanup():
    TableDataEditorService.invalidate_metadata_cache()

    adapter = MagicMock()
    adapter.session = MagicMock(connection_id="conn_ttl_test")

    # Manually store with a very short custom TTL (e.g. 0.05s)
    with TableDataEditorService._meta_cache_lock:
        key = TableDataEditorService._meta_cache_key(adapter, "DB", "dbo", "ShortLived")
        TableDataEditorService._meta_cache[key] = ({"data": 123}, time.time() + 0.05)

    assert TableDataEditorService._get_cached_metadata(adapter, "DB", "dbo", "ShortLived") is not None

    time.sleep(0.06)

    # Should be expired and return None, and entry purged
    assert TableDataEditorService._get_cached_metadata(adapter, "DB", "dbo", "ShortLived") is None
    with TableDataEditorService._meta_cache_lock:
        assert key not in TableDataEditorService._meta_cache
