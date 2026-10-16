/**
 * Position Mapper for SQL Syntax Check
 * Handles accurate line/column calculations, offset translations, and token boundary expansion.
 * Reference: .SKILL/sytax_check.md (Section 12)
 */

(function (window) {
    'use strict';

    /**
     * Compute 1-indexed line and column from character offset
     */
    function offsetToPosition(text, offset) {
        if (!text || typeof text !== 'string') return { line: 1, column: 1 };
        let line = 1;
        let column = 1;
        const target = Math.max(0, Math.min(offset, text.length));

        for (let i = 0; i < target; i++) {
            const ch = text[i];
            if (ch === '\n') {
                line++;
                column = 1;
            } else if (ch !== '\r') {
                column++;
            }
        }
        return { line, column };
    }

    /**
     * Compute 0-indexed character offset from 1-indexed line and column
     */
    function positionToOffset(text, line, column) {
        if (!text || typeof text !== 'string') return 0;
        let curLine = 1;
        let curCol = 1;
        const targetLine = Math.max(1, line);
        const targetCol = Math.max(1, column);

        for (let i = 0; i < text.length; i++) {
            if (curLine === targetLine && curCol === targetCol) {
                return i;
            }
            const ch = text[i];
            if (ch === '\n') {
                if (curLine === targetLine) return i; // end of target line
                curLine++;
                curCol = 1;
            } else if (ch !== '\r') {
                curCol++;
            }
        }
        return text.length;
    }

    /**
     * Expand token bounds on a given line so Monaco renders a clear wavy underline
     * across the entire erroneous token or keyword.
     */
    function expandTokenRange(text, line, column, token = '') {
        if (!text || typeof text !== 'string') {
            return {
                startLine: line,
                startColumn: column,
                endLine: line,
                endColumn: column + Math.max(1, token.length)
            };
        }

        const lines = text.split(/\r?\n/);
        const lineIdx = line - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) {
            return {
                startLine: line,
                startColumn: column,
                endLine: line,
                endColumn: column + Math.max(1, token.length)
            };
        }

        const lineText = lines[lineIdx];
        const chars = Array.from(lineText);
        const lineLen = chars.length;
        if (lineLen === 0) {
            return {
                startLine: line,
                startColumn: 1,
                endLine: line,
                endColumn: 2
            };
        }
        const colIdx = Math.max(0, Math.min(column - 1, lineLen - 1));

        // If explicit token is provided, locate it near the column
        if (token) {
            const cleanToken = token.trim();
            if (cleanToken) {
                const tokenChars = Array.from(cleanToken);
                const tLen = tokenChars.length;
                const findInChars = (fromIdx) => {
                    for (let i = fromIdx; i <= lineLen - tLen; i++) {
                        let match = true;
                        for (let k = 0; k < tLen; k++) {
                            if (chars[i + k] !== tokenChars[k]) {
                                match = false;
                                break;
                            }
                        }
                        if (match) return i;
                    }
                    return -1;
                };

                let foundIdx = findInChars(Math.max(0, colIdx - tLen));
                if (foundIdx === -1) {
                    foundIdx = findInChars(0);
                }
                if (foundIdx !== -1) {
                    return {
                        startLine: line,
                        startColumn: foundIdx + 1,
                        endLine: line,
                        endColumn: foundIdx + 1 + tLen
                    };
                }
            }
        }

        // Expand word boundary around colIdx using Unicode character class properties
        const isWordChar = (ch) => typeof ch === 'string' && /[\p{L}\p{N}_@#$]/u.test(ch);

        let start = colIdx;
        while (start > 0 && isWordChar(chars[start - 1])) {
            start--;
        }

        let end = colIdx;
        while (end < chars.length && isWordChar(chars[end])) {
            end++;
        }

        if (end <= start) {
            end = Math.min(chars.length, start + 1);
        }

        return {
            startLine: line,
            startColumn: start + 1,
            endLine: line,
            endColumn: Math.max(start + 2, end + 1)
        };
    }

    window.SqlPositionMapper = {
        offsetToPosition,
        positionToOffset,
        expandTokenRange
    };

})(typeof window !== 'undefined' ? window : globalThis);
