# -*- coding: utf-8 -*-
"""
Tests for Phase 5 Step 1: ConnectionSession.exclusive() context manager.
Verifies thread-safety, lock acquisition, touch() invocation, and exception release.
"""
import threading
import time
from unittest.mock import MagicMock
from app.models.connection_session import ConnectionSession


def test_session_exclusive_acquires_lock_and_touches():
    mock_adapter = MagicMock()
    session = ConnectionSession(
        connection_id="conn_test_exclusive_1",
        owner_session_id="owner_1",
        config={"name": "TestDB", "type": "sqlserver"},
        adapter=mock_adapter,
        metadata_service=None,
        query_service=None,
    )

    t0 = session.last_used_at
    time.sleep(0.01)

    assert hasattr(session, "exclusive"), "ConnectionSession must have an 'exclusive' method/context manager"

    with session.exclusive() as sess:
        assert sess is session
        # Lock should be acquired: an RLock acquired once by the current thread
        # cannot be acquired by another thread without timeout.
        assert session.last_used_at > t0, "exclusive() should touch last_used_at"

        # Verify re-entrancy within same thread works smoothly
        with session.exclusive():
            pass

    # Verify lock is released: another thread can acquire it immediately
    acquired_by_other = False
    def other_thread():
        nonlocal acquired_by_other
        acquired = session.lock.acquire(timeout=0.5)
        if acquired:
            acquired_by_other = True
            session.lock.release()

    t = threading.Thread(target=other_thread)
    t.start()
    t.join()
    assert acquired_by_other is True, "Lock should be released after exiting exclusive block"


def test_session_exclusive_blocks_concurrent_threads():
    mock_adapter = MagicMock()
    session = ConnectionSession(
        connection_id="conn_test_exclusive_2",
        owner_session_id="owner_1",
        config={"name": "TestDB", "type": "sqlserver"},
        adapter=mock_adapter,
        metadata_service=None,
        query_service=None,
    )

    order = []

    def worker_long():
        with session.exclusive():
            order.append("worker_long_start")
            time.sleep(0.1)
            order.append("worker_long_end")

    def worker_short():
        time.sleep(0.02)  # ensure worker_long starts first
        with session.exclusive():
            order.append("worker_short_run")

    t1 = threading.Thread(target=worker_long)
    t2 = threading.Thread(target=worker_short)

    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert order == ["worker_long_start", "worker_long_end", "worker_short_run"], (
        f"Worker short should be blocked until worker long finishes. Actual order: {order}"
    )


def test_session_exclusive_releases_on_exception():
    mock_adapter = MagicMock()
    session = ConnectionSession(
        connection_id="conn_test_exclusive_3",
        owner_session_id="owner_1",
        config={"name": "TestDB", "type": "sqlserver"},
        adapter=mock_adapter,
        metadata_service=None,
        query_service=None,
    )

    try:
        with session.exclusive():
            raise ValueError("Simulated error inside exclusive block")
    except ValueError:
        pass

    # Verify lock is released despite exception
    acquired = session.lock.acquire(timeout=0.1)
    assert acquired is True
    session.lock.release()
