from flask import Blueprint, jsonify, request
from app.routes._common import get_connection_manager, get_owner_session_id

connections_bp = Blueprint("connections", __name__)

@connections_bp.post("")
def create_connection():
    data = request.get_json(silent=True) or {}

    if not data.get("type"):
        return jsonify(success=False, error="Database type is required"), 400

    try:
        connection = get_connection_manager().create(
            get_owner_session_id(),
            data,
        )
        return jsonify(
            success=True,
            connection=connection.public_info(),
        )
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400

@connections_bp.get("")
def list_connections():
    items = [
        connection.public_info()
        for connection in get_connection_manager().list(
            get_owner_session_id()
        )
    ]
    return jsonify(success=True, connections=items)

@connections_bp.delete("/<connection_id>")
def delete_connection(connection_id):
    try:
        get_connection_manager().close(
            get_owner_session_id(),
            connection_id,
        )
        return jsonify(success=True)
    except KeyError:
        return jsonify(success=False, error="Connection not found"), 404
    except PermissionError:
        return jsonify(success=False, error="Forbidden"), 403
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400

@connections_bp.post("/check-credential")
def check_credential():
    data = request.get_json(silent=True) or {}
    db_type = (data.get("type") or "sqlserver").lower()
    trusted = bool(data.get("trusted_connection"))

    if db_type == "sqlite" or trusted:
        return jsonify(success=True, requires_password=False, has_password=True)

    cm = get_connection_manager()
    has_pwd = cm.has_cached_password(data)
    return jsonify(
        success=True,
        requires_password=True,
        has_password=has_pwd,
    )

@connections_bp.post("/clear-credential")
def clear_credential():
    data = request.get_json(silent=True) or {}
    cm = get_connection_manager()
    cm.clear_cached_password(data)
    return jsonify(success=True)
