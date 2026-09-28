from flask import Blueprint, jsonify, request
from app.routes._common import get_connection_manager, get_owner_session_id

connections_bp = Blueprint("connections", __name__)

@connections_bp.post("")
def create_connection():
    data = request.get_json(silent=True) or {}

    if not data.get("type"):
        return jsonify(success=False, error="Database type is required"), 400

    db_type = (data.get("type") or "").strip().lower()
    if db_type == "group_marker" or str(data.get("name", "")).startswith("__group__"):
        return jsonify(success=False, error="Không thể kết nối đến nhóm"), 400

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
    saved_connections = []
    try:
        from pathlib import Path
        import json
        conn_file = Path(__file__).resolve().parent.parent.parent / "data" / "connections.json"
        if conn_file.exists():
            with open(conn_file, "r", encoding="utf-8-sig") as f:
                saved_raw = json.load(f)
                for item in saved_raw:
                    d = dict(item)
                    db_type = (d.get("type") or "").strip().lower()
                    if db_type == "group_marker" or str(d.get("name", "")).startswith("__group__"):
                        continue
                    if d.get("password"):
                        d["has_password"] = True
                        d.pop("password", None)
                    else:
                        d["has_password"] = False
                    saved_connections.append(d)
    except Exception:
        pass
    return jsonify(success=True, connections=items, saved_connections=saved_connections, active_connections=items)

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
    if db_type == "group_marker" or str(data.get("name", "")).startswith("__group__"):
        return jsonify(success=False, error="Không phải kết nối cơ sở dữ liệu"), 400
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

@connections_bp.post("/fetch-metadata")
def fetch_metadata():
    data = request.get_json(silent=True) or {}
    cm = get_connection_manager()
    owner_id = get_owner_session_id()
    try:
        temp_conn = cm.create(owner_id, data)
        try:
            db_name = data.get("database") or None
            databases = []
            schemas = []
            try:
                raw_dbs = temp_conn.metadata_service.list_databases()
                databases = [d.get("name", d) if isinstance(d, dict) else str(d) for d in raw_dbs]
            except Exception:
                pass
            try:
                raw_schemas = temp_conn.metadata_service.list_schemas(db_name)
                schemas = [s.get("name", s) if isinstance(s, dict) else str(s) for s in raw_schemas]
            except Exception:
                pass
            return jsonify(success=True, databases=databases, schemas=schemas)
        finally:
            cm.close(owner_id, temp_conn.connection_id)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400

