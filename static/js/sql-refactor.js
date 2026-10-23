/**
 * sql-refactor.js - Smart SQL Refactor Engine (Sprint 3 - Bước 3.2 F5)
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Rename Identifier (F2 / Rename Symbol):
 *    - Registers Monaco RenameProvider for 'sql'.
 *    - Tokenizes SQL text using SqlTokenizer to find matching identifier tokens in scope.
 *    - Replaces all occurrences in query scope with undo/redo support.
 * 2. Extract to CTE (Alt+Shift+C / Ctrl+Shift+E / Context Menu):
 *    - Extracts selected subquery into a WITH clause at the top of the statement.
 *    - Replaces selected subquery with the new CTE name.
 * 3. Format on Paste:
 *    - Automatically formats multiline SQL paste cleanly using SqlFormatter.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (window) {
    'use strict';

    class SqlRefactorEngine {
        constructor() {
            this._isRegistered = false;
        }

        init() {
            if (this._isRegistered) return;
            this._isRegistered = true;

            this.registerMonacoRenameProvider();
        }

        /**
         * Register Rename Provider in Monaco Editor for 'sql' language.
         */
        registerMonacoRenameProvider() {
            if (typeof monaco === 'undefined' || !monaco.languages || !monaco.languages.registerRenameProvider) {
                return;
            }

            const self = this;

            monaco.languages.registerRenameProvider('sql', {
                resolveRenameLocation(model, position, token) {
                    const wordInfo = model.getWordAtPosition(position);
                    if (!wordInfo || !wordInfo.word) {
                        return {
                            rejectReason: 'Không tìm thấy định danh hợp lệ để đổi tên tại vị trí con trỏ.'
                        };
                    }

                    // Check if cursor is on a keyword
                    const isKeyword = window.SqlTokenizer && window.SqlTokenizer.isKeyword
                        ? window.SqlTokenizer.isKeyword(wordInfo.word)
                        : /^(SELECT|FROM|WHERE|JOIN|GROUP|ORDER|BY|HAVING|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TABLE|VIEW|INTO|VALUES|SET|WITH|AS|ON|AND|OR|NOT|IN|EXISTS|IS|NULL|CASE|WHEN|THEN|ELSE|END)$/i.test(wordInfo.word);

                    if (isKeyword) {
                        return {
                            rejectReason: `Từ khóa '${wordInfo.word}' là cú pháp SQL chuẩn, không thể đổi tên.`
                        };
                    }

                    return {
                        range: new monaco.Range(position.lineNumber, wordInfo.startColumn, position.lineNumber, wordInfo.endColumn),
                        text: wordInfo.word
                    };
                },

                provideRenameEdits(model, position, newName, token) {
                    const wordInfo = model.getWordAtPosition(position);
                    if (!wordInfo || !wordInfo.word) return null;

                    const oldName = wordInfo.word;
                    const cleanOld = oldName.replace(/^[\["`]+|[\]"`]+$/g, '');
                    const cleanNew = newName.replace(/^[\["`]+|[\]"`]+$/g, '').trim();

                    if (!cleanNew || cleanOld.toLowerCase() === cleanNew.toLowerCase()) {
                        return null;
                    }

                    const edits = self.findRenameEdits(model, cleanOld, cleanNew);
                    return { edits };
                }
            });
        }

        /**
         * Scan text and collect text edits for all matching identifier occurrences.
         */
        findRenameEdits(model, cleanOldName, cleanNewName) {
            const fullText = model.getValue();
            const edits = [];
            const targetLower = cleanOldName.toLowerCase();

            if (window.SqlTokenizer && typeof window.SqlTokenizer === 'function') {
                const tokenizer = new window.SqlTokenizer();
                const tokens = tokenizer.tokenize(fullText);

                tokens.forEach(tok => {
                    if (tok.type === 'IDENTIFIER' || tok.type === 'PARAMETER') {
                        const tokClean = tokenizer.cleanIdentifier(tok.value).toLowerCase();
                        if (tokClean === targetLower) {
                            // Retain quotation brackets if original token used them
                            let replacement = cleanNewName;
                            if (tok.value.startsWith('[') && tok.value.endsWith(']')) {
                                replacement = `[${cleanNewName}]`;
                            } else if (tok.value.startsWith('"') && tok.value.endsWith('"')) {
                                replacement = `"${cleanNewName}"`;
                            } else if (tok.value.startsWith('@')) {
                                replacement = `@${cleanNewName}`;
                            }

                            const startPos = model.getPositionAt(tok.start);
                            const endPos = model.getPositionAt(tok.end);

                            edits.push({
                                resource: model.uri,
                                textEdit: {
                                    range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
                                    text: replacement
                                }
                            });
                        }
                    }
                });
            } else {
                // Fallback regex matching word boundaries
                const lines = fullText.split('\n');
                lines.forEach((lineText, lineIdx) => {
                    const regex = new RegExp(`\\b${cleanOldName}\\b`, 'gi');
                    let match;
                    while ((match = regex.exec(lineText)) !== null) {
                        const startCol = match.index + 1;
                        const endCol = startCol + match[0].length;
                        edits.push({
                            resource: model.uri,
                            textEdit: {
                                range: new monaco.Range(lineIdx + 1, startCol, lineIdx + 1, endCol),
                                text: cleanNewName
                            }
                        });
                    }
                });
            }

            return edits;
        }

        /**
         * Extract selected subquery into a Common Table Expression (CTE).
         * @param {Object} editor Monaco editor instance or AppEditor
         */
        extractToCTE(targetEd) {
            let ed = targetEd;
            if (!ed) {
                ed = (typeof window.getActiveAppEditor === 'function') ? window.getActiveAppEditor() : window.AppEditor;
            }
            if (!ed) return;

            const monacoEd = ed.rawEditor || ed.monaco || (ed.getModel ? ed : null);
            if (!monacoEd) return;

            const model = monacoEd.getModel();
            const selection = monacoEd.getSelection();
            if (!model || !selection) return;

            let selectedText = model.getValueInRange(selection).trim();

            // If no text selected, try to detect enclosing parentheses around cursor
            if (!selectedText) {
                const pos = monacoEd.getPosition();
                const lineContent = model.getLineContent(pos.lineNumber);
                const openIdx = lineContent.lastIndexOf('(', pos.column - 1);
                const closeIdx = lineContent.indexOf(')', pos.column - 1);

                if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
                    selectedText = lineContent.substring(openIdx + 1, closeIdx).trim();
                }
            }

            // Clean outer parentheses
            let innerQuery = selectedText;
            if (innerQuery.startsWith('(') && innerQuery.endsWith(')')) {
                innerQuery = innerQuery.substring(1, innerQuery.length - 1).trim();
            }

            if (!innerQuery || !/^SELECT\b/i.test(innerQuery)) {
                if (window.showToast) {
                    window.showToast('Vui lòng chọn (bôi đen) câu truy vấn SELECT cần trích xuất thành CTE.', 'warning');
                } else {
                    alert('Vui lòng chọn (bôi đen) câu truy vấn SELECT cần trích xuất thành CTE.');
                }
                return;
            }

            const defaultCteName = 'cte_' + Math.random().toString(36).substring(2, 6);
            const cteName = prompt('Nhập tên cho Common Table Expression (CTE):', defaultCteName);
            if (!cteName || !cteName.trim()) return;

            const cleanCteName = cteName.trim();
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleanCteName)) {
                alert('Tên CTE không hợp lệ! Vui lòng chỉ sử dụng chữ cái, chữ số và dấu gạch dưới (_).');
                return;
            }

            // Indent inner query
            const indentedQuery = innerQuery.split('\n').map(l => '    ' + l).join('\n');
            const fullDocText = model.getValue();

            // Check if document already has WITH clause
            const withMatch = fullDocText.match(/^\s*WITH\s+([a-zA-Z0-9_]+)\s+AS\s*\(/im);

            if (withMatch) {
                // Insert as another CTE into existing WITH clause
                const cteSnippet = `\n    ${cleanCteName} AS (\n${indentedQuery}\n),`;
                // Insert after WITH
                const withIdx = fullDocText.search(/\bWITH\b/i);
                const insertPos = model.getPositionAt(withIdx + 4);

                monacoEd.executeEdits('extract-to-cte', [
                    {
                        range: new monaco.Range(insertPos.lineNumber, insertPos.column, insertPos.lineNumber, insertPos.column),
                        text: cteSnippet
                    },
                    {
                        range: selection,
                        text: cleanCteName
                    }
                ]);
            } else {
                // Prepend new WITH clause to the statement
                const withSnippet = `WITH ${cleanCteName} AS (\n${indentedQuery}\n)\n`;

                monacoEd.executeEdits('extract-to-cte', [
                    {
                        range: new monaco.Range(1, 1, 1, 1),
                        text: withSnippet
                    },
                    {
                        range: selection,
                        text: cleanCteName
                    }
                ]);
            }

            if (window.showToast) {
                window.showToast(`✓ Đã trích xuất CTE "${cleanCteName}" thành công!`, 'success');
            } else {
                alert(`✓ Đã trích xuất CTE "${cleanCteName}" thành công!`);
            }
        }

        /**
         * Hook paste event in Monaco editor.
         * Disabled per user requirement: Do NOT format code on paste.
         * Users format code manually when needed (via Ctrl+K, Ctrl+D / Format SQL button).
         * @param {Object} editor Monaco editor instance
         */
        hookFormatOnPaste(editor) {
            // Disabled: Never auto-format code on paste.
            // User will format code manually when needed.
            return;
        }
    }

    window.SqlRefactorEngine = new SqlRefactorEngine();

    // Auto-init on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.SqlRefactorEngine.init());
    } else {
        window.SqlRefactorEngine.init();
    }

})(window);
