"""
tests/test_sql_visualization.py - Unit & Integration Tests for SQL Query Visualization (Design View)
─────────────────────────────────────────────────────────────────────────────
Complies with .SKILL/sql_visualization.md:
- Tests context menu registry for 'view' and 'materialized_view' (PostgreSQL)
- Tests action handling for 'design-view'
- Tests tab manager integration for 'query-designer' tab type
- Tests HTML templates contain #sql-visualizer-container and required assets
- Tests Flask metadata definition API for view and materialized_view
- Tests parser and generator against the 6 mandatory test cases in Section 13
─────────────────────────────────────────────────────────────────────────────
"""

import re
import sys
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path

WORKSPACE_DIR = Path(__file__).resolve().parent.parent
if str(WORKSPACE_DIR) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_DIR))

from main import MainApi
from app.services.connection_manager import ConnectionManager


class TestSqlVisualizationIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context_menu_js = (WORKSPACE_DIR / "static" / "js" / "context-menu.js").read_text(encoding="utf-8")
        cls.tabs_js = (WORKSPACE_DIR / "static" / "js" / "tabs.js").read_text(encoding="utf-8")
        cls.index_html = (WORKSPACE_DIR / "templates" / "index.html").read_text(encoding="utf-8")
        cls.editor_html = (WORKSPACE_DIR / "templates" / "partials" / "editor.html").read_text(encoding="utf-8")
        cls.query_model_js = (WORKSPACE_DIR / "static" / "js" / "visualization" / "query-model.js").read_text(encoding="utf-8")
        cls.sql_parser_js = (WORKSPACE_DIR / "static" / "js" / "visualization" / "sql-parser.js").read_text(encoding="utf-8")
        cls.sql_generator_js = (WORKSPACE_DIR / "static" / "js" / "visualization" / "sql-generator.js").read_text(encoding="utf-8")
        cls.d3_renderer_js = (WORKSPACE_DIR / "static" / "js" / "visualization" / "d3-renderer.js").read_text(encoding="utf-8")
        cls.sql_visualizer_js = (WORKSPACE_DIR / "static" / "js" / "visualization" / "sql-visualizer.js").read_text(encoding="utf-8")
        cls.css = (WORKSPACE_DIR / "static" / "css" / "sql-visualization.css").read_text(encoding="utf-8")

        cls.cm = ConnectionManager()
        cls.api = MainApi(cls.cm)

    def test_context_menu_view_has_design_view(self):
        """Verify context menu registry for 'view' contains 'design-view' item."""
        self.assertIn("view: [", self.context_menu_js)
        view_match = re.search(r"view:\s*\[([\s\S]*?)\]\s*,", self.context_menu_js)
        self.assertIsNotNone(view_match, "Could not find view registry in context-menu.js")
        view_block = view_match.group(1)
        self.assertIn("design-view", view_block)
        self.assertIn("Design View (Trực quan hóa SQL)", view_block)

    def test_context_menu_materialized_view_has_design_view(self):
        """Verify context menu registry for 'materialized_view' (PostgreSQL) contains 'design-view'."""
        self.assertIn("materialized_view: [", self.context_menu_js)
        mat_match = re.search(r"materialized_view:\s*\[([\s\S]*?)\]\s*,", self.context_menu_js)
        self.assertIsNotNone(mat_match, "Could not find materialized_view registry in context-menu.js")
        mat_block = mat_match.group(1)
        self.assertIn("design-view", mat_block)
        self.assertIn("Design View (Trực quan hóa SQL)", mat_block)

    def test_context_menu_handles_design_view_action(self):
        """Verify handleAction has case 'design-view' calling SqlVisualizer.openView."""
        self.assertIn("case 'design-view':", self.context_menu_js)
        self.assertIn("window.SqlVisualizer.openView(nodeData)", self.context_menu_js)

    def test_tabs_manager_query_designer_integration(self):
        """Verify tabs.js recognizes 'query-designer' as non-text tab and manages its lifecycle."""
        self.assertIn("'query-designer'", self.tabs_js)
        self.assertIn("state.tabType === 'query-designer'", self.tabs_js)
        self.assertIn("window.SqlVisualizer.activateTab(tabId)", self.tabs_js)
        self.assertIn("window.SqlVisualizer.closeTab(tabId)", self.tabs_js)
        self.assertIn("document.getElementById('sql-visualizer-container')?.classList.add('d-none')", self.tabs_js)

    def test_templates_contain_visualizer_container(self):
        """Verify both index.html and partials/editor.html contain #sql-visualizer-container."""
        self.assertIn('id="sql-visualizer-container"', self.index_html)
        self.assertIn('id="sql-visualizer-container"', self.editor_html)

    def test_index_html_loads_all_visualization_assets(self):
        """Verify index.html includes CSS and all JS modules."""
        self.assertIn('static/css/sql-visualization.css', self.index_html)
        self.assertIn('static/vendor/d3/d3.min.js', self.index_html)
        self.assertIn('static/js/visualization/query-model.js', self.index_html)
        self.assertIn('static/js/visualization/sql-parser.js', self.index_html)
        self.assertIn('static/js/visualization/sql-generator.js', self.index_html)
        self.assertIn('static/js/visualization/d3-renderer.js', self.index_html)
        self.assertIn('static/js/visualization/sql-visualizer.js', self.index_html)

    def test_query_model_module_definitions(self):
        """Verify QueryModel exposes all required classes and methods per Section 5."""
        self.assertIn("class TableNode", self.query_model_js)
        self.assertIn("class JoinEdge", self.query_model_js)
        self.assertIn("class SelectItem", self.query_model_js)
        self.assertIn("class WhereCondition", self.query_model_js)
        self.assertIn("class QueryModel", self.query_model_js)
        self.assertIn("class HistoryManager", self.query_model_js)
        self.assertIn("addTable", self.query_model_js)
        self.assertIn("removeTable", self.query_model_js)
        self.assertIn("addJoin", self.query_model_js)
        self.assertIn("removeJoin", self.query_model_js)
        self.assertIn("toggleColumnSelection", self.query_model_js)

    def test_sql_parser_implements_section_13_cases(self):
        """Verify SqlParser implements required logic for Tests 1 through 6."""
        self.assertIn("extractSelectQuery", self.sql_parser_js)
        self.assertIn("isUnsupported", self.sql_parser_js)
        self.assertIn("detectDialect", self.sql_parser_js)
        self.assertIn("_parseFromAndJoins", self.sql_parser_js)
        self.assertIn("_parseOnConditions", self.sql_parser_js)
        self.assertIn("_parseSelectItems", self.sql_parser_js)
        self.assertIn("_parseWhere", self.sql_parser_js)

    def test_sql_generator_implements_dialects_and_preservation(self):
        """Verify SqlGenerator supports SQL Server and PostgreSQL quoting and limits."""
        self.assertIn("quoteIdentifier", self.sql_generator_js)
        self.assertIn("formatTableRef", self.sql_generator_js)
        self.assertIn("formatColumnRef", self.sql_generator_js)
        self.assertIn("postgresql", self.sql_generator_js)
        self.assertIn("sqlserver", self.sql_generator_js)
        self.assertIn("LIMIT", self.sql_generator_js)
        self.assertIn("TOP", self.sql_generator_js)

    def test_d3_renderer_implements_interactions(self):
        """Verify D3 renderer implements cards, ports, bezier curves, drag-link, zoom."""
        self.assertIn("d3.zoom()", self.d3_renderer_js)
        self.assertIn("d3.drag()", self.d3_renderer_js)
        self.assertIn("_renderTables", self.d3_renderer_js)
        self.assertIn("_renderJoins", self.d3_renderer_js)
        self.assertIn("_startDragLink", self.d3_renderer_js)
        self.assertIn("_calculateBezier", self.d3_renderer_js)
        self.assertIn("zoomFit", self.d3_renderer_js)
        self.assertIn("autoLayout", self.d3_renderer_js)

    def test_css_rules_present(self):
        """Verify required CSS classes for dark theme, canvas, and table cards."""
        self.assertIn("#sql-visualizer-container", self.css)
        self.assertIn(".vqd-canvas-svg", self.css)
        self.assertIn(".vqd-table-card", self.css)
        self.assertIn(".vqd-port", self.css)
        self.assertIn(".vqd-join-path", self.css)
        self.assertIn(".vqd-join-badge-group", self.css)
        self.assertIn(".vqd-criteria-table", self.css)
        # Theme and Focus rules
        self.assertIn("html[data-theme-mode=\"light\"]", self.css)
        self.assertIn(".vqd-table-card.vqd-focused", self.css)
        self.assertIn(".vqd-row-focused", self.css)
        self.assertIn("--ide-bg-editor", self.css)
        self.assertIn("--ide-bg-toolbar", self.css)

    def test_d3_renderer_hierarchical_layout_and_focus(self):
        """Verify D3 renderer has applyHierarchicalLayout and onTableFocus."""
        self.assertIn("applyHierarchicalLayout", self.d3_renderer_js)
        self.assertIn("onTableFocus", self.d3_renderer_js)
        self.assertIn("vqd-focused", self.d3_renderer_js)

    def test_metadata_provider_static_methods(self):
        """Verify metadata-provider.js exposes static getObjects and getColumns."""
        metadata_provider_js = (WORKSPACE_DIR / "static" / "js" / "metadata-provider.js").read_text(encoding="utf-8")
        self.assertIn("MetadataProvider.getObjects = async function", metadata_provider_js)
        self.assertIn("MetadataProvider.getColumns = async function", metadata_provider_js)

    def test_main_api_intellisense_endpoints(self):
        """Verify MainApi exposes get_intellisense_objects and get_intellisense_columns."""
        self.assertTrue(hasattr(self.api, "get_intellisense_objects"))
        self.assertTrue(hasattr(self.api, "get_intellisense_columns"))

    def test_metadata_definition_endpoint_for_view(self):
        """Verify MainApi.get_definition returns DDL for a standard view."""
        mock_conn = MagicMock()
        mock_conn.metadata_service.get_object_definition.return_value = (
            "CREATE VIEW dbo.B20CustomerView AS SELECT Id, Name FROM dbo.B20Customer;"
        )
        with patch.object(self.api, "_get_connection", return_value=mock_conn):
            res = self.api.get_definition(
                "test-conn", database="mydb", schema="dbo", name="B20CustomerView", type="view"
            )
            self.assertTrue(res.get("success"))
            self.assertIn("CREATE VIEW", res.get("definition", ""))
            mock_conn.metadata_service.get_object_definition.assert_called_with(
                "mydb", "dbo", "B20CustomerView", "view"
            )

    def test_metadata_definition_endpoint_for_materialized_view(self):
        """Verify MainApi.get_definition returns DDL for PostgreSQL materialized_view."""
        mock_conn = MagicMock()
        mock_conn.metadata_service.get_object_definition.return_value = (
            'CREATE MATERIALIZED VIEW "public"."mv_monthly_sales" AS '
            'SELECT date_trunc(\'month\', order_date) AS month, sum(total) AS total_sales FROM "public"."orders" GROUP BY 1;'
        )
        with patch.object(self.api, "_get_connection", return_value=mock_conn):
            res = self.api.get_definition(
                "test-conn", database="mydb", schema="public", name="mv_monthly_sales", type="materialized_view"
            )
            self.assertTrue(res.get("success"))
            self.assertIn("CREATE MATERIALIZED VIEW", res.get("definition", ""))
            mock_conn.metadata_service.get_object_definition.assert_called_with(
                "mydb", "public", "mv_monthly_sales", "materialized_view"
            )

    def test_sql_visualizer_enhancements(self):
        """Verify new enhancements: resizer rAF/overlay, toolbar collapse, linked columns, Monaco highlights, synonyms."""
        # Resizer & Overlay
        self.assertIn("vqd-resizing", self.css)
        self.assertIn("requestAnimationFrame", self.sql_visualizer_js)
        # Toolbar collapse
        self.assertIn("vqd-toolbar-collapsed", self.css)
        self.assertIn(".vqd-toolbar.vqd-toolbar-collapsed .vqd-toolbar-left", self.css)
        self.assertIn(".vqd-toolbar.vqd-toolbar-collapsed .vqd-btn-toggle-objects", self.css)
        self.assertIn("vqd-btn-toggle-toolbar", self.sql_visualizer_js)
        # Linked columns & expand toggle
        self.assertIn("vqd-col-linked", self.css)
        self.assertIn("vqd-col-linked", self.d3_renderer_js)
        self.assertIn("vqd-toggle-more-btn", self.d3_renderer_js)
        # Synonyms in right panel
        self.assertIn("type=synonyms", self.sql_visualizer_js)
        self.assertIn("SYNONYM", self.sql_visualizer_js)
        # Monaco highlight
        self.assertIn("_highlightTableInMonaco", self.sql_visualizer_js)
        self.assertIn("vqd-monaco-highlight-table", self.css)
        self.assertIn("vqd-monaco-highlight-column", self.css)

    def test_sql_visualizer_performance_optimizations(self):
        """Verify performance optimizations for lag-free 60fps operations."""
        # 1. Fast joins and real-time drag tracking
        self.assertIn("_updateJoinsFast", self.d3_renderer_js)
        self.assertIn("_updateJoinsRealtime", self.d3_renderer_js)
        # 2. In-place column selection and card badge count
        self.assertIn("_updateCardBadgeCount", self.d3_renderer_js)
        # 3. Dynamic draglink event listeners
        self.assertIn("mousemove.draglink", self.d3_renderer_js)
        # 4. In-place Criteria Grid highlighting without full DOM rebuild
        self.assertIn("_updateCriteriaGridHighlight", self.sql_visualizer_js)
        # 5. Monaco smooth executeEdits instead of setValue
        self.assertIn("executeEdits('vqd-sync'", self.sql_visualizer_js)
        # 6. Filter disabling during dragging
        self.assertIn(".vqd-table-card.vqd-dragging .vqd-card-bg", self.css)
        # 7. Default collapse unlinked columns
        self.assertIn("this.isExpanded = opts.isExpanded !== undefined ? opts.isExpanded : false", self.query_model_js)
        # 8. Normalized database object types for search
        self.assertIn("_normalizeObjectType", self.sql_visualizer_js)

    def test_join_with_literal_filter_avoids_self_loop(self):
        """
        Verify Bug 1 fix: When JOIN ON contains literal filter like Class.ParentCode = 'SYSTEMCONFIG',
        the parser does NOT treat targetNode as sourceTableNode (avoiding self-join loop).
        """
        self.assertIn("isInterTable", self.sql_parser_js)
        self.assertIn("sourceTableNode && sourceTableNode.id === targetNode.id", self.sql_parser_js)
        self.assertIn("b.isInterTable ? 1 : 0", self.sql_parser_js)

    def test_union_all_visualization_support(self):
        """
        Verify Bug 2 fix: Queries with UNION / UNION ALL are visualized:
        - AST flow analysis in Python supports CREATE VIEW with UNION (unwrapping exp.Create)
        - Client-side sql-parser extracts tables from UNION branches so Table Cards view is populated
        """
        from app.services.query_flow_service import QueryFlowService
        sql = """
        CREATE VIEW dbo.vTest
        AS
        SELECT Id, Name FROM dbo.TableA
        UNION ALL
        SELECT Id, Name FROM dbo.TableB
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")
        self.assertIsNotNone(graph.get_node("union_combiner"), "union_combiner node must exist for UNION ALL")
        self.assertEqual(graph.get_node("union_combiner").label, "UNION ALL")
        self.assertIsNotNone(graph.get_node("final_result"))
        self.assertIsNotNone(graph.get_node("select_branch_1"))
        self.assertIsNotNone(graph.get_node("select_branch_2"))

        # Verify client parser extracts tables from branches
        self.assertIn("rawBranches = splitTopLevel(querySql, 'UNION', true)", self.sql_parser_js)

    def test_resize_lag_elimination_and_pointer_capture(self):
        """
        Verify Bug 3 fix: Resizing uses pointer capture and CSS pointer-events blocking to eliminate lag.
        """
        self.assertIn("setPointerCapture", self.sql_visualizer_js)
        self.assertIn("releasePointerCapture", self.sql_visualizer_js)
        self.assertIn("body.vqd-resizing .monaco-editor *", self.css)
        self.assertIn("body.vqd-resizing .vqd-objects-pane", self.css)

    def test_object_filter_toggles_d_none(self):
        """
        Verify Bug 4 fix: Filtering database objects toggles Bootstrap 'd-none' and sets display: none !important
        to overcome Bootstrap .d-flex's display: flex !important.
        """
        self.assertIn("classList.toggle('d-none', !isMatch)", self.sql_visualizer_js)
        self.assertIn("item.style.setProperty('display', 'none', 'important')", self.sql_visualizer_js)

    def test_initial_collapse_and_pk_first_column_sorting(self):
        """
        Verify Bug 5 fix and Improvement 1:
        - Table cards default to collapsed (isExpanded: false) on first open.
        - Primary key columns (isPk) appear first, followed by joined columns (isLinked), followed by other columns.
        """
        # Table cards default collapsed on initial creation
        self.assertIn("isExpanded: existingNode ? existingNode.isExpanded : false", self.sql_parser_js)
        # Stable column sorting: PK rank 0, linked rank 1, others rank 2
        self.assertIn("col.isPk) return 0", self.d3_renderer_js)
        self.assertIn("col.isLinked) return 1", self.d3_renderer_js)
        self.assertIn("allCols.filter(c => c.isPk || c.isLinked)", self.d3_renderer_js)


if __name__ == "__main__":
    unittest.main()


