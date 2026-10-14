from pathlib import Path
import re


def test_navbar_toolbar_and_subnav_z_index():
    """Verify that navbar and all its sub-nav dropdown menus have the highest stacking priority above all content."""
    app_css = Path("static/css/app.css").read_text(encoding="utf-8")
    style_css = Path("static/css/style.css").read_text(encoding="utf-8")
    editor_css = Path("static/css/editor.css").read_text(encoding="utf-8")

    # 1. Verify .ide-toolbar has relative positioning and high z-index
    for css in [app_css, style_css]:
        assert ".ide-toolbar {" in css
        assert "position: relative;" in css
        assert "z-index: 10000 !important;" in css
        assert "overflow: visible !important;" in css

    # 2. Verify sub-nav dropdown menus have highest z-index priority
    for css in [app_css, style_css]:
        assert ".ide-toolbar .dropdown-menu" in css
        assert "z-index: 10002 !important;" in css

    # 3. Verify .ide-toolbar z-index (10000) strictly exceeds .ide-action-bar (1050)
    action_bar_match = re.search(r"\.ide-action-bar\s*\{[^}]*z-index:\s*(\d+)", editor_css)
    assert action_bar_match, "editor.css must contain .ide-action-bar with z-index"
    action_bar_z = int(action_bar_match.group(1))
    assert 10000 > action_bar_z, f"Navbar z-index (10000) must be greater than action bar z-index ({action_bar_z})"
