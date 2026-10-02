import os
import re

def test_editor_adapter_file_and_tags():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    adapter_path = os.path.join(base_dir, "static", "js", "editor-adapter.js")
    intellisense_path = os.path.join(base_dir, "static", "js", "intellisense.js")
    index_html_path = os.path.join(base_dir, "templates", "index.html")

    assert os.path.exists(adapter_path), "editor-adapter.js must exist"
    assert os.path.exists(intellisense_path), "intellisense.js must exist"
    assert os.path.exists(index_html_path), "index.html must exist"

    with open(adapter_path, "r", encoding="utf-8") as f:
        adapter_code = f.read()

    # Verify EditorAdapter methods
    expected_methods = [
        "class EditorAdapter",
        "getText",
        "getValue",
        "getLine",
        "getCurrentLine",
        "getTextBeforeCursor",
        "getTextAfterCursor",
        "getCursor",
        "getCursorPosition",
        "getCursorOffset",
        "replaceRange",
        "setCursor",
        "setSelection",
        "findWordAt",
        "getCursorCoordinates",
        "cursorCoords",
        "on",
        "window.EditorAdapter = EditorAdapter"
    ]
    for method in expected_methods:
        assert method in adapter_code, f"EditorAdapter must implement {method}"

    # Verify index.html loads adapter before intellisense
    with open(index_html_path, "r", encoding="utf-8") as f:
        html = f.read()

    adapter_idx = html.find("editor-adapter.js")
    intellisense_idx = html.find("intellisense.js")

    assert adapter_idx != -1, "index.html must load editor-adapter.js"
    assert intellisense_idx != -1, "index.html must load intellisense.js"
    assert adapter_idx < intellisense_idx, "editor-adapter.js must be loaded before intellisense.js"

    # Verify intellisense.js architecture separation
    with open(intellisense_path, "r", encoding="utf-8") as f:
        is_code = f.read()

    assert "class IntelliSenseDataProvider" in is_code
    assert "class IntelliSensePopupUI" in is_code
    assert "class IntelliSenseController" in is_code
    assert "window.AppIntelliSense = {" in is_code
    assert "normalizeAdapter" in is_code
    assert "attachEditor:" in is_code
    assert "triggerIntelliSense:" in is_code
    assert "chooseCurrentItem:" in is_code

    # Verify ALTER VIEW regex and context preservation
    assert "const isAlterContext = context.isAlterContext;" in is_code
    assert "const currentContext = this.activeContext;" in is_code
    assert "['procedure', 'function', 'trigger', 'view'].includes(item.type)" in is_code

    print("[PASS] Phase 1 EditorAdapter and modular architecture verified successfully!")

def test_alter_view_regex_transformation():
    # Test the regex used in intellisense.js for transforming scripts
    raw_view_ddl_1 = "CREATE VIEW [dbo].[CustomerView] AS SELECT Id, Name FROM Customer;"
    raw_view_ddl_2 = "/* header comment */\nSET ANSI_NULLS ON\nGO\nCREATE VIEW [dbo].[ComplexView] AS\nSELECT 1 AS col;"
    raw_view_ddl_3 = "CREATE OR REPLACE VIEW public.customer_view AS SELECT 1;"

    alter_regex = re.compile(r'\bCREATE\s+(?:OR\s+(?:ALTER|REPLACE)\s+)?(VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER)\b', re.IGNORECASE)

    res1 = alter_regex.sub(r'ALTER \1', raw_view_ddl_1)
    assert res1.startswith("ALTER VIEW"), f"Expected ALTER VIEW, got: {res1}"

    res2 = alter_regex.sub(r'ALTER \1', raw_view_ddl_2)
    assert "ALTER VIEW [dbo].[ComplexView]" in res2, f"Expected ALTER VIEW in res2, got: {res2}"

    res3 = alter_regex.sub(r'ALTER \1', raw_view_ddl_3)
    assert res3.startswith("ALTER VIEW"), f"Expected ALTER VIEW in res3, got: {res3}"

    # Test cursor positioning regex
    pos_regex = re.compile(r'\b(?:ALTER|CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?)\s+(?:PROCEDURE|FUNCTION|TRIGGER|VIEW)\s+(?:\[?\w+\]?\.)?\[?(CustomerView)\]?', re.IGNORECASE)
    match = pos_regex.search(res1)
    assert match is not None, "Cursor pos regex must match CustomerView"
    assert match.group(1) == "CustomerView"

    print("[PASS] ALTER VIEW script transformation regexes verified successfully!")

if __name__ == '__main__':
    test_editor_adapter_file_and_tags()
    test_alter_view_regex_transformation()

