# -*- coding: utf-8 -*-
"""
Table Data Editor API Mixin.
Handles table data fetching, editing, validating, transactions, and mutations.
"""
import logging
from datetime import datetime, timezone
from app.services.table_data_editor_service import TableDataEditorService

logger = logging.getLogger("luobtool.api.table_editor")


class TableEditorApiMixin:
    def tx_begin(self, connection_id):
        try:
            conn = self._get_connection(connection_id)
            return conn.begin_transaction()
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def tx_commit(self, connection_id):
        try:
            conn = self._get_connection(connection_id)
            return conn.commit_transaction()
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def tx_rollback(self, connection_id):
        try:
            conn = self._get_connection(connection_id)
            return conn.rollback_transaction()
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def tx_status(self, connection_id):
        try:
            conn = self._get_connection(connection_id)
            from datetime import datetime, timezone
            duration = None
            if conn.in_transaction and conn.tx_started_at:
                duration = (datetime.now(timezone.utc) - conn.tx_started_at).total_seconds()
            return {
                "success": True,
                "in_transaction": conn.in_transaction,
                "duration_seconds": duration,
                "environment": conn.environment,
                "read_only": conn.read_only
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def set_connection_read_only(self, connection_id, read_only=False):
        try:
            conn = self._get_connection(connection_id)
            if hasattr(conn, "set_read_only"):
                return conn.set_read_only(read_only)
            conn.read_only = bool(read_only)
            return {"success": True, "read_only": conn.read_only, "connection_id": connection_id}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def get_table_editor_metadata(self, connection_id, database=None, schema=None, table=None):
        try:
            if not table:
                return {"success": False, "error": "Tên bảng là bắt buộc (table is required)"}
            conn = self._get_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}
            with conn.exclusive():
                meta = TableDataEditorService.get_metadata(conn.adapter, database, schema, table, lock=conn.lock)
                return {"success": True, "metadata": meta}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def fetch_table_data(self, connection_id, database=None, schema=None, table=None, select_cols=None, criteria=None, top_n=200, custom_sql=None):
        try:
            if not table and not custom_sql:
                return {"success": False, "error": "Tên bảng hoặc câu truy vấn là bắt buộc"}
            conn = self._get_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}
            with conn.exclusive():
                data = TableDataEditorService.fetch_data(
                    adapter=conn.adapter,
                    database=database,
                    schema=schema,
                    table=table,
                    select_cols=select_cols,
                    criteria=criteria,
                    top_n=top_n,
                    custom_sql=custom_sql,
                    lock=conn.lock
                )
                return {"success": True, **data}
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def update_table_row(self, connection_id, database=None, schema=None, table=None, pk_conditions=None, changes=None):
        try:
            conn = self._get_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}
            with conn.exclusive():
                result = TableDataEditorService.update_row(
                    adapter=conn.adapter,
                    database=database,
                    schema=schema,
                    table=table,
                    pk_conditions=pk_conditions or {},
                    changes=changes or {},
                    lock=conn.lock
                )
                return result
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def delete_table_row(self, connection_id, database=None, schema=None, table=None, pk_conditions=None):
        try:
            conn = self._get_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}
            with conn.exclusive():
                result = TableDataEditorService.delete_row(
                    adapter=conn.adapter,
                    database=database,
                    schema=schema,
                    table=table,
                    pk_conditions=pk_conditions or {},
                    lock=conn.lock
                )
                return result
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def insert_table_row(self, connection_id, database=None, schema=None, table=None, values=None, identity_columns=None, computed_columns=None):
        try:
            conn = self._get_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}
            with conn.exclusive():
                result = TableDataEditorService.insert_row(
                    adapter=conn.adapter,
                    database=database,
                    schema=schema,
                    table=table,
                    values=values or {},
                    identity_columns=identity_columns,
                    computed_columns=computed_columns,
                    lock=conn.lock
                )
                return result
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def submit_table_changes(self, connection_id, database=None, schema=None, table=None, changes=None, concurrency_mode="optimistic"):
        try:
            conn = self._get_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}"}
            if getattr(conn, "read_only", False):
                return {"success": False, "error_code": "ERR_READ_ONLY", "error": "Kết nối đang ở chế độ CHỈ ĐỌC (Read-Only). Không thể lưu thay đổi vào bảng dữ liệu."}
            with conn.exclusive():
                result = TableDataEditorService.submit_changes(
                    adapter=conn.adapter,
                    database=database,
                    schema=schema,
                    table=table,
                    changes=changes or {},
                    concurrency_mode=concurrency_mode,
                    lock=conn.lock
                )
                return result
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    def validate_table_rows(self, connection_id, database=None, schema=None, table=None, rows=None):
        try:
            conn = self._get_connection(connection_id)
            if not conn:
                return {"success": False, "error": f"Không tìm thấy kết nối: {connection_id}", "total": len(rows or []), "valid_count": 0, "error_count": len(rows or []), "results": []}
            with conn.exclusive():
                result = TableDataEditorService.validate_insert_rows(
                    adapter=conn.adapter,
                    database=database,
                    schema=schema,
                    table=table,
                    rows=rows or [],
                    lock=conn.lock
                )
                return result
        except Exception as exc:
            return {"success": False, "error": str(exc), "total": len(rows or []), "valid_count": 0, "error_count": len(rows or []), "results": []}


    def validate_table_row(self, connection_id, database=None, schema=None, table=None, values=None, keys=None, is_new=True, target_column=None):
        try:
            conn = self._get_connection(connection_id)
            if not conn:
                return {"valid": False, "error": f"Không tìm thấy kết nối: {connection_id}"}
            with conn.exclusive():
                result = TableDataEditorService.validate_row(
                    adapter=conn.adapter,
                    database=database,
                    schema=schema,
                    table=table,
                    values=values or {},
                    keys=keys,
                    is_new=is_new,
                    target_column=target_column,
                    lock=conn.lock
                )
                return result
        except Exception as exc:
            return {"valid": False, "error": str(exc)}

