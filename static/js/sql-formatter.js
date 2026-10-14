/**
 * sql-formatter.js - Dialect-Aware SQL Formatter Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements Section 15, 16, 17, 18, 19 of .SKILL/format-code_general.md
 * 
 * 3-Layer Architecture:
 *   Style Code UI -> Style Configuration -> Formatter Engine -> Formatted SQL
 * 
 * Features:
 * - Tokenizes & protects comments, string literals, identifiers verbatim
 * - Dialect recognition: SQL Server and PostgreSQL
 * - Dynamic Style Config application (Casing, Whitespace, Lists, Clauses, Operators, CASE)
 * - Safe fallback & backward-compatible defaults
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (window) {
    'use strict';

    // ── Default Fallback Style Configuration ──────────────────────────────────
    const DEFAULT_STYLE_CONFIG = {
        schemaVersion: 1,
        id: 'default',
        name: 'Default (Standard)',
        database: 'all',
        settings: {
            casing: {
                keywords: 'upper',
                functions: 'upper',
                datatypes: 'upper'
            },
            whitespace: {
                indentSize: 4,
                useTabs: false,
                maxEmptyLines: 1,
                trimTrailingWhitespace: true
            },
            lists: {
                commaPosition: 'after',
                itemsOnNewLine: true
            },
            parentheses: {
                spacesInside: false,
                multiLineBlockNewLine: true
            },
            statements: {
                majorClausesNewLine: true,
                indentClauseBody: true
            },
            clauses: {
                joinOnNewLine: true,
                indentJoinOn: true
            },
            operators: {
                andOrPlaceOnNewLine: 'always',
                andOrAlignment: 'rightToStatement',
                andOrKeywordBeforeCondition: true,
                betweenPlaceOnNewLine: false,
                spacesAroundOperators: true,
                alignComparisonOperators: false
            },
            caseExpression: {
                whenOnNewLine: true,
                thenOnSameLine: true,
                indentWhen: true
            }
        }
    };

    // ── Keyword Dictionaries ──────────────────────────────────────────────────
    const MAJOR_CLAUSES = [
        'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY',
        'LIMIT', 'OFFSET', 'UNION ALL', 'UNION', 'INTERSECT', 'EXCEPT',
        'INSERT INTO', 'INSERT', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'DELETE',
        'MERGE', 'OUTPUT', 'RETURNING', 'WITH', 'TRUNCATE TABLE', 'TRUNCATE'
    ];

    const JOIN_CLAUSES = [
        'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN',
        'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN',
        'CROSS APPLY', 'OUTER APPLY', 'NATURAL JOIN', 'JOIN'
    ];

    const LOGICAL_OPERATORS = [
        'AND', 'OR', 'NOT', 'BETWEEN', 'IN', 'LIKE', 'ILIKE',
        'IS NULL', 'IS NOT NULL', 'IS', 'EXISTS', 'ANY', 'ALL'
    ];

    const DDL_KEYWORDS = [
        'CREATE OR ALTER', 'CREATE OR REPLACE', 'CREATE', 'ALTER', 'DROP',
        'TABLE', 'VIEW', 'PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER', 'SEQUENCE',
        'INDEX', 'SYNONYM', 'TYPE', 'SCHEMA', 'DATABASE', 'CONSTRAINT',
        'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'CHECK', 'DEFAULT', 'UNIQUE'
    ];

    const CONTROL_FLOW_KEYWORDS = [
        'BEGIN TRY', 'END TRY', 'BEGIN CATCH', 'END CATCH',
        'BEGIN TRANSACTION', 'COMMIT TRANSACTION', 'ROLLBACK TRANSACTION',
        'BEGIN TRAN', 'COMMIT TRAN', 'ROLLBACK TRAN',
        'BEGIN', 'END IF', 'END LOOP', 'ELSIF', 'LOOP', 'WHILE', 'IF', 'ELSE',
        'RETURN', 'RETURNS', 'BREAK', 'CONTINUE', 'EXECUTE', 'EXEC',
        'DECLARE', 'NOLOCK', 'GO'
    ];

    const BUILTIN_FUNCTIONS = [
        'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'ISNULL',
        'DATEADD', 'DATEDIFF', 'DATEPART', 'DATENAME', 'GETDATE', 'GETUTCDATE', 'SYSDATETIME',
        'NOW', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME',
        'CONVERT', 'CAST', 'TRY_CONVERT', 'TRY_CAST', 'PARSE', 'TRY_PARSE',
        'SUBSTRING', 'LEFT', 'RIGHT', 'LEN', 'LENGTH', 'LOWER', 'UPPER',
        'TRIM', 'LTRIM', 'RTRIM', 'REPLACE', 'REVERSE', 'CHARINDEX', 'PATINDEX', 'STUFF',
        'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
        'STRING_AGG', 'GROUP_CONCAT', 'CONCAT_WS', 'CONCAT', 'ROUND', 'FLOOR', 'CEILING', 'ABS'
    ];

    const DATATYPES = [
        'BIGINT', 'INT', 'INTEGER', 'SMALLINT', 'TINYINT', 'BIT', 'BOOLEAN', 'BOOL',
        'DECIMAL', 'NUMERIC', 'MONEY', 'SMALLMONEY', 'FLOAT', 'REAL',
        'DATE', 'DATETIME', 'DATETIME2', 'DATETIMEOFFSET', 'SMALLDATETIME', 'TIME', 'TIMESTAMP',
        'CHAR', 'VARCHAR', 'TEXT', 'NCHAR', 'NVARCHAR', 'NTEXT',
        'BINARY', 'VARBINARY', 'IMAGE', 'BYTEA',
        'UNIQUEIDENTIFIER', 'UUID', 'XML', 'JSON', 'JSONB'
    ];

    // Combine all standard keywords for generic casing
    const ALL_KEYWORDS = [
        ...MAJOR_CLAUSES,
        ...JOIN_CLAUSES,
        ...LOGICAL_OPERATORS,
        ...DDL_KEYWORDS,
        ...CONTROL_FLOW_KEYWORDS,
        'AS', 'ASC', 'DESC', 'ON', 'CASE', 'WHEN', 'THEN', 'TOP', 'DISTINCT',
        'LANGUAGE', 'PLPGSQL', 'EXCEPTION', 'PERFORM', 'RAISE', 'NOTICE'
    ];

    class SqlFormatter {
        /**
         * Cached active style configuration in memory
         */
        static _activeStyle = DEFAULT_STYLE_CONFIG;

        /**
         * Get currently active style configuration
         */
        static getActiveStyle() {
            if (window._activeCodeStyle && typeof window._activeCodeStyle === 'object') {
                return window._activeCodeStyle;
            }
            return this._activeStyle || DEFAULT_STYLE_CONFIG;
        }

        /**
         * Set active style configuration
         */
        static setActiveStyle(style) {
            if (style && typeof style === 'object') {
                this._activeStyle = style;
                window._activeCodeStyle = style;
            }
        }

        /**
         * Return default style
         */
        static getDefaultStyle() {
            return JSON.parse(JSON.stringify(DEFAULT_STYLE_CONFIG));
        }

        /**
         * Resolve merged style configuration with backward compatibility.
         * Missing options fallback cleanly to defaults (Section 19).
         */
        static _resolveConfig(userConfig) {
            const def = DEFAULT_STYLE_CONFIG;
            let cfg = userConfig;

            if (!cfg || typeof cfg !== 'object') {
                cfg = this.getActiveStyle();
            } else if (cfg.dialect && !cfg.settings && !cfg.casing) {
                const active = this.getActiveStyle();
                cfg = {
                    ...active,
                    dialect: cfg.dialect,
                    database: cfg.dialect.includes('postgr') ? 'postgresql' : (active.database || 'sqlserver')
                };
            }

            // If raw settings passed directly without envelope
            const s = cfg.settings || cfg;
            const ds = def.settings;

            return {
                schemaVersion: cfg.schemaVersion || 1,
                id: cfg.id || 'custom',
                name: cfg.name || 'Custom',
                database: cfg.database || (cfg.dialect ? (cfg.dialect.includes('postgr') ? 'postgresql' : 'sqlserver') : 'all'),
                settings: {
                    casing: {
                        keywords: s.casing?.keywords || ds.casing.keywords,
                        functions: s.casing?.functions || ds.casing.functions,
                        datatypes: s.casing?.datatypes || ds.casing.datatypes
                    },
                    whitespace: {
                        indentSize: typeof s.whitespace?.indentSize === 'number' ? s.whitespace.indentSize : ds.whitespace.indentSize,
                        useTabs: typeof s.whitespace?.useTabs === 'boolean' ? s.whitespace.useTabs : ds.whitespace.useTabs,
                        maxEmptyLines: typeof s.whitespace?.maxEmptyLines === 'number' ? s.whitespace.maxEmptyLines : ds.whitespace.maxEmptyLines,
                        trimTrailingWhitespace: typeof s.whitespace?.trimTrailingWhitespace === 'boolean' ? s.whitespace.trimTrailingWhitespace : ds.whitespace.trimTrailingWhitespace
                    },
                    lists: {
                        commaPosition: s.lists?.commaPosition || ds.lists.commaPosition,
                        itemsOnNewLine: typeof s.lists?.itemsOnNewLine === 'boolean' ? s.lists.itemsOnNewLine : ds.lists.itemsOnNewLine
                    },
                    parentheses: {
                        spacesInside: typeof s.parentheses?.spacesInside === 'boolean' ? s.parentheses.spacesInside : ds.parentheses.spacesInside,
                        multiLineBlockNewLine: typeof s.parentheses?.multiLineBlockNewLine === 'boolean' ? s.parentheses.multiLineBlockNewLine : ds.parentheses.multiLineBlockNewLine
                    },
                    statements: {
                        majorClausesNewLine: typeof s.statements?.majorClausesNewLine === 'boolean' ? s.statements.majorClausesNewLine : ds.statements.majorClausesNewLine,
                        indentClauseBody: typeof s.statements?.indentClauseBody === 'boolean' ? s.statements.indentClauseBody : ds.statements.indentClauseBody
                    },
                    clauses: {
                        joinOnNewLine: typeof s.clauses?.joinOnNewLine === 'boolean' ? s.clauses.joinOnNewLine : ds.clauses.joinOnNewLine,
                        indentJoinOn: typeof s.clauses?.indentJoinOn === 'boolean' ? s.clauses.indentJoinOn : ds.clauses.indentJoinOn
                    },
                    operators: {
                        andOrPlaceOnNewLine: s.operators?.andOrPlaceOnNewLine || ds.operators.andOrPlaceOnNewLine,
                        andOrAlignment: s.operators?.andOrAlignment || ds.operators.andOrAlignment,
                        andOrKeywordBeforeCondition: typeof s.operators?.andOrKeywordBeforeCondition === 'boolean' ? s.operators.andOrKeywordBeforeCondition : ds.operators.andOrKeywordBeforeCondition,
                        betweenPlaceOnNewLine: typeof s.operators?.betweenPlaceOnNewLine === 'boolean' ? s.operators.betweenPlaceOnNewLine : ds.operators.betweenPlaceOnNewLine,
                        spacesAroundOperators: typeof s.operators?.spacesAroundOperators === 'boolean' ? s.operators.spacesAroundOperators : ds.operators.spacesAroundOperators,
                        alignComparisonOperators: typeof s.operators?.alignComparisonOperators === 'boolean' ? s.operators.alignComparisonOperators : ds.operators.alignComparisonOperators
                    },
                    caseExpression: {
                        whenOnNewLine: typeof s.caseExpression?.whenOnNewLine === 'boolean' ? s.caseExpression.whenOnNewLine : ds.caseExpression.whenOnNewLine,
                        thenOnSameLine: typeof s.caseExpression?.thenOnSameLine === 'boolean' ? s.caseExpression.thenOnSameLine : ds.caseExpression.thenOnSameLine,
                        indentWhen: typeof s.caseExpression?.indentWhen === 'boolean' ? s.caseExpression.indentWhen : ds.caseExpression.indentWhen
                    }
                }
            };
        }

        /**
         * Main formatting entry point.
         * Formats SQL according to style configuration.
         * 
         * @param {string} sql - Input SQL query text
         * @param {Object} [styleConfig] - Optional style config object or options { dialect }
         * @returns {string} Formatted SQL
         */
        static format(sql, styleConfig = null) {
            if (!sql || typeof sql !== 'string') return '';
            if (!sql.trim()) return sql;

            try {
                const config = this._resolveConfig(styleConfig);
                const isPg = (config.database === 'postgresql') ||
                    (String(config.database || '').toLowerCase().includes('postgr')) ||
                    (styleConfig && typeof styleConfig.dialect === 'string' && styleConfig.dialect.toLowerCase().includes('postgr'));

                const indentChar = config.settings.whitespace.useTabs ? '\t' : ' '.repeat(config.settings.whitespace.indentSize);

                // 1. Tokenize into protected chunks (strings, comments, bracket/quoted idents) vs formatable code
                const chunks = this._tokenizeProtectedChunks(sql, isPg);

                // 2. Format regular code segments
                for (const chunk of chunks) {
                    if (chunk.type === 'code') {
                        chunk.text = this._formatCodeChunk(chunk.text, config.settings, indentChar, isPg);
                    }
                }

                // 3. Reassemble tokens
                let result = chunks.map(c => c.text).join('');

                // 4. Post-processing: Parentheses spaces, List commas, Clean blank lines, Trailing spaces
                result = this._postProcessFormatting(result, config.settings, indentChar);

                return result;
            } catch (err) {
                console.warn('[SqlFormatter] Format error, returning original SQL:', err);
                return sql;
            }
        }

        /**
         * Tokenize SQL into chunks, shielding comments, literals, and identifiers verbatim (Section 10, 15).
         */
        static _tokenizeProtectedChunks(sql, isPg) {
            const chunks = [];
            const len = sql.length;
            let i = 0;
            let lastCodeStart = 0;

            const flushCode = (endIdx) => {
                if (endIdx > lastCodeStart) {
                    chunks.push({
                        type: 'code',
                        text: sql.substring(lastCodeStart, endIdx)
                    });
                }
                lastCodeStart = endIdx;
            };

            while (i < len) {
                const ch = sql[i];
                const nextCh = i + 1 < len ? sql[i + 1] : '';

                // Line comment -- ...
                if (ch === '-' && nextCh === '-') {
                    flushCode(i);
                    const start = i;
                    i += 2;
                    while (i < len && sql[i] !== '\n') i++;
                    chunks.push({ type: 'comment_line', text: sql.substring(start, i) });
                    lastCodeStart = i;
                    continue;
                }

                // Block comment /* ... */
                if (ch === '/' && nextCh === '*') {
                    flushCode(i);
                    const start = i;
                    i += 2;
                    while (i < len && !(sql[i] === '*' && i + 1 < len && sql[i + 1] === '/')) i++;
                    if (i < len) i += 2;
                    chunks.push({ type: 'comment_block', text: sql.substring(start, i) });
                    lastCodeStart = i;
                    continue;
                }

                // String literal '...' or N'...'
                if (ch === "'" || ((ch === 'N' || ch === 'n') && nextCh === "'")) {
                    flushCode(i);
                    const start = i;
                    if (ch === 'N' || ch === 'n') i++;
                    i++;
                    while (i < len) {
                        if (sql[i] === "'") {
                            if (i + 1 < len && sql[i + 1] === "'") {
                                i += 2; // Escaped quote ''
                                continue;
                            } else {
                                i++;
                                break;
                            }
                        }
                        i++;
                    }
                    chunks.push({ type: 'string', text: sql.substring(start, i) });
                    lastCodeStart = i;
                    continue;
                }

                // Square bracket identifier [name]]name] (SQL Server)
                if (!isPg && ch === '[') {
                    flushCode(i);
                    const start = i;
                    i++;
                    while (i < len) {
                        if (sql[i] === ']') {
                            if (i + 1 < len && sql[i + 1] === ']') {
                                i += 2; // Escaped ]]
                                continue;
                            } else {
                                i++;
                                break;
                            }
                        }
                        i++;
                    }
                    chunks.push({ type: 'ident_bracket', text: sql.substring(start, i) });
                    lastCodeStart = i;
                    continue;
                }

                // Quoted identifier "name""name"
                if (ch === '"') {
                    flushCode(i);
                    const start = i;
                    i++;
                    while (i < len) {
                        if (sql[i] === '"') {
                            if (i + 1 < len && sql[i + 1] === '"') {
                                i += 2;
                                continue;
                            } else {
                                i++;
                                break;
                            }
                        }
                        i++;
                    }
                    chunks.push({ type: 'ident_quoted', text: sql.substring(start, i) });
                    lastCodeStart = i;
                    continue;
                }

                i++;
            }
            flushCode(len);

            return chunks;
        }

        /**
         * Transform casing of a token according to style mode ('upper', 'lower', 'preserve')
         */
        static _applyCasing(token, mode) {
            if (mode === 'upper') return token.toUpperCase();
            if (mode === 'lower') return token.toLowerCase();
            return token;
        }

        /**
         * Format a single code segment (applying casing, spacing, and clause structure).
         */
        static _formatCodeChunk(raw, settings, indentChar, isPg) {
            let s = raw;

            // 1. Spacing normalization: multiple spaces -> single space (preserve newlines)
            s = s.replace(/[ \t]{2,}/g, ' ');

            // 2. Spaces around comparison and arithmetic operators
            if (settings.operators.spacesAroundOperators) {
                // Comparison: =, <>, !=, <=, >=, <, >
                s = s.replace(/\s*(<=|>=|<>|!=)\s*/g, ' $1 ');
                s = s.replace(/(?<=[^\s<>=!])(=|<|>)(?=[^\s<>=!])/g, ' $1 ');
                // Simple arithmetic (+, -) when isolated
                s = s.replace(/(?<=[a-zA-Z0-9_\)\]])\s*([\+\*\/])\s*(?=[a-zA-Z0-9_\(\[@])/g, ' $1 ');
            }

            // 3. Apply Casing rules (Keywords, Functions, Datatypes)
            // Casing: Datatypes
            const dtCasing = settings.casing.datatypes;
            if (dtCasing && dtCasing !== 'preserve') {
                const sortedDt = [...DATATYPES].sort((a, b) => b.length - a.length);
                for (const dt of sortedDt) {
                    const esc = dt.replace(/\s+/g, '\\s+');
                    const target = this._applyCasing(dt, dtCasing);
                    s = s.replace(new RegExp(`\\b${esc}\\b`, 'gi'), target);
                }
            }

            // Casing: Built-in Functions
            const fnCasing = settings.casing.functions;
            if (fnCasing && fnCasing !== 'preserve') {
                const sortedFn = [...BUILTIN_FUNCTIONS].sort((a, b) => b.length - a.length);
                for (const fn of sortedFn) {
                    const esc = fn.replace(/\s+/g, '\\s+');
                    const target = this._applyCasing(fn, fnCasing);
                    // Match function name followed by '('
                    s = s.replace(new RegExp(`\\b${esc}\\b(?=\\s*\\()`, 'gi'), target);
                }
            }

            // Casing: Keywords
            const kwCasing = settings.casing.keywords;
            if (kwCasing && kwCasing !== 'preserve') {
                const sortedKw = [...ALL_KEYWORDS].sort((a, b) => b.length - a.length);
                for (const kw of sortedKw) {
                    const esc = kw.replace(/\s+/g, '\\s+');
                    const target = this._applyCasing(kw, kwCasing);
                    s = s.replace(new RegExp(`\\b${esc}\\b`, 'gi'), target);
                }
            }

            // 4. Major Clauses on New Line
            if (settings.statements.majorClausesNewLine) {
                const clauseKw = [
                    'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY',
                    'LIMIT', 'OFFSET', 'UNION ALL', 'UNION', 'INTERSECT', 'EXCEPT',
                    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'DELETE',
                    'WITH'
                ];
                for (const clause of clauseKw) {
                    const esc = clause.replace(/\s+/g, '\\s+');
                    // If preceded by non-newline characters, break onto new line
                    const reg = new RegExp(`([^\\r\\n])\\s+(${esc})\\b`, 'gi');
                    s = s.replace(reg, (match, prefix, kw) => {
                        const kwFormatted = kwCasing === 'lower' ? kw.toLowerCase() : kw.toUpperCase();
                        return `${prefix}\n${kwFormatted}`;
                    });
                }
            }

            // 5. JOIN Clauses on New Line & ON Indentation
            if (settings.clauses.joinOnNewLine) {
                const joins = [
                    'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN',
                    'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN',
                    'CROSS APPLY', 'OUTER APPLY', 'JOIN'
                ];
                for (const j of joins) {
                    const esc = j.replace(/\s+/g, '\\s+');
                    const reg = new RegExp(`([^\\r\\n])\\s+(${esc})\\b`, 'gi');
                    s = s.replace(reg, (match, prefix, kw) => {
                        const kwFormatted = kwCasing === 'lower' ? kw.toLowerCase() : kw.toUpperCase();
                        return `${prefix}\n${kwFormatted}`;
                    });
                }

                // Indent JOIN ... ON condition
                if (settings.clauses.indentJoinOn) {
                    const onReg = new RegExp(`([^\\r\\n])\\s+\\bON\\b`, 'gi');
                    s = s.replace(onReg, (match, prefix) => {
                        const onWord = kwCasing === 'lower' ? 'on' : 'ON';
                        return `${prefix}\n${indentChar}${onWord}`;
                    });
                }
            }

            // 6. AND / OR Operators Placement & Alignment
            const andOrMode = settings.operators.andOrPlaceOnNewLine;
            if (andOrMode === 'always') {
                const alignment = settings.operators.andOrAlignment;
                let pad = '';
                if (alignment === 'indented') {
                    pad = indentChar;
                } else if (alignment === 'rightToStatement') {
                    // Align 'AND' (3 chars) with 'WHERE' (5 chars) -> 2 leading spaces
                    pad = '  ';
                }

                // AND
                const andWord = kwCasing === 'lower' ? 'and' : 'AND';
                s = s.replace(/([^\r\n])\s+\bAND\b\s+/gi, `$1\n${pad}${andWord} `);

                // OR
                const orWord = kwCasing === 'lower' ? 'or' : 'OR';
                const orPad = alignment === 'rightToStatement' ? '   ' : pad;
                s = s.replace(/([^\r\n])\s+\bOR\b\s+/gi, `$1\n${orPad}${orWord} `);
            }

            // 7. CASE Expression formatting
            if (settings.caseExpression.whenOnNewLine) {
                const whenWord = kwCasing === 'lower' ? 'when' : 'WHEN';
                const thenWord = kwCasing === 'lower' ? 'then' : 'THEN';
                const elseWord = kwCasing === 'lower' ? 'else' : 'ELSE';
                const endWord = kwCasing === 'lower' ? 'end' : 'END';

                const whenPad = settings.caseExpression.indentWhen ? indentChar : '';

                // Break WHEN onto newline
                s = s.replace(/([^\r\n])\s+\bWHEN\b\s+/gi, `$1\n${whenPad}${whenWord} `);

                // THEN placement
                if (!settings.caseExpression.thenOnSameLine) {
                    s = s.replace(/([^\r\n])\s+\bTHEN\b\s+/gi, `$1\n${whenPad}${indentChar}${thenWord} `);
                }

                // ELSE
                s = s.replace(/([^\r\n])\s+\bELSE\b\s+/gi, `$1\n${whenPad}${elseWord} `);

                // END
                s = s.replace(/([^\r\n])\s+\bEND\b\b/gi, `$1\n${endWord}`);
            }

            return s;
        }

        /**
         * Post-processing cleanups (Parentheses spaces, Comma positioning, Semicolons, Empty lines)
         */
        static _postProcessFormatting(result, settings, indentChar) {
            let s = result;

            // 1. Parentheses spacing inside: ( a, b ) vs (a, b)
            if (settings.parentheses.spacesInside) {
                s = s.replace(/\(\s*([^\s\(\)])/g, '( $1');
                s = s.replace(/([^\s\(\)])\s*\)/g, '$1 )');
            } else {
                s = s.replace(/\(\s+/g, '(');
                s = s.replace(/\s+\)/g, ')');
            }

            // 2. Comma position (Before vs After)
            const commaPos = settings.lists.commaPosition;
            if (commaPos === 'before') {
                // Leading comma: convert trailing ",\n" or comma on newline to "\n, "
                s = s.replace(/,\s*\n\s*/g, '\n, ');
            } else {
                // Trailing comma: ensure comma sticks to preceding token with space after
                s = s.replace(/\s*,\s*/g, ', ');
                // If followed by newline, keep comma at end of previous line
                s = s.replace(/\s*,\s*\n/g, ',\n');
            }

            // 3. Semicolon cleanup: " ;" -> ";"
            s = s.replace(/\s+;/g, ';');

            // 4. Maximum consecutive empty lines
            const maxEmpty = Math.max(0, settings.whitespace.maxEmptyLines || 1);
            if (maxEmpty === 0) {
                s = s.replace(/\n[ \t]*\n+/g, '\n');
            } else {
                const emptyPattern = new RegExp(`(\\n[ \\t]*){${maxEmpty + 2},}`, 'g');
                s = s.replace(emptyPattern, '\n'.repeat(maxEmpty + 1));
            }

            // 5. Trim trailing whitespace on lines
            if (settings.whitespace.trimTrailingWhitespace) {
                s = s.replace(/[ \t]+$/gm, '');
            }

            return s.trim();
        }

        /**
         * Show format confirmation dialog when formatting full document (Section 35.1 A)
         */
        static showFormatConfirmDialog(onConfirm) {
            if (typeof onConfirm !== 'function') return;

            const modalEl = document.getElementById('ide-modal-format-confirm');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
                const confirmBtn = document.getElementById('ide-btn-confirm-format');

                const handler = () => {
                    if (confirmBtn) confirmBtn.removeEventListener('click', handler);
                    modal.hide();
                    onConfirm();
                };

                if (confirmBtn) {
                    confirmBtn.addEventListener('click', handler, { once: true });
                }

                modal.show();
            } else {
                const confirmed = window.confirm('Toàn bộ nội dung SQL trong tài liệu hiện tại sẽ được định dạng lại. Bạn có muốn tiếp tục không?');
                if (confirmed) {
                    onConfirm();
                }
            }
        }
    }

    window.SqlFormatter = SqlFormatter;

})(typeof window !== 'undefined' ? window : globalThis);
