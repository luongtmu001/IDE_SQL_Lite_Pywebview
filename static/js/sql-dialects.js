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
                "TABLESAMPLE", "TEXTSIZE", "THEN", "TO", "TOP", "TRAN", "TRANSACTION",
                "TRIGGER", "TRUNCATE", "TRYCONNECT", "TRY_CONVERT", "TSEQUAL", "UNION", "UNIQUE",
                "UNPIVOT", "UPDATE", "UPDATETEXT", "USE", "USER", "VALUES", "VARYING", "VIEW",
                "WAITFOR", "WHEN", "WHERE", "WHILE", "WITH", "WITHIN GROUP", "WRITETEXT",
                "CROSS APPLY", "OUTER APPLY", "NOLOCK"
            ];
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
                "NEWID", "NEWSEQUENTIALID"
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
                "ALL", "ANALYSE", "ANALYZE", "AND", "ANY", "ARRAY", "AS", "ASC", "ASYMMETRIC",
                "AUTHORIZATION", "BETWEEN", "BIGSERIAL", "BINARY", "BIT", "BOOLEAN", "BOTH",
                "CASE", "CAST", "CHECK", "COLLATE", "COLLATION", "COLUMN", "CONCURRENTLY",
                "CONSTRAINT", "CREATE", "CROSS", "CURRENT_CATALOG", "CURRENT_DATE", "CURRENT_ROLE",
                "CURRENT_SCHEMA", "CURRENT_TIME", "CURRENT_TIMESTAMP", "CURRENT_USER", "DEFAULT",
                "DEFERRABLE", "DESC", "DISTINCT", "DISTINCT ON", "DO", "DO NOTHING", "DO UPDATE",
                "ELSE", "END", "EXCEPT", "EXCLUDE", "EXPLAIN", "FALSE", "FETCH", "FOR", "FOREIGN",
                "FREEZE", "FROM", "FULL", "FUNCTION", "GRANT", "GROUP", "HAVING", "ILIKE", "IN",
                "INITIALLY", "INNER", "INTERSECT", "INTO", "IS", "ISNULL", "JOIN", "LATERAL",
                "LEADING", "LEFT", "LIKE", "LIMIT", "LOCALTIME", "LOCALTIMESTAMP", "NATURAL",
                "NOT", "NOTNULL", "NULL", "OFFSET", "ON", "ON CONFLICT", "ONLY", "OR", "ORDER",
                "OUTER", "OVERLAPS", "PLACING", "PRIMARY", "PROCEDURE", "REFERENCES", "RETURNING",
                "RIGHT", "SELECT", "SERIAL", "SESSION_USER", "SIMILAR", "SIMILAR TO", "SOME",
                "SYMMETRIC", "TABLE", "TABLESAMPLE", "THEN", "TO", "TRAILING", "TRUE", "UNION",
                "UNIQUE", "USER", "USING", "VACUUM", "VARIADIC", "VERBOSE", "VIEW", "WHEN",
                "WHERE", "WINDOW", "WITH"
            ];
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
    window.SqlDialectFactory = SqlDialectFactory;
    window.DefaultSqlDialectFactory = SqlDialectFactory;

})(typeof window !== 'undefined' ? window : globalThis);
