"""Tests for Tab Close Button UX and Empty Tabs State ("New Query" placeholder)
"""

import os
from pathlib import Path


def test_empty_tabs_placeholder_dom():
    """Verify templates contain ide-empty-tabs-placeholder and ide-empty-new-query-btn."""
    base_dir = Path(__file__).parent.parent
    for rel_path in ["templates/index.html", "templates/partials/editor.html"]:
        template_file = base_dir / rel_path
        assert template_file.exists(), f"{rel_path} must exist"
        content = template_file.read_text(encoding="utf-8")

        assert 'id="ide-empty-tabs-placeholder"' in content, f"{rel_path} must have #ide-empty-tabs-placeholder"
        assert 'id="ide-empty-new-query-btn"' in content, f"{rel_path} must have #ide-empty-new-query-btn"
        assert 'New Query' in content, f"{rel_path} must have 'New Query' button label"
        assert 'Không có tab nào đang mở' in content, f"{rel_path} must have empty state title"


def test_tab_close_button_css():
    """Verify editor.css and style.css define generous hit area and hover styling for .tab-close."""
    base_dir = Path(__file__).parent.parent
    for css_rel in ["static/css/editor.css", "static/css/style.css"]:
        css_file = base_dir / css_rel
        assert css_file.exists(), f"{css_rel} must exist"
        content = css_file.read_text(encoding="utf-8")

        assert ".tab-close {" in content
        assert "display: inline-flex" in content
        assert "width: 20px" in content
        assert "height: 20px" in content
        assert "cursor: pointer" in content
        assert ".tab-close:hover {" in content


def test_tabs_js_close_button_events_and_drag_prevention():
    """Verify tabs.js prevents dragstart on .tab-close and stops event propagation on click/mousedown."""
    base_dir = Path(__file__).parent.parent
    tabs_js = base_dir / "static" / "js" / "tabs.js"
    assert tabs_js.exists()
    content = tabs_js.read_text(encoding="utf-8")

    # Dedicated close button event handlers stopping propagation
    assert "closeBtn.addEventListener('mousedown'" in content
    assert "closeBtn.addEventListener('click'" in content
    assert "e.stopPropagation()" in content

    # Dragstart check to prevent dragging tab when clicking close
    assert "e.target.closest('.tab-close')" in content
    assert "e.preventDefault()" in content


def test_tabs_js_empty_state_and_readonly_editor():
    """Verify tabs.js disables editor typing and shows placeholder when all tabs are closed."""
    base_dir = Path(__file__).parent.parent
    tabs_js = base_dir / "static" / "js" / "tabs.js"
    assert tabs_js.exists()
    content = tabs_js.read_text(encoding="utf-8")

    # updateEmptyTabsState logic
    assert "function updateEmptyTabsState()" in content
    assert "ide-empty-tabs-placeholder" in content
    assert "emptyPlaceholder.classList.remove('d-none')" in content
    assert "readOnly: true" in content
    assert "readOnly: false" in content

    # New Query button listener
    assert "ide-empty-new-query-btn" in content
    assert "createNewQueryTab()" in content
