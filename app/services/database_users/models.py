# -*- coding: utf-8 -*-
"""
DTO Models for Database Users & Roles Explorer.
Normalized across Microsoft SQL Server and PostgreSQL without obscuring engine semantics.
"""
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any


@dataclass
class PrincipalSummary:
    """
    Standardized principal model for both SQL Server and PostgreSQL.
    """
    engine: str                             # 'sqlserver' | 'postgresql'
    scope_type: str                         # 'database' | 'cluster'
    scope_name: str                         # Database name (SQL Server) or Cluster/Host (PostgreSQL)
    name: str                               # Principal name (User name or Role name)
    principal_type: str                     # e.g. 'SQL_USER', 'WINDOWS_USER', 'ROLE', 'SUPERUSER'
    can_login: Optional[bool] = None        # True/False (nullable if unknown/not applicable)
    authentication_type: Optional[str] = None # e.g. 'INSTANCE', 'DATABASE', 'WINDOWS', 'NONE'
    login_name: Optional[str] = None        # Server login mapping (SQL Server) if mapped
    default_schema: Optional[str] = None    # Default schema (SQL Server)
    is_system: bool = False                 # Flag for system-defined accounts/roles
    metadata_visibility: str = "complete"   # 'complete' | 'partial' | 'unknown'
    capabilities: List[str] = field(default_factory=list) # Supported query features: ['script_create', 'script_drop', 'permissions', 'memberships']
    extra: Dict[str, Any] = field(default_factory=dict)   # Additional engine-specific attributes

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PermissionEntry:
    """
    Standardized permission entry model for Permissions Viewer.
    Distinguishes DIRECT grants, ROLE inheritance, OWNERSHIP, and EFFECTIVE states.
    """
    principal_name: str                     # Principal this permission is queried for
    scope_type: str                         # 'database' | 'schema' | 'object' | 'server' | 'cluster'
    scope_name: str                         # Name of the container scope (e.g. database name)
    permission_name: str                    # e.g. 'SELECT', 'INSERT', 'CONNECT', 'USAGE', 'EXECUTE'
    state: str = "GRANT"                    # 'GRANT' | 'DENY' | 'GRANT_WITH_OPTION' | 'OTHER'
    source: str = "DIRECT"                  # 'DIRECT' | 'ROLE' | 'OWNERSHIP' | 'EFFECTIVE' | 'UNKNOWN'
    object_type: Optional[str] = None       # e.g. 'TABLE', 'VIEW', 'PROCEDURE', 'SCHEMA', 'DATABASE'
    schema_name: Optional[str] = None       # Schema of the securable object
    object_name: Optional[str] = None       # Name of the securable object
    grantor: Optional[str] = None           # Principal that granted the permission
    via_role: Optional[str] = None          # Role name if permission is inherited via role
    is_complete: bool = True                # Flag if metadata was read completely
    warning: Optional[str] = None           # Warning message if metadata visibility was restricted

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
