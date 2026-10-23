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
        accessible_only = request.args.get("accessible_only", "").lower() in ("1", "true", "yes")
        items = connection.metadata_service.list_databases(accessible_only=accessible_only)
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
        limit_arg = request.args.get("limit")
        try:
            limit = int(limit_arg) if limit_arg is not None else 0
        except (ValueError, TypeError):
            limit = 0
        refresh = request.args.get("refresh", "").lower() in ("true", "1", "yes")
        return jsonify(
            success=True,
            items=connection.metadata_service.list_objects(
                request.args.get("database"),
                request.args.get("schema"),
                request.args.get("type", "tables"),
                request.args.get("search"),
                limit=limit,
                refresh=refresh
            ),
        )
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400

@metadata_bp.post("/<connection_id>/refresh")
def refresh_metadata(connection_id):
    try:
        connection = get_connection(connection_id)
        payload = request.get_json(silent=True) or {}
        database = payload.get("database") or request.args.get("database")
        schema = payload.get("schema") or request.args.get("schema")
        obj_type = payload.get("type") or request.args.get("type")
        connection.metadata_service.invalidate(database=database, schema=schema, object_type=obj_type)
        return jsonify(success=True, message="Metadata cache invalidated successfully")
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400

@metadata_bp.get("/<connection_id>/definition")
def definition(connection_id):
    try:
        connection = get_connection(connection_id)
        name = request.args.get("name")
        if not name:
            return jsonify(success=False, error="Name parameter is required"), 400
        schema = request.args.get("schema") or "dbo"
        obj_type = request.args.get("type", "")
        value = connection.metadata_service.get_object_definition(
            request.args.get("database"),
            schema,
            name,
            obj_type,
        )
        resp = jsonify(success=True, definition=value)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        return resp
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400

@metadata_bp.route("/<connection_id>/script", methods=["GET", "POST"])
def script(connection_id):
    try:
        connection = get_connection(connection_id)
        data = request.get_json(silent=True) or {}
        name = request.args.get("name") or data.get("name")
        if not name:
            return jsonify(success=False, error="Name parameter is required"), 400
        database = request.args.get("database") or data.get("database")
        schema = request.args.get("schema") or data.get("schema")
        obj_type = request.args.get("type") or data.get("type", "table")
        action = request.args.get("action") or data.get("action", "CREATE")

        script_sql = connection.metadata_service.script_object(
            database=database,
            schema=schema,
            name=name,
            object_type=obj_type,
            action=action,
        )
        resp = jsonify(success=True, script=script_sql)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp
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


@metadata_bp.get("/<connection_id>/foreign_keys")
def foreign_keys(connection_id):
    try:
        connection = get_connection(connection_id)
        database = request.args.get("database")
        schema = request.args.get("schema")
        table = request.args.get("table")
        items = connection.metadata_service.get_foreign_keys(database, schema, table)
        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/linked_servers")
def linked_servers(connection_id):
    try:
        connection = get_connection(connection_id)
        items = connection.metadata_service.list_linked_servers()
        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/linked_server/databases")
def linked_server_databases(connection_id):
    try:
        connection = get_connection(connection_id)
        server = request.args.get("server")
        if not server:
            return jsonify(success=False, error="Parameter 'server' is required"), 400
        items = connection.metadata_service.list_remote_databases(server)
        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/linked_server/schemas")
def linked_server_schemas(connection_id):
    try:
        connection = get_connection(connection_id)
        server = request.args.get("server")
        database = request.args.get("database")
        if not server:
            return jsonify(success=False, error="Parameter 'server' is required"), 400
        items = connection.metadata_service.list_remote_schemas(server, database)
        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/linked_server/objects")
def linked_server_objects(connection_id):
    try:
        connection = get_connection(connection_id)
        server = request.args.get("server")
        database = request.args.get("database")
        schema = request.args.get("schema")
        if not server:
            return jsonify(success=False, error="Parameter 'server' is required"), 400
        items = connection.metadata_service.list_remote_objects(server, database, schema)
        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/linked_server/columns")
def linked_server_columns(connection_id):
    try:
        connection = get_connection(connection_id)
        server = request.args.get("server")
        database = request.args.get("database")
        schema = request.args.get("schema")
        table = request.args.get("table")
        if not server or not table:
            return jsonify(success=False, error="Parameters 'server' and 'table' are required"), 400
        items = connection.metadata_service.list_remote_columns(server, database, schema, table)
        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/foreign_servers")
def foreign_servers(connection_id):
    try:
        connection = get_connection(connection_id)
        items = connection.metadata_service.list_foreign_servers()
        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/foreign_tables")
def foreign_tables(connection_id):
    try:
        connection = get_connection(connection_id)
        schema = request.args.get("schema")
        items = connection.metadata_service.list_foreign_tables(schema=schema)
        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.post("/<connection_id>/linked_server/test")
def test_linked_server_endpoint(connection_id):
    try:
        connection = get_connection(connection_id)
        data = request.get_json(silent=True) or {}
        server = data.get("server") or request.args.get("server")
        if not server:
            return jsonify(success=False, error="Parameter 'server' is required"), 400
        if hasattr(connection.adapter, "test_linked_server"):
            res = connection.adapter.test_linked_server(server)
            status = 200 if res.get("success") else 400
            return jsonify(res), status
        return jsonify(success=False, error="Test linked server is not supported on this adapter"), 400
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.get("/<connection_id>/linked_server/script")
def script_linked_server_endpoint(connection_id):
    try:
        connection = get_connection(connection_id)
        server = request.args.get("server")
        mode = request.args.get("mode", "create")
        if not server:
            return jsonify(success=False, error="Parameter 'server' is required"), 400
        if hasattr(connection.adapter, "get_linked_server_script"):
            script = connection.adapter.get_linked_server_script(server, mode=mode)
            return jsonify(success=True, script=script)
        return jsonify(success=False, error="Script linked server is not supported on this adapter"), 400
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.post("/<connection_id>/linked_server/drop")
def drop_linked_server_endpoint(connection_id):
    try:
        connection = get_connection(connection_id)
        data = request.get_json(silent=True) or {}
        server = data.get("server") or request.args.get("server")
        if not server:
            return jsonify(success=False, error="Parameter 'server' is required"), 400
        if hasattr(connection.adapter, "drop_linked_server"):
            res = connection.adapter.drop_linked_server(server)
            if hasattr(connection, "metadata_service") and hasattr(connection.metadata_service, "session"):
                connection.metadata_service.session.metadata_cache.pop(
                    connection.metadata_service._cache_key("linked_servers"), None
                )
            status = 200 if res.get("success") else 400
            return jsonify(res), status
        return jsonify(success=False, error="Drop linked server is not supported on this adapter"), 400
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.post("/query-flow")
def analyze_query_flow_endpoint():
    """
    Analyzes SQL query and returns the QueryFlowGraph representation.
    """
    try:
        from app.services.query_flow_service import QueryFlowService
        data = request.get_json(silent=True) or {}
        sql = data.get("sql", "")
        dialect = data.get("dialect", "tsql")
        graph = QueryFlowService.build_flow_graph(sql, dialect=dialect)
        return jsonify(success=True, flowGraph=graph.to_dict())
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@metadata_bp.post("/query-plan")
def get_query_plan_endpoint():
    """
    Retrieves the physical execution plan (estimated or actual) for a SQL query.
    Complies with Section 11 & Phase 6 of .SKILL/query_plan_visualization.md.
    """
    try:
        from app.services.query_plan_service import QueryPlanService
        data = request.get_json(silent=True) or {}
        conn_id = data.get("connectionId") or data.get("connId")
        sql = data.get("sql", "")
        plan_type = data.get("planType", "estimated")
        database = data.get("database")
        schema = data.get("schema")
        dialect = data.get("dialect")

        conn_session = None
        if conn_id:
            try:
                conn_session = get_connection(conn_id)
            except Exception:
                pass

        plan = QueryPlanService.get_execution_plan(
            connection_session=conn_session,
            sql=sql,
            plan_type=plan_type,
            database=database,
            schema=schema,
            dialect=dialect,
        )
        return jsonify(success=True, plan=plan.to_dict())
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400







