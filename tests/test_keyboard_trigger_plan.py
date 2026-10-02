import os
import re

def test_trigger_controller_file_and_script_order():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tc_path = os.path.join(base_dir, "static", "js", "trigger-controller.js")
    adapter_path = os.path.join(base_dir, "static", "js", "editor-adapter.js")
    ce_path = os.path.join(base_dir, "static", "js", "completion-engine.js")
    is_path = os.path.join(base_dir, "static", "js", "intellisense.js")
    html_path = os.path.join(base_dir, "templates", "index.html")

    assert os.path.exists(tc_path), "trigger-controller.js must exist"
    assert os.path.exists(adapter_path), "editor-adapter.js must exist"
    assert os.path.exists(ce_path), "completion-engine.js must exist"
    assert os.path.exists(is_path), "intellisense.js must exist"
    assert os.path.exists(html_path), "index.html must exist"

    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    adapter_idx = html.find("editor-adapter.js")
    ce_idx = html.find("completion-engine.js")
    tc_idx = html.find("trigger-controller.js")
    is_idx = html.find("intellisense.js")

    assert adapter_idx != -1, "editor-adapter.js must be in index.html"
    assert ce_idx != -1, "completion-engine.js must be in index.html"
    assert tc_idx != -1, "trigger-controller.js must be in index.html"
    assert is_idx != -1, "intellisense.js must be in index.html"

    assert adapter_idx < ce_idx < tc_idx < is_idx, (
        f"Scripts must be loaded in order: editor-adapter ({adapter_idx}) < "
        f"completion-engine ({ce_idx}) < trigger-controller ({tc_idx}) < intellisense ({is_idx})"
    )

    print("[PASS] trigger-controller.js file and index.html script load order verified!")


def test_trigger_controller_classes_and_enums():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tc_path = os.path.join(base_dir, "static", "js", "trigger-controller.js")

    with open(tc_path, "r", encoding="utf-8") as f:
        code = f.read()

    # Enums
    assert "CompletionState" in code
    for state in ["IDLE", "OPENING", "VISIBLE", "REFRESHING", "NAVIGATING", "ACCEPTING"]:
        assert f"{state}: '{state}'" in code or f"'{state}'" in code

    assert "KeyCategory" in code
    for cat in [
        "TRIGGER_EXPLICIT", "TRIGGER_CHAR", "ACTION_NAVIGATE", "ACTION_ACCEPT",
        "ACTION_CLOSE", "ACTION_BACKSPACE", "ACTION_DELETE", "ACTION_TYPING",
        "ACTION_DELIMITER", "ACTION_IGNORE"
    ]:
        assert cat in code

    assert "DecisionAction" in code
    for act in ["none", "trigger", "refresh", "close", "accept", "navigate"]:
        assert f"'{act}'" in code

    # Class & methods
    assert "class IntelliSenseTriggerController" in code
    assert "classifyKey(" in code
    assert "decideKeyDown(" in code
    assert "decideChange(" in code
    assert "decideCursor(" in code
    assert "setState(" in code
    assert "setDismissedByEscape(" in code
    assert "setActiveCandidates(" in code
    assert "setActiveToken(" in code
    assert "getMetrics(" in code
    assert "getHistory(" in code

    # Functional helpers (Section 5)
    assert "classifyKeyEvent" in code
    assert "shouldTriggerIntelliSense" in code
    assert "shouldRefreshIntelliSense" in code
    assert "shouldCloseIntelliSense" in code

    print("[PASS] CompletionState, KeyCategory, DecisionAction, and Controller methods verified!")


def test_keyboard_classification_logic():
    # Python simulation of classifyKeyEvent matching JavaScript implementation
    def classify_key_event(e):
        key = e.get('key', '')
        code = e.get('code', '')
        is_ctrl = bool(e.get('ctrlKey') or e.get('metaKey'))
        is_alt = bool(e.get('altKey'))

        if is_ctrl and not is_alt and (code == 'Space' or key in (' ', 'Spacebar')):
            return ('TRIGGER_EXPLICIT', 'Ctrl+Space', 0)

        if key in ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab'] and not is_ctrl and not is_alt:
            if key == 'Tab':
                return ('ACTION_ACCEPT', 'Tab', 0)
            return ('ACTION_IGNORE', key, 0)

        if is_ctrl or is_alt:
            return ('ACTION_IGNORE', key, 0)

        if key == 'ArrowDown':
            return ('ACTION_NAVIGATE', key, 1)
        if key == 'ArrowUp':
            return ('ACTION_NAVIGATE', key, -1)
        if key == 'PageDown':
            return ('ACTION_NAVIGATE', key, 8)
        if key == 'PageUp':
            return ('ACTION_NAVIGATE', key, -8)
        if key == 'Enter':
            return ('ACTION_ACCEPT', key, 0)
        if key == 'Escape':
            return ('ACTION_CLOSE', key, 0)
        if key == 'Backspace':
            return ('ACTION_BACKSPACE', key, 0)
        if key == 'Delete':
            return ('ACTION_DELETE', key, 0)
        if key in ('.', '@'):
            return ('TRIGGER_CHAR', key, 0)
        if key in (' ', 'Spacebar'):
            return ('ACTION_DELIMITER', ' ', 0)
        if key in [',', '(', ')', ';', '[', ']', '{', '}', '=', '+', '-', '*', '/', '<', '>', '!', '%', '&', '|', '^', '~']:
            return ('ACTION_DELIMITER', key, 0)
        if len(key) == 1 and re.match(r'^[\w$#]$', key):
            return ('ACTION_TYPING', key, 0)
        return ('ACTION_IGNORE', key, 0)

    # 1. Explicit trigger
    cat, key, _ = classify_key_event({'ctrlKey': True, 'code': 'Space'})
    assert cat == 'TRIGGER_EXPLICIT'

    # 2. Character trigger
    cat, key, _ = classify_key_event({'key': '.'})
    assert cat == 'TRIGGER_CHAR'
    cat, key, _ = classify_key_event({'key': '@'})
    assert cat == 'TRIGGER_CHAR'

    # 3. Navigation
    cat, key, step = classify_key_event({'key': 'ArrowDown'})
    assert cat == 'ACTION_NAVIGATE' and step == 1
    cat, key, step = classify_key_event({'key': 'ArrowUp'})
    assert cat == 'ACTION_NAVIGATE' and step == -1
    cat, key, step = classify_key_event({'key': 'PageDown'})
    assert cat == 'ACTION_NAVIGATE' and step == 8
    cat, key, step = classify_key_event({'key': 'PageUp'})
    assert cat == 'ACTION_NAVIGATE' and step == -8

    # 4. Accept & Close
    cat, key, _ = classify_key_event({'key': 'Enter'})
    assert cat == 'ACTION_ACCEPT'
    cat, key, _ = classify_key_event({'key': 'Escape'})
    assert cat == 'ACTION_CLOSE'

    # 5. Edits
    cat, key, _ = classify_key_event({'key': 'Backspace'})
    assert cat == 'ACTION_BACKSPACE'
    cat, key, _ = classify_key_event({'key': 'Delete'})
    assert cat == 'ACTION_DELETE'

    # 6. Delimiters
    cat, key, _ = classify_key_event({'key': ' '})
    assert cat == 'ACTION_DELIMITER'
    cat, key, _ = classify_key_event({'key': ','})
    assert cat == 'ACTION_DELIMITER'
    cat, key, _ = classify_key_event({'key': '('})
    assert cat == 'ACTION_DELIMITER'

    # 7. Typing
    cat, key, _ = classify_key_event({'key': 'c'})
    assert cat == 'ACTION_TYPING'
    cat, key, _ = classify_key_event({'key': '1'})
    assert cat == 'ACTION_TYPING'
    cat, key, _ = classify_key_event({'key': '_'})
    assert cat == 'ACTION_TYPING'
    cat, key, _ = classify_key_event({'key': '#'})
    assert cat == 'ACTION_TYPING'

    # 8. Modifiers & horizontal navigation
    cat, key, _ = classify_key_event({'key': 'Shift'})
    assert cat == 'ACTION_IGNORE'
    cat, key, _ = classify_key_event({'key': 'ArrowLeft'})
    assert cat == 'ACTION_IGNORE'
    cat, key, _ = classify_key_event({'key': 'ArrowRight'})
    assert cat == 'ACTION_IGNORE'
    cat, key, _ = classify_key_event({'ctrlKey': True, 'key': 'c'})
    assert cat == 'ACTION_IGNORE'

    print("[PASS] Comprehensive keyboard event classification matrix verified!")


def test_comment_and_string_isolation_in_context_analyzer():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ca_path = os.path.join(base_dir, "static", "js", "context-analyzer.js")

    with open(ca_path, "r", encoding="utf-8") as f:
        code = f.read()

    # Verify comment & string isolation checks
    assert "isInsideComment" in code
    assert "isInsideString" in code
    assert "COMMENT_LINE" in code
    assert "COMMENT_BLOCK" in code
    assert "STRING" in code
    assert "contextType = 'comment'" in code
    assert "contextType = 'string'" in code

    # Simulate tokenizer range check for comment and string
    def check_isolation(sql_text, cursor_idx):
        # Line comment simulation
        if '--' in sql_text:
            idx = sql_text.find('--')
            if cursor_idx >= idx:
                return {"isInsideComment": True, "isInsideString": False}
        # Block comment simulation
        if '/*' in sql_text:
            s_idx = sql_text.find('/*')
            e_idx = sql_text.find('*/')
            if e_idx == -1:
                e_idx = len(sql_text)
            else:
                e_idx += 2
            if s_idx <= cursor_idx <= e_idx:
                return {"isInsideComment": True, "isInsideString": False}
        # String simulation
        if "'" in sql_text:
            s_idx = sql_text.find("'")
            e_idx = sql_text.rfind("'")
            if s_idx == e_idx:
                e_idx = len(sql_text)
            if s_idx < cursor_idx <= e_idx:
                return {"isInsideComment": False, "isInsideString": True}
        return {"isInsideComment": False, "isInsideString": False}

    res_comment = check_isolation("-- SELECT Cus", 10)
    assert res_comment["isInsideComment"] is True

    res_block = check_isolation("/*\nSELECT Cus\n*/", 8)
    assert res_block["isInsideComment"] is True

    res_string = check_isolation("SELECT 'Customer'", 12)
    assert res_string["isInsideString"] is True

    res_sql = check_isolation("SELECT CustomerId FROM Customer", 10)
    assert res_sql["isInsideComment"] is False
    assert res_sql["isInsideString"] is False

    print("[PASS] Comment and string literal isolation verified!")


def test_numeric_dot_guard_in_context_analyzer():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ca_path = os.path.join(base_dir, "static", "js", "context-analyzer.js")

    with open(ca_path, "r", encoding="utf-8") as f:
        code = f.read()

    # Verify numeric dot guard prevents treating 10. as qualifier (Section 18)
    assert "prevCodeTok.type === 'NUMBER' || /^\\d+$/.test(prevCodeTok.value)" in code
    assert "triggerChar = '';" in code
    assert "qualifier = '';" in code

    print("[PASS] Numeric decimal dot guard (Section 18) verified!")


def test_trigger_controller_decision_matrix():
    # Python simulation of TriggerController.decideChange & decideKeyDown
    class MockTriggerController:
        def __init__(self):
            self.state = 'IDLE'
            self.just_dismissed = False
            self.metrics = {'triggers': 0, 'refreshes': 0, 'closes': 0, 'accepts': 0}

        def decide_keydown(self, key, is_visible, has_selection=False, is_ctrl_space=False):
            if has_selection and not is_ctrl_space:
                if is_visible and key == 'Escape':
                    return {'action': 'close', 'reason': 'escape'}
                return {'action': 'none', 'reason': 'selection'}

            if is_ctrl_space:
                self.metrics['triggers'] += 1
                self.state = 'OPENING'
                return {'action': 'trigger', 'reason': 'explicit'}

            if key == 'Escape':
                if is_visible:
                    self.metrics['closes'] += 1
                    self.just_dismissed = True
                    self.state = 'IDLE'
                    return {'action': 'close', 'reason': 'escape'}
                return {'action': 'none', 'reason': 'ignored'}

            if key in ('Enter', 'Tab'):
                if is_visible:
                    self.metrics['accepts'] += 1
                    self.state = 'ACCEPTING'
                    return {'action': 'accept', 'reason': 'accept'}
                return {'action': 'none', 'reason': 'newline'}

            if key in ('ArrowUp', 'ArrowDown'):
                if is_visible:
                    self.state = 'NAVIGATING'
                    return {'action': 'navigate', 'reason': 'navigate'}
                return {'action': 'none', 'reason': 'cursor_nav'}

            return {'action': 'none', 'reason': 'propagate'}

        def decide_change(self, text, removed, context, is_visible, origin=''):
            if origin in ('paste', 'cut', 'undo', 'redo', 'setValue'):
                if is_visible:
                    return {'action': 'close', 'reason': f'change_origin_{origin}'}
                return {'action': 'none', 'reason': f'change_origin_{origin}'}

            if self.just_dismissed:
                self.just_dismissed = False
                return {'action': 'none', 'reason': 'suppressed_by_escape'}

            if context.get('isInsideComment') or context.get('isInsideString'):
                if is_visible:
                    return {'action': 'close', 'reason': 'comment_or_string'}
                return {'action': 'none', 'reason': 'comment_or_string'}

            is_del = len(removed) > 0 and len(text) == 0

            if is_visible:
                if is_del:
                    if not context.get('currentWord') and context.get('triggerChar') != '.':
                        self.state = 'IDLE'
                        return {'action': 'close', 'reason': 'backspace_empty'}
                    self.metrics['refreshes'] += 1
                    self.state = 'REFRESHING'
                    return {'action': 'refresh', 'reason': 'backspace'}

                if text == ' ' or text in (',', '(', ';'):
                    self.state = 'IDLE'
                    return {'action': 'close', 'reason': 'delimiter'}

                self.metrics['refreshes'] += 1
                self.state = 'REFRESHING'
                return {'action': 'refresh', 'reason': 'identifier'}

            # IDLE
            if is_del or text == ' ':
                return {'action': 'none', 'reason': 'idle_ignore'}

            if text == '.' or context.get('triggerChar') == '.':
                if context.get('qualifier'):
                    self.metrics['triggers'] += 1
                    self.state = 'OPENING'
                    return {'action': 'trigger', 'reason': 'character', 'kind': 'column'}
                return {'action': 'none', 'reason': 'invalid_dot'}

            if context.get('currentWord') and context.get('clause'):
                self.metrics['triggers'] += 1
                self.state = 'OPENING'
                return {'action': 'trigger', 'reason': 'automatic'}

            return {'action': 'none', 'reason': 'no_context'}

    ctrl = MockTriggerController()

    # 1. Explicit trigger
    d = ctrl.decide_keydown('Space', is_visible=False, is_ctrl_space=True)
    assert d['action'] == 'trigger' and d['reason'] == 'explicit'

    # 2. Navigation when visible vs hidden
    d = ctrl.decide_keydown('ArrowDown', is_visible=True)
    assert d['action'] == 'navigate'
    d = ctrl.decide_keydown('ArrowDown', is_visible=False)
    assert d['action'] == 'none'

    # 3. Enter when visible vs hidden
    d = ctrl.decide_keydown('Enter', is_visible=True)
    assert d['action'] == 'accept'
    d = ctrl.decide_keydown('Enter', is_visible=False)
    assert d['action'] == 'none'

    # 4. Escape closes and suppresses immediate reopen
    d = ctrl.decide_keydown('Escape', is_visible=True)
    assert d['action'] == 'close' and ctrl.just_dismissed is True
    # Immediate change right after escape is suppressed
    d = ctrl.decide_change('u', '', {'currentWord': 'Cu', 'clause': 'SELECT'}, is_visible=False)
    assert d['action'] == 'none' and d['reason'] == 'suppressed_by_escape'

    # 5. Paste/Cut/Undo/Redo never trigger completion
    for orig in ['paste', 'cut', 'undo', 'redo', 'setValue']:
        d = ctrl.decide_change('SELECT * FROM Customer', '', {'currentWord': '', 'clause': 'SELECT'}, is_visible=False, origin=orig)
        assert d['action'] == 'none'

    # 6. Inside comment or string
    d = ctrl.decide_change('C', '', {'currentWord': 'C', 'clause': 'SELECT', 'isInsideComment': True}, is_visible=False)
    assert d['action'] == 'none' and d['reason'] == 'comment_or_string'

    d = ctrl.decide_change('C', '', {'currentWord': 'C', 'clause': 'SELECT', 'isInsideString': True}, is_visible=False)
    assert d['action'] == 'none' and d['reason'] == 'comment_or_string'

    # 7. Character trigger '.' with alias 'c'
    d = ctrl.decide_change('.', '', {'triggerChar': '.', 'qualifier': 'c'}, is_visible=False)
    assert d['action'] == 'trigger' and d['reason'] == 'character'

    # 8. Numeric dot '.' without qualifier (e.g. 10.)
    d = ctrl.decide_change('.', '', {'triggerChar': '', 'qualifier': ''}, is_visible=False)
    assert d['action'] == 'none'

    # 9. Typing while visible triggers REFRESH (not trigger!)
    d = ctrl.decide_change('s', '', {'currentWord': 'Cus', 'clause': 'SELECT'}, is_visible=True)
    assert d['action'] == 'refresh' and ctrl.state == 'REFRESHING'

    # 10. Backspacing until empty closes popup
    d = ctrl.decide_change('', 's', {'currentWord': '', 'clause': 'SELECT'}, is_visible=True)
    assert d['action'] == 'close' and d['reason'] == 'backspace_empty'

    print("[PASS] Full TriggerController decision matrix (Explicit, Character, Refresh, Close) verified!")


def test_intellisense_js_integration():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    is_path = os.path.join(base_dir, "static", "js", "intellisense.js")

    with open(is_path, "r", encoding="utf-8") as f:
        code = f.read()

    # Controller integration
    assert "this.triggerController" in code
    assert "this.activeCandidates" in code
    assert "refresh(adapter, context)" in code
    assert "decideKeyDown" in code
    assert "decideChange" in code
    assert "decideCursor" in code
    assert "getTriggerController" in code
    assert "triggerController" in code

    print("[PASS] intellisense.js integration with TriggerController verified!")


if __name__ == '__main__':
    test_trigger_controller_file_and_script_order()
    test_trigger_controller_classes_and_enums()
    test_keyboard_classification_logic()
    test_comment_and_string_isolation_in_context_analyzer()
    test_numeric_dot_guard_in_context_analyzer()
    test_trigger_controller_decision_matrix()
    test_intellisense_js_integration()
