import unittest
from unittest.mock import MagicMock, patch
from app import create_app
from app.services.table_designer_service import TableDesignerService
from app.database.sqlserver import SqlServerAdapter
from app.database.postgresql import PostgreSqlAdapter


class TestTableDesigner(unittest.TestCase):

    def setUp(self):
        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()

    def test_sqlserver_create_table_ddl(self):
        meta = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Customer",
            "columns": [
                {"name": "Id", "type": "int", "size": "", "scale": "", "nullable": False, "is_pk": True, "is_identity": True},
                {"name": "CustomerCode", "type": "varchar", "size": "50", "scale": "", "nullable": False, "is_pk": False},
                {"name": "CustomerName", "type": "nvarchar", "size": "100", "scale": "", "nullable": True, "is_pk": False, "default_value": "''"},
                {"name": "Balance", "type": "decimal", "size": "18", "scale": "2", "nullable": False, "is_pk": False, "default_value": "0"}
            ],
            "indexes": [
                {"name": "IX_Customer_Code", "fields": [{"column": "CustomerCode", "desc": False}], "index_type": "NONCLUSTERED", "is_unique": True}
            ],
            "foreign_keys": [],
            "uniques": [
                {"name": "UQ_Customer_Code", "fields": ["CustomerCode"], "is_clustered": False}
            ],
            "checks": [
                {"name": "CK_Customer_Balance", "check_clause": "[Balance] >= 0"}
            ],
            "triggers": []
        }

        ddl = TableDesignerService.generate_create_table_ddl(meta)
        self.assertIn("CREATE TABLE [dbo].[Customer]", ddl)
        self.assertIn("[Id] int IDENTITY(1,1) NOT NULL", ddl)
        self.assertIn("[CustomerCode] varchar(50) NOT NULL", ddl)
        self.assertIn("[CustomerName] nvarchar(100) DEFAULT '' NULL", ddl)
        self.assertIn("[Balance] decimal(18, 2) DEFAULT 0 NOT NULL", ddl)
        self.assertIn("CONSTRAINT [PK_Customer] PRIMARY KEY CLUSTERED ([Id])", ddl)
        self.assertIn("CONSTRAINT [UQ_Customer_Code] UNIQUE ([CustomerCode])", ddl)
        self.assertIn("CONSTRAINT [CK_Customer_Balance] CHECK ([Balance] >= 0)", ddl)
        self.assertIn("CREATE UNIQUE NONCLUSTERED INDEX [IX_Customer_Code] ON [dbo].[Customer] ([CustomerCode]);", ddl)

    def test_postgresql_create_table_ddl(self):
        meta = {
            "engine": "postgresql",
            "schema": "public",
            "table": "orders",
            "columns": [
                {"name": "id", "type": "serial", "size": "", "scale": "", "nullable": False, "is_pk": True},
                {"name": "order_no", "type": "varchar", "size": "20", "scale": "", "nullable": False, "is_pk": False},
                {"name": "total", "type": "numeric", "size": "12", "scale": "2", "nullable": False, "is_pk": False, "default_value": "0.00"}
            ],
            "indexes": [
                {"name": "idx_orders_no", "fields": [{"column": "order_no", "desc": False}], "index_type": "BTREE", "is_unique": True}
            ],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": []
        }

        ddl = TableDesignerService.generate_create_table_ddl(meta)
        self.assertIn('CREATE TABLE "public"."orders"', ddl)
        self.assertIn('"id" serial NOT NULL', ddl)
        self.assertIn('"order_no" varchar(20) NOT NULL', ddl)
        self.assertIn('CONSTRAINT "PK_orders" PRIMARY KEY ("id")', ddl)
        self.assertIn('CREATE UNIQUE INDEX "idx_orders_no" ON "public"."orders" USING btree ("order_no");', ddl)

    def test_diff_generation_and_destructive_detection(self):
        orig = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Product",
            "columns": [
                {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
                {"name": "OldColumn", "type": "varchar", "size": "50", "nullable": True},
                {"name": "Price", "type": "decimal", "size": "10", "scale": "2", "nullable": True}
            ],
            "indexes": [
                {"name": "IX_Old", "fields": [{"column": "OldColumn", "desc": False}], "index_type": "NONCLUSTERED", "is_unique": False}
            ],
            "uniques": [],
            "checks": [],
            "foreign_keys": [],
            "triggers": []
        }

        mod = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Product",
            "columns": [
                {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
                # OldColumn dropped!
                {"name": "Price", "type": "decimal", "size": "18", "scale": "2", "nullable": False}, # altered
                {"name": "NewColumn", "type": "nvarchar", "size": "100", "nullable": True} # added
            ],
            "indexes": [
                # IX_Old dropped!
                {"name": "IX_New", "fields": [{"column": "NewColumn", "desc": False}], "index_type": "NONCLUSTERED", "is_unique": False}
            ],
            "uniques": [],
            "checks": [
                {"name": "CK_Price", "check_clause": "[Price] > 0"} # added check
            ],
            "foreign_keys": [],
            "triggers": []
        }

        diff = TableDesignerService.generate_diff(orig, mod)
        self.assertTrue(diff["has_destructive"])
        self.assertTrue(any("drop column OldColumn" in s["sql"] for s in diff["statements"]))
        self.assertTrue(any(s["destructive"] for s in diff["statements"] if "drop column" in s["sql"].lower()))
        self.assertTrue(any("add NewColumn nvarchar(100)" in s["sql"] for s in diff["statements"]))
        self.assertTrue(any("alter column Price decimal(18, 2) not null" in s["sql"] for s in diff["statements"]))
        self.assertTrue(any("DROP INDEX [IX_Old]" in s["sql"] for s in diff["statements"]))
        self.assertTrue(any("CREATE NONCLUSTERED INDEX [IX_New]" in s["sql"] for s in diff["statements"]))
        self.assertTrue(any("add constraint [CK_Price] check ([Price] > 0)" in s["sql"] for s in diff["statements"]))
        self.assertTrue(len(diff["warnings"]) > 0)

    def test_api_endpoints(self):
        with patch('app.routes.metadata.get_connection') as mock_get_conn:
            mock_conn = MagicMock()
            mock_conn.metadata_service.get_supported_types.return_value = {
                "engine": "sqlserver",
                "types": ["int", "varchar"],
                "collations": ["SQL_Latin1_General_CP1_CI_AS"]
            }
            mock_conn.metadata_service.get_table_design_metadata.return_value = {
                "engine": "sqlserver",
                "database": "TestDB",
                "schema": "dbo",
                "table": "Users",
                "columns": [{"name": "Id", "type": "int", "size": "", "scale": "", "nullable": False, "is_pk": True}],
                "indexes": [],
                "foreign_keys": [],
                "uniques": [],
                "checks": [],
                "triggers": []
            }
            mock_get_conn.return_value = mock_conn

            # 1. Test GET /types
            res = self.client.get('/api/metadata/c1/table-design/types')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json["data"]["engine"], "sqlserver")

            # 2. Test GET /table-design
            res = self.client.get('/api/metadata/c1/table-design?database=TestDB&schema=dbo&table=Users')
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.json["success"])
            self.assertIn("CREATE TABLE [dbo].[Users]", res.json["preview_sql"])

            # 3. Test POST /diff
            res = self.client.post('/api/metadata/c1/table-design/diff', json={
                "original": {
                    "engine": "sqlserver",
                    "schema": "dbo",
                    "table": "Users",
                    "columns": [{"name": "Id", "type": "int", "nullable": False, "is_pk": True}]
                },
                "modified": {
                    "engine": "sqlserver",
                    "schema": "dbo",
                    "table": "Users",
                    "columns": [
                        {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
                        {"name": "Username", "type": "nvarchar", "size": "50", "nullable": False}
                    ]
                }
            })
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.json["success"])
            self.assertIn("add username nvarchar(50) not null", res.json["diff"]["migration_sql"].lower())

            # 4. Test POST /apply
            res = self.client.post('/api/metadata/c1/table-design/apply', json={
                "database": "TestDB",
                "statements": [{"sql": "ALTER TABLE [dbo].[Users] ADD [Username] nvarchar(50) NOT NULL;"}]
            })
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.json["success"])
            mock_conn.adapter.execute_migration_transaction.assert_called_with(
                ["ALTER TABLE [dbo].[Users] ADD [Username] nvarchar(50) NOT NULL;"], database="TestDB"
            )
            mock_conn.metadata_service.invalidate.assert_called_once()

    def test_generate_diff_empty_has_no_changes(self):
        orig = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Product",
            "columns": [{"name": "Id", "type": "int", "nullable": False, "is_pk": True}],
            "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
        }
        mod = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Product",
            "columns": [{"name": "Id", "type": "int", "nullable": False, "is_pk": True}],
            "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
        }
        diff = TableDesignerService.generate_diff(orig, mod)
        self.assertFalse(diff["has_changes"])
        self.assertEqual(diff["migration_sql"], "")
        self.assertEqual(len(diff["statements"]), 0)

    def test_generate_diff_table_rename(self):
        # SQL Server rename
        orig_sqlserver = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "OldTable",
            "columns": [{"name": "Id", "type": "int", "nullable": False, "is_pk": True}],
            "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
        }
        mod_sqlserver = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "NewTable",
            "columns": [{"name": "Id", "type": "int", "nullable": False, "is_pk": True}],
            "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
        }
        diff_ss = TableDesignerService.generate_diff(orig_sqlserver, mod_sqlserver)
        self.assertTrue(diff_ss["has_changes"])
        self.assertTrue(any("sp_rename" in s["sql"] and "OldTable" in s["sql"] and "NewTable" in s["sql"] for s in diff_ss["statements"]))

        # PostgreSQL rename
        orig_pg = {
            "engine": "postgresql",
            "schema": "public",
            "table": "old_table",
            "columns": [{"name": "id", "type": "int4", "nullable": False, "is_pk": True}],
            "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
        }
        mod_pg = {
            "engine": "postgresql",
            "schema": "public",
            "table": "new_table",
            "columns": [{"name": "id", "type": "int4", "nullable": False, "is_pk": True}],
            "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
        }
        diff_pg = TableDesignerService.generate_diff(orig_pg, mod_pg)
        self.assertTrue(diff_pg["has_changes"])
        self.assertTrue(any("RENAME TO \"new_table\"" in s["sql"] for s in diff_pg["statements"]))

    def test_frontend_assets_rendered(self):
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)
        html = res.data.decode('utf-8')
        self.assertIn('id="table-designer-container"', html)
        self.assertIn('id="table-design-confirm-modal"', html)
        self.assertIn('/static/css/table-designer.css', html)
        self.assertIn('/static/js/table-designer.js', html)

    def test_sqlserver_adapter_get_table_design_metadata_mock(self):
        adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
        # Mock execute
        def mock_execute(sql, params=None, database=None):
            if "sys.tables o" in sql:
                return {"rows": [(123,)]}
            elif "sys.identity_columns" in sql:
                return {"rows": [
                    (1, "Id", "int", 4, 10, 0, 0, 1, 1, 1, None, None, 1, "PK Description"),
                    (2, "Name", "nvarchar", 100, 0, 0, 1, 0, 1, 1, "('guest')", "SQL_Latin1_General_CP1_CI_AS", 0, None)
                ]}
            elif "sys.indexes i" in sql and "key_constraints" not in sql:
                return {"rows": [
                    (2, "IX_Customer_Name", "NONCLUSTERED", 0, "Name", 0)
                ]}
            elif "sys.foreign_keys fk" in sql:
                return {"rows": []}
            elif "sys.key_constraints kc" in sql:
                return {"rows": []}
            elif "sys.check_constraints cc" in sql:
                return {"rows": []}
            elif "sys.triggers tr" in sql:
                return {"rows": []}
            return {"rows": []}

        adapter.execute = mock_execute
        meta = adapter.get_table_design_metadata("TestDb", "dbo", "Customer")
        self.assertIsNotNone(meta)
        self.assertEqual(meta["table"], "Customer")
        self.assertEqual(len(meta["columns"]), 2)
        self.assertTrue(meta["columns"][0]["is_pk"])
        self.assertEqual(meta["columns"][1]["size"], "50")
        self.assertEqual(meta["columns"][1]["default_value"], "'guest'")
        self.assertEqual(len(meta["indexes"]), 1)

    def test_new_table_diff_generation(self):
        new_table_meta = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "NewCustomer",
            "columns": [
                {"name": "Id", "type": "int", "size": "", "scale": "", "nullable": False, "is_pk": True, "is_identity": True},
                {"name": "Name", "type": "nvarchar", "size": "100", "scale": "", "nullable": False, "is_pk": False}
            ],
            "indexes": [
                {"name": "IX_NewCustomer_Name", "fields": [{"column": "Name", "desc": False}], "index_type": "NONCLUSTERED", "is_unique": False}
            ],
            "uniques": [],
            "checks": [],
            "foreign_keys": [],
            "triggers": []
        }
        diff = TableDesignerService.generate_diff({}, new_table_meta)
        self.assertFalse(diff["has_destructive"])
        self.assertEqual(len(diff["statements"]), 2)
        self.assertIn("CREATE TABLE [dbo].[NewCustomer]", diff["statements"][0]["sql"])
        self.assertIn("CREATE NONCLUSTERED INDEX [IX_NewCustomer_Name] ON [dbo].[NewCustomer]", diff["statements"][1]["sql"])

    def test_sqlserver_get_trigger_definition(self):
        adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
        def mock_execute(sql, params=None, database=None):
            if "sys.triggers" in sql:
                return {"rows": [("CREATE TRIGGER tr_Audit ON Customer AFTER INSERT AS BEGIN SELECT 1 END",)]}
            return {"rows": []}
        adapter.execute = mock_execute
        defn = adapter.get_object_definition("TestDb", "dbo", "tr_Audit", "trigger")
        self.assertIsNotNone(defn)
        self.assertIn("CREATE TRIGGER tr_Audit", defn)

    def test_postgresql_get_trigger_definition(self):
        adapter = PostgreSqlAdapter({'host': 'localhost', 'port': 5432, 'user': 'postgres', 'password': 'pw'})
        def mock_execute(sql, params=None, database=None, **kwargs):
            if "pg_get_triggerdef" in sql:
                return {"rows": [("CREATE TRIGGER tr_audit AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION notify();",)]}
            return {"rows": []}
        adapter.execute = mock_execute
        defn = adapter.get_object_definition("postgres", "public", "tr_audit", "trigger")
        self.assertIsNotNone(defn)
    def test_sequence_and_identity_custom_seed_increment(self):
        # SQL Server custom identity and sequence
        meta_mssql = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Invoice",
            "columns": [
                {"name": "InvoiceId", "type": "int", "size": "", "scale": "", "nullable": False, "is_pk": True, "is_identity": True, "identity_seed": 100, "identity_increment": 10},
                {"name": "SeqNumber", "type": "bigint", "size": "", "scale": "", "nullable": False, "is_pk": False, "sequence_name": "dbo.invoice_seq"}
            ],
            "indexes": [],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": []
        }
        ddl_mssql = TableDesignerService.generate_create_table_ddl(meta_mssql)
        self.assertIn("[InvoiceId] int IDENTITY(100,10) NOT NULL", ddl_mssql)
        self.assertIn("[SeqNumber] bigint DEFAULT (NEXT VALUE FOR dbo.invoice_seq) NOT NULL", ddl_mssql)

        # PostgreSQL sequence
        meta_pg = {
            "engine": "postgresql",
            "schema": "public",
            "table": "orders",
            "columns": [
                {"name": "order_id", "type": "bigint", "size": "", "scale": "", "nullable": False, "is_pk": True, "sequence_name": "orders_id_seq"}
            ],
            "indexes": [],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": []
        }
        ddl_pg = TableDesignerService.generate_create_table_ddl(meta_pg)
        self.assertIn('"order_id" bigint DEFAULT nextval(\'orders_id_seq\') NOT NULL', ddl_pg)

    def test_user_defined_types_support(self):
        adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
        def mock_execute(sql, params=None, database=None):
            if "sys.types" in sql:
                return {"rows": [("dbo", "phonenumber"), ("dbo", "zipcode")]}
            return {"rows": []}
        adapter.execute = mock_execute
        res = adapter.get_supported_types(database="SalesDB")
        self.assertIn("user_types", res)
        self.assertIn("[dbo].[phonenumber]", res["user_types"])
        self.assertIn("[dbo].[zipcode]", res["user_types"])

    def test_numeric_default_value_unquoted(self):
        col_int = {
            "name": "col1",
            "type": "int",
            "nullable": True,
            "default_value": "'-1'"  # Quoted in input
        }
        col_def = TableDesignerService.generate_column_def(col_int, "sqlserver")
        self.assertIn("[col1] int DEFAULT -1 NULL", col_def)
        self.assertNotIn("DEFAULT '-1'", col_def)

        col_dec = {
            "name": "col2",
            "type": "decimal",
            "size": "10",
            "scale": "2",
            "nullable": True,
            "default_value": "'-1.50'"
        }
        col_dec_def = TableDesignerService.generate_column_def(col_dec, "sqlserver")
        self.assertIn("[col2] decimal(10, 2) DEFAULT -1.50 NULL", col_dec_def)

    def test_error_8112_and_452_prevention(self):
        # Table with clustered PK, a UDT with collation, and an index + unique requesting CLUSTERED
        meta = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "B20Dept",
            "columns": [
                {"name": "DeptId", "type": "int", "nullable": False, "is_pk": True},
                {"name": "DeptCode", "type": "[dbo].[CodeType]", "nullable": False, "collation": "SQL_Latin1_General_CP1_CI_AS"}
            ],
            "indexes": [
                {"name": "IX_Dept", "fields": ["DeptCode"], "index_type": "CLUSTERED", "is_unique": False}
            ],
            "uniques": [
                {"name": "UQ_Dept", "fields": ["DeptCode"], "is_clustered": True}
            ],
            "foreign_keys": [],
            "checks": [],
            "triggers": []
        }
        ddl = TableDesignerService.generate_create_table_ddl(meta)

        # 1. Verify Error 452 prevention: COLLATE must NOT appear on UDT [dbo].[CodeType]
        self.assertNotIn("COLLATE", ddl)
        self.assertIn("[DeptCode] [dbo].[CodeType] NOT NULL", ddl)

        # 2. Verify Error 8112 prevention: only ONE clustered index permitted (PK is CLUSTERED, others must be NONCLUSTERED)
        self.assertIn("PRIMARY KEY CLUSTERED ([DeptId])", ddl)
        self.assertNotIn("UNIQUE CLUSTERED", ddl)
        self.assertIn("CREATE NONCLUSTERED INDEX [IX_Dept]", ddl)
        self.assertNotIn("CREATE CLUSTERED INDEX [IX_Dept]", ddl)

    def test_statement_type_tagging(self):
        meta = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "TestTbl",
            "columns": [{"name": "Id", "type": "int", "is_pk": True}],
            "indexes": [{"name": "IX_Id", "fields": ["Id"], "index_type": "NONCLUSTERED"}],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": []
        }
        diff = TableDesignerService.generate_diff({}, meta)
        self.assertEqual(len(diff["statements"]), 2)
        self.assertEqual(diff["statements"][0]["type"], "tables")
        self.assertEqual(diff["statements"][1]["type"], "indexes")

    def test_trigger_without_definition_omitted(self):
        meta = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Orders",
            "columns": [{"name": "Id", "type": "int", "is_pk": True}],
            "indexes": [],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": [
                {"name": "tr_empty", "definition": "   "},
                {"name": "tr_none", "definition": None},
                {"name": "tr_valid", "definition": "CREATE TRIGGER tr_valid ON [dbo].[Orders] AFTER INSERT AS BEGIN PRINT 'hi'; END"}
            ]
        }
        # Verify generate_create_table_statements only includes valid trigger
        stmts = TableDesignerService.generate_create_table_statements(meta)
        self.assertEqual(len(stmts), 2)
        self.assertTrue(stmts[0].startswith("CREATE TABLE"))
        self.assertTrue(stmts[1].startswith("CREATE TRIGGER tr_valid"))

        # Verify generate_diff only includes valid trigger
        diff = TableDesignerService.generate_diff({}, meta)
        trig_stmts = [s for s in diff["statements"] if s["type"] == "triggers"]
        self.assertEqual(len(trig_stmts), 1)
        self.assertEqual(trig_stmts[0]["sql"], "CREATE TRIGGER tr_valid ON [dbo].[Orders] AFTER INSERT AS BEGIN PRINT 'hi'; END")

    def test_sqlserver_migration_sql_has_go_separators(self):
        meta = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Orders",
            "columns": [{"name": "Id", "type": "int", "is_pk": True}],
            "indexes": [{"name": "IX_Id", "fields": ["Id"]}],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": [
                {"name": "tr_valid", "definition": "CREATE TRIGGER tr_valid ON [dbo].[Orders] AFTER INSERT AS BEGIN PRINT 'hi'; END"}
            ]
        }
        diff = TableDesignerService.generate_diff({}, meta)
        mig_sql = diff["migration_sql"]
        self.assertIn("\n\nGO\n\n", mig_sql)
        self.assertTrue(mig_sql.strip().endswith("GO"))

    def test_sqlserver_execute_migration_transaction_rollback(self):
        adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        adapter.connection = mock_conn

        # Simulate second statement failing
        def mock_exec(stmt):
            if "FAIL" in stmt:
                raise RuntimeError("Simulated syntax error in trigger")
        mock_cursor.execute.side_effect = mock_exec
        mock_cursor.nextset.return_value = False

        batches = ["CREATE TABLE [dbo].[T] ([Id] int);", "FAIL TRIGGER"]
        with self.assertRaises(RuntimeError):
            adapter.execute_migration_transaction(batches, database="TestDB")

        # Must have called rollback and restored autocommit = True
        mock_conn.rollback.assert_called_once()
        mock_conn.commit.assert_not_called()
        self.assertTrue(mock_conn.autocommit)

    def test_postgresql_execute_migration_transaction_rollback(self):
        adapter = PostgreSqlAdapter({'username': 'postgres', 'password': 'pw', 'host': 'localhost'})
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        adapter.connection = mock_conn

        def mock_exec(stmt):
            if "FAIL" in stmt:
                raise RuntimeError("Simulated trigger error")
        mock_cursor.execute.side_effect = mock_exec

        batches = ['CREATE TABLE "public"."t" ("id" int);', 'FAIL TRIGGER']
        with self.assertRaises(RuntimeError):
            adapter.execute_migration_transaction(batches, database="postgres")

        mock_conn.rollback.assert_called_once()
        mock_conn.commit.assert_not_called()
        self.assertTrue(mock_conn.autocommit)

    def test_apply_endpoint_with_custom_migration_sql_and_go_split(self):
        mock_conn = MagicMock()
        with patch('app.routes.metadata.get_connection', return_value=mock_conn):
            custom_sql = """
            CREATE TABLE [dbo].[Item] ([Id] int);
            GO
            CREATE TRIGGER [dbo].[tr_item] ON [dbo].[Item] AFTER INSERT AS BEGIN PRINT 1; END
            GO
            """
            res = self.client.post('/api/metadata/c1/table-design/apply', json={
                "database": "TestDB",
                "migration_sql": custom_sql
            })
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.json["success"])

            expected_batches = [
                "CREATE TABLE [dbo].[Item] ([Id] int);",
                "CREATE TRIGGER [dbo].[tr_item] ON [dbo].[Item] AFTER INSERT AS BEGIN PRINT 1; END"
            ]
            mock_conn.adapter.execute_migration_transaction.assert_called_once_with(
                expected_batches, database="TestDB"
            )

    @patch('app.database.sqlserver.pyodbc.connect')
    def test_sqlserver_connection_ssl_options(self, mock_pyodbc_connect):
        # 1. Default (Encrypt=no, TrustServerCertificate=yes)
        adapter = SqlServerAdapter({'username': 'sa', 'password': 'pw', 'server': 'localhost'})
        adapter.connect()
        conn_str_1 = mock_pyodbc_connect.call_args[0][0]
        self.assertIn("Encrypt=no;", conn_str_1)
        self.assertIn("TrustServerCertificate=yes;", conn_str_1)

        # 2. SSL/Encrypt enabled + TrustServerCertificate disabled
        adapter2 = SqlServerAdapter({
            'username': 'sa', 'password': 'pw', 'server': 'localhost',
            'encrypt': True, 'trust_server_certificate': False
        })
        adapter2.connect()
        conn_str_2 = mock_pyodbc_connect.call_args[0][0]
        self.assertIn("Encrypt=yes;", conn_str_2)
        self.assertIn("TrustServerCertificate=no;", conn_str_2)

        # 3. Windows Auth + Encrypt + TrustServerCertificate + custom port and driver
        adapter3 = SqlServerAdapter({
            'server': '192.168.1.50',
            'port': 14333,
            'driver': 'ODBC Driver 17 for SQL Server',
            'trusted_connection': True,
            'encrypt': True, 'trust_server_certificate': True
        })
        adapter3.connect()
        conn_str_3 = mock_pyodbc_connect.call_args[0][0]
        self.assertIn("DRIVER={ODBC Driver 17 for SQL Server};", conn_str_3)
        self.assertIn("SERVER=192.168.1.50,14333;", conn_str_3)
        self.assertIn("Trusted_Connection=yes;", conn_str_3)
        self.assertIn("Encrypt=yes;", conn_str_3)
        self.assertIn("TrustServerCertificate=yes;", conn_str_3)

    def test_connection_modal_contains_ssl_and_trust_cert(self):
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)
        self.assertIn(b'id="connEncrypt"', res.data)
        self.assertIn(b'id="connTrustCert"', res.data)
        self.assertIn(b'id="connSqlServerOptionsGroup"', res.data)


if __name__ == '__main__':
    unittest.main()


