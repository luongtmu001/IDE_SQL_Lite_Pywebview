/**
 * completion-ranker.js - Contextual IntelliSense Candidate Ranker
 */
(function(window) {
    'use strict';

    /**
     * CompletionMruManager - Manages Most Recently Used (MRU) / Frequently Used completions.
     * Specification (GĐ5):
     * - Key format: `${dbType}::${connection}::${type}::${nameLower}`
     * - Saved to localStorage under key 'intellisense_mru_history' (wrapped in try/catch)
     * - Max 500 entries, with time decay factor
     * - Score bonus 0..15 points within the same candidate category
     */
    class CompletionMruManager {
        constructor(options = {}) {
            this.storageKey = options.storageKey || 'intellisense_mru_history';
            this.maxEntries = options.maxEntries || 500;
        }

        static getInstance() {
            if (!CompletionMruManager._instance) {
                CompletionMruManager._instance = new CompletionMruManager();
            }
            return CompletionMruManager._instance;
        }

        buildKey(dbType, connectionId, type, name) {
            const dt = String(dbType || 'common').trim().toLowerCase();
            const conn = String(connectionId || 'default').trim();
            const tp = String(type || 'unknown').trim().toLowerCase();
            const nm = String(name || '').trim().toLowerCase();
            return `${dt}::${conn}::${tp}::${nm}`;
        }

        loadHistory() {
            if (typeof localStorage === 'undefined') return {};
            try {
                const raw = localStorage.getItem(this.storageKey);
                if (!raw) return {};
                const parsed = JSON.parse(raw);
                return (parsed && typeof parsed === 'object') ? parsed : {};
            } catch (e) {
                return {};
            }
        }

        saveHistory(history) {
            if (typeof localStorage === 'undefined') return;
            try {
                const keys = Object.keys(history);
                if (keys.length > this.maxEntries) {
                    const now = Date.now();
                    const scored = keys.map(k => {
                        const item = history[k] || {};
                        const ageHours = Math.max(0, (now - (item.lastUsed || now)) / 3600000);
                        const recency = Math.max(0.2, 1 / (1 + ageHours / 72));
                        const score = (item.count || 1) * recency;
                        return { key: k, score };
                    });
                    scored.sort((a, b) => b.score - a.score);
                    const pruned = {};
                    const targetCount = Math.floor(this.maxEntries * 0.8);
                    for (let i = 0; i < Math.min(targetCount, scored.length); i++) {
                        pruned[scored[i].key] = history[scored[i].key];
                    }
                    localStorage.setItem(this.storageKey, JSON.stringify(pruned));
                } else {
                    localStorage.setItem(this.storageKey, JSON.stringify(history));
                }
            } catch (e) {
                // Ignore storage errors (quota, sandbox)
            }
        }

        recordItem(dbType, connectionId, type, name) {
            if (!name) return;
            try {
                const key = this.buildKey(dbType, connectionId, type, name);
                const history = this.loadHistory();
                const existing = history[key] || { count: 0, lastUsed: 0 };
                existing.count = (existing.count || 0) + 1;
                existing.lastUsed = Date.now();
                history[key] = existing;
                this.saveHistory(history);
            } catch (e) {
                // Non-blocking
            }
        }

        getMruBonus(dbType, connectionId, type, name) {
            if (!name) return 0;
            try {
                const key = this.buildKey(dbType, connectionId, type, name);
                const history = this.loadHistory();
                const entry = history[key];
                if (!entry || !entry.count) return 0;

                const now = Date.now();
                const ageHours = Math.max(0, (now - (entry.lastUsed || now)) / 3600000);
                // Decay half-life: 72h (3 days). Drops smoothly from 1.0 down to 0.2
                const recency = Math.max(0.2, 1 / (1 + ageHours / 72));
                const rawScore = entry.count * recency;

                // Scale: 1 use = ~3 pts, 2 uses = ~6 pts, 3 uses = ~9 pts, 5+ uses = up to 15 pts
                return Math.min(15, Math.max(0, Math.round(rawScore * 3)));
            } catch (e) {
                return 0;
            }
        }

        clearHistory() {
            if (typeof localStorage === 'undefined') return;
            try {
                localStorage.removeItem(this.storageKey);
            } catch (e) {
                // Non-blocking
            }
        }
    }

    class CompletionRanker {
        constructor(options = {}) {
            this.v2Ranking = options.v2Ranking !== undefined ? options.v2Ranking : undefined;
            this.v2Mru = options.v2Mru !== undefined ? options.v2Mru : undefined;
            this.mruManager = options.mruManager || CompletionMruManager.getInstance();
        }

        rank(items, context = {}, query = '') {
            if (!items || !Array.isArray(items)) return [];
            const cleanQuery = String(query || '').trim().toLowerCase();
            const isV2 = (this.v2Ranking !== undefined)
                ? Boolean(this.v2Ranking)
                : ((context && context.v2Ranking !== undefined)
                    ? Boolean(context.v2Ranking)
                    : ((typeof localStorage !== 'undefined' && localStorage.getItem('intellisense.v2.ranking') === 'false') ? false : true));
            const isMru = (this.v2Mru !== undefined)
                ? Boolean(this.v2Mru)
                : ((context && context.v2Mru !== undefined)
                    ? Boolean(context.v2Mru)
                    : ((typeof localStorage !== 'undefined' && localStorage.getItem('intellisense.v2.mru') === 'true')));

            const dbType = (context.dbType || (context.tabCtx && context.tabCtx.dbType) || 'common').toLowerCase();
            const connId = (context.connectionId || (context.tabCtx && context.tabCtx.connectionId) || 'default');

            // Phase 3: Visibility Filter - in WHERE and HAVING, hide aliases of the SELECT list (Spec 8.2 & 8.3)
            let candidatesToRank = items;
            if (context.clause === 'WHERE' || context.clause === 'HAVING') {
                candidatesToRank = items.filter(it => (it.type || it.kind) !== 'select_alias');
            }

            // Phase 4: DML alreadyListed filter (INSERT columns & UPDATE SET)
            const isInsertCols = Boolean(context.isInsertColumns || context.clause === 'INSERT_COLUMNS');
            const isUpdateSet = Boolean(context.isUpdateSet || (context.clause === 'SET' && !context.isUpdateSetValue));
            if ((isInsertCols || isUpdateSet) && context.alreadyListed && context.alreadyListed.length > 0) {
                const alreadySet = new Set(context.alreadyListed.map(s => s.toLowerCase()));
                candidatesToRank = candidatesToRank.filter(it => !alreadySet.has((it.name || '').toLowerCase()));
            }

            // Deduplicate items by (nameLower::type)
            const seen = new Set();
            let unique = [];

            candidatesToRank.forEach(item => {
                const name = item.name || item.label || '';
                const type = item.type || item.kind || 'unknown';
                const key = `${name.toLowerCase()}::${type}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(item);
                }
            });

            const isFromClause = (context.clause === 'FROM' || context.clause === 'JOIN');
            const isDmlTableClause = (context.clause === 'INSERT INTO' || context.clause === 'UPDATE');
            const isSelectClause = (context.clause === 'SELECT' || context.clause === 'RETURNING' || context.clause === 'OUTPUT');
            const isWhereClause = (context.clause === 'WHERE' || context.clause === 'ON' || context.clause === 'HAVING');
            const isOrderClause = (context.clause === 'ORDER BY' || context.clause === 'GROUP BY');
            const isExecClause = (context.clause === 'EXEC' || context.clause === 'EXECUTE');
            const isUseClause = (context.clause === 'USE');
            const isVarTrigger = (context.currentWord && context.currentWord.startsWith('@')) || context.triggerChar === '@';
            const isValueExpr = Boolean(context.position === 'value_expression' || context.isUpdateSetValue);

            // Exclude current procedure if in EXEC parameter position
            if (context.execContext && context.execContext.isParameterPosition && context.execContext.procedureName) {
                const targetProc = context.execContext.procedureName.toLowerCase();
                unique = unique.filter(it => !(it.type === 'procedure' && (it.name || '').toLowerCase() === targetProc));
            }

            // Calculate contextual rank score for each item
            unique.forEach(item => {
                let contextScore = 0;
                const type = item.type || item.kind || '';

                // Exact match rule (Spec GĐ4, K-OR, PG-OR)
                const itemNameLower = (item.name || item.label || '').toLowerCase();
                if (cleanQuery && itemNameLower === cleanQuery) {
                    if (item.isExpected || item.isFollowUp) {
                        contextScore += 150; // Expected keyword exact match is unconditionally #1
                    } else {
                        contextScore += 80;  // Standard exact match bonus
                    }
                }

                // Expected / Follow-up keywords boost (Spec GĐ3 & GĐ4)
                if (item.isFollowUp) {
                    contextScore += 120;
                } else if (item.isExpected) {
                    contextScore += 90;
                }

                if (context.position === 'table_hint' && item.name.toUpperCase() === 'NOLOCK') {
                    contextScore += 10;
                } else if (context.position === 'after_operand') {
                    const opUpper = item.name.toUpperCase();
                    if (['=', '<>', 'IN', 'IS', 'LIKE', 'BETWEEN'].includes(opUpper)) {
                        contextScore += 10;
                    }
                } else if (context.position === 'statement_start') {
                    const kw = item.name.toUpperCase();
                    if (['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'DECLARE'].includes(kw)) {
                        contextScore += 15;
                    }
                } else if (isValueExpr && context.isUpdateSetValue && context.alreadyListed && context.alreadyListed.length > 0) {
                    const currentTargetCol = context.alreadyListed[context.alreadyListed.length - 1];
                    if ((item.name || '').toLowerCase() === currentTargetCol) {
                        contextScore += 15;
                    }
                }

                // 1. ALTER context priority
                if (context.isAlterContext && context.alterObjectType) {
                    if (type === context.alterObjectType) {
                        contextScore += 100;
                    } else if (type === 'schema') {
                        contextScore += 75;
                    }
                }

                // 2. FROM / JOIN / INSERT INTO / UPDATE clause priorities (Section 25, 26, 39, Phase 4 DML)
                if ((isFromClause || isDmlTableClause) && !context.qualifier) {
                    if (['table', 'view', 'cte', 'subquery', 'apply_subquery', 'lateral_subquery', 'table_function', 'temp_table', 'table_variable', 'synonym', 'pseudo_table', 'linked_server', 'foreign_server'].includes(type)) {
                        contextScore += (type === 'cte' || type === 'pseudo_table') ? 85 : 80;
                    } else if (type === 'schema') {
                        contextScore += 75;
                    } else if (type === 'database') {
                        contextScore += item.isSystemDb ? 35 : 65;
                    } else if (isFromClause && type === 'keyword' && ['JOIN', 'LEFT', 'RIGHT', 'INNER', 'CROSS', 'OUTER', 'ON', 'WHERE', 'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET'].includes(item.name.toUpperCase())) {
                        contextScore += 50;
                        const kw = item.name.toUpperCase();
                        if (context.clause === 'JOIN' && kw === 'ON') {
                            contextScore += 30;
                        } else if (kw === 'WHERE') {
                            contextScore += 15;
                        } else if (['JOIN', 'INNER JOIN', 'LEFT JOIN', 'INNER', 'LEFT'].includes(kw)) {
                            contextScore += 10;
                        }
                    } else if (isDmlTableClause && type === 'keyword') {
                        contextScore -= 40;
                    }
                }

                // 2b. USE statement database priority
                if (isUseClause && !context.qualifier) {
                    if (type === 'database') {
                        contextScore += item.isSystemDb ? 85 : 120;
                    }
                }

                // 3. SELECT / WHERE / ON / ORDER BY / VALUE_EXPR clause priorities (Section 24, 27, 28, 47)
                if ((isSelectClause || isWhereClause || isOrderClause || isValueExpr) && !context.qualifier) {
                    if (context.enclosingFunction === 'COUNT') {
                        const itemName = (item.name || item.label || '').toUpperCase();
                        if (itemName === '*') {
                            contextScore += 110;
                        } else if (itemName === 'DISTINCT') {
                            contextScore += 95;
                        } else if (type === 'pk_column') {
                            contextScore += 75;
                        } else if (type === 'column') {
                            contextScore += 70;
                        }
                    } else if (type === 'star_expansion') {
                        contextScore += 85;
                    } else if (type === 'scalar_variable') {
                        contextScore += isWhereClause ? 80 : 65;
                    } else if (type === 'pk_column') {
                        contextScore += 75;
                    } else if (type === 'column') {
                        contextScore += 70;
                    } else if (type === 'table_variable' || type === 'temp_table') {
                        contextScore += 50;
                    } else if (type === 'sql_function' || type === 'function') {
                        contextScore += isWhereClause ? 45 : 30;
                    }
                }

                // 3b. Routine Body / Non-clause Expression priority (PL/pgSQL assignments, returns, conditionals)
                if (!context.clause && !context.qualifier) {
                    if (type === 'scalar_variable') {
                        contextScore += 70;
                    } else if (type === 'linked_server' || type === 'foreign_server') {
                        contextScore += 75;
                    }
                }

                // 4. EXEC clause priority (Section 29, 51)
                if (isExecClause) {
                    if (context.execContext && context.execContext.isParameterPosition) {
                        if (type === 'parameter') {
                            contextScore += 110;
                        } else if (type === 'scalar_variable') {
                            contextScore += 90;
                        }
                    } else {
                        if (type === 'procedure' || type === 'stored_procedure') {
                            contextScore += 95;
                        } else if (type === 'schema') {
                            contextScore += 85;
                        } else if (type === 'database') {
                            contextScore += item.isSystemDb ? 40 : 70;
                        } else if (type === 'linked_server' || type === 'foreign_server') {
                            contextScore += 80;
                        }
                    }
                }

                // 4b. Variable trigger priority (user typed '@')
                if (isVarTrigger) {
                    if (type === 'parameter') {
                        contextScore += 105;
                    } else if (type === 'scalar_variable') {
                        contextScore += 95;
                    } else if (type === 'table_variable') {
                        contextScore += 75;
                    }
                }

                // 4b2. Temp Table trigger priority (user typed '#')
                const isTempTrigger = (context.currentWord && context.currentWord.startsWith('#')) || context.triggerChar === '#';
                if (isTempTrigger) {
                    if (type === 'temp_table') {
                        contextScore += 120;
                    }
                }

                // 4c. Strict ALTER Context priority (SQL Prompt style)
                if (context.isAlterContext && context.alterObjectType && type === context.alterObjectType) {
                    contextScore += 100;
                }

                // 4d. Snippet Priority: When user types snippet prefix, prioritize snippets at the top!
                if (type === 'snippet') {
                    if (item.displayType === 'FK Join Snippet') {
                        contextScore += 270; // Top snippet in JOIN clause (#1 over raw tables)!
                    } else {
                        const snipName = (item.name || '').toLowerCase();
                        if (cleanQuery && snipName === cleanQuery) {
                            contextScore += 160; // Exact snippet prefix match -> #1
                        } else if (cleanQuery && snipName.startsWith(cleanQuery)) {
                            contextScore += 130; // Prefix snippet match -> top priority above keywords
                        } else {
                            contextScore += 50;
                        }
                    }
                    if (item.isPinned) {
                        contextScore += 120; // Pinned snippets get strong priority boost!
                    }
                }

                // Phase 5: JOIN & ON Clause Priorities (Spec 11.4)
                if (type === 'join_condition') {
                    contextScore += 280; // #1 candidate in ON clause!
                }
                if (item.isFkTarget) {
                    contextScore += 180; // Boost FK-related tables to the top in JOIN clause!
                }

                // Phase 3: ORDER BY & GROUP BY Select Alias Visibility
                if (context.clause === 'ORDER BY' || context.clause === 'GROUP BY') {
                    if (type === 'select_alias') {
                        contextScore += 120; // Top priority in ORDER BY!
                    }
                }

                // Phase 4: DML INSERT_COLUMNS & UPDATE SET Priorities
                if (isInsertCols) {
                    if (type === 'pk_column' || type === 'column') {
                        contextScore += 110; // Top priority in INSERT column list!
                    } else if (type === 'keyword') {
                        contextScore -= 40;
                    }
                } else if (isUpdateSet) {
                    if (type === 'pk_column' || type === 'column') {
                        contextScore += 100; // Top priority in UPDATE SET column list!
                    } else if (type === 'keyword') {
                        contextScore -= 40; // Demote keywords so target columns appear first
                    }
                }

                // Phase 4: T-SQL CATCH Block Priority (Section 4.1 of .SKILL/quy_tac_va_thu_tu_thuc_hien_intellisense_syntax_check.md)
                if (context.isInCatchBlock) {
                    const itemName = (item.name || item.label || '').toUpperCase();
                    const CATCH_ERROR_FUNCTIONS = [
                        'ERROR_MESSAGE', 'ERROR_MESSAGE()',
                        'ERROR_NUMBER', 'ERROR_NUMBER()',
                        'ERROR_LINE', 'ERROR_LINE()',
                        'ERROR_SEVERITY', 'ERROR_SEVERITY()',
                        'ERROR_STATE', 'ERROR_STATE()',
                        'ERROR_PROCEDURE', 'ERROR_PROCEDURE()',
                        'XACT_STATE', 'XACT_STATE()'
                    ];
                    if (CATCH_ERROR_FUNCTIONS.includes(itemName) || CATCH_ERROR_FUNCTIONS.some(fn => itemName.startsWith(fn))) {
                        contextScore += 160; // High priority for error functions in CATCH block
                    } else if (itemName === 'THROW') {
                        contextScore += 150; // High priority statement in CATCH block
                    }
                }

                // Phase 4: Data Type Context Priorities (Issue I3)
                if (context.isDataTypePosition || context.contextType === 'data_type') {
                    if (type === 'data_type') {
                        contextScore += 200;
                        const itemName = (item.name || '').toLowerCase();
                        if (context.dataTypeTarget === 'CONVERT') {
                            if (itemName === 'varchar') contextScore += 60;
                            else if (itemName === 'int') contextScore += 50;
                            else if (itemName === 'datetime') contextScore += 40;
                            else if (itemName === 'nvarchar') contextScore += 35;
                            else if (itemName === 'decimal') contextScore += 30;
                        } else if (context.dataTypeTarget === 'CAST') {
                            if (itemName === 'int') contextScore += 60;
                            else if (itemName === 'varchar') contextScore += 50;
                            else if (itemName === 'bigint') contextScore += 40;
                            else if (itemName === 'decimal') contextScore += 35;
                            else if (itemName === 'datetime') contextScore += 30;
                        } else if (context.dataTypeTarget === 'DECLARE') {
                            if (itemName === 'int') contextScore += 60;
                            else if (itemName === 'varchar') contextScore += 50;
                            else if (itemName === 'bigint') contextScore += 40;
                            else if (itemName === 'bit') contextScore += 35;
                            else if (itemName === 'nvarchar') contextScore += 30;
                        } else if (context.dataTypeTarget === 'PG_CAST') {
                            if (itemName === 'integer') contextScore += 60;
                            else if (itemName === 'text') contextScore += 50;
                            else if (itemName === 'numeric') contextScore += 40;
                            else if (itemName === 'varchar') contextScore += 35;
                            else if (itemName === 'boolean') contextScore += 30;
                        } else {
                            if (['int', 'integer', 'varchar', 'bigint', 'text'].includes(itemName)) {
                                contextScore += 30;
                            }
                        }
                    } else {
                        contextScore -= 100;
                    }
                }

                // 5. Qualifier Priority (Section 24, 39, 40, 46)
                if (context.qualifier) {
                    if (type === 'star_expansion') {
                        contextScore += 100;
                    } else if (type === 'pk_column') {
                        contextScore += 95;
                    } else if (type === 'column' || type === 'remote_column') {
                        contextScore += 90;
                    } else if (['database', 'remote_database', 'schema', 'remote_schema', 'remote_table', 'remote_view', 'table', 'view', 'procedure', 'function', 'synonym', 'sequence'].includes(type)) {
                        contextScore += 92;
                    }
                    // Phase 3: Alias che ten goc (Spec 8.3 Rule 1)
                    // If qualifier is masked by an alias (e.g. Customers. instead of c.), downgrade priority
                    if (context.resolvedObject && context.resolvedObject.isMaskedByAlias) {
                        contextScore -= 40;
                    }
                } else {
                    // Unqualified: Active query alias has higher priority than raw tables
                    if (type === 'alias') {
                        contextScore += 60;
                    } else if (item.isMaskedByAlias) {
                        contextScore -= 30; // Table has an alias, downgrade raw table name
                    }
                }

                // 6. Base level penalty/bonus
                const baseLevel = (typeof item.level === 'number') ? item.level : 2;
                const levelScore = Math.max(0, 30 - baseLevel * 10);

                // 7. Match quality from filter
                const matchScore = item._matchScore || 50;

                // 8. Popularity weight (Spec GĐ4 / RC3)
                let pop = item.popularity;
                if (pop === undefined) {
                    const dialect = (window.SqlDialectFactory && context && (context.dbType || context.dialect))
                        ? window.SqlDialectFactory.getDialect(context.dbType || context.dialect)
                        : null;
                    if (dialect && typeof dialect.getPopularity === 'function') {
                        pop = dialect.getPopularity(item.name || item.label, type);
                    } else {
                        const kwOrFn = (item.name || item.label || '').toUpperCase();
                        if (type === 'keyword' || type === 'syntax_operator') {
                            pop = (window.COMMON_KEYWORD_POPULARITY && window.COMMON_KEYWORD_POPULARITY[kwOrFn]) || 0;
                        } else if (type === 'sql_function' || type === 'function') {
                            pop = (window.COMMON_FUNCTION_POPULARITY && window.COMMON_FUNCTION_POPULARITY[kwOrFn]) || 0;
                        } else {
                            pop = 0;
                        }
                    }
                }
                item.popularity = pop || 0;

                if (isV2) {
                    item._finalScore = (matchScore * 2) + contextScore + levelScore + (item.popularity * 2);
                    if (isMru && this.mruManager) {
                        const mruBonus = this.mruManager.getMruBonus(dbType, connId, type, item.name || item.label);
                        if (mruBonus > 0) {
                            item.mruBonus = mruBonus;
                            item._finalScore += mruBonus;
                        }
                    }
                } else {
                    item._finalScore = (matchScore * 2) + contextScore + levelScore;
                }
            });

            // Sort: points -> popularity -> exact match -> length -> A-Z (Spec GĐ4)
            unique.sort((a, b) => {
                if (b._finalScore !== a._finalScore) {
                    return b._finalScore - a._finalScore;
                }
                if (isV2) {
                    if (a.type === 'parameter' && b.type === 'parameter' && a.paramIndex !== undefined && b.paramIndex !== undefined) {
                        return a.paramIndex - b.paramIndex;
                    }
                    if (isMru) {
                        const aMru = a.mruBonus || 0;
                        const bMru = b.mruBonus || 0;
                        if (bMru !== aMru) return bMru - aMru;
                    }
                    const aPop = a.popularity || 0;
                    const bPop = b.popularity || 0;
                    if (bPop !== aPop) return bPop - aPop;
                    if (cleanQuery) {
                        const aExact = (a.name || '').toLowerCase() === cleanQuery;
                        const bExact = (b.name || '').toLowerCase() === cleanQuery;
                        if (aExact && !bExact) return -1;
                        if (!aExact && bExact) return 1;
                        const aLen = (a.name || '').length;
                        const bLen = (b.name || '').length;
                        if (aLen !== bLen) return aLen - bLen;
                    }
                } else {
                    if (cleanQuery) {
                        const aExact = (a.name || '').toLowerCase() === cleanQuery;
                        const bExact = (b.name || '').toLowerCase() === cleanQuery;
                        if (aExact && !bExact) return -1;
                        if (!aExact && bExact) return 1;
                    }
                }
                return (a.name || '').localeCompare(b.name || '');
            });

            // Issue I8 & Spec GĐ4 / RC4: Group Quota Limiting
            // If qualifier resolves to a specific object/alias (e.g. column list of a table), raise limit to 1000 (wide tables)
            // Group quotas in v2: expected keywords always kept; other keywords <= 30; functions <= 40; objects <= 100; total <= 150
            const isSingleObjectQualified = Boolean(
                context.qualifier && (
                    (context.resolvedObject && ['table', 'view', 'temp_table', 'table_variable', 'cte', 'subquery'].includes(context.resolvedObject.type)) ||
                    (context.queryTables && context.queryTables.some(t => 
                        (t.alias && t.alias.toLowerCase() === context.qualifier.toLowerCase()) ||
                        (t.table && t.table.toLowerCase() === context.qualifier.toLowerCase())
                    ))
                )
            );
            const maxLimit = isSingleObjectQualified ? 1000 : 150;

            let sliced;
            if (isV2 && !isSingleObjectQualified) {
                sliced = [];
                let kwOtherCount = 0;
                let fnCount = 0;
                let objCount = 0;
                for (const item of unique) {
                    const type = item.type || item.kind || '';
                    if (type === 'keyword' || type === 'syntax_operator') {
                        if (item.isExpected || item.isFollowUp) {
                            sliced.push(item);
                        } else {
                            if (kwOtherCount < 30) {
                                kwOtherCount++;
                                sliced.push(item);
                            }
                        }
                    } else if (type === 'sql_function' || type === 'function') {
                        if (fnCount < 40) {
                            fnCount++;
                            sliced.push(item);
                        }
                    } else if (['table', 'view', 'schema', 'procedure', 'stored_procedure', 'synonym', 'sequence', 'database', 'linked_server', 'foreign_server'].includes(type)) {
                        if (objCount < 100) {
                            objCount++;
                            sliced.push(item);
                        }
                    } else {
                        // columns, pk_column, parameter, scalar_variable, snippet, star_expansion, join_condition...
                        sliced.push(item);
                    }
                    if (sliced.length >= maxLimit) break;
                }
            } else {
                sliced = unique.slice(0, maxLimit);
            }
            const isTruncated = unique.length > maxLimit;
            sliced.isTruncated = isTruncated;
            sliced.meta = {
                truncated: isTruncated,
                totalCount: unique.length,
                limit: maxLimit
            };
            if (items.hasError) {
                sliced.hasError = true;
            }
            if (items.meta && items.meta.errors) {
                sliced.meta.errors = items.meta.errors;
            }
            return sliced;
        }
    }

    /**
     * CandidateGenerator - Context-Aware Candidate Provider (Section 23-29, 39, 40, 46, 47, 51)
     */

    CompletionRanker.MruManager = CompletionMruManager;
    CompletionRanker.getInstance = function() {
        if (!CompletionRanker._instance) {
            CompletionRanker._instance = new CompletionRanker();
        }
        return CompletionRanker._instance;
    };
    CompletionRanker.recordMru = function(dbType, connectionId, type, name) {
        CompletionMruManager.getInstance().recordItem(dbType, connectionId, type, name);
    };
    CompletionRanker.clearMruHistory = function() {
        CompletionMruManager.getInstance().clearHistory();
    };
    CompletionRanker.getMruBonus = function(dbType, connectionId, type, name) {
        return CompletionMruManager.getInstance().getMruBonus(dbType, connectionId, type, name);
    };

    window.CompletionMruManager = CompletionMruManager;
    window.CompletionRanker = CompletionRanker;
})(typeof window !== 'undefined' ? window : globalThis);
