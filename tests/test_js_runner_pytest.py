"""
tests/test_js_runner_pytest.py

Integration test executing the Node.js test runner suite (tests/js/*.test.js) via pytest.
Ensures running `pytest` covers all JavaScript IntelliSense, CompletionEngine,
PositionMapper, Fuzzing, and Performance tests.
"""

import glob
import os
import shutil
import subprocess
import pytest


def test_run_node_js_test_suite():
    # Resolve node binary
    node_bin = shutil.which("node")
    if not node_bin:
        default_node = r"C:\Program Files\nodejs\node.exe"
        if os.path.exists(default_node):
            node_bin = default_node

    if not node_bin:
        pytest.skip("Node.js executable not found on system PATH or default installation path.")

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    js_tests_dir = os.path.join(base_dir, "tests", "js")
    test_files = glob.glob(os.path.join(js_tests_dir, "*.test.js"))

    assert len(test_files) > 0, "No JS test files found in tests/js/"

    cmd = [node_bin, "--test"] + test_files
    proc = subprocess.run(
        cmd,
        cwd=base_dir,
        capture_output=True,
        text=True,
        encoding="utf-8"
    )

    if proc.returncode != 0:
        safe_stdout = proc.stdout.encode('ascii', errors='replace').decode('ascii')
        safe_stderr = proc.stderr.encode('ascii', errors='replace').decode('ascii')
        print("[NODE TEST STDOUT]:\n", safe_stdout)
        print("[NODE TEST STDERR]:\n", safe_stderr)

    assert proc.returncode == 0, f"Node.js test suite failed with exit code {proc.returncode}"
