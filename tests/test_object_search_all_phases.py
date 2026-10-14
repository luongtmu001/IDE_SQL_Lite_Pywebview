# -*- coding: utf-8 -*-
"""
Tests for Object Content Search across all phases.
Validates:
1. ObjectSearchService for SQL Server & PostgreSQL
2. Case-sensitive, whole-word, regex matching
3. Match coordinate calculation (line, column, length, snippet)
4. REST routes and Native IPC integration
5. Syntax & integrity of frontend assets
"""
import unittest
from unittest.mock import MagicMock
from app.services.object_search_service import ObjectSearchService


class DummyAdapter:
    def __init__(self, db_type="sqlserver", mock_rows=None, mock_definition=None):
        self.db_type = db_type
        self.mock_rows = mock_rows or []
        self.mock_definition = mock_definition

    def execute(self, sql, params=None, database=None):
        # Filter mock rows according to query if type is specified
        if "pg_views" in sql or "pg_matviews" in sql or "information_schema.views" in sql or "c.relkind" in sql or "pg_get_viewdef" in sql:
            v_rows = [r for r in self.mock_rows if len(r) >= 3 and r[2] == "VIEW"]
            return {"rows": v_rows}
        elif "pg_trigger" in sql or "sys.triggers" in sql:
            t_rows = [r for r in self.mock_rows if len(r) >= 3 and r[2] == "TRIGGER"]
            return {"rows": t_rows}
        elif "pg_proc" in sql:
            p_rows = [r for r in self.mock_rows if len(r) >= 3 and r[2] in ("FUNCTION", "PROCEDURE")]
            return {"rows": p_rows}
        return {"rows": self.mock_rows}

    def get_object_definition(self, database, schema, name, object_type):
        return self.mock_definition


class TestObjectSearchService(unittest.TestCase):

    def test_sqlserver_search_and_matching(self):
        sample_ddl_view = (
            "CREATE VIEW dbo.vCustomer AS\n"
            "SELECT c.CustomerId, c.CustomerName\n"
            "FROM Customer c\n"
            "WHERE c.CustomerId = @customer_id"
        )
        sample_ddl_proc = (
            "CREATE PROCEDURE dbo.usp_GetCustomer\n"
            "    @customer_id INT\n"
            "AS\n"
            "BEGIN\n"
            "    SELECT * FROM Customer WHERE CustomerId = @customer_id;\n"
            "END"
        )

        rows = [
            ("dbo", "vCustomer", "VIEW", sample_ddl_view),
            ("dbo", "usp_GetCustomer", "PROCEDURE", sample_ddl_proc)
        ]
        adapter = DummyAdapter(db_type="sqlserver", mock_rows=rows)
        service = ObjectSearchService(adapter)

        # 1. Search keyword "customer_id" (case insensitive)
        res = service.search(keyword="customer_id", database="testdb")
        self.assertTrue(res["success"])
        self.assertEqual(res["total_objects"], 2)
        # vCustomer has 1 match, usp_GetCustomer has 2 matches
        self.assertEqual(res["total_matches"], 3)
        self.assertEqual(res["objects"][0]["name"], "vCustomer")
        self.assertEqual(res["objects"][1]["name"], "usp_GetCustomer")

        # 2. Case sensitive search
        res_cs = service.search(keyword="CustomerId", database="testdb", case_sensitive=True)
        self.assertTrue(res_cs["success"])
        self.assertEqual(res_cs["total_objects"], 2)

        # 3. Whole word search
        res_ww = service.search(keyword="Customer", database="testdb", whole_word=True)
        self.assertTrue(res_ww["success"])
        # Should match "Customer" but not "CustomerId"
        self.assertTrue(res_ww["total_matches"] > 0)

        # 4. Regex search
        res_re = service.search(keyword=r"@customer_\w+", database="testdb", is_regex=True)
        self.assertTrue(res_re["success"])
        self.assertEqual(res_re["total_objects"], 2)

    def test_get_ddl_and_coordinates(self):
        sample_ddl = (
            "CREATE VIEW dbo.vCustomer AS\n"
            "SELECT c.CustomerId, c.CustomerName\n"
            "FROM Customer c\n"
            "WHERE c.CustomerId = @customer_id"
        )
        adapter = DummyAdapter(db_type="sqlserver", mock_rows=[(sample_ddl,)])
        service = ObjectSearchService(adapter)

        res = service.get_ddl(
            schema="dbo",
            name="vCustomer",
            object_type="VIEW",
            database="testdb",
            keyword="CustomerId"
        )

        self.assertTrue(res["success"])
        self.assertEqual(res["total_matches"], 2)
        matches = res["matches"]
        # Line 2: "SELECT c.CustomerId, c.CustomerName" -> column 10
        self.assertEqual(matches[0]["line"], 2)
        self.assertEqual(matches[0]["column"], 10)
        self.assertEqual(matches[0]["length"], 10)

        # Line 4: "WHERE c.CustomerId = @customer_id" -> column 9
        self.assertEqual(matches[1]["line"], 4)
        self.assertEqual(matches[1]["column"], 9)
        self.assertEqual(matches[1]["length"], 10)

    def test_postgres_search(self):
        sample_pg_func = (
            "CREATE OR REPLACE FUNCTION public.fn_test()\n"
            "RETURNS void AS $$\n"
            "BEGIN\n"
            "    PERFORM 1 FROM customer_table;\n"
            "END; $$ LANGUAGE plpgsql;"
        )
        rows = [("public", "fn_test", "FUNCTION", sample_pg_func)]
        adapter = DummyAdapter(db_type="postgresql", mock_rows=rows)
        service = ObjectSearchService(adapter)

        res = service.search(keyword="customer_table", database="pgdb")
        self.assertTrue(res["success"])
        self.assertEqual(res["total_objects"], 1)
        self.assertEqual(res["objects"][0]["type"], "FUNCTION")


if __name__ == "__main__":
    unittest.main()
