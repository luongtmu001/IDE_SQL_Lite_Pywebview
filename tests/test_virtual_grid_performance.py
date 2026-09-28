import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

class TestVirtualGridPerformance(unittest.TestCase):

    def setUp(self):
        self.css_path = BASE_DIR / "static" / "css" / "editor.css"
        self.query_js_path = BASE_DIR / "static" / "js" / "query.js"
        self.grid_js_path = BASE_DIR / "static" / "js" / "grid-result.js"
        self.tabs_js_path = BASE_DIR / "static" / "js" / "tabs.js"

        with open(self.css_path, "r", encoding="utf-8") as f:
            self.css_content = f.read()

        with open(self.query_js_path, "r", encoding="utf-8") as f:
            self.query_js_content = f.read()

        with open(self.grid_js_path, "r", encoding="utf-8") as f:
            self.grid_js_content = f.read()

        with open(self.tabs_js_path, "r", encoding="utf-8") as f:
            self.tabs_js_content = f.read()

    def test_css_fixed_row_height_and_spacers(self):
        """Test fixed 26px row heights and virtual spacer CSS in editor.css."""
        self.assertIn("height: 26px;", self.css_content)
        self.assertIn("max-height: 26px;", self.css_content)
        self.assertIn(".ide-virtual-spacer-top", self.css_content)
        self.assertIn(".ide-virtual-spacer-bottom", self.css_content)
        self.assertIn("pointer-events: none !important;", self.css_content)
        self.assertIn(".ide-row-alt", self.css_content)

    def test_virtual_renderer_class_and_methods(self):
        """Test that VirtualGridRenderer is defined with pool and spacer management."""
        self.assertIn("class VirtualGridRenderer", self.grid_js_content)
        self.assertIn("initSpacers()", self.grid_js_content)
        self.assertIn("initScrollListener()", self.grid_js_content)
        self.assertIn("initResizeObserver()", self.grid_js_content)
        self.assertIn("ide-virtual-spacer-top", self.grid_js_content)
        self.assertIn("ide-virtual-spacer-bottom", self.grid_js_content)
        self.assertIn("rowPool", self.grid_js_content)
        self.assertIn("requestAnimationFrame", self.grid_js_content)

    def test_grid_event_delegation(self):
        """Test table-level event delegation eliminating per-cell listeners."""
        self.assertIn("this.table.addEventListener('mousedown', (e) => this.onTableMouseDown(e));", self.grid_js_content)
        self.assertIn("this.table.addEventListener('mouseover', (e) => this.onTableMouseOver(e));", self.grid_js_content)
        self.assertIn("onTableMouseDown(e)", self.grid_js_content)
        self.assertIn("onTableMouseOver(e)", self.grid_js_content)
        # Ensure we do NOT loop through trList to add per-cell mousedown listeners in init()
        self.assertNotIn("tdList.forEach((td, cIdx) => {\n                        if (cIdx === 0) {", self.grid_js_content)

    def test_virtual_selection_and_navigation(self):
        """Test that selection UI only touches visible row pool and navigation uses virtual coords."""
        self.assertIn("this.renderer.rowPool.forEach", self.grid_js_content)
        self.assertIn("scrollCellIntoView(r, c)", self.grid_js_content)
        self.assertIn("this.renderer.rowHeight", self.grid_js_content)
        self.assertIn("isRowFilteredOut", self.grid_js_content)

    def test_query_js_raf_column_resize(self):
        """Test that column resizing uses requestAnimationFrame to prevent forced synchronous reflow."""
        self.assertIn("pendingResize", self.query_js_content)
        self.assertIn("requestAnimationFrame", self.query_js_content)
        self.assertIn("th.style.width = latestWidth + 'px';", self.query_js_content)

    def test_tab_result_dom_caching(self):
        """Test tab result DOM caching and ide-tab-closed cleanup."""
        self.assertIn("tabGridContainers", self.query_js_content)
        self.assertIn("ide-tab-grid-wrap", self.query_js_content)
        self.assertIn("ide-tab-closed", self.query_js_content)
        self.assertIn("ide-tab-closed", self.tabs_js_content)

    def test_footer_count_fast_sync(self):
        """Test that updateResultFooter reads from GridResultManager without scanning DOM."""
        self.assertIn("GridResultManager.getInstance", self.query_js_content)
        self.assertIn("getVisibleRowCount", self.query_js_content)

    def test_tde_virtual_grid_class_and_spacers(self):
        """Test TdeVirtualGrid and virtual spacers in table-data-editor CSS and JS."""
        tde_css_path = BASE_DIR / "static" / "css" / "table-data-editor.css"
        tde_js_path = BASE_DIR / "static" / "js" / "table-data-editor.js"

        with open(tde_css_path, "r", encoding="utf-8") as f:
            tde_css = f.read()
        with open(tde_js_path, "r", encoding="utf-8") as f:
            tde_js = f.read()

        self.assertIn(".tde-virtual-spacer-top", tde_css)
        self.assertIn(".tde-virtual-spacer-bottom", tde_css)
        self.assertIn("overflow-anchor: none !important;", tde_css)

        self.assertIn("class TdeVirtualGrid", tde_js)
        self.assertIn("function populateGridRow", tde_js)
        self.assertIn("this.topSpacer", tde_js)
        self.assertIn("this.bottomSpacer", tde_js)
        self.assertIn("tde-virtual-spacer-top", tde_js)
        self.assertIn("tde-virtual-spacer-bottom", tde_js)
        self.assertIn("function updateFooterNavState", tde_js)

    def test_tde_skeleton_render_and_in_memory_filtering(self):
        """Test that renderDataGrid outputs empty tbody skeleton and applyColumnFilters uses in-memory indexing."""
        tde_js_path = BASE_DIR / "static" / "js" / "table-data-editor.js"
        with open(tde_js_path, "r", encoding="utf-8") as f:
            tde_js = f.read()

        # renderDataGrid should return skeleton table with empty tbody
        self.assertIn("function renderDataGrid(session)", tde_js)
        self.assertIn("<tbody></tbody>", tde_js)

        # applyColumnFilters should set session.filteredRowIndices and call virtualGrid.render(true)
        self.assertIn("session.filteredRowIndices = filteredIndices;", tde_js)
        self.assertIn("session.virtualGrid.render(true);", tde_js)


if __name__ == "__main__":
    unittest.main()

