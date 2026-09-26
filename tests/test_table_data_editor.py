import unittest
from pathlib import Path
from unittest.mock import MagicMock
from app.services.table_data_editor_service import TableDataEditorService


class TestTableDataEditor(unittest.TestCase):

    def test_html_includes_table_data_editor_assets(self):
        """Verify index.html includes table-data-editor CSS, JS, and DOM container."""
        html_path = Path(__file__).resolve().parent.parent / "templates" / "index.html"
        self.assertTrue(html_path.exists())
        with open(html_path, "r", encoding="utf-8") as f:
            html = f.read()
        self.assertIn("table-data-editor.css", html)
        self.assertIn('id="table-data-editor-container"', html)
        self.assertIn("table-data-editor.js", html)

    def test_build_select_sql_sqlserver(self):
        """Test SQL generation for SQL Server with TOP, sorting, and criteria."""
        # Basic TOP
        sql = TableDataEditorService.build_select_sql('sqlserver', 'dbo', 'Customers', top_n=200)
        self.assertIn('SELECT TOP (200) *', sql)
        self.assertIn('FROM [dbo].[Customers]', sql)

        # With criteria and sort
        criteria = [
            {'column': 'Country', 'filter': "='USA'", 'ors': ["='UK'"], 'sort_type': 'Ascending', 'sort_order': 1},
            {'column': 'Age', 'filter': '> 21', 'ors': [], 'sort_type': 'Descending', 'sort_order': 2}
        ]
        sql = TableDataEditorService.build_select_sql(
            'sqlserver', 'dbo', 'Customers',
            top_n=100, criteria=criteria
        )
        self.assertIn('SELECT TOP (100) *', sql)
        self.assertIn('FROM [dbo].[Customers]', sql)
        self.assertIn("WHERE ([Country] = 'USA' OR [Country] = 'UK') AND [Age] > 21", sql)
        self.assertIn('ORDER BY [Country] ASC, [Age] DESC', sql)

    def test_build_select_sql_postgresql(self):
        """Test SQL generation for PostgreSQL with LIMIT, sorting, and criteria."""
        # Basic LIMIT
        sql = TableDataEditorService.build_select_sql('postgresql', 'public', 'users', top_n=50)
        self.assertIn('SELECT *', sql)
        self.assertIn('FROM "public"."users"', sql)
        self.assertIn('LIMIT 50', sql)

        # With criteria and sort
        criteria = [
            {'column': 'status', 'filter': "='active'", 'ors': []},
            {'column': 'created_at', 'filter': '', 'ors': [], 'sort_type': 'DESC', 'sort_order': 1}
        ]
        sql = TableDataEditorService.build_select_sql(
            'postgresql', 'public', 'users',
            top_n=50, criteria=criteria
        )
        self.assertIn('SELECT *', sql)
        self.assertIn('FROM "public"."users"', sql)
        self.assertIn("WHERE \"status\" = 'active'", sql)
        self.assertIn('ORDER BY "created_at" DESC', sql)
        self.assertIn('LIMIT 50', sql)

    def test_update_row_sqlserver(self):
        """Test UPDATE statement generation and execution for SQL Server."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_adapter.execute.return_value = {'success': True, 'row_count': 1}

        res = TableDataEditorService.update_row(
            mock_adapter, 'TestDB', 'dbo', 'Users',
            pk_conditions={'Id': 10},
            changes={'Name': 'Alice', 'Email': 'alice@example.com'}
        )

        self.assertTrue(res['success'])
        self.assertEqual(res['affected'], 1)
        mock_adapter.execute.assert_called_once()
        call_sql = mock_adapter.execute.call_args[0][0]
        params = mock_adapter.execute.call_args[1]['params']
        self.assertIn('UPDATE [TestDB].[dbo].[Users]', call_sql)
        self.assertIn('[Name] = ?', call_sql)
        self.assertIn('[Email] = ?', call_sql)
        self.assertIn('WHERE [Id] = ?', call_sql)
        self.assertEqual(len(params), 3) # Name, Email, Id

    def test_delete_row_postgresql(self):
        """Test DELETE statement generation and execution for PostgreSQL."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'postgresql'
        mock_adapter.execute.return_value = {'success': True, 'row_count': 1}

        res = TableDataEditorService.delete_row(
            mock_adapter, 'testdb', 'public', 'items',
            pk_conditions={'id': 42}
        )

        self.assertTrue(res['success'])
        self.assertEqual(res['affected'], 1)
        mock_adapter.execute.assert_called_once()
        call_sql = mock_adapter.execute.call_args[0][0]
        params = mock_adapter.execute.call_args[1]['params']
        self.assertIn('DELETE FROM "public"."items"\nWHERE "id" = %s', call_sql)
        self.assertEqual(params, (42,))

    def test_insert_row_skips_identity(self):
        """Test INSERT statement generation properly skips identity/auto-increment columns."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_adapter.execute.return_value = {'success': True, 'row_count': 1}

        # Pass Id in data (e.g. from copy/paste or duplicate)
        res = TableDataEditorService.insert_row(
            mock_adapter, 'TestDB', 'dbo', 'Products',
            values={'Id': 999, 'Code': 'PRD-01', 'Description': 'Test Product'},
            identity_columns=['Id']
        )

        self.assertTrue(res['success'])
        mock_adapter.execute.assert_called_once()
        call_sql = mock_adapter.execute.call_args[0][0]
        params = mock_adapter.execute.call_args[1]['params']
        # Should NOT insert into Id!
        self.assertNotIn('[Id]', call_sql)
        self.assertIn('[Code]', call_sql)
        self.assertIn('[Description]', call_sql)
        self.assertIn('INSERT INTO [TestDB].[dbo].[Products]', call_sql)
        self.assertEqual(params, ('PRD-01', 'Test Product'))


    def test_submit_changes_sqlserver_atomic(self):
        """Test submit_changes executes inserts, updates, deletes in a single committed transaction."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter.connection = mock_conn
        mock_cursor.rowcount = 1

        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'Id', 'type': 'int', 'is_pk': True, 'is_identity': True, 'is_computed': False, 'is_nullable': False},
                {'name': 'Name', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': True},
                {'name': 'Age', 'type': 'int', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': True}
            ],
            'foreign_keys': []
        }

        changes = {
            'inserts': [{'data': {'Name': 'NewUser', 'Age': 25}}],
            'updates': [{'keys': {'Id': 1}, 'original_data': {'Name': 'OldUser', 'Age': 30}, 'modified_data': {'Name': 'UpdatedUser'}}],
            'deletes': [{'keys': {'Id': 2}, 'original_data': {'Name': 'ToDelete', 'Age': 40}}]
        }

        res = TableDataEditorService.submit_changes(
            mock_adapter, 'TestDB', 'dbo', 'Users', changes
        )

        self.assertTrue(res['success'])
        self.assertEqual(res['inserted'], 1)
        self.assertEqual(res['updated'], 1)
        self.assertEqual(res['deleted'], 1)
        self.assertEqual(res['total'], 3)
        mock_conn.commit.assert_called_once()
        self.assertFalse(mock_conn.rollback.called)

    def test_submit_changes_rollback_on_conflict(self):
        """Test submit_changes rolls back if optimistic concurrency conflict occurs (rowcount == 0)."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter.connection = mock_conn
        # Simulate row was updated or deleted by another session (0 rows affected)
        mock_cursor.rowcount = 0

        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'Id', 'type': 'int', 'is_pk': True, 'is_identity': False, 'is_computed': False, 'is_nullable': False},
                {'name': 'Val', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': True}
            ],
            'foreign_keys': []
        }

        changes = {
            'updates': [{'keys': {'Id': 5}, 'original_data': {'Val': 'Original'}, 'modified_data': {'Val': 'Changed'}}]
        }

        with self.assertRaises(RuntimeError) as ctx:
            TableDataEditorService.submit_changes(
                mock_adapter, 'TestDB', 'dbo', 'Items', changes, concurrency_mode="optimistic"
            )

        self.assertIn("Xung đột ghi đè", str(ctx.exception))
        mock_conn.rollback.assert_called_once()
        self.assertFalse(mock_conn.commit.called)

    def test_submit_changes_identity_insert_sqlserver(self):
        """Test SET IDENTITY_INSERT ON / OFF is called when inserting explicit identity column values."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter.connection = mock_conn
        mock_cursor.rowcount = 1

        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'Id', 'type': 'int', 'is_pk': True, 'is_identity': True, 'is_computed': False, 'is_nullable': False},
                {'name': 'Code', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': True}
            ],
            'foreign_keys': []
        }

        changes = {
            'inserts': [{'data': {'Id': 100, 'Code': 'EXPLICIT_ID'}}]
        }

        res = TableDataEditorService.submit_changes(
            mock_adapter, 'TestDB', 'dbo', 'Products', changes
        )

        self.assertTrue(res['success'])
        executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]
        self.assertTrue(any('SET IDENTITY_INSERT [TestDB].[dbo].[Products] ON;' in s for s in executed_sqls))
        self.assertTrue(any('SET IDENTITY_INSERT [TestDB].[dbo].[Products] OFF;' in s for s in executed_sqls))

    def test_submit_changes_heap_table_null_handling(self):
        """Test Heap table (no PK) uses full-row matching with IS NULL for null values in WHERE clause."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter.connection = mock_conn
        mock_cursor.rowcount = 1

        # Table without PK
        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'ColA', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': True},
                {'name': 'ColB', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': True}
            ],
            'foreign_keys': []
        }

        changes = {
            'updates': [{
                'keys': {},
                'original_data': {'ColA': 'valA', 'ColB': None},
                'modified_data': {'ColA': 'valA_new'}
            }],
            'deletes': [{
                'keys': {},
                'original_data': {'ColA': None, 'ColB': 'valB'}
            }]
        }

        res = TableDataEditorService.submit_changes(
            mock_adapter, 'TestDB', 'dbo', 'HeapTable', changes
        )

        self.assertTrue(res['success'])
        executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]
        update_call = [s for s in executed_sqls if 'UPDATE' in s][0]
        delete_call = [s for s in executed_sqls if 'DELETE' in s][0]

        self.assertIn('[ColB] IS NULL', update_call)
        self.assertIn('[ColA] IS NULL', delete_call)

    def test_criteria_pane_default_hidden_in_js(self):
        """Verify that panesVisible.criteria is false by default in static/js/table-data-editor.js."""
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        self.assertTrue(js_path.exists())
        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()
        self.assertIn("criteria: false", js)

    def test_clean_sql_error_cleans_driver_wrapper(self):
        """Test _clean_sql_error cleans ODBC and SQL Server driver prefixes."""
        from app.services.table_data_editor_service import _clean_sql_error

        raw_err = "('23000', '[23000] [Microsoft][ODBC Driver 17 for SQL Server][SQL Server]The INSERT statement conflicted with the FOREIGN KEY constraint \"FK_Orders_Cust\". (547) (SQLExecDirectW)')"
        cleaned = _clean_sql_error(raw_err)
        self.assertEqual(cleaned, 'The INSERT statement conflicted with the FOREIGN KEY constraint "FK_Orders_Cust".')

    def test_validate_insert_rows_mixed_results(self):
        """Test validate_insert_rows tests each row in an isolated transaction that is always rolled back."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter.connection = mock_conn

        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'Id', 'type': 'int', 'is_pk': True, 'is_identity': True, 'is_computed': False, 'is_nullable': False},
                {'name': 'Name', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': False},
                {'name': 'CustId', 'type': 'int', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': False}
            ],
            'foreign_keys': []
        }

        # Row 1 succeeds, Row 2 fails (e.g. FK violation)
        def mock_execute_side_effect(sql, params=None):
            if params and 'InvalidCust' in params:
                raise Exception("[SQL Server]The INSERT statement conflicted with the FOREIGN KEY constraint. (547) (SQLExecDirectW)")
            return None

        mock_cursor.execute.side_effect = mock_execute_side_effect

        rows = [
            {'Name': 'Order1', 'CustId': 10},
            {'Name': 'InvalidCust', 'CustId': 999}
        ]

        res = TableDataEditorService.validate_insert_rows(
            mock_adapter, 'TestDB', 'dbo', 'Orders', rows
        )

        self.assertTrue(res['success'])
        self.assertEqual(res['total'], 2)
        self.assertEqual(res['valid_count'], 1)
        self.assertEqual(res['error_count'], 1)
        self.assertTrue(res['results'][0]['valid'])
        self.assertFalse(res['results'][1]['valid'])
        self.assertIn("FOREIGN KEY constraint", res['results'][1]['error'])

        # Verify transaction was rolled back for both and never committed
        self.assertFalse(mock_conn.commit.called)
        self.assertTrue(mock_conn.rollback.called)
        self.assertGreaterEqual(mock_conn.rollback.call_count, 2)

    def test_validate_insert_rows_skips_identity_and_computed(self):
        """Test validate_insert_rows skips identity and computed columns from INSERT statement."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter.connection = mock_conn

        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'Id', 'type': 'int', 'is_pk': True, 'is_identity': True, 'is_computed': False, 'is_nullable': False},
                {'name': 'RowVer', 'type': 'timestamp', 'is_pk': False, 'is_identity': False, 'is_computed': True, 'is_nullable': False},
                {'name': 'Title', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': True}
            ],
            'foreign_keys': []
        }

        rows = [{'Id': 999, 'RowVer': 'dummy', 'Title': 'Test Book'}]

        res = TableDataEditorService.validate_insert_rows(
            mock_adapter, 'TestDB', 'dbo', 'Books', rows
        )

        self.assertTrue(res['success'])
        self.assertEqual(res['valid_count'], 1)
        sql_called = mock_cursor.execute.call_args[0][0]
        params_called = mock_cursor.execute.call_args[0][1]

        self.assertNotIn('[Id]', sql_called)
        self.assertNotIn('[RowVer]', sql_called)
        self.assertIn('[Title]', sql_called)
        self.assertEqual(params_called, ('Test Book',))

    def test_multi_row_copy_and_paste_features_in_js(self):
        """Verify multi-row selection, copy, and constraint validation features are present in JS."""
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()

        self.assertIn("selectedRowIndices", js)
        self.assertIn("tde-row-selected", js)
        self.assertIn("showConstraintErrorModal", js)
        self.assertIn("/api/table-data-editor/validate-rows", js)

    def test_all_9_table_editor_enhancements(self):
        """Verify all 9 enhancements are properly integrated in code."""
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()

        # Item 1: Manual PK is NOT skipped; only identity & computed are skipped in paste
        self.assertIn("if (isIdent || isComp)", js)

        # Item 2: Column resizer and auto-fit
        self.assertIn("tde-col-resizer", js)
        self.assertIn("autoFitColumn", js)

        # Item 3: Separated cell active highlight vs input
        self.assertIn("tde-cell-active", js)

        # Item 4: Shortcuts Ctrl+N, Ctrl+C, Ctrl+V
        self.assertIn("triggerAddNewRow", js)
        self.assertIn("triggerCopy", js)
        self.assertIn("triggerPaste", js)

        # Item 5: Alt+X shortcut for Execute
        self.assertIn("Alt+X", js)

        # Item 6: Native clipboard bridge usage
        self.assertIn("ClipboardBridge", js)

        # Item 7: Custom modal popup replacing web alert/confirm
        self.assertIn("showDialogModal", js)
        self.assertNotIn("alert(`", js)
        self.assertNotIn("confirm('", js)

        # Item 8: Ctrl+R disabled in edit mode in app.js
        app_js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "app.js"
        with open(app_js_path, "r", encoding="utf-8") as f:
            app_js = f.read()
        self.assertIn("data-editor", app_js)
        self.assertIn("table-data-editor-container", app_js)

        # Item 9: Explicit columns in fetch_data
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'ColA', 'type': 'int'},
                {'name': 'ColB', 'type': 'nvarchar'}
            ],
            'foreign_keys': []
        }
        mock_adapter.execute.return_value = {'success': True, 'columns': ['ColA', 'ColB'], 'rows': [], 'row_count': 0}
        res = TableDataEditorService.fetch_data(mock_adapter, 'TestDB', 'dbo', 'TestTable')
        self.assertIn('[ColA], [ColB]', res['sql'])
        self.assertNotIn('SELECT TOP (200) *', res['sql'])

    def test_validate_row_update_and_insert(self):
        """Test TableDataEditorService.validate_row for both INSERT and UPDATE operations."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'Id', 'type': 'int', 'is_pk': True, 'is_identity': True},
                {'name': 'Code', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False},
                {'name': 'Name', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False},
            ],
            'foreign_keys': []
        }
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter.connection = mock_conn

        # 1. Test validate_row with is_new=True (INSERT)
        res_insert = TableDataEditorService.validate_row(
            adapter=mock_adapter,
            database='TestDB',
            schema='dbo',
            table='TestTable',
            values={'Code': 'NEW_CODE', 'Name': 'New Name'},
            is_new=True
        )
        self.assertTrue(res_insert['valid'])
        mock_conn.rollback.assert_called()

        # 2. Test validate_row with is_new=False (UPDATE)
        res_update = TableDataEditorService.validate_row(
            adapter=mock_adapter,
            database='TestDB',
            schema='dbo',
            table='TestTable',
            values={'Code': 'UPDATED_CODE'},
            keys={'Id': 10},
            is_new=False
        )
        self.assertTrue(res_update['valid'])
        self.assertIn("UPDATE [TestDB].[dbo].[TestTable] SET [Code] = ?", mock_cursor.execute.call_args[0][0])
        self.assertIn("WHERE [Id] = ?", mock_cursor.execute.call_args[0][0])

        # 3. Test validate_row with SQL constraint violation error
        mock_cursor.execute.side_effect = Exception("[Microsoft][ODBC Driver 17 for SQL Server][SQL Server]Violation of UNIQUE KEY constraint 'UQ_Code'. Cannot insert duplicate key in object 'dbo.TestTable'. The duplicate key value is (EXISTING).")
        res_error = TableDataEditorService.validate_row(
            adapter=mock_adapter,
            database='TestDB',
            schema='dbo',
            table='TestTable',
            values={'Code': 'EXISTING'},
            keys={'Id': 11},
            is_new=False
        )
        self.assertFalse(res_error['valid'])
        self.assertIn("Violation of UNIQUE KEY constraint", res_error['error'])
        # Driver wrappers should be stripped
        self.assertNotIn("ODBC Driver 17", res_error['error'])

    def test_css_no_cell_stretch_and_error_border(self):
        """Verify CSS contains absolute positioning to prevent stretching and error border styling."""
        css_path = Path(__file__).resolve().parent.parent / "static" / "css" / "table-data-editor.css"
        with open(css_path, "r", encoding="utf-8") as f:
            css = f.read()

        # Item 1: No stretch - position absolute inside td
        self.assertIn(".tde-cell-input", css)
        self.assertIn("position: absolute", css)
        self.assertIn(".tde-grid-table td", css)
        self.assertIn("position: relative", css)

        # Item 3: Error cell border and badge
        self.assertIn(".tde-cell-error", css)
        self.assertIn("#ff5c5c", css)
        self.assertIn(".tde-cell-error-badge", css)

    def test_js_five_enhancements_integrated(self):
        """Verify the 5 specific user enhancements exist in table-data-editor.js."""
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()

        # Item 1: colgroup with explicit widths
        self.assertIn("<colgroup>", js)

        # Item 2: navigation keys during edit
        self.assertIn("moveToCellAndEdit", js)

        # Item 3: constraint warning modal and error badge
        self.assertIn("showRowConstraintWarningModal", js)
        self.assertIn("cleanSqlErrorMessage", js)
        self.assertIn("revertCellEdit", js)
        self.assertIn("tde-cell-error-badge", js)

        # Item 4: isRuleColumn helper
        self.assertIn("function isRuleColumn", js)

        # Item 5: multiline formatted SQL
        self.assertIn("join(',\\n')", js)

    def test_identity_and_computed_columns_ssms_behavior(self):
        """Verify SSMS-style behavior for Identity and Computed columns: skipped during paste/validate/submit."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter.connection = mock_conn
        mock_cursor.rowcount = 1

        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'Id', 'type': 'int', 'is_pk': True, 'is_identity': True, 'is_computed': False, 'is_nullable': False},
                {'name': 'Code', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': False},
                {'name': 'Total', 'type': 'decimal', 'is_pk': False, 'is_identity': False, 'is_computed': True, 'is_nullable': True}
            ],
            'foreign_keys': []
        }

        # 1. validate_insert_rows: when pasting whole row with Id and Total, they must be stripped
        rows_to_validate = [
            {'id': 101, 'CODE': 'PRODUCT_A', 'total': 500},
            {'id': '<Auto>', 'code': 'PRODUCT_B', 'Total': '<Computed>'}
        ]
        val_res = TableDataEditorService.validate_insert_rows(
            mock_adapter, 'TestDB', 'dbo', 'Products', rows_to_validate
        )
        self.assertTrue(val_res['success'])
        self.assertEqual(val_res['total'], 2)
        # Verify the SQL executed inside validate_insert_rows only contained Code
        executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]
        for sql in executed_sqls:
            if 'INSERT INTO' in sql:
                self.assertIn('[code]', sql.lower())
                self.assertNotIn('[id]', sql.lower())
                self.assertNotIn('[total]', sql.lower())

        mock_cursor.execute.reset_mock()

        # 2. submit_changes: when inserting new row where Id is '<Auto>' or empty
        changes = {
            'inserts': [
                {'data': {'Id': '<Auto>', 'Code': 'NEW_ITEM', 'Total': '<Computed>'}}
            ]
        }
        sub_res = TableDataEditorService.submit_changes(
            mock_adapter, 'TestDB', 'dbo', 'Products', changes
        )
        self.assertTrue(sub_res['success'])
        executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]
        # Must NOT enable IDENTITY_INSERT for auto-generated rows
        self.assertFalse(any('SET IDENTITY_INSERT' in s for s in executed_sqls))
        # SQL must insert only [Code]
        insert_sqls = [s for s in executed_sqls if 'INSERT INTO' in s]
        self.assertTrue(len(insert_sqls) > 0)
        for sql in insert_sqls:
            self.assertIn('[Code]', sql)
            self.assertNotIn('[Id]', sql)
            self.assertNotIn('[Total]', sql)

        # 3. Frontend checks
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()
        self.assertIn("isIdentityColumn", js)
        self.assertIn("isComputedColumn", js)
        self.assertIn("tde-auto-tag", js)
        self.assertIn("tde-computed-tag", js)
        self.assertIn("tde-cell-readonly", js)

        css_path = Path(__file__).resolve().parent.parent / "static" / "css" / "table-data-editor.css"
        with open(css_path, "r", encoding="utf-8") as f:
            css = f.read()
        self.assertIn(".tde-auto-tag", css)
        self.assertIn(".tde-computed-tag", css)
        self.assertIn(".tde-cell-readonly", css)

    def test_manual_pk_and_sequence_enhancements(self):
        """Verify Sequence recognition and Manual PK handling in TableDataEditorService and JS."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'ManualId', 'type': 'int', 'is_pk': True, 'is_identity': False, 'is_computed': False, 'is_nullable': False},
                {'name': 'SeqCode', 'type': 'int', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': False, 'default_value': "NEXT VALUE FOR dbo.OrderSeq"},
                {'name': 'Name', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_computed': False, 'is_nullable': True}
            ],
            'foreign_keys': []
        }

        meta = TableDataEditorService.get_metadata(mock_adapter, 'TestDB', 'dbo', 'Orders')
        self.assertIn('SeqCode', meta.get('sequence_columns', []))
        self.assertNotIn('SeqCode', meta.get('identity_columns', []))
        self.assertIn('ManualId', meta.get('pk_columns', []))

        # JS checks
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()
        self.assertIn("isSequenceColumn", js)
        self.assertIn("isPkColumn", js)
        self.assertIn("<Seq>", js)

    def test_validate_row_composite_unique_and_not_null(self):
        """Verify targeted constraint checking: composite unique doesn't trigger until all columns filled; NOT NULL catches empty values."""
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'OrgId', 'type': 'int', 'is_pk': False, 'is_identity': False, 'is_nullable': False},
                {'name': 'DeptCode', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_nullable': False},
                {'name': 'Title', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_nullable': True}
            ],
            'uniques': [
                {'name': 'UQ_Org_Dept', 'fields': ['OrgId', 'DeptCode']}
            ],
            'foreign_keys': []
        }
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter.connection = mock_conn

        # 1. NOT NULL check: empty OrgId
        res_nn = TableDataEditorService.validate_row(
            adapter=mock_adapter,
            database='TestDB',
            schema='dbo',
            table='Departments',
            values={'OrgId': None, 'DeptCode': 'HR'},
            target_column='OrgId',
            is_new=True
        )
        self.assertFalse(res_nn['valid'])
        self.assertEqual(res_nn['constraint_type'], 'NOT_NULL')
        self.assertEqual(res_nn['columns'], ['OrgId'])

        # 2. Composite unique: only OrgId provided, DeptCode is missing -> must NOT query DB or trigger error
        res_partial = TableDataEditorService.validate_row(
            adapter=mock_adapter,
            database='TestDB',
            schema='dbo',
            table='Departments',
            values={'OrgId': 10},
            target_column='OrgId',
            is_new=True
        )
        self.assertTrue(res_partial['valid'])
        executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]
        self.assertFalse(any("Departments" in s for s in executed_sqls))

        # 3. Composite unique: all columns filled -> queries DB, finds duplicate -> returns violation
        mock_cursor.fetchone.return_value = (1,)
        res_full = TableDataEditorService.validate_row(
            adapter=mock_adapter,
            database='TestDB',
            schema='dbo',
            table='Departments',
            values={'OrgId': 10, 'DeptCode': 'HR'},
            target_column='DeptCode',
            is_new=True
        )
        self.assertFalse(res_full['valid'])
        self.assertEqual(res_full['constraint_type'], 'UNIQUE KEY')
        self.assertEqual(res_full['constraint_name'], 'UQ_Org_Dept')
        self.assertEqual(res_full['columns'], ['OrgId', 'DeptCode'])

    def test_table_constraints_popover_and_modal_error_card(self):
        """Verify the '?' button, popover logic and error card styling in JS and CSS."""
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()
        self.assertIn("tde-btn-table-constraints", js)
        self.assertIn("showTableConstraintsPopover", js)
        self.assertIn("tde-table-constraints-popover", js)
        self.assertIn("applyErrorToRow", js)

        css_path = Path(__file__).resolve().parent.parent / "static" / "css" / "table-data-editor.css"
        with open(css_path, "r", encoding="utf-8") as f:
            css = f.read()
        self.assertIn(".tde-constraints-popover", css)
        self.assertIn(".tde-constraint-error-card", css)
        self.assertIn(".tde-cec-type", css)

    def test_validate_row_fast_per_cell_and_js_enter_behavior(self):
        """Verify Bug 1, 2, 3 fixes: Enter key doesn't add rows, per-cell validation is fast, and JS preserves value."""
        # 1. Verify JS features: selectCell, isTemplateRow, Enter doesn't auto-create rows
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()
        self.assertIn("function selectCell", js)
        self.assertIn("isTemplateRow", js)
        self.assertIn("selectCell(session, nextRIdx, cIdx)", js)

        # 2. Verify backend validate_row with target_column skips unrelated unique checks & trial UPDATE
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'Id', 'type': 'int', 'is_pk': True, 'is_identity': True, 'is_nullable': False},
                {'name': 'Code', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_nullable': False},
                {'name': 'Remark', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_nullable': True},
            ],
            'uniques': [{'name': 'UQ_Code', 'fields': ['Code']}],
            'foreign_keys': []
        }
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter.connection = mock_conn

        # Clear meta cache to ensure clean test state
        TableDataEditorService._meta_cache.clear()

        # When validating 'Remark' (not unique, not PK, nullable), no SELECT or UPDATE queries should run
        res = TableDataEditorService.validate_row(
            adapter=mock_adapter,
            database='TestDB',
            schema='dbo',
            table='TestTable',
            values={'Remark': 'hello world'},
            keys={'Id': 1},
            is_new=False,
            target_column='Remark'
        )
        self.assertTrue(res['valid'])
        # Ensure trial UPDATE was NOT called because target_column is not None
        executed = [call[0][0] for call in mock_cursor.execute.call_args_list if call[0]]
        self.assertFalse(any("UPDATE" in q for q in executed))

        # Check metadata cache: second call should not call get_table_design_metadata again
        call_count_before = mock_adapter.get_table_design_metadata.call_count
        TableDataEditorService.validate_row(
            adapter=mock_adapter,
            database='TestDB',
            schema='dbo',
            table='TestTable',
            values={'Remark': 'again'},
            keys={'Id': 1},
            is_new=False,
            target_column='Remark'
        )
        self.assertEqual(mock_adapter.get_table_design_metadata.call_count, call_count_before)

    def test_revert_cell_to_original_clears_error_and_highlight(self):
        """Verify that when a cell is reverted to its original value:
        1. JS checks isRevertedToOriginal and clears constraint errors + highlight.
        2. JS passes session.originalRows instead of dirty rows to getRowPkConditions.
        3. Backend unique check properly excludes current row when valid keys are provided.
        """
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()

        # Check Step 0 in commit()
        self.assertIn("isRevertedToOriginal", js)
        self.assertIn("session.originalRows[rIdx]?.[cIdx]", js)
        self.assertIn("td.classList.remove('tde-cell-error')", js)
        self.assertIn("td.classList.remove('tde-cell-dirty')", js)
        self.assertIn("origRow = (!isNewRow && session.originalRows[rIdx]) ? session.originalRows[rIdx] : session.rows[rIdx]", js)
        self.assertIn("pkConds = isNewRow ? null : getRowPkConditions(session, origRow)", js)

        # Test backend unique constraint self-match exclusion:
        mock_adapter = MagicMock()
        mock_adapter.db_type = 'sqlserver'
        mock_adapter.get_table_design_metadata.return_value = {
            'columns': [
                {'name': 'Id', 'type': 'int', 'is_pk': True, 'is_identity': False, 'is_nullable': False},
                {'name': 'Username', 'type': 'nvarchar', 'is_pk': False, 'is_identity': False, 'is_nullable': False},
            ],
            'pk_columns': ['Id'],
            'uniques': [{'name': 'UQ_Username', 'fields': ['Username']}],
            'foreign_keys': []
        }
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        # When querying DB to find duplicate excluding current row (keys={'Id': 1}):
        # Mock cursor fetchone returning None (no other row with this username)
        mock_cursor.fetchone.return_value = None
        mock_conn.cursor.return_value = mock_cursor
        mock_adapter.connection = mock_conn

        TableDataEditorService._meta_cache.clear()

        # Validating Row 1 with its original username should return valid=True
        res = TableDataEditorService.validate_row(
            adapter=mock_adapter,
            database='TestDB',
            schema='dbo',
            table='Users',
            values={'Id': 1, 'Username': 'alice'},
            keys={'Id': 1},
            is_new=False,
            target_column='Username'
        )
        self.assertTrue(res['valid'])
        # Verify query had WHERE [Username] = ? AND ([Id] != ?)
        executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list if call[0]]
        self.assertTrue(any("([Id] != ?)" in q for q in executed_sqls))

    def test_five_requested_fixes_integration(self):
        """Verify the 5 fixes requested by user:
        1. Ctrl+C / Ctrl+V row copying and pasting with tabIndex and key handlers.
        2. Sequence/Identity/Computed column protection on duplicate and copy.
        3. Highlight unique columns in red without popup modal on duplicate row.
        4. Transparent informative toast notifications for copy/duplicate/paste.
        5. Date / datetime calendar picker button + manual typing support.
        """
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()

        css_path = Path(__file__).resolve().parent.parent / "static" / "css" / "table-data-editor.css"
        with open(css_path, "r", encoding="utf-8") as f:
            css = f.read()

        # 1. Row copy & paste shortcuts and focus
        self.assertIn("container.tabIndex = 0", js)
        self.assertIn("copy-row", js)
        self.assertIn("copy-cell", js)
        self.assertIn("Ctrl+Shift+C", js)

        # 2. Sequence, Identity, and Computed excluded on duplicate
        self.assertIn("const isSeq = isSequenceColumn(session, col);", js)
        self.assertIn("if (!isIdent && !isComp && !isSeq)", js)
        self.assertIn("<Seq>", js)
        self.assertIn("<Auto>", js)

        # 3. Unique columns highlighted without popup modal on duplicate
        self.assertIn("getUniqueColumnsForDuplicate", js)
        self.assertIn("DUPLICATE_COPY::", js)
        self.assertIn("err.type !== 'DUPLICATE_COPY'", js)

        # 4. Informative toast notifications
        self.assertIn("các ô Unique", js)
        self.assertIn("bộ nhớ tạm", js)

        # 5. Calendar picker button + manual typing for date/datetime
        self.assertIn("tde-cell-date-btn", js)
        self.assertIn("tde-has-date-btn", js)
        self.assertIn("showPicker", js)
        self.assertIn(".tde-cell-date-btn", css)
        self.assertIn(".tde-has-date-btn", css)

    def test_copy_single_row_no_accumulation_and_no_duplicate_toasts(self):
        """Verify that copying a row does not accumulate previous selections or cause stacked toasts."""
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()

        # Multi-row selection is restricted only to clicking row header
        self.assertIn("if (isRowHead)", js)
        self.assertIn("// Click on any normal data cell: ALWAYS select only this single row", js)

        # Multi-row copy only occurs if row headers were explicitly selected
        self.assertIn("Boolean(session.isRowHeaderSelected) && session.selectedRowIndices && session.selectedRowIndices.size > 1", js)

        # Cleanup of document event listeners prevents duplicate toasts
        self.assertIn("session._docKeyDownHandler", js)
        self.assertIn("session._docPasteHandler", js)
        self.assertIn("e.defaultPrevented", js)

        # refreshData resets row selection state
        self.assertIn("session.selectedRowIndices = new Set([0]);", js)
        self.assertIn("session.isRowHeaderSelected = false;", js)

    def test_cell_editor_full_width_and_click_within_cell_protection(self):
        """Verify that the inline cell editor occupies 100% width and clicking within the cell does not trigger outside-blur/commit."""
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        css_path = Path(__file__).resolve().parent.parent / "static" / "css" / "table-data-editor.css"

        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()
        with open(css_path, "r", encoding="utf-8") as f:
            css = f.read()

        # 1. CSS rules for full cell width & removing table cell padding
        self.assertIn(".tde-grid-table td.tde-cell-editing", css)
        self.assertIn("padding: 0 !important;", css)
        self.assertIn(".tde-cell-editor-wrap", css)
        self.assertIn("display: flex;", css)
        self.assertIn(".tde-cell-input", css)
        self.assertIn("flex: 1 1 0%;", css)
        self.assertIn("width: 100% !important;", css)

        # 2. JS DOM construction: tde-cell-editing and tde-cell-editor-wrap
        self.assertIn("td.classList.add('tde-cell-editing')", js)
        self.assertIn("tde-cell-editor-wrap", js)
        self.assertIn("editorWrap.appendChild(input)", js)
        self.assertIn("handleWrapMousedown", js)

        # 3. JS Grid click & mousedown protection: clicking within editing cell keeps focus and does not steal focus
        self.assertIn("td.classList.contains('tde-cell-editing') || td.querySelector('.tde-cell-input')", js)
        self.assertIn("inp.setSelectionRange(len, len)", js)

        # 4. Cleanup on commit & revert
        self.assertIn("td.classList.remove('tde-cell-editing')", js)

    def test_question_mark_hover_and_popover_theme_synchronization(self):
        """Verify question mark hover styling and constraints popover are fully synchronized with the PM theme."""
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        css_path = Path(__file__).resolve().parent.parent / "static" / "css" / "table-data-editor.css"

        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()
        with open(css_path, "r", encoding="utf-8") as f:
            css = f.read()

        # 1. Question mark button hover in CSS
        self.assertIn("#tde-btn-table-constraints", css)
        self.assertIn("#tde-btn-table-constraints:hover", css)
        self.assertIn(".tde-btn--icon:hover", css)

        # 2. Popover uses PM theme variables
        self.assertIn("var(--ide-bg-context-menu", css)
        self.assertIn("html[data-bs-theme=\"light\"] .tde-constraints-popover", css)
        self.assertIn("html[data-bs-theme=\"light\"] .tde-popover-header", css)
        self.assertIn("html[data-bs-theme=\"light\"] .tde-constraint-item", css)

        # 3. Hover preview events wired in JS
        self.assertIn("btnConstraints.addEventListener('mouseenter'", js)
        self.assertIn("btnConstraints.addEventListener('mouseleave'", js)
        self.assertIn("popover.addEventListener('mouseleave'", js)

    def test_active_row_editing_highlight_no_row_number_in_toasts_and_shift_multi_selection(self):
        """Verify:
        1. When entering data (startCellEditing / cell focus / input click), the active row is highlighted via updateActiveHighlight.
        2. Notifications / toasts no longer expose row numbers such as #[dòng] or #{rowNumber}.
        3. Shift+click performs range selection across all rows and synchronizes .tde-row-selected with stale play icons cleared.
        """
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        css_path = Path(__file__).resolve().parent.parent / "static" / "css" / "table-data-editor.css"

        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()
        with open(css_path, "r", encoding="utf-8") as f:
            css = f.read()

        # 1. Active row highlight when editing data
        self.assertIn("session.activeRowIndex = rIdx;", js)
        self.assertIn("updateActiveHighlight(session, container);", js)
        self.assertIn("tr.classList.toggle('active', isAct);", js)
        self.assertIn("tr.classList.toggle('tde-row-selected', isSel);", js)

        # 2. No #[dòng] or #${rowNumber} in notifications / toasts / modals
        self.assertNotIn("dòng #${copiedRowIdx + 1}", js)
        self.assertNotIn("dòng mới #${newNum}", js)
        self.assertNotIn("thay đổi của dòng #${rIdx + 1}", js)
        self.assertNotIn("<strong>#${rowNumber}</strong>", js)
        self.assertIn("✓ Đã sao chép dòng vào bộ nhớ tạm", js)
        self.assertIn("✓ Đã dán thành công dòng mới", js)
        self.assertIn("✓ Đã tạo bản sao dòng mới", js)
        self.assertIn("Đã hoàn tác toàn bộ thay đổi của dòng", js)

        # 3. Shift+click multi-row selection and highlighting
        self.assertIn("if (e.shiftKey)", js)
        self.assertIn("session.selectedRowIndices.add(i);", js)
        self.assertIn("isSel = Boolean(session.selectedRowIndices && session.selectedRowIndices.has(r));", js)
        self.assertIn("rowHead.innerHTML = '<i class=\"fa-solid fa-play text-primary\"", js)
        self.assertIn(".tde-grid-table tr.tde-row-selected td", css)

    def test_column_header_min_width_and_column_filter_feature(self):
        """Verify:
        1. Minimum column width is determined dynamically by the column header title/controls
           via getColumnHeaderMinWidth, allowing short columns to shrink down to their header text.
        2. Column resizer bounds dragging by minW instead of hardcoded 50/120px, and updates td.style.minWidth.
        3. Column headers contain filter buttons (.tde-th-filter-btn) with .tde-th-content layout.
        4. Column filter popover (.tde-col-filter-popover) supports operator condition filters and distinct values checklist.
        5. Filter bar (.tde-filter-active-bar) provides clear all filters functionality and summary.
        6. CSS defines styling for filter popover, active states, and row filtering display: none !important.
        """
        js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "table-data-editor.js"
        css_path = Path(__file__).resolve().parent.parent / "static" / "css" / "table-data-editor.css"

        with open(js_path, "r", encoding="utf-8") as f:
            js = f.read()
        with open(css_path, "r", encoding="utf-8") as f:
            css = f.read()

        # 1. Dynamic header min-width
        self.assertIn("function getColumnHeaderMinWidth(session, colName)", js)
        self.assertIn("const minW = getColumnHeaderMinWidth(session, col);", js)
        self.assertIn("min-width: ${minW}px", js)
        self.assertIn("const minW = getColumnHeaderMinWidth(session, colName);", js)
        self.assertIn("const newW = Math.max(minW, startWidth + diff);", js)

        # 2. Column filter button in headers
        self.assertIn("class=\"tde-th-filter-btn", js)
        self.assertIn("showColumnFilterPopover(session, colName, cIdx, btn, container)", js)
        self.assertIn("applyColumnFilters(session, container)", js)
        self.assertIn("checkFilterMatch(val, filterRule)", js)
        self.assertIn("updateFilterStatusBanner(session, container, filterKeys, hiddenCount)", js)

        # 3. Filter active bar and clear all filters
        self.assertIn("tde-filter-active-bar", js)
        self.assertIn("tde-btn-clear-all-filters", js)

        # 4. CSS rules (anti-squish & lazy sentinel)
        self.assertIn(".tde-th-filter-btn", css)
        self.assertIn(".tde-filter-active", css)
        self.assertIn(".tde-row-filtered-out", css)
        self.assertIn(".tde-col-filter-popover", css)
        self.assertIn(".tde-filter-active-bar", css)
        self.assertIn("flex-shrink: 0;", css)
        self.assertIn("min-height: 25px;", css)
        self.assertIn(".tde-cfp-lazy-sentinel", css)

        # 5. Lazy loading infinite scroll in JS
        self.assertIn("renderNextBatch", js)
        self.assertIn("valuesList.addEventListener('scroll'", js)
        self.assertIn("activeFilteredList.slice(renderedCount, renderedCount + PAGE_SIZE)", js)


if __name__ == '__main__':
    unittest.main()



