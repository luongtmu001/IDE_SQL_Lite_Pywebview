# -*- coding: utf-8 -*-
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
import pytest

from app.models.connection_session import ConnectionSession
from app.services.connection_manager import ConnectionManager


def _create_mock_session(cm: ConnectionManager, owner: str, conn_id: str, idle_seconds: int = 0, in_transaction: bool = False):
    adapter = MagicMock()
    now = datetime.now(timezone.utc)
    last_used = now - timedelta(seconds=idle_seconds)
    session = ConnectionSession(
        connection_id=conn_id,
        owner_session_id=owner,
        config={"type": "sqlserver", "server": "localhost", "database": "db"},
        adapter=adapter,
        metadata_service=None,
        query_service=None,
        in_transaction=in_transaction,
        last_used_at=last_used
    )
    with cm._lock:
        cm._connections[conn_id] = session
    return session, adapter


def test_cleanup_idle_closes_expired_connections_and_leaves_active():
    cm = ConnectionManager()
    sess_idle, mock_adapter_idle = _create_mock_session(cm, "desktop_user", "conn_idle", idle_seconds=4000)
    sess_active, mock_adapter_active = _create_mock_session(cm, "desktop_user", "conn_active", idle_seconds=300)

    closed_count = cm.cleanup_idle(max_idle_seconds=3600)

    assert closed_count == 1
    mock_adapter_idle.close.assert_called_once()
    mock_adapter_active.close.assert_not_called()

    with cm._lock:
        assert "conn_idle" not in cm._connections
        assert "conn_active" in cm._connections


def test_cleanup_idle_skips_in_transaction():
    cm = ConnectionManager()
    # Idle for 5000s but in transaction
    sess_tx, mock_adapter_tx = _create_mock_session(cm, "desktop_user", "conn_tx", idle_seconds=5000, in_transaction=True)

    closed_count = cm.cleanup_idle(max_idle_seconds=3600)

    assert closed_count == 0
    mock_adapter_tx.close.assert_not_called()
    with cm._lock:
        assert "conn_tx" in cm._connections


def test_cleanup_idle_respects_owner_session_filter():
    cm = ConnectionManager()
    sess1, mock_adapter1 = _create_mock_session(cm, "win_1", "conn_win1", idle_seconds=4000)
    sess2, mock_adapter2 = _create_mock_session(cm, "win_2", "conn_win2", idle_seconds=4000)

    closed_count = cm.cleanup_idle(max_idle_seconds=3600, owner_session_id="win_1")

    assert closed_count == 1
    mock_adapter1.close.assert_called_once()
    mock_adapter2.close.assert_not_called()
    with cm._lock:
        assert "conn_win1" not in cm._connections
        assert "conn_win2" in cm._connections


def test_close_all_for_window():
    cm = ConnectionManager()
    sess1, mock_adapter1 = _create_mock_session(cm, "win_A", "conn_A1")
    sess2, mock_adapter2 = _create_mock_session(cm, "win_A", "conn_A2")
    sess3, mock_adapter3 = _create_mock_session(cm, "win_B", "conn_B1")

    closed = cm.close_all_for_window("win_A")

    assert closed == 2
    mock_adapter1.close.assert_called_once()
    mock_adapter2.close.assert_called_once()
    mock_adapter3.close.assert_not_called()
    with cm._lock:
        assert "conn_A1" not in cm._connections
        assert "conn_A2" not in cm._connections
        assert "conn_B1" in cm._connections


def test_close_resilient_to_adapter_close_failure():
    cm = ConnectionManager()
    sess, mock_adapter = _create_mock_session(cm, "desktop_user", "conn_broken")
    mock_adapter.close.side_effect = RuntimeError("Socket already disconnected")

    # Calling close may log or raise, but must guarantee removal from _connections
    try:
        cm.close("desktop_user", "conn_broken")
    except RuntimeError:
        pass

    with cm._lock:
        assert "conn_broken" not in cm._connections
