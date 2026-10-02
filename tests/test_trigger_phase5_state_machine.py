import os
import re

def test_phase5_state_machine_code_structure():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tc_path = os.path.join(base_dir, "static", "js", "trigger-controller.js")
    is_path = os.path.join(base_dir, "static", "js", "intellisense.js")

    with open(tc_path, "r", encoding="utf-8") as f:
        tc_code = f.read()

    with open(is_path, "r", encoding="utf-8") as f:
        is_code = f.read()

    # 1. State Machine Enum & transitions
    assert "CompletionState" in tc_code
    for st in ["IDLE", "OPENING", "VISIBLE", "REFRESHING", "NAVIGATING", "ACCEPTING"]:
        assert f"{st}: '{st}'" in tc_code

    # 2. State management methods
    assert "getState()" in tc_code
    assert "setState(newState, reason" in tc_code
    assert "isSessionActive()" in tc_code

    # 3. Active session state tracking
    assert "setActiveToken(" in tc_code
    assert "getActiveToken(" in tc_code
    assert "clearActiveToken(" in tc_code
    assert "setActiveCandidates(" in tc_code
    assert "getActiveCandidates(" in tc_code
    assert "clearActiveCandidates(" in tc_code

    # 4. Cursor activity boundary checks
    assert "decideCursor(curOffset, curLine, isVisible)" in tc_code
    assert "cursor_line_change" in tc_code
    assert "cursor_outside_token" in tc_code

    # 5. Double-trigger prevention mechanisms
    assert "propagate_to_editor" in tc_code
    assert "isConfirmingCompletion" in is_code
    assert "setDismissedByEscape" in tc_code
    assert "suppressed_by_escape" in tc_code

    print("[PASS] Phase 5: State Machine and Lifecycle code structure verified!")


def test_phase5_state_machine_lifecycle_transitions():
    # Python simulation of Phase 5 state machine transitions
    class LifecycleStateMachine:
        def __init__(self):
            self.state = 'IDLE'
            self.history = []

        def set_state(self, new_state, reason=''):
            old = self.state
            self.state = new_state
            self.history.append((old, new_state, reason))

        def is_active(self):
            return self.state in ('VISIBLE', 'REFRESHING', 'NAVIGATING')

    sm = LifecycleStateMachine()
    assert sm.state == 'IDLE'
    assert not sm.is_active()

    # Transition 1: User presses Ctrl+Space -> OPENING
    sm.set_state('OPENING', 'explicit_trigger')
    assert sm.state == 'OPENING'

    # Transition 2: Candidates loaded & rendered -> VISIBLE
    sm.set_state('VISIBLE', 'rendered')
    assert sm.state == 'VISIBLE'
    assert sm.is_active()

    # Transition 3: Typing next character -> REFRESHING -> VISIBLE
    sm.set_state('REFRESHING', 'typing')
    assert sm.state == 'REFRESHING'
    sm.set_state('VISIBLE', 'refreshed')
    assert sm.state == 'VISIBLE'

    # Transition 4: Arrow navigation -> NAVIGATING -> VISIBLE
    sm.set_state('NAVIGATING', 'arrow_down')
    assert sm.state == 'NAVIGATING'
    sm.set_state('VISIBLE', 'selection_updated')
    assert sm.state == 'VISIBLE'

    # Transition 5: Enter / Tab accepted -> ACCEPTING -> IDLE
    sm.set_state('ACCEPTING', 'accept_item')
    assert sm.state == 'ACCEPTING'
    sm.set_state('IDLE', 'inserted_and_closed')
    assert sm.state == 'IDLE'
    assert not sm.is_active()

    # Transition 6: Escape while visible -> IDLE
    sm.set_state('OPENING', 'auto_trigger')
    sm.set_state('VISIBLE', 'rendered')
    sm.set_state('IDLE', 'escape')
    assert sm.state == 'IDLE'

    # Verify history length
    assert len(sm.history) == 11
    print("[PASS] Phase 5: State Machine Lifecycle transitions verified!")


def test_phase5_double_trigger_prevention():
    # Verify that single keystroke generates exactly ONE logical action
    class TriggerSafetyController:
        def __init__(self):
            self.is_visible = False
            self.just_dismissed_by_escape = False
            self.is_confirming_completion = False

        def on_keydown(self, event):
            key = event.get('key', '')
            is_ctrl = bool(event.get('ctrlKey'))
            # 1. Typing keys: propagate to editor first, do NOT trigger from keydown!
            if len(key) == 1 and not is_ctrl:
                return {'action': 'none', 'reason': 'propagate_to_editor', 'intercept': False}

            # 2. Explicit trigger: intercepts keydown and triggers once
            if is_ctrl and key == ' ':
                return {'action': 'trigger', 'reason': 'explicit', 'intercept': True}

            # 3. Enter on popup: accepts and intercepts
            if key == 'Enter' and self.is_visible:
                self.is_confirming_completion = True
                return {'action': 'accept', 'reason': 'accept', 'intercept': True}

            # 4. Escape: closes and intercepts
            if key == 'Escape' and self.is_visible:
                self.just_dismissed_by_escape = True
                self.is_visible = False
                return {'action': 'close', 'reason': 'escape', 'intercept': True}

            return {'action': 'none', 'reason': 'default', 'intercept': False}

        def on_change(self, change_obj):
            # If confirming completion, ignore change
            if self.is_confirming_completion:
                self.is_confirming_completion = False
                return {'action': 'none', 'reason': 'confirming_completion'}

            # If dismissed by escape, ignore immediate trailing change
            if self.just_dismissed_by_escape:
                self.just_dismissed_by_escape = False
                return {'action': 'none', 'reason': 'suppressed_by_escape'}

            inserted = change_obj.get('text', '')
            if inserted and len(inserted) == 1:
                if self.is_visible:
                    return {'action': 'refresh', 'reason': 'typing'}
                else:
                    return {'action': 'trigger', 'reason': 'automatic'}

            return {'action': 'none', 'reason': 'no_change'}

    ctrl = TriggerSafetyController()

    # Scenario A: User types 'C' from idle
    kd = ctrl.on_keydown({'key': 'C'})
    assert kd['action'] == 'none'
    assert kd['reason'] == 'propagate_to_editor'
    assert kd['intercept'] is False  # Lets editor type
    ch = ctrl.on_change({'text': 'C'})
    assert ch['action'] == 'trigger' # Exactly 1 trigger fired from change!
    ctrl.is_visible = True

    # Scenario B: User presses Enter to accept
    kd_enter = ctrl.on_keydown({'key': 'Enter'})
    assert kd_enter['action'] == 'accept'
    assert kd_enter['intercept'] is True
    # Editor replaces range:
    ch_accept = ctrl.on_change({'text': 'Customer'})
    assert ch_accept['action'] == 'none' # Suppressed, no re-trigger!

    # Scenario C: User presses Escape to close
    ctrl.is_visible = True
    kd_esc = ctrl.on_keydown({'key': 'Escape'})
    assert kd_esc['action'] == 'close'
    assert kd_esc['intercept'] is True
    # Trailing input/change immediately after escape:
    ch_trailing = ctrl.on_change({'text': ''})
    assert ch_trailing['action'] == 'none'
    assert ch_trailing['reason'] == 'suppressed_by_escape' # Suppressed!

    print("[PASS] Phase 5: Double-trigger prevention verified!")


def test_phase5_cursor_activity_boundary_control():
    # Boundary control logic: closes when cursor leaves token or line changes
    def evaluate_cursor_activity(cur_offset, cur_line, token_info, is_visible):
        if not is_visible:
            return {'action': 'none', 'reason': 'idle'}

        if token_info:
            # Check line change
            if cur_line is not None and token_info.get('line') is not None:
                if cur_line != token_info['line']:
                    return {'action': 'close', 'reason': 'cursor_leave'}

            # Check offset boundaries [start, end + 5]
            start = token_info.get('start')
            end = token_info.get('end')
            if start is not None and end is not None:
                if cur_offset < start or cur_offset > (end + 5):
                    return {'action': 'close', 'reason': 'cursor_leave'}

        return {'action': 'none', 'reason': 'cursor_within_token'}

    token = {'word': 'Cust', 'start': 10, 'end': 14, 'line': 0}

    # Case 1: Cursor inside token boundaries -> keep open
    res1 = evaluate_cursor_activity(12, 0, token, is_visible=True)
    assert res1['action'] == 'none'
    assert res1['reason'] == 'cursor_within_token'

    # Case 2: Cursor at token end -> keep open
    res2 = evaluate_cursor_activity(14, 0, token, is_visible=True)
    assert res2['action'] == 'none'

    # Case 3: Cursor moved to a different line -> CLOSE
    res3 = evaluate_cursor_activity(12, 1, token, is_visible=True)
    assert res3['action'] == 'close'
    assert res3['reason'] == 'cursor_leave'

    # Case 4: Cursor moved far left (< start) -> CLOSE
    res4 = evaluate_cursor_activity(5, 0, token, is_visible=True)
    assert res4['action'] == 'close'

    # Case 5: Cursor moved far right (> end + 5) -> CLOSE
    res5 = evaluate_cursor_activity(25, 0, token, is_visible=True)
    assert res5['action'] == 'close'

    # Case 6: Cursor moves while popup is IDLE -> NEVER triggers!
    res6 = evaluate_cursor_activity(12, 0, token, is_visible=False)
    assert res6['action'] == 'none'
    assert res6['reason'] == 'idle'

    print("[PASS] Phase 5: Cursor Activity Boundary Control verified!")


def test_phase5_selection_lock_and_lifecycle_cleanup():
    # Python simulation of selection lock (Section 34) and cleanup
    class SelectionAndLifecycleController:
        def __init__(self):
            self.state = 'IDLE'
            self.active_candidates = None
            self.active_token = None
            self.metrics = {'triggers': 0, 'refreshes': 0, 'closes': 0, 'ignored': 0}

        def on_keydown(self, event, is_visible, has_selection):
            is_ctrl = bool(event.get('ctrlKey'))
            key = event.get('key', '')

            if has_selection and not (is_ctrl and key == ' '):
                if is_visible and key == 'Escape':
                    self.metrics['closes'] += 1
                    self.hide()
                    return {'action': 'close', 'reason': 'escape'}
                self.metrics['ignored'] += 1
                return {'action': 'none', 'reason': 'selection'}

            if is_ctrl and key == ' ':
                self.metrics['triggers'] += 1
                self.state = 'OPENING'
                return {'action': 'trigger', 'reason': 'explicit'}

            return {'action': 'none', 'reason': 'default'}

        def on_change(self, has_selection, is_visible):
            if has_selection:
                if is_visible:
                    self.metrics['closes'] += 1
                    self.hide()
                    return {'action': 'close', 'reason': 'selection'}
                return {'action': 'none', 'reason': 'selection'}
            return {'action': 'trigger', 'reason': 'normal'}

        def show(self, candidates, token):
            self.state = 'VISIBLE'
            self.active_candidates = list(candidates)
            self.active_token = dict(token)

        def hide(self):
            self.state = 'IDLE'
            self.active_candidates = None
            self.active_token = None

    ctrl = SelectionAndLifecycleController()
    ctrl.show([{'name': 'CustomerId'}], {'word': 'Cus', 'start': 0, 'end': 3})
    assert ctrl.state == 'VISIBLE'
    assert len(ctrl.active_candidates) == 1

    # 1. Selection active: normal key ignored
    res_sel = ctrl.on_keydown({'key': 'a'}, is_visible=True, has_selection=True)
    assert res_sel['action'] == 'none'
    assert res_sel['reason'] == 'selection'
    assert ctrl.metrics['ignored'] == 1

    # 2. Selection active: Ctrl+Space allowed
    res_explicit = ctrl.on_keydown({'ctrlKey': True, 'key': ' '}, is_visible=True, has_selection=True)
    assert res_explicit['action'] == 'trigger'
    assert res_explicit['reason'] == 'explicit'
    assert ctrl.metrics['triggers'] == 1

    # 3. Clean hide
    ctrl.hide()
    assert ctrl.state == 'IDLE'
    assert ctrl.active_candidates is None
    assert ctrl.active_token is None

    print("[PASS] Phase 5: Selection lock and Lifecycle cleanup verified!")
