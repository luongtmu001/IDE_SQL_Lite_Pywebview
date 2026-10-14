"""app/routes/styles.py - REST API endpoints for SQL Code Styles Management.

Complies with .SKILL/format-code_general.md and .SKILL/format-code_viewstyle.md:
- Persists user & system styles in data/code_styles.json independently of app code.
- Supports style listing, saving, resetting, importing, and exporting.
- Maintains schemaVersion for safe forward-migration.
"""

import json
from pathlib import Path
try:
    from flask import Blueprint, jsonify, request, Response
    styles_bp = Blueprint("styles", __name__)
except ImportError:
    Blueprint = None
    jsonify = None
    request = None
    Response = None
    styles_bp = None

from app.utils.paths import get_user_data_dir

DATA_DIR = get_user_data_dir()
STYLES_FILE = DATA_DIR / "code_styles.json"


def _get_default_styles_data():
    return {
        "schemaVersion": 1,
        "activeStyleId": "default",
        "styles": [
            {
                "id": "default",
                "name": "Default (Standard)",
                "isSystem": True,
                "database": "all",
                "description": "Cấu hình chuẩn hóa cú pháp SQL mặc định của IDE.",
                "settings": {
                    "casing": {
                        "keywords": "upper",
                        "functions": "upper",
                        "datatypes": "upper"
                    },
                    "whitespace": {
                        "indentSize": 4,
                        "useTabs": False,
                        "maxEmptyLines": 1,
                        "trimTrailingWhitespace": True
                    },
                    "lists": {
                        "commaPosition": "after",
                        "itemsOnNewLine": True
                    },
                    "parentheses": {
                        "spacesInside": False,
                        "multiLineBlockNewLine": True
                    },
                    "statements": {
                        "majorClausesNewLine": True,
                        "indentClauseBody": True
                    },
                    "clauses": {
                        "joinOnNewLine": True,
                        "indentJoinOn": True
                    },
                    "operators": {
                        "andOrPlaceOnNewLine": "always",
                        "andOrAlignment": "rightToStatement",
                        "andOrKeywordBeforeCondition": True,
                        "betweenPlaceOnNewLine": False,
                        "spacesAroundOperators": True,
                        "alignComparisonOperators": False
                    },
                    "caseExpression": {
                        "whenOnNewLine": True,
                        "thenOnSameLine": True,
                        "indentWhen": True
                    }
                }
            },
            {
                "id": "sqlserver-standard",
                "name": "SQL Server Standard",
                "isSystem": True,
                "database": "sqlserver",
                "description": "Cấu hình chuẩn T-SQL cho Microsoft SQL Server (GO, TOP, bracket identifiers).",
                "settings": {
                    "casing": {
                        "keywords": "upper",
                        "functions": "upper",
                        "datatypes": "upper"
                    },
                    "whitespace": {
                        "indentSize": 4,
                        "useTabs": False,
                        "maxEmptyLines": 1,
                        "trimTrailingWhitespace": True
                    },
                    "lists": {
                        "commaPosition": "after",
                        "itemsOnNewLine": True
                    },
                    "parentheses": {
                        "spacesInside": False,
                        "multiLineBlockNewLine": True
                    },
                    "statements": {
                        "majorClausesNewLine": True,
                        "indentClauseBody": True
                    },
                    "clauses": {
                        "joinOnNewLine": True,
                        "indentJoinOn": True
                    },
                    "operators": {
                        "andOrPlaceOnNewLine": "always",
                        "andOrAlignment": "rightToStatement",
                        "andOrKeywordBeforeCondition": True,
                        "betweenPlaceOnNewLine": False,
                        "spacesAroundOperators": True,
                        "alignComparisonOperators": False
                    },
                    "caseExpression": {
                        "whenOnNewLine": True,
                        "thenOnSameLine": True,
                        "indentWhen": True
                    }
                }
            },
            {
                "id": "postgres-standard",
                "name": "PostgreSQL Standard",
                "isSystem": True,
                "database": "postgresql",
                "description": "Cấu hình chuẩn PL/pgSQL cho PostgreSQL (LIMIT, OFFSET, quoted identifiers).",
                "settings": {
                    "casing": {
                        "keywords": "upper",
                        "functions": "upper",
                        "datatypes": "upper"
                    },
                    "whitespace": {
                        "indentSize": 4,
                        "useTabs": False,
                        "maxEmptyLines": 1,
                        "trimTrailingWhitespace": True
                    },
                    "lists": {
                        "commaPosition": "after",
                        "itemsOnNewLine": True
                    },
                    "parentheses": {
                        "spacesInside": False,
                        "multiLineBlockNewLine": True
                    },
                    "statements": {
                        "majorClausesNewLine": True,
                        "indentClauseBody": True
                    },
                    "clauses": {
                        "joinOnNewLine": True,
                        "indentJoinOn": True
                    },
                    "operators": {
                        "andOrPlaceOnNewLine": "always",
                        "andOrAlignment": "rightToStatement",
                        "andOrKeywordBeforeCondition": True,
                        "betweenPlaceOnNewLine": False,
                        "spacesAroundOperators": True,
                        "alignComparisonOperators": False
                    },
                    "caseExpression": {
                        "whenOnNewLine": True,
                        "thenOnSameLine": True,
                        "indentWhen": True
                    }
                }
            },
            {
                "id": "compact",
                "name": "Compact SQL",
                "isSystem": True,
                "database": "all",
                "description": "Định dạng thu gọn dòng, giữ câu truy vấn gọn gàng trên ít dòng.",
                "settings": {
                    "casing": {
                        "keywords": "upper",
                        "functions": "upper",
                        "datatypes": "upper"
                    },
                    "whitespace": {
                        "indentSize": 2,
                        "useTabs": False,
                        "maxEmptyLines": 1,
                        "trimTrailingWhitespace": True
                    },
                    "lists": {
                        "commaPosition": "after",
                        "itemsOnNewLine": False
                    },
                    "parentheses": {
                        "spacesInside": False,
                        "multiLineBlockNewLine": False
                    },
                    "statements": {
                        "majorClausesNewLine": True,
                        "indentClauseBody": False
                    },
                    "clauses": {
                        "joinOnNewLine": True,
                        "indentJoinOn": False
                    },
                    "operators": {
                        "andOrPlaceOnNewLine": "never",
                        "andOrAlignment": "left",
                        "andOrKeywordBeforeCondition": True,
                        "betweenPlaceOnNewLine": False,
                        "spacesAroundOperators": True,
                        "alignComparisonOperators": False
                    },
                    "caseExpression": {
                        "whenOnNewLine": False,
                        "thenOnSameLine": True,
                        "indentWhen": False
                    }
                }
            }
        ]
    }


def _load_styles_file():
    if STYLES_FILE.exists():
        try:
            with open(STYLES_FILE, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
                if isinstance(data, dict) and "styles" in data:
                    return data
        except Exception as e:
            print(f"[Styles] Read error: {e}")
    defaults = _get_default_styles_data()
    _save_styles_file(defaults)
    return defaults


def _save_styles_file(data):
    try:
        STYLES_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(STYLES_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[Styles] Write error: {e}")
        return False


if styles_bp is not None:
    @styles_bp.get("")
    def get_styles():
        """Retrieve all available styles and the currently active style ID."""
        data = _load_styles_file()
        return jsonify(
            success=True,
            schemaVersion=data.get("schemaVersion", 1),
            activeStyleId=data.get("activeStyleId", "default"),
            styles=data.get("styles", [])
        )

    @styles_bp.post("")
    def save_styles():
        """Save code styles and the active style choice."""
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return jsonify(success=False, error="Invalid payload format"), 400

        styles = payload.get("styles")
        if not isinstance(styles, list):
            return jsonify(success=False, error="Styles list is required"), 400

        active_id = payload.get("activeStyleId", "default")
        schema_ver = payload.get("schemaVersion", 1)

        data = {
            "schemaVersion": schema_ver,
            "activeStyleId": active_id,
            "styles": styles
        }

        if _save_styles_file(data):
            return jsonify(success=True, message="Styles saved successfully")
        return jsonify(success=False, error="Failed to write styles file"), 500

    @styles_bp.post("/reset")
    def reset_styles():
        """Reset styles to default built-in configuration."""
        defaults = _get_default_styles_data()
        if _save_styles_file(defaults):
            return jsonify(success=True, **defaults)
        return jsonify(success=False, error="Failed to reset styles"), 500

    @styles_bp.get("/export/<style_id>")
    def export_style(style_id):
        """Export a single style as a JSON document."""
        data = _load_styles_file()
        styles = data.get("styles", [])
        target = next((s for s in styles if s.get("id") == style_id), None)
        if not target:
            return jsonify(success=False, error=f"Style '{style_id}' not found"), 404

        export_obj = {
            "schemaVersion": data.get("schemaVersion", 1),
            "exportedStyle": target
        }
        content = json.dumps(export_obj, indent=4, ensure_ascii=False)
        safe_name = "".join(c for c in target.get("name", "style") if c.isalnum() or c in ("-", "_")).rstrip()
        filename = f"{safe_name or 'style'}.sqlstyle.json"

        return Response(
            content,
            mimetype="application/json",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    @styles_bp.post("/import")
    def import_style():
        """Import a style from a JSON payload, resolving naming and ID collisions."""
        payload = request.get_json(silent=True) or {}
        imported = payload.get("exportedStyle") or payload
        if not isinstance(imported, dict) or not imported.get("name"):
            return jsonify(success=False, error="Invalid style format for import"), 400

        data = _load_styles_file()
        styles = data.get("styles", [])

        base_id = "".join(c for c in imported.get("id", "user-style") if c.isalnum() or c in ("-", "_")).lower()
        base_name = imported.get("name", "Imported Style")

        # Resolve ID collisions
        existing_ids = {s.get("id") for s in styles}
        new_id = base_id
        counter = 1
        while new_id in existing_ids:
            new_id = f"{base_id}_{counter}"
            counter += 1

        # Resolve Name collisions
        existing_names = {s.get("name") for s in styles}
        new_name = base_name
        counter = 1
        while new_name in existing_names:
            new_name = f"{base_name} ({counter})"
            counter += 1

        new_style = {
            "id": new_id,
            "name": new_name,
            "isSystem": False,
            "database": imported.get("database", "all"),
            "description": imported.get("description", "Imported user SQL style"),
            "settings": imported.get("settings", {})
        }

        styles.append(new_style)
        data["styles"] = styles

        if _save_styles_file(data):
            return jsonify(success=True, style=new_style)
        return jsonify(success=False, error="Failed to save imported style"), 500
