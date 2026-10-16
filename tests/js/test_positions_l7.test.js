/**
 * tests/js/test_positions_l7.test.js
 * 
 * L7: Position Mapper tests (CRLF, Vietnamese, Emoji) using Node.js test runner
 * Known issues (POS-1, POS-2) marked as { todo: 'Issue S8' }
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createIdeContext } = require('./load.js');

const corpusPath = path.resolve(__dirname, '../corpus/syntax/positions_l7.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

test('L7: Position Mapper Corpus Tests (8 cases)', async (t) => {
    const ide = createIdeContext();
    const mapper = ide.sandbox.SqlPositionMapper;
    assert.ok(mapper, 'SqlPositionMapper should be loaded');

    for (const item of corpus) {
        const isTodo = item.status === 'expectedFailure';
        const testOptions = isTodo ? { todo: `Issue ${item.issue}` } : {};

        await t.test(`${item.id}: ${item.text}`, testOptions, () => {
            const range = mapper.expandTokenRange(item.text, item.line, item.column, item.token || '');
            const exp = item.expect;

            if (exp.startColumn !== undefined) {
                assert.strictEqual(
                    range.startColumn,
                    exp.startColumn,
                    `Expected startColumn ${exp.startColumn}, got ${range.startColumn}`
                );
            }
            if (exp.endColumn !== undefined) {
                assert.strictEqual(
                    range.endColumn,
                    exp.endColumn,
                    `Expected endColumn ${exp.endColumn}, got ${range.endColumn}`
                );
            }
        });
    }
});
