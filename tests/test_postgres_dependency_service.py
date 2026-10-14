import unittest
from unittest.mock import MagicMock, patch
from app.services.postgres_dependency import (
    PostgresDependencyService,
    ObjectType,
    RelationType,
    GraphDirection
)


class TestPostgresDependencyService(unittest.TestCase):
    def setUp(self):
        self.mock_adapter = MagicMock()
        self.service = PostgresDependencyService(self.mock_adapter)

    def test_get_column_graph_dependents(self):
        # Mock resolve_column
        self.service.catalog.resolve_column = MagicMock(return_value={
            "table_oid": 12345,
            "table_name": "users",
            "schema_name": "public",
            "column_name": "email",
            "data_type": "text",
            "is_pk": False,
            "attnum": 2
        })

        # Mock execute returning views and routines
        def mock_execute(sql, *args, **kwargs):
            if "pg_class v" in sql:
                # View query: return 1 view that SELECTs email, and 1 view that only JOINs users
                return [
                    {
                        "view_oid": 67890,
                        "view_name": "v_user_emails",
                        "schema_name": "public",
                        "relkind": "v",
                        "definition": "SELECT u.email FROM users u;"
                    },
                    {
                        "view_oid": 67891,
                        "view_name": "v_users_joined_only",
                        "schema_name": "public",
                        "relkind": "v",
                        "definition": "SELECT o.order_id FROM orders o JOIN users u ON u.email = o.user_email;"
                    }
                ]
            elif "pg_proc p" in sql:
                # Routine query: return 1 function that SELECTs email, and 1 function that only JOINs
                return [
                    {
                        "oid": 99999,
                        "proname": "send_user_email",
                        "schema_name": "public",
                        "prokind": "f",
                        "body": "SELECT u.email FROM users u;"
                    },
                    {
                        "oid": 99998,
                        "proname": "audit_user_join_only",
                        "schema_name": "public",
                        "prokind": "f",
                        "body": "SELECT o.id FROM orders o JOIN users u ON u.email = o.user_email;"
                    }
                ]
            return []

        self.service.catalog._execute = MagicMock(side_effect=mock_execute)

        graph = self.service.get_column_graph(
            schema="public",
            table_name="users",
            column_name="email",
            direction="dependents",
            depth_limit=2,
            include_source_analysis=True
        )

        self.assertIsNotNone(graph.root)
        self.assertEqual(graph.root.name, "email")
        node_names = [n.name for n in graph.nodes.values()]

        # Objects that actually SELECT email must be present
        self.assertIn("v_user_emails", node_names)
        self.assertIn("send_user_email", node_names)

        # Objects that only JOIN without SELECTing must NOT be present
        self.assertNotIn("v_users_joined_only", node_names)
        self.assertNotIn("audit_user_join_only", node_names)

        # Check tree projection
        tree = graph.to_tree_projection()
        self.assertIsNotNone(tree)
        self.assertEqual(tree["id"], graph.root.id)
        self.assertTrue(len(tree["children"]) >= 1)

    def test_get_suggested_steps(self):
        self.service.get_column_graph = MagicMock()
        mock_graph = MagicMock()
        mock_graph.nodes = {}
        self.service.get_column_graph.return_value = mock_graph

        steps = self.service.get_suggested_steps(
            schema="public",
            table="orders",
            column="total_amount",
            action="ALTER"
        )
        self.assertTrue(len(steps) >= 3)
        self.assertEqual(steps[0]["title"], "Review Dependent Objects")
        self.assertTrue(any("ALTER" in s["description"] for s in steps))

    def test_get_object_graph_table_dependents(self):
        # Test table dependents finds views like vb20customer and routines
        self.service.catalog.resolve_object = MagicMock(return_value={
            "oid": 10001,
            "name": "b20customer",
            "schema_name": "dbo",
            "relkind": "r"
        })
        self.service.catalog._get_views_using_table = MagicMock(return_value=[
            {"view_oid": 20001, "view_name": "vb20customer", "schema_name": "dbo", "relkind": "v"}
        ])
        self.service.catalog._get_foreign_keys_referencing_table = MagicMock(return_value=[])
        self.service.catalog._get_triggers_on_table = MagicMock(return_value=[])
        self.service.catalog._get_indexes_on_table = MagicMock(return_value=[])

        def mock_execute(sql, *args, **kwargs):
            if "pg_proc" in sql:
                return [{
                    "oid": 30001,
                    "proname": "sp_update_customer",
                    "schema_name": "dbo",
                    "prokind": "p",
                    "body": "CREATE PROCEDURE sp_update_customer() AS $$ BEGIN UPDATE dbo.b20customer SET iscustomer = true; END; $$ LANGUAGE plpgsql;",
                    "defn": "CREATE PROCEDURE sp_update_customer() AS $$ BEGIN UPDATE dbo.b20customer SET iscustomer = true; END; $$ LANGUAGE plpgsql;"
                }]
            return []

        self.service.catalog._execute = mock_execute

        graph = self.service.get_object_graph(
            obj_type_str="table",
            schema="dbo",
            name="b20customer",
            direction="dependents",
            depth_limit=2,
            include_source_analysis=True
        )

        self.assertIsNotNone(graph.root)
        self.assertEqual(graph.root.name, "b20customer")
        node_names = [n.name for n in graph.nodes.values()]
        self.assertIn("vb20customer", node_names)
        self.assertIn("sp_update_customer", node_names)


if __name__ == "__main__":
    unittest.main()
