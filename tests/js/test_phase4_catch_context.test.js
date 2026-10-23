/**
 * tests/js/test_phase4_catch_context.test.js
 * 
 * Phase 4.1: T-SQL TRY/CATCH Context Detection & Completion Ranking Tests.
 * Verifies that cursor position inside BEGIN CATCH ... END CATCH is detected,
 * ERROR_* functions and THROW statement are boosted, and ranking outside CATCH is undisturbed.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createIdeContext } = require('./load.js');

describe('Phase 4.1: T-SQL TRY/CATCH Context & Error Functions Ranking', () => {
    const ide = createIdeContext({ dbType: 'sqlserver' });

    it('detectCatchBlock correctly identifies inside vs outside CATCH block', () => {
        const analyzer = ide.sandbox.SqlContextAnalyzer;
        assert.ok(analyzer && typeof analyzer.detectCatchBlock === 'function', 'detectCatchBlock must be available');

        // 1. Inside CATCH
        const sqlInsideCatch = `
        BEGIN TRY
            SELECT 1;
        END TRY
        BEGIN CATCH
            SELECT 2;
        `;
        assert.equal(analyzer.detectCatchBlock([], sqlInsideCatch.length, sqlInsideCatch), true);

        // 2. Inside TRY (not CATCH)
        const sqlInsideTry = `
        BEGIN TRY
            SELECT 1;
        `;
        assert.equal(analyzer.detectCatchBlock([], sqlInsideTry.length, sqlInsideTry), false);

        // 3. After END CATCH
        const sqlAfterCatch = `
        BEGIN TRY
            SELECT 1;
        END TRY
        BEGIN CATCH
            SELECT 2;
        END CATCH;
        SELECT 3;
        `;
        assert.equal(analyzer.detectCatchBlock([], sqlAfterCatch.length, sqlAfterCatch), false);
    });

    it('SqlContextAnalyzer.analyze populates isInCatchBlock flag', () => {
        const sql = `
        BEGIN TRY
            SELECT 1;
        END TRY
        BEGIN CATCH
            SELECT ‸
        END CATCH;
        `;
        const ctx = ide.analyze(sql);
        assert.equal(ctx.isInCatchBlock, true, 'isInCatchBlock must be true inside CATCH block');

        const sqlOutside = `SELECT ‸ FROM dbo.Users;`;
        const ctxOutside = ide.analyze(sqlOutside);
        assert.equal(ctxOutside.isInCatchBlock, false, 'isInCatchBlock must be false outside CATCH block');
    });

    it('CompletionEngine boosts ERROR_MESSAGE and THROW inside CATCH block', async () => {
        const tabCtx = {
            dbType: 'sqlserver',
            connectionId: 'conn-1',
            database: 'master',
            schema: 'dbo'
        };

        const sqlCatch = `
        BEGIN TRY
            SELECT 1;
        END TRY
        BEGIN CATCH
            ERR‸
        END CATCH;
        `;

        const completions = await ide.getCompletions(sqlCatch, null, tabCtx);
        assert.ok(Array.isArray(completions) && completions.length > 0, 'Completions must return items');
        const labels = completions.map(c => c.label);

        // ERROR_MESSAGE and ERROR_NUMBER should be at the very top of completions
        assert.ok(labels.includes('ERROR_MESSAGE'), 'Must include ERROR_MESSAGE');
        assert.ok(labels.includes('ERROR_NUMBER'), 'Must include ERROR_NUMBER');
        assert.ok(labels.indexOf('ERROR_MESSAGE') < 5, `ERROR_MESSAGE should be top ranked, got index ${labels.indexOf('ERROR_MESSAGE')}`);

        // THROW statement boost
        const sqlThrow = `
        BEGIN TRY
            SELECT 1;
        END TRY
        BEGIN CATCH
            THR‸
        END CATCH;
        `;
        const completionsThrow = await ide.getCompletions(sqlThrow, null, tabCtx);
        const labelsThrow = completionsThrow.map(c => c.label);
        assert.ok(labelsThrow.includes('THROW'), 'Must include THROW');
        assert.equal(labelsThrow[0], 'THROW', 'THROW must be top #1 suggestion in CATCH block');
    });

    it('Standard query ranking outside CATCH is undisturbed', async () => {
        const tabCtx = {
            dbType: 'sqlserver',
            connectionId: 'conn-1',
            database: 'master',
            schema: 'dbo'
        };

        const sqlNormal = `SELECT ‸ FROM dbo.Orders;`;
        const completionsNormal = await ide.getCompletions(sqlNormal, null, tabCtx);
        const labelsNormal = completionsNormal.map(c => c.label);

        // Columns from dbo.Orders (e.g. OrderID, CustomerID) must be top ranked, not ERROR_MESSAGE
        assert.ok(labelsNormal.includes('OrderID'), 'Orders columns should appear');
        assert.ok(labelsNormal.indexOf('CustomerID') < 5, 'Table columns must remain top ranked in normal query');
        assert.ok(labelsNormal.indexOf('OrderID') < 10, 'Table columns must remain top ranked in normal query');
    });
});
