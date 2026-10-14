# -*- coding: utf-8 -*-
"""
Tests for Phase 8 Step 3: Content Security Policy (CSP) Meta Tags.
Verifies:
1. templates/index.html defines Content-Security-Policy with default-src 'self'.
2. All subwindows define matching Content-Security-Policy meta tags.
3. Key directives for Monaco Editor, AG Grid, Web Workers, and offline fonts are satisfied.
4. Dist folder templates are synchronized.
"""

from pathlib import Path
import re


ALL_TEMPLATES = [
    "templates/index.html",
    "templates/profiler_window.html",
    "templates/query_history_window.html",
    "templates/settings_window.html",
    "templates/event_listener_window.html",
    "templates/bravo_form.html",
    "templates/splash.html",
]


def test_index_html_has_csp_meta_tag():
    path = Path("templates/index.html")
    assert path.exists()
    content = path.read_text(encoding="utf-8")

    assert 'http-equiv="Content-Security-Policy"' in content
    assert "default-src 'self'" in content
    assert "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:" in content
    assert "worker-src 'self' blob:" in content
    assert "connect-src 'self'" in content


def test_all_secondary_windows_have_csp_meta_tags():
    for t_path in ALL_TEMPLATES:
        path = Path(t_path)
        assert path.exists(), f"{t_path} must exist"
        content = path.read_text(encoding="utf-8")

        m = re.search(r'<meta\s+http-equiv=["\']Content-Security-Policy["\']\s+content="([^"]+)"', content, re.IGNORECASE)
        assert m is not None, f"Missing Content-Security-Policy meta tag in {t_path}"
        policy = m.group(1)

        assert "default-src 'self'" in policy, f"Missing default-src 'self' in {t_path}"
        assert "script-src" in policy, f"Missing script-src in {t_path}"
        assert "worker-src" in policy, f"Missing worker-src in {t_path}"


def test_dist_sync_templates():
    for t_path in ALL_TEMPLATES:
        src = Path(t_path).read_text(encoding="utf-8")
        dist = Path(f"dist/LLTool/_internal/{t_path}").read_text(encoding="utf-8")
        assert src == dist, f"Dist template out of sync: {t_path}"
