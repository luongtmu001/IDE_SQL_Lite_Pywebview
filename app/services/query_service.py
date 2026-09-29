class QueryService:

    def __init__(self, connection_session):
        self.session = connection_session

    def execute(self, sql, params=None, limit=None, database=None, schema=None, progress_callback=None):
        with self.session.lock:
            result = self.session.adapter.execute(
                sql,
                params,
                limit=limit,
                database=database,
                schema=schema,
                progress_callback=progress_callback
            )
            self.session.touch()
            return result

    def cancel(self):
        """Cancel the currently running query on the adapter immediately."""
        adapter = getattr(self.session, "adapter", None)
        if adapter and hasattr(adapter, "cancel"):
            return adapter.cancel()
        return False
