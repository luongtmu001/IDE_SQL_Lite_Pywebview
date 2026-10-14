"""
History Routes (Phase 2) — luoBTool IDE
Cung cấp REST API cho Query History trong chế độ Flask Web/Server.
"""

from flask import Blueprint, jsonify, request
from app.services.history import get_history_service

history_bp = Blueprint("history", __name__)


@history_bp.post("/log_execution")
def log_execution():
    """Ghi nhận lượt chạy F5 ngay khi thực thi (Status = NULL hoặc cập nhật nếu có)."""
    data = request.get_json(silent=True) or {}
    doc_id = data.get("doc_id")
    sql = data.get("sql", "")

    if not doc_id:
        return jsonify(success=False, error="doc_id is required"), 400

    display_name = data.get("display_name") or "Untitled.sql"
    server = data.get("server") or "localhost"
    database = data.get("database") or "master"
    file_path = data.get("file_path")
    login = data.get("login")
    is_selection = bool(data.get("is_selection", False))
    entry_type = int(data.get("entry_type", 1))
    executed_at = data.get("executed_at")
    duration_ms = data.get("duration_ms")
    status = data.get("status")
    error_summary = data.get("error_summary")

    svc = get_history_service()
    res = svc.record_execution(
        doc_id=doc_id,
        display_name=display_name,
        sql=sql,
        server=server,
        database=database,
        file_path=file_path,
        login=login,
        is_selection=is_selection,
        entry_type=entry_type,
        executed_at=executed_at,
        duration_ms=duration_ms,
        status=status,
        error_summary=error_summary
    )

    if res is None:
        return jsonify(success=True, entry_id=None, skipped=True)

    return jsonify(success=True, **res)


@history_bp.post("/update_execution")
def update_execution():
    """Cập nhật kết quả sau khi câu truy vấn chạy xong (DurationMs, Status, ErrorSummary)."""
    data = request.get_json(silent=True) or {}
    entry_id = data.get("entry_id")

    if entry_id is None:
        return jsonify(success=False, error="entry_id is required"), 400

    duration_ms = data.get("duration_ms")
    status = data.get("status")
    error_summary = data.get("error_summary")

    svc = get_history_service()
    updated = svc.update_entry_result(
        entry_id=int(entry_id),
        duration_ms=duration_ms,
        status=status,
        error_summary=error_summary
    )

    return jsonify(success=True, updated=updated)


@history_bp.post("/update_document")
def update_document():
    """Cập nhật DisplayName hoặc FilePath (khi Save, Save As, Rename).
    Tự động gộp theo FilePath nếu file đã tồn tại trên đĩa.
    """
    data = request.get_json(silent=True) or {}
    doc_id = data.get("doc_id")

    if not doc_id:
        return jsonify(success=False, error="doc_id is required"), 400

    display_name = data.get("display_name")
    file_path = data.get("file_path")

    svc = get_history_service()
    res = svc.update_document(
        doc_id=doc_id,
        display_name=display_name,
        file_path=file_path
    )

    return jsonify(res)


@history_bp.get("/document_by_path")
def document_by_path():
    """Tìm Document theo đường dẫn file trên đĩa."""
    file_path = request.args.get("path")
    if not file_path:
        return jsonify(success=False, error="path parameter is required"), 400

    svc = get_history_service()
    doc = svc.get_document_by_path(file_path)
    return jsonify(success=True, document=doc)


@history_bp.get("/documents")
def get_documents():
    """Lấy danh sách Document hiển thị ở khung danh sách."""
    search = request.args.get("search")
    fav_raw = request.args.get("favorites_only")
    favorites_only = fav_raw.lower() in ("true", "1") if fav_raw else False
    server = request.args.get("server")
    database = request.args.get("database")
    from_ts = request.args.get("from_timestamp", type=int)
    to_ts = request.args.get("to_timestamp", type=int)
    limit = int(request.args.get("limit", 200))

    svc = get_history_service()
    docs = svc.get_documents(
        search=search,
        favorites_only=favorites_only,
        server=server,
        database=database,
        from_timestamp=from_ts,
        to_timestamp=to_ts,
        limit=limit
    )
    return jsonify(success=True, documents=docs)


@history_bp.get("/document/<doc_id>")
def get_document(doc_id):
    """Lấy thông tin một Document."""
    svc = get_history_service()
    doc = svc.get_document(doc_id)
    if not doc:
        return jsonify(success=False, error="Document not found"), 404
    return jsonify(success=True, document=doc)


@history_bp.get("/entries")
def get_entries():
    """Lấy danh sách các lần thực thi của Document."""
    doc_id = request.args.get("doc_id")
    if not doc_id:
        return jsonify(success=False, error="doc_id is required"), 400

    status_raw = request.args.get("status")
    status_filter = int(status_raw) if status_raw is not None and status_raw != "" else None
    search = request.args.get("search")
    server = request.args.get("server")
    database = request.args.get("database")
    tag = request.args.get("tag")
    entry_type = request.args.get("entry_type", type=int)
    from_ts = request.args.get("from_timestamp", type=int)
    to_ts = request.args.get("to_timestamp", type=int)
    limit = int(request.args.get("limit", 200))
    fav_only_raw = request.args.get("favorite_only")
    fav_only = fav_only_raw in ["true", "1", "True"] if fav_only_raw is not None else False
    is_fav_raw = request.args.get("is_favorite")
    is_fav = (is_fav_raw in ["true", "1", "True"]) if is_fav_raw is not None else None

    svc = get_history_service()
    entries = svc.get_entries(
        doc_id=doc_id,
        status_filter=status_filter,
        search=search,
        server=server,
        database=database,
        from_timestamp=from_ts,
        to_timestamp=to_ts,
        tag=tag,
        entry_type=entry_type,
        favorite_only=fav_only,
        is_favorite=is_fav,
        limit=limit
    )
    return jsonify(success=True, entries=entries)


@history_bp.get("/editor_settings")
def get_editor_settings():
    """Chỉ đọc setting font của text editor mà không can thiệp hay sửa đổi file setting."""
    try:
        from main import _load_settings_file
        return jsonify(
            success=True,
            editor=st.get("editor", {}),
            theme=st.get("appearance", {}).get("theme") or st.get("theme", "dark"),
            appearance=st.get("appearance", {}),
            settings=st
        )
    except Exception as exc:
        return jsonify(success=False, error=str(exc), editor={})


@history_bp.get("/entry/<int:entry_id>")
def get_entry_detail(entry_id):
    """Lấy chi tiết entry kèm SQL đã giải nén."""
    svc = get_history_service()
    detail = svc.get_entry_detail(entry_id)
    if not detail:
        return jsonify(success=False, error="Entry not found"), 404
    return jsonify(success=True, entry=detail)


@history_bp.post("/toggle_star")
def toggle_star():
    """Bật/tắt trạng thái yêu thích (Favorite)."""
    data = request.get_json(silent=True) or {}
    doc_id = data.get("doc_id")
    if not doc_id:
        return jsonify(success=False, error="doc_id is required"), 400

    is_starred = data.get("is_starred")
    svc = get_history_service()
    val = svc.toggle_star(doc_id=doc_id, is_starred=is_starred)
    return jsonify(success=True, is_starred=val)


@history_bp.delete("/entry/<int:entry_id>")
def delete_entry(entry_id):
    """Xóa an toàn một HistoryEntry."""
    svc = get_history_service()
    ok = svc.delete_entry(entry_id)
    return jsonify(success=ok)


@history_bp.delete("/document/<doc_id>")
def delete_document(doc_id):
    """Xóa lịch sử của Document."""
    svc = get_history_service()
    ok = svc.delete_document(doc_id)
    return jsonify(success=ok)


@history_bp.post("/purge")
def purge():
    """Chạy dọn dẹp theo Retention."""
    data = request.get_json(silent=True) or {}
    max_age = int(data.get("max_age_days", 90))
    max_entries = int(data.get("max_entries_per_doc", 200))

    svc = get_history_service()
    res = svc.purge_old_entries(max_age_days=max_age, max_entries_per_doc=max_entries)
    return jsonify(success=True, **res)


@history_bp.get("/stats")
def stats():
    """Lấy thống kê dung lượng."""
    svc = get_history_service()
    st = svc.get_storage_stats()
    return jsonify(success=True, stats=st)


@history_bp.post("/compact")
def compact():
    """Tối ưu và thu gọn dung lượng database (VACUUM)."""
    svc = get_history_service()
    st = svc.compact()
    return jsonify(success=True, stats=st)


@history_bp.post("/clear_all")
def clear_all():
    """Xóa toàn bộ lịch sử truy vấn."""
    data = request.get_json(silent=True) or {}
    keep_fav = bool(data.get("keep_favorites", False))
    svc = get_history_service()
    st = svc.clear_all(keep_favorites=keep_fav)
    return jsonify(success=True, stats=st)


@history_bp.post("/entry/<int:entry_id>/note")
def update_entry_note(entry_id):
    """Cập nhật ghi chú (Note) và nhãn (Tag) cho một HistoryEntry."""
    data = request.get_json(silent=True) or {}
    note = data.get("note")
    tag = data.get("tag")
    svc = get_history_service()
    ok = svc.update_entry_note(entry_id=entry_id, note=note, tag=tag)
    return jsonify(success=ok)


@history_bp.post("/entry/<int:entry_id>/favorite")
def set_entry_favorite(entry_id):
    """Bật/tắt trạng thái yêu thích (Favorite) cho một lượt thực thi/entry."""
    data = request.get_json(silent=True) or {}
    is_favorite = data.get("is_favorite")
    svc = get_history_service()
    val = svc.set_entry_favorite(entry_id=entry_id, is_favorite=is_favorite)
    return jsonify(success=True, is_favorite=val)


@history_bp.post("/entry/<int:entry_id>/tag")
def add_entry_tag(entry_id):
    """Gắn nhãn (Tag) cho một HistoryEntry."""
    data = request.get_json(silent=True) or {}
    tag_name = data.get("tag_name")
    color = data.get("color")
    if not tag_name:
        return jsonify(success=False, error="tag_name is required"), 400
    svc = get_history_service()
    ok = svc.add_entry_tag(entry_id=entry_id, tag_name=tag_name, color=color)
    return jsonify(success=ok)


@history_bp.delete("/entry/<int:entry_id>/tag")
def remove_entry_tag(entry_id):
    """Gỡ một nhãn (Tag) khỏi một HistoryEntry."""
    data = request.get_json(silent=True) or {}
    tag_name = data.get("tag_name") or request.args.get("tag_name")
    if not tag_name:
        return jsonify(success=False, error="tag_name is required"), 400
    svc = get_history_service()
    ok = svc.remove_entry_tag(entry_id=entry_id, tag_name=tag_name)
    return jsonify(success=ok)


@history_bp.get("/entry/<int:entry_id>/tags")
def get_entry_tags(entry_id):
    """Lấy danh sách các nhãn (Tag) của một HistoryEntry."""
    svc = get_history_service()
    tags = svc.get_entry_tags(entry_id=entry_id)
    return jsonify(success=True, tags=tags)


@history_bp.get("/tags")
def get_all_tags():
    """Lấy toàn bộ danh sách nhãn (Tag) trong hệ thống cùng số lượt sử dụng."""
    svc = get_history_service()
    tags = svc.get_all_tags()
    return jsonify(success=True, tags=tags)


@history_bp.get("/filters")
def get_filters():
    """Lấy danh sách các Server, Database, Tag độc nhất phục vụ bộ lọc."""
    svc = get_history_service()
    data = svc.get_distinct_filters()
    return jsonify(success=True, filters=data)


@history_bp.post("/export")
def export_history():
    """Xuất lịch sử truy vấn dưới dạng JSON."""
    data = request.get_json(silent=True) or {}
    doc_ids = data.get("doc_ids")
    svc = get_history_service()
    res = svc.export_history(doc_ids=doc_ids)
    return jsonify(res)


@history_bp.post("/import")
def import_history():
    """Nhập dữ liệu lịch sử truy vấn từ JSON."""
    data = request.get_json(silent=True) or {}
    svc = get_history_service()
    try:
        res = svc.import_history(data)
        return jsonify(res)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 400


@history_bp.post("/open_in_editor")
def open_in_editor():
    """Fallback cho web mode mở script trong editor."""
    return jsonify(success=True)


@history_bp.post("/open_containing_folder")
def open_containing_folder():
    """Fallback cho web mode mở thư mục."""
    return jsonify(success=True)


@history_bp.post("/open_diff_in_editor")
def open_diff_in_editor():
    """Fallback cho web mode mở diff view trong editor."""
    return jsonify(success=True)


@history_bp.get("/active_editor_content")
def active_editor_content():
    """Fallback cho web mode lấy nội dung active editor."""
    return jsonify(success=True, content="")


@history_bp.post("/open-window")
def open_window():
    """Endpoint mở cửa sổ query history cho web mode."""
    return jsonify(success=True)

