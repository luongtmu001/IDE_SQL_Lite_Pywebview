/**
 * tests/js/test_context_l1.test.js
 * 
 * L1: Context Analyzer tests using Node.js test runner (node --test)
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createIdeContext } = require('./load.js');

const corpusPath = path.resolve(__dirname, '../corpus/intellisense/context_l1.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

test('L1: Context Analyzer Corpus Tests (40 cases)', async (t) => {
    const ide = createIdeContext();

    for (const item of corpus) {
        await t.test(`${item.id}: ${item.sql.replace(/\n/g, ' ')}`, () => {
            const result = ide.analyze(item.sql, null, item.dialect || 'mssql');
            const exp = item.expect;

            if (exp.clause !== undefined) {
                assert.strictEqual(result.clause, exp.clause, `Expected clause ${exp.clause}, got ${result.clause}`);
            }
            if (exp.qualifier !== undefined) {
                assert.strictEqual(result.qualifier, exp.qualifier, `Expected qualifier ${exp.qualifier}, got ${result.qualifier}`);
            }
            if (exp.isInsert) {
                assert.ok(result.isInsert, 'Expected isInsert to be true');
            }
            if (exp.isUpdateSet) {
                assert.ok(result.isUpdateSet, 'Expected isUpdateSet to be true');
            }
            if (exp.isUpdateSetValue) {
                assert.ok(result.isUpdateSetValue, 'Expected isUpdateSetValue to be true');
            }
            if (exp.isExec) {
                assert.ok(result.execContext && result.execContext.isExec, 'Expected isExec to be true');
            }
            if (exp.isInsideString) {
                assert.ok(result.isInsideString, 'Expected isInsideString to be true');
            }
            if (exp.isInsideComment) {
                assert.ok(result.isInsideComment, 'Expected isInsideComment to be true');
            }
        });
    }
});
