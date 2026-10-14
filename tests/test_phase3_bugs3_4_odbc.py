# -*- coding: utf-8 -*-
"""
Tests for Phase 3 Bug 3 & 4:
- Bug 3: ODBC connection string escaping for passwords containing ';' and '}'
- Bug 4: Warning log for default Encrypt=no, TrustServerCertificate=yes
"""
import logging
from unittest.mock import MagicMock, patch
import pytest
from app.database.sqlserver import SqlServerAdapter, escape_odbc_value


def test_escape_odbc_value():
    """Verify ODBC value escaping according to Microsoft ODBC specification."""
    assert escape_odbc_value("simple") == "simple"
    assert escape_odbc_value("p;ssword") == "{p;ssword}"
    assert escape_odbc_value("p}ssword") == "{p}}ssword}"
    assert escape_odbc_value("p;ss}w{ord") == "{p;ss}}w{ord}"


def test_connection_string_escapes_special_password():
    """Verify _build_connection_string wraps passwords containing ';' and '}' in braces."""
    adapter = SqlServerAdapter({
        "server": "10.0.0.1",
        "database": "TestDB",
        "username": "sa",
        "password": "p;ss}word{123",
    })
    conn_str = adapter._build_connection_string()
    assert "PWD={p;ss}}word{123};" in conn_str


def test_default_encrypt_warning_logged(caplog):
    """Verify that default Encrypt=no and TrustServerCertificate=yes emit warning logs."""
    with caplog.at_level(logging.WARNING):
        adapter = SqlServerAdapter({
            "server": "10.0.0.1",
            "database": "TestDB",
            "username": "sa",
            "password": "secret",
        })
        adapter._build_connection_string()

        assert any("Encrypt=no" in record.message for record in caplog.records)
        assert any("TrustServerCertificate=yes" in record.message for record in caplog.records)


def test_explicit_encrypt_no_warning_when_secure(caplog):
    """Verify that explicit Encrypt=yes and TrustServerCertificate=no emit no warnings."""
    with caplog.at_level(logging.WARNING):
        adapter = SqlServerAdapter({
            "server": "10.0.0.1",
            "database": "TestDB",
            "username": "sa",
            "password": "secret",
            "encrypt": True,
            "trust_server_certificate": False,
        })
        adapter._build_connection_string()

        assert not any("Encrypt=no" in record.message for record in caplog.records)
        assert not any("TrustServerCertificate=yes" in record.message for record in caplog.records)
