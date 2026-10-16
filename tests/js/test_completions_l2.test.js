/**
 * tests/js/test_completions_l2.test.js
 * 
 * L2: Completion Engine tests using Node.js test runner (node --test)
 * Known issues from Phase A5 are marked as { todo: 'Issue ...' } so baseline tests pass green.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createIdeContext } = require('./load.js');

const corpusPath = path.resolve(__dirname, '../corpus/intellisense/completions_l2.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

test('L2: Completion Engine Corpus Tests', async (t) => {
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

            if (exp.count !== undefined) {
                const count = Array.isArray(completions) ? completions.length : 0;
                assert.strictEqual(count, exp.count, `Expected count ${exp.count}, got ${count}`);
                return;
            }

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

            if (exp.first) {
                assert.ok(completions.length > 0, 'Completions should not be empty for expect.first');
                const topLabels = completions.slice(0, exp.first.length).map(c => (c.label || c.insertText).toLowerCase());
                for (const firstItem of exp.first) {
                    assert.ok(
                        topLabels.includes(firstItem.toLowerCase()),
                        `Expected '${firstItem}' in top completions, but top was: ${topLabels.join(', ')}`
                    );
                }
            }

            if (exp.not) {
                for (const prohibitedItem of exp.not) {
                    assert.ok(
                        !labels.includes(prohibitedItem),
                        `Expected completions NOT to contain '${prohibitedItem}', but found it`
                    );
                }
            }
        });
    }
});
