import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

class TestGridResultFilter(unittest.TestCase):

    def setUp(self):
        self.css_path = BASE_DIR / "static" / "css" / "editor.css"
        self.query_js_path = BASE_DIR / "static" / "js" / "query.js"
        self.grid_js_path = BASE_DIR / "static" / "js" / "grid-result.js"

        with open(self.css_path, "r", encoding="utf-8") as f:
            self.css_content = f.read()

        with open(self.query_js_path, "r", encoding="utf-8") as f:
            self.query_js_content = f.read()

        with open(self.grid_js_path, "r", encoding="utf-8") as f:
            self.grid_js_content = f.read()

    def test_css_grid_pane_and_scroll_wrapper(self):
        """Test that .ide-grid-pane uses flex column and .ide-grid-table-scroll exists for sticky thead."""
        self.assertIn(".ide-grid-pane", self.css_content)
        self.assertIn("display: flex;", self.css_content)
        self.assertIn("flex-direction: column;", self.css_content)
        self.assertIn(".ide-grid-table-scroll", self.css_content)
        self.assertIn("overflow: auto;", self.css_content)

    def test_css_filter_bar_and_button_styles(self):
        """Test that .ide-result-filter-bar, .ide-th-filter-btn, and active styles are defined."""
        self.assertIn(".ide-result-filter-bar", self.css_content)
        self.assertIn(".ide-btn-clear-all-filters", self.css_content)
        self.assertIn(".ide-th-content", self.css_content)
        self.assertIn(".ide-th-filter-btn", self.css_content)
        self.assertIn(".ide-th-filter-btn.ide-filter-active", self.css_content)
        self.assertIn(".ide-results-table tr.ide-row-filtered-out", self.css_content)
        self.assertIn("display: none !important;", self.css_content)

    def test_query_js_filter_bar_creation(self):
        """Test that renderResults in query.js creates .ide-result-filter-bar and .ide-grid-table-scroll."""
        self.assertIn("ide-result-filter-bar", self.query_js_content)
        self.assertIn("ide-btn-clear-all-filters", self.query_js_content)
        self.assertIn("ide-grid-table-scroll", self.query_js_content)
        self.assertIn("tableScroll.appendChild(table)", self.query_js_content)

    def test_query_js_th_filter_button_and_dynamic_min_width(self):
        """Test that column headers have filter buttons and dynamic min-width based on column name."""
        self.assertIn("ide-th-filter-btn", self.query_js_content)
        self.assertIn("ide-th-content", self.query_js_content)
        self.assertIn("filterBtn.dataset.colIdx", self.query_js_content)
        self.assertIn("filterBtn.dataset.colName", self.query_js_content)
        # Check dynamic min-width calculation
        self.assertIn("colName.length", self.query_js_content)

    def test_query_js_postgres_compatibility(self):
        """Test that renderResults in query.js handles PostgreSQL booleans and JSON/array objects."""
        # Boolean rendering for postgres
        self.assertIn("ide-bool-value", self.query_js_content)
        self.assertIn("String(val)", self.query_js_content)
        # Object/JSON rendering
        self.assertIn("JSON.stringify(val)", self.query_js_content)

    def test_query_js_footer_updater(self):
        """Test that updateResultFooter synchronizes row count on filtering."""
        self.assertIn("updateResultFooter", self.query_js_content)
        self.assertIn("window.updateResultFooter = updateResultFooter", self.query_js_content)
        self.assertIn("ide-row-filtered-out", self.query_js_content)

    def test_grid_js_filter_state_and_init(self):
        """Test that GridResultInstance initializes filter state and wires events."""
        self.assertIn("this.columnFilters = {};", self.grid_js_content)
        self.assertIn("this.filterBar =", self.grid_js_content)
        self.assertIn("this.setupFilterEvents();", self.grid_js_content)

    def test_grid_js_column_filter_methods(self):
        """Test that GridResultInstance implements all filter methods."""
        self.assertIn("setupFilterEvents()", self.grid_js_content)
        self.assertIn("formatCellValue(val)", self.grid_js_content)
        self.assertIn("checkFilterMatch(val, filterRule)", self.grid_js_content)
        self.assertIn("applyColumnFilters()", self.grid_js_content)
        self.assertIn("showColumnFilterPopover(colName, cIdx, btn)", self.grid_js_content)

    def test_grid_js_postgres_types_in_filter(self):
        """Test that checkFilterMatch and formatCellValue support PostgreSQL booleans and JSON objects."""
        # Boolean handling
        self.assertIn("boolTrueMatches", self.grid_js_content)
        self.assertIn("boolFalseMatches", self.grid_js_content)
        # JSON/Object handling in formatCellValue
        self.assertIn("JSON.stringify(val)", self.grid_js_content)
        # Null handling
        self.assertIn("(Trống / NULL)", self.grid_js_content)

    def test_grid_js_popover_lazy_loading(self):
        """Test that popover uses chunk-based lazy loading / infinite scroll."""
        self.assertIn("PAGE_SIZE = 40", self.grid_js_content)
        self.assertIn("renderNextBatch", self.grid_js_content)
        self.assertIn("tde-cfp-lazy-sentinel", self.grid_js_content)
        self.assertIn("valuesList.addEventListener('scroll'", self.grid_js_content)

    def test_grid_js_range_copy_skips_filtered_rows(self):
        """Test that getSelectedRangeData skips rows hidden by filters."""
        self.assertIn("ide-row-filtered-out", self.grid_js_content)
        self.assertIn("classList.contains('ide-row-filtered-out')", self.grid_js_content)


if __name__ == "__main__":
    unittest.main()
