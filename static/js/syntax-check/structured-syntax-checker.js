/**
 * structured-syntax-checker.js
 * Client-side syntax checking extension for XML and JSON files in Monaco Editor.
 * Reference: User Request & .SKILL/STRUCTURED_DATA_VIEWER.md
 */

(function (window) {
    'use strict';

    const MARKER_OWNER = 'syntax-check';

    const StructuredSyntaxChecker = {
        MARKER_OWNER,

        /**
         * Checks XML syntax using browser native DOMParser.
         * Handles both single-root XML and multi-root XML fragments.
         * Extracts line, column, and error description.
         * @param {string} xmlText
         * @returns {{ valid: boolean, diagnostics: Array<{ line: number, column: number, message: string, code: string, source: string, token: string }> }}
         */
        checkXml: function (xmlText) {
            if (!xmlText || !xmlText.trim()) {
                return { valid: true, diagnostics: [] };
            }

            if (typeof DOMParser === 'undefined') {
                return { valid: true, diagnostics: [] };
            }

            try {
                const parser = new DOMParser();
                let doc = parser.parseFromString(xmlText, 'application/xml');
                let parserErrors = doc.getElementsByTagName('parsererror');

                if (parserErrors && parserErrors.length > 0) {
                    const rawErr = parserErrors[0].textContent || 'XML parsing error';

                    // If error is caused by XML fragment (multiple root elements or extra content at root level),
                    // attempt wrapped parse with `<__root__>`
                    let isFragment = false;
                    if (/extra content at the end|multiple root|junk after document element/i.test(rawErr)) {
                        const wrappedDoc = parser.parseFromString(`<__root__>${xmlText}</__root__>`, 'application/xml');
                        const wrappedErrors = wrappedDoc.getElementsByTagName('parsererror');
                        if (!wrappedErrors || wrappedErrors.length === 0) {
                            return { valid: true, diagnostics: [] };
                        }
                        parserErrors = wrappedErrors;
                        isFragment = true;
                    }

                    const errMsg = parserErrors[0].textContent || 'XML syntax error';

                    // Parse line & column from parsererror text
                    // Typical formats:
                    // - Chromium: "error on line 3 at column 12: Opening and ending tag mismatch: foo line 2 and bar"
                    // - Firefox: "XML Parsing Error: mismatched tag. Location: ... Line Number 3, Column 12:"
                    let line = 1;
                    let col = 1;

                    const lineColMatch = errMsg.match(/line\s*(\d+)(?:\s*(?:at\s*)?column\s*(\d+))?/i)
                        || errMsg.match(/Line Number\s*(\d+)(?:,\s*Column\s*(\d+))?/i);

                    if (lineColMatch) {
                        line = parseInt(lineColMatch[1], 10) || 1;
                        col = parseInt(lineColMatch[2], 10) || 1;
                    }

                    // Extract first descriptive error line
                    let cleanMsg = errMsg.split('\n')[0]
                        .replace(/^(?:error\s+on\s+line\s+\d+\s+at\s+column\s+\d+:\s*|XML Parsing Error:\s*|This page contains the following errors:\s*)/i, '')
                        .trim();
                    if (!cleanMsg) cleanMsg = 'Lỗi cú pháp XML';

                    return {
                        valid: false,
                        diagnostics: [{
                            severity: 'error',
                            message: cleanMsg,
                            code: 'XML_SYNTAX_ERROR',
                            source: 'xml',
                            line: line,
                            column: col,
                            token: ''
                        }]
                    };
                }

                return { valid: true, diagnostics: [] };
            } catch (err) {
                return {
                    valid: false,
                    diagnostics: [{
                        severity: 'error',
                        message: err.message || 'Lỗi kiểm tra cú pháp XML',
                        code: 'XML_SYNTAX_ERROR',
                        source: 'xml',
                        line: 1,
                        column: 1,
                        token: ''
                    }]
                };
            }
        },

        /**
         * Checks JSON syntax using JSON.parse.
         * Extracts line, column, and position from error message.
         * @param {string} jsonText
         * @returns {{ valid: boolean, diagnostics: Array<{ line: number, column: number, message: string, code: string, source: string, token: string }> }}
         */
        checkJson: function (jsonText) {
            if (!jsonText || !jsonText.trim()) {
                return { valid: true, diagnostics: [] };
            }

            try {
                JSON.parse(jsonText);
                return { valid: true, diagnostics: [] };
            } catch (err) {
                const errMsg = err.message || 'Lỗi cú pháp JSON';
                let line = 1;
                let col = 1;

                // Pattern 1: V8 / Node format: "at position 42" or "at position 0"
                const posMatch = errMsg.match(/at position (\d+)/i);
                if (posMatch) {
                    const pos = parseInt(posMatch[1], 10) || 0;
                    const prefix = jsonText.slice(0, Math.min(pos, jsonText.length));
                    const lines = prefix.split('\n');
                    line = lines.length;
                    col = lines[lines.length - 1].length + 1;
                } else {
                    // Pattern 2: Firefox / other engines: "line 3 column 5"
                    const lineColMatch = errMsg.match(/line\s*(\d+)\s*column\s*(\d+)/i);
                    if (lineColMatch) {
                        line = parseInt(lineColMatch[1], 10) || 1;
                        col = parseInt(lineColMatch[2], 10) || 1;
                    }
                }

                return {
                    valid: false,
                    diagnostics: [{
                        severity: 'error',
                        message: errMsg,
                        code: 'JSON_SYNTAX_ERROR',
                        source: 'json',
                        line: line,
                        column: col,
                        token: ''
                    }]
                };
            }
        },

        /**
         * Applies syntax check diagnostics directly to a Monaco Editor model.
         * @param {object} model - Monaco editor model
         * @param {'xml' | 'json'} format - Target format
         * @returns {{ valid: boolean, diagnostics: Array }}
         */
        validateModel: function (model, format) {
            if (!model || (typeof model.isDisposed === 'function' && model.isDisposed())) {
                return { valid: true, diagnostics: [] };
            }
            const m = window.monaco || (typeof monaco !== 'undefined' ? monaco : null);
            if (!m || !m.editor) {
                return { valid: true, diagnostics: [] };
            }

            const text = model.getValue ? model.getValue() : '';
            const normFormat = (format || (model.getLanguageId ? model.getLanguageId() : '')).toLowerCase();

            let result;
            if (normFormat === 'xml') {
                result = this.checkXml(text);
            } else if (normFormat === 'json') {
                result = this.checkJson(text);
            } else {
                return { valid: true, diagnostics: [] };
            }

            if (result.valid) {
                m.editor.setModelMarkers(model, MARKER_OWNER, []);
            } else {
                const markers = result.diagnostics.map(d => ({
                    severity: m.MarkerSeverity ? m.MarkerSeverity.Error : 8,
                    message: d.message,
                    startLineNumber: d.line,
                    startColumn: d.column,
                    endLineNumber: d.line,
                    endColumn: d.column + Math.max(1, (d.token || '').length),
                    source: d.source,
                    code: d.code
                }));
                m.editor.setModelMarkers(model, MARKER_OWNER, markers);
            }

            if (window.EditorStatusBar && typeof window.EditorStatusBar.updateIssues === 'function') {
                window.EditorStatusBar.updateIssues();
            }

            return result;
        }
    };

    window.StructuredSyntaxChecker = StructuredSyntaxChecker;

})(typeof window !== 'undefined' ? window : globalThis);
