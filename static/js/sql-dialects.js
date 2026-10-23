/**
 * sql-dialects.js - SQL Dialect Abstraction Layer (Phase 7)
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements Section 43, 44, 45, 46 & 69 of intellisense_improvement_plan_v2.md
 *
 * Core engine does not hard-code SQL Server or PostgreSQL specifics.
 * Encapsulates:
 * - Identifier Quoting & Unquoting ([name] vs "name")
 * - Case-folding & Normalization (PostgreSQL unquoted -> lowercase)
 * - Dialect-specific Keywords, Functions, and Data Types
 * - Temp Object Rules (#temp, @var for SQL Server)
 * - DDL Script Alter Header Templates (CREATE OR ALTER vs CREATE OR REPLACE)
 * - Batch Separators (GO vs ;)
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function(window) {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────────
    // KEYWORD & FUNCTION POPULARITY WEIGHTS (Spec Section 5 GĐ4 / RC3)
    // Range: 0 to 12. Boosts essential, high-frequency SQL constructs.
    // ─────────────────────────────────────────────────────────────────────────────
    const COMMON_KEYWORD_POPULARITY = {
        'SELECT': 12, 'WHERE': 12, 'FROM': 12, 'ON': 12,
        'CASE': 11, 'AND': 11, 'OR': 11,
        'JOIN': 10, 'INNER': 10, 'LEFT': 10, 'INSERT': 10, 'UPDATE': 10, 'DELETE': 10, 'VALUES': 10, 'INTO': 10,
        'ORDER': 10, 'BY': 10, 'GROUP': 10, 'AS': 10, 'SET': 10, 'WITH': 9, 'DECLARE': 9,
        'DISTINCT': 10, 'IN': 10, 'IS': 10, 'NOT': 10, 'NULL': 10, 'EXISTS': 10,
        'WHEN': 10, 'THEN': 10,
        'HAVING': 9, 'UNION': 9, 'ALL': 9, 'ELSE': 9, 'END': 9,
        'DEFAULT': 9, 'LIKE': 9, 'BETWEEN': 9, 'ASC': 9, 'DESC': 9, 'CAST': 9, 'CONVERT': 9,
        'EXEC': 9, 'EXECUTE': 9, 'BEGIN': 9, 'TOP': 9, 'LIMIT': 9,
        'CREATE': 8, 'ALTER': 8, 'DROP': 8, 'TABLE': 8, 'VIEW': 7, 'INDEX': 7,
        'PROCEDURE': 7, 'PROC': 7, 'FUNCTION': 7, 'TRIGGER': 7,
        'TRY': 8, 'CATCH': 8, 'THROW': 8, 'NOLOCK': 9, 'IF': 8, 'OVER': 8, 'PARTITION': 8,
        'CROSS': 8, 'RIGHT': 8, 'FULL': 8, 'OUTER': 8, 'OFFSET': 8, 'PRIMARY': 8, 'KEY': 8,
        'FOREIGN': 8, 'REFERENCES': 8, 'CONSTRAINT': 7, 'IDENTITY': 7, 'CHECK': 7,
        'TRUNCATE': 7, 'MERGE': 7, 'RETURN': 7, 'PRINT': 6
    };

    const COMMON_FUNCTION_POPULARITY = {
        'COUNT': 12,
        'GETDATE': 11, 'NOW': 11,
        'SUM': 10, 'AVG': 10, 'ISNULL': 10, 'COALESCE': 10, 'ROW_NUMBER': 10,
        'DATEADD': 10, 'DATEDIFF': 10, 'TO_CHAR': 10, 'ERROR_MESSAGE': 10, 'ERROR_NUMBER': 10, 'SCOPE_IDENTITY': 10,
        'MIN': 9, 'MAX': 9, 'CAST': 9, 'CONVERT': 9, 'SUBSTRING': 9, 'LEN': 9, 'LENGTH': 9,
        'CONCAT': 9, 'DATEPART': 9, 'DENSE_RANK': 9, 'RANK': 9, 'LEAD': 9, 'LAG': 9,
        'IIF': 9, 'STRING_AGG': 9, 'TO_DATE': 9, 'TO_TIMESTAMP': 9,
        'TRIM': 8, 'LTRIM': 8, 'RTRIM': 8, 'LOWER': 8, 'UPPER': 8, 'REPLACE': 8, 'CHARINDEX': 8,
        'POSITION': 8, 'CONCAT_WS': 8, 'NULLIF': 8, 'YEAR': 8, 'MONTH': 8, 'DAY': 8, 'DATENAME': 8,
        'EOMONTH': 8, 'FORMAT': 8, 'ROUND': 8, 'FLOOR': 7, 'CEILING': 7, 'ABS': 7, 'STUFF': 7, 'CHOOSE': 7
    };

    const MSSQL_KEYWORD_POPULARITY = {
        ...COMMON_KEYWORD_POPULARITY,
        'TOP': 10,
        'NOLOCK': 10,
        'TRY_CAST': 9,
        'TRY_CONVERT': 8
    };

    const MSSQL_FUNCTION_POPULARITY = {
        ...COMMON_FUNCTION_POPULARITY,
        'GETDATE': 12,
        'ISNULL': 11,
        'SCOPE_IDENTITY': 10,
        'GETUTCDATE': 9
    };

    const PG_KEYWORD_POPULARITY = {
        ...COMMON_KEYWORD_POPULARITY,
        'ILIKE': 11,
        'RETURNING': 10,
        'LIMIT': 10,
        'OFFSET': 9,
        'CONFLICT': 9,
        'DO': 8,
        'PERFORM': 8,
        'RAISE': 8
    };

    const PG_FUNCTION_POPULARITY = {
        ...COMMON_FUNCTION_POPULARITY,
        'NOW': 12,
        'TO_CHAR': 11,
        'TO_DATE': 10,
        'TO_TIMESTAMP': 10,
        'LENGTH': 9,
        'GREATEST': 8,
        'LEAST': 8
    };

    /**
     * Base SqlDialect Contract (Section 43)
     */
    class SqlDialect {
        constructor(name, defaultSchema = 'dbo') {
            this.name = name;
            this.defaultSchema = defaultSchema;
        }

        /**
         * Quote an identifier according to dialect rules
         */
        quoteIdentifier(ident) {
            return String(ident || '');
        }

        /**
         * Strip quotes from an identifier
         */
        unquoteIdentifier(ident) {
            return String(ident || '');
        }

        /**
         * Normalize an identifier (e.g. Postgres unquoted -> lowercase)
         */
        normalizeIdentifier(ident) {
            return String(ident || '');
        }

        /**
         * Check if an identifier is quoted
         */
        isQuotedIdentifier(ident) {
            return false;
        }

        /**
         * Check if identifier represents a temporary table or variable
         */
        isTempObject(ident) {
            return false;
        }

        /**
         * Get list of dialect-specific keywords
         */
        getKeywords() {
            return [];
        }

        /**
         * Get expected keywords for a specific syntax position (GĐ3 & GĐ4)
         */
        getExpectedKeywords(position, context = null) {
            switch (position) {
                case 'select_clause':
                    return ['DISTINCT', 'CASE', 'CAST', 'NULL'];
                case 'value_expression':
                    return ['SELECT', 'NULL', 'DEFAULT', 'CASE', 'CAST'];
                default:
                    if (!position && context && context.clause === 'SELECT') {
                        return ['DISTINCT', 'CASE', 'CAST', 'NULL'];
                    }
                    return [];
            }
        }

        /**
         * Get popularity weight (0-12) for a keyword or function (Spec GĐ4)
         */
        getKeywordPopularity(keyword) {
            if (!keyword) return 0;
            return COMMON_KEYWORD_POPULARITY[keyword.toUpperCase()] || 0;
        }

        getFunctionPopularity(functionName) {
            if (!functionName) return 0;
            return COMMON_FUNCTION_POPULARITY[functionName.toUpperCase()] || 0;
        }

        getPopularity(name, type) {
            if (!name) return 0;
            if (type === 'keyword' || type === 'syntax_operator') {
                return this.getKeywordPopularity(name);
            }
            if (type === 'sql_function' || type === 'function') {
                return this.getFunctionPopularity(name);
            }
            return 0;
        }

        /**
         * Get list of dialect-specific built-in functions
         */
        getFunctions() {
            return [];
        }

        /**
         * Get list of dialect-specific supported data types
         */
        getDataTypes() {
            return [];
        }

        /**
         * Get batch separator tokens
         */
        getBatchSeparators() {
            return [';'];
        }

        /**
         * Generate DDL header for modifying an existing routine or view
         */
        getAlterHeaderTemplate(objectType, objectName, schema = null) {
            const targetSchema = schema || this.defaultSchema;
            const quotedSchema = this.quoteIdentifier(targetSchema);
            const quotedName = this.quoteIdentifier(objectName);
            const cleanType = String(objectType || 'VIEW').toUpperCase();
            return `ALTER ${cleanType} ${quotedSchema}.${quotedName}`;
        }

        /**
         * Parameter style: 'named' (@param) or 'positional' ($1)
         */
        getParameterStyle() {
            return 'named';
        }

        /**
         * Check if token is a dialect-specific query parameter
         */
        isParameter(tokenValue) {
            return false;
        }

        /**
         * Check if token is a system variable (e.g. @@ROWCOUNT)
         */
        isSystemVariable(tokenValue) {
            return false;
        }

        /**
         * Check if token is a dollar-quote tag ($$ or $tag$)
         */
        isDollarQuote(tokenValue) {
            return false;
        }

        /**
         * List of format placeholders supported by format()
         */
        getFormatPlaceholders() {
            return [];
        }

        /**
         * Check if string is a valid format placeholder
         */
        isFormatPlaceholder(placeholder) {
            return false;
        }
    }

    /**
     * SQL Server Dialect (Section 44)
     * Handles [bracket] quoting, #temp tables, @table variables, GO, CREATE OR ALTER
     */
    class SqlServerDialect extends SqlDialect {
        constructor() {
            super('sqlserver', 'dbo');
        }

        quoteIdentifier(ident) {
            if (!ident) return '';
            const s = String(ident).trim();
            if (s.startsWith('[') && s.endsWith(']')) return s;
            // Clean inner quotes
            const clean = s.replace(/^[\["]+|[\]"]+$/g, '');
            return `[${clean}]`;
        }

        unquoteIdentifier(ident) {
            if (!ident) return '';
            const s = String(ident).trim();
            if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1);
            if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
            return s;
        }

        normalizeIdentifier(ident) {
            if (!ident) return '';
            return this.unquoteIdentifier(ident);
        }

        isQuotedIdentifier(ident) {
            if (!ident) return false;
            const s = String(ident).trim();
            return (s.startsWith('[') && s.endsWith(']')) || (s.startsWith('"') && s.endsWith('"'));
        }

        isTempObject(ident) {
            if (!ident) return false;
            const clean = this.unquoteIdentifier(ident);
            return clean.startsWith('#') || clean.startsWith('@');
        }

        getBatchSeparators() {
            return ['GO', ';'];
        }

        getKeywords() {
            return [
                "ADD", "ALL", "ALTER", "AND", "ANY", "AS", "ASC", "AUTHORIZATION", "BACKUP",
                "BEGIN", "BETWEEN", "BREAK", "BROWSE", "BULK", "BY", "CASCADE", "CASE",
                "CHECK", "CHECKPOINT", "CLOSE", "CLUSTERED", "COALESCE", "COLLATE", "COLUMN",
                "COMMIT", "COMPUTE", "CONSTRAINT", "CONTAINS", "CONTAINSTABLE", "CONTINUE",
                "CONVERT", "CREATE", "CROSS", "CURRENT", "CURRENT_DATE", "CURRENT_TIME",
                "CURRENT_TIMESTAMP", "CURRENT_USER", "CURSOR", "DATABASE", "DBCC", "DEALLOCATE",
                "DECLARE", "DEFAULT", "DELETE", "DENY", "DESC", "DISK", "DISTINCT", "DISTRIBUTED",
                "DOUBLE", "DROP", "DUMP", "ELSE", "END", "ERRLVL", "ESCAPE", "EXCEPT", "EXEC",
                "EXECUTE", "EXISTS", "EXIT", "EXTERNAL", "FETCH", "FILE", "FILLFACTOR", "FOR",
                "FOREIGN", "FREETEXT", "FREETEXTTABLE", "FROM", "FULL", "FUNCTION", "GOTO",
                "GRANT", "GROUP", "HAVING", "HOLDLOCK", "IDENTITY", "IDENTITY_INSERT",
                "IDENTITYCOL", "IF", "IN", "INDEX", "INNER", "INSERT", "INTERSECT", "INTO",
                "IS", "JOIN", "KEY", "KILL", "LEFT", "LIKE", "LINENO", "LOAD", "MERGE",
                "NATIONAL", "NOCHECK", "NONCLUSTERED", "NOT", "NULL", "NULLIF", "OF", "OFF",
                "OFFSETS", "ON", "OPEN", "OPENDATASOURCE", "OPENQUERY", "OPENROWSET", "OPENXML",
                "OPTION", "OR", "ORDER", "OUTER", "OVER", "PERCENT", "PIVOT", "PLAN", "PRECISION",
                "PRIMARY", "PRINT", "PROC", "PROCEDURE", "PUBLIC", "RAISERROR", "READ", "READTEXT",
                "RECONFIGURE", "REFERENCES", "REPLICATION", "RESTORE", "RESTRICT", "RETURN",
                "REVERT", "REVOKE", "RIGHT", "ROLLBACK", "ROWCOUNT", "ROWGUIDCOL", "RULE",
                "SAVE", "SCHEMA", "SECURITYAUDIT", "SELECT", "SEMANTICKEYPHRASETABLE",
                "SEMANTICSIMILARITYDETAILSTABLE", "SEMANTICSIMILARITYTABLE", "SESSION_USER",
                "SET", "SETUSER", "SHUTDOWN", "SOME", "STATISTICS", "SYSTEM_USER", "TABLE",
                "TABLESAMPLE", "TEXTSIZE", "THEN", "THROW", "TO", "TOP", "TRAN", "TRANSACTION",
                "TRIGGER", "TRUNCATE", "TRY", "CATCH", "TRYCONNECT", "TRY_CONVERT", "TSEQUAL", "UNION", "UNIQUE",
                "UNPIVOT", "UPDATE", "UPDATETEXT", "USE", "USER", "VALUES", "VARYING", "VIEW",
                "WAITFOR", "WHEN", "WHERE", "WHILE", "WITH", "WITHIN GROUP", "WRITETEXT",
                "APPLY", "CROSS APPLY", "OUTER APPLY", "NOLOCK",
                "OUTPUT", "INSERTED", "DELETED", "NOWAIT", "READPAST", "UPDLOCK", "XLOCK",
                "ROWLOCK", "PAGLOCK", "TABLOCK", "TABLOCKX", "READCOMMITTED", "READUNCOMMITTED",
                "REPEATABLEREAD", "SNAPSHOT", "RECOMPILE", "MAXDOP", "FAST", "OPTIMIZE",
                "SYNONYM", "SEQUENCE", "RESTART", "PERIOD", "SYSTEM_TIME", "UNBOUNDED",
                "PRECEDING", "FOLLOWING", "RANGE", "ROWS", "ONLY", "PARTITION", "WITHIN"
            ];
        }

        getExpectedKeywords(position, context = null) {
            switch (position) {
                case 'statement_start':
                    return [
                        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'DECLARE', 'SET',
                        'EXEC', 'EXECUTE', 'IF', 'BEGIN', 'CREATE', 'ALTER', 'DROP',
                        'TRUNCATE', 'MERGE', 'PRINT', 'RETURN', 'THROW', 'USE'
                    ];
                case 'after_source': {
                    const list = [
                        'WHERE', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN',
                        'CROSS JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER',
                        'ON', 'GROUP BY', 'ORDER BY', 'GROUP', 'ORDER', 'HAVING',
                        'UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT', 'WITH', 'AS',
                        'APPLY', 'CROSS APPLY', 'OUTER APPLY'
                    ];
                    if (context && context.clause === 'JOIN') {
                        return ['ON', ...list.filter(k => k !== 'ON')];
                    }
                    return list;
                }
                case 'after_operand':
                    return [
                        '=', '<>', '!=', '>', '<', '>=', '<=',
                        'AND', 'OR', 'NOT', 'IN', 'IS', 'LIKE', 'BETWEEN', 'EXISTS', 'ESCAPE'
                    ];
                case 'is_predicate':
                    return ['NULL', 'NOT', 'NOT NULL'];
                case 'order_direction':
                    return ['ASC', 'DESC', ','];
                case 'table_hint':
                    return [
                        'NOLOCK', 'READUNCOMMITTED', 'UPDLOCK', 'ROWLOCK', 'HOLDLOCK',
                        'TABLOCK', 'TABLOCKX', 'PAGLOCK', 'READPAST', 'INDEX', 'FORCESEEK', 'NOWAIT'
                    ];
                case 'on_conflict':
                    return [];
                case 'select_clause':
                    return ['DISTINCT', 'TOP', 'CASE', 'CAST', 'TRY_CAST', 'CONVERT', 'NULL'];
                case 'value_expression':
                    return ['SELECT', 'NULL', 'DEFAULT', 'CASE', 'CAST', 'TRY_CAST', 'CONVERT'];
                default:
                    if (!position && context && context.clause === 'SELECT') {
                        return ['DISTINCT', 'TOP', 'CASE', 'CAST', 'TRY_CAST', 'CONVERT', 'NULL'];
                    }
                    return [];
            }
        }

        getKeywordPopularity(keyword) {
            if (!keyword) return 0;
            const kw = keyword.toUpperCase();
            if (MSSQL_KEYWORD_POPULARITY[kw] !== undefined) return MSSQL_KEYWORD_POPULARITY[kw];
            return super.getKeywordPopularity(keyword);
        }

        getFunctionPopularity(functionName) {
            if (!functionName) return 0;
            const fn = functionName.toUpperCase();
            if (MSSQL_FUNCTION_POPULARITY[fn] !== undefined) return MSSQL_FUNCTION_POPULARITY[fn];
            return super.getFunctionPopularity(functionName);
        }

        getFunctions() {
            return [
                "ABS", "ACOS", "ASIN", "ATAN", "ATN2", "CEILING", "COS", "COT", "DEGREES",
                "EXP", "FLOOR", "LOG", "LOG10", "PI", "POWER", "RADIANS", "RAND", "ROUND",
                "SIGN", "SIN", "SQRT", "SQUARE", "TAN",
                "ASCII", "CHAR", "CHARINDEX", "CONCAT", "CONCAT_WS", "DIFFERENCE", "FORMAT",
                "LEFT", "LEN", "LOWER", "LTRIM", "NCHAR", "PATINDEX", "QUOTENAME", "REPLACE",
                "REPLICATE", "REVERSE", "RIGHT", "RTRIM", "SOUNDEX", "SPACE", "STR", "STRING_AGG",
                "STRING_ESCAPE", "STRING_SPLIT", "STUFF", "SUBSTRING", "TRANSLATE", "TRIM",
                "UNICODE", "UPPER",
                "CURRENT_TIMESTAMP", "DATEADD", "DATEDIFF", "DATEDIFF_BIG", "DATEFROMPARTS",
                "DATENAME", "DATEPART", "DATETIME2FROMPARTS", "DATETIMEFROMPARTS", "DATETIMEOFFSETFROMPARTS",
                "DAY", "EOMONTH", "GETDATE", "GETUTCDATE", "ISDATE", "MONTH", "SMALLDATETIMEFROMPARTS",
                "SWITCHOFFSET", "SYSDATETIME", "SYSDATETIMEOFFSET", "SYSUTCDATETIME", "TIMEFROMPARTS",
                "TODATETIMEOFFSET", "YEAR",
                "CAST", "CONVERT", "PARSE", "TRY_CAST", "TRY_CONVERT", "TRY_PARSE",
                "CHOOSE", "IIF",
                "COALESCE", "ISNULL", "NULLIF",
                "AVG", "COUNT", "COUNT_BIG", "MAX", "MIN", "SUM", "STDEV", "STDEVP", "VAR", "VARP",
                "CUME_DIST", "DENSE_RANK", "FIRST_VALUE", "LAG", "LAST_VALUE", "LEAD", "NTILE",
                "PERCENT_RANK", "PERCENTILE_CONT", "PERCENTILE_DISC", "RANK", "ROW_NUMBER",
                "APP_NAME", "COL_LENGTH", "COL_NAME", "COLUMNPROPERTY", "DATABASEPROPERTYEX",
                "DB_ID", "DB_NAME", "HOST_ID", "HOST_NAME", "IDENT_CURRENT", "IDENT_INCR",
                "IDENT_SEED", "ISNUMERIC", "OBJECT_DEFINITION", "OBJECT_ID", "OBJECT_NAME",
                "OBJECT_SCHEMA_NAME", "OBJECTPROPERTY", "OBJECTPROPERTYEX", "ORIGINAL_LOGIN",
                "PARSENAME", "SCHEMA_ID", "SCHEMA_NAME", "SCOPE_IDENTITY", "SERVERPROPERTY",
                "SUSER_ID", "SUSER_NAME", "SUSER_SID", "SUSER_SNAME", "USER_ID", "USER_NAME",
                "NEWID", "NEWSEQUENTIALID",
                "ERROR_LINE", "ERROR_MESSAGE", "ERROR_NUMBER", "ERROR_PROCEDURE", "ERROR_SEVERITY", "ERROR_STATE", "XACT_STATE"
            ];
        }

        getDataTypes() {
            return [
                "BIGINT", "BINARY", "BIT", "CHAR", "DATE", "DATETIME", "DATETIME2",
                "DATETIMEOFFSET", "DECIMAL", "FLOAT", "GEOGRAPHY", "GEOMETRY", "HIERARCHYID",
                "IMAGE", "INT", "INTEGER", "MONEY", "NCHAR", "NTEXT", "NUMERIC", "NVARCHAR",
                "REAL", "ROWVERSION", "SMALLDATETIME", "SMALLINT", "SMALLMONEY", "SQL_VARIANT",
                "SYSNAME", "TEXT", "TIME", "TIMESTAMP", "TINYINT", "UNIQUEIDENTIFIER",
                "VARBINARY", "VARCHAR", "XML"
            ];
        }

        getAlterHeaderTemplate(objectType, objectName, schema = null) {
            const targetSchema = schema || this.defaultSchema;
            const quotedSchema = this.quoteIdentifier(targetSchema);
            const quotedName = this.quoteIdentifier(objectName);
            const cleanType = String(objectType || 'VIEW').toUpperCase();
            // SQL Server 2016+ standard: CREATE OR ALTER
            return `CREATE OR ALTER ${cleanType} ${quotedSchema}.${quotedName}`;
        }

        getParameterStyle() {
            return 'named';
        }

        isParameter(tokenValue) {
            if (!tokenValue || typeof tokenValue !== 'string') return false;
            return /^@[a-zA-Z_][a-zA-Z0-9_]*$/.test(tokenValue);
        }

        isSystemVariable(tokenValue) {
            if (!tokenValue || typeof tokenValue !== 'string') return false;
            return /^@@[a-zA-Z_][a-zA-Z0-9_]*$/.test(tokenValue);
        }

        isDollarQuote(tokenValue) {
            return false;
        }

        getFormatPlaceholders() {
            return [];
        }

        isFormatPlaceholder(placeholder) {
            return false;
        }
    }

    /**
     * PostgreSQL Dialect (Section 45)
     * Handles "double-quote" identifiers, lowercase unquoted folding, public default schema, CREATE OR REPLACE
     */
    class PostgresDialect extends SqlDialect {
        constructor() {
            super('postgresql', 'public');
        }

        quoteIdentifier(ident) {
            if (!ident) return '';
            const s = String(ident).trim();
            if (s.startsWith('"') && s.endsWith('"')) return s;
            const clean = s.replace(/^[\["]+|[\]"]+$/g, '');
            return `"${clean}"`;
        }

        unquoteIdentifier(ident) {
            if (!ident) return '';
            const s = String(ident).trim();
            if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
            if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1);
            return s;
        }

        /**
         * PostgreSQL semantics: unquoted identifiers fold to lower-case.
         * Quoted identifiers ("MyTable") maintain exact case.
         */
        normalizeIdentifier(ident) {
            if (!ident) return '';
            const s = String(ident).trim();
            if (s.startsWith('"') && s.endsWith('"')) {
                return s.slice(1, -1);
            }
            return s.toLowerCase();
        }

        isQuotedIdentifier(ident) {
            if (!ident) return false;
            const s = String(ident).trim();
            return s.startsWith('"') && s.endsWith('"');
        }

        isTempObject(ident) {
            // PostgreSQL does not use # or @ prefixes
            return false;
        }

        getBatchSeparators() {
            return [';'];
        }

        getKeywords() {
            return [
                "ALL", "ANALYSE", "ANALYZE", "AND", "ANY", "ARRAY", "AS", "ASC", "ASSERT", "ASYMMETRIC",
                "ATTACH", "AUTHORIZATION", "BEGIN", "BETWEEN", "BIGSERIAL", "BINARY", "BIT", "BOOLEAN", "BOTH",
                "CALL", "CALLED", "CASCADE", "CASE", "CAST", "CHECK", "CLOSE", "COLLATE", "COLLATION", "COLUMN",
                "COMMIT", "CONCURRENTLY", "CONFLICT", "CONSTANT", "CONSTRAINT", "CONTINUE", "COST", "CREATE", "CROSS",
                "CURRENT_CATALOG", "CURRENT_DATE", "CURRENT_ROLE", "CURRENT_SCHEMA", "CURRENT_TIME",
                "CURRENT_TIMESTAMP", "CURRENT_USER", "CURSOR", "DATABASE", "DEBUG", "DECLARE", "DEFAULT", "DEFERRABLE",
                "DEFINER", "DELETE", "DESC", "DETACH", "DIAGNOSTICS", "DISTINCT", "DISTINCT ON", "DO", "DO NOTHING",
                "DO UPDATE", "DROP", "ELSE", "ELSEIF", "ELSIF", "END", "ESCAPE", "EXCEPT", "EXCEPTION", "EXCLUDE",
                "EXECUTE", "EXIT", "EXPLAIN", "EXTENSION", "FALSE", "FETCH", "FOR", "FOREACH", "FOREIGN", "FOUND",
                "FREEZE", "FROM", "FULL", "FUNCTION", "GENERATED", "GET", "GRANT", "GROUP", "HAVING", "IDENTITY",
                "IF", "ILIKE", "IMMUTABLE", "IN", "INDEX", "INFO", "INITIALLY", "INNER", "INSERT", "INTERSECT",
                "INTO", "INVOKER", "IS", "ISNULL", "JOIN", "LANGUAGE", "LATERAL", "LEADING", "LEAKPROOF", "LEFT",
                "LIKE", "LIMIT", "LOCALTIME", "LOCALTIMESTAMP", "LOCK", "LOOP", "MOVE", "NATURAL", "NOT", "NOTICE",
                "NOTNULL", "NULL", "OFFSET", "ON", "ON CONFLICT", "ONLY", "OPEN", "OR", "ORDER", "OUTER", "OVER",
                "OVERLAPS", "PARALLEL", "PARTITION", "PARTITION BY", "PERFORM", "PLACING", "PLPGSQL", "PRIMARY",
                "PROCEDURE", "RAISE", "RECORD", "RECURSIVE", "REFERENCES", "RENAME", "RESTRICT", "RETURN", "RETURNING",
                "RETURNS", "REVOKE", "RIGHT", "ROLLBACK", "ROW", "ROW_COUNT", "ROWS", "SCHEMA", "SECURITY", "SELECT",
                "SETOF", "SERIAL", "SESSION_USER", "SET", "SHARE", "SHOW", "SIMILAR", "SIMILAR TO", "SOME", "SQLSTATE",
                "STABLE", "STACKED", "START", "STRICT", "SYMMETRIC", "TABLE", "TABLESAMPLE", "TABLESPACE", "TEMPORARY",
                "TEMP", "THEN", "TO", "TRAILING", "TRANSACTION", "TRIGGER", "TRUE", "TRUNCATE", "UNION", "UNIQUE",
                "UNLOGGED", "UPDATE", "USER", "USING", "VACUUM", "VALUES", "VARIADIC", "VERBOSE", "VIEW", "VOLATILE",
                "WARNING", "WHEN", "WHERE", "WHILE", "WINDOW", "WITH", "WITHIN GROUP", "WITHIN",
                "MATERIALIZED", "REFRESH", "POLICY", "PUBLICATION", "SUBSCRIPTION", "ROUTINE",
                "NOWAIT", "LOCKED", "SKIP", "STORED", "SUPERUSER", "TYPE", "RULE", "UNLISTEN",
                "UNTIL", "VALID", "WRAPPER", "DISCARD", "RESET", "RESTART", "SEQUENCE",
                "LEFT JOIN LATERAL", "CROSS JOIN LATERAL"
            ];
        }

        getExpectedKeywords(position, context = null) {
            switch (position) {
                case 'statement_start': {
                    const inRoutine = context && context.isInRoutineBody;
                    if (inRoutine) {
                        return [
                            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'CREATE', 'ALTER',
                            'DROP', 'TRUNCATE', 'DO', 'CALL', 'PERFORM', 'RAISE', 'RETURN',
                            'IF', 'LOOP', 'WHILE', 'EXIT', 'CONTINUE'
                        ];
                    }
                    return [
                        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'CREATE', 'ALTER',
                        'DROP', 'TRUNCATE', 'DO', 'CALL'
                    ];
                }
                case 'after_source': {
                    const list = [
                        'WHERE', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN',
                        'CROSS JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS',
                        'ON', 'GROUP BY', 'ORDER BY', 'GROUP', 'ORDER', 'HAVING',
                        'UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT', 'AS',
                        'LIMIT', 'OFFSET', 'RETURNING', 'USING', 'NATURAL'
                    ];
                    if (context && context.clause === 'JOIN') {
                        return ['ON', ...list.filter(k => k !== 'ON')];
                    }
                    return list;
                }
                case 'after_operand':
                    return [
                        '=', '<>', '!=', '>', '<', '>=', '<=',
                        'AND', 'OR', 'NOT', 'IN', 'IS', 'LIKE', 'ILIKE',
                        'SIMILAR TO', 'SIMILAR', 'BETWEEN', 'EXISTS', 'ESCAPE'
                    ];
                case 'is_predicate':
                    return ['NULL', 'NOT', 'NOT NULL', 'TRUE', 'FALSE', 'UNKNOWN'];
                case 'order_direction':
                    return ['ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'NULLS', ','];
                case 'table_hint':
                    return [];
                case 'on_conflict':
                    return ['CONFLICT', 'DO NOTHING', 'DO UPDATE'];
                case 'select_clause':
                    return ['DISTINCT', 'CASE', 'CAST', 'NULL', 'TRUE', 'FALSE'];
                case 'value_expression':
                    return ['SELECT', 'NULL', 'DEFAULT', 'CASE', 'CAST', 'TRUE', 'FALSE'];
                default:
                    if (!position && context && context.clause === 'SELECT') {
                        return ['DISTINCT', 'CASE', 'CAST', 'NULL', 'TRUE', 'FALSE'];
                    }
                    return [];
            }
        }

        getKeywordPopularity(keyword) {
            if (!keyword) return 0;
            const kw = keyword.toUpperCase();
            if (PG_KEYWORD_POPULARITY[kw] !== undefined) return PG_KEYWORD_POPULARITY[kw];
            return super.getKeywordPopularity(keyword);
        }

        getFunctionPopularity(functionName) {
            if (!functionName) return 0;
            const fn = functionName.toUpperCase();
            if (PG_FUNCTION_POPULARITY[fn] !== undefined) return PG_FUNCTION_POPULARITY[fn];
            return super.getFunctionPopularity(functionName);
        }

        getFunctions() {
            return [
                "NOW", "CURRENT_TIMESTAMP", "CURRENT_DATE", "CURRENT_TIME", "CLOCK_TIMESTAMP",
                "TIMEOFDAY", "AGE", "DATE_PART", "DATE_TRUNC", "EXTRACT", "ISFINITE", "MAKE_DATE",
                "MAKE_TIME", "MAKE_TIMESTAMP", "MAKE_TIMESTAMPTZ", "TO_CHAR", "TO_DATE",
                "TO_TIMESTAMP", "TO_NUMBER",
                "COALESCE", "NULLIF", "GREATEST", "LEAST",
                "CONCAT", "CONCAT_WS", "FORMAT", "INITCAP", "LEFT", "LENGTH", "LOWER", "LPAD",
                "LTRIM", "MD5", "POSITION", "REGEXP_MATCH", "REGEXP_MATCHES", "REGEXP_REPLACE",
                "REGEXP_SPLIT_TO_ARRAY", "REGEXP_SPLIT_TO_TABLE", "REPEAT", "REPLACE", "REVERSE",
                "RIGHT", "RPAD", "RTRIM", "SPLIT_PART", "STRPOS", "SUBSTR", "SUBSTRING",
                "TRANSLATE", "TRIM", "UPPER",
                "ABS", "CBRT", "CEIL", "CEILING", "DEGREES", "DIV", "EXP", "FLOOR", "LN",
                "LOG", "MOD", "PI", "POWER", "RADIANS", "ROUND", "SCALE", "SIGN", "SQRT",
                "TRUNC", "RANDOM", "SETSEED",
                "AVG", "COUNT", "MAX", "MIN", "SUM", "ARRAY_AGG", "STRING_AGG", "BOOL_AND",
                "BOOL_OR", "EVERY",
                "ROW_NUMBER", "RANK", "DENSE_RANK", "PERCENT_RANK", "CUME_DIST", "NTILE",
                "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE", "NTH_VALUE",
                "GEN_RANDOM_UUID", "UUID_GENERATE_V4",
                "TO_JSON", "TO_JSONB", "ARRAY_TO_JSON", "ROW_TO_JSON", "JSON_BUILD_ARRAY",
                "JSON_BUILD_OBJECT", "JSON_OBJECT", "JSON_ARRAY_LENGTH", "JSON_EACH",
                "JSON_EACH_TEXT", "JSON_EXTRACT_PATH", "JSON_EXTRACT_PATH_TEXT", "JSON_OBJECT_KEYS",
                "JSONB_SET", "JSONB_INSERT", "JSONB_PRETTY"
            ];
        }

        getDataTypes() {
            return [
                "BIGINT", "BIGSERIAL", "BIT", "BIT VARYING", "BOOLEAN", "BOOL", "BOX",
                "BYTEA", "CHARACTER", "CHAR", "CHARACTER VARYING", "VARCHAR", "CIDR",
                "CIRCLE", "DATE", "DOUBLE PRECISION", "FLOAT8", "INET", "INTEGER", "INT",
                "INT4", "INTERVAL", "JSON", "JSONB", "LINE", "LSEG", "MACADDR", "MONEY",
                "NUMERIC", "DECIMAL", "PATH", "PG_LSN", "POINT", "POLYGON", "REAL", "FLOAT4",
                "SMALLINT", "INT2", "SMALLSERIAL", "SERIAL", "TEXT", "TIME", "TIMETZ",
                "TIMESTAMP", "TIMESTAMPTZ", "TSQUERY", "TSVECTOR", "UUID", "XML"
            ];
        }

        getAlterHeaderTemplate(objectType, objectName, schema = null) {
            const targetSchema = schema || this.defaultSchema;
            const quotedSchema = this.quoteIdentifier(targetSchema);
            const quotedName = this.quoteIdentifier(objectName);
            const cleanType = String(objectType || 'VIEW').toUpperCase();
            // PostgreSQL standard: CREATE OR REPLACE for VIEW and FUNCTION
            if (cleanType === 'VIEW' || cleanType === 'FUNCTION') {
                return `CREATE OR REPLACE ${cleanType} ${quotedSchema}.${quotedName}`;
            }
            return `ALTER ${cleanType} ${quotedSchema}.${quotedName}`;
        }

        getParameterStyle() {
            return 'positional';
        }

        isParameter(tokenValue) {
            if (!tokenValue || typeof tokenValue !== 'string') return false;
            return /^\$[1-9][0-9]*$/.test(tokenValue);
        }

        isSystemVariable(tokenValue) {
            return false;
        }

        isDollarQuote(tokenValue) {
            if (!tokenValue || typeof tokenValue !== 'string') return false;
            return /^\$([a-zA-Z0-9_]*)\$$/.test(tokenValue);
        }

        getFormatPlaceholders() {
            return ['%I', '%L', '%s', '%%'];
        }

        isFormatPlaceholder(placeholder) {
            if (!placeholder || typeof placeholder !== 'string') return false;
            return ['%I', '%L', '%s', '%%'].includes(placeholder);
        }
    }

    /**
     * SqlDialectFactory - Dialect Resolution & Registration (Section 43)
     */
    class SqlDialectFactory {
        static _instances = new Map();

        static register(dbType, dialectInstance) {
            if (!dbType || !dialectInstance) return;
            this._instances.set(String(dbType).toLowerCase(), dialectInstance);
        }

        /**
         * Get singleton dialect for given dbType
         */
        static getDialect(dbType = 'sqlserver') {
            const normalized = String(dbType || 'sqlserver').trim().toLowerCase();
            if (normalized === 'postgresql' || normalized === 'postgres' || normalized === 'pg') {
                if (!this._instances.has('postgresql')) {
                    this._instances.set('postgresql', new PostgresDialect());
                }
                return this._instances.get('postgresql');
            }

            // Default to SQL Server
            if (!this._instances.has('sqlserver')) {
                this._instances.set('sqlserver', new SqlServerDialect());
            }
            return this._instances.get('sqlserver');
        }

        /**
         * Resolve dialect by inspecting connection or active workspace context
         */
        static getDialectForConnection(connectionId) {
            let dbType = 'sqlserver';

            // Check MetadataProviderFactory if registered
            if (window.MetadataProviderFactory && typeof window.MetadataProviderFactory.getDbTypeForConnection === 'function') {
                dbType = window.MetadataProviderFactory.getDbTypeForConnection(connectionId);
            } else if (window.ActiveDbType) {
                dbType = window.ActiveDbType;
            }

            return this.getDialect(dbType);
        }
    }

    // Pre-register default dialects
    SqlDialectFactory.register('sqlserver', new SqlServerDialect());
    SqlDialectFactory.register('mssql', SqlDialectFactory.getDialect('sqlserver'));
    SqlDialectFactory.register('postgresql', new PostgresDialect());
    SqlDialectFactory.register('postgres', SqlDialectFactory.getDialect('postgresql'));

    // Export to global window
    window.SqlDialect = SqlDialect;
    window.SqlServerDialect = SqlServerDialect;
    window.PostgresDialect = PostgresDialect;
    window.PostgreSQLDialect = PostgresDialect;
    window.SqlDialectFactory = SqlDialectFactory;
    window.DefaultSqlDialectFactory = SqlDialectFactory;
    window.COMMON_KEYWORD_POPULARITY = COMMON_KEYWORD_POPULARITY;
    window.COMMON_FUNCTION_POPULARITY = COMMON_FUNCTION_POPULARITY;
    window.MSSQL_KEYWORD_POPULARITY = MSSQL_KEYWORD_POPULARITY;
    window.MSSQL_FUNCTION_POPULARITY = MSSQL_FUNCTION_POPULARITY;
    window.PG_KEYWORD_POPULARITY = PG_KEYWORD_POPULARITY;
    window.PG_FUNCTION_POPULARITY = PG_FUNCTION_POPULARITY;

})(typeof window !== 'undefined' ? window : globalThis);
