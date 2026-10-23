/**
 * completion-engine.js - SQL IntelliSense Completion Engine (Phase 6 & 8)
 * 
 * Implements:
 * - Completion Pipeline: Tokenize -> Statement -> Context -> Scope -> Aliases -> Metadata -> Generate -> Filter -> Rank -> Return (Section 21, 22)
 * - Candidate Sources: Keywords, Scope symbols, Aliases, Tables, Views, Columns, Functions, Procedures, Types, Snippets, CTEs, Variables (Section 23, 39, 40, 46, 47, 51)
 * - Context-Aware Routing: FROM/JOIN (tables, CTEs, temp tables), SELECT/WHERE/ON/ORDER BY (columns, variables), EXEC (procedures, parameters) (Section 24-29, 51)
 * - Multi-Stage Filtering: exact prefix -> prefix -> substring -> fuzzy (Section 31)
 * - Contextual Ranking: CompletionRanker with weighted contextual signals (Section 30)
 * - Request Cancellation: requestId / AbortController concurrency management (Section 33)
 * - Function Signatures & Documentation (Section 51)
 * - Level 3 Memoization: Seamless caching via AppMetadataCache
 */

(function(window) {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────────
    // 0. RESERVED SQL KEYWORDS & BUILT-IN FUNCTION SIGNATURES (Section 51 & 9.2)
    // ─────────────────────────────────────────────────────────────────────────────
    const RESERVED_KEYWORDS = new Set([
        'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER',
        'ON', 'GROUP', 'HAVING', 'ORDER', 'BY', 'UNION', 'ALL', 'INTERSECT', 'EXCEPT',
        'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'TRUNCATE', 'MERGE',
        'CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX', 'PROCEDURE', 'PROC', 'FUNCTION',
        'TRIGGER', 'SCHEMA', 'DATABASE', 'DEFAULT', 'CHECK', 'CONSTRAINT', 'PRIMARY', 'KEY',
        'FOREIGN', 'REFERENCES', 'IDENTITY', 'NULL', 'NOT', 'AND', 'OR', 'AS', 'DISTINCT',
        'TOP', 'LIMIT', 'OFFSET', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'OVER', 'WITH',
        'EXEC', 'EXECUTE', 'USER', 'FILE', 'COLUMN', 'DECLARE', 'ROWCOUNT', 'STATUS',
        'PERCENT', 'TIES', 'OUTPUT', 'APPLY', 'LATERAL', 'WINDOW', 'QUALIFY', 'PARTITION'
    ]);

    // ─────────────────────────────────────────────────────────────────────────────
    // 0. PARAMETER DOCUMENTATION & SIGNATURE HELP METADATA (Phase 6)
    // ─────────────────────────────────────────────────────────────────────────────
    const PARAMETER_DOCS = {
        "DATEADD": {
            "datepart": "The part of date (year, quarter, month, dayofyear, day, week, weekday, hour, minute, second, millisecond) to add to.",
            "number": "An expression that can resolve to an int that is added to a datepart of date.",
            "date": "An expression that can resolve to a time, date, smalldatetime, datetime, datetime2, or datetimeoffset value."
        },
        "DATEDIFF": {
            "datepart": "The units in which DATEDIFF reports the difference between startdate and enddate (year, month, day, hour, etc.).",
            "startdate": "The starting date expression.",
            "enddate": "The ending date expression."
        },
        "DATEPART": {
            "datepart": "The specific part of the date (year, month, day, hour, etc.) to return.",
            "date": "The date expression."
        },
        "DATENAME": {
            "datepart": "The specific part of the date (e.g. month, weekday) to return as a string.",
            "date": "The date expression."
        },
        "DATEFROMPARTS": {
            "year": "Integer expression specifying a year.",
            "month": "Integer expression specifying a month, from 1 to 12.",
            "day": "Integer expression specifying a day, from 1 to 31."
        },
        "EOMONTH": {
            "start_date": "Date expression specifying the date for which to return the last day of the month.",
            "month_to_add": "Optional integer expression specifying the number of months to add to start_date."
        },
        "SUBSTRING": {
            "expression": "A character, binary, text, ntext, or image expression.",
            "start": "An integer specifying where the returned characters start (1-based index).",
            "length": "A positive integer specifying how many characters or bytes will be returned."
        },
        "REPLACE": {
            "string_expression": "The string expression to be searched.",
            "string_pattern": "The substring to be found.",
            "string_replacement": "The replacement string."
        },
        "STUFF": {
            "character_expression": "An expression of character data to modify.",
            "start": "An integer value that specifies the location to begin deletion and insertion.",
            "length": "An integer that specifies the number of characters to delete.",
            "replacewith_expression": "An expression of character data that replaces length characters."
        },
        "CHARINDEX": {
            "expressiontofind": "The character expression containing the sequence to find.",
            "expressiontosearch": "The character expression to search.",
            "start_location": "Optional integer expression at which the search begins (1-based index)."
        },
        "PATINDEX": {
            "pattern": "A character expression that contains the sequence to find. Wildcards (% and _) can be used.",
            "expression": "An expression, usually a column, that is searched for the specified pattern."
        },
        "CONVERT": {
            "data_type": "The target data type (with optional length, precision, or scale).",
            "expression": "Any valid expression to convert.",
            "style": "Optional integer expression specifying how CONVERT will translate expression."
        },
        "CAST": {
            "expression as data_type": "Syntax: CAST(expression AS data_type)"
        },
        "ISNULL": {
            "check_expression": "The expression to be checked for NULL.",
            "replacement_value": "The expression to be returned if check_expression is NULL."
        },
        "COALESCE": {
            "expression1": "The first expression to evaluate.",
            "expression2": "The second expression to evaluate if expression1 is NULL.",
            "...": "Additional expressions evaluated in order until a non-NULL value is found."
        },
        "NULLIF": {
            "expression1": "The first expression.",
            "expression2": "The second expression. Returns NULL if both expressions are equal; otherwise returns expression1."
        },
        "IIF": {
            "boolean_expression": "The boolean expression to evaluate.",
            "true_value": "Value returned if boolean_expression evaluates to true.",
            "false_value": "Value returned if boolean_expression evaluates to false."
        },
        "CHOOSE": {
            "index": "An integer expression that represents a 1-based index into the list of items.",
            "val_1": "First value in the list.",
            "val_2": "Second value in the list."
        },
        "ROUND": {
            "numeric_expression": "An expression of the exact numeric or approximate numeric data type category.",
            "length": "The precision to which numeric_expression is to be rounded.",
            "function": "Optional integer. When 0 or omitted, rounds. When any other value, truncates."
        },
        "FLOOR": {
            "numeric_expression": "A numeric expression to round down to the largest integer."
        },
        "CEILING": {
            "numeric_expression": "A numeric expression to round up to the smallest integer."
        },
        "ABS": {
            "numeric_expression": "A numeric expression to return the absolute value for."
        },
        "CONCAT": {
            "string_value1": "The first string value to concatenate.",
            "string_value2": "The second string value to concatenate.",
            "string_valuen": "Additional string values to concatenate."
        },
        "CONCAT_WS": {
            "separator": "An expression of any character type that separates the concatenated values.",
            "argument1": "The first value to concatenate.",
            "argument2": "The second value to concatenate."
        },
        "STRING_AGG": {
            "expression": "An expression of any type. Null values are ignored.",
            "separator": "A literal or variable of character type that separates concatenated values."
        },
        "STRING_SPLIT": {
            "string": "An expression of any character type (e.g. nvarchar, varchar) to split.",
            "separator": "A single character literal used as separator for splitting."
        },
        "LEFT": {
            "character_expression": "An expression of character or binary data.",
            "integer_expression": "A positive integer specifying how many characters will be returned from the left."
        },
        "RIGHT": {
            "character_expression": "An expression of character or binary data.",
            "integer_expression": "A positive integer specifying how many characters will be returned from the right."
        },
        "TRIM": {
            "string": "A string expression from which characters will be removed."
        },
        "LTRIM": {
            "character_expression": "A character expression from which leading blanks will be removed."
        },
        "RTRIM": {
            "character_expression": "A character expression from which trailing blanks will be removed."
        },
        "UPPER": {
            "character_expression": "A character expression to convert to uppercase."
        },
        "LOWER": {
            "character_expression": "A character expression to convert to lowercase."
        },
        "LEN": {
            "string_expression": "A string expression whose length (excluding trailing spaces) will be returned."
        },
        "LENGTH": {
            "string": "A string expression whose character count will be returned."
        },
        "COUNT": {
            "expression": "The expression or column to count, or * to count all rows."
        },
        "SUM": {
            "expression": "An expression of exact or approximate numeric type to sum."
        },
        "AVG": {
            "expression": "An expression of exact or approximate numeric type to average."
        },
        "MIN": {
            "expression": "An expression whose minimum value will be returned."
        },
        "MAX": {
            "expression": "An expression whose maximum value will be returned."
        }
    };

    function parseSignatureParameters(fnName, signatureStr, docStr) {
        if (!signatureStr) return [];
        const openParen = signatureStr.indexOf('(');
        const closeParen = signatureStr.lastIndexOf(')');
        if (openParen === -1 || closeParen === -1 || closeParen <= openParen) {
            return [];
        }
        const inside = signatureStr.substring(openParen + 1, closeParen).trim();
        if (!inside) return [];

        const rawParts = inside.split(',');
        const fnDocs = PARAMETER_DOCS[fnName.toUpperCase()] || {};

        return rawParts.map((raw, idx) => {
            let clean = raw.trim().replace(/^[\[\]]+|[\[\]]+$/g, '').trim();
            clean = clean.replace(/^[\[\]]+|[\[\]]+$/g, '').trim();
            const paramKey = clean.toLowerCase().replace(/[^a-z0-9_]/g, '');
            const doc = fnDocs[paramKey] || fnDocs[clean.toLowerCase()] || `Parameter ${idx + 1} (${clean}) of ${fnName}.`;
            return {
                label: clean,
                documentation: doc
            };
        });
    }

    const FUNCTION_SIGNATURES = {
        "ISNULL": {
            signature: "ISNULL(check_expression, replacement_value)",
            documentation: "Replaces NULL with the specified replacement value."
        },
        "COALESCE": {
            signature: "COALESCE(expression1, expression2, ...)",
            documentation: "Evaluates the arguments in order and returns the current value of the first expression that initially doesn't evaluate to NULL."
        },
        "NULLIF": {
            signature: "NULLIF(expression1, expression2)",
            documentation: "Returns a null value if the two specified expressions are equal."
        },
        "DATEADD": {
            signature: "DATEADD(datepart, number, date)",
            documentation: "Returns a specified date with the specified number interval (signed integer) added to a specified datepart of that date."
        },
        "DATEDIFF": {
            signature: "DATEDIFF(datepart, startdate, enddate)",
            documentation: "Returns the count of the specified datepart boundaries crossed between the specified startdate and enddate."
        },
        "DATEPART": {
            signature: "DATEPART(datepart, date)",
            documentation: "Returns an integer that represents the specified datepart of the specified date."
        },
        "DATENAME": {
            signature: "DATENAME(datepart, date)",
            documentation: "Returns a character string that represents the specified datepart of the specified date."
        },
        "GETDATE": {
            signature: "GETDATE()",
            documentation: "Returns the current database system timestamp as a datetime value without the database time zone offset."
        },
        "NOW": {
            signature: "NOW()",
            documentation: "Returns the current date and time."
        },
        "CURRENT_TIMESTAMP": {
            signature: "CURRENT_TIMESTAMP",
            documentation: "Returns the current date and time as a TIMESTAMP value."
        },
        "SUBSTRING": {
            signature: "SUBSTRING(expression, start, length)",
            documentation: "Returns part of a character, binary, text, or image expression."
        },
        "REPLACE": {
            signature: "REPLACE(string_expression, string_pattern, string_replacement)",
            documentation: "Replaces all occurrences of a specified string value with another string value."
        },
        "TRIM": {
            signature: "TRIM([characters FROM ] string)",
            documentation: "Removes the space character OR other specified characters from the start and end of a string."
        },
        "LTRIM": {
            signature: "LTRIM(character_expression)",
            documentation: "Returns a character expression after it removes leading blanks."
        },
        "RTRIM": {
            signature: "RTRIM(character_expression)",
            documentation: "Returns a character expression after it removes trailing blanks."
        },
        "UPPER": {
            signature: "UPPER(character_expression)",
            documentation: "Returns a character expression with lowercase character data converted to uppercase."
        },
        "LOWER": {
            signature: "LOWER(character_expression)",
            documentation: "Returns a character expression with uppercase character data converted to lowercase."
        },
        "LEN": {
            signature: "LEN(string_expression)",
            documentation: "Returns the number of characters of the specified string expression, excluding trailing blanks."
        },
        "LENGTH": {
            signature: "LENGTH(string)",
            documentation: "Returns the length of a string in characters or bytes."
        },
        "CHARINDEX": {
            signature: "CHARINDEX(expressionToFind, expressionToSearch [, start_location])",
            documentation: "Searches an expression for another expression and returns its starting position if found."
        },
        "CAST": {
            signature: "CAST(expression AS data_type)",
            documentation: "Converts an expression of one data type to another."
        },
        "CONVERT": {
            signature: "CONVERT(data_type, expression [, style])",
            documentation: "Converts an expression of one data type to another."
        },
        "COUNT": {
            signature: "COUNT(expression | *)",
            documentation: "Returns the number of items found in a group."
        },
        "SUM": {
            signature: "SUM(expression)",
            documentation: "Returns the sum of all the values, or only the DISTINCT values, in the expression."
        },
        "AVG": {
            signature: "AVG(expression)",
            documentation: "Returns the average of the values in a group. It ignores null values."
        },
        "MIN": {
            signature: "MIN(expression)",
            documentation: "Returns the minimum value in the expression."
        },
        "MAX": {
            signature: "MAX(expression)",
            documentation: "Returns the maximum value in the expression."
        },
        "ROW_NUMBER": {
            signature: "ROW_NUMBER() OVER ([PARTITION BY ...] ORDER BY ...)",
            documentation: "Numbers the output of a result set starting at 1 for the first row in each partition."
        },
        "RANK": {
            signature: "RANK() OVER ([PARTITION BY ...] ORDER BY ...)",
            documentation: "Returns the rank of each row within the partition of a result set."
        },
        "DENSE_RANK": {
            signature: "DENSE_RANK() OVER ([PARTITION BY ...] ORDER BY ...)",
            documentation: "Returns the rank of rows within the partition without any gaps in the ranking."
        },
        "ROUND": {
            signature: "ROUND(numeric_expression, length [, function])",
            documentation: "Returns a numeric value, rounded to the specified length or precision."
        },
        "FLOOR": {
            signature: "FLOOR(numeric_expression)",
            documentation: "Returns the largest integer less than or equal to the specified numeric expression."
        },
        "CEILING": {
            signature: "CEILING(numeric_expression)",
            documentation: "Returns the smallest integer greater than or equal to the specified numeric expression."
        },
        "ABS": {
            signature: "ABS(numeric_expression)",
            documentation: "Returns the absolute (positive) value of the specified numeric expression."
        },
        "IIF": {
            signature: "IIF(boolean_expression, true_value, false_value)",
            documentation: "Returns one of two values, depending on whether the boolean expression evaluates to true or false."
        },
        "CONCAT": {
            signature: "CONCAT(string_value1, string_value2 [, string_valueN])",
            documentation: "Returns a string resulting from the concatenation of two or more string values."
        },
        "STRING_AGG": {
            signature: "STRING_AGG(expression, separator) [WITHIN GROUP (ORDER BY ...)]",
            documentation: "Concatenates the values of string expressions and places separator values between them."
        },
        "DATEFROMPARTS": {
            signature: "DATEFROMPARTS(year, month, day)",
            documentation: "Returns a date value for the specified year, month, and day."
        },
        "EOMONTH": {
            signature: "EOMONTH(start_date [, month_to_add])",
            documentation: "Returns the last day of the month containing a specified date, with an optional offset."
        },
        "LEFT": {
            signature: "LEFT(character_expression, integer_expression)",
            documentation: "Returns the specified number of characters from the start of a character string."
        },
        "RIGHT": {
            signature: "RIGHT(character_expression, integer_expression)",
            documentation: "Returns the specified number of characters from the end of a character string."
        },
        "STUFF": {
            signature: "STUFF(character_expression, start, length, replaceWith_expression)",
            documentation: "Deletes a specified length of characters and inserts new characters at a specified starting point."
        },
        "PATINDEX": {
            signature: "PATINDEX(pattern, expression)",
            documentation: "Returns the starting position of the first occurrence of a pattern in a specified expression."
        },
        "CONCAT_WS": {
            signature: "CONCAT_WS(separator, argument1, argument2 [, argumentN])",
            documentation: "Returns a string resulting from the concatenation of two or more string values with a separator."
        },
        "STRING_SPLIT": {
            signature: "STRING_SPLIT(string, separator)",
            documentation: "Splits a character expression into rows of substrings based on a specified separator character."
        },
        "CHOOSE": {
            signature: "CHOOSE(index, val_1, val_2 [, val_N])",
            documentation: "Returns the item at the specified index from a list of values."
        }
    };

    // Pre-calculate structured parameters for all built-in function signatures
    Object.keys(FUNCTION_SIGNATURES).forEach(fn => {
        const item = FUNCTION_SIGNATURES[fn];
        if (!item.parameters) {
            item.parameters = parseSignatureParameters(fn, item.signature, item.documentation);
        }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. CANONICAL INTELLISENSE PIPELINE CLASSES (Section 30, 31, Spec RC13)
    // ─────────────────────────────────────────────────────────────────────────────
    // Resolved RC13: CandidateFilter, CompletionRanker, and CandidateGenerator are
    // canonically implemented in candidate-filter.js, completion-ranker.js, and
    // candidate-generator.js. Fallbacks are provided only in standalone environments.
    const CandidateFilter = (typeof window !== 'undefined' && window.CandidateFilter) || class CandidateFilter {
        filter(candidates) { return candidates || []; }
    };
    const CompletionRanker = (typeof window !== 'undefined' && window.CompletionRanker) || class CompletionRanker {
        rank(candidates) { return candidates || []; }
    };
    const CandidateGenerator = (typeof window !== 'undefined' && window.CandidateGenerator) || class CandidateGenerator {
        async generate() { return []; }
    };

    /**
     * CompletionEngine - Primary Completion Service (Section 21, 22)
     */
    class CompletionEngine {
        constructor(dataProvider, metadataCache) {
            this.dataProvider = dataProvider || (window.AppIntelliSense ? window.AppIntelliSense.getDataProvider() : null);
            this.metadataCache = metadataCache || window.AppMetadataCache || null;
            const GeneratorClass = (typeof window !== 'undefined' && window.CandidateGenerator) || CandidateGenerator;
            const FilterClass = (typeof window !== 'undefined' && window.CandidateFilter) || CandidateFilter;
            const RankerClass = (typeof window !== 'undefined' && window.CompletionRanker) || CompletionRanker;
            this.generator = new GeneratorClass(this.dataProvider, this.metadataCache);
            this.filter = new FilterClass();
            this.ranker = new RankerClass();
            this._currentRequestId = 0;
        }

        setDataProvider(provider) {
            this.dataProvider = provider;
            this.generator.dataProvider = provider;
        }

        setMetadataCache(cache) {
            this.metadataCache = cache;
            this.generator.metadataCache = cache;
        }

        cancelPending() {
            this._currentRequestId++;
        }

        static cleanIdentifier(name) {
            if (!name) return "";
            name = name.trim();
            if (name.length === 0) return "";

            if (name.startsWith('[')) {
                if (name.endsWith(']')) {
                    return name.substring(1, name.length - 1).replace(/\]\]/g, ']');
                }
                return name.substring(1).replace(/\]\]/g, ']');
            }

            if (name.startsWith('"')) {
                if (name.endsWith('"') && name.length >= 2) {
                    return name.substring(1, name.length - 1).replace(/""/g, '"');
                }
                return name.substring(1).replace(/""/g, '"');
            }

            if (name.startsWith('`')) {
                if (name.endsWith('`') && name.length >= 2) {
                    return name.substring(1, name.length - 1).replace(/``/g, '`');
                }
                return name.substring(1).replace(/``/g, '`');
            }

            return name;
        }

        static needsQuoting(name, dialect = 'mssql') {
            if (!name) return false;
            const clean = name.trim();
            if (clean.length === 0) return false;

            if ((clean.startsWith('[') && clean.endsWith(']')) ||
                (clean.startsWith('"') && clean.endsWith('"')) ||
                (clean.startsWith('`') && clean.endsWith('`'))) {
                return false;
            }

            const isPg = (dialect === 'postgres' || dialect === 'postgresql' || dialect === 'pg');

            // PostgreSQL: unquoted identifiers fold to lowercase; any uppercase requires quoting
            if (isPg && /[A-Z]/.test(clean)) {
                return true;
            }

            // Starts with digit
            if (/^\d/.test(clean)) {
                return true;
            }

            // Non-standard characters or whitespace
            if (/[^a-zA-Z0-9_@$#]/.test(clean)) {
                return true;
            }

            // Reserved SQL keyword
            if (RESERVED_KEYWORDS.has(clean.toUpperCase())) {
                return true;
            }

            return false;
        }

        static quoteIdentifier(name, dialect = 'mssql') {
            if (!name) return "";
            const clean = name.trim();
            if ((clean.startsWith('[') && clean.endsWith(']')) ||
                (clean.startsWith('"') && clean.endsWith('"')) ||
                (clean.startsWith('`') && clean.endsWith('`'))) {
                return clean;
            }

            const isPg = (dialect === 'postgres' || dialect === 'postgresql' || dialect === 'pg');
            const isMysql = (dialect === 'mysql' || dialect === 'mariadb');

            if (isPg) {
                return `"${clean.replace(/"/g, '""')}"`;
            } else if (isMysql) {
                return `\`${clean.replace(/`/g, '``')}\``;
            } else {
                return `[${clean.replace(/\]/g, ']]')}]`;
            }
        }

        static generateTableAlias(tableName, existingAliases = new Set()) {
            if (!tableName) return 't';
            const clean = CompletionEngine.cleanIdentifier(tableName);
            // 1. Check PascalCase/camelCase with multiple capital letters (e.g. OrderDetails -> od)
            const caps = clean.match(/[A-Z]/g);
            let candidate = '';
            if (caps && caps.length >= 2) {
                candidate = caps.join('').toLowerCase();
            } else if (clean.includes('_')) {
                const parts = clean.split('_').filter(Boolean);
                if (parts.length >= 2) {
                    candidate = parts.map(p => p[0]).join('').toLowerCase();
                }
            }
            if (!candidate) {
                candidate = clean.charAt(0).toLowerCase();
            }
            if (!/^[a-z_]/i.test(candidate)) {
                candidate = 't';
            }

            const aliasSet = existingAliases instanceof Set 
                ? existingAliases 
                : new Set(Array.isArray(existingAliases) ? existingAliases.map(a => String(a).toLowerCase()) : []);

            let finalAlias = candidate;
            let counter = 2;
            while (aliasSet.has(finalAlias.toLowerCase())) {
                finalAlias = `${candidate}${counter}`;
                counter++;
            }
            return finalAlias;
        }

        static getFunctionSignature(name) {
            if (!name) return null;
            const upper = name.toUpperCase().trim();
            return FUNCTION_SIGNATURES[upper] || null;
        }

        getFunctionSignature(name) {
            return CompletionEngine.getFunctionSignature(name);
        }

        static getSignatureHelp(fullSql, cursorOffset, tabCtx) {
            if (window.SqlSignatureHelpResolver) {
                return window.SqlSignatureHelpResolver.resolve(fullSql, cursorOffset, tabCtx);
            }
            return null;
        }

        getSignatureHelp(fullSql, cursorOffset, tabCtx) {
            return CompletionEngine.getSignatureHelp(fullSql, cursorOffset, tabCtx);
        }

        static getHover(fullSql, cursorOffset, tabCtx) {
            if (window.SqlHoverResolver) {
                return window.SqlHoverResolver.resolve(fullSql, cursorOffset, tabCtx);
            }
            return null;
        }

        getHover(fullSql, cursorOffset, tabCtx) {
            return CompletionEngine.getHover(fullSql, cursorOffset, tabCtx);
        }

        static hashString(str) {
            if (!str) return '0';
            let hash = 5381;
            for (let i = 0; i < str.length; i++) {
                hash = ((hash << 5) + hash) + str.charCodeAt(i);
                hash |= 0;
            }
            return (hash >>> 0).toString(36);
        }

        static computeAliasSignature(aliasMap) {
            if (!aliasMap || typeof aliasMap !== 'object') return '';
            const keys = Object.keys(aliasMap).sort();
            return keys.map(k => {
                const val = aliasMap[k];
                const tbl = (val && (val.table || val.targetObject || val.name)) || '';
                const sch = (val && val.schema) || '';
                return `${k}:${sch}.${tbl}`;
            }).join(';');
        }

        async getCompletions(documentText, cursor, context, tabCtx) {
            if (context && !context.fullSql) {
                context.fullSql = documentText || '';
            }
            if (tabCtx) {
                if (!context.dbType && tabCtx.dbType) context.dbType = tabCtx.dbType;
                if (!context.connectionId && tabCtx.connectionId) context.connectionId = tabCtx.connectionId;
            }
            const requestId = ++this._currentRequestId;
            const wordLower = (context.currentWord || '').toLowerCase();
            const alterPart = context.isAlterContext ? `ALTER_${context.alterObjectType || ''}` : '';
            const execPart = (context.execContext && context.execContext.isExec) ? 'EXEC' : '';
            const tablesKey = (context.queryTables || []).map(t => (t.table || '').toLowerCase()).sort().join(',');

            // Issue I9: Statement text hash and aliasMap signature
            const stmtText = (context.fullSql && context.statementRange)
                ? context.fullSql.substring(context.statementRange.start, context.statementRange.end)
                : (context.fullSql || '');
            const stmtHash = CompletionEngine.hashString(stmtText);
            const aliasSig = CompletionEngine.computeAliasSignature(context.aliasMap);

            const dtPart = context.isDataTypePosition ? `DT_${context.dataTypeTarget || ''}` : '';
            const tabPrefix = tabCtx && tabCtx.tabId ? `${tabCtx.tabId}::` : '';
            const scopeKey = `${tabPrefix}${context.clause || 'DEFAULT'}::${tablesKey}::${stmtHash}::${aliasSig}::${context.qualifier || ''}::${alterPart}::${execPart}::${dtPart}::${context.resolvedObject ? context.resolvedObject.name : ''}`;

            // Level 3 Completion Memoization lookup (Issue I9: attach replacementRange per call, never reuse stale offsets from cache)
            if (this.metadataCache && typeof this.metadataCache.getCompletions === 'function') {
                const cached = this.metadataCache.getCompletions(tabCtx.connectionId, tabCtx.database, tabCtx.schema, scopeKey, wordLower);
                if (cached && Array.isArray(cached) && cached.length > 0) {
                    const result = [...cached];
                    result.rawCandidates = cached.rawCandidates || cached;
                    result.replacementRange = context.replacementRange || null;
                    result.prefixRange = context.prefixRange || null;
                    result.isTruncated = Boolean(cached.isTruncated);
                    result.meta = cached.meta || null;
                    return result;
                }
            }

            // Step 1: Generate Raw Candidates
            const rawCandidates = await this.generator.generate(context, tabCtx, wordLower);

            // Concurrency check
            if (requestId !== this._currentRequestId) {
                return null;
            }

            // Step 2: Multi-Stage Filtering (Exact -> Prefix -> Sub-Word -> Substring -> Fuzzy)
            const currentQuery = (context.currentWord || wordLower);
            const filtered = this.filter.filter(rawCandidates, currentQuery);

            // Step 3: Contextual Ranking (Clause, Scope, Match Quality, Types)
            const ranked = this.ranker.rank(filtered, context, currentQuery);
            if (ranked && Array.isArray(ranked)) {
                ranked.rawCandidates = rawCandidates;
                ranked.replacementRange = context.replacementRange || null;
                ranked.prefixRange = context.prefixRange || null;
                if (rawCandidates && rawCandidates.hasError) {
                    ranked.hasError = true;
                    ranked.meta = ranked.meta || {};
                    ranked.meta.errors = rawCandidates.meta ? rawCandidates.meta.errors : [];
                }
                if (ranked.meta) {
                    ranked.isTruncated = Boolean(ranked.meta.truncated);
                }
            }

            // Step 4: Level 3 Memoization Store (Do not cache if there were metadata errors)
            const hasErrors = Boolean(ranked && (ranked.hasError || (ranked.meta && ranked.meta.errors && ranked.meta.errors.length > 0)));
            if (!hasErrors && this.metadataCache && typeof this.metadataCache.setCompletions === 'function' && ranked && ranked.length > 0) {
                this.metadataCache.setCompletions(tabCtx.connectionId, tabCtx.database, tabCtx.schema, scopeKey, wordLower, ranked);
            }

            return ranked;
        }

        async expandStar(documentText, cursorOffset, context, tabCtx) {
            if (!context) {
                context = (window.SqlContextAnalyzer && typeof window.SqlContextAnalyzer.analyze === 'function')
                    ? window.SqlContextAnalyzer.analyze(documentText, cursorOffset, (tabCtx && tabCtx.dbType) ? tabCtx.dbType : '')
                    : { clause: 'SELECT', queryTables: [] };
            }
            return this.generator.expandStarColumns(context, tabCtx, context.qualifier || null);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. SIGNATURE HELP RESOLVER & MONACO PROVIDER (Phase 6 — Spec Section 11.6)
    // ─────────────────────────────────────────────────────────────────────────────
    class SqlSignatureHelpResolver {
        constructor(options = {}) {
            this.dataProvider = options.dataProvider || null;
            this.metadataCache = options.metadataCache || null;
        }

        setDataProvider(provider) {
            this.dataProvider = provider;
        }

        setMetadataCache(cache) {
            this.metadataCache = cache;
        }

        getDataProvider() {
            if (this.dataProvider) return this.dataProvider;
            if (window.DefaultCompletionEngine && window.DefaultCompletionEngine.dataProvider) {
                return window.DefaultCompletionEngine.dataProvider;
            }
            if (window.AppIntelliSense && window.AppIntelliSense.dataProvider) {
                return window.AppIntelliSense.dataProvider;
            }
            return null;
        }

        getMetadataCache() {
            if (this.metadataCache) return this.metadataCache;
            if (window.AppMetadataCache) return window.AppMetadataCache;
            return null;
        }

        getTabContext(overrideCtx = {}) {
            if (overrideCtx && (overrideCtx.connectionId || overrideCtx.database || overrideCtx.dbType)) {
                return overrideCtx;
            }
            if (window.AppIntelliSense && typeof window.AppIntelliSense.getActiveTabContext === 'function') {
                return window.AppIntelliSense.getActiveTabContext();
            }
            if (window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function') {
                const state = window.AppTabs.getActiveTabState();
                if (state) {
                    return {
                        connectionId: state.connectionId,
                        database: state.database,
                        schema: state.schema,
                        dbType: state.dbType || 'sqlserver'
                    };
                }
            }
            return {
                connectionId: window.ActiveConnectionId || null,
                database: window.ActiveDatabase || null,
                schema: window.ActiveSchema || null,
                dbType: window.ActiveDbType || 'sqlserver'
            };
        }

        cleanIdentifier(name) {
            if (!name) return '';
            return CompletionEngine.cleanIdentifier(name);
        }

        async resolve(fullSql, cursorOffset, tabCtx = {}) {
            if (!fullSql || typeof fullSql !== 'string' || cursorOffset == null || cursorOffset < 0) {
                return null;
            }
            if (cursorOffset > fullSql.length) {
                cursorOffset = fullSql.length;
            }

            const tokenizer = window.SqlTokenizer ? new window.SqlTokenizer() : null;
            if (!tokenizer) return null;

            const allTokens = tokenizer.tokenize(fullSql);
            if (!allTokens || allTokens.length === 0) return null;

            // 1. Check if cursor is inside comment or string literal
            for (let i = 0; i < allTokens.length; i++) {
                const tk = allTokens[i];
                if (tk.type === 'COMMENT_LINE' || tk.type === 'COMMENT_BLOCK' || tk.type === 'STRING') {
                    if (cursorOffset > tk.start && cursorOffset <= tk.end) {
                        return null; // Inside comment or string literal -> degrade gracefully
                    }
                }
            }

            // 2. Filter tokens strictly before cursor (excluding comments and whitespace)
            const tokensBefore = allTokens.filter(t => 
                t.start < cursorOffset && 
                t.type !== 'WHITESPACE' && 
                t.type !== 'COMMENT_LINE' && 
                t.type !== 'COMMENT_BLOCK'
            );
            if (tokensBefore.length === 0) return null;

            // 3. Scan for enclosing function call via parenthesis stack
            const nonFuncKeywords = new Set([
                'IN', 'VALUES', 'EXISTS', 'SELECT', 'WHERE', 'AND', 'OR', 'NOT', 
                'FROM', 'JOIN', 'ON', 'AS', 'SET', 'TABLE', 'VIEW', 'INDEX', 'BY', 
                'ORDER', 'GROUP', 'HAVING', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
                'INTO', 'UPDATE', 'DELETE', 'INSERT', 'CREATE', 'ALTER', 'DROP',
                'WITH', 'UNION', 'EXCEPT', 'INTERSECT'
            ]);

            const parenStack = [];
            for (let i = 0; i < tokensBefore.length; i++) {
                const tk = tokensBefore[i];
                if (tk.value === '(') {
                    let funcName = null;
                    let funcSchema = null;
                    const k = i - 1;
                    if (k >= 0 && (tokensBefore[k].type === 'IDENTIFIER' || tokensBefore[k].type === 'KEYWORD')) {
                        funcName = this.cleanIdentifier(tokensBefore[k].value);
                        if (k >= 2 && tokensBefore[k - 1].value === '.' &&
                            (tokensBefore[k - 2].type === 'IDENTIFIER' || tokensBefore[k - 2].type === 'KEYWORD')) {
                            funcSchema = this.cleanIdentifier(tokensBefore[k - 2].value);
                        }
                    }
                    const isFunc = Boolean(funcName && !nonFuncKeywords.has(funcName.toUpperCase()));
                    parenStack.push({
                        isFunc,
                        funcName: isFunc ? funcName : null,
                        funcSchema: isFunc ? funcSchema : null,
                        openIndex: tk.start,
                        commaCount: 0
                    });
                } else if (tk.value === ')') {
                    if (parenStack.length > 0) {
                        parenStack.pop();
                    }
                } else if (tk.value === ',') {
                    if (parenStack.length > 0) {
                        parenStack[parenStack.length - 1].commaCount++;
                    }
                }
            }

            // Find closest enclosing function call on the stack
            let activeFuncCall = null;
            for (let i = parenStack.length - 1; i >= 0; i--) {
                if (parenStack[i].isFunc) {
                    activeFuncCall = parenStack[i];
                    break;
                }
            }

            const effectiveTabCtx = this.getTabContext(tabCtx);

            // 4A. Function call found
            if (activeFuncCall) {
                const fnName = activeFuncCall.funcName;
                const fnSchema = activeFuncCall.funcSchema;
                const activeParamIdx = activeFuncCall.commaCount;
                const fnUpper = fnName.toUpperCase();

                // Check built-in function signatures first
                if (FUNCTION_SIGNATURES[fnUpper]) {
                    const info = FUNCTION_SIGNATURES[fnUpper];
                    const params = info.parameters || [];
                    const clamped = (params.length > 0) 
                        ? Math.max(0, Math.min(activeParamIdx, params.length - 1))
                        : 0;

                    return {
                        signatures: [{
                            label: info.signature,
                            documentation: info.documentation,
                            parameters: params,
                            activeParameter: clamped
                        }],
                        activeSignature: 0,
                        activeParameter: clamped
                    };
                }

                // Check User-Defined Function (UDF) via dataProvider
                const dataProvider = this.getDataProvider();
                if (dataProvider && typeof dataProvider.fetchParameters === 'function' && effectiveTabCtx.connectionId) {
                    try {
                        const uParams = await dataProvider.fetchParameters(
                            effectiveTabCtx.connectionId,
                            effectiveTabCtx.database,
                            fnSchema || effectiveTabCtx.schema,
                            fnName,
                            effectiveTabCtx.dbType
                        );
                        if (uParams && Array.isArray(uParams) && uParams.length > 0) {
                            const paramList = uParams.map(p => {
                                const pName = p.name.startsWith('@') ? p.name : `@${p.name}`;
                                const dt = p.data_type || 'any';
                                const dir = p.direction ? ` [${p.direction}]` : (p.is_output ? ' [OUTPUT]' : '');
                                return {
                                    label: pName,
                                    documentation: `Type: ${dt}${dir}${p.default_value ? ` | Default: ${p.default_value}` : ''}`
                                };
                            });
                            const sigLabel = `${fnSchema ? `${fnSchema}.` : ''}${fnName}(${uParams.map(p => `${p.name.startsWith('@') ? p.name : `@${p.name}`} ${p.data_type || ''}`).join(', ')})`;
                            const clamped = Math.max(0, Math.min(activeParamIdx, paramList.length - 1));

                            return {
                                signatures: [{
                                    label: sigLabel,
                                    documentation: `User-defined function ${fnSchema ? `${fnSchema}.` : ''}${fnName}`,
                                    parameters: paramList,
                                    activeParameter: clamped
                                }],
                                activeSignature: 0,
                                activeParameter: clamped
                            };
                        }
                    } catch (e) {
                        console.warn('[SignatureHelp] UDF parameters error:', e);
                    }
                }

                // Fallback for unknown function call
                return {
                    signatures: [{
                        label: `${fnName}(...)`,
                        documentation: `Function ${fnName}`,
                        parameters: [{
                            label: `arg${activeParamIdx + 1}`,
                            documentation: `Parameter ${activeParamIdx + 1} of ${fnName}`
                        }],
                        activeParameter: 0
                    }],
                    activeSignature: 0,
                    activeParameter: 0
                };
            }

            // 4B. Check EXEC / Stored Procedure context
            let execIdx = -1;
            for (let i = tokensBefore.length - 1; i >= 0; i--) {
                const up = tokensBefore[i].value.toUpperCase();
                if (up === 'EXEC' || up === 'EXECUTE') {
                    execIdx = i;
                    break;
                }
                if (tokensBefore[i].value === ';' || up === 'GO' ||
                    ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER'].includes(up)) {
                    break;
                }
            }

            if (execIdx !== -1) {
                let j = execIdx + 1;
                // Skip return status variable: EXEC @ret = proc
                if (j + 1 < tokensBefore.length && tokensBefore[j].value.startsWith('@') && tokensBefore[j + 1].value === '=') {
                    j += 2;
                }

                let parts = [];
                while (j < tokensBefore.length) {
                    const tk = tokensBefore[j];
                    if (tk.value === '.' || tk.type === 'IDENTIFIER' || tk.type === 'KEYWORD') {
                        if (tk.value !== '.') parts.push(this.cleanIdentifier(tk.value));
                        j++;
                        if (j < tokensBefore.length && tokensBefore[j].value === '.') {
                            j++;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }

                let procName = "";
                let procSchema = "";
                if (parts.length === 1) procName = parts[0];
                else if (parts.length >= 2) {
                    procSchema = parts[parts.length - 2];
                    procName = parts[parts.length - 1];
                }

                if (procName) {
                    // Tokens between proc name and cursor:
                    let commaCount = 0;
                    let lastNamedParam = null;
                    for (let k = j; k < tokensBefore.length; k++) {
                        const tk = tokensBefore[k];
                        if (tk.value === ',') {
                            commaCount++;
                        } else if (tk.value.startsWith('@') && k + 1 < tokensBefore.length && tokensBefore[k + 1].value === '=') {
                            lastNamedParam = tk.value;
                        }
                    }

                    const dataProvider = this.getDataProvider();
                    if (dataProvider && typeof dataProvider.fetchParameters === 'function' && effectiveTabCtx.connectionId) {
                        try {
                            const procParams = await dataProvider.fetchParameters(
                                effectiveTabCtx.connectionId,
                                effectiveTabCtx.database,
                                procSchema || effectiveTabCtx.schema,
                                procName,
                                effectiveTabCtx.dbType
                            );
                            if (procParams && Array.isArray(procParams) && procParams.length > 0) {
                                const paramList = procParams.map(p => {
                                    const pName = p.name.startsWith('@') ? p.name : `@${p.name}`;
                                    const dt = p.data_type || 'any';
                                    const dir = p.direction ? ` [${p.direction}]` : (p.is_output ? ' [OUTPUT]' : '');
                                    return {
                                        label: pName,
                                        documentation: `Type: ${dt}${dir}${p.default_value ? ` | Default: ${p.default_value}` : ''}`
                                    };
                                });

                                let activeParamIdx = commaCount;
                                if (lastNamedParam) {
                                    const matchIdx = procParams.findIndex(p => {
                                        const pn = p.name.startsWith('@') ? p.name : `@${p.name}`;
                                        return pn.toLowerCase() === lastNamedParam.toLowerCase();
                                    });
                                    if (matchIdx !== -1) activeParamIdx = matchIdx;
                                }
                                const clamped = Math.max(0, Math.min(activeParamIdx, paramList.length - 1));
                                const sigLabel = `EXEC ${procSchema ? `${procSchema}.` : ''}${procName} ${procParams.map(p => `${p.name.startsWith('@') ? p.name : `@${p.name}`} ${p.data_type || ''}${p.is_output ? ' OUTPUT' : ''}`).join(', ')}`;

                                return {
                                    signatures: [{
                                        label: sigLabel,
                                        documentation: `Stored procedure ${procSchema ? `${procSchema}.` : ''}${procName}`,
                                        parameters: paramList,
                                        activeParameter: clamped
                                    }],
                                    activeSignature: 0,
                                    activeParameter: clamped
                                };
                            }
                        } catch (e) {
                            console.warn('[SignatureHelp] Procedure parameters error:', e);
                        }
                    }
                }
            }

            return null;
        }

        registerMonacoProvider() {
            return SqlSignatureHelpResolver.registerMonacoProvider();
        }

        static registerMonacoProvider() {
            if (typeof monaco === 'undefined' || !monaco.languages || typeof monaco.languages.registerSignatureHelpProvider !== 'function') {
                return false;
            }
            if (window._sqlSignatureHelpRegistered) return true;
            window._sqlSignatureHelpRegistered = true;

            monaco.languages.registerSignatureHelpProvider('sql', {
                signatureHelpTriggerCharacters: ['(', ',', ' ', '@'],
                signatureHelpRetriggerCharacters: [',', ' ', '@'],
                provideSignatureHelp: async function (model, position, token, context) {
                    try {
                        if (!model) return null;
                        const fullSql = model.getValue();
                        const offset = model.getOffsetAt(position);
                        const resolver = window.SqlSignatureHelpResolver || 
                            (window.DefaultCompletionEngine && window.DefaultCompletionEngine.signatureResolver);
                        if (!resolver) return null;

                        const tabCtx = (typeof resolver.getTabContext === 'function') 
                            ? resolver.getTabContext() 
                            : {};

                        const result = await resolver.resolve(fullSql, offset, tabCtx);
                        if (!result || !result.signatures || result.signatures.length === 0) {
                            return null;
                        }

                        return {
                            value: result,
                            dispose: function () {}
                        };
                    } catch (err) {
                        console.warn('[SignatureHelpProvider] Error in provideSignatureHelp:', err);
                        return null;
                    }
                }
            });
            return true;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. HOVER RESOLVER & MONACO HOVER PROVIDER (Phase 7 — Spec Section 12.1)
    // ─────────────────────────────────────────────────────────────────────────────
    class SqlHoverResolver {
        constructor(options = {}) {
            this.dataProvider = options.dataProvider || null;
            this.metadataCache = options.metadataCache || null;
        }

        setDataProvider(provider) {
            this.dataProvider = provider;
        }

        setMetadataCache(cache) {
            this.metadataCache = cache;
        }

        setTabContext(ctx) {
            this.tabContext = ctx;
        }

        getDataProvider() {
            if (this.dataProvider) return this.dataProvider;
            if (window.DefaultCompletionEngine && window.DefaultCompletionEngine.dataProvider) {
                return window.DefaultCompletionEngine.dataProvider;
            }
            if (window.AppIntelliSense && window.AppIntelliSense.dataProvider) {
                return window.AppIntelliSense.dataProvider;
            }
            return null;
        }

        getMetadataCache() {
            if (this.metadataCache) return this.metadataCache;
            if (window.AppMetadataCache) return window.AppMetadataCache;
            return null;
        }

        getTabContext(overrideCtx = {}) {
            if (overrideCtx && (overrideCtx.connectionId || overrideCtx.database || overrideCtx.dbType)) {
                return overrideCtx;
            }
            if (this.tabContext && (this.tabContext.connectionId || this.tabContext.database)) {
                return this.tabContext;
            }
            if (window.AppIntelliSense && typeof window.AppIntelliSense.getActiveTabContext === 'function') {
                return window.AppIntelliSense.getActiveTabContext();
            }
            if (window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function') {
                const state = window.AppTabs.getActiveTabState();
                if (state) {
                    return {
                        connectionId: state.connectionId,
                        database: state.database,
                        schema: state.schema,
                        dbType: state.dbType || 'sqlserver'
                    };
                }
            }
            return {
                connectionId: window.ActiveConnectionId || null,
                database: window.ActiveDatabase || null,
                schema: window.ActiveSchema || null,
                dbType: window.ActiveDbType || 'sqlserver'
            };
        }

        cleanIdentifier(name) {
            if (!name) return '';
            return CompletionEngine.cleanIdentifier(name);
        }

        async resolve(fullSql, cursorOffset, tabCtx = {}) {
            if (!fullSql || typeof fullSql !== 'string' || cursorOffset == null || cursorOffset < 0) {
                return null;
            }
            if (cursorOffset > fullSql.length) {
                cursorOffset = fullSql.length;
            }

            const tokenizer = window.SqlTokenizer ? new window.SqlTokenizer() : null;
            if (!tokenizer) return null;

            const allTokens = tokenizer.tokenize(fullSql);
            if (!allTokens || allTokens.length === 0) return null;

            // 1. Locate token directly under cursor offset
            let targetTk = null;
            // Prefer exact character match in [start, end)
            for (let i = 0; i < allTokens.length; i++) {
                const tk = allTokens[i];
                if (cursorOffset >= tk.start && cursorOffset < tk.end) {
                    targetTk = tk;
                    break;
                }
            }

            // Boundary fallback (e.g. at end of word/token)
            if (!targetTk) {
                for (let i = 0; i < allTokens.length; i++) {
                    const tk = allTokens[i];
                    if (cursorOffset >= tk.start && cursorOffset <= tk.end) {
                        targetTk = tk;
                        if (tk.type !== 'WHITESPACE') {
                            break;
                        }
                    }
                }
            }

            if (!targetTk) return null;

            // Guard against whitespace, comments, strings, operators, and punctuation
            if (['WHITESPACE', 'COMMENT_LINE', 'COMMENT_BLOCK', 'STRING', 'PUNCTUATION', 'OPERATOR'].includes(targetTk.type)) {
                return null;
            }

            const rawWord = targetTk.value;
            const word = this.cleanIdentifier(rawWord);
            if (!word) return null;
            const wordLower = word.toLowerCase();
            const wordUpper = word.toUpperCase();

            const range = {
                startLine: targetTk.line,
                startCol: targetTk.col,
                endLine: targetTk.line,
                endCol: targetTk.col + rawWord.length
            };

            // 2. Identify neighbors in non-whitespace token stream
            const nonWs = allTokens.filter(t => t.type !== 'WHITESPACE' && t.type !== 'COMMENT_LINE' && t.type !== 'COMMENT_BLOCK');
            const idxInNonWs = nonWs.findIndex(t => t.start === targetTk.start);

            let qualifier = null;
            let schemaQualifier = null;
            let memberAfter = null;
            let isCall = false;
            let isExec = false;

            if (idxInNonWs >= 2 && nonWs[idxInNonWs - 1].value === '.') {
                qualifier = this.cleanIdentifier(nonWs[idxInNonWs - 2].value);
                if (idxInNonWs >= 4 && nonWs[idxInNonWs - 3].value === '.') {
                    schemaQualifier = this.cleanIdentifier(nonWs[idxInNonWs - 4].value);
                }
            }

            if (idxInNonWs + 2 < nonWs.length && nonWs[idxInNonWs + 1].value === '.') {
                memberAfter = this.cleanIdentifier(nonWs[idxInNonWs + 2].value);
            }

            if (idxInNonWs + 1 < nonWs.length && nonWs[idxInNonWs + 1].value === '(') {
                isCall = true;
            }

            if (idxInNonWs >= 1) {
                const prev1 = (nonWs[idxInNonWs - 1].upper || nonWs[idxInNonWs - 1].value).toUpperCase();
                if (prev1 === 'EXEC' || prev1 === 'EXECUTE') {
                    isExec = true;
                } else if (idxInNonWs >= 3 && nonWs[idxInNonWs - 1].value === '.') {
                    const prev3 = (nonWs[idxInNonWs - 3].upper || nonWs[idxInNonWs - 3].value).toUpperCase();
                    if (prev3 === 'EXEC' || prev3 === 'EXECUTE') {
                        isExec = true;
                    } else if (idxInNonWs >= 5 && nonWs[idxInNonWs - 3].value === '.') {
                        const prev5 = (nonWs[idxInNonWs - 5].upper || nonWs[idxInNonWs - 5].value).toUpperCase();
                        if (prev5 === 'EXEC' || prev5 === 'EXECUTE') {
                            isExec = true;
                        }
                    }
                }
            }

            // 3. Context, active query scope & caches
            let context = null;
            const effectiveTabCtx = this.getTabContext(tabCtx);
            if (window.SqlContextAnalyzer && typeof window.SqlContextAnalyzer.analyze === 'function') {
                context = window.SqlContextAnalyzer.analyze(fullSql, cursorOffset, (effectiveTabCtx && effectiveTabCtx.dbType) ? effectiveTabCtx.dbType : '');
            }
            const queryTables = (context && context.queryTables) ? context.queryTables : [];
            const activeScope = (context && context.activeScope) ? context.activeScope : null;
            const cache = this.getMetadataCache();
            const dataProvider = this.getDataProvider();

            // ─────────────────────────────────────────────────────────────────────
            // Category 1: Built-in SQL Function
            // ─────────────────────────────────────────────────────────────────────
            if (!qualifier && FUNCTION_SIGNATURES[wordUpper]) {
                const fnInfo = FUNCTION_SIGNATURES[wordUpper];
                const md = [
                    "```sql\n" + fnInfo.signature + "\n```",
                    "**Built-in SQL Function**\n\n" + (fnInfo.documentation || '')
                ].join('\n\n');
                return { range, contents: [{ value: md }] };
            }

            // ─────────────────────────────────────────────────────────────────────
            // Category 2: Alias in Scope
            // ─────────────────────────────────────────────────────────────────────
            let aliasSym = null;
            if (activeScope && activeScope.aliases && activeScope.aliases.has(wordLower)) {
                aliasSym = activeScope.aliases.get(wordLower);
            } else if (context && context.aliasMap && context.aliasMap[wordLower] && (context.aliasMap[wordLower].alias || '').toLowerCase() === wordLower) {
                const mapObj = context.aliasMap[wordLower];
                aliasSym = {
                    name: mapObj.table || mapObj.targetObject || mapObj.object || word,
                    schema: mapObj.schema || '',
                    type: mapObj.type || 'table',
                    columns: mapObj.columns || []
                };
            } else {
                const tblWithAlias = queryTables.find(t => (t.alias || '').toLowerCase() === wordLower && (t.table || '').toLowerCase() !== wordLower);
                if (tblWithAlias) {
                    aliasSym = {
                        name: tblWithAlias.table || tblWithAlias.targetObject || tblWithAlias.object || word,
                        schema: tblWithAlias.schema || '',
                        type: tblWithAlias.type || 'table',
                        columns: tblWithAlias.columns || []
                    };
                }
            }

            if (aliasSym) {
                const schemaPart = aliasSym.schema ? `[${aliasSym.schema}].` : '';
                let md = `**(Alias) ${word}** → \`${schemaPart}[${aliasSym.name}]\``;
                if (aliasSym.type === 'cte') {
                    md = `**(CTE Alias) ${word}** → \`${aliasSym.name}\``;
                    if (aliasSym.columns && aliasSym.columns.length > 0) {
                        md += `\n\nColumns: ${aliasSym.columns.map(c => `\`${c.name || c}\``).join(', ')}`;
                    }
                } else if (aliasSym.type === 'subquery' || aliasSym.type === 'apply_subquery' || aliasSym.type === 'lateral_subquery') {
                    const label = aliasSym.type === 'apply_subquery' ? 'APPLY Subquery Alias' : (aliasSym.type === 'lateral_subquery' ? 'LATERAL Subquery Alias' : 'Subquery Alias');
                    const targetInfo = (aliasSym.targetObject && aliasSym.targetObject !== word) ? ` → \`[${aliasSym.targetObject}]\`` : '';
                    md = `**(${label}) ${word}**${targetInfo}`;
                    if (aliasSym.columns && aliasSym.columns.length > 0) {
                        md += `\n\nColumns: ${aliasSym.columns.map(c => `\`${c.name || c}\``).join(', ')}`;
                    }
                }
                return { range, contents: [{ value: md }] };
            }

            // ─────────────────────────────────────────────────────────────────────
            // Category 3: Column Resolution (Qualified or Unqualified)
            // ─────────────────────────────────────────────────────────────────────
            if (qualifier) {
                // Case 3A: Qualified column (qualifier.word)
                let targetTbl = queryTables.find(t => 
                    (t.alias && t.alias.toLowerCase() === qualifier.toLowerCase()) ||
                    (t.table && t.table.toLowerCase() === qualifier.toLowerCase()) ||
                    (t.targetObject && t.targetObject.toLowerCase() === qualifier.toLowerCase())
                );

                if (!targetTbl && activeScope && typeof activeScope.resolve === 'function') {
                    const sym = activeScope.resolve(qualifier);
                    if (sym) {
                        targetTbl = sym.toContextObject();
                    }
                }

                if (targetTbl) {
                    const tblName = targetTbl.table || targetTbl.targetObject || targetTbl.object || targetTbl.name;
                    const schemaToUse = targetTbl.schema || effectiveTabCtx.schema || 'dbo';

                    // For persistent database tables/views, query cache and dataProvider for authoritative column types
                    let authoritativeCols = null;
                    if (targetTbl.server || targetTbl.sourceType === 'REMOTE_TABLE') {
                        const targetServer = targetTbl.server;
                        const targetDb = targetTbl.database || effectiveTabCtx.database;
                        if (cache && typeof cache.getRemoteColumns === 'function' && effectiveTabCtx.connectionId && tblName) {
                            authoritativeCols = cache.getRemoteColumns(effectiveTabCtx.connectionId, targetServer, targetDb, schemaToUse, tblName);
                        }
                        if ((!authoritativeCols || authoritativeCols.length === 0) && dataProvider && typeof dataProvider.getRemoteColumns === 'function' && effectiveTabCtx.connectionId && tblName) {
                            try {
                                authoritativeCols = await dataProvider.getRemoteColumns(effectiveTabCtx.connectionId, targetServer, targetDb, schemaToUse, tblName);
                            } catch (_) {}
                        }
                    } else {
                        if (cache && typeof cache.getColumns === 'function' && effectiveTabCtx.connectionId && tblName) {
                            authoritativeCols = cache.getColumns(effectiveTabCtx.connectionId, effectiveTabCtx.database, schemaToUse, tblName);
                            if ((!authoritativeCols || authoritativeCols.length === 0) && targetTbl.schema) {
                                authoritativeCols = cache.getColumns(effectiveTabCtx.connectionId, effectiveTabCtx.database, targetTbl.schema, tblName);
                            }
                        }
                        if ((!authoritativeCols || authoritativeCols.length === 0) && dataProvider && typeof dataProvider.fetchColumns === 'function' && effectiveTabCtx.connectionId && tblName) {
                            try {
                                authoritativeCols = await dataProvider.fetchColumns(effectiveTabCtx.connectionId, effectiveTabCtx.database, schemaToUse, tblName, effectiveTabCtx.dbType);
                            } catch (_) {}
                        }
                    }

                    const cols = (authoritativeCols && authoritativeCols.length > 0) ? authoritativeCols : (targetTbl.columns || []);
                    const col = (cols || []).find(c => (c.name || '').toLowerCase() === wordLower);

                    if (col) {
                        const dt = col.data_type || col.dataType || 'any';
                        const pkTag = (col.is_pk || col.isPk) ? ' `[PK]`' : '';
                        const fkTag = (col.is_fk || col.isFk) ? ' `[FK]`' : '';
                        const nullTag = (col.is_nullable === false || col.nullable === false) ? ' `NOT NULL`' : ' `NULL`';

                        let md = `**${tblName}.${col.name}** : \`${dt}\`${pkTag}${fkTag}${nullTag}`;

                        if (cache && typeof cache.getForeignKeys === 'function' && effectiveTabCtx.connectionId && tblName) {
                            let fks = cache.getForeignKeys(effectiveTabCtx.connectionId, effectiveTabCtx.database, schemaToUse, tblName) || [];
                            if (fks.length === 0 && targetTbl.schema) {
                                fks = cache.getForeignKeys(effectiveTabCtx.connectionId, effectiveTabCtx.database, targetTbl.schema, tblName) || [];
                            }
                            const matchFk = fks.find(f => (f.column || f.from_column || '').toLowerCase() === col.name.toLowerCase());
                            if (matchFk) {
                                const toTbl = matchFk.target_table || matchFk.to_table || '';
                                const toCol = matchFk.target_column || matchFk.to_column || '';
                                md += `\n\n*Foreign Key → [${toTbl}].[${toCol}]*`;
                            }
                        }

                        if (col.default_value) {
                            md += `\n\nDefault: \`${col.default_value}\``;
                        }
                        if (col.comment || col.description) {
                            md += `\n\n*${col.comment || col.description}*`;
                        }
                        return { range, contents: [{ value: md }] };
                    }
                }
            } else if (!memberAfter && !isCall) {
                // Case 3B: Unqualified column across queryTables in scope
                for (const t of queryTables) {
                    const tblName = t.table || t.targetObject || t.object || t.name;
                    const schemaToUse = t.schema || effectiveTabCtx.schema || 'dbo';

                    let authoritativeCols = null;
                    if (cache && typeof cache.getColumns === 'function' && effectiveTabCtx.connectionId && tblName) {
                        authoritativeCols = cache.getColumns(effectiveTabCtx.connectionId, effectiveTabCtx.database, schemaToUse, tblName);
                        if ((!authoritativeCols || authoritativeCols.length === 0) && t.schema) {
                            authoritativeCols = cache.getColumns(effectiveTabCtx.connectionId, effectiveTabCtx.database, t.schema, tblName);
                        }
                    }
                    if ((!authoritativeCols || authoritativeCols.length === 0) && dataProvider && typeof dataProvider.fetchColumns === 'function' && effectiveTabCtx.connectionId && tblName) {
                        try {
                            authoritativeCols = await dataProvider.fetchColumns(effectiveTabCtx.connectionId, effectiveTabCtx.database, schemaToUse, tblName, effectiveTabCtx.dbType);
                        } catch (_) {}
                    }

                    const cols = (authoritativeCols && authoritativeCols.length > 0) ? authoritativeCols : (t.columns || []);
                    const matchedCol = (cols || []).find(c => (c.name || '').toLowerCase() === wordLower);

                    if (matchedCol) {
                        const dt = matchedCol.data_type || matchedCol.dataType || 'any';
                        const pkTag = (matchedCol.is_pk || matchedCol.isPk) ? ' `[PK]`' : '';
                        const fkTag = (matchedCol.is_fk || matchedCol.isFk) ? ' `[FK]`' : '';
                        const nullTag = (matchedCol.is_nullable === false || matchedCol.nullable === false) ? ' `NOT NULL`' : ' `NULL`';

                        let md = `**${tblName}.${matchedCol.name}** : \`${dt}\`${pkTag}${fkTag}${nullTag}`;

                        if (cache && typeof cache.getForeignKeys === 'function' && effectiveTabCtx.connectionId && tblName) {
                            let fks = cache.getForeignKeys(effectiveTabCtx.connectionId, effectiveTabCtx.database, schemaToUse, tblName) || [];
                            if (fks.length === 0 && t.schema) {
                                fks = cache.getForeignKeys(effectiveTabCtx.connectionId, effectiveTabCtx.database, t.schema, tblName) || [];
                            }
                            const matchFk = fks.find(f => (f.column || f.from_column || '').toLowerCase() === matchedCol.name.toLowerCase());
                            if (matchFk) {
                                const toTbl = matchFk.target_table || matchFk.to_table || '';
                                const toCol = matchFk.target_column || matchFk.to_column || '';
                                md += `\n\n*Foreign Key → [${toTbl}].[${toCol}]*`;
                            }
                        }

                        if (matchedCol.default_value) {
                            md += `\n\nDefault: \`${matchedCol.default_value}\``;
                        }
                        if (matchedCol.comment || matchedCol.description) {
                            md += `\n\n*${matchedCol.comment || matchedCol.description}*`;
                        }
                        return { range, contents: [{ value: md }] };
                    }
                }
            }

            // ─────────────────────────────────────────────────────────────────────
            // Category 4: Table / View / CTE / Temp Table
            // ─────────────────────────────────────────────────────────────────────
            const matchedTbl = queryTables.find(t => 
                (t.table && t.table.toLowerCase() === wordLower) ||
                (t.targetObject && t.targetObject.toLowerCase() === wordLower)
            );

            if (matchedTbl) {
                const type = matchedTbl.type || 'table';
                const displayType = type.charAt(0).toUpperCase() + type.slice(1);
                const tblName = matchedTbl.table || matchedTbl.targetObject || matchedTbl.object || matchedTbl.name;
                const schemaToUse = matchedTbl.schema || effectiveTabCtx.schema || 'dbo';

                let authoritativeCols = null;
                if (cache && typeof cache.getColumns === 'function' && effectiveTabCtx.connectionId && tblName) {
                    authoritativeCols = cache.getColumns(effectiveTabCtx.connectionId, effectiveTabCtx.database, schemaToUse, tblName);
                    if ((!authoritativeCols || authoritativeCols.length === 0) && matchedTbl.schema) {
                        authoritativeCols = cache.getColumns(effectiveTabCtx.connectionId, effectiveTabCtx.database, matchedTbl.schema, tblName);
                    }
                }
                if ((!authoritativeCols || authoritativeCols.length === 0) && dataProvider && typeof dataProvider.fetchColumns === 'function' && effectiveTabCtx.connectionId && tblName) {
                    try {
                        authoritativeCols = await dataProvider.fetchColumns(effectiveTabCtx.connectionId, effectiveTabCtx.database, schemaToUse, tblName, effectiveTabCtx.dbType);
                    } catch (_) {}
                }

                const cols = (authoritativeCols && authoritativeCols.length > 0) ? authoritativeCols : (matchedTbl.columns || []);
                const pkCols = cols.filter(c => c.is_pk || c.isPk).map(c => c.name);

                let md = `**(${displayType}) ${schemaToUse ? `[${schemaToUse}].` : ''}[${tblName}]**`;
                if (cols.length > 0) {
                    md += `\n\nColumns (${cols.length})`;
                }
                if (pkCols.length > 0) {
                    md += ` | Primary Key: \`${pkCols.join(', ')}\``;
                }
                return { range, contents: [{ value: md }] };
            }

            // Check metadata catalog for objects (Table, View, Stored Procedure, UDF)
            if (cache && typeof cache.getObjects === 'function' && effectiveTabCtx.connectionId) {
                const schemaToUse = effectiveTabCtx.schema || 'dbo';
                const objs = cache.getObjects(effectiveTabCtx.connectionId, effectiveTabCtx.database, schemaToUse) || [];
                const obj = objs.find(o => (o.name || '').toLowerCase() === wordLower);
                if (obj) {
                    const displayType = obj.type ? (obj.type.charAt(0).toUpperCase() + obj.type.slice(1)) : 'Table';
                    let md = `**(${displayType}) ${obj.schema ? `[${obj.schema}].` : ''}[${obj.name}]**`;
                    return { range, contents: [{ value: md }] };
                }
            }

            // ─────────────────────────────────────────────────────────────────────
            // Category 5: Stored Procedure / User-Defined Function (UDF)
            // ─────────────────────────────────────────────────────────────────────
            if (isExec || isCall || (qualifier && !memberAfter)) {
                if (dataProvider && typeof dataProvider.fetchParameters === 'function' && effectiveTabCtx.connectionId) {
                    try {
                        const schemaToUse = qualifier || effectiveTabCtx.schema || 'dbo';
                        const params = await dataProvider.fetchParameters(
                            effectiveTabCtx.connectionId,
                            effectiveTabCtx.database,
                            schemaToUse,
                            word,
                            effectiveTabCtx.dbType
                        );
                        if (params && Array.isArray(params) && params.length > 0) {
                            const paramSig = params.map(p => {
                                const pName = p.name.startsWith('@') ? p.name : `@${p.name}`;
                                return `${pName} ${p.data_type || ''}${p.is_output ? ' OUTPUT' : ''}`;
                            }).join(', ');
                            const callPrefix = isExec ? 'EXEC ' : '';
                            const sigCode = `${callPrefix}${qualifier ? `${qualifier}.` : ''}${word} ${paramSig}`.trim();
                            const md = [
                                "```sql\n" + sigCode + "\n```",
                                `**${isExec ? 'Stored Procedure' : 'Function'}** \`${qualifier ? `${qualifier}.` : ''}${word}\``
                            ].join('\n\n');
                            return { range, contents: [{ value: md }] };
                        }
                    } catch (_) {}
                }
            }

            // ─────────────────────────────────────────────────────────────────────
            // Category 6: Variables (@var)
            // ─────────────────────────────────────────────────────────────────────
            if (word.startsWith('@') && activeScope) {
                const vSym = activeScope.resolve(word);
                if (vSym) {
                    const md = `**(Variable) ${word}**${vSym.dataType ? ` : \`${vSym.dataType}\`` : ''}`;
                    return { range, contents: [{ value: md }] };
                }
            }

            return null;
        }

        static registerMonacoProvider() {
            if (typeof monaco === 'undefined' || !monaco.languages || typeof monaco.languages.registerHoverProvider !== 'function') {
                return false;
            }
            if (window._sqlHoverProviderRegistered) return true;
            window._sqlHoverProviderRegistered = true;

            monaco.languages.registerHoverProvider('sql', {
                provideHover: async function (model, position, token) {
                    try {
                        if (!model) return null;
                        const fullSql = model.getValue();
                        const offset = model.getOffsetAt(position);
                        const resolver = window.SqlHoverResolver || 
                            (window.DefaultCompletionEngine && window.DefaultCompletionEngine.hoverResolver);
                        if (!resolver) return null;

                        const tabCtx = (typeof resolver.getTabContext === 'function') 
                            ? resolver.getTabContext() 
                            : {};

                        const result = await resolver.resolve(fullSql, offset, tabCtx);
                        if (!result || !result.contents || result.contents.length === 0) {
                            return null;
                        }

                        let range = undefined;
                        if (result.range && typeof monaco !== 'undefined' && monaco.Range) {
                            range = new monaco.Range(
                                result.range.startLine,
                                result.range.startCol,
                                result.range.endLine,
                                result.range.endCol
                            );
                        }

                        return {
                            range: range,
                            contents: result.contents.map(c => typeof c === 'string' ? { value: c } : c)
                        };
                    } catch (err) {
                        console.warn('[HoverProvider] Error in provideHover:', err);
                        return null;
                    }
                }
            });
            return true;
        }

        registerMonacoProvider() {
            return SqlHoverResolver.registerMonacoProvider();
        }
    }

    // Auto-register Monaco Hover Provider when ready
    if (typeof window._onMonacoReady === 'function') {
        window._onMonacoReady(() => {
            SqlSignatureHelpResolver.registerMonacoProvider();
            SqlHoverResolver.registerMonacoProvider();
        });
    } else if (typeof monaco !== 'undefined' && monaco.languages) {
        SqlSignatureHelpResolver.registerMonacoProvider();
        SqlHoverResolver.registerMonacoProvider();
    }

    // Export singleton instance, signatures, and classes
    const defaultEngine = new CompletionEngine();
    const SigResolverClass = (typeof window !== 'undefined' && window.SqlSignatureHelpResolverClass) || SqlSignatureHelpResolver;
    const HoverResolverClass = (typeof window !== 'undefined' && window.SqlHoverResolverClass) || SqlHoverResolver;
    const signatureResolver = (typeof window !== 'undefined' && window.SqlSignatureHelpResolver) || new SigResolverClass();
    const hoverResolver = (typeof window !== 'undefined' && window.SqlHoverResolver) || new HoverResolverClass();
    defaultEngine.signatureResolver = signatureResolver;
    defaultEngine.hoverResolver = hoverResolver;

    CompletionEngine.invalidate = function (connId, database) {
        if (typeof window !== 'undefined') {
            if (window.AppMetadataCache) {
                if (database && typeof window.AppMetadataCache.invalidateDatabase === 'function') {
                    window.AppMetadataCache.invalidateDatabase(connId, database);
                } else if (typeof window.AppMetadataCache.invalidateConnection === 'function') {
                    window.AppMetadataCache.invalidateConnection(connId);
                }
            }
            if (window.AppIntelliSense && window.AppIntelliSense.dataProvider) {
                if (database && typeof window.AppIntelliSense.dataProvider.invalidateDatabase === 'function') {
                    window.AppIntelliSense.dataProvider.invalidateDatabase(connId, database);
                } else if (typeof window.AppIntelliSense.dataProvider.invalidateConnection === 'function') {
                    window.AppIntelliSense.dataProvider.invalidateConnection(connId);
                }
            }
        }
    };

    window.SqlFunctionSignatures = FUNCTION_SIGNATURES;
    if (!window.CandidateFilter) window.CandidateFilter = CandidateFilter;
    if (!window.CompletionRanker) window.CompletionRanker = CompletionRanker;
    if (!window.CandidateGenerator) window.CandidateGenerator = CandidateGenerator;
    window.CompletionEngine = CompletionEngine;
    window.DefaultCompletionEngine = defaultEngine;
    window.SqlSignatureHelpResolver = signatureResolver;
    window.SqlHoverResolver = hoverResolver;
    window.SqlSignatureHelpResolverClass = SigResolverClass;
    window.SqlHoverResolverClass = HoverResolverClass;

})(typeof window !== 'undefined' ? window : globalThis);

