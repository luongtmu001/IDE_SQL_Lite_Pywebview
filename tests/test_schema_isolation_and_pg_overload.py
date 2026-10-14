import pytest
from unittest.mock import MagicMock, patch
from app.database.sqlserver import qualify_sql_with_schema, SqlServerAdapter
from app.database.postgresql import PostgreSqlAdapter

def test_sqlserver_qualify_sql_with_schema():
    # 1. Unqualified table in SELECT
    sql = "SELECT * FROM b00command"
    assert qualify_sql_with_schema(sql, "datasys") == "SELECT * FROM [datasys].[b00command]"

    # 2. Bracketed unqualified table
    sql = "SELECT * FROM [b00command]"
    assert qualify_sql_with_schema(sql, "datasys") == "SELECT * FROM [datasys].[b00command]"

    # 3. Already qualified with dbo - should remain untouched
    sql = "SELECT * FROM dbo.b00command"
    assert qualify_sql_with_schema(sql, "datasys") == "SELECT * FROM dbo.b00command"

    # 4. Already qualified with bracketed schema
    sql = "SELECT * FROM [dbo].[b00command]"
    assert qualify_sql_with_schema(sql, "datasys") == "SELECT * FROM [dbo].[b00command]"

    # 5. Join of two unqualified tables
    sql = "SELECT a.* FROM b00command a JOIN c00command b ON a.id = b.id"
    assert qualify_sql_with_schema(sql, "datasys") == "SELECT a.* FROM [datasys].[b00command] a JOIN [datasys].[c00command] b ON a.id = b.id"

    # 6. Temporary tables should NOT be qualified
    sql = "SELECT * FROM #tempTable"
    assert qualify_sql_with_schema(sql, "datasys") == "SELECT * FROM #tempTable"

    # 7. CTEs should NOT be qualified
    sql = "WITH cte AS (SELECT 1 AS x) SELECT * FROM cte"
    assert qualify_sql_with_schema(sql, "datasys") == "WITH cte AS (SELECT 1 AS x) SELECT * FROM cte"

    # 8. INSERT, UPDATE, DELETE
    assert qualify_sql_with_schema("INSERT INTO b00command (col) VALUES (1)", "datasys") == "INSERT INTO [datasys].[b00command] (col) VALUES (1)"
    assert qualify_sql_with_schema("UPDATE b00command SET col = 1", "datasys") == "UPDATE [datasys].[b00command] SET col = 1"
    assert qualify_sql_with_schema("DELETE FROM b00command WHERE id = 1", "datasys") == "DELETE FROM [datasys].[b00command] WHERE id = 1"

    # 9. When schema is 'dbo' or empty, no qualification should occur
    assert qualify_sql_with_schema("SELECT * FROM b00command", "dbo") == "SELECT * FROM b00command"
    assert qualify_sql_with_schema("SELECT * FROM b00command", "") == "SELECT * FROM b00command"
    assert qualify_sql_with_schema("SELECT * FROM b00command", None) == "SELECT * FROM b00command"

def test_postgresql_search_path_strict():
    adapter = PostgreSqlAdapter({"server": "localhost", "database": "testdb"})
    mock_conn = MagicMock()
    mock_conn.closed = False
    mock_cur = MagicMock()
    mock_cur.nextset.return_value = False
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_cur.fetchall.return_value = []
    mock_cur.description = None
    adapter.connection = mock_conn

    # Execute with schema 'public'
    adapter.execute("SELECT * FROM b00command", schema="public")
    
    # Check that search_path was set strictly to "public" without appending dbo
    executed_statements = [call[0][0] for call in mock_cur.execute.call_args_list if isinstance(call[0][0], str)]
    set_search_path = [s for s in executed_statements if "SET search_path" in s]
    assert len(set_search_path) >= 1
    assert 'SET search_path TO "public"' in set_search_path[0]
    assert '"dbo"' not in set_search_path[0]

def test_postgresql_function_overloading_metadata():
    adapter = PostgreSqlAdapter({"server": "localhost", "database": "testdb"})
    mock_conn = MagicMock()
    mock_conn.closed = False
    mock_cur = MagicMock()
    mock_cur.nextset.return_value = False
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    adapter.connection = mock_conn

    # 1. list_objects for functions: (nspname, proname, oid, identity_args, pronargs)
    mock_cur.fetchall.return_value = [
        ("public", "test_fn", 101, "integer", 1),
        ("public", "test_fn", 102, "text, integer", 2),
    ]
    # Provide description so execute() recognizes it as result set
    mock_desc = [MagicMock(), MagicMock(), MagicMock(), MagicMock(), MagicMock()]
    mock_desc[0].name = "nspname"
    mock_desc[1].name = "proname"
    mock_desc[2].name = "oid"
    mock_desc[3].name = "identity_args"
    mock_desc[4].name = "pronargs"
    mock_cur.description = mock_desc

    objs = adapter.list_objects(database="testdb", schema="public", object_type="functions")
    assert len(objs) == 2
    assert objs[0]["name"] == "test_fn(integer)"
    assert objs[0]["base_name"] == "test_fn"
    assert objs[0]["identity_args"] == "integer"
    assert objs[1]["name"] == "test_fn(text, integer)"
    assert objs[1]["base_name"] == "test_fn"
    assert objs[1]["identity_args"] == "text, integer"

    # 2. get_object_definition for overloaded function
    mock_cur.fetchmany.return_value = [("CREATE OR REPLACE FUNCTION public.test_fn(p1 integer) RETURNS void ...",)]
    mock_cur.fetchall.return_value = [("CREATE OR REPLACE FUNCTION public.test_fn(p1 integer) RETURNS void ...",)]
    mock_desc_def = [MagicMock()]
    mock_desc_def[0].name = "pg_get_functiondef"
    mock_cur.description = mock_desc_def

    defn = adapter.get_object_definition("testdb", "public", "test_fn(integer)", "function")
    assert "test_fn(p1 integer)" in defn

    # Check query passed to cursor had identity_args
    call_args = mock_cur.execute.call_args_list[-1]
    query_sql = call_args[0][0]
    params = call_args[0][1]
    assert "pg_get_function_identity_arguments" in query_sql
    assert "integer" in params

def test_open_file_dom_and_js_integration():
    from pathlib import Path
    base_dir = Path(__file__).resolve().parent.parent

    # 1. Verify index.html contains menu-file, ide-menu-open-file, and ide-open-file-input
    index_html = (base_dir / "templates" / "index.html").read_text(encoding="utf-8")
    assert 'id="menu-file"' in index_html
    assert 'id="ide-menu-open-file"' in index_html
    assert 'id="ide-open-file-input"' in index_html
    assert 'Ctrl+O' in index_html

    # 2. Verify tabs.js contains openFilesFromDisk, Ctrl+O shortcut, and drag & drop handling
    tabs_js = (base_dir / "static" / "js" / "tabs.js").read_text(encoding="utf-8")
    assert 'function openFilesFromDisk' in tabs_js
    assert "key === 'o'" in tabs_js
    assert 'ide-menu-open-file' in tabs_js
    assert 'openFilesFromDisk' in tabs_js
    assert "addEventListener('drop'" in tabs_js
