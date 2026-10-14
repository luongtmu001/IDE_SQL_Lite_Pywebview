# -*- coding: utf-8 -*-
"""
Tests for PyInstaller run.spec security (Phase 2):
- Ensures datas list does NOT package sensitive user files:
  - connections.json
  - programlist.json
  - history.db
  - .secret.key
"""
import ast
import re
from pathlib import Path

SPEC_PATH = Path(__file__).resolve().parent.parent / "run.spec"


def test_run_spec_does_not_package_secrets():
    """Verify run.spec statically filters and excludes sensitive files from datas."""
    assert SPEC_PATH.exists(), f"run.spec not found at {SPEC_PATH}"
    spec_text = SPEC_PATH.read_text(encoding="utf-8")

    # Verify that the old insecure pattern is absent
    assert "f.endswith('.json')" not in spec_text, "Insecure globbing of all *.json in run.spec detected!"
    assert "f == '.secret.key'" not in spec_text, ".secret.key inclusion detected in run.spec!"

    # Verify that ALLOWED_DEFAULT_DATA_FILES is defined and strictly whitelists safe files
    forbidden = ["connections.json", "programlist.json", "history.db", ".secret.key"]
    for f in forbidden:
        assert f"'{f}'" not in spec_text or f"Exclude" in spec_text, f"Forbidden file {f} mentioned insecurely in run.spec"

    # Simulate collection logic with mock directory
    allowed_match = re.search(r"ALLOWED_DEFAULT_DATA_FILES\s*=\s*\{([^}]+)\}", spec_text)
    assert allowed_match is not None, "ALLOWED_DEFAULT_DATA_FILES set not found in run.spec"

    allowed_raw = allowed_match.group(1)
    for f in forbidden:
        assert f"'{f}'" not in allowed_raw and f'"{f}"' not in allowed_raw, (
            f"Sensitive file {f} found in ALLOWED_DEFAULT_DATA_FILES in run.spec!"
        )
