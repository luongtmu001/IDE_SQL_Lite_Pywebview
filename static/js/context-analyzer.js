// SQL Context Analyzer for Web IDE IntelliSense
// High-accuracy lexical and syntactic analyzer using SqlTokenizer
// Compliant with Section 10, 11, and 64 of intellisense_improvement_plan_v2.md

(function (window) {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. STANDARDIZED CONTEXT TYPES (Section 11)
    // ─────────────────────────────────────────────────────────────────────────────
    const IntelliSenseContextType = {
        KEYWORD: "keyword",
        DATABASE: "database",
        SCHEMA: "schema",
        TABLE: "table",
        VIEW: "view",
        COLUMN: "column",
        ALIAS: "alias",
        FUNCTION: "function",
        PROCEDURE: "procedure",
        TRIGGER: "trigger",
        SYNONYM: "synonym",
        PARAMETER: "parameter",
        JOIN_COLUMN: "join_column",
        ORDER_COLUMN: "order_column",
        GROUP_COLUMN: "group_column",
        ALTER_OBJECT: "alter_object",
        DATA_TYPE: "data_type",
        UNKNOWN: "unknown"
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. DIALECT KEYWORDS & BUILT-INS
    // ─────────────────────────────────────────────────────────────────────────────
    const COMMON_SQL_KEYWORDS = [
        "SELECT", "FROM", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS",
        "ON", "GROUP", "ORDER", "BY", "HAVING", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
        "DELETE", "TRUNCATE", "CREATE", "ALTER", "DROP", "TABLE", "VIEW", "INDEX",
        "PRIMARY", "FOREIGN", "KEY", "REFERENCES", "CHECK", "DEFAULT", "UNIQUE", "CONSTRAINT",
        "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "IS", "NULL", "UNION", "ALL",
        "INTERSECT", "EXCEPT", "AS", "DISTINCT", "CASE", "WHEN", "THEN", "ELSE", "END",
        "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION", "WITH", "OVER", "PARTITION",
        "ASC", "DESC", "TRUE", "FALSE"
    ];

    const MSSQL_KEYWORDS = [
        "TOP", "PRINT", "PROCEDURE", "PROC", "FUNCTION", "TRIGGER", "SYNONYM", "DATABASE", "SCHEMA",
        "DECLARE", "EXEC", "EXECUTE", "USE", "GO", "APPLY", "OUTER", "CROSS APPLY", "OUTER APPLY",
        "NOLOCK", "READPAST", "HOLDLOCK", "TABLOCK", "IDENTITY", "OUTPUT", "INSERTED", "DELETED",
        "TRY", "CATCH", "RAISERROR", "THROW", "MERGE", "MATCHED", "RECOMPILE", "ROWCOUNT",
        "NONCLUSTERED", "CLUSTERED", "FILLFACTOR", "PAD_INDEX", "STATISTICS_NORECOMPUTE"
    ];

    const POSTGRES_KEYWORDS = [
        "LIMIT", "OFFSET", "ILIKE", "SIMILAR", "RETURNING", "PROCEDURE", "FUNCTION", "TRIGGER",
        "SCHEMA", "DATABASE", "DO", "LANGUAGE", "PLPGSQL", "PERFORM", "VACUUM", "ANALYZE",
        "EXPLAIN", "CONFLICT", "NOTHING", "CASCADE", "RESTRICT", "FOREACH", "LOOP", "RECORD",
        "RAISE", "NOTICE", "EXCEPTION", "RETURNS", "SETOF", "GENERATE_SERIES", "LATERAL",
        "INHERITS", "TABLESPACE", "UNLOGGED", "ELSIF", "ELSEIF", "WHILE", "EXIT", "CONTINUE",
        "CONSTANT", "STRICT", "SQLSTATE", "FOUND", "GET", "DIAGNOSTICS", "STACKED", "ROW_COUNT",
        "ASSERT", "IMMUTABLE", "STABLE", "VOLATILE", "SECURITY", "DEFINER", "INVOKER", "PARALLEL",
        "COST", "ROWS", "RECURSIVE"
    ];

    const SQLITE_KEYWORDS = [
        "LIMIT", "OFFSET", "PRAGMA", "VACUUM", "ATTACH", "DETACH", "EXPLAIN", "AUTOINCREMENT",
        "GLOB", "COLLATE", "NOCASE", "CONFLICT", "IGNORE", "REPLACE", "INDEXED", "ROWID"
    ];

    function getKeywordsForDbType(dbType) {
        const type = (dbType || '').toLowerCase();
        let specific = [];
        if (type === 'postgresql' || type === 'postgres') {
            specific = POSTGRES_KEYWORDS;
        } else if (type === 'sqlserver' || type === 'mssql') {
            specific = MSSQL_KEYWORDS;
        } else if (type === 'sqlite') {
            specific = SQLITE_KEYWORDS;
        } else {
            specific = [...new Set([...MSSQL_KEYWORDS, ...POSTGRES_KEYWORDS, ...SQLITE_KEYWORDS])];
        }
        return [...new Set([...COMMON_SQL_KEYWORDS, ...specific])];
    }

    const SQL_KEYWORDS = getKeywordsForDbType();

    const SQL_FUNCTIONS = [
        "COUNT", "SUM", "AVG", "MIN", "MAX", "LEN", "LENGTH", "SUBSTRING", "REPLACE",
        "TRIM", "LTRIM", "RTRIM", "UPPER", "LOWER", "CHARINDEX", "PATINDEX", "GETDATE",
        "NOW", "CURRENT_TIMESTAMP", "DATEADD", "DATEDIFF", "ISNULL", "COALESCE",
        "NULLIF", "CAST", "CONVERT", "ROW_NUMBER", "RANK", "DENSE_RANK", "NTILE",
        "LEAD", "LAG", "IIF", "FORMAT"
    ];

    const SQL_DATA_TYPES = [
        "BIGINT", "BINARY", "BIT", "BOOLEAN", "BYTEA", "CHAR", "DATE", "DATETIME",
        "DATETIME2", "DATETIMEOFFSET", "DECIMAL", "DOUBLE PRECISION", "FLOAT", "IMAGE",
        "INT", "INTEGER", "JSON", "JSONB", "MONEY", "NCHAR", "NTEXT", "NUMERIC",
        "NVARCHAR", "REAL", "SERIAL", "BIGSERIAL", "SMALLDATETIME", "SMALLINT",
        "SMALLMONEY", "SMALLSERIAL", "TEXT", "TIME", "TIMESTAMP", "TIMESTAMPTZ",
        "TINYINT", "UNIQUEIDENTIFIER", "UUID", "VARBINARY", "VARCHAR", "XML"
    ];

    const FOLLOW_UP_KEYWORDS = {
        "ALTER": [
            "TABLE", "VIEW", "PROCEDURE", "FUNCTION", "TRIGGER",
            "COLUMN", "DATABASE", "SCHEMA", "INDEX"
        ],
        "CREATE": [
            "TABLE", "VIEW", "PROCEDURE", "FUNCTION", "TRIGGER",
            "INDEX", "DATABASE", "SCHEMA", "OR"
        ],
        "CREATE OR": [
            "ALTER", "REPLACE"
        ],
        "CREATE OR ALTER": [
            "PROCEDURE", "FUNCTION", "TRIGGER", "VIEW"
        ],
        "CREATE OR REPLACE": [
            "PROCEDURE", "FUNCTION", "TRIGGER", "VIEW"
        ],
        "DROP": [
            "TABLE", "VIEW", "PROCEDURE", "FUNCTION", "TRIGGER",
            "INDEX", "DATABASE", "SCHEMA"
        ],
        "GROUP": ["BY"],
        "ORDER": ["BY"],
        "INSERT": ["INTO"],
        "DELETE": ["FROM"],
        "TRUNCATE": ["TABLE"],
        "INNER": ["JOIN"],
        "LEFT": ["JOIN", "OUTER"],
        "RIGHT": ["JOIN", "OUTER"],
        "FULL": ["JOIN", "OUTER"],
        "CROSS": ["JOIN", "APPLY"],
        "OUTER": ["JOIN", "APPLY"],
        "UNION": ["ALL"],
        "PRIMARY": ["KEY"],
        "FOREIGN": ["KEY"],
        "PARTITION": ["BY"],
        "BEGIN": ["TRANSACTION", "TRY", "CATCH"],
        "COMMIT": ["TRANSACTION"],
        "ROLLBACK": ["TRANSACTION"]
    };

    function cleanIdentifier(name) {
        if (!name) return "";
        name = name.trim();
        if (name.length === 0) return "";

        // Bracketed [ ... ] or unclosed [ ...
        if (name.startsWith('[')) {
            if (name.endsWith(']')) {
                return name.substring(1, name.length - 1).replace(/\]\]/g, ']');
            }
            return name.substring(1).replace(/\]\]/g, ']');
        }

        // Double-quoted " ... " or unclosed " ...
        if (name.startsWith('"')) {
            if (name.endsWith('"') && name.length >= 2) {
                return name.substring(1, name.length - 1).replace(/""/g, '"');
            }
            return name.substring(1).replace(/""/g, '"');
        }

        // Backticked ` ... ` or unclosed ` ...
        if (name.startsWith('`')) {
            if (name.endsWith('`') && name.length >= 2) {
                return name.substring(1, name.length - 1).replace(/``/g, '`');
            }
            return name.substring(1).replace(/``/g, '`');
        }

        return name;
    }

    function getTokenizer() {
        if (window.DefaultSqlTokenizer) return window.DefaultSqlTokenizer;
        if (window.SqlTokenizer) return new window.SqlTokenizer();
        return null;
    }

    // Memoization variables for analyze & statement boundaries (Issue I1)
    let _lastFullSql = null;
    let _lastFullTokens = null;
    let _lastFullCodeTokens = null;
    let _lastSortedBoundaries = null;

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. STATEMENT BOUNDARY DETECTOR
    // ─────────────────────────────────────────────────────────────────────────────
    // 3. STATEMENT BOUNDARY DETECTOR (Spec Section 5.1 & T-SQL Semicolon-less Statements)
    // ─────────────────────────────────────────────────────────────────────────────
    function detectStatementBoundary(fullSql, cursorIndex, optionalTokens = null) {
        if (!fullSql) return { start: 0, end: 0, text: "" };
        const tokenizer = getTokenizer();
        if (!tokenizer && !optionalTokens) {
            return { start: 0, end: fullSql.length, text: fullSql };
        }

        let sortedBoundaries = null;
        if (fullSql === _lastFullSql && _lastSortedBoundaries) {
            sortedBoundaries = _lastSortedBoundaries;
        } else {
            const allTokens = optionalTokens || (tokenizer ? tokenizer.tokenize(fullSql) : []);
            const codeTokens = [];
            for (let i = 0; i < allTokens.length; i++) {
                const t = allTokens[i];
                if (t.type !== 'WHITESPACE' && t.type !== 'COMMENT_LINE' && t.type !== 'COMMENT_BLOCK') {
                    codeTokens.push(t);
                }
            }

        const boundaries = [0];
        let parenDepth = 0;
        let stmtStarter = null;
        let seenFromOrValues = false;
        let inFromClause = false;

        const CONTINUATION_BEFORE_SELECT = new Set([
            'UNION', 'INTERSECT', 'EXCEPT', 'ALL', 'AS', 'INTO', 'RETURN', 'IF', 'ELSE', 'VIEW', 'OPENQUERY', 'OPENROWSET'
        ]);

        const CLAUSE_CONTINUATION_KEYWORDS = new Set([
            'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER',
            'ON', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'INTERSECT', 'EXCEPT',
            'FOR', 'OPTION', 'AS', 'AND', 'OR', 'SET', 'VALUES', 'INTO', 'OUTPUT',
            'WHEN', 'THEN', 'ELSE', 'END', 'OVER', 'WITH', 'APPLY', 'LIMIT', 'OFFSET',
            'TOP', 'TABLE', 'BY', 'WINDOW', 'QUALIFY', 'PARTITION', 'CASCADE', 'COLLATE',
            'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'EXISTS', 'NOT', 'ASC', 'DESC'
        ]);

        for (let i = 0; i < codeTokens.length; i++) {
            const t = codeTokens[i];
            if (t.value === '(') {
                parenDepth++;
            } else if (t.value === ')') {
                if (parenDepth > 0) parenDepth--;
            }

            if (parenDepth === 0) {
                const up = (t.upper || t.value).toUpperCase();
                const isSemicolon = (t.type === 'PUNCTUATION' && t.value === ';');
                const isGo = (t.type === 'KEYWORD' && up === 'GO');

                if (isSemicolon || isGo) {
                    boundaries.push(t.end);
                    stmtStarter = null;
                    seenFromOrValues = false;
                    inFromClause = false;
                    continue;
                }

                if (stmtStarter === null) {
                    if (['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'WITH', 'DECLARE', 'CREATE', 'ALTER', 'DROP', 'EXEC', 'EXECUTE', 'TRUNCATE', 'USE'].includes(up)) {
                        stmtStarter = up;
                    }
                } else {
                    if (up === 'FROM') {
                        inFromClause = true;
                    } else if (up === 'VALUES') {
                        seenFromOrValues = true;
                    } else if (inFromClause) {
                        if (!CLAUSE_CONTINUATION_KEYWORDS.has(up) && t.type !== 'PUNCTUATION') {
                            seenFromOrValues = true;
                            inFromClause = false;
                        }
                    }

                    // Check if this token starts a new statement at parenDepth === 0
                    const prevTok = i > 0 ? codeTokens[i - 1] : null;
                    const prev = prevTok ? (prevTok.upper || prevTok.value).toUpperCase() : '';
                    const isNewlineAfterPrev = i > 0 && fullSql.substring(codeTokens[i - 1].end, t.start).includes('\n');

                    if (up === 'SELECT') {
                        const isAfterBlockOrRoutine = ['BEGIN', 'DO'].includes(prev);
                        if (!CONTINUATION_BEFORE_SELECT.has(prev) || (prev === 'AS' && (stmtStarter === 'CREATE' || stmtStarter === 'ALTER'))) {
                            if (stmtStarter === 'SELECT' || stmtStarter === 'DECLARE' || seenFromOrValues || isAfterBlockOrRoutine || stmtStarter === 'CREATE' || stmtStarter === 'ALTER') {
                                boundaries.push(t.start);
                                stmtStarter = 'SELECT';
                                seenFromOrValues = false;
                                inFromClause = false;
                            }
                        }
                    } else if (['INSERT', 'UPDATE', 'DELETE', 'DECLARE', 'CREATE', 'ALTER', 'DROP', 'WITH', 'EXEC', 'EXECUTE', 'TRUNCATE', 'USE'].includes(up)) {
                        if (!['THEN', 'ELSE', 'DO'].includes(prev) && !(prev === 'AS' && stmtStarter !== 'CREATE' && stmtStarter !== 'ALTER')) {
                            boundaries.push(t.start);
                            stmtStarter = up;
                            seenFromOrValues = false;
                            inFromClause = false;
                        }
                    } else if (seenFromOrValues && isNewlineAfterPrev && prevTok && prevTok.value !== ',' && t.type !== 'PUNCTUATION' && !CLAUSE_CONTINUATION_KEYWORDS.has(up)) {
                        // Identifier or partial typing on a new line after complete clause
                        boundaries.push(t.start);
                        stmtStarter = up;
                        seenFromOrValues = false;
                        inFromClause = false;
                    }
                }
            }
        }
        boundaries.push(fullSql.length);

        // Sort unique boundaries
        sortedBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);
        if (fullSql === _lastFullSql) {
            _lastSortedBoundaries = sortedBoundaries;
        }
        }

        // Find boundary interval enclosing cursorIndex
        let start = 0;
        let end = fullSql.length;

        for (let i = 0; i < sortedBoundaries.length - 1; i++) {
            const bStart = sortedBoundaries[i];
            const bEnd = sortedBoundaries[i + 1];
            if (cursorIndex >= bStart && cursorIndex <= bEnd) {
                if (cursorIndex === bEnd && (i + 1) < sortedBoundaries.length - 1) {
                    continue; // prefer next statement that starts at this boundary
                }
                start = bStart;
                end = bEnd;
                break;
            }
        }

        return {
            start: start,
            end: end,
            text: fullSql.substring(start, end)
        };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. CLAUSE DETECTION USING TOKEN STREAM (Zero comment/string false positives)
    // ─────────────────────────────────────────────────────────────────────────────
    function detectClauseFromTokens(tokens, cursorOffset, statementStart = 0) {
        if (!tokens || tokens.length === 0) return "";

        // Tokens strictly within current statement and before cursor
        const priorTokens = tokens.filter(t => t.end <= cursorOffset && t.start >= statementStart);
        let depth = 0;

        for (let i = priorTokens.length - 1; i >= 0; i--) {
            const t = priorTokens[i];

            if (t.value === ')') {
                depth++;
                continue;
            } else if (t.value === '(') {
                depth--;
                continue;
            }

            if (depth <= 0) {
                const upper = (t.upper || t.value).toUpperCase();

                if (t.value === ';' || upper === 'GO' || upper === 'BEGIN') {
                    // Semicolon, GO, or BEGIN demarcates statement/block boundary.
                    // Clauses before this boundary belong to an earlier statement or outer routine definition.
                    break;
                }

                if (upper === 'BY' && i > 0) {
                    const prevUpper = (priorTokens[i - 1].upper || priorTokens[i - 1].value).toUpperCase();
                    if (prevUpper === 'ORDER') return 'ORDER BY';
                    if (prevUpper === 'GROUP') return 'GROUP BY';
                }

                if (upper === 'JOIN') {
                    if (i > 0) {
                        const prev = (priorTokens[i - 1].upper || priorTokens[i - 1].value).toUpperCase();
                        if (['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER'].includes(prev)) {
                            return 'JOIN';
                        }
                    }
                    return 'JOIN';
                }

                if (['SELECT', 'FROM', 'WHERE', 'HAVING', 'VALUES', 'OUTPUT', 'RETURNING'].includes(upper)) {
                    return upper;
                }

                if (upper === 'ON') {
                    // ON is a join/merge condition clause if preceded by JOIN, MERGE, or USING in the same statement
                    let hasJoinOrMerge = false;
                    for (let j = 0; j < i; j++) {
                        const jUp = (priorTokens[j].upper || priorTokens[j].value).toUpperCase();
                        if (jUp === 'JOIN' || jUp === 'MERGE' || jUp === 'USING') {
                            hasJoinOrMerge = true;
                            break;
                        }
                    }
                    if (hasJoinOrMerge) {
                        return 'ON';
                    }
                }

                if (upper === 'USING') {
                    return 'USING';
                }

                if (upper === 'MERGE') {
                    return 'MERGE INTO';
                }

                if (upper === 'INTO' && i > 0) {
                    const prevUpper = (priorTokens[i - 1].upper || priorTokens[i - 1].value).toUpperCase();
                    if (prevUpper === 'INSERT') return 'INSERT INTO';
                    if (prevUpper === 'MERGE') return 'MERGE INTO';
                }

                if (upper === 'INSERT') {
                    return 'INSERT INTO';
                }

                if (upper === 'SET') {
                    // SET is only a DML clause if preceded by UPDATE in the same statement
                    let hasUpdate = false;
                    for (let j = 0; j < i; j++) {
                        const jUp = (priorTokens[j].upper || priorTokens[j].value).toUpperCase();
                        if (jUp === 'UPDATE') {
                            hasUpdate = true;
                            break;
                        }
                    }
                    if (hasUpdate) {
                        return 'SET';
                    }
                }

                if (['UPDATE', 'EXEC', 'EXECUTE'].includes(upper)) {
                    return upper;
                }

                if (upper === 'FROM' && i > 0) {
                    const prevUpper = (priorTokens[i - 1].upper || priorTokens[i - 1].value).toUpperCase();
                    if (prevUpper === 'DELETE') return 'DELETE FROM';
                }
            }
        }

        return "";
    }

    function detectClause(textBeforeCursor) {
        const tokenizer = getTokenizer();
        if (tokenizer) {
            const allTokens = tokenizer.tokenize(textBeforeCursor);
            const codeTokens = tokenizer.filterCodeTokens(allTokens);
            return detectClauseFromTokens(codeTokens, textBeforeCursor.length);
        }

        // Fallback regex if tokenizer not initialized
        if (!textBeforeCursor) return "";
        const keywords = [
            "SELECT", "FROM", "JOIN", "WHERE", "ON", "GROUP BY", "ORDER BY",
            "HAVING", "INSERT INTO", "UPDATE", "SET", "DELETE FROM",
            "EXEC", "EXECUTE", "INTO"
        ];
        const pattern = new RegExp(
            '\\b(' + keywords.map(k => k.replace(" ", "\\s+")).join("|") + ')\\b',
            'gi'
        );
        let match;
        let lastMatch = null;
        while ((match = pattern.exec(textBeforeCursor)) !== null) {
            lastMatch = match[1];
        }
        return lastMatch ? lastMatch.replace(/\s+/g, " ").toUpperCase() : "";
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. ALTER / CREATE CONTEXT DETECTION
    // ─────────────────────────────────────────────────────────────────────────────
    function detectAlterContext(textBeforeCursor, optionalCodeTokens = null) {
        if (!textBeforeCursor && !optionalCodeTokens) return { isAlter: false, action: "", alterType: "" };

        const tokenizer = getTokenizer();
        if (optionalCodeTokens || tokenizer) {
            const codeTokens = optionalCodeTokens || tokenizer.filterCodeTokens(tokenizer.tokenize(textBeforeCursor));

            // Find current statement boundary (scan backwards to last ';' or 'GO')
            let stmtStartIdx = 0;
            for (let i = codeTokens.length - 1; i >= 0; i--) {
                const up = (codeTokens[i].upper || codeTokens[i].value).toUpperCase();
                if (codeTokens[i].value === ';' || up === 'GO') {
                    stmtStartIdx = i + 1;
                    break;
                }
            }

            for (let i = stmtStartIdx; i < codeTokens.length; i++) {
                const t = codeTokens[i];
                const upper = (t.upper || t.value).toUpperCase();

                if (['ALTER', 'DROP'].includes(upper) || (upper === 'CREATE' && i + 2 < codeTokens.length && (codeTokens[i + 1].upper === 'OR' || codeTokens[i + 1].value.toUpperCase() === 'OR'))) {
                    let action = upper;
                    let nextIdx = i + 1;

                    if (upper === 'CREATE') {
                        const orToken = (codeTokens[i + 1].upper || codeTokens[i + 1].value).toUpperCase();
                        const nextWord = (codeTokens[i + 2].upper || codeTokens[i + 2].value).toUpperCase();
                        if (orToken === 'OR' && (nextWord === 'ALTER' || nextWord === 'REPLACE')) {
                            action = `CREATE OR ${nextWord}`;
                            nextIdx = i + 3;
                        }
                    }

                    if (nextIdx < codeTokens.length) {
                        const targetWord = (codeTokens[nextIdx].upper || codeTokens[nextIdx].value).toUpperCase();
                        const validTypes = {
                            'PROCEDURE': 'procedure',
                            'PROC': 'procedure',
                            'FUNCTION': 'function',
                            'FUNC': 'function',
                            'TRIGGER': 'trigger',
                            'VIEW': 'view',
                            'TABLE': 'table'
                        };

                        if (validTypes[targetWord]) {
                            // Check that cursor is not after "AS", "BEGIN", "RETURNS", or "$$" (Routine Body in SQL Server / Postgres)
                            const remaining = codeTokens.slice(nextIdx + 1);
                            const hasRoutineBodyStarter = remaining.some(rem => {
                                const up = (rem.upper || rem.value).toUpperCase();
                                const val = rem.value || '';
                                return up === 'AS' || up === 'BEGIN' || up === 'RETURNS' || up === '$$' || (val.startsWith('$') && val.endsWith('$') && val.length >= 2);
                            });
                            if (!hasRoutineBodyStarter) {
                                return {
                                    isAlter: true,
                                    action: action,
                                    alterType: validTypes[targetWord],
                                    actionStart: t.start
                                };
                            }
                        }
                    }
                }
            }
            return { isAlter: false, action: "", alterType: "", actionStart: -1 };
        }

        // Fallback regex: only inspect current statement after last ';' or 'GO'
        const lastBoundaryMatch = textBeforeCursor.match(/(?:;|[\r\n]\s*GO\b)(?![\s\S]*(?:;|[\r\n]\s*GO\b))/i);
        const currentStmtText = lastBoundaryMatch
            ? textBeforeCursor.substring(lastBoundaryMatch.index + lastBoundaryMatch[0].length)
            : textBeforeCursor;

        const pattern = /\b(ALTER|DROP|CREATE\s+OR\s+ALTER|CREATE\s+OR\s+REPLACE)(?:\s+(PROCEDURE|PROC|FUNCTION|FUNC|TRIGGER|VIEW|TABLE))?\b/gi;
        let match;
        let lastMatch = null;
        let lastEnd = 0;
        while ((match = pattern.exec(currentStmtText)) !== null) {
            lastMatch = match;
            lastEnd = match.index + match[0].length;
        }

        if (lastMatch) {
            const afterClause = currentStmtText.substring(lastEnd).trim();
            const afterUpper = afterClause.toUpperCase();
            if (!afterClause.includes("\n") && !afterUpper.includes(" AS ") && !afterUpper.includes(" BEGIN ") && !afterUpper.includes(" RETURNS ") && !afterClause.includes("$$")) {
                const action = lastMatch[1].toUpperCase();
                const rawType = (lastMatch[2] || "").toLowerCase();
                let alterType = rawType;
                if (rawType === "proc" || rawType === "procedure") alterType = "procedure";
                else if (rawType === "func" || rawType === "function") alterType = "function";

                const stmtOffset = lastBoundaryMatch ? (lastBoundaryMatch.index + lastBoundaryMatch[0].length) : 0;
                return { 
                    isAlter: true, 
                    action: action, 
                    alterType: alterType,
                    actionStart: stmtOffset + lastMatch.index
                };
            }
        }
        return { isAlter: false, action: "", alterType: "", actionStart: -1 };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 5b. ROUTINE / STORED PROCEDURE / FUNCTION BODY CONTEXT DETECTION (Phase 4b)
    // ─────────────────────────────────────────────────────────────────────────────
    function detectRoutineContext(codeTokens, textBeforeCursor, fullCodeTokens) {
        const cursorOffset = textBeforeCursor ? textBeforeCursor.length : 0;
        const tokensToScan = (fullCodeTokens && fullCodeTokens.length > 0) ? fullCodeTokens : (codeTokens || []);
        if (tokensToScan.length === 0) {
            if (!textBeforeCursor) return { isInRoutine: false, isRoutineBody: false, routineType: '', routineName: '', routineSchema: '', triggerTable: null };
            const m = textBeforeCursor.match(/\b(CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER)\s+(PROCEDURE|PROC|FUNCTION|FUNC|TRIGGER)\b/i);
            if (!m) return { isInRoutine: false, isRoutineBody: false, routineType: '', routineName: '', routineSchema: '', triggerTable: null };
            const rawType = m[2].toUpperCase();
            let rType = (rawType === 'PROC' || rawType === 'PROCEDURE') ? 'procedure' : (rawType === 'FUNC' || rawType === 'FUNCTION') ? 'function' : 'trigger';
            const afterHeader = textBeforeCursor.substring(m.index);
            if (/\bRETURNS\s+TRIGGER\b/i.test(afterHeader)) rType = 'trigger';
            let trgTable = null;
            const onMatch = afterHeader.match(/\bON\s+(?:\[?([a-zA-Z0-9_#]+)\]?\.)?\[?([a-zA-Z0-9_#]+)\]?/i);
            if (onMatch && rType === 'trigger') trgTable = { schema: onMatch[1] || '', table: onMatch[2] };
            const hasStarter = /\b(AS|BEGIN|\$\$)\b/i.test(afterHeader);
            return { isInRoutine: true, isRoutineBody: hasStarter, routineType: rType, routineName: '', routineSchema: '', triggerTable: trgTable };
        }

        const routines = [];

        for (let i = 0; i < tokensToScan.length; i++) {
            const upper = (tokensToScan[i].upper || tokensToScan[i].value).toUpperCase();

            // 1. PostgreSQL anonymous block: DO $$ ... $$;
            if (upper === 'DO' && i + 1 < tokensToScan.length) {
                const nextVal = tokensToScan[i + 1].value || '';
                const isDollar = nextVal === '$$' || (nextVal.startsWith('$') && nextVal.endsWith('$') && nextVal.length >= 2);
                if (isDollar) {
                    const tag = nextVal;
                    const routineStart = tokensToScan[i].start;
                    const bodyStart = tokensToScan[i + 1].end;
                    let bodyEnd = tokensToScan[tokensToScan.length - 1].end;
                    for (let m = i + 2; m < tokensToScan.length; m++) {
                        if (tokensToScan[m].value === tag) {
                            bodyEnd = tokensToScan[m].end;
                            break;
                        }
                    }
                    routines.push({
                        start: routineStart,
                        bodyStart: bodyStart,
                        end: bodyEnd,
                        routineType: 'procedure',
                        routineName: '',
                        routineSchema: '',
                        triggerTable: null
                    });
                    continue;
                }
            }

            // 2. CREATE [OR ALTER|REPLACE] PROCEDURE|FUNCTION|TRIGGER
            if (['CREATE', 'ALTER'].includes(upper)) {
                let k = i + 1;
                if (k < tokensToScan.length && (tokensToScan[k].upper || tokensToScan[k].value).toUpperCase() === 'OR') {
                    k++;
                    if (k < tokensToScan.length && ['ALTER', 'REPLACE'].includes((tokensToScan[k].upper || tokensToScan[k].value).toUpperCase())) {
                        k++;
                    }
                }
                if (k < tokensToScan.length) {
                    const typeUp = (tokensToScan[k].upper || tokensToScan[k].value).toUpperCase();
                    if (['PROCEDURE', 'PROC', 'FUNCTION', 'FUNC', 'TRIGGER'].includes(typeUp)) {
                        let routineType = (typeUp === 'PROC' || typeUp === 'PROCEDURE') ? 'procedure'
                            : (typeUp === 'FUNC' || typeUp === 'FUNCTION') ? 'function' : 'trigger';
                        const routineStart = tokensToScan[i].start;
                        k++;
                        let routineSchema = '';
                        let routineName = '';
                        if (k < tokensToScan.length) {
                            let firstIdent = cleanIdentifier(tokensToScan[k].value);
                            k++;
                            if (k + 1 < tokensToScan.length && tokensToScan[k].value === '.') {
                                routineSchema = firstIdent;
                                routineName = cleanIdentifier(tokensToScan[k + 1].value);
                                k += 2;
                            } else {
                                routineName = firstIdent;
                            }
                        }

                        // Scan header tokens for routine body starter, RETURNS TRIGGER, and ON tableName
                        let triggerTable = null;
                        let bodyStart = -1;
                        let dollarTag = null;
                        let singleQuoteString = null;

                        for (let r = k; r < tokensToScan.length; r++) {
                            const rUp = (tokensToScan[r].upper || tokensToScan[r].value).toUpperCase();
                            const rVal = tokensToScan[r].value || '';

                            if (rUp === 'RETURNS' && r + 1 < tokensToScan.length) {
                                const nextUp = (tokensToScan[r + 1].upper || tokensToScan[r + 1].value).toUpperCase();
                                if (nextUp === 'TRIGGER') {
                                    routineType = 'trigger';
                                }
                            }

                            if (rUp === 'ON' && (routineType === 'trigger') && r + 1 < tokensToScan.length) {
                                let tblFirst = cleanIdentifier(tokensToScan[r + 1].value);
                                let tblSchema = '';
                                let tblName = tblFirst;
                                if (r + 3 < tokensToScan.length && tokensToScan[r + 2].value === '.') {
                                    tblSchema = tblFirst;
                                    tblName = cleanIdentifier(tokensToScan[r + 3].value);
                                }
                                triggerTable = { schema: tblSchema, table: tblName };
                            }

                            // Body starter: AS $tag$ or AS $$ or AS BEGIN or BEGIN or AS '...'
                            if (rVal === '$$' || (rVal.startsWith('$') && rVal.endsWith('$') && rVal.length >= 2)) {
                                bodyStart = tokensToScan[r].end;
                                dollarTag = rVal;
                                break;
                            } else if (rUp === 'AS' && r + 1 < tokensToScan.length) {
                                const nTok = tokensToScan[r + 1];
                                const nVal = nTok.value || '';
                                if (nVal === '$$' || (nVal.startsWith('$') && nVal.endsWith('$') && nVal.length >= 2)) {
                                    bodyStart = nTok.end;
                                    dollarTag = nVal;
                                    break;
                                } else if (nTok.type === 'STRING') {
                                    bodyStart = nTok.start + 1;
                                    singleQuoteString = nTok;
                                    break;
                                } else {
                                    bodyStart = tokensToScan[r].end;
                                    break;
                                }
                            } else if (rUp === 'BEGIN' && bodyStart === -1) {
                                bodyStart = tokensToScan[r].end;
                                break;
                            }
                        }

                        // Determine routine body end offset
                        let routineEnd = tokensToScan[tokensToScan.length - 1].end;
                        if (dollarTag) {
                            for (let m = k; m < tokensToScan.length; m++) {
                                if (tokensToScan[m].value === dollarTag && tokensToScan[m].end > bodyStart) {
                                    let endIdx = tokensToScan[m].end;
                                    for (let post = m + 1; post < Math.min(tokensToScan.length, m + 5); post++) {
                                        if (tokensToScan[post].value === ';') {
                                            endIdx = tokensToScan[post].end;
                                            break;
                                        }
                                        const pUp = (tokensToScan[post].upper || tokensToScan[post].value).toUpperCase();
                                        if (pUp === 'CREATE' || pUp === 'DO' || pUp === 'SELECT') break;
                                        endIdx = tokensToScan[post].end;
                                    }
                                    routineEnd = endIdx;
                                    break;
                                }
                            }
                        } else if (singleQuoteString) {
                            routineEnd = singleQuoteString.end;
                        } else {
                            let beginDepth = 0;
                            let hasSeenBegin = false;
                            for (let m = k; m < tokensToScan.length; m++) {
                                const mUp = (tokensToScan[m].upper || tokensToScan[m].value).toUpperCase();
                                if (mUp === 'GO') {
                                    routineEnd = tokensToScan[m].start;
                                    break;
                                }
                                if (mUp === 'BEGIN') {
                                    beginDepth++;
                                    hasSeenBegin = true;
                                } else if (mUp === 'END') {
                                    if (beginDepth > 0) beginDepth--;
                                    if (hasSeenBegin && beginDepth === 0) {
                                        routineEnd = tokensToScan[m].end;
                                        if (m + 1 < tokensToScan.length && tokensToScan[m + 1].value === ';') {
                                            routineEnd = tokensToScan[m + 1].end;
                                        }
                                        break;
                                    }
                                } else if (beginDepth === 0 && hasSeenBegin && ['CREATE', 'ALTER', 'SELECT'].includes(mUp)) {
                                    routineEnd = tokensToScan[m].start;
                                    break;
                                }
                            }
                        }

                        // If PG trigger without triggerTable, scan entire tokens for CREATE TRIGGER ... ON
                        if (routineType === 'trigger' && !triggerTable) {
                            for (let s = 0; s < tokensToScan.length; s++) {
                                const sUp = (tokensToScan[s].upper || tokensToScan[s].value).toUpperCase();
                                if (sUp === 'CREATE' && s + 2 < tokensToScan.length && (tokensToScan[s + 1].upper || tokensToScan[s + 1].value).toUpperCase() === 'TRIGGER') {
                                    for (let m = s + 2; m < tokensToScan.length; m++) {
                                        const mUp = (tokensToScan[m].upper || tokensToScan[m].value).toUpperCase();
                                        if (mUp === ';' || mUp === 'BEGIN') break;
                                        if (mUp === 'ON' && m + 1 < tokensToScan.length) {
                                            let tblFirst = cleanIdentifier(tokensToScan[m + 1].value);
                                            let tblSchema = '';
                                            let tblName = tblFirst;
                                            if (m + 3 < tokensToScan.length && tokensToScan[m + 2].value === '.') {
                                                tblSchema = tblFirst;
                                                tblName = cleanIdentifier(tokensToScan[m + 3].value);
                                            }
                                            triggerTable = { schema: tblSchema, table: tblName };
                                            break;
                                        }
                                    }
                                    if (triggerTable) break;
                                }
                            }
                        }

                        routines.push({
                            start: routineStart,
                            bodyStart: bodyStart,
                            end: routineEnd,
                            routineType: routineType,
                            routineName: routineName,
                            routineSchema: routineSchema,
                            triggerTable: triggerTable
                        });
                    }
                }
            }
        }

        // Find routine enclosing cursor
        for (const r of routines) {
            if (cursorOffset >= r.start && cursorOffset <= r.end) {
                const isBody = (r.bodyStart !== -1 && cursorOffset >= r.bodyStart);
                return {
                    isInRoutine: true,
                    isRoutineBody: isBody,
                    routineType: r.routineType,
                    routineName: r.routineName,
                    routineSchema: r.routineSchema,
                    triggerTable: r.triggerTable
                };
            }
        }

        // Fallback: If cursor is not inside any detected routine
        return {
            isInRoutine: false,
            isRoutineBody: false,
            routineType: '',
            routineName: '',
            routineSchema: '',
            triggerTable: null
        };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. SCOPE, TEMP TABLES & TABLE VARIABLES EXTRACTION
    // ─────────────────────────────────────────────────────────────────────────────
    function extractLocalTempTables(sqlText, optionalTokens = null) {
        if (!sqlText) return [];
        const tokenizer = getTokenizer();
        if (optionalTokens || tokenizer) {
            const tokens = optionalTokens || tokenizer.tokenize(sqlText);
            const seen = new Set();
            const result = [];
            tokens.forEach(t => {
                if (t.type === 'PARAMETER' && t.value.startsWith('#') && t.value.length > 1 && !/^#+$/.test(t.value)) {
                    const lower = t.value.toLowerCase();
                    if (!seen.has(lower)) {
                        seen.add(lower);
                        result.push(t.value);
                    }
                }
            });
            return result;
        }

        const regex = /(?:^|[^a-zA-Z0-9_])(#[#a-zA-Z0-9_]+)/g;
        const seen = new Set();
        const result = [];
        let match;
        while ((match = regex.exec(sqlText)) !== null) {
            const table = match[1];
            if (table.length > 1 && !/^#+$/.test(table)) {
                const lower = table.toLowerCase();
                if (!seen.has(lower)) {
                    seen.add(lower);
                    result.push(table);
                }
            }
        }
        return result;
    }

    function extractLocalTableVars(sqlText, optionalTokens = null) {
        if (!sqlText) return [];
        const tokenizer = getTokenizer();
        if (optionalTokens || tokenizer) {
            const allTokens = optionalTokens || tokenizer.tokenize(sqlText);
            const codeTokens = tokenizer.filterCodeTokens(allTokens);
            const seen = new Set();
            const result = [];

            for (let i = 0; i < codeTokens.length - 2; i++) {
                const tDecl = (codeTokens[i].upper || codeTokens[i].value).toUpperCase();
                const tVar = codeTokens[i + 1];
                if (tDecl === 'DECLARE' && tVar.value.startsWith('@')) {
                    let nextIdx = i + 2;
                    if (nextIdx < codeTokens.length && (codeTokens[nextIdx].upper || codeTokens[nextIdx].value).toUpperCase() === 'AS') {
                        nextIdx++;
                    }
                    if (nextIdx < codeTokens.length && (codeTokens[nextIdx].upper || codeTokens[nextIdx].value).toUpperCase() === 'TABLE') {
                        const lower = tVar.value.toLowerCase();
                        if (!seen.has(lower)) {
                            seen.add(lower);
                            result.push(tVar.value);
                        }
                    }
                }
            }
            return result;
        }

        const regex = /\bDECLARE\s+(@[a-zA-Z0-9_]+)\s+(?:AS\s+)?TABLE\b/gi;
        const seen = new Set();
        const result = [];
        let match;
        while ((match = regex.exec(sqlText)) !== null) {
            const v = match[1];
            const lower = v.toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                result.push(v);
            }
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 7. ALIAS AND QUERY TABLES RESOLVER
    // ─────────────────────────────────────────────────────────────────────────────
    function extractAliases(sqlText, optionalTokens = null) {
        const aliasMap = {};
        if (!sqlText) return aliasMap;

        const tokenizer = getTokenizer();
        if (optionalTokens || tokenizer) {
            const allTokens = optionalTokens || tokenizer.tokenize(sqlText);
            const codeTokens = tokenizer.filterCodeTokens(allTokens);
            const nonAliases = new Set([
                "WHERE", "ON", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER",
                "GROUP", "ORDER", "HAVING", "LIMIT", "UNION", "APPLY", "LATERAL", "NATURAL", "WITH",
                "SELECT", "FROM", "INTO", "SET", "VALUES", "IN", "AND", "OR"
            ]);

            for (let i = 0; i < codeTokens.length; i++) {
                const upper = (codeTokens[i].upper || codeTokens[i].value).toUpperCase();
                if (upper === 'FROM' || upper === 'JOIN' || upper === 'APPLY' || upper === 'LATERAL') {
                    if (i + 1 >= codeTokens.length) continue;

                    let j = i + 1;

                    // 1. Check if a subquery immediately follows: (SELECT ...
                    if (codeTokens[j].value === '(') {
                        const openP = j;
                        let depth = 1;
                        let k = j + 1;
                        let isSubquery = false;
                        while (k < codeTokens.length && depth > 0) {
                            if (codeTokens[k].value === '(') depth++;
                            else if (codeTokens[k].value === ')') depth--;
                            if (depth === 1 && (codeTokens[k].upper || codeTokens[k].value).toUpperCase() === 'SELECT') {
                                isSubquery = true;
                            }
                            k++;
                        }
                        const closeP = k - 1;
                        if (depth === 0) {
                            j = closeP + 1;
                            let aliasToken = null;
                            if (j < codeTokens.length) {
                                const nextWord = (codeTokens[j].upper || codeTokens[j].value).toUpperCase();
                                if (nextWord === 'AS') {
                                    j++;
                                    if (j < codeTokens.length && codeTokens[j].type === 'IDENTIFIER') {
                                        aliasToken = codeTokens[j].value;
                                        j++;
                                    }
                                } else if (!nonAliases.has(nextWord) && codeTokens[j].value !== ')' && codeTokens[j].value !== '(' && codeTokens[j].value !== ';' && codeTokens[j].value !== ',') {
                                    if (codeTokens[j].type === 'IDENTIFIER') {
                                        aliasToken = codeTokens[j].value;
                                        j++;
                                    }
                                }
                            }
                            if (aliasToken) {
                                const cleanAl = cleanIdentifier(aliasToken);
                                if (!nonAliases.has(cleanAl.toUpperCase())) {
                                    let cols = [];
                                    // Parse explicit column aliases if present: alias(c1, c2, ...)
                                    if (j < codeTokens.length && codeTokens[j].value === '(') {
                                        const colOpen = j;
                                        let colDepth = 1;
                                        let colClose = -1;
                                        for (let p = colOpen + 1; p < codeTokens.length; p++) {
                                            if (codeTokens[p].value === '(') colDepth++;
                                            else if (codeTokens[p].value === ')') {
                                                colDepth--;
                                                if (colDepth === 0) { colClose = p; break; }
                                            }
                                        }
                                        if (colClose > colOpen) {
                                            for (let p = colOpen + 1; p < colClose; p++) {
                                                const cTok = codeTokens[p];
                                                const cVal = (cTok.upper || cTok.value).toUpperCase();
                                                if ((cTok.type === 'IDENTIFIER' || !nonAliases.has(cVal)) && cTok.value !== ',') {
                                                    const cName = cleanIdentifier(cTok.value);
                                                    if (cName && !cols.some(x => x.name.toLowerCase() === cName.toLowerCase())) {
                                                        cols.push({ name: cName, type: 'column', displayType: 'Column' });
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    if (cols.length === 0 && isSubquery && window.DefaultScopeResolver && window.DefaultScopeResolver.aliasResolver) {
                                        cols = window.DefaultScopeResolver.aliasResolver.parseSelectProjection(codeTokens, openP + 1, closeP);
                                    }
                                    let subSourceTables = [];
                                    if (window.DefaultScopeResolver && window.DefaultScopeResolver.aliasResolver) {
                                        subSourceTables = window.DefaultScopeResolver.aliasResolver.extractSubquerySourceTables(codeTokens, openP + 1, closeP);
                                    }
                                    const primarySrc = subSourceTables.length > 0 ? subSourceTables[0] : null;
                                    const subHasStar = Boolean(cols.hasStar);

                                    const subType = upper === 'APPLY' ? 'apply_subquery' : (upper === 'LATERAL' ? 'lateral_subquery' : 'subquery');
                                    const info = {
                                        schema: primarySrc ? primarySrc.schema : '',
                                        table: primarySrc ? primarySrc.table : cleanAl,
                                        targetObject: primarySrc ? primarySrc.table : cleanAl,
                                        alias: cleanAl,
                                        type: subType,
                                        columns: cols,
                                        hasStar: subHasStar,
                                        underlyingTables: subSourceTables
                                    };
                                    aliasMap[cleanAl.toLowerCase()] = info;
                                    aliasMap[cleanAl] = info;
                                }
                            }
                            continue;
                        }
                    }

                    // 2. Regular table path or table function call:
                    let tableParts = [];
                    while (j < codeTokens.length) {
                        const tok = codeTokens[j];
                        const tokVal = (tok.upper || tok.value).toUpperCase();
                        if (nonAliases.has(tokVal) || tok.value === '(' || tok.value === ')' || tok.value === ';' || tok.value === ',') {
                            break;
                        }
                        if (tok.type === 'IDENTIFIER' || tok.type === 'PARAMETER' || tok.type === 'KEYWORD') {
                            tableParts.push(cleanIdentifier(tok.value));
                            j++;
                            if (j < codeTokens.length && codeTokens[j].value === '.') {
                                j++; // skip dot
                            } else {
                                break; // end of table path
                            }
                        } else {
                            break;
                        }
                    }

                    if (tableParts.length === 0) continue;

                    let schemaName = "";
                    let tableName = "";
                    if (tableParts.length === 1) {
                        tableName = tableParts[0];
                    } else if (tableParts.length === 2) {
                        schemaName = tableParts[0];
                        tableName = tableParts[1];
                    } else if (tableParts.length >= 3) {
                        schemaName = tableParts[tableParts.length - 2];
                        tableName = tableParts[tableParts.length - 1];
                    }

                    // Check if followed by function call arguments: func(...)
                    let isFunctionCall = false;
                    if (j < codeTokens.length && codeTokens[j].value === '(') {
                        isFunctionCall = true;
                        let depth = 1;
                        j++;
                        while (j < codeTokens.length && depth > 0) {
                            if (codeTokens[j].value === '(') depth++;
                            else if (codeTokens[j].value === ')') depth--;
                            j++;
                        }
                    }

                    let tblType = isFunctionCall ? 'table_function' : 'table';
                    if (tableName.startsWith('#')) {
                        tblType = 'temp_table';
                    } else if (tableName.startsWith('@')) {
                        tblType = 'table_variable';
                    }
                    const info = {
                        schema: schemaName,
                        table: tableName,
                        type: tblType,
                        columns: []
                    };

                    // Optional alias
                    let aliasToken = null;
                    if (j < codeTokens.length) {
                        const nextWord = (codeTokens[j].upper || codeTokens[j].value).toUpperCase();
                        if (nextWord === 'AS') {
                            j++;
                            if (j < codeTokens.length && codeTokens[j].type === 'IDENTIFIER') {
                                aliasToken = codeTokens[j].value;
                                j++;
                            }
                        } else if (!nonAliases.has(nextWord) && codeTokens[j].value !== ')' && codeTokens[j].value !== '(' && codeTokens[j].value !== ';' && codeTokens[j].value !== ',') {
                            if (codeTokens[j].type === 'IDENTIFIER') {
                                aliasToken = codeTokens[j].value;
                                j++;
                            }
                        }
                    }

                    if (aliasToken) {
                        const cleanAl = cleanIdentifier(aliasToken);
                        if (!nonAliases.has(cleanAl.toUpperCase())) {
                            info.alias = cleanAl;
                            // Check for explicit column aliases: alias(c1, c2, ...)
                            if (j < codeTokens.length && codeTokens[j].value === '(') {
                                const colOpen = j;
                                let colDepth = 1;
                                let colClose = -1;
                                for (let p = colOpen + 1; p < codeTokens.length; p++) {
                                    if (codeTokens[p].value === '(') colDepth++;
                                    else if (codeTokens[p].value === ')') {
                                        colDepth--;
                                        if (colDepth === 0) { colClose = p; break; }
                                    }
                                }
                                if (colClose > colOpen) {
                                    for (let p = colOpen + 1; p < colClose; p++) {
                                        const cTok = codeTokens[p];
                                        const cVal = (cTok.upper || cTok.value).toUpperCase();
                                        if ((cTok.type === 'IDENTIFIER' || !nonAliases.has(cVal)) && cTok.value !== ',') {
                                            const cName = cleanIdentifier(cTok.value);
                                            if (cName && !info.columns.some(x => x.name.toLowerCase() === cName.toLowerCase())) {
                                                info.columns.push({ name: cName, type: 'column', displayType: 'Column' });
                                            }
                                        }
                                    }
                                }
                            }
                            aliasMap[cleanAl.toLowerCase()] = info;
                            aliasMap[cleanAl] = info;
                        }
                    }

                    if (tableName) {
                        aliasMap[tableName.toLowerCase()] = info;
                        aliasMap[tableName] = info;
                    }
                } else if (upper === 'INSERT') {
                    if (i + 1 >= codeTokens.length) continue;
                    let j = i + 1;
                    if ((codeTokens[j].upper || codeTokens[j].value).toUpperCase() === 'INTO') {
                        j++;
                    }
                    let tableParts = [];
                    while (j < codeTokens.length) {
                        const tok = codeTokens[j];
                        if (tok.value === '(' || tok.value === ')' || tok.value === ';' || tok.value === ',') break;
                        if (tok.type === 'IDENTIFIER' || tok.type === 'PARAMETER' || tok.type === 'KEYWORD') {
                            tableParts.push(cleanIdentifier(tok.value));
                            j++;
                            if (j < codeTokens.length && codeTokens[j].value === '.') {
                                j++;
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    }
                    if (tableParts.length > 0) {
                        let schemaName = tableParts.length > 1 ? tableParts[tableParts.length - 2] : '';
                        let tableName = tableParts[tableParts.length - 1];
                        const info = { schema: schemaName, table: tableName, dmlAction: 'INSERT' };
                        aliasMap[tableName.toLowerCase()] = info;
                        aliasMap[tableName] = info;
                    }
                } else if (upper === 'UPDATE') {
                    if (i + 1 >= codeTokens.length) continue;
                    let j = i + 1;
                    let tableParts = [];
                    while (j < codeTokens.length) {
                        const tok = codeTokens[j];
                        const up = (tok.upper || tok.value).toUpperCase();
                        if (up === 'SET' || tok.value === ';' || tok.value === '(' || tok.value === ')') break;
                        if (tok.type === 'IDENTIFIER' || tok.type === 'PARAMETER' || tok.type === 'KEYWORD') {
                            tableParts.push(cleanIdentifier(tok.value));
                            j++;
                            if (j < codeTokens.length && codeTokens[j].value === '.') {
                                j++;
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    }
                    if (tableParts.length > 0) {
                        let schemaName = tableParts.length > 1 ? tableParts[tableParts.length - 2] : '';
                        let tableName = tableParts[tableParts.length - 1];
                        const info = { schema: schemaName, table: tableName, dmlAction: 'UPDATE' };
                        let aliasToken = null;
                        if (j < codeTokens.length) {
                            const nextWord = (codeTokens[j].upper || codeTokens[j].value).toUpperCase();
                            if (nextWord === 'AS') {
                                j++;
                                if (j < codeTokens.length && codeTokens[j].type === 'IDENTIFIER') {
                                    aliasToken = codeTokens[j].value;
                                }
                            } else if (nextWord !== 'SET' && codeTokens[j].type === 'IDENTIFIER') {
                                aliasToken = codeTokens[j].value;
                            }
                        }
                        if (aliasToken) {
                            const cleanAl = cleanIdentifier(aliasToken);
                            info.alias = cleanAl;
                            aliasMap[cleanAl.toLowerCase()] = info;
                            aliasMap[cleanAl] = info;
                        }
                        aliasMap[tableName.toLowerCase()] = info;
                        aliasMap[tableName] = info;
                    }
                }
            }
            return aliasMap;
        }

        // Fallback regex
        const regex = /\b(?:FROM|JOIN|APPLY|LATERAL)\s+([\[\]\"\w\.#@]+)(?:\s+(?:AS\s+)?([\[\]\"\w]+))?/gi;
        const nonAliases = new Set([
            "WHERE", "ON", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER",
            "GROUP", "ORDER", "HAVING", "LIMIT", "UNION", "APPLY", "LATERAL", "NATURAL",
            "SELECT", "FROM", "INTO", "SET", "VALUES", "IN", "AND", "OR"
        ]);

        let match;
        while ((match = regex.exec(sqlText)) !== null) {
            const rawTable = match[1].trim();
            let rawAlias = match[2] ? match[2].trim() : "";

            if (rawAlias && nonAliases.has(rawAlias.toUpperCase())) {
                rawAlias = "";
            }

            const parts = rawTable.split(".").map(cleanIdentifier);
            let schemaName = "";
            let tableName = "";
            if (parts.length === 1) {
                tableName = parts[0];
            } else if (parts.length === 2) {
                schemaName = parts[0];
                tableName = parts[1];
            } else {
                schemaName = parts[parts.length - 2];
                tableName = parts[parts.length - 1];
            }

            const info = { schema: schemaName, table: tableName };

            if (rawAlias) {
                const cleanAlias = cleanIdentifier(rawAlias);
                info.alias = cleanAlias;
                aliasMap[cleanAlias.toLowerCase()] = info;
                aliasMap[cleanAlias] = info;
            }

            if (tableName) {
                aliasMap[tableName.toLowerCase()] = info;
                aliasMap[tableName] = info;
            }
        }

        return aliasMap;
    }

    function extractAllTablesInQuery(sqlText) {
        if (!sqlText) return [];
        const aliasMap = extractAliases(sqlText);
        const seen = new Set();
        const tables = [];

        Object.values(aliasMap).forEach(info => {
            if (info.table) {
                const key = `${(info.schema || '').toLowerCase()}::${info.table.toLowerCase()}::${(info.alias || '').toLowerCase()}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    tables.push({
                        schema: info.schema,
                        table: info.table,
                        targetObject: info.targetObject || info.table,
                        alias: info.alias || "",
                        type: info.type || 'table',
                        columns: info.columns || [],
                        hasStar: Boolean(info.hasStar),
                        underlyingTables: info.underlyingTables || []
                    });
                }
            }
        });

        return tables;
    }

    function extractSelectAliases(sqlText, statementRange = null, optionalTokens = null) {
        const selectAliases = [];
        if (!sqlText) return selectAliases;

        const tokenizer = getTokenizer();
        if (!tokenizer && !optionalTokens) return selectAliases;

        const allTokens = optionalTokens || tokenizer.tokenize(sqlText);
        const codeTokens = tokenizer.filterCodeTokens(allTokens);

        // Filter tokens within statementRange if provided
        let stmtTokens = codeTokens;
        if (statementRange && typeof statementRange.start === 'number' && typeof statementRange.end === 'number') {
            stmtTokens = codeTokens.filter(t => t.end >= statementRange.start && t.start <= statementRange.end);
        }

        // Find top-level SELECT at depth 0
        let selectIdx = -1;
        let parenDepth = 0;
        for (let i = 0; i < stmtTokens.length; i++) {
            const t = stmtTokens[i];
            if (t.value === '(') parenDepth++;
            else if (t.value === ')') {
                if (parenDepth > 0) parenDepth--;
            }
            if (parenDepth === 0 && (t.upper || t.value).toUpperCase() === 'SELECT') {
                selectIdx = i;
                break;
            }
        }

        if (selectIdx === -1) return selectAliases;

        // Collect tokens from SELECT until FROM, WHERE, GROUP, HAVING, ORDER, UNION, ';' at depth 0
        const projTokens = [];
        parenDepth = 0;
        for (let i = selectIdx + 1; i < stmtTokens.length; i++) {
            const t = stmtTokens[i];
            if (t.value === '(') parenDepth++;
            else if (t.value === ')') {
                if (parenDepth > 0) parenDepth--;
            }
            if (parenDepth === 0) {
                const up = (t.upper || t.value).toUpperCase();
                if (['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION'].includes(up) || t.value === ';') {
                    break;
                }
            }
            projTokens.push(t);
        }

        // Split projTokens by comma at depth 0
        const chunks = [];
        let currentChunk = [];
        parenDepth = 0;
        for (const t of projTokens) {
            if (t.value === '(') parenDepth++;
            else if (t.value === ')') {
                if (parenDepth > 0) parenDepth--;
            }
            if (parenDepth === 0 && t.value === ',') {
                if (currentChunk.length > 0) chunks.push(currentChunk);
                currentChunk = [];
            } else {
                currentChunk.push(t);
            }
        }
        if (currentChunk.length > 0) chunks.push(currentChunk);

        const nonAliases = new Set([
            "WHERE", "ON", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER",
            "GROUP", "ORDER", "HAVING", "LIMIT", "UNION", "APPLY", "LATERAL", "NATURAL", "WITH",
            "SELECT", "FROM", "INTO", "SET", "VALUES", "IN", "AND", "OR", "AS"
        ]);

        for (const chunk of chunks) {
            if (chunk.length === 0) continue;
            let aliasName = "";
            let asIdx = -1;

            // Check for explicit 'AS' keyword at depth 0
            parenDepth = 0;
            for (let k = 0; k < chunk.length; k++) {
                if (chunk[k].value === '(') parenDepth++;
                else if (chunk[k].value === ')') {
                    if (parenDepth > 0) parenDepth--;
                }
                if (parenDepth === 0 && (chunk[k].upper || chunk[k].value).toUpperCase() === 'AS') {
                    asIdx = k;
                    break;
                }
            }

            if (asIdx !== -1 && asIdx + 1 < chunk.length) {
                aliasName = cleanIdentifier(chunk[asIdx + 1].value);
            } else if (chunk.length > 1) {
                // Check if last token is an identifier alias (e.g. `col alias` or `expr alias`)
                const lastTok = chunk[chunk.length - 1];
                const lastVal = (lastTok.upper || lastTok.value).toUpperCase();
                if (lastTok.type === 'IDENTIFIER' && !nonAliases.has(lastVal)) {
                    aliasName = cleanIdentifier(lastTok.value);
                }
            }

            if (aliasName && !nonAliases.has(aliasName.toUpperCase())) {
                const exprTokens = (asIdx !== -1) ? chunk.slice(0, asIdx) : chunk.slice(0, chunk.length - 1);
                const exprText = exprTokens.map(t => t.value).join(' ');
                if (!selectAliases.some(sa => sa.name.toLowerCase() === aliasName.toLowerCase())) {
                    selectAliases.push({
                        name: aliasName,
                        label: aliasName,
                        originalExpr: exprText,
                        type: 'select_alias',
                        displayType: 'Select Alias'
                    });
                }
            }
        }

        return selectAliases;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Phase 4: DML CONTEXT EXTRACTION (INSERT INTO & UPDATE SET)
    // ─────────────────────────────────────────────────────────────────────────────
    function extractDmlContext(codeTokens, cursorIndex, statementRange = null, currentWord = '') {
        const result = {
            isInsert: false,
            isInsertTarget: false,
            isInsertColumns: false,
            isValues: false,
            valueColumnIndex: -1,
            isUpdate: false,
            isUpdateTarget: false,
            isUpdateSet: false,
            isUpdateSetValue: false,
            targetTable: null,
            alreadyListed: [],
            insertColumns: []
        };

        if (!codeTokens || codeTokens.length === 0) return result;

        // Filter tokens within statementRange if provided
        let stmtTokens = codeTokens;
        if (statementRange && typeof statementRange.start === 'number' && typeof statementRange.end === 'number') {
            stmtTokens = codeTokens.filter(t => t.end >= statementRange.start && t.start <= statementRange.end);
        }
        if (stmtTokens.length === 0) return result;

        // Filter tokens prior to or at cursor
        const priorTokens = stmtTokens.filter(t => t.start <= cursorIndex);
        if (priorTokens.length === 0) return result;

        // Find primary statement starter keyword
        const firstKeywordTok = stmtTokens.find(t => t.type === 'KEYWORD');
        const firstKeyword = firstKeywordTok ? (firstKeywordTok.upper || firstKeywordTok.value).toUpperCase() : '';

        // ── A. INSERT STATEMENTS ─────────────────────────────────────────────
        if (firstKeyword === 'INSERT') {
            result.isInsert = true;
            const insertIdx = stmtTokens.indexOf(firstKeywordTok);
            let j = insertIdx + 1;
            if (j < stmtTokens.length && (stmtTokens[j].upper || stmtTokens[j].value).toUpperCase() === 'INTO') {
                j++;
            }

            // Collect target table name (id or schema.id)
            let tableParts = [];
            while (j < stmtTokens.length) {
                const tok = stmtTokens[j];
                if (tok.value === '(' || tok.value === ';' || (tok.type === 'PUNCTUATION' && tok.value !== '.')) {
                    break;
                }
                if (tok.type === 'IDENTIFIER' || tok.type === 'PARAMETER' || tok.type === 'KEYWORD') {
                    tableParts.push(cleanIdentifier(tok.value));
                    j++;
                    if (j < stmtTokens.length && stmtTokens[j].value === '.') {
                        j++; // skip dot
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            if (tableParts.length > 0) {
                let schemaName = '';
                let tableName = '';
                if (tableParts.length === 1) {
                    tableName = tableParts[0];
                } else {
                    schemaName = tableParts[tableParts.length - 2];
                    tableName = tableParts[tableParts.length - 1];
                }
                result.targetTable = { schema: schemaName, table: tableName };
            }

            // Check if cursor is before first '('
            const openParenIdx = stmtTokens.findIndex((t, idx) => idx >= j && t.value === '(');
            if (openParenIdx === -1 || cursorIndex < stmtTokens[openParenIdx].start) {
                result.isInsertTarget = true;
            } else {
                // Open paren exists and cursor is at or after open paren
                // Check if there is a VALUES or SELECT following this open paren
                let valuesIdx = -1;
                let selectIdx = -1;
                for (let k = openParenIdx; k < stmtTokens.length; k++) {
                    const up = (stmtTokens[k].upper || stmtTokens[k].value).toUpperCase();
                    if (up === 'VALUES' && valuesIdx === -1) valuesIdx = k;
                    if (up === 'SELECT' && selectIdx === -1) selectIdx = k;
                }

                const isBeforeValues = (valuesIdx === -1 || cursorIndex < stmtTokens[valuesIdx].start);
                const isBeforeSelect = (selectIdx === -1 || cursorIndex < stmtTokens[selectIdx].start);

                if (isBeforeValues && isBeforeSelect) {
                    // Cursor is in INSERT columns list: INSERT INTO Customers ( ... | ... )
                    result.isInsertColumns = true;

                    // Scan tokens between openParen and cursor
                    let colTokens = [];
                    let parenDepth = 0;
                    for (let k = openParenIdx; k < priorTokens.length; k++) {
                        const tok = priorTokens[k];
                        if (tok.value === '(') {
                            parenDepth++;
                            continue;
                        } else if (tok.value === ')') {
                            parenDepth--;
                            if (parenDepth <= 0) break;
                            continue;
                        }

                        if (parenDepth === 1) {
                            if (tok.type === 'IDENTIFIER' || tok.type === 'KEYWORD') {
                                // Check if this token is currently being typed under cursor
                                const isCursorInside = (cursorIndex >= tok.start && cursorIndex <= tok.end);
                                const val = cleanIdentifier(tok.value);
                                if (!isCursorInside && val) {
                                    colTokens.push(val);
                                }
                            }
                        }
                    }

                    result.insertColumns = colTokens;
                    result.alreadyListed = colTokens.map(c => c.toLowerCase());
                } else if (valuesIdx !== -1 && cursorIndex >= stmtTokens[valuesIdx].end) {
                    // Cursor is in VALUES clause: only if strictly inside parentheses (Issue I4a)
                    let commaCount = 0;
                    let valParenDepth = 0;
                    for (let k = valuesIdx; k < priorTokens.length; k++) {
                        const tok = priorTokens[k];
                        if (tok.value === '(') {
                            valParenDepth++;
                        } else if (tok.value === ')') {
                            valParenDepth--;
                        } else if (tok.value === ',' && valParenDepth === 1) {
                            commaCount++;
                        }
                    }
                    if (valParenDepth > 0) {
                        result.isValues = true;
                        result.valueColumnIndex = commaCount;
                    }
                }
            }
        }

        // ── B. UPDATE STATEMENTS ─────────────────────────────────────────────
        if (firstKeyword === 'UPDATE') {
            result.isUpdate = true;
            const updateIdx = stmtTokens.indexOf(firstKeywordTok);
            let j = updateIdx + 1;

            // Collect target table name (id or schema.id)
            let tableParts = [];
            while (j < stmtTokens.length) {
                const tok = stmtTokens[j];
                const up = (tok.upper || tok.value).toUpperCase();
                if (up === 'SET' || tok.value === ';' || (tok.type === 'PUNCTUATION' && tok.value !== '.')) {
                    break;
                }
                if (tok.type === 'IDENTIFIER' || tok.type === 'PARAMETER' || tok.type === 'KEYWORD') {
                    tableParts.push(cleanIdentifier(tok.value));
                    j++;
                    if (j < stmtTokens.length && stmtTokens[j].value === '.') {
                        j++; // skip dot
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            if (tableParts.length > 0) {
                let schemaName = '';
                let tableName = '';
                if (tableParts.length === 1) {
                    tableName = tableParts[0];
                } else {
                    schemaName = tableParts[tableParts.length - 2];
                    tableName = tableParts[tableParts.length - 1];
                }
                result.targetTable = { schema: schemaName, table: tableName };
            }

            // Check optional alias before SET
            let alias = '';
            while (j < stmtTokens.length) {
                const up = (stmtTokens[j].upper || stmtTokens[j].value).toUpperCase();
                if (up === 'SET') break;
                if (up !== 'AS' && stmtTokens[j].type === 'IDENTIFIER') {
                    alias = cleanIdentifier(stmtTokens[j].value);
                }
                j++;
            }
            if (alias && result.targetTable) {
                result.targetTable.alias = alias;
            }

            // Find SET keyword index
            const setIdx = stmtTokens.findIndex(t => (t.upper || t.value).toUpperCase() === 'SET');
            if (setIdx === -1 || cursorIndex < stmtTokens[setIdx].start) {
                result.isUpdateTarget = true;
            } else {
                // Cursor is after SET
                // Check if there is FROM / WHERE / OUTPUT following SET
                const endSetKeywords = ['FROM', 'WHERE', 'OUTPUT'];
                const endSetIdx = stmtTokens.findIndex((t, idx) => idx > setIdx && endSetKeywords.includes((t.upper || t.value).toUpperCase()));
                const isBeforeEndSet = (endSetIdx === -1 || cursorIndex < stmtTokens[endSetIdx].start);

                if (isBeforeEndSet) {
                    // Cursor is in SET clause
                    // Determine if cursor is at column name position or value expression position
                    let lastNonWordTok = null;
                    for (let k = priorTokens.length - 1; k >= setIdx; k--) {
                        const tok = priorTokens[k];
                        const isCurrentTypingWord = (cursorIndex >= tok.start && cursorIndex <= tok.end && (tok.type === 'IDENTIFIER' || tok.type === 'KEYWORD'));
                        if (!isCurrentTypingWord) {
                            lastNonWordTok = tok;
                            break;
                        }
                    }

                    const lastVal = lastNonWordTok ? lastNonWordTok.value : '';
                    const lastUpper = lastNonWordTok ? (lastNonWordTok.upper || lastNonWordTok.value).toUpperCase() : '';

                    if (lastVal === '=' || ['+', '-', '*', '/', '%', 'CASE', 'WHEN', 'THEN'].includes(lastUpper)) {
                        result.isUpdateSetValue = true;
                    } else {
                        result.isUpdateSet = true;
                    }

                    // Collect all columns already assigned (col = expr) before cursor
                    const assignedCols = [];
                    for (let k = setIdx + 1; k < priorTokens.length; k++) {
                        if (priorTokens[k].value === '=') {
                            // Token immediately preceding '=' is the column
                            let prevIdx = k - 1;
                            if (prevIdx >= setIdx + 1) {
                                const colTok = priorTokens[prevIdx];
                                if (colTok.type === 'IDENTIFIER' || colTok.type === 'KEYWORD') {
                                    assignedCols.push(cleanIdentifier(colTok.value));
                                }
                            }
                        }
                    }
                    result.alreadyListed = assignedCols.map(c => c.toLowerCase());
                }
            }
        }

        return result;
    }

    function detectExecContext(codeTokens) {
        if (!codeTokens || codeTokens.length === 0) {
            return { isExec: false, procedureName: "", procedureSchema: "", isParameterPosition: false };
        }

        let execIdx = -1;
        for (let i = codeTokens.length - 1; i >= 0; i--) {
            const up = (codeTokens[i].upper || codeTokens[i].value).toUpperCase();
            if (up === 'EXEC' || up === 'EXECUTE') {
                execIdx = i;
                break;
            }
            if (codeTokens[i].value === ';' || up === 'GO') break;
        }

        if (execIdx === -1) {
            return { isExec: false, procedureName: "", procedureSchema: "", isParameterPosition: false };
        }

        let j = execIdx + 1;
        // Skip return status variable if present: EXEC @return_status = proc
        if (j + 1 < codeTokens.length && codeTokens[j].value.startsWith('@') && codeTokens[j + 1].value === '=') {
            j += 2;
        }

        let parts = [];
        let hasTrailingDot = false;
        while (j < codeTokens.length) {
            const tk = codeTokens[j];
            if (tk.value === '.' || tk.type === 'IDENTIFIER' || tk.type === 'KEYWORD') {
                if (tk.value !== '.') {
                    parts.push(cleanIdentifier(tk.value));
                    hasTrailingDot = false;
                }
                j++;
                if (j < codeTokens.length && codeTokens[j].value === '.') {
                    hasTrailingDot = true;
                    j++;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        let procName = "";
        let procSchema = "";
        if (hasTrailingDot) {
            procSchema = parts.length > 0 ? parts[parts.length - 1] : "";
            procName = "";
        } else if (parts.length === 1) {
            procName = parts[0];
        } else if (parts.length >= 2) {
            procSchema = parts[parts.length - 2];
            procName = parts[parts.length - 1];
        }

        const isParameterPosition = Boolean(procName && !hasTrailingDot && j < codeTokens.length);

        return {
            isExec: true,
            procedureName: procName,
            procedureSchema: procSchema,
            isParameterPosition: isParameterPosition
        };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 7b. DATA TYPE CONTEXT DETECTION (Issue I3)
    // ─────────────────────────────────────────────────────────────────────────────
    function detectDataTypeContext(codeTokens, currentWord, fullCodeTokens, cursorIndex) {
        if (!codeTokens || codeTokens.length === 0) {
            return { isDataTypePosition: false, dataTypeTarget: null };
        }

        let lastIdx = codeTokens.length - 1;
        if (lastIdx >= 0 && currentWord && codeTokens[lastIdx].value === currentWord) {
            lastIdx--;
        }

        if (lastIdx < 0) {
            return { isDataTypePosition: false, dataTypeTarget: null };
        }

        const lastTok = codeTokens[lastIdx];
        const lastUpper = (lastTok.upper || lastTok.value || '').toUpperCase();
        const lastVal = lastTok.value || '';

        // Rule 1: After '::' (PostgreSQL cast operator, e.g. SELECT id::‸ or id::int‸)
        if (lastVal === '::' || (lastTok.type === 'OPERATOR' && lastVal === '::')) {
            return { isDataTypePosition: true, dataTypeTarget: 'PG_CAST' };
        }

        // Rule 2: After 'AS' inside CAST( / TRY_CAST( (e.g. SELECT CAST(OrderID AS ‸) FROM dbo.Orders)
        if (lastUpper === 'AS') {
            let depth = 0;
            for (let p = lastIdx - 1; p >= 0; p--) {
                const tok = codeTokens[p];
                if (tok.value === ')') {
                    depth++;
                } else if (tok.value === '(') {
                    depth--;
                    if (depth < 0) {
                        if (p > 0) {
                            const fnName = (codeTokens[p - 1].upper || codeTokens[p - 1].value || '').toUpperCase();
                            if (fnName === 'CAST' || fnName === 'TRY_CAST') {
                                return { isDataTypePosition: true, dataTypeTarget: 'CAST' };
                            }
                        }
                        break;
                    }
                }
            }
        }

        // Rule 3: First argument of CONVERT( / TRY_CONVERT( (e.g. SELECT CONVERT(‸, OrderID) FROM dbo.Orders)
        let depth = 0;
        let commaCount = 0;
        for (let p = lastIdx; p >= 0; p--) {
            const tok = codeTokens[p];
            if (tok.value === ')') {
                depth++;
            } else if (tok.value === ',') {
                if (depth === 0) commaCount++;
            } else if (tok.value === '(') {
                if (depth === 0) {
                    if (p > 0) {
                        const fnName = (codeTokens[p - 1].upper || codeTokens[p - 1].value || '').toUpperCase();
                        if ((fnName === 'CONVERT' || fnName === 'TRY_CONVERT') && commaCount === 0) {
                            return { isDataTypePosition: true, dataTypeTarget: 'CONVERT' };
                        }
                    }
                    break;
                } else {
                    depth--;
                }
            }
        }

        // Rule 4: After DECLARE @x [AS] (e.g. DECLARE @x ‸) or CREATE PROC/FUNC (@p ‸
        let checkIdx = lastIdx;
        if (lastUpper === 'AS' && checkIdx > 0) {
            checkIdx--;
        }
        const targetTok = codeTokens[checkIdx];
        if (targetTok && (targetTok.type === 'PARAMETER' || (targetTok.value && targetTok.value.startsWith('@')))) {
            let inDeclare = false;
            let dDepth = 0;
            for (let p = checkIdx - 1; p >= 0; p--) {
                const tok = codeTokens[p];
                if (tok.value === ')') dDepth++;
                else if (tok.value === '(') dDepth--;
                else if (dDepth === 0) {
                    const u = (tok.upper || tok.value || '').toUpperCase();
                    if (u === ';' || u === 'GO' || u === 'BEGIN') break;
                    if (u === 'DECLARE') {
                        inDeclare = true;
                        break;
                    }
                    if (u === 'PROCEDURE' || u === 'PROC' || u === 'FUNCTION') {
                        return { isDataTypePosition: true, dataTypeTarget: 'ROUTINE_PARAM' };
                    }
                }
            }
            if (inDeclare) {
                return { isDataTypePosition: true, dataTypeTarget: 'DECLARE' };
            }
        }

        // Rule 6: After RETURNS (e.g. CREATE FUNCTION fn() RETURNS ‸)
        if (lastUpper === 'RETURNS') {
            return { isDataTypePosition: true, dataTypeTarget: 'RETURNS' };
        }

        // Rule 5: Column definition in CREATE TABLE (...), @t TABLE (...), or ALTER TABLE ... ADD col ‸
        if (lastTok.type === 'IDENTIFIER' || lastTok.type === 'KEYWORD') {
            const nonColWords = new Set(['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'CHECK', 'UNIQUE', 'KEY', 'INDEX', 'DEFAULT', 'NULL', 'NOT', 'AS', 'SET', 'WHERE', 'AND', 'OR', 'SELECT', 'FROM']);
            if (!nonColWords.has(lastUpper)) {
                if (lastIdx > 0) {
                    const prevTok = codeTokens[lastIdx - 1];
                    const prevUp = (prevTok.upper || prevTok.value || '').toUpperCase();
                    if (prevUp === 'ADD' || prevUp === 'COLUMN') {
                        return { isDataTypePosition: true, dataTypeTarget: 'TABLE_COLUMN' };
                    }
                    if (prevTok.value === '(' || prevTok.value === ',') {
                        let tDepth = 0;
                        for (let p = lastIdx - 1; p >= 0; p--) {
                            const tok = codeTokens[p];
                            if (tok.value === ')') tDepth++;
                            else if (tok.value === '(') {
                                tDepth--;
                                if (tDepth < 0) {
                                    if (p > 0) {
                                        const pWord = (codeTokens[p - 1].upper || codeTokens[p - 1].value || '').toUpperCase();
                                        if (pWord === 'TABLE' || (p > 1 && (codeTokens[p - 2].upper || codeTokens[p - 2].value || '').toUpperCase() === 'TABLE')) {
                                            return { isDataTypePosition: true, dataTypeTarget: 'TABLE_COLUMN' };
                                        }
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        return { isDataTypePosition: false, dataTypeTarget: null };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 8. MAIN CONTEXT ANALYZER (analyze)
    // ─────────────────────────────────────────────────────────────────────────────
    function analyze(fullSql, cursorIndex, dialect = '') {
        fullSql = fullSql || "";
        cursorIndex = (cursorIndex !== undefined && cursorIndex !== null) ? cursorIndex : fullSql.length;
        const textBeforeCursor = fullSql.substring(0, cursorIndex);

        const tokenizer = getTokenizer();
        let currentWord = "";
        let qualifier = "";
        let fullQualifier = "";
        let qualifierParts = [];
        let qualifierStartOffset = cursorIndex;
        let triggerChar = "";
        let previousToken = "";
        let previousTokens = [];
        let isPrecedingOperator = false;
        let precedingOperator = null;
        let onLeftOperand = null;
        let clause = "";
        let alterContext = { isAlter: false, action: "", alterType: "" };
        let execContext = { isExec: false, procedureName: "", procedureSchema: "", isParameterPosition: false };
        let routineContext = { isInRoutine: false, isRoutineBody: false, routineType: "", routineName: "" };
        let dataTypeContext = { isDataTypePosition: false, dataTypeTarget: null };
        let statementRange = { start: 0, end: fullSql.length };
        let stmtInfo = { start: 0, end: fullSql.length, text: fullSql };
        let isInsideComment = false;
        let isInsideString = false;
        let isQuotedIdentifier = false;
        let quoteChar = '';
        let closeQuoteChar = '';
        let isUnterminatedQuote = false;
        let hasClosingQuoteAfterCursor = false;
        let tokenStartOffset = cursorIndex;
        let tokenEndOffset = cursorIndex;
        let prefixRange = { start: cursorIndex, end: cursorIndex };
        let replacementRange = { start: cursorIndex, end: cursorIndex };

        let fullTokens = null;
        let fullCodeTokens = [];

        if (tokenizer) {
            if (fullSql === _lastFullSql && _lastFullTokens) {
                fullTokens = _lastFullTokens;
                fullCodeTokens = _lastFullCodeTokens;
            } else {
                fullTokens = tokenizer.tokenize(fullSql);
                fullCodeTokens = tokenizer.filterCodeTokens(fullTokens);
                _lastFullSql = fullSql;
                _lastFullTokens = fullTokens;
                _lastFullCodeTokens = fullCodeTokens;
                _lastSortedBoundaries = null;
            }

            // 0. Detect Comment / String Literal isolation (Plan Section 20, 21, 22)
            for (let i = 0; i < fullTokens.length; i++) {
                const tok = fullTokens[i];
                if (tok.start <= cursorIndex && cursorIndex <= tok.end) {
                    if (tok.type === 'COMMENT_LINE' || tok.type === 'COMMENT_BLOCK') {
                        isInsideComment = true;
                        break;
                    }
                    if (tok.type === 'STRING') {
                        // Check if this string is a PostgreSQL routine body: AS 'BEGIN ...'
                        let isRoutineBodyString = false;
                        for (let b = i - 1; b >= 0; b--) {
                            if (fullTokens[b].type === 'WHITESPACE') continue;
                            const prevUp = (fullTokens[b].upper || fullTokens[b].value).toUpperCase();
                            if (prevUp === 'AS') {
                                isRoutineBodyString = true;
                            }
                            break;
                        }
                        if (!isRoutineBodyString) {
                            // Inside quotes or unclosed string
                            if (cursorIndex > tok.start && (cursorIndex < tok.end || !tok.value.endsWith("'") || tok.value.length === 1)) {
                                isInsideString = true;
                                break;
                            }
                        }
                    }
                }
            }

            // 1. Statement Boundary
            stmtInfo = detectStatementBoundary(fullSql, cursorIndex, fullTokens);
            statementRange = { start: stmtInfo.start, end: stmtInfo.end };

            // 2. Tokenize text up to cursor (Single tokenization slicing, Issue I1)
            const allTokens = [];
            for (let i = 0; i < fullTokens.length; i++) {
                const t = fullTokens[i];
                if (t.end <= cursorIndex) {
                    allTokens.push(t);
                } else if (t.start < cursorIndex) {
                    const val = fullSql.substring(t.start, cursorIndex);
                    allTokens.push({
                        ...t,
                        end: cursorIndex,
                        value: val,
                        upper: val.toUpperCase()
                    });
                    break;
                } else {
                    break;
                }
            }
            const codeTokens = tokenizer.filterCodeTokens(allTokens);

            // 3. Current token and dot-qualifier
            // Check raw characters immediately preceding cursor to accurately detect trailing dot or @
            const trimmedBefore = textBeforeCursor.trimEnd();
            if (trimmedBefore.endsWith('.')) {
                triggerChar = '.';
            } else if (trimmedBefore.endsWith('@')) {
                triggerChar = '@';
            } else if (trimmedBefore.endsWith('#')) {
                triggerChar = '#';
            }

            tokenStartOffset = cursorIndex;
            tokenEndOffset = cursorIndex;

            if (allTokens.length > 0) {
                const lastTok = allTokens[allTokens.length - 1];
                if (lastTok.type === 'WHITESPACE') {
                    currentWord = "";
                    tokenStartOffset = cursorIndex;
                    tokenEndOffset = cursorIndex;
                } else if (lastTok.value === '.') {
                    triggerChar = '.';
                    currentWord = "";
                    tokenStartOffset = cursorIndex;
                    tokenEndOffset = cursorIndex;
                } else if (lastTok.type === 'PUNCTUATION' || lastTok.type === 'OPERATOR') {
                    currentWord = "";
                    tokenStartOffset = cursorIndex;
                    tokenEndOffset = cursorIndex;
                } else {
                    currentWord = cleanIdentifier(lastTok.value);
                    tokenStartOffset = lastTok.start;
                    tokenEndOffset = lastTok.end;

                    if (lastTok.isQuoted) {
                        isQuotedIdentifier = true;
                        quoteChar = lastTok.quoteChar || '';
                        closeQuoteChar = lastTok.closeQuoteChar || (quoteChar === '[' ? ']' : quoteChar);
                        isUnterminatedQuote = !lastTok.terminated;
                    } else if (lastTok.value.startsWith('[') || lastTok.value.startsWith('"') || lastTok.value.startsWith('`')) {
                        isQuotedIdentifier = true;
                        quoteChar = lastTok.value[0];
                        closeQuoteChar = quoteChar === '[' ? ']' : quoteChar;
                        isUnterminatedQuote = !lastTok.value.endsWith(closeQuoteChar) || lastTok.value.length === 1;
                    }
                }
            }

            // Check if there is already a closing quote immediately after cursor (e.g. [Cus|])
            hasClosingQuoteAfterCursor = false;
            if (closeQuoteChar) {
                const textAfterCursor = fullSql.substring(cursorIndex);
                if (textAfterCursor.startsWith(closeQuoteChar)) {
                    hasClosingQuoteAfterCursor = true;
                    tokenEndOffset = cursorIndex + closeQuoteChar.length;
                }
            }

            prefixRange = { start: tokenStartOffset, end: cursorIndex };
            replacementRange = { start: tokenStartOffset, end: tokenEndOffset };

            // Find qualifier chain if triggerChar is dot or if previous token was dot
            if (codeTokens.length > 0) {
                let dotIdx = -1;
                const lastTokIdx = codeTokens.length - 1;
                if (codeTokens[lastTokIdx].value === '.') {
                    dotIdx = lastTokIdx;
                } else if (lastTokIdx >= 1 && codeTokens[lastTokIdx - 1].value === '.') {
                    dotIdx = lastTokIdx - 1;
                }

                if (dotIdx >= 0) {
                    if (dotIdx > 0) {
                        const prevCodeTok = codeTokens[dotIdx - 1];
                        if (prevCodeTok && (prevCodeTok.type === 'NUMBER' || /^\d+$/.test(prevCodeTok.value))) {
                            // Numeric literal (e.g. 10.), not a table/alias qualifier (Section 18)
                            triggerChar = '';
                            qualifier = '';
                        } else {
                            triggerChar = '.';
                            // Multi-part qualifier chain: server.db.schema.table
                            // Also handles double-dot e.g. server.database..
                            let parts = [];
                            let firstPartIdx = dotIdx;
                            let p = dotIdx;
                            while (p >= 0) {
                                if (codeTokens[p].value === '.') {
                                    p--;
                                    if (p >= 0 && codeTokens[p].value === '.') {
                                        // consecutive dots e.g. '..'
                                        parts.unshift('');
                                        firstPartIdx = p;
                                        p--;
                                    }
                                } else if (codeTokens[p].type === 'IDENTIFIER' || codeTokens[p].type === 'KEYWORD' || codeTokens[p].type === 'PARAMETER') {
                                    firstPartIdx = p;
                                    parts.unshift(cleanIdentifier(codeTokens[p].value));
                                    p--;
                                    if (p >= 0 && codeTokens[p].value === '.') {
                                        // continue to next dot
                                    } else {
                                        break;
                                    }
                                } else {
                                    break;
                                }
                            }
                            qualifierParts = parts;
                            fullQualifier = parts.join('.');
                            qualifier = parts.length > 0 ? parts[parts.length - 1] : '';
                            qualifierStartOffset = codeTokens[firstPartIdx].start;
                        }
                    }
                }
            }

            // 4. Preceding tokens for follow-up detection
            const nonPunct = codeTokens.filter(t => t.type === 'KEYWORD' || t.type === 'IDENTIFIER');
            if (nonPunct.length > 0) {
                previousTokens = nonPunct.slice(-3).map(t => (t.upper || t.value).toUpperCase());
                previousToken = previousTokens[previousTokens.length - 1];
            }

            // 4b. Preceding operator & ON clause left-hand operand detection (Issue I6)
            if (codeTokens.length > 0) {
                let lastIdx = codeTokens.length - 1;
                if (currentWord && codeTokens[lastIdx].value === currentWord) {
                    lastIdx--;
                }
                if (lastIdx >= 0) {
                    const lastCode = codeTokens[lastIdx];
                    if (lastCode.type === 'OPERATOR') {
                        isPrecedingOperator = true;
                        precedingOperator = lastCode.value;

                        if (precedingOperator === '=' && lastIdx > 0) {
                            let opCol = '';
                            let opTable = '';
                            let p = lastIdx - 1;
                            if (p >= 0 && (codeTokens[p].type === 'IDENTIFIER' || codeTokens[p].type === 'KEYWORD')) {
                                opCol = cleanIdentifier(codeTokens[p].value);
                                p--;
                                if (p >= 0 && codeTokens[p].value === '.') {
                                    p--;
                                    if (p >= 0 && (codeTokens[p].type === 'IDENTIFIER' || codeTokens[p].type === 'KEYWORD')) {
                                        opTable = cleanIdentifier(codeTokens[p].value);
                                    }
                                }
                            }
                            if (opCol) {
                                onLeftOperand = { tableOrAlias: opTable, column: opCol };
                            }
                        }
                    }
                }
            }

            // 5. Clause Detection
            clause = detectClauseFromTokens(codeTokens, cursorIndex, statementRange.start);

            // 6. ALTER, EXEC, ROUTINE & DATA TYPE Context Detection
            alterContext = detectAlterContext(textBeforeCursor, codeTokens);
            execContext = detectExecContext(codeTokens);
            routineContext = detectRoutineContext(codeTokens, textBeforeCursor, fullCodeTokens);
            dataTypeContext = detectDataTypeContext(codeTokens, currentWord, fullCodeTokens, cursorIndex);

            if (routineContext && routineContext.isRoutineBody) {
                alterContext = { isAlter: false, action: "", alterType: "" };
            }

        } else {
            // Fallback if tokenizer not yet loaded
            const tokenMatch = textBeforeCursor.match(/([\[\]"\w\.#@]*)$/);
            const rawToken = tokenMatch ? tokenMatch[1] : "";

            if (rawToken.includes(".")) {
                const parts = rawToken.split(".");
                currentWord = cleanIdentifier(parts[parts.length - 1]);
                qualifier = cleanIdentifier(parts[parts.length - 2]);
                fullQualifier = parts.slice(0, -1).map(cleanIdentifier).join(".");
                triggerChar = ".";
            } else {
                currentWord = cleanIdentifier(rawToken);
                triggerChar = rawToken.startsWith('@') ? '@' : (rawToken.startsWith('#') ? '#' : "");
            }

            const textPrior = rawToken ? textBeforeCursor.substring(0, textBeforeCursor.length - rawToken.length) : textBeforeCursor;
            const precedingWords = textPrior.match(/([a-zA-Z0-9_#@]+)/g) || [];
            previousTokens = precedingWords.slice(-3).map(w => w.toUpperCase());
            previousToken = previousTokens.length > 0 ? previousTokens[previousTokens.length - 1] : "";
            clause = detectClause(textBeforeCursor);
            alterContext = detectAlterContext(textBeforeCursor);
            routineContext = detectRoutineContext([], textBeforeCursor);
            if (routineContext && routineContext.isRoutineBody) {
                alterContext = { isAlter: false, action: "", alterType: "" };
            }

            let isDt = false;
            let dtTarget = null;
            if (/::\s*[a-zA-Z0-9_]*$/i.test(textBeforeCursor)) {
                isDt = true; dtTarget = 'PG_CAST';
            } else if (/\b(?:CAST|TRY_CAST)\s*\([^)]*\bAS\s+[a-zA-Z0-9_]*$/i.test(textBeforeCursor)) {
                isDt = true; dtTarget = 'CAST';
            } else if (/\b(?:CONVERT|TRY_CONVERT)\s*\(\s*[a-zA-Z0-9_]*$/i.test(textBeforeCursor)) {
                isDt = true; dtTarget = 'CONVERT';
            } else if (/\bDECLARE\s+@[a-zA-Z0-9_#$]+\s*(?:AS\s+)?[a-zA-Z0-9_]*$/i.test(textBeforeCursor)) {
                isDt = true; dtTarget = 'DECLARE';
            } else if (/\bRETURNS\s+[a-zA-Z0-9_]*$/i.test(textBeforeCursor)) {
                isDt = true; dtTarget = 'RETURNS';
            }
            dataTypeContext = { isDataTypePosition: isDt, dataTypeTarget: dtTarget };
        }

        // 7. Follow-up keywords check
        let hasFollowUp = false;
        let followUpKeywords = [];

        if (previousTokens.length >= 3) {
            const threeKey = `${previousTokens[previousTokens.length - 3]} ${previousTokens[previousTokens.length - 2]} ${previousTokens[previousTokens.length - 1]}`;
            if (FOLLOW_UP_KEYWORDS[threeKey]) {
                hasFollowUp = true;
                followUpKeywords = FOLLOW_UP_KEYWORDS[threeKey];
            }
        }

        if (!hasFollowUp && previousTokens.length >= 2) {
            const twoKey = `${previousTokens[previousTokens.length - 2]} ${previousTokens[previousTokens.length - 1]}`;
            if (FOLLOW_UP_KEYWORDS[twoKey]) {
                hasFollowUp = true;
                followUpKeywords = FOLLOW_UP_KEYWORDS[twoKey];
            }
        }

        if (!hasFollowUp && previousToken && FOLLOW_UP_KEYWORDS[previousToken]) {
            if (previousToken === 'BEGIN') {
                const prev2 = previousTokens.length >= 2 ? previousTokens[previousTokens.length - 2] : '';
                const isRoutineOrBlockBegin = (prev2 === 'AS' || prev2 === 'TRY' || prev2 === 'CATCH' || prev2 === 'ELSE' || prev2 === 'THEN' || (routineContext && routineContext.isRoutineBody));
                if (!isRoutineOrBlockBegin) {
                    hasFollowUp = true;
                    followUpKeywords = FOLLOW_UP_KEYWORDS[previousToken];
                }
            } else {
                hasFollowUp = true;
                followUpKeywords = FOLLOW_UP_KEYWORDS[previousToken];
            }
        }

        // Phase 4: DML Context Detection (INSERT INTO & UPDATE SET)
        let dmlContext = {
            isInsert: false,
            isInsertTarget: false,
            isInsertColumns: false,
            isValues: false,
            valueColumnIndex: -1,
            isUpdate: false,
            isUpdateTarget: false,
            isUpdateSet: false,
            isUpdateSetValue: false,
            targetTable: null,
            alreadyListed: [],
            insertColumns: []
        };
        if (tokenizer && fullCodeTokens.length > 0) {
            dmlContext = extractDmlContext(fullCodeTokens, cursorIndex, statementRange, currentWord);
        }

        // 8. Standardize Context Type (Section 11)
        let contextType = IntelliSenseContextType.KEYWORD;
        if (dataTypeContext.isDataTypePosition) {
            contextType = IntelliSenseContextType.DATA_TYPE;
        } else if (alterContext.isAlter) {
            contextType = IntelliSenseContextType.ALTER_OBJECT;
        } else if (execContext.isExec) {
            contextType = execContext.procedureName ? IntelliSenseContextType.PARAMETER : IntelliSenseContextType.PROCEDURE;
        } else if (triggerChar === '@' || (currentWord && currentWord.startsWith('@'))) {
            contextType = IntelliSenseContextType.PARAMETER;
        } else if (triggerChar === '#' || (currentWord && currentWord.startsWith('#'))) {
            contextType = IntelliSenseContextType.TABLE;
        } else if (qualifier) {
            contextType = IntelliSenseContextType.COLUMN;
        } else if (dmlContext.isInsertColumns) {
            clause = 'INSERT_COLUMNS';
            contextType = IntelliSenseContextType.COLUMN;
        } else if (dmlContext.isInsertTarget) {
            clause = 'INSERT INTO';
            contextType = IntelliSenseContextType.TABLE;
        } else if (dmlContext.isUpdateSet) {
            clause = 'SET';
            contextType = IntelliSenseContextType.COLUMN;
        } else if (dmlContext.isUpdateTarget) {
            clause = 'UPDATE';
            contextType = IntelliSenseContextType.TABLE;
        } else if (clause === 'SELECT' || clause === 'OUTPUT' || clause === 'RETURNING') {
            contextType = IntelliSenseContextType.COLUMN;
        } else if (dmlContext.isValues) {
            clause = 'VALUES';
            contextType = IntelliSenseContextType.COLUMN;
        } else if (clause === 'FROM' || clause === 'JOIN' || clause === 'USING' || clause === 'MERGE' || clause === 'MERGE INTO') {
            contextType = IntelliSenseContextType.TABLE;
        } else if (clause === 'WHERE' || clause === 'ON' || clause === 'HAVING') {
            contextType = IntelliSenseContextType.COLUMN;
        } else if (clause === 'ORDER BY') {
            contextType = IntelliSenseContextType.ORDER_COLUMN;
        } else if (clause === 'GROUP BY') {
            contextType = IntelliSenseContextType.GROUP_COLUMN;
        } else if (clause === 'EXEC' || clause === 'EXECUTE') {
            contextType = IntelliSenseContextType.PROCEDURE;
        }

        if (isInsideComment) {
            contextType = 'comment';
            currentWord = '';
            qualifier = '';
            triggerChar = '';
        } else if (isInsideString) {
            contextType = 'string';
            currentWord = '';
            qualifier = '';
            triggerChar = '';
        }

        // 9. Local script objects & table aliases
        let localTempTables = extractLocalTempTables(fullSql, fullTokens);
        let localTableVars = extractLocalTableVars(fullSql, fullTokens);
        let localVariables = [];
        let ctes = [];
        let aliasMap = {};
        let queryTables = [];
        let activeScope = null;
        let resolvedObject = null;

        if (window.DefaultScopeResolver && tokenizer) {
            const allCodeTokens = fullCodeTokens;
            const rootScope = window.DefaultScopeResolver.buildScopeTree(allCodeTokens, fullSql.length, cursorIndex, statementRange);
            activeScope = window.DefaultScopeResolver.getScopeAt(rootScope, cursorIndex);

            if (activeScope) {
                queryTables = activeScope.getAllVisibleTables();
                const visibleSymbols = activeScope.getAllVisibleSymbols();
                visibleSymbols.forEach((sym, k) => {
                    aliasMap[k] = sym.toContextObject();
                });

                // Enrich any query table that lacks columns from visible symbols
                queryTables.forEach(qt => {
                    if ((!qt.columns || qt.columns.length === 0) && visibleSymbols) {
                        const s = visibleSymbols.get((qt.table || '').toLowerCase()) || (qt.alias ? visibleSymbols.get(qt.alias.toLowerCase()) : null);
                        if (s && s.columns && Array.isArray(s.columns) && s.columns.length > 0) {
                            qt.columns = s.columns;
                            if (s.type) qt.type = s.type;
                            if (s.underlyingTables && (!qt.underlyingTables || qt.underlyingTables.length === 0)) {
                                qt.underlyingTables = s.underlyingTables;
                            }
                        }
                    }
                });

                ctes = activeScope.getSymbolsByType('cte');
                localVariables = activeScope.getSymbolsByType('scalar_variable');
                const scopeTableVars = activeScope.getSymbolsByType('table_variable');
                if (scopeTableVars.length > 0) {
                    localTableVars = [...new Set([...localTableVars, ...scopeTableVars.map(v => v.name)])];
                }
                const scopeTempTables = activeScope.getSymbolsByType('temp_table');
                if (scopeTempTables.length > 0) {
                    localTempTables = [...new Set([...localTempTables, ...scopeTempTables.map(t => t.name)])];
                }
            }

            if (fullQualifier || qualifier) {
                resolvedObject = window.DefaultScopeResolver.resolveQualifier(fullQualifier || qualifier, activeScope);
            }
        }

        function isLegacyScopeEnabled() {
            try {
                if (typeof window !== 'undefined' && window.__USE_LEGACY_SCOPE__) return true;
                if (typeof localStorage !== 'undefined' && localStorage.getItem('intellisense.v2.legacyScope') === 'true') return true;
            } catch (_) {}
            return false;
        }

        // Phase 3 & Phase 6: ScopeResolver is the primary scope provider.
        // Legacy regex functions only run if activeScope is absent or when intellisense.v2.legacyScope flag is enabled.
        if (isLegacyScopeEnabled() || !activeScope) {
            if ((clause === 'SELECT' && statementRange) || ((clause === 'SET' || dmlContext.isUpdateSet || dmlContext.isUpdateSetValue) && statementRange)) {
                const stmtText = fullSql.substring(statementRange.start, statementRange.end);
                const forwardTables = extractAllTablesInQuery(stmtText);
                const forwardAliases = extractAliases(stmtText);

                forwardTables.forEach(ft => {
                    const key = `${(ft.schema || '').toLowerCase()}::${ft.table.toLowerCase()}`;
                    if (!queryTables.some(qt => `${(qt.schema || '').toLowerCase()}::${qt.table.toLowerCase()}` === key)) {
                        queryTables.push(ft);
                    }
                });

                Object.keys(forwardAliases).forEach(ak => {
                    if (!aliasMap[ak]) {
                        aliasMap[ak] = forwardAliases[ak];
                    }
                });
            }

            // Fallbacks if activeScope did not populate tables/aliases:
            if (queryTables.length === 0) {
                queryTables = extractAllTablesInQuery(stmtInfo.text || fullSql);
            }
            if (Object.keys(aliasMap).length === 0) {
                aliasMap = extractAliases(stmtInfo.text || fullSql);
            }
        } else {
            // Safety fallback only if activeScope produced 0 tables
            if (queryTables.length === 0) {
                queryTables = extractAllTablesInQuery(stmtInfo.text || fullSql);
            }
            if (Object.keys(aliasMap).length === 0) {
                aliasMap = extractAliases(stmtInfo.text || fullSql);
            }
        }

        // Phase 4: Bind DML target table into queryTables if present
        if (dmlContext.targetTable && dmlContext.targetTable.table) {
            const dtKey = `${(dmlContext.targetTable.schema || '').toLowerCase()}::${dmlContext.targetTable.table.toLowerCase()}`;
            if (!queryTables.some(qt => `${(qt.schema || '').toLowerCase()}::${qt.table.toLowerCase()}` === dtKey)) {
                queryTables.push({
                    schema: dmlContext.targetTable.schema || '',
                    table: dmlContext.targetTable.table,
                    alias: dmlContext.targetTable.alias || ''
                });
            }
        }

        // Phase 4b: Bind Trigger target table into queryTables if present
        if (routineContext && routineContext.triggerTable && routineContext.triggerTable.table) {
            const trKey = `${(routineContext.triggerTable.schema || '').toLowerCase()}::${routineContext.triggerTable.table.toLowerCase()}`;
            if (!queryTables.some(qt => `${(qt.schema || '').toLowerCase()}::${qt.table.toLowerCase()}` === trKey)) {
                queryTables.push({
                    schema: routineContext.triggerTable.schema || '',
                    table: routineContext.triggerTable.table,
                    alias: ''
                });
            }
        }

        const selectAliases = extractSelectAliases(fullSql, statementRange, fullTokens);

        return {
            dialect: dialect || '',
            fullSql,
            currentWord,
            rawToken: currentWord,
            qualifier,
            fullQualifier,
            qualifierParts,
            resolvedObject,
            activeScope,
            triggerChar,
            clause,
            contextType,
            isDataTypePosition: Boolean(dataTypeContext.isDataTypePosition),
            dataTypeTarget: dataTypeContext.dataTypeTarget || null,
            previousToken,
            previousTokens,
            isPrecedingOperator,
            precedingOperator,
            onLeftOperand,
            hasFollowUp,
            followUpKeywords,
            aliasMap,
            queryTables,
            ctes,
            localVariables,
            localTempTables,
            localTableVars,
            execContext,
            isAlterContext: alterContext.isAlter,
            alterObjectType: alterContext.alterType,
            alterAction: alterContext.action || '',
            alterStartOffset: typeof alterContext.actionStart === 'number' ? alterContext.actionStart : -1,
            isInRoutine: routineContext ? routineContext.isInRoutine : false,
            isInRoutineBody: routineContext ? routineContext.isRoutineBody : false,
            routineType: routineContext ? routineContext.routineType : '',
            routineName: routineContext ? routineContext.routineName : '',
            triggerTable: routineContext ? routineContext.triggerTable : null,
            cursorIndex,
            statementRange,
            isInsideComment,
            isInsideString,
            isQuotedIdentifier,
            quoteChar,
            closeQuoteChar,
            isUnterminatedQuote,
            hasClosingQuoteAfterCursor,
            prefixRange,
            replacementRange,
            qualifierStartOffset,
            selectAliases,
            // Phase 4 DML additions:
            isInsert: dmlContext.isInsert,
            isInsertTarget: dmlContext.isInsertTarget,
            isInsertColumns: dmlContext.isInsertColumns,
            isValues: dmlContext.isValues,
            valueColumnIndex: dmlContext.valueColumnIndex,
            isUpdate: dmlContext.isUpdate,
            isUpdateTarget: dmlContext.isUpdateTarget,
            isUpdateSet: dmlContext.isUpdateSet,
            isUpdateSetValue: dmlContext.isUpdateSetValue,
            targetTable: dmlContext.targetTable,
            alreadyListed: dmlContext.alreadyListed || [],
            insertColumns: dmlContext.insertColumns || []
        };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 9. PUBLIC EXPORTS
    // ─────────────────────────────────────────────────────────────────────────────
    window.IntelliSenseContextType = IntelliSenseContextType;
    window.SqlContextAnalyzer = {
        IntelliSenseContextType,
        SQL_KEYWORDS,
        COMMON_SQL_KEYWORDS,
        MSSQL_KEYWORDS,
        POSTGRES_KEYWORDS,
        SQLITE_KEYWORDS,
        getKeywordsForDbType,
        SQL_FUNCTIONS,
        SQL_DATA_TYPES,
        FOLLOW_UP_KEYWORDS,
        cleanIdentifier,
        extractLocalTempTables,
        extractLocalTableVars,
        extractAliases,
        extractAllTablesInQuery,
        extractSelectAliases,
        extractDmlContext,
        detectClause,
        detectAlterContext,
        detectRoutineContext,
        detectStatementBoundary,
        analyze
    };

})(window);
