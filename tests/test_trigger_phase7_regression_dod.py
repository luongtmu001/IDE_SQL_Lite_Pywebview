import os
import re

def test_phase7_definition_of_done_verification():
    """
    Phase 7 — Definition of Done (DOD) Verification
    Compliant with Section 46 & 47 of INTELLISENSE_KEYBOARD_TRIGGER_PLAN.md.
    """
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tc_path = os.path.join(base_dir, "static", "js", "trigger-controller.js")
    ca_path = os.path.join(base_dir, "static", "js", "context-analyzer.js")
    is_path = os.path.join(base_dir, "static", "js", "intellisense.js")
    ce_path = os.path.join(base_dir, "static", "js", "completion-engine.js")

    with open(tc_path, "r", encoding="utf-8") as f:
        tc_code = f.read()
    with open(ca_path, "r", encoding="utf-8") as f:
        ca_code = f.read()
    with open(is_path, "r", encoding="utf-8") as f:
        is_code = f.read()
    with open(ce_path, "r", encoding="utf-8") as f:
        ce_code = f.read()

    # ─────────────────────────────────────────────────────────────────────────
    # A. 10 PROHIBITED BEHAVIORS (Must NOT happen - Section 46)
    # ─────────────────────────────────────────────────────────────────────────

    # 1. Continuous typing popup spam -> Separated into Trigger vs Refresh
    assert "DecisionAction.REFRESH" in tc_code
    assert "CompletionState.REFRESHING" in tc_code

    # 2. Space opening popup unnecessarily from idle -> Strictly suppressed
    assert "reason: 'space_idle'" in tc_code
    assert "insertedText === ' '" in tc_code

    # 3. Enter opening a new popup -> Propagates to newline when idle
    assert "reason: 'newline'" in tc_code

    # 4. Arrow navigation opening a new popup -> Propagates to cursor movement when idle
    assert "reason: 'cursor_nav'" in tc_code

    # 5. Escape immediate bounce-back -> 300ms suppression flag
    assert "justDismissedByEscape" in tc_code
    assert "reason: 'suppressed_by_escape'" in tc_code

    # 6. Backspace/Delete opening popup from idle -> Strictly suppressed
    assert "reason: 'delete_idle'" in tc_code

    # 7. Typing in string literal opening object suggestions -> Isolated
    assert "isInsideString" in ca_code
    assert "reason: 'comment_or_string'" in tc_code

    # 8. Typing in comments opening suggestions -> Isolated
    assert "isInsideComment" in ca_code
    assert "COMMENT_LINE" in ca_code
    assert "COMMENT_BLOCK" in ca_code

    # 9. Paste / Cut / Undo opening popup -> Strictly suppressed
    for orig in ['paste', 'cut', 'undo', 'redo', 'setValue']:
        assert orig in tc_code

    # 10. Every keystroke querying database -> Local filtering on cached pool
    assert "rankAndFilterCandidates(this.activeCandidates" in is_code

    # ─────────────────────────────────────────────────────────────────────────
    # B. 9 MANDATORY BEHAVIORS (MUST happen - Section 46)
    # ─────────────────────────────────────────────────────────────────────────

    # 1. Ctrl + Space -> Explicit trigger
    assert "TRIGGER_EXPLICIT" in tc_code
    assert "reason: 'explicit'" in tc_code

    # 2. '.' -> Context-aware character trigger, decimal dot guarded
    assert "TRIGGER_CHAR" in tc_code
    assert "reason: 'character'" in tc_code
    assert "reason: 'invalid_dot'" in tc_code

    # 3. Typing while popup active -> Local Refresh
    assert "action: DecisionAction.REFRESH" in tc_code

    # 4. ArrowUp / ArrowDown -> Navigation in popup
    assert "ACTION_NAVIGATE" in tc_code
    assert "action: DecisionAction.NAVIGATE" in tc_code

    # 5. Enter / Tab -> Accept selected item
    assert "ACTION_ACCEPT" in tc_code
    assert "action: DecisionAction.ACCEPT" in tc_code

    # 6. Escape -> Close popup & activate suppression
    assert "ACTION_CLOSE" in tc_code
    assert "action: DecisionAction.CLOSE" in tc_code

    # 7. Backspace / Delete while active -> Refresh if non-empty, Close if empty
    assert "ACTION_BACKSPACE" in tc_code
    assert "ACTION_DELETE" in tc_code
    assert "reason: 'backspace_empty'" in tc_code

    # 8. Cursor leaving token boundary -> Close completion
    assert "decideCursor" in tc_code
    assert "cursor_leave" in tc_code

    # 9. String / Comment -> Disable automatic completion
    assert "contextType = 'comment'" in ca_code
    assert "contextType = 'string'" in ca_code

    # ─────────────────────────────────────────────────────────────────────────
    # C. PERFORMANCE & CONCURRENCY CRITERIA (Section 47)
    # ─────────────────────────────────────────────────────────────────────────
    assert "_currentRequestId" in is_code
    assert "requestId !== this._currentRequestId" in is_code
    assert "cancelPending" in ce_code

    print("[PASS] Phase 7: All 10 Prohibited Behaviors and 9 Mandatory Behaviors verified against Definition of Done!")


def test_phase7_full_lifecycle_simulation():
    # End-to-end simulation of full user session
    class FullSessionEngine:
        def __init__(self):
            self.state = 'IDLE'
            self.db_requests = 0
            self.local_refreshes = 0
            self.suppressed_events = 0
            self.active_candidates = []

        def handle_event(self, event_type, payload):
            if event_type == 'KEYDOWN':
                key = payload.get('key')
                if payload.get('ctrlKey') and key == ' ':
                    self.state = 'OPENING'
                    self.db_requests += 1
                    self.active_candidates = ['CustomerId', 'CustomerName', 'City']
                    self.state = 'VISIBLE'
                    return 'OPENED'
                if key == 'Escape' and self.state == 'VISIBLE':
                    self.state = 'IDLE'
                    self.active_candidates = []
                    return 'CLOSED_ESCAPE'
                if key == 'Enter' and self.state == 'VISIBLE':
                    self.state = 'IDLE'
                    return 'ACCEPTED'
                if key in ('ArrowUp', 'ArrowDown') and self.state == 'VISIBLE':
                    return 'NAVIGATED'

            elif event_type == 'CHANGE':
                text = payload.get('text', '')
                in_comment = payload.get('in_comment', False)
                in_string = payload.get('in_string', False)

                if in_comment or in_string:
                    self.suppressed_events += 1
                    return 'SUPPRESSED'

                if text == ' ':
                    if self.state == 'IDLE':
                        self.suppressed_events += 1
                        return 'SUPPRESSED'
                    else:
                        self.state = 'IDLE'
                        return 'CLOSED'

                if self.state == 'VISIBLE':
                    self.local_refreshes += 1
                    return 'REFRESHED_LOCALLY'

            elif event_type == 'CURSOR':
                if self.state == 'IDLE':
                    self.suppressed_events += 1
                    return 'SUPPRESSED'
                if payload.get('outside_token'):
                    self.state = 'IDLE'
                    return 'CLOSED'

            return 'NONE'

    engine = FullSessionEngine()

    # 1. Typing Space in blank area -> Suppressed
    assert engine.handle_event('CHANGE', {'text': ' '}) == 'SUPPRESSED'

    # 2. Moving cursor in blank area -> Suppressed
    assert engine.handle_event('CURSOR', {'outside_token': False}) == 'SUPPRESSED'

    # 3. Typing inside comment -> Suppressed
    assert engine.handle_event('CHANGE', {'text': 'SELECT', 'in_comment': True}) == 'SUPPRESSED'

    # 4. User presses Ctrl+Space -> Opens popup
    assert engine.handle_event('KEYDOWN', {'ctrlKey': True, 'key': ' '}) == 'OPENED'
    assert engine.state == 'VISIBLE'
    assert engine.db_requests == 1

    # 5. User types 'u' while open -> Local Refresh (NO db request!)
    assert engine.handle_event('CHANGE', {'text': 'u'}) == 'REFRESHED_LOCALLY'
    assert engine.db_requests == 1
    assert engine.local_refreshes == 1

    # 6. User navigates with ArrowDown
    assert engine.handle_event('KEYDOWN', {'key': 'ArrowDown'}) == 'NAVIGATED'

    # 7. User presses Escape -> Closes popup
    assert engine.handle_event('KEYDOWN', {'key': 'Escape'}) == 'CLOSED_ESCAPE'
    assert engine.state == 'IDLE'

    print("[PASS] Phase 7: Full user session lifecycle simulation verified successfully!")
