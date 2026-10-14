# -*- coding: utf-8 -*-
"""
Bravo API Mixin.
Handles Bravo sessions, programs, layout editor XML payloads, and file selection.
"""
import logging
import os
import re as _re
import subprocess
import threading
import uuid
import webview
from app.bravo.xml_codec import (
    _validate_xml_syntax,
    _decode_xml_payload,
    _encode_xml_payload,
)
from app.desktop.exports import (
    grid_open_in_excel as _desktop_grid_open_in_excel,
    grid_save_results_as as _desktop_grid_save_results_as,
)
from app.services.settings_store import (
    PROGRAM_LIST_FILE,
    PROGRAM_GROUPS_FILE,
    _read_json,
    _write_json,
)
from app.utils.crypto import (
    encrypt_password,
    decrypt_password,
    CredentialDecryptError,
)

logger = logging.getLogger("luobtool.bravo.api")


class BravoApiMixin:
    def ready(self):
        if self._window:
            try:
                self._window.show()
            except Exception:
                pass
            import threading
            for delay in (0.05, 0.2, 0.5):
                threading.Timer(delay, lambda: self.apply_titlebar_theme()).start()
        return {"success": True}


    def get_initial_context(self):
        return {"success": True, "context": self.initial_context}


    def set_window_title(self, title):
        if self._window:
            try:
                self._window.set_title(title)
                return {"success": True}
            except Exception:
                pass
        return {"success": False}


    def list_features(self):
        features = [
            {
                "id": "program-list",
                "displayName": "Danh sách chương trình",
                "icon": "fa-list-check",
                "order": 5,
                "description": "Quản lý danh sách kết nối và khởi chạy nhanh các chương trình BRAVO"
            },
            {
                "id": "layout-editor",
                "displayName": "Soạn thảo layout",
                "icon": "fa-table-columns",
                "order": 10,
                "description": "Thiết kế và soạn thảo layout báo cáo / form hiển thị"
            }
        ]
        return {"success": True, "features": features}


    def get_program_list(self):
        try:
            programs = _read_json(PROGRAM_LIST_FILE, [])
            if not isinstance(programs, list):
                programs = []
            res = []
            for p in programs:
                if not isinstance(p, dict):
                    continue
                item = dict(p)
                if item.get("password"):
                    item["password"] = decrypt_password(item["password"])
                res.append(item)
            return {"success": True, "programs": res}
        except Exception as exc:
            return {"success": False, "error": str(exc), "programs": []}


    def save_program_list(self, programs):
        try:
            if not isinstance(programs, list):
                return {"success": False, "error": "Dữ liệu chương trình không hợp lệ"}
            to_save = []
            for p in programs:
                if not isinstance(p, dict):
                    continue
                item = dict(p)
                pwd = item.get("password")
                if pwd and not str(pwd).startswith("ENC:"):
                    item["password"] = encrypt_password(pwd)
                to_save.append(item)
            ok = _write_json(PROGRAM_LIST_FILE, to_save)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_program_groups(self):
        try:
            groups = _read_json(PROGRAM_GROUPS_FILE, [])
            if not isinstance(groups, list):
                groups = []
            return {"success": True, "groups": groups}
        except Exception as exc:
            return {"success": False, "error": str(exc), "groups": []}


    def save_program_groups(self, groups):
        try:
            if not isinstance(groups, list):
                return {"success": False, "error": "Dữ liệu nhóm không hợp lệ"}
            to_save = []
            for g in groups:
                if not isinstance(g, dict):
                    continue
                to_save.append({
                    "id": str(g.get("id") or ""),
                    "name": str(g.get("name") or "").strip()
                })
            ok = _write_json(PROGRAM_GROUPS_FILE, to_save)
            return {"success": ok}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def select_program_file(self):
        try:
            target_win = getattr(self, '_window', None)
            if not target_win and hasattr(self, '_main_api') and self._main_api:
                target_win = getattr(self._main_api, '_window', None)

            # 1. Ưu tiên tuyệt đối sử dụng hộp thoại chuẩn của pywebview trên cửa sổ hiện hành
            if target_win:
                import webview
                files = target_win.create_file_dialog(
                    webview.OPEN_DIALOG,
                    allow_multiple=False,
                    file_types=('Executable Files (*.exe;*.bat;*.cmd)', 'All files (*.*)')
                )
                if files and len(files) > 0:
                    return {"success": True, "path": files[0]}
                # Người dùng bấm Hủy (Cancel) hoặc đóng hộp thoại -> dừng lại, không mở thêm cửa sổ thứ 2
                return {"success": False, "cancelled": True}

            # 2. Fallback Tkinter chỉ dùng khi hoàn toàn không có cửa sổ webview nào (môi trường headless)
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            file_path = filedialog.askopenfilename(
                title="Chọn chương trình thực thi (Executable)",
                filetypes=[("Chương trình thực thi (*.exe;*.bat;*.cmd)", "*.exe *.bat *.cmd"), ("Tất cả tệp", "*.*")]
            )
            root.destroy()

            if file_path:
                return {"success": True, "path": file_path}
            return {"success": False, "cancelled": True}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def grid_open_in_excel(self, columns=None, rows=None):
        return _desktop_grid_open_in_excel(columns=columns, rows=rows)


    def grid_save_results_as(self, columns=None, rows=None, default_filename=None):
        target_win = getattr(self, '_window', None)
        if not target_win and hasattr(self, '_main_api') and self._main_api:
            target_win = getattr(self._main_api, '_window', None)
        return _desktop_grid_save_results_as(
            columns=columns,
            rows=rows,
            default_filename=default_filename,
            window=target_win,
        )


    def run_program(self, program_data):
        try:
            import subprocess, os
            from app.utils.crypto import CredentialDecryptError
            if not program_data:
                return {"success": False, "error": "Thiếu thông tin chương trình"}

            prog_id = program_data.get("id") if isinstance(program_data, dict) else program_data
            if not prog_id:
                return {"success": False, "error": "ID chương trình không được để trống"}

            stored_programs = _read_json(PROGRAM_LIST_FILE, [])
            target = None
            for p in stored_programs:
                if str(p.get("id")) == str(prog_id):
                    target = p
                    break

            if not target:
                return {"success": False, "error": f"Không tìm thấy chương trình ID '{prog_id}' trong danh sách đã cấu hình"}

            path = (target.get("path") or "").strip()
            if not path:
                return {"success": False, "error": "Đường dẫn chương trình đã lưu không hợp lệ"}

            if not os.path.exists(path):
                return {"success": False, "error": f"Không tìm thấy file tại đường dẫn: {path}"}

            username = (target.get("username") or "").strip()
            raw_password = target.get("password") or ""
            password = ""
            if raw_password:
                try:
                    password = decrypt_password(raw_password)
                except CredentialDecryptError as dec_err:
                    logger.error("[run_program] Password decrypt error for %s: %s", prog_id, dec_err)
                    return {"success": False, "error": "Mật khẩu đã lưu không thể giải mã. Vui lòng nhập lại mật khẩu trong danh sách chương trình."}

            cmd = [path]
            if username:
                cmd.append(f"-u:{username}")
            if password:
                cmd.append(f"-p:{password}")

            work_dir = os.path.dirname(path) if os.path.isdir(os.path.dirname(path)) else None
            subprocess.Popen(cmd, cwd=work_dir)
            logger.info("[run_program] Executed program id=%s, name=%s", prog_id, target.get("name"))
            return {"success": True, "message": f"Đã khởi chạy: {target.get('name') or path}"}
        except Exception as exc:
            logger.error("[run_program] Exception: %s", exc)
            return {"success": False, "error": str(exc)}


    def create_session(self, config=None, connection_id=None, window_id=None):
        wid = window_id or str(uuid.uuid4())
        sid = f"bravo_{uuid.uuid4().hex[:12]}"
        self._bravo_sessions[sid] = {
            "connection_id": connection_id,
            "window_id": wid,
            "config": config
        }
        return {"success": True, "bravo_session_id": sid, "window_id": wid}


    def destroy_session(self, bravo_session_id):
        if bravo_session_id in self._bravo_sessions:
            del self._bravo_sessions[bravo_session_id]
            return {"success": True}
        return {"success": False, "error": "Session not found"}


    def get_session(self, bravo_session_id):
        sess = self._bravo_sessions.get(bravo_session_id)
        if not sess:
            return {"success": False, "error": "Session not found"}
        return {"success": True, "session": sess}


    def layout_editor_list(self, connection_id, database=None, platform="Win", version="Bravo 10", custom_where=""):
        if not connection_id:
            return {"success": False, "error": "connection_id is required"}

        try:
            conn = self._get_connection(connection_id)
            conn_config = getattr(conn, "config", {}) or {}
            c_type = str(conn_config.get("type") or "").strip().lower()
            is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
                conn.adapter and conn.adapter.__class__.__name__.lower().startswith("postgre")
            )

            if is_postgres:
                if platform == "Win":
                    if version == "Bravo 7":
                        sql = """SELECT l.id AS "Id", l.formname AS "FormName", l.layoutname AS "LayoutName", l.istemplate AS "IsTemplate",
                                        l.createdby AS "CreatedBy", l.modifiedat AS "ModifiedAt", u.username AS "ModifiedBy", 0 AS "HasDraft",
                                        c.commandkey AS "CommandKey", c.dllname AS "DllName", c.classname AS "ClassName"
                                 FROM b00layout AS l
                                 INNER JOIN b00layoutdata AS ld ON ld.id = l.id
                                 LEFT OUTER JOIN b00command AS c ON c.ctorarg2 = l.formname
                                 LEFT OUTER JOIN b00userlist AS u ON u.id = l.modifiedby"""
                    else:
                        sql = """SELECT l.id AS "Id", l.formname AS "FormName", l.layoutname AS "LayoutName", l.istemplate AS "IsTemplate",
                                        l.createdby AS "CreatedBy", l.modifiedat AS "ModifiedAt", u.username AS "ModifiedBy",
                                        CASE WHEN ld.lastlayoutdata IS NOT NULL AND OCTET_LENGTH(ld.lastlayoutdata) > 0 THEN 1 ELSE 0 END AS "HasDraft",
                                        c.commandkey AS "CommandKey", c.dllname AS "DllName", c.classname AS "ClassName"
                                 FROM b00layout AS l
                                 INNER JOIN b00layoutdata AS ld ON ld.id = l.id
                                 LEFT OUTER JOIN b00command AS c ON c.commandkey = l.formname
                                 LEFT OUTER JOIN b00userlist AS u ON u.id = l.modifiedby"""
                else:
                    if version == "Bravo 8":
                        sql = """SELECT id AS "Id", name AS "FormName", '' AS "LayoutName", 0 AS "IsTemplate", NULL AS "CreatedBy",
                                        modifiedat AS "ModifiedAt", NULL AS "ModifiedBy", 0 AS "HasDraft",
                                        name AS "CommandKey", '' AS "DllName", '' AS "ClassName"
                                 FROM b00storyboard"""
                    else:
                        sql = """SELECT l.id AS "Id", l.formname AS "FormName", l.layoutname AS "LayoutName", 0 AS "IsTemplate",
                                        l.createdby AS "CreatedBy", l.modifiedat AS "ModifiedAt", u.username AS "ModifiedBy",
                                        CASE WHEN ld.lastlayoutdata IS NOT NULL AND OCTET_LENGTH(ld.lastlayoutdata) > 0 THEN 1 ELSE 0 END AS "HasDraft",
                                        c.commandkey AS "CommandKey", c.dllname AS "DllName", c.classname AS "ClassName"
                                 FROM b09layout AS l
                                 INNER JOIN b09layoutdata AS ld ON ld.id = l.id
                                 LEFT OUTER JOIN b09command AS c ON c.commandkey = l.formname
                                 LEFT OUTER JOIN b00userlist AS u ON u.id = l.modifiedby"""
            else:
                if platform == "Win":
                    if version == "Bravo 7":
                        sql = """SELECT l.Id, l.FormName, l.LayoutName, l.IsTemplate, l.CreatedBy, l.ModifiedAt, u.UserName AS ModifiedBy, 0 AS HasDraft,
                                        c.CommandKey, c.DllName, c.ClassName
                                 FROM B00Layout AS l
                                 INNER JOIN B00LayoutData AS ld ON ld.Id = l.Id
                                 LEFT OUTER JOIN B00Command AS c ON c.CtorArg2 = l.FormName
                                 LEFT OUTER JOIN B00UserList AS u ON u.Id = l.ModifiedBy"""
                    else:
                        sql = """SELECT l.Id, l.FormName, l.LayoutName, l.IsTemplate, l.CreatedBy, l.ModifiedAt, u.UserName AS ModifiedBy,
                                        CASE WHEN ld.LastLayoutData IS NOT NULL AND DATALENGTH(ld.LastLayoutData) > 0 THEN 1 ELSE 0 END AS HasDraft,
                                        c.CommandKey, c.DllName, c.ClassName
                                 FROM B00Layout AS l
                                 INNER JOIN B00LayoutData AS ld ON ld.Id = l.Id
                                 LEFT OUTER JOIN B00Command AS c ON c.CommandKey = l.FormName
                                 LEFT OUTER JOIN B00UserList AS u ON u.Id = l.ModifiedBy"""
                else:
                    if version == "Bravo 8":
                        sql = """SELECT Id, Name AS FormName, '' AS LayoutName, 0 AS IsTemplate, NULL AS CreatedBy, ModifiedAt, NULL AS ModifiedBy, 0 AS HasDraft,
                                        Name AS CommandKey, '' AS DllName, '' AS ClassName
                                 FROM B00StoryBoard"""
                    else:
                        sql = """SELECT l.Id, l.FormName, l.LayoutName, 0 AS IsTemplate, l.CreatedBy, l.ModifiedAt, u.UserName AS ModifiedBy,
                                        CASE WHEN ld.LastLayoutData IS NOT NULL AND DATALENGTH(ld.LastLayoutData) > 0 THEN 1 ELSE 0 END AS HasDraft,
                                        c.CommandKey, c.DllName, c.ClassName
                                 FROM B09Layout AS l
                                 INNER JOIN B09LayoutData AS ld ON ld.Id = l.Id
                                 LEFT OUTER JOIN B09Command AS c ON c.CommandKey = l.FormName
                                 LEFT OUTER JOIN B00UserList AS u ON u.Id = l.ModifiedBy"""

            if custom_where and custom_where.strip():
                cw = custom_where.strip()
                if not cw.upper().startswith("WHERE"):
                    sql += f" WHERE 1=1 {cw}"
                else:
                    sql += f" {cw}"

            order_col = "l.formname" if is_postgres else "l.FormName"
            sql += f" ORDER BY {order_col}"

            result = conn.query_service.execute(sql, limit=5000, database=database)
            if not result.get("success", False):
                return result

            rows = result.get("rows", [])
            columns = result.get("columns", [])
            template_map = {0: "Layout", 1: "FormTemplate", 2: "GlobalLayout", 3: "Datasource", 4: "SubLayout"}

            items = []
            for r in rows:
                col_map = {str(col).lower(): val for col, val in zip(columns, r)}
                is_tpl = col_map.get("istemplate", 0) or 0
                items.append({
                    "id": col_map.get("id"),
                    "formName": col_map.get("formname", "") or "",
                    "layoutName": col_map.get("layoutname", "") or "",
                    "layoutType": template_map.get(is_tpl, "Khác"),
                    "isTemplate": is_tpl,
                    "createdBy": col_map.get("createdby", "") or "",
                    "modifiedAt": str(col_map.get("modifiedat", "")) if col_map.get("modifiedat") else "",
                    "modifiedBy": col_map.get("modifiedby", "") or "",
                    "hasDraft": bool(col_map.get("hasdraft", 0)),
                    "commandKey": col_map.get("commandkey", "") or "",
                    "dllName": col_map.get("dllname", "") or "",
                    "className": col_map.get("classname", "") or "",
                })

            return {"success": True, "items": items}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def layout_editor_payload(self, connection_id, form_id, database=None, platform="Win", version="Bravo 10"):
        if not connection_id or form_id is None:
            return {"success": False, "error": "connection_id and form id are required"}

        try:
            conn = self._get_connection(connection_id)
            conn_config = getattr(conn, "config", {}) or {}
            c_type = str(conn_config.get("type") or "").strip().lower()
            is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
                conn.adapter and conn.adapter.__class__.__name__.lower().startswith("postgre")
            )

            if platform == "Win":
                tbl = "b00layoutdata" if is_postgres else "B00LayoutData"
                sql = f"SELECT Id, LayoutData, LastLayoutData FROM {tbl} WHERE Id = {int(form_id)}"
            else:
                if version == "Bravo 8":
                    tbl = "b00storyboard" if is_postgres else "B00StoryBoard"
                    sql = f"SELECT Id, LayoutXml AS LayoutData, NULL AS LastLayoutData FROM {tbl} WHERE Id = {int(form_id)}"
                else:
                    tbl = "b09layoutdata" if is_postgres else "B09LayoutData"
                    sql = f"SELECT Id, LayoutData, LastLayoutData FROM {tbl} WHERE Id = {int(form_id)}"

            result = conn.query_service.execute(sql, database=database)
            if not result.get("success", False) or not result.get("rows"):
                return {"success": False, "error": "Record not found"}

            row = result["rows"][0]
            raw_xml = row[1] if len(row) > 1 else ""
            raw_draft = row[2] if len(row) > 2 else ""

            xml_content = _decode_xml_payload(raw_xml, version)
            draft_xml_content = _decode_xml_payload(raw_draft, version) if raw_draft else ""

            return {
                "success": True,
                "id": form_id,
                "xml": xml_content,
                "draft_xml": draft_xml_content
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def layout_editor_commit(self, connection_id, forms, database=None, platform="Win", version="Bravo 10"):
        if not connection_id or not forms:
            return {"success": False, "error": "connection_id and forms list are required"}

        # 1. Pre-commit XML Syntax Validation
        for item in forms:
            xml_str = item.get("xml", "")
            valid, err = _validate_xml_syntax(xml_str)
            if not valid:
                return {
                    "success": False,
                    "error": f"Cú pháp XML không hợp lệ tại form '{item.get('formName')}': {err}"
                }

        try:
            conn = self._get_connection(connection_id)
            conn_config = getattr(conn, "config", {}) or {}
            c_type = str(conn_config.get("type") or "").strip().lower()
            is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
                conn.adapter and conn.adapter.__class__.__name__.lower().startswith("postgre")
            )

            def _format_binary_literal(binary_data):
                if not binary_data:
                    return "NULL"
                hex_str = binary_data.hex()
                if is_postgres:
                    return f"decode('{hex_str}', 'hex')"
                return f"0x{hex_str}"

            time_fn = "CURRENT_TIMESTAMP" if is_postgres else "GETDATE()"

            # 2. Build Atomic Transaction Script
            statements = ["BEGIN TRANSACTION;"]
            for item in forms:
                f_id = int(item.get("id"))
                xml_str = item.get("xml", "")
                draft_xml_str = item.get("draft_xml")

                if platform == "Mobile" and version == "Bravo 8":
                    xml_escaped = xml_str.replace("'", "''")
                    tbl_sb = "b00storyboard" if is_postgres else "B00StoryBoard"
                    statements.append(f"UPDATE {tbl_sb} SET LayoutXml = '{xml_escaped}', ModifiedAt = {time_fn} WHERE Id = {f_id};")
                else:
                    zip_bytes = _encode_xml_payload(xml_str, version=version, format_type="zip")
                    bin_lit = _format_binary_literal(zip_bytes)
                    set_clause = f"LayoutData = {bin_lit}"

                    if draft_xml_str is not None:
                        draft_bytes = _encode_xml_payload(draft_xml_str, version=version, format_type="zip")
                        draft_bin_lit = _format_binary_literal(draft_bytes)
                        set_clause += f", LastLayoutData = {draft_bin_lit}"

                    if is_postgres:
                        table_data = "b00layoutdata" if platform == "Win" else "b09layoutdata"
                        table_main = "b00layout" if platform == "Win" else "b09layout"
                    else:
                        table_data = "B00LayoutData" if platform == "Win" else "B09LayoutData"
                        table_main = "B00Layout" if platform == "Win" else "B09Layout"

                    statements.append(f"UPDATE {table_data} SET {set_clause} WHERE Id = {f_id};")
                    statements.append(f"UPDATE {table_main} SET ModifiedAt = {time_fn} WHERE Id = {f_id};")

            statements.append("COMMIT TRANSACTION;")
            full_sql = "\n".join(statements)

            result = conn.query_service.execute(full_sql, database=database)
            if not result.get("success", False):
                return result

            return {"success": True, "count": len(forms), "message": "Commit successful!"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def layout_editor_search_xml(self, connection_id, keyword, form_ids=None, database=None, platform="Win", version="Bravo 10", is_regex=False):
        if not connection_id or not keyword:
            return {"success": False, "error": "connection_id and keyword are required"}
        if not form_ids:
            return {"success": True, "results": []}

        import re as _re
        ids_str = ", ".join(str(int(fid)) for fid in form_ids)

        try:
            conn = self._get_connection(connection_id)
            conn_config = getattr(conn, "config", {}) or {}
            c_type = str(conn_config.get("type") or "").strip().lower()
            is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
                conn.adapter and conn.adapter.__class__.__name__.lower().startswith("postgre")
            )

            if platform == "Win":
                tbl = "b00layoutdata" if is_postgres else "B00LayoutData"
                sql = f"SELECT Id, LayoutData FROM {tbl} WHERE Id IN ({ids_str})"
            else:
                if version == "Bravo 8":
                    tbl = "b00storyboard" if is_postgres else "B00StoryBoard"
                    sql = f"SELECT Id, LayoutXml AS LayoutData FROM {tbl} WHERE Id IN ({ids_str})"
                else:
                    tbl = "b09layoutdata" if is_postgres else "B09LayoutData"
                    sql = f"SELECT Id, LayoutData FROM {tbl} WHERE Id IN ({ids_str})"

            result = conn.query_service.execute(sql, database=database)
            if not result.get("success", False):
                return {"success": False, "error": result.get("error", "Query failed")}

            rows = result.get("rows", [])
            matched = []

            for r in rows:
                fid = r[0]
                raw_val = r[1] if len(r) > 1 else ""
                xml_str = _decode_xml_payload(raw_val, version)
                if not xml_str:
                    continue

                lines = xml_str.splitlines()
                hits = []
                for idx, line in enumerate(lines):
                    if is_regex:
                        try:
                            if _re.search(keyword, line, _re.IGNORECASE):
                                hits.append({"line": idx + 1, "content": line.strip()[:150]})
                        except Exception:
                            if keyword.lower() in line.lower():
                                hits.append({"line": idx + 1, "content": line.strip()[:150]})
                    else:
                        if keyword.lower() in line.lower():
                            hits.append({"line": idx + 1, "content": line.strip()[:150]})

                if hits:
                    matched.append({
                        "id": fid,
                        "match_count": len(hits),
                        "snippets": hits[:10]
                    })

            return {"success": True, "results": matched}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

