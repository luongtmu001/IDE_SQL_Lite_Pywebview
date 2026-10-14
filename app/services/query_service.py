class QueryService:

    def __init__(self, connection_session):
        self.session = connection_session

    def execute(self, sql, params=None, limit=None, database=None, schema=None, progress_callback=None, mode="normal", debug_session_id=None, traces=None, parameters=None, stop_on_error=True):
        with self.session.lock:
            dialect = getattr(self.session.adapter, "db_type", "sqlserver")
            if parameters and isinstance(parameters, dict):
                from app.utils.sql_params import substitute_parameters
                sql = substitute_parameters(sql, parameters, dialect=dialect)

            if mode == "debug" and hasattr(self.session.adapter, "execute_debug"):
                result = self.session.adapter.execute_debug(
                    sql,
                    params=params,
                    limit=limit,
                    database=database,
                    schema=schema,
                    debug_session_id=debug_session_id,
                    traces=traces,
                    progress_callback=progress_callback
                )
            else:
                result = self.session.adapter.execute(
                    sql,
                    params,
                    limit=limit,
                    database=database,
                    schema=schema,
                    progress_callback=progress_callback,
                    stop_on_error=stop_on_error
                )
            self.session.touch()
            return result

    def cancel(self):
        """Cancel the currently running query on the adapter immediately."""
        adapter = getattr(self.session, "adapter", None)
        if adapter and hasattr(adapter, "cancel"):
            return adapter.cancel()
        return False
