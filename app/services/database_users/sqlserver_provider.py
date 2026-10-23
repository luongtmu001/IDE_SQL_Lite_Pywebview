# -*- coding: utf-8 -*-
"""
SQL Server metadata provider for Database Users, Role Memberships, and Permissions.
"""
import logging
from typing import List, Dict, Any, Optional
from app.database.sql_utils import quote_ident
from .models import PrincipalSummary, PermissionEntry

logger = logging.getLogger("luobtool.database_users.sqlserver")


class SqlServerUsersProvider:
    """
    Metadata provider for Microsoft SQL Server Database Users.
    Scope: Database level (sys.database_principals, sys.database_permissions, sys.database_role_members).
    """

    def __init__(self, adapter):
        self.adapter = adapter

    def list_principals(self, database: Optional[str] = None) -> List[PrincipalSummary]:
        """
        Lists all database users and roles in the target database.
        """
        db = database or self.adapter.config.get("database") or "master"
        sql = """
        SELECT
            dp.principal_id,
            dp.name AS UserName,
            dp.type_desc AS UserType,
            dp.authentication_type_desc AS AuthenticationType,
            dp.default_schema_name AS DefaultSchema,
            dp.create_date AS CreateDate,
            dp.modify_date AS ModifyDate,
            SUSER_SNAME(dp.sid) AS LoginName
        FROM sys.database_principals AS dp
        WHERE dp.type IN ('S', 'U', 'G', 'C', 'K', 'E', 'X') -- SQL user, Windows user/group, Contained, Asymmetric, External
           OR (dp.principal_id > 0 AND dp.type IN ('R'))     -- Include user roles if needed
        ORDER BY dp.name;
        """

        try:
            res = self.adapter.execute(sql, database=db, limit=0)
            if not res or not res.get("success", True):
                err = res.get("error") if res else "Unknown database error"
                logger.warning("Failed to query sys.database_principals in [%s]: %s", db, err)
                return []

            rows = res.get("rows", [])
            principals: List[PrincipalSummary] = []

            for row in rows:
                if not row or len(row) < 8:
                    continue
                p_id, name, p_type, auth_type, def_schema, c_date, m_date, login_name = row[:8]
                name_str = str(name) if name is not None else ""
                p_type_str = str(p_type) if p_type is not None else "USER"
                
                # Flag system principals
                is_sys = (
                    (p_id is not None and int(p_id) <= 4)
                    or name_str.lower() in ("sys", "information_schema", "guest", "dbo", "public")
                    or name_str.startswith("##")
                )

                # Determine if user can log in
                can_login = p_type_str in (
                    "SQL_USER", "WINDOWS_USER", "WINDOWS_GROUP", 
                    "EXTERNAL_USER", "EXTERNAL_GROUP"
                )

                capabilities = ["script_create", "script_drop", "permissions", "memberships"]

                p = PrincipalSummary(
                    engine="sqlserver",
                    scope_type="database",
                    scope_name=db,
                    name=name_str,
                    principal_type=p_type_str,
                    can_login=can_login,
                    authentication_type=str(auth_type) if auth_type else None,
                    login_name=str(login_name) if login_name else None,
                    default_schema=str(def_schema) if def_schema else None,
                    is_system=is_sys,
                    metadata_visibility="complete",
                    capabilities=capabilities,
                    extra={
                        "principal_id": p_id,
                        "create_date": str(c_date) if c_date else None,
                        "modify_date": str(m_date) if m_date else None,
                    }
                )
                principals.append(p)

            return principals

        except Exception as exc:
            logger.exception("Exception querying SQL Server users for database %s: %s", db, exc)
            return []

    def get_role_memberships(self, principal_name: str, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Retrieves all database roles that the given principal is directly or indirectly a member of.
        """
        db = database or self.adapter.config.get("database") or "master"
        sql = """
        SELECT
            r.name AS RoleName,
            r.type_desc AS RoleType,
            r.is_fixed_role AS IsFixedRole
        FROM sys.database_role_members AS rm
        JOIN sys.database_principals AS r ON rm.role_principal_id = r.principal_id
        JOIN sys.database_principals AS m ON rm.member_principal_id = m.principal_id
        WHERE m.name = ?
        ORDER BY r.name;
        """

        try:
            res = self.adapter.execute(sql, params=(principal_name,), database=db, limit=0)
            rows = res.get("rows", []) if res else []
            memberships = []
            for r in rows:
                if not r or len(r) < 3:
                    continue
                memberships.append({
                    "role_name": str(r[0]),
                    "role_type": str(r[1]) if r[1] is not None else "DATABASE_ROLE",
                    "is_fixed_role": bool(r[2]),
                })
            return memberships
        except Exception as exc:
            logger.warning("Error fetching role memberships for [%s] in [%s]: %s", principal_name, db, exc)
            return []

    def get_permissions(self, principal_name: str, database: Optional[str] = None) -> List[PermissionEntry]:
        """
        Retrieves direct and role-inherited permissions for the principal.
        """
        db = database or self.adapter.config.get("database") or "master"
        permissions: List[PermissionEntry] = []

        # 1. Direct permissions
        sql_direct = """
        SELECT
            dp.permission_name,
            dp.state_desc,
            dp.class_desc,
            SCHEMA_NAME(o.schema_id) AS schema_name,
            o.name AS object_name,
            o.type_desc AS object_type,
            s.name AS schema_scope_name,
            USER_NAME(dp.grantor_principal_id) AS grantor_name
        FROM sys.database_permissions AS dp
        JOIN sys.database_principals AS p ON dp.grantee_principal_id = p.principal_id
        LEFT JOIN sys.all_objects AS o ON dp.major_id = o.object_id AND dp.class = 1
        LEFT JOIN sys.schemas AS s ON dp.major_id = s.schema_id AND dp.class = 3
        WHERE p.name = ?
        ORDER BY dp.class_desc, dp.permission_name;
        """

        try:
            res = self.adapter.execute(sql_direct, params=(principal_name,), database=db, limit=0)
            rows = res.get("rows", []) if res else []
            for r in rows:
                if not r or len(r) < 8:
                    continue
                perm_name, state_desc, class_desc, obj_schema, obj_name, obj_type, sc_scope, grantor = r[:8]
                
                # Class resolution
                scope_type = "database"
                sc_name = None
                ob_name = None
                ob_type = None

                c_desc = str(class_desc or "").upper()
                if "SCHEMA" in c_desc:
                    scope_type = "schema"
                    sc_name = str(sc_scope) if sc_scope else None
                elif "OBJECT" in c_desc:
                    scope_type = "object"
                    sc_name = str(obj_schema) if obj_schema else None
                    ob_name = str(obj_name) if obj_name else None
                    ob_type = str(obj_type) if obj_type else "OBJECT"

                permissions.append(PermissionEntry(
                    principal_name=principal_name,
                    scope_type=scope_type,
                    scope_name=db,
                    permission_name=str(perm_name),
                    state=str(state_desc) if state_desc else "GRANT",
                    source="DIRECT",
                    object_type=ob_type,
                    schema_name=sc_name,
                    object_name=ob_name,
                    grantor=str(grantor) if grantor else None,
                    is_complete=True,
                ))
        except Exception as exc:
            logger.warning("Could not read direct permissions for [%s] in [%s]: %s", principal_name, db, exc)
            permissions.append(PermissionEntry(
                principal_name=principal_name,
                scope_type="database",
                scope_name=db,
                permission_name="METADATA_UNAVAILABLE",
                state="OTHER",
                source="UNKNOWN",
                is_complete=False,
                warning=f"Không đủ quyền đọc sys.database_permissions: {exc}"
            ))

        # 2. Permissions inherited via roles
        roles = self.get_role_memberships(principal_name, database=db)
        for role_info in roles:
            r_name = role_info.get("role_name")
            if not r_name:
                continue
            try:
                res_role = self.adapter.execute(sql_direct, params=(r_name,), database=db, limit=0)
                rows_role = res_role.get("rows", []) if res_role else []
                for r in rows_role:
                    if not r or len(r) < 8:
                        continue
                    perm_name, state_desc, class_desc, obj_schema, obj_name, obj_type, sc_scope, grantor = r[:8]
                    
                    scope_type = "database"
                    sc_name = None
                    ob_name = None
                    ob_type = None

                    c_desc = str(class_desc or "").upper()
                    if "SCHEMA" in c_desc:
                        scope_type = "schema"
                        sc_name = str(sc_scope) if sc_scope else None
                    elif "OBJECT" in c_desc:
                        scope_type = "object"
                        sc_name = str(obj_schema) if obj_schema else None
                        ob_name = str(obj_name) if obj_name else None
                        ob_type = str(obj_type) if obj_type else "OBJECT"

                    permissions.append(PermissionEntry(
                        principal_name=principal_name,
                        scope_type=scope_type,
                        scope_name=db,
                        permission_name=str(perm_name),
                        state=str(state_desc) if state_desc else "GRANT",
                        source="ROLE",
                        via_role=r_name,
                        object_type=ob_type,
                        schema_name=sc_name,
                        object_name=ob_name,
                        grantor=str(grantor) if grantor else None,
                        is_complete=True,
                    ))
            except Exception as exc:
                logger.debug("Could not read role permissions for role [%s]: %s", r_name, exc)

        return permissions

    def get_principal_properties(self, principal_name: str, database: Optional[str] = None) -> Dict[str, Any]:
        """
        Retrieves detailed attributes for a principal.
        """
        db = database or self.adapter.config.get("database") or "master"
        sql = """
        SELECT
            dp.principal_id,
            dp.name,
            dp.type_desc,
            dp.authentication_type_desc,
            dp.default_schema_name,
            dp.create_date,
            dp.modify_date,
            SUSER_SNAME(dp.sid) AS LoginName
        FROM sys.database_principals dp
        WHERE dp.name = ?;
        """
        try:
            res = self.adapter.execute(sql, params=(principal_name,), database=db, limit=1)
            rows = res.get("rows", []) if res else []
            if rows and len(rows[0]) >= 8:
                r = rows[0]
                return {
                    "principal_id": r[0],
                    "name": r[1],
                    "type_desc": r[2],
                    "authentication_type": r[3],
                    "default_schema": r[4],
                    "create_date": str(r[5]) if r[5] else None,
                    "modify_date": str(r[6]) if r[6] else None,
                    "login_name": r[7],
                    "database": db,
                    "engine": "sqlserver",
                }
        except Exception as exc:
            logger.warning("Error fetching properties for [%s]: %s", principal_name, exc)
        return {"name": principal_name, "database": db, "engine": "sqlserver"}
