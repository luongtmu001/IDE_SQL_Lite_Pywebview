/**
 * Monaco CodeAction Provider for SQL Syntax & Best Practice Quick-Fixes.
 * Sprint 3 - Smart IDE v1.1.0
 * 
 * Provides automated Quick-Fix suggestions (lightbulb / Alt+Enter):
 * - BP002: Remove table hint (NOLOCK) / WITH (NOLOCK)
 * - BP005: Convert T-SQL ISNULL(a, b) to ANSI COALESCE(a, b)
 * - BP006: Convert T-SQL CONVERT(type, val) to ANSI CAST(val AS type)
 */

(function (window) {
    'use strict';

    let _isRegistered = false;

    function registerSqlQuickFixProvider() {
        if (_isRegistered) return;
        const m = window.monaco;
        if (!m || !m.languages || typeof m.languages.registerCodeActionProvider !== 'function') {
            return;
        }

        const languages = ['sql', 'tsql', 'mssql', 'postgresql'];

        const provider = {
            provideCodeActions(model, range, context) {
                const actions = [];
                const markers = (context && Array.isArray(context.markers)) ? context.markers : [];

                for (const marker of markers) {
                    const code = String(marker.code || '');

                    // 1. BP002: Remove (NOLOCK) hint
                    if (code === 'BP002') {
                        actions.push({
                            title: 'Xóa gợi ý bảng (NOLOCK)',
                            diagnostics: [marker],
                            kind: 'quickfix',
                            isPreferred: true,
                            edit: {
                                edits: [{
                                    resource: model.uri,
                                    textEdit: {
                                        range: {
                                            startLineNumber: marker.startLineNumber,
                                            startColumn: marker.startColumn,
                                            endLineNumber: marker.endLineNumber,
                                            endColumn: marker.endColumn
                                        },
                                        text: ''
                                    }
                                }]
                            }
                        });
                    }

                    // 2. BP005: Replace ISNULL with COALESCE
                    else if (code === 'BP005') {
                        actions.push({
                            title: 'Chuyển đổi thành chuẩn ANSI COALESCE',
                            diagnostics: [marker],
                            kind: 'quickfix',
                            isPreferred: true,
                            edit: {
                                edits: [{
                                    resource: model.uri,
                                    textEdit: {
                                        range: {
                                            startLineNumber: marker.startLineNumber,
                                            startColumn: marker.startColumn,
                                            endLineNumber: marker.startLineNumber,
                                            endColumn: marker.startColumn + 6 // len("ISNULL")
                                        },
                                        text: 'COALESCE'
                                    }
                                }]
                            }
                        });
                    }

                    // 3. BP006: Replace 2-argument CONVERT(T, X) with CAST(X AS T)
                    else if (code === 'BP006') {
                        try {
                            const lineContent = model.getLineContent(marker.startLineNumber) || '';
                            const subText = lineContent.substring(marker.startColumn - 1);
                            const convertMatch = subText.match(/^CONVERT\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/i);
                            if (convertMatch) {
                                const targetType = convertMatch[1].trim();
                                const targetVal = convertMatch[2].trim();
                                const fullMatchLength = convertMatch[0].length;
                                actions.push({
                                    title: `Chuyển thành chuẩn ANSI CAST(${targetVal} AS ${targetType})`,
                                    diagnostics: [marker],
                                    kind: 'quickfix',
                                    isPreferred: true,
                                    edit: {
                                        edits: [{
                                            resource: model.uri,
                                            textEdit: {
                                                range: {
                                                    startLineNumber: marker.startLineNumber,
                                                    startColumn: marker.startColumn,
                                                    endLineNumber: marker.startLineNumber,
                                                    endColumn: marker.startColumn + fullMatchLength
                                                },
                                                text: `CAST(${targetVal} AS ${targetType})`
                                            }
                                        }]
                                    }
                                });
                            }
                        } catch (_) {}
                    }
                }

                return {
                    actions: actions,
                    dispose: () => {}
                };
            }
        };

        languages.forEach(lang => {
            try {
                m.languages.registerCodeActionProvider(lang, provider);
            } catch (_) {}
        });

        _isRegistered = true;
    }

    // Try registering immediately, or after monaco loader initializes
    if (typeof window !== 'undefined') {
        if (window.monaco && window.monaco.languages) {
            registerSqlQuickFixProvider();
        } else {
            window.addEventListener('load', () => {
                setTimeout(registerSqlQuickFixProvider, 500);
                setTimeout(registerSqlQuickFixProvider, 1500);
            });
            document.addEventListener('monaco-initialized', registerSqlQuickFixProvider);
        }

        window.SqlQuickFixProvider = {
            register: registerSqlQuickFixProvider,
            isRegistered: () => _isRegistered
        };
    }

})(typeof window !== 'undefined' ? window : globalThis);
