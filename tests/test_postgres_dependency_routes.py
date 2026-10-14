import unittest
from unittest.mock import MagicMock, patch

try:
    from flask import Flask
    from app.routes.postgres_dependency import postgres_dependency_bp
    FLASK_AVAILABLE = True
except ImportError:
    FLASK_AVAILABLE = False


@unittest.skipUnless(FLASK_AVAILABLE, "Flask not installed in this environment")
class TestPostgresDependencyRoutes(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.register_blueprint(postgres_dependency_bp, url_prefix="/api/postgresql/dependency")
        self.client = self.app.test_client()

    @patch("app.routes.postgres_dependency._get_connection")
    def test_get_column_dependencies_non_postgres(self, mock_get_conn):
        mock_conn = MagicMock()
        mock_conn.config = {"type": "sqlserver"}
        mock_conn.adapter.db_type = "sqlserver"
        mock_get_conn.return_value = mock_conn

        res = self.client.get("/api/postgresql/dependency/conn1/column?table=customer&column=id")
        self.assertEqual(res.status_code, 400)
        data = res.get_json()
        self.assertFalse(data["success"])
        self.assertIn("exclusively supported for PostgreSQL", data["error"])

    @patch("app.routes.postgres_dependency._get_connection")
    @patch("app.routes.postgres_dependency.PostgresDependencyService.get_object_definition")
    def test_get_object_definition_success(self, mock_get_def, mock_get_conn):
        mock_conn = MagicMock()
        mock_conn.config = {"type": "postgresql"}
        mock_conn.adapter.db_type = "postgresql"
        mock_get_conn.return_value = mock_conn

        mock_get_def.return_value = "CREATE OR REPLACE VIEW sales_view AS SELECT 1;"

        res = self.client.get("/api/postgresql/dependency/conn1/definition?type=view&schema=public&name=sales_view")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["object_type"], "view")
        self.assertIn("CREATE OR REPLACE VIEW", data["definition"])

    def test_ui_assets_integration(self):
        import os
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        # 1. Verify dependency-list.js exists and exports class
        list_js_path = os.path.join(base_dir, "static", "js", "postgresql", "dependency", "dependency-list.js")
        self.assertTrue(os.path.exists(list_js_path))
        with open(list_js_path, "r", encoding="utf-8") as f:
            list_js_content = f.read()
        self.assertIn("class PostgresDependencyListView", list_js_content)
        self.assertIn("ide-dep-btn-ddl", list_js_content)
        self.assertIn("ide-dep-btn-inspect", list_js_content)
        self.assertIn("ide-dep-group-header", list_js_content)
        self.assertIn("ide-dep-hover-card", list_js_content)

        # 2. Verify dependency-filter.js has list layout button and defaults to list
        filter_js_path = os.path.join(base_dir, "static", "js", "postgresql", "dependency", "dependency-filter.js")
        with open(filter_js_path, "r", encoding="utf-8") as f:
            filter_js_content = f.read()
        self.assertIn("ide-dep-btn-layout-list", filter_js_content)
        self.assertIn("layout === 'list'", filter_js_content)
        self.assertIn("this.currentLayout = options.layout || 'list'", filter_js_content)

        # 3. Verify dependency-controller.js creates listView and handles DDL open and defaults to list
        controller_js_path = os.path.join(base_dir, "static", "js", "postgresql", "dependency", "dependency-controller.js")
        with open(controller_js_path, "r", encoding="utf-8") as f:
            controller_js_content = f.read()
        self.assertIn("ide-dep-list-wrap", controller_js_content)
        self.assertIn("this.listView = new global.PostgresDependencyListView", controller_js_content)
        self.assertIn("openObjectDefinition(node)", controller_js_content)
        self.assertIn("handleLayoutChange(layout)", controller_js_content)
        self.assertIn("this.handleLayoutChange('list')", controller_js_content)

        # 4. Verify templates/index.html includes dependency-list.js
        index_html_path = os.path.join(base_dir, "templates", "index.html")
        with open(index_html_path, "r", encoding="utf-8") as f:
            index_html_content = f.read()
        self.assertIn("dependency-list.js", index_html_content)

        # 5. Verify static/css/dependency-graph.css has list styling
        css_path = os.path.join(base_dir, "static", "css", "dependency-graph.css")
        with open(css_path, "r", encoding="utf-8") as f:
            css_content = f.read()
        self.assertIn(".ide-dep-list-container", css_content)
        self.assertIn(".ide-dep-group-header", css_content)
        self.assertIn(".ide-dep-row", css_content)
        self.assertIn(".ide-dep-btn-ddl", css_content)
        self.assertIn(".ide-dep-hover-card", css_content)

        # 6. Verify column dependency message in dependency-list.js
        self.assertIn("chỉ JOIN mà không SELECT đã được lọc bỏ", list_js_content)


if __name__ == "__main__":
    unittest.main()
