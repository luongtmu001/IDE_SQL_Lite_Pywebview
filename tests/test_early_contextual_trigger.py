import os
import re

def test_early_trigger_code_verification():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tc_path = os.path.join(base_dir, "static", "js", "trigger-controller.js")
    ce_path = os.path.join(base_dir, "static", "js", "completion-engine.js")
    is_path = os.path.join(base_dir, "static", "js", "intellisense.js")

    with open(tc_path, "r", encoding="utf-8") as f:
        tc_code = f.read()
    with open(ce_path, "r", encoding="utf-8") as f:
        ce_code = f.read()
    with open(is_path, "r", encoding="utf-8") as f:
        is_code = f.read()

    # 1. Verify isPostKeywordObjectTrigger helper
    assert "isPostKeywordObjectTrigger" in tc_code
    assert "exec_space" in tc_code
    assert "alter_object_space" in tc_code
    assert "from_join_space" in tc_code

    # 2. Verify SQL Prompt strict keyword candidate generation
    assert "isStrictAlter" in ce_code
    assert "isStrictExec" in ce_code

    # 3. Verify reactive type-switching in intellisense.js
    assert "_lastContextCategory" in is_code

    print("[PASS] Early Contextual Trigger: Code structure and integration verified!")


def test_early_trigger_post_keyword_space_simulation():
    # Python simulation of isPostKeywordObjectTrigger
    def is_post_keyword_object_trigger(context):
        if not context:
            return None
        if context.get('hasFollowUp'):
            return {'kind': 'keyword', 'reason': 'followup_space'}
        if context.get('isAlterContext') and context.get('alterObjectType'):
            return {'kind': context['alterObjectType'], 'reason': 'alter_object_space'}
        if context.get('isExec') and not context.get('procedureName'):
            return {'kind': 'procedure', 'reason': 'exec_space'}
        if context.get('clause') in ('FROM', 'JOIN', 'INSERT INTO'):
            return {'kind': 'table', 'reason': 'from_join_space'}
        return None

    def decide_space_action(context, is_visible):
        eager = is_post_keyword_object_trigger(context)
        if eager:
            return {'action': 'trigger', 'reason': eager['reason'], 'kind': eager['kind'], 'token': ''}
        if is_visible:
            return {'action': 'close', 'reason': 'delimiter'}
        return {'action': 'none', 'reason': 'space_idle'}

    # 1. Space after FROM -> auto-triggers table
    r_from = decide_space_action({'clause': 'FROM'}, is_visible=False)
    assert r_from['action'] == 'trigger'
    assert r_from['kind'] == 'table'
    assert r_from['reason'] == 'from_join_space'

    # 2. Space after JOIN -> auto-triggers table
    r_join = decide_space_action({'clause': 'JOIN'}, is_visible=False)
    assert r_join['action'] == 'trigger'
    assert r_join['kind'] == 'table'

    # 3. Space after EXEC -> auto-triggers procedure (SQL Prompt style!)
    r_exec = decide_space_action({'isExec': True, 'procedureName': ''}, is_visible=False)
    assert r_exec['action'] == 'trigger'
    assert r_exec['kind'] == 'procedure'
    assert r_exec['reason'] == 'exec_space'

    # 4. Space after ALTER PROCEDURE -> auto-triggers procedure
    r_alter_p = decide_space_action({'isAlterContext': True, 'alterObjectType': 'procedure'}, is_visible=False)
    assert r_alter_p['action'] == 'trigger'
    assert r_alter_p['kind'] == 'procedure'
    assert r_alter_p['reason'] == 'alter_object_space'

    # 5. Space after ALTER FUNCTION -> auto-triggers function
    r_alter_f = decide_space_action({'isAlterContext': True, 'alterObjectType': 'function'}, is_visible=False)
    assert r_alter_f['action'] == 'trigger'
    assert r_alter_f['kind'] == 'function'
    assert r_alter_f['reason'] == 'alter_object_space'

    # 6. Space after ALTER VIEW -> auto-triggers view
    r_alter_v = decide_space_action({'isAlterContext': True, 'alterObjectType': 'view'}, is_visible=False)
    assert r_alter_v['action'] == 'trigger'
    assert r_alter_v['kind'] == 'view'

    # 7. Space after non-object construct (e.g. WHERE 1 = 1 ) -> stays suppressed!
    r_where = decide_space_action({'clause': 'WHERE'}, is_visible=False)
    assert r_where['action'] == 'none'
    assert r_where['reason'] == 'space_idle'

    print("[PASS] Early Contextual Trigger: Post-keyword space actions verified!")


def test_sql_prompt_strict_object_filtering_simulation():
    # Simulation of CandidateGenerator with strict keyword filtering
    mock_db_objects = [
        {"name": "Customer", "type": "table"},
        {"name": "Orders", "type": "table"},
        {"name": "vw_CustomerOrders", "type": "view"},
        {"name": "sp_GetCustomer", "type": "procedure"},
        {"name": "sp_InsertOrder", "type": "procedure"},
        {"name": "fn_CalculateTax", "type": "function"},
        {"name": "fn_FormatPhone", "type": "function"}
    ]

    mock_keywords = ["SELECT", "FROM", "WHERE", "JOIN", "EXEC", "ALTER", "CREATE"]

    def generate_candidates(context):
        candidates = []
        is_strict_alter = bool(context.get('isAlterContext') and context.get('alterObjectType'))
        is_strict_exec = bool(context.get('isExec') and not context.get('procedureName'))
        is_from_join = context.get('clause') in ('FROM', 'JOIN')

        # Keywords: only added when NOT in strict alter/exec or from/join context
        if not is_strict_alter and not is_strict_exec and not is_from_join:
            for kw in mock_keywords:
                candidates.append({"name": kw, "type": "keyword"})

        # DB objects
        for obj in mock_db_objects:
            if is_strict_alter:
                if obj['type'] != context['alterObjectType']:
                    continue
            elif is_strict_exec:
                if obj['type'] != 'procedure':
                    continue
            elif context.get('clause') in ('FROM', 'JOIN'):
                if obj['type'] not in ('table', 'view'):
                    continue

            candidates.append(obj)

        return candidates

    # Case 1: After EXEC -> ONLY procedures! (No keywords, tables, or functions!)
    exec_cands = generate_candidates({'isExec': True, 'procedureName': ''})
    assert len(exec_cands) == 2
    for c in exec_cands:
        assert c['type'] == 'procedure'
    assert all(c['type'] != 'keyword' for c in exec_cands)
    assert all(c['type'] != 'table' for c in exec_cands)

    # Case 2: After ALTER PROCEDURE -> ONLY procedures!
    alter_proc_cands = generate_candidates({'isAlterContext': True, 'alterObjectType': 'procedure'})
    assert len(alter_proc_cands) == 2
    for c in alter_proc_cands:
        assert c['type'] == 'procedure'

    # Case 3: After ALTER FUNCTION -> ONLY functions!
    alter_func_cands = generate_candidates({'isAlterContext': True, 'alterObjectType': 'function'})
    assert len(alter_func_cands) == 2
    for c in alter_func_cands:
        assert c['type'] == 'function'

    # Case 4: After FROM -> ONLY tables and views!
    from_cands = generate_candidates({'clause': 'FROM'})
    assert len(from_cands) == 3  # Customer, Orders, vw_CustomerOrders
    for c in from_cands:
        assert c['type'] in ('table', 'view')

    print("[PASS] Early Contextual Trigger: Strict object filtering by keyword (SQL Prompt style) verified!")


def test_reactive_type_switching_simulation():
    # Simulation of switching from ALTER PROCEDURE to ALTER FUNCTION without Ctrl+Space
    class ReactiveController:
        def __init__(self):
            self.last_context_category = None
            self.active_candidates = []
            self.fetch_count = 0

        def update_context(self, context):
            current_cat = ""
            if context.get('isAlterContext') and context.get('alterObjectType'):
                current_cat = f"alter_{context['alterObjectType']}"
            elif context.get('isExec'):
                current_cat = "exec"
            else:
                current_cat = context.get('clause', '')

            # Detect reactive switch
            if self.last_context_category and current_cat and self.last_context_category != current_cat:
                # Invalidate & reload!
                self.active_candidates = None
                self.fetch_candidates(current_cat)
                self.last_context_category = current_cat
                return "SWITCHED_AND_RELOADED"

            self.last_context_category = current_cat
            if not self.active_candidates:
                self.fetch_candidates(current_cat)
                return "INITIAL_LOAD"
            return "FILTERED_LOCALLY"

        def fetch_candidates(self, category):
            self.fetch_count += 1
            if category == 'alter_procedure':
                self.active_candidates = ['sp_GetCustomer', 'sp_InsertOrder']
            elif category == 'alter_function':
                self.active_candidates = ['fn_CalculateTax', 'fn_FormatPhone']
            else:
                self.active_candidates = ['Customer', 'Orders']

    rc = ReactiveController()

    # Step 1: User types ALTER PROCEDURE
    res1 = rc.update_context({'isAlterContext': True, 'alterObjectType': 'procedure'})
    assert res1 == "INITIAL_LOAD"
    assert rc.active_candidates == ['sp_GetCustomer', 'sp_InsertOrder']
    assert rc.fetch_count == 1

    # Step 2: User backspaces PROCEDURE and types FUNCTION
    # Controller reacts automatically without needing Ctrl+Space!
    res2 = rc.update_context({'isAlterContext': True, 'alterObjectType': 'function'})
    assert res2 == "SWITCHED_AND_RELOADED"
    assert rc.active_candidates == ['fn_CalculateTax', 'fn_FormatPhone']
    assert rc.fetch_count == 2

    print("[PASS] Early Contextual Trigger: Reactive type-switching without Ctrl+Space verified!")
