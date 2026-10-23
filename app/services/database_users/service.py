# -*- coding: utf-8 -*-
"""
Database Users & Roles Coordinator Service.
Selects the appropriate provider (SQL Server vs PostgreSQL) based on connection adapter.
"""
import logging
from typing import List, Dict, Any, Optional

from .models import PrincipalSummary, PermissionEntry
from .sqlserver_provider import SqlServerUsersProvider
from .postgres_provider import PostgresUsersProvider
from .sqlserver_scripts import SqlServerScriptGenerator
from .postgres_scripts import PostgresScriptGenerator

logger = logging.getLogger("luobtool.database_users.service")


class DatabaseUsersService:
    """
    Coordinates user/role management and script generation for a given database connection.
    """

    def __init__(self, adapter):
        self.adapter = adapter
        self.engine = getattr(adapter, "db_type", None) or adapter.config.get("type", "sqlserver").lower()

        if self.engine in ("postgresql", "postgres"):
            self.provider = PostgresUsersProvider(adapter)
            self.is_postgres = True
        else:
            self.provider = SqlServerUsersProvider(adapter)
            self.is_postgres = False

    def list_principals(self, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Lists users (SQL Server) or roles (PostgreSQL).
        """
        principals = self.provider.list_principals(database=database)
        return [p.to_dict() for p in principals]

    def get_role_memberships(self, principal_name: str, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Retrieves role memberships.
        """
        return self.provider.get_role_memberships(principal_name, database=database)

    def get_permissions(self, principal_name: str, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Retrieves direct and role-inherited permissions.
        """
        perms = self.provider.get_permissions(principal_name, database=database)
        return [p.to_dict() for p in perms]

    def get_properties(self, principal_name: str, database: Optional[str] = None) -> Dict[str, Any]:
        """
        Retrieves principal detailed properties.
        """
        return self.provider.get_principal_properties(principal_name, database=database)

    def generate_script(
        self,
        principal_name: str,
        action: str = "CREATE",
        mode: str = "basic",
        database: Optional[str] = None,
        connection_name: str = ""
    ) -> str:
        """
        Generates CREATE or DROP script.
        """
        db = database or self.adapter.config.get("database") or "master"
        act = action.strip().upper()

        if self.is_postgres:
            if act == "DROP":
                return PostgresScriptGenerator.generate_drop_script(
                    role_name=principal_name,
                    connection_name=connection_name
                )
            else:
                props = self.get_properties(principal_name, database=db)
                memberships = self.get_role_memberships(principal_name, database=db) if mode.lower() == "full" else None
                permissions = self.provider.get_permissions(principal_name, database=db) if mode.lower() == "full" else None
                return PostgresScriptGenerator.generate_create_script(
                    role_info=props,
                    mode=mode,
                    memberships=memberships,
                    permissions=permissions,
                    connection_name=connection_name
                )
        else:
            if act == "DROP":
                return SqlServerScriptGenerator.generate_drop_script(
                    principal_name=principal_name,
                    database=db,
                    connection_name=connection_name
                )
            else:
                props = self.get_properties(principal_name, database=db)
                memberships = self.get_role_memberships(principal_name, database=db) if mode.lower() == "full" else None
                permissions = self.provider.get_permissions(principal_name, database=db) if mode.lower() == "full" else None
                return SqlServerScriptGenerator.generate_create_script(
                    principal_info=props,
                    database=db,
                    mode=mode,
                    memberships=memberships,
                    permissions=permissions,
                    connection_name=connection_name
                )
