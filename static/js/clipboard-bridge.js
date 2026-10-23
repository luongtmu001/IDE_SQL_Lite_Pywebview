/**
 * Clipboard Bridge - Zero-Loss Windows Native Clipboard Integration
 * File: static/js/clipboard-bridge.js
 * 
 * Ensures any copy/cut action in Monaco Editor, Grid Results, Table Data Editor,
 * Structured Data Viewer, or DOM elements writes reliably to the Windows OS clipboard
 * via Win32 ctypes / pywebview bridge + synchronous DOM user-gesture execution.
 */

(function (window) {
    'use strict';

    let _isProgrammaticCopy = false;
    let _programmaticText = '';

    // ── 1. Text Extractor for Monaco Editors ─────────────────────────────────
    function getMonacoSelectedOrLineText(editor) {
        if (!editor) return '';
        try {
            const model = editor.getModel();
            if (!model) return '';
            const selections = editor.getSelections();
            if (selections && selections.length > 0) {
                const hasNonEmpty = selections.some(s => !s.isEmpty());
                if (hasNonEmpty) {
                    return selections.map(s => model.getValueInRange(s)).join('\n');
                } else {
                    // Empty selection -> VS Code standard: copy full current line
                    const pos = editor.getPosition();
                    if (pos) {
                        return model.getLineContent(pos.lineNumber) + '\n';
                    }
                }
            }
        } catch (e) {
            console.warn('[Clipboard] Error extracting Monaco text:', e);
        }
        return '';
    }

    // ── 2. Universal copyToClipboard API ──────────────────────────────────────
    async function copyToClipboard(text) {
        if (typeof text !== 'string') {
            text = String(text ?? '');
        }
        if (!text) return true;

        let nativeSuccess = false;

        // A. Synchronous execCommand copy executed immediately within the active user gesture
        const prevActive = (document.activeElement && typeof document.activeElement.focus === 'function') ? document.activeElement : null;
        _isProgrammaticCopy = true;
        _programmaticText = text;
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            ta.style.top = '-9999px';
            ta.style.opacity = '0';
            ta.setAttribute('readonly', '');
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            if (ok) nativeSuccess = true;
        } catch (_) {
        } finally {
            _isProgrammaticCopy = false;
            _programmaticText = '';
            if (prevActive && document.body.contains(prevActive)) {
                try { prevActive.focus(); } catch (_) {}
            }
        }

        // B. Đồng thời cập nhật Web Clipboard nếu có quyền
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                nativeSuccess = true;
            } catch (_) {}
        }

        // C. Ghi trực tiếp vào Windows OS Clipboard qua Python Win32 ctypes bridge
        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_clipboard_text === 'function') {
                const res = await window.pywebview.api.set_clipboard_text(text);
                if (res && res.success) {
                    nativeSuccess = true;
                }
            }
        } catch (e) {
            console.warn('[Clipboard] Native clipboard bridge error:', e);
        }

        return nativeSuccess;
    }

    // ── 3. Universal readFromClipboard API ────────────────────────────────────
    async function readFromClipboard() {
        // A. Ưu tiên đọc từ Windows OS Clipboard qua Python Win32 ctypes bridge
        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_clipboard_text === 'function') {
                const res = await window.pywebview.api.get_clipboard_text();
                if (res && res.success && typeof res.text === 'string') {
                    return res.text;
                }
            }
        } catch (e) {
            console.warn('[Clipboard] Native read clipboard error:', e);
        }

        // B. Fallback qua navigator.clipboard.readText
        if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
            try {
                return await navigator.clipboard.readText();
            } catch (_) {}
        }

        return '';
    }

    // ── 4. Global Capture-Phase Copy/Cut Listener ────────────────────────────
    function handleGlobalCopyCapture(e) {
        // If copyToClipboard triggered this event programmatically, populate data directly
        if (_isProgrammaticCopy) {
            if (_programmaticText) {
                e.preventDefault();
                if (e.clipboardData) {
                    try {
                        e.clipboardData.setData('text/plain', _programmaticText);
                    } catch (_) {}
                }
            }
            return;
        }

        let text = '';
        let targetEd = null;

        // Check active Monaco Editor ONLY if editor actually has focus
        if (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.getEditors === 'function') {
            try {
                const editors = monaco.editor.getEditors();
                targetEd = editors.find(ed => ed.hasTextFocus && ed.hasTextFocus());
                if (!targetEd && document.activeElement) {
                    targetEd = editors.find(ed => {
                        const dom = ed.getDomNode && ed.getDomNode();
                        return dom && dom.contains(document.activeElement);
                    });
                }
                if (!targetEd && document.activeElement && document.activeElement.closest('.monaco-editor, #ide-editor-container, .ide-editor-container, .ide-editor-pane')) {
                    if (window.AppEditor && typeof window.AppEditor.getMonaco === 'function') {
                        targetEd = window.AppEditor.getMonaco();
                    } else if (window.EditorStatusBar && typeof window.EditorStatusBar.getActiveEditor === 'function') {
                        targetEd = window.EditorStatusBar.getActiveEditor();
                    }
                }
                if (targetEd) {
                    text = getMonacoSelectedOrLineText(targetEd);
                }
            } catch (_) {}
        }

        // Check active Result Grid if active element is inside grid or results container
        if (!text) {
            const gridEl = document.activeElement ? document.activeElement.closest('.ide-ag-grid-instance, .ide-grid-table-scroll, .ide-grid-pane') : null;
            if (gridEl && window.GridResultController && window.GridResultController.activeInstance) {
                const activeGrid = window.GridResultController.activeInstance;
                if (typeof activeGrid.getSelectionCopyText === 'function') {
                    text = activeGrid.getSelectionCopyText(false);
                }
            }
        }

        // Check active input / textarea
        if (!text && document.activeElement) {
            const el = document.activeElement;
            if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && typeof el.selectionStart === 'number') {
                const start = el.selectionStart;
                const end = el.selectionEnd;
                if (start !== end) {
                    text = el.value.substring(start, end);
                }
            }
        }

        // Check window.getSelection
        if (!text && window.getSelection) {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                text = sel.toString();
            }
        }

        // Check focused or selected Object Explorer tree item ONLY when Object Explorer actually has focus
        // Never hijack copy/cut when user is typing SQL or focus is inside editor, inputs, grids, or elsewhere
        const isEditorActive = Boolean(targetEd) ||
                               Boolean(document.activeElement?.closest('.monaco-editor, #ide-editor-container, .ide-editor-container, .ide-editor-pane, .ide-ag-grid-instance, .ag-root-wrapper, .ide-grid-pane, input, textarea, [contenteditable="true"]'));

        const isExplorerFocused = document.activeElement && Boolean(
            document.activeElement.closest('.tree-item, .ide-tree, #ide-tree-root, .ide-sidebar-body, #ide-sidebar')
        );

        if (!text && e.type === 'copy' && isExplorerFocused && !isEditorActive) {
            const activeTreeItem = (document.activeElement && document.activeElement.closest('.tree-item')) ||
                                   document.querySelector('.ide-tree .tree-item.selected') ||
                                   document.querySelector('.tree-item.selected');
            if (activeTreeItem) {
                text = (typeof window.getCleanTreeItemName === 'function')
                    ? window.getCleanTreeItemName(activeTreeItem._nodeData, activeTreeItem)
                    : (activeTreeItem._nodeData?.name || activeTreeItem.textContent || '').split('(')[0].trim();
                if (text) {
                    activeTreeItem.classList.add('tree-item-copied');
                    setTimeout(() => activeTreeItem.classList.remove('tree-item-copied'), 600);
                    if (typeof window.showToast === 'function') {
                        const objType = activeTreeItem._nodeData?.type || activeTreeItem._nodeData?.object_type || 'object';
                        const typeMap = {
                            table: 'bảng',
                            view: 'view',
                            procedure: 'stored procedure',
                            function: 'function',
                            trigger: 'trigger',
                            column: 'cột',
                            database_user: 'user',
                            postgres_role: 'role'
                        };
                        const typeLabel = typeMap[objType] || 'đối tượng';
                        window.showToast(`Đã sao chép tên ${typeLabel}: ${text}`, 'success');
                    }
                }
            }
        }

        if (text) {
            // Prevent default and stop propagation so browser accepts custom text in clipboardData
            // and Monaco's internal textarea listener does not fire secondary cut actions
            e.preventDefault();
            if (typeof e.stopPropagation === 'function') {
                e.stopPropagation();
            }
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }
            if (e.clipboardData) {
                try {
                    e.clipboardData.setData('text/plain', text);
                } catch (_) {}
            }
            // Đồng thời ghi vào Windows OS clipboard qua Python Win32 ctypes bridge
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_clipboard_text === 'function') {
                try {
                    window.pywebview.api.set_clipboard_text(text);
                } catch (_) {}
            }

            // Nếu là thao tác CUT (Ctrl + X) trên Monaco Editor hoặc input / textarea, chủ động cắt bỏ đoạn văn bản đã chọn
            if (e.type === 'cut') {
                if (targetEd) {
                    const selections = targetEd.getSelections();
                    if (selections && selections.length > 0) {
                        const hasNonEmpty = selections.some(s => !s.isEmpty());
                        if (hasNonEmpty) {
                            targetEd.executeEdits('clipboard-cut', selections.map(s => ({
                                range: s,
                                text: '',
                                forceMoveMarkers: true
                            })));
                            targetEd.pushUndoStop();
                        } else {
                            // VS Code standard: cut entire line when selection is empty
                            const pos = targetEd.getPosition();
                            if (pos) {
                                const model = targetEd.getModel();
                                if (model) {
                                    const lineCount = model.getLineCount();
                                    let range;
                                    if (pos.lineNumber < lineCount) {
                                        range = new monaco.Range(pos.lineNumber, 1, pos.lineNumber + 1, 1);
                                    } else if (pos.lineNumber > 1) {
                                        const prevCol = model.getLineMaxColumn(pos.lineNumber - 1);
                                        range = new monaco.Range(pos.lineNumber - 1, prevCol, pos.lineNumber, model.getLineMaxColumn(pos.lineNumber));
                                    } else {
                                        range = new monaco.Range(1, 1, 1, model.getLineMaxColumn(1));
                                    }
                                    targetEd.executeEdits('clipboard-cut', [{
                                        range: range,
                                        text: '',
                                        forceMoveMarkers: true
                                    }]);
                                    targetEd.pushUndoStop();
                                }
                            }
                        }
                    }
                } else if (document.activeElement) {
                    const el = document.activeElement;
                    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && typeof el.selectionStart === 'number' && !el.readOnly && !el.disabled) {
                        const start = el.selectionStart;
                        const end = el.selectionEnd;
                        if (start !== end) {
                            const val = el.value;
                            el.value = val.substring(0, start) + val.substring(end);
                            el.selectionStart = el.selectionEnd = start;
                            try {
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                            } catch (_) {}
                        }
                    }
                }
            }
        }
    }

    // Lắng nghe sự kiện copy và cut ở CAPTURING PHASE (true)
    window.addEventListener('copy', handleGlobalCopyCapture, true);
    window.addEventListener('cut', handleGlobalCopyCapture, true);

    // ── 5. Monaco Editor Instance Key Hook ────────────────────────────────────
    function attachMonacoClipboardHook(editor) {
        if (!editor || !editor.onKeyDown) return;
        editor.onKeyDown(e => {
            const isCtrlOrCmd = e.ctrlKey || e.metaKey;
            if (!isCtrlOrCmd) return;

            const isC = (e.keyCode === 33 /* KeyC */) || (e.browserEvent && (e.browserEvent.key === 'c' || e.browserEvent.key === 'C'));
            const isX = (e.keyCode === 54 /* KeyX */) || (e.browserEvent && (e.browserEvent.key === 'x' || e.browserEvent.key === 'X'));

            if (isC || isX) {
                const text = getMonacoSelectedOrLineText(editor);
                if (text && window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_clipboard_text === 'function') {
                    try {
                        window.pywebview.api.set_clipboard_text(text);
                    } catch (_) {}
                }
            }
        });
    }

    // Export to global window for all modules
    window.copyToClipboard = copyToClipboard;
    window.copyText = copyToClipboard;
    window.readFromClipboard = readFromClipboard;
    window.getMonacoSelectedOrLineText = getMonacoSelectedOrLineText;
    window.attachMonacoClipboardHook = attachMonacoClipboardHook;
    window.ClipboardBridge = {
        copyToClipboard,
        readFromClipboard,
        getMonacoSelectedOrLineText,
        attachMonacoClipboardHook
    };

})(window);
