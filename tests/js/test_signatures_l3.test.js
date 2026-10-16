/**
 * tests/js/test_signatures_l3.test.js
 * 
 * L3: Signature Help tests using Node.js test runner (node --test)
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createIdeContext } = require('./load.js');

const corpusPath = path.resolve(__dirname, '../corpus/intellisense/signatures_l3.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

test('L3: Signature Help Corpus Tests', async (t) => {
    const ide = createIdeContext();

    for (const item of corpus) {
        await t.test(`${item.id}: ${item.sql}`, async () => {
            const sigResult = await ide.getSignatureHelp(item.sql);
            assert.ok(sigResult, `Signature help should return a result for ${item.sql}`);
            assert.ok(Array.isArray(sigResult.signatures), 'Result should contain signatures array');
            assert.ok(sigResult.signatures.length > 0, 'Signatures array should not be empty');

            const firstSig = sigResult.signatures[0];
            if (item.expect.function) {
                assert.ok(
                    firstSig.label.toUpperCase().includes(item.expect.function.toUpperCase()),
                    `Expected signature label to include ${item.expect.function}, got: ${firstSig.label}`
                );
            }

            if (item.expect.activeParameter !== undefined) {
                assert.strictEqual(
                    sigResult.activeParameter,
                    item.expect.activeParameter,
                    `Expected activeParameter ${item.expect.activeParameter}, got: ${sigResult.activeParameter}`
                );
            }
        });
    }
});
