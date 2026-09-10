from app.database.sqlserver import SqlServerAdapter
from app.database.postgresql import PostgreSqlAdapter

def create_adapter(config):
    db_type = str(config.get("type", "")).lower()

    if db_type in {"sqlserver", "mssql"}:
        return SqlServerAdapter(config)

    if db_type in {"postgresql", "postgres", "pgsql"}:
        return PostgreSqlAdapter(config)

    raise ValueError(f"Unsupported database type: {db_type}")
