from pathlib import Path


def test_explorer_css_hover_and_sticky_positioning():
    css_path = Path("static/css/explorer.css")
    assert css_path.exists(), "static/css/explorer.css must exist"
    content = css_path.read_text(encoding="utf-8")

    # 1. Verify tree-item layout
    assert ".tree-item {" in content
    assert "width: max-content;" in content
    assert "min-width: 100%;" in content

    # 2. Verify tree-node-actions container, sticky positioning, default hidden state, and theme gradient
    assert ".tree-node-actions {" in content
    assert "margin-left: auto;" in content
    assert "position: sticky;" in content
    assert "right: 0;" in content
    assert "opacity: 0;" in content
    assert "visibility: hidden;" in content
    assert ".tree-item:hover .tree-node-actions {" in content
    assert "var(--ide-bg-sidebar)" in content
    assert "linear-gradient(90deg, transparent 0%" in content

    # 3. Verify tree-more-btn styling and hover opacity
    assert ".tree-more-btn {" in content
    assert ".tree-item:hover .tree-more-btn {" in content
    assert "opacity: 1;" in content

    # 4. Verify tree-filter-btn styling and filter-active
    assert ".tree-filter-btn {" in content
    assert ".tree-item:hover .tree-filter-btn {" in content
    assert ".tree-filter-btn.filter-active {" in content
    assert "opacity: 1 !important;" in content

    # 5. Verify square status indicator (conn-status-indicator / conn-status-dot) is suppressed
    assert ".conn-status-indicator," in content
    assert "display: none !important;" in content


def test_explorer_js_hover_actions_and_nodes():
    js_path = Path("static/js/explorer.js")
    assert js_path.exists(), "static/js/explorer.js must exist"
    content = js_path.read_text(encoding="utf-8")

    # 1. Verify createMoreBtn helper exists
    assert "function createMoreBtn(" in content
    assert "tree-more-btn" in content
    assert "fa-ellipsis-vertical" in content

    # 2. Verify renderNode ensures tree-node-actions class
    assert "tree-node-actions" in content
    assert "item.appendChild(rightEl);" in content

    # 3. Verify fetchDatabases provides tree-node-actions with [⋮] and [Filter]
    assert "dbActions.className = 'tree-node-actions';" in content
    assert "dbActions.append(moreBtn, schemaFilterBtn);" in content

    # 4. Verify fetchCategories provides tree-node-actions with [⋮] and [Filter]
    assert "catActions.className = 'tree-node-actions';" in content
    assert "catActions.append(moreBtn, filterBtn);" in content

    # 5. Verify fetchObjects provides tree-node-actions with [⋮] for objects
    assert "objActions.className = 'tree-node-actions';" in content
    assert "objActions.appendChild(createMoreBtn(nData));" in content

    # 6. Verify renderGroupNode has groupActions with [⋮]
    assert "groupActions.className = 'tree-node-actions';" in content

    # 7. Verify connection node does not render square conn-status-indicator
    assert '<span class="conn-status-indicator"' not in content

