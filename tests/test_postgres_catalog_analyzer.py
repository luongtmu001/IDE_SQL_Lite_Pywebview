import unittest
from unittest.mock import MagicMock
from app.services.postgres_dependency.catalog_analyzer import PostgresCatalogAnalyzer
from app.services.postgres_dependency.models import (
    ObjectType,
    RelationType,
    DependencyType,
    Confidence,
    DependencySource,
    GraphDirection
)


class TestPostgresCatalogAnalyzer(unittest.TestCase):
    def setUp(self):
        self.mock_adapter = MagicMock()
        self.analyzer = PostgresCatalogAnalyzer(self.mock_adapter)

    def test_resolve_column_found(self):
        self.mock_adapter.execute.return_value = {
            "columns": [{"name": "table_oid"}, {"name": "table_name"}, {"name": "schema_name"},
                        {"name": "relkind"}, {"name": "attnum"}, {"name": "column_name"},
                        {"name": "data_type"}, {"name": "is_pk"}],
            "rows": [
                [16452, "b30_customer", "public", "r", 2, "customer_id", "bigint", True]
            ]
        }

        col = self.analyzer.resolve_column("public", "b30_customer", "customer_id")
        self.assertIsNotNone(col)
        self.assertEqual(col["table_oid"], 16452)
        self.assertEqual(col["column_name"], "customer_id")
        self.assertTrue(col["is_pk"])

    def test_get_column_dependents_full_graph(self):
        def mock_execute(sql, params=None, database=None):
            sql_clean = " ".join(sql.split())
            if "pg_attribute a" in sql_clean:
                # Column resolve
                return {
                    "columns": [{"name": "table_oid"}, {"name": "table_name"}, {"name": "schema_name"},
                                {"name": "relkind"}, {"name": "attnum"}, {"name": "column_name"},
                                {"name": "data_type"}, {"name": "is_pk"}],
                    "rows": [[10001, "customer", "public", "r", 1, "id", "integer", True]]
                }
            elif "pg_depend d" in sql_clean and "ev_class" in sql_clean:
                # View dependents
                return {
                    "columns": [{"name": "view_oid"}, {"name": "view_name"}, {"name": "schema_name"}, {"name": "relkind"}],
                    "rows": [
                        [20001, "v_active_customer", "public", "v"],
                        [20002, "mv_customer_summary", "public", "m"]
                    ]
                }
            elif "pg_constraint con" in sql_clean and "con.contype = 'f'" in sql_clean:
                # Foreign keys
                return {
                    "columns": [{"name": "con_oid"}, {"name": "conname"}, {"name": "src_schema"}, {"name": "src_table"},
                                {"name": "confrelid"}, {"name": "conrelid"}],
                    "rows": [
                        [30001, "fk_orders_customer", "sales", "orders", 10001, 10002]
                    ]
                }
            elif "pg_index i" in sql_clean:
                # Indexes
                return {
                    "columns": [{"name": "idx_oid"}, {"name": "index_name"}, {"name": "schema_name"}],
                    "rows": [
                        [40001, "idx_customer_id", "public"]
                    ]
                }
            elif "pg_trigger t" in sql_clean:
                # Triggers
                return {
                    "columns": [{"name": "trig_oid"}, {"name": "tgname"}, {"name": "schema_name"}, {"name": "table_name"}, {"name": "tgattr"}],
                    "rows": [
                        [50001, "trg_customer_audit", "public", "customer", b"\x01\x00"]
                    ]
                }
            elif "pg_constraint con" in sql_clean and "con.contype = 'c'" in sql_clean:
                # Checks
                return {"columns": [], "rows": []}
            return {"columns": [], "rows": []}

        self.mock_adapter.execute.side_effect = mock_execute

        graph = self.analyzer.get_column_dependents("public", "customer", "id", depth_limit=1)

        self.assertIsNotNone(graph.root)
        self.assertEqual(graph.root.name, "id")
        self.assertEqual(graph.direction, GraphDirection.DEPENDENTS)

        # Check nodes
        node_types = {n.object_type for n in graph.nodes.values()}
        self.assertIn(ObjectType.COLUMN, node_types)
        self.assertIn(ObjectType.VIEW, node_types)
        self.assertIn(ObjectType.MATERIALIZED_VIEW, node_types)
        self.assertIn(ObjectType.FOREIGN_KEY, node_types)
        self.assertIn(ObjectType.INDEX, node_types)
        self.assertIn(ObjectType.TRIGGER, node_types)

        # Check edges
        relations = {e.relation for e in graph.edges}
        self.assertIn(RelationType.USES_COLUMN, relations)
        self.assertIn(RelationType.FOREIGN_KEY_TO, relations)
        self.assertIn(RelationType.HAS_INDEX, relations)
        self.assertIn(RelationType.HAS_TRIGGER, relations)

        # Check safety warning
        self.assertTrue(any(w.type == "EXTERNAL_DEPENDENCY" for w in graph.warnings))

    def test_get_object_definition(self):
        self.mock_adapter.execute.return_value = {
            "columns": [{"name": "definition"}],
            "rows": [["CREATE OR REPLACE VIEW public.v_test AS SELECT 1;"]]
        }
        defn = self.analyzer.get_object_definition(ObjectType.VIEW, "public", "v_test", oid=123)
        self.assertEqual(defn, "CREATE OR REPLACE VIEW public.v_test AS SELECT 1;")

    def test_get_table_dependents(self):
        def mock_execute(sql, params=None, database=None):
            sql_clean = " ".join(sql.split())
            if "pg_class c" in sql_clean and "pg_namespace n" in sql_clean and "LIMIT 1" in sql_clean:
                # Table resolve
                return {
                    "columns": [{"name": "oid"}, {"name": "name"}, {"name": "schema_name"}, {"name": "relkind"}],
                    "rows": [[10001, "b20customer", "public", "r"]]
                }
            elif "pg_depend d" in sql_clean and "ev_class" in sql_clean:
                # View dependents
                return {
                    "columns": [{"name": "view_oid"}, {"name": "view_name"}, {"name": "schema_name"}, {"name": "relkind"}],
                    "rows": [[20001, "v_b20customer", "public", "v"]]
                }
            elif "pg_constraint con" in sql_clean and "con.contype = 'f'" in sql_clean:
                # FK
                return {
                    "columns": [{"name": "con_oid"}, {"name": "conname"}, {"name": "src_schema"}, {"name": "src_table"},
                                {"name": "src_table_oid"}, {"name": "confrelid"}, {"name": "conrelid"}],
                    "rows": [[30001, "fk_order_customer", "public", "orders", 10002, 10001, 10002]]
                }
            elif "pg_trigger t" in sql_clean:
                return {
                    "columns": [{"name": "trig_oid"}, {"name": "tgname"}, {"name": "schema_name"}, {"name": "table_name"}, {"name": "tgattr"}],
                    "rows": [[50001, "trg_customer_audit", "public", "b20customer", None]]
                }
            elif "pg_index i" in sql_clean:
                return {
                    "columns": [{"name": "idx_oid"}, {"name": "index_name"}, {"name": "schema_name"}],
                    "rows": [[40001, "idx_customer_code", "public"]]
                }
            return {"columns": [], "rows": []}

        self.mock_adapter.execute.side_effect = mock_execute
        graph = self.analyzer.get_table_dependents("public", "b20customer", depth_limit=1)

        self.assertIsNotNone(graph.root)
        self.assertEqual(graph.root.name, "b20customer")
        self.assertEqual(graph.direction, GraphDirection.DEPENDENTS)

        node_types = {n.object_type for n in graph.nodes.values()}
        self.assertIn(ObjectType.TABLE, node_types)
        self.assertIn(ObjectType.VIEW, node_types)
        self.assertIn(ObjectType.FOREIGN_KEY, node_types)
        self.assertIn(ObjectType.TRIGGER, node_types)
        self.assertIn(ObjectType.INDEX, node_types)

    def test_get_table_dependencies(self):
        def mock_execute(sql, params=None, database=None):
            sql_clean = " ".join(sql.split())
            if "pg_class c" in sql_clean and "pg_namespace n" in sql_clean and "LIMIT 1" in sql_clean:
                return {
                    "columns": [{"name": "oid"}, {"name": "name"}, {"name": "schema_name"}, {"name": "relkind"}],
                    "rows": [[10001, "b20customer", "public", "r"]]
                }
            elif "pg_constraint con" in sql_clean and "con.contype = 'f'" in sql_clean:
                return {
                    "columns": [{"name": "con_oid"}, {"name": "conname"}, {"name": "target_schema"}, {"name": "target_table"},
                                {"name": "target_oid"}, {"name": "confrelid"}, {"name": "conrelid"}],
                    "rows": [[30001, "fk_customer_group", "public", "b10group", 10000, 10000, 10001]]
                }
            elif "pg_depend d" in sql_clean and "s.relkind = 'S'" in sql_clean:
                return {
                    "columns": [{"name": "seq_oid"}, {"name": "seq_name"}, {"name": "schema_name"}],
                    "rows": [[60001, "b20customer_id_seq", "public"]]
                }
            return {"columns": [], "rows": []}

        self.mock_adapter.execute.side_effect = mock_execute
        graph = self.analyzer.get_table_dependencies("public", "b20customer", depth_limit=1)

        self.assertIsNotNone(graph.root)
        self.assertEqual(graph.direction, GraphDirection.DEPENDENCIES)
        node_types = {n.object_type for n in graph.nodes.values()}
        self.assertIn(ObjectType.TABLE, node_types)
        self.assertIn(ObjectType.SEQUENCE, node_types)


if __name__ == "__main__":
    unittest.main()

