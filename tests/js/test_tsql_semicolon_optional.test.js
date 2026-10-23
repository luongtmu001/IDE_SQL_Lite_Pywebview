/**
 * tests/js/test_tsql_semicolon_optional.test.js
 * 
 * Verifies that SQL Server (T-SQL) statements without semicolons (;)
 * produce accurate statement boundaries, clauses, positions, and autocomplete rankings,
 * behaving consistently with queries that use semicolons.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { createIdeContext } = require('./load.js');

describe('T-SQL: Semicolon-less Statement Boundary & IntelliSense Tests', () => {
    test('Boundary: UPDATE without semicolon splits properly before subsequent SELECT', () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const sql = 'UPDATE dbo.Orders SET Total = 10 WHERE OrderID = 1\nSELECT ';
        const cursor = sql.length;
        const ctx = ide.analyze(sql, cursor, 'sqlserver');

        assert.ok(ctx.statementRange.start > 0, 'Statement range start must isolate second statement');
        assert.strictEqual(ctx.clause, 'SELECT');
    });

    test('Ranking: UPDATE without semicolon then typing S suggests SELECT at top', async () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const tabCtx = { connectionId: 'conn-1', database: 'testdb', schema: 'dbo', dbType: 'mssql' };

        const sqlNoSemi = 'UPDATE dbo.Orders SET Total = 10\nS';
        const completionsNoSemi = await ide.getCompletions(sqlNoSemi, null, tabCtx);
        const topNoSemi = completionsNoSemi.slice(0, 5).map(c => c.label || c.name);

        assert.ok(topNoSemi.includes('SELECT'), `Expected 'SELECT' in top suggestions for no-semicolon UPDATE, got: ${topNoSemi.join(', ')}`);
        assert.strictEqual(topNoSemi[0], 'SELECT', 'Top suggestion should be SELECT');
    });

    test('Ranking: UPDATE without semicolon then SELECT suggests SELECT clause starters', async () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const tabCtx = { connectionId: 'conn-1', database: 'testdb', schema: 'dbo', dbType: 'mssql' };

        const sqlNoSemi = 'UPDATE dbo.Orders SET Total = 10\nSELECT ';
        const completionsNoSemi = await ide.getCompletions(sqlNoSemi, null, tabCtx);
        const topNoSemi = completionsNoSemi.slice(0, 5).map(c => c.label || c.name);

        const expectedStarters = ['CASE', 'DISTINCT', 'NULL', 'TOP', 'CAST'];
        const hasExpected = expectedStarters.some(k => topNoSemi.includes(k));
        assert.ok(hasExpected, `Expected SELECT clause starters in top suggestions, got: ${topNoSemi.join(', ')}`);
    });

    test('Boundary: EXEC without semicolon does not leak parameter context into next statement', async () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const tabCtx = { connectionId: 'conn-1', database: 'testdb', schema: 'dbo', dbType: 'mssql' };

        const sql = 'EXEC dbo.usp_GetOrders\nS';
        const completions = await ide.getCompletions(sql, null, tabCtx);
        const top = completions.slice(0, 5).map(c => c.label || c.name);

        assert.ok(top.includes('SELECT'), `Expected 'SELECT' in top suggestions after EXEC, got: ${top.join(', ')}`);
        assert.strictEqual(top[0], 'SELECT');
    });

    test('Boundary: SET @var without semicolon does not leak into next statement', async () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const tabCtx = { connectionId: 'conn-1', database: 'testdb', schema: 'dbo', dbType: 'mssql' };

        const sql = 'SET @Total = 100\nS';
        const completions = await ide.getCompletions(sql, null, tabCtx);
        const top = completions.slice(0, 5).map(c => c.label || c.name);

        assert.ok(top.includes('SELECT'), `Expected 'SELECT' in top suggestions after SET, got: ${top.join(', ')}`);
        assert.strictEqual(top[0], 'SELECT');
    });

    test('Boundary: ALTER TABLE without semicolon does not leak alter_object into next SELECT', () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const sql = 'ALTER TABLE dbo.Orders ADD Notes VARCHAR(100)\nSELECT ';
        const ctx = ide.analyze(sql, sql.length, 'sqlserver');

        assert.strictEqual(ctx.clause, 'SELECT');
        assert.strictEqual(ctx.contextType, 'column');
        assert.strictEqual(ctx.isAlterContext, false, 'isAlterContext must not be active in subsequent SELECT');
    });

    test('Procedure: SET NOCOUNT ON without semicolon allows DECLARE on next line', async () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const tabCtx = { connectionId: 'conn-1', database: 'testdb', schema: 'dbo', dbType: 'mssql' };

        const sql = 'CREATE PROCEDURE dbo.usp_Multi\nAS\nBEGIN\n    SET NOCOUNT ON\n    D\nEND';
        const cursor = sql.indexOf('D\nEND') + 1;
        const completions = await ide.getCompletions(sql, cursor, tabCtx);
        const top = completions.slice(0, 5).map(c => c.label || c.name);

        assert.ok(top.includes('DECLARE'), `Expected 'DECLARE' in top suggestions after SET NOCOUNT ON, got: ${top.join(', ')}`);
    });

    test('Procedure: AFTER block END allows UPDATE on next line at statement_start', async () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const tabCtx = { connectionId: 'conn-1', database: 'testdb', schema: 'dbo', dbType: 'mssql' };

        const sql = 'CREATE PROCEDURE dbo.usp_Multi\nAS\nBEGIN\n    IF @x > 0\n    BEGIN\n        SELECT 1\n    END\n    U\nEND';
        const cursor = sql.indexOf('U\nEND') + 1;
        const ctx = ide.analyze(sql, cursor, 'sqlserver');
        assert.strictEqual(ctx.position, 'statement_start');

        const completions = await ide.getCompletions(sql, cursor, tabCtx);
        const top = completions.slice(0, 5).map(c => c.label || c.name);
        assert.strictEqual(top[0], 'UPDATE', `Expected 'UPDATE' as top suggestion, got: ${top.join(', ')}`);
    });

    test('Procedure: Parameters @ID and @Total are suggested when typing @', async () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const tabCtx = { connectionId: 'conn-1', database: 'testdb', schema: 'dbo', dbType: 'mssql' };

        const sql = 'CREATE PROCEDURE dbo.usp_Calc\n    @ID INT,\n    @Total DECIMAL(18, 2)\nAS\nBEGIN\n    SELECT @\nEND';
        const cursor = sql.indexOf('SELECT @') + 8;
        const completions = await ide.getCompletions(sql, cursor, tabCtx);
        const labels = completions.map(c => c.label || c.name);

        assert.ok(labels.includes('@ID'), `Expected @ID in suggestions, got: ${labels.join(', ')}`);
        assert.ok(labels.includes('@Total'), `Expected @Total in suggestions, got: ${labels.join(', ')}`);
    });

    test('Trigger: AFTER INSERT does not misclassify inner SELECT WHERE as INSERT INTO', async () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const tabCtx = { connectionId: 'conn-1', database: 'testdb', schema: 'dbo', dbType: 'mssql' };

        const sql = 'CREATE TRIGGER trg_Orders ON dbo.Orders\nAFTER INSERT\nAS\nBEGIN\n    SELECT * FROM inserted WHERE \nEND';
        const cursor = sql.indexOf('WHERE ') + 6;
        const ctx = ide.analyze(sql, cursor, 'sqlserver');

        assert.strictEqual(ctx.clause, 'WHERE', 'Clause must be WHERE, not INSERT INTO');

        const completions = await ide.getCompletions(sql, cursor, tabCtx);
        const labels = completions.map(c => c.label || c.name);
        assert.ok(labels.includes('OrderID'), `Expected OrderID in trigger WHERE suggestions, got: ${labels.slice(0, 10).join(', ')}`);
    });

    test('Trigger: Pseudo-table alias i. resolves columns of trigger target table', async () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const tabCtx = { connectionId: 'conn-1', database: 'testdb', schema: 'dbo', dbType: 'mssql' };

        const sql = 'CREATE TRIGGER trg_Orders ON dbo.Orders\nAFTER INSERT\nAS\nBEGIN\n    SELECT i. FROM inserted i\nEND';
        const cursor = sql.indexOf('i.') + 2;
        const completions = await ide.getCompletions(sql, cursor, tabCtx);
        const labels = completions.map(c => c.label || c.name);

        assert.ok(labels.includes('OrderID'), `Expected OrderID on i. in trigger, got: ${labels.join(', ')}`);
        assert.ok(labels.includes('Total'), `Expected Total on i. in trigger, got: ${labels.join(', ')}`);
    });

    test('Function: Inline TVF resolves parameters inside RETURN (SELECT ...)', async () => {
        const ide = createIdeContext({ dbType: 'mssql' });
        const tabCtx = { connectionId: 'conn-1', database: 'testdb', schema: 'dbo', dbType: 'mssql' };

        const sql = 'CREATE FUNCTION dbo.fn_Test (@ID INT)\nRETURNS TABLE\nAS\nRETURN (\n    SELECT * FROM dbo.Orders WHERE OrderID = @\n)';
        const cursor = sql.indexOf('OrderID = @') + 11;
        const completions = await ide.getCompletions(sql, cursor, tabCtx);
        const labels = completions.map(c => c.label || c.name);

        assert.ok(labels.includes('@ID'), `Expected @ID inside inline TVF, got: ${labels.join(', ')}`);
    });
});

