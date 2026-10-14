"""
Tests for Semantic SQL Syntax and Column Validation.
Validates invalid column detection for:
- Physical tables (PostgreSQL & SQL Server)
- Table variables (@tbl)
- Temporary tables (#temp, ##temp, CREATE TEMP TABLE, SELECT ... INTO #temp)
- CTEs (WITH cte AS (...))
"""

import unittest
from unittest.mock import MagicMock
from app.database.syntax.semantic_analyzer import (
    extract_table_variables,
    extract_temporary_tables,
    extract_ctes,
    analyze_sql_semantics,
)
from app.database.syntax.validator import validate_sql


class TestTableVariableExtraction(unittest.TestCase):
    def test_extract_single_table_variable(self):
        sql = """
        DECLARE @customer TABLE (
            id INT PRIMARY KEY,
            code VARCHAR(50) NOT NULL,
            name NVARCHAR(100),
            amount DECIMAL(18, 2) DEFAULT 0
        );
        """
        table_vars = extract_table_variables(sql)
        assert "@customer" in table_vars
        cols = table_vars["@customer"]
        assert "id" in cols
        assert "code" in cols
        assert "name" in cols
        assert "amount" in cols
        assert "primary" not in cols

    def test_extract_multiple_table_variables(self):
        sql = """
        DECLARE @t1 TABLE (colA INT, colB VARCHAR(10));
        DECLARE @t2 TABLE (colX INT, colY DATETIME);
        """
        table_vars = extract_table_variables(sql)
        assert "@t1" in table_vars
        assert "@t2" in table_vars
        assert table_vars["@t1"] == {"cola", "colb"}
        assert table_vars["@t2"] == {"colx", "coly"}


class TestTemporaryTableExtraction(unittest.TestCase):
    def test_extract_create_hash_temp_table(self):
        sql = """
        CREATE TABLE #temp_cust (
            cust_id INT,
            cust_name VARCHAR(100),
            CONSTRAINT chk_val CHECK (cust_id > 0)
        );
        """
        temps = extract_temporary_tables(sql)
        assert "#temp_cust" in temps
        assert "cust_id" in temps["#temp_cust"]
        assert "cust_name" in temps["#temp_cust"]
        assert "chk_val" not in temps["#temp_cust"]

    def test_extract_create_postgres_temp_table(self):
        sql = """
        CREATE TEMP TABLE tmp_user (
            user_id INT,
            email TEXT
        );
        """
        temps = extract_temporary_tables(sql)
        assert "tmp_user" in temps
        assert "user_id" in temps["tmp_user"]
        assert "email" in temps["tmp_user"]

    def test_extract_select_into_temp_table(self):
        sql = """
        SELECT id, code, name AS full_name
        INTO #temp_res
        FROM b20customer;
        """
        temps = extract_temporary_tables(sql)
        assert "#temp_res" in temps
        assert "id" in temps["#temp_res"]
        assert "code" in temps["#temp_res"]
        assert "full_name" in temps["#temp_res"]


class TestCteExtraction(unittest.TestCase):
    def test_extract_cte_explicit_columns(self):
        sql = """
        WITH cte_cust (c_id, c_code) AS (
            SELECT 1, 'C01'
        )
        SELECT * FROM cte_cust;
        """
        ctes = extract_ctes(sql)
        assert "cte_cust" in ctes
        assert ctes["cte_cust"] == {"c_id", "c_code"}

    def test_extract_cte_projection_columns(self):
        sql = """
        WITH cte_cust AS (
            SELECT cust_id, cust_name AS name_alias FROM b20customer
        )
        SELECT * FROM cte_cust;
        """
        ctes = extract_ctes(sql)
        assert "cte_cust" in ctes
        assert "cust_id" in ctes["cte_cust"]
        assert "name_alias" in ctes["cte_cust"]


class TestSemanticColumnValidation(unittest.TestCase):
    def test_physical_table_invalid_column_detected(self):
        sql = "SELECT *, stt FROM b20customer;"
        cached = {"b20customer": ["id", "code", "name"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert len(diags) == 1
        d = diags[0]
        assert d["token"] == "stt"
        assert d["line"] == 1
        assert "Invalid column name 'stt'" in d["message"]
        assert d["code"] == "SQL_INVALID_COLUMN"

    def test_physical_table_valid_columns_pass(self):
        sql = "SELECT id, name FROM b20customer;"
        cached = {"b20customer": ["id", "code", "name"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert diags == []

    def test_table_variable_invalid_column_detected(self):
        sql = """
        DECLARE @b20customer TABLE (
            id INT,
            code VARCHAR(50)
        );
        SELECT *, stt FROM @b20customer;
        """
        diags = analyze_sql_semantics(sql, dialect="sqlserver")
        assert len(diags) == 1
        d = diags[0]
        assert d["token"] == "stt"
        assert "table variable '@b20customer'" in d["message"]

    def test_temporary_table_invalid_column_detected(self):
        sql = """
        CREATE TABLE #b20customer (
            id INT,
            code VARCHAR(50)
        );
        SELECT *, stt FROM #b20customer;
        """
        diags = analyze_sql_semantics(sql, dialect="sqlserver")
        assert len(diags) == 1
        d = diags[0]
        assert d["token"] == "stt"
        assert "temporary table '#b20customer'" in d["message"]

    def test_postgres_temp_table_invalid_column_detected(self):
        sql = """
        CREATE TEMP TABLE tmp_customer (
            id INT,
            code TEXT
        );
        SELECT *, stt FROM tmp_customer;
        """
        diags = analyze_sql_semantics(sql, dialect="postgres")
        assert len(diags) == 1
        d = diags[0]
        assert d["token"] == "stt"
        assert 'column "stt" does not exist' in d["message"]

    def test_qualified_column_invalid_detected(self):
        sql = "SELECT c.id, c.stt FROM b20customer c;"
        cached = {"b20customer": ["id", "code", "name"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert len(diags) == 1
        assert diags[0]["token"] == "stt"

    def test_where_clause_invalid_column_detected(self):
        sql = "SELECT id FROM b20customer WHERE stt = 1;"
        cached = {"b20customer": ["id", "code", "name"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert len(diags) == 1
        assert diags[0]["token"] == "stt"

    def test_cte_invalid_column_detected(self):
        sql = """
        WITH cust_cte AS (
            SELECT id, code FROM b20customer
        )
        SELECT *, stt FROM cust_cte;
        """
        cached = {"b20customer": ["id", "code"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert len(diags) == 1
        assert diags[0]["token"] == "stt"
        assert "CTE 'cust_cte'" in diags[0]["message"]


class TestValidateSqlIntegration(unittest.TestCase):
    def test_validate_sql_with_physical_table_and_cache(self):
        sql = "SELECT *, stt FROM b20customer;"
        cached = {"b20customer": ["id", "code", "name"]}
        diags = validate_sql(
            sql=sql,
            dialect="sqlserver",
            cached_tables_dict=cached,
        )
        assert len(diags) == 1
        assert diags[0]["token"] == "stt"
        assert "Invalid column name 'stt'" in diags[0]["message"]

    def test_validate_sql_with_table_variable(self):
        sql = """
        DECLARE @tbl TABLE (id INT, name VARCHAR(50));
        SELECT *, stt FROM @tbl;
        """
        diags = validate_sql(sql=sql, dialect="sqlserver")
        assert len(diags) == 1
        assert diags[0]["token"] == "stt"

    def test_validate_sql_with_temp_table(self):
        sql = """
        CREATE TABLE #tbl (id INT, name VARCHAR(50));
        SELECT *, stt FROM #tbl;
        """
        diags = validate_sql(sql=sql, dialect="sqlserver")
        assert len(diags) == 1
        assert diags[0]["token"] == "stt"

    def test_select_into_does_not_treat_target_as_column(self):
        # User bug: SELECT isactive INTO #temp FROM B00Layout
        sql = "SELECT isactive INTO #temp FROM B00Layout;"
        cached = {"B00Layout": ["isactive", "col1", "col2"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert diags == [], f"Expected no error, got: {diags}"

    def test_select_into_and_subsequent_invalid_column(self):
        sql = """
        SELECT isactive INTO #temp FROM B00Layout;
        SELECT invalid_col FROM #temp;
        """
        cached = {"B00Layout": ["isactive", "col1", "col2"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert len(diags) == 1
        assert diags[0]["token"] == "invalid_col"
        assert "#temp" in diags[0]["message"]

    def test_linked_server_multipart_name_invalid_column(self):
        sql = "SELECT id, wrong_col FROM [LINKED_SRV].[master].[dbo].[B00Layout];"
        cached = {"[LINKED_SRV].[master].[dbo].[B00Layout]": ["id", "isactive"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert len(diags) == 1
        assert diags[0]["token"] == "wrong_col"

    def test_linked_server_valid_columns_pass(self):
        sql = "SELECT id, isactive FROM [LINKED_SRV].[master].[dbo].[B00Layout];"
        cached = {"[LINKED_SRV].[master].[dbo].[B00Layout]": ["id", "isactive"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert diags == []

    def test_joined_tables_column_validation(self):
        sql = "SELECT a.id, b.order_num, a.bad_col FROM b20customer a JOIN b20order b ON a.id = b.cust_id;"
        cached = {
            "b20customer": ["id", "name"],
            "b20order": ["cust_id", "order_num"]
        }
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert len(diags) == 1
        assert diags[0]["token"] == "bad_col"

    def test_multiple_select_statements_second_statement_invalid(self):
        sql = """
        SELECT id, name FROM b20customer;
        SELECT id, not_a_col FROM b20customer;
        """
        cached = {"b20customer": ["id", "name"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert len(diags) == 1
        assert diags[0]["token"] == "not_a_col"

    def test_tsql_alias_assignment_does_not_flag_alias_as_invalid(self):
        sql = "SELECT TotalAmount = id, bad_col FROM b20customer;"
        cached = {"b20customer": ["id", "name"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert len(diags) == 1
        assert diags[0]["token"] == "bad_col"

    def test_space_separated_alias_does_not_flag_alias_as_invalid(self):
        sql = "SELECT id MyId, bad_col FROM b20customer;"
        cached = {"b20customer": ["id", "name"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert len(diags) == 1
        assert diags[0]["token"] == "bad_col"

    def test_variables_and_cast_expressions_in_projection_no_false_error(self):
        sql = """
        SELECT
            @_var AS col1,
            @my_var AS col2,
            CAST('' AS VARCHAR(50)) AS col3,
            CONVERT(DATETIME, '2026-01-01') AS col4,
            1 AS col5,
            ISNULL(@_var, 0) AS col6,
            COALESCE(@_var, 'default') AS col7,
            id
        FROM b20customer;
        """
        cached = {"b20customer": ["id", "name"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert diags == [], f"Expected no error for variables and expressions, got: {diags}"

    def test_postgres_cast_and_variables_in_projection_no_false_error(self):
        sql = """
        SELECT
            CAST('' AS TEXT) AS col1,
            COALESCE(NULL, 'test') AS col2,
            100 AS col3,
            id
        FROM b20customer;
        """
        cached = {"b20customer": ["id", "name"]}
        diags = analyze_sql_semantics(sql, dialect="postgres", cached_tables_dict=cached)
        assert diags == [], f"Expected no error for postgres expressions, got: {diags}"

    def test_cte_with_comments_and_joined_temp_table_no_false_error(self):
        sql = """;WITH AggregatedDetails AS (
            SELECT
                d.Amount3,
                d.OriginalAmount9,
                d.Amount9,
                d.OriginalAmount,
                d.AmountB10,
                d.OriginalAmountBeforeTax,
                d.AmountBeforeTax,
                d.isVatIncluded,
                -- 1. Tim dong co Amount3 lon nhat cua tung hoa don
                ROW_NUMBER() OVER (
                    PARTITION BY d.InvoiceID
                    ORDER BY d.Amount3 DESC, d.InvoiceDetailID ASC
                ) AS rn,
                -- 2. Tinh tong cac dong chi tiet theo tung hoa don
                SUM(d.OriginalAmount3) OVER (PARTITION BY d.InvoiceID) AS Sum_OriginalAmount3_Pb,
                SUM(d.Amount3)         OVER (PARTITION BY d.InvoiceID) AS Sum_Amount3_Pb,
                SUM(d.OriginalAmountBeforeTax) OVER (PARTITION BY d.InvoiceID) AS Sum_OriginalAmount9_Pb,
                SUM(d.AmountBeforeTax)         OVER (PARTITION BY d.InvoiceID) AS Sum_Amount9_Pb,
                -- 3. Lay so chung tu
                h.TotalOrig,
                h.TotalAmou
            FROM #CtTmp0 d
                INNER JOIN #Ct h ON d.InvoiceID = h.InvoiceID
        ),
        DifferenceCalculation AS (
            SELECT 1 AS x
        )
        SELECT * FROM DifferenceCalculation;
        """
        # Even with #CtTmp0 and #Ct not explicitly declared in this script,
        # it should safely skip unknown tables or joined unknown tables and produce 0 errors.
        diags = validate_sql(sql, dialect="sqlserver")
        assert diags == [], f"Expected no false error in CTE query, got: {diags}"

    def test_temp_table_from_db_session_lookup(self):
        from unittest.mock import MagicMock
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = [("col_a",), ("col_b",)]
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter = MagicMock()
        mock_adapter.connection = mock_conn
        mock_session = MagicMock()
        mock_session.adapter = mock_adapter
        mock_session.lock = None

        sql = "SELECT col_a, invalid_col FROM #ExternalTemp;"
        diags = analyze_sql_semantics(sql, dialect="sqlserver", connection_session=mock_session)
        assert len(diags) == 1
        assert diags[0]["token"] == "invalid_col"
        assert "#externaltemp" in diags[0]["message"].lower()

    def test_dynamic_sql_and_n_literal_does_not_trigger_false_errors(self):
        sql = """
        DROP TABLE IF EXISTS #TblNX
        SELECT TOP 0 Id, Unit, ItemId INTO #TblNX FROM dbo.B00CtTmp

        EXECUTE dbo.usp_sys_DefaultTable @_table = N'#TblNX'

        SET @_StrExec = '
            ;WITH Cte AS (SELECT IdTmp FROM #TblRequest)
            INSERT INTO #TblNX (Id, Unit) SELECT a.Id, a.Unit FROM #TblRequest a
        '
        """
        cached = {"dbo.B00CtTmp": ["id", "unit", "itemid"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert diags == [], f"Expected 0 false errors, got: {diags}"

    def test_select_without_from_does_not_swallow_subsequent_ddl(self):
        sql = """
        BEGIN
            IF 1 = 1
                SELECT @_WarehouseId
        END

        DROP TABLE IF EXISTS #V_CtTmp0
        SELECT TOP 0 Id, DocCode INTO #V_CtTmp0 FROM dbo.B00CtTmp

        EXECUTE dbo.usp_sys_DefaultTable @_Table = N'#V_CtTmp0'
        """
        cached = {"dbo.B00CtTmp": ["id", "doccode"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert diags == [], f"Expected 0 false errors, got: {diags}"

    def test_update_statement_without_semicolon_does_not_flag_declare_variables(self):
        sql = """
        CREATE TABLE #TblResult (
            DiffRequestedIssued INT,
            DiffRequiredIssued INT,
            DiffRequestedRequired INT,
            DiffExWarehouseIssued INT
        )

        UPDATE #TblResult
            SET DiffRequestedIssued = ISNULL(DiffRequestedIssued, 0),
                DiffRequiredIssued = ISNULL(DiffRequiredIssued, 0),
                DiffRequestedRequired = 0,
                DiffExWarehouseIssued = 0

        DECLARE @_ValueCol VARCHAR(36), @_CodeCol VARCHAR(36), @_NameCol NVARCHAR(36), @_Description NVARCHAR(64),
            @_TableName VARCHAR(36), @_FilterExpr VARCHAR(256), @_SqlTmp NVARCHAR(4000)

        SET @_CodeCol = 'TEST'
        """
        diags = analyze_sql_semantics(sql, dialect="sqlserver")
        assert diags == [], f"Expected 0 false errors on UPDATE without semicolon and DECLARE, got: {diags}"

    def test_subquery_in_where_clause_does_not_attribute_inner_column_to_outer_table(self):
        sql = """
        SELECT DISTINCT(value) AS GroupByCols
        INTO #_TblGroupCols
        FROM STRING_SPLIT(@_IsDetailColumn, ',')

        SELECT @_GroupCols = STRING_AGG(Code, ',')
        FROM dbo.B20Class
        WHERE ParentCode='REP_St'
            AND Code IN (SELECT GroupByCols FROM #_TblGroupCols)
        """
        cached = {"dbo.b20class": ["parentcode", "code", "name"]}
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert diags == [], f"Expected 0 false errors on WHERE subquery, got: {diags}"

    def test_derived_table_and_subquery_join_does_not_flag_false_columns(self):
        sql = """
        DROP TABLE IF EXISTS #Compare
        SELECT a.ItemId, W.RowId_SourceDoc, a.ItemId0, a.Unit, a.StatsDocId_W0, a.ProductionLineId, a.ProductionProcessId, a.FactoryId, a.BizDocId_S0,
            a.QuantityRequired, W.Quantity9 AS ReplaceQuantity, ISNULL(a.QuantityRequired, 0) - ISNULL(W.Quantity9, 0) AS Diff
        INTO #Compare
        FROM #TblStatsDocWO a
            INNER JOIN #V_CtTmp0 c ON a.ItemId = c.ItemId
            INNER JOIN (
                SELECT DocCode, RowId_SourceDoc, Quantity9
                FROM #TblStatsDocWO
                WHERE DocCode = 'WO' AND ISNULL(RowId_SourceDoc, '') <> ''
                GROUP BY RowId_SourceDoc
            ) AS W ON a.RowId = W.RowId_SourceDoc
        """
        cached = {
            "#tblstatsdocwo": ["itemid", "itemid0", "unit", "statsdocid_w0", "productionlineid", "productionprocessid", "factoryid", "bizdocid_s0", "quantityrequired", "rowid", "doccode", "rowid_sourcedoc", "quantity9"]
        }
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert diags == [], f"Expected 0 false errors on derived table join and subquery, got: {diags}"

    def test_string_agg_within_group_does_not_flag_within_as_column(self):
        sql = """
        ;WITH W
        AS
        (
            SELECT value, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
            FROM STRING_SPLIT(@_IsDetailColumn, ',')
        )
        SELECT @_Layout = STRING_AGG(CONVERT(NVARCHAR(MAX), class.ValueExpr), CHAR(13)) WITHIN GROUP (ORDER BY W.RowNum)
        FROM W
            LEFT OUTER JOIN dbo.B20Class AS class ON W.value = class.Code AND class.ParentCode='REP_Stats_MCM';
        """
        cached = {
            "dbo.b20class": ["code", "parentcode", "valueexpr"],
            "b20class": ["code", "parentcode", "valueexpr"],
        }
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert diags == [], f"Expected 0 false errors on WITHIN GROUP, got: {diags}"

    def test_select_into_temp_table_preceded_by_ctes_and_selects_preserves_columns(self):
        sql = """
        ;WITH W
        AS
        (
            SELECT value, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
            FROM STRING_SPLIT(@_IsDetailColumn, ',')
        )
        SELECT @_Layout = STRING_AGG(CONVERT(NVARCHAR(MAX), class.ValueExpr), CHAR(13)) WITHIN GROUP (ORDER BY W.RowNum)
        FROM W
            LEFT OUTER JOIN dbo.B20Class AS class ON W.value = class.Code;

        SELECT ItemId, ItemCode, ItemName
        INTO #TblResult
        FROM dbo.B20Item;

        SELECT rs.ItemId, rs.ItemCode, rs.ItemName
        FROM #TblResult AS rs;

        SELECT rs.NonExistentColumn
        FROM #TblResult AS rs;
        """
        cached = {
            "dbo.b20class": ["code", "valueexpr"],
            "dbo.b20item": ["itemid", "itemcode", "itemname"],
        }
        diags = analyze_sql_semantics(sql, dialect="sqlserver", cached_tables_dict=cached)
        assert len(diags) == 1, f"Expected exactly 1 diagnostic for NonExistentColumn, got: {diags}"
        assert diags[0]["token"] == "NonExistentColumn"
        assert "NonExistentColumn" in diags[0]["message"]

    def test_select_star_into_temp_table_does_not_flag_dynamic_columns(self):
        sql = """
        SELECT *
        INTO #TblResult
        FROM dbo.B20Item;

        SELECT rs.ItemId, rs.AnyDynamicColumn
        FROM #TblResult AS rs;
        """
        diags = analyze_sql_semantics(sql, dialect="sqlserver")
        assert diags == [], f"Expected 0 false errors on wildcard SELECT INTO temp table, got: {diags}"



