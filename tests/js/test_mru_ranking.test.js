/**
 * test_mru_ranking.test.js
 * 
 * Unit and integration tests for GĐ5: Most Recently Used (MRU) History Ranking.
 * Tests CompletionMruManager, decay calculation, storage limit pruning,
 * flag toggling (intellisense.v2.mru), and contextual ranker integration.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { createIdeContext } = require('./load.js');

describe('GĐ5: Most Recently Used (MRU) History Ranking', () => {
    let ide;

    beforeEach(async () => {
        ide = await createIdeContext('mssql');
        if (ide.sandbox.localStorage) {
            ide.sandbox.localStorage.clear();
        }
    });

    test('MRU-1: CompletionMruManager key generation & basic recording', () => {
        const MruClass = ide.sandbox.CompletionMruManager;
        assert.ok(MruClass, 'CompletionMruManager must be exported on window');

        const manager = new MruClass();
        const key = manager.buildKey('SQLSERVER', 'conn_abc', 'COLUMN', 'OrderID');
        assert.strictEqual(key, 'sqlserver::conn_abc::column::orderid');

        manager.recordItem('sqlserver', 'conn_abc', 'column', 'OrderID');
        const history = manager.loadHistory();
        assert.ok(history[key]);
        assert.strictEqual(history[key].count, 1);
        assert.ok(history[key].lastUsed > 0);

        // Record second time
        manager.recordItem('sqlserver', 'conn_abc', 'column', 'OrderID');
        const updated = manager.loadHistory();
        assert.strictEqual(updated[key].count, 2);
    });

    test('MRU-2: Bonus score calculation and maximum cap of 15 points', () => {
        const MruClass = ide.sandbox.CompletionMruManager;
        const manager = new MruClass();

        // 0 uses
        assert.strictEqual(manager.getMruBonus('sqlserver', 'conn1', 'column', 'Unknown'), 0);

        // 1 use -> ~3 points
        manager.recordItem('sqlserver', 'conn1', 'column', 'Col1');
        const bonus1 = manager.getMruBonus('sqlserver', 'conn1', 'column', 'Col1');
        assert.strictEqual(bonus1, 3);

        // 2 uses -> ~6 points
        manager.recordItem('sqlserver', 'conn1', 'column', 'Col1');
        const bonus2 = manager.getMruBonus('sqlserver', 'conn1', 'column', 'Col1');
        assert.strictEqual(bonus2, 6);

        // 3 uses -> ~9 points
        manager.recordItem('sqlserver', 'conn1', 'column', 'Col1');
        const bonus3 = manager.getMruBonus('sqlserver', 'conn1', 'column', 'Col1');
        assert.strictEqual(bonus3, 9);

        // 10 uses -> capped at 15 points
        for (let i = 0; i < 10; i++) {
            manager.recordItem('sqlserver', 'conn1', 'column', 'Col1');
        }
        const bonusMax = manager.getMruBonus('sqlserver', 'conn1', 'column', 'Col1');
        assert.strictEqual(bonusMax, 15, 'MRU bonus must not exceed 15 points');
    });

    test('MRU-3: Time decay reduces older item score bonus', () => {
        const MruClass = ide.sandbox.CompletionMruManager;
        const manager = new MruClass();
        const key = manager.buildKey('sqlserver', 'conn1', 'column', 'OldCol');

        // Simulate item used 5 times, but 6 days (144 hours) ago
        const history = {};
        history[key] = {
            count: 5,
            lastUsed: Date.now() - (6 * 24 * 3600 * 1000)
        };
        manager.saveHistory(history);

        const decayedBonus = manager.getMruBonus('sqlserver', 'conn1', 'column', 'OldCol');
        // Without decay, 5 uses would be 15 pts. With 6 days decay (recency ~0.33), score drops significantly
        assert.ok(decayedBonus < 15, 'Decayed bonus should be less than 15');
        assert.ok(decayedBonus >= 3, 'Decayed bonus should retain non-zero recency floor');
    });

    test('MRU-4: History storage limit enforces pruning down to <= 500 entries', () => {
        const MruClass = ide.sandbox.CompletionMruManager;
        const manager = new MruClass({ maxEntries: 50 });

        // Add 65 distinct entries
        for (let i = 0; i < 65; i++) {
            manager.recordItem('sqlserver', 'conn1', 'column', `Col_${i}`);
        }

        const history = manager.loadHistory();
        const count = Object.keys(history).length;
        assert.ok(count <= 50, `Entries count (${count}) must be pruned to <= 50`);
    });

    test('MRU-5: Clear history resets all recorded completions', () => {
        const MruClass = ide.sandbox.CompletionMruManager;
        const manager = new MruClass();

        manager.recordItem('sqlserver', 'conn1', 'table', 'Orders');
        assert.ok(manager.getMruBonus('sqlserver', 'conn1', 'table', 'Orders') > 0);

        manager.clearHistory();
        assert.strictEqual(manager.getMruBonus('sqlserver', 'conn1', 'table', 'Orders'), 0);
        assert.strictEqual(Object.keys(manager.loadHistory()).length, 0);
    });

    test('MRU-6: Feature flag intellisense.v2.mru=false ignores MRU history', async () => {
        ide.sandbox.localStorage.setItem('intellisense.v2.mru', 'false');

        // Record Total column 5 times
        ide.sandbox.CompletionRanker.recordMru('sqlserver', 'default', 'column', 'Total');

        const completions = await ide.getCompletions('SELECT ‸ FROM dbo.Orders', null, {
            dbType: 'sqlserver',
            connectionId: 'default'
        });

        // When MRU is off, Total should NOT have mruBonus
        const totalItem = completions.find(c => c.name === 'Total');
        assert.ok(totalItem, 'Total column should be present');
        assert.strictEqual(totalItem.mruBonus || 0, 0, 'MRU bonus must be 0 when flag is false');
    });

    test('MRU-7: Feature flag intellisense.v2.mru=true boosts frequently used column to top of group', async () => {
        ide.sandbox.localStorage.setItem('intellisense.v2.mru', 'true');

        // Record Total 5 times
        for (let i = 0; i < 5; i++) {
            ide.sandbox.CompletionRanker.recordMru('sqlserver', 'default', 'column', 'Total');
        }

        const completions = await ide.getCompletions('SELECT ‸ FROM dbo.Orders', null, {
            dbType: 'sqlserver',
            connectionId: 'default'
        });

        const totalItem = completions.find(c => c.name === 'Total');
        assert.ok(totalItem, 'Total column should be present');
        assert.strictEqual(totalItem.mruBonus, 15, 'Total should receive +15 MRU bonus');

        // Total should now be #1 among columns (ahead of CustomerID which is naturally index 0 among columns)
        const columns = completions.filter(c => c.type === 'column' || c.type === 'pk_column');
        assert.strictEqual(columns[0].name, 'Total', 'Total with +15 MRU bonus must rank #1 among columns');
    });

    test('MRU-8: MRU bonus never overtakes expected keywords or exact matches', async () => {
        ide.sandbox.localStorage.setItem('intellisense.v2.mru', 'true');

        // Give a column maximum +15 MRU bonus
        for (let i = 0; i < 10; i++) {
            ide.sandbox.CompletionRanker.recordMru('sqlserver', 'default', 'column', 'OrderID');
        }

        // Test in WHERE operand position with query 'O' (SELECT * FROM dbo.Orders WHERE OrderID = 1 O‸)
        // Expected keyword is OR (exact match on OR, or prefix on O).
        const completions = await ide.getCompletions('SELECT * FROM dbo.Orders WHERE OrderID = 1 O‸', null, {
            dbType: 'sqlserver',
            connectionId: 'default'
        });

        // 'OR' must remain #1
        assert.strictEqual(completions[0].name, 'OR', 'Expected keyword OR must remain #1 despite column MRU bonus');
    });
});
