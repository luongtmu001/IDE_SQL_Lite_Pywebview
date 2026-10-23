"""
tests/test_corpus_syntax_temp_tables.py

Corpus test runner for Temporary Table Semantics & Diagnostics (Cases A-M).
Complies with temp_table_session_context_analysis.md.
"""

import json
import os
import pytest
from app.database.syntax.semantic_analyzer import analyze_sql_semantics

CORPUS_PATH = os.path.join(
    os.path.dirname(__file__), "corpus", "syntax", "temp_tables.json"
)


def load_temp_table_corpus():
    with open(CORPUS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


TEMP_TABLE_CASES = load_temp_table_corpus()


@pytest.mark.parametrize("case", TEMP_TABLE_CASES, ids=lambda c: c["id"])
def test_temp_table_semantic_corpus(case):
    if case.get("status") == "expectedFailure":
        pytest.xfail(f"Known Issue: {case.get('issue')}")

    sql = case["sql"]
    dialect = case.get("dialect", "sqlserver")
    expect = case.get("expect", {})

    diags = analyze_sql_semantics(sql, dialect=dialect)

    if expect.get("diagnosticsCount") == 0:
        assert len(diags) == 0, f"Expected 0 diagnostics, got: {diags}"
    elif "diagnosticsCount" in expect:
        assert len(diags) == expect["diagnosticsCount"], f"Expected {expect['diagnosticsCount']} diagnostics, got: {diags}"

    if "token" in expect:
        expected_token = expect["token"].lower()
        tokens = [d.get("token", "").lower() for d in diags]
        assert expected_token in tokens, f"Expected token '{expected_token}' in {tokens}"

    if expect.get("hasWarningOrError"):
        assert len(diags) > 0, f"Expected warning or error for SQL, got 0 diagnostics: {sql}"
