/**
 * tests/js/test_perf_l9.test.js
 * 
 * L9: Performance Baseline Measurements
 * Measures:
 * 1. analyze on 10 KB document
 * 2. analyze on 54 KB document
 * 3. analyze on 218 KB document
 * 4. getCompletions with table of 600 columns
 * 5. getCompletions with 20,000 metadata objects
 * 
 * Records measurements into tests/snapshots/perf_baseline.json
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createIdeContext } = require('./load.js');

function generateSqlOfSize(targetBytes) {
    const template = "SELECT o.OrderID, c.CustomerName, o.Total FROM dbo.Orders o INNER JOIN dbo.Customers c ON o.CustomerID = c.CustomerID WHERE o.Total > 100.0;\n";
    let sql = "";
    while (Buffer.byteLength(sql, 'utf8') < targetBytes) {
        sql += template;
    }
    // Append cursor query at the end
    sql += "SELECT o.‸ FROM dbo.Orders o;";
    return sql;
}

test('L9: Performance Benchmarking (10KB, 54KB, 218KB, 600 cols, 20k objs)', async () => {
    const ide = createIdeContext();
    const metrics = {};

    // 1. 10 KB document
    const sql10k = generateSqlOfSize(10 * 1024);
    const start10k = performance.now();
    for (let i = 0; i < 5; i++) {
        ide.analyze(sql10k);
    }
    metrics.analyze_10kb_ms = Math.round((performance.now() - start10k) / 5 * 10) / 10;

    // 2. 54 KB document
    const sql54k = generateSqlOfSize(54 * 1024);
    const start54k = performance.now();
    for (let i = 0; i < 3; i++) {
        ide.analyze(sql54k);
    }
    metrics.analyze_54kb_ms = Math.round((performance.now() - start54k) / 3 * 10) / 10;

    // 3. 218 KB document
    const sql218k = generateSqlOfSize(218 * 1024);
    const start218k = performance.now();
    ide.analyze(sql218k);
    metrics.analyze_218kb_ms = Math.round((performance.now() - start218k) * 10) / 10;

    // 4. 600 columns completion
    const start600 = performance.now();
    await ide.getCompletions("SELECT t.‸ FROM dbo.Tbl1 t");
    metrics.completions_600_columns_ms = Math.round((performance.now() - start600) * 10) / 10;

    // 5. 20,000 objects in schema
    const largeObjects = Array.from({ length: 20000 }, (_, i) => ({
        name: `Table_${i + 1}`,
        schema: 'dbo',
        type: 'table'
    }));
    ide.mockProvider.schemaData.objects.push(...largeObjects);
    const start20k = performance.now();
    await ide.getCompletions("SELECT * FROM ‸");
    metrics.completions_20k_objects_ms = Math.round((performance.now() - start20k) * 10) / 10;

    console.log('[L9 Performance Baseline Measurements]:', JSON.stringify(metrics, null, 2));

    // Save baseline snapshot
    const snapshotDir = path.resolve(__dirname, '../snapshots');
    if (!fs.existsSync(snapshotDir)) {
        fs.mkdirSync(snapshotDir, { recursive: true });
    }
    const baselineFile = path.join(snapshotDir, 'perf_baseline.json');
    fs.writeFileSync(baselineFile, JSON.stringify(metrics, null, 2), 'utf8');

    assert.ok(metrics.analyze_10kb_ms > 0, '10KB metric valid');
    assert.ok(metrics.analyze_54kb_ms > 0, '54KB metric valid');
    assert.ok(metrics.analyze_218kb_ms > 0, '218KB metric valid');
    assert.ok(metrics.completions_600_columns_ms > 0, '600 cols metric valid');
    assert.ok(metrics.completions_20k_objects_ms > 0, '20k objs metric valid');
});

test('PERF-1: analyze under 50ms on 100 KB document', () => {
    const ide = createIdeContext();
    const sql100k = generateSqlOfSize(100 * 1024);
    // Warmup
    ide.analyze(sql100k);
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
        ide.analyze(sql100k);
    }
    const elapsedAvg = (performance.now() - start) / 5;
    console.log(`[PERF-1] analyze 100KB average: ${elapsedAvg.toFixed(2)}ms`);
    assert.ok(elapsedAvg < 50, `Expected analyze on 100KB to be under 50ms, got ${elapsedAvg}ms`);
});

