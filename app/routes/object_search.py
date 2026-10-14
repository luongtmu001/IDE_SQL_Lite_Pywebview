# -*- coding: utf-8 -*-
"""
Object Content Search REST API routes.
Implements:
  POST /api/sql/object-search
  GET  /api/sql/object-ddl
"""
from flask import Blueprint, jsonify, request
from app.routes._common import get_connection_manager, get_owner_session_id
from app.services.object_search_service import ObjectSearchService

object_search_bp = Blueprint("object_search", __name__)


def _get_connection(connection_id: str):
    return get_connection_manager().get(
        get_owner_session_id(),
        connection_id,
    )


@object_search_bp.post("/object-search")
def object_search():
    try:
        data = request.get_json(force=True, silent=True) or {}
        conn_id = data.get("connection_id") or request.args.get("connection_id")
        if not conn_id:
            cm = get_connection_manager()
            conns = cm.list(get_owner_session_id())
            if conns:
                conn_id = conns[0].connection_id

        if not conn_id:
            return jsonify(success=False, error="Connection ID is required"), 400

        conn = _get_connection(conn_id)
        if not conn or not conn.adapter:
            return jsonify(success=False, error="Connection not found"), 404

        keyword = data.get("keyword") or ""
        database = data.get("database") or request.args.get("database")
        object_types = data.get("object_types")
        case_sensitive = bool(data.get("case_sensitive", False))
        whole_word = bool(data.get("whole_word", False))
        is_regex = bool(data.get("is_regex", False))
        schema = data.get("schema")

        service = ObjectSearchService(conn.adapter)
        res = service.search(
            keyword=keyword,
            database=database,
            object_types=object_types,
            case_sensitive=case_sensitive,
            whole_word=whole_word,
            is_regex=is_regex,
            schema=schema
        )
        return jsonify(res)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@object_search_bp.get("/object-ddl")
def object_ddl():
    try:
        conn_id = request.args.get("connection_id")
        if not conn_id:
            cm = get_connection_manager()
            conns = cm.list(get_owner_session_id())
            if conns:
                conn_id = conns[0].connection_id

        if not conn_id:
            return jsonify(success=False, error="Connection ID is required"), 400

        conn = _get_connection(conn_id)
        if not conn or not conn.adapter:
            return jsonify(success=False, error="Connection not found"), 404

        schema = request.args.get("schema", "dbo")
        name = request.args.get("name")
        if not name:
            return jsonify(success=False, error="Object name is required"), 400

        object_type = request.args.get("type", "VIEW")
        database = request.args.get("database")
        keyword = request.args.get("keyword")
        case_sensitive = request.args.get("case_sensitive", "false").lower() in ("true", "1")
        whole_word = request.args.get("whole_word", "false").lower() in ("true", "1")
        is_regex = request.args.get("is_regex", "false").lower() in ("true", "1")

        service = ObjectSearchService(conn.adapter)
        res = service.get_ddl(
            schema=schema,
            name=name,
            object_type=object_type,
            database=database,
            keyword=keyword,
            case_sensitive=case_sensitive,
            whole_word=whole_word,
            is_regex=is_regex
        )
        return jsonify(res)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400
