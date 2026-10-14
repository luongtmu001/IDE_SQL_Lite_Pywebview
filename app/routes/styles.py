# -*- coding: utf-8 -*-
"""app/routes/styles.py - REST API endpoints for SQL Code Styles Management.

Complies with .SKILL/format-code_general.md and .SKILL/format-code_viewstyle.md:
- Delegates persistence and style models to app.services.styles_service.
- Supports style listing, saving, resetting, importing, and exporting.
"""
import json
try:
    from flask import Blueprint, jsonify, request, Response
    styles_bp = Blueprint("styles", __name__)
except ImportError:
    Blueprint = None
    jsonify = None
    request = None
    Response = None
    styles_bp = None

from app.services.styles_service import (
    STYLES_FILE,
    export_style_data,
    get_default_styles_data,
    import_style_data,
    load_styles_file,
    reset_styles_file,
    save_styles_file,
)

# Backward-compatibility aliases
_get_default_styles_data = get_default_styles_data
_load_styles_file = load_styles_file
_save_styles_file = save_styles_file


if styles_bp is not None:
    @styles_bp.get("")
    def get_styles():
        """Retrieve all available styles and the currently active style ID."""
        data = load_styles_file()
        return jsonify(
            success=True,
            schemaVersion=data.get("schemaVersion", 1),
            activeStyleId=data.get("activeStyleId", "default"),
            styles=data.get("styles", []),
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
            "styles": styles,
        }

        if save_styles_file(data):
            return jsonify(success=True, message="Styles saved successfully")
        return jsonify(success=False, error="Failed to write styles file"), 500

    @styles_bp.post("/reset")
    def reset_styles():
        """Reset styles to default built-in configuration."""
        defaults = reset_styles_file()
        return jsonify(success=True, **defaults)

    @styles_bp.get("/export/<style_id>")
    def export_style(style_id):
        """Export a single style as a JSON document."""
        export_obj = export_style_data(style_id)
        if not export_obj:
            return jsonify(success=False, error=f"Style '{style_id}' not found"), 404

        target = export_obj["exportedStyle"]
        content = json.dumps(export_obj, indent=4, ensure_ascii=False)
        safe_name = "".join(c for c in target.get("name", "style") if c.isalnum() or c in ("-", "_")).rstrip()
        filename = f"{safe_name or 'style'}.sqlstyle.json"

        return Response(
            content,
            mimetype="application/json",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    @styles_bp.post("/import")
    def import_style():
        """Import a style from a JSON payload, resolving naming and ID collisions."""
        payload = request.get_json(silent=True) or {}
        ok, res = import_style_data(payload)
        if ok:
            return jsonify(success=True, style=res)
        return jsonify(success=False, error=res), 400 if isinstance(res, str) and res.startswith("Invalid") else 500
