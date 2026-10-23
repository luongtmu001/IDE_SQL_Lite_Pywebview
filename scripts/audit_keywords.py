import json
import re
import sys
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT_DIR = Path(__file__).resolve().parent.parent

# Read monaco-sql-lang.js
with open(ROOT_DIR / "static/js/monaco-sql-lang.js", "r", encoding="utf-8") as f:
    monaco_code = f.read()

def extract_array(code, prop_name):
    m = re.search(rf'{prop_name}:\s*\[(.*?)\]', code, re.DOTALL)
    if not m:
        return set()
    return set(re.findall(r'["\']([^"\']+)["\']', m.group(1)))

monaco_keywords = extract_array(monaco_code, "keywords")
monaco_functions = extract_array(monaco_code, "builtinFunctions")
monaco_datatypes = extract_array(monaco_code, "dataTypes")
monaco_variables = extract_array(monaco_code, "builtinVariables")
monaco_operators = extract_array(monaco_code, "operators")

all_monaco_tokens = {k.upper() for k in (monaco_keywords | monaco_functions | monaco_datatypes | monaco_variables | monaco_operators)}

# Read sql-dialects.js
with open(ROOT_DIR / "static/js/sql-dialects.js", "r", encoding="utf-8") as f:
    dialects_code = f.read()

# Read sql-formatter.js
with open(ROOT_DIR / "static/js/sql-formatter.js", "r", encoding="utf-8") as f:
    formatter_code = f.read()

# Comprehensive list of standard PostgreSQL keywords (Reserved, Non-reserved, Type/Function, PL/pgSQL)
POSTGRESQL_KEYWORDS = {
    # Core statements & DDL
    "CALL", "ANALYSE", "ANALYZE", "ARRAY", "ASYMMETRIC", "ATTACH", "AUTHORIZATION",
    "BINARY", "BOTH", "CLUSTER", "COMMENT", "CONCURRENTLY", "CONFLICT", "COPY",
    "CURRENT_CATALOG", "CURRENT_ROLE", "CURRENT_SCHEMA", "DEFERRABLE", "DETACH",
    "DISCARD", "DO", "EXCLUDE", "EXTENSION", "FALSE", "FREEZE", "GENERATED",
    "HOLD", "ILIKE", "INITIALLY", "LATERAL", "LEADING", "LISTEN", "LOAD",
    "LOCALTIME", "LOCALTIMESTAMP", "LOCK", "MATERIALIZED", "MOVE", "NOTHING",
    "NOTIFY", "ONLY", "OVERLAPS", "PLACING", "POLICY", "PREPARE", "PUBLICATION",
    "REFRESH", "RESET", "RESTART", "RESTRICT", "ROUTINE", "RULE", "SAFE",
    "SEQUENCE", "SHARE", "SHOW", "SIMILAR", "STORED", "SUBSCRIPTION", "SUPERUSER",
    "SYMMETRIC", "TABLESPACE", "TRAILING", "TRUE", "TRUSTED", "TYPE", "UNLISTEN",
    "UNTIL", "VACUUM", "VALID", "VARIADIC", "VERBOSE", "WRAPPER",
    # Locking & Isolation
    "NOWAIT", "SKIP", "LOCKED", "ISOLATION", "LEVEL", "SERIALIZABLE", "REPEATABLE",
    # PL/pgSQL
    "PERFORM", "RAISE", "NOTICE", "DEBUG", "LOG", "WARNING", "INFO", "ASSERT",
    "FOREACH", "LOOP", "ELSIF", "ELSEIF", "EXCEPTION", "RECORD", "FOUND",
    "STACKED", "DIAGNOSTICS", "PG_CONTEXT", "SQLSTATE", "CONSTANT", "SLICE",
    "IMMUTABLE", "STABLE", "VOLATILE", "LEAKPROOF", "COST", "ROWS", "RETURNS",
    "SETOF", "LANGUAGE", "PLPGSQL", "STRICT", "CALLED", "SECURITY", "DEFINER", "INVOKER"
}

# Comprehensive list of T-SQL (SQL Server) keywords (Reserved, Query Hints, Control Flow, Windowing)
MSSQL_KEYWORDS = {
    # Reserved words
    "ADD", "ALL", "ALTER", "AND", "ANY", "APPLY", "AS", "ASC", "AUTHORIZATION",
    "BACKUP", "BEGIN", "BETWEEN", "BREAK", "BROWSE", "BULK", "BY", "CASCADE",
    "CASE", "CATCH", "CHECK", "CHECKPOINT", "CLOSE", "CLUSTERED", "COALESCE",
    "COLLATE", "COLUMN", "COMMIT", "COMPUTE", "CONSTRAINT", "CONTAINS",
    "CONTAINSTABLE", "CONTINUE", "CONVERT", "CREATE", "CROSS", "CURRENT",
    "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "CURRENT_USER", "CURSOR",
    "DATABASE", "DBCC", "DEALLOCATE", "DECLARE", "DEFAULT", "DELETE", "DENY",
    "DESC", "DISK", "DISTINCT", "DISTRIBUTED", "DOUBLE", "DROP", "DUMP", "ELSE",
    "END", "ERRLVL", "ESCAPE", "EXCEPT", "EXEC", "EXECUTE", "EXISTS", "EXIT",
    "EXTERNAL", "FETCH", "FILE", "FILLFACTOR", "FOR", "FOREIGN", "FREETEXT",
    "FREETEXTTABLE", "FROM", "FULL", "FUNCTION", "GO", "GOTO", "GRANT", "GROUP",
    "HAVING", "HOLDLOCK", "IDENTITY", "IDENTITYCOL", "IDENTITY_INSERT", "IF",
    "IN", "INDEX", "INNER", "INSERT", "INTERSECT", "INTO", "IS", "JOIN", "KEY",
    "KILL", "LEFT", "LIKE", "LINENO", "LOAD", "MERGE", "NATIONAL", "NOCHECK",
    "NONCLUSTERED", "NOT", "NULL", "NULLIF", "OF", "OFF", "OFFSETS", "ON",
    "OPEN", "OPENDATASOURCE", "OPENQUERY", "OPENROWSET", "OPENXML", "OPTION",
    "OR", "ORDER", "OUTER", "OVER", "PERCENT", "PIVOT", "PLAN", "PRECISION",
    "PRIMARY", "PRINT", "PROC", "PROCEDURE", "PUBLIC", "RAISERROR", "READ",
    "READTEXT", "RECONFIGURE", "REFERENCES", "REPLICATION", "RESTORE", "RESTRICT",
    "RETURN", "REVERT", "REVOKE", "RIGHT", "ROLLBACK", "ROWCOUNT", "ROWGUIDCOL",
    "RULE", "SAVE", "SCHEMA", "SECURITYAUDIT", "SELECT", "SEMANTICKEYPHRASETABLE",
    "SEMANTICSIMILARITYDETAILSTABLE", "SEMANTICSIMILARITYTABLE", "SESSION_USER",
    "SET", "SETUSER", "SHUTDOWN", "SOME", "STATISTICS", "SYSTEM_USER", "TABLE",
    "TABLESAMPLE", "TEXTSIZE", "THEN", "THROW", "TO", "TOP", "TRAN", "TRANSACTION",
    "TRIGGER", "TRUNCATE", "TRY", "TRY_CONVERT", "TSEQUAL", "UNION", "UNIQUE",
    "UNPIVOT", "UPDATE", "UPDATETEXT", "USE", "USER", "VALUES", "VARYING", "VIEW",
    "WAITFOR", "WHEN", "WHERE", "WHILE", "WITH", "WITHIN GROUP", "WRITETEXT",
    # Modern / Essential Clauses & Hints
    "NOLOCK", "READPAST", "UPDLOCK", "XLOCK", "ROWLOCK", "PAGLOCK", "TABLOCK",
    "TABLOCKX", "READCOMMITTED", "READUNCOMMITTED", "REPEATABLEREAD", "SNAPSHOT",
    "NOWAIT", "OUTPUT", "INSERTED", "DELETED", "RECOMPILE", "MAXDOP", "FAST",
    "OPTIMIZE", "SYNONYM", "SEQUENCE", "RESTART", "PERIOD", "SYSTEM_TIME",
    "UNBOUNDED", "PRECEDING", "FOLLOWING", "RANGE", "ROWS", "ONLY", "PARTITION"
}

# PostgreSQL Builtin Functions commonly used in queries
POSTGRESQL_FUNCTIONS = {
    "GEN_RANDOM_UUID", "UUID_GENERATE_V4", "CLOCK_TIMESTAMP", "TIMEOFDAY",
    "MAKE_DATE", "MAKE_TIME", "MAKE_TIMESTAMP", "MAKE_TIMESTAMPTZ",
    "TO_CHAR", "TO_DATE", "TO_TIMESTAMP", "TO_NUMBER", "GREATEST", "LEAST",
    "INITCAP", "LPAD", "RPAD", "MD5", "POSITION", "SPLIT_PART", "STRPOS",
    "CBRT", "CEIL", "DIV", "LN", "MOD", "RANDOM", "SETSEED", "TRUNC",
    "ARRAY_AGG", "BOOL_AND", "BOOL_OR", "EVERY", "NTH_VALUE",
    "TO_JSON", "TO_JSONB", "ARRAY_TO_JSON", "ROW_TO_JSON", "JSON_BUILD_ARRAY",
    "JSON_BUILD_OBJECT", "JSON_OBJECT", "JSON_ARRAY_LENGTH", "JSON_EACH",
    "JSON_EACH_TEXT", "JSON_EXTRACT_PATH", "JSON_EXTRACT_PATH_TEXT",
    "JSON_OBJECT_KEYS", "JSONB_SET", "JSONB_INSERT", "JSONB_PRETTY",
    "REGEXP_MATCH", "REGEXP_MATCHES", "REGEXP_REPLACE", "REGEXP_SPLIT_TO_ARRAY", "REGEXP_SPLIT_TO_TABLE"
}

# T-SQL Functions commonly used in queries
MSSQL_FUNCTIONS = {
    "DATEDIFF_BIG", "DATETIME2FROMPARTS", "DATETIMEFROMPARTS", "DATETIMEOFFSETFROMPARTS",
    "SMALLDATETIMEFROMPARTS", "TIMEFROMPARTS", "SWITCHOFFSET", "TODATETIMEOFFSET",
    "STDEV", "STDEVP", "VAR", "VARP", "CUME_DIST", "PERCENT_RANK", "PERCENTILE_CONT", "PERCENTILE_DISC",
    "APP_NAME", "COL_LENGTH", "COLUMNPROPERTY", "DATABASEPROPERTYEX",
    "HOST_ID", "HOST_NAME", "IDENT_CURRENT", "IDENT_INCR", "IDENT_SEED",
    "OBJECT_DEFINITION", "OBJECT_SCHEMA_NAME", "OBJECTPROPERTY", "OBJECTPROPERTYEX",
    "ORIGINAL_LOGIN", "PARSENAME", "SCOPE_IDENTITY", "SERVERPROPERTY",
    "SESSIONPROPERTY", "STATS_DATE", "TYPE_ID", "TYPE_NAME", "USER_ID", "USER_NAME",
    "SUSER_SNAME", "SUSER_ID", "SCHEMA_ID", "SCHEMA_NAME"
}

# PostgreSQL Data Types
POSTGRESQL_DATATYPES = {
    "BIGSERIAL", "SERIAL", "SMALLSERIAL", "BYTEA", "CIDR", "INET", "MACADDR", "MACADDR8",
    "POINT", "LINE", "LSEG", "BOX", "PATH", "POLYGON", "CIRCLE",
    "JSON", "JSONB", "JSONPATH", "UUID", "XML", "INTERVAL", "TIMETZ", "TIMESTAMPTZ",
    "TSQUERY", "TSVECTOR", "PG_LSN", "INT2", "INT4", "INT8", "FLOAT4", "FLOAT8",
    "NUMERIC", "DECIMAL", "BOOLEAN", "BOOL"
}

# T-SQL Data Types
MSSQL_DATATYPES = {
    "BIGINT", "INT", "SMALLINT", "TINYINT", "BIT", "DECIMAL", "NUMERIC", "MONEY", "SMALLMONEY",
    "FLOAT", "REAL", "DATE", "DATETIME", "DATETIME2", "SMALLDATETIME", "TIME", "DATETIMEOFFSET",
    "TIMESTAMP", "CHAR", "VARCHAR", "TEXT", "NCHAR", "NVARCHAR", "NTEXT",
    "BINARY", "VARBINARY", "IMAGE", "UNIQUEIDENTIFIER", "XML", "ROWVERSION", "GEOMETRY", "GEOGRAPHY", "HIERARCHYID"
}

print("=================================================================")
print("KIỂM TRA TỪ KHÓA POSTGRESQL TRONG MONACO MONARCH TOKENIZER")
print("=================================================================")
pg_missing_kw = sorted([kw for kw in POSTGRESQL_KEYWORDS if kw not in all_monaco_tokens])
print(f"PostgreSQL keywords thiếu ({len(pg_missing_kw)}):")
for kw in pg_missing_kw:
    print(f"  - {kw}")

print("\n=================================================================")
print("KIỂM TRA TỪ KHÓA MSSQL (T-SQL) TRONG MONACO MONARCH TOKENIZER")
print("=================================================================")
ms_missing_kw = sorted([kw for kw in MSSQL_KEYWORDS if kw not in all_monaco_tokens])
print(f"T-SQL keywords thiếu ({len(ms_missing_kw)}):")
for kw in ms_missing_kw:
    print(f"  - {kw}")

print("\n=================================================================")
print("KIỂM TRA HÀM BUILT-IN PHỔ BIẾN TRONG MONACO MONARCH")
print("=================================================================")
pg_missing_fn = sorted([fn for fn in POSTGRESQL_FUNCTIONS if fn not in all_monaco_tokens])
print(f"PostgreSQL built-in functions thiếu ({len(pg_missing_fn)}):")
for fn in pg_missing_fn:
    print(f"  - {fn}")

ms_missing_fn = sorted([fn for fn in MSSQL_FUNCTIONS if fn not in all_monaco_tokens])
print(f"MSSQL built-in functions thiếu ({len(ms_missing_fn)}):")
for fn in ms_missing_fn:
    print(f"  - {fn}")

print("\n=================================================================")
print("KIỂM TRA KIỂU DỮ LIỆU (DATATYPES) TRONG MONACO MONARCH")
print("=================================================================")
missing_types = sorted([dt for dt in (POSTGRESQL_DATATYPES | MSSQL_DATATYPES) if dt not in all_monaco_tokens])
print(f"Datatypes thiếu ({len(missing_types)}):")
for dt in missing_types:
    print(f"  - {dt}")
