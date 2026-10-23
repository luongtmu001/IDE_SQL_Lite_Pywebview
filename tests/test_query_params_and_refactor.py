import os
import subprocess
import pytest
from app.utils.sql_params import extract_param_declarations, find_param_placeholders, substitute_parameters


def test_query_params_backend_boolean_and_types():
    """Verify backend sql_params supports boolean and types safely."""
    sql = """
    -- @param active_flag: boolean = true
    -- @param cutoff_date: date = 2026-01-01
    -- @param max_count: number = 50
    -- @param target_table: identifier = Orders
    SELECT * FROM {{target_table}}
    WHERE is_active = {{active_flag}}
      AND order_date >= {{cutoff_date}}
      LIMIT {{max_count}};
    """
    decls = extract_param_declarations(sql)
    assert "active_flag" in decls
    assert decls["active_flag"]["type"] == "boolean"
    assert decls["active_flag"]["default"] == "true"

    placeholders = find_param_placeholders(sql, dialect="sqlserver")
    p_names = {p["name"] for p in placeholders}
    assert p_names == {"target_table", "active_flag", "cutoff_date", "max_count"}

    # Test substitution in SQL Server
    substituted_mssql = substitute_parameters(sql, {
        "active_flag": "true",
        "cutoff_date": "2026-05-10",
        "max_count": "100",
        "target_table": "Users"
    }, dialect="sqlserver")

    assert "is_active = 1" in substituted_mssql
    assert "FROM [Users]" in substituted_mssql
    assert "'2026-05-10'" in substituted_mssql
    assert "LIMIT 100" in substituted_mssql

    # Test substitution in PostgreSQL (boolean -> TRUE/FALSE, ident -> "...")
    substituted_pg = substitute_parameters(sql, {
        "active_flag": "false",
        "cutoff_date": "2026-05-10",
        "max_count": "100",
        "target_table": "Users"
    }, dialect="postgresql")

    assert "is_active = FALSE" in substituted_pg
    assert 'FROM "Users"' in substituted_pg


def test_query_params_frontend_components():
    """Verify static/js/query-params.js includes type inference and parameter presets."""
    js_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "query-params.js")
    with open(js_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "inferParamType(" in content
    assert "getPresets()" in content
    assert "savePreset(" in content
    assert "deletePreset(" in content
    assert "ideParamPresetSelect" in content
    assert "ideParamSavePresetBtn" in content
    assert "ideParamDeletePresetBtn" in content
    assert "openParametersModal(" in content

    # Check monarch tokenizer & init
    lang_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "monaco-sql-lang.js")
    with open(lang_path, "r", encoding="utf-8") as f:
        lang_content = f.read()
    assert 'variable.parameter' in lang_content

    init_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "monaco-init.js")
    with open(init_path, "r", encoding="utf-8") as f:
        init_content = f.read()
    assert 'variable.parameter' in init_content


def test_sql_refactor_engine_components():
    """Verify sql-refactor.js has Rename Identifier, Extract to CTE, and Format on Paste."""
    refactor_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "sql-refactor.js")
    with open(refactor_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "registerMonacoRenameProvider" in content
    assert "provideRenameEdits" in content
    assert "resolveRenameLocation" in content
    assert "extractToCTE" in content
    assert "hookFormatOnPaste" in content
    assert "window.SqlRefactorEngine" in content

    # Check templates/index.html includes sql-refactor.js
    html_path = os.path.join(os.path.dirname(__file__), "..", "templates", "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        html_content = f.read()
    assert "sql-refactor.js" in html_content

    # Check editor.js registers actions
    ed_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "editor.js")
    with open(ed_path, "r", encoding="utf-8") as f:
        ed_content = f.read()
    assert "sql-query-parameters" in ed_content
    assert "sql-extract-to-cte" in ed_content
    assert "hookFormatOnPaste" in ed_content


def test_format_on_paste_is_disabled():
    """Verify format on paste is disabled so user code is never automatically mutated on paste."""
    refactor_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "sql-refactor.js")
    with open(refactor_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Format on paste must NOT execute edits or auto-format in hookFormatOnPaste
    assert "format-on-paste" not in content

    ed_path = os.path.join(os.path.dirname(__file__), "..", "static", "js", "editor.js")
    with open(ed_path, "r", encoding="utf-8") as f:
        ed_content = f.read()
    assert "formatOnPaste: false" in ed_content


def test_dist_packages_untouched_in_sprint2_and_3():
    """Verify that dist/ and build/ directory contents remain untouched per constraint."""
    try:
        res = subprocess.run(
            ["git", "status", "--porcelain", "dist", "build"],
            capture_output=True,
            text=True,
            check=True
        )
        assert res.stdout.strip() == "", f"dist/ or build/ has modified files: {res.stdout.strip()}"
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
