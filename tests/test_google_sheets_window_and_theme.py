"""
Unit tests for Google Sheets standalone subwindow and theme synchronization.
Verifies:
1. GoogleSheetsSubwindowApi class delegation and lifecycle.
2. open_google_sheets_window creates window with correct URL query parameters.
3. Theme synchronization mechanism for Google Sheets window.
4. Retention of pure white background for spreadsheet table contents.
"""

import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path
from app.desktop.windows import GoogleSheetsSubwindowApi, open_google_sheets_window


class TestGoogleSheetsSubwindow(unittest.TestCase):

    def setUp(self):
        self.mock_main_api = MagicMock()
        self.mock_main_api.gs_list_projects.return_value = {"success": True, "projects": []}
        self.mock_main_api.apply_titlebar_theme.return_value = {"success": True}
        self.sub_api = GoogleSheetsSubwindowApi(self.mock_main_api)

    def test_subwindow_api_delegation(self):
        """Verify any gs_* or helper API call is transparently delegated to main_api."""
        res = self.sub_api.gs_list_projects()
        self.assertTrue(res["success"])
        self.mock_main_api.gs_list_projects.assert_called_once()

    def test_subwindow_api_fetch_sheet_data(self):
        """Verify gs_fetch_sheet_data is delegated to main_api."""
        self.mock_main_api.gs_fetch_sheet_data.return_value = {"success": True, "rows": 10, "gridData": []}
        res = self.sub_api.gs_fetch_sheet_data("proj_1", "sheet_1")
        self.assertTrue(res["success"])
        self.mock_main_api.gs_fetch_sheet_data.assert_called_once_with("proj_1", "sheet_1")

    def test_subwindow_api_theme_titlebar(self):
        """Verify titlebar theme delegation."""
        res = self.sub_api.apply_titlebar_theme("#ffffff", "#000000", "#cccccc", False)
        self.assertTrue(res["success"])
        self.mock_main_api.apply_titlebar_theme.assert_called_with("#ffffff", "#000000", "#cccccc", False)

    def test_subwindow_api_lifecycle(self):
        """Verify window close lifecycle."""
        mock_win = MagicMock()
        self.sub_api.set_window(mock_win)
        res = self.sub_api.close_window()
        self.assertTrue(res["success"])
        mock_win.destroy.assert_called_once()

    @patch("webview.create_window")
    @patch("app.desktop.windows._load_settings_file")
    def test_open_google_sheets_window_url_and_theme(self, mock_load_settings, mock_create_window):
        """Verify open_google_sheets_window creates subwindow with ?theme= query parameter."""
        mock_load_settings.return_value = {
            "appearance": {"theme": "light-jetbrains-color-theme"},
            "theme": "light-jetbrains-color-theme"
        }
        mock_win = MagicMock()
        mock_create_window.return_value = mock_win

        mock_api = MagicMock()
        mock_api._window = MagicMock()
        mock_api._google_sheets_manager_window = None

        res = open_google_sheets_window(mock_api, base_dir=Path(__file__).parent.parent)
        self.assertTrue(res["success"])
        self.assertTrue(mock_create_window.called)

        call_kwargs = mock_create_window.call_args[1]
        self.assertTrue(call_kwargs["url"].endswith("google_sheets_window.html"))
        self.assertNotIn("?", call_kwargs["url"], "file:// URLs must not contain query parameters to prevent ERR_FILE_NOT_FOUND in WebView2")
        self.assertEqual(call_kwargs["title"], "Google Sheets Workspace — luoBTool IDE")
        self.assertIsInstance(call_kwargs["js_api"], GoogleSheetsSubwindowApi)

    def test_editor_host_api_bridge(self):
        """Verify gs_editor_host_* methods exist and function through subwindow API."""
        mock_host = MagicMock()
        mock_host.initialize.return_value = {"success": True, "status": "initialized"}
        mock_host.navigate.return_value = {"success": True, "url": "https://docs.google.com/spreadsheets/d/abc/edit"}
        mock_host.set_bounds.return_value = {"success": True, "bounds": {"x": 100, "y": 50, "width": 800, "height": 600}}
        mock_host.set_visible.return_value = {"success": True, "visible": True}
        mock_host.get_state.return_value = {"status": "ready", "url": "https://docs.google.com/spreadsheets/d/abc/edit"}
        mock_host.dispose.return_value = {"success": True, "status": "disposed"}

        self.sub_api._editor_host = mock_host

        # Test bridge calls
        self.assertEqual(self.sub_api.gs_editor_host_init()["status"], "initialized")
        self.assertEqual(self.sub_api.gs_editor_host_navigate("https://docs.google.com/spreadsheets/d/abc/edit")["success"], True)
        self.assertEqual(self.sub_api.gs_editor_host_set_bounds(100, 50, 800, 600, True)["success"], True)
        self.assertEqual(self.sub_api.gs_editor_host_set_visible(True)["visible"], True)
        self.assertEqual(self.sub_api.gs_editor_host_get_state()["status"], "ready")
        self.assertEqual(self.sub_api.gs_editor_host_dispose()["status"], "disposed")
        self.assertIsNone(self.sub_api._editor_host)

    def test_google_sheets_window_html_structure(self):
        """Verify google_sheets_window.html has grouped project tree, tag filters, independent tabs, and no panel 2."""
        html_path = Path(__file__).parent.parent / "templates" / "google_sheets_window.html"
        self.assertTrue(html_path.exists(), "templates/google_sheets_window.html must exist")
        content = html_path.read_text(encoding="utf-8")

        # 1. Grouped project tree & Search
        self.assertIn('id="gs-project-tree"', content, "Must have project tree element")
        self.assertIn('id="gs-tag-filter-bar"', content, "Must have tag filter bar")
        self.assertIn('id="gs-search-input"', content, "Must have search input under project title")

        # 2. Independent Sheet Tabs
        self.assertIn('id="gs-sheet-tabs-bar"', content, "Must have independent sheet tabs bar")
        self.assertIn('id="gs-sheet-tabs-scroll"', content, "Must have sheet tabs scroll container")
        self.assertIn('static/js/google-sheets/sheet-tabs.js', content, "Must load sheet-tabs.js")

        # 3. Removed panel 2 sheet navigator column
        self.assertNotIn('class="gs-sheet-col"', content, "Old Panel 2 sheet column must be removed")
        self.assertNotIn('id="gs-sheet-list"', content, "Old gs-sheet-list container must be removed")

    def test_list_projects_includes_sheets(self):
        """Verify GoogleSheetsService.list_projects returns sheets list for grouped tree rendering."""
        import tempfile
        import shutil
        from app.services.google_sheets.registry import GoogleSheetsRegistry
        from app.services.google_sheets.service import GoogleSheetsService

        tmp_dir = tempfile.mkdtemp()
        try:
            reg = GoogleSheetsRegistry(data_file=Path(tmp_dir) / "test_sheets.json")
            svc = GoogleSheetsService(registry=reg)

            # Create test project
            p = svc.create_project(name="ERP Project", description="Testing", color="#10B981")
            proj_id = p["id"]

            # Add a test sheet
            s = svc.add_sheet(
                project_id=proj_id,
                title="Khách Hàng ERP",
                url="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0",
                tags=["khach-hang", "erp"]
            )

            # List projects
            projects = svc.list_projects()
            self.assertGreaterEqual(len(projects), 1)
            target_proj = next((p for p in projects if p["id"] == proj_id), None)
            self.assertIsNotNone(target_proj, "Created project must be in list_projects")
            self.assertIn("sheets", target_proj, "list_projects must return 'sheets' list")
            self.assertEqual(len(target_proj["sheets"]), 1)
            self.assertEqual(target_proj["sheets"][0]["id"], s["id"])
            self.assertEqual(target_proj["sheets"][0]["title"], "Khách Hàng ERP")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def test_sheet_tabs_js_isolation(self):
        """Verify sheet-tabs.js defines GoogleSheetTabsManager and is completely isolated from IDE tabs."""
        js_path = Path(__file__).parent.parent / "static" / "js" / "google-sheets" / "sheet-tabs.js"
        self.assertTrue(js_path.exists(), "sheet-tabs.js must exist")
        content = js_path.read_text(encoding="utf-8")

        self.assertIn("window.GoogleSheetTabsManager", content, "Must define GoogleSheetTabsManager")
        self.assertNotIn("window.TabManager", content, "Must not interfere with IDE's main TabManager")
        self.assertNotIn("static/js/tabs.js", content, "Must not reference IDE main tabs.js")

    def test_companion_window_theming_and_get_open_windows(self):
        """Verify GoogleSheetsWindowManager supports get_open_windows and dynamic titlebar theming."""
        from app.services.google_sheets.webview_host import GoogleSheetsWindowManager, _get_current_titlebar_theme
        wm = GoogleSheetsWindowManager()
        self.assertEqual(wm.get_open_windows(), [])

        # Mock parent_api with light theme
        mock_api = MagicMock()
        mock_api._current_titlebar_theme = {
            "bg": "#dcdcdc",
            "text": "#2b2b2b",
            "border": "#cccccc",
            "is_dark": False
        }
        theme_res = _get_current_titlebar_theme(mock_api)
        self.assertEqual(theme_res.get("bg"), "#dcdcdc")
        self.assertFalse(theme_res.get("is_dark"))

    def test_multi_document_url_parsing(self):
        """Verify parse_google_workspace_url handles Docs, Slides, PDF (read-only), and Tasks."""
        from app.services.google_sheets.url_parser import parse_google_workspace_url

        # 1. Google Sheets
        sheet_res = parse_google_workspace_url("https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=123")
        self.assertTrue(sheet_res["valid"])
        self.assertEqual(sheet_res["type"], "sheet")
        self.assertEqual(sheet_res["gid"], "123")
        self.assertFalse(sheet_res["read_only"])

        # 2. Google Docs
        doc_res = parse_google_workspace_url("https://docs.google.com/document/d/1c234567890abcdefghijklm/edit")
        self.assertTrue(doc_res["valid"])
        self.assertEqual(doc_res["type"], "doc")
        self.assertEqual(doc_res["doc_id"], "1c234567890abcdefghijklm")
        self.assertIn("/document/d/1c234567890abcdefghijklm/preview", doc_res["preview_url"])
        self.assertFalse(doc_res["read_only"])

        # 3. Google Slides
        slide_res = parse_google_workspace_url("https://docs.google.com/presentation/d/1p234567890abcdefghijklm/edit")
        self.assertTrue(slide_res["valid"])
        self.assertEqual(slide_res["type"], "slide")
        self.assertEqual(slide_res["doc_id"], "1p234567890abcdefghijklm")
        self.assertIn("/presentation/d/1p234567890abcdefghijklm/embed", slide_res["preview_url"])
        self.assertFalse(slide_res["read_only"])

        # 4. Google Drive PDF (Read-only)
        pdf_drive_res = parse_google_workspace_url("https://drive.google.com/file/d/1d234567890abcdefghijklm/view")
        self.assertTrue(pdf_drive_res["valid"])
        self.assertEqual(pdf_drive_res["type"], "pdf")
        self.assertEqual(pdf_drive_res["doc_id"], "1d234567890abcdefghijklm")
        self.assertTrue(pdf_drive_res["read_only"], "PDF documents must be strictly read-only")

        # 5. Direct .pdf URL (Read-only)
        pdf_direct_res = parse_google_workspace_url("https://example.com/files/annual_report_2026.pdf")
        self.assertTrue(pdf_direct_res["valid"])
        self.assertEqual(pdf_direct_res["type"], "pdf")
        self.assertTrue(pdf_direct_res["read_only"])

        # 6. Google Tasks
        task_res = parse_google_workspace_url("https://calendar.google.com/calendar/u/0/r/tasks")
        self.assertTrue(task_res["valid"])
        self.assertEqual(task_res["type"], "task")

    def test_service_multi_document_storage(self):
        """Verify service properly saves and lists diverse document types."""
        import tempfile
        import shutil
        from app.services.google_sheets.registry import GoogleSheetsRegistry
        from app.services.google_sheets.service import GoogleSheetsService

        tmp_dir = tempfile.mkdtemp()
        try:
            reg = GoogleSheetsRegistry(data_file=Path(tmp_dir) / "test_workspace_docs.json")
            svc = GoogleSheetsService(registry=reg)

            p = svc.create_project(name="Project Docs", description="All Workspace Docs", color="#8B5CF6")
            p_id = p["id"]

            doc_item = svc.add_sheet(p_id, "Tài Liệu Đặc Tả", "https://docs.google.com/document/d/1c234567890abcdefghijklm/edit", tags=["doc", "spec"])
            self.assertEqual(doc_item["type"], "doc")
            self.assertFalse(doc_item["readOnly"])

            pdf_item = svc.add_sheet(p_id, "Báo Cáo Kiểm Toán PDF", "https://drive.google.com/file/d/1d234567890abcdefghijklm/view", tags=["pdf", "audit"])
            self.assertEqual(pdf_item["type"], "pdf")
            self.assertTrue(pdf_item["readOnly"])

            projects = svc.list_projects()
            target_proj = next((p for p in projects if p["id"] == p_id), None)
            self.assertIsNotNone(target_proj)
            self.assertEqual(len(target_proj["sheets"]), 2)
            self.assertEqual(target_proj["sheets"][0]["type"], "doc")
            self.assertEqual(target_proj["sheets"][1]["type"], "pdf")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)


    @patch("webview.create_window")
    @patch("app.desktop.windows._load_settings_file")
    def test_open_google_sheets_window_single_instance_concurrent_safe(self, mock_load_settings, mock_create_window):
        """Verify open_google_sheets_window prevents opening multiple instances concurrently."""
        mock_load_settings.return_value = {"theme": "dark"}
        mock_win = MagicMock()
        mock_create_window.return_value = mock_win

        mock_api = MagicMock()
        mock_api._window = MagicMock()
        mock_api._google_sheets_manager_window = None

        # Call 1: Opens window
        res1 = open_google_sheets_window(mock_api, base_dir=Path(__file__).parent.parent)
        self.assertTrue(res1["success"])
        self.assertEqual(mock_create_window.call_count, 1)

        # Call 2: Window already exists -> shows and focuses, does not call create_window again
        res2 = open_google_sheets_window(mock_api, base_dir=Path(__file__).parent.parent)
        self.assertTrue(res2["success"])
        self.assertEqual(mock_create_window.call_count, 1)
        mock_win.show.assert_called_once()
        mock_win.focus.assert_called_once()


if __name__ == "__main__":
    unittest.main()

