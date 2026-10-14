# -*- coding: utf-8 -*-
"""
Tests for Phase 3 Bug 5:
- Verify that MainApi has no duplicate method definitions (ast check)
- Verify that get_intellisense_* methods work as expected
"""
import ast
from unittest.mock import MagicMock
import pytest
from main import MainApi


def test_main_api_has_no_duplicate_methods():
    """Verify that MainApi class in main.py has no duplicate method names."""
    with open("main.py", "r", encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename="main.py")

    for cls_name in ("BravoApi", "MainApi"):
        cls_node = None
        for node in tree.body:
            if isinstance(node, ast.ClassDef) and node.name == cls_name:
                cls_node = node
                break

        assert cls_node is not None, f"Class {cls_name} not found in main.py"

        method_counts = {}
        for item in cls_node.body:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                method_counts[item.name] = method_counts.get(item.name, 0) + 1

        duplicates = {name: count for name, count in method_counts.items() if count > 1}
        assert duplicates == {}, f"Found duplicate methods in {cls_name}: {duplicates}"


def test_get_intellisense_types_format():
    """Verify get_intellisense_types returns types, user_types, engine."""
    api = MainApi()
    mock_conn = MagicMock()
    mock_conn.metadata_service.get_supported_types.return_value = {
        "types": ["int", "varchar"],
        "user_types": ["dbo.MyType"],
        "engine": "sqlserver",
    }
    api._get_connection = MagicMock(return_value=mock_conn)

    res = api.get_intellisense_types("conn1", database="master")
    assert res["success"] is True
    assert res["types"] == ["int", "varchar"]
    assert res["user_types"] == ["dbo.MyType"]
    assert res["engine"] == "sqlserver"
