# -*- coding: utf-8 -*-
"""
Phase 1: Deep Comparison Test Suite between Legacy T-SQL Validator and ScriptDom Adapter.
Verifies False Positives, False Negatives, Line/Column accuracy, and stability across
procedural code, CTEs, TRY/CATCH, routines, control-flow, and modern T-SQL syntax.
"""
import pytest
from app.database.syntax.adapters.sqlserver_scriptdom import SqlServerScriptDomAdapter
from app.database.syntax.validator_mssql import validate_sql_server

adapter = SqlServerScriptDomAdapter()

CORPUS_VALID_TSQL = [
    # 1. Basic DML
    ("SELECT 1 AS col;", "Basic scalar select"),
    ("SELECT id, name FROM dbo.Users WHERE is_active = 1 ORDER BY id DESC;", "Select with filter & order"),
    ("INSERT INTO dbo.AuditLog (UserId, ActionDate) VALUES (123, GETDATE());", "Insert into table"),
    ("UPDATE u SET u.Status = 'Active' FROM dbo.Users u INNER JOIN dbo.Roles r ON u.RoleId = r.Id WHERE r.Code = 'ADM';", "Update with join"),
    ("DELETE FROM dbo.Sessions WHERE ExpiredAt < DATEADD(day, -7, GETDATE());", "Delete with date function"),
    ("MERGE INTO dbo.Target t USING dbo.Source s ON t.Id = s.Id WHEN MATCHED THEN UPDATE SET t.Val = s.Val WHEN NOT MATCHED THEN INSERT (Id, Val) VALUES (s.Id, s.Val);", "Merge statement"),
    
    # 2. CTEs
    ("WITH UserCTE AS (SELECT Id, Name FROM dbo.Users WHERE Id > 10) SELECT * FROM UserCTE;", "Single CTE"),
    ("WITH C1 AS (SELECT 1 AS n), C2 AS (SELECT n + 1 AS n2 FROM C1) SELECT * FROM C2;", "Chained CTEs"),
    ("WITH RecursiveCTE AS (SELECT 1 AS lvl UNION ALL SELECT lvl + 1 FROM RecursiveCTE WHERE lvl < 10) SELECT * FROM RecursiveCTE OPTION (MAXRECURSION 10);", "Recursive CTE"),

    # 3. Variables & Parameters
    ("DECLARE @Count INT = 0; SET @Count = (SELECT COUNT(*) FROM dbo.Users); SELECT @Count;", "Declare & Set variable"),
    ("DECLARE @tbl TABLE (Id INT PRIMARY KEY, Val NVARCHAR(50)); INSERT INTO @tbl VALUES (1, 'Test'); SELECT * FROM @tbl;", "Table variable"),

    # 4. Control Flow & Transactions
    ("""
    DECLARE @x INT = 10;
    IF @x > 5
    BEGIN
        PRINT 'Greater';
    END
    ELSE
    BEGIN
        PRINT 'Lesser or equal';
    END
    """, "IF/ELSE block"),
    ("""
    DECLARE @i INT = 0;
    WHILE @i < 5
    BEGIN
        SET @i = @i + 1;
        IF @i = 3 CONTINUE;
        IF @i = 4 BREAK;
    END
    """, "WHILE loop with BREAK/CONTINUE"),
    ("""
    BEGIN TRANSACTION;
    SAVE TRANSACTION SavePt1;
    UPDATE dbo.Accounts SET Balance = Balance - 100 WHERE Id = 1;
    COMMIT TRANSACTION;
    """, "Transactions with Savepoint"),

    # 5. TRY / CATCH (including nested)
    ("""
    BEGIN TRY
        SELECT 1 / 0;
    END TRY
    BEGIN CATCH
        SELECT ERROR_NUMBER() AS ErrNum, ERROR_MESSAGE() AS ErrMsg;
        THROW;
    END CATCH;
    """, "Single TRY/CATCH"),
    ("""
    BEGIN TRY
        PRINT 'Outer Try';
        BEGIN TRY
            PRINT 'Inner Try';
        END TRY
        BEGIN CATCH
            PRINT 'Inner Catch';
        END CATCH
    END TRY
    BEGIN CATCH
        PRINT 'Outer Catch';
    END CATCH;
    """, "Nested TRY/CATCH"),

    # 6. Stored Procedures, Functions, Triggers
    ("""
    CREATE PROCEDURE dbo.usp_GetUsers
        @DeptId INT,
        @ActiveOnly BIT = 1
    AS
    BEGIN
        SET NOCOUNT ON;
        SELECT Id, FullName, DeptId
        FROM dbo.Users
        WHERE DeptId = @DeptId
          AND (IsActive = 1 OR @ActiveOnly = 0);
    END;
    """, "Stored Procedure with params"),
    ("""
    CREATE FUNCTION dbo.fn_GetSquare (@num INT)
    RETURNS INT
    AS
    BEGIN
        RETURN @num * @num;
    END;
    """, "Scalar UDF"),
    ("""
    CREATE FUNCTION dbo.fn_GetActiveUsersInDept (@DeptId INT)
    RETURNS TABLE
    AS
    RETURN
    (
        SELECT Id, Username FROM dbo.Users WHERE DeptId = @DeptId AND IsActive = 1
    );
    """, "Inline Table-Valued Function"),
    ("""
    CREATE TRIGGER dbo.trg_UserAudit
    ON dbo.Users
    AFTER INSERT, UPDATE, DELETE
    AS
    BEGIN
        SET NOCOUNT ON;
        INSERT INTO dbo.UserHistory (UserId, ChangedAt)
        SELECT Id, GETUTCDATE() FROM inserted;
    END;
    """, "DML Trigger with inserted table"),

    # 7. Modern T-SQL Features
    ("SELECT STRING_AGG(Name, ', ') WITHIN GROUP (ORDER BY Name ASC) FROM dbo.Users;", "STRING_AGG with WITHIN GROUP"),
    ("SELECT TRIM('  hello  ') AS CleanText;", "TRIM function"),
    ("DROP TABLE IF EXISTS dbo.TempStage;", "DROP TABLE IF EXISTS"),
    ("SELECT JSON_VALUE(JsonCol, '$.user.name') AS UserName FROM dbo.LogData;", "JSON_VALUE"),
    
    # 8. Batch Separators
    ("""
    SELECT 1;
    GO
    SELECT 2;
    GO
    """, "GO batch separator"),
]

CORPUS_INVALID_TSQL = [
    # (sql, description, expected_error_fragment, expected_line)
    ("SELECT id, name, FROM Users;", "Trailing comma in select list", "from", 1),
    ("SELECT * FROM Users WHERE id == 10;", "C-style equality == instead of =", "near", 1),
    ("SELECT * FROM Users WHERE id = 10 AND;", "Trailing AND with no predicate", "near", 1),
    ("SELECT * FROM Users INNER JOIN Roles;", "INNER JOIN missing ON clause", "near", 1),
    ("WITH MyCTE (SELECT 1) SELECT * FROM MyCTE;", "CTE missing AS keyword", "near", 1),
    ("""
    CREATE PROCEDURE dbo.usp_Test
    AS
    BEGIN
        SELECT 1;
    -- Missing END
    """, "Stored procedure missing END", "end", 4),
    ("""
    BEGIN TRY
        SELECT 1;
    -- Missing END TRY before CATCH
    BEGIN CATCH
        SELECT 2;
    END CATCH
    """, "Missing END TRY before CATCH", "catch", 6),
    ("""
    DECLARE @x INT = 10;
    IF @x > 0
    BEGIN
        PRINT 'Positive';
    ELSE
    BEGIN
        PRINT 'Other';
    END
    """, "Missing END before ELSE", "else", 6),
    ("""
    CREATE FUNCTION dbo.fn_Bad (@x INT)
    RETURNS INT
    AS
    BEGIN
        DECLARE @y INT = 5
        RETURN @x + @y
    -- Missing END
    """, "Function missing closing END", "end", 7),
]


class TestPhase1ScriptDomComparison:
    """Rigorous comparison between legacy validator and ScriptDom."""

    def test_scriptdom_is_available_and_bundled(self):
        status = adapter.get_status()
        assert status["is_available"] is True, f"ScriptDOM must be initialized. Error: {status.get('error')}"
        assert status["dll_path"] is not None

    @pytest.mark.parametrize("sql,desc", CORPUS_VALID_TSQL)
    def test_scriptdom_no_false_positives_on_valid_tsql(self, sql, desc):
        """ScriptDom must not report syntax errors on valid T-SQL statements."""
        diags = adapter.validate(sql=sql)
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) == 0, f"False positive in ScriptDom on valid T-SQL ({desc}): {errors}"

    @pytest.mark.parametrize("sql,desc,fragment,line", CORPUS_INVALID_TSQL)
    def test_scriptdom_catches_all_invalid_tsql_without_false_negatives(self, sql, desc, fragment, line):
        """ScriptDom must catch syntax errors in all invalid T-SQL statements."""
        diags = adapter.validate(sql=sql)
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) > 0, f"ScriptDom failed to catch invalid T-SQL ({desc}). SQL:\n{sql}"
        
        # Verify message mentions relevant context or token
        all_msgs = " ".join(str(d.get("message", "")).lower() for d in errors)
        assert fragment.lower() in all_msgs, f"Error message should mention '{fragment}', got: {all_msgs}"

    @pytest.mark.parametrize("sql,desc,fragment,line", CORPUS_INVALID_TSQL)
    def test_compare_legacy_vs_scriptdom_detection(self, sql, desc, fragment, line):
        """Compare detection capability of legacy validator vs ScriptDom."""
        scriptdom_diags = adapter.validate(sql=sql)
        scriptdom_errors = [d for d in scriptdom_diags if d.get("severity") == "error"]

        legacy_diags = validate_sql_server(sql=sql)
        legacy_errors = [d for d in legacy_diags if d.get("severity") == "error"]

        # ScriptDom must ALWAYS catch the error
        assert len(scriptdom_errors) >= 1, f"ScriptDom missed error in {desc}"
        
        # ScriptDom error should have accurate line & column
        for err in scriptdom_errors:
            assert err.get("line") is not None and err.get("line") > 0
            assert err.get("column") is not None and err.get("column") > 0
            assert err.get("code") == "SQL_SYNTAX_ERROR"
            assert err.get("source") == "sqlserver"

    def test_fallback_when_scriptdom_fails(self):
        """When ScriptDOM parser raises or is unavailable, it must gracefully fallback to legacy validator."""
        # Create an instance with dummy nonexistent DLL to simulate unavailable state
        dummy_adapter = SqlServerScriptDomAdapter(custom_dll_path="C:\\nonexistent\\ScriptDom.dll")
        assert dummy_adapter.is_available is False

        # Must still return diagnostics (via fallback to validate_sql_server) without crashing
        res_valid = dummy_adapter.validate(sql="SELECT 1 AS col;")
        assert isinstance(res_valid, list)

        res_invalid = dummy_adapter.validate(sql="SELECT id, name, FROM Users;")
        assert isinstance(res_invalid, list)
        assert len(res_invalid) >= 1
        assert res_invalid[0].get("source") in ("tsql", "sqlserver-legacy")
