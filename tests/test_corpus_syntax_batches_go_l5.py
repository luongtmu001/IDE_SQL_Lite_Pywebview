"""
tests/test_corpus_syntax_batches_go_l5.py

L5: SQL Server GO Batch Splitting Corpus Tests (12 cases)
Validates split_sqlserver_batches against tests/corpus/syntax/batches_go.json.
"""

import json
import os
import pytest
from app.database.syntax.validator import split_sqlserver_batches

CORPUS_PATH = os.path.join(os.path.dirname(__file__), "corpus", "syntax", "batches_go.json")


def load_batches_corpus():
    with open(CORPUS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


BATCHES_CASES = load_batches_corpus()


@pytest.mark.parametrize("case", BATCHES_CASES, ids=lambda c: c["id"])
def test_sqlserver_go_batch_splitting(case):
    sql = case["sql"]
    expect = case["expect"]
    batches = split_sqlserver_batches(sql)

    assert len(batches) == expect["batchCount"], (
        f"Expected {expect['batchCount']} batches, got {len(batches)} for SQL:\n{sql}"
    )

    if "startLines" in expect:
        start_lines = [b["start_line"] for b in batches]
        assert start_lines == expect["startLines"], (
            f"Expected start lines {expect['startLines']}, got {start_lines}"
        )
