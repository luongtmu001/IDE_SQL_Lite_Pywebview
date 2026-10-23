/**
 * sql-function-signatures.js - SQL Built-in Function Signatures & Documentation
 */
(function(window) {
    'use strict';

    const RESERVED_KEYWORDS = new Set([
        'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER',
        'ON', 'GROUP', 'HAVING', 'ORDER', 'BY', 'UNION', 'ALL', 'INTERSECT', 'EXCEPT',
        'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'TRUNCATE', 'MERGE',
        'CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX', 'PROCEDURE', 'PROC', 'FUNCTION',
        'TRIGGER', 'SCHEMA', 'DATABASE', 'DEFAULT', 'CHECK', 'CONSTRAINT', 'PRIMARY', 'KEY',
        'FOREIGN', 'REFERENCES', 'IDENTITY', 'NULL', 'NOT', 'AND', 'OR', 'AS', 'DISTINCT',
        'TOP', 'LIMIT', 'OFFSET', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'OVER', 'WITH',
        'EXEC', 'EXECUTE', 'CALL', 'USER', 'FILE', 'COLUMN', 'DECLARE', 'ROWCOUNT', 'STATUS',
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

    /**
     * CandidateFilter - Multi-Stage Candidate Filtering (Section 31)
     * CandidateFilter - Multi-Stage Candidate Filtering (Section 31 & Spec 11.2)
     * Exact Prefix -> Prefix -> Sub-Word -> Substring -> Fuzzy
     */

    window.SqlFunctionSignatures = FUNCTION_SIGNATURES;
    window.SqlReservedKeywords = RESERVED_KEYWORDS;
    window.SqlParameterDocs = PARAMETER_DOCS;
})(typeof window !== 'undefined' ? window : globalThis);
