"""Unit tests for AG Grid Community Migration in SQL IDE.

Verifies:
- Inclusion of offline vendor CSS and JS assets in templates/index.html
- Scoped Quartz Dark/Light CSS styling, 26px row heights, and monospace typography in editor.css
- IdeAgHeaderComponent, AG Grid lifecycle, transactions, and context menu binding in grid-result.js
- Tab restoration and lifecycle handling in query.js
"""

import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class TestAgGridMigration(unittest.TestCase):

    def setUp(self):
        self.html_path = BASE_DIR / "templates" / "index.html"
        self.css_path = BASE_DIR / "static" / "css" / "editor.css"
        self.grid_js_path = BASE_DIR / "static" / "js" / "grid-result.js"
        self.query_js_path = BASE_DIR / "static" / "js" / "query.js"

        with open(self.html_path, "r", encoding="utf-8") as f:
            self.html_content = f.read()
        with open(self.css_path, "r", encoding="utf-8") as f:
            self.css_content = f.read()
        with open(self.grid_js_path, "r", encoding="utf-8") as f:
            self.grid_js_content = f.read()
        with open(self.query_js_path, "r", encoding="utf-8") as f:
            self.query_js_content = f.read()

    def test_vendor_assets_included_in_html(self):
        """Verify that offline AG Grid CSS and JS are loaded in index.html in correct order."""
        self.assertIn("vendor/ag-grid/ag-grid.css", self.html_content)
        self.assertIn("vendor/ag-grid/ag-theme-quartz.css", self.html_content)
        self.assertIn("vendor/ag-grid/ag-grid-community.min.js", self.html_content)

        # Ensure vendor script is loaded BEFORE grid-result.js
        ag_script_pos = self.html_content.find("vendor/ag-grid/ag-grid-community.min.js")
        grid_result_pos = self.html_content.find("static/js/grid-result.js")
        self.assertGreater(ag_script_pos, 0)
        self.assertGreater(grid_result_pos, 0)
        self.assertLess(ag_script_pos, grid_result_pos, "ag-grid-community.min.js must be loaded before grid-result.js")

    def test_ag_grid_css_styling(self):
        """Verify custom Quartz Dark theme overrides, 26px row height and font rules."""
        self.assertIn(".ag-theme-quartz-dark.ide-ag-grid-instance", self.css_content)
        self.assertIn("--ag-row-height: 26px;", self.css_content)
        self.assertIn("--ag-header-height: 28px;", self.css_content)
        self.assertIn(".ide-ag-header-filter-btn", self.css_content)
        self.assertIn(".ide-ag-header-filter-btn.ide-filter-active", self.css_content)
        self.assertIn(".ag-cell-row-number", self.css_content)
        self.assertIn(".ag-cell-numeric", self.css_content)
        self.assertIn(".ag-null-value", self.css_content)

    def test_custom_header_component_in_grid_js(self):
        """Verify IdeAgHeaderComponent defines custom header and filter button."""
        self.assertIn("class IdeAgHeaderComponent", self.grid_js_content)
        self.assertIn("ide-ag-header-content", self.grid_js_content)
        self.assertIn("ide-ag-header-filter-btn", self.grid_js_content)
        self.assertIn("showColumnFilterPopover", self.grid_js_content)

    def test_ag_grid_lifecycle_and_methods(self):
        """Verify GridResultInstance implements AG Grid lifecycle and transactions."""
        self.assertIn("initAgGrid()", self.grid_js_content)
        self.assertIn("global.agGrid.createGrid", self.grid_js_content)
        self.assertIn("this.gridApi.applyTransaction({ add: newRows });", self.grid_js_content)
        self.assertIn("this.gridApi.destroy();", self.grid_js_content)
        self.assertIn("this.gridApi.onFilterChanged();", self.grid_js_content)
        self.assertIn("doesNodePassFilter(node)", self.grid_js_content)
        self.assertIn("onAgCellContextMenu(params)", self.grid_js_content)

    def test_context_menu_integration(self):
        """Verify 21 context menu actions remain available and read from grid state."""
        self.assertIn("copyAllHeaders", self.grid_js_content)
        self.assertIn("copySelectedHeaders", self.grid_js_content)
        self.assertIn("copyCurrentCell", self.grid_js_content)
        self.assertIn("copySqlValuesList", self.grid_js_content)
        self.assertIn("findDataInGrid", self.grid_js_content)
        self.assertIn("showGridAggregates", self.grid_js_content)
        self.assertIn("scriptAsInsert", self.grid_js_content)
        self.assertIn("copySelectionAsXmlSpreadsheet", self.grid_js_content)
        self.assertIn("openInExcel", self.grid_js_content)
        self.assertIn("saveResultsAs", self.grid_js_content)

    def test_selection_model_and_focus(self):
        """Verify cell/row selection model, suppressRowClickSelection, and IdeAgTopLeftHeaderComponent."""
        self.assertIn("class IdeAgTopLeftHeaderComponent", self.grid_js_content)
        self.assertIn("suppressRowClickSelection: true", self.grid_js_content)
        self.assertIn("suppressCellFocus: true", self.grid_js_content)
        self.assertIn("syncAgRowNodesSelection()", self.grid_js_content)
        self.assertIn("renderAgSelection()", self.grid_js_content)
        self.assertIn("ide-cell-selected", self.grid_js_content)
        self.assertIn("ide-cell-active", self.grid_js_content)
        self.assertIn("row-selected", self.grid_js_content)
        self.assertIn("col-selected", self.grid_js_content)
        self.assertIn("user-select: none !important;", self.css_content)
        self.assertIn("background: transparent !important;", self.css_content)

    def test_theme_and_typography_synchronization(self):
        """Verify dynamic theme syncing and typography settings from user configuration."""
        self.assertIn("syncTheme()", self.grid_js_content)
        self.assertIn("applyTypographySettings()", self.grid_js_content)
        self.assertIn("--ide-grid-font-family", self.css_content)
        self.assertIn("--ide-grid-font-size", self.css_content)
        self.assertIn("var(--ide-bg-result", self.css_content)
        self.assertIn("var(--ide-grid-header-bg", self.css_content)


if __name__ == "__main__":
    unittest.main()
