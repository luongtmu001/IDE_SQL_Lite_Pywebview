# -*- coding: utf-8 -*-
"""
Table Designer API Mixin.
Handles schema/table design retrieval, preview, diff, and DDL application.
"""
import logging
import re
from app.services.table_designer_service import TableDesignerService

logger = logging.getLogger("luobtool.api.designer")


class DesignerApiMixin:
    def get_table_design(self, connection_id, database=None, schema=None, table=None):
        try:
            if not table:
                return {"success": False, "error": "Parameter 'table' is required"}
            conn = self._get_connection(connection_id)
            data = conn.metadata_service.get_table_design_metadata(database, schema, table)
            if not data:
                return {"success": False, "error": f"Table {schema}.{table} not found"}
            preview_sql = TableDesignerService.generate_create_table_ddl(data)
            return {"success": True, "data": data, "preview_sql": preview_sql}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_table_design_types(self, connection_id, database=None):
        try:
            conn = self._get_connection(connection_id)
            types_info = conn.metadata_service.get_supported_types(database=database)
            return {"success": True, "data": types_info}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def preview_table_design(self, connection_id, data=None):
        try:
            preview_sql = TableDesignerService.generate_create_table_ddl(data or {})
            return {"success": True, "preview_sql": preview_sql}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def diff_table_design(self, connection_id, original=None, modified=None):
        try:
            diff_res = TableDesignerService.generate_diff(original or {}, modified or {})
            new_preview = TableDesignerService.generate_create_table_ddl(modified or {})
            return {"success": True, "diff": diff_res, "preview_sql": new_preview}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def apply_table_design(self, connection_id, database=None, statements=None, migration_sql=None):
        try:
            conn = self._get_connection(connection_id)
            if getattr(conn, "read_only", False):
                return {"success": False, "error_code": "ERR_READ_ONLY", "error": "Kết nối đang ở chế độ CHỈ ĐỌC (Read-Only). Không thể áp dụng thay đổi thiết kế bảng (DDL)."}
            batches = []
            trans_keywords = ("BEGIN", "BEGIN TRANSACTION", "BEGIN TRAN", "COMMIT", "COMMIT TRANSACTION", "COMMIT TRAN", "SET XACT_ABORT ON")
            if migration_sql and migration_sql.strip():
                raw_batches = re.split(r'^\s*GO\s*;?\s*(?:--.*)?$', migration_sql, flags=re.MULTILINE | re.IGNORECASE)
                for b in raw_batches:
                    clean_b = b.strip()
                    if not clean_b:
                        continue
                    lines = [l.strip().rstrip(';').upper() for l in clean_b.splitlines() if l.strip()]
                    if lines and all(l in trans_keywords for l in lines):
                        continue
                    batches.append(clean_b)
            elif statements:
                for stmt in statements:
                    sql = stmt.get("sql") if isinstance(stmt, dict) else str(stmt)
                    if sql and sql.strip():
                        clean_sql = sql.strip()
                        lines = [l.strip().rstrip(';').upper() for l in clean_sql.splitlines() if l.strip()]
                        if lines and all(l in trans_keywords for l in lines):
                            continue
                        batches.append(clean_sql)
            if not batches:
                return {"success": False, "error": "No statements provided to apply"}
            conn.adapter.execute_migration_transaction(batches, database=database)
            conn.metadata_service.invalidate()
            return {"success": True, "message": "Changes applied successfully"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

