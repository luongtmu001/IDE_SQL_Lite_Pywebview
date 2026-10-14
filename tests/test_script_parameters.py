"""
Unit tests for SQL Script Parameters and SQL Injection Prevention (Mục 5.2).
"""
import pytest
from app.utils.sql_params import (
    extract_param_declarations,
    find_param_placeholders,
    get_query_parameters,
    format_safe_param_value,
    substitute_parameters
)


def test_extract_param_declarations():
    sql = """
    -- @param cust_id: number = 42
    -- @param cust_name: string = 'Luong'
    -- @param order_date: date = 2026-10-14
    -- @param table_name: identifier = Customers
    SELECT * FROM {{table_name}} WHERE Id = {{cust_id}} AND Name = {{cust_name}} AND CreatedDate >= {{order_date}};
    """
    decls = extract_param_declarations(sql)
    assert len(decls) == 4
    assert decls["cust_id"]["type"] == "number"
    assert decls["cust_id"]["default"] == "42"
    assert decls["cust_name"]["type"] == "string"
    assert decls["cust_name"]["default"] == "Luong"
    assert decls["order_date"]["type"] == "date"
    assert decls["order_date"]["default"] == "2026-10-14"
    assert decls["table_name"]["type"] == "identifier"
    assert decls["table_name"]["default"] == "Customers"


def test_find_param_placeholders_ignores_strings_and_comments():
    sql = """
    -- Comment with {{ignored_in_comment}}
    /* Block comment with {{ignored_in_block_comment}} */
    SELECT 'Literal string with {{ignored_in_string}}' AS col,
           {{active_param}} AS active_col
    FROM Orders
    """
    phs = find_param_placeholders(sql, dialect="sqlserver")
    assert len(phs) == 1
    assert phs[0]["name"] == "active_param"


def test_format_safe_param_value_prevents_sql_injection():
    # 1. Number validation
    assert format_safe_param_value("123", "number") == "123"
    assert format_safe_param_value("-45.67", "number") == "-45.67"
    with pytest.raises(ValueError):
        format_safe_param_value("123; DROP TABLE Users;--", "number")

    # 2. String escaping
    malicious_string = "admin' OR '1'='1"
    escaped_tsql = format_safe_param_value(malicious_string, "string", dialect="sqlserver")
    assert escaped_tsql == "N'admin'' OR ''1''=''1'"

    escaped_pg = format_safe_param_value(malicious_string, "string", dialect="postgresql")
    assert escaped_pg == "'admin'' OR ''1''=''1'"

    # 3. Identifier quoting
    ident_tsql = format_safe_param_value("User]Table", "identifier", dialect="sqlserver")
    assert ident_tsql == "[User]]Table]"

    ident_pg = format_safe_param_value('User"Table', "identifier", dialect="postgresql")
    assert ident_pg == '"User""Table"'

    # 4. Date validation
    date_val = format_safe_param_value("2026-10-14", "date")
    assert date_val == "'2026-10-14'"
    with pytest.raises(ValueError):
        format_safe_param_value("invalid-date' OR 1=1--", "date")


def test_substitute_parameters_end_to_end():
    sql = """
    -- @param id: number = 1
    -- @param name: string = Test
    SELECT * FROM Users WHERE id = {{id}} AND name = {{name}};
    """
    params = {"id": 999, "name": "O'Connor"}
    substituted = substitute_parameters(sql, params, dialect="sqlserver")
    assert "WHERE id = 999 AND name = N'O''Connor';" in substituted


def test_query_service_parameters_substitution():
    from unittest.mock import MagicMock
    from app.services.query_service import QueryService
    mock_session = MagicMock()
    mock_session.adapter.db_type = "sqlserver"
    mock_session.adapter.execute.return_value = {"success": True, "results": []}

    qs = QueryService(mock_session)
    sql = "-- @param id: number\nSELECT * FROM Users WHERE id = {{id}}"
    res = qs.execute(sql, parameters={"id": 123}, stop_on_error=True)

    assert res["success"] is True
    called_sql = mock_session.adapter.execute.call_args[0][0]
    assert "WHERE id = 123" in called_sql
    assert mock_session.adapter.execute.call_args[1]["stop_on_error"] is True


def test_main_api_parse_query_parameters():
    from main import MainApi
    api = MainApi()
    sql = """
    -- @param dept: string = IT
    SELECT * FROM Dept WHERE name = {{dept}}
    """
    res = api.parse_query_parameters(sql, dialect="sqlserver")
    assert res["success"] is True
    assert len(res["parameters"]) == 1
    assert res["parameters"][0]["name"] == "dept"
    assert res["parameters"][0]["default"] == "IT"

