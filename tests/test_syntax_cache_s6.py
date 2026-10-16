# -*- coding: utf-8 -*-
"""
Tests for Phase 2, S6: Column Caching TTL and Invalidation on DDL.
Verifies:
1. Cache stores columns with connection_id isolation.
2. TTL expiration mechanism works as expected.
3. Invalidation functions selectively evict target tables.
4. DDL detection automatically evicts target tables from cache.
"""
import time
import pytest
from app.database.syntax.semantic_analyzer import (
    _PHYSICAL_TABLE_COLUMNS_CACHE,
    _get_cached_columns,
    _set_cached_columns,
    invalidate_physical_table_columns_cache,
    clear_physical_table_columns_cache,
    invalidate_on_ddl,
    get_physical_table_columns,
    DEFAULT_COLUMN_CACHE_TTL,
)


@pytest.fixture(autouse=True)
def clean_cache():
    clear_physical_table_columns_cache()
    yield
    clear_physical_table_columns_cache()


def test_cache_connection_isolation():
    key1 = ("conn1", "sqlserver", "", "mydb", "dbo", "orders")
    key2 = ("conn2", "sqlserver", "", "mydb", "dbo", "orders")

    _set_cached_columns(key1, {"orderid", "customerid"})
    _set_cached_columns(key2, {"orderid", "newcol"})

    assert _get_cached_columns(key1) == {"orderid", "customerid"}
    assert _get_cached_columns(key2) == {"orderid", "newcol"}


def test_cache_ttl_expiration(monkeypatch):
    current_time = 1000.0
    monkeypatch.setattr(time, "time", lambda: current_time)

    key = ("conn1", "sqlserver", "", "mydb", "dbo", "orders")
    _set_cached_columns(key, {"orderid", "total"})

    # Within TTL (50 seconds elapsed)
    current_time += 50.0
    assert _get_cached_columns(key) == {"orderid", "total"}

    # Exceeded TTL (61 seconds elapsed)
    current_time += 11.0
    assert _get_cached_columns(key) is None
    # Key should have been evicted
    assert key not in _PHYSICAL_TABLE_COLUMNS_CACHE


def test_invalidate_by_criteria():
    key1 = ("conn1", "sqlserver", "", "mydb", "dbo", "orders")
    key2 = ("conn1", "sqlserver", "", "mydb", "dbo", "customers")
    key3 = ("conn2", "sqlserver", "", "mydb", "dbo", "orders")
    key4 = ("conn1", "sqlserver", "", "mydb", "hr", "employees")

    _set_cached_columns(key1, {"orderid"})
    _set_cached_columns(key2, {"custid"})
    _set_cached_columns(key3, {"orderid"})
    _set_cached_columns(key4, {"empid"})

    # Invalidate only orders in conn1
    removed = invalidate_physical_table_columns_cache(connection_id="conn1", table_name="orders")
    assert removed == 1
    assert _get_cached_columns(key1) is None
    assert _get_cached_columns(key2) == {"custid"}
    assert _get_cached_columns(key3) == {"orderid"}
    assert _get_cached_columns(key4) == {"empid"}

    # Invalidate schema hr
    removed = invalidate_physical_table_columns_cache(schema="hr")
    assert removed == 1
    assert _get_cached_columns(key4) is None

    # Invalidate all remaining
    removed = invalidate_physical_table_columns_cache()
    assert removed == 2
    assert len(_PHYSICAL_TABLE_COLUMNS_CACHE) == 0


def test_invalidate_on_ddl():
    key_orders = ("conn1", "sqlserver", "", "mydb", "dbo", "orders")
    key_cust = ("conn1", "sqlserver", "", "mydb", "dbo", "customers")

    _set_cached_columns(key_orders, {"orderid", "total"})
    _set_cached_columns(key_cust, {"custid", "name"})

    # Run ALTER TABLE dbo.Orders
    sql = "ALTER TABLE [dbo].[Orders] ADD ExtraCol INT;"
    invalidated = invalidate_on_ddl(sql, connection_id="conn1", database="mydb")
    assert invalidated >= 1
    assert _get_cached_columns(key_orders) is None
    assert _get_cached_columns(key_cust) == {"custid", "name"}

    # Run DROP TABLE Customers
    sql = "DROP TABLE dbo.customers;"
    invalidated = invalidate_on_ddl(sql, connection_id="conn1", database="mydb")
    assert invalidated >= 1
    assert _get_cached_columns(key_cust) is None


def test_invalidate_on_ddl_create_view():
    key_view = ("conn1", "postgres", "", "mydb", "public", "v_active_users")
    _set_cached_columns(key_view, {"userid", "status"})

    sql = "CREATE OR REPLACE VIEW public.v_active_users AS SELECT userid FROM users;"
    invalidated = invalidate_on_ddl(sql, connection_id="conn1", database="mydb")
    assert invalidated >= 1
    assert _get_cached_columns(key_view) is None
