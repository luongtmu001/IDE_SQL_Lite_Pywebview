/**
 * tests/js/test_temp_table_tab_isolation.test.js
 * 
 * Verifies that:
 * 1. Undeclared #temp in FROM clause is NOT suggested (self-referential leak fix).
 * 2. Declared #temp via CREATE TABLE or SELECT INTO is suggested in current tab.
 * 3. #temp from Tab 1 NEVER leaks to Tab 2 (strict session / tab isolation).
 * 4. ##global_temp from Tab 1 IS shared and suggested across tabs on the same connection.
 * 5. ##global_temp is NOT leaked to tabs on different connections.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const staticJsDir = path.resolve(__dirname, '../../static/js');

function createEnvironment() {
    const tabsMap = new Map();
    const sandbox = {
        window: {},
        console: console,
        document: {
            querySelectorAll: () => [],
            addEventListener: () => {},
            dispatchEvent: () => {}
        },
        localStorage: {
            getItem: () => null,
            setItem: () => {}
        },
        performance: { now: () => Date.now() },
        CustomEvent: function(name, opts) {
            this.type = name;
            this.name = name;
            this.detail = opts ? opts.detail : null;
        },
        AppTabs: {
            getAllTabs: () => tabsMap,
            getActiveTabId: () => 'tab_active',
            getActiveTabState: () => tabsMap.get('tab_active')
        }
    };
    sandbox.window = sandbox;

    function loadScript(fileName) {
        const filePath = path.join(staticJsDir, fileName);
        const code = fs.readFileSync(filePath, 'utf-8');
        vm.runInNewContext(code, sandbox, { filename: fileName });
    }

    loadScript('sql-tokenizer.js');
    loadScript('scope-resolver.js');
    loadScript('context-analyzer.js');
    loadScript('metadata-cache.js');
    loadScript('candidate-generator.js');
    loadScript('completion-engine.js');

    return { sandbox, tabsMap };
}

test('Temp Table Tab Isolation & Global Temp Table Sharing', async (t) => {
    const { sandbox, tabsMap } = createEnvironment();
    const generator = new sandbox.CandidateGenerator(sandbox.MetadataCache);

    await t.test('1. Undeclared #temp in FROM clause is NOT suggested', async () => {
        const text = 'SELECT * FROM #temp';
        const ctx = sandbox.SqlContextAnalyzer.analyze(text, 19, 'sqlserver');
        const tabCtx = { tabId: 'tab_test1', connectionId: 'conn1', dbType: 'sqlserver' };
        const candidates = await generator.generate(ctx, tabCtx, '#temp');
        const hasTemp = candidates.some(c => (c.name || '').toLowerCase() === '#temp');
        assert.strictEqual(hasTemp, false, 'Undeclared #temp must not be suggested');
    });

    await t.test('2. Declared #temp via CREATE TABLE is suggested in current tab', async () => {
        const text = 'CREATE TABLE #temp (id INT);\nSELECT * FROM #';
        const ctx = sandbox.SqlContextAnalyzer.analyze(text, text.length, 'sqlserver');
        const tabCtx = { tabId: 'tab_test2', connectionId: 'conn1', dbType: 'sqlserver' };
        const candidates = await generator.generate(ctx, tabCtx, '#');
        const found = candidates.find(c => (c.name || '').toLowerCase() === '#temp');
        assert.ok(found, '#temp should be suggested when declared via CREATE TABLE');
        assert.strictEqual(found.displayType, 'Temp Table');
    });

    await t.test('3. Declared #temp via SELECT INTO is suggested in current tab', async () => {
        const text = 'SELECT id INTO #temp FROM users;\nSELECT * FROM #';
        const ctx = sandbox.SqlContextAnalyzer.analyze(text, text.length, 'sqlserver');
        const tabCtx = { tabId: 'tab_test3', connectionId: 'conn1', dbType: 'sqlserver' };
        const candidates = await generator.generate(ctx, tabCtx, '#');
        const found = candidates.find(c => (c.name || '').toLowerCase() === '#temp');
        assert.ok(found, '#temp should be suggested when declared via SELECT INTO');
    });

    await t.test('4. Tab 1 local #temp does NOT leak to Tab 2', async () => {
        tabsMap.clear();
        tabsMap.set('tab_1', {
            id: 'tab_1',
            connectionId: 'conn1',
            content: 'CREATE TABLE #tab1_local (id INT);'
        });
        tabsMap.set('tab_2', {
            id: 'tab_2',
            connectionId: 'conn1',
            content: 'SELECT * FROM #'
        });

        const tab2Text = 'SELECT * FROM #';
        const ctx = sandbox.SqlContextAnalyzer.analyze(tab2Text, tab2Text.length, 'sqlserver');
        const tabCtx2 = { tabId: 'tab_2', connectionId: 'conn1', dbType: 'sqlserver' };
        const candidates = await generator.generate(ctx, tabCtx2, '#');
        const leaked = candidates.find(c => (c.name || '').toLowerCase() === '#tab1_local');
        assert.strictEqual(Boolean(leaked), false, 'Local temp table # must NEVER leak across tabs');
    });

    await t.test('5. Tab 1 global ##temp IS suggested in Tab 2 on the same connection', async () => {
        tabsMap.clear();
        tabsMap.set('tab_1', {
            id: 'tab_1',
            connectionId: 'conn1',
            content: 'CREATE TABLE ##global_tab1 (id INT);'
        });
        tabsMap.set('tab_2', {
            id: 'tab_2',
            connectionId: 'conn1',
            content: 'SELECT * FROM ##'
        });

        const tab2Text = 'SELECT * FROM ##';
        const ctx = sandbox.SqlContextAnalyzer.analyze(tab2Text, tab2Text.length, 'sqlserver');
        const tabCtx2 = { tabId: 'tab_2', connectionId: 'conn1', dbType: 'sqlserver' };
        const candidates = await generator.generate(ctx, tabCtx2, '##');
        const found = candidates.find(c => (c.name || '').toLowerCase() === '##global_tab1');
        assert.ok(found, 'Global temp table ## must be suggested across tabs on the same connection');
        assert.strictEqual(found.displayType, 'Global Temp Table');
    });

    await t.test('6. Tab 1 global ##temp is NOT leaked to Tab 3 on a DIFFERENT connection', async () => {
        tabsMap.set('tab_3', {
            id: 'tab_3',
            connectionId: 'conn2',
            content: 'SELECT * FROM ##'
        });

        const tab3Text = 'SELECT * FROM ##';
        const ctx = sandbox.SqlContextAnalyzer.analyze(tab3Text, tab3Text.length, 'sqlserver');
        const tabCtx3 = { tabId: 'tab_3', connectionId: 'conn2', dbType: 'sqlserver' };
        const candidates = await generator.generate(ctx, tabCtx3, '##');
        const found = candidates.find(c => (c.name || '').toLowerCase() === '##global_tab1');
        assert.strictEqual(Boolean(found), false, 'Global temp table ## must NOT leak to tabs on different connections');
    });
});
