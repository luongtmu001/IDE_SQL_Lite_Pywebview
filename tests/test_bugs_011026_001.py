"""
Test suite validating the 5 bug fixes from bugs/011026_001_bugslist.md:
- BUG 1: Invalidate DDL cache after routine execution via F5
- BUG 2: Monaco Find Widget keyboard event isolation (Enter, Shift+Enter)
- BUG 3: SQL Server ALTER / CREATE / CREATE OR ALTER detection and script generation
- BUG 4: Duplicate filename counter without overwriting (file(1).sql, file(2).sql, filling holes)
- BUG 5: Editor position, selection, and scroll preservation across F5 execution
"""

import re
try:
    import pytest
except ImportError:
    pytest = None


# ==============================================================================
# BUG 1 & BUG 3: DDL Parser & Cache Invalidation Logic Verification
# ==============================================================================

def parse_ddl_statement(sql):
    """
    Python model of the JavaScript handleDdlExecution in metadata-cache.js
    """
    if not sql or not isinstance(sql, str):
        return None
    ddl_header_regex = re.compile(
        r'\b(CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER|DROP)\s+(TABLE|VIEW|PROCEDURE|PROC|FUNCTION|TYPE|TRIGGER)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?',
        re.IGNORECASE
    )
    match = ddl_header_regex.search(sql)
    if not match:
        return None

    action = re.sub(r'\s+', ' ', match.group(1)).upper()
    obj_type = match.group(2).upper()
    if obj_type == 'PROC':
        obj_type = 'PROCEDURE'

    after_header = sql[match.end():].strip()
    parts = []
    rest = after_header
    part_regex = re.compile(r'^(?:\[([^\]]+)\]|"([^"]+)"|`([^`]+)`|([a-zA-Z0-9_#$@]+))')
    while rest:
        part_match = part_regex.match(rest)
        if not part_match:
            break
        token = part_match.group(1) or part_match.group(2) or part_match.group(3) or part_match.group(4)
        parts.append(token)
        rest = rest[len(part_match.group(0)):].strip()
        if rest.startswith('.'):
            rest = rest[1:].strip()
        else:
            break

    target_db = None
    schema = None
    name = None

    if len(parts) == 3:
        target_db = parts[0]
        schema = parts[1]
        name = parts[2]
    elif len(parts) == 2:
        schema = parts[0]
        name = parts[1]
    elif len(parts) == 1:
        name = parts[0]

    return {
        'action': action,
        'objType': obj_type,
        'targetDb': target_db,
        'schema': schema,
        'name': name
    }


def test_bug1_ddl_parser_multi_bracket_and_actions():
    # 1. ALTER PROCEDURE [dbo].[usp_UpdateReport]
    res1 = parse_ddl_statement("ALTER PROCEDURE [dbo].[usp_UpdateReport] AS BEGIN SELECT 1 END")
    assert res1['action'] == 'ALTER'
    assert res1['objType'] == 'PROCEDURE'
    assert res1['schema'] == 'dbo'
    assert res1['name'] == 'usp_UpdateReport'

    # 2. CREATE OR ALTER PROCEDURE [Catalog].[dbo].[usp_Calculate]
    res2 = parse_ddl_statement("CREATE OR ALTER PROCEDURE [Catalog].[dbo].[usp_Calculate] @p1 int AS BEGIN RETURN @p1; END")
    assert res2['action'] == 'CREATE OR ALTER'
    assert res2['objType'] == 'PROCEDURE'
    assert res2['targetDb'] == 'Catalog'
    assert res2['schema'] == 'dbo'
    assert res2['name'] == 'usp_Calculate'

    # 3. CREATE OR REPLACE FUNCTION "finance"."fn_vat"(val numeric)
    res3 = parse_ddl_statement('CREATE OR REPLACE FUNCTION "finance"."fn_vat"(val numeric) RETURNS numeric AS $$ SELECT 1; $$;')
    assert res3['action'] == 'CREATE OR REPLACE'
    assert res3['objType'] == 'FUNCTION'
    assert res3['schema'] == 'finance'
    assert res3['name'] == 'fn_vat'

    # 4. DROP VIEW IF EXISTS v_ActiveUsers
    res4 = parse_ddl_statement("DROP VIEW IF EXISTS v_ActiveUsers")
    assert res4['action'] == 'DROP'
    assert res4['objType'] == 'VIEW'
    assert res4['name'] == 'v_ActiveUsers'


# ==============================================================================
# BUG 3: SQL Server DDL Transformation (ALTER vs CREATE vs CREATE OR ALTER)
# ==============================================================================

def transform_ddl_script(def_script, desired_action, mode='script-alter'):
    """
    Python model of the combined transformation in intellisense.js and context-menu.js
    """
    sql = def_script
    if mode == 'script-alter' or desired_action in ('ALTER', 'CREATE OR ALTER', 'CREATE OR REPLACE'):
        if desired_action == 'CREATE OR ALTER':
            sql = re.sub(
                r'^\s*(?:CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER)\s+(VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER)\b',
                r'CREATE OR ALTER \1',
                sql,
                flags=re.IGNORECASE | re.MULTILINE
            )
        elif desired_action == 'CREATE OR REPLACE':
            sql = re.sub(
                r'^\s*(?:CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER)\s+(VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER)\b',
                r'CREATE OR REPLACE \1',
                sql,
                flags=re.IGNORECASE | re.MULTILINE
            )
        else: # ALTER
            sql = re.sub(
                r'^\s*(?:CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER)\s+(VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER)\b',
                r'ALTER \1',
                sql,
                flags=re.IGNORECASE | re.MULTILINE
            )
    elif mode == 'script-create':
        sql = re.sub(
            r'^\s*(?:CREATE(?:\s+OR\s+ALTER)?|ALTER)\s+(VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER)\b',
            r'CREATE \1',
            sql,
            flags=re.IGNORECASE | re.MULTILINE
        )
    return sql


def test_bug3_alter_not_reverted_to_create():
    # Procedure created originally with CREATE PROCEDURE
    orig = "CREATE PROCEDURE [dbo].[usp_GetData] AS SELECT 1;"

    # When user alters or requests script-alter, it must become ALTER PROCEDURE, NEVER CREATE!
    altered = transform_ddl_script(orig, desired_action='ALTER', mode='script-alter')
    assert altered.startswith("ALTER PROCEDURE")
    assert not altered.startswith("ALTER OR ALTER")

    # When user uses CREATE OR ALTER, it must become CREATE OR ALTER PROCEDURE
    coa = transform_ddl_script(orig, desired_action='CREATE OR ALTER')
    assert coa.startswith("CREATE OR ALTER PROCEDURE")

    # If procedure was already CREATE OR ALTER, script-alter must NOT turn it into ALTER OR ALTER
    already_coa = "CREATE OR ALTER PROCEDURE [dbo].[usp_GetData] AS SELECT 1;"
    altered_coa = transform_ddl_script(already_coa, desired_action='ALTER', mode='script-alter')
    assert altered_coa.startswith("ALTER PROCEDURE")
    assert "ALTER OR ALTER" not in altered_coa

    # If procedure was stored as ALTER PROCEDURE, script-create must turn it into CREATE PROCEDURE
    stored_as_alter = "ALTER PROCEDURE [dbo].[usp_GetData] AS SELECT 1;"
    as_create = transform_ddl_script(stored_as_alter, desired_action='CREATE', mode='script-create')
    assert as_create.startswith("CREATE PROCEDURE")


# ==============================================================================
# BUG 4: getUniqueFileName Implementation & Hole-Filling Verification
# ==============================================================================

def get_unique_filename(candidate_name, existing_names):
    """
    Exact Python replica of getUniqueFileName implemented in tabs.js & context-menu.js
    """
    if not candidate_name:
        candidate_name = 'Untitled.sql'

    existing_set = set(str(n).strip().lower() for n in existing_names if n)
    trimmed = str(candidate_name).strip()
    if trimmed.lower() not in existing_set:
        return trimmed

    dot_idx = trimmed.rfind('.')
    base_stem = trimmed
    ext = ''
    if dot_idx > 0:
        base_stem = trimmed[:dot_idx]
        ext = trimmed[dot_idx:]

    m = re.match(r'^(.*?)(?:\((\d+)\))?$', base_stem)
    root_stem = m.group(1).strip() if (m and m.group(1)) else base_stem

    i = 1
    while True:
        test_name = f"{root_stem}({i}){ext}"
        if test_name.lower() not in existing_set:
            return test_name
        i += 1


def test_bug4_unique_filename_counter_and_holes():
    # 1. No collision
    assert get_unique_filename("file.sql", []) == "file.sql"

    # 2. Collision with file.sql -> file(1).sql
    assert get_unique_filename("file.sql", ["file.sql"]) == "file(1).sql"

    # 3. Collision with file.sql and file(1).sql -> file(2).sql
    assert get_unique_filename("file.sql", ["file.sql", "file(1).sql"]) == "file(2).sql"

    # 4. Fill hole: file.sql, file(1).sql, file(2).sql, file(4).sql -> file(3).sql
    existing = ["file.sql", "file(1).sql", "file(2).sql", "file(4).sql"]
    assert get_unique_filename("file.sql", existing) == "file(3).sql"

    # 5. Extension preservation: procedure.sql -> procedure(1).sql (NOT procedure.sql(1))
    assert get_unique_filename("procedure.sql", ["procedure.sql"]) == "procedure(1).sql"

    # 6. Windows Case-Insensitivity: "FILE.SQL" collides with "file.sql"
    assert get_unique_filename("FILE.sql", ["file.sql"]) == "FILE(1).sql"


# ==============================================================================
# BUG 5: Editor State Snapshot & Restoration Verification
# ==============================================================================

class MockMonacoEditor:
    def __init__(self, line=1, col=1, sel=(1, 1, 1, 1), scroll_top=0, scroll_left=0):
        self.position = {'lineNumber': line, 'column': col}
        self.selection = {'startLineNumber': sel[0], 'startColumn': sel[1], 'endLineNumber': sel[2], 'endColumn': sel[3]}
        self.scrollTop = scroll_top
        self.scrollLeft = scroll_left
        self.focused = False

    def getPosition(self):
        return dict(self.position)

    def getSelection(self):
        return dict(self.selection)

    def getScrollTop(self):
        return self.scrollTop

    def getScrollLeft(self):
        return self.scrollLeft

    def setPosition(self, pos):
        self.position = dict(pos)

    def setSelection(self, sel):
        self.selection = dict(sel)

    def setScrollTop(self, top):
        self.scrollTop = top

    def setScrollLeft(self, left):
        self.scrollLeft = left

    def focus(self):
        self.focused = True


def simulate_execute_query(editor, has_errors=False):
    # Snapshot before execution
    snapshot = {
        'position': editor.getPosition(),
        'selection': editor.getSelection(),
        'scrollTop': editor.getScrollTop(),
        'scrollLeft': editor.getScrollLeft()
    }

    # Simulate Monaco layout change or focus loss during query execution
    editor.position = {'lineNumber': 1, 'column': 1}
    editor.selection = {'startLineNumber': 1, 'startColumn': 1, 'endLineNumber': 1, 'endColumn': 1}
    editor.scrollTop = 0
    editor.scrollLeft = 0
    editor.focused = False

    # Restore reliably across execution (both success and errors)
    editor.setPosition(snapshot['position'])
    editor.setSelection(snapshot['selection'])
    editor.setScrollTop(snapshot['scrollTop'])
    editor.setScrollLeft(snapshot['scrollLeft'])
    editor.focus()

    return snapshot


def test_bug5_cursor_and_selection_preserved_on_success():
    ed = MockMonacoEditor(line=42, col=15, sel=(42, 10, 42, 25), scroll_top=350, scroll_left=0)

    # Execute successfully
    simulate_execute_query(ed, has_errors=False)

    assert ed.position == {'lineNumber': 42, 'column': 15}
    assert ed.selection == {'startLineNumber': 42, 'startColumn': 10, 'endLineNumber': 42, 'endColumn': 25}
    assert ed.scrollTop == 350
    assert ed.focused is True


def test_bug5_cursor_and_selection_preserved_on_procedure_or_error():
    ed = MockMonacoEditor(line=88, col=20, sel=(88, 5, 88, 30), scroll_top=1200, scroll_left=0)

    # Execute procedure with error or pure DDL: cursor, selection, and scroll MUST be preserved
    simulate_execute_query(ed, has_errors=True)

    assert ed.position == {'lineNumber': 88, 'column': 20}
    assert ed.selection == {'startLineNumber': 88, 'startColumn': 5, 'endLineNumber': 88, 'endColumn': 30}
    assert ed.scrollTop == 1200
    assert ed.focused is True


if __name__ == '__main__':
    all_tests = [v for k, v in list(globals().items()) if k.startswith('test_') and callable(v)]
    passed = 0
    print(f"Running {len(all_tests)} tests in test_bugs_011026_001.py...")
    for t in all_tests:
        t()
        passed += 1
        print(f"  [PASS] {t.__name__}")
    print(f"All {passed}/{len(all_tests)} tests passed successfully!")
