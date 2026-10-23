# -*- coding: utf-8 -*-
"""
PostgreSQL metadata provider for Cluster Roles, Memberships, and Permissions.
"""
import logging
from typing import List, Dict, Any, Optional
from .models import PrincipalSummary, PermissionEntry

logger = logging.getLogger("luobtool.database_users.postgres")


class PostgresUsersProvider:
    """
    Metadata provider for PostgreSQL Roles.
    Scope: Cluster level (pg_roles, pg_auth_members).
    """

    def __init__(self, adapter):
        self.adapter = adapter

    def list_principals(self, database: Optional[str] = None) -> List[PrincipalSummary]:
        """
        Lists all roles across the PostgreSQL cluster.
        """
        sql = """
        SELECT
            rolname,
            rolsuper,
            rolinherit,
            rolcreaterole,
            rolcreatedb,
            rolcanlogin,
            rolreplication,
            rolconnlimit
        FROM pg_roles
        ORDER BY rolname;
        """

        try:
            res = self.adapter.execute(sql, limit=0)
            if not res or not res.get("success", True):
                err = res.get("error") if res else "Unknown database error"
                logger.warning("Failed to query pg_roles: %s", err)
                return []

            rows = res.get("rows", [])
            principals: List[PrincipalSummary] = []

            for row in rows:
                if not row or len(row) < 8:
                    continue
                (
                    rolname, rolsuper, rolinherit, rolcreaterole,
                    rolcreatedb, rolcanlogin, rolreplication, rolconnlimit
                ) = row[:8]

                name_str = str(rolname) if rolname is not None else ""
                is_sys = name_str.startswith("pg_")

                can_login = bool(rolcanlogin)
                p_type = "SUPERUSER" if rolsuper else ("LOGIN_ROLE" if can_login else "ROLE")

                capabilities = ["script_create", "script_drop", "permissions", "memberships"]

                p = PrincipalSummary(
                    engine="postgresql",
                    scope_type="cluster",
                    scope_name=self.adapter.config.get("host") or "localhost",
                    name=name_str,
                    principal_type=p_type,
                    can_login=can_login,
                    authentication_type="PASSWORD" if can_login else "NONE",
                    login_name=name_str if can_login else None,
                    default_schema=None,
                    is_system=is_sys,
                    metadata_visibility="complete",
                    capabilities=capabilities,
                    extra={
                        "is_superuser": bool(rolsuper),
                        "inherit_privileges": bool(rolinherit),
                        "can_create_role": bool(rolcreaterole),
                        "can_create_db": bool(rolcreatedb),
                        "can_replicate": bool(rolreplication),
                        "connection_limit": rolconnlimit if rolconnlimit is not None else -1,
                    }
                )
                principals.append(p)

            return principals

        except Exception as exc:
            logger.exception("Exception querying PostgreSQL roles: %s", exc)
            return []

    def get_role_memberships(self, principal_name: str, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Retrieves all roles granted to this principal.
        """
        sql = """
        SELECT
            r.rolname AS role_name,
            m.admin_option
        FROM pg_auth_members m
        JOIN pg_roles r ON m.roleid = r.oid
        JOIN pg_roles u ON m.member = u.oid
        WHERE u.rolname = %s
        ORDER BY r.rolname;
        """

        try:
            res = self.adapter.execute(sql, params=(principal_name,), limit=0)
            rows = res.get("rows", []) if res else []
            memberships = []
            for r in rows:
                if not r or len(r) < 2:
                    continue
                memberships.append({
                    "role_name": str(r[0]),
                    "admin_option": bool(r[1]),
                    "role_type": "ROLE"
                })
            return memberships
        except Exception as exc:
            logger.warning("Error fetching PostgreSQL role memberships for [%s]: %s", principal_name, exc)
            return []

    def get_permissions(self, principal_name: str, database: Optional[str] = None) -> List[PermissionEntry]:
        """
        Retrieves database, schema, and object privileges for the role.
        """
        db = database or self.adapter.config.get("database") or "postgres"
        permissions: List[PermissionEntry] = []

        # 1. Database-level permissions for the active database
        db_privs = ["CONNECT", "CREATE", "TEMPORARY"]
        for priv in db_privs:
            sql_chk = f"SELECT has_database_privilege(%s, %s, '{priv}')"
            try:
                chk_res = self.adapter.execute(sql_chk, params=(principal_name, db), limit=1)
                rows = chk_res.get("rows", []) if chk_res else []
                if rows and rows[0] and rows[0][0]:
                    permissions.append(PermissionEntry(
                        principal_name=principal_name,
                        scope_type="database",
                        scope_name=db,
                        permission_name=priv,
                        state="GRANT",
                        source="DIRECT",
                        object_type="DATABASE",
                        schema_name=None,
                        object_name=db,
                        is_complete=True,
                    ))
            except Exception:
                pass

        # 2. Schema-level permissions (e.g. public, etc.)
        sql_schemas = """
        SELECT n.nspname
        FROM pg_namespace n
        WHERE n.nspname NOT LIKE 'pg_temp_%'
          AND n.nspname NOT LIKE 'pg_toast%'
        ORDER BY n.nspname;
        """
        try:
            s_res = self.adapter.execute(sql_schemas, limit=50)
            s_rows = s_res.get("rows", []) if s_res else []
            for sr in s_rows:
                if not sr or not sr[0]:
                    continue
                sc_name = str(sr[0])
                for priv in ["USAGE", "CREATE"]:
                    chk_sql = f"SELECT has_schema_privilege(%s, %s, '{priv}')"
                    try:
                        chk_res = self.adapter.execute(chk_sql, params=(principal_name, sc_name), limit=1)
                        r = chk_res.get("rows", []) if chk_res else []
                        if r and r[0] and r[0][0]:
                            permissions.append(PermissionEntry(
                                principal_name=principal_name,
                                scope_type="schema",
                                scope_name=db,
                                permission_name=priv,
                                state="GRANT",
                                source="DIRECT",
                                object_type="SCHEMA",
                                schema_name=sc_name,
                                object_name=sc_name,
                                is_complete=True,
                            ))
                    except Exception:
                        pass
        except Exception as exc:
            logger.warning("Error fetching schemas for PG permissions: %s", exc)

        # 3. Role-inherited flags
        memberships = self.get_role_memberships(principal_name)
        for m in memberships:
            r_name = m.get("role_name")
            if r_name:
                permissions.append(PermissionEntry(
                    principal_name=principal_name,
                    scope_type="cluster",
                    scope_name=self.adapter.config.get("host") or "localhost",
                    permission_name="MEMBER OF",
                    state="GRANT",
                    source="ROLE",
                    via_role=r_name,
                    object_type="ROLE",
                    object_name=r_name,
                    is_complete=True,
                ))

        return permissions

    def get_principal_properties(self, principal_name: str, database: Optional[str] = None) -> Dict[str, Any]:
        """
        Retrieves detailed attributes for a PostgreSQL role.
        """
        sql = """
        SELECT
            r.rolname,
            r.rolsuper,
            r.rolinherit,
            r.rolcreaterole,
            r.rolcreatedb,
            r.rolcanlogin,
            r.rolreplication,
            r.rolconnlimit,
            sh.description
        FROM pg_roles r
        LEFT JOIN pg_shdescription sh ON sh.objoid = r.oid
        WHERE r.rolname = %s;
        """
        try:
            res = self.adapter.execute(sql, params=(principal_name,), limit=1)
            rows = res.get("rows", []) if res else []
            if rows and len(rows[0]) >= 8:
                r = rows[0]
                return {
                    "name": r[0],
                    "is_superuser": bool(r[1]),
                    "inherit_privileges": bool(r[2]),
                    "can_create_role": bool(r[3]),
                    "can_create_db": bool(r[4]),
                    "can_login": bool(r[5]),
                    "can_replicate": bool(r[6]),
                    "connection_limit": r[7],
                    "comment": r[8] if len(r) > 8 else None,
                    "engine": "postgresql",
                }
        except Exception as exc:
            logger.warning("Error fetching PG role properties for [%s]: %s", principal_name, exc)
        return {"name": principal_name, "engine": "postgresql"}
