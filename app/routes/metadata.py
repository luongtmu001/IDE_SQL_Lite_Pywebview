from flask import Blueprint, jsonify, request
from app.routes._common import get_connection_manager, get_owner_session_id

metadata_bp = Blueprint("metadata", __name__)

def get_connection(connection_id):
    return get_connection_manager().get(
        get_owner_session_id(),
        connection_id,
    )

@metadata_bp.get("/<connection_id>/databases")
def databases(connection_id):
    try:
        connection = get_connection(connection_id)
        items = connection.metadata_service.list_databases()
        search = request.args.get("search")
        if search:
            s = search.strip().lower()
            items = [
                d for d in items
                if s in (d.get("name", d) if isinstance(d, dict) else str(d)).lower()
            ]
        return jsonify(
            success=True,
            items=items,
        )
    except PermissionError:
        return jsonify(success=False, error="Forbidden"), 403
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400

@metadata_bp.get("/<connection_id>/schemas")
def schemas(connection_id):
    try:
        connection = get_connection(connection_id)
        items = connection.metadata_service.list_schemas(
            request.args.get("database")
        )
        search = request.args.get("search")
        if search:
            s = search.strip().lower()
            items = [
                x for x in items
                if s in (x.get("name", x) if isinstance(x, dict) else str(x)).lower()
            ]
        return jsonify(
            success=True,
            items=items,
        )
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400

@metadata_bp.get("/<connection_id>/objects")
def objects(connection_id):
    try:
        connection = get_connection(connection_id)
        return jsonify(
            success=True,
            items=connection.metadata_service.list_objects(
                request.args.get("database"),
                request.args.get("schema"),
                request.args.get("type", "tables"),
                request.args.get("search")
            ),
        )
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400

@metadata_bp.get("/<connection_id>/definition")
def definition(connection_id):
    try:
        connection = get_connection(connection_id)
        value = connection.metadata_service.get_object_definition(
            request.args.get("database"),
            request.args["schema"],
            request.args["name"],
            request.args["type"],
        )
        return jsonify(success=True, definition=value)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400

@metadata_bp.get("/<connection_id>/object_children")
def object_children(connection_id):
    try:
        connection = get_connection(connection_id)
        return jsonify(
            success=True,
            items=connection.metadata_service.list_object_children(
                request.args.get("database"),
                request.args.get("schema"),
                request.args.get("name"),
                request.args.get("type"),
                request.args.get("child_type"),
            ),
        )
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/table-design")
def table_design(connection_id):
    try:
        from app.services.table_designer_service import TableDesignerService

        connection = get_connection(connection_id)
        database = request.args.get("database")
        schema = request.args.get("schema")
        table = request.args.get("table")
        if not table:
            return jsonify(success=False, error="Parameter 'table' is required"), 400

        data = connection.metadata_service.get_table_design_metadata(database, schema, table)
        if not data:
            return jsonify(success=False, error=f"Table {schema}.{table} not found"), 404

        preview_sql = TableDesignerService.generate_create_table_ddl(data)
        return jsonify(success=True, data=data, preview_sql=preview_sql)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/table-design/types")
def table_design_types(connection_id):
    try:
        connection = get_connection(connection_id)
        database = request.args.get("database")
        types_info = connection.metadata_service.get_supported_types(database=database)
        return jsonify(success=True, data=types_info)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.post("/<connection_id>/table-design/preview")
def table_design_preview(connection_id):
    try:
        from app.services.table_designer_service import TableDesignerService

        data = request.get_json() or {}
        preview_sql = TableDesignerService.generate_create_table_ddl(data)
        return jsonify(success=True, preview_sql=preview_sql)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.post("/<connection_id>/table-design/diff")
def table_design_diff(connection_id):
    try:
        from app.services.table_designer_service import TableDesignerService

        body = request.get_json() or {}
        original = body.get("original") or {}
        modified = body.get("modified") or {}

        diff_res = TableDesignerService.generate_diff(original, modified)
        new_preview = TableDesignerService.generate_create_table_ddl(modified)
        return jsonify(success=True, diff=diff_res, preview_sql=new_preview)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.post("/<connection_id>/table-design/apply")
def table_design_apply(connection_id):
    try:
        import re
        connection = get_connection(connection_id)
        body = request.get_json() or {}
        database = body.get("database")
        statements = body.get("statements", [])
        migration_sql = body.get("migration_sql", "")

        batches = []
        if migration_sql and migration_sql.strip():
            raw_batches = re.split(r'^\s*GO\s*;?\s*(?:--.*)?$', migration_sql, flags=re.MULTILINE | re.IGNORECASE)
            batches = [b.strip() for b in raw_batches if b.strip()]
        elif statements:
            for stmt in statements:
                sql = stmt.get("sql") if isinstance(stmt, dict) else str(stmt)
                if sql and sql.strip():
                    batches.append(sql.strip())

        if not batches:
            return jsonify(success=False, error="No statements provided to apply"), 400

        connection.adapter.execute_migration_transaction(batches, database=database)

        # Invalidate metadata cache after schema change
        connection.metadata_service.invalidate()
        return jsonify(success=True, message="Changes applied successfully")
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/intellisense/objects")
def intellisense_objects(connection_id):
    try:
        connection = get_connection(connection_id)
        database = request.args.get("database")
        schema = request.args.get("schema")
        items = connection.metadata_service.get_intellisense_objects(database, schema)
        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/intellisense/columns")
def intellisense_columns(connection_id):
    try:
        connection = get_connection(connection_id)
        database = request.args.get("database")
        schema = request.args.get("schema")
        table = request.args.get("table")
        items = connection.metadata_service.get_intellisense_columns(database, schema, table)
        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/intellisense/parameters")
def intellisense_parameters(connection_id):
    try:
        connection = get_connection(connection_id)
        database = request.args.get("database")
        schema = request.args.get("schema")
        name = request.args.get("name")
        items = connection.metadata_service.get_intellisense_parameters(database, schema, name)
        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/intellisense/types")
def intellisense_types(connection_id):
    try:
        connection = get_connection(connection_id)
        database = request.args.get("database")
        types_info = connection.metadata_service.get_supported_types(database=database)
        return jsonify(
            success=True,
            types=types_info.get("types", []),
            user_types=types_info.get("user_types", []),
            engine=types_info.get("engine", "")
        )
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400




