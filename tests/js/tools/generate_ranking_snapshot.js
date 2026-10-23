/**
 * tests/js/tools/generate_ranking_snapshot.js
 * 
 * Generates tests/snapshots/ranking_top10.json from L2 and L2R corpora.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createIdeContext } = require('../load.js');

const l2Path = path.resolve(__dirname, '../../corpus/intellisense/completions_l2.json');
const l2rPath = path.resolve(__dirname, '../../corpus/intellisense/ranking_l2r.json');
const snapshotPath = path.resolve(__dirname, '../../snapshots/ranking_top10.json');

const l2Corpus = JSON.parse(fs.readFileSync(l2Path, 'utf8'));
const l2rCorpus = JSON.parse(fs.readFileSync(l2rPath, 'utf8'));

// Combine without duplicates by id
const allCases = [];
const seenIds = new Set();

for (const c of l2Corpus) {
    if (!seenIds.has(c.id)) {
        seenIds.add(c.id);
        allCases.push(c);
    }
}
for (const c of l2rCorpus) {
    if (!seenIds.has(c.id)) {
        seenIds.add(c.id);
        allCases.push(c);
    }
}

async function generateSnapshot() {
    console.log(`Generating top-10 ranking snapshot for ${allCases.length} cases...`);
    const snapshot = {};

    for (const item of allCases) {
        const ide = createIdeContext({ dbType: item.dialect || 'mssql' });
        const tabCtx = {
            connectionId: 'conn-1',
            database: 'testdb',
            schema: (item.dialect === 'postgres' || item.dialect === 'postgresql') ? 'public' : 'dbo',
            dbType: item.dialect || 'mssql'
        };

        const completions = await ide.getCompletions(item.sql, null, tabCtx);
        const top10 = completions.slice(0, 10).map((c, idx) => ({
            rank: idx + 1,
            label: c.label || c.name || c.insertText || '',
            type: c.type || c.kind || ''
        }));

        snapshot[item.id] = {
            sql: item.sql,
            dialect: item.dialect || 'mssql',
            total: completions.length,
            top10: top10
        };
    }

    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
    console.log(`Successfully written snapshot to: ${snapshotPath}`);
}

if (require.main === module) {
    generateSnapshot().catch(err => {
        console.error('Snapshot generation failed:', err);
        process.exit(1);
    });
}

module.exports = { generateSnapshot };
