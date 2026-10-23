"""Unit tests for Windows Clipboard Integration & Results Grid Copy (Shortcuts & Menus).

Validates:
1. Python Win32 ctypes & multi-tier fallbacks in main.py:
   - _native_set_clipboard with HWND targeting and Tkinter/PowerShell fallbacks
   - _native_get_clipboard
   - MainApi.set_clipboard_text and MainApi.get_clipboard_text
2. Universal Clipboard Bridge in static/js/clipboard-bridge.js:
   - Synchronous DOM user-gesture execCommand execution
   - Prevention of Monaco Editor text stealing when focus is elsewhere
   - Mandatory e.preventDefault() when custom clipboardData is set
   - Global exports: window.copyToClipboard, window.copyText, window.ClipboardBridge
3. Results Grid Selection and Copy in static/js/grid-result.js:
   - this.agGridDiv has tabIndex = 0 and style.outline = 'none' for keyboard focus
   - _agMouseDownHandler and onAgCellContextMenu activate DOM focus and activeInstance
   - this.agGridDiv listens for 'copy' event
   - onKeyDown handles Ctrl+C (KeyC), Ctrl+Shift+C, Ctrl+A
   - Document-level shortcut routing when results pane is active
   - getSelectionCopyText: raw cell value for single cell, TSV with \\t and \\r\\n for ranges
4. Cross-module compatibility:
   - table-data-editor.js calls window.ClipboardBridge.copyToClipboard or window.copyToClipboard
   - structured-data-viewer.js calls window.copyToClipboard
"""

import unittest
from pathlib import Path
from main import _native_set_clipboard, _native_get_clipboard, MainApi

BASE_DIR = Path(__file__).resolve().parent.parent


class TestClipboardAndGridCopy(unittest.TestCase):

    def setUp(self):
        self.main_py_path = BASE_DIR / "main.py"
        self.clipboard_js_path = BASE_DIR / "static" / "js" / "clipboard-bridge.js"
        self.grid_js_path = BASE_DIR / "static" / "js" / "grid-result.js"
        self.table_editor_js_path = BASE_DIR / "static" / "js" / "table-data-editor.js"
        self.struct_viewer_js_path = BASE_DIR / "static" / "js" / "structured-data-viewer.js"

        with open(self.main_py_path, "r", encoding="utf-8") as f:
            self.main_py = f.read()
        clipboard_py_path = BASE_DIR / "app" / "desktop" / "clipboard.py"
        if clipboard_py_path.exists():
            with open(clipboard_py_path, "r", encoding="utf-8") as f:
                self.clipboard_py = f.read()
        else:
            self.clipboard_py = ""
        with open(self.clipboard_js_path, "r", encoding="utf-8") as f:
            self.clipboard_js = f.read()
        with open(self.grid_js_path, "r", encoding="utf-8") as f:
            self.grid_js = f.read()
        with open(self.table_editor_js_path, "r", encoding="utf-8") as f:
            self.table_editor_js = f.read()
        with open(self.struct_viewer_js_path, "r", encoding="utf-8") as f:
            self.struct_viewer_js = f.read()

    # ── 1. Python Native Clipboard Bridge ─────────────────────────────────────
    def test_python_native_set_and_get_clipboard(self):
        """Verify _native_set_clipboard writes and _native_get_clipboard reads text."""
        test_val = "UnitTest_PyWebview_Clipboard_12345"
        ok = _native_set_clipboard(test_val)
        self.assertTrue(ok, "_native_set_clipboard should return True")
        read_val = _native_get_clipboard()
        self.assertEqual(read_val, test_val, "Clipboard read value must match written value")

    def test_main_api_clipboard_methods(self):
        """Verify MainApi wraps clipboard operations with success status."""
        api = MainApi(None)
        res = api.set_clipboard_text("MainApi_Test_Val_888")
        self.assertTrue(res.get("success"), "MainApi.set_clipboard_text must return success: True")
        get_res = api.get_clipboard_text()
        self.assertTrue(get_res.get("success"))
        self.assertEqual(get_res.get("text"), "MainApi_Test_Val_888")

    def test_main_py_supports_hwnd_and_fallbacks(self):
        """Verify clipboard implementation has HWND parameter and Tkinter/PowerShell fallbacks."""
        source = (self.clipboard_py + "\n" + self.main_py)
        self.assertTrue(
            ("def _native_set_clipboard(text: str, hwnd=None)" in source) or
            ("def native_set_clipboard(text: str, hwnd=None)" in source),
            "native_set_clipboard must accept hwnd parameter"
        )
        self.assertTrue(
            ("def _native_get_clipboard(hwnd=None)" in source) or
            ("def native_get_clipboard(hwnd=None)" in source),
            "native_get_clipboard must accept hwnd parameter"
        )
        self.assertIn("import tkinter as tk", source)
        self.assertIn("Set-Clipboard", source)
        self.assertIn("Get-Clipboard", source)

    # ── 2. Frontend Clipboard Bridge ──────────────────────────────────────────
    def test_clipboard_bridge_exports_and_prevent_default(self):
        """Verify clipboard-bridge.js exports window.ClipboardBridge and calls preventDefault."""
        self.assertIn("window.copyToClipboard = copyToClipboard;", self.clipboard_js)
        self.assertIn("window.copyText = copyToClipboard;", self.clipboard_js)
        self.assertIn("window.ClipboardBridge =", self.clipboard_js)
        self.assertIn("e.preventDefault();", self.clipboard_js)
        self.assertIn("e.clipboardData.setData('text/plain'", self.clipboard_js)

    def test_clipboard_bridge_cut_stops_propagation_to_prevent_double_cut(self):
        """Verify clipboard-bridge.js stops event propagation on cut/copy to prevent Monaco secondary line cut."""
        self.assertIn("e.stopPropagation();", self.clipboard_js)
        self.assertIn("e.stopImmediatePropagation();", self.clipboard_js)

    def test_clipboard_bridge_does_not_steal_from_unfocused_monaco(self):
        """Verify Monaco text extraction only occurs if editor has text focus."""
        self.assertIn("targetEd = editors.find(ed => ed.hasTextFocus && ed.hasTextFocus());", self.clipboard_js)
        # Ensure it does not greedily grab text from unfocused editors with non-empty selections
        self.assertNotIn("targetEd = editors.find(ed => {\n                        const s = ed.getSelection", self.clipboard_js)

    def test_clipboard_bridge_synchronous_gesture_copy(self):
        """Verify copyToClipboard performs synchronous execCommand within user gesture."""
        self.assertIn("_isProgrammaticCopy = true;", self.clipboard_js)
        self.assertIn("document.execCommand('copy');", self.clipboard_js)
        self.assertIn("window.pywebview.api.set_clipboard_text", self.clipboard_js)

    # ── 3. Grid Results Copy & Focus ──────────────────────────────────────────
    def test_grid_result_ag_grid_div_focusable(self):
        """Verify agGridDiv is given tabIndex = 0 and focus management."""
        self.assertIn("this.agGridDiv.tabIndex = 0;", self.grid_js)
        self.assertIn("this.agGridDiv.style.outline = 'none';", self.grid_js)
        self.assertIn("this.agGridDiv.focus({ preventScroll: true });", self.grid_js)

    def test_grid_result_active_instance_tracking(self):
        """Verify GridResultInstance tracks activeInstance for shortcut routing."""
        self.assertIn("GridResultInstance.activeInstance = this;", self.grid_js)
        self.assertIn("global.GridResultInstance = GridResultInstance;", self.grid_js)
        self.assertIn("global.GridResultController = GridResultInstance;", self.grid_js)

    def test_grid_result_copy_shortcuts_and_listener(self):
        """Verify Ctrl+C, Ctrl+Shift+C, KeyC and copy event listener on agGridDiv."""
        self.assertIn("this.agGridDiv.addEventListener('copy'", self.grid_js)
        self.assertIn("this.agGridDiv.addEventListener('keydown'", self.grid_js)
        self.assertIn("KeyC", self.grid_js)
        self.assertIn("this.copy(false);", self.grid_js)
        self.assertIn("this.copyWithHeaders();", self.grid_js)
        self.assertIn("this.selectAll();", self.grid_js)

    def test_grid_result_selection_format_logic(self):
        """Verify getSelectionCopyText handles single cell raw value and range TSV."""
        self.assertIn("getSelectionCopyText(includeHeaders = false)", self.grid_js)
        self.assertIn("selectedRowsData.length === 1 && selectedRowsData[0].length === 1", self.grid_js)
        self.assertIn("lines.join('\\r\\n')", self.grid_js)

    # ── 4. Cross-Module Consistency ───────────────────────────────────────────
    def test_table_editor_and_structured_viewer_use_clipboard_bridge(self):
        """Verify table-data-editor and structured-data-viewer route through copyToClipboard."""
        self.assertIn("window.ClipboardBridge.copyToClipboard", self.table_editor_js)
        self.assertIn("window.copyToClipboard", self.table_editor_js)
        self.assertIn("window.copyToClipboard", self.struct_viewer_js)


if __name__ == "__main__":
    unittest.main()
