// static/js/monaco-sql-lang.js
// SQL Monarch Tokenizer and Language Configuration for Monaco Editor
// Supports T-SQL (SQL Server), PostgreSQL, and SQLite dialects.

(function (window) {
    "use strict";

    function registerSqlLanguage() {
        if (typeof monaco === "undefined") return;

        // Register sql language if not registered
        const languages = monaco.languages.getLanguages();
        if (!languages.some(l => l.id === "sql")) {
            monaco.languages.register({ id: "sql" });
        }

        // Language Configuration (Comments, Brackets, Auto-closing)
        monaco.languages.setLanguageConfiguration("sql", {
            comments: {
                lineComment: "--",
                blockComment: ["/*", "*/"]
            },
            brackets: [
                ["{", "}"],
                ["[", "]"],
                ["(", ")"]
            ],
            autoClosingPairs: [
                { open: "{", close: "}" },
                { open: "[", close: "]" },
                { open: "(", close: ")" },
                { open: '"', close: '"' },
                { open: "'", close: "'" }
            ],
            surroundingPairs: [
                { open: "{", close: "}" },
                { open: "[", close: "]" },
                { open: "(", close: ")" },
                { open: '"', close: '"' },
                { open: "'", close: "'" }
            ]
        });

        // Monarch Tokenizer Provider
        monaco.languages.setMonarchTokensProvider("sql", {
            defaultToken: "",
            tokenPostfix: ".sql",
            ignoreCase: true,
            brackets: [
                { open: "[", close: "]", token: "delimiter.square" },
                { open: "(", close: ")", token: "delimiter.parenthesis" },
                { open: "{", close: "}", token: "delimiter.curly" }
            ],
            keywords: [
                "ABORT", "ACTION", "ADD", "AFTER", "ALL", "ALTER", "ANALYSE", "ANALYZE", "AND", "ANY",
                "APPLY", "ARRAY", "AS", "ASC", "ASSERT", "ASYMMETRIC", "ATTACH", "AUTHORIZATION", "AUTOINCREMENT", "AUTO_INCREMENT",
                "BACKUP", "BEFORE", "BEGIN", "BETWEEN", "BOTH", "BREAK", "BROWSE", "BULK", "BY", "CALL",
                "CALLED", "CASCADE", "CASE", "CAST", "CATCH", "CHECK", "CHECKPOINT", "CLOSE", "CLUSTER", "CLUSTERED",
                "COLLATE", "COLUMN", "COMMENT", "COMMIT", "COMMITTED", "COMPUTE", "CONCURRENTLY", "CONFLICT", "CONSTANT", "CONSTRAINT",
                "CONSTRAINTS", "CONTAINS", "CONTAINSTABLE", "CONTINUE", "CONVERT", "COPY", "COST", "CREATE", "CROSS", "CURRENT",
                "CURRENT_CATALOG", "CURRENT_DATE", "CURRENT_ROLE", "CURRENT_SCHEMA", "CURRENT_TIME", "CURRENT_TIMESTAMP", "CURRENT_USER", "CURSOR", "DATABASE", "DBCC",
                "DEALLOCATE", "DEBUG", "DECLARE", "DEFAULT", "DEFERRABLE", "DEFINER", "DELETE", "DELETED", "DENY", "DESC",
                "DETACH", "DIAGNOSTICS", "DISABLE", "DISCARD", "DISK", "DISTINCT", "DISTRIBUTED", "DO", "DOUBLE", "DROP",
                "DUMP", "ELSE", "ELSEIF", "ELSIF", "ENABLE", "END", "ERRLVL", "ESCAPE", "EXCEPT", "EXCEPTION",
                "EXCLUDE", "EXEC", "EXECUTE", "EXISTS", "EXIT", "EXPLAIN", "EXTENSION", "EXTERNAL", "FAIL", "FALSE",
                "FAST", "FETCH", "FILE", "FILLFACTOR", "FILTER", "FOLLOWING", "FOR", "FOREACH", "FOREIGN", "FOUND",
                "FREETEXT", "FREETEXTTABLE", "FREEZE", "FROM", "FULL", "FUNCTION", "GENERATED", "GET", "GLOB", "GO",
                "GOTO", "GRANT", "GROUP", "HAVING", "HOLD", "HOLDLOCK", "IDENTITY", "IDENTITYCOL", "IDENTITY_INSERT", "IF",
                "IGNORE", "ILIKE", "IMMUTABLE", "IN", "INDEX", "INDEXED", "INFO", "INITIALLY", "INNER", "INSERT",
                "INSERTED", "INSTEAD", "INTERSECT", "INTO", "INVOKER", "IS", "ISNULL", "ISOLATION", "JOIN", "KEY",
                "KILL", "LANGUAGE", "LATERAL", "LEADING", "LEAKPROOF", "LEFT", "LEVEL", "LIKE", "LIMIT", "LINENO",
                "LISTEN", "LOAD", "LOCALTIME", "LOCALTIMESTAMP", "LOCK", "LOCKED", "LOOP", "MATCH", "MATERIALIZED", "MAXDOP",
                "MERGE", "MOVE", "NATIONAL", "NATURAL", "NOCHECK", "NOLOCK", "NONCLUSTERED", "NOT", "NOTHING", "NOTICE",
                "NOTIFY", "NOTNULL", "NOWAIT", "NULL", "NULLS", "OF", "OFF", "OFFSET", "OFFSETS", "ON",
                "ONLY", "OPEN", "OPENDATASOURCE", "OPENQUERY", "OPENROWSET", "OPENXML", "OPTIMIZE", "OPTION", "OR", "ORDER",
                "OUTER", "OUTPUT", "OVER", "OVERLAPS", "PAGLOCK", "PARALLEL", "PARTITION", "PERCENT", "PERFORM", "PERIOD",
                "PG_CONTEXT", "PIVOT", "PLACING", "PLAN", "PLPGSQL", "POLICY", "PRAGMA", "PRECEDING", "PRECISION", "PREPARE",
                "PRIMARY", "PRINT", "PROC", "PROCEDURE", "PUBLIC", "PUBLICATION", "RAISE", "RAISERROR", "RANGE", "READ",
                "READCOMMITTED", "READPAST", "READTEXT", "READUNCOMMITTED", "RECOMPILE", "RECONFIGURE", "RECORD", "RECURSIVE", "REFERENCES", "REFRESH",
                "REGEXP", "REINDEX", "RELEASE", "RENAME", "REPEATABLE", "REPEATABLEREAD", "REPLACE", "REPLICATION", "RESET", "RESTART",
                "RESTORE", "RESTRICT", "RETURN", "RETURNING", "RETURNS", "REVERT", "REVOKE", "RIGHT", "ROLLBACK", "ROLLUP",
                "ROUTINE", "ROW", "ROWCOUNT", "ROWGUIDCOL", "ROWLOCK", "ROWS", "ROW_COUNT", "RULE", "SAFE", "SAVE",
                "SAVEPOINT", "SCHEMA", "SECURITY", "SECURITYAUDIT", "SELECT", "SEMANTICKEYPHRASETABLE", "SEMANTICSIMILARITYDETAILSTABLE", "SEMANTICSIMILARITYTABLE", "SEQUENCE", "SERIALIZABLE",
                "SESSION_USER", "SET", "SETOF", "SETUSER", "SHARE", "SHOW", "SHUTDOWN", "SIMILAR", "SKIP", "SLICE",
                "SNAPSHOT", "SQLSTATE", "STABLE", "STACKED", "STATISTICS", "STORED", "STRICT", "SUBSCRIPTION", "SUPERUSER", "SYMMETRIC",
                "SYNONYM", "SYSTEM_TIME", "SYSTEM_USER", "TABLE", "TABLESAMPLE", "TABLESPACE", "TABLOCK", "TABLOCKX", "TEMP", "TEMPORARY",
                "TEXTSIZE", "THEN", "THROW", "TO", "TOP", "TRAILING", "TRAN", "TRANSACTION", "TRIGGER", "TRUE",
                "TRUNCATE", "TRUSTED", "TRY", "TSEQUAL", "TYPE", "UNBOUNDED", "UNION", "UNIQUE", "UNLISTEN", "UNLOGGED",
                "UNPIVOT", "UNTIL", "UPDATE", "UPDATETEXT", "UPDLOCK", "USE", "USER", "USING", "VACUUM", "VALID",
                "VALUES", "VARIADIC", "VARYING", "VERBOSE", "VIEW", "VOLATILE", "WAITFOR", "WARNING", "WHEN", "WHERE",
                "WHILE", "WINDOW", "WITH", "WITHIN", "WITHOUT", "WRAPPER", "WRITETEXT", "XLOCK"
        ],
            operators: [
                "ALL", "AND", "ANY", "BETWEEN", "EXISTS", "IN", "LIKE", "NOT", "OR", "SOME",
                "EXCEPT", "INTERSECT", "UNION", "APPLY", "CROSS", "FULL", "INNER", "JOIN",
                "LEFT", "OUTER", "RIGHT",
                "=", ">", "<", ">=", "<=", "<>", "!=", "!<", "!>",
                "+=", "-=", "*=", "/=", "%=", "&=", "^-=", "|*=",
                "+", "-", "*", "/", "%", "&", "|", "^", "~", "||"
            ],
            builtinFunctions: [
                "ABS", "ACOS", "AGE", "APP_NAME", "ARRAY_AGG", "ARRAY_TO_JSON", "ASCII", "ASIN", "ATAN", "ATN2",
                "AVG", "BOOL_AND", "BOOL_OR", "CAST", "CBRT", "CEIL", "CEILING", "CHAR", "CHARINDEX", "CHOOSE",
                "CLOCK_TIMESTAMP", "COALESCE", "COLUMNPROPERTY", "COL_LENGTH", "COL_NAME", "CONCAT", "CONCAT_WS", "CONVERT", "COS", "COT",
                "COUNT", "COUNT_BIG", "CUME_DIST", "DATABASEPROPERTYEX", "DATEADD", "DATEDIFF", "DATEDIFF_BIG", "DATEFROMPARTS", "DATENAME", "DATEPART",
                "DATETIME2FROMPARTS", "DATETIMEFROMPARTS", "DATETIMEOFFSETFROMPARTS", "DATE_TRUNC", "DAY", "DB_ID", "DB_NAME", "DEGREES", "DENSE_RANK", "DIFFERENCE",
                "DIV", "EOMONTH", "ERROR_LINE", "ERROR_MESSAGE", "ERROR_NUMBER", "ERROR_PROCEDURE", "ERROR_SEVERITY", "ERROR_STATE", "EVERY", "EXP",
                "EXTRACT", "FIRST_VALUE", "FLOOR", "FORMAT", "GEN_RANDOM_UUID", "GETDATE", "GETUTCDATE", "GREATEST", "HOST_ID", "HOST_NAME",
                "IDENT_CURRENT", "IDENT_INCR", "IDENT_SEED", "IIF", "INITCAP", "ISDATE", "ISNULL", "ISNUMERIC", "JSONB_INSERT", "JSONB_PRETTY",
                "JSONB_SET", "JSON_ARRAY_LENGTH", "JSON_BUILD_ARRAY", "JSON_BUILD_OBJECT", "JSON_EACH", "JSON_EACH_TEXT", "JSON_EXTRACT_PATH", "JSON_EXTRACT_PATH_TEXT", "JSON_OBJECT", "JSON_OBJECT_KEYS",
                "LAG", "LAST_VALUE", "LEAD", "LEAST", "LEFT", "LEN", "LENGTH", "LN", "LOG", "LOG10",
                "LOWER", "LPAD", "LTRIM", "MAKE_DATE", "MAKE_TIME", "MAKE_TIMESTAMP", "MAKE_TIMESTAMPTZ", "MAX", "MD5", "MIN",
                "MOD", "MONTH", "NCHAR", "NOW", "NTH_VALUE", "NTILE", "NULLIF", "NVL", "OBJECTPROPERTY", "OBJECTPROPERTYEX",
                "OBJECT_DEFINITION", "OBJECT_ID", "OBJECT_NAME", "OBJECT_SCHEMA_NAME", "ORIGINAL_LOGIN", "PARSE", "PARSENAME", "PATINDEX", "PERCENTILE_CONT", "PERCENTILE_DISC",
                "PERCENT_RANK", "PI", "POSITION", "POWER", "QUOTENAME", "RADIANS", "RAND", "RANDOM", "RANK", "REGEXP_MATCH",
                "REGEXP_MATCHES", "REGEXP_REPLACE", "REGEXP_SPLIT_TO_ARRAY", "REGEXP_SPLIT_TO_TABLE", "REPLACE", "REPLICATE", "REVERSE", "RIGHT", "ROUND", "ROW_NUMBER",
                "ROW_TO_JSON", "RPAD", "RTRIM", "SCHEMA_ID", "SCHEMA_NAME", "SCOPE_IDENTITY", "SERVERPROPERTY", "SESSIONPROPERTY", "SETSEED", "SIGN",
                "SIN", "SMALLDATETIMEFROMPARTS", "SOUNDEX", "SPACE", "SPLIT_PART", "SQRT", "SQUARE", "STATS_DATE", "STDEV", "STDEVP",
                "STR", "STRING_AGG", "STRING_ESCAPE", "STRING_SPLIT", "STRPOS", "STUFF", "SUBSTR", "SUBSTRING", "SUM", "SUSER_ID",
                "SUSER_SNAME", "SWITCHOFFSET", "SYSDATETIME", "SYSDATETIMEOFFSET", "SYSUTCDATETIME", "TAN", "TIMEFROMPARTS", "TIMEOFDAY", "TODATETIMEOFFSET", "TO_CHAR",
                "TO_DATE", "TO_JSON", "TO_JSONB", "TO_NUMBER", "TO_TIMESTAMP", "TRANSLATE", "TRIM", "TRUNC", "TRY_CAST", "TRY_CONVERT",
                "TRY_PARSE", "TYPE_ID", "TYPE_NAME", "UNICODE", "UPPER", "USER_ID", "USER_NAME", "UUID_GENERATE_V4", "VAR", "VARP",
                "XACT_STATE", "YEAR"
        ],
            builtinVariables: [
                "@@CPU_BUSY", "@@CURSOR_ROWS", "@@DBTS", "@@ERROR", "@@FETCH_STATUS", "@@IDENTITY", "@@IDLE", "@@IO_BUSY",
                "@@LANGID", "@@LANGUAGE", "@@LOCK_TIMEOUT", "@@MAX_CONNECTIONS", "@@MAX_PRECISION", "@@NESTLEVEL", "@@OPTIONS", "@@PACKET_ERRORS",
                "@@PACK_RECEIVED", "@@PACK_SENT", "@@PROCID", "@@REMSERVER", "@@ROWCOUNT", "@@SERVERNAME", "@@SERVICENAME", "@@SPID",
                "@@TEXTSIZE", "@@TIMETICKS", "@@TOTAL_ERRORS", "@@TOTAL_READ", "@@TOTAL_WRITE", "@@TRANCOUNT", "@@VERSION"
        ],
            dataTypes: [
                "BIGINT", "BIGSERIAL", "BINARY", "BIT", "BOOL", "BOOLEAN", "BOX", "BYTEA", "CHAR", "CIDR",
                "CIRCLE", "DATE", "DATETIME", "DATETIME2", "DATETIMEOFFSET", "DECIMAL", "FLOAT", "FLOAT4", "FLOAT8", "GEOGRAPHY",
                "GEOMETRY", "HIERARCHYID", "IMAGE", "INET", "INT", "INT2", "INT4", "INT8", "INTEGER", "INTERVAL",
                "JSON", "JSONB", "JSONPATH", "LINE", "LSEG", "MACADDR", "MACADDR8", "MONEY", "NCHAR", "NTEXT",
                "NUMERIC", "NVARCHAR", "PATH", "PG_LSN", "POINT", "POLYGON", "REAL", "ROWVERSION", "SERIAL", "SMALLDATETIME",
                "SMALLINT", "SMALLMONEY", "SMALLSERIAL", "TEXT", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "TIMETZ", "TINYINT", "TSQUERY",
                "TSVECTOR", "UNIQUEIDENTIFIER", "UUID", "VARBINARY", "VARCHAR", "XML"
        ],
            tokenizer: {
                root: [
                    { include: "@comments" },
                    { include: "@whitespace" },
                    { include: "@numbers" },
                    { include: "@strings" },
                    { include: "@complexIdentifiers" },
                    [/\{\{[a-zA-Z0-9_]+\}\}/, "variable.parameter"],
                    [/[;,.]/, "delimiter"],
                    [/[()]/, "@brackets"],
                    [/@@[a-zA-Z_]\w*/, "variable.predefined"],
                    [/@[a-zA-Z_]\w*/, "variable"],
                    [/#[a-zA-Z_]\w*/, "type.identifier"],
                    [/[a-zA-Z_]\w*/, {
                        cases: {
                            "@keywords": "keyword",
                            "@dataTypes": "type",
                            "@builtinFunctions": "predefined",
                            "@operators": "operator",
                            "@default": "identifier"
                        }
                    }],
                    [/[<>=!%&+\-*/|~^]/, "operator"]
                ],
                whitespace: [
                    [/\s+/, "white"]
                ],
                comments: [
                    [/--.*$/, "comment"],
                    [/\/\*/, { token: "comment.quote", next: "@comment" }]
                ],
                comment: [
                    [/[^*/]+/, "comment"],
                    [/\*\//, { token: "comment.quote", next: "@pop" }],
                    [/./, "comment"]
                ],
                numbers: [
                    [/0[xX][0-9a-fA-F]+/, "number.hex"],
                    [/\d+(\.\d+)?([eE][\-+]?\d+)?/, "number"]
                ],
                strings: [
                    [/N'/, { token: "string", next: "@string" }],
                    [/'/, { token: "string", next: "@string" }]
                ],
                string: [
                    [/[^']+/, "string"],
                    [/''/, "string.escape"],
                    [/'/, { token: "string", next: "@pop" }]
                ],
                complexIdentifiers: [
                    [/\[/, { token: "identifier.quote", next: "@bracketedIdentifier" }],
                    [/"/, { token: "identifier.quote", next: "@quotedIdentifier" }]
                ],
                bracketedIdentifier: [
                    [/[^\]]+/, "identifier"],
                    [/\]\]/, "identifier"],
                    [/\]/, { token: "identifier.quote", next: "@pop" }]
                ],
                quotedIdentifier: [
                    [/[^"]+/, "identifier"],
                    [/""/, "identifier"],
                    [/"/, { token: "identifier.quote", next: "@pop" }]
                ]
            }
        });

        // Phase 6: Register Signature Help Provider if available
        if (window.SqlSignatureHelpResolver && typeof window.SqlSignatureHelpResolver.registerMonacoProvider === 'function') {
            window.SqlSignatureHelpResolver.registerMonacoProvider();
        }

        // Phase 7: Register Hover Provider if available
        if (window.SqlHoverResolver && typeof window.SqlHoverResolver.registerMonacoProvider === 'function') {
            window.SqlHoverResolver.registerMonacoProvider();
        }
    }

    // Expose registration hook
    window.MonacoSqlLanguage = {
        register: registerSqlLanguage
    };

    // Auto-register when monaco is ready
    if (typeof window._onMonacoReady === "function") {
        window._onMonacoReady(function () {
            registerSqlLanguage();
        });
    } else if (typeof monaco !== "undefined") {
        registerSqlLanguage();
    }
})(window);
