# -*- coding: utf-8 -*-
"""
Script generator for PostgreSQL Roles.
Generates CREATE ROLE and DROP ROLE scripts with proper identifier quoting and headers.
"""
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from app.database.sql_utils import quote_ident, quote_qualified
from .models import PermissionEntry


class PostgresScriptGenerator:
    """
    Generates PostgreSQL CREATE ROLE and DROP ROLE scripts.
    """

    @staticmethod
    def generate_header(action: str, role_name: str, connection_name: str = "") -> str:
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        conn_info = f" ({connection_name})" if connection_name else ""
        return (
            f"-- ==========================================================\n"
            f"-- Object: Role \"{role_name}\"   Script Date: {now_str}\n"
            f"-- Engine: PostgreSQL{conn_info}\n"
            f"-- Action: {action}\n"
            f"-- ==========================================================\n\n"
        )

    @classmethod
    def generate_create_script(
        cls,
        role_info: Dict[str, Any],
        mode: str = "basic",
        memberships: Optional[List[Dict[str, Any]]] = None,
        permissions: Optional[List[PermissionEntry]] = None,
        connection_name: str = ""
    ) -> str:
        name = role_info.get("name", "")
        if not name:
            return "-- Error: Missing role name for CREATE script."

        quoted_role = quote_ident(name, engine="postgresql")
        lines = [cls.generate_header("CREATE ROLE", name, connection_name)]

        # Attributes
        attrs = []
        if role_info.get("can_login"):
            attrs.append("LOGIN")
        else:
            attrs.append("NOLOGIN")

        if role_info.get("is_superuser"):
            attrs.append("SUPERUSER")
        else:
            attrs.append("NOSUPERUSER")

        if role_info.get("can_create_db"):
            attrs.append("CREATEDB")
        else:
            attrs.append("NOCREATEDB")

        if role_info.get("can_create_role"):
            attrs.append("CREATEROLE")
        else:
            attrs.append("NOCREATEROLE")

        if role_info.get("inherit_privileges", True):
            attrs.append("INHERIT")
        else:
            attrs.append("NOINHERIT")

        if role_info.get("can_replicate"):
            attrs.append("REPLICATION")
        else:
            attrs.append("NOREPLICATION")

        conn_limit = role_info.get("connection_limit")
        if conn_limit is not None and conn_limit != -1:
            attrs.append(f"CONNECTION LIMIT {conn_limit}")

        lines.append(f"CREATE ROLE {quoted_role} WITH")
        for attr in attrs:
            lines.append(f"    {attr}")
        lines[-1] += ";\n"

        lines.append(
            "-- Lưu ý: Mật khẩu (PASSWORD) không được xuất tự động vì lý do an toàn.\n"
            "-- Nếu cần thiết lập mật khẩu, hãy chạy:\n"
            f"-- ALTER ROLE {quoted_role} WITH PASSWORD 'your_password_here';\n"
        )

        # Full mode: memberships & permissions
        if mode.lower() == "full":
            if memberships:
                lines.append("-- ── Granted Roles (Memberships) ──")
                for m in memberships:
                    r_name = m.get("role_name")
                    if r_name:
                        q_r = quote_ident(r_name, engine="postgresql")
                        admin_opt = " WITH ADMIN OPTION" if m.get("admin_option") else ""
                        lines.append(f"GRANT {q_r} TO {quoted_role}{admin_opt};")
                lines.append("")

            if permissions:
                lines.append("-- ── Object & Schema Permissions ──")
                for p in permissions:
                    if p.source != "DIRECT" or not p.is_complete:
                        continue
                    p_state = p.state or "GRANT"
                    p_name = p.permission_name
                    if p.scope_type == "database" and p.object_name:
                        q_db = quote_ident(p.object_name, engine="postgresql")
                        lines.append(f"{p_state} {p_name} ON DATABASE {q_db} TO {quoted_role};")
                    elif p.scope_type == "schema" and p.schema_name:
                        q_sc = quote_ident(p.schema_name, engine="postgresql")
                        lines.append(f"{p_state} {p_name} ON SCHEMA {q_sc} TO {quoted_role};")
                    elif p.scope_type == "object" and p.object_name:
                        q_obj = quote_qualified(p.schema_name, p.object_name, engine="postgresql")
                        lines.append(f"{p_state} {p_name} ON {q_obj} TO {quoted_role};")
                lines.append("")

        return "\n".join(lines)

    @classmethod
    def generate_drop_script(
        cls,
        role_name: str,
        connection_name: str = ""
    ) -> str:
        quoted_role = quote_ident(role_name, engine="postgresql")

        lines = [cls.generate_header("DROP ROLE", role_name, connection_name)]
        lines.append(
            "-- CẢNH BÁO AN TOÀN:\n"
            "-- Nếu Role đang sở hữu đối tượng hoặc có quyền phụ thuộc, lệnh DROP ROLE sẽ báo lỗi.\n"
            "-- Trước khi DROP, xem xét chuyển giao hoặc thu hồi quyền sở hữu nếu cần thiết:\n"
            f"--   REASSIGN OWNED BY {quoted_role} TO \"new_owner\";\n"
            f"--   DROP OWNED BY {quoted_role};\n"
        )
        lines.append(f"DROP ROLE IF EXISTS {quoted_role};\n")

        return "\n".join(lines)
