"""
tests/test_corpus_syntax_pg_offline_l6.py

L6: PostgreSQL Offline Structural Block Validation Tests (16 cases)
Validates check_offline_postgres_structural_blocks against tests/corpus/syntax/postgres_offline.json.
Known issues (PGO-1, PGO-2, PGO-3, PGO-4: Issue S7) marked with xfail.
"""

import json
import os
import pytest
from app.database.syntax.adapters.postgresql_adapter import check_offline_postgres_structural_blocks

CORPUS_PATH = os.path.join(os.path.dirname(__file__), "corpus", "syntax", "postgres_offline.json")


def load_pg_offline_corpus():
    with open(CORPUS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


PG_OFFLINE_CASES = load_pg_offline_corpus()


@pytest.mark.parametrize("case", PG_OFFLINE_CASES, ids=lambda c: c["id"])
def test_postgres_offline_structural_blocks(case):
    if case.get("status") == "expectedFailure":
        pytest.xfail(f"Known Issue: {case.get('issue')}")

    sql = case["sql"]
    expect = case["expect"]
    diags = check_offline_postgres_structural_blocks(sql)

    if "errorCount" in expect:
        assert len(diags) == expect["errorCount"], (
            f"Expected {expect['errorCount']} diagnostics, got {len(diags)} for SQL:\n{sql}\nDiags: {diags}"
        )

    if "token" in expect:
        tokens = [d.get("token", "") for d in diags]
        assert expect["token"] in tokens, f"Expected token {expect['token']} in {tokens}"
