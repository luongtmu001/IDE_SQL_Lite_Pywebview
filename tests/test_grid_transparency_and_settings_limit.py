"""Unit tests for Grid Header/STT transparency fix and Settings limits & icon size.

Verifies:
1. Solid opaque backgrounds on AG Grid header, header-row, header-cell, pinned-left-header,
   and pinned-left row number (STT) cells in editor.css.
2. Removal of transparent #00000000 --ide-grid-header-bg in theme-variables.css and style.css.
3. Enhanced light theme detection in grid-result.js handling data-theme-mode and light themes.
4. Settings maxRows synchronization with toolbar query limit dropdown in settings.js and query.js.
5. Appearance iconSize handling in settings.js, index.html, and explorer.css.
"""

import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class TestGridTransparencyAndSettings(unittest.TestCase):

    def setUp(self):
        self.editor_css_path = BASE_DIR / "static" / "css" / "editor.css"
        self.theme_vars_path = BASE_DIR / "static" / "css" / "theme-variables.css"
        self.style_css_path = BASE_DIR / "static" / "css" / "style.css"
        self.explorer_css_path = BASE_DIR / "static" / "css" / "explorer.css"
        self.grid_js_path = BASE_DIR / "static" / "js" / "grid-result.js"
        self.settings_js_path = BASE_DIR / "static" / "js" / "settings.js"
        self.query_js_path = BASE_DIR / "static" / "js" / "query.js"
        self.index_html_path = BASE_DIR / "templates" / "index.html"

        with open(self.editor_css_path, "r", encoding="utf-8") as f:
            self.editor_css = f.read()
        with open(self.theme_vars_path, "r", encoding="utf-8") as f:
            self.theme_vars = f.read()
        with open(self.style_css_path, "r", encoding="utf-8") as f:
            self.style_css = f.read()
        with open(self.explorer_css_path, "r", encoding="utf-8") as f:
            self.explorer_css = f.read()
        with open(self.grid_js_path, "r", encoding="utf-8") as f:
            self.grid_js = f.read()
        with open(self.settings_js_path, "r", encoding="utf-8") as f:
            self.settings_js = f.read()
        with open(self.query_js_path, "r", encoding="utf-8") as f:
            self.query_js = f.read()
        with open(self.index_html_path, "r", encoding="utf-8") as f:
            self.index_html = f.read()

    def test_grid_header_and_stt_solid_backgrounds(self):
        """Verify headers and pinned STT row number column have solid opaque styling in editor.css."""
        # Generic instance fallback
        self.assertIn(".ide-ag-grid-instance .ag-header", self.editor_css)
        self.assertIn(".ide-ag-grid-instance .ag-pinned-left-header", self.editor_css)
        self.assertIn("opacity: 1 !important;", self.editor_css)

        # Dark theme
        self.assertIn(".ag-theme-quartz-dark.ide-ag-grid-instance .ag-header", self.editor_css)
        self.assertIn(".ag-theme-quartz-dark.ide-ag-grid-instance .ag-pinned-left-cols-container", self.editor_css)
        self.assertIn(".ag-theme-quartz-dark.ide-ag-grid-instance .ag-cell-row-number", self.editor_css)

        # Light theme
        self.assertIn(".ag-theme-quartz.ide-ag-grid-instance .ag-header", self.editor_css)
        self.assertIn(".ag-theme-quartz.ide-ag-grid-instance .ag-pinned-left-cols-container", self.editor_css)
        self.assertIn(".ag-theme-quartz.ide-ag-grid-instance .ag-cell-row-number", self.editor_css)

    def test_no_transparent_grid_header_variables(self):
        """Ensure no #00000000 transparent values for --ide-grid-header-bg."""
        self.assertNotIn("--ide-grid-header-bg:           #00000000;", self.theme_vars)
        self.assertNotIn("--ide-grid-header-bg:           #00000000;", self.style_css)

    def test_grid_result_theme_detection(self):
        """Verify grid-result.js checks data-theme-mode and light themes correctly."""
        self.assertIn("themeMode === 'light' || curTheme === 'light'", self.grid_js)
        self.assertIn("curTheme.startsWith('light-')", self.grid_js)
        self.assertIn("ag-header-cell-row-number", self.grid_js)

    def test_settings_max_rows_and_toolbar_sync(self):
        """Verify settings.js syncs maxRows to #ide-query-limit and query.js resolves it."""
        self.assertIn("function syncToolbarQueryLimit", self.settings_js)
        self.assertIn("syncToolbarQueryLimit(maxRowsNum)", self.settings_js)
        self.assertIn("defaultLimit", self.query_js)
        self.assertIn("window._sqlConfig", self.query_js)

    def test_appearance_icon_size_support(self):
        """Verify iconSize is reactive in settings.js, restored in index.html, and scales explorer.css."""
        self.assertIn("function applyIconSize", self.settings_js)
        self.assertIn("--ide-icon-size", self.settings_js)
        self.assertIn("ide-icon-size", self.index_html)
        self.assertIn("var(--ide-icon-size, 16px)", self.explorer_css)


if __name__ == "__main__":
    unittest.main()
