import unittest
from app.services.postgres_dependency.source_analyzer import PostgresSourceAnalyzer
from app.services.postgres_dependency.models import Confidence, RelationType


class TestPostgresSourceAnalyzer(unittest.TestCase):
    def test_strictly_qualified_column_reference(self):
        code = """
        CREATE OR REPLACE FUNCTION get_cust(p_id int) RETURNS text AS $$
        BEGIN
            RETURN (SELECT c.customer_name FROM public.customer c WHERE customer.customer_id = p_id);
        END;
        $$ LANGUAGE plpgsql;
        """
        res = PostgresSourceAnalyzer.analyze_source_for_column(
            code,
            target_column="customer_id",
            target_table="customer",
            object_name="get_cust"
        )
        self.assertTrue(res.is_referenced)
        self.assertEqual(res.confidence, Confidence.LIKELY)
        self.assertEqual(res.relation, RelationType.USES_COLUMN)
        self.assertTrue(len(res.snippets) > 0)

    def test_unqualified_column_reference(self):
        code = """
        CREATE OR REPLACE FUNCTION list_cust() RETURNS SETOF text AS $$
        BEGIN
            RETURN QUERY SELECT name FROM customer WHERE status = 'active' AND is_vip = true;
        END;
        $$ LANGUAGE plpgsql;
        """
        res = PostgresSourceAnalyzer.analyze_source_for_column(
            code,
            target_column="status",
            target_table="customer",
            object_name="list_cust"
        )
        self.assertTrue(res.is_referenced)
        self.assertEqual(res.confidence, Confidence.POSSIBLE)
        self.assertTrue(any(w.type == "UNQUALIFIED_REFERENCE" for w in res.warnings))

    def test_dynamic_sql_detection(self):
        code = """
        CREATE OR REPLACE FUNCTION dyn_query(p_col text) RETURNS void AS $$
        DECLARE
            v_sql text;
        BEGIN
            v_sql := format('SELECT %I FROM customer', p_col);
            EXECUTE v_sql;
        END;
        $$ LANGUAGE plpgsql;
        """
        res = PostgresSourceAnalyzer.analyze_source_for_column(
            code,
            target_column="customer_id",
            target_table="customer",
            object_name="dyn_query"
        )
        self.assertTrue(res.has_dynamic_sql)
        self.assertTrue(any(w.type == "DYNAMIC_SQL" for w in res.warnings))

    def test_commented_out_mentions_ignored(self):
        code = """
        CREATE OR REPLACE FUNCTION dummy() RETURNS void AS $$
        BEGIN
            -- customer.customer_id is deprecated
            /* SELECT customer.customer_id FROM customer */
            NULL;
        END;
        $$ LANGUAGE plpgsql;
        """
        res = PostgresSourceAnalyzer.analyze_source_for_column(
            code,
            target_column="customer_id",
            target_table="customer"
        )
        self.assertFalse(res.is_referenced)

    def test_external_dependency_detection(self):
        code = """
        CREATE OR REPLACE FUNCTION sync_remote() RETURNS void AS $$
        BEGIN
            PERFORM dblink_exec('dbname=remote_db', 'UPDATE remote_table SET synced = true');
        END;
        $$ LANGUAGE plpgsql;
        """
        res = PostgresSourceAnalyzer.analyze_source_for_column(
            code,
            target_column="any_col",
            object_name="sync_remote"
        )
        self.assertTrue(res.has_external_dependency)
        self.assertTrue(any(w.type == "EXTERNAL_DEPENDENCY" for w in res.warnings))

    def test_is_column_selected_from_table(self):
        # 1. Projecting c.id explicitly -> True
        sql_proj = "SELECT c.id, c.name FROM dbo.b20customer c JOIN orders o ON o.customer_id = c.id;"
        self.assertTrue(PostgresSourceAnalyzer.is_column_selected_from_table(sql_proj, "b20customer", "id", "dbo"))

        # 2. Only joining on c.id and not selecting c.id -> False (Crucial user requirement!)
        sql_join_only = "SELECT o.order_no, o.total FROM orders o JOIN dbo.b20customer c ON c.id = o.customer_id WHERE c.status = 'active';"
        self.assertFalse(PostgresSourceAnalyzer.is_column_selected_from_table(sql_join_only, "b20customer", "id", "dbo"))

        # 3. Where clause on id but not selected -> False
        sql_where_only = "SELECT o.total FROM orders o JOIN dbo.b20customer c ON c.id = o.customer_id WHERE c.id > 100;"
        self.assertFalse(PostgresSourceAnalyzer.is_column_selected_from_table(sql_where_only, "b20customer", "id", "dbo"))

        # 4. Selecting star c.* -> True
        sql_star = "SELECT c.*, o.order_no FROM dbo.b20customer c JOIN orders o ON o.customer_id = c.id;"
        self.assertTrue(PostgresSourceAnalyzer.is_column_selected_from_table(sql_star, "b20customer", "id", "dbo"))

        # 5. Selecting full star * -> True
        sql_full_star = "SELECT * FROM b20customer;"
        self.assertTrue(PostgresSourceAnalyzer.is_column_selected_from_table(sql_full_star, "b20customer", "id"))

        # 6. Selecting another column from b20customer but not id -> False
        sql_other_col = "SELECT c.name, c.address FROM dbo.b20customer c;"
        self.assertFalse(PostgresSourceAnalyzer.is_column_selected_from_table(sql_other_col, "b20customer", "id", "dbo"))

        # 7. Function body selecting id into var -> True
        func_sql = """
        CREATE FUNCTION get_cust() RETURNS void AS $$
        BEGIN
            SELECT c.id INTO v_id FROM dbo.b20customer c;
        END;
        $$ LANGUAGE plpgsql;
        """
        self.assertTrue(PostgresSourceAnalyzer.is_column_selected_from_table(func_sql, "b20customer", "id", "dbo"))

        # 8. Function body only joining b20customer -> False
        func_join_only = """
        CREATE FUNCTION get_cust() RETURNS void AS $$
        BEGIN
            SELECT o.total INTO v_total FROM orders o JOIN dbo.b20customer c ON c.id = o.customer_id;
        END;
        $$ LANGUAGE plpgsql;
        """
        self.assertFalse(PostgresSourceAnalyzer.is_column_selected_from_table(func_join_only, "b20customer", "id", "dbo"))


if __name__ == "__main__":
    unittest.main()
