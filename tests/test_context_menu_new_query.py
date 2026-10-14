import os
import re


def test_context_menu_has_new_query_on_all_required_nodes():
    js_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "context-menu.js")
    with open(js_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Required types that must have 'new-query'
    target_types = [
        "database",
        "schema",
        "table",
        "group-tables",
        "view",
        "group-views",
        "materialized_view",
        "group-materialized_views",
        "procedure",
        "group-procedures",
        "function",
        "group-functions",
        "trigger",
        "group-triggers",
        "sequence",
        "group-sequences",
        "synonym",
        "group-synonyms",
        "user_type",
        "group-user_types",
    ]

    for t in target_types:
        # Search for key in registry: 't': [ or t: [
        pattern = rf"['\"]?{re.escape(t)}['\"]?\s*:\s*\[([^\]]+)\]"
        match = re.search(pattern, content)
        assert match is not None, f"Registry entry for '{t}' should exist in context-menu.js"
        block = match.group(1)
        assert "new-query" in block, f"'{t}' context menu must include 'new-query'"


def test_synonym_context_menu_commands():
    js_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "context-menu.js")
    with open(js_path, "r", encoding="utf-8") as f:
        content = f.read()

    match = re.search(r"synonym\s*:\s*\[([^\]]+)\]", content)
    assert match is not None, "Registry entry for 'synonym' must exist"
    block = match.group(1)

    assert "new-query" in block
    assert "Generate DDL Script" in block or "script-create" in block
    assert "view-definition" in block
    assert "script-drop" in block
    assert "drop" in block


def test_explorer_synonyms_integration():
    js_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "explorer.js")
    with open(js_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Verify Synonyms is conditionally added based on SQL Server / SSMS
    assert "isSqlServer" in content
    assert "Synonyms" in content
    assert "type: 'synonyms'" in content or 'type: "synonyms"' in content

    # Verify iconMap and typeMap
    assert "synonyms: 'link'" in content
    assert "synonyms: 'synonym'" in content

    # Verify isLeaf includes synonyms
    assert "objType === 'synonyms'" in content
