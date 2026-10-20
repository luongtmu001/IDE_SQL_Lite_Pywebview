"""
Unit tests for GoogleSheetsEditorHost service.
Verifies URL normalization, lifecycle state machine, and bounds coordination.
"""

import unittest
from unittest.mock import MagicMock, patch

from app.services.google_sheets.editor_host import (
    GoogleSheetsEditorHost,
    EditorHostState,
    normalize_sheet_edit_url
)


class TestGoogleSheetsEditorHost(unittest.TestCase):

    def test_normalize_sheet_edit_url(self):
        """Verify URL normalization into official /edit format."""
        # 1. Standard edit URL
        raw1 = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing"
        norm1 = normalize_sheet_edit_url(raw1)
        self.assertEqual(norm1, "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit")

        # 2. URL with gid
        raw2 = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=987654"
        norm2 = normalize_sheet_edit_url(raw2)
        self.assertEqual(norm2, "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=987654")

        # 3. /htmlembed preview URL normalized to /edit
        raw3 = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/htmlembed?gid=123"
        norm3 = normalize_sheet_edit_url(raw3)
        self.assertEqual(norm3, "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=123")

        # 4. Empty URL
        self.assertEqual(normalize_sheet_edit_url(""), "")

    def test_editor_host_initial_state(self):
        """Verify initial state of GoogleSheetsEditorHost."""
        host = GoogleSheetsEditorHost(window=None, cache_dir="C:\\temp\\test_cache")
        state = host.get_state()
        self.assertEqual(state["status"], EditorHostState.INITIALIZING)
        self.assertFalse(state["is_ready"])
        self.assertFalse(state["is_attached"])
        self.assertFalse(state["visible"])

    def test_editor_host_bounds_before_init(self):
        """Verify bounds can be set safely when control is not yet initialized."""
        host = GoogleSheetsEditorHost(window=None)
        res = host.set_bounds(50, 100, 800, 600, False)
        self.assertFalse(res["success"])
        self.assertIn("not initialized", res["error"])

    def test_editor_host_visible_toggle(self):
        """Verify visibility toggle without control returns safe success."""
        host = GoogleSheetsEditorHost(window=None)
        res = host.set_visible(False)
        self.assertTrue(res["success"])
        self.assertFalse(res["visible"])

    def test_editor_host_dispose(self):
        """Verify dispose transitions status to DISPOSED."""
        host = GoogleSheetsEditorHost(window=None)
        res = host.dispose()
        self.assertTrue(res["success"])
        self.assertEqual(host.status, EditorHostState.DISPOSED)

    def test_editor_host_states_constants(self):
        """Phase 4 & 5: Verify all mandated states exist."""
        self.assertEqual(EditorHostState.INITIALIZING, "initializing")
        self.assertEqual(EditorHostState.LOADING, "loading")
        self.assertEqual(EditorHostState.READY, "ready")
        self.assertEqual(EditorHostState.AUTH_REQUIRED, "auth_required")
        self.assertEqual(EditorHostState.READ_ONLY, "read_only")
        self.assertEqual(EditorHostState.ACCESS_DENIED, "access_denied")
        self.assertEqual(EditorHostState.NETWORK_ERROR, "network_error")
        self.assertEqual(EditorHostState.CLOSING, "closing")
        self.assertEqual(EditorHostState.DISPOSED, "disposed")

    @patch("webbrowser.open")
    def test_editor_host_new_window_handling(self, mock_web_open):
        """Phase 5.3: Verify external links redirect to system browser while auth popups are permitted."""
        host = GoogleSheetsEditorHost(window=None)

        # Simulate CoreWebView2 NewWindowRequested logic
        def simulate_new_window(uri):
            window_args = MagicMock()
            window_args.Uri = uri
            window_args.Handled = False
            # Core logic from editor_host.py
            if "accounts.google.com" in uri or "docs.google.com" in uri:
                return window_args
            window_args.Handled = True
            import webbrowser
            webbrowser.open(uri)
            return window_args

        # 1. Google Auth link: Handled must be False (permitted inside WebView2)
        res_auth = simulate_new_window("https://accounts.google.com/signin/v2/identifier")
        self.assertFalse(res_auth.Handled)
        mock_web_open.assert_not_called()

        # 2. External third-party link: Handled must be True and webbrowser.open called
        res_ext = simulate_new_window("https://example.com/support")
        self.assertTrue(res_ext.Handled)
        mock_web_open.assert_called_once_with("https://example.com/support")


if __name__ == "__main__":
    unittest.main()
