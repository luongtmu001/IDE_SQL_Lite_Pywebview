"""
Test to ensure Public API Surface (pywebview Bridge & Flask Routes) matches the Phase 0 baseline snapshot.
Acts as a critical regression safety net for refactoring in Phase 6 and beyond.
"""
import difflib
from pathlib import Path
from tests.snapshots.generate_api_surface import generate_api_surface_content

SNAPSHOT_FILE = Path(__file__).resolve().parent / "snapshots" / "api_surface.txt"


def test_public_api_surface_matches_snapshot():
    """Verify that current MainApi, BravoApi, Subwindow APIs, and Flask routes match snapshot."""
    assert SNAPSHOT_FILE.exists(), f"Snapshot file not found: {SNAPSHOT_FILE}"
    expected = SNAPSHOT_FILE.read_text(encoding="utf-8")
    actual = generate_api_surface_content()

    if actual != expected:
        diff = "\n".join(
            difflib.unified_diff(
                expected.splitlines(),
                actual.splitlines(),
                fromfile="expected_snapshot",
                tofile="actual_surface",
                lineterm="",
            )
        )
        assert False, (
            "Public API Surface has changed compared to baseline snapshot!\n"
            "If this change is intentional, re-run generate_api_surface.py to update.\n"
            f"Diff:\n{diff}"
        )
