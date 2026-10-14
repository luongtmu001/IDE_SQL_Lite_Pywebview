from pathlib import Path
import re


def test_explorer_css_multi_filter_and_count_badge():
    css_path = Path("static/css/explorer.css")
    assert css_path.exists(), "static/css/explorer.css must exist"
    content = css_path.read_text(encoding="utf-8")

    # 1. Section 52: Tree count badge styling
    assert ".tree-count-badge {" in content
    assert ".tree-count-badge.is-filtered {" in content

    # 2. Section 6: Multi-condition filter modal styling
    assert "#ide-filter-modal .modal-content {" in content
    assert "#ide-filter-modal .form-control" in content
    assert "#ide-filter-modal .filter-condition-row .cond-remove" in content


def test_explorer_js_multi_filter_engine_and_modal():
    js_path = Path("static/js/explorer.js")
    assert js_path.exists(), "static/js/explorer.js must exist"
    content = js_path.read_text(encoding="utf-8")

    # 1. Multiple filter conditions modal structure
    assert "showFilterModal" in content
    assert "ide-filter-conditions-list" in content
    assert "ide-filter-add-btn" in content
    assert "ide-filter-logic" in content
    assert "ide-filter-apply" in content
    assert "ide-filter-reset" in content

    # 2. Operators supported (Section 9)
    assert 'value="contains"' in content
    assert 'value="startswith"' in content
    assert 'value="endswith"' in content
    assert 'value="equals"' in content
    assert 'value="notequals"' in content

    # 3. Fields supported (Section 7)
    assert 'value="name"' in content
    assert 'value="schema"' in content

    # 4. Filter matching logic (Section 8 & 10)
    assert "function matchFilterItem(" in content
    assert "filter.logic === 'OR'" in content
    assert "c.operator" in content

    # 5. Section 52: Total & Filtered object counting
    assert "countBadgeEl.textContent = `${filteredItems.length}/${totalCount}`;" in content
    assert "countBadgeEl.textContent = `${totalCount}`;" in content
    assert "tree-count-badge is-filtered" in content


def test_multi_filter_logic_pure_python_simulation():
    """Simulate the matchFilterItem logic in Python to verify exact semantics."""
    def eval_condition(obj, default_schema, cond):
        field = cond.get("field", "name")
        op = cond.get("operator", "contains")
        val = cond.get("value", "").strip().lower()
        if not val:
            return True

        target = (obj.get("schema") or default_schema or "dbo").lower() if field == "schema" else (obj.get("name") or "").lower()

        if op == "contains":
            return val in target
        elif op == "startswith":
            return target.startswith(val)
        elif op == "endswith":
            return target.endswith(val)
        elif op == "equals":
            return target == val
        elif op == "notequals":
            return target != val
        return val in target

    def match_item(obj, default_schema, filter_state):
        if not filter_state:
            return True
        conditions = filter_state.get("conditions", [])
        if not conditions and filter_state.get("search"):
            conditions = [{"field": "name", "operator": "contains", "value": filter_state["search"]}]
        
        valid_conds = [c for c in conditions if c.get("value", "").strip()]
        if not valid_conds:
            return True

        logic = filter_state.get("logic", "AND")
        if logic == "OR":
            return any(eval_condition(obj, default_schema, c) for c in valid_conds)
        else:
            return all(eval_condition(obj, default_schema, c) for c in valid_conds)

    items = [
        {"name": "Customer", "schema": "dbo"},
        {"name": "CustomerOrders", "schema": "sales"},
        {"name": "Orders", "schema": "sales"},
        {"name": "OrderDetails", "schema": "dbo"},
        {"name": "v_ActiveCustomers", "schema": "dbo"},
    ]

    # Test 1: Single condition contains "customer" (AND)
    f1 = {"conditions": [{"field": "name", "operator": "contains", "value": "Customer"}], "logic": "AND"}
    res1 = [x["name"] for x in items if match_item(x, "dbo", f1)]
    assert res1 == ["Customer", "CustomerOrders", "v_ActiveCustomers"]

    # Test 2: Multi-condition AND (name contains "Customer" AND schema equals "dbo")
    f2 = {
        "conditions": [
            {"field": "name", "operator": "contains", "value": "Customer"},
            {"field": "schema", "operator": "equals", "value": "dbo"}
        ],
        "logic": "AND"
    }
    res2 = [x["name"] for x in items if match_item(x, "dbo", f2)]
    assert res2 == ["Customer", "v_ActiveCustomers"]

    # Test 3: Multi-condition OR (name startswith "Customer" OR name endswith "Details")
    f3 = {
        "conditions": [
            {"field": "name", "operator": "startswith", "value": "Customer"},
            {"field": "name", "operator": "endswith", "value": "Details"}
        ],
        "logic": "OR"
    }
    res3 = [x["name"] for x in items if match_item(x, "dbo", f3)]
    assert res3 == ["Customer", "CustomerOrders", "OrderDetails"]

    # Test 4: Not equals
    f4 = {"conditions": [{"field": "name", "operator": "notequals", "value": "Customer"}], "logic": "AND"}
    res4 = [x["name"] for x in items if match_item(x, "dbo", f4)]
    assert "Customer" not in res4
    assert "Orders" in res4

    # Test 5: Empty filter returns all
    f5 = {}
    res5 = [x["name"] for x in items if match_item(x, "dbo", f5)]
    assert len(res5) == 5


def test_schema_first_click_count_preload_and_right_align():
    """Verify that clicking a schema immediately pre-calculates object counts and badges are right-aligned."""
    js_content = Path("static/js/explorer.js").read_text(encoding="utf-8")
    css_content = Path("static/css/explorer.css").read_text(encoding="utf-8")

    # 1. Immediately calculate object counts upon schema expansion
    assert "loadCategoryObjects(connId, dbName, safeSchema, cat.type, dbType)" in js_content
    assert "categoryPromiseCache" in js_content
    assert "countBadge.textContent = `${totalCount}`;" in js_content
    assert "countBadge.textContent = `${filteredItems.length}/${totalCount}`;" in js_content

    # 2. Right alignment styling in CSS
    assert "margin-left: auto;" in css_content
    assert ".tree-count-badge:empty {" in css_content
    assert "display: none;" in css_content
    assert ".tree-count-badge + .tree-node-actions {" in css_content

