/**
 * Clipboard Bridge - Zero-Loss Windows Native Clipboard Integration
 * File: static/js/clipboard-bridge.js
 * 
 * Ensures any copy/cut action in Monaco Editor, Grid Results, or DOM elements
 * writes reliably to the Windows OS clipboard via Win32 ctypes pywebview bridge.
 */

(function (window) {
    'use strict';

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

        // A. Ưu tiên hàng đầu: Ghi trực tiếp vào Windows OS Clipboard qua Python Win32 ctypes bridge
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

        // B. Đồng thời cập nhật Web Clipboard nếu có quyền (phòng hờ môi trường browser tiêu chuẩn)
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
            } catch (_) {}
        }

        // C. Fallback textarea copy cho DOM context
        if (!nativeSuccess) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                ta.style.top = '-9999px';
                ta.setAttribute('readonly', '');
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                if (ok) nativeSuccess = true;
            } catch (_) {}
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
        let text = '';

        // Check active Monaco Editor
        if (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.getEditors === 'function') {
            try {
                const editors = monaco.editor.getEditors();
                let targetEd = editors.find(ed => ed.hasTextFocus && ed.hasTextFocus());
                if (!targetEd && document.activeElement) {
                    targetEd = editors.find(ed => {
                        const dom = ed.getDomNode && ed.getDomNode();
                        return dom && dom.contains(document.activeElement);
                    });
                }
                if (!targetEd) {
                    targetEd = editors.find(ed => {
                        const s = ed.getSelection && ed.getSelection();
                        return s && !s.isEmpty();
                    });
                }
                if (targetEd) {
                    text = getMonacoSelectedOrLineText(targetEd);
                }
            } catch (_) {}
        }

        // Check window.getSelection
        if (!text && window.getSelection) {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                text = sel.toString();
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

        if (text) {
            // Lập tức ghi vào Windows OS clipboard
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_clipboard_text === 'function') {
                try {
                    window.pywebview.api.set_clipboard_text(text);
                } catch (_) {}
            }
            if (e.clipboardData) {
                try {
                    e.clipboardData.setData('text/plain', text);
                } catch (_) {}
            }
        }
    }

    // Lắng nghe sự kiện copy và cut ở CAPTURING PHASE (true) để chặn trước khi Monaco kịp gọi e.preventDefault()
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
                if (text) {
                    copyToClipboard(text);
                }
            }
        });
    }

    // Export to global window
    window.copyToClipboard = copyToClipboard;
    window.readFromClipboard = readFromClipboard;
    window.getMonacoSelectedOrLineText = getMonacoSelectedOrLineText;
    window.attachMonacoClipboardHook = attachMonacoClipboardHook;

})(window);
