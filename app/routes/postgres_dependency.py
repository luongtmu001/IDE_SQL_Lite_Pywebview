"""PostgreSQL Dependency Graph REST API
Exposes endpoints for querying dependencies, object definitions, and suggested impact resolution.

Decoupled from frontend visualization. Serves pure Graph and Tree models.
"""

from flask import Blueprint, jsonify, request
from app.routes._common import get_connection_manager, get_owner_session_id
from app.services.postgres_dependency import PostgresDependencyService

postgres_dependency_bp = Blueprint("postgres_dependency", __name__)


def _get_connection(connection_id: str):
    cm = get_connection_manager()
    session_id = get_owner_session_id()
    try:
        return cm.get(session_id, connection_id)
    except Exception:
        active_conns = cm.list(session_id)
        for conn in active_conns:
            if conn.config.get("name") == connection_id or conn.config.get("server") == connection_id:
                return conn
        pg_conns = [c for c in active_conns if (c.config.get("type") or "").lower() == "postgresql"]
        if pg_conns:
            return pg_conns[0]
        if active_conns:
            return active_conns[0]
        raise


def _validate_postgres_connection(connection):
    db_type = (
        connection.config.get("type")
        or getattr(connection.adapter, "db_type", "")
        or ""
    ).lower()
    if db_type != "postgresql":
        raise ValueError("PostgreSQL Dependency Graph is exclusively supported for PostgreSQL connections.")


@postgres_dependency_bp.get("/<connection_id>/column")
def get_column_dependencies(connection_id: str):
    """
    Returns dependency graph for a specific table column.
    Query params: schema, table, column, direction, depth, database, include_source
    """
    try:
        connection = _get_connection(connection_id)
        _validate_postgres_connection(connection)

        schema = request.args.get("schema", "public").strip()
        table = request.args.get("table", "").strip()
        column = request.args.get("column", "").strip()
        if "(" in column:
            column = column.split("(")[0].strip()
        if "(" in table:
            table = table.split("(")[0].strip()
        direction = request.args.get("direction", "dependents").strip()
        depth = int(request.args.get("depth", 2))
        database = request.args.get("database")
        include_source = request.args.get("include_source", "true").lower() in ("true", "1", "yes")

        if not table or not column:
            return jsonify(success=False, error="Parameters 'table' and 'column' are required."), 400

        service = PostgresDependencyService(connection.adapter)
        graph = service.get_column_graph(
            schema=schema,
            table_name=table,
            column_name=column,
            direction=direction,
            depth_limit=depth,
            database=database,
            include_source_analysis=include_source
        )

        return jsonify(
            success=True,
            graph=graph.to_dict(),
            tree=graph.to_tree_projection()
        )
    except PermissionError:
        return jsonify(success=False, error="Forbidden"), 403
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@postgres_dependency_bp.get("/<connection_id>/object")
def get_object_dependencies(connection_id: str):
    """
    Returns dependency graph for an object (View, Table, Function, etc.).
    Query params: type, schema, name, direction, depth, database
    """
    try:
        connection = _get_connection(connection_id)
        _validate_postgres_connection(connection)

        obj_type = request.args.get("type", "view").strip()
        schema = request.args.get("schema", "public").strip()
        name = request.args.get("name", "").strip()
        if "(" in name:
            name = name.split("(")[0].strip()
        direction = request.args.get("direction", "dependents").strip()
        depth = int(request.args.get("depth", 2))
        database = request.args.get("database")

        if not name:
            return jsonify(success=False, error="Parameter 'name' is required."), 400

        service = PostgresDependencyService(connection.adapter)
        graph = service.get_object_graph(
            obj_type_str=obj_type,
            schema=schema,
            name=name,
            direction=direction,
            depth_limit=depth,
            database=database
        )

        return jsonify(
            success=True,
            graph=graph.to_dict(),
            tree=graph.to_tree_projection()
        )
    except PermissionError:
        return jsonify(success=False, error="Forbidden"), 403
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@postgres_dependency_bp.get("/<connection_id>/definition")
def get_object_definition(connection_id: str):
    """
    Returns SQL script definition for viewing in Monaco Editor.
    Query params: type, schema, name, oid, database
    """
    try:
        connection = _get_connection(connection_id)
        _validate_postgres_connection(connection)

        obj_type = request.args.get("type", "view").strip()
        schema = request.args.get("schema", "public").strip()
        name = request.args.get("name", "").strip()
        oid_val = request.args.get("oid")
        oid = int(oid_val) if oid_val and oid_val.isdigit() else None
        database = request.args.get("database")

        if not name:
            return jsonify(success=False, error="Parameter 'name' is required."), 400

        service = PostgresDependencyService(connection.adapter)
        definition = service.get_object_definition(
            obj_type_str=obj_type,
            schema=schema,
            name=name,
            oid=oid,
            database=database
        )

        if not definition:
            return jsonify(success=False, error=f"Definition not available for {schema}.{name}."), 404

        return jsonify(
            success=True,
            object_type=obj_type,
            schema=schema,
            name=name,
            definition=definition
        )
    except PermissionError:
        return jsonify(success=False, error="Forbidden"), 403
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@postgres_dependency_bp.get("/<connection_id>/suggested-steps")
def get_suggested_steps(connection_id: str):
    """
    Returns non-executable suggested resolution workflow before modifying a column.
    Query params: schema, table, column, action, database
    """
    try:
        connection = _get_connection(connection_id)
        _validate_postgres_connection(connection)

        schema = request.args.get("schema", "public").strip()
        table = request.args.get("table", "").strip()
        column = request.args.get("column", "").strip()
        action = request.args.get("action", "ALTER").strip()
        database = request.args.get("database")

        if not table or not column:
            return jsonify(success=False, error="Parameters 'table' and 'column' are required."), 400

        service = PostgresDependencyService(connection.adapter)
        steps = service.get_suggested_steps(
            schema=schema,
            table=table,
            column=column,
            action=action,
            database=database
        )

        return jsonify(
            success=True,
            action=action,
            target=f"{schema}.{table}.{column}",
            steps=steps
        )
    except PermissionError:
        return jsonify(success=False, error="Forbidden"), 403
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400
