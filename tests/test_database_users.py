# -*- coding: utf-8 -*-
"""
Unit tests for Database Users Explorer (Phase 1, Phase 3).
Tests DTO models, Script Generators for SQL Server & PostgreSQL, Providers with mocks, and API Mixin.
"""
import pytest
from app.services.database_users.models import PrincipalSummary, PermissionEntry
from app.services.database_users.sqlserver_scripts import SqlServerScriptGenerator
from app.services.database_users.postgres_scripts import PostgresScriptGenerator
from app.services.database_users.service import DatabaseUsersService
from app.services.database_users.sqlserver_provider import SqlServerUsersProvider
from app.services.database_users.postgres_provider import PostgresUsersProvider
from app.api.database_users_api import DatabaseUsersApiMixin


class MockAdapter:
    def __init__(self, db_type="sqlserver", execute_fn=None):
        self._db_type = db_type
        self.config = {"type": db_type, "database": "test_db", "host": "localhost"}
        self.execute_fn = execute_fn

    @property
    def db_type(self):
        return self._db_type

    def execute(self, sql, params=None, database=None, limit=None, **kwargs):
        if self.execute_fn:
            return self.execute_fn(sql, params, database, limit)
        return {"success": True, "rows": [], "columns": []}


class TestDatabaseUsersModels:
    def test_principal_summary_serialization(self):
        p = PrincipalSummary(
            engine="sqlserver",
            scope_type="database",
            scope_name="SalesDB",
            name="app_user",
            principal_type="SQL_USER",
            can_login=True,
            login_name="app_login",
            default_schema="dbo",
            is_system=False,
            capabilities=["script_create", "script_drop"]
        )
        d = p.to_dict()
        assert d["engine"] == "sqlserver"
        assert d["scope_type"] == "database"
        assert d["scope_name"] == "SalesDB"
        assert d["name"] == "app_user"
        assert d["can_login"] is True
        assert d["login_name"] == "app_login"
        assert d["is_system"] is False
        assert "script_create" in d["capabilities"]

    def test_permission_entry_serialization(self):
        pe = PermissionEntry(
            principal_name="report_role",
            scope_type="object",
            scope_name="SalesDB",
            permission_name="SELECT",
            state="GRANT",
            source="DIRECT",
            object_type="TABLE",
            schema_name="dbo",
            object_name="Invoices"
        )
        d = pe.to_dict()
        assert d["principal_name"] == "report_role"
        assert d["permission_name"] == "SELECT"
        assert d["source"] == "DIRECT"
        assert d["object_name"] == "Invoices"


class TestSqlServerScriptGenerator:
    def test_basic_create_script(self):
        principal_info = {
            "name": "john_doe",
            "type_desc": "SQL_USER",
            "login_name": "john_login",
            "default_schema": "sales"
        }
        script = SqlServerScriptGenerator.generate_create_script(
            principal_info=principal_info,
            database="SalesDB",
            mode="basic",
            connection_name="Production"
        )
        assert "USE [SalesDB];" in script
        assert "CREATE USER [john_doe] FOR LOGIN [john_login]" in script
        assert "WITH DEFAULT_SCHEMA = [sales];" in script
        assert "Production" in script

    def test_create_script_quoting_special_chars(self):
        principal_info = {
            "name": "user]with]brackets and spaces",
            "type_desc": "SQL_USER",
            "login_name": "login]name",
            "default_schema": "my schema"
        }
        script = SqlServerScriptGenerator.generate_create_script(
            principal_info=principal_info,
            database="Special]DB",
            mode="basic"
        )
        assert "[Special]]DB]" in script
        assert "[user]]with]]brackets and spaces]" in script
        assert "[login]]name]" in script
        assert "[my schema]" in script

    def test_full_create_script_with_memberships_and_permissions(self):
        principal_info = {
            "name": "app_reader",
            "type_desc": "SQL_USER",
            "login_name": "app_reader",
            "default_schema": "dbo"
        }
        memberships = [{"role_name": "db_datareader"}, {"role_name": "custom_audit_role"}]
        permissions = [
            PermissionEntry(
                principal_name="app_reader",
                scope_type="database",
                scope_name="TestDB",
                permission_name="VIEW DEFINITION",
                state="GRANT",
                source="DIRECT"
            ),
            PermissionEntry(
                principal_name="app_reader",
                scope_type="object",
                scope_name="TestDB",
                permission_name="SELECT",
                state="GRANT",
                source="DIRECT",
                schema_name="dbo",
                object_name="Customers"
            )
        ]
        script = SqlServerScriptGenerator.generate_create_script(
            principal_info=principal_info,
            database="TestDB",
            mode="full",
            memberships=memberships,
            permissions=permissions
        )
        assert "ALTER ROLE [db_datareader] ADD MEMBER [app_reader];" in script
        assert "ALTER ROLE [custom_audit_role] ADD MEMBER [app_reader];" in script
        assert "GRANT VIEW DEFINITION TO [app_reader];" in script
        assert "GRANT SELECT ON [dbo].[Customers] TO [app_reader];" in script

    def test_drop_script(self):
        script = SqlServerScriptGenerator.generate_drop_script(
            principal_name="temp_user",
            database="DevDB"
        )
        assert "USE [DevDB];" in script
        assert "DROP USER [temp_user];" in script
        assert "IF EXISTS" in script


class TestPostgresScriptGenerator:
    def test_basic_create_role(self):
        role_info = {
            "name": "developer",
            "can_login": True,
            "is_superuser": False,
            "can_create_db": True,
            "can_create_role": False,
            "inherit_privileges": True,
            "connection_limit": 20
        }
        script = PostgresScriptGenerator.generate_create_script(
            role_info=role_info,
            mode="basic",
            connection_name="LocalPG"
        )
        assert 'CREATE ROLE "developer" WITH' in script
        assert "LOGIN" in script
        assert "CREATEDB" in script
        assert "NOCREATEROLE" in script
        assert "CONNECTION LIMIT 20" in script
        assert "LocalPG" in script

    def test_create_role_special_characters(self):
        role_info = {
            "name": 'role"with"quotes and Caps',
            "can_login": False
        }
        script = PostgresScriptGenerator.generate_create_script(
            role_info=role_info,
            mode="basic"
        )
        assert 'CREATE ROLE "role""with""quotes and Caps" WITH' in script
        assert "NOLOGIN" in script

    def test_full_create_role_with_memberships_and_permissions(self):
        role_info = {
            "name": "bi_analyst",
            "can_login": True
        }
        memberships = [{"role_name": "reporting_group", "admin_option": False}]
        permissions = [
            PermissionEntry(
                principal_name="bi_analyst",
                scope_type="database",
                scope_name="analytics_db",
                permission_name="CONNECT",
                state="GRANT",
                source="DIRECT",
                object_name="analytics_db"
            ),
            PermissionEntry(
                principal_name="bi_analyst",
                scope_type="schema",
                scope_name="analytics_db",
                permission_name="USAGE",
                state="GRANT",
                source="DIRECT",
                schema_name="public"
            )
        ]
        script = PostgresScriptGenerator.generate_create_script(
            role_info=role_info,
            mode="full",
            memberships=memberships,
            permissions=permissions
        )
        assert 'GRANT "reporting_group" TO "bi_analyst";' in script
        assert 'GRANT CONNECT ON DATABASE "analytics_db" TO "bi_analyst";' in script
        assert 'GRANT USAGE ON SCHEMA "public" TO "bi_analyst";' in script

    def test_drop_role_script(self):
        script = PostgresScriptGenerator.generate_drop_script(
            role_name="old_role",
            connection_name="Cluster1"
        )
        assert 'DROP ROLE IF EXISTS "old_role";' in script
        assert "CẢNH BÁO AN TOÀN" in script


class TestDatabaseUsersServiceAndProviders:
    def test_sqlserver_provider_list_principals(self):
        fake_rows = [
            (1, "dbo", "SQL_USER", "INSTANCE", "dbo", "2024-01-01", "2024-01-01", "sa"),
            (5, "app_user", "SQL_USER", "INSTANCE", "sales", "2024-02-01", "2024-02-01", "app_login"),
            (6, "db_reader", "DATABASE_ROLE", "NONE", None, "2024-02-01", "2024-02-01", None),
        ]
        adapter = MockAdapter(
            db_type="sqlserver",
            execute_fn=lambda sql, params, db, limit: {"success": True, "rows": fake_rows}
        )
        service = DatabaseUsersService(adapter)
        users = service.list_principals("TestDB")
        assert len(users) == 3
        # dbo is flagged as system
        assert users[0]["name"] == "dbo"
        assert users[0]["is_system"] is True
        # app_user
        assert users[1]["name"] == "app_user"
        assert users[1]["is_system"] is False
        assert users[1]["can_login"] is True
        assert users[1]["login_name"] == "app_login"
        assert users[1]["scope_type"] == "database"
        # db_reader
        assert users[2]["name"] == "db_reader"
        assert users[2]["can_login"] is False

    def test_postgres_provider_list_principals(self):
        fake_rows = [
            ("postgres", True, True, True, True, True, True, -1),
            ("pg_read_all_data", False, True, False, False, False, False, -1),
            ("web_app", False, True, False, False, True, False, 10),
        ]
        adapter = MockAdapter(
            db_type="postgresql",
            execute_fn=lambda sql, params, db, limit: {"success": True, "rows": fake_rows}
        )
        service = DatabaseUsersService(adapter)
        roles = service.list_principals()
        assert len(roles) == 3
        # postgres superuser
        assert roles[0]["name"] == "postgres"
        assert roles[0]["principal_type"] == "SUPERUSER"
        assert roles[0]["can_login"] is True
        assert roles[0]["scope_type"] == "cluster"
        # pg_read_all_data system role
        assert roles[1]["name"] == "pg_read_all_data"
        assert roles[1]["is_system"] is True
        assert roles[1]["can_login"] is False
        # web_app
        assert roles[2]["name"] == "web_app"
        assert roles[2]["is_system"] is False
        assert roles[2]["can_login"] is True


class DummyConnection:
    def __init__(self, adapter):
        self.adapter = adapter
        self.config = {"name": "TestConn"}


class DummyApi(DatabaseUsersApiMixin):
    def __init__(self, adapter):
        self._adapter = adapter

    def _get_connection(self, connection_id):
        return DummyConnection(self._adapter)


class TestDatabaseUsersApiMixin:
    def test_api_list_and_script(self):
        adapter = MockAdapter(db_type="sqlserver")
        api = DummyApi(adapter)

        res_list = api.list_database_users("conn_123", database="master")
        assert res_list["success"] is True
        assert isinstance(res_list["items"], list)

        res_script = api.script_database_user(
            connection_id="conn_123",
            principal_name="test_user",
            action="DROP",
            database="master"
        )
        assert res_script["success"] is True
        assert "DROP USER [test_user];" in res_script["script"]
