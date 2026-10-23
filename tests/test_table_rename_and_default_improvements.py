import unittest
from unittest.mock import MagicMock
from app.services.table_designer_service import TableDesignerService
from app.services.metadata_service import MetadataService
from app.api.designer_api import DesignerApiMixin


class TestTableRenameAndDefaultImprovements(unittest.TestCase):

    def test_sqlserver_column_rename(self):
        orig = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Employees",
            "columns": [
                {"name": "EmpId", "type": "int", "is_pk": True},
                {"name": "OldMobile", "type": "varchar", "size": "20", "nullable": True}
            ],
            "indexes": [],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": []
        }

        mod = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Employees",
            "columns": [
                {"name": "EmpId", "type": "int", "is_pk": True},
                {"name": "Phone", "original_name": "OldMobile", "type": "varchar", "size": "20", "nullable": True}
            ],
            "indexes": [],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": []
        }

        diff = TableDesignerService.generate_diff(orig, mod)
        sqls = [s["sql"] for s in diff["statements"]]
        full_sql = "\n".join(sqls)

        # Must generate sp_rename
        self.assertTrue(any("sp_rename" in s and "OldMobile" in s and "Phone" in s for s in sqls), f"sp_rename missing in {sqls}")
        self.assertIn("EXEC sp_rename @objname = N'[dbo].[Employees].[OldMobile]', @newname = N'Phone', @objtype = N'COLUMN';", full_sql)

        # Must NOT drop or add column
        self.assertFalse(any("drop column" in s.lower() for s in sqls), f"Should not drop column: {sqls}")
        self.assertFalse(any("add [phone]" in s.lower() for s in sqls), f"Should not add column: {sqls}")

    def test_postgresql_column_rename(self):
        orig = {
            "engine": "postgresql",
            "schema": "public",
            "table": "users",
            "columns": [
                {"name": "id", "type": "int", "is_pk": True},
                {"name": "old_email", "type": "varchar", "size": "100", "nullable": True}
            ],
            "indexes": [],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": []
        }

        mod = {
            "engine": "postgresql",
            "schema": "public",
            "table": "users",
            "columns": [
                {"name": "id", "type": "int", "is_pk": True},
                {"name": "email_address", "original_name": "old_email", "type": "varchar", "size": "100", "nullable": True}
            ],
            "indexes": [],
            "foreign_keys": [],
            "uniques": [],
            "checks": [],
            "triggers": []
        }

        diff = TableDesignerService.generate_diff(orig, mod)
        sqls = [s["sql"] for s in diff["statements"]]
        full_sql = "\n".join(sqls)

        self.assertTrue(any("rename column \"old_email\" to \"email_address\"" in s.lower() for s in sqls), f"Missing rename column in {sqls}")
        self.assertFalse(any("drop column" in s.lower() for s in sqls))
        self.assertFalse(any("add \"email_address\"" in s.lower() for s in sqls))

    def test_column_rename_combined_with_alter_type(self):
        orig = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Products",
            "columns": [
                {"name": "Id", "type": "int", "is_pk": True},
                {"name": "LegacyCode", "type": "varchar", "size": "20", "nullable": True}
            ]
        }

        mod = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Products",
            "columns": [
                {"name": "Id", "type": "int", "is_pk": True},
                {"name": "SkuCode", "original_name": "LegacyCode", "type": "nvarchar", "size": "50", "nullable": False}
            ]
        }

        diff = TableDesignerService.generate_diff(orig, mod)
        sqls = [s["sql"] for s in diff["statements"]]

        # Both rename and alter column should exist
        rename_idx = next(i for i, s in enumerate(sqls) if "sp_rename" in s)
        alter_idx = next(i for i, s in enumerate(sqls) if "alter column [SkuCode]" in s)

        # Rename MUST precede alter column
        self.assertLess(rename_idx, alter_idx)
        self.assertIn("alter column [SkuCode] nvarchar(50) not null;", sqls[alter_idx])

    def test_format_default_value_variants(self):
        # Raw string literal without quotes
        self.assertEqual(TableDesignerService.format_default_value("active", "varchar", "sqlserver"), "'active'")
        self.assertEqual(TableDesignerService.format_default_value("active", "varchar", "postgresql"), "'active'")

        # String with single quotes already
        self.assertEqual(TableDesignerService.format_default_value("'active'", "varchar", "sqlserver"), "'active'")

        # Numeric values
        self.assertEqual(TableDesignerService.format_default_value("100", "int", "sqlserver"), "100")
        self.assertEqual(TableDesignerService.format_default_value("'100'", "decimal", "sqlserver"), "100")
        self.assertEqual(TableDesignerService.format_default_value("(0)", "int", "sqlserver"), "0")

        # System functions (should not be double quoted)
        self.assertEqual(TableDesignerService.format_default_value("GETDATE()", "datetime", "sqlserver"), "GETDATE()")
        self.assertEqual(TableDesignerService.format_default_value("(getdate())", "datetime", "sqlserver"), "(getdate())")
        self.assertEqual(TableDesignerService.format_default_value("gen_random_uuid()", "uuid", "postgresql"), "gen_random_uuid()")
        self.assertEqual(TableDesignerService.format_default_value("CURRENT_TIMESTAMP", "timestamptz", "postgresql"), "CURRENT_TIMESTAMP")

        # Boolean and bit
        self.assertEqual(TableDesignerService.format_default_value("true", "bit", "sqlserver"), "((1))")
        self.assertEqual(TableDesignerService.format_default_value("false", "bit", "sqlserver"), "((0))")
        self.assertEqual(TableDesignerService.format_default_value("true", "boolean", "postgresql"), "true")
        self.assertEqual(TableDesignerService.format_default_value("false", "boolean", "postgresql"), "false")

    def test_script_object_table_alter_templates(self):
        # SQL Server
        mock_conn_ss = MagicMock()
        mock_conn_ss.adapter.db_type = "sqlserver"
        mock_conn_ss.connection_id = "test_ss"
        svc_ss = MetadataService(mock_conn_ss)

        sql_ss = svc_ss.script_object("TestDb", "dbo", "Customers", object_type="table", action="ALTER")
        self.assertIn("Script Table as ALTER: [dbo].[Customers]", sql_ss)
        self.assertIn("ALTER TABLE [dbo].[Customers]", sql_ss)
        self.assertIn("ADD [NewColumn] VARCHAR(100) NULL;", sql_ss)
        self.assertIn("EXEC sp_rename", sql_ss)
        self.assertIn("GO", sql_ss)

        # PostgreSQL
        mock_conn_pg = MagicMock()
        mock_conn_pg.adapter.db_type = "postgresql"
        mock_conn_pg.connection_id = "test_pg"
        svc_pg = MetadataService(mock_conn_pg)

        sql_pg = svc_pg.script_object("testdb", "public", "customers", object_type="table", action="ALTER")
        self.assertIn("Script Table as ALTER: \"public\".\"customers\"", sql_pg)
        self.assertIn("ALTER TABLE \"public\".\"customers\"", sql_pg)
        self.assertIn("ADD COLUMN \"NewColumn\" VARCHAR(100);", sql_pg)
        self.assertIn("RENAME COLUMN", sql_pg)

    def test_apply_table_design_filters_transaction_markers(self):
        class DummyApi(DesignerApiMixin):
            def __init__(self, conn):
                self._conn = conn
            def _get_connection(self, cid):
                return self._conn

        mock_conn = MagicMock()
        mock_conn.read_only = False
        api = DummyApi(mock_conn)

        migration_sql_with_trans = """
        BEGIN TRANSACTION;
        SET XACT_ABORT ON;
        GO
        ALTER TABLE [dbo].[Orders] ADD [Notes] NVARCHAR(200) NULL;
        GO
        COMMIT TRANSACTION;
        GO
        """

        res = api.apply_table_design("dummy_conn", "TestDb", migration_sql=migration_sql_with_trans)
        self.assertTrue(res["success"])

        # execute_migration_transaction should be called with only the DDL batch!
        mock_conn.adapter.execute_migration_transaction.assert_called_once()
        passed_batches = mock_conn.adapter.execute_migration_transaction.call_args[0][0]
        self.assertEqual(len(passed_batches), 1)
        self.assertIn("ALTER TABLE [dbo].[Orders] ADD [Notes] NVARCHAR(200) NULL", passed_batches[0])


    def test_computed_columns_create_table(self):
        # SQL Server computed column
        col_mssql = {
            "name": "Total",
            "type": "decimal",
            "is_computed": True,
            "formula": "[Qty] * [Price]",
            "is_persisted": True
        }
        col_def_mssql = TableDesignerService.generate_column_def(col_mssql, "sqlserver")
        self.assertEqual(col_def_mssql, "[Total] AS ([Qty] * [Price]) PERSISTED")

        # PostgreSQL generated column
        col_pg = {
            "name": "total",
            "type": "numeric",
            "size": "12",
            "scale": "2",
            "is_computed": True,
            "formula": "\"qty\" * \"price\""
        }
        col_def_pg = TableDesignerService.generate_column_def(col_pg, "postgresql")
        self.assertEqual(col_def_pg, "\"total\" numeric(12, 2) GENERATED ALWAYS AS (\"qty\" * \"price\") STORED")

    def test_table_and_column_comments_create_table(self):
        meta_mssql = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Articles",
            "comment": "Store articles data",
            "columns": [
                {"name": "Id", "type": "int", "is_pk": True},
                {"name": "Title", "type": "nvarchar", "size": "200", "comment": "Article title"}
            ]
        }
        stmts_mssql = TableDesignerService.generate_create_table_statements(meta_mssql)
        full_mssql = "\n".join(stmts_mssql)
        self.assertIn("sp_addextendedproperty", full_mssql)
        self.assertIn("@value = N'Store articles data'", full_mssql)
        self.assertIn("@value = N'Article title'", full_mssql)

        meta_pg = {
            "engine": "postgresql",
            "schema": "public",
            "table": "articles",
            "comment": "Store articles data",
            "columns": [
                {"name": "id", "type": "int", "is_pk": True},
                {"name": "title", "type": "varchar", "size": "200", "comment": "Article title"}
            ]
        }
        stmts_pg = TableDesignerService.generate_create_table_statements(meta_pg)
        full_pg = "\n".join(stmts_pg)
        self.assertIn("COMMENT ON TABLE \"public\".\"articles\" IS 'Store articles data';", full_pg)
        self.assertIn("COMMENT ON COLUMN \"public\".\"articles\".\"title\" IS 'Article title';", full_pg)

    def test_comments_diff_update_and_drop(self):
        # SQL Server diff comments
        orig_mssql = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Docs",
            "comment": "Old doc table comment",
            "columns": [
                {"name": "Id", "type": "int", "is_pk": True, "comment": "Document identifier"},
                {"name": "Content", "type": "nvarchar", "size": "max", "comment": "To be removed comment"}
            ]
        }
        mod_mssql = {
            "engine": "sqlserver",
            "schema": "dbo",
            "table": "Docs",
            "comment": "New doc table comment",
            "columns": [
                {"name": "Id", "type": "int", "is_pk": True, "comment": "Updated document ID"},
                {"name": "Content", "type": "nvarchar", "size": "max", "comment": ""}
            ]
        }
        diff_mssql = TableDesignerService.generate_diff(orig_mssql, mod_mssql)
        sqls_mssql = [s["sql"] for s in diff_mssql["statements"]]
        full_diff_mssql = "\n".join(sqls_mssql)

        self.assertIn("New doc table comment", full_diff_mssql)
        self.assertIn("Updated document ID", full_diff_mssql)
        self.assertIn("sp_dropextendedproperty", full_diff_mssql)

        # PostgreSQL diff comments
        orig_pg = {
            "engine": "postgresql",
            "schema": "public",
            "table": "docs",
            "comment": "Old doc comment",
            "columns": [
                {"name": "id", "type": "int", "is_pk": True, "comment": "Old id comment"}
            ]
        }
        mod_pg = {
            "engine": "postgresql",
            "schema": "public",
            "table": "docs",
            "comment": "",
            "columns": [
                {"name": "id", "type": "int", "is_pk": True, "comment": "New id comment"}
            ]
        }
        diff_pg = TableDesignerService.generate_diff(orig_pg, mod_pg)
        sqls_pg = [s["sql"] for s in diff_pg["statements"]]
        full_diff_pg = "\n".join(sqls_pg)

        self.assertIn("COMMENT ON TABLE \"public\".\"docs\" IS NULL;", full_diff_pg)
        self.assertIn("COMMENT ON COLUMN \"public\".\"docs\".\"id\" IS 'New id comment';", full_diff_pg)

    def test_postgresql_serial_alter_type_normalization(self):
        orig = {
            "engine": "postgresql",
            "schema": "public",
            "table": "metrics",
            "columns": [
                {"name": "id", "type": "smallint", "is_pk": True}
            ]
        }
        mod = {
            "engine": "postgresql",
            "schema": "public",
            "table": "metrics",
            "columns": [
                {"name": "id", "type": "bigserial", "is_pk": True}
            ]
        }
        diff = TableDesignerService.generate_diff(orig, mod)
        sqls = [s["sql"] for s in diff["statements"]]
        full_sql = "\n".join(sqls)

        # Must NOT generate "alter column "id" type bigserial"
        self.assertNotIn("type bigserial", full_sql)
        # Must normalize to bigint
        self.assertIn("alter column \"id\" type bigint using \"id\"::bigint;", full_sql)


if __name__ == "__main__":
    unittest.main()

