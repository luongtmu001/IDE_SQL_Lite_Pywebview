import os

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
    MAX_QUERY_ROWS = int(os.getenv("MAX_QUERY_ROWS", "1000"))
    QUERY_TIMEOUT_SECONDS = int(os.getenv("QUERY_TIMEOUT_SECONDS", "30"))
