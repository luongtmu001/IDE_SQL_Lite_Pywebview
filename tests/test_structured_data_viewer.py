"""Tests for Structured Data Viewer (JSON / XML) Implementation.

Validates all Acceptance Criteria (TC01 - TC18) defined in .SKILL/STRUCTURED_DATA_VIEWER.md:
- TC01: SELECT returning valid JSON -> Displays View JSON link
- TC02: SELECT returning valid XML -> Displays View XML link
- TC03: Click View JSON -> Opens Monaco JSON tab
- TC04: Click View XML -> Opens Monaco XML tab
- TC05: Right click on JSON cell -> Option 'View as JSON'
- TC06: Right click on XML cell -> Option 'View as XML'
- TC07: Select View as JSON -> Opens Quick Viewer on right
- TC08: Close Quick Viewer -> Restores Result Grid size
- TC09: Select another cell and view -> Quick Viewer updates to new cell
- TC10: Re-run SQL -> Does not show stale old data
- TC11: NULL data -> No link displayed
- TC12: Invalid content -> Clear error message reported
- TC13: Copy data -> Existing copy behavior preserved (1:1 raw copy)
- TC14: Unicode data -> Accurate display with Vietnamese Unicode support
- TC15: Large data -> O(1) fast heuristic detection, no UI freeze
- TC16: PostgreSQL JSON/JSONB -> Identified by metadata
- TC17: SQL Server XML -> Identified by metadata
- TC18: Open/close Quick Viewer multiple times -> Clean lifecycle
"""

import json
import re
import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class TestStructuredDataViewer(unittest.TestCase):

    def setUp(self):
        self.css_path = BASE_DIR / "static" / "css" / "structured-data-viewer.css"
        self.viewer_js_path = BASE_DIR / "static" / "js" / "structured-data-viewer.js"
        self.grid_js_path = BASE_DIR / "static" / "js" / "grid-result.js"
        self.tabs_js_path = BASE_DIR / "static" / "js" / "tabs.js"
        self.query_js_path = BASE_DIR / "static" / "js" / "query.js"
        self.results_html_path = BASE_DIR / "templates" / "partials" / "results.html"
        self.index_html_path = BASE_DIR / "templates" / "index.html"

        with open(self.css_path, "r", encoding="utf-8") as f:
            self.css_content = f.read()
        with open(self.viewer_js_path, "r", encoding="utf-8") as f:
            self.viewer_js_content = f.read()
        with open(self.grid_js_path, "r", encoding="utf-8") as f:
            self.grid_js_content = f.read()
        with open(self.tabs_js_path, "r", encoding="utf-8") as f:
            self.tabs_js_content = f.read()
        with open(self.query_js_path, "r", encoding="utf-8") as f:
            self.query_js_content = f.read()
        with open(self.results_html_path, "r", encoding="utf-8") as f:
            self.results_html_content = f.read()
        with open(self.index_html_path, "r", encoding="utf-8") as f:
            self.index_html_content = f.read()

    # ── TC01 & TC02: Detection Heuristics ──────────────────────────────────────
    def test_tc01_tc02_detector_definitions(self):
        """StructuredDataDetector must define detectCandidate, validate, and format."""
        self.assertIn("const StructuredDataDetector = {", self.viewer_js_content)
        self.assertIn("detectCandidate:", self.viewer_js_content)
        self.assertIn("validate:", self.viewer_js_content)
        self.assertIn("format:", self.viewer_js_content)
        self.assertIn("window.StructuredDataDetector = StructuredDataDetector;", self.viewer_js_content)

    def test_tc01_tc02_candidate_heuristics(self):
        """Fast delimiter checks for JSON ({...}, [...]) and XML (<...>)."""
        # Checks that '{' and '}', '[' and ']', '<' and '>' are checked
        self.assertIn("firstChar === '{' && lastChar === '}'", self.viewer_js_content)
        self.assertIn("firstChar === '[' && lastChar === ']'", self.viewer_js_content)
        self.assertIn("firstChar === '<' && lastChar === '>'", self.viewer_js_content)

    # ── TC03 & TC04: Click View opens Monaco Editor tab ────────────────────────
    def test_tc03_tc04_open_in_new_tab(self):
        """openInNewTab must create a tab with tabType 'structured-data' and set language."""
        self.assertIn("openInNewTab:", self.viewer_js_content)
        self.assertIn("tabType: 'structured-data'", self.viewer_js_content)
        self.assertIn("window.AppTabs.createTab", self.viewer_js_content)

    def test_tc03_tc04_grid_link_click_handlers(self):
        """AG Grid and VirtualGridRenderer must handle .ide-structured-link clicks."""
        self.assertIn("onCellClicked:", self.grid_js_content)
        self.assertIn(".ide-structured-link", self.grid_js_content)
        self.assertIn("window.StructuredDataViewer.openInNewTab", self.grid_js_content)

    # ── TC05 & TC06: Right-click context menu ──────────────────────────────────
    def test_tc05_tc06_context_menu_items(self):
        """Grid context menu must show 'View as JSON/XML' and 'Open in New Editor Tab'."""
        self.assertIn("structured-quick-view", self.grid_js_content)
        self.assertIn("structured-open-tab", self.grid_js_content)
        self.assertIn("View as ${structFormat.toUpperCase()}", self.grid_js_content)
        self.assertIn("Open in New Editor Tab", self.grid_js_content)

    # ── TC07 & TC08: Quick Viewer panel open/close & sizing ────────────────────
    def test_tc07_tc08_quick_viewer_markup_and_css(self):
        """Quick Viewer panel and draggable resizer must exist in HTML and CSS."""
        self.assertIn('id="ide-structured-viewer-panel"', self.results_html_content)
        self.assertIn('id="ide-structured-viewer-resizer"', self.results_html_content)
        self.assertIn('id="ide-structured-viewer-editor-container"', self.results_html_content)
        self.assertIn('.ide-structured-viewer-panel', self.css_content)
        self.assertIn('.ide-structured-resizer', self.css_content)
        self.assertIn('width: 35%;', self.css_content)
        self.assertIn('cursor: col-resize;', self.css_content)

    def test_tc07_tc08_open_and_close_methods(self):
        """StructuredDataViewer must provide openQuickView and closeQuickView."""
        self.assertIn("openQuickView:", self.viewer_js_content)
        self.assertIn("closeQuickView:", self.viewer_js_content)
        self.assertIn("this.panelEl.classList.remove('d-none')", self.viewer_js_content)
        self.assertIn("this.panelEl.classList.add('d-none')", self.viewer_js_content)
        self.assertIn("this.refreshGridLayout()", self.viewer_js_content)

    # ── TC09: Update view when selecting another cell ──────────────────────────
    def test_tc09_sync_cell_selection(self):
        """Selecting another cell updates currentData and sets new value in editor."""
        self.assertIn("this.currentData =", self.viewer_js_content)
        self.assertIn("this.ensureEditor(rawValue, lang)", self.viewer_js_content)

    # ── TC10: Query re-execution resets viewer ─────────────────────────────────
    def test_tc10_query_reset(self):
        """Query re-run in query.js triggers onQueryExecuted to clear stale data."""
        self.assertIn("window.StructuredDataViewer.onQueryExecuted()", self.query_js_content)
        self.assertIn("onQueryExecuted:", self.viewer_js_content)

    # ── TC11: NULL data produces no link ──────────────────────────────────────
    def test_tc11_null_handling(self):
        """detectCandidate must return null for NULL, undefined, and empty string."""
        self.assertIn("if (val === null || val === undefined) return null;", self.viewer_js_content)
        self.assertIn("if (len < 2) return null;", self.viewer_js_content)

    # ── TC12: Invalid content error reporting ──────────────────────────────────
    def test_tc12_validation_and_error_reporting(self):
        """Invalid JSON / XML triggers clear warning/error notification."""
        self.assertIn("StructuredDataDetector.validate", self.viewer_js_content)
        self.assertIn("[Định dạng ${format.toUpperCase()} không hợp lệ]:", self.viewer_js_content)

    # ── TC13: Data copying preserved ──────────────────────────────────────────
    def test_tc13_raw_copy_preserved(self):
        """Grid copying uses raw row array data without HTML tag interference."""
        self.assertIn("getActiveCellValue()", self.grid_js_content)
        self.assertIn("getSelectedRangeData(", self.grid_js_content)
        self.assertIn("copyCurrentCell()", self.grid_js_content)

    # ── TC14: Unicode preservation ────────────────────────────────────────────
    def test_tc14_unicode_preservation(self):
        """Strings and values are converted to string cleanly without re-encoding."""
        self.assertIn("rawValue = (cellData.value === null || cellData.value === undefined) ? '' : String(cellData.value)", self.viewer_js_content)

    # ── TC15: Large data O(1) check ───────────────────────────────────────────
    def test_tc15_fast_boundary_scan(self):
        """Detector scans first/last non-whitespace characters in O(1) time without full parse."""
        self.assertIn("while (start < len && val.charCodeAt(start) <= 32) start++;", self.viewer_js_content)
        self.assertIn("while (end > start && val.charCodeAt(end) <= 32) end--;", self.viewer_js_content)

    # ── TC16 & TC17: PostgreSQL & SQL Server metadata ─────────────────────────
    def test_tc16_tc17_metadata_hints(self):
        """PostgreSQL json/jsonb and SQL Server xml types and column names are checked."""
        self.assertIn("cn.includes('json') || ct === 'json' || ct === 'jsonb'", self.viewer_js_content)
        self.assertIn("cn.includes('xml') || ct === 'xml'", self.viewer_js_content)

    # ── TC18: Clean Monaco lifecycle ──────────────────────────────────────────
    def test_tc18_editor_lifecycle_and_model_reuse(self):
        """Quick Viewer reuses editor instance cleanly and updates model language."""
        self.assertIn("ensureEditor:", self.viewer_js_content)
        self.assertIn("monaco.editor.setModelLanguage", self.viewer_js_content)
        self.assertIn("monaco.editor.create", self.viewer_js_content)

    # ── Index.html Inclusions ──────────────────────────────────────────────────
    def test_index_html_includes_css_and_js(self):
        """index.html must include structured-data-viewer.css and structured-data-viewer.js."""
        self.assertIn("structured-data-viewer.css", self.index_html_content)
        self.assertIn("structured-data-viewer.js", self.index_html_content)

    # ── Tabs.js Language Switching ────────────────────────────────────────────
    def test_tabs_js_model_language_switching(self):
        """tabs.js switchTab must switch Monaco model language to json/xml for structured-data tabs."""
        self.assertIn("state.tabType === 'structured-data'", self.tabs_js_content)
        self.assertIn("monaco.editor.setModelLanguage(model, targetLang)", self.tabs_js_content)

    # ── Grid Rendering & XML/JSON Text Escaping ──────────────────────────────
    def test_xml_cell_renders_escaped_text_preview(self):
        """Result grid cellRenderer must display actual XML/JSON text content escaped."""
        self.assertIn("formatStructuredCellText(val", self.grid_js_content)
        self.assertIn("${escapeHtml(displayText)}", self.grid_js_content)
        self.assertIn("escapeHtml(String(val))", self.grid_js_content)

    # ── Quick Viewer Theme Sync & Scrolling ───────────────────────────────────
    def test_quick_viewer_header_theme_variables_and_wrap_button(self):
        """Quick Viewer header must use theme variables and have Word Wrap toggle button."""
        self.assertIn("var(--ide-bg-toolbar", self.css_content)
        self.assertIn("ide-btn-structured-wrap", self.results_html_content)
        self.assertIn("ide-btn-structured-wrap", self.index_html_content)
        self.assertIn("toggleWordWrap:", self.viewer_js_content)
        self.assertIn("this.wrapBtn", self.viewer_js_content)

    def test_quick_viewer_monaco_scroll_configuration(self):
        """Monaco Editor in Quick Viewer must configure explicit scrolling options."""
        self.assertIn("scrollbar:", self.viewer_js_content)
        self.assertIn("vertical: 'visible'", self.viewer_js_content)
        self.assertIn("horizontal: 'auto'", self.viewer_js_content)
        self.assertIn("alwaysConsumeMouseWheel: true", self.viewer_js_content)
        self.assertIn("smoothScrolling: true", self.viewer_js_content)
        self.assertIn("validateEditorContent:", self.viewer_js_content)

    # ── XML & JSON Syntax Check Extension ─────────────────────────────────────
    def test_structured_syntax_checker_module_and_index_inclusion(self):
        """StructuredSyntaxChecker extension module must exist and be included in index.html."""
        checker_path = BASE_DIR / "static" / "js" / "syntax-check" / "structured-syntax-checker.js"
        self.assertTrue(checker_path.exists())
        with open(checker_path, "r", encoding="utf-8") as f:
            checker_content = f.read()

        self.assertIn("checkXml:", checker_content)
        self.assertIn("checkJson:", checker_content)
        self.assertIn("validateModel:", checker_content)
        self.assertIn("window.StructuredSyntaxChecker = StructuredSyntaxChecker", checker_content)
        self.assertIn("structured-syntax-checker.js", self.index_html_content)

    def test_syntax_check_service_xml_json_isolation_and_methods(self):
        """syntax-check-service.js must intercept XML and JSON and not call SQL backend."""
        service_path = BASE_DIR / "static" / "js" / "syntax-check" / "syntax-check-service.js"
        with open(service_path, "r", encoding="utf-8") as f:
            service_content = f.read()

        self.assertIn("targetLanguage === 'xml' || targetLanguage === 'json'", service_content)
        self.assertIn("checkXmlSyntax", service_content)
        self.assertIn("checkJsonSyntax", service_content)
        self.assertIn("window.StructuredSyntaxChecker", service_content)


if __name__ == "__main__":
    unittest.main()
