import unittest
from unittest.mock import MagicMock, patch
from main import MainApi


class TestPostgresDependencyIPC(unittest.TestCase):
    def setUp(self):
        self.mock_cm = MagicMock()
        self.mock_cm._connections = {}
        self.api = MainApi(self.mock_cm)

    def test_pg_dependency_get_column_non_postgres(self):
        mock_conn = MagicMock()
        mock_conn.config = {"type": "sqlserver"}
        mock_conn.adapter.db_type = "sqlserver"
        self.mock_cm.get.return_value = mock_conn

        res = self.api.pg_dependency_get_column("conn1", "public", "customer", "id")
        self.assertFalse(res["success"])
        self.assertIn("exclusively supported for PostgreSQL", res["error"])

    def test_pg_dependency_get_column_success(self):
        mock_conn = MagicMock()
        mock_conn.config = {"type": "postgresql"}
        mock_conn.adapter.db_type = "postgresql"
        self.mock_cm.get.return_value = mock_conn

        with patch("app.services.postgres_dependency.service.PostgresDependencyService.get_column_graph") as mock_get_graph:
            mock_graph = MagicMock()
            mock_graph.to_dict.return_value = {"nodes": [], "edges": []}
            mock_graph.to_tree_projection.return_value = {"id": "root", "children": []}
            mock_get_graph.return_value = mock_graph

            res = self.api.pg_dependency_get_column("conn1", "public", "customer", "id")
            self.assertTrue(res["success"])
            self.assertIn("graph", res)
            self.assertIn("tree", res)

    def test_pg_dependency_get_definition_success(self):
        mock_conn = MagicMock()
        mock_conn.config = {"type": "postgresql"}
        mock_conn.adapter.db_type = "postgresql"
        self.mock_cm.get.return_value = mock_conn

        with patch("app.services.postgres_dependency.service.PostgresDependencyService.get_object_definition") as mock_get_def:
            mock_get_def.return_value = "CREATE VIEW v_test AS SELECT 1;"

            res = self.api.pg_dependency_get_definition("conn1", "view", "public", "v_test")
            self.assertTrue(res["success"])
            self.assertEqual(res["definition"], "CREATE VIEW v_test AS SELECT 1;")

    def test_pg_dependency_get_suggested_steps_success(self):
        mock_conn = MagicMock()
        mock_conn.config = {"type": "postgresql"}
        mock_conn.adapter.db_type = "postgresql"
        self.mock_cm.get.return_value = mock_conn

        with patch("app.services.postgres_dependency.service.PostgresDependencyService.get_suggested_steps") as mock_steps:
            mock_steps.return_value = [
                {"step": 1, "title": "Review Dependent Objects", "description": "Found 0 views"}
            ]

            res = self.api.pg_dependency_get_suggested_steps("conn1", "public", "customer", "id", "ALTER")
            self.assertTrue(res["success"])
            self.assertEqual(res["action"], "ALTER")
            self.assertTrue(len(res["steps"]) > 0)

    def test_pg_dependency_fallback_connection(self):
        # Simulate conn_id not found via get(), but available via name or active list
        self.mock_cm.get.side_effect = KeyError("Connection not found")
        mock_conn = MagicMock()
        mock_conn.config = {"type": "postgresql", "name": "my_pg_server"}
        mock_conn.adapter.db_type = "postgresql"
        self.mock_cm.list.return_value = [mock_conn]

        with patch("app.services.postgres_dependency.service.PostgresDependencyService.get_column_graph") as mock_get_graph:
            mock_graph = MagicMock()
            mock_graph.to_dict.return_value = {"nodes": [], "edges": []}
            mock_graph.to_tree_projection.return_value = {"id": "root", "children": []}
            mock_get_graph.return_value = mock_graph

            # Call with name or undefined
            res = self.api.pg_dependency_get_column("my_pg_server", "public", "customer", "id")
            self.assertTrue(res["success"])


if __name__ == "__main__":
    unittest.main()
