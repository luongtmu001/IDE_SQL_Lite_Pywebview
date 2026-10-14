import os
import re
import pytest

def test_snippets_manager_has_matching_snippet_and_try_expand():
    snippets_path = os.path.join("static", "js", "snippets-manager.js")
    assert os.path.exists(snippets_path), f"File {snippets_path} does not exist"

    with open(snippets_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Check hasMatchingSnippet method
    assert "hasMatchingSnippet(cm)" in content, "hasMatchingSnippet method must be defined"
    assert "somethingSelected" in content, "hasMatchingSnippet must check for active selection"
    assert "hasSelection" in content, "hasMatchingSnippet must check for active selection"
    assert "findSnippet(prefix)" in content, "hasMatchingSnippet must look up exact snippet"
    assert "window.AppIntelliSense.hidePopup()" in content, "tryExpandSnippet must hide IntelliSense popup"

def test_editor_on_keydown_single_tab_snippet():
    editor_path = os.path.join("static", "js", "editor.js")
    assert os.path.exists(editor_path), f"File {editor_path} does not exist"

    with open(editor_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Verify that single-Tab snippet expansion is handled in editor.onKeyDown before popup interception
    tab_snippet_idx = content.find("Single Tab Instant Snippet Expansion")
    popup_visible_idx = content.find("window.AppIntelliSense.isPopupVisible()")

    assert tab_snippet_idx != -1, "editor.js must contain Single Tab Instant Snippet Expansion"
    assert popup_visible_idx != -1, "editor.js must contain isPopupVisible check"
    assert tab_snippet_idx < popup_visible_idx, "Single Tab Snippet Expansion MUST be evaluated before isPopupVisible so 1 Tab expands snippet"
    assert "tryExpandSnippet(activeEd)" in content, "editor.js must call tryExpandSnippet"

def test_intellisense_handle_keydown_single_tab_snippet():
    is_path = os.path.join("static", "js", "intellisense.js")
    assert os.path.exists(is_path), f"File {is_path} does not exist"

    with open(is_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "Single Tab Instant Snippet Expansion" in content, "intellisense.js must contain Single Tab Instant Snippet Expansion in handleKeyDown"
    assert "tryExpandSnippet(adapter)" in content, "intellisense.js must invoke tryExpandSnippet on single Tab"

def test_ssf_snippet_exists_in_default_snippets():
    data_path = os.path.join("static", "data", "snippets.json")
    assert os.path.exists(data_path), f"File {data_path} does not exist"

    import json
    with open(data_path, "r", encoding="utf-8") as f:
        snippets = json.load(f)

    ssf_snip = next((s for s in snippets if s.get("prefix") == "ssf"), None)
    assert ssf_snip is not None, "ssf snippet must exist in snippets.json"
    assert "SELECT * FROM" in ssf_snip.get("body", ""), "ssf snippet body should contain SELECT * FROM"
