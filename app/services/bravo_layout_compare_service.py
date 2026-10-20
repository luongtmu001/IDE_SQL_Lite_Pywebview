# -*- coding: utf-8 -*-
"""
Bravo Layout Compare & Update Service.
Handles Bravo Layout comparison, payload extraction, XML decoding/encoding,
transactional update script generation, optimistic concurrency control, and atomic updates.
Supports both SQL Server and PostgreSQL.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple, Union

from app.bravo.xml_codec import (
    decode_xml_payload,
    encode_xml_payload,
    validate_xml_syntax,
)

logger = logging.getLogger("luobtool.services.bravo_layout_compare")


class BravoLayoutCompareService:
    """Service providing Bravo Layout comparison and atomic update operations."""

    @staticmethod
    def is_postgres(conn_or_type: Any) -> bool:
        """Determine whether connection or database type string represents PostgreSQL."""
        if isinstance(conn_or_type, str):
            t = conn_or_type.strip().lower()
            return t in {"postgresql", "postgres", "pgsql"}
        if conn_or_type is None:
            return False

        conn_config = getattr(conn_or_type, "config", {}) or {}
        c_type = str(conn_config.get("type") or "").strip().lower()
        if c_type in {"postgresql", "postgres", "pgsql"}:
            return True

        adapter = getattr(conn_or_type, "adapter", None)
        if adapter:
            adp_type = str(getattr(adapter, "db_type", "")).strip().lower()
            if adp_type in {"postgresql", "postgres", "pgsql"}:
                return True
            if adapter.__class__.__name__.lower().startswith("postgre"):
                return True

        return False

    @classmethod
    def get_layout_list(
        cls,
        conn: Any,
        database: Optional[str] = None,
        platform: str = "Win",
        version: str = "Bravo 10",
        search_term: str = "",
    ) -> Dict[str, Any]:
        """
        Queries layout metadata from B00Layout joined with B00LayoutData.
        Groups the layouts hierarchically by FormName.
        Excludes full XML payloads from this query to optimize memory and network bandwidth.
        """
        if not conn:
            return {"success": False, "error": "Connection is required"}

        try:
            is_pg = cls.is_postgres(conn)
            if is_pg:
                table_layout = "b00layout" if platform == "Win" else "b09layout"
                table_data = "b00layoutdata" if platform == "Win" else "b09layoutdata"
                sql = f"""SELECT
                            a.id AS "Id",
                            a.formname AS "FormName",
                            a.layoutname AS "LayoutName",
                            a.modifiedat AS "ModifiedAt",
                            CASE WHEN b.lastlayoutdata IS NOT NULL AND OCTET_LENGTH(b.lastlayoutdata) > 0 THEN 1 ELSE 0 END AS "HasDraft",
                            a.istemplate AS "IsTemplate",
                            a.createdby AS "CreatedBy",
                            OCTET_LENGTH(b.layoutdata) AS "PayloadLength"
                         FROM {table_layout} AS a
                         INNER JOIN {table_data} AS b ON a.id = b.id
                         ORDER BY a.formname, a.layoutname;"""
            else:
                table_layout = "B00Layout" if platform == "Win" else "B09Layout"
                table_data = "B00LayoutData" if platform == "Win" else "B09LayoutData"
                sql = f"""SELECT
                            a.Id,
                            a.FormName,
                            a.LayoutName,
                            a.ModifiedAt,
                            CASE WHEN b.LastLayoutData IS NOT NULL AND DATALENGTH(b.LastLayoutData) > 0 THEN 1 ELSE 0 END AS HasDraft,
                            a.IsTemplate,
                            a.CreatedBy,
                            DATALENGTH(b.LayoutData) AS PayloadLength
                         FROM {table_layout} AS a
                         INNER JOIN {table_data} AS b ON a.Id = b.Id
                         ORDER BY a.FormName, a.LayoutName;"""

            result = conn.query_service.execute(sql, limit=10000, database=database)
            if not result.get("success", False):
                return {"success": False, "error": result.get("error", "Query failed")}

            rows = result.get("rows", [])
            columns = [str(c).lower() for c in result.get("columns", [])]

            col_idx = {name: i for i, name in enumerate(columns)}
            id_idx = col_idx.get("id", 0)
            form_idx = col_idx.get("formname", 1)
            layout_idx = col_idx.get("layoutname", 2)
            mod_idx = col_idx.get("modifiedat", 3)
            draft_idx = col_idx.get("hasdraft", 4)
            tmpl_idx = col_idx.get("istemplate", 5)
            len_idx = col_idx.get("payloadlength")

            search_clean = (search_term or "").strip().lower()

            forms_map: Dict[str, List[Dict[str, Any]]] = {}
            total_layouts = 0

            for r in rows:
                f_name = str(r[form_idx] or "").strip()
                l_name = str(r[layout_idx] or "").strip()
                l_id = r[id_idx]

                if search_clean:
                    if search_clean not in f_name.lower() and search_clean not in l_name.lower():
                        continue

                mod_val = r[mod_idx]
                mod_str = str(mod_val) if mod_val is not None else ""

                item = {
                    "id": l_id,
                    "formName": f_name,
                    "layoutName": l_name or "(Mặc định)",
                    "modifiedAt": mod_str,
                    "hasDraft": bool(r[draft_idx]),
                    "isTemplate": r[tmpl_idx] if tmpl_idx < len(r) else 0,
                    "payloadLength": r[len_idx] if len_idx is not None and len_idx < len(r) else 0,
                }

                if f_name not in forms_map:
                    forms_map[f_name] = []
                forms_map[f_name].append(item)
                total_layouts += 1

            grouped_forms = []
            for fn, layouts in forms_map.items():
                grouped_forms.append({
                    "formName": fn,
                    "layoutCount": len(layouts),
                    "layouts": layouts,
                })

            return {
                "success": True,
                "forms": grouped_forms,
                "total_forms": len(grouped_forms),
                "total_layouts": total_layouts,
            }
        except Exception as exc:
            logger.exception("Error in BravoLayoutCompareService.get_layout_list: %s", exc)
            return {"success": False, "error": str(exc)}

    @classmethod
    def get_layout_detail(
        cls,
        conn: Any,
        layout_id: Union[int, str],
        database: Optional[str] = None,
        platform: str = "Win",
        version: str = "Bravo 10",
    ) -> Dict[str, Any]:
        """
        Retrieves and decodes LayoutData and LastLayoutData for a specific Layout Id.
        Separates raw database payloads from beautified XML.
        """
        if not conn or layout_id is None:
            return {"success": False, "error": "conn and layout_id are required"}

        try:
            lid = int(layout_id)
            is_pg = cls.is_postgres(conn)
            table_layout = "b00layout" if platform == "Win" else "b09layout"
            table_data = "b00layoutdata" if platform == "Win" else "b09layoutdata"

            if is_pg:
                sql = f"""SELECT
                            a.id AS "Id",
                            a.formname AS "FormName",
                            a.layoutname AS "LayoutName",
                            a.modifiedat AS "ModifiedAt",
                            b.layoutdata AS "LayoutData",
                            b.lastlayoutdata AS "LastLayoutData"
                         FROM {table_layout} AS a
                         INNER JOIN {table_data} AS b ON a.id = b.id
                         WHERE a.id = {lid};"""
            else:
                sql = f"""SELECT
                            a.Id,
                            a.FormName,
                            a.LayoutName,
                            a.ModifiedAt,
                            b.LayoutData,
                            b.LastLayoutData
                         FROM {table_layout} AS a
                         INNER JOIN {table_data} AS b ON a.Id = b.Id
                         WHERE a.Id = {lid};"""

            result = conn.query_service.execute(sql, database=database)
            if not result.get("success", False) or not result.get("rows"):
                return {"success": False, "error": f"Không tìm thấy Layout với Id={lid}"}

            row = result["rows"][0]
            f_id = row[0]
            form_name = row[1] or ""
            layout_name = row[2] or ""
            modified_at = str(row[3]) if row[3] is not None else ""
            raw_layout_data = row[4]
            raw_draft_data = row[5]

            xml_content = decode_xml_payload(raw_layout_data, version=version)
            draft_xml_content = (
                decode_xml_payload(raw_draft_data, version=version)
                if raw_draft_data
                else ""
            )

            has_draft = bool(raw_draft_data and draft_xml_content.strip())

            return {
                "success": True,
                "id": f_id,
                "formName": form_name,
                "layoutName": layout_name,
                "modifiedAt": modified_at,
                "xml": xml_content,
                "draftXml": draft_xml_content,
                "hasDraft": has_draft,
                "isLastLayoutNull": raw_draft_data is None,
            }
        except Exception as exc:
            logger.exception("Error in BravoLayoutCompareService.get_layout_detail: %s", exc)
            return {"success": False, "error": str(exc)}

    @classmethod
    def format_binary_literal(cls, binary_data: Optional[bytes], is_postgres: bool) -> str:
        """Format binary payload for target database SQL representation."""
        if not binary_data:
            return "NULL"
        hex_str = binary_data.hex()
        if is_postgres:
            return f"decode('{hex_str}', 'hex')"
        return f"0x{hex_str.upper()}"

    @classmethod
    def generate_update_script(
        cls,
        db_type_or_conn: Any,
        layout_id: Union[int, str],
        layout_xml: str,
        draft_layout_xml: Optional[str] = None,
        expected_modified_at: Optional[str] = None,
        form_name: str = "",
        layout_name: str = "",
        platform: str = "Win",
        version: str = "Bravo 10",
        database: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generates an atomic transactional SQL UPDATE script adhering to the reference script's rules.
        Includes transaction bounds, optimistic concurrency checking, and affected-row validation.
        Does NOT execute the script; intended for user preview and review.
        """
        lid = int(layout_id)
        is_pg = cls.is_postgres(db_type_or_conn)

        # 1. Validate XML
        valid, err = validate_xml_syntax(layout_xml)
        if not valid:
            return {"success": False, "error": f"Cú pháp XML của LayoutData không hợp lệ: {err}"}

        if draft_layout_xml is not None and draft_layout_xml.strip():
            d_valid, d_err = validate_xml_syntax(draft_layout_xml)
            if not d_valid:
                return {"success": False, "error": f"Cú pháp XML của LastLayoutData không hợp lệ: {d_err}"}

        # 2. Encode XML into Bravo ZIP payloads
        try:
            zip_bytes = encode_xml_payload(layout_xml, version=version, format_type="zip")
            bin_lit = cls.format_binary_literal(zip_bytes, is_pg)

            draft_bin_lit = "NULL"
            if draft_layout_xml is not None and draft_layout_xml.strip():
                draft_bytes = encode_xml_payload(draft_layout_xml, version=version, format_type="zip")
                draft_bin_lit = cls.format_binary_literal(draft_bytes, is_pg)
        except Exception as exc:
            return {"success": False, "error": f"Lỗi mã hóa ZIP payload: {exc}"}

        # 3. Build Database Specific Transaction Script
        db_label = "PostgreSQL" if is_pg else "SQL Server"
        lines = [
            f"-- ==========================================================================",
            f"-- BRAVO LAYOUT ATOMIC TRANSACTION UPDATE SCRIPT ({db_label})",
            f"-- Target Database : {database or '(Current)'}",
            f"-- Layout ID       : {lid}",
            f"-- Form Name       : {form_name or '(Unspecified)'}",
            f"-- Layout Name     : {layout_name or '(Default)'}",
            f"-- Rules           : Atomic update for both LayoutData and LastLayoutData",
            f"-- ==========================================================================",
            "",
        ]

        if is_pg:
            tbl_layout = "b00layout" if platform == "Win" else "b09layout"
            tbl_data = "b00layoutdata" if platform == "Win" else "b09layoutdata"
            time_fn = "CURRENT_TIMESTAMP"

            lines.append("BEGIN;")
            lines.append("")

            # Concurrency check comment
            if expected_modified_at and expected_modified_at.strip():
                clean_mod = expected_modified_at.replace("'", "''").strip()
                lines.append(f"-- 1. Optimistic Concurrency Check: Verify record has not changed")
                lines.append(f"DO $$")
                lines.append(f"BEGIN")
                lines.append(f"    IF EXISTS (SELECT 1 FROM {tbl_layout} WHERE id = {lid} AND CAST(modifiedat AS TEXT) <> '{clean_mod}') THEN")
                lines.append(f"        RAISE EXCEPTION 'Optimistic Concurrency Conflict: Layout id={lid} has been modified by another session.';")
                lines.append(f"    END IF;")
                lines.append(f"END $$;")
                lines.append("")

            lines.append(f"-- 2. Atomic Update of both columns in {tbl_data}")
            lines.append(f"UPDATE {tbl_data}")
            lines.append(f"SET layoutdata = {bin_lit},")
            lines.append(f"    lastlayoutdata = {draft_bin_lit}")
            lines.append(f"WHERE id = {lid};")
            lines.append("")
            lines.append(f"-- 3. Update ModifiedAt in {tbl_layout}")
            lines.append(f"UPDATE {tbl_layout}")
            lines.append(f"SET modifiedat = {time_fn}")
            lines.append(f"WHERE id = {lid};")
            lines.append("")
            lines.append("COMMIT;")
        else:
            tbl_layout = "B00Layout" if platform == "Win" else "B09Layout"
            tbl_data = "B00LayoutData" if platform == "Win" else "B09LayoutData"
            time_fn = "GETDATE()"

            lines.append("BEGIN TRANSACTION;")
            lines.append("")

            # Concurrency check
            if expected_modified_at and expected_modified_at.strip():
                clean_mod = expected_modified_at.replace("'", "''").strip()
                lines.append(f"-- 1. Optimistic Concurrency Check: Verify record has not changed")
                lines.append(f"IF EXISTS (SELECT 1 FROM {tbl_layout} WHERE Id = {lid} AND CONVERT(VARCHAR(30), ModifiedAt, 120) <> '{clean_mod}')")
                lines.append("BEGIN")
                lines.append("    RAISERROR(N'Optimistic Concurrency Conflict: Layout đã bị thay đổi bởi phiên làm việc khác.', 16, 1);")
                lines.append("    ROLLBACK TRANSACTION;")
                lines.append("    RETURN;")
                lines.append("END;")
                lines.append("")

            lines.append(f"-- 2. Atomic Update of both columns in {tbl_data}")
            lines.append(f"UPDATE {tbl_data}")
            lines.append(f"SET LayoutData = {bin_lit},")
            lines.append(f"    LastLayoutData = {draft_bin_lit}")
            lines.append(f"WHERE Id = {lid};")
            lines.append("")
            lines.append("IF @@ROWCOUNT <> 1")
            lines.append("BEGIN")
            lines.append(f"    RAISERROR(N'Lỗi: Không tìm thấy hoặc không thể cập nhật {tbl_data} với Id={lid}.', 16, 1);")
            lines.append("    ROLLBACK TRANSACTION;")
            lines.append("    RETURN;")
            lines.append("END;")
            lines.append("")
            lines.append(f"-- 3. Update ModifiedAt in {tbl_layout}")
            lines.append(f"UPDATE {tbl_layout}")
            lines.append(f"SET ModifiedAt = {time_fn}")
            lines.append(f"WHERE Id = {lid};")
            lines.append("")
            lines.append("IF @@ROWCOUNT <> 1")
            lines.append("BEGIN")
            lines.append(f"    RAISERROR(N'Lỗi: Không thể cập nhật {tbl_layout} với Id={lid}.', 16, 1);")
            lines.append("    ROLLBACK TRANSACTION;")
            lines.append("    RETURN;")
            lines.append("END;")
            lines.append("")
            lines.append("COMMIT TRANSACTION;")

        full_sql = "\n".join(lines)
        return {
            "success": True,
            "sql": full_sql,
            "layout_id": lid,
            "is_postgres": is_pg,
        }

    @classmethod
    def apply_update_layout(
        cls,
        conn: Any,
        layout_id: Union[int, str],
        layout_xml: str,
        draft_layout_xml: Optional[str] = None,
        expected_modified_at: Optional[str] = None,
        database: Optional[str] = None,
        platform: str = "Win",
        version: str = "Bravo 10",
    ) -> Dict[str, Any]:
        """
        Executes atomic per-layout database update within a single transaction.
        Enforces optimistic concurrency checking against current ModifiedAt in database.
        Updates both LayoutData and LastLayoutData atomically.
        Rolls back on any error.
        Reloads and returns the updated record upon success.
        """
        if not conn or layout_id is None:
            return {"success": False, "error": "conn and layout_id are required"}

        try:
            lid = int(layout_id)
            is_pg = cls.is_postgres(conn)
            tbl_layout = "b00layout" if (is_pg and platform == "Win") else ("b09layout" if is_pg else ("B00Layout" if platform == "Win" else "B09Layout"))
            tbl_data = "b00layoutdata" if (is_pg and platform == "Win") else ("b09layoutdata" if is_pg else ("B00LayoutData" if platform == "Win" else "B09LayoutData"))

            # 1. Pre-validation of XML
            valid, err = validate_xml_syntax(layout_xml)
            if not valid:
                return {
                    "success": False,
                    "error": f"Cú pháp XML của LayoutData không hợp lệ: {err}",
                    "preserved_xml": layout_xml,
                }

            if draft_layout_xml is not None and draft_layout_xml.strip():
                d_valid, d_err = validate_xml_syntax(draft_layout_xml)
                if not d_valid:
                    return {
                        "success": False,
                        "error": f"Cú pháp XML của LastLayoutData không hợp lệ: {d_err}",
                        "preserved_xml": layout_xml,
                    }

            # 2. Concurrency Check: Fetch current ModifiedAt from database
            id_col = "id" if is_pg else "Id"
            mod_col = "modifiedat" if is_pg else "ModifiedAt"
            check_sql = f"SELECT {mod_col} FROM {tbl_layout} WHERE {id_col} = {lid}"
            check_res = conn.query_service.execute(check_sql, database=database)

            if not check_res.get("success", False) or not check_res.get("rows"):
                return {
                    "success": False,
                    "error": f"Không tìm thấy Layout với Id={lid} trong cơ sở dữ liệu.",
                    "preserved_xml": layout_xml,
                }

            current_db_mod = str(check_res["rows"][0][0] or "").strip()

            if expected_modified_at and expected_modified_at.strip():
                exp_mod = expected_modified_at.strip()
                # Normalize spaces and compare timestamps
                if exp_mod != current_db_mod and not current_db_mod.startswith(exp_mod):
                    return {
                        "success": False,
                        "concurrency_conflict": True,
                        "error": (
                            f"Xung đột ghi đè đồng thời (Optimistic Concurrency Conflict): "
                            f"Layout (Id={lid}) đã bị thay đổi bởi phiên khác kể từ khi bạn tải dữ liệu.\n"
                            f"Thời điểm dự kiến: {exp_mod} | Hiện tại trong DB: {current_db_mod}.\n"
                            f"Vui lòng tải lại dữ liệu để so sánh trước khi lưu."
                        ),
                        "preserved_xml": layout_xml,
                    }

            # 3. Generate script with verified payloads and transactions
            script_res = cls.generate_update_script(
                db_type_or_conn=conn,
                layout_id=lid,
                layout_xml=layout_xml,
                draft_layout_xml=draft_layout_xml,
                expected_modified_at=None,  # Concurrency check already verified explicitly above
                platform=platform,
                version=version,
                database=database,
            )

            if not script_res.get("success", False):
                return {
                    "success": False,
                    "error": script_res.get("error", "Failed to generate update script"),
                    "preserved_xml": layout_xml,
                }

            exec_sql = script_res["sql"]

            # 4. Execute atomic update
            exec_res = conn.query_service.execute(exec_sql, database=database)
            if not exec_res.get("success", False):
                err_msg = exec_res.get("error", "Lỗi thực thi transaction cập nhật")
                logger.error("Update layout failed for Id=%s: %s", lid, err_msg)
                return {
                    "success": False,
                    "error": f"Cập nhật thất bại: {err_msg}",
                    "preserved_xml": layout_xml,
                }

            # 5. Reload updated layout details
            reloaded = cls.get_layout_detail(
                conn=conn,
                layout_id=lid,
                database=database,
                platform=platform,
                version=version,
            )

            return {
                "success": True,
                "message": f"Cập nhật Layout (Id={lid}) thành công!",
                "layout": reloaded if reloaded.get("success") else None,
            }
        except Exception as exc:
            logger.exception("Error in BravoLayoutCompareService.apply_update_layout: %s", exc)
            return {
                "success": False,
                "error": f"Lỗi không xác định khi cập nhật Layout: {exc}",
                "preserved_xml": layout_xml,
            }

    @classmethod
    def compare_layout_metadata(
        cls,
        source_conn: Any,
        target_conn: Any,
        source_database: Optional[str] = None,
        target_database: Optional[str] = None,
        platform: str = "Win",
        version: str = "Bravo 10",
        search_term: str = "",
    ) -> Dict[str, Any]:
        """
        Compares Bravo Layout metadata between Source and Target databases.
        Matches layouts by (FormName, LayoutName).
        Identifies differences, missing layouts in Target, extra layouts in Target, or identical layouts.
        """
        if not source_conn or not target_conn:
            return {"success": False, "error": "Cần cung cấp cả kết nối Nguồn và kết nối Đích để so sánh."}

        try:
            s_res = cls.get_layout_list(
                source_conn, database=source_database, platform=platform, version=version, search_term=search_term
            )
            if not s_res.get("success"):
                return {"success": False, "error": f"Lỗi nạp Layout từ CSDL Nguồn: {s_res.get('error')}"}

            t_res = cls.get_layout_list(
                target_conn, database=target_database, platform=platform, version=version, search_term=search_term
            )
            if not t_res.get("success"):
                return {"success": False, "error": f"Lỗi nạp Layout từ CSDL Đích: {t_res.get('error')}"}

            s_map = {}
            for form in s_res.get("forms", []):
                for l in form.get("layouts", []):
                    key = (l["formName"].strip().lower(), (l["layoutName"] or "").strip().lower())
                    s_map[key] = l

            t_map = {}
            for form in t_res.get("forms", []):
                for l in form.get("layouts", []):
                    key = (l["formName"].strip().lower(), (l["layoutName"] or "").strip().lower())
                    t_map[key] = l

            all_keys = sorted(list(set(s_map.keys()) | set(t_map.keys())))
            forms_dict: Dict[str, List[Dict[str, Any]]] = {}

            diff_count = 0
            ident_count = 0
            missing_count = 0
            extra_count = 0

            for key in all_keys:
                s_item = s_map.get(key)
                t_item = t_map.get(key)

                form_name = s_item["formName"] if s_item else t_item["formName"]
                layout_name = s_item["layoutName"] if s_item else t_item["layoutName"]

                if s_item and t_item:
                    is_same_len = (s_item.get("payloadLength") or 0) == (t_item.get("payloadLength") or 0)
                    is_same_mod = (s_item.get("modifiedAt") or "") == (t_item.get("modifiedAt") or "")
                    if is_same_len and is_same_mod:
                        status = "identical"
                        ident_count += 1
                    else:
                        status = "different"
                        diff_count += 1

                    combined_item = {
                        "id": s_item["id"],
                        "sourceId": s_item["id"],
                        "targetId": t_item["id"],
                        "formName": form_name,
                        "layoutName": layout_name,
                        "status": status,
                        "hasDraft": bool(s_item.get("hasDraft") or t_item.get("hasDraft")),
                        "sourceModifiedAt": s_item.get("modifiedAt") or "",
                        "targetModifiedAt": t_item.get("modifiedAt") or "",
                        "isTemplate": s_item.get("isTemplate") or t_item.get("isTemplate") or 0,
                    }
                elif s_item:
                    status = "missing_in_target"
                    missing_count += 1
                    combined_item = {
                        "id": s_item["id"],
                        "sourceId": s_item["id"],
                        "targetId": None,
                        "formName": form_name,
                        "layoutName": layout_name,
                        "status": status,
                        "hasDraft": bool(s_item.get("hasDraft")),
                        "sourceModifiedAt": s_item.get("modifiedAt") or "",
                        "targetModifiedAt": "",
                        "isTemplate": s_item.get("isTemplate") or 0,
                    }
                else:
                    status = "extra_in_target"
                    extra_count += 1
                    combined_item = {
                        "id": t_item["id"],
                        "sourceId": None,
                        "targetId": t_item["id"],
                        "formName": form_name,
                        "layoutName": layout_name,
                        "status": status,
                        "hasDraft": bool(t_item.get("hasDraft")),
                        "sourceModifiedAt": "",
                        "targetModifiedAt": t_item.get("modifiedAt") or "",
                        "isTemplate": t_item.get("isTemplate") or 0,
                    }

                if form_name not in forms_dict:
                    forms_dict[form_name] = []
                forms_dict[form_name].append(combined_item)

            grouped_forms = []
            total_layouts = len(all_keys)
            for fn in sorted(forms_dict.keys()):
                layouts = forms_dict[fn]
                grouped_forms.append({
                    "formName": fn,
                    "layoutCount": len(layouts),
                    "layouts": layouts,
                })

            return {
                "success": True,
                "forms": grouped_forms,
                "total_forms": len(grouped_forms),
                "total_layouts": total_layouts,
                "different_count": diff_count,
                "identical_count": ident_count,
                "missing_in_target_count": missing_count,
                "extra_in_target_count": extra_count,
            }
        except Exception as exc:
            logger.exception("Error in BravoLayoutCompareService.compare_layout_metadata: %s", exc)
            return {"success": False, "error": str(exc)}

    @classmethod
    def get_layout_pair_detail(
        cls,
        source_conn: Optional[Any],
        target_conn: Optional[Any],
        source_layout_id: Optional[Union[int, str]] = None,
        target_layout_id: Optional[Union[int, str]] = None,
        source_database: Optional[str] = None,
        target_database: Optional[str] = None,
        platform: str = "Win",
        version: str = "Bravo 10",
    ) -> Dict[str, Any]:
        """
        Retrieves XML payloads from both Source and Target databases for side-by-side comparison.
        Original (Left) is Target; Modified (Right) is Source.
        """
        source_xml = ""
        source_draft_xml = ""
        source_mod = ""
        form_name = ""
        layout_name = ""

        target_xml = ""
        target_draft_xml = ""
        target_mod = ""

        try:
            if source_conn and source_layout_id is not None:
                s_res = cls.get_layout_detail(
                    conn=source_conn,
                    layout_id=source_layout_id,
                    database=source_database,
                    platform=platform,
                    version=version,
                )
                if s_res.get("success"):
                    source_xml = s_res.get("xml") or ""
                    source_draft_xml = s_res.get("draftXml") or ""
                    source_mod = s_res.get("modifiedAt") or ""
                    form_name = s_res.get("formName") or ""
                    layout_name = s_res.get("layoutName") or ""

            if target_conn and target_layout_id is not None:
                t_res = cls.get_layout_detail(
                    conn=target_conn,
                    layout_id=target_layout_id,
                    database=target_database,
                    platform=platform,
                    version=version,
                )
                if t_res.get("success"):
                    target_xml = t_res.get("xml") or ""
                    target_draft_xml = t_res.get("draftXml") or ""
                    target_mod = t_res.get("modifiedAt") or ""
                    if not form_name:
                        form_name = t_res.get("formName") or ""
                    if not layout_name:
                        layout_name = t_res.get("layoutName") or ""

            is_identical = False
            if source_xml and target_xml:
                is_identical = (source_xml.strip() == target_xml.strip())

            return {
                "success": True,
                "formName": form_name,
                "layoutName": layout_name,
                "sourceId": source_layout_id,
                "targetId": target_layout_id,
                "sourceXml": source_xml,
                "targetXml": target_xml,
                "sourceDraftXml": source_draft_xml,
                "targetDraftXml": target_draft_xml,
                "sourceModifiedAt": source_mod,
                "targetModifiedAt": target_mod,
                "isIdentical": is_identical,
                "hasDraft": bool(source_draft_xml or target_draft_xml),
            }
        except Exception as exc:
            logger.exception("Error in BravoLayoutCompareService.get_layout_pair_detail: %s", exc)
            return {"success": False, "error": str(exc)}
