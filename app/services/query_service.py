class QueryService:

    def __init__(self, connection_session):
        self.session = connection_session

    def execute(self, sql, params=None, limit=None, database=None, schema=None):
        with self.session.lock:
            result = self.session.adapter.execute(
                sql,
                params,
                limit=limit,
                database=database,
                schema=schema
            )
            self.session.touch()
            return result
