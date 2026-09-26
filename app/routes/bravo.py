import base64
import gzip
import io
import json
import os
import uuid
import xml.etree.ElementTree as ET
import zipfile
import zlib

from flask import Blueprint, jsonify, request
from app.routes._common import get_connection_manager, get_owner_session_id

bravo_bp = Blueprint("bravo", __name__)

_SETTINGS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "settings", "settings.json"
)

def _load_settings():
    try:
        with open(_SETTINGS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

from app.utils.crypto import encrypt_password, decrypt_password

_PROGRAM_LIST_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "programlist.json"
)
_PROGRAM_GROUPS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "programgroups.json"
)

# ── In-memory BRAVO session store ─────────────────────────────────────────────
_bravo_sessions: dict = {}

# ── Registered features ───────────────────────────────────────────────────────
_BRAVO_FEATURES = [
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


@bravo_bp.get("/programs")
def get_programs():
    try:
        if os.path.exists(_PROGRAM_LIST_PATH):
            with open(_PROGRAM_LIST_PATH, "r", encoding="utf-8") as f:
                programs = json.load(f)
        else:
            programs = []
        res = []
        for p in programs:
            if not isinstance(p, dict):
                continue
            item = dict(p)
            if item.get("password"):
                item["password"] = decrypt_password(item["password"])
            res.append(item)
        return jsonify(success=True, programs=res)
    except Exception as exc:
        return jsonify(success=False, error=str(exc), programs=[])


@bravo_bp.post("/programs")
def save_programs():
    try:
        data = request.get_json(force=True) or {}
        programs = data.get("programs", [])
        if not isinstance(programs, list):
            return jsonify(success=False, error="Dữ liệu chương trình không hợp lệ"), 400
        to_save = []
        for p in programs:
            if not isinstance(p, dict):
                continue
            item = dict(p)
            pwd = item.get("password")
            if pwd and not str(pwd).startswith("ENC:"):
                item["password"] = encrypt_password(pwd)
            to_save.append(item)
        os.makedirs(os.path.dirname(_PROGRAM_LIST_PATH), exist_ok=True)
        with open(_PROGRAM_LIST_PATH, "w", encoding="utf-8") as f:
            json.dump(to_save, f, indent=4, ensure_ascii=False)
        return jsonify(success=True)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


@bravo_bp.get("/programs/groups")
def get_program_groups():
    try:
        if os.path.exists(_PROGRAM_GROUPS_PATH):
            with open(_PROGRAM_GROUPS_PATH, "r", encoding="utf-8") as f:
                groups = json.load(f)
        else:
            groups = []
        return jsonify(success=True, groups=groups)
    except Exception as exc:
        return jsonify(success=False, error=str(exc), groups=[])


@bravo_bp.post("/programs/groups")
def save_program_groups():
    try:
        data = request.get_json(force=True) or {}
        groups = data.get("groups", [])
        if not isinstance(groups, list):
            return jsonify(success=False, error="Dữ liệu nhóm không hợp lệ"), 400
        to_save = []
        for g in groups:
            if not isinstance(g, dict):
                continue
            to_save.append({
                "id": str(g.get("id") or ""),
                "name": str(g.get("name") or "").strip()
            })
        os.makedirs(os.path.dirname(_PROGRAM_GROUPS_PATH), exist_ok=True)
        with open(_PROGRAM_GROUPS_PATH, "w", encoding="utf-8") as f:
            json.dump(to_save, f, indent=4, ensure_ascii=False)
        return jsonify(success=True)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


@bravo_bp.post("/programs/run")
def run_program_endpoint():
    try:
        import subprocess
        data = request.get_json(force=True) or {}
        program_data = data.get("program", data)
        path = (program_data.get("path") or "").strip()
        if not path:
            return jsonify(success=False, error="Đường dẫn chương trình không được để trống"), 400
        if not os.path.exists(path):
            return jsonify(success=False, error=f"Không tìm thấy file tại đường dẫn: {path}"), 404

        username = (program_data.get("username") or "").strip()
        password = program_data.get("password") or ""
        if password.startswith("ENC:"):
            password = decrypt_password(password)

        cmd = [path]
        if username:
            cmd.append(f"-u:{username}")
        if password:
            cmd.append(f"-p:{password}")

        work_dir = os.path.dirname(path) if os.path.isdir(os.path.dirname(path)) else None
        subprocess.Popen(cmd, cwd=work_dir)
        return jsonify(success=True, message=f"Đã khởi chạy: {program_data.get('name') or path}")
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500



@bravo_bp.get("/config")
def get_config():
    settings = _load_settings()
    enabled = settings.get("addons", {}).get("bravo_tool", {}).get("enabled", False)
    return jsonify(success=True, enabled=enabled)


@bravo_bp.get("/features")
def list_features():
    return jsonify(success=True, features=sorted(_BRAVO_FEATURES, key=lambda f: f["order"]))


@bravo_bp.get("/connections")
def list_connections():
    """Return all saved connections so BRAVO top bar can populate its dropdown."""
    try:
        cm = get_connection_manager()
        items = [conn.public_info() for conn in cm.list(get_owner_session_id())]
        return jsonify(success=True, connections=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


@bravo_bp.post("/session")
def create_session():
    data = request.get_json(silent=True) or {}
    connection_id = data.get("connection_id")
    window_id = data.get("window_id") or str(uuid.uuid4())

    bravo_session_id = f"bravo_{uuid.uuid4().hex[:12]}"
    _bravo_sessions[bravo_session_id] = {
        "connection_id": connection_id,
        "window_id": window_id,
        "owner": get_owner_session_id()
    }
    return jsonify(success=True, bravo_session_id=bravo_session_id, window_id=window_id)


@bravo_bp.delete("/session/<bravo_session_id>")
def destroy_session(bravo_session_id):
    if bravo_session_id in _bravo_sessions:
        del _bravo_sessions[bravo_session_id]
        return jsonify(success=True)
    return jsonify(success=False, error="Session not found"), 404


@bravo_bp.get("/session/<bravo_session_id>")
def get_session(bravo_session_id):
    session = _bravo_sessions.get(bravo_session_id)
    if not session:
        return jsonify(success=False, error="Session not found"), 404
    return jsonify(success=True, session=session)


# ── Codec & Helper functions for Layout Editor (Specification 4.1 & 7.1) ──────

def _beautify_xml_string(xml_str):
    if not xml_str or not xml_str.strip():
        return ""
    s = xml_str.strip()

    # 1. Try standard minidom parse
    try:
        dom = xml.dom.minidom.parseString(s)
        pretty = dom.toprettyxml(indent="  ")
        lines = [line for line in pretty.splitlines() if line.strip()]
        return "\n".join(lines)
    except Exception:
        pass

    # 2. Try wrapping in dummy root if fragment or unrooted text
    try:
        wrapped = f"<root>{s}</root>"
        dom = xml.dom.minidom.parseString(wrapped)
        pretty = dom.toprettyxml(indent="  ")
        lines = [line for line in pretty.splitlines() if line.strip()]
        lines = [l for l in lines if not l.startswith('<?xml')]
        if len(lines) >= 2 and lines[0].strip() == '<root>' and lines[-1].strip() == '</root>':
            inner_lines = lines[1:-1]
            outdented = [l[2:] if l.startswith('  ') else l for l in inner_lines]
            return "\n".join(outdented)
    except Exception:
        pass

    # 3. Fallback regex beautifier
    try:
        clean = s.replace('><', '>\n<')
        formatted = []
        pad = 0
        for line in clean.split('\n'):
            line = line.strip()
            if not line:
                continue
            if line.startswith('</'):
                if pad > 0: pad -= 1
            indent_str = '  ' * pad
            formatted.append(indent_str + line)
            if line.startswith('<') and not line.startswith('</') and not line.startswith('<?') and not line.endswith('/>') and '</' not in line:
                pad += 1
        return "\n".join(formatted)
    except Exception:
        return xml_str


def _decode_xml_payload(raw_val, version):
    """
    Decode XML payload from DB based on version & content format.
    Handles:
    - ZIP Compressed Stream starting with 0x504B0304 ('PK\\x03\\x04')
    - Base64 encoded ZIP or Base64 UTF-8 string (Bravo 10)
    - Base64 GZIP / ZLIB compressed binary
    - UTF-8 Plain text XML (Bravo 7, Bravo 8, or unencoded DB records)
    """
    if not raw_val:
        return ""

    raw_bytes = None

    if isinstance(raw_val, bytes):
        raw_bytes = raw_val
    elif isinstance(raw_val, str):
        str_val = raw_val.strip()

        # Check Hex string starting with 0x or raw hex (from serialize_cell or DB varbinary)
        if str_val.lower().startswith("0x"):
            try:
                raw_bytes = bytes.fromhex(str_val[2:])
            except Exception:
                pass
        elif str_val.lower().startswith("504b0304"):
            try:
                raw_bytes = bytes.fromhex(str_val)
            except Exception:
                pass

        # Check if already plain-text XML
        if raw_bytes is None and (str_val.startswith("<") or str_val.startswith("<?xml")):
            return _beautify_xml_string(str_val)

        # Try Base64 decode
        if raw_bytes is None:
            try:
                raw_bytes = base64.b64decode(str_val)
            except Exception:
                raw_bytes = str_val.encode("utf-8", errors="replace")

    if not raw_bytes:
        return ""

    result_text = ""

    # 1. Check ZIP Archive signature b"PK\x03\x04" (Hex 0x504B0304)
    if len(raw_bytes) >= 4 and raw_bytes[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as z:
                names = z.namelist()
                if names:
                    result_text = z.read(names[0]).decode("utf-8", errors="replace")
        except Exception:
            pass

    # 2. Check GZIP signature b"\x1f\x8b"
    if not result_text and len(raw_bytes) >= 2 and raw_bytes[:2] == b"\x1f\x8b":
        try:
            result_text = gzip.decompress(raw_bytes).decode("utf-8", errors="replace")
        except Exception:
            pass

    # 3. Check ZLIB header
    if not result_text and len(raw_bytes) >= 2 and raw_bytes[0] == 0x78:
        try:
            result_text = zlib.decompress(raw_bytes).decode("utf-8", errors="replace")
        except Exception:
            pass

    # 4. Standard UTF-8 / UTF-16 text (and nested Base64)
    if not result_text:
        try:
            result_text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            result_text = raw_bytes.decode("utf-16", errors="replace")

        # If decoded text is not yet XML, test if it is a Base64 encoded payload
        trimmed = result_text.strip()
        if not (trimmed.startswith("<") or trimmed.startswith("<?xml")):
            try:
                b64_bytes = base64.b64decode(trimmed)
                if len(b64_bytes) >= 4 and b64_bytes[:4] == b"PK\x03\x04":
                    with zipfile.ZipFile(io.BytesIO(b64_bytes)) as z:
                        names = z.namelist()
                        if names:
                            result_text = z.read(names[0]).decode("utf-8", errors="replace")
                else:
                    b64_str = b64_bytes.decode("utf-8", errors="replace")
                    if b64_str.strip().startswith("<"):
                        result_text = b64_str
            except Exception:
                pass

    return _beautify_xml_string(result_text)



def _encode_xml_payload(xml_str, version=None, format_type="zip"):
    """
    Encode XML payload to store back into Database.
    Bravo Win & Mobile store LayoutData as a ZIP archive (Deflate)
    containing an internal entry named 'Xml' (b'PK\x03\x04...').
    """
    if not xml_str:
        return b""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("Xml", xml_str.encode("utf-8"))
    return buffer.getvalue()


def _validate_xml_syntax(xml_str):
    if not xml_str or not xml_str.strip():
        return True, None
    try:
        ET.fromstring(xml_str.strip())
        return True, None
    except ET.ParseError as err:
        return False, str(err)


# ── Layout Editor Backend API Endpoints (edit_layout.md Specification) ──────

@bravo_bp.post("/layout-editor/list")
def layout_editor_list():
    """Metadata query for Layout Editor Master Grid (Specification 3.1)."""
    data = request.get_json(silent=True) or {}
    connection_id = data.get("connection_id")
    database = data.get("database")
    platform = data.get("platform", "Win")
    version = data.get("version", "Bravo 10")
    custom_where = data.get("custom_where", "").strip()

    if not connection_id:
        return jsonify(success=False, error="connection_id is required"), 400

    try:
        connection = get_connection_manager().get(get_owner_session_id(), connection_id)
        conn_config = getattr(connection, "config", {}) or {}
        c_type = str(conn_config.get("type") or "").strip().lower()
        is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
            connection.adapter and connection.adapter.__class__.__name__.lower().startswith("postgre")
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

        if custom_where:
            if not custom_where.upper().startswith("WHERE"):
                sql += f" WHERE 1=1 {custom_where}"
            else:
                sql += f" {custom_where}"

        order_col = "l.formname" if is_postgres else "l.FormName"
        sql += f" ORDER BY {order_col}"

        result = connection.query_service.execute(sql, database=database)
        if not result.get("success", False):
            return jsonify(result), 400

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

        return jsonify(success=True, items=items)
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


@bravo_bp.post("/layout-editor/payload")
def layout_editor_payload():
    """Payload Query: Fetch XML content on-demand (Specification 3.2 & 4.1)."""
    data = request.get_json(silent=True) or {}
    connection_id = data.get("connection_id")
    database = data.get("database")
    platform = data.get("platform", "Win")
    version = data.get("version", "Bravo 10")
    form_id = data.get("id")

    if not connection_id or form_id is None:
        return jsonify(success=False, error="connection_id and form id are required"), 400

    try:
        connection = get_connection_manager().get(get_owner_session_id(), connection_id)
        conn_config = getattr(connection, "config", {}) or {}
        c_type = str(conn_config.get("type") or "").strip().lower()
        is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
            connection.adapter and connection.adapter.__class__.__name__.lower().startswith("postgre")
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

        result = connection.query_service.execute(sql, database=database)
        if not result.get("success", False) or not result.get("rows"):
            return jsonify(success=False, error="Record not found"), 404

        row = result["rows"][0]
        raw_xml = row[1] if len(row) > 1 else ""
        raw_draft = row[2] if len(row) > 2 else ""

        xml_content = _decode_xml_payload(raw_xml, version)
        draft_xml_content = _decode_xml_payload(raw_draft, version) if raw_draft else ""

        return jsonify(
            success=True,
            id=form_id,
            xml=xml_content,
            draft_xml=draft_xml_content
        )
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


@bravo_bp.post("/layout-editor/commit")
def layout_editor_commit():
    """Atomic Database Commit Transaction (Specification 7)."""
    data = request.get_json(silent=True) or {}
    connection_id = data.get("connection_id")
    database = data.get("database")
    platform = data.get("platform", "Win")
    version = data.get("version", "Bravo 10")
    forms = data.get("forms", [])

    if not connection_id or not forms:
        return jsonify(success=False, error="connection_id and forms list are required"), 400

    # 1. Pre-commit XML Syntax Validation
    for item in forms:
        xml_str = item.get("xml", "")
        valid, err = _validate_xml_syntax(xml_str)
        if not valid:
            return jsonify(
                success=False,
                error=f"Cú pháp XML không hợp lệ tại form '{item.get('formName')}': {err}"
            ), 400

    try:
        connection = get_connection_manager().get(get_owner_session_id(), connection_id)
        conn_config = getattr(connection, "config", {}) or {}
        c_type = str(conn_config.get("type") or "").strip().lower()
        is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
            connection.adapter and connection.adapter.__class__.__name__.lower().startswith("postgre")
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

        result = connection.query_service.execute(full_sql, database=database)

        if not result.get("success", False):
            return jsonify(result), 400

        return jsonify(success=True, count=len(forms), message="Commit successful!")
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


@bravo_bp.post("/layout-editor/search-xml")
def layout_editor_search_xml():
    """
    Hybrid XML Batch Search (Specification 4.2.3).
    Fetches LayoutData for given form_ids, decodes payload (Base64/ZIP),
    then searches for keyword occurrences line-by-line.
    Never uses SQL LIKE on encoded columns.
    """
    data = request.get_json(silent=True) or {}
    connection_id = data.get("connection_id")
    database = data.get("database")
    platform = data.get("platform", "Win")
    version = data.get("version", "Bravo 10")
    keyword = data.get("keyword", "").strip()
    is_regex = data.get("is_regex", False)
    form_ids = data.get("form_ids", [])

    if not connection_id or not keyword:
        return jsonify(success=False, error="connection_id and keyword are required"), 400

    if not form_ids:
        return jsonify(success=True, results=[])

    import re as _re

    ids_str = ", ".join(str(int(fid)) for fid in form_ids)

    try:
        connection = get_connection_manager().get(get_owner_session_id(), connection_id)
        conn_config = getattr(connection, "config", {}) or {}
        c_type = str(conn_config.get("type") or "").strip().lower()
        is_postgres = (c_type in {"postgresql", "postgres", "pgsql"}) or (
            connection.adapter and connection.adapter.__class__.__name__.lower().startswith("postgre")
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
            result = connection.query_service.execute(sql, database=database)
            if not result.get("success", False):
                return jsonify(success=False, error=result.get("error", "Query failed")), 400

        rows = result.get("rows", [])
        columns = result.get("columns", [])

        results = []
        for row in rows:
            row_dict = dict(zip(columns, row))
            form_id = row_dict.get("Id")
            raw_payload = row_dict.get("LayoutData")

            xml_text = _decode_xml_payload(raw_payload, version)
            if not xml_text:
                continue

            lines_list = xml_text.split("\n")
            occurrences = []
            try:
                if is_regex:
                    pattern = _re.compile(keyword, _re.IGNORECASE)
                    for line_num, line_content in enumerate(lines_list, start=1):
                        if pattern.search(line_content):
                            occurrences.append({"line": line_num, "content": line_content.strip()})
                else:
                    kw_lower = keyword.lower()
                    for line_num, line_content in enumerate(lines_list, start=1):
                        if kw_lower in line_content.lower():
                            occurrences.append({"line": line_num, "content": line_content.strip()})
            except _re.error:
                kw_lower = keyword.lower()
                for line_num, line_content in enumerate(lines_list, start=1):
                    if kw_lower in line_content.lower():
                        occurrences.append({"line": line_num, "content": line_content.strip()})

            results.append({
                "form_id": form_id,
                "form_name": None,
                "layout_name": None,
                "occurrences": occurrences
            })

        return jsonify(success=True, results=results)

    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


