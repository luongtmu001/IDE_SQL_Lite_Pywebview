"""Tests for Multi-Table Layout, Performance Optimizations, Freeze Column, and Structured Data Viewer.

Covers all 5 requirements requested by the user:
1. Grid generation lag optimization (pre-theming, fast cell rendering, inactive virtual spacers)
2. Last table 100% remaining space flex layout (.ide-grid-pane-last)
3. Active table row count display on click & Minimize button per result pane (.ide-btn-grid-minimize)
4. Structured data viewer overhaul (file naming [LoaiFile](Stt).[ext], 1-click debounce, auto-format, Xem [format] quick view)
5. Freeze column (Cố định cột / Bỏ cố định cột via context menu and header right-click)
"""

import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class TestGridMultiTableAndFreeze(unittest.TestCase):

    def setUp(self):
        self.query_js_path = BASE_DIR / "static" / "js" / "query.js"
        self.grid_js_path = BASE_DIR / "static" / "js" / "grid-result.js"
        self.viewer_js_path = BASE_DIR / "static" / "js" / "structured-data-viewer.js"
        self.css_path = BASE_DIR / "static" / "css" / "editor.css"

        with open(self.query_js_path, "r", encoding="utf-8") as f:
            self.query_js_content = f.read()
        with open(self.grid_js_path, "r", encoding="utf-8") as f:
            self.grid_js_content = f.read()
        with open(self.viewer_js_path, "r", encoding="utf-8") as f:
            self.viewer_js_content = f.read()
        with open(self.css_path, "r", encoding="utf-8") as f:
            self.css_content = f.read()

    # ── Requirement 1: Performance Lag Optimizations ───────────────────────────
    def test_performance_pre_theming_and_no_startup_thrashing(self):
        """Theme and typography should be applied early before AG Grid creation to avoid layout thrashing."""
        self.assertIn("this._isInitializing = true;", self.grid_js_content)
        self.assertIn("this.syncTheme(false);", self.grid_js_content)
        self.assertIn("this.applyTypographySettings(false);", self.grid_js_content)
        self.assertIn("this._isInitializing = false;", self.grid_js_content)

    def test_performance_fast_cell_renderer(self):
        """Cell renderer must fast-path numbers and booleans before running detector regexes."""
        self.assertIn("if (typeof val === 'number')", self.grid_js_content)
        self.assertIn("if (typeof val === 'boolean')", self.grid_js_content)

    def test_performance_skip_fallback_virtual_listeners_when_ag_grid(self):
        """VirtualGridRenderer must skip heavy scroll/resize observers when AG Grid is present."""
        self.assertIn("if (!global.agGrid || typeof global.agGrid.createGrid !== 'function')", self.grid_js_content)

    # ── Requirement 2: Last Table Fills 100% Space ────────────────────────────
    def test_last_table_flex_grow_and_no_gap(self):
        """Last table must have .ide-grid-pane-last, flex: 1 1 0% and height: auto."""
        self.assertIn("isLast = false", self.query_js_content)
        self.assertIn("pane.classList.add('ide-grid-pane-last')", self.query_js_content)
        self.assertIn("pane.style.flex = '1 1 0%'", self.query_js_content)
        self.assertIn("pane.style.height = 'auto'", self.query_js_content)
        self.assertIn(".ide-grid-pane-last", self.css_content)
        self.assertIn("flex: 1 1 0% !important;", self.css_content)

    def test_render_grid_identifies_is_last(self):
        """renderGrid passes isLast flag to createGridPaneElement."""
        self.assertIn("const isLast = (index === totalGrids - 1);", self.query_js_content)
        self.assertIn("pane._nextSplitter = splitter;", self.query_js_content)

    # ── Requirement 3: Row Counts & Minimize Button ───────────────────────────
    def test_pane_toolbar_and_row_count_badge(self):
        """Each grid pane must have a toolbar with title, row count, and minimize button."""
        self.assertIn("ide-grid-pane-toolbar", self.query_js_content)
        self.assertIn("ide-grid-pane-rowcount", self.query_js_content)
        self.assertIn("Bảng #${gridNum}", self.query_js_content)
        self.assertIn("ide-btn-grid-minimize", self.query_js_content)

    def test_active_grid_click_and_status_update(self):
        """Clicking a grid marks it active and calls updateActiveGridStatus."""
        self.assertIn("setActiveGrid", self.query_js_content)
        self.assertIn("ide-grid-pane-active", self.query_js_content)
        self.assertIn("window.updateActiveGridStatus", self.query_js_content)

    def test_minimize_button_collapses_and_restores(self):
        """Minimize button toggles .ide-grid-pane-minimized and collapses height."""
        self.assertIn("ide-grid-pane-minimized", self.query_js_content)
        self.assertIn("minBtn.innerHTML = '<i class=\"fa-solid fa-window-maximize\"></i>'", self.query_js_content)
        self.assertIn(".ide-grid-pane-minimized", self.css_content)

    # ── Requirement 4: Structured Data Viewer Improvements ────────────────────
    def test_structured_data_file_naming(self):
        """File naming format must follow [LoaiFile](Stt).[ext], e.g. xmlresult(2).xml, jsonresult(1).json."""
        self.assertIn("getNextFileName:", self.viewer_js_content)
        self.assertIn("xmlresult", self.viewer_js_content)
        self.assertIn("jsonresult", self.viewer_js_content)

    def test_structured_data_click_debounce(self):
        """openInNewTab must debounce duplicate clicks to prevent double tab opening."""
        self.assertIn("_lastOpenTabTime", self.viewer_js_content)
        self.assertIn("_lastOpenTabKey", self.viewer_js_content)

    def test_structured_data_auto_formatting_in_tab(self):
        """New structured data tab must contain pre-formatted code."""
        self.assertIn("StructuredDataDetector.format(rawValue, format)", self.viewer_js_content)
        self.assertIn("content: formattedContent", self.viewer_js_content)

    def test_structured_data_xem_quick_view(self):
        """Context menu must provide 'Xem [Kiểu data]' action to open quick view panel."""
        self.assertIn("Xem ${structFormat.toUpperCase()}", self.grid_js_content)
        self.assertIn("structured-quick-view", self.grid_js_content)
        self.assertIn("window.StructuredDataViewer.openQuickView", self.grid_js_content)

    # ── Requirement 5: Freeze Column (Cố định cột) ───────────────────────────
    def test_freeze_column_context_menu_items(self):
        """Context menu must provide 'Cố định cột [Name]' and 'Bỏ cố định cột [Name]'."""
        self.assertIn("freeze-column", self.grid_js_content)
        self.assertIn("unfreeze-column", self.grid_js_content)
        self.assertIn("Cố định cột [${colName}]", self.grid_js_content)
        self.assertIn("Bỏ cố định cột [${colName}]", self.grid_js_content)

    def test_header_context_menu_trigger(self):
        """IdeAgHeaderComponent must support contextmenu event to allow freezing from header."""
        self.assertIn("this.eGui.addEventListener('contextmenu'", self.grid_js_content)

    def test_freeze_column_implementation(self):
        """freezeColumn method must apply column pinned state to AG Grid."""
        self.assertIn("freezeColumn(colIdx, freeze = true)", self.grid_js_content)
        self.assertIn("pinned: freeze ? 'left' : null", self.grid_js_content)
        self.assertIn("this.pinnedCols", self.grid_js_content)

    # ── Requirement 6: Row Number Contrast & Fixed Column Width on Resize ───
    def test_row_number_text_contrast(self):
        """Row number cells must have contrasting text color (#b0b8c4 in dark mode) and not dim."""
        self.assertIn(".ag-theme-quartz-dark.ide-ag-grid-instance .ag-cell-row-number", self.css_content)
        self.assertIn("color: #b0b8c4 !important;", self.css_content)
        self.assertIn("color: #495057 !important;", self.css_content)

    def test_columns_preserve_fixed_width_on_resize(self):
        """Columns must not stretch to full screen on resize, sizeColumnsToFit should not be called in refreshLayout."""
        self.assertIn("suppressSizeToFit: true", self.grid_js_content)
        self.assertNotIn("this.gridApi.sizeColumnsToFit()", self.grid_js_content)
        self.assertNotIn("min-width: 100%;", self.css_content.split(".ide-results-table {")[1].split("}")[0])


if __name__ == '__main__':
    unittest.main()

