/**
 * tests/js/test_phase3_pg_keywords_sync.test.js
 * 
 * Phase 3: PostgreSQL Keywords Inventory and Synchronization Tests.
 * Verifies that PostgresDialect and CandidateGenerator correctly expose
 * verified PL/pgSQL and routine statement keywords without polluting SqlServerDialect,
 * and without treating %ROWTYPE as an isolated keyword.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createIdeContext } = require('./load.js');

describe('Phase 3: PostgreSQL Keywords Inventory & Dialect Synchronization', () => {
    const idePg = createIdeContext({ dbType: 'postgresql' });
    const ideMs = createIdeContext({ dbType: 'sqlserver' });

    it('PostgresDialect includes essential PL/pgSQL control and routine keywords', () => {
        const pgDialect = idePg.sandbox.SqlDialectFactory.getDialect('postgresql');
        assert.ok(pgDialect, 'PostgresDialect must be registered');
        const kws = pgDialect.getKeywords();

        const requiredKws = [
            'PERFORM', 'RAISE', 'ELSIF', 'ELSEIF', 'FOREACH', 'LOOP', 'WHILE', 'EXIT',
            'CONTINUE', 'EXCEPTION', 'DECLARE', 'CONSTANT', 'RECORD', 'RETURN', 'RETURNS',
            'STRICT', 'NOTICE', 'WARNING', 'INFO', 'DEBUG', 'SQLSTATE', 'FOUND', 'GET',
            'DIAGNOSTICS', 'STACKED', 'ROW_COUNT', 'ASSERT', 'LANGUAGE', 'PLPGSQL',
            'IMMUTABLE', 'STABLE', 'VOLATILE', 'SECURITY', 'DEFINER', 'INVOKER',
            'RECURSIVE', 'UNLOGGED'
        ];

        for (const kw of requiredKws) {
            assert.ok(kws.includes(kw), `PostgresDialect must include keyword '${kw}'`);
        }
    });

    it('PostgresDialect does NOT treat %ROWTYPE or %TYPE as isolated keywords', () => {
        const pgDialect = idePg.sandbox.SqlDialectFactory.getDialect('postgresql');
        const kws = pgDialect.getKeywords();
        assert.ok(!kws.includes('%ROWTYPE'), 'PostgresDialect should not have %ROWTYPE as standard keyword');
        assert.ok(!kws.includes('ROWTYPE'), 'PostgresDialect should not have bare ROWTYPE as independent keyword');
        assert.ok(!kws.includes('%TYPE'), 'PostgresDialect should not have %TYPE as standard keyword');
    });

    it('PostgresDialect does NOT contain SQL Server specific keywords', () => {
        const pgDialect = idePg.sandbox.SqlDialectFactory.getDialect('postgresql');
        const kws = pgDialect.getKeywords();

        const mssqlSpecific = ['TOP', 'NOLOCK', 'IDENTITY_INSERT', 'CROSS APPLY', 'OUTER APPLY', 'OUTPUT', 'INSERTED', 'DELETED'];
        for (const kw of mssqlSpecific) {
            assert.ok(!kws.includes(kw), `PostgresDialect must NOT contain MSSQL keyword '${kw}'`);
        }
    });

    it('SqlServerDialect does NOT contain PostgreSQL specific keywords', () => {
        const sqlserverDialect = ideMs.sandbox.SqlDialectFactory.getDialect('sqlserver');
        assert.ok(sqlserverDialect, 'SqlServerDialect must be registered');
        const kws = sqlserverDialect.getKeywords();

        const pgSpecific = ['PERFORM', 'PLPGSQL', 'FOREACH', 'ELSIF', 'ELSEIF', 'UNLOGGED'];
        for (const kw of pgSpecific) {
            assert.ok(!kws.includes(kw), `SqlServerDialect must NOT contain PostgreSQL keyword '${kw}'`);
        }
    });

    it('CandidateGenerator provides PERFORM and RAISE completions in PostgreSQL dialect', async () => {
        const tabCtxPg = {
            dbType: 'postgresql',
            connectionId: 'conn-pg-1',
            database: 'postgres',
            schema: 'public'
        };

        // Test PERFORM completion with prefix 'PER'
        const completionsPer = await idePg.getCompletions('PER‸', null, tabCtxPg);
        assert.ok(Array.isArray(completionsPer), 'Must return completions array');
        const labelsPer = completionsPer.map(s => s.label);
        assert.ok(labelsPer.includes('PERFORM'), `Completions for 'PER' in PG must include 'PERFORM', got: ${labelsPer.slice(0, 10)}`);

        // Test RAISE completion with prefix 'RAI'
        const completionsRai = await idePg.getCompletions('RAI‸', null, tabCtxPg);
        assert.ok(Array.isArray(completionsRai), 'Must return completions array');
        const labelsRai = completionsRai.map(s => s.label);
        assert.ok(labelsRai.includes('RAISE'), `Completions for 'RAI' in PG must include 'RAISE', got: ${labelsRai.slice(0, 10)}`);

        // Test ELSIF completion with prefix 'ELS'
        const completionsEls = await idePg.getCompletions('ELS‸', null, tabCtxPg);
        const labelsEls = completionsEls.map(s => s.label);
        assert.ok(labelsEls.includes('ELSIF'), `Completions for 'ELS' in PG must include 'ELSIF', got: ${labelsEls.slice(0, 10)}`);
    });
});
