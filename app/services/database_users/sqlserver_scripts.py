# -*- coding: utf-8 -*-
"""
Script generator for Microsoft SQL Server Database Users.
Generates CREATE and DROP scripts with proper identifier quoting and headers.
"""
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from app.database.sql_utils import quote_ident, quote_qualified
from .models import PermissionEntry


class SqlServerScriptGenerator:
    """
    Generates T-SQL CREATE and DROP scripts for SQL Server Database Users.
    """

    @staticmethod
    def generate_header(action: str, principal_name: str, database: str, connection_name: str = "") -> str:
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        conn_info = f" ({connection_name})" if connection_name else ""
        return (
            f"/****** Object: User [{principal_name}]   Script Date: {now_str} ******/\n"
            f"/* Engine: Microsoft SQL Server{conn_info} */\n"
            f"/* Database: [{database}] */\n"
            f"/* Action: {action} */\n\n"
        )

    @classmethod
    def generate_create_script(
        cls,
        principal_info: Dict[str, Any],
        database: str,
        mode: str = "basic",
        memberships: Optional[List[Dict[str, Any]]] = None,
        permissions: Optional[List[PermissionEntry]] = None,
        connection_name: str = ""
    ) -> str:
        name = principal_info.get("name", "")
        if not name:
            return "-- Error: Missing principal name for CREATE script."

        quoted_user = quote_ident(name, engine="sqlserver")
        quoted_db = quote_ident(database, engine="sqlserver")
        p_type = str(principal_info.get("type_desc") or principal_info.get("principal_type") or "SQL_USER").upper()
        auth_type = str(principal_info.get("authentication_type") or "").upper()
        login_name = principal_info.get("login_name")
        default_schema = principal_info.get("default_schema") or "dbo"
        quoted_schema = quote_ident(default_schema, engine="sqlserver")

        lines = [cls.generate_header("CREATE USER", name, database, connection_name)]
        lines.append(f"USE {quoted_db};")
        lines.append("GO\n")

        # Determine CREATE USER syntax
        if p_type in ("SQL_USER", "WINDOWS_USER", "WINDOWS_GROUP", "EXTERNAL_USER"):
            if login_name:
                quoted_login = quote_ident(login_name, engine="sqlserver")
                lines.append(f"CREATE USER {quoted_user} FOR LOGIN {quoted_login}")
                lines.append(f"    WITH DEFAULT_SCHEMA = {quoted_schema};")
                lines.append("GO\n")
            else:
                lines.append(f"CREATE USER {quoted_user} WITHOUT LOGIN")
                lines.append(f"    WITH DEFAULT_SCHEMA = {quoted_schema};")
                lines.append("GO\n")
        elif "CONTAINED" in auth_type or "DATABASE" in auth_type:
            lines.append(f"CREATE USER {quoted_user} WITH DEFAULT_SCHEMA = {quoted_schema};")
            lines.append("GO\n")
        else:
            lines.append(f"CREATE USER {quoted_user} WITHOUT LOGIN")
            lines.append(f"    WITH DEFAULT_SCHEMA = {quoted_schema};")
            lines.append("GO\n")

        # In Full mode: add role memberships & permissions
        if mode.lower() == "full":
            if memberships:
                lines.append("/* ── Role Memberships ── */")
                for m in memberships:
                    r_name = m.get("role_name")
                    if r_name and r_name.lower() != "public":
                        quoted_role = quote_ident(r_name, engine="sqlserver")
                        lines.append(f"ALTER ROLE {quoted_role} ADD MEMBER {quoted_user};")
                lines.append("GO\n")

            if permissions:
                lines.append("/* ── Granted Permissions ── */")
                for p in permissions:
                    if p.source != "DIRECT" or not p.is_complete:
                        continue
                    p_state = p.state or "GRANT"
                    p_name = p.permission_name
                    if p.scope_type == "database":
                        lines.append(f"{p_state} {p_name} TO {quoted_user};")
                    elif p.scope_type == "schema" and p.schema_name:
                        q_sc = quote_ident(p.schema_name, engine="sqlserver")
                        lines.append(f"{p_state} {p_name} ON SCHEMA::{q_sc} TO {quoted_user};")
                    elif p.scope_type == "object" and p.object_name:
                        q_obj = quote_qualified(p.schema_name, p.object_name, engine="sqlserver")
                        lines.append(f"{p_state} {p_name} ON {q_obj} TO {quoted_user};")
                lines.append("GO\n")

        return "\n".join(lines)

    @classmethod
    def generate_drop_script(
        cls,
        principal_name: str,
        database: str,
        connection_name: str = ""
    ) -> str:
        quoted_user = quote_ident(principal_name, engine="sqlserver")
        quoted_db = quote_ident(database, engine="sqlserver")

        lines = [cls.generate_header("DROP USER", principal_name, database, connection_name)]
        lines.append(f"USE {quoted_db};")
        lines.append("GO\n")
        lines.append("/* CẢNH BÁO: Kiểm tra kỹ dependency hoặc schema do user sở hữu trước khi thực thi. */")
        safe_name = principal_name.replace("'", "''")
        lines.append(f"IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'{safe_name}')")
        lines.append("BEGIN")
        lines.append(f"    DROP USER {quoted_user};")
        lines.append("END")
        lines.append("GO\n")

        return "\n".join(lines)
