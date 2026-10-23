/**
 * tests/js/test_phase5_syntax_highlighting.test.js
 * 
 * Phase 5 Verification: Monaco Monarch Syntax Highlighting
 * - Verifies PL/pgSQL keywords presence in Monarch keywords
 * - Verifies T-SQL error functions presence in Monarch builtinFunctions
 * - Verifies T-SQL TRY/CATCH/THROW presence in Monarch keywords
 * - Simulates tokenization to ensure proper token class mapping (keyword, predefined, identifier)
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '../..');
const MONACO_SQL_LANG_PATH = path.join(ROOT_DIR, 'static/js/monaco-sql-lang.js');

function loadMonacoSqlDefinition() {
    let capturedProvider = null;
    let capturedConfig = null;

    const sandbox = {
        window: {},
        monaco: {
            languages: {
                getLanguages: () => [{ id: 'sql' }],
                register: () => {},
                setLanguageConfiguration: (id, config) => {
                    capturedConfig = config;
                },
                setMonarchTokensProvider: (id, provider) => {
                    capturedProvider = provider;
                }
            }
        }
    };
    sandbox.window = sandbox;

    const code = fs.readFileSync(MONACO_SQL_LANG_PATH, 'utf8');
    const script = new vm.Script(code, { filename: 'monaco-sql-lang.js' });
    const context = vm.createContext(sandbox);
    script.runInContext(context);

    if (sandbox.MonacoSqlLanguage && typeof sandbox.MonacoSqlLanguage.register === 'function') {
        sandbox.MonacoSqlLanguage.register();
    }

    assert.ok(capturedProvider, 'Monarch tokens provider should be registered');
    return { provider: capturedProvider, config: capturedConfig };
}

// Simple Monarch word classification simulator based on root [a-zA-Z_]\w* rule
function classifyWord(word, provider) {
    const upper = word.toUpperCase();
    const keywords = new Set(provider.keywords.map(k => k.toUpperCase()));
    const dataTypes = new Set(provider.dataTypes.map(d => d.toUpperCase()));
    const builtinFunctions = new Set(provider.builtinFunctions.map(f => f.toUpperCase()));
    const operators = new Set(provider.operators.map(o => o.toUpperCase()));

    if (keywords.has(upper)) return 'keyword';
    if (dataTypes.has(upper)) return 'type';
    if (builtinFunctions.has(upper)) return 'predefined';
    if (operators.has(upper)) return 'operator';
    return 'identifier';
}

test('Phase 5 - PL/pgSQL keywords are registered in Monarch tokenizer', () => {
    const { provider } = loadMonacoSqlDefinition();
    const keywords = new Set(provider.keywords.map(k => k.toUpperCase()));

    const expectedPgKeywords = [
        'PERFORM', 'RAISE', 'ELSIF', 'ELSEIF', 'FOREACH', 'LOOP',
        'EXCEPTION', 'DECLARE', 'RECORD', 'RETURN', 'RETURNING',
        'STRICT', 'NOTICE', 'DEBUG', 'SQLSTATE', 'FOUND', 'GET',
        'DIAGNOSTICS', 'STACKED', 'ASSERT', 'IMMUTABLE', 'STABLE',
        'VOLATILE', 'SECURITY', 'DEFINER', 'INVOKER', 'PARALLEL',
        'COST', 'ROWS', 'RETURNS', 'LANGUAGE', 'PLPGSQL', 'RECURSIVE',
        'UNLOGGED', 'CONSTANT', 'CALLED', 'LEAKPROOF', 'SETOF', 'SIMILAR'
    ];

    const missing = expectedPgKeywords.filter(kw => !keywords.has(kw));
    assert.deepStrictEqual(missing, [], `Missing PL/pgSQL keywords in Monaco Monarch: ${missing.join(', ')}`);
});

test('Phase 5 - T-SQL error functions are registered in Monarch builtinFunctions', () => {
    const { provider } = loadMonacoSqlDefinition();
    const functions = new Set(provider.builtinFunctions.map(f => f.toUpperCase()));

    const expectedFunctions = [
        'ERROR_MESSAGE', 'ERROR_NUMBER', 'ERROR_LINE',
        'ERROR_SEVERITY', 'ERROR_STATE', 'ERROR_PROCEDURE',
        'XACT_STATE'
    ];

    const missing = expectedFunctions.filter(fn => !functions.has(fn));
    assert.deepStrictEqual(missing, [], `Missing T-SQL error functions in Monaco Monarch: ${missing.join(', ')}`);
});

test('Phase 5 - T-SQL error handling keywords (TRY, CATCH, THROW) are registered in Monarch keywords', () => {
    const { provider } = loadMonacoSqlDefinition();
    const keywords = new Set(provider.keywords.map(k => k.toUpperCase()));

    const expected = ['TRY', 'CATCH', 'THROW'];
    const missing = expected.filter(k => !keywords.has(k));
    assert.deepStrictEqual(missing, [], `Missing T-SQL control keywords: ${missing.join(', ')}`);
});

test('Phase 5 - Token classification simulation for PL/pgSQL routine', () => {
    const { provider } = loadMonacoSqlDefinition();

    assert.strictEqual(classifyWord('PERFORM', provider), 'keyword');
    assert.strictEqual(classifyWord('RAISE', provider), 'keyword');
    assert.strictEqual(classifyWord('NOTICE', provider), 'keyword');
    assert.strictEqual(classifyWord('FOREACH', provider), 'keyword');
    assert.strictEqual(classifyWord('LOOP', provider), 'keyword');
    assert.strictEqual(classifyWord('EXCEPTION', provider), 'keyword');
    assert.strictEqual(classifyWord('SQLSTATE', provider), 'keyword');
    assert.strictEqual(classifyWord('PLPGSQL', provider), 'keyword');
    assert.strictEqual(classifyWord('RETURNS', provider), 'keyword');

    // Extended PostgreSQL keywords & routines
    assert.strictEqual(classifyWord('CALL', provider), 'keyword');
    assert.strictEqual(classifyWord('REFRESH', provider), 'keyword');
    assert.strictEqual(classifyWord('MATERIALIZED', provider), 'keyword');
    assert.strictEqual(classifyWord('LATERAL', provider), 'keyword');
    assert.strictEqual(classifyWord('GENERATED', provider), 'keyword');
    assert.strictEqual(classifyWord('WITHIN', provider), 'keyword');

    // Extended PostgreSQL functions & types
    assert.strictEqual(classifyWord('GEN_RANDOM_UUID', provider), 'predefined');
    assert.strictEqual(classifyWord('UUID_GENERATE_V4', provider), 'predefined');
    assert.strictEqual(classifyWord('JSONB_SET', provider), 'predefined');
    assert.strictEqual(classifyWord('INTERVAL', provider), 'type');
    assert.strictEqual(classifyWord('INET', provider), 'type');

    // Identifiers should remain 'identifier'
    assert.strictEqual(classifyWord('my_variable', provider), 'identifier');
    assert.strictEqual(classifyWord('order_total', provider), 'identifier');
    assert.strictEqual(classifyWord('customer_id', provider), 'identifier');
});

test('Phase 5 - Token classification simulation for T-SQL CATCH block', () => {
    const { provider } = loadMonacoSqlDefinition();

    assert.strictEqual(classifyWord('BEGIN', provider), 'keyword');
    assert.strictEqual(classifyWord('TRY', provider), 'keyword');
    assert.strictEqual(classifyWord('CATCH', provider), 'keyword');
    assert.strictEqual(classifyWord('THROW', provider), 'keyword');
    assert.strictEqual(classifyWord('ERROR_MESSAGE', provider), 'predefined');
    assert.strictEqual(classifyWord('ERROR_NUMBER', provider), 'predefined');
    assert.strictEqual(classifyWord('ERROR_LINE', provider), 'predefined');
    assert.strictEqual(classifyWord('XACT_STATE', provider), 'predefined');

    // Extended T-SQL keywords, hints, windowing
    assert.strictEqual(classifyWord('OUTPUT', provider), 'keyword');
    assert.strictEqual(classifyWord('INSERTED', provider), 'keyword');
    assert.strictEqual(classifyWord('DELETED', provider), 'keyword');
    assert.strictEqual(classifyWord('NOLOCK', provider), 'keyword');
    assert.strictEqual(classifyWord('UPDLOCK', provider), 'keyword');
    assert.strictEqual(classifyWord('PIVOT', provider), 'keyword');
    assert.strictEqual(classifyWord('UNPIVOT', provider), 'keyword');
    assert.strictEqual(classifyWord('UNBOUNDED', provider), 'keyword');
    assert.strictEqual(classifyWord('PRECEDING', provider), 'keyword');
    assert.strictEqual(classifyWord('FOLLOWING', provider), 'keyword');

    // Extended T-SQL functions & types
    assert.strictEqual(classifyWord('SCOPE_IDENTITY', provider), 'predefined');
    assert.strictEqual(classifyWord('PARSENAME', provider), 'predefined');
    assert.strictEqual(classifyWord('DATEDIFF_BIG', provider), 'predefined');
    assert.strictEqual(classifyWord('GEOMETRY', provider), 'type');
    assert.strictEqual(classifyWord('ROWVERSION', provider), 'type');

    // Standard columns and tables remain identifiers
    assert.strictEqual(classifyWord('Users', provider), 'identifier');
    assert.strictEqual(classifyWord('ErrorLog', provider), 'identifier');
});

