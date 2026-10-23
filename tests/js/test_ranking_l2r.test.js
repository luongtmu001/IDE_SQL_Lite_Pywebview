/**
 * tests/js/test_ranking_l2r.test.js
 * 
 * L2R: IntelliSense Ranking & Contextual Corpus Tests
 * Supports: first, top: { n, contains }, before: [[A, B]], absent, contains, maxCount
 * Known issues from Phase A5 / improve_intellisense_3.md are marked with { todo: 'Issue ...' }
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createIdeContext } = require('./load.js');

const corpusPath = path.resolve(__dirname, '../corpus/intellisense/ranking_l2r.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

test('L2R: Completion Ranking Corpus Tests', async (t) => {
    for (const item of corpus) {
        const isTodo = item.status === 'expectedFailure';
        const testOptions = isTodo ? { todo: `Issue ${item.issue || 'Ranking'}` } : {};

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
            const labels = completions.map(c => c.label || c.name || c.insertText || '');
            const labelsLower = labels.map(l => l.toLowerCase());

            if (exp.maxCount !== undefined) {
                assert.ok(
                    completions.length <= exp.maxCount,
                    `Expected completions length <= ${exp.maxCount}, got ${completions.length}`
                );
            }

            if (exp.first) {
                assert.ok(completions.length > 0, `Expected completions not to be empty for first: ${exp.first}`);
                const topItem = completions[0];
                const topLabel = labels[0] || '';
                const topName = topItem.name || '';
                const matchFirst = exp.first.some(f => {
                    const fLow = f.toLowerCase().trim();
                    return topLabel.toLowerCase().trim() === fLow ||
                           topName.toLowerCase().trim() === fLow ||
                           topLabel.toLowerCase().startsWith(fLow);
                });
                assert.ok(
                    matchFirst,
                    `Expected #1 to be one of [${exp.first.join(', ')}], but got #1 '${topLabel}' (top 5: ${labels.slice(0, 5).join(', ')})`
                );
            }

            if (exp.top) {
                const n = exp.top.n || 5;
                const topSlice = labels.slice(0, n);
                const topSliceLower = topSlice.map(l => l.toLowerCase());
                for (const target of (exp.top.contains || [])) {
                    assert.ok(
                        topSliceLower.includes(target.toLowerCase()) || topSlice.some(l => l.includes(target)),
                        `Expected top ${n} to contain '${target}', but got: [${topSlice.join(', ')}]`
                    );
                }
            }

            if (exp.before) {
                for (const [a, b] of exp.before) {
                    const idxA = labelsLower.indexOf(a.toLowerCase());
                    const idxB = labelsLower.indexOf(b.toLowerCase());
                    assert.ok(idxA !== -1, `Expected '${a}' to be in completions`);
                    if (idxB !== -1) {
                        assert.ok(
                            idxA < idxB,
                            `Expected '${a}' (#${idxA + 1}) to appear before '${b}' (#${idxB + 1})`
                        );
                    }
                }
            }

            if (exp.absent) {
                for (const target of exp.absent) {
                    assert.ok(
                        !labelsLower.includes(target.toLowerCase()),
                        `Expected '${target}' to be ABSENT from completions, but found in: [${labels.slice(0, 10).join(', ')}]`
                    );
                }
            }

            if (exp.contains) {
                for (const target of exp.contains) {
                    assert.ok(
                        labelsLower.includes(target.toLowerCase()) || labels.some(l => l.includes(target)),
                        `Expected completions to contain '${target}', but got: [${labels.slice(0, 10).join(', ')}]`
                    );
                }
            }
        });
    }
});
