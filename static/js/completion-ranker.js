/**
 * completion-ranker.js - Contextual IntelliSense Candidate Ranker
 */
(function(window) {
    'use strict';

    class CompletionRanker {
        rank(items, context = {}, query = '') {
            if (!items || !Array.isArray(items)) return [];
            const cleanQuery = String(query || '').trim().toLowerCase();

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
            const unique = [];

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
            const isDmlTableClause = (context.clause === 'INSERT INTO' || context.clause === 'UPDATE' || context.contextType === 'table');
            const isSelectClause = (context.clause === 'SELECT' || context.clause === 'RETURNING' || context.clause === 'OUTPUT');
            const isWhereClause = (context.clause === 'WHERE' || context.clause === 'ON' || context.clause === 'HAVING');
            const isOrderClause = (context.clause === 'ORDER BY' || context.clause === 'GROUP BY');
            const isExecClause = (context.clause === 'EXEC' || context.clause === 'EXECUTE');
            const isVarTrigger = (context.currentWord && context.currentWord.startsWith('@')) || context.triggerChar === '@';

            // Calculate contextual rank score for each item
            unique.forEach(item => {
                let contextScore = 0;
                const type = item.type || item.kind || '';

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
                    } else if (isFromClause && type === 'keyword' && ['JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'WHERE'].includes(item.name.toUpperCase())) {
                        contextScore += 30;
                    } else if (isDmlTableClause && type === 'keyword') {
                        contextScore -= 40;
                    }
                }

                // 3. SELECT / WHERE / ON / ORDER BY clause priorities (Section 24, 27, 28, 47)
                if ((isSelectClause || isWhereClause || isOrderClause) && !context.qualifier) {
                    if (type === 'star_expansion') {
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
                    } else if (['database', 'remote_database', 'schema', 'remote_schema', 'remote_table', 'remote_view'].includes(type)) {
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

                item._finalScore = (matchScore * 2) + contextScore + levelScore;
            });

            // Sort descending by finalScore, then ascending by name
            unique.sort((a, b) => {
                if (b._finalScore !== a._finalScore) {
                    return b._finalScore - a._finalScore;
                }
                if (cleanQuery) {
                    const aExact = (a.name || '').toLowerCase() === cleanQuery;
                    const bExact = (b.name || '').toLowerCase() === cleanQuery;
                    if (aExact && !bExact) return -1;
                    if (!aExact && bExact) return 1;
                }
                return (a.name || '').localeCompare(b.name || '');
            });

            // Issue I8: Ceiling limit for candidate list
            // If qualifier resolves to a specific object/alias (e.g. column list of a table), raise limit to 1000 (wide tables)
            // Keep 150 for general unqualified lists or schema object lists
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
            const sliced = unique.slice(0, maxLimit);
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

    window.CompletionRanker = CompletionRanker;
})(typeof window !== 'undefined' ? window : globalThis);
