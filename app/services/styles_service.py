# -*- coding: utf-8 -*-
"""
SQL Code Styles Service.
Handles code styles persistence, defaults, loading, saving, resetting, import, and export.
Shared by pywebview Native API (SettingsApiMixin) and Flask routes (styles_bp).
"""
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

from app.services.settings_store import (
    CODE_STYLES_FILE,
    DATA_DIR,
    read_json,
    write_json,
)

logger = logging.getLogger("luobtool.styles_service")

STYLES_FILE = CODE_STYLES_FILE


def get_default_styles_data() -> Dict[str, Any]:
    """Return factory default code styles configuration."""
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
                        "datatypes": "upper",
                    },
                    "whitespace": {
                        "indentSize": 4,
                        "useTabs": False,
                        "maxEmptyLines": 1,
                        "trimTrailingWhitespace": True,
                    },
                    "lists": {
                        "commaPosition": "after",
                        "itemsOnNewLine": True,
                    },
                    "parentheses": {
                        "spacesInside": False,
                        "multiLineBlockNewLine": True,
                    },
                    "statements": {
                        "majorClausesNewLine": True,
                        "indentClauseBody": True,
                    },
                    "clauses": {
                        "joinOnNewLine": True,
                        "indentJoinOn": True,
                    },
                    "operators": {
                        "andOrPlaceOnNewLine": "always",
                        "andOrAlignment": "rightToStatement",
                        "andOrKeywordBeforeCondition": True,
                        "betweenPlaceOnNewLine": False,
                        "spacesAroundOperators": True,
                        "alignComparisonOperators": False,
                    },
                    "caseExpression": {
                        "whenOnNewLine": True,
                        "thenOnSameLine": True,
                        "indentWhen": True,
                    },
                },
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
                        "datatypes": "upper",
                    },
                    "whitespace": {
                        "indentSize": 4,
                        "useTabs": False,
                        "maxEmptyLines": 1,
                        "trimTrailingWhitespace": True,
                    },
                    "lists": {
                        "commaPosition": "after",
                        "itemsOnNewLine": True,
                    },
                    "parentheses": {
                        "spacesInside": False,
                        "multiLineBlockNewLine": True,
                    },
                    "statements": {
                        "majorClausesNewLine": True,
                        "indentClauseBody": True,
                    },
                    "clauses": {
                        "joinOnNewLine": True,
                        "indentJoinOn": True,
                    },
                    "operators": {
                        "andOrPlaceOnNewLine": "always",
                        "andOrAlignment": "rightToStatement",
                        "andOrKeywordBeforeCondition": True,
                        "betweenPlaceOnNewLine": False,
                        "spacesAroundOperators": True,
                        "alignComparisonOperators": False,
                    },
                    "caseExpression": {
                        "whenOnNewLine": True,
                        "thenOnSameLine": True,
                        "indentWhen": True,
                    },
                },
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
                        "datatypes": "upper",
                    },
                    "whitespace": {
                        "indentSize": 4,
                        "useTabs": False,
                        "maxEmptyLines": 1,
                        "trimTrailingWhitespace": True,
                    },
                    "lists": {
                        "commaPosition": "after",
                        "itemsOnNewLine": True,
                    },
                    "parentheses": {
                        "spacesInside": False,
                        "multiLineBlockNewLine": True,
                    },
                    "statements": {
                        "majorClausesNewLine": True,
                        "indentClauseBody": True,
                    },
                    "clauses": {
                        "joinOnNewLine": True,
                        "indentJoinOn": True,
                    },
                    "operators": {
                        "andOrPlaceOnNewLine": "always",
                        "andOrAlignment": "rightToStatement",
                        "andOrKeywordBeforeCondition": True,
                        "betweenPlaceOnNewLine": False,
                        "spacesAroundOperators": True,
                        "alignComparisonOperators": False,
                    },
                    "caseExpression": {
                        "whenOnNewLine": True,
                        "thenOnSameLine": True,
                        "indentWhen": True,
                    },
                },
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
                        "datatypes": "upper",
                    },
                    "whitespace": {
                        "indentSize": 2,
                        "useTabs": False,
                        "maxEmptyLines": 1,
                        "trimTrailingWhitespace": True,
                    },
                    "lists": {
                        "commaPosition": "after",
                        "itemsOnNewLine": False,
                    },
                    "parentheses": {
                        "spacesInside": False,
                        "multiLineBlockNewLine": False,
                    },
                    "statements": {
                        "majorClausesNewLine": True,
                        "indentClauseBody": False,
                    },
                    "clauses": {
                        "joinOnNewLine": True,
                        "indentJoinOn": False,
                    },
                    "operators": {
                        "andOrPlaceOnNewLine": "never",
                        "andOrAlignment": "left",
                        "andOrKeywordBeforeCondition": True,
                        "betweenPlaceOnNewLine": False,
                        "spacesAroundOperators": True,
                        "alignComparisonOperators": False,
                    },
                    "caseExpression": {
                        "whenOnNewLine": False,
                        "thenOnSameLine": True,
                        "indentWhen": False,
                    },
                },
            },
        ],
    }


def load_styles_file(styles_file: Optional[Path] = None) -> Dict[str, Any]:
    """Load styles from file or write defaults if missing/invalid."""
    target_file = Path(styles_file or STYLES_FILE)
    if target_file.exists():
        try:
            with open(target_file, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
                if isinstance(data, dict) and "styles" in data:
                    return data
        except Exception as e:
            logger.error("[Styles] Read error: %s", e)
    defaults = get_default_styles_data()
    save_styles_file(defaults, styles_file=target_file)
    return defaults


def save_styles_file(data: Dict[str, Any], styles_file: Optional[Path] = None) -> bool:
    """Save code styles to target styles file."""
    target_file = Path(styles_file or STYLES_FILE)
    try:
        target_file.parent.mkdir(parents=True, exist_ok=True)
        with open(target_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error("[Styles] Write error: %s", e)
        return False


def reset_styles_file(styles_file: Optional[Path] = None) -> Dict[str, Any]:
    """Reset styles to default built-in configuration and persist."""
    defaults = get_default_styles_data()
    save_styles_file(defaults, styles_file=styles_file)
    return defaults


def export_style_data(style_id: str, styles_file: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    """Export a single style by id as a JSON export document."""
    data = load_styles_file(styles_file=styles_file)
    styles = data.get("styles", [])
    target = next((s for s in styles if s.get("id") == style_id), None)
    if not target:
        return None
    return {
        "schemaVersion": data.get("schemaVersion", 1),
        "exportedStyle": target,
    }


def import_style_data(payload: Dict[str, Any], styles_file: Optional[Path] = None) -> Tuple[bool, Union[Dict[str, Any], str]]:
    """Import a style from a JSON payload, resolving naming and ID collisions."""
    imported = payload.get("exportedStyle") or payload
    if not isinstance(imported, dict) or not imported.get("name"):
        return False, "Invalid style format for import"

    data = load_styles_file(styles_file=styles_file)
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
        "settings": imported.get("settings", {}),
    }

    styles.append(new_style)
    data["styles"] = styles

    if save_styles_file(data, styles_file=styles_file):
        return True, new_style
    return False, "Failed to save imported style"
