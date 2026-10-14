class MetadataService:

    def __init__(self, connection_session):
        self.session = connection_session

    def _cache_key(self, *parts):
        return "::".join(
            "" if part is None else str(part)
            for part in parts
        )

    def list_databases(self):
        key = self._cache_key("databases")

        if key not in self.session.metadata_cache:
            with self.session.lock:
                self.session.metadata_cache[key] = (
                    self.session.adapter.list_databases()
                )

        return self.session.metadata_cache[key]

    def list_schemas(self, database=None):
        key = self._cache_key("schemas", database)

        if key not in self.session.metadata_cache:
            with self.session.lock:
                self.session.metadata_cache[key] = (
                    self.session.adapter.list_schemas(database)
                )

        return self.session.metadata_cache[key]

    def list_objects(self, database, schema, object_type, search=None, limit=0):
        key = self._cache_key(
            "objects",
            database,
            schema,
            object_type,
            search,
            limit,
        )

        if key not in self.session.metadata_cache:
            with self.session.lock:
                self.session.metadata_cache[key] = (
                    self.session.adapter.list_objects(
                        database,
                        schema,
                        object_type,
                        search,
                        limit=limit
                    )
                )

        return self.session.metadata_cache[key]

    def get_object_definition(
        self,
        database,
        schema,
        name,
        object_type,
    ):
        with self.session.lock:
            return self.session.adapter.get_object_definition(
                database,
                schema,
                name,
                object_type,
            )

    def list_object_children(self, database, schema, name, object_type, child_type):
        key = self._cache_key("children", database, schema, name, object_type, child_type)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                self.session.metadata_cache[key] = (
                    self.session.adapter.list_object_children(
                        database, schema, name, object_type, child_type
                    )
                )
        return self.session.metadata_cache[key]

    def get_table_design_metadata(self, database, schema, table):
        with self.session.lock:
            return self.session.adapter.get_table_design_metadata(database, schema, table)

    def get_supported_types(self, database=None):
        with self.session.lock:
            return self.session.adapter.get_supported_types(database=database)

    def get_intellisense_objects(self, database=None, schema=None):
        key = self._cache_key("intellisense_objects", database, schema)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "get_intellisense_objects"):
                    self.session.metadata_cache[key] = (
                        self.session.adapter.get_intellisense_objects(database, schema)
                    )
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def get_intellisense_columns(self, database=None, schema=None, table=None):
        key = self._cache_key("intellisense_columns", database, schema, table)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "get_intellisense_columns"):
                    self.session.metadata_cache[key] = (
                        self.session.adapter.get_intellisense_columns(database, schema, table)
                    )
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def get_intellisense_parameters(self, database=None, schema=None, name=None):
        key = self._cache_key("intellisense_parameters", database, schema, name)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "get_intellisense_parameters"):
                    self.session.metadata_cache[key] = (
                        self.session.adapter.get_intellisense_parameters(database, schema, name)
                    )
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def get_foreign_keys(self, database=None, schema=None, table=None):
        key = self._cache_key("foreign_keys", database, schema, table)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "get_foreign_keys"):
                    self.session.metadata_cache[key] = (
                        self.session.adapter.get_foreign_keys(database, schema, table)
                    )
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_linked_servers(self):
        key = self._cache_key("linked_servers")
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_linked_servers"):
                    self.session.metadata_cache[key] = self.session.adapter.list_linked_servers()
                elif hasattr(self.session.adapter, "list_foreign_servers"):
                    self.session.metadata_cache[key] = self.session.adapter.list_foreign_servers()
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_remote_databases(self, server):
        key = self._cache_key("remote_databases", server)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_remote_databases"):
                    self.session.metadata_cache[key] = self.session.adapter.list_remote_databases(server)
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_remote_schemas(self, server, database=None):
        key = self._cache_key("remote_schemas", server, database)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_remote_schemas"):
                    self.session.metadata_cache[key] = self.session.adapter.list_remote_schemas(server, database)
                else:
                    self.session.metadata_cache[key] = [{"name": "dbo"}]
        return self.session.metadata_cache[key]

    def list_remote_objects(self, server, database=None, schema=None):
        key = self._cache_key("remote_objects", server, database, schema)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_remote_objects"):
                    self.session.metadata_cache[key] = self.session.adapter.list_remote_objects(server, database, schema)
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_remote_columns(self, server, database=None, schema=None, table=None):
        key = self._cache_key("remote_columns", server, database, schema, table)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_remote_columns"):
                    self.session.metadata_cache[key] = self.session.adapter.list_remote_columns(server, database, schema, table)
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_foreign_servers(self):
        key = self._cache_key("foreign_servers")
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_foreign_servers"):
                    self.session.metadata_cache[key] = self.session.adapter.list_foreign_servers()
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def list_foreign_tables(self, schema=None):
        key = self._cache_key("foreign_tables", schema)
        if key not in self.session.metadata_cache:
            with self.session.lock:
                if hasattr(self.session.adapter, "list_foreign_tables"):
                    self.session.metadata_cache[key] = self.session.adapter.list_foreign_tables(schema=schema)
                else:
                    self.session.metadata_cache[key] = []
        return self.session.metadata_cache[key]

    def invalidate(self):
        with self.session.lock:
            self.session.metadata_cache.clear()


