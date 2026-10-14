import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def test_connection_action_bar_zindex_and_overflow():
    """Verify action bar and dropdowns have high z-index and overflow visible so connection is never hidden."""
    editor_css = (BASE_DIR / "static" / "css" / "editor.css").read_text(encoding="utf-8")
    style_css = (BASE_DIR / "static" / "css" / "style.css").read_text(encoding="utf-8")
    
    for css in [editor_css, style_css]:
        assert ".ide-action-bar {" in css
        assert "z-index: 2050 !important;" in css
        assert "overflow: visible !important;" in css
        assert ".ide-ctx-selectors {" in css
        assert "z-index: 2060 !important;" in css
        assert ".ide-ctx-selectors .dropdown-menu {" in css
        assert "z-index: 10002 !important;" in css
        assert ".ide-ctx-hover-card {" in css
        assert "z-index: 10005 !important;" in css

def test_templates_contain_connection_hover_card():
    """Verify both index.html and editor.html templates include connection hover card with high z-index."""
    index_html = (BASE_DIR / "templates" / "index.html").read_text(encoding="utf-8")
    editor_html = (BASE_DIR / "templates" / "partials" / "editor.html").read_text(encoding="utf-8")
    
    for html in [index_html, editor_html]:
        assert 'id="ide-ctx-connection"' in html
        assert 'id="ide-ctx-conn-hover-card"' in html
        assert 'id="ide-ctx-hc-name"' in html
        assert 'id="ide-ctx-hc-details"' in html

def test_query_js_cursor_retention_and_hover_card():
    """Verify query.js captures and restores editor position/scroll, and populates connection hover card."""
    query_js = (BASE_DIR / "static" / "js" / "query.js").read_text(encoding="utf-8")
    
    # Cursor retention
    assert "function captureEditorState(" in query_js
    assert "function restoreEditorState(" in query_js
    assert "function scheduleEditorStateRestoration(" in query_js
    assert "resolveMonacoEditor(" in query_js
    assert "rawEditor.getPosition()" in query_js or "rawEditor.getPosition" in query_js
    assert "rawEditor.getScrollTop()" in query_js or "rawEditor.getScrollTop" in query_js
    assert "rawEditor.setScrollTop(snapshot.scrollTop)" in query_js
    assert "rawEditor.setPosition(snapshot.position)" in query_js
    assert "scheduleEditorStateRestoration(rawEditorInstance, editorStateSnapshot);" in query_js
    
    # Hover card updates
    assert "ide-ctx-hc-name" in query_js
    assert "ide-ctx-hc-details" in query_js
