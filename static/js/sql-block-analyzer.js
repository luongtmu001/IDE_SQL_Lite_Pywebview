/**
 * sql-block-analyzer.js - SQL Block Structure Analyzer
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements Section 36 to 48 of Object_Explorer_Filter_Context_Menu_Synonyms_Plan.md
 *
 * Provides dialect-aware lexical block detection for:
 * - Goto Begin / Goto End navigation in Monaco Editor
 * - SQL Server: BEGIN/END, BEGIN TRY/END TRY, BEGIN CATCH/END CATCH, CASE/END
 * - PostgreSQL: BEGIN/END, IF..THEN/END IF, LOOP/END LOOP, DO $$...$$, EXCEPTION
 * - Safely ignores string literals, line comments (--), and block comments (/* *\/)
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (window) {
    'use strict';

    class SqlBlockAnalyzer {
        /**
         * Tokenize SQL text into block-relevant tokens while skipping comments & string literals.
         * @param {string} sql 
         * @param {string} dialect - 'sqlserver' | 'postgresql'
         * @returns {Array<Object>} tokens
         */
        static tokenize(sql, dialect = 'sqlserver') {
            const tokens = [];
            if (!sql || typeof sql !== 'string') return tokens;

            const isPg = String(dialect || '').toLowerCase().includes('postgr');
            const len = sql.length;
            let i = 0;

            while (i < len) {
                const ch = sql[i];
                const nextCh = i + 1 < len ? sql[i + 1] : '';

                // 1. Skip Whitespace
                if (/\s/.test(ch)) {
                    i++;
                    continue;
                }

                // 2. Skip Line Comment: -- ... \n
                if (ch === '-' && nextCh === '-') {
                    i += 2;
                    while (i < len && sql[i] !== '\n') i++;
                    continue;
                }

                // 3. Skip Block Comment: /* ... */
                if (ch === '/' && nextCh === '*') {
                    i += 2;
                    while (i < len && !(sql[i] === '*' && i + 1 < len && sql[i + 1] === '/')) {
                        i++;
                    }
                    if (i < len) i += 2;
                    continue;
                }

                // 4. Skip Single-Quoted String Literal: '...' or N'...' (with '' escaping)
                if (ch === "'" || ((ch === 'N' || ch === 'n') && nextCh === "'")) {
                    if (ch === 'N' || ch === 'n') i++;
                    i++; // skip opening quote
                    while (i < len) {
                        if (sql[i] === "'") {
                            if (i + 1 < len && sql[i + 1] === "'") {
                                i += 2; // escaped quote ''
                                continue;
                            } else {
                                i++; // closing quote
                                break;
                            }
                        }
                        i++;
                    }
                    continue;
                }

                // 5. Skip Square Bracket Identifier in SQL Server: [ident]]ident]
                if (!isPg && ch === '[') {
                    i++;
                    while (i < len) {
                        if (sql[i] === ']') {
                            if (i + 1 < len && sql[i + 1] === ']') {
                                i += 2;
                                continue;
                            } else {
                                i++;
                                break;
                            }
                        }
                        i++;
                    }
                    continue;
                }

                // 6. Skip Double-Quoted Identifier in PostgreSQL: "ident""ident"
                if (ch === '"') {
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
                    continue;
                }

                // 7. Check Word Tokens
                if (/[a-zA-Z_]/.test(ch)) {
                    const start = i;
                    while (i < len && /[a-zA-Z0-9_$]/.test(sql[i])) {
                        i++;
                    }
                    const word = sql.substring(start, i);
                    const upper = word.toUpperCase();

                    // Check for multi-word delimiters
                    if (upper === 'BEGIN') {
                        // Look ahead for TRY, CATCH, TRAN, TRANSACTION
                        const rest = sql.substring(i);
                        const matchSub = rest.match(/^\s+(TRY|CATCH|TRAN|TRANSACTION)\b/i);
                        if (matchSub) {
                            const subWord = matchSub[1].toUpperCase();
                            const fullEnd = i + matchSub[0].length;
                            if (subWord === 'TRY') {
                                tokens.push({ type: 'BEGIN_TRY', text: sql.substring(start, fullEnd), start, end: fullEnd });
                                i = fullEnd;
                                continue;
                            } else if (subWord === 'CATCH') {
                                tokens.push({ type: 'BEGIN_CATCH', text: sql.substring(start, fullEnd), start, end: fullEnd });
                                i = fullEnd;
                                continue;
                            } else {
                                // BEGIN TRAN / TRANSACTION is transaction scope, not code block delimiter
                                i = fullEnd;
                                continue;
                            }
                        }
                        tokens.push({ type: 'BEGIN', text: word, start, end: i });
                        continue;
                    }

                    if (upper === 'END') {
                        // Look ahead for TRY, CATCH, IF, LOOP
                        const rest = sql.substring(i);
                        const matchSub = rest.match(/^\s+(TRY|CATCH|IF|LOOP)\b/i);
                        if (matchSub) {
                            const subWord = matchSub[1].toUpperCase();
                            const fullEnd = i + matchSub[0].length;
                            if (subWord === 'TRY') {
                                tokens.push({ type: 'END_TRY', text: sql.substring(start, fullEnd), start, end: fullEnd });
                                i = fullEnd;
                                continue;
                            } else if (subWord === 'CATCH') {
                                tokens.push({ type: 'END_CATCH', text: sql.substring(start, fullEnd), start, end: fullEnd });
                                i = fullEnd;
                                continue;
                            } else if (subWord === 'IF') {
                                tokens.push({ type: 'END_IF', text: sql.substring(start, fullEnd), start, end: fullEnd });
                                i = fullEnd;
                                continue;
                            } else if (subWord === 'LOOP') {
                                tokens.push({ type: 'END_LOOP', text: sql.substring(start, fullEnd), start, end: fullEnd });
                                i = fullEnd;
                                continue;
                            }
                        }
                        tokens.push({ type: 'END', text: word, start, end: i });
                        continue;
                    }

                    if (upper === 'CASE') {
                        tokens.push({ type: 'CASE', text: word, start, end: i });
                        continue;
                    }

                    if (isPg) {
                        if (upper === 'IF') {
                            // In PG, IF condition THEN ... END IF
                            tokens.push({ type: 'IF', text: word, start, end: i });
                            continue;
                        }
                        if (upper === 'LOOP') {
                            tokens.push({ type: 'LOOP', text: word, start, end: i });
                            continue;
                        }
                    }

                    continue;
                }

                // Other punctuation / characters
                i++;
            }

            return tokens;
        }

        /**
         * Analyze matching block pairs from token stream.
         * @param {string} sql 
         * @param {string} dialect 
         * @returns {Array<Object>} blocks
         */
        static analyzeBlocks(sql, dialect = 'sqlserver') {
            const tokens = this.tokenize(sql, dialect);
            const blocks = [];
            const stack = [];

            for (const t of tokens) {
                // Opening tokens
                if (t.type === 'BEGIN' || t.type === 'BEGIN_TRY' || t.type === 'BEGIN_CATCH' ||
                    t.type === 'CASE' || t.type === 'IF' || t.type === 'LOOP') {
                    stack.push(t);
                    continue;
                }

                // Closing tokens
                if (t.type === 'END_TRY') {
                    for (let j = stack.length - 1; j >= 0; j--) {
                        if (stack[j].type === 'BEGIN_TRY') {
                            const opening = stack.splice(j, 1)[0];
                            blocks.push({
                                type: 'TRY_CATCH',
                                startToken: opening,
                                endToken: t
                            });
                            break;
                        }
                    }
                    continue;
                }

                if (t.type === 'END_CATCH') {
                    for (let j = stack.length - 1; j >= 0; j--) {
                        if (stack[j].type === 'BEGIN_CATCH') {
                            const opening = stack.splice(j, 1)[0];
                            blocks.push({
                                type: 'TRY_CATCH',
                                startToken: opening,
                                endToken: t
                            });
                            break;
                        }
                    }
                    continue;
                }

                if (t.type === 'END_IF') {
                    for (let j = stack.length - 1; j >= 0; j--) {
                        if (stack[j].type === 'IF') {
                            const opening = stack.splice(j, 1)[0];
                            blocks.push({
                                type: 'IF_BLOCK',
                                startToken: opening,
                                endToken: t
                            });
                            break;
                        }
                    }
                    continue;
                }

                if (t.type === 'END_LOOP') {
                    for (let j = stack.length - 1; j >= 0; j--) {
                        if (stack[j].type === 'LOOP') {
                            const opening = stack.splice(j, 1)[0];
                            blocks.push({
                                type: 'LOOP_BLOCK',
                                startToken: opening,
                                endToken: t
                            });
                            break;
                        }
                    }
                    continue;
                }

                if (t.type === 'END') {
                    // Standard END matches nearest BEGIN or CASE
                    for (let j = stack.length - 1; j >= 0; j--) {
                        if (stack[j].type === 'BEGIN' || stack[j].type === 'CASE') {
                            const opening = stack.splice(j, 1)[0];
                            blocks.push({
                                type: opening.type === 'CASE' ? 'CASE_BLOCK' : 'BEGIN_END',
                                startToken: opening,
                                endToken: t
                            });
                            break;
                        }
                    }
                    continue;
                }
            }

            return blocks;
        }

        /**
         * Find nearest enclosing block containing cursorOffset.
         * @param {string} sql 
         * @param {number} cursorOffset 
         * @param {string} dialect 
         * @returns {Object|null} block
         */
        static findEnclosingBlock(sql, cursorOffset, dialect = 'sqlserver') {
            const blocks = this.analyzeBlocks(sql, dialect);
            if (!blocks.length) return null;

            // Find all blocks that contain cursorOffset
            const candidates = blocks.filter(b => 
                b.startToken.start <= cursorOffset && cursorOffset <= b.endToken.end
            );

            if (!candidates.length) return null;

            // Pick the innermost block (smallest span)
            candidates.sort((a, b) => {
                const spanA = a.endToken.end - a.startToken.start;
                const spanB = b.endToken.end - b.startToken.start;
                return spanA - spanB;
            });

            return candidates[0];
        }

        /**
         * Get target cursor jump offset for Goto Begin / Goto End.
         * @param {string} sql 
         * @param {number} cursorOffset 
         * @param {'BEGIN'|'END'} targetType 
         * @param {string} dialect 
         * @returns {{ targetOffset: number|null, block: Object|null }}
         */
        static getJumpTarget(sql, cursorOffset, targetType, dialect = 'sqlserver') {
            const block = this.findEnclosingBlock(sql, cursorOffset, dialect);
            if (!block) {
                return { targetOffset: null, block: null };
            }

            if (targetType === 'BEGIN') {
                // If cursor is already on the opening token, stay on it (Section 45 rule)
                if (cursorOffset >= block.startToken.start && cursorOffset <= block.startToken.end) {
                    return { targetOffset: block.startToken.start, block };
                }
                return { targetOffset: block.startToken.start, block };
            } else {
                // Goto End
                // If cursor is already on the closing token, stay on it (Section 46 rule)
                if (cursorOffset >= block.endToken.start && cursorOffset <= block.endToken.end) {
                    return { targetOffset: block.endToken.start, block };
                }
                return { targetOffset: block.endToken.start, block };
            }
        }
    }

    window.SqlBlockAnalyzer = SqlBlockAnalyzer;

})(typeof window !== 'undefined' ? window : globalThis);
