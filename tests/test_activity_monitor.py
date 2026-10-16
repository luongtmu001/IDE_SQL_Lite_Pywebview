# -*- coding: utf-8 -*-
"""
Tests for Feature 5.5: Session & Blocking Locks Monitor (Trình xem phiên & Khóa chặn).
Validates:
1. Backend ActivityService snapshot logic, DMV queries, and Head Blocker detection.
2. Safety rules: forbids self-cancellation/kill, read-only protection.
3. ActivityApiMixin & Desktop subwindow bridges.
4. CSS & Template theme compliance and STRICT Zero-inline-CSS validation.
"""
import inspect
import re
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.services.activity_service import ActivityService
from app.api.activity_api import ActivityApiMixin
from app.desktop.windows import ActivityMonitorSubwindowApi, open_activity_monitor_window

WORKSPACE_DIR = Path(__file__).resolve().parent.parent


class TestActivityMonitorService(unittest.TestCase):
    """Test ActivityService core logic and Head Blocker detection."""

    def test_head_blocker_detection_algorithm(self):
        """Simulate sessions with blocking lock chains and verify head blocker identification."""
        raw_sessions = [
            # SPID 50: idle
            {"session_id": 50, "blocking_session_id": 0, "status": "sleeping", "sql_text": ""},
            # SPID 52: Active, holding exclusive lock, not blocked by anyone -> HEAD BLOCKER
            {"session_id": 52, "blocking_session_id": 0, "status": "running", "sql_text": "UPDATE Accounts SET Bal=100"},
            # SPID 55: Blocked by 52
            {"session_id": 55, "blocking_session_id": 52, "status": "suspended", "sql_text": "SELECT * FROM Accounts"},
            # SPID 60: Blocked by 55 (multi-tier chain)
            {"session_id": 60, "blocking_session_id": 55, "status": "suspended", "sql_text": "DELETE FROM Accounts"},
            # SPID 70: User's own session
            {"session_id": 70, "blocking_session_id": 0, "status": "running", "sql_text": "SELECT 1"}
        ]

        current_spid = 70
        processed, head_blockers = ActivityService._process_session_rows(raw_sessions, current_spid=current_spid)

        # SPID 52 blocks 55, and 52 is not blocked -> 52 is head blocker!
        # Note: SPID 55 blocks 60, but 55 is blocked by 52, so 55 is NOT head blocker (it's intermediate).
        self.assertIn(52, head_blockers)
        self.assertNotIn(55, head_blockers)
        self.assertNotIn(50, head_blockers)

        # Verify row flags
        s52 = next(s for s in processed if s["session_id"] == 52)
        self.assertTrue(s52["is_head_blocker"])
        self.assertFalse(s52["is_blocked"])
        self.assertFalse(s52["is_current_session"])

        s55 = next(s for s in processed if s["session_id"] == 55)
        self.assertFalse(s55["is_head_blocker"])
        self.assertTrue(s55["is_blocked"])
        self.assertEqual(s55["blocking_session_id"], 52)

        s70 = next(s for s in processed if s["session_id"] == 70)
        self.assertTrue(s70["is_current_session"])
        self.assertFalse(s70["is_head_blocker"])

    def test_forbid_self_cancellation_and_kill(self):
        """Ensure ActivityService prevents users from killing or cancelling their own active session."""
        mock_conn = MagicMock()
        mock_conn.id = "conn_1"
        mock_conn.db_type = "mssql"
        mock_conn.read_only = False

        with patch.object(ActivityService, "get_current_session_id", return_value=88):
            # Attempting to cancel own SPID 88
            res_cancel = ActivityService.cancel_session(mock_conn, target_id=88)
            self.assertFalse(res_cancel["success"])
            self.assertIn("chính bạn", res_cancel["error"])

            # Attempting to kill own SPID 88
            res_kill = ActivityService.kill_session(mock_conn, target_id=88)
            self.assertFalse(res_kill["success"])
            self.assertIn("chính bạn", res_kill["error"])

    def test_read_only_connection_protection(self):
        """Ensure ActivityService rejects session cancellation and termination on read-only connections."""
        mock_conn = MagicMock()
        mock_conn.id = "conn_ro"
        mock_conn.db_type = "mssql"
        mock_conn.read_only = True

        with patch.object(ActivityService, "get_current_session_id", return_value=12):
            res_cancel = ActivityService.cancel_session(mock_conn, target_id=99)
            self.assertFalse(res_cancel["success"])
            self.assertIn("read-only", res_cancel["error"].lower())

            res_kill = ActivityService.kill_session(mock_conn, target_id=99)
            self.assertFalse(res_kill["success"])
            self.assertIn("read-only", res_kill["error"].lower())


class TestActivityMonitorApiAndSubwindow(unittest.TestCase):
    """Test API mixin and pywebview subwindow bridge."""

    def test_api_mixin_methods_exist(self):
        """Verify ActivityApiMixin has all required RPC methods."""
        mixin_methods = [m[0] for m in inspect.getmembers(ActivityApiMixin, predicate=inspect.isfunction)]
        self.assertIn("activity_get_sessions", mixin_methods)
        self.assertIn("activity_cancel_session", mixin_methods)
        self.assertIn("activity_kill_session", mixin_methods)
        self.assertIn("activity_get_current_spid", mixin_methods)
        self.assertIn("open_activity_monitor_window", mixin_methods)

    def test_subwindow_api_bridge(self):
        """Verify ActivityMonitorSubwindowApi delegates calls to main_api."""
        mock_main_api = MagicMock()
        mock_main_api.activity_get_sessions.return_value = {"success": True, "sessions": []}
        mock_main_api.activity_cancel_session.return_value = {"success": True}
        mock_main_api.activity_kill_session.return_value = {"success": True}
        mock_main_api.activity_get_current_spid.return_value = {"success": True, "spid": 42}

        sub_api = ActivityMonitorSubwindowApi(mock_main_api)
        self.assertTrue(sub_api.activity_get_sessions("c1")["success"])
        self.assertTrue(sub_api.activity_cancel_session("c1", 50)["success"])
        self.assertTrue(sub_api.activity_kill_session("c1", 50)["success"])
        self.assertEqual(sub_api.activity_get_current_spid("c1")["spid"], 42)


class TestActivityMonitorThemeAndZeroInlineCSS(unittest.TestCase):
    """Verify Theme synchronization and STRICT compliance with the Zero Inline CSS rule."""

    def test_css_theme_variables_presence(self):
        """Verify static/css/activity-monitor.css exists and leverages IDE CSS theme variables."""
        css_path = WORKSPACE_DIR / "static" / "css" / "activity-monitor.css"
        self.assertTrue(css_path.exists(), "activity-monitor.css must exist")

        css_content = css_path.read_text(encoding="utf-8")
        self.assertIn("var(--ide-bg-main", css_content)
        self.assertIn("var(--ide-bg-toolbar", css_content)
        self.assertIn("var(--ide-border", css_content)
        self.assertIn("var(--ide-text-main", css_content)
        self.assertIn("var(--ide-accent", css_content)
        self.assertIn(".activity-row.row-head-blocker", css_content)
        self.assertIn(".activity-row.row-blocked", css_content)
        self.assertIn(".activity-kpi-card", css_content)

    def test_zero_inline_css_in_template_and_generated_markup(self):
        """
        Verify that templates/activity_monitor_window.html has ZERO inline style attributes.
        Verify that static/js/activity-monitor.js does NOT inject HTML containing style="...".
        """
        template_path = WORKSPACE_DIR / "templates" / "activity_monitor_window.html"
        self.assertTrue(template_path.exists(), "activity_monitor_window.html must exist")
        template_content = template_path.read_text(encoding="utf-8")

        # Must not contain style="..." in body elements
        body_match = re.search(r"<body[^>]*>(.*?)</body>", template_content, re.DOTALL | re.IGNORECASE)
        if body_match:
            body_html = body_match.group(1)
            style_matches = re.findall(r'\bstyle\s*=\s*["\'][^"\']*["\']', body_html, re.IGNORECASE)
            self.assertEqual(style_matches, [], f"Found inline style in activity_monitor_window.html: {style_matches}")

        js_path = WORKSPACE_DIR / "static" / "js" / "activity-monitor.js"
        self.assertTrue(js_path.exists(), "activity-monitor.js must exist")
        js_content = js_path.read_text(encoding="utf-8")

        # Check for any style="..." written in template literals or string HTML
        js_style_matches = re.findall(r'<[^>]+style\s*=\s*["\'][^"\']*["\'][^>]*>', js_content, re.IGNORECASE)
        self.assertEqual(js_style_matches, [], f"Found inline style in generated HTML within activity-monitor.js: {js_style_matches}")

    def test_tabs_js_integration(self):
        """Verify tabs.js recognizes activity-monitor tabType and supports container switching."""
        tabs_js_path = WORKSPACE_DIR / "static" / "js" / "tabs.js"
        self.assertTrue(tabs_js_path.exists(), "tabs.js must exist")
        tabs_content = tabs_js_path.read_text(encoding="utf-8")

        self.assertIn("'activity-monitor'", tabs_content)
        self.assertIn("activity-monitor-container", tabs_content)
        self.assertIn("openActivityMonitorTab", tabs_content)


if __name__ == "__main__":
    unittest.main()
