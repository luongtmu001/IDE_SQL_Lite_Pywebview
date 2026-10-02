// SQL Tokenizer for Web IDE IntelliSense
// High-performance Lexer / Tokenizer in Vanilla JavaScript
// Compliant with Section 9 and Section 64 of intellisense_improvement_plan_v2.md

(function (window) {
    'use strict';

    const TokenType = {
        KEYWORD: 'KEYWORD',
        IDENTIFIER: 'IDENTIFIER',
        STRING: 'STRING',
        NUMBER: 'NUMBER',
        OPERATOR: 'OPERATOR',
        PUNCTUATION: 'PUNCTUATION',
        PARAMETER: 'PARAMETER',       // @var, @@var, #temp, ##global_temp
        COMMENT_LINE: 'COMMENT_LINE', // --
        COMMENT_BLOCK: 'COMMENT_BLOCK', // /* */
        WHITESPACE: 'WHITESPACE',
        UNKNOWN: 'UNKNOWN'
    };

    class SqlTokenizer {
        constructor() {
            // Standard SQL operators
            this.multiCharOperators = new Set(['<>', '!=', '>=', '<=', '+=', '-=', '*=', '/=', '||', '::']);
            this.singleCharOperators = new Set(['=', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '~']);
            this.punctuation = new Set(['.', ',', '(', ')', ';', '[', ']', '{', '}']);
        }

        cleanIdentifier(name) {
            if (!name) return '';
            name = name.trim();
            if ((name.startsWith('[') && name.endsWith(']')) ||
                (name.startsWith('"') && name.endsWith('"')) ||
                (name.startsWith('`') && name.endsWith('`'))) {
                return name.substring(1, name.length - 1);
            }
            return name;
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
                        type: TokenType.WHITESPACE,
                        value: sqlText.substring(start, i),
                        start: start,
                        end: i,
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
                        type: TokenType.COMMENT_LINE,
                        value: sqlText.substring(start, i),
                        start: start,
                        end: i,
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
                        i += 2; // skip */
                        col += 2;
                    }
                    tokens.push({
                        type: TokenType.COMMENT_BLOCK,
                        value: sqlText.substring(start, i),
                        start: start,
                        end: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 4. String literal: '...' with '' escaping
                if (ch === "'") {
                    i++;
                    col++;
                    while (i < len) {
                        if (sqlText[i] === "'") {
                            if (i + 1 < len && sqlText[i + 1] === "'") {
                                i += 2; // escaped quote ''
                                col += 2;
                                continue;
                            } else {
                                i++; // closing quote
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
                    tokens.push({
                        type: TokenType.STRING,
                        value: sqlText.substring(start, i),
                        start: start,
                        end: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 5. Bracketed identifier: [...]
                if (ch === '[') {
                    i++;
                    col++;
                    let terminated = false;
                    while (i < len) {
                        if (sqlText[i] === ']') {
                            if (i + 1 < len && sqlText[i + 1] === ']') {
                                // Escaped bracket ]] in T-SQL
                                i += 2;
                                col += 2;
                                continue;
                            }
                            terminated = true;
                            i++;
                            col++;
                            break;
                        }
                        if (sqlText[i] === '\n') {
                            line++;
                            col = 1;
                        } else {
                            col++;
                        }
                        i++;
                    }
                    tokens.push({
                        type: TokenType.IDENTIFIER,
                        value: sqlText.substring(start, i),
                        start: start,
                        end: i,
                        line: tokenLine,
                        col: tokenCol,
                        isQuoted: true,
                        quoteChar: '[',
                        closeQuoteChar: ']',
                        terminated: terminated
                    });
                    continue;
                }

                // 6. Double-quoted or Backticked identifier: "..." or `...`
                if (ch === '"' || ch === '`') {
                    const quoteChar = ch;
                    i++;
                    col++;
                    let terminated = false;
                    while (i < len) {
                        if (sqlText[i] === quoteChar) {
                            if (i + 1 < len && sqlText[i + 1] === quoteChar) {
                                // Escaped quote "" or ``
                                i += 2;
                                col += 2;
                                continue;
                            }
                            terminated = true;
                            i++;
                            col++;
                            break;
                        }
                        if (sqlText[i] === '\n') {
                            line++;
                            col = 1;
                        } else {
                            col++;
                        }
                        i++;
                    }
                    tokens.push({
                        type: TokenType.IDENTIFIER,
                        value: sqlText.substring(start, i),
                        start: start,
                        end: i,
                        line: tokenLine,
                        col: tokenCol,
                        isQuoted: true,
                        quoteChar: quoteChar,
                        closeQuoteChar: quoteChar,
                        terminated: terminated
                    });
                    continue;
                }

                // 7. Parameters & Temp Tables: @param, @@var, #temp, ##global_temp
                if (ch === '@' || ch === '#') {
                    while (i < len && (sqlText[i] === '@' || sqlText[i] === '#' || /[a-zA-Z0-9_$]/.test(sqlText[i]))) {
                        i++;
                        col++;
                    }
                    tokens.push({
                        type: TokenType.PARAMETER,
                        value: sqlText.substring(start, i),
                        start: start,
                        end: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 7b. PostgreSQL Dollar-Quoting Tag: $$ or $tag$ or $BODY$, and Positional Parameters $1, $2
                if (ch === '$') {
                    let tagEnd = i + 1;
                    // Check for $$
                    if (tagEnd < len && sqlText[tagEnd] === '$') {
                        tagEnd++;
                        tokens.push({
                            type: TokenType.PUNCTUATION,
                            value: sqlText.substring(i, tagEnd),
                            upper: sqlText.substring(i, tagEnd),
                            start: i,
                            end: tagEnd,
                            line: tokenLine,
                            col: tokenCol
                        });
                        col += (tagEnd - i);
                        i = tagEnd;
                        continue;
                    }
                    // Check for $tag$
                    if (tagEnd < len && /[a-zA-Z_]/.test(sqlText[tagEnd])) {
                        while (tagEnd < len && /[a-zA-Z0-9_]/.test(sqlText[tagEnd])) {
                            tagEnd++;
                        }
                        if (tagEnd < len && sqlText[tagEnd] === '$') {
                            tagEnd++;
                            tokens.push({
                                type: TokenType.PUNCTUATION,
                                value: sqlText.substring(i, tagEnd),
                                upper: sqlText.substring(i, tagEnd).toUpperCase(),
                                start: i,
                                end: tagEnd,
                                line: tokenLine,
                                col: tokenCol
                            });
                            col += (tagEnd - i);
                            i = tagEnd;
                            continue;
                        }
                    }
                    // Check for Positional parameter: $1, $2, etc.
                    if (tagEnd < len && /[0-9]/.test(sqlText[tagEnd])) {
                        while (tagEnd < len && /[0-9]/.test(sqlText[tagEnd])) {
                            tagEnd++;
                        }
                        tokens.push({
                            type: TokenType.PARAMETER,
                            value: sqlText.substring(i, tagEnd),
                            upper: sqlText.substring(i, tagEnd),
                            start: i,
                            end: tagEnd,
                            line: tokenLine,
                            col: tokenCol
                        });
                        col += (tagEnd - i);
                        i = tagEnd;
                        continue;
                    }
                }

                // 8. Numbers (integer, float, hex 0x...)
                if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(nextCh))) {
                    let hasDot = (ch === '.');
                    i++;
                    col++;
                    if (ch === '0' && (i < len && (sqlText[i] === 'x' || sqlText[i] === 'X'))) {
                        i++;
                        col++;
                        while (i < len && /[0-9a-fA-F]/.test(sqlText[i])) {
                            i++;
                            col++;
                        }
                    } else {
                        while (i < len) {
                            if (sqlText[i] === '.') {
                                if (hasDot) break;
                                hasDot = true;
                                i++;
                                col++;
                            } else if (/[0-9]/.test(sqlText[i])) {
                                i++;
                                col++;
                            } else if ((sqlText[i] === 'e' || sqlText[i] === 'E') && i + 1 < len) {
                                i++;
                                col++;
                                if (sqlText[i] === '+' || sqlText[i] === '-') {
                                    i++;
                                    col++;
                                }
                            } else {
                                break;
                            }
                        }
                    }
                    tokens.push({
                        type: TokenType.NUMBER,
                        value: sqlText.substring(start, i),
                        start: start,
                        end: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 9. Multi-character operators (<>, !=, >=, <=, etc.)
                const twoChars = ch + nextCh;
                if (this.multiCharOperators.has(twoChars)) {
                    i += 2;
                    col += 2;
                    tokens.push({
                        type: TokenType.OPERATOR,
                        value: twoChars,
                        start: start,
                        end: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 10. Single-character operators
                if (this.singleCharOperators.has(ch)) {
                    i++;
                    col++;
                    tokens.push({
                        type: TokenType.OPERATOR,
                        value: ch,
                        start: start,
                        end: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 11. Punctuation (., ,, (, ), ;, etc.)
                if (this.punctuation.has(ch)) {
                    i++;
                    col++;
                    tokens.push({
                        type: TokenType.PUNCTUATION,
                        value: ch,
                        start: start,
                        end: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 12. Identifiers & Keywords
                if (/[a-zA-Z_]/.test(ch)) {
                    while (i < len && /[a-zA-Z0-9_$]/.test(sqlText[i])) {
                        i++;
                        col++;
                    }
                    const word = sqlText.substring(start, i);
                    const upper = word.toUpperCase();

                    // Determine if keyword
                    const isKw = this._isKnownKeyword(upper);

                    tokens.push({
                        type: isKw ? TokenType.KEYWORD : TokenType.IDENTIFIER,
                        value: word,
                        upper: upper,
                        start: start,
                        end: i,
                        line: tokenLine,
                        col: tokenCol
                    });
                    continue;
                }

                // 13. Fallback / Unknown character
                i++;
                col++;
                tokens.push({
                    type: TokenType.UNKNOWN,
                    value: ch,
                    start: start,
                    end: i,
                    line: tokenLine,
                    col: tokenCol
                });
            }

            return tokens;
        }

        _isKnownKeyword(upper) {
            if (window.SqlContextAnalyzer && window.SqlContextAnalyzer.SQL_KEYWORDS) {
                return window.SqlContextAnalyzer.SQL_KEYWORDS.includes(upper);
            }
            // Standard fallback keywords
            const basic = new Set([
                'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS',
                'ON', 'GROUP', 'ORDER', 'BY', 'HAVING', 'INSERT', 'INTO', 'VALUES', 'UPDATE',
                'SET', 'DELETE', 'TRUNCATE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW',
                'INDEX', 'PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER', 'AND', 'OR', 'NOT',
                'IN', 'EXISTS', 'AS', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
                'TOP', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'WITH', 'EXEC', 'EXECUTE', 'GO'
            ]);
            return basic.has(upper);
        }

        filterCodeTokens(tokens) {
            return tokens.filter(t => 
                t.type !== TokenType.WHITESPACE &&
                t.type !== TokenType.COMMENT_LINE &&
                t.type !== TokenType.COMMENT_BLOCK
            );
        }

        static cleanIdentifier(name) {
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

        cleanIdentifier(name) {
            return SqlTokenizer.cleanIdentifier(name);
        }
    }

    const defaultTokenizer = new SqlTokenizer();

    window.TokenType = TokenType;
    window.SqlTokenizer = SqlTokenizer;
    window.DefaultSqlTokenizer = defaultTokenizer;

})(window);
