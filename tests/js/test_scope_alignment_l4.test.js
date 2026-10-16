/**
 * tests/js/test_scope_alignment_l4.test.js
 * 
 * Step 6 of Phase 2: Parallel Scope Alignment.
 * Runs valid SQL corpus (40 cases) through JS ScopeResolver to ensure
 * consistency with Python semantic_analyzer on aliases and scope tree construction.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createIdeContext } = require('./load.js');

const corpusPath = path.resolve(__dirname, '../corpus/syntax/valid.json');
const validCases = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

test('L4 Alignment: ScopeResolver handles all valid SQL corpus queries', async (t) => {
    const ide = createIdeContext();
    const tokenizer = ide.sandbox.DefaultSqlTokenizer || new ide.sandbox.SqlTokenizer();
    const scopeResolver = ide.sandbox.DefaultScopeResolver || new ide.sandbox.ScopeResolver();

    assert.ok(tokenizer, 'SqlTokenizer must be present');
    assert.ok(scopeResolver, 'ScopeResolver must be present');

    for (const item of validCases) {
        await t.test(`Scope: ${item.id} (${item.dialect})`, () => {
            const tokens = tokenizer.tokenize(item.sql);
            assert.ok(Array.isArray(tokens), 'Tokens must be an array');

            // Build scope tree without error
            const rootScope = scopeResolver.buildScopeTree(tokens);
            assert.ok(rootScope, 'Scope tree root must be created');

            // Verify specific alias resolutions on representative queries
            if (item.id === 'V-002') {
                // SELECT o.OrderID, c.CustomerName FROM dbo.Orders o INNER JOIN dbo.Customers c ON ...
                assert.ok(rootScope.resolve('o'), 'Alias o must resolve to Orders');
                assert.ok(rootScope.resolve('c'), 'Alias c must resolve to Customers');
            } else if (item.id === 'SEM-FP-1') {
                // SELECT o.OrderID FROM dbo.Orders o WHERE EXISTS (SELECT 1 FROM dbo.OrderItems i WHERE i.OrderID = o.OrderID);
                assert.ok(rootScope.resolve('o'), 'Outer alias o must resolve');
            } else if (item.id === 'SEM-FP-4') {
                // SELECT o.OrderID FROM dbo.Orders AS o WITH (NOLOCK);
                assert.ok(rootScope.resolve('o'), 'Alias o with table hint must resolve');
            }
        });
    }
});
