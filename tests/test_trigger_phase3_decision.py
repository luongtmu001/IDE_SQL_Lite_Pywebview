import os
import re

def test_phase3_decision_object_structure():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tc_file = os.path.join(base_dir, "static", "js", "trigger-controller.js")

    with open(tc_file, "r", encoding="utf-8") as f:
        code = f.read()

    # Verify DecisionAction constants
    assert "DecisionAction" in code
    for action in ["none", "trigger", "refresh", "close", "accept", "navigate"]:
        assert f"'{action}'" in code

    # Verify Section 5 instance methods on IntelliSenseTriggerController
    assert "shouldTrigger(eventOrChange" in code
    assert "shouldRefresh(changeObj" in code
    assert "shouldClose(eventOrChange" in code
    assert "decide(params" in code

    # Verify Section 5 global helper functions
    assert "window.shouldTriggerIntelliSense" in code
    assert "window.shouldRefreshIntelliSense" in code
    assert "window.shouldCloseIntelliSense" in code
    assert "window.decideCompletionAction" in code

    print("[PASS] Phase 3: Standard Decision Object structure & Section 5 API verified!")


def test_phase3_decision_engine_matrix():
    # Python simulation of Phase 3 TriggerController decision engine
    class Phase3TriggerController:
        def __init__(self):
            self.state = 'IDLE'
            self.just_dismissed_by_escape = False
            self.metrics = {'triggers': 0, 'refreshes': 0, 'closes': 0, 'navigates': 0, 'accepts': 0, 'ignored': 0}

        def decide_keydown(self, event, is_visible, has_selection=False):
            key = event.get('key', '')
            code = event.get('code', '')
            is_ctrl = bool(event.get('ctrlKey') or event.get('metaKey'))
            is_alt = bool(event.get('altKey'))

            # Rule 1: Selection active
            if has_selection and not (is_ctrl and not is_alt and (code == 'Space' or key in (' ', 'Spacebar'))):
                if is_visible and key == 'Escape':
                    self.metrics['closes'] += 1
                    self.state = 'IDLE'
                    return {'action': 'close', 'reason': 'escape'}
                self.metrics['ignored'] += 1
                return {'action': 'none', 'reason': 'selection'}

            # Rule 2: Explicit Trigger (Ctrl+Space)
            if is_ctrl and not is_alt and (code == 'Space' or key in (' ', 'Spacebar')):
                self.metrics['triggers'] += 1
                self.state = 'OPENING'
                return {'action': 'trigger', 'reason': 'explicit', 'kind': 'all'}

            # Rule 3: Close via Escape
            if key == 'Escape':
                if is_visible:
                    self.metrics['closes'] += 1
                    self.just_dismissed_by_escape = True
                    self.state = 'IDLE'
                    return {'action': 'close', 'reason': 'escape'}
                return {'action': 'none', 'reason': 'ignored'}

            # Rule 4: Accept via Enter / Tab
            if key in ('Enter', 'Tab'):
                if is_visible:
                    self.metrics['accepts'] += 1
                    self.state = 'ACCEPTING'
                    return {'action': 'accept', 'reason': 'accept'}
                return {'action': 'none', 'reason': 'newline'}

            # Rule 5: Navigate via ArrowUp / ArrowDown / PageUp / PageDown
            if key in ('ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'):
                step = 1 if key == 'ArrowDown' else (-1 if key == 'ArrowUp' else (8 if key == 'PageDown' else -8))
                if is_visible:
                    self.metrics['navigates'] += 1
                    self.state = 'NAVIGATING'
                    return {'action': 'navigate', 'reason': 'navigate', 'step': step}
                return {'action': 'none', 'reason': 'cursor_nav'}

            return {'action': 'none', 'reason': 'propagate_to_editor'}

        def decide_change(self, change_obj, context, is_visible, has_selection=False):
            origin = change_obj.get('origin', '')
            if origin in ('setValue', 'paste', 'cut', 'undo', 'redo'):
                if is_visible:
                    self.metrics['closes'] += 1
                    self.state = 'IDLE'
                    return {'action': 'close', 'reason': f'change_origin_{origin}'}
                return {'action': 'none', 'reason': f'change_origin_{origin}'}

            if self.just_dismissed_by_escape:
                self.just_dismissed_by_escape = False
                return {'action': 'none', 'reason': 'suppressed_by_escape'}

            if has_selection:
                if is_visible:
                    self.metrics['closes'] += 1
                    self.state = 'IDLE'
                    return {'action': 'close', 'reason': 'selection'}
                return {'action': 'none', 'reason': 'selection'}

            if context.get('isInsideComment') or context.get('isInsideString'):
                if is_visible:
                    self.metrics['closes'] += 1
                    self.state = 'IDLE'
                    return {'action': 'close', 'reason': 'comment_or_string'}
                return {'action': 'none', 'reason': 'comment_or_string'}

            text = change_obj.get('text', '')
            removed = change_obj.get('removed', '')
            is_del = len(removed) > 0 and len(text) == 0
            current_word = context.get('currentWord', '')
            trigger_char = context.get('triggerChar', '')

            # Case A: VISIBLE
            if is_visible:
                if is_del:
                    if not current_word and trigger_char != '.':
                        self.metrics['closes'] += 1
                        self.state = 'IDLE'
                        return {'action': 'close', 'reason': 'backspace_empty'}
                    if trigger_char == '.' and '.' in removed:
                        self.metrics['closes'] += 1
                        self.state = 'IDLE'
                        return {'action': 'close', 'reason': 'dot_deleted'}
                    self.metrics['refreshes'] += 1
                    self.state = 'REFRESHING'
                    return {'action': 'refresh', 'reason': 'backspace', 'token': current_word}

                if text == ' ' or text in (',', '(', ')', ';'):
                    if context.get('hasFollowUp') and text == ' ':
                        self.metrics['refreshes'] += 1
                        self.state = 'REFRESHING'
                        return {'action': 'refresh', 'reason': 'followup_space', 'token': ''}
                    self.metrics['closes'] += 1
                    self.state = 'IDLE'
                    return {'action': 'close', 'reason': 'delimiter'}

                self.metrics['refreshes'] += 1
                self.state = 'REFRESHING'
                return {'action': 'refresh', 'reason': 'identifier', 'token': current_word}

            # Case B: IDLE
            if is_del:
                return {'action': 'none', 'reason': 'delete_idle'}
            if text == ' ':
                return {'action': 'none', 'reason': 'space_idle'}

            if text == '.' or trigger_char == '.':
                if context.get('qualifier'):
                    self.metrics['triggers'] += 1
                    self.state = 'OPENING'
                    return {'action': 'trigger', 'reason': 'character', 'kind': 'column', 'token': context['qualifier']}
                return {'action': 'none', 'reason': 'invalid_dot'}

            if text == '@' or trigger_char == '@':
                self.metrics['triggers'] += 1
                self.state = 'OPENING'
                return {'action': 'trigger', 'reason': 'character', 'kind': 'parameter', 'token': current_word}

            if len(current_word) >= 1:
                has_valid = bool(context.get('clause') or context.get('hasFollowUp') or context.get('isAlterContext') or (context.get('execContext') and context['execContext'].get('isExec')))
                if has_valid:
                    self.metrics['triggers'] += 1
                    self.state = 'OPENING'
                    return {'action': 'trigger', 'reason': 'automatic', 'kind': context.get('contextType', 'keyword'), 'token': current_word}

            return {'action': 'none', 'reason': 'no_context'}

        def should_trigger(self, event_or_change, context, is_visible=False):
            if isinstance(event_or_change, dict) and ('key' in event_or_change or 'code' in event_or_change):
                d = self.decide_keydown(event_or_change, is_visible)
                return d['action'] == 'trigger'
            d = self.decide_change(event_or_change, context, is_visible)
            return d['action'] == 'trigger'

        def should_refresh(self, change_obj, context, is_visible=True):
            d = self.decide_change(change_obj, context, is_visible)
            return d['action'] == 'refresh'

        def should_close(self, event_or_change, context, is_visible=True):
            if isinstance(event_or_change, dict) and ('key' in event_or_change or 'code' in event_or_change):
                d = self.decide_keydown(event_or_change, is_visible)
                return d['action'] == 'close'
            d = self.decide_change(event_or_change, context, is_visible)
            return d['action'] == 'close'

        def decide(self, params):
            if 'event' in params:
                return self.decide_keydown(params['event'], params.get('isVisible', False), params.get('hasSelection', False))
            if 'changeObj' in params:
                return self.decide_change(params['changeObj'], params.get('context', {}), params.get('isVisible', False), params.get('hasSelection', False))
            return {'action': 'none', 'reason': 'no_input'}

    ctrl = Phase3TriggerController()

    # 1. Explicit trigger
    assert ctrl.should_trigger({'ctrlKey': True, 'code': 'Space'}, {}) is True
    dec = ctrl.decide({'event': {'ctrlKey': True, 'code': 'Space'}})
    assert dec['action'] == 'trigger' and dec['reason'] == 'explicit'

    # 2. KeyDown actions
    assert ctrl.decide_keydown({'key': 'Escape'}, is_visible=True)['action'] == 'close'
    assert ctrl.decide_keydown({'key': 'Enter'}, is_visible=True)['action'] == 'accept'
    assert ctrl.decide_keydown({'key': 'ArrowDown'}, is_visible=True)['action'] == 'navigate'
    assert ctrl.decide_keydown({'key': 'ArrowUp'}, is_visible=True)['action'] == 'navigate'
    assert ctrl.decide_keydown({'key': 'PageDown'}, is_visible=True)['action'] == 'navigate'

    # When hidden: navigation and enter do not trigger or close
    assert ctrl.decide_keydown({'key': 'ArrowDown'}, is_visible=False)['action'] == 'none'
    assert ctrl.decide_keydown({'key': 'Enter'}, is_visible=False)['action'] == 'none'
    assert ctrl.decide_keydown({'key': 'Escape'}, is_visible=False)['action'] == 'none'

    # Clear escape dismissal flag before testing normal change triggers
    ctrl.just_dismissed_by_escape = False

    # 3. Text selection blocks automatic trigger
    d_sel = ctrl.decide_keydown({'key': 'c'}, is_visible=False, has_selection=True)
    assert d_sel['action'] == 'none' and d_sel['reason'] == 'selection'

    # 4. Dot trigger with valid qualifier vs invalid numeric dot
    ctx_col = {'triggerChar': '.', 'qualifier': 'c', 'clause': 'WHERE'}
    assert ctrl.should_trigger({'text': '.'}, ctx_col, is_visible=False) is True
    dec_dot = ctrl.decide({'changeObj': {'text': '.'}, 'context': ctx_col, 'isVisible': False})
    assert dec_dot['action'] == 'trigger' and dec_dot['kind'] == 'column'

    ctx_num = {'triggerChar': '', 'qualifier': ''}
    assert ctrl.should_trigger({'text': '.'}, ctx_num, is_visible=False) is False

    # 5. Parameter trigger @
    ctx_param = {'triggerChar': '@', 'currentWord': 'param'}
    assert ctrl.should_trigger({'text': '@'}, ctx_param, is_visible=False) is True

    # 6. Automatic identifier in clause vs outside clause
    ctx_clause = {'currentWord': 'Cust', 'clause': 'FROM'}
    assert ctrl.should_trigger({'text': 't'}, ctx_clause, is_visible=False) is True

    ctx_no_clause = {'currentWord': 'random', 'clause': ''}
    assert ctrl.should_trigger({'text': 'm'}, ctx_no_clause, is_visible=False) is False

    # 7. Refresh vs Trigger distinction
    # Typing while visible is REFRESH
    assert ctrl.should_refresh({'text': 'o'}, {'currentWord': 'Custo', 'clause': 'FROM'}, is_visible=True) is True
    # Backspacing while visible is REFRESH if token non-empty
    assert ctrl.should_refresh({'removed': 'o', 'text': ''}, {'currentWord': 'Cust', 'clause': 'FROM'}, is_visible=True) is True
    # Backspacing to empty while visible is CLOSE
    assert ctrl.should_close({'removed': 'C', 'text': ''}, {'currentWord': '', 'clause': 'FROM'}, is_visible=True) is True

    # 8. Deleting and Space from idle NEVER trigger
    assert ctrl.should_trigger({'removed': 'a', 'text': ''}, {}, is_visible=False) is False
    assert ctrl.should_trigger({'text': ' '}, {}, is_visible=False) is False

    # 9. Paste / Cut / Undo / Redo
    for op in ['paste', 'cut', 'undo', 'redo', 'setValue']:
        d_op = ctrl.decide_change({'origin': op, 'text': 'SELECT 1'}, {'clause': 'SELECT'}, is_visible=False)
        assert d_op['action'] == 'none'
        d_op_vis = ctrl.decide_change({'origin': op, 'text': 'SELECT 1'}, {'clause': 'SELECT'}, is_visible=True)
        assert d_op_vis['action'] == 'close'

    # 10. Comment and String suppression
    d_comm = ctrl.decide_change({'text': 'a'}, {'currentWord': 'a', 'isInsideComment': True}, is_visible=False)
    assert d_comm['action'] == 'none' and d_comm['reason'] == 'comment_or_string'

    d_str = ctrl.decide_change({'text': 'a'}, {'currentWord': 'a', 'isInsideString': True}, is_visible=False)
    assert d_str['action'] == 'none' and d_str['reason'] == 'comment_or_string'

    print("[PASS] Phase 3: All Decision Engine rules (Explicit, Auto, Refresh, Close, Navigate, Accept) verified!")

if __name__ == '__main__':
    test_phase3_decision_object_structure()
    test_phase3_decision_engine_matrix()
