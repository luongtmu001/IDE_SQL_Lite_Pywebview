import os
import re
import pytest

WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_split_tab_no_global_addcommand_enter_or_tab():
    """Bug #1: Ensure editor.js does NOT bind global addCommand for Enter, Shift+Enter, or Tab,
    which previously hijacked Enter to a fixed closure and broke split tab independence."""
    editor_js_path = os.path.join(WORKSPACE_ROOT, "static", "js", "editor.js")
    with open(editor_js_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Must NOT have editor.addCommand for Enter or Tab
    assert not re.search(r"editor\.addCommand\s*\(\s*monaco\.KeyCode\.Enter\b", content), \
        "editor.js must not override monaco.KeyCode.Enter with addCommand"
    assert not re.search(r"editor\.addCommand\s*\(\s*monaco\.KeyMod\.Shift\s*\|\s*monaco\.KeyCode\.Enter\b", content), \
        "editor.js must not override Shift+Enter with addCommand"
    assert not re.search(r"editor\.addCommand\s*\(\s*monaco\.KeyCode\.Tab\b", content), \
        "editor.js must not override monaco.KeyCode.Tab with addCommand"

    # Must have instance-local editor.onKeyDown handling
    assert "editor.onKeyDown" in content
    assert "getActiveAppEditor" in content
    assert "chooseCurrentItem" in content


def test_split_tab_context_and_tabstate_isolation():
    """Bug #1: Ensure split tab exports getActiveExecutingTabId / State and query.js respects them."""
    editor_js_path = os.path.join(WORKSPACE_ROOT, "static", "js", "editor.js")
    with open(editor_js_path, "r", encoding="utf-8") as f:
        editor_js = f.read()

    assert "window.getActiveExecutingTabId" in editor_js
    assert "window.getActiveExecutingTabState" in editor_js
    assert "window.getLastFocusedPane" in editor_js
    assert "window.getSecondaryTabId" in editor_js

    # Check query.js uses getActiveExecutingTabState and getActiveAppEditor
    query_js_path = os.path.join(WORKSPACE_ROOT, "static", "js", "query.js")
    with open(query_js_path, "r", encoding="utf-8") as f:
        query_js = f.read()

    assert "getActiveExecutingTabState" in query_js
    assert "getActiveAppEditor" in query_js


def test_message_formatting_separation_between_messages():
    """Bug #2: Multiple messages must be separated cleanly with line breaks, not smushed together."""
    query_js_path = os.path.join(WORKSPACE_ROOT, "static", "js", "query.js")
    with open(query_js_path, "r", encoding="utf-8") as f:
        query_js = f.read()

    # Must separate messages with double newlines
    assert "msgBlocks.join('\\n\\n')" in query_js or "msgBlocks.join(\"\\n\\n\")" in query_js, \
        "Multiple messages should be separated by double newlines for clear readability"

    # Must support message separator element
    assert "ide-msg-separator" in query_js


def test_postgresql_table_formatting_preservation():
    """Bug #2: PostgreSQL table box-drawing characters must be preserved without loss of indentation or corrupting lines."""
    query_js_path = os.path.join(WORKSPACE_ROOT, "static", "js", "query.js")
    with open(query_js_path, "r", encoding="utf-8") as f:
        query_js = f.read()

    # cleanClientMessage must preserve box drawing tables
    assert "hasTableFormatting" in query_js or "hasBoxDrawing" in query_js or "[┌─┬┐│├┼┤└┴┘]" in query_js

    # showMessage must recognize table lines and assign ide-msg-table-line class
    assert "ide-msg-table-line" in query_js
    assert "isBoxLine" in query_js


def test_css_messages_tab_no_wordwrap_and_horizontal_scroll():
    """Bug #2: CSS for messages tab must use white-space: pre !important, no word-break: break-word,
    and have horizontal scroll so tables are not broken into wrapped rows."""
    css_files = [
        os.path.join(WORKSPACE_ROOT, "static", "css", "editor.css"),
        os.path.join(WORKSPACE_ROOT, "static", "css", "style.css"),
    ]

    for p in css_files:
        with open(p, "r", encoding="utf-8") as f:
            css = f.read()

        # Check messages view has overflow: auto
        assert "#ide-results-messages-view" in css
        assert "overflow: auto" in css

        # Check messages container does not break words
        assert "word-break: normal" in css
        assert "white-space: pre" in css

        # Check table line and separator styles exist
        assert ".ide-msg-line.ide-msg-table-line" in css
        assert ".ide-msg-line.ide-msg-separator" in css
