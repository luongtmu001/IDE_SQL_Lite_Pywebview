/**
 * tests/js/tools/probe_ranking.js
 * 
 * Probe tool for inspecting IntelliSense completion ranking details.
 * Prints top N candidates with: rank, name, type, _matchType, _matchScore, _finalScore.
 * 
 * Usage:
 *   node tests/js/tools/probe_ranking.js [topN] [caseIdFilter]
 */

const fs = require('node:fs');
const path = require('node:path');
const { createIdeContext } = require('../load.js');

const corpusPath = path.resolve(__dirname, '../../corpus/intellisense/ranking_l2r.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

const args = process.argv.slice(2);
const topN = parseInt(args[0], 10) || 5;
const filterId = (args[1] || '').trim().toLowerCase();

async function runProbe() {
    console.log(`=== IntelliSense Ranking Probe (Top ${topN}) ===\n`);

    const results = {};

    for (const item of corpus) {
        if (filterId && !item.id.toLowerCase().includes(filterId)) {
            continue;
        }

        const ide = createIdeContext({ dbType: item.dialect || 'mssql' });
        const tabCtx = {
            connectionId: 'conn-1',
            database: 'testdb',
            schema: (item.dialect === 'postgres' || item.dialect === 'postgresql') ? 'public' : 'dbo',
            dbType: item.dialect || 'mssql'
        };

        const completions = await ide.getCompletions(item.sql, null, tabCtx);
        const topSlice = completions.slice(0, topN).map((c, idx) => ({
            rank: idx + 1,
            label: c.label || c.name || c.insertText || '',
            type: c.type || c.kind || '',
            matchType: c._matchType || 'none',
            matchScore: c._matchScore !== undefined ? c._matchScore : null,
            finalScore: c._finalScore !== undefined ? c._finalScore : null
        }));

        results[item.id] = {
            sql: item.sql,
            dialect: item.dialect,
            status: item.status,
            issue: item.issue,
            totalCount: completions.length,
            top: topSlice
        };

        const statusTag = item.status === 'expectedFailure' ? `[TODO: ${item.issue}]` : '[PASS]';
        console.log(`------------------------------------------------------------`);
        console.log(`ID: ${item.id} ${statusTag}`);
        console.log(`SQL: ${item.sql.replace(/\n/g, ' ')}`);
        console.log(`Total completions: ${completions.length}`);
        console.log(`Top ${topN}:`);
        topSlice.forEach(c => {
            const matchInfo = c.matchType !== 'none' ? ` (${c.matchType}:${c.matchScore})` : '';
            const scoreInfo = c.finalScore !== null ? ` [score: ${c.finalScore}]` : '';
            console.log(`  #${c.rank} ${c.label} <${c.type}>${matchInfo}${scoreInfo}`);
        });
        console.log('');
    }

    return results;
}

if (require.main === module) {
    runProbe().catch(err => {
        console.error('Probe failed:', err);
        process.exit(1);
    });
}

module.exports = { runProbe };
