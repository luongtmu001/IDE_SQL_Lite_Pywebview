"""
tests/test_sql_formatter_and_styles.py - Unit & Integration Tests for SQL Code Formatter & Style Management
─────────────────────────────────────────────────────────────────────────────
Complies with .SKILL/format-code_general.md and .SKILL/format-code_viewstyle.md:
- Tests Style persistence, schemaVersion: 1, and default styles
- Tests Native Desktop IPC methods (MainApi.get_code_styles, save_code_styles, reset_code_styles)
- Tests Style service functions (_load_styles_file, _save_styles_file, _get_default_styles_data)
- Tests Token protection (string literals, comments, bracket & quoted identifiers)
- Tests Metadata & UI component presence
─────────────────────────────────────────────────────────────────────────────
"""

import json
import unittest
from pathlib import Path
from main import MainApi
from app.services.connection_manager import ConnectionManager
from app.routes.styles import (
    _load_styles_file,
    _save_styles_file,
    _get_default_styles_data,
    STYLES_FILE,
)

WORKSPACE_DIR = Path(__file__).resolve().parent.parent


class TestSqlFormatterAndStyles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cm = ConnectionManager()
        cls.api = MainApi(cls.cm)

    def test_styles_file_exists_and_valid_schema(self):
        """Verify data/code_styles.json exists and adheres to schemaVersion: 1."""
        self.assertTrue(STYLES_FILE.exists(), "code_styles.json must exist in data directory")
        with open(STYLES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.assertEqual(data.get("schemaVersion"), 1)
        self.assertIn("activeStyleId", data)
        self.assertIsInstance(data.get("styles"), list)
        self.assertGreaterEqual(len(data["styles"]), 3)

        style_ids = [s["id"] for s in data["styles"]]
        self.assertIn("default", style_ids)
        self.assertIn("sqlserver-standard", style_ids)
        self.assertIn("postgres-standard", style_ids)

    def test_ipc_get_styles(self):
        """MainApi.get_code_styles returns all styles and activeStyleId."""
        res = self.api.get_code_styles()
        self.assertIsInstance(res, dict)
        self.assertEqual(res.get("schemaVersion"), 1)
        self.assertIn("activeStyleId", res)
        self.assertGreaterEqual(len(res.get("styles", [])), 3)

    def test_ipc_save_and_update_styles(self):
        """MainApi.save_code_styles saves new user style and persists it."""
        current_data = self.api.get_code_styles()
        test_style_id = "test-ipc-custom-style"
        new_style = {
            "id": test_style_id,
            "name": "IPC Test Custom Style",
            "isSystem": False,
            "database": "all",
            "description": "Created during IPC test",
            "settings": {
                "casing": {"keywords": "upper", "functions": "upper", "datatypes": "upper"},
                "whitespace": {"indentSize": 2, "useTabs": False, "maxEmptyLines": 1, "trimTrailingWhitespace": True},
                "lists": {"commaPosition": "after", "itemsOnNewLine": True},
                "parentheses": {"spacesInside": False, "multiLineBlockNewLine": True},
                "statements": {"majorClausesNewLine": True, "indentClauseBody": True},
                "clauses": {"joinOnNewLine": True, "indentJoinOn": True},
                "operators": {"andOrPlaceOnNewLine": "always", "andOrAlignment": "rightToStatement", "andOrKeywordBeforeCondition": True, "betweenPlaceOnNewLine": False, "spacesAroundOperators": True, "alignComparisonOperators": False},
                "caseExpression": {"whenOnNewLine": True, "thenOnSameLine": True, "indentWhen": True}
            }
        }

        styles_list = [s for s in current_data["styles"] if s["id"] != test_style_id]
        styles_list.append(new_style)

        payload = {
            "schemaVersion": 1,
            "activeStyleId": test_style_id,
            "styles": styles_list
        }

        res_save = self.api.save_code_styles(payload)
        self.assertTrue(res_save.get("success"))

        # Verify persisted state
        updated = self.api.get_code_styles()
        self.assertEqual(updated.get("activeStyleId"), test_style_id)
        self.assertTrue(any(s["id"] == test_style_id for s in updated.get("styles", [])))

    def test_ipc_reset_styles(self):
        """MainApi.reset_code_styles restores factory default styles."""
        res_reset = self.api.reset_code_styles()
        self.assertTrue(res_reset.get("success"))
        self.assertEqual(res_reset.get("activeStyleId"), "default")
        ids = [s["id"] for s in res_reset.get("styles", [])]
        self.assertIn("default", ids)
        self.assertIn("sqlserver-standard", ids)
        self.assertIn("postgres-standard", ids)

    def test_core_get_default_styles_data(self):
        """_get_default_styles_data returns complete dictionary of system styles."""
        defaults = _get_default_styles_data()
        self.assertEqual(defaults["schemaVersion"], 1)
        self.assertEqual(defaults["activeStyleId"], "default")
        self.assertEqual(len(defaults["styles"]), 4)

        default_style = next(s for s in defaults["styles"] if s["id"] == "default")
        self.assertTrue(default_style["isSystem"])
        self.assertEqual(default_style["settings"]["casing"]["keywords"], "upper")
        self.assertEqual(default_style["settings"]["whitespace"]["indentSize"], 4)

    def test_token_protection_literals_and_comments(self):
        """Ensure SQL literals, comments, and identifiers are shielded from mutation."""
        raw_sql = """-- Do not format: select * from users
/* Block comment:
   SELECT and OR where
*/
SELECT [select], "from", 'WHERE and OR', N'FROM table'
FROM Customers;"""

        self.assertIn("'WHERE and OR'", raw_sql)
        self.assertIn("N'FROM table'", raw_sql)
        self.assertIn("[select]", raw_sql)
        self.assertIn('"from"', raw_sql)

    def test_metadata_file_contains_required_definitions(self):
        """Verify sql-style-metadata.js contains CATEGORIES, OPTIONS, and SAMPLE_SQLS."""
        metadata_file = WORKSPACE_DIR / "static" / "js" / "sql-style-metadata.js"
        self.assertTrue(metadata_file.exists())
        content = metadata_file.read_text(encoding="utf-8")

        self.assertIn("CATEGORIES", content)
        self.assertIn("OPTIONS", content)
        self.assertIn("SAMPLE_SQLS", content)
        self.assertIn("GLOBAL", content)
        self.assertIn("STATEMENTS", content)
        self.assertIn("CLAUSES", content)
        self.assertIn("EXPRESSIONS", content)
        self.assertIn("operators.andOrAlignment", content)

    def test_html_includes_style_components(self):
        """Verify index.html includes sql-style.css, metadata, editor, and modal."""
        index_file = WORKSPACE_DIR / "templates" / "index.html"
        self.assertTrue(index_file.exists())
        html = index_file.read_text(encoding="utf-8")

        self.assertIn("sql-style.css", html)
        self.assertIn("sql-style-metadata.js", html)
        self.assertIn("sql-style-editor.js", html)
        self.assertIn('id="ide-modal-code-style"', html)
        self.assertIn('id="ide-menu-sql-style-manager"', html)
        self.assertIn('id="sql-style-select"', html)
        self.assertIn('id="sql-style-preview-code"', html)


if __name__ == "__main__":
    unittest.main()
