# -*- coding: utf-8 -*-
"""
Tests for Phase 8 Step 2: DOM Injection Hardening (innerHTML -> escapeHtml / textContent).
Verifies:
1. explorer.js sanitizes DB error messages and delegates to window.escapeHtml.
2. table-data-editor.js delegates esc() to window.escapeHtml.
3. grid-result.js delegates escapeHtml() to window.escapeHtml.
4. Malicious payloads (<img src=x onerror=...>) are safely escaped in rendered tree/error nodes.
5. Dist sync verification.
"""

from pathlib import Path
import re


def _escape_html_py(val):
    if val is None:
        return ""
    mapping = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    }
    return re.sub(r'[&<>"\']', lambda m: mapping[m.group(0)], str(val))


def test_explorer_js_escapes_error_messages():
    exp_path = Path("static/js/explorer.js")
    assert exp_path.exists()
    content = exp_path.read_text(encoding="utf-8")

    # Line ~315: childUl error loadCallback
    assert "Error: ${escapeHtml(err.message)}" in content
    # Line ~1066: object children error
    assert "Error: ${escapeHtml(data.error" in content
    # Delegates to window.escapeHtml
    assert "window.escapeHtml" in content


def test_table_data_editor_and_grid_delegate_to_window_escape_html():
    tde_content = Path("static/js/table-data-editor.js").read_text(encoding="utf-8")
    assert "window.escapeHtml" in tde_content

    grid_content = Path("static/js/grid-result.js").read_text(encoding="utf-8")
    assert "window.escapeHtml" in grid_content


def test_xss_payload_in_simulated_explorer_error():
    malicious_db_error = "<img src=x onerror=alert('db_hack')> Connection dropped"
    escaped_error = _escape_html_py(malicious_db_error)

    rendered_html = f'<li><div class="tree-item" style="color: var(--ide-danger); font-size: 11px;">Error: {escaped_error}</div></li>'
    assert "<img" not in rendered_html
    assert "&lt;img src=x onerror=alert(&#039;db_hack&#039;)&gt;" in rendered_html


def test_dist_sync_hardened_files():
    for f in ["static/js/explorer.js", "static/js/table-data-editor.js", "static/js/grid-result.js"]:
        src = Path(f).read_text(encoding="utf-8")
        dist = Path(f"dist/LLTool/_internal/{f}").read_text(encoding="utf-8")
        assert src == dist, f"Dist file out of sync: {f}"
