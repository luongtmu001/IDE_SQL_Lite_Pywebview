# -*- coding: utf-8 -*-
import pytest
from app.services.report_layout_gen.result_shape.parser import (
    clean_identifier,
    extract_columns_from_select_clause,
    parse_create_table_columns,
    parse_postgres_cursors,
    parse_sql_server_selects,
)


def test_clean_identifier():
    assert clean_identifier("[DocNo]") == "DocNo"
    assert clean_identifier('"DocDate"') == "DocDate"
    assert clean_identifier("`TotalAmount`") == "TotalAmount"
    assert clean_identifier("  ItemName  ") == "ItemName"


def test_extract_columns_from_select_clause():
    sql = "a.Id, a.DocNo AS [DocumentNumber], b.ItemName, TotalAmount = a.Qty * a.Price, c.Description"
    cols = extract_columns_from_select_clause(sql)
    names = [c["name"] for c in cols]
    assert names == ["Id", "DocumentNumber", "ItemName", "TotalAmount", "Description"]


def test_parse_sql_server_selects_with_temp_table():
    proc_body = """
    CREATE PROCEDURE usp_Report_Sales
        @DocId int
    AS
    BEGIN
        SET NOCOUNT ON;

        CREATE TABLE #Detail (
            BuiltinOrder int,
            ItemName nvarchar(250),
            Quantity decimal(18, 4),
            Price decimal(18, 2)
        );

        INSERT INTO #Detail (BuiltinOrder, ItemName, Quantity, Price)
        SELECT row_number() over (order by id), name, qty, price FROM TblSalesDetail WHERE DocId = @DocId;

        -- Final output query
        SELECT 
            BuiltinOrder,
            ItemName,
            Quantity,
            Price,
            Total = Quantity * Price
        FROM #Detail;
    END
    """
    result_sets = parse_sql_server_selects(proc_body)
    assert len(result_sets) == 1
    assert result_sets[0]["name"] == "Table0"
    col_names = [c["name"] for c in result_sets[0]["columns"]]
    assert col_names == ["BuiltinOrder", "ItemName", "Quantity", "Price", "Total"]


def test_parse_sql_server_selects_expand_select_into_and_filter_vars():
    proc_body = """
    CREATE PROCEDURE dbo.usp_Ket_ListOfVATTax
        @DocId int,
        @_TotalAmount decimal(18,2) OUTPUT,
        @_TotalTaxableAmount decimal(18,2) OUTPUT,
        @_TotalVAT decimal(18,2) OUTPUT
    AS
    BEGIN
        -- 1. Create temp table via SELECT INTO
        SELECT 
            d.DocDate,
            d.DocNo,
            d.CustomerName,
            d.Amount,
            d.TaxRate
        INTO #TempResult
        FROM InvoiceData d
        WHERE d.DocId = @DocId;

        -- 2. Variable assignment query (should NOT be detected as a result set)
        SELECT 
            @_TotalAmount = ISNULL(SUM(Amount), 0),
            @_TotalTaxableAmount = ISNULL(SUM(Amount), 0),
            @_TotalVAT = ISNULL(SUM(Amount * TaxRate / 100), 0)
        FROM #TempResult;

        -- 3. Final output query with SELECT * plus added computed columns
        SELECT 
            *,
            Notes = 'VND',
            BlankForHTKK = '',
            DocDate_Exp = DocDate
        FROM #TempResult
        ORDER BY DocDate;
    END
    """
    result_sets = parse_sql_server_selects(proc_body)
    # Variable assignment must be filtered out, only the final SELECT should be returned
    assert len(result_sets) == 1
    assert result_sets[0]["name"] == "Table0"
    col_names = [c["name"] for c in result_sets[0]["columns"]]
    # Should contain expanded columns from #TempResult PLUS the extra added columns
    assert col_names == [
        "DocDate",
        "DocNo",
        "CustomerName",
        "Amount",
        "TaxRate",
        "Notes",
        "BlankForHTKK",
        "DocDate_Exp",
    ]


def test_parse_sql_server_selects_ignore_insert_into_and_subqueries():
    proc_body = """
    CREATE PROCEDURE dbo.usp_DemoProc
    AS
    BEGIN
        INSERT INTO TargetTable (Col1, Col2)
        SELECT a.Val1, a.Val2
        FROM TblSource a
        WHERE EXISTS (SELECT 1 FROM OtherTbl o WHERE o.Id = a.Id);

        SELECT TOP 0 Id, Name, Code INTO #TempZero FROM BaseTbl;

        SELECT 
            *,
            ExtraCol = 'Demo'
        FROM #TempZero;
    END
    """
    result_sets = parse_sql_server_selects(proc_body)
    assert len(result_sets) == 1
    assert result_sets[0]["name"] == "Table0"
    col_names = [c["name"] for c in result_sets[0]["columns"]]
    assert col_names == ["Id", "Name", "Code", "ExtraCol"]

    func_source = """
    DECLARE
        cur_header refcursor;
        cur_detail refcursor;
    BEGIN
        OPEN cur_header FOR SELECT doc_no AS DocNo, doc_date AS DocDate FROM tbl_header WHERE id = p_id;
        OPEN cur_detail FOR SELECT item_name AS ItemName, qty AS Quantity FROM tbl_detail WHERE header_id = p_id;
    END;
    """
    cursors = parse_postgres_cursors(func_source)
    assert len(cursors) == 2
    assert cursors[0]["name"] == "cur_header"
    assert [c["name"] for c in cursors[0]["columns"]] == ["DocNo", "DocDate"]
    assert cursors[1]["name"] == "cur_detail"
    assert [c["name"] for c in cursors[1]["columns"]] == ["ItemName", "Quantity"]


def test_sqlserver_detector_list_and_describe_mock():
    from unittest.mock import MagicMock
    from app.services.report_layout_gen.result_shape.sqlserver import SqlServerResultShapeDetector

    mock_cm = MagicMock()
    mock_conn = MagicMock()
    mock_adapter = MagicMock()
    mock_cursor = MagicMock()

    mock_conn.adapter = mock_adapter
    mock_adapter.connection.cursor.return_value = mock_cursor
    mock_cm._connections = {"conn_1": mock_conn}

    # Mock list_routines
    mock_cursor.description = [("schema",), ("name",), ("type",), ("kind",)]
    mock_cursor.fetchall.return_value = [
        ("dbo", "usp_Report_Sales", "P", "SQL_STORED_PROCEDURE"),
        ("dbo", "fn_GetBalance", "FN", "SQL_SCALAR_FUNCTION"),
    ]

    detector = SqlServerResultShapeDetector(mock_cm, "conn_1")
    routines = detector.list_routines(schema="dbo")
    assert len(routines) == 2
    assert routines[0]["name"] == "usp_Report_Sales"
    assert routines[0]["type"] == "P"
    assert routines[1]["name"] == "fn_GetBalance"
    assert routines[1]["type"] == "FN"


def test_postgres_detector_list_routines_mock():
    from unittest.mock import MagicMock
    from app.services.report_layout_gen.result_shape.postgresql import PostgresResultShapeDetector

    mock_cm = MagicMock()
    mock_conn = MagicMock()
    mock_adapter = MagicMock()
    mock_cursor = MagicMock()

    mock_conn.adapter = mock_adapter
    mock_adapter.connection.cursor.return_value = mock_cursor
    mock_cm._connections = {"conn_pg": mock_conn}

    mock_cursor.description = [("schema",), ("name",), ("type",), ("kind",)]
    mock_cursor.fetchall.return_value = [
        ("public", "get_sales_report", "P", "PROCEDURE"),
        ("public", "calc_tax", "FN", "FUNCTION"),
    ]

    detector = PostgresResultShapeDetector(mock_cm, "conn_pg")
    routines = detector.list_routines(schema="public")
    assert len(routines) == 2
    assert routines[0]["name"] == "get_sales_report"
    assert routines[0]["type"] == "P"
    assert routines[1]["name"] == "calc_tax"
    assert routines[1]["type"] == "FN"


def test_parse_sql_server_selects_kct_and_dynamic():
    import os
    if os.path.exists("usp_kct_def.sql"):
        with open("usp_kct_def.sql", "r", encoding="utf-8") as f:
            kct_sql = f.read()
        res = parse_sql_server_selects(kct_sql)
        assert len(res) == 1
        assert res[0]["table_source"] == "#BcTmp_Kct07"
        col_names = [c["name"] for c in res[0]["columns"]]
        assert len(col_names) == 39
        assert "Stt_Sx" in col_names
        assert "Notes" in col_names
        assert "BlankForHTKK" in col_names
        assert "DocDate_Exp" in col_names
        assert "_LinkCommand" in col_names
        assert "Stt_Order1" in col_names

    # Dynamic SQL test
    proc_dyn = """
    CREATE PROCEDURE usp_DynReport
    AS
    BEGIN
        EXEC('SELECT CustId, CustName, Balance FROM Customers WHERE Status = 1')
    END
    """
    res_dyn = parse_sql_server_selects(proc_dyn)
    assert len(res_dyn) == 1
    assert [c["name"] for c in res_dyn[0]["columns"]] == ["CustId", "CustName", "Balance"]


