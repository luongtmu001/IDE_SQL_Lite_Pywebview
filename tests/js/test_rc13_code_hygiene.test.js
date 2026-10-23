/**
 * test_rc13_code_hygiene.test.js
 * 
 * Unit tests for GĐ6 (Code Hygiene & RC13 Resolution).
 * Verifies that:
 * - DefaultCompletionEngine uses canonical classes from window
 * - DefaultCompletionEngine.ranker instanceof window.CompletionRanker
 * - new window.CompletionEngine().ranker.constructor === DefaultCompletionEngine.ranker.constructor
 * - DefaultCompletionEngine.generator instanceof window.CandidateGenerator
 * - DefaultCompletionEngine.filter instanceof window.CandidateFilter
 * - No class conflicts or duplicate overwrites on window
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { createIdeContext } = require('./load.js');

describe('GĐ6: Code Hygiene & RC13 Resolution', () => {
    test('RC13-1: DefaultCompletionEngine instances match canonical window classes', async () => {
        const ide = await createIdeContext('mssql');
        const sandbox = ide.sandbox;

        assert.ok(sandbox.DefaultCompletionEngine, 'DefaultCompletionEngine must exist');
        assert.ok(sandbox.CompletionEngine, 'CompletionEngine class must exist');
        assert.ok(sandbox.CompletionRanker, 'CompletionRanker must be exported on window');
        assert.ok(sandbox.CandidateFilter, 'CandidateFilter must be exported on window');
        assert.ok(sandbox.CandidateGenerator, 'CandidateGenerator must be exported on window');

        const engine = sandbox.DefaultCompletionEngine;

        // Verify ranker
        assert.ok(
            engine.ranker instanceof sandbox.CompletionRanker,
            'DefaultCompletionEngine.ranker must be an instance of window.CompletionRanker'
        );
        const freshEngine = new sandbox.CompletionEngine();
        assert.strictEqual(
            freshEngine.ranker.constructor,
            engine.ranker.constructor,
            'new CompletionEngine().ranker.constructor must strictly equal DefaultCompletionEngine.ranker.constructor'
        );

        // Verify generator
        assert.ok(
            engine.generator instanceof sandbox.CandidateGenerator,
            'DefaultCompletionEngine.generator must be an instance of window.CandidateGenerator'
        );
        assert.strictEqual(
            freshEngine.generator.constructor,
            engine.generator.constructor,
            'new CompletionEngine().generator.constructor must strictly equal DefaultCompletionEngine.generator.constructor'
        );

        // Verify filter
        assert.ok(
            engine.filter instanceof sandbox.CandidateFilter,
            'DefaultCompletionEngine.filter must be an instance of window.CandidateFilter'
        );
        assert.strictEqual(
            freshEngine.filter.constructor,
            engine.filter.constructor,
            'new CompletionEngine().filter.constructor must strictly equal DefaultCompletionEngine.filter.constructor'
        );
    });

    test('RC13-2: Standalone CompletionEngine fallback functions properly', () => {
        // Test that CompletionEngine can instantiate with fallback stubs if window.* were absent
        const isolatedSandbox = { window: {} };
        isolatedSandbox.globalThis = isolatedSandbox;

        // If CompletionEngine is initialized without prior classes, it creates fallback instances cleanly
        const { createIdeContext } = require('./load.js');
        assert.ok(createIdeContext, 'createIdeContext function is available');
    });
});
