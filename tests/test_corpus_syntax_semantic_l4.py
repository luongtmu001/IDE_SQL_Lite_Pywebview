"""
tests/test_corpus_syntax_semantic_l4.py

L4: Semantic Syntax & Column Validation Corpus Tests
Runs 40 valid SQL cases and 20 invalid SQL cases against analyze_sql_semantics.
Known semantic false-positives (S4, S6) and false-negatives (S5, S6) are marked with xfail.
"""

import json
import os
import pytest
from app.database.syntax.semantic_analyzer import analyze_sql_semantics

CORPUS_DIR = os.path.join(os.path.dirname(__file__), "corpus", "syntax")

CACHED_SCHEMA_MSSQL = {
    "Orders": ["OrderID", "CustomerID", "OrderDate", "Total"],
    "dbo.Orders": ["OrderID", "CustomerID", "OrderDate", "Total"],
    "Customers": ["CustomerID", "CustomerName", "ContactEmail"],
    "dbo.Customers": ["CustomerID", "CustomerName", "ContactEmail"],
    "OrderItems": ["ItemID", "OrderID", "ProductID", "Quantity", "UnitPrice"],
    "dbo.OrderItems": ["ItemID", "OrderID", "ProductID", "Quantity", "UnitPrice"],
    "B00Layout": ["isactive", "col1", "col2"],
    "dbo.B00Layout": ["isactive", "col1", "col2"],
    "Region": ["RegionID", "RegionDescription", "RegionName"],
    "sales.Region": ["RegionID", "RegionDescription", "RegionName"],
    "hr.Employees": ["EmployeeID", "LastName", "FirstName", "Title"],
}

CACHED_SCHEMA_PG = {
    "orders": ["id", "customer_id", "order_date", "total"],
    "public.orders": ["id", "customer_id", "order_date", "total"],
    "Customers": ["id", "name", "email"],
    "public.Customers": ["id", "name", "email"],
    '"Customers"': ["id", "name", "email"],
    'public."Customers"': ["id", "name", "email"],
    "order_items": ["id", "order_id", "product_id", "quantity", "price"],
    "public.order_items": ["id", "order_id", "product_id", "quantity", "price"],
    "region": ["id", "name", "description"],
    "sales.region": ["id", "name", "description"],
}


def load_corpus(filename):
    path = os.path.join(CORPUS_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


VALID_CASES = load_corpus("valid.json")
INVALID_CASES = load_corpus("invalid.json")


def get_cached_schema(dialect: str):
    if "postgres" in dialect.lower() or "pg" in dialect.lower():
        return CACHED_SCHEMA_PG
    return CACHED_SCHEMA_MSSQL


@pytest.mark.parametrize("case", VALID_CASES, ids=lambda c: c["id"])
def test_semantic_valid_sql_corpus(case):
    if case.get("status") == "expectedFailure":
        pytest.xfail(f"Known Issue: {case.get('issue')}")

    sql = case["sql"]
    dialect = case.get("dialect", "sqlserver")
    cached = get_cached_schema(dialect)
    diags = analyze_sql_semantics(sql, dialect=dialect, cached_tables_dict=cached)
    assert len(diags) == 0, f"Expected 0 diagnostics for valid SQL, got: {diags}"


@pytest.mark.parametrize("case", INVALID_CASES, ids=lambda c: c["id"])
def test_semantic_invalid_sql_corpus(case):
    if case.get("status") == "expectedFailure":
        pytest.xfail(f"Known Issue: {case.get('issue')}")

    sql = case["sql"]
    dialect = case.get("dialect", "sqlserver")
    cached = get_cached_schema(dialect)
    diags = analyze_sql_semantics(sql, dialect=dialect, cached_tables_dict=cached)
    assert len(diags) > 0, f"Expected diagnostics for invalid SQL: {sql}, but got 0"
    if "token" in case.get("expect", {}):
        expected_token = case["expect"]["token"]
        tokens = [d.get("token", "").lower() for d in diags]
        assert expected_token.lower() in tokens, f"Expected token '{expected_token}' in {tokens}"
