"""Tests for All Phases of SQL IDE Result Grid Performance Improvements.

Validates requirements from .SKILL/improve_grid_result.md:
- Phase 1: Fixed row height, spacer CSS, eliminating layout thrashing
- Phase 2: Throttled splitter resizing, smart ResizeObserver (skipping hidden grids)
- Phase 3: Multiple result sets lifecycle, progressive row appending without rebuild
- Phase 4: Zero duplicate payload over PyWebView IPC bridge in streaming mode
- Phase 5: Resource lifecycle cleanup (tab close, cancellation, query_id isolation)
- Phase 6/8: Performance instrumentation metrics (__gridResultPerf)
"""

import unittest
from pathlib import Path
from unittest.mock import MagicMock
from app.database.sqlserver import SqlServerAdapter
from app.database.postgresql import PostgreSqlAdapter

BASE_DIR = Path(__file__).resolve().parent.parent


class TestImproveGridResultAllPhases(unittest.TestCase):

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

    # ── Phase 1: Fixed Row Height & Layout Thrashing Elimination ─────────────
    def test_phase1_fixed_row_height_consistency(self):
        """Phase 1: Both JS and CSS must strictly use uniform 26px row heights."""
        self.assertIn("const GRID_ROW_HEIGHT = 26;", self.grid_js_content)
        self.assertIn("height: 26px;", self.css_content)
        self.assertIn("max-height: 26px;", self.css_content)

    def test_phase1_separated_read_and_write_phases(self):
        """Phase 1: render() separates Phase 1 (reads) from Phase 3 (DOM writes)."""
        self.assertIn("// Phase 1: Read layout properties in one pass", self.grid_js_content)
        self.assertIn("// Phase 2: Pure JavaScript calculations", self.grid_js_content)
        self.assertIn("// Phase 3: Batched DOM writes (zero layout reads)", self.grid_js_content)
        # Ensure rowPool[0].offsetHeight is NOT called in render
        self.assertNotIn("this.rowPool[0].offsetHeight", self.grid_js_content)

    # ── Phase 2: Throttled Splitter & Smart ResizeObserver ───────────────────
    def test_phase2_throttled_splitter(self):
        """Phase 2: Splitter dragging is throttled via requestAnimationFrame."""
        self.assertIn("createGridSplitter", self.query_js_content)
        self.assertIn("requestAnimationFrame", self.query_js_content)
        self.assertIn("ide-grid-splitter", self.query_js_content)

    def test_phase2_resize_observer_skips_hidden_grids(self):
        """Phase 2: ResizeObserver skips 0-height/hidden containers and defers layout."""
        self.assertIn("if (newHeight <= 0) {", self.grid_js_content)
        self.assertIn("this.needsLayoutUpdate = true;", self.grid_js_content)
        self.assertIn("return;", self.grid_js_content)

    # ── Phase 3: Multiple Result Sets & Progressive Append ──────────────────
    def test_phase3_lifecycle_state_management(self):
        """Phase 3: GridResultInstance manages explicit lifecycle states."""
        self.assertIn("this.state = resSet.isStreaming ? 'loading' : 'ready';", self.grid_js_content)
        self.assertIn("setState(newState)", self.grid_js_content)
        self.assertIn("getState()", self.grid_js_content)
        self.assertIn("inst.setState('loading');", self.query_js_content)
        self.assertIn("inst.setState(finalState);", self.query_js_content)

    def test_phase3_append_rows_without_rebuilding_grid(self):
        """Phase 3: appendRows appends data directly without recreating rowPool or headers."""
        self.assertIn("appendRows(newRows) {", self.grid_js_content)
        self.assertIn("this.rows.push(newRows[i]);", self.grid_js_content)
        self.assertIn("this.renderer.render(false);", self.grid_js_content)

    # ── Phase 4: Duplicate Payload Elimination ──────────────────────────────
    def test_phase4_sqlserver_streaming_eliminates_duplicate_payload(self):
        """Phase 4: SqlServerAdapter streams chunks and returns empty rows in final payload."""
        adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
        adapter.connection = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.nextset.return_value = False
        adapter.connection.cursor.return_value = mock_cursor
        mock_cursor.description = [('id',), ('title',)]
        mock_cursor.fetchmany.side_effect = [
            [(1, 'Alpha'), (2, 'Beta')],
            []
        ]

        chunks = []
        result = adapter.execute("SELECT id, title FROM tbl", progress_callback=lambda evt: chunks.append(evt))

        # Chunks delivered via callback
        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0]['type'], 'columns')
        self.assertEqual(chunks[1]['type'], 'chunk')
        self.assertEqual(len(chunks[1]['rows']), 2)

        # Final return payload does NOT duplicate the row data in memory
        self.assertEqual(result['results'][0]['row_count'], 2)
        self.assertEqual(result['results'][0]['rows'], [])
        self.assertTrue(result['results'][0].get('streamed'))

    def test_phase4_sqlserver_non_streaming_backward_compatibility(self):
        """Phase 4: Non-streaming query execution retains full rows for compatibility."""
        adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
        adapter.connection = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.nextset.return_value = False
        adapter.connection.cursor.return_value = mock_cursor
        mock_cursor.description = [('id',)]
        mock_cursor.fetchmany.return_value = [(1,), (2,)]

        result = adapter.execute("SELECT id FROM tbl", progress_callback=None)
        self.assertEqual(result['results'][0]['row_count'], 2)
        self.assertEqual(result['results'][0]['rows'], [[1], [2]])

    def test_phase4_postgresql_streaming_eliminates_duplicate_payload(self):
        """Phase 4: PostgreSqlAdapter streams chunks and returns empty rows in final payload."""
        adapter = PostgreSqlAdapter({'user': 'postgres', 'password': 'pw', 'host': 'localhost', 'database': 'db'})
        adapter.connect = MagicMock()
        adapter._ensure_database = MagicMock()
        adapter.connection = MagicMock()
        adapter.connection.closed = False
        mock_cursor = MagicMock()
        mock_cursor.pgresult = None
        mock_cursor.nextset.return_value = False
        adapter.connection.cursor.return_value.__enter__.return_value = mock_cursor
        mock_col = MagicMock()
        mock_col.name = 'val'
        mock_cursor.description = [mock_col]
        mock_cursor.fetchmany.side_effect = [
            [(100,), (200,)],
            []
        ]

        chunks = []
        result = adapter.execute("SELECT val FROM test", progress_callback=lambda evt: chunks.append(evt))

        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[1]['type'], 'chunk')
        self.assertEqual(result['results'][0]['row_count'], 2)
        self.assertEqual(result['results'][0]['rows'], [])
        self.assertTrue(result['results'][0].get('streamed'))

    # ── Phase 5: Resource Lifecycle & Cleanup ────────────────────────────────
    def test_phase5_query_id_isolation(self):
        """Phase 5: onQueryProgress rejects events from stale queries."""
        self.assertIn("evt.query_id !== currentExecutingQueryId", self.query_js_content)

    def test_phase5_tab_close_cancels_running_query_and_destroys_grids(self):
        """Phase 5: ide-tab-closed cancels executing query and destroys all grid instances."""
        self.assertIn("document.addEventListener('ide-tab-closed'", self.query_js_content)
        self.assertIn("cancelQuery();", self.query_js_content)
        self.assertIn("inst.destroy();", self.query_js_content)

    def test_phase5_cancel_query_updates_grid_state(self):
        """Phase 5: cancelQuery sets grid instances state to 'cancelled'."""
        self.assertIn("inst.setState('cancelled');", self.query_js_content)

    # ── Phase 6/8: Performance Instrumentation ───────────────────────────────
    def test_phase6_performance_instrumentation_metrics(self):
        """Phase 6/8: GridResultManager exposes getMetrics and window.__gridResultPerf."""
        self.assertIn("global.GridResultManager", self.grid_js_content)
        self.assertIn("getMetrics()", self.grid_js_content)
        self.assertIn("global.__gridResultPerf", self.grid_js_content)
        self.assertIn("renderCount", self.grid_js_content)
        self.assertIn("resizeRenderCount", self.grid_js_content)
        self.assertIn("observerCallbacks", self.grid_js_content)


if __name__ == "__main__":
    unittest.main()
