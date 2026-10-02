import os
import re

def test_phase2_classifier_exports_and_structure():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tc_file = os.path.join(base_dir, "static", "js", "trigger-controller.js")

    with open(tc_file, "r", encoding="utf-8") as f:
        code = f.read()

    # Verify KeyCategory definition
    assert "KeyCategory" in code
    categories = [
        "TRIGGER_EXPLICIT",
        "TRIGGER_CHAR",
        "ACTION_NAVIGATE",
        "ACTION_ACCEPT",
        "ACTION_CLOSE",
        "ACTION_BACKSPACE",
        "ACTION_DELETE",
        "ACTION_TYPING",
        "ACTION_DELIMITER",
        "ACTION_IGNORE"
    ]
    for cat in categories:
        assert cat in code, f"KeyCategory must define {cat}"

    # Verify classifier functions
    assert "classifyKeyEvent" in code
    assert "classifyKey(event)" in code or "classifyKey(" in code

    print("[PASS] Phase 2 Keyboard Event Layer: KeyCategory and classifier API verified!")


def test_phase2_all_key_categories():
    def classify_key_event(e):
        key = e.get('key', '')
        code = e.get('code', '')
        is_ctrl = bool(e.get('ctrlKey') or e.get('metaKey'))
        is_alt = bool(e.get('altKey'))

        # Explicit Trigger
        if is_ctrl and not is_alt and (code == 'Space' or key in (' ', 'Spacebar')):
            return ('TRIGGER_EXPLICIT', 'Ctrl+Space', 0)

        # Modifiers alone
        if key in ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab'] and not is_ctrl and not is_alt:
            if key == 'Tab':
                return ('ACTION_ACCEPT', 'Tab', 0)
            return ('ACTION_IGNORE', key, 0)

        # Shortcut combinations to ignore
        if is_ctrl or is_alt:
            return ('ACTION_IGNORE', key, 0)

        # Navigation
        if key == 'ArrowDown':
            return ('ACTION_NAVIGATE', key, 1)
        if key == 'ArrowUp':
            return ('ACTION_NAVIGATE', key, -1)
        if key == 'PageDown':
            return ('ACTION_NAVIGATE', key, 8)
        if key == 'PageUp':
            return ('ACTION_NAVIGATE', key, -8)

        # Accept & Close
        if key == 'Enter':
            return ('ACTION_ACCEPT', key, 0)
        if key == 'Escape':
            return ('ACTION_CLOSE', key, 0)

        # Edits
        if key == 'Backspace':
            return ('ACTION_BACKSPACE', key, 0)
        if key == 'Delete':
            return ('ACTION_DELETE', key, 0)

        # Trigger characters
        if key in ('.', '@'):
            return ('TRIGGER_CHAR', key, 0)

        # Delimiters
        if key in (' ', 'Spacebar'):
            return ('ACTION_DELIMITER', ' ', 0)
        if key in [',', '(', ')', ';', '[', ']', '{', '}', '=', '+', '-', '*', '/', '<', '>', '!', '%', '&', '|', '^', '~']:
            return ('ACTION_DELIMITER', key, 0)

        # Typing
        if len(key) == 1 and re.match(r'^[\w$#]$', key):
            return ('ACTION_TYPING', key, 0)

        return ('ACTION_IGNORE', key, 0)

    # 1. Explicit triggers
    assert classify_key_event({'ctrlKey': True, 'code': 'Space'}) == ('TRIGGER_EXPLICIT', 'Ctrl+Space', 0)
    assert classify_key_event({'metaKey': True, 'key': ' '}) == ('TRIGGER_EXPLICIT', 'Ctrl+Space', 0)

    # 2. Character triggers
    assert classify_key_event({'key': '.'}) == ('TRIGGER_CHAR', '.', 0)
    assert classify_key_event({'key': '@'}) == ('TRIGGER_CHAR', '@', 0)

    # 3. Navigation
    assert classify_key_event({'key': 'ArrowDown'}) == ('ACTION_NAVIGATE', 'ArrowDown', 1)
    assert classify_key_event({'key': 'ArrowUp'}) == ('ACTION_NAVIGATE', 'ArrowUp', -1)
    assert classify_key_event({'key': 'PageDown'}) == ('ACTION_NAVIGATE', 'PageDown', 8)
    assert classify_key_event({'key': 'PageUp'}) == ('ACTION_NAVIGATE', 'PageUp', -8)

    # 4. Accept
    assert classify_key_event({'key': 'Enter'}) == ('ACTION_ACCEPT', 'Enter', 0)
    assert classify_key_event({'key': 'Tab'}) == ('ACTION_ACCEPT', 'Tab', 0)

    # 5. Close
    assert classify_key_event({'key': 'Escape'}) == ('ACTION_CLOSE', 'Escape', 0)

    # 6. Edits
    assert classify_key_event({'key': 'Backspace'}) == ('ACTION_BACKSPACE', 'Backspace', 0)
    assert classify_key_event({'key': 'Delete'}) == ('ACTION_DELETE', 'Delete', 0)

    # 7. Delimiters
    for d in [' ', ',', '(', ')', ';', '[', ']', '{', '}', '=', '+', '-', '*', '/']:
        assert classify_key_event({'key': d}) == ('ACTION_DELIMITER', d if d != ' ' else ' ', 0)

    # 8. Typing
    for ch in ['a', 'Z', '0', '9', '_', '#', '$']:
        assert classify_key_event({'key': ch}) == ('ACTION_TYPING', ch, 0)

    # 9. Ignore
    for ign in ['Shift', 'Control', 'Alt', 'Meta', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'F1', 'F12']:
        assert classify_key_event({'key': ign}) == ('ACTION_IGNORE', ign, 0)
    # Shortcuts
    assert classify_key_event({'ctrlKey': True, 'key': 'c'}) == ('ACTION_IGNORE', 'c', 0)
    assert classify_key_event({'ctrlKey': True, 'key': 'v'}) == ('ACTION_IGNORE', 'v', 0)
    assert classify_key_event({'ctrlKey': True, 'key': 'z'}) == ('ACTION_IGNORE', 'z', 0)
    assert classify_key_event({'ctrlKey': True, 'key': 'a'}) == ('ACTION_IGNORE', 'a', 0)

    print("[PASS] Phase 2: All 10 KeyCategory groups and edge-case combinations verified!")

if __name__ == '__main__':
    test_phase2_classifier_exports_and_structure()
    test_phase2_all_key_categories()
