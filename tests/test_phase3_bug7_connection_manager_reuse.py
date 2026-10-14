# -*- coding: utf-8 -*-
"""
Tests for Phase 3 Bug 7:
- Verify that ConnectionManager.create_or_get considers port and trusted_connection
  when determining if an existing connection can be reused.
"""
from unittest.mock import MagicMock, patch
import pytest
from app.services.connection_manager import ConnectionManager


@pytest.fixture
def conn_mgr():
    mgr = ConnectionManager()
    return mgr


@patch("app.services.connection_manager.create_adapter")
def test_create_or_get_distinguishes_different_ports(mock_create_adapter, conn_mgr):
    """Verify connections to same host/db/user but different ports are not reused."""
    mock_adapter1 = MagicMock()
    mock_adapter2 = MagicMock()
    mock_create_adapter.side_effect = [mock_adapter1, mock_adapter2]

    cfg1 = {"type": "sqlserver", "server": "10.0.0.1", "port": "1433", "database": "db", "username": "sa"}
    cfg2 = {"type": "sqlserver", "server": "10.0.0.1", "port": "14333", "database": "db", "username": "sa"}

    conn1, reused1 = conn_mgr.create_or_get("session1", cfg1)
    assert reused1 is False

    conn2, reused2 = conn_mgr.create_or_get("session1", cfg2)
    assert reused2 is False
    assert conn1.connection_id != conn2.connection_id


@patch("app.services.connection_manager.create_adapter")
def test_create_or_get_distinguishes_trusted_connection(mock_create_adapter, conn_mgr):
    """Verify connections with trusted_connection=True vs False are not reused."""
    mock_adapter1 = MagicMock()
    mock_adapter2 = MagicMock()
    mock_create_adapter.side_effect = [mock_adapter1, mock_adapter2]

    cfg1 = {"type": "sqlserver", "server": "10.0.0.1", "database": "db", "trusted_connection": True}
    cfg2 = {"type": "sqlserver", "server": "10.0.0.1", "database": "db", "trusted_connection": False, "username": "sa"}

    conn1, reused1 = conn_mgr.create_or_get("session1", cfg1)
    assert reused1 is False

    conn2, reused2 = conn_mgr.create_or_get("session1", cfg2)
    assert reused2 is False
    assert conn1.connection_id != conn2.connection_id


@patch("app.services.connection_manager.create_adapter")
def test_create_or_get_reuses_when_all_match(mock_create_adapter, conn_mgr):
    """Verify connection is reused when type, server, port, db, user, trusted_connection all match."""
    mock_adapter1 = MagicMock()
    mock_create_adapter.return_value = mock_adapter1

    cfg1 = {"type": "sqlserver", "server": "10.0.0.1", "port": 1433, "database": "db", "username": "sa", "trusted_connection": False}
    cfg2 = {"type": "sqlserver", "server": "10.0.0.1", "port": "1433", "database": "db", "username": "sa", "trusted_connection": False}

    conn1, reused1 = conn_mgr.create_or_get("session1", cfg1)
    assert reused1 is False

    conn2, reused2 = conn_mgr.create_or_get("session1", cfg2)
    assert reused2 is True
    assert conn1.connection_id == conn2.connection_id
