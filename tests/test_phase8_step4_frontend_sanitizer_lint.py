# -*- coding: utf-8 -*-
"""
Tests for Phase 8 Step 4: ESLint & Frontend Static Analysis Sanitizer Rules.
Verifies:
1. .eslintrc.json exists with no-unsanitized plugin configured at warning level.
2. Static analysis audit of static/js/ to detect unescaped DB error variables in innerHTML.
3. Critical files (explorer.js, table-data-editor.js, grid-result.js) pass sanitizer checks.
"""

import json
from pathlib import Path
import re


def test_eslintrc_json_has_no_unsanitized_rules():
    rc_path = Path(".eslintrc.json")
    assert rc_path.exists(), ".eslintrc.json must exist in project root"
    data = json.loads(rc_path.read_text(encoding="utf-8"))

    assert "no-unsanitized" in data.get("plugins", [])
    rules = data.get("rules", {})
    assert "no-unsanitized/method" in rules
    assert "no-unsanitized/property" in rules
    assert rules["no-unsanitized/property"] in ("warn", "error", 1, 2)


def test_critical_js_files_sanitize_inner_html_error_interpolations():
    """Verify no raw err.message or data.error is directly interpolated into innerHTML without escaping."""
    critical_files = [
        "static/js/explorer.js",
        "static/js/table-data-editor.js",
        "static/js/grid-result.js",
    ]

    raw_error_pattern = re.compile(
        r'\.innerHTML\s*=\s*`[^`]*\$\{\s*(?!escapeHtml|esc\b)(?:err\.message|data\.error|fetchErr\.message|e\.message)[^}]*\}[^`]*`',
        re.MULTILINE
    )

    violations = []
    for f in critical_files:
        path = Path(f)
        assert path.exists(), f"{f} must exist"
        content = path.read_text(encoding="utf-8")

        for line_num, line in enumerate(content.splitlines(), start=1):
            if ".innerHTML" in line and ("err.message" in line or "data.error" in line or "fetchErr.message" in line):
                if not ("escapeHtml" in line or "esc(" in line):
                    violations.append(f"{f}:{line_num}: {line.strip()}")

    assert not violations, f"Found unescaped error interpolations in innerHTML:\n" + "\n".join(violations)
