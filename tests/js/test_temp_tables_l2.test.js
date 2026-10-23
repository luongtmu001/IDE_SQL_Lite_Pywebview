/**
 * tests/js/test_temp_tables_l2.test.js
 * 
 * L2: Temp Table Completion Engine tests using Node.js test runner (node --test).
 * Tests ALTER ADD, INSERT INTO not wiping columns, self-suggestion elimination for #K‸.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createIdeContext } = require('./load.js');

const corpusPath = path.resolve(__dirname, '../corpus/intellisense/temp_tables_l2.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

test('L2: Temp Table Completion Engine Tests', async (t) => {
    for (const item of corpus) {
        const isTodo = item.status === 'expectedFailure';
        const testOptions = isTodo ? { todo: `Issue ${item.issue}` } : {};

        await t.test(`${item.id}: ${item.sql.replace(/\n/g, ' ')}`, testOptions, async () => {
            const ide = createIdeContext({ dbType: item.dialect || 'mssql' });
            const tabCtx = {
                connectionId: 'conn-1',
                database: 'testdb',
                schema: (item.dialect === 'postgres' || item.dialect === 'postgresql') ? 'public' : 'dbo',
                dbType: item.dialect || 'mssql'
            };

            const completions = await ide.getCompletions(item.sql, null, tabCtx);
            const exp = item.expect;

            assert.ok(Array.isArray(completions), 'Completions should be an array');
            const labels = completions.map(c => c.label || c.insertText);

            if (exp.contains) {
                for (const expectedItem of exp.contains) {
                    assert.ok(
                        labels.includes(expectedItem) || completions.some(c => (c.insertText || '').includes(expectedItem)),
                        `Expected completions to contain '${expectedItem}', but got: ${labels.slice(0, 10).join(', ')}`
                    );
                }
            }

            if (exp.not) {
                for (const prohibitedItem of exp.not) {
                    assert.ok(
                        !labels.includes(prohibitedItem),
                        `Expected completions NOT to contain '${prohibitedItem}', but found it in: ${labels.slice(0, 10).join(', ')}`
                    );
                }
            }
        });
    }
});
