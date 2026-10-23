// Test Cross-Routine Temp Table IntelliSense (PostgreSQL export vs SQL Server isolation)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const staticJsDir = path.join(__dirname, '..', 'static', 'js');

// Setup mock window/browser environment
const sandbox = {
    window: {},
    console: console,
    document: {
        querySelectorAll: () => []
    },
    localStorage: {
        getItem: () => null,
        setItem: () => {}
    }
};
sandbox.window = sandbox;
sandbox.CompletionEngine = {
    cleanIdentifier: (id) => id,
    needsQuoting: () => false,
    quoteIdentifier: (id) => id
};

function loadScript(fileName) {
    const filePath = path.join(staticJsDir, fileName);
    const code = fs.readFileSync(filePath, 'utf-8');
    vm.runInNewContext(code, sandbox, { filename: fileName });
}

// Load scripts in dependency order
loadScript('sql-tokenizer.js');
loadScript('scope-resolver.js');
loadScript('context-analyzer.js');
loadScript('candidate-generator.js');

console.log('Scripts loaded successfully.');

async function runTests() {
    // Test 1: PostgreSQL cross-routine temp tables (CALL proc_b -> temp_b visible in proc_a)
    {
        const sql = `
CREATE OR REPLACE PROCEDURE proc_b()
LANGUAGE plpgsql
AS $$
BEGIN
    CREATE TEMP TABLE temp_b (col_b1 INT, col_b2 TEXT);
END;
$$;

CREATE OR REPLACE PROCEDURE proc_a()
LANGUAGE plpgsql
AS $$
BEGIN
    CALL proc_b();
    SELECT  FROM temp_b;
END;
$$;
`;

        // Cursor right after "SELECT " inside proc_a
        const cursorIndex = sql.indexOf('SELECT ') + 'SELECT '.length;
        const context = sandbox.SqlContextAnalyzer.analyze(sql, cursorIndex, 'postgres');

        assert(context.activeScope, 'activeScope should be present inside proc_a');
        const scopeTemps = context.activeScope.getSymbolsByType('temp_table');
        const tempNames = scopeTemps.map(t => t.name.toLowerCase());
        
        console.log('Postgres inside proc_a visible temp tables:', tempNames);
        assert(tempNames.includes('temp_b'), 'temp_b should be visible inside proc_a because proc_a called proc_b()');
        
        // Check columns of temp_b
        const tempBSym = scopeTemps.find(t => t.name.toLowerCase() === 'temp_b');
        console.log('tempBSym keys and values:', Object.keys(tempBSym), 'inheritedFrom:', tempBSym.inheritedFrom, 'originRoutine:', tempBSym.originRoutine);
        assert(tempBSym, 'temp_b symbol must exist');
        const colNames = (tempBSym.columns || []).map(c => c.name.toLowerCase());
        console.log('temp_b columns:', colNames);
        assert(colNames.includes('col_b1') && colNames.includes('col_b2'), 'col_b1 and col_b2 must be defined on temp_b');

        // Test candidate generator
        const gen = new sandbox.CandidateGenerator();
        const candidates = await gen.generate(context, {});
        const tempBCand = candidates.find(c => c.name.toLowerCase() === 'temp_b');
        console.log('tempBCand in test 1:', tempBCand);
        assert(tempBCand, 'CandidateGenerator should generate candidate for temp_b inside proc_a');
        assert.strictEqual(tempBCand.type, 'temp_table');
        assert.strictEqual(tempBCand.displayType, 'Temp Table (proc_b)');
        assert.strictEqual(tempBCand.detail, 'Kế thừa từ proc_b()');
        console.log('[PASS] Test 1: PostgreSQL CALL proc_b exports temp_b to proc_a with displayType and detail');
    }

    // Test 2: PostgreSQL uncalled routine temp table should NOT be visible
    {
        const sql = `
CREATE OR REPLACE PROCEDURE proc_uncalled()
LANGUAGE plpgsql
AS $$
BEGIN
    CREATE TEMP TABLE temp_uncalled (secret_id INT);
END;
$$;

CREATE OR REPLACE PROCEDURE proc_caller()
LANGUAGE plpgsql
AS $$
BEGIN
    SELECT  FROM test;
END;
$$;
`;
        const cursorIndex = sql.indexOf('SELECT ') + 'SELECT '.length;
        const context = sandbox.SqlContextAnalyzer.analyze(sql, cursorIndex, 'postgres');

        const scopeTemps = context.activeScope.getSymbolsByType('temp_table');
        const tempNames = scopeTemps.map(t => t.name.toLowerCase());
        
        console.log('Postgres uncalled test visible temp tables:', tempNames);
        assert(!tempNames.includes('temp_uncalled'), 'temp_uncalled should NOT be visible inside proc_caller because it was never called');
        console.log('[PASS] Test 2: PostgreSQL uncalled routine temp table is not leaked');
    }

    // Test 3: PostgreSQL transitive call: proc_a -> proc_b -> proc_c
    {
        const sql = `
CREATE OR REPLACE PROCEDURE proc_c()
LANGUAGE plpgsql
AS $$
BEGIN
    CREATE TEMP TABLE temp_c (id_c INT, val_c VARCHAR(100));
END;
$$;

CREATE OR REPLACE PROCEDURE proc_b()
LANGUAGE plpgsql
AS $$
BEGIN
    CALL proc_c();
    CREATE TEMP TABLE temp_b (id_b INT);
END;
$$;

CREATE OR REPLACE PROCEDURE proc_a()
LANGUAGE plpgsql
AS $$
BEGIN
    CALL proc_b();
    SELECT  FROM temp_c;
END;
$$;
`;
        const cursorIndex = sql.indexOf('SELECT ') + 'SELECT '.length;
        const context = sandbox.SqlContextAnalyzer.analyze(sql, cursorIndex, 'postgres');

        const scopeTemps = context.activeScope.getSymbolsByType('temp_table');
        const tempNames = scopeTemps.map(t => t.name.toLowerCase());
        
        console.log('Postgres transitive call visible temp tables:', tempNames);
        assert(tempNames.includes('temp_b'), 'temp_b must be visible');
        assert(tempNames.includes('temp_c'), 'temp_c must be visible transitively (proc_a -> proc_b -> proc_c)');
        console.log('[PASS] Test 3: PostgreSQL transitive call exports temp_c to proc_a');
    }

    // Test 4: SQL Server isolation - callee procedure's #temp is NOT visible in caller procedure or outside
    {
        const sql = `
CREATE PROCEDURE dbo.usp_Child
AS
BEGIN
    CREATE TABLE #temp_child (ChildId INT, ChildName NVARCHAR(50));
    SELECT * FROM #temp_child;
END;
GO

CREATE PROCEDURE dbo.usp_Parent
AS
BEGIN
    EXEC dbo.usp_Child;
    SELECT  FROM 
END;
GO
`;
        // Cursor right after "SELECT " inside usp_Parent
        const cursorIndex = sql.indexOf('SELECT  FROM ') + 'SELECT '.length;
        const context = sandbox.SqlContextAnalyzer.analyze(sql, cursorIndex, 'sqlserver');

        assert(context.activeScope, 'activeScope should be present inside usp_Parent');
        const scopeTemps = context.activeScope.getSymbolsByType('temp_table');
        const tempNames = scopeTemps.map(t => t.name.toLowerCase());
        
        console.log('SQL Server inside usp_Parent visible temp tables:', tempNames);
        assert(!tempNames.includes('#temp_child'), 'SQL Server #temp_child must NOT be visible inside usp_Parent even with EXEC usp_Child');
        assert(!context.localTempTables.map(t => t.toLowerCase()).includes('#temp_child'), 'localTempTables must not leak #temp_child');

        const gen = new sandbox.CandidateGenerator();
        const candidates = await gen.generate(context, {});
        const childCand = candidates.find(c => c.name.toLowerCase() === '#temp_child');
        assert(!childCand, 'CandidateGenerator must NOT generate candidate for #temp_child in SQL Server caller');
        console.log('[PASS] Test 4: SQL Server procedure #temp isolation verified (no leak to caller)');
    }

    // Test 5: SQL Server - procedure can see its own #temp
    {
        const sql = `
CREATE PROCEDURE dbo.usp_Self
AS
BEGIN
    CREATE TABLE #temp_self (SelfId INT, SelfDesc NVARCHAR(100));
    SELECT  FROM #temp_self;
END;
GO
`;
        const cursorIndex = sql.indexOf('SELECT ') + 'SELECT '.length;
        const context = sandbox.SqlContextAnalyzer.analyze(sql, cursorIndex, 'sqlserver');

        assert(context.activeScope, 'activeScope should be present inside usp_Self');
        const scopeTemps = context.activeScope.getSymbolsByType('temp_table');
        const tempNames = scopeTemps.map(t => t.name.toLowerCase());
        
        console.log('SQL Server inside usp_Self visible temp tables:', tempNames);
        assert(tempNames.includes('#temp_self'), '#temp_self must be visible inside its own procedure');
        
        const sym = scopeTemps.find(t => t.name.toLowerCase() === '#temp_self');
        const cols = (sym.columns || []).map(c => c.name.toLowerCase());
        assert(cols.includes('selfid') && cols.includes('selfdesc'), '#temp_self columns must be present');
        console.log('[PASS] Test 5: SQL Server procedure can see its own #temp');
    }

    console.log('\nALL 5 JAVASCRIPT CROSS-ROUTINE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
