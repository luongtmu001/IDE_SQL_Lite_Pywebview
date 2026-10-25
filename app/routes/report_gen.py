# -*- coding: utf-8 -*-
"""
Flask Blueprint for Report Layout Generation.
URL Prefix: /api/report-gen
"""
from flask import Blueprint, jsonify, render_template, request

from app.routes._common import get_connection_manager, get_owner_session_id
from app.services.report_layout_gen import ReportLayoutGenService

report_gen_bp = Blueprint("report_gen", __name__)


def _get_service() -> ReportLayoutGenService:
    return ReportLayoutGenService(connection_manager=get_connection_manager())


@report_gen_bp.get("/")
@report_gen_bp.get("/ui")
def report_gen_ui():
    """Render the Report Layout Generator Wizard in web/browser mode."""
    return render_template("report_gen_window.html")


def _resolve_conn_id(cm, connection_id: str, owner_sid: str) -> str:
    """Helper to find live connection or auto-connect saved profile."""
    if not connection_id:
        return connection_id
    with cm._lock:
        if connection_id in cm._connections:
            return connection_id
        clean = str(connection_id).strip().lower()
        for c in cm._connections.values():
            cfg = getattr(c, "config", {}) or {}
            cid = str(cfg.get("id") or getattr(c, "connection_id", "")).strip().lower()
            cname = str(cfg.get("name") or "").strip().lower()
            if cid == clean or cname == clean:
                return getattr(c, "connection_id", connection_id)

    # Try saved profiles
    try:
        from app.services.settings_store import get_saved_connections
        from app.utils.crypto import decrypt_password
        saved = get_saved_connections(filter_groups=False) or []
        for p in saved:
            if not p or p.get("type") == "group_marker":
                continue
            pid = str(p.get("id") or "").strip().lower()
            pname = str(p.get("name") or "").strip().lower()
            if pid == clean or pname == clean:
                cfg = dict(p)
                if cfg.get("password") and not cfg.get("trusted_connection"):
                    try:
                        cfg["password"] = decrypt_password(cfg["password"])
                    except Exception:
                        pass
                conn, _ = cm.create_or_get(owner_sid, cfg)
                return conn.connection_id
    except Exception:
        pass
    return connection_id


@report_gen_bp.get("/connections")
def list_connections():
    """List available SQL Server and PostgreSQL connections (active and saved profiles)."""
    try:
        import re
        from app.services.settings_store import get_saved_connections
        cm = get_connection_manager()
        results = []
        active_ids = set()
        active_names = set()

        # 1. Active connections
        with cm._lock:
            for cid, conn in cm._connections.items():
                cid_str = str(cid).strip().lower()
                active_ids.add(cid_str)
                cfg = getattr(conn, "config", {}) or {}
                cfg_id = cfg.get("id")
                if cfg_id:
                    active_ids.add(str(cfg_id).strip().lower())
                cname = cfg.get("name") or cid
                if cname:
                    active_names.add(str(cname).strip().lower())

                db_type = getattr(conn.adapter, "db_type", cfg.get("type", "sqlserver"))
                if str(db_type).lower() in ("sqlserver", "postgresql", "postgres"):
                    results.append({
                        "id": cid,
                        "name": cfg.get("name") or cid,
                        "db_type": db_type,
                        "database": getattr(conn.adapter, "database", cfg.get("database", "")) or cfg.get("default_database", ""),
                        "schema": cfg.get("schema") or getattr(conn.adapter, "default_schema", getattr(conn.adapter, "schema", "")) or "",
                        "server": cfg.get("server") or cfg.get("host") or "",
                        "is_active": True,
                    })

        # 2. Saved profiles
        try:
            profiles = get_saved_connections(filter_groups=False) or []
            for p in profiles:
                if not p or p.get("type") == "group_marker" or str(p.get("name", "")).startswith("__group__"):
                    continue
                db_t = str(p.get("type", "sqlserver")).lower()
                if db_t not in ("sqlserver", "postgresql", "postgres"):
                    continue
                pid = p.get("id") or p.get("name")
                pname = p.get("name") or pid
                pid_str = str(pid).strip().lower()
                pname_str = str(pname).strip().lower()
                clean_name = re.sub(r"\s*\([^)]*\)$", "", pname_str).strip().lower()
                if pid_str in active_ids or pid_str in active_names or pname_str in active_names or clean_name in active_names:
                    continue
                results.append({
                    "id": pid,
                    "name": pname,
                    "db_type": p.get("type", "sqlserver"),
                    "database": p.get("database", "") or p.get("default_database", ""),
                    "schema": p.get("schema", "") or p.get("default_schema", ""),
                    "server": p.get("server") or p.get("host") or "",
                    "is_active": False,
                })
        except Exception:
            pass

        return jsonify(success=True, connections=results)
    except Exception as exc:
        return jsonify(success=False, error=str(exc), connections=[]), 400


@report_gen_bp.post("/source")
def open_source():
    """Upload Excel file(s) or submit Google Sheet URL."""
    try:
        service = _get_service()
        # 1. Multi-file upload via form-data
        uploaded_files = request.files.getlist("files") or request.files.getlist("file")
        if uploaded_files:
            valid_files = [f for f in uploaded_files if f.filename]
            if len(valid_files) > 1:
                files_data = [{"content": f.read(), "filename": f.filename} for f in valid_files]
                res = service.open_files(files_data)
                return jsonify(success=True, **res)
            elif len(valid_files) == 1:
                f = valid_files[0]
                res = service.open_file(f.read(), filename=f.filename)
                return jsonify(success=True, **res)

        # 2. JSON with URL, multiple files, or single file content
        data = request.get_json(silent=True) or {}
        if "url" in data and data["url"]:
            res = service.open_gsheet(data["url"])
            return jsonify(success=True, **res)
        elif "files" in data and isinstance(data["files"], list) and len(data["files"]) > 0:
            res = service.open_files(data["files"])
            return jsonify(success=True, **res)
        elif "content" in data and data["content"]:
            filename = data.get("filename", "upload.xlsx")
            res = service.open_file(data["content"], filename=filename)
            return jsonify(success=True, **res)

        return jsonify(success=False, error="Vui lòng cung cấp ít nhất một file Excel hoặc liên kết Google Sheet."), 400
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@report_gen_bp.post("/<session_id>/add-files")
def add_files(session_id: str):
    """Add more Excel files to an existing session."""
    try:
        service = _get_service()
        data = request.get_json(silent=True) or {}
        files = data.get("files", [])
        if not files:
            return jsonify(success=False, error="Danh sách file trống."), 400
        res = service.add_files(session_id, files)
        return jsonify(success=True, **res)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@report_gen_bp.delete("/<session_id>/file/<file_id>")
def remove_file(session_id: str, file_id: str):
    """Remove a file from an active session."""
    try:
        service = _get_service()
        res = service.remove_file(session_id, file_id)
        return jsonify(success=True, **res)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@report_gen_bp.post("/<session_id>/select-file")
def select_file(session_id: str):
    """Switch active Excel file in session."""
    try:
        service = _get_service()
        data = request.get_json(silent=True) or {}
        file_id = data.get("file_id")
        if not file_id:
            return jsonify(success=False, error="Thiếu file_id."), 400
        res = service.select_file(session_id, file_id)
        return jsonify(success=True, **res)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@report_gen_bp.get("/<session_id>/sheet/<path:sheet_name>")
@report_gen_bp.get("/<session_id>/sheet")
def get_sheet_preview(session_id: str, sheet_name: str = None):
    """Retrieve sheet model preview grid and suggested regions."""
    try:
        service = _get_service()
        res = service.get_sheet(session_id, sheet_name=sheet_name)
        return jsonify(success=True, **res)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@report_gen_bp.put("/<session_id>/regions")
def set_regions(session_id: str):
    """Assign 2-4 report regions and generate preliminary layout XML."""
    try:
        data = request.get_json(force=True) or {}
        regions = data.get("regions", [])
        if not regions:
            return jsonify(success=False, error="Danh sách vùng không được để trống."), 400

        sheet_name = data.get("sheet_name") or data.get("sheet")
        service = _get_service()
        res = service.set_regions(session_id, regions, sheet_name=sheet_name)
        return jsonify(success=True, **res)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@report_gen_bp.get("/databases")
def get_databases():
    """List databases for the given connection."""
    try:
        conn_id = request.args.get("connection_id")
        if not conn_id:
            return jsonify(success=False, error="Thiếu tham số connection_id."), 400
        cm = get_connection_manager()
        owner_sid = get_owner_session_id()
        resolved_id = _resolve_conn_id(cm, conn_id, owner_sid)
        conn = cm._connections.get(resolved_id)
        if not conn:
            try:
                conn = cm.get(owner_sid, resolved_id)
            except Exception:
                conn = None
        if not conn:
            return jsonify(success=False, error="Kết nối không tồn tại hoặc chưa kết nối."), 404
        items = conn.metadata_service.list_databases()
        db_names = [d.get("name", d) if isinstance(d, dict) else str(d) for d in items]
        return jsonify(success=True, databases=db_names)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@report_gen_bp.get("/schemas")
def get_schemas():
    """List schemas for the given connection and database."""
    try:
        conn_id = request.args.get("connection_id")
        if not conn_id:
            return jsonify(success=False, error="Thiếu tham số connection_id."), 400
        database = request.args.get("database")
        cm = get_connection_manager()
        owner_sid = get_owner_session_id()
        resolved_id = _resolve_conn_id(cm, conn_id, owner_sid)
        conn = cm._connections.get(resolved_id)
        if not conn:
            try:
                conn = cm.get(owner_sid, resolved_id)
            except Exception:
                conn = None
        if not conn:
            return jsonify(success=False, error="Kết nối không tồn tại hoặc chưa kết nối."), 404
        items = conn.metadata_service.list_schemas(database)
        schema_names = [s.get("name", s) if isinstance(s, dict) else str(s) for s in items]
        return jsonify(success=True, schemas=schema_names)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@report_gen_bp.get("/routines")
def list_routines():
    """List available routines for the given connection."""
    try:
        conn_id = request.args.get("connection_id")
        if not conn_id:
            return jsonify(success=False, error="Thiếu tham số connection_id."), 400

        schema = request.args.get("schema")
        search = request.args.get("search")
        database = request.args.get("database")
        owner_sid = get_owner_session_id()
        resolved_id = _resolve_conn_id(get_connection_manager(), conn_id, owner_sid)
        service = _get_service()
        routines = service.list_routines(
            connection_id=resolved_id,
            schema=schema,
            search=search,
            database=database,
            owner_session_id=owner_sid,
        )
        return jsonify(success=True, routines=routines)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@report_gen_bp.post("/<session_id>/describe")
def describe_routine(session_id: str):
    """Statically inspect routine output structure without executing it."""
    try:
        data = request.get_json(force=True) or {}
        conn_id = data.get("connection_id")
        routine = data.get("routine")
        schema = data.get("schema")
        database = data.get("database")

        if not conn_id or not routine:
            return jsonify(success=False, error="Thiếu tham số connection_id hoặc routine."), 400

        owner_sid = get_owner_session_id()
        resolved_id = _resolve_conn_id(get_connection_manager(), conn_id, owner_sid)
        service = _get_service()
        shape = service.describe_routine(
            session_id=session_id,
            connection_id=resolved_id,
            routine_name=routine,
            schema=schema,
            database=database,
            owner_session_id=owner_sid,
        )
        return jsonify(success=True, shape=shape)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@report_gen_bp.put("/<session_id>/mapping")
def apply_mapping(session_id: str):
    """Apply column mappings from routine to layout XML."""
    try:
        data = request.get_json(force=True) or {}
        data_member = data.get("data_member", "Table0")
        mapping = data.get("mapping", {})
        mode = data.get("mode", "rename")
        unmapped = data.get("unmapped_columns")
        sheet_name = data.get("sheet_name") or data.get("sheet")
        param_mappings = data.get("param_mappings")

        service = _get_service()
        res = service.apply_mapping(
            session_id=session_id,
            data_member=data_member,
            mapping=mapping,
            mode=mode,
            unmapped_columns=unmapped,
            sheet_name=sheet_name,
            param_mappings=param_mappings,
        )
        return jsonify(success=True, **res)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@report_gen_bp.post("/<session_id>/build")
def build(session_id: str):
    """Finalize both layout and datasource XML."""
    try:
        service = _get_service()
        res = service.build(session_id)
        return jsonify(success=True, **res)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400
