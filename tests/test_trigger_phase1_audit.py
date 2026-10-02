import os

def test_phase1_audit_deliverables():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    audit_file = os.path.join(base_dir, ".SKILL", "audit_phase1_keyboard_trigger.md")

    assert os.path.exists(audit_file), "audit_phase1_keyboard_trigger.md must exist in .SKILL/"

    with open(audit_file, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Event Map
    assert "IntelliSense Event Map" in content
    assert "editor-adapter.js" in content
    assert "context-analyzer.js" in content
    assert "trigger-controller.js" in content
    assert "intellisense.js" in content

    # 2. Trigger Map
    assert "Trigger Map" in content
    assert "Ctrl + Space" in content
    assert "TRIGGER_EXPLICIT" in content or "explicit" in content
    assert "TRIGGER_CHAR" in content or "character" in content
    assert "ACTION_NAVIGATE" in content or "navigate" in content
    assert "ACTION_ACCEPT" in content or "accept" in content
    assert "ACTION_CLOSE" in content or "escape" in content
    assert "ACTION_BACKSPACE" in content or "backspace" in content
    assert "ACTION_DELETE" in content or "delete" in content
    assert "ACTION_TYPING" in content or "identifier" in content
    assert "ACTION_DELIMITER" in content or "delimiter" in content

    # 3. Provider Map
    assert "Provider Map" in content
    assert "SqlContextAnalyzer" in content
    assert "CompletionEngine" in content
    assert "AppMetadataCache" in content

    # 4. Popup Lifecycle Map
    assert "Popup Lifecycle Map" in content
    assert "OPENING" in content
    assert "VISIBLE" in content
    assert "REFRESHING" in content
    assert "NAVIGATING" in content
    assert "ACCEPTING" in content
    assert "IDLE" in content

    # 5. Metadata Request Flow Map
    assert "Metadata Request Flow Map" in content
    assert "Giảm 100% request DB" in content

    print("[PASS] Phase 1 Audit: Event Map, Trigger Map, Provider Map, Lifecycle Map, and Request Flow verified!")


def test_phase1_code_invariants():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tc_file = os.path.join(base_dir, "static", "js", "trigger-controller.js")
    adapter_file = os.path.join(base_dir, "static", "js", "editor-adapter.js")
    ca_file = os.path.join(base_dir, "static", "js", "context-analyzer.js")
    is_file = os.path.join(base_dir, "static", "js", "intellisense.js")

    with open(tc_file, "r", encoding="utf-8") as f:
        tc_code = f.read()
    with open(adapter_file, "r", encoding="utf-8") as f:
        adapter_code = f.read()
    with open(ca_file, "r", encoding="utf-8") as f:
        ca_code = f.read()
    with open(is_file, "r", encoding="utf-8") as f:
        is_code = f.read()

    # Invariants in editor-adapter
    assert "hasSelection()" in adapter_code

    # Invariants in context-analyzer
    assert "isInsideComment" in ca_code
    assert "isInsideString" in ca_code
    assert "prevCodeTok.type === 'NUMBER' || /^\\d+$/.test(prevCodeTok.value)" in ca_code

    # Invariants in trigger-controller
    assert "CompletionState" in tc_code
    assert "KeyCategory" in tc_code
    assert "DecisionAction" in tc_code

    # Invariants in intellisense.js
    assert "this.triggerController" in is_code
    assert "refresh(adapter, context)" in is_code
    assert "getTriggerController" in is_code

    print("[PASS] Phase 1 Code Invariants: Selection check, Comment/String isolation, Dot guard, and Trigger Controller wiring verified!")

if __name__ == '__main__':
    test_phase1_audit_deliverables()
    test_phase1_code_invariants()
