# -*- coding: utf-8 -*-
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

# 1. New Keywords to Add into monaco-sql-lang.js
NEW_KEYWORDS = [
    # PostgreSQL specific & ANSI statements (including CALL)
    "ANALYSE", "ARRAY", "ASYMMETRIC", "AUTHORIZATION", "BOTH", "CALL",
    "CLUSTER", "COMMENT", "CONCURRENTLY", "COPY", "CURRENT_CATALOG",
    "CURRENT_ROLE", "CURRENT_SCHEMA", "DEFERRABLE", "DISCARD", "EXCLUDE",
    "EXTENSION", "FALSE", "FREEZE", "GENERATED", "HOLD", "ISOLATION",
    "LATERAL", "LEADING", "LEVEL", "LISTEN", "LOAD", "LOCALTIME",
    "LOCALTIMESTAMP", "LOCK", "LOCKED", "MATERIALIZED", "MOVE", "NOTHING",
    "NOTIFY", "NOWAIT", "ONLY", "OVERLAPS", "PG_CONTEXT", "PLACING",
    "POLICY", "PREPARE", "PUBLICATION", "REFRESH", "REPEATABLE", "RESET",
    "RESTART", "ROUTINE", "RULE", "SAFE", "SEQUENCE", "SERIALIZABLE",
    "SHARE", "SHOW", "SKIP", "SLICE", "STORED", "SUBSCRIPTION",
    "SUPERUSER", "SYMMETRIC", "TABLESPACE", "TRAILING", "TRUE", "TRUSTED",
    "TYPE", "UNLISTEN", "UNTIL", "VALID", "VARIADIC", "VERBOSE", "WITHIN",
    "WRAPPER",

    # SQL Server (T-SQL) specific keywords, clauses & hints
    "BROWSE", "BULK", "COMPUTE", "CONTAINS", "CONTAINSTABLE", "DELETED",
    "DISK", "DISTRIBUTED", "DOUBLE", "DUMP", "ERRLVL", "EXTERNAL",
    "FAST", "FILE", "FILLFACTOR", "FOLLOWING", "FREETEXT", "FREETEXTTABLE",
    "HOLDLOCK", "IDENTITYCOL", "INSERTED", "LINENO", "MAXDOP",
    "NATIONAL", "NOLOCK", "OFFSETS", "OPENDATASOURCE", "OPENQUERY",
    "OPENROWSET", "OPENXML", "OPTIMIZE", "OUTPUT", "PAGLOCK", "PERCENT",
    "PERIOD", "PIVOT", "PRECEDING", "PRECISION", "PUBLIC", "RANGE",
    "READ", "READCOMMITTED", "READPAST", "READTEXT", "READUNCOMMITTED",
    "RECOMPILE", "REPEATABLEREAD", "REPLICATION", "RESTORE", "REVERT",
    "ROWGUIDCOL", "ROWLOCK", "SECURITYAUDIT", "SEMANTICKEYPHRASETABLE",
    "SEMANTICSIMILARITYDETAILSTABLE", "SEMANTICSIMILARITYTABLE", "SESSION_USER", "SETUSER",
    "SHUTDOWN", "SNAPSHOT", "SYNONYM", "SYSTEM_TIME", "SYSTEM_USER",
    "TABLESAMPLE", "TABLOCK", "TABLOCKX", "TEXTSIZE", "TSEQUAL",
    "UNBOUNDED", "UNPIVOT", "UPDLOCK", "VARYING", "WRITETEXT", "XLOCK"
]

# 2. New Built-in Functions to Add into monaco-sql-lang.js
NEW_BUILTIN_FUNCTIONS = [
    # PostgreSQL built-in functions
    "ARRAY_AGG", "ARRAY_TO_JSON", "BOOL_AND", "BOOL_OR", "CBRT", "CEIL",
    "CLOCK_TIMESTAMP", "DIV", "EVERY", "GEN_RANDOM_UUID", "GREATEST",
    "INITCAP", "JSONB_INSERT", "JSONB_PRETTY", "JSONB_SET", "JSON_ARRAY_LENGTH",
    "JSON_BUILD_ARRAY", "JSON_BUILD_OBJECT", "JSON_EACH", "JSON_EACH_TEXT",
    "JSON_EXTRACT_PATH", "JSON_EXTRACT_PATH_TEXT", "JSON_OBJECT",
    "JSON_OBJECT_KEYS", "LEAST", "LN", "LPAD", "MAKE_DATE", "MAKE_TIME",
    "MAKE_TIMESTAMP", "MAKE_TIMESTAMPTZ", "MD5", "MOD", "NTH_VALUE",
    "POSITION", "RANDOM", "REGEXP_MATCH", "REGEXP_MATCHES", "REGEXP_REPLACE",
    "REGEXP_SPLIT_TO_ARRAY", "REGEXP_SPLIT_TO_TABLE", "ROW_TO_JSON", "RPAD",
    "SETSEED", "SPLIT_PART", "STRPOS", "TIMEOFDAY", "TO_CHAR", "TO_DATE",
    "TO_JSON", "TO_JSONB", "TO_NUMBER", "TO_TIMESTAMP", "TRUNC", "UUID_GENERATE_V4",

    # SQL Server (T-SQL) built-in functions
    "APP_NAME", "COLUMNPROPERTY", "COL_LENGTH", "CUME_DIST",
    "DATABASEPROPERTYEX", "DATEDIFF_BIG", "DATETIME2FROMPARTS",
    "DATETIMEFROMPARTS", "DATETIMEOFFSETFROMPARTS", "HOST_ID", "HOST_NAME",
    "IDENT_CURRENT", "IDENT_INCR", "IDENT_SEED", "OBJECTPROPERTY",
    "OBJECTPROPERTYEX", "OBJECT_DEFINITION", "OBJECT_SCHEMA_NAME",
    "ORIGINAL_LOGIN", "PARSENAME", "PERCENTILE_CONT", "PERCENTILE_DISC",
    "PERCENT_RANK", "SCOPE_IDENTITY", "SERVERPROPERTY", "SESSIONPROPERTY",
    "SMALLDATETIMEFROMPARTS", "STATS_DATE", "STDEV", "STDEVP", "SUSER_ID",
    "SUSER_SNAME", "SWITCHOFFSET", "TIMEFROMPARTS", "TODATETIMEOFFSET",
    "TYPE_ID", "TYPE_NAME", "USER_ID", "USER_NAME", "VAR", "VARP"
]

# 3. New Data Types to Add into monaco-sql-lang.js
NEW_DATATYPES = [
    # PostgreSQL data types
    "BOX", "CIDR", "CIRCLE", "FLOAT4", "FLOAT8", "INET", "INT2", "INT4", "INT8",
    "INTERVAL", "JSONPATH", "LINE", "LSEG", "MACADDR", "MACADDR8", "PATH",
    "PG_LSN", "POINT", "POLYGON", "SMALLSERIAL", "TIMETZ", "TSQUERY", "TSVECTOR",

    # SQL Server (T-SQL) data types
    "GEOGRAPHY", "GEOMETRY", "HIERARCHYID", "ROWVERSION"
]

# 4. New Built-in Variables to Add into monaco-sql-lang.js
NEW_VARIABLES = [
    "@@CPU_BUSY", "@@CURSOR_ROWS", "@@DBTS", "@@IDLE", "@@IO_BUSY", "@@LANGID",
    "@@LANGUAGE", "@@MAX_PRECISION", "@@OPTIONS", "@@PACKET_ERRORS", "@@PACK_RECEIVED",
    "@@PACK_SENT", "@@PROCID", "@@REMSERVER", "@@SERVICENAME", "@@TEXTSIZE",
    "@@TIMETICKS", "@@TOTAL_ERRORS", "@@TOTAL_READ", "@@TOTAL_WRITE"
]

def format_js_array(items, indent="            ", items_per_line=10):
    sorted_items = sorted(list(set(items)), key=lambda s: s.upper())
    lines = []
    current_line = []
    for item in sorted_items:
        current_line.append(f'"{item}"')
        if len(current_line) >= items_per_line:
            lines.append(indent + ", ".join(current_line))
            current_line = []
    if current_line:
        lines.append(indent + ", ".join(current_line))
    return "[\n" + ",\n".join(lines) + "\n        ]"

def update_monaco_sql_lang():
    file_path = ROOT_DIR / "static/js/monaco-sql-lang.js"
    content = file_path.read_text(encoding="utf-8")

    def get_existing(prop_name):
        m = re.search(rf'{prop_name}:\s*\[(.*?)\]', content, re.DOTALL)
        if not m:
            return []
        return [w.strip(' \t\r\n"') for w in re.findall(r'["\']([^"\']+)["\']', m.group(1))]

    current_kw = get_existing("keywords")
    current_fn = get_existing("builtinFunctions")
    current_dt = get_existing("dataTypes")
    current_var = get_existing("builtinVariables")

    merged_kw = sorted(list(set(current_kw + NEW_KEYWORDS)), key=lambda s: s.upper())
    merged_fn = sorted(list(set(current_fn + NEW_BUILTIN_FUNCTIONS)), key=lambda s: s.upper())
    merged_dt = sorted(list(set(current_dt + NEW_DATATYPES)), key=lambda s: s.upper())
    merged_var = sorted(list(set(current_var + NEW_VARIABLES)), key=lambda s: s.upper())

    # Replace in content
    new_content = re.sub(
        r'keywords:\s*\[.*?\]',
        f'keywords: {format_js_array(merged_kw, indent="                ", items_per_line=10)}',
        content,
        flags=re.DOTALL
    )
    new_content = re.sub(
        r'builtinFunctions:\s*\[.*?\]',
        f'builtinFunctions: {format_js_array(merged_fn, indent="                ", items_per_line=10)}',
        new_content,
        flags=re.DOTALL
    )
    new_content = re.sub(
        r'builtinVariables:\s*\[.*?\]',
        f'builtinVariables: {format_js_array(merged_var, indent="                ", items_per_line=8)}',
        new_content,
        flags=re.DOTALL
    )
    new_content = re.sub(
        r'dataTypes:\s*\[.*?\]',
        f'dataTypes: {format_js_array(merged_dt, indent="                ", items_per_line=10)}',
        new_content,
        flags=re.DOTALL
    )

    file_path.write_text(new_content, encoding="utf-8")
    print(f"[monaco-sql-lang.js] Updated successfully:")
    print(f"  - keywords: {len(current_kw)} -> {len(merged_kw)} (+{len(merged_kw) - len(current_kw)})")
    print(f"  - builtinFunctions: {len(current_fn)} -> {len(merged_fn)} (+{len(merged_fn) - len(current_fn)})")
    print(f"  - dataTypes: {len(current_dt)} -> {len(merged_dt)} (+{len(merged_dt) - len(current_dt)})")
    print(f"  - builtinVariables: {len(current_var)} -> {len(merged_var)} (+{len(merged_var) - len(current_var)})")


def update_sql_dialects():
    file_path = ROOT_DIR / "static/js/sql-dialects.js"
    content = file_path.read_text(encoding="utf-8")

    # Add missing MSSQL keywords
    mssql_to_add = [
        "OUTPUT", "INSERTED", "DELETED", "NOWAIT", "READPAST", "UPDLOCK", "XLOCK",
        "ROWLOCK", "PAGLOCK", "TABLOCK", "TABLOCKX", "READCOMMITTED", "READUNCOMMITTED",
        "REPEATABLEREAD", "SNAPSHOT", "RECOMPILE", "MAXDOP", "FAST", "OPTIMIZE",
        "SYNONYM", "SEQUENCE", "RESTART", "PERIOD", "SYSTEM_TIME", "UNBOUNDED",
        "PRECEDING", "FOLLOWING", "RANGE", "ROWS", "ONLY", "PARTITION", "WITHIN"
    ]
    # Check what is currently in SqlServerDialect getKeywords
    m_ms = re.search(r'(class SqlServerDialect.*?getKeywords\(\)\s*\{\s*return\s*\[)(.*?)(\];)', content, re.DOTALL)
    if m_ms:
        existing_ms = [w.strip(' \t\r\n"') for w in re.findall(r'["\']([^"\']+)["\']', m_ms.group(2))]
        merged_ms = sorted(list(set(existing_ms + mssql_to_add)), key=lambda s: s.upper())
        formatted_ms = "[\n" + ",\n".join(["                " + ", ".join([f'"{x}"' for x in merged_ms[i:i+10]]) for i in range(0, len(merged_ms), 10)]) + "\n            ]"
        content = content[:m_ms.start(1)] + m_ms.group(1).split("[")[0] + formatted_ms + content[m_ms.end(2)+1:]

    # Check PostgreSqlDialect getKeywords
    pg_to_add = [
        "CALL", "REFRESH", "MATERIALIZED", "ROUTINE", "POLICY", "PUBLICATION", "SUBSCRIPTION",
        "NOWAIT", "LOCKED", "SKIP", "STORED", "SUPERUSER", "TYPE", "RULE", "UNLISTEN", "UNTIL",
        "VALID", "WRAPPER", "DISCARD", "RESET", "RESTART", "SEQUENCE", "WITHIN"
    ]
    m_pg = re.search(r'(class PostgreSqlDialect.*?getKeywords\(\)\s*\{\s*return\s*\[)(.*?)(\];)', content, re.DOTALL)
    if m_pg:
        existing_pg = [w.strip(' \t\r\n"') for w in re.findall(r'["\']([^"\']+)["\']', m_pg.group(2))]
        merged_pg = sorted(list(set(existing_pg + pg_to_add)), key=lambda s: s.upper())
        formatted_pg = "[\n" + ",\n".join(["                " + ", ".join([f'"{x}"' for x in merged_pg[i:i+10]]) for i in range(0, len(merged_pg), 10)]) + "\n            ]"
        content = content[:m_pg.start(1)] + m_pg.group(1).split("[")[0] + formatted_pg + content[m_pg.end(2)+1:]

    file_path.write_text(content, encoding="utf-8")
    print(f"[sql-dialects.js] Updated SqlServerDialect and PostgreSqlDialect keywords.")


def update_sql_formatter():
    file_path = ROOT_DIR / "static/js/sql-formatter.js"
    content = file_path.read_text(encoding="utf-8")

    # Add CALL, REFRESH, MATERIALIZED to DDL or CONTROL_FLOW
    if "'CALL'" not in content:
        content = content.replace(
            "'EXECUTE', 'EXEC',",
            "'EXECUTE', 'EXEC', 'CALL',"
        )
    if "'MATERIALIZED'" not in content:
        content = content.replace(
            "'PRIMARY KEY', 'FOREIGN KEY',",
            "'PRIMARY KEY', 'FOREIGN KEY', 'MATERIALIZED', 'REFRESH',"
        )
    if "'OUTPUT'" not in content:
        content = content.replace(
            "'LANGUAGE', 'PLPGSQL', 'EXCEPTION', 'PERFORM', 'RAISE', 'NOTICE'",
            "'LANGUAGE', 'PLPGSQL', 'EXCEPTION', 'PERFORM', 'RAISE', 'NOTICE', 'OUTPUT', 'INSERTED', 'DELETED', 'PIVOT', 'UNPIVOT'"
        )

    file_path.write_text(content, encoding="utf-8")
    print(f"[sql-formatter.js] Updated keywords (CALL, MATERIALIZED, REFRESH, OUTPUT, etc.).")


def update_sql_function_signatures():
    file_path = ROOT_DIR / "static/js/sql-function-signatures.js"
    content = file_path.read_text(encoding="utf-8")

    if "'CALL'" not in content:
        content = content.replace(
            "'EXEC', 'EXECUTE',",
            "'EXEC', 'EXECUTE', 'CALL',"
        )
    if "'OUTPUT'" not in content:
        content = content.replace(
            "'PERCENT', 'TIES',",
            "'PERCENT', 'TIES', 'OUTPUT', 'INSERTED', 'DELETED', 'REFRESH', 'MATERIALIZED',"
        )

    file_path.write_text(content, encoding="utf-8")
    print(f"[sql-function-signatures.js] Updated RESERVED_KEYWORDS with CALL, OUTPUT, etc.")


if __name__ == "__main__":
    print("=================================================================")
    print("CẬP NHẬT TỪ KHÓA, HÀM BUILT-IN & KIỂU DỮ LIỆU SQL SERVER & POSTGRESQL")
    print("=================================================================")
    update_monaco_sql_lang()
    update_sql_dialects()
    update_sql_formatter()
    update_sql_function_signatures()
    print("=================================================================")
