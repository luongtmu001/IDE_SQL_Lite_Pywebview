/**
 * completion-engine.js - SQL IntelliSense Completion Engine (Phase 6 & 8)
 * 
 * Implements:
 * - Completion Pipeline: Tokenize -> Statement -> Context -> Scope -> Aliases -> Metadata -> Generate -> Filter -> Rank -> Return (Section 21, 22)
 * - Candidate Sources: Keywords, Scope symbols, Aliases, Tables, Views, Columns, Functions, Procedures, Types, Snippets, CTEs, Variables (Section 23, 39, 40, 46, 47, 51)
 * - Context-Aware Routing: FROM/JOIN (tables, CTEs, temp tables), SELECT/WHERE/ON/ORDER BY (columns, variables), EXEC (procedures, parameters) (Section 24-29, 51)
 * - Multi-Stage Filtering: exact prefix -> prefix -> substring -> fuzzy (Section 31)
 * - Contextual Ranking: CompletionRanker with weighted contextual signals (Section 30)
 * - Request Cancellation: requestId / AbortController concurrency management (Section 33)
 * - Function Signatures & Documentation (Section 51)
 * - Level 3 Memoization: Seamless caching via AppMetadataCache
 */

(function(window) {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────────
    // 0. RESERVED SQL KEYWORDS & BUILT-IN FUNCTION SIGNATURES (Section 51 & 9.2)
    // ─────────────────────────────────────────────────────────────────────────────
    const RESERVED_KEYWORDS = new Set([
        'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER',
        'ON', 'GROUP', 'HAVING', 'ORDER', 'BY', 'UNION', 'ALL', 'INTERSECT', 'EXCEPT',
        'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'TRUNCATE', 'MERGE',
        'CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX', 'PROCEDURE', 'PROC', 'FUNCTION',
        'TRIGGER', 'SCHEMA', 'DATABASE', 'DEFAULT', 'CHECK', 'CONSTRAINT', 'PRIMARY', 'KEY',
        'FOREIGN', 'REFERENCES', 'IDENTITY', 'NULL', 'NOT', 'AND', 'OR', 'AS', 'DISTINCT',
        'TOP', 'LIMIT', 'OFFSET', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'OVER', 'WITH',
        'EXEC', 'EXECUTE', 'USER', 'FILE', 'COLUMN', 'DECLARE', 'ROWCOUNT', 'STATUS',
        'PERCENT', 'TIES', 'OUTPUT', 'APPLY', 'WINDOW', 'QUALIFY', 'PARTITION'
    ]);

    const FUNCTION_SIGNATURES = {
        "ISNULL": {
            signature: "ISNULL(check_expression, replacement_value)",
            documentation: "Replaces NULL with the specified replacement value."
        },
        "COALESCE": {
            signature: "COALESCE(expression1, expression2, ...)",
            documentation: "Evaluates the arguments in order and returns the current value of the first expression that initially doesn't evaluate to NULL."
        },
        "NULLIF": {
            signature: "NULLIF(expression1, expression2)",
            documentation: "Returns a null value if the two specified expressions are equal."
        },
        "DATEADD": {
            signature: "DATEADD(datepart, number, date)",
            documentation: "Returns a specified date with the specified number interval (signed integer) added to a specified datepart of that date."
        },
        "DATEDIFF": {
            signature: "DATEDIFF(datepart, startdate, enddate)",
            documentation: "Returns the count of the specified datepart boundaries crossed between the specified startdate and enddate."
        },
        "DATEPART": {
            signature: "DATEPART(datepart, date)",
            documentation: "Returns an integer that represents the specified datepart of the specified date."
        },
        "DATENAME": {
            signature: "DATENAME(datepart, date)",
            documentation: "Returns a character string that represents the specified datepart of the specified date."
        },
        "GETDATE": {
            signature: "GETDATE()",
            documentation: "Returns the current database system timestamp as a datetime value without the database time zone offset."
        },
        "NOW": {
            signature: "NOW()",
            documentation: "Returns the current date and time."
        },
        "CURRENT_TIMESTAMP": {
            signature: "CURRENT_TIMESTAMP",
            documentation: "Returns the current date and time as a TIMESTAMP value."
        },
        "SUBSTRING": {
            signature: "SUBSTRING(expression, start, length)",
            documentation: "Returns part of a character, binary, text, or image expression."
        },
        "REPLACE": {
            signature: "REPLACE(string_expression, string_pattern, string_replacement)",
            documentation: "Replaces all occurrences of a specified string value with another string value."
        },
        "TRIM": {
            signature: "TRIM([characters FROM ] string)",
            documentation: "Removes the space character OR other specified characters from the start and end of a string."
        },
        "LTRIM": {
            signature: "LTRIM(character_expression)",
            documentation: "Returns a character expression after it removes leading blanks."
        },
        "RTRIM": {
            signature: "RTRIM(character_expression)",
            documentation: "Returns a character expression after it removes trailing blanks."
        },
        "UPPER": {
            signature: "UPPER(character_expression)",
            documentation: "Returns a character expression with lowercase character data converted to uppercase."
        },
        "LOWER": {
            signature: "LOWER(character_expression)",
            documentation: "Returns a character expression with uppercase character data converted to lowercase."
        },
        "LEN": {
            signature: "LEN(string_expression)",
            documentation: "Returns the number of characters of the specified string expression, excluding trailing blanks."
        },
        "LENGTH": {
            signature: "LENGTH(string)",
            documentation: "Returns the length of a string in characters or bytes."
        },
        "CHARINDEX": {
            signature: "CHARINDEX(expressionToFind, expressionToSearch [, start_location])",
            documentation: "Searches an expression for another expression and returns its starting position if found."
        },
        "CAST": {
            signature: "CAST(expression AS data_type)",
            documentation: "Converts an expression of one data type to another."
        },
        "CONVERT": {
            signature: "CONVERT(data_type, expression [, style])",
            documentation: "Converts an expression of one data type to another."
        },
        "COUNT": {
            signature: "COUNT(expression | *)",
            documentation: "Returns the number of items found in a group."
        },
        "SUM": {
            signature: "SUM(expression)",
            documentation: "Returns the sum of all the values, or only the DISTINCT values, in the expression."
        },
        "AVG": {
            signature: "AVG(expression)",
            documentation: "Returns the average of the values in a group. It ignores null values."
        },
        "MIN": {
            signature: "MIN(expression)",
            documentation: "Returns the minimum value in the expression."
        },
        "MAX": {
            signature: "MAX(expression)",
            documentation: "Returns the maximum value in the expression."
        },
        "ROW_NUMBER": {
            signature: "ROW_NUMBER() OVER ([PARTITION BY ...] ORDER BY ...)",
            documentation: "Numbers the output of a result set starting at 1 for the first row in each partition."
        },
        "RANK": {
            signature: "RANK() OVER ([PARTITION BY ...] ORDER BY ...)",
            documentation: "Returns the rank of each row within the partition of a result set."
        },
        "DENSE_RANK": {
            signature: "DENSE_RANK() OVER ([PARTITION BY ...] ORDER BY ...)",
            documentation: "Returns the rank of rows within the partition without any gaps in the ranking."
        },
        "ROUND": {
            signature: "ROUND(numeric_expression, length [, function])",
            documentation: "Returns a numeric value, rounded to the specified length or precision."
        },
        "FLOOR": {
            signature: "FLOOR(numeric_expression)",
            documentation: "Returns the largest integer less than or equal to the specified numeric expression."
        },
        "CEILING": {
            signature: "CEILING(numeric_expression)",
            documentation: "Returns the smallest integer greater than or equal to the specified numeric expression."
        },
        "ABS": {
            signature: "ABS(numeric_expression)",
            documentation: "Returns the absolute (positive) value of the specified numeric expression."
        },
        "IIF": {
            signature: "IIF(boolean_expression, true_value, false_value)",
            documentation: "Returns one of two values, depending on whether the boolean expression evaluates to true or false."
        },
        "CONCAT": {
            signature: "CONCAT(string_value1, string_value2 [, string_valueN])",
            documentation: "Returns a string resulting from the concatenation of two or more string values."
        },
        "STRING_AGG": {
            signature: "STRING_AGG(expression, separator) [WITHIN GROUP (ORDER BY ...)]",
            documentation: "Concatenates the values of string expressions and places separator values between them."
        }
    };

    /**
     * CandidateFilter - Multi-Stage Candidate Filtering (Section 31)
     * Exact Prefix -> Prefix -> Substring -> Fuzzy
     */
    class CandidateFilter {
        constructor(options = {}) {
            this.fuzzyThreshold = options.fuzzyThreshold || 2; // Min chars to activate fuzzy search
            this.maxPrefixToSkipFuzzy = options.maxPrefixToSkipFuzzy || 8; // If prefix matches >= 8, skip fuzzy to avoid noise
        }

        matchExact(candidateName, query) {
            return candidateName.toLowerCase() === query.toLowerCase();
        }

        matchPrefix(candidateName, query) {
            return candidateName.toLowerCase().startsWith(query.toLowerCase());
        }

        matchSubstring(candidateName, query) {
            return candidateName.toLowerCase().includes(query.toLowerCase());
        }

        matchFuzzy(candidateName, query) {
            if (!query) return 100;
            const target = candidateName.toLowerCase();
            const pattern = query.toLowerCase();

            let targetIdx = 0;
            let patternIdx = 0;
            let consecutiveMatches = 0;
            let totalGaps = 0;
            let matchedFirstChar = false;

            while (targetIdx < target.length && patternIdx < pattern.length) {
                if (target[targetIdx] === pattern[patternIdx]) {
                    if (patternIdx === 0 && targetIdx === 0) matchedFirstChar = true;
                    if (targetIdx > 0 && target[targetIdx - 1] === pattern[patternIdx - 1]) {
                        consecutiveMatches++;
                    }
                    patternIdx++;
                } else if (patternIdx > 0) {
                    totalGaps++;
                }
                targetIdx++;
            }

            if (patternIdx < pattern.length) return -1; // Not all pattern chars found

            let score = 40;
            if (matchedFirstChar) score += 20;
            score += Math.min(20, consecutiveMatches * 5);
            score -= Math.min(25, totalGaps * 2);
            return Math.max(10, score);
        }

        filter(candidates, query = '') {
            if (!candidates || !Array.isArray(candidates)) return [];
            const cleanQuery = String(query || '').trim().toLowerCase();

            if (!cleanQuery) {
                return candidates.map(c => ({
                    ...c,
                    _matchType: 'all',
                    _matchScore: 50
                }));
            }

            const prefixMatches = [];
            const substringMatches = [];
            const fuzzyMatches = [];

            candidates.forEach(item => {
                const name = item.name || item.label || '';
                const nameLower = name.toLowerCase();

                // Also check with leading # and @ stripped for friendly prefix matching
                const nameClean = (nameLower.startsWith('#') || nameLower.startsWith('@')) ? nameLower.replace(/^#+|^@+/, '') : nameLower;
                const queryClean = (cleanQuery.startsWith('#') || cleanQuery.startsWith('@')) ? cleanQuery.replace(/^#+|^@+/, '') : cleanQuery;

                // 1. Exact match
                if (nameLower === cleanQuery || (queryClean && nameClean === queryClean)) {
                    prefixMatches.push({
                        ...item,
                        _matchType: 'exact',
                        _matchScore: 100
                    });
                    return;
                }

                // 2. Prefix match
                if (nameLower.startsWith(cleanQuery) || (queryClean && nameClean.startsWith(queryClean))) {
                    const ratio = queryClean ? (queryClean.length / nameClean.length) : (cleanQuery.length / nameLower.length);
                    prefixMatches.push({
                        ...item,
                        _matchType: 'prefix',
                        _matchScore: 80 + Math.round(ratio * 15)
                    });
                    return;
                }

                // 3. Substring match
                const subIdx = nameLower.indexOf(cleanQuery);
                if (subIdx !== -1) {
                    substringMatches.push({
                        ...item,
                        _matchType: 'substring',
                        _matchScore: Math.max(50, 70 - subIdx * 2)
                    });
                    return;
                }

                // 4. Fuzzy match (only if query length >= fuzzyThreshold)
                if (cleanQuery.length >= this.fuzzyThreshold) {
                    const fuzzyScore = this.matchFuzzy(name, cleanQuery);
                    if (fuzzyScore > 0) {
                        fuzzyMatches.push({
                            ...item,
                            _matchType: 'fuzzy',
                            _matchScore: fuzzyScore
                        });
                    }
                }
            });

            if (prefixMatches.length >= this.maxPrefixToSkipFuzzy) {
                return prefixMatches;
            }

            return [...prefixMatches, ...substringMatches, ...fuzzyMatches];
        }
    }

    /**
     * CompletionRanker - Contextual Ranking Engine (Section 30)
     * Weighs context, clause, scope, qualifier, and match quality
     */
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
            const isSelectClause = (context.clause === 'SELECT');
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
                    }
                }

                // 2. FROM / JOIN / INSERT INTO / UPDATE clause priorities (Section 25, 26, 39, Phase 4 DML)
                if ((isFromClause || isDmlTableClause) && !context.qualifier) {
                    if (['table', 'view', 'cte', 'subquery', 'temp_table', 'table_variable', 'synonym', 'pseudo_table'].includes(type)) {
                        contextScore += (type === 'cte' || type === 'pseudo_table') ? 85 : 80;
                    } else if (isFromClause && type === 'keyword' && ['JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'WHERE'].includes(item.name.toUpperCase())) {
                        contextScore += 30;
                    } else if (isDmlTableClause && type === 'keyword') {
                        contextScore -= 40;
                    }
                }

                // 3. SELECT / WHERE / ON / ORDER BY clause priorities (Section 24, 27, 28, 47)
                if ((isSelectClause || isWhereClause || isOrderClause) && !context.qualifier) {
                    if (type === 'scalar_variable') {
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
                    const snipName = (item.name || '').toLowerCase();
                    if (cleanQuery && snipName === cleanQuery) {
                        contextScore += 160; // Exact snippet prefix match -> #1
                    } else if (cleanQuery && snipName.startsWith(cleanQuery)) {
                        contextScore += 130; // Prefix snippet match -> top priority above keywords
                    } else {
                        contextScore += 50;
                    }
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
                    }
                }

                // 5. Qualifier Priority (Section 24, 39, 40, 46)
                if (context.qualifier) {
                    if (type === 'pk_column') {
                        contextScore += 95;
                    } else if (type === 'column') {
                        contextScore += 90;
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

            return unique.slice(0, 150);
        }
    }

    /**
     * CandidateGenerator - Context-Aware Candidate Provider (Section 23-29, 39, 40, 46, 47, 51)
     */
    class CandidateGenerator {
        constructor(dataProvider, metadataCache) {
            this.dataProvider = dataProvider;
            this.metadataCache = metadataCache;
        }

        formatInsertText(name, type, context, tabCtx) {
            if (!name) return "";
            if (['keyword', 'operator', 'snippet', 'scalar_variable', 'table_variable', 'data_type'].includes(type)) {
                return name;
            }
            if (name.startsWith('@') || name.startsWith('#')) {
                return name;
            }

            const dialect = (tabCtx && tabCtx.dbType) || 'mssql';
            const isUserQuoted = Boolean(context && context.isQuotedIdentifier);
            const userQuoteChar = context ? context.quoteChar : '';
            const closeChar = context ? (context.closeQuoteChar || (userQuoteChar === '[' ? ']' : userQuoteChar)) : '';

            // User already typed open quote: format with matching quotes
            if (isUserQuoted && userQuoteChar) {
                const clean = CompletionEngine.cleanIdentifier(name);
                return `${userQuoteChar}${clean}${closeChar}`;
            }

            // Auto-quote if required by dialect/syntax
            if (CompletionEngine.needsQuoting(name, dialect)) {
                return CompletionEngine.quoteIdentifier(name, dialect);
            }

            return name;
        }

        async generate(context, tabCtx, wordLower = '') {
            const allCandidates = [];

            // ─────────────────────────────────────────────────────────────────────────
            // 0. Level 0: Stored Procedure Parameters (EXEC context - Section 29, 51)
            // ─────────────────────────────────────────────────────────────────────────
            if (context.execContext && context.execContext.isExec && context.execContext.procedureName) {
                const procName = context.execContext.procedureName;
                const procSchema = context.execContext.procedureSchema || tabCtx.schema;

                if (tabCtx.connectionId && this.dataProvider && typeof this.dataProvider.fetchParameters === 'function') {
                    const params = await this.dataProvider.fetchParameters(tabCtx.connectionId, tabCtx.database, procSchema, procName, tabCtx.dbType);
                    (params || []).forEach(p => {
                        const pName = p.name.startsWith('@') ? p.name : `@${p.name}`;
                        allCandidates.push({
                            name: pName,
                            label: `${pName} = `,
                            type: 'parameter',
                            kind: 'parameter',
                            level: 1.0,
                            displayType: p.data_type ? `Param (${p.data_type})` : 'Parameter',
                            dataType: p.data_type,
                            direction: p.direction || 'IN',
                            insertText: `${pName} = `
                        });
                    });
                }
            }

            const isStrictAlter = Boolean(context.isAlterContext && context.alterObjectType);
            const isStrictExec = Boolean(context.execContext && context.execContext.isExec && !context.execContext.procedureName);
            const isTableSourceContext = Boolean(context.clause === 'FROM' || context.clause === 'JOIN');
            const shouldLoadStandardKeywords = (!context.qualifier && !isStrictAlter && !isStrictExec);

            if (context.hasFollowUp && context.followUpKeywords && context.followUpKeywords.length > 0) {
                context.followUpKeywords.forEach(kw => {
                    if (!wordLower || kw.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: kw,
                            label: kw,
                            type: 'keyword',
                            kind: 'keyword',
                            level: 1,
                            displayType: 'Keyword',
                            insertText: kw
                        });
                    }
                });

                // If inside routine body or following BEGIN, also load standard SQL statement keywords, functions & snippets
                if ((context.isInRoutineBody || context.previousToken === 'BEGIN') && shouldLoadStandardKeywords) {
                    this._loadStandardKeywordsAndSnippets(allCandidates, tabCtx, wordLower);
                }
            } else if (!context.qualifier && !isStrictAlter && !isStrictExec) {
                if (context.isInsertColumns || context.clause === 'INSERT_COLUMNS') {
                    ['VALUES', 'SELECT', 'DEFAULT'].forEach(kw => {
                        allCandidates.push({
                            name: kw,
                            label: kw,
                            type: 'keyword',
                            kind: 'keyword',
                            level: 1.5,
                            displayType: 'Keyword',
                            insertText: kw
                        });
                    });
                } else {
                    this._loadStandardKeywordsAndSnippets(allCandidates, tabCtx, wordLower);
                }
            }

            // ─────────────────────────────────────────────────────────────────────────
            // 2. Level 2: Local Script Objects (CTEs, Variables, Temp Tables)
            // ─────────────────────────────────────────────────────────────────────────
            if (!context.qualifier && !isStrictAlter) {
                // A. CTEs (Common Table Expressions - Section 39)
                const ctes = (context.activeScope && typeof context.activeScope.getSymbolsByType === 'function')
                    ? context.activeScope.getSymbolsByType('cte')
                    : (context.ctes || []);

                ctes.forEach(cte => {
                    const cteName = cte.name || cte;
                    allCandidates.push({
                        name: cteName,
                        label: cteName,
                        type: 'cte',
                        kind: 'table',
                        level: 1.2,
                        displayType: 'CTE',
                        columns: cte.columns || [],
                        insertText: this.formatInsertText(cteName, 'cte', context, tabCtx)
                    });
                });

                // B. Local temp tables (#temp in SQL Server, temp_tbl in PostgreSQL - Section 46)
                const scopeTemp = (context.activeScope && typeof context.activeScope.getSymbolsByType === 'function')
                    ? context.activeScope.getSymbolsByType('temp_table')
                    : [];
                const tempNameSet = new Set(scopeTemp.map(t => (t.name || t).toLowerCase()));
                const fallbackTemp = (context.localTempTables || [])
                    .filter(t => !tempNameSet.has((t || '').toLowerCase()))
                    .map(t => ({ name: t, columns: [] }));
                const tempTables = [...scopeTemp, ...fallbackTemp];

                tempTables.forEach(tbl => {
                    const tblName = tbl.name || tbl;
                    allCandidates.push({
                        name: tblName,
                        label: tblName,
                        type: 'temp_table',
                        kind: 'table',
                        level: 1.3,
                        displayType: 'Temp Table',
                        columns: tbl.columns || [],
                        insertText: this.formatInsertText(tblName, 'temp_table', context, tabCtx)
                    });
                });

                // C. Local table variables (@table - Section 47)
                const scopeTableVars = (context.activeScope && typeof context.activeScope.getSymbolsByType === 'function')
                    ? context.activeScope.getSymbolsByType('table_variable')
                    : [];
                const tvNameSet = new Set(scopeTableVars.map(v => (v.name || v).toLowerCase()));
                const fallbackTV = (context.localTableVars || [])
                    .filter(v => !tvNameSet.has((v || '').toLowerCase()))
                    .map(v => ({ name: v, columns: [] }));
                const tableVars = [...scopeTableVars, ...fallbackTV];

                tableVars.forEach(v => {
                    const vName = v.name || v;
                    allCandidates.push({
                        name: vName,
                        label: vName,
                        type: 'table_variable',
                        kind: 'variable',
                        level: 1.3,
                        displayType: 'Table Var',
                        insertText: vName
                    });
                });

                // C2. Trigger Pseudo-tables (inserted / deleted in T-SQL, NEW / OLD in PostgreSQL - Spec 8.5)
                const scopePseudos = (context.activeScope && typeof context.activeScope.getSymbolsByType === 'function')
                    ? context.activeScope.getSymbolsByType('pseudo_table')
                    : [];
                scopePseudos.forEach(pt => {
                    allCandidates.push({
                        name: pt.name,
                        label: pt.name,
                        type: 'pseudo_table',
                        kind: 'table',
                        level: 1.1,
                        displayType: pt.displayType || 'Pseudo Table',
                        tableName: pt.targetObject || pt.name,
                        schema: pt.schema || '',
                        columns: pt.columns || [],
                        insertText: pt.name
                    });
                });

                // Phase 3: Query Table Aliases in active scope (e.g. c for Customers)
                if (!context.qualifier && context.queryTables && context.queryTables.length > 0) {
                    context.queryTables.forEach(tbl => {
                        if (tbl.alias) {
                            allCandidates.push({
                                name: tbl.alias,
                                label: tbl.alias,
                                type: 'alias',
                                kind: 'table',
                                level: 1.0,
                                displayType: `Alias (${tbl.table})`,
                                tableName: tbl.table,
                                schema: tbl.schema,
                                insertText: tbl.alias
                            });
                        }
                    });
                }

                // Phase 3: Select-list Aliases (Spec 8.2, 8.3)
                // Available in ORDER BY / GROUP BY; forbidden in WHERE / HAVING
                if ((context.clause === 'ORDER BY' || context.clause === 'GROUP BY') && context.selectAliases && context.selectAliases.length > 0) {
                    context.selectAliases.forEach(sa => {
                        allCandidates.push({
                            name: sa.name,
                            label: sa.name,
                            type: 'select_alias',
                            kind: 'column',
                            level: 1.0,
                            displayType: 'Select Alias',
                            originalExpr: sa.originalExpr || '',
                            insertText: this.formatInsertText(sa.name, 'column', context, tabCtx)
                        });
                    });
                }

                // D. Scalar variables & Parameters (@var in SQL Server, var_name in PostgreSQL)
                const isVarTrigger = (context.currentWord && context.currentWord.startsWith('@')) || context.triggerChar === '@';
                const isInsertCols = Boolean(context.isInsertColumns || context.clause === 'INSERT_COLUMNS');
                const isUpdateSet = Boolean(context.isUpdateSet || (context.clause === 'SET' && !context.isUpdateSetValue));
                const isExprClause = (context.clause === 'SELECT' || isInsertCols || isUpdateSet || !context.clause || ['WHERE', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'SET', 'VALUES', 'EXEC', 'EXECUTE'].includes(context.clause) || context.isInRoutineBody);

                if (isVarTrigger || isExprClause) {
                    const scopeVars = (context.activeScope && typeof context.activeScope.getSymbolsByType === 'function')
                        ? context.activeScope.getSymbolsByType('scalar_variable')
                        : [];
                    const varNameSet = new Set(scopeVars.map(v => (v.name || v).toLowerCase()));
                    const fallbackVars = (context.localVariables || [])
                        .filter(v => !varNameSet.has((v.name || v || '').toLowerCase()));
                    const vars = [...scopeVars, ...fallbackVars];

                    vars.forEach(v => {
                        allCandidates.push({
                            name: v.name,
                            label: v.name,
                            type: 'scalar_variable',
                            kind: 'variable',
                            level: isVarTrigger ? 1.0 : 1.3,
                            displayType: v.dataType ? `Variable (${v.dataType})` : 'Variable',
                            dataType: v.dataType || '',
                            insertText: v.name
                        });
                    });
                }

                // E. Columns of tables participating in current query (SELECT/WHERE/INSERT/UPDATE clauses)
                if (tabCtx.connectionId && context.queryTables && context.queryTables.length > 0) {
                    if (isExprClause) {
                        const alreadySet = new Set((context.alreadyListed || []).map(s => s.toLowerCase()));

                        for (const tbl of context.queryTables) {
                            const targetSchema = tbl.schema || tabCtx.schema;
                            // Only query database for physical tables, views, synonyms
                            if (!['subquery', 'cte', 'temp_table', 'table_variable'].includes(tbl.type)) {
                                const cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, targetSchema, tbl.table);
                                (cols || []).forEach(c => {
                                    const colName = c.name;
                                    const colLower = (colName || '').toLowerCase();

                                    // 1. Filter already listed columns in INSERT column list or UPDATE SET list
                                    if ((isInsertCols || isUpdateSet) && alreadySet.has(colLower)) {
                                        return;
                                    }

                                    // 2. Filter non-insertable columns in INSERT column list (Spec Section 7.2)
                                    // T-SQL: identity, computed, rowversion. PG: generated always / identity.
                                    if (isInsertCols) {
                                        const isNonInsertable = Boolean(
                                            c.is_identity || 
                                            c.is_computed || 
                                            c.generated || 
                                            c.is_generated ||
                                            (c.data_type && ['rowversion', 'timestamp'].includes(c.data_type.toLowerCase()))
                                        );
                                        if (isNonInsertable) {
                                            return;
                                        }
                                    }

                                    allCandidates.push({
                                        name: c.name,
                                        label: c.name,
                                        type: c.is_pk ? 'pk_column' : 'column',
                                        kind: 'column',
                                        level: isInsertCols ? 0.9 : 1.1,
                                        displayType: 'Column',
                                        dataType: c.data_type,
                                        isNullable: c.is_nullable,
                                        isPk: c.is_pk,
                                        isIdentity: c.is_identity,
                                        isComputed: c.is_computed,
                                        schema: targetSchema,
                                        tableName: tbl.table,
                                        tableAlias: tbl.alias,
                                        insertText: this.formatInsertText(c.name, 'column', context, tabCtx)
                                    });
                                });
                            } else if (Array.isArray(tbl.columns)) {
                                tbl.columns.forEach(c => {
                                    const colName = c.name || c;
                                    const colLower = (colName || '').toLowerCase();

                                    if ((isInsertCols || isUpdateSet) && alreadySet.has(colLower)) {
                                        return;
                                    }

                                    allCandidates.push({
                                        name: colName,
                                        label: colName,
                                        type: c.is_pk ? 'pk_column' : 'column',
                                        kind: 'column',
                                        level: isInsertCols ? 0.9 : 1.1,
                                        displayType: 'Column',
                                        dataType: c.data_type || '',
                                        tableName: tbl.table,
                                        tableAlias: tbl.alias,
                                        insertText: this.formatInsertText(colName, 'column', context, tabCtx)
                                    });
                                });
                            }
                        }
                    }
                }

                // F. Data Types
                if (this.dataProvider && typeof this.dataProvider.fetchDataTypes === 'function') {
                    const dtData = await this.dataProvider.fetchDataTypes(tabCtx.connectionId, tabCtx.database);
                    if (dtData && dtData.types) {
                        dtData.types.forEach(dt => {
                            allCandidates.push({
                                name: dt.toUpperCase(),
                                label: dt.toUpperCase(),
                                type: 'data_type',
                                kind: 'type',
                                level: 1.8,
                                displayType: 'Data Type',
                                insertText: dt.toUpperCase()
                            });
                        });
                    }
                }
            }

            // ─────────────────────────────────────────────────────────────────────────
            // 3. Level 3: Database Metadata Objects & Columns (Qualified Resolution)
            // ─────────────────────────────────────────────────────────────────────────
            if (context.qualifier) {
                const qualLower = context.qualifier.toLowerCase();
                let targetTable = null;
                let targetSchema = tabCtx.schema;

                if (context.resolvedObject && context.resolvedObject.object) {
                    targetTable = context.resolvedObject.object;
                    if (context.resolvedObject.schema) targetSchema = context.resolvedObject.schema;
                } else if (context.aliasMap && context.aliasMap[qualLower]) {
                    const mapped = context.aliasMap[qualLower];
                    targetTable = mapped.table || mapped.object;
                    if (mapped.schema) targetSchema = mapped.schema;
                } else {
                    targetTable = context.qualifier;
                }

                const isLocalSymbol = Boolean(context.resolvedObject && ['subquery', 'cte', 'temp_table', 'table_variable', 'pseudo_table'].includes(context.resolvedObject.type));

                // A. Columns from database connection (Only for physical tables/views)
                if (tabCtx.connectionId && targetTable && !isLocalSymbol) {
                    const cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, targetSchema, targetTable);
                    (cols || []).forEach(c => {
                        allCandidates.push({
                            name: c.name,
                            label: c.name,
                            type: c.is_pk ? 'pk_column' : 'column',
                            kind: 'column',
                            level: 2,
                            displayType: 'Column',
                            dataType: c.data_type,
                            isNullable: c.is_nullable,
                            isPk: c.is_pk,
                            schema: targetSchema,
                            tableName: targetTable,
                            insertText: this.formatInsertText(c.name, 'column', context, tabCtx)
                        });
                    });
                }

                // A2. Pseudo-table columns (NEW / OLD in PostgreSQL, inserted / deleted in SQL Server)
                if (context.resolvedObject && context.resolvedObject.type === 'pseudo_table') {
                    const isPseudoName = (name) => ['new', 'old', 'inserted', 'deleted'].includes(String(name || '').toLowerCase());
                    let trgTable = (context.resolvedObject.targetObject && !isPseudoName(context.resolvedObject.targetObject)) ? context.resolvedObject.targetObject : '';
                    let trgSchema = context.resolvedObject.schema || tabCtx.schema;

                    if (!trgTable && context.triggerTable && context.triggerTable.table && !isPseudoName(context.triggerTable.table)) {
                        trgTable = context.triggerTable.table;
                        if (context.triggerTable.schema) trgSchema = context.triggerTable.schema;
                    }

                    if (!trgTable && context.queryTables && context.queryTables.length > 0) {
                        const nonPseudo = context.queryTables.find(t => t.type !== 'pseudo_table' && !isPseudoName(t.table));
                        if (nonPseudo) {
                            trgTable = nonPseudo.table;
                            if (nonPseudo.schema) trgSchema = nonPseudo.schema;
                        }
                    }

                    if (trgTable && tabCtx.connectionId && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                        const cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, trgSchema, trgTable);
                        (cols || []).forEach(c => {
                            allCandidates.push({
                                name: c.name,
                                label: c.name,
                                type: c.is_pk ? 'pk_column' : 'column',
                                kind: 'column',
                                level: 1.0,
                                displayType: 'Column',
                                dataType: c.data_type,
                                isNullable: c.is_nullable,
                                isPk: c.is_pk,
                                schema: trgSchema,
                                tableName: trgTable,
                                insertText: this.formatInsertText(c.name, 'column', context, tabCtx)
                            });
                        });
                    } else if (!trgTable && tabCtx.connectionId && this.dataProvider && typeof this.dataProvider.fetchObjects === 'function') {
                        // Fallback: If trigger table is unknown, try matching table from routine name or fetch schema tables
                        const dbObjs = await this.dataProvider.fetchObjects(tabCtx.connectionId, tabCtx.database, tabCtx.schema);
                        const tables = (dbObjs || []).filter(o => o.type === 'table');
                        const rName = (context.routineName || '').toLowerCase().replace(/^trg_|^check_|_trigger$|_trg$/, '');
                        const rParts = rName.split('_').filter(p => p.length >= 3);
                        const matched = tables.find(t => {
                            const tLower = (t.name || '').toLowerCase();
                            if (rName && (rName.includes(tLower) || tLower.includes(rName))) return true;
                            return rParts.some(p => tLower.includes(p) || p.includes(tLower));
                        }) || (tables.length === 1 ? tables[0] : null);

                        const targetTables = matched ? [matched] : (tables.length <= 5 ? tables : []);
                        for (const tbl of targetTables) {
                            if (typeof this.dataProvider.fetchColumns === 'function') {
                                const cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, tbl.schema || tabCtx.schema, tbl.name);
                                (cols || []).forEach(c => {
                                    allCandidates.push({
                                        name: c.name,
                                        label: c.name,
                                        type: c.is_pk ? 'pk_column' : 'column',
                                        kind: 'column',
                                        level: 1.0,
                                        displayType: matched ? 'Column' : `Column (${tbl.name})`,
                                        dataType: c.data_type,
                                        isNullable: c.is_nullable,
                                        isPk: c.is_pk,
                                        schema: tbl.schema || tabCtx.schema,
                                        tableName: tbl.name,
                                        insertText: this.formatInsertText(c.name, 'column', context, tabCtx)
                                    });
                                });
                            }
                        }
                    }
                }

                // B. Columns discovered from local query scope (Subquery / CTE / Temp table / Table var projections - Section 39, 40, 46, 47)
                if (context.resolvedObject && Array.isArray(context.resolvedObject.columns)) {
                    context.resolvedObject.columns.forEach(col => {
                        const cName = col.name || col;
                        allCandidates.push({
                            name: cName,
                            label: cName,
                            type: col.is_pk ? 'pk_column' : 'column',
                            kind: 'column',
                            level: 1.1,
                            displayType: 'Column',
                            dataType: col.data_type || '',
                            isNullable: col.is_nullable !== false,
                            isPk: Boolean(col.is_pk),
                            schema: targetSchema || '',
                            tableName: targetTable || context.qualifier,
                            insertText: this.formatInsertText(cName, 'column', context, tabCtx)
                        });
                    });
                }

                // C. If qualifier is schema (e.g. dbo.), fetch objects in that schema
                const isKnownAlias = Boolean(context.resolvedObject && context.resolvedObject.isAlias);
                if (tabCtx.connectionId && !isKnownAlias && !isLocalSymbol && this.dataProvider && typeof this.dataProvider.fetchObjects === 'function') {
                    const dbObjects = await this.dataProvider.fetchObjects(tabCtx.connectionId, tabCtx.database, context.qualifier);
                    (dbObjects || []).forEach(obj => {
                        allCandidates.push({
                            name: obj.name,
                            label: obj.name,
                            type: obj.type,
                            kind: obj.type,
                            level: 2,
                            displayType: this._formatDisplayType(obj.type),
                            schema: obj.schema,
                            targetObject: obj.target_object,
                            insertText: this.formatInsertText(obj.name, obj.type, context, tabCtx)
                        });
                    });
                }
            } else if (tabCtx.connectionId && this.dataProvider && typeof this.dataProvider.fetchObjects === 'function') {
                // No qualifier: Fetch database objects for active schema
                const dbObjects = await this.dataProvider.fetchObjects(tabCtx.connectionId, tabCtx.database, tabCtx.schema);
                (dbObjects || []).forEach(obj => {
                    // SQL Prompt-style keyword filtering
                    if (isStrictAlter) {
                        if (obj.type !== context.alterObjectType) return;
                    } else if (isStrictExec) {
                        if (obj.type !== 'procedure') return;
                    } else if (context.isInsertColumns || context.clause === 'INSERT_COLUMNS') {
                        return;
                    } else if (context.clause === 'FROM' || context.clause === 'JOIN' || context.clause === 'INSERT INTO' || context.clause === 'UPDATE') {
                        if (!['table', 'view', 'temp_table', 'table_variable', 'synonym'].includes(obj.type)) return;
                    }

                    const hasAlias = context.queryTables && context.queryTables.some(
                        qt => (qt.table || '').toLowerCase() === (obj.name || '').toLowerCase() && qt.alias
                    );

                    allCandidates.push({
                        name: obj.name,
                        label: obj.name,
                        type: obj.type,
                        kind: obj.type,
                        level: 2,
                        displayType: this._formatDisplayType(obj.type),
                        schema: obj.schema,
                        targetObject: obj.target_object,
                        isMaskedByAlias: Boolean(hasAlias),
                        insertText: this.formatInsertText(obj.name, obj.type, context, tabCtx)
                    });
                });
            }

            return allCandidates;
        }

        _formatDisplayType(type) {
            if (!type) return 'Object';
            return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }

        _loadStandardKeywordsAndSnippets(allCandidates, tabCtx, wordLower) {
            const dialect = (window.SqlDialectFactory)
                ? window.SqlDialectFactory.getDialect(tabCtx.dbType)
                : null;

            const keywordsToUse = dialect
                ? dialect.getKeywords()
                : ((window.SqlContextAnalyzer && window.SqlContextAnalyzer.getKeywordsForDbType)
                    ? window.SqlContextAnalyzer.getKeywordsForDbType(tabCtx.dbType)
                    : (window.SqlContextAnalyzer ? window.SqlContextAnalyzer.SQL_KEYWORDS : []));

            keywordsToUse.forEach(kw => {
                allCandidates.push({
                    name: kw,
                    label: kw,
                    type: 'keyword',
                    kind: 'keyword',
                    level: 1,
                    displayType: 'Keyword',
                    insertText: kw
                });
            });

            // Built-in SQL functions with signatures & documentation (Section 51)
            const functionsToUse = dialect
                ? dialect.getFunctions()
                : (window.SqlContextAnalyzer ? window.SqlContextAnalyzer.SQL_FUNCTIONS : []);

            functionsToUse.forEach(fn => {
                const fnUpper = fn.toUpperCase();
                const sigInfo = FUNCTION_SIGNATURES[fnUpper] || null;
                allCandidates.push({
                    name: fn,
                    label: fn,
                    type: 'sql_function',
                    kind: 'function',
                    level: 1.2,
                    displayType: 'Function',
                    signature: sigInfo ? sigInfo.signature : `${fn}()`,
                    detail: sigInfo ? sigInfo.signature : `${fn}()`,
                    documentation: sigInfo ? sigInfo.documentation : '',
                    insertText: `${fn}()`
                });
            });

            // Snippets
            if (window.AppSnippets && typeof window.AppSnippets.getSnippets === 'function') {
                const allSnips = window.AppSnippets.getSnippets();
                allSnips.forEach(snip => {
                    allCandidates.push({
                        name: snip.prefix,
                        label: snip.prefix,
                        type: 'snippet',
                        kind: 'snippet',
                        level: 1.5,
                        displayType: 'Snippet',
                        description: snip.description || '',
                        snippetData: snip,
                        insertText: snip.body || snip.prefix
                    });
                });
            }
        }
    }

    /**
     * CompletionEngine - Primary Completion Service (Section 21, 22)
     */
    class CompletionEngine {
        constructor(dataProvider, metadataCache) {
            this.dataProvider = dataProvider || (window.AppIntelliSense ? window.AppIntelliSense.getDataProvider() : null);
            this.metadataCache = metadataCache || window.AppMetadataCache || null;
            this.generator = new CandidateGenerator(this.dataProvider, this.metadataCache);
            this.filter = new CandidateFilter();
            this.ranker = new CompletionRanker();
            this._currentRequestId = 0;
        }

        setDataProvider(provider) {
            this.dataProvider = provider;
            this.generator.dataProvider = provider;
        }

        setMetadataCache(cache) {
            this.metadataCache = cache;
            this.generator.metadataCache = cache;
        }

        cancelPending() {
            this._currentRequestId++;
        }

        static cleanIdentifier(name) {
            if (!name) return "";
            name = name.trim();
            if (name.length === 0) return "";

            if (name.startsWith('[')) {
                if (name.endsWith(']')) {
                    return name.substring(1, name.length - 1).replace(/\]\]/g, ']');
                }
                return name.substring(1).replace(/\]\]/g, ']');
            }

            if (name.startsWith('"')) {
                if (name.endsWith('"') && name.length >= 2) {
                    return name.substring(1, name.length - 1).replace(/""/g, '"');
                }
                return name.substring(1).replace(/""/g, '"');
            }

            if (name.startsWith('`')) {
                if (name.endsWith('`') && name.length >= 2) {
                    return name.substring(1, name.length - 1).replace(/``/g, '`');
                }
                return name.substring(1).replace(/``/g, '`');
            }

            return name;
        }

        static needsQuoting(name, dialect = 'mssql') {
            if (!name) return false;
            const clean = name.trim();
            if (clean.length === 0) return false;

            if ((clean.startsWith('[') && clean.endsWith(']')) ||
                (clean.startsWith('"') && clean.endsWith('"')) ||
                (clean.startsWith('`') && clean.endsWith('`'))) {
                return false;
            }

            const isPg = (dialect === 'postgres' || dialect === 'postgresql' || dialect === 'pg');

            // PostgreSQL: unquoted identifiers fold to lowercase; any uppercase requires quoting
            if (isPg && /[A-Z]/.test(clean)) {
                return true;
            }

            // Starts with digit
            if (/^\d/.test(clean)) {
                return true;
            }

            // Non-standard characters or whitespace
            if (/[^a-zA-Z0-9_@$#]/.test(clean)) {
                return true;
            }

            // Reserved SQL keyword
            if (RESERVED_KEYWORDS.has(clean.toUpperCase())) {
                return true;
            }

            return false;
        }

        static quoteIdentifier(name, dialect = 'mssql') {
            if (!name) return "";
            const clean = name.trim();
            if ((clean.startsWith('[') && clean.endsWith(']')) ||
                (clean.startsWith('"') && clean.endsWith('"')) ||
                (clean.startsWith('`') && clean.endsWith('`'))) {
                return clean;
            }

            const isPg = (dialect === 'postgres' || dialect === 'postgresql' || dialect === 'pg');
            const isMysql = (dialect === 'mysql' || dialect === 'mariadb');

            if (isPg) {
                return `"${clean.replace(/"/g, '""')}"`;
            } else if (isMysql) {
                return `\`${clean.replace(/`/g, '``')}\``;
            } else {
                return `[${clean.replace(/\]/g, ']]')}]`;
            }
        }

        static getFunctionSignature(name) {
            if (!name) return null;
            const upper = name.toUpperCase().trim();
            return FUNCTION_SIGNATURES[upper] || null;
        }

        getFunctionSignature(name) {
            return CompletionEngine.getFunctionSignature(name);
        }

        async getCompletions(documentText, cursor, context, tabCtx) {
            const requestId = ++this._currentRequestId;
            const wordLower = (context.currentWord || '').toLowerCase();
            const alterPart = context.isAlterContext ? `ALTER_${context.alterObjectType || ''}` : '';
            const execPart = (context.execContext && context.execContext.isExec) ? 'EXEC' : '';
            const tablesKey = (context.queryTables || []).map(t => (t.table || '').toLowerCase()).sort().join(',');
            const stmtKey = context.statementRange ? `${context.statementRange.start}-${context.statementRange.end}` : '';
            const scopeKey = `${context.clause || 'DEFAULT'}::${tablesKey}::${stmtKey}::${context.qualifier || ''}::${alterPart}::${execPart}::${context.resolvedObject ? context.resolvedObject.name : ''}`;

            // Level 3 Completion Memoization lookup
            if (this.metadataCache && typeof this.metadataCache.getCompletions === 'function') {
                const cached = this.metadataCache.getCompletions(tabCtx.connectionId, tabCtx.database, tabCtx.schema, scopeKey, wordLower);
                if (cached && Array.isArray(cached) && cached.length > 0) {
                    return cached;
                }
            }

            // Step 1: Generate Raw Candidates
            const rawCandidates = await this.generator.generate(context, tabCtx, wordLower);

            // Concurrency check
            if (requestId !== this._currentRequestId) {
                return null;
            }

            // Step 2: Multi-Stage Filtering (Exact -> Prefix -> Substring -> Fuzzy)
            const filtered = this.filter.filter(rawCandidates, wordLower);

            // Step 3: Contextual Ranking (Clause, Scope, Match Quality, Types)
            const ranked = this.ranker.rank(filtered, context, wordLower);
            if (ranked && Array.isArray(ranked)) {
                ranked.rawCandidates = rawCandidates;
                ranked.replacementRange = context.replacementRange || null;
                ranked.prefixRange = context.prefixRange || null;
            }

            // Step 4: Level 3 Memoization Store
            if (this.metadataCache && typeof this.metadataCache.setCompletions === 'function' && ranked.length > 0) {
                this.metadataCache.setCompletions(tabCtx.connectionId, tabCtx.database, tabCtx.schema, scopeKey, wordLower, ranked);
            }

            return ranked;
        }
    }

    // Export singleton instance, signatures, and classes
    const defaultEngine = new CompletionEngine();
    window.SqlFunctionSignatures = FUNCTION_SIGNATURES;
    window.CandidateFilter = CandidateFilter;
    window.CompletionRanker = CompletionRanker;
    window.CandidateGenerator = CandidateGenerator;
    window.CompletionEngine = CompletionEngine;
    window.DefaultCompletionEngine = defaultEngine;

})(typeof window !== 'undefined' ? window : globalThis);

