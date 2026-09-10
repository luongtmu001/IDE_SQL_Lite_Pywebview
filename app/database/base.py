from abc import ABC, abstractmethod
from typing import Any

class DatabaseAdapter(ABC):

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.connection = None

    @abstractmethod
    def connect(self):
        ...

    @abstractmethod
    def close(self):
        ...

    @abstractmethod
    def execute(self, sql: str, params=None, limit=None, database=None):
        ...

    @abstractmethod
    def list_databases(self):
        ...

    @abstractmethod
    def list_schemas(self, database=None):
        ...

    @abstractmethod
    def list_objects(self, database, schema, object_type, search=None):
        ...

    @abstractmethod
    def get_object_definition(
        self,
        database,
        schema,
        name,
        object_type,
    ):
        ...

    @abstractmethod
    def list_object_children(
        self,
        database,
        schema,
        name,
        object_type,
        child_type,
    ):
        ...

    @abstractmethod
    def get_table_design_metadata(self, database, schema, table):
        ...

    @abstractmethod
    def get_supported_types(self, database=None):
        ...

    def execute_migration_transaction(self, batches: list[str], database: str = None):
        """Executes a list of SQL batches within a single atomic transaction.
        Must rollback and re-raise if any statement fails.
        """
        for b in batches:
            self.execute(b, database=database)
