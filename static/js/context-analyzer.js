// SQL Context Analyzer for Web IDE IntelliSense
// Ported from Python SqlContextAnalyzer, fully compliant with intellisense_overview.md

(function (window) {
    'use strict';

    const SQL_KEYWORDS = [
        "SELECT", "FROM", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER",
        "ON", "GROUP", "ORDER", "BY", "HAVING", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
        "DELETE", "TRUNCATE", "PRINT", "CREATE", "ALTER", "DROP", "TABLE", "VIEW", "PROCEDURE", "FUNCTION",
        "TRIGGER", "SYNONYM", "DATABASE", "SCHEMA", "INDEX", "PRIMARY", "FOREIGN", "KEY",
        "REFERENCES", "CHECK", "DEFAULT", "UNIQUE", "CONSTRAINT", "AND", "OR", "NOT", "IN",
        "EXISTS", "BETWEEN", "LIKE", "IS", "NULL", "UNION", "ALL", "INTERSECT", "EXCEPT",
        "AS", "DISTINCT", "TOP", "LIMIT", "OFFSET", "CASE", "WHEN", "THEN", "ELSE", "END",
        "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION", "DECLARE", "EXEC", "EXECUTE", "WITH",
        "OVER", "PARTITION", "ASC", "DESC", "TRUE", "FALSE", "USE", "GO"
    ];

    const SQL_FUNCTIONS = [
        "COUNT", "SUM", "AVG", "MIN", "MAX", "LEN", "LENGTH", "SUBSTRING", "REPLACE",
        "TRIM", "LTRIM", "RTRIM", "UPPER", "LOWER", "CHARINDEX", "PATINDEX", "GETDATE",
        "NOW", "CURRENT_TIMESTAMP", "DATEADD", "DATEDIFF", "ISNULL", "COALESCE",
        "NULLIF", "CAST", "CONVERT", "ROW_NUMBER", "RANK", "DENSE_RANK", "NTILE",
        "LEAD", "LAG", "IIF", "FORMAT"
    ];

    const SQL_DATA_TYPES = [
        "BIGINT", "BINARY", "BIT", "BOOLEAN", "BYTEA", "CHAR", "DATE", "DATETIME",
        "DATETIME2", "DATETIMEOFFSET", "DECIMAL", "DOUBLE PRECISION", "FLOAT", "IMAGE",
        "INT", "INTEGER", "JSON", "JSONB", "MONEY", "NCHAR", "NTEXT", "NUMERIC",
        "NVARCHAR", "REAL", "SERIAL", "BIGSERIAL", "SMALLDATETIME", "SMALLINT",
        "SMALLMONEY", "SMALLSERIAL", "TEXT", "TIME", "TIMESTAMP", "TIMESTAMPTZ",
        "TINYINT", "UNIQUEIDENTIFIER", "UUID", "VARBINARY", "VARCHAR", "XML"
    ];

    const FOLLOW_UP_KEYWORDS = {
        "ALTER": [
            "TABLE", "VIEW", "PROCEDURE", "FUNCTION", "TRIGGER",
            "COLUMN", "DATABASE", "SCHEMA", "INDEX"
        ],
        "CREATE": [
            "TABLE", "VIEW", "PROCEDURE", "FUNCTION", "TRIGGER",
            "INDEX", "DATABASE", "SCHEMA", "OR"
        ],
        "CREATE OR": [
            "ALTER", "REPLACE"
        ],
        "CREATE OR ALTER": [
            "PROCEDURE", "FUNCTION", "TRIGGER", "VIEW"
        ],
        "CREATE OR REPLACE": [
            "PROCEDURE", "FUNCTION", "TRIGGER", "VIEW"
        ],
        "DROP": [
            "TABLE", "VIEW", "PROCEDURE", "FUNCTION", "TRIGGER",
            "INDEX", "DATABASE", "SCHEMA"
        ],
        "GROUP": ["BY"],
        "ORDER": ["BY"],
        "INSERT": ["INTO"],
        "DELETE": ["FROM"],
        "TRUNCATE": ["TABLE"],
        "INNER": ["JOIN"],
        "LEFT": ["JOIN", "OUTER"],
        "RIGHT": ["JOIN", "OUTER"],
        "FULL": ["JOIN", "OUTER"],
        "CROSS": ["JOIN", "APPLY"],
        "OUTER": ["JOIN", "APPLY"],
        "UNION": ["ALL"],
        "PRIMARY": ["KEY"],
        "FOREIGN": ["KEY"],
        "PARTITION": ["BY"],
        "BEGIN": ["TRANSACTION", "TRY", "CATCH"],
        "COMMIT": ["TRANSACTION"],
        "ROLLBACK": ["TRANSACTION"]
    };

    function cleanIdentifier(name) {
        if (!name) return "";
        name = name.trim();
        if ((name.startsWith("[") && name.endsWith("]")) ||
            (name.startsWith('"') && name.endsWith('"')) ||
            (name.startsWith('`') && name.endsWith('`'))) {
            return name.substring(1, name.length - 1);
        }
        return name;
    }

    function extractLocalTempTables(sqlText) {
        if (!sqlText) return [];
        const regex = /(?:^|[^a-zA-Z0-9_])(#[#a-zA-Z0-9_]+)/g;
        const seen = new Set();
        const result = [];
        let match;
        while ((match = regex.exec(sqlText)) !== null) {
            const table = match[1];
            const lower = table.toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                result.push(table);
            }
        }
        return result;
    }

    function extractLocalTableVars(sqlText) {
        if (!sqlText) return [];
        const regex = /\bDECLARE\s+(@[a-zA-Z0-9_]+)\s+(?:AS\s+)?TABLE\b/gi;
        const seen = new Set();
        const result = [];
        let match;
        while ((match = regex.exec(sqlText)) !== null) {
            const v = match[1];
            const lower = v.toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                result.push(v);
            }
        }
        return result;
    }

    function extractAliases(sqlText) {
        const aliasMap = {};
        if (!sqlText) return aliasMap;

        const regex = /\b(?:FROM|JOIN)\s+([\[\]"\w\.#@]+)(?:\s+(?:AS\s+)?([\[\]"\w]+))?/gi;
        const nonAliases = new Set([
            "WHERE", "ON", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS",
            "GROUP", "ORDER", "HAVING", "LIMIT", "UNION", "APPLY"
        ]);

        let match;
        while ((match = regex.exec(sqlText)) !== null) {
            const rawTable = match[1].trim();
            let rawAlias = match[2] ? match[2].trim() : "";

            if (rawAlias && nonAliases.has(rawAlias.toUpperCase())) {
                rawAlias = "";
            }

            const parts = rawTable.split(".").map(cleanIdentifier);
            let schemaName = "";
            let tableName = "";
            if (parts.length === 1) {
                tableName = parts[0];
            } else if (parts.length === 2) {
                schemaName = parts[0];
                tableName = parts[1];
            } else {
                schemaName = parts[parts.length - 2];
                tableName = parts[parts.length - 1];
            }

            const info = { schema: schemaName, table: tableName };

            if (rawAlias) {
                const cleanAlias = cleanIdentifier(rawAlias);
                aliasMap[cleanAlias.toLowerCase()] = info;
                aliasMap[cleanAlias] = info;
            }

            if (tableName) {
                aliasMap[tableName.toLowerCase()] = info;
                aliasMap[tableName] = info;
            }
        }

        return aliasMap;
    }

    function extractAllTablesInQuery(sqlText) {
        if (!sqlText) return [];
        const regex = /\b(?:FROM|JOIN)\s+([\[\]"\w\.#@]+)(?:\s+(?:AS\s+)?([\[\]"\w]+))?/gi;
        const nonAliases = new Set([
            "WHERE", "ON", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS",
            "GROUP", "ORDER", "HAVING", "LIMIT", "UNION", "APPLY"
        ]);

        const seen = new Set();
        const tables = [];
        let match;
        while ((match = regex.exec(sqlText)) !== null) {
            const rawTable = match[1].trim();
            let rawAlias = match[2] ? match[2].trim() : "";

            if (rawAlias && nonAliases.has(rawAlias.toUpperCase())) {
                rawAlias = "";
            }

            const parts = rawTable.split(".").map(cleanIdentifier);
            let schemaName = "";
            let tableName = "";
            if (parts.length === 1) {
                tableName = parts[0];
            } else if (parts.length === 2) {
                schemaName = parts[0];
                tableName = parts[1];
            } else {
                schemaName = parts[parts.length - 2];
                tableName = parts[parts.length - 1];
            }

            if (tableName) {
                const key = `${schemaName.toLowerCase()}::${tableName.toLowerCase()}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    tables.push({
                        schema: schemaName,
                        table: tableName,
                        alias: rawAlias ? cleanIdentifier(rawAlias) : ""
                    });
                }
            }
        }
        return tables;
    }


    function detectClause(textBeforeCursor) {
        if (!textBeforeCursor) return "";
        const keywords = [
            "SELECT", "FROM", "JOIN", "WHERE", "ON", "GROUP BY", "ORDER BY",
            "HAVING", "INSERT INTO", "UPDATE", "SET", "DELETE FROM",
            "EXEC", "EXECUTE", "INTO"
        ];
        const pattern = new RegExp(
            '\\b(' + keywords.map(k => k.replace(" ", "\\s+")).join("|") + ')\\b',
            'gi'
        );
        let match;
        let lastMatch = null;
        while ((match = pattern.exec(textBeforeCursor)) !== null) {
            lastMatch = match[1];
        }
        return lastMatch ? lastMatch.replace(/\s+/g, " ").toUpperCase() : "";
    }

    function detectAlterContext(textBeforeCursor) {
        if (!textBeforeCursor) return { isAlter: false, alterType: "" };
        const pattern = /\b(?:ALTER|DROP|CREATE\s+OR\s+ALTER|CREATE\s+OR\s+REPLACE)\s+(PROCEDURE|PROC|FUNCTION|TRIGGER|VIEW|TABLE)\b/gi;
        let match;
        let lastMatch = null;
        let lastEnd = 0;
        while ((match = pattern.exec(textBeforeCursor)) !== null) {
            lastMatch = match[1];
            lastEnd = match.index + match[0].length;
        }

        if (lastMatch) {
            const afterClause = textBeforeCursor.substring(lastEnd).trim();
            if (!afterClause.includes("\n") && !afterClause.toUpperCase().includes(" AS ")) {
                const rawType = lastMatch.toLowerCase();
                if (rawType === "proc" || rawType === "procedure") return { isAlter: true, alterType: "procedure" };
                if (rawType === "func" || rawType === "function") return { isAlter: true, alterType: "function" };
                return { isAlter: true, alterType: rawType };
            }
        }
        return { isAlter: false, alterType: "" };
    }

    function analyze(fullSql, cursorIndex) {
        fullSql = fullSql || "";
        cursorIndex = (cursorIndex !== undefined && cursorIndex !== null) ? cursorIndex : fullSql.length;
        const textBeforeCursor = fullSql.substring(0, cursorIndex);

        // 1. Current token and qualifier
        const tokenMatch = textBeforeCursor.match(/([\[\]"\w\.#@]*)$/);
        const rawToken = tokenMatch ? tokenMatch[1] : "";

        let currentWord = "";
        let qualifier = "";
        let fullQualifier = "";
        let triggerChar = "";

        if (rawToken.includes(".")) {
            const parts = rawToken.split(".");
            currentWord = cleanIdentifier(parts[parts.length - 1]);
            qualifier = cleanIdentifier(parts[parts.length - 2]);
            fullQualifier = parts.slice(0, -1).map(cleanIdentifier).join(".");
            triggerChar = ".";
        } else {
            currentWord = cleanIdentifier(rawToken);
            triggerChar = "";
        }

        // 2. Preceding tokens
        const textPrior = rawToken ? textBeforeCursor.substring(0, textBeforeCursor.length - rawToken.length) : textBeforeCursor;
        const precedingWords = textPrior.match(/([a-zA-Z0-9_#@]+)/g) || [];
        const previousTokens = precedingWords.slice(-3).map(w => w.toUpperCase());
        const previousToken = previousTokens.length > 0 ? previousTokens[previousTokens.length - 1] : "";

        // 3. Follow-up keywords check
        let hasFollowUp = false;
        let followUpKeywords = [];

        if (previousTokens.length >= 3) {
            const threeKey = `${previousTokens[previousTokens.length - 3]} ${previousTokens[previousTokens.length - 2]} ${previousTokens[previousTokens.length - 1]}`;
            if (FOLLOW_UP_KEYWORDS[threeKey]) {
                hasFollowUp = true;
                followUpKeywords = FOLLOW_UP_KEYWORDS[threeKey];
            }
        }

        if (!hasFollowUp && previousTokens.length >= 2) {
            const twoKey = `${previousTokens[previousTokens.length - 2]} ${previousTokens[previousTokens.length - 1]}`;
            if (FOLLOW_UP_KEYWORDS[twoKey]) {
                hasFollowUp = true;
                followUpKeywords = FOLLOW_UP_KEYWORDS[twoKey];
            }
        }

        if (!hasFollowUp && previousToken && FOLLOW_UP_KEYWORDS[previousToken]) {
            hasFollowUp = true;
            followUpKeywords = FOLLOW_UP_KEYWORDS[previousToken];
        }

        // 4. Local temp tables & table vars strictly in file
        const localTempTables = extractLocalTempTables(fullSql);
        const localTableVars = extractLocalTableVars(fullSql);

        // 5. Table aliases and all tables in query
        const aliasMap = extractAliases(fullSql);
        const queryTables = extractAllTablesInQuery(fullSql);

        // 6. Current clause
        const clause = detectClause(textBeforeCursor);

        // 7. ALTER / CREATE OR ALTER context
        const alterContext = detectAlterContext(textBeforeCursor);

        return {
            currentWord,
            rawToken,
            qualifier,
            fullQualifier,
            triggerChar,
            clause,
            previousToken,
            previousTokens,
            hasFollowUp,
            followUpKeywords,
            aliasMap,
            queryTables,
            localTempTables,
            localTableVars,
            isAlterContext: alterContext.isAlter,
            alterObjectType: alterContext.alterType,
            cursorIndex
        };
    }

    window.SqlContextAnalyzer = {
        SQL_KEYWORDS,
        SQL_FUNCTIONS,
        SQL_DATA_TYPES,
        FOLLOW_UP_KEYWORDS,
        cleanIdentifier,
        extractLocalTempTables,
        extractLocalTableVars,
        extractAliases,
        extractAllTablesInQuery,
        detectClause,
        detectAlterContext,
        analyze
    };

})(window);
