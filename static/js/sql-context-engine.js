/**
 * sql-context-engine.js - Shared SQL Context Engine & Parameter Parser
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements architectural requirements in .SKILL/SQL_Parameter_Placeholder_Parse.md:
 * - Common SQL Context Engine serving IntelliSense and Parameter Parser
 * - Dialect-aware Lexer / Tokenizer (PostgreSQL vs SQL Server)
 * - Safe handling of PostgreSQL format() placeholders (%I, %L, %s) vs query parameters ($1, $2)
 * - Safe handling of SQL Server named parameters (@param) vs system variables (@@ROWCOUNT)
 * - Dollar-quoting support ($$, $function$, etc.)
 * - Zero DB queries, zero network calls, sub-millisecond in-memory parsing with cache
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (window) {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────
    // 1. TOKEN TYPES
    // ─────────────────────────────────────────────────────────────────────────
    const ContextTokenType = {
        KEYWORD: 'KEYWORD',
        IDENTIFIER: 'IDENTIFIER',
        QUOTED_IDENTIFIER: 'QUOTED_IDENTIFIER',
        STRING: 'STRING',
        DOLLAR_QUOTE: 'DOLLAR_QUOTE',
        NUMBER: 'NUMBER',
        OPERATOR: 'OPERATOR',
        PUNCTUATION: 'PUNCTUATION',
        PARAMETER: 'PARAMETER',
        SYSTEM_VARIABLE: 'SYSTEM_VARIABLE',
        FORMAT_PLACEHOLDER: 'FORMAT_PLACEHOLDER',
        COMMENT_LINE: 'COMMENT_LINE',
        COMMENT_BLOCK: 'COMMENT_BLOCK',
        WHITESPACE: 'WHITESPACE',
        UNKNOWN: 'UNKNOWN'
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 2. TOKENIZER
    // ─────────────────────────────────────────────────────────────────────────
    class SqlContextTokenizer {
        constructor(dialect) {
            this.dialect = dialect || (window.SqlDialectFactory ? window.SqlDialectFactory.getDialect('sqlserver') : null);
            this.dbType = (this.dialect && this.dialect.name) ? this.dialect.name.toLowerCase() : 'sqlserver';
            this.isPostgres = this.dbType === 'postgresql' || this.dbType === 'postgres' || this.dbType === 'pg';
        }

        tokenize(sqlText) {
            const tokens = [];
            if (!sqlText || typeof sqlText !== 'string') return tokens;

            const len = sqlText.length;
            let i = 0;
            let line = 1;
            let col = 1;

            while (i < len) {
                const start = i;
                const tokenLine = line;
                const tokenCol = col;
                const ch = sqlText[i];
                const nextCh = i + 1 < len ? sqlText[i + 1] : '';

                // 1. Whitespace
                if (/\s/.test(ch)) {
                    while (i < len && /\s/.test(sqlText[i])) {
                        if (sqlText[i] === '\n') {
                            line++;
                            col = 1;
                        } else {
                            col++;
                        }
                        i++;
                    }
                    tokens.push({
                        type: ContextTokenType.WHITESPACE,
                        value: sqlText.substring(start, i),
                        rawText: sqlText.substring(start, i),
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 2. Line comment: --
                if (ch === '-' && nextCh === '-') {
                    i += 2;
                    col += 2;
                    while (i < len && sqlText[i] !== '\n') {
                        i++;
                        col++;
                    }
                    tokens.push({
                        type: ContextTokenType.COMMENT_LINE,
                        value: sqlText.substring(start, i),
                        rawText: sqlText.substring(start, i),
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 3. Block comment: /* ... */
                if (ch === '/' && nextCh === '*') {
                    i += 2;
                    col += 2;
                    while (i < len && !(sqlText[i] === '*' && i + 1 < len && sqlText[i + 1] === '/')) {
                        if (sqlText[i] === '\n') {
                            line++;
                            col = 1;
                        } else {
                            col++;
                        }
                        i++;
                    }
                    if (i < len) {
                        i += 2;
                        col += 2;
                    }
                    tokens.push({
                        type: ContextTokenType.COMMENT_BLOCK,
                        value: sqlText.substring(start, i),
                        rawText: sqlText.substring(start, i),
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 4. PostgreSQL Dollar-Quoting Tag: $$ or $tag$
                if (this.isPostgres && ch === '$') {
                    let tagEnd = i + 1;
                    let isDollarTag = false;
                    let tagString = '';

                    // Case A: $$
                    if (tagEnd < len && sqlText[tagEnd] === '$') {
                        tagEnd++;
                        isDollarTag = true;
                        tagString = '$$';
                    } else if (tagEnd < len && /[a-zA-Z_]/.test(sqlText[tagEnd])) {
                        // Case B: $tag$
                        while (tagEnd < len && /[a-zA-Z0-9_]/.test(sqlText[tagEnd])) {
                            tagEnd++;
                        }
                        if (tagEnd < len && sqlText[tagEnd] === '$') {
                            tagEnd++;
                            isDollarTag = true;
                            tagString = sqlText.substring(i, tagEnd);
                        }
                    }

                    if (isDollarTag) {
                        tokens.push({
                            type: ContextTokenType.DOLLAR_QUOTE,
                            value: tagString,
                            rawText: tagString,
                            tag: tagString,
                            startOffset: i,
                            endOffset: tagEnd,
                            line: tokenLine,
                            col: tokenCol
                        });
                        col += (tagEnd - i);
                        i = tagEnd;
                        continue;
                    }
                }

                // 5. String literal: '...' with '' escaping, or N'...' / E'...'
                if (ch === "'" || ((ch === 'N' || ch === 'n' || ch === 'E' || ch === 'e') && nextCh === "'")) {
                    const prefixLen = ch === "'" ? 0 : 1;
                    i += prefixLen + 1;
                    col += prefixLen + 1;
                    while (i < len) {
                        if (sqlText[i] === "'") {
                            if (i + 1 < len && sqlText[i + 1] === "'") {
                                i += 2;
                                col += 2;
                                continue;
                            } else {
                                i++;
                                col++;
                                break;
                            }
                        }
                        if (sqlText[i] === '\n') {
                            line++;
                            col = 1;
                        } else {
                            col++;
                        }
                        i++;
                    }
                    const strVal = sqlText.substring(start, i);
                    tokens.push({
                        type: ContextTokenType.STRING,
                        value: strVal,
                        rawText: strVal,
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 6. Quoted identifiers: [MSSQL] or "Postgres" or `MySQL`
                if (ch === '[' || ch === '"' || ch === '`') {
                    const closeChar = ch === '[' ? ']' : ch;
                    i++;
                    col++;
                    while (i < len && sqlText[i] !== closeChar) {
                        if (sqlText[i] === '\n') {
                            line++;
                            col = 1;
                        } else {
                            col++;
                        }
                        i++;
                    }
                    if (i < len && sqlText[i] === closeChar) {
                        i++;
                        col++;
                    }
                    const qVal = sqlText.substring(start, i);
                    tokens.push({
                        type: ContextTokenType.QUOTED_IDENTIFIER,
                        value: qVal,
                        rawText: qVal,
                        cleanName: qVal.length >= 2 ? qVal.substring(1, qVal.length - 1) : qVal,
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 7. Parameters & System Variables
                // 7a. SQL Server: @param, @@system_var, #temp
                if (!this.isPostgres && (ch === '@' || ch === '#')) {
                    if (ch === '@' && nextCh === '@') {
                        // System variable @@ROWCOUNT, @@SPID, etc.
                        i += 2;
                        col += 2;
                        while (i < len && /[a-zA-Z0-9_$]/.test(sqlText[i])) {
                            i++;
                            col++;
                        }
                        const varName = sqlText.substring(start, i);
                        tokens.push({
                            type: ContextTokenType.SYSTEM_VARIABLE,
                            value: varName,
                            rawText: varName,
                            startOffset: start,
                            endOffset: i,
                            line: tokenLine,
                            col: tokenCol
                        });
                        continue;
                    }

                    // Named parameter @param or #temp
                    while (i < len && (sqlText[i] === '@' || sqlText[i] === '#' || /[a-zA-Z0-9_$]/.test(sqlText[i]))) {
                        i++;
                        col++;
                    }
                    const paramName = sqlText.substring(start, i);
                    tokens.push({
                        type: ContextTokenType.PARAMETER,
                        value: paramName,
                        rawText: paramName,
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 7b. PostgreSQL: Positional parameter $1, $2, ...
                if (this.isPostgres && ch === '$' && /[0-9]/.test(nextCh)) {
                    i++;
                    col++;
                    while (i < len && /[0-9]/.test(sqlText[i])) {
                        i++;
                        col++;
                    }
                    const posParam = sqlText.substring(start, i);
                    tokens.push({
                        type: ContextTokenType.PARAMETER,
                        value: posParam,
                        rawText: posParam,
                        index: parseInt(posParam.substring(1), 10),
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 8. Numbers (integer, float, hex 0x...)
                if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(nextCh))) {
                    let hasDot = (ch === '.');
                    i++;
                    col++;
                    if (ch === '0' && (sqlText[i] === 'x' || sqlText[i] === 'X')) {
                        i++;
                        col++;
                        while (i < len && /[0-9a-fA-F]/.test(sqlText[i])) {
                            i++;
                            col++;
                        }
                    } else {
                        while (i < len) {
                            if (sqlText[i] === '.' && !hasDot && i + 1 < len && /[0-9]/.test(sqlText[i + 1])) {
                                hasDot = true;
                                i++;
                                col++;
                            } else if (/[0-9]/.test(sqlText[i])) {
                                i++;
                                col++;
                            } else if ((sqlText[i] === 'e' || sqlText[i] === 'E') && i + 1 < len && /[0-9+-]/.test(sqlText[i + 1])) {
                                i += 2;
                                col += 2;
                                while (i < len && /[0-9]/.test(sqlText[i])) {
                                    i++;
                                    col++;
                                }
                                break;
                            } else {
                                break;
                            }
                        }
                    }
                    const numVal = sqlText.substring(start, i);
                    tokens.push({
                        type: ContextTokenType.NUMBER,
                        value: numVal,
                        rawText: numVal,
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 9. Multi-character operators: <>, !=, >=, <=, ||, ::, etc.
                const twoChar = ch + nextCh;
                const multiOps = ['<>', '!=', '>=', '<=', '+=', '-=', '*=', '/=', '||', '::'];
                if (multiOps.includes(twoChar)) {
                    i += 2;
                    col += 2;
                    tokens.push({
                        type: ContextTokenType.OPERATOR,
                        value: twoChar,
                        rawText: twoChar,
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 10. Single-character punctuation & operators
                const singlePunc = ['.', ',', '(', ')', ';', '[', ']', '{', '}'];
                if (singlePunc.includes(ch)) {
                    i++;
                    col++;
                    tokens.push({
                        type: ContextTokenType.PUNCTUATION,
                        value: ch,
                        rawText: ch,
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                const singleOps = ['=', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '~'];
                if (singleOps.includes(ch)) {
                    i++;
                    col++;
                    tokens.push({
                        type: ContextTokenType.OPERATOR,
                        value: ch,
                        rawText: ch,
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 11. Word: Keyword, Identifier, or Built-in Function
                if (/[a-zA-Z_]/.test(ch)) {
                    while (i < len && /[a-zA-Z0-9_$]/.test(sqlText[i])) {
                        i++;
                        col++;
                    }
                    const word = sqlText.substring(start, i);
                    const upperWord = word.toUpperCase();
                    const isKeyword = this._isKeyword(upperWord);

                    tokens.push({
                        type: isKeyword ? ContextTokenType.KEYWORD : ContextTokenType.IDENTIFIER,
                        value: word,
                        upper: upperWord,
                        rawText: word,
                        startOffset: start,
                        endOffset: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 12. Fallback Unknown single character
                i++;
                col++;
                tokens.push({
                    type: ContextTokenType.UNKNOWN,
                    value: ch,
                    rawText: ch,
                    startOffset: start,
                    endOffset: i,
                    line: tokenLine,
                    col: tokenCol
                });
            }

            return tokens;
        }

        _isKeyword(upperWord) {
            const commonKeywords = [
                "SELECT", "FROM", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS",
                "ON", "GROUP", "ORDER", "BY", "HAVING", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
                "DELETE", "TRUNCATE", "CREATE", "ALTER", "DROP", "TABLE", "VIEW", "INDEX",
                "PRIMARY", "FOREIGN", "KEY", "REFERENCES", "CHECK", "DEFAULT", "UNIQUE", "CONSTRAINT",
                "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "IS", "NULL", "UNION", "ALL",
                "INTERSECT", "EXCEPT", "AS", "DISTINCT", "CASE", "WHEN", "THEN", "ELSE", "END",
                "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION", "WITH", "OVER", "PARTITION",
                "ASC", "DESC", "TRUE", "FALSE", "LIMIT", "OFFSET", "TOP", "EXEC", "EXECUTE", "FORMAT"
            ];
            return commonKeywords.includes(upperWord);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. SQL CONTEXT ENGINE
    // ─────────────────────────────────────────────────────────────────────────
    class SqlContextEngine {
        constructor() {
            this._cache = null;
        }

        /**
         * Full analysis of SQL document and optional cursor position
         */
        analyze(options) {
            const sql = (options && typeof options.sql === 'string') ? options.sql : '';
            const cursorOffset = (options && typeof options.cursorOffset === 'number') ? options.cursorOffset : -1;
            const dialectInput = options ? options.dialect : null;

            // Resolve dialect
            let dialect = null;
            if (typeof dialectInput === 'string' && window.SqlDialectFactory) {
                dialect = window.SqlDialectFactory.getDialect(dialectInput);
            } else if (dialectInput && typeof dialectInput === 'object') {
                dialect = dialectInput;
            } else if (window.SqlDialectFactory) {
                dialect = window.SqlDialectFactory.getDialect(window.ActiveDbType || 'sqlserver');
            }

            const dbType = (dialect && dialect.name) ? dialect.name.toLowerCase() : 'sqlserver';
            const isPostgres = dbType === 'postgresql' || dbType === 'postgres' || dbType === 'pg';

            // Cache check
            if (this._cache && this._cache.sql === sql && this._cache.dbType === dbType) {
                if (cursorOffset >= 0) {
                    return this._resolveCursorContext(this._cache.model, cursorOffset);
                }
                return this._cache.model;
            }

            // 1. Tokenize
            const tokenizer = new SqlContextTokenizer(dialect);
            const rawTokens = tokenizer.tokenize(sql);
            const nonWsTokens = rawTokens.filter(t => t.type !== ContextTokenType.WHITESPACE);

            // 2. Syntactic & Scope Tracking
            const scopes = [];
            const parameters = [];
            const formatPlaceholders = [];
            const functionCalls = [];

            let parenDepth = 0;
            const parenStack = [];
            let inDollarQuote = false;
            let currentDollarTag = null;
            let currentClause = 'UNKNOWN';

            for (let idx = 0; idx < nonWsTokens.length; idx++) {
                const tok = nonWsTokens[idx];
                const prev = idx > 0 ? nonWsTokens[idx - 1] : null;
                const next = idx + 1 < nonWsTokens.length ? nonWsTokens[idx + 1] : null;

                // Track Dollar-quoting blocks in PostgreSQL
                if (isPostgres && tok.type === ContextTokenType.DOLLAR_QUOTE) {
                    if (!inDollarQuote) {
                        inDollarQuote = true;
                        currentDollarTag = tok.tag;
                    } else if (tok.tag === currentDollarTag) {
                        inDollarQuote = false;
                        currentDollarTag = null;
                    }
                }

                // Track Clause keywords
                if (tok.type === ContextTokenType.KEYWORD) {
                    const up = tok.upper || tok.value.toUpperCase();
                    if (['SELECT', 'FROM', 'WHERE', 'JOIN', 'GROUP', 'ORDER', 'HAVING', 'INSERT', 'UPDATE', 'DELETE', 'SET'].includes(up)) {
                        currentClause = up;
                    }
                }

                // Track function calls: identifier/keyword followed by (
                if ((tok.type === ContextTokenType.IDENTIFIER || tok.type === ContextTokenType.KEYWORD) && next && next.value === '(') {
                    functionCalls.push({
                        name: tok.value,
                        upperName: (tok.upper || tok.value).toUpperCase(),
                        startOffset: tok.startOffset,
                        parenDepth: parenDepth + 1,
                        argIndex: 0
                    });
                }

                // Track parentheses and function arguments
                if (tok.value === '(') {
                    parenDepth++;
                    parenStack.push(parenDepth);
                } else if (tok.value === ')') {
                    if (functionCalls.length > 0 && functionCalls[functionCalls.length - 1].parenDepth === parenDepth) {
                        functionCalls.pop();
                    }
                    parenDepth = Math.max(0, parenDepth - 1);
                    parenStack.pop();
                } else if (tok.value === ',') {
                    if (functionCalls.length > 0 && functionCalls[functionCalls.length - 1].parenDepth === parenDepth) {
                        functionCalls[functionCalls.length - 1].argIndex++;
                    }
                }

                // Detect PostgreSQL format() placeholders inside format string
                if (isPostgres && tok.type === ContextTokenType.STRING) {
                    const currentFunc = functionCalls.length > 0 ? functionCalls[functionCalls.length - 1] : null;
                    if (currentFunc && currentFunc.upperName === 'FORMAT' && currentFunc.argIndex === 0) {
                        tok.isFormatString = true;
                        // Inspect string contents for %I, %L, %s, %%
                        const regex = /%([ILs%])/g;
                        let m;
                        while ((m = regex.exec(tok.value)) !== null) {
                            const phType = m[1] === 'I' ? 'identifier' : (m[1] === 'L' ? 'literal' : (m[1] === 's' ? 'string' : 'escaped'));
                            formatPlaceholders.push({
                                type: 'format_placeholder',
                                dialect: 'postgresql',
                                formatType: phType,
                                value: m[0],
                                location: {
                                    start: tok.startOffset + m.index,
                                    end: tok.startOffset + m.index + m[0].length,
                                    line: tok.line,
                                    col: tok.col + m.index
                                }
                            });
                        }
                    }
                }

                // Extract query parameters (Positional $1 for Postgres, Named @param for SQL Server)
                if (tok.type === ContextTokenType.PARAMETER) {
                    if (isPostgres) {
                        parameters.push({
                            type: 'query_parameter',
                            dialect: 'postgresql',
                            style: 'positional',
                            name: tok.value,
                            index: tok.index || parseInt(tok.value.substring(1), 10) || 1,
                            location: {
                                start: tok.startOffset,
                                end: tok.endOffset,
                                line: tok.line,
                                col: tok.col
                            }
                        });
                    } else {
                        parameters.push({
                            type: 'query_parameter',
                            dialect: 'sqlserver',
                            style: 'named',
                            name: tok.value,
                            location: {
                                start: tok.startOffset,
                                end: tok.endOffset,
                                line: tok.line,
                                col: tok.col
                            }
                        });
                    }
                }
            }

            // Deduplicate parameters
            const paramMap = new Map();
            parameters.forEach(p => {
                if (!paramMap.has(p.name)) paramMap.set(p.name, p);
            });
            const uniqueParameters = Array.from(paramMap.values());

            const model = {
                dialect: dbType,
                sql,
                tokens: rawTokens,
                nonWsTokens,
                scopes,
                parameters: uniqueParameters,
                formatPlaceholders,
                errors: []
            };

            this._cache = { sql, dbType, model };

            if (cursorOffset >= 0) {
                return this._resolveCursorContext(model, cursorOffset);
            }

            return model;
        }

        /**
         * Resolves context at cursor offset without database access
         */
        _resolveCursorContext(model, cursorOffset) {
            const tokens = model.tokens;
            const nonWs = model.nonWsTokens;

            let prevToken = null;
            let currentToken = null;
            let nextToken = null;

            for (let i = 0; i < tokens.length; i++) {
                const t = tokens[i];
                if (cursorOffset >= t.startOffset && cursorOffset <= t.endOffset) {
                    currentToken = t;
                    prevToken = i > 0 ? tokens[i - 1] : null;
                    nextToken = i + 1 < tokens.length ? tokens[i + 1] : null;
                    break;
                } else if (cursorOffset > t.endOffset) {
                    prevToken = t;
                } else if (cursorOffset < t.startOffset && !nextToken) {
                    nextToken = t;
                }
            }

            const insideString = currentToken ? currentToken.type === ContextTokenType.STRING : false;
            const insideComment = currentToken ? (currentToken.type === ContextTokenType.COMMENT_LINE || currentToken.type === ContextTokenType.COMMENT_BLOCK) : false;
            const insideDollarQuote = currentToken ? currentToken.type === ContextTokenType.DOLLAR_QUOTE : false;

            // Check if cursor is inside format()
            let insideFormat = false;
            let formatPlaceholder = null;
            let functionName = null;
            let functionArgIndex = 0;

            if (insideString && currentToken.isFormatString) {
                insideFormat = true;
                functionName = 'format';
            }

            // Find surrounding function call if any
            for (let i = 0; i < nonWs.length; i++) {
                const t = nonWs[i];
                if (t.startOffset < cursorOffset && (t.type === ContextTokenType.IDENTIFIER || t.type === ContextTokenType.KEYWORD)) {
                    const next = nonWs[i + 1];
                    if (next && next.value === '(' && next.startOffset < cursorOffset) {
                        functionName = t.value;
                    }
                }
            }

            // Compute expected type
            let expectedType = 'unknown';
            if (insideComment || (insideString && !insideFormat)) {
                expectedType = 'none';
            } else if (insideFormat) {
                expectedType = 'format_placeholder';
            } else if (prevToken && (prevToken.upper === 'FROM' || prevToken.upper === 'JOIN')) {
                expectedType = 'table';
            } else if (prevToken && (prevToken.upper === 'SELECT' || prevToken.upper === 'WHERE' || prevToken.upper === 'AND' || prevToken.upper === 'OR')) {
                expectedType = 'column';
            }

            return {
                ...model,
                cursor: {
                    offset: cursorOffset,
                    line: currentToken ? currentToken.line : 1,
                    col: currentToken ? currentToken.col : 1
                },
                context: {
                    type: expectedType,
                    insideString,
                    insideComment,
                    insideDollarQuote,
                    insideFunction: Boolean(functionName),
                    functionName,
                    functionArgIndex,
                    insideFormat,
                    formatPlaceholder,
                    insideDynamicSql: false,
                    clause: 'UNKNOWN',
                    expectedType,
                    previousToken: prevToken,
                    currentToken,
                    nextToken
                }
            };
        }

        /**
         * Quick API for IntelliSense cursor query
         */
        getCursorContext(options) {
            const analysis = this.analyze(options);
            return analysis.context || {
                type: 'unknown',
                insideString: false,
                insideComment: false,
                insideFormat: false,
                expectedType: 'unknown'
            };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. PARAMETER PARSER
    // ─────────────────────────────────────────────────────────────────────────
    class SqlParameterParser {
        constructor(engine) {
            this.engine = engine || new SqlContextEngine();
        }

        /**
         * Extract parameters using the Context Engine.
         * Ensures %I, %L, %s in format() are never treated as query parameters.
         */
        extract(sqlOrAnalysis, dialect = null) {
            let analysis;
            if (sqlOrAnalysis && typeof sqlOrAnalysis === 'object' && Array.isArray(sqlOrAnalysis.parameters)) {
                analysis = sqlOrAnalysis;
            } else {
                analysis = this.engine.analyze({
                    sql: typeof sqlOrAnalysis === 'string' ? sqlOrAnalysis : '',
                    dialect: dialect
                });
            }

            return {
                queryParameters: analysis.parameters || [],
                formatPlaceholders: analysis.formatPlaceholders || []
            };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. INTELLISENSE CONTEXT ADAPTER
    // ─────────────────────────────────────────────────────────────────────────
    class SqlContextAdapter {
        constructor(engine) {
            this.engine = engine || new SqlContextEngine();
        }

        /**
         * Adapts CodeMirror EditorState or position to Context Model
         */
        adapt(editorStateOrSql, cursorOffset, dialect = null) {
            let sql = '';
            let offset = cursorOffset;

            if (typeof editorStateOrSql === 'string') {
                sql = editorStateOrSql;
            } else if (editorStateOrSql && editorStateOrSql.doc) {
                sql = editorStateOrSql.doc.toString();
                if (typeof offset !== 'number' && editorStateOrSql.selection) {
                    offset = editorStateOrSql.selection.main.head;
                }
            }

            return this.engine.getCursorContext({
                sql,
                cursorOffset: offset,
                dialect
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. GLOBAL EXPORTS & SINGLETONS
    // ─────────────────────────────────────────────────────────────────────────
    const defaultEngine = new SqlContextEngine();
    const defaultParser = new SqlParameterParser(defaultEngine);
    const defaultAdapter = new SqlContextAdapter(defaultEngine);

    window.ContextTokenType = ContextTokenType;
    window.SqlContextTokenizer = SqlContextTokenizer;
    window.SqlContextEngine = SqlContextEngine;
    window.SqlParameterParser = SqlParameterParser;
    window.SqlContextAdapter = SqlContextAdapter;

    window.sqlContextEngine = defaultEngine;
    window.sqlParameterParser = defaultParser;
    window.sqlContextAdapter = defaultAdapter;

})(typeof window !== 'undefined' ? window : globalThis);
