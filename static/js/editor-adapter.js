// Editor Adapter for SQL IntelliSense
// Implements standard editor interface contract isolating IntelliSense engine from specific editor implementation
// Compliant with Section 4 and Section 63 of intellisense_improvement_plan_v2.md

(function (window) {
    'use strict';

    class EditorAdapter {
        constructor(editorInstance) {
            if (!editorInstance) {
                throw new Error('[EditorAdapter] An editor instance is required');
            }
            if (editorInstance.isAdapter) {
                return editorInstance;
            }
            this.isAdapter = true;
            this._editor = editorInstance;
        }

        get rawEditor() {
            return this._editor.rawEditor || this._editor;
        }

        // ── Text Retrieval ──────────────────────────────────────────────────────────
        getText() {
            return typeof this._editor.getValue === 'function' ? this._editor.getValue() : '';
        }

        getValue() {
            return this.getText();
        }

        getLine(lineNo) {
            return typeof this._editor.getLine === 'function' ? this._editor.getLine(lineNo) : '';
        }

        getCurrentLine() {
            return this.getLine(this.getCursor().line);
        }

        getTextBeforeCursor() {
            const offset = this.getCursorOffset();
            return this.getText().substring(0, offset);
        }

        getTextAfterCursor() {
            const offset = this.getCursorOffset();
            return this.getText().substring(offset);
        }

        getRange(fromPos, toPos) {
            if (typeof this._editor.getRange === 'function') {
                return this._editor.getRange(fromPos, toPos);
            }
            return '';
        }

        // ── Cursor and Selection ────────────────────────────────────────────────────
        getCursor() {
            return typeof this._editor.getCursor === 'function' ? this._editor.getCursor() : { line: 0, ch: 0 };
        }

        getCursorPosition() {
            return this.getCursor();
        }

        getCursorOffset() {
            const cursor = this.getCursor();
            return typeof this._editor.indexFromPos === 'function' ? this._editor.indexFromPos(cursor) : 0;
        }

        posFromIndex(idx) {
            return typeof this._editor.posFromIndex === 'function' ? this._editor.posFromIndex(idx) : { line: 0, ch: idx };
        }

        indexFromPos(pos) {
            return typeof this._editor.indexFromPos === 'function' ? this._editor.indexFromPos(pos) : 0;
        }

        setCursor(pos) {
            if (typeof this._editor.setCursor === 'function') {
                this._editor.setCursor(pos);
            }
        }

        setSelection(posStart, posEnd) {
            if (typeof this._editor.setSelection === 'function') {
                this._editor.setSelection(posStart, posEnd);
            }
        }

        hasSelection() {
            if (typeof this._editor.somethingSelected === 'function') {
                return this._editor.somethingSelected();
            }
            if (typeof this._editor.getSelection === 'function') {
                const s = this._editor.getSelection();
                return Boolean(s && s.length > 0);
            }
            return false;
        }

        findWordAt(pos) {
            const p = pos || this.getCursor();
            if (typeof this._editor.findWordAt === 'function') {
                return this._editor.findWordAt(p);
            }
            return { anchor: p, head: p };
        }

        // ── Text Replacement and Edits ──────────────────────────────────────────────
        replaceRange(text, fromPos, toPos) {
            if (typeof this._editor.replaceRange === 'function') {
                this._editor.replaceRange(text, fromPos, toPos);
            }
        }

        operation(fn) {
            if (typeof this._editor.operation === 'function') {
                return this._editor.operation(fn);
            }
            return fn();
        }

        // ── Visual and Viewport Coordinates ─────────────────────────────────────────
        getCursorCoordinates(pos) {
            const p = pos || this.getCursor();
            if (typeof this._editor.cursorCoords === 'function') {
                return this._editor.cursorCoords(p, 'window');
            }
            return { top: 100, left: 100, bottom: 120, right: 100 };
        }

        cursorCoords(pos, mode) {
            return this.getCursorCoordinates(pos);
        }

        scrollIntoView(pos, margin) {
            if (typeof this._editor.scrollIntoView === 'function') {
                this._editor.scrollIntoView(pos, margin);
            }
        }

        focus() {
            if (typeof this._editor.focus === 'function') {
                this._editor.focus();
            }
        }

        // ── Event Subscription ──────────────────────────────────────────────────────
        on(event, handler) {
            if (typeof this._editor.on === 'function') {
                this._editor.on(event, handler);
            }
        }
    }

    window.EditorAdapter = EditorAdapter;

})(window);
