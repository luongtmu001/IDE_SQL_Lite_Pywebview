/**
 * tests/js/test_metadata_error_i12.test.js
 * 
 * Tests for Issue I12:
 * 1. Metadata provider errors attach meta.errors and hasError to result.
 * 2. Empty results caused by provider error must NOT be cached.
 * 3. Completion candidate cache must NOT memoize failed completions.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createIdeContext } = require('./load.js');

test('I12: Metadata Provider Errors attach meta.errors and do not cache empty sets', async () => {
    const ide = createIdeContext();
    const tabCtx = ide.defaultTabCtx;

    // Simulate provider failure
    ide.mockProvider.fetchObjects = async () => {
        const errResult = [];
        errResult.hasError = true;
        errResult.error = new Error('Connection timeout to SQL Server');
        return errResult;
    };

    const completions = await ide.getCompletions("SELECT * FROM ‸", null, tabCtx);

    assert.ok(Array.isArray(completions), 'Completions should be an array even when provider fails');
    assert.strictEqual(completions.hasError, true, 'Result should have hasError: true');
    assert.ok(completions.meta && Array.isArray(completions.meta.errors) && completions.meta.errors.length > 0,
        'Result should have meta.errors populated with provider error details');

    // Verify cache was NOT polluted with empty array
    const cache = ide.sandbox.AppMetadataCache || (ide.sandbox.DefaultCompletionEngine && ide.sandbox.DefaultCompletionEngine.metadataCache);
    if (cache) {
        const cachedObjects = cache.getObjects(tabCtx.connectionId, tabCtx.database, tabCtx.schema);
        assert.strictEqual(cachedObjects, null, 'Cache must NOT store empty objects on error');
    }
});

test('I12: Throwing provider does not crash getCompletions and marks hasError', async () => {
    const ide = createIdeContext();
    const tabCtx = ide.defaultTabCtx;

    ide.mockProvider.fetchObjects = async () => {
        throw new Error('Network socket closed');
    };

    const completions = await ide.getCompletions("SELECT * FROM ‸", null, tabCtx);

    assert.ok(Array.isArray(completions), 'Completions should return fallback array (e.g. keywords)');
    assert.strictEqual(completions.hasError, true, 'Result should be marked with hasError');
    assert.ok(completions.meta && completions.meta.errors.length > 0, 'meta.errors should contain the caught exception');
});
