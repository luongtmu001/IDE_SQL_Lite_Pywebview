# -*- coding: utf-8 -*-
"""
Tests for Phase A: Procedure and Function Body Syntax Checking.
Verifies elimination of false positive syntax/semantic errors inside procedure and function bodies
for both SQL Server (T-SQL) and PostgreSQL.
"""
from __future__ import annotations

import pytest

from app.database.syntax.coordinator import validate_sql_pipeline
from app.database.syntax.proc_body_detector import (
    extract_proc_bodies,
    get_proc_local_identifiers,
    get_proc_params_from_sql,
    is_procedural_sql,
)


# ==============================================================================
# 1. Procedural SQL Detector Tests
# ==============================================================================

class TestProceduralSqlDetector:
    def test_is_procedural_sqlserver(self):
        sql_proc = "CREATE PROCEDURE dbo.usp_GetUsers @Id INT AS BEGIN SELECT * FROM Users; END;"
        assert is_procedural_sql(sql_proc, "sqlserver") is True

        sql_proc_short = "CREATE PROC usp_Test AS BEGIN SELECT 1; END;"
        assert is_procedural_sql(sql_proc_short, "sqlserver") is True

        sql_func = "CREATE FUNCTION dbo.fn_Add(@a INT, @b INT) RETURNS INT AS BEGIN RETURN @a + @b; END;"
        assert is_procedural_sql(sql_func, "sqlserver") is True

        sql_trig = "CREATE TRIGGER trg_Audit ON Users AFTER INSERT AS BEGIN SET NOCOUNT ON; END;"
        assert is_procedural_sql(sql_trig, "sqlserver") is True

        sql_plain = "SELECT id, name FROM Users WHERE active = 1;"
        assert is_procedural_sql(sql_plain, "sqlserver") is False

    def test_is_procedural_postgres(self):
        sql_fn = """
        CREATE OR REPLACE FUNCTION get_balance(p_acc_id INT)
        RETURNS NUMERIC AS $$
        BEGIN
            RETURN 100.0;
        END;
        $$ LANGUAGE plpgsql;
        """
        assert is_procedural_sql(sql_fn, "postgres") is True

        sql_do = "DO $$ BEGIN PERFORM 1; END $$;"
        assert is_procedural_sql(sql_do, "postgres") is True

        sql_plain = "SELECT id, name FROM accounts WHERE balance > 0;"
        assert is_procedural_sql(sql_plain, "postgres") is False

    def test_extract_tsql_proc_parameters(self):
        sql = """
        CREATE PROCEDURE dbo.usp_ProcessOrder
            @OrderID INT,
            @CustomerCode VARCHAR(20) = 'GUEST',
            @TotalAmount DECIMAL(18, 2) OUTPUT
        AS
        BEGIN
            SET NOCOUNT ON;
        END;
        """
        bodies = extract_proc_bodies(sql, "sqlserver")
        assert len(bodies) == 1
        proc = bodies[0]
        assert proc["clean_name"] == "usp_processorder"
        assert proc["type"] == "PROCEDURE"
        assert "@orderid" in proc["params"]
        assert "@customercode" in proc["params"]
        assert "@totalamount" in proc["params"]

    def test_extract_postgres_proc_parameters(self):
        sql = """
        CREATE OR REPLACE FUNCTION update_user_status(
            p_user_id INT,
            IN p_status VARCHAR(20),
            OUT p_success BOOLEAN
        ) RETURNS BOOLEAN AS $$
        BEGIN
            RETURN true;
        END;
        $$ LANGUAGE plpgsql;
        """
        bodies = extract_proc_bodies(sql, "postgres")
        assert len(bodies) == 1
        proc = bodies[0]
        assert proc["clean_name"] == "update_user_status"
        assert "p_user_id" in proc["params"]
        assert "p_status" in proc["params"]
        assert "p_success" in proc["params"]

    def test_get_proc_local_identifiers_tsql(self):
        sql = """
        CREATE PROCEDURE dbo.usp_Calculate
            @InputVal INT
        AS
        BEGIN
            DECLARE @Multiplier INT = 2;
            DECLARE @Result INT;
            SELECT @Result = @InputVal * @Multiplier;
        END;
        """
        idents = get_proc_local_identifiers(sql, "sqlserver")
        assert "inputval" in idents
        assert "@inputval" in idents
        assert "multiplier" in idents
        assert "@multiplier" in idents
        assert "result" in idents
        assert "@result" in idents

    def test_get_proc_local_identifiers_postgres(self):
        sql = """
        CREATE OR REPLACE FUNCTION calculate_bonus(p_emp_id INT, p_year INT)
        RETURNS NUMERIC AS $$
        DECLARE
            v_salary NUMERIC;
            v_bonus_rate NUMERIC := 0.15;
            rec RECORD;
        BEGIN
            FOR rec IN SELECT salary FROM employee_records LOOP
                v_salary := rec.salary;
            END LOOP;
            RETURN v_salary * v_bonus_rate;
        END;
        $$ LANGUAGE plpgsql;
        """
        idents = get_proc_local_identifiers(sql, "postgres")
        assert "p_emp_id" in idents
        assert "p_year" in idents
        assert "v_salary" in idents
        assert "v_bonus_rate" in idents
        assert "rec" in idents


# ==============================================================================
# 2. SQL Server Procedure Body False Positive Elimination Tests
# ==============================================================================

class TestSqlServerProcBodyFalsePositiveElimination:
    def test_tsql_procedure_parameters_in_where_no_false_error(self):
        sql = """
        CREATE PROCEDURE dbo.usp_FindCustomers
            @CustID INT,
            @Status VARCHAR(10)
        AS
        BEGIN
            SELECT CustomerID, CustomerName
            FROM Customers
            WHERE CustomerID = @CustID AND Status = @Status;
        END;
        """
        cached_tables = {
            "customers": ["CustomerID", "CustomerName", "Status"]
        }
        diags = validate_sql_pipeline(
            sql=sql,
            dialect="sqlserver",
            cached_tables_dict=cached_tables,
        )
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) == 0, f"Unexpected errors: {errors}"

    def test_tsql_procedure_variable_assignment_in_select_no_false_error(self):
        sql = """
        CREATE PROCEDURE dbo.usp_GetOrderCount
            @CustID INT
        AS
        BEGIN
            DECLARE @TotalOrders INT;
            SELECT @TotalOrders = COUNT(*)
            FROM Orders
            WHERE CustomerID = @CustID;
        END;
        """
        cached_tables = {
            "orders": ["OrderID", "CustomerID", "OrderDate"]
        }
        diags = validate_sql_pipeline(
            sql=sql,
            dialect="sqlserver",
            cached_tables_dict=cached_tables,
        )
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) == 0, f"Unexpected errors: {errors}"

    def test_tsql_procedure_with_syntax_error_is_still_detected(self):
        sql = """
        CREATE PROCEDURE dbo.usp_BrokenProc
            @ID INT
        AS
        BEGIN
            SELECT CustomerID FORM Customers WHERE CustomerID = @ID;
        END;
        """
        cached_tables = {
            "customers": ["CustomerID", "CustomerName"]
        }
        diags = validate_sql_pipeline(
            sql=sql,
            dialect="sqlserver",
            cached_tables_dict=cached_tables,
        )
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) >= 1
        # The syntax error must be flagged on line 6 inside the procedure body
        assert any(d.get("line") == 6 for d in errors)


# ==============================================================================
# 3. PostgreSQL Function and DO Block False Positive Elimination Tests
# ==============================================================================

class TestPostgreSqlProcBodyFalsePositiveElimination:
    def test_postgres_function_parameters_no_false_error(self):
        sql = """
        CREATE OR REPLACE FUNCTION get_account_info(p_acc_id INT, p_branch TEXT)
        RETURNS TABLE(account_id INT, balance NUMERIC) AS $$
        BEGIN
            RETURN QUERY
            SELECT account_id, balance
            FROM accounts
            WHERE account_id = p_acc_id AND branch_code = p_branch;
        END;
        $$ LANGUAGE plpgsql;
        """
        cached_tables = {
            "accounts": ["account_id", "balance", "branch_code"]
        }
        diags = validate_sql_pipeline(
            sql=sql,
            dialect="postgres",
            cached_tables_dict=cached_tables,
        )
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) == 0, f"Unexpected errors: {errors}"

    def test_postgres_function_select_into_variable_no_false_error(self):
        sql = """
        CREATE OR REPLACE FUNCTION get_user_balance(p_uid INT)
        RETURNS NUMERIC AS $$
        DECLARE
            v_user_balance NUMERIC;
        BEGIN
            SELECT balance INTO v_user_balance
            FROM accounts
            WHERE user_id = p_uid;
            RETURN v_user_balance;
        END;
        $$ LANGUAGE plpgsql;
        """
        cached_tables = {
            "accounts": ["user_id", "balance"]
        }
        diags = validate_sql_pipeline(
            sql=sql,
            dialect="postgres",
            cached_tables_dict=cached_tables,
        )
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) == 0, f"Unexpected errors: {errors}"

    def test_postgres_do_block_no_false_error(self):
        sql = """
        DO $$
        DECLARE
            v_count INT := 0;
        BEGIN
            v_count := v_count + 1;
        END;
        $$;
        """
        diags = validate_sql_pipeline(
            sql=sql,
            dialect="postgres",
        )
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) == 0, f"Unexpected errors: {errors}"

    def test_postgres_unmatched_begin_in_proc_detected(self):
        sql = """
        CREATE OR REPLACE FUNCTION test_broken() RETURNS void AS $$
        BEGIN
            IF true THEN
                NULL;
            END IF;
        $$ LANGUAGE plpgsql;
        """
        diags = validate_sql_pipeline(
            sql=sql,
            dialect="postgres",
        )
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) >= 1
        assert any("BEGIN" in d.get("message", "") for d in errors)

    def test_postgres_unclosed_dollar_quote_detected(self):
        sql = """
        CREATE OR REPLACE FUNCTION test_unclosed() RETURNS void AS $$
        BEGIN
            NULL;
        END;
        """
        diags = validate_sql_pipeline(
            sql=sql,
            dialect="postgres",
        )
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) >= 1
        assert any("Unclosed dollar-quoted" in d.get("message", "") for d in errors)
