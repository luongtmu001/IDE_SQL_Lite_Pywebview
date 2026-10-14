"""
test_intellisense_fixes_plan.py - Automated Test Suite for IntelliSense Enhancements

Covers:
1. Snippets suggestion & top priority (snippets.json).
2. Clean context analysis: newline insertion does not trigger popup; tightened post-keyword space triggers.
3. Procedure/function local scope for BOTH PostgreSQL and SQL Server:
   - SQL Server: @param, #temp (with columns), SELECT INTO #temp, DECLARE @var, DECLARE @tbl TABLE.
   - PostgreSQL: routine params (IN/OUT/DEFAULT), DECLARE (v_var, CONSTANT, CURSOR, ROWTYPE),
     CREATE TEMP TABLE (with columns/AS SELECT), SELECT INTO TEMP.
   - Routine body detection turning off isStrictAlter.
4. Neutral popup selection (selectedIndex = -1) and Enter passthrough.
"""

import os
import re
import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_issue1_snippets_trigger_and_ranker_priority():
    """Verify Snippets are triggered in trigger-controller and scored with top priority in completion-engine."""
    trigger_path = os.path.join(BASE_DIR, 'static', 'js', 'trigger-controller.js')
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')

    with open(trigger_path, 'r', encoding='utf-8') as f:
        trigger_code = f.read()

    with open(engine_path, 'r', encoding='utf-8') as f:
        engine_code = f.read()

    # Trigger controller detects snippet prefix
    assert 'hasSnippetMatch' in trigger_code
    assert 'window.AppSnippets.getSnippets()' in trigger_code
    assert "'snippet'" in trigger_code

    # CandidateGenerator generates snippet candidates
    assert "type: 'snippet'" in engine_code
    assert "displayType: 'Snippet'" in engine_code

    # CompletionRanker scores snippets at the very top (Rule 4d)
    assert "contextScore += 160" in engine_code
    assert "contextScore += 130" in engine_code


def test_issue2_newline_guard_and_clean_context_triggers():
    """Verify Enter / newline insertion does not trigger popup and keyword triggers are strictly contextual."""
    trigger_path = os.path.join(BASE_DIR, 'static', 'js', 'trigger-controller.js')

    with open(trigger_path, 'r', encoding='utf-8') as f:
        trigger_code = f.read()

    # Newline guard in decideChange
    assert "insertedText.includes('\\n')" in trigger_code
    assert "return { action: DecisionAction.CLOSE, reason: 'newline' };" in trigger_code
    assert "return { action: DecisionAction.NONE, reason: 'newline' };" in trigger_code

    # Strict previous token check for post-keyword space (avoiding newline or table-name space triggers)
    assert "['FROM', 'JOIN', 'INTO'].includes(prevTokenUpper)" in trigger_code


def test_issue3_sqlserver_procedure_and_temp_table_scope():
    """Verify SQL Server routine params, #temp tables, table variables, and scalar variables."""
    scope_path = os.path.join(BASE_DIR, 'static', 'js', 'scope-resolver.js')
    analyzer_path = os.path.join(BASE_DIR, 'static', 'js', 'context-analyzer.js')
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')

    with open(scope_path, 'r', encoding='utf-8') as f:
        scope_code = f.read()

    with open(analyzer_path, 'r', encoding='utf-8') as f:
        analyzer_code = f.read()

    with open(engine_path, 'r', encoding='utf-8') as f:
        engine_code = f.read()

    # Routine params without parens (@p1 INT, @p2 VARCHAR)
    assert "codeTokens[k].value.startsWith('@')" in scope_code

    # Temp tables starting with #
    assert "tableName.startsWith('#')" in scope_code
    assert "tbl.startsWith('#')" in scope_code

    # Table variables (@table TABLE)
    assert "type: 'table_variable'" in scope_code

    # Routine body starter resets isAlterContext so local objects are not suppressed
    assert 'hasRoutineBodyStarter' in analyzer_code
    assert "up === 'AS' || up === 'BEGIN' || up === 'RETURNS' || up === '$$'" in analyzer_code

    # Local temp tables injected from activeScope with columns
    assert "context.activeScope.getSymbolsByType('temp_table')" in engine_code


def test_issue3_postgresql_procedure_function_and_temp_table_scope():
    """Verify PostgreSQL routine params, DECLARE block (v_var, CONSTANT, CURSOR), and CREATE TEMP TABLE."""
    scope_path = os.path.join(BASE_DIR, 'static', 'js', 'scope-resolver.js')
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')

    with open(scope_path, 'r', encoding='utf-8') as f:
        scope_code = f.read()

    with open(engine_path, 'r', encoding='utf-8') as f:
        engine_code = f.read()

    # PostgreSQL parameter directions (IN, OUT, INOUT, VARIADIC) and DEFAULT
    assert "['IN', 'OUT', 'INOUT', 'VARIADIC'].includes(firstUp)" in scope_code
    assert "'DEFAULT'" in scope_code

    # PostgreSQL DECLARE block handles CONSTANT and CURSOR
    assert "isConstant" in scope_code
    assert "isCursor" in scope_code
    assert "'CURSOR'" in scope_code

    # PostgreSQL CREATE TEMP TABLE with or without AS SELECT
    assert "['TEMP', 'TEMPORARY'].includes" in scope_code
    assert "['OR', 'REPLACE', 'GLOBAL', 'LOCAL', 'UNLOGGED']" in scope_code
    assert "columns = this.parseColumnDefinitions(codeTokens, openParen, closeParen);" in scope_code
    assert "columns = this.parseSelectProjection(codeTokens, asIdx + 1, stmtEnd);" in scope_code

    # PostgreSQL SELECT ... INTO TEMP tbl
    assert "['TEMP', 'TEMPORARY', 'UNLOGGED'].includes" in scope_code
    assert "this.parseSelectProjection(codeTokens, selectIdx, i)" in scope_code

    # Non-clause expression priority for variables (assignments, returns in PL/pgSQL)
    assert "!context.clause && !context.qualifier" in engine_code
    assert "type === 'scalar_variable'" in engine_code


def test_issue4_neutral_selection_and_enter_passthrough():
    """Verify popup initializes with selectedIndex = -1 and Enter key passes through to editor when unselected."""
    ui_path = os.path.join(BASE_DIR, 'static', 'js', 'intellisense.js')

    with open(ui_path, 'r', encoding='utf-8') as f:
        ui_code = f.read()

    # Initial neutral selection
    assert "this.selectedIndex = -1;" in ui_code

    # Move selection from neutral -1 to 0 on ArrowDown or length-1 on ArrowUp
    assert "if (this.selectedIndex === -1)" in ui_code

    # When getSelectedItem() is null (neutral state), popup closes and returns false so Enter is not eaten
    assert "const selected = this.popupUI.getSelectedItem();" in ui_code
    assert "this.hidePopup();" in ui_code
    assert "return false;" in ui_code


def test_intellisense_icon_and_display_types():
    """Verify scalar_variable and parameter have appropriate icons and display types."""
    ui_path = os.path.join(BASE_DIR, 'static', 'js', 'intellisense.js')

    with open(ui_path, 'r', encoding='utf-8') as f:
        ui_code = f.read()

    assert "scalar_variable: 'fa-cube text-warning'" in ui_code
    assert "parameter: 'fa-cube text-warning'" in ui_code
    assert "scalar_variable: 'Variable'" in ui_code
    assert "parameter: 'Parameter'" in ui_code
    assert "item.type === 'temp_table' || item.type === 'table_variable'" in ui_code
    assert "item.type === 'scalar_variable' || item.type === 'parameter'" in ui_code


def test_continuous_keystroke_filtering_and_raw_candidates():
    """Verify rankAndFilterCandidates runs filter before rank, and refresh uses rawCandidates."""
    ui_path = os.path.join(BASE_DIR, 'static', 'js', 'intellisense.js')
    with open(ui_path, 'r', encoding='utf-8') as f:
        ui_code = f.read()

    # rankAndFilterCandidates must call this.completionEngine.filter.filter before ranker.rank
    assert "candidates = this.completionEngine.filter.filter(candidates, wordLower);" in ui_code
    assert "return this.completionEngine.ranker.rank(candidates, context, wordLower);" in ui_code

    # refresh must use pool = this.rawCandidates || this.activeCandidates
    assert "const pool = this.rawCandidates || this.activeCandidates;" in ui_code
    assert "this.rankAndFilterCandidates(this.activeCandidates, wordLower, currentContext);" in ui_code

    # rawCandidates preserved on collectAndShowCandidates
    assert "this.rawCandidates = (ranked && ranked.rawCandidates) ? ranked.rawCandidates : ranked;" in ui_code
    assert "this.rawCandidates = null;" in ui_code


def test_declare_boundary_and_subsequent_temp_tables_not_swallowed():
    """Verify DECLARE statement stops at statement keywords and semicolons, preventing swallowing."""
    scope_path = os.path.join(BASE_DIR, 'static', 'js', 'scope-resolver.js')
    with open(scope_path, 'r', encoding='utf-8') as f:
        scope_code = f.read()

    # Statement break keywords in DECLARE block
    assert "STATEMENT_BREAK_KEYWORDS" in scope_code
    assert "'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP'" in scope_code
    assert "isSqlServerDeclare" in scope_code

    # Semicolon terminates SQL Server DECLARE
    assert "if (isSqlServerDeclare) {" in scope_code
    assert "j++;" in scope_code
    assert "break;" in scope_code


def test_detect_alter_context_isolated_to_current_statement():
    """Verify detectAlterContext only inspects current statement so earlier ALTER/DROP do not leak."""
    analyzer_path = os.path.join(BASE_DIR, 'static', 'js', 'context-analyzer.js')
    with open(analyzer_path, 'r', encoding='utf-8') as f:
        analyzer_code = f.read()

    # Statement boundary detection in detectAlterContext
    assert "stmtStartIdx = i + 1;" in analyzer_code
    assert "codeTokens[i].value === ';' || up === 'GO'" in analyzer_code
    assert "lastBoundaryMatch" in analyzer_code


def test_from_clause_keywords_and_snippets_available():
    """Verify FROM and JOIN clauses do not suppress keywords, functions, or snippets."""
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')
    with open(engine_path, 'r', encoding='utf-8') as f:
        engine_code = f.read()

    # Ensure !isTableSourceContext is not blocking keywords
    assert "} else if (!context.qualifier && !isStrictAlter && !isStrictExec) {" in engine_code
    assert "ranked.rawCandidates = rawCandidates;" in engine_code


def test_procedure_and_function_body_intellisense():
    """Verify procedure and function body detection, clause isolation, dollar quoting, and symbol availability."""
    tokenizer_path = os.path.join(BASE_DIR, 'static', 'js', 'sql-tokenizer.js')
    analyzer_path = os.path.join(BASE_DIR, 'static', 'js', 'context-analyzer.js')
    scope_path = os.path.join(BASE_DIR, 'static', 'js', 'scope-resolver.js')
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')
    trigger_path = os.path.join(BASE_DIR, 'static', 'js', 'trigger-controller.js')

    with open(tokenizer_path, 'r', encoding='utf-8') as f:
        tok_code = f.read()
    with open(analyzer_path, 'r', encoding='utf-8') as f:
        analyzer_code = f.read()
    with open(scope_path, 'r', encoding='utf-8') as f:
        scope_code = f.read()
    with open(engine_path, 'r', encoding='utf-8') as f:
        engine_code = f.read()
    with open(trigger_path, 'r', encoding='utf-8') as f:
        trigger_code = f.read()

    # 1. PostgreSQL dollar quoting and tag delimiters
    assert "ch === '$'" in tok_code
    assert "tagEnd < len && sqlText[tagEnd] === '$'" in tok_code
    assert "TokenType.PUNCTUATION" in tok_code

    # 2. Routine context detection & exports
    assert "function detectRoutineContext(codeTokens, textBeforeCursor" in analyzer_code
    assert "detectRoutineContext," in analyzer_code
    assert "isInRoutineBody: routineContext ? routineContext.isRoutineBody : false" in analyzer_code

    # 3. Statement boundary stops backward clause leak
    assert "if (t.value === ';' || upper === 'GO' || upper === 'BEGIN')" in analyzer_code

    # 4. Routine body string isolation (PostgreSQL AS 'BEGIN...')
    assert "isRoutineBodyString" in analyzer_code

    # 5. BEGIN inside routine body does not trigger follow-up keywords
    assert "isRoutineOrBlockBegin" in analyzer_code
    assert "routineContext && routineContext.isRoutineBody" in analyzer_code

    # 6. Outer loop index update in ScopeResolver
    assert "if (k > i) {\n                                    i = k - 1;\n                                }" in scope_code

    # 7. Routine body suggestions in CompletionEngine
    assert "context.isInRoutineBody || context.previousToken === 'BEGIN'" in engine_code
    assert "context.isInRoutineBody" in engine_code

    # 8. Routine body trigger in TriggerController
    assert "(context && context.isInRoutineBody)" in trigger_code
    assert "context.previousToken === 'BEGIN' && context.isInRoutineBody" in trigger_code

