from flask import Blueprint, jsonify, request
from app.routes._common import get_connection_manager, get_owner_session_id

query_bp = Blueprint("query", __name__)

@query_bp.post("/execute")
def execute():
    data = request.get_json(silent=True) or {}

    connection_id = data.get("connection_id")
    sql = data.get("sql", "")

    if not connection_id:
        return jsonify(success=False, error="connection_id is required"), 400

    if not sql.strip():
        return jsonify(success=False, error="SQL is empty"), 400

    limit = data.get("limit")
    if limit is not None:
        try:
            limit = int(limit)
        except (ValueError, TypeError):
            limit = None

    database = data.get("database")

    try:
        connection = get_connection_manager().get(
            get_owner_session_id(),
            connection_id,
        )

        result = connection.query_service.execute(
            sql,
            limit=limit,
            database=database,
        )
        return jsonify(result)

    except PermissionError:
        return jsonify(success=False, error="Forbidden"), 403
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@query_bp.post("/explain")
def explain():
    """Return an execution plan text for the given SQL.

    For SQL Server: uses SET SHOWPLAN_TEXT ON / OFF.
    For PostgreSQL: uses EXPLAIN.
    """
    data = request.get_json(silent=True) or {}

    connection_id = data.get("connection_id")
    sql = data.get("sql", "").strip()
    database = data.get("database")

    if not connection_id:
        return jsonify(success=False, error="connection_id is required"), 400
    if not sql:
        return jsonify(success=False, error="SQL is empty"), 400

    try:
        cm = get_connection_manager()
        session_id = get_owner_session_id()
        conn = cm.get(session_id, connection_id)  # returns ConnectionSession directly
        adapter = conn.adapter

        db_type = conn.config.get("type", "sqlserver")

        if db_type == "postgresql":
            plan_sql = f"EXPLAIN\n{sql}"
            result = adapter.execute(plan_sql, database=database)
            plan_text = "\n".join(
                str(row[0]) for row in result.get("rows", [])
            )
        else:
            # SQL Server: SHOWPLAN_TEXT requires autocommit and separate statements
            cursor = adapter.connection.cursor()
            try:
                import re
                if database and not re.match(r'^\s*USE\s+', sql, flags=re.IGNORECASE):
                    try:
                        clean_db = str(database).replace("]", "]]")
                        cursor.execute(f"USE [{clean_db}]")
                    except Exception:
                        pass

                cursor.execute("SET SHOWPLAN_TEXT ON")
                cursor.nextset()
                cursor.execute(sql)
                lines = []
                while True:
                    if cursor.description:
                        lines += [str(row[0]) for row in cursor.fetchall()]
                    if not cursor.nextset():
                        break
                plan_text = "\n".join(lines)
            finally:
                try:
                    cursor.execute("SET SHOWPLAN_TEXT OFF")
                    cursor.close()
                except Exception:
                    pass

        return jsonify(success=True, plan=plan_text or "(No plan returned)")

    except PermissionError:
        return jsonify(success=False, error="Forbidden"), 403
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400
