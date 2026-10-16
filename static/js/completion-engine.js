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

    /**
     * CandidateFilter - Multi-Stage Candidate Filtering (Section 31)
     * CandidateFilter - Multi-Stage Candidate Filtering (Section 31 & Spec 11.2)
     * Exact Prefix -> Prefix -> Sub-Word -> Substring -> Fuzzy
     */
    class CandidateFilter {
        constructor(options = {}) {
            this.fuzzyThreshold = options.fuzzyThreshold || 2; // Min chars to activate fuzzy search
            this.maxPrefixToSkipFuzzy = options.maxPrefixToSkipFuzzy || 8; // If prefix matches >= 8, skip fuzzy to avoid noise
        }

        static splitSubWords(candidateName) {
            if (!candidateName || typeof candidateName !== 'string') return [];
            let clean = candidateName.trim();
            // Strip surrounding quotes or brackets
            if ((clean.startsWith('[') && clean.endsWith(']')) ||
                (clean.startsWith('"') && clean.endsWith('"')) ||
                (clean.startsWith('`') && clean.endsWith('`'))) {
                clean = clean.substring(1, clean.length - 1);
            }
            // Strip leading # or @
            clean = clean.replace(/^[#@]+/, '');
            if (!clean) return [];

            // Normalize Unicode (NFC) per Spec 11.2
            try {
                clean = clean.normalize('NFC');
            } catch (_) {}

            // Split by punctuation / separators: underscores, hyphens, spaces, dots
            const chunks = clean.split(/[-_\s.]+/).filter(Boolean);
            const subWords = [];

            for (const chunk of chunks) {
                // Split camelCase, PascalCase, and Acronyms within each chunk
                // E.g. "XMLParser" -> ["XML", "Parser"]
                // E.g. "CustomerId" -> ["Customer", "Id"]
                // E.g. "getHTTPResponseCode" -> ["get", "HTTP", "Response", "Code"]
                // E.g. "col1Name" -> ["col1", "Name"]
                let parts;
                try {
                    parts = chunk
                        .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, '$1 $2')
                        .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
                        .split(/\s+/)
                        .filter(Boolean);
                } catch (_) {
                    parts = chunk
                        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
                        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                        .split(/\s+/)
                        .filter(Boolean);
                }

                for (const p of parts) {
                    subWords.push({
                        raw: p,
                        lower: p.toLowerCase()
                    });
                }
            }

            return subWords;
        }

        splitSubWords(candidateName) {
            return CandidateFilter.splitSubWords(candidateName);
        }

        matchExact(candidateName, query) {
            return candidateName.toLowerCase() === query.toLowerCase();
        }

        matchPrefix(candidateName, query) {
            return candidateName.toLowerCase().startsWith(query.toLowerCase());
        }

        matchSubWord(candidateName, query) {
            if (!candidateName || !query) return null;
            const rawQuery = String(query).trim();
            if (rawQuery.length < 2) return null; // Single-char queries are prefix matches
            const queryLower = rawQuery.toLowerCase();

            // Clean candidate name (strip quotes, @, #)
            let cleanCandidate = candidateName.trim();
            if ((cleanCandidate.startsWith('[') && cleanCandidate.endsWith(']')) ||
                (cleanCandidate.startsWith('"') && cleanCandidate.endsWith('"')) ||
                (cleanCandidate.startsWith('`') && cleanCandidate.endsWith('`'))) {
                cleanCandidate = cleanCandidate.substring(1, cleanCandidate.length - 1);
            }
            cleanCandidate = cleanCandidate.replace(/^[#@]+/, '');
            const candidateLower = cleanCandidate.toLowerCase();

            // If query is already a full prefix of the entire candidate, let matchPrefix handle it
            if (candidateLower.startsWith(queryLower)) {
                return null;
            }

            const subWords = CandidateFilter.splitSubWords(cleanCandidate);
            if (!subWords || subWords.length < 2) return null;

            // Recursive search: partition query across sub-word prefixes
            function search(wordIdx, qIdx, matchedWordsCount, caseMatchesCount, skippedWordsCount) {
                if (qIdx === queryLower.length) {
                    return {
                        matchedWordsCount,
                        caseMatchesCount,
                        skippedWordsCount
                    };
                }

                if (wordIdx >= subWords.length) {
                    return null;
                }

                const currentWord = subWords[wordIdx];
                const firstCharQ = queryLower[qIdx];
                let best = null;

                // Option 1: Match prefix of currentWord starting with query[qIdx]
                if (currentWord.lower[0] === firstCharQ) {
                    const maxL = Math.min(currentWord.lower.length, queryLower.length - qIdx);
                    for (let L = maxL; L >= 1; L--) {
                        const qSlice = queryLower.substring(qIdx, qIdx + L);
                        if (currentWord.lower.startsWith(qSlice)) {
                            let caseBonus = 0;
                            if (rawQuery[qIdx] === currentWord.raw[0]) {
                                caseBonus++;
                            }
                            const res = search(wordIdx + 1, qIdx + L, matchedWordsCount + 1, caseMatchesCount + caseBonus, skippedWordsCount);
                            if (res) {
                                if (!best || res.skippedWordsCount < best.skippedWordsCount || res.caseMatchesCount > best.caseMatchesCount) {
                                    best = res;
                                }
                                if (best && best.skippedWordsCount === 0 && best.caseMatchesCount > 0) {
                                    return best;
                                }
                            }
                        }
                    }
                }

                // Option 2: Skip currentWord
                const remainingWords = subWords.length - (wordIdx + 1);
                const remainingChars = queryLower.length - qIdx;
                if (remainingWords >= remainingChars || (remainingWords > 0 && matchedWordsCount > 0)) {
                    const resSkip = search(wordIdx + 1, qIdx, matchedWordsCount, caseMatchesCount, skippedWordsCount + (matchedWordsCount > 0 ? 1 : 0));
                    if (resSkip) {
                        if (!best || resSkip.skippedWordsCount < best.skippedWordsCount || resSkip.caseMatchesCount > best.caseMatchesCount) {
                            best = resSkip;
                        }
                    }
                }

                return best;
            }

            const matchResult = search(0, 0, 0, 0, 0);
            if (!matchResult || matchResult.matchedWordsCount < 2) {
                return null;
            }

            // Calculate Sub-Word score strictly between 72 and 79
            // (Strictly higher than Substring 50-70, strictly lower than Prefix 80-95)
            let score = 75; // Baseline sub-word score

            // Consecutive words bonus
            if (matchResult.skippedWordsCount === 0) {
                score += 2;
            } else {
                score -= Math.min(3, matchResult.skippedWordsCount);
            }

            // Case-match bonus (e.g. cO or CO matching CustomerOrder)
            if (matchResult.caseMatchesCount > 0) {
                score += Math.min(2, matchResult.caseMatchesCount);
            }

            // Coverage ratio bonus
            const coverageRatio = queryLower.length / Math.max(queryLower.length, subWords.length);
            score += Math.round(coverageRatio * 1);

            return Math.max(72, Math.min(79, score));
        }

        matchSubstring(candidateName, query) {
            return candidateName.toLowerCase().includes(query.toLowerCase());
        }

        matchFuzzy(candidateName, query) {
            if (!query) return 100;
            const target = candidateName.toLowerCase();
            const pattern = query.toLowerCase();

            let targetIdx = 0;
            let patternIdx = 0;
            let consecutiveMatches = 0;
            let totalGaps = 0;
            let matchedFirstChar = false;

            while (targetIdx < target.length && patternIdx < pattern.length) {
                if (target[targetIdx] === pattern[patternIdx]) {
                    if (patternIdx === 0 && targetIdx === 0) matchedFirstChar = true;
                    if (targetIdx > 0 && target[targetIdx - 1] === pattern[patternIdx - 1]) {
                        consecutiveMatches++;
                    }
                    patternIdx++;
                } else if (patternIdx > 0) {
                    totalGaps++;
                }
                targetIdx++;
            }

            if (patternIdx < pattern.length) return -1; // Not all pattern chars found

            let score = 40;
            if (matchedFirstChar) score += 20;
            score += Math.min(20, consecutiveMatches * 5);
            score -= Math.min(25, totalGaps * 2);
            return Math.max(10, score);
        }

        filter(candidates, query = '') {
            if (!candidates || !Array.isArray(candidates)) return [];
            const rawQuery = String(query || '').trim();
            const cleanQuery = rawQuery.toLowerCase();

            if (!cleanQuery) {
                return candidates.map(c => ({
                    ...c,
                    _matchType: 'all',
                    _matchScore: 50
                }));
            }

            const prefixMatches = [];
            const subwordMatches = [];
            const substringMatches = [];
            const fuzzyMatches = [];

            candidates.forEach(item => {
                const name = item.name || item.label || '';
                const nameLower = name.toLowerCase();

                // Also check with leading #, @ and delimiters [, ", ` stripped for friendly matching
                const stripDelims = (s) => (s || '').replace(/^[\["`#@]+|[\]"`]+$/g, '');
                const nameClean = stripDelims(nameLower);
                const queryClean = stripDelims(cleanQuery);

                // Phase 9: Star Expansion query matching (*, expand, all, star, columns)
                if (item.type === 'star_expansion') {
                    if (cleanQuery === '*' || 'expand'.startsWith(cleanQuery) || 'columns'.startsWith(cleanQuery) || 'all'.startsWith(cleanQuery) || 'star'.startsWith(cleanQuery)) {
                        prefixMatches.push({
                            ...item,
                            _matchType: cleanQuery === '*' ? 'exact' : 'prefix',
                            _matchScore: cleanQuery === '*' ? 100 : 88
                        });
                        return;
                    }
                }

                // 1. Exact match
                if (nameLower === cleanQuery || (queryClean && nameClean === queryClean)) {
                    prefixMatches.push({
                        ...item,
                        _matchType: 'exact',
                        _matchScore: 100
                    });
                    return;
                }

                // 2. Prefix match
                if (nameLower.startsWith(cleanQuery) || (queryClean && nameClean.startsWith(queryClean))) {
                    const ratio = queryClean ? (queryClean.length / nameClean.length) : (cleanQuery.length / nameLower.length);
                    prefixMatches.push({
                        ...item,
                        _matchType: 'prefix',
                        _matchScore: 80 + Math.round(ratio * 15)
                    });
                    return;
                }

                // 2b. Phase 8: Sub-Word Match (PascalCase / camelCase / snake_case)
                // e.g. 'cid' -> 'CustomerId', 'odi' -> 'order_detail_id', 'co' -> 'CustomerOrder'
                const subwordScore = this.matchSubWord(name, rawQuery);
                if (subwordScore !== null && subwordScore > 0) {
                    subwordMatches.push({
                        ...item,
                        _matchType: 'subword',
                        _matchScore: subwordScore
                    });
                    return;
                }

                // 3. Substring match
                const subIdx = nameLower.indexOf(cleanQuery);
                if (subIdx !== -1) {
                    substringMatches.push({
                        ...item,
                        _matchType: 'substring',
                        _matchScore: Math.max(50, 70 - subIdx * 2)
                    });
                    return;
                }

                // 4. Fuzzy match (only if query length >= fuzzyThreshold)
                if (cleanQuery.length >= this.fuzzyThreshold) {
                    const fuzzyScore = this.matchFuzzy(name, cleanQuery);
                    if (fuzzyScore > 0) {
                        fuzzyMatches.push({
                            ...item,
                            _matchType: 'fuzzy',
                            _matchScore: fuzzyScore
                        });
                    }
                }
            });

            if (prefixMatches.length >= this.maxPrefixToSkipFuzzy) {
                return prefixMatches;
            }

            return [...prefixMatches, ...subwordMatches, ...substringMatches, ...fuzzyMatches];
        }
    }

    /**
     * CompletionRanker - Contextual Ranking Engine (Section 30)
     * Weighs context, clause, scope, qualifier, and match quality
     */
    class CompletionRanker {
        rank(items, context = {}, query = '') {
            if (!items || !Array.isArray(items)) return [];
            const cleanQuery = String(query || '').trim().toLowerCase();

            // Phase 3: Visibility Filter - in WHERE and HAVING, hide aliases of the SELECT list (Spec 8.2 & 8.3)
            let candidatesToRank = items;
            if (context.clause === 'WHERE' || context.clause === 'HAVING') {
                candidatesToRank = items.filter(it => (it.type || it.kind) !== 'select_alias');
            }

            // Phase 4: DML alreadyListed filter (INSERT columns & UPDATE SET)
            const isInsertCols = Boolean(context.isInsertColumns || context.clause === 'INSERT_COLUMNS');
            const isUpdateSet = Boolean(context.isUpdateSet || (context.clause === 'SET' && !context.isUpdateSetValue));
            if ((isInsertCols || isUpdateSet) && context.alreadyListed && context.alreadyListed.length > 0) {
                const alreadySet = new Set(context.alreadyListed.map(s => s.toLowerCase()));
                candidatesToRank = candidatesToRank.filter(it => !alreadySet.has((it.name || '').toLowerCase()));
            }

            // Deduplicate items by (nameLower::type)
            const seen = new Set();
            const unique = [];

            candidatesToRank.forEach(item => {
                const name = item.name || item.label || '';
                const type = item.type || item.kind || 'unknown';
                const key = `${name.toLowerCase()}::${type}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(item);
                }
            });

            const isFromClause = (context.clause === 'FROM' || context.clause === 'JOIN');
            const isDmlTableClause = (context.clause === 'INSERT INTO' || context.clause === 'UPDATE' || context.contextType === 'table');
            const isSelectClause = (context.clause === 'SELECT' || context.clause === 'RETURNING' || context.clause === 'OUTPUT');
            const isWhereClause = (context.clause === 'WHERE' || context.clause === 'ON' || context.clause === 'HAVING');
            const isOrderClause = (context.clause === 'ORDER BY' || context.clause === 'GROUP BY');
            const isExecClause = (context.clause === 'EXEC' || context.clause === 'EXECUTE');
            const isVarTrigger = (context.currentWord && context.currentWord.startsWith('@')) || context.triggerChar === '@';

            // Calculate contextual rank score for each item
            unique.forEach(item => {
                let contextScore = 0;
                const type = item.type || item.kind || '';

                // 1. ALTER context priority
                if (context.isAlterContext && context.alterObjectType) {
                    if (type === context.alterObjectType) {
                        contextScore += 100;
                    } else if (type === 'schema') {
                        contextScore += 75;
                    }
                }

                // 2. FROM / JOIN / INSERT INTO / UPDATE clause priorities (Section 25, 26, 39, Phase 4 DML)
                if ((isFromClause || isDmlTableClause) && !context.qualifier) {
                    if (['table', 'view', 'cte', 'subquery', 'apply_subquery', 'lateral_subquery', 'table_function', 'temp_table', 'table_variable', 'synonym', 'pseudo_table', 'linked_server', 'foreign_server'].includes(type)) {
                        contextScore += (type === 'cte' || type === 'pseudo_table') ? 85 : 80;
                    } else if (type === 'schema') {
                        contextScore += 75;
                    } else if (isFromClause && type === 'keyword' && ['JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'WHERE'].includes(item.name.toUpperCase())) {
                        contextScore += 30;
                    } else if (isDmlTableClause && type === 'keyword') {
                        contextScore -= 40;
                    }
                }

                // 3. SELECT / WHERE / ON / ORDER BY clause priorities (Section 24, 27, 28, 47)
                if ((isSelectClause || isWhereClause || isOrderClause) && !context.qualifier) {
                    if (type === 'star_expansion') {
                        contextScore += 85;
                    } else if (type === 'scalar_variable') {
                        contextScore += isWhereClause ? 80 : 65;
                    } else if (type === 'pk_column') {
                        contextScore += 75;
                    } else if (type === 'column') {
                        contextScore += 70;
                    } else if (type === 'table_variable' || type === 'temp_table') {
                        contextScore += 50;
                    } else if (type === 'sql_function' || type === 'function') {
                        contextScore += isWhereClause ? 45 : 30;
                    }
                }

                // 3b. Routine Body / Non-clause Expression priority (PL/pgSQL assignments, returns, conditionals)
                if (!context.clause && !context.qualifier) {
                    if (type === 'scalar_variable') {
                        contextScore += 70;
                    } else if (type === 'linked_server' || type === 'foreign_server') {
                        contextScore += 75;
                    }
                }

                // 4. EXEC clause priority (Section 29, 51)
                if (isExecClause) {
                    if (context.execContext && context.execContext.isParameterPosition) {
                        if (type === 'parameter') {
                            contextScore += 110;
                        } else if (type === 'scalar_variable') {
                            contextScore += 90;
                        }
                    } else {
                        if (type === 'procedure' || type === 'stored_procedure') {
                            contextScore += 95;
                        } else if (type === 'schema') {
                            contextScore += 85;
                        } else if (type === 'linked_server' || type === 'foreign_server') {
                            contextScore += 80;
                        }
                    }
                }

                // 4b. Variable trigger priority (user typed '@')
                if (isVarTrigger) {
                    if (type === 'parameter') {
                        contextScore += 105;
                    } else if (type === 'scalar_variable') {
                        contextScore += 95;
                    } else if (type === 'table_variable') {
                        contextScore += 75;
                    }
                }

                // 4b2. Temp Table trigger priority (user typed '#')
                const isTempTrigger = (context.currentWord && context.currentWord.startsWith('#')) || context.triggerChar === '#';
                if (isTempTrigger) {
                    if (type === 'temp_table') {
                        contextScore += 120;
                    }
                }

                // 4c. Strict ALTER Context priority (SQL Prompt style)
                if (context.isAlterContext && context.alterObjectType && type === context.alterObjectType) {
                    contextScore += 100;
                }

                // 4d. Snippet Priority: When user types snippet prefix, prioritize snippets at the top!
                if (type === 'snippet') {
                    if (item.displayType === 'FK Join Snippet') {
                        contextScore += 270; // Top snippet in JOIN clause (#1 over raw tables)!
                    } else {
                        const snipName = (item.name || '').toLowerCase();
                        if (cleanQuery && snipName === cleanQuery) {
                            contextScore += 160; // Exact snippet prefix match -> #1
                        } else if (cleanQuery && snipName.startsWith(cleanQuery)) {
                            contextScore += 130; // Prefix snippet match -> top priority above keywords
                        } else {
                            contextScore += 50;
                        }
                    }
                }

                // Phase 5: JOIN & ON Clause Priorities (Spec 11.4)
                if (type === 'join_condition') {
                    contextScore += 280; // #1 candidate in ON clause!
                }
                if (item.isFkTarget) {
                    contextScore += 180; // Boost FK-related tables to the top in JOIN clause!
                }

                // Phase 3: ORDER BY & GROUP BY Select Alias Visibility
                if (context.clause === 'ORDER BY' || context.clause === 'GROUP BY') {
                    if (type === 'select_alias') {
                        contextScore += 120; // Top priority in ORDER BY!
                    }
                }

                // Phase 4: DML INSERT_COLUMNS & UPDATE SET Priorities
                if (isInsertCols) {
                    if (type === 'pk_column' || type === 'column') {
                        contextScore += 110; // Top priority in INSERT column list!
                    } else if (type === 'keyword') {
                        contextScore -= 40;
                    }
                } else if (isUpdateSet) {
                    if (type === 'pk_column' || type === 'column') {
                        contextScore += 100; // Top priority in UPDATE SET column list!
                    } else if (type === 'keyword') {
                        contextScore -= 40; // Demote keywords so target columns appear first
                    }
                }

                // Phase 4: Data Type Context Priorities (Issue I3)
                if (context.isDataTypePosition || context.contextType === 'data_type') {
                    if (type === 'data_type') {
                        contextScore += 200;
                        const itemName = (item.name || '').toLowerCase();
                        if (context.dataTypeTarget === 'CONVERT') {
                            if (itemName === 'varchar') contextScore += 60;
                            else if (itemName === 'int') contextScore += 50;
                            else if (itemName === 'datetime') contextScore += 40;
                            else if (itemName === 'nvarchar') contextScore += 35;
                            else if (itemName === 'decimal') contextScore += 30;
                        } else if (context.dataTypeTarget === 'CAST') {
                            if (itemName === 'int') contextScore += 60;
                            else if (itemName === 'varchar') contextScore += 50;
                            else if (itemName === 'bigint') contextScore += 40;
                            else if (itemName === 'decimal') contextScore += 35;
                            else if (itemName === 'datetime') contextScore += 30;
                        } else if (context.dataTypeTarget === 'DECLARE') {
                            if (itemName === 'int') contextScore += 60;
                            else if (itemName === 'varchar') contextScore += 50;
                            else if (itemName === 'bigint') contextScore += 40;
                            else if (itemName === 'bit') contextScore += 35;
                            else if (itemName === 'nvarchar') contextScore += 30;
                        } else if (context.dataTypeTarget === 'PG_CAST') {
                            if (itemName === 'integer') contextScore += 60;
                            else if (itemName === 'text') contextScore += 50;
                            else if (itemName === 'numeric') contextScore += 40;
                            else if (itemName === 'varchar') contextScore += 35;
                            else if (itemName === 'boolean') contextScore += 30;
                        } else {
                            if (['int', 'integer', 'varchar', 'bigint', 'text'].includes(itemName)) {
                                contextScore += 30;
                            }
                        }
                    } else {
                        contextScore -= 100;
                    }
                }

                // 5. Qualifier Priority (Section 24, 39, 40, 46)
                if (context.qualifier) {
                    if (type === 'star_expansion') {
                        contextScore += 100;
                    } else if (type === 'pk_column') {
                        contextScore += 95;
                    } else if (type === 'column' || type === 'remote_column') {
                        contextScore += 90;
                    } else if (['database', 'remote_database', 'schema', 'remote_schema', 'remote_table', 'remote_view'].includes(type)) {
                        contextScore += 92;
                    }
                    // Phase 3: Alias che ten goc (Spec 8.3 Rule 1)
                    // If qualifier is masked by an alias (e.g. Customers. instead of c.), downgrade priority
                    if (context.resolvedObject && context.resolvedObject.isMaskedByAlias) {
                        contextScore -= 40;
                    }
                } else {
                    // Unqualified: Active query alias has higher priority than raw tables
                    if (type === 'alias') {
                        contextScore += 60;
                    } else if (item.isMaskedByAlias) {
                        contextScore -= 30; // Table has an alias, downgrade raw table name
                    }
                }

                // 6. Base level penalty/bonus
                const baseLevel = (typeof item.level === 'number') ? item.level : 2;
                const levelScore = Math.max(0, 30 - baseLevel * 10);

                // 7. Match quality from filter
                const matchScore = item._matchScore || 50;

                item._finalScore = (matchScore * 2) + contextScore + levelScore;
            });

            // Sort descending by finalScore, then ascending by name
            unique.sort((a, b) => {
                if (b._finalScore !== a._finalScore) {
                    return b._finalScore - a._finalScore;
                }
                if (cleanQuery) {
                    const aExact = (a.name || '').toLowerCase() === cleanQuery;
                    const bExact = (b.name || '').toLowerCase() === cleanQuery;
                    if (aExact && !bExact) return -1;
                    if (!aExact && bExact) return 1;
                }
                return (a.name || '').localeCompare(b.name || '');
            });

            // Issue I8: Ceiling limit for candidate list
            // If qualifier resolves to a specific object/alias (e.g. column list of a table), raise limit to 1000 (wide tables)
            // Keep 150 for general unqualified lists or schema object lists
            const isSingleObjectQualified = Boolean(
                context.qualifier && (
                    (context.resolvedObject && ['table', 'view', 'temp_table', 'table_variable', 'cte', 'subquery'].includes(context.resolvedObject.type)) ||
                    (context.queryTables && context.queryTables.some(t => 
                        (t.alias && t.alias.toLowerCase() === context.qualifier.toLowerCase()) ||
                        (t.table && t.table.toLowerCase() === context.qualifier.toLowerCase())
                    ))
                )
            );
            const maxLimit = isSingleObjectQualified ? 1000 : 150;
            const sliced = unique.slice(0, maxLimit);
            const isTruncated = unique.length > maxLimit;
            sliced.isTruncated = isTruncated;
            sliced.meta = {
                truncated: isTruncated,
                totalCount: unique.length,
                limit: maxLimit
            };
            if (items.hasError) {
                sliced.hasError = true;
            }
            if (items.meta && items.meta.errors) {
                sliced.meta.errors = items.meta.errors;
            }
            return sliced;
        }
    }

    /**
     * CandidateGenerator - Context-Aware Candidate Provider (Section 23-29, 39, 40, 46, 47, 51)
     */
    class CandidateGenerator {
        constructor(dataProvider, metadataCache) {
            this.dataProvider = dataProvider;
            this.metadataCache = metadataCache;
        }

        async _getLinkedServers(connId) {
            if (!connId) return [];
            if (this.metadataCache && typeof this.metadataCache.getLinkedServers === 'function') {
                const cached = this.metadataCache.getLinkedServers(connId);
                if (cached && Array.isArray(cached) && cached.length > 0) return cached;
            }
            let res = null;
            if (this.dataProvider && typeof this.dataProvider.getLinkedServers === 'function') {
                res = await this.dataProvider.getLinkedServers(connId);
            } else if (window.AppMetadataProvider && typeof window.AppMetadataProvider.getLinkedServers === 'function') {
                res = await window.AppMetadataProvider.getLinkedServers(connId);
            } else if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:' && !window.pywebview && typeof window.waitForPywebview !== 'function') {
                res = [];
            } else {
                try {
                    const fetchRes = await fetch(`/api/metadata/${connId}/linked_servers`);
                    const data = await fetchRes.json();
                    res = data && data.success && Array.isArray(data.items) ? data.items : [];
                } catch (e) {
                    res = [];
                }
            }
            if (res && this.metadataCache && typeof this.metadataCache.setLinkedServers === 'function') {
                this.metadataCache.setLinkedServers(connId, res);
            }
            return res || [];
        }

        async _getRemoteDatabases(connId, server) {
            if (!connId || !server) return [];
            if (this.metadataCache && typeof this.metadataCache.getRemoteDatabases === 'function') {
                const cached = this.metadataCache.getRemoteDatabases(connId, server);
                if (cached && Array.isArray(cached) && cached.length > 0) return cached;
            }
            let res = null;
            if (this.dataProvider && typeof this.dataProvider.getRemoteDatabases === 'function') {
                res = await this.dataProvider.getRemoteDatabases(connId, server);
            } else if (window.AppMetadataProvider && typeof window.AppMetadataProvider.getRemoteDatabases === 'function') {
                res = await window.AppMetadataProvider.getRemoteDatabases(connId, server);
            } else if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:' && !window.pywebview && typeof window.waitForPywebview !== 'function') {
                res = [];
            } else {
                try {
                    const q = `?server=${encodeURIComponent(server)}`;
                    const fetchRes = await fetch(`/api/metadata/${connId}/linked_server/databases${q}`);
                    const data = await fetchRes.json();
                    res = data && data.success && Array.isArray(data.items) ? data.items : [];
                } catch (e) {
                    res = [];
                }
            }
            if (res && this.metadataCache && typeof this.metadataCache.setRemoteDatabases === 'function') {
                this.metadataCache.setRemoteDatabases(connId, server, res);
            }
            return res || [];
        }

        async _getRemoteSchemas(connId, server, database) {
            if (!connId || !server) return [];
            if (this.metadataCache && typeof this.metadataCache.getRemoteSchemas === 'function') {
                const cached = this.metadataCache.getRemoteSchemas(connId, server, database);
                if (cached && Array.isArray(cached) && cached.length > 0) return cached;
            }
            let res = null;
            if (this.dataProvider && typeof this.dataProvider.getRemoteSchemas === 'function') {
                res = await this.dataProvider.getRemoteSchemas(connId, server, database);
            } else if (window.AppMetadataProvider && typeof window.AppMetadataProvider.getRemoteSchemas === 'function') {
                res = await window.AppMetadataProvider.getRemoteSchemas(connId, server, database);
            } else if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:' && !window.pywebview && typeof window.waitForPywebview !== 'function') {
                res = [];
            } else {
                try {
                    const params = new URLSearchParams({ server });
                    if (database) params.append('database', database);
                    const fetchRes = await fetch(`/api/metadata/${connId}/linked_server/schemas?${params.toString()}`);
                    const data = await fetchRes.json();
                    res = data && data.success && Array.isArray(data.items) ? data.items : [];
                } catch (e) {
                    res = [];
                }
            }
            if (res && this.metadataCache && typeof this.metadataCache.setRemoteSchemas === 'function') {
                this.metadataCache.setRemoteSchemas(connId, server, database, res);
            }
            return res || [];
        }

        async _getRemoteObjects(connId, server, database, schema) {
            if (!connId || !server) return [];
            if (this.metadataCache && typeof this.metadataCache.getRemoteObjects === 'function') {
                const cached = this.metadataCache.getRemoteObjects(connId, server, database, schema);
                if (cached && Array.isArray(cached) && cached.length > 0) return cached;
            }
            let res = null;
            if (this.dataProvider && typeof this.dataProvider.getRemoteObjects === 'function') {
                res = await this.dataProvider.getRemoteObjects(connId, server, database, schema);
            } else if (window.AppMetadataProvider && typeof window.AppMetadataProvider.getRemoteObjects === 'function') {
                res = await window.AppMetadataProvider.getRemoteObjects(connId, server, database, schema);
            } else if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:' && !window.pywebview && typeof window.waitForPywebview !== 'function') {
                res = [];
            } else {
                try {
                    const params = new URLSearchParams({ server });
                    if (database) params.append('database', database);
                    if (schema) params.append('schema', schema);
                    const fetchRes = await fetch(`/api/metadata/${connId}/linked_server/objects?${params.toString()}`);
                    const data = await fetchRes.json();
                    res = data && data.success && Array.isArray(data.items) ? data.items : [];
                } catch (e) {
                    res = [];
                }
            }
            if (res && this.metadataCache && typeof this.metadataCache.setRemoteObjects === 'function') {
                this.metadataCache.setRemoteObjects(connId, server, database, schema, res);
            }
            return res || [];
        }

        async _getRemoteColumns(connId, server, database, schema, table) {
            if (!connId || !server || !table) return [];
            if (this.metadataCache && typeof this.metadataCache.getRemoteColumns === 'function') {
                const cached = this.metadataCache.getRemoteColumns(connId, server, database, schema, table);
                if (cached && Array.isArray(cached) && cached.length > 0) return cached;
            }
            let res = null;
            if (this.dataProvider && typeof this.dataProvider.getRemoteColumns === 'function') {
                res = await this.dataProvider.getRemoteColumns(connId, server, database, schema, table);
            } else if (window.AppMetadataProvider && typeof window.AppMetadataProvider.getRemoteColumns === 'function') {
                res = await window.AppMetadataProvider.getRemoteColumns(connId, server, database, schema, table);
            } else if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:' && !window.pywebview && typeof window.waitForPywebview !== 'function') {
                res = [];
            } else {
                try {
                    const params = new URLSearchParams({ server, table });
                    if (database) params.append('database', database);
                    if (schema) params.append('schema', schema);
                    const fetchRes = await fetch(`/api/metadata/${connId}/linked_server/columns?${params.toString()}`);
                    const data = await fetchRes.json();
                    res = data && data.success && Array.isArray(data.items) ? data.items : [];
                } catch (e) {
                    res = [];
                }
            }
            if (res && this.metadataCache && typeof this.metadataCache.setRemoteColumns === 'function') {
                this.metadataCache.setRemoteColumns(connId, server, database, schema, table, res);
            }
            return res || [];
        }

        async _getForeignServers(connId) {
            if (!connId) return [];
            if (this.metadataCache && typeof this.metadataCache.getForeignServers === 'function') {
                const cached = this.metadataCache.getForeignServers(connId);
                if (cached && Array.isArray(cached) && cached.length > 0) return cached;
            }
            let res = null;
            if (this.dataProvider && typeof this.dataProvider.getForeignServers === 'function') {
                res = await this.dataProvider.getForeignServers(connId);
            } else if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:' && !window.pywebview && typeof window.waitForPywebview !== 'function') {
                res = [];
            } else {
                try {
                    const fetchRes = await fetch(`/api/metadata/${connId}/foreign_servers`);
                    const data = await fetchRes.json();
                    res = data && data.success && Array.isArray(data.items) ? data.items : [];
                } catch (e) {
                    res = [];
                }
            }
            if (res && this.metadataCache && typeof this.metadataCache.setForeignServers === 'function') {
                this.metadataCache.setForeignServers(connId, res);
            }
            return res || [];
        }

        formatInsertText(name, type, context, tabCtx) {
            if (!name) return "";
            if (['keyword', 'operator', 'snippet', 'scalar_variable', 'table_variable', 'data_type'].includes(type)) {
                return name;
            }
            if (name.startsWith('@') || name.startsWith('#')) {
                return name;
            }

            const dialect = (tabCtx && tabCtx.dbType) || 'mssql';
            const isUserQuoted = Boolean(context && context.isQuotedIdentifier);
            const userQuoteChar = context ? context.quoteChar : '';
            const closeChar = context ? (context.closeQuoteChar || (userQuoteChar === '[' ? ']' : userQuoteChar)) : '';

            // User already typed open quote: format with matching quotes
            if (isUserQuoted && userQuoteChar) {
                const clean = CompletionEngine.cleanIdentifier(name);
                return `${userQuoteChar}${clean}${closeChar}`;
            }

            // Auto-quote if required by dialect/syntax
            if (CompletionEngine.needsQuoting(name, dialect)) {
                return CompletionEngine.quoteIdentifier(name, dialect);
            }

            return name;
        }

        /**
         * Phase 9: Star Expansion (* Expansion to explicit column list - Spec Section 8.4 & 10.6)
         * Expands '*' in SELECT queries into a comma-separated list of columns.
         * Supports:
         * - Unqualified star expansion: SELECT * FROM Customers c (uses c.CustomerId, ...)
         * - Single table without alias: SELECT * FROM Customers (uses CustomerId, ...)
         * - Multi-table JOIN: SELECT * FROM Customers c JOIN Orders o ... (c.Col, ..., o.Col, ...)
         * - Qualified star expansion: SELECT c.* FROM Customers c ... (c.CustomerId, ...)
         * - Table variables, CTEs, Temp Tables, and Subqueries
         * - Dialect quoting for reserved keywords or special characters
         */
        async expandStarColumns(context, tabCtx, qualifier = null) {
            const isExprClause = (context.clause === 'SELECT' || context.clause === 'RETURNING' || context.clause === 'OUTPUT' || !context.clause || ['WHERE', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'SET'].includes(context.clause) || context.isInRoutineBody);
            if (!isExprClause) return null;

            // Helper to get columns for a table object
            const getTableColumns = async (tbl) => {
                const targetSchema = tbl.schema || tabCtx.schema;
                const tblName = tbl.table || tbl.name;
                if (!tblName) return [];

                const isPhysical = !['subquery', 'apply_subquery', 'lateral_subquery', 'table_function', 'cte', 'temp_table', 'table_variable', 'pseudo_table'].includes(tbl.type);

                // 1. For physical tables, query Metadata Cache / Data Provider for full schema
                if (isPhysical && tabCtx.connectionId) {
                    let cols = null;
                    if (tbl.server || tbl.sourceType === 'REMOTE_TABLE') {
                        const targetServer = tbl.server;
                        const targetDb = tbl.database || tabCtx.database;
                        if (this.metadataCache && typeof this.metadataCache.getRemoteColumns === 'function') {
                            cols = this.metadataCache.getRemoteColumns(tabCtx.connectionId, targetServer, targetDb, targetSchema, tblName);
                        }
                        if (!cols && this.dataProvider && typeof this.dataProvider.getRemoteColumns === 'function') {
                            cols = await this.dataProvider.getRemoteColumns(tabCtx.connectionId, targetServer, targetDb, targetSchema, tblName);
                            if (cols && this.metadataCache && typeof this.metadataCache.setRemoteColumns === 'function') {
                                this.metadataCache.setRemoteColumns(tabCtx.connectionId, targetServer, targetDb, targetSchema, tblName, cols);
                            }
                        }
                    } else {
                        if (this.metadataCache && typeof this.metadataCache.getColumns === 'function') {
                            cols = this.metadataCache.getColumns(tabCtx.connectionId, tabCtx.database, targetSchema, tblName);
                        }
                        if (!cols && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                            cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, targetSchema, tblName);
                        } else if (!cols && this.dataProvider && typeof this.dataProvider.getColumns === 'function') {
                            cols = await this.dataProvider.getColumns(tabCtx.connectionId, tabCtx.database, targetSchema, tblName);
                        }
                    }
                    if (cols && cols.length > 0) {
                        return cols;
                    }
                }

                // 2. Direct columns on object (CTE, subquery, temp_table, table_variable)
                if (tbl.columns && Array.isArray(tbl.columns) && tbl.columns.length > 0) {
                    return tbl.columns;
                }

                // If subquery hasStar or has underlying table:
                if (['subquery', 'apply_subquery', 'lateral_subquery'].includes(tbl.type) && tabCtx.connectionId) {
                    const uTblName = (tbl.underlyingTables && tbl.underlyingTables[0]) ? tbl.underlyingTables[0].table : (tbl.targetObject && tbl.targetObject !== tbl.alias ? tbl.targetObject : '');
                    if (uTblName) {
                        const uSchema = tbl.schema || tabCtx.schema;
                        let cols = this.metadataCache && typeof this.metadataCache.getColumns === 'function' ? this.metadataCache.getColumns(tabCtx.connectionId, tabCtx.database, uSchema, uTblName) : null;
                        if (!cols && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                            cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, uSchema, uTblName);
                        } else if (!cols && this.dataProvider && typeof this.dataProvider.getColumns === 'function') {
                            cols = await this.dataProvider.getColumns(tabCtx.connectionId, tabCtx.database, uSchema, uTblName);
                        }
                        if (cols && cols.length > 0) return cols;
                    }
                }

                // 3. Active scope symbol lookup
                if (context.activeScope && typeof context.activeScope.getAllVisibleSymbols === 'function') {
                    const symbols = context.activeScope.getAllVisibleSymbols();
                    for (const [_, sym] of symbols) {
                        const symName = sym.name || sym.alias;
                        if (symName && symName.toLowerCase() === tblName.toLowerCase() && sym.columns && Array.isArray(sym.columns) && sym.columns.length > 0) {
                            return sym.columns;
                        }
                    }
                }

                return [];
            };

            // Case A: Qualified star expansion (e.g. c.* or Customers.*)
            if (qualifier) {
                const qualLower = qualifier.toLowerCase();
                let targetTable = null;
                let targetSchema = tabCtx.schema;
                let matchedTbl = null;

                if (context.resolvedObject && context.resolvedObject.object) {
                    targetTable = context.resolvedObject.object;
                    if (context.resolvedObject.schema) targetSchema = context.resolvedObject.schema;
                    matchedTbl = {
                        table: targetTable,
                        schema: targetSchema,
                        server: context.resolvedObject.server || null,
                        database: context.resolvedObject.database || null,
                        sourceType: context.resolvedObject.sourceType || null,
                        type: context.resolvedObject.type,
                        columns: context.resolvedObject.columns
                    };
                } else if (context.aliasMap && context.aliasMap[qualLower]) {
                    const mapped = context.aliasMap[qualLower];
                    targetTable = mapped.table || mapped.object || mapped.name;
                    if (mapped.schema) targetSchema = mapped.schema;
                    matchedTbl = {
                        table: targetTable,
                        schema: targetSchema,
                        server: mapped.server || null,
                        database: mapped.database || null,
                        sourceType: mapped.sourceType || null,
                        type: mapped.type,
                        columns: mapped.columns
                    };
                } else if (context.queryTables && context.queryTables.length > 0) {
                    const found = context.queryTables.find(t => (t.alias && t.alias.toLowerCase() === qualLower) || (t.table && t.table.toLowerCase() === qualLower));
                    if (found) {
                        targetTable = found.table;
                        targetSchema = found.schema || tabCtx.schema;
                        matchedTbl = found;
                    }
                }

                if (!matchedTbl) {
                    matchedTbl = { table: qualifier, schema: targetSchema };
                }

                const rawCols = await getTableColumns(matchedTbl);
                if (!rawCols || rawCols.length === 0) return null;

                const qualPrefix = qualifier;
                const formattedList = rawCols.map(c => {
                    const cName = c.name || c;
                    const quotedName = this.formatInsertText(cName, 'column', context, tabCtx);
                    return `${qualPrefix}.${quotedName}`;
                }).join(', ');

                let repRange = context.replacementRange;
                if (context.qualifierStartOffset !== undefined && context.replacementRange) {
                    repRange = { start: context.qualifierStartOffset, end: context.replacementRange.end };
                }

                return {
                    name: '*',
                    label: `* (All columns of ${qualifier})`,
                    type: 'star_expansion',
                    kind: 'snippet',
                    level: 0.8,
                    displayType: 'Star Expansion',
                    detail: `Expand * to columns of ${qualifier}`,
                    documentation: `Inserts columns of ${matchedTbl.table || qualifier}:\n${formattedList}`,
                    insertText: formattedList,
                    replacementRange: repRange,
                    isStarExpansion: true
                };
            }

            // Case B: Unqualified star expansion (SELECT * FROM ...)
            if (context.queryTables && context.queryTables.length > 0) {
                const totalTables = context.queryTables.length;
                const allParts = [];

                for (const tbl of context.queryTables) {
                    const rawCols = await getTableColumns(tbl);
                    if (!rawCols || rawCols.length === 0) continue;

                    let prefix = '';
                    if (totalTables > 1) {
                        prefix = tbl.alias || tbl.table || '';
                    } else if (tbl.alias) {
                        prefix = tbl.alias;
                    }

                    rawCols.forEach(c => {
                        const cName = c.name || c;
                        const quotedName = this.formatInsertText(cName, 'column', context, tabCtx);
                        if (prefix) {
                            allParts.push(`${prefix}.${quotedName}`);
                        } else {
                            allParts.push(quotedName);
                        }
                    });
                }

                if (allParts.length === 0) return null;

                const formattedList = allParts.join(', ');
                let repRange = context.replacementRange;
                if (context.precedingOperator === '*' || (context.fullSql && context.cursorIndex !== undefined && context.fullSql.substring(0, context.cursorIndex).trimEnd().endsWith('*'))) {
                    const starIdx = context.fullSql ? context.fullSql.lastIndexOf('*', context.cursorIndex) : -1;
                    if (starIdx !== -1 && starIdx >= context.cursorIndex - 5) {
                        repRange = { start: starIdx, end: repRange ? Math.max(repRange.end, starIdx + 1) : context.cursorIndex };
                    }
                }

                return {
                    name: '*',
                    label: '* (Expand columns)',
                    type: 'star_expansion',
                    kind: 'snippet',
                    level: 0.8,
                    displayType: 'Star Expansion',
                    detail: 'Expand * to column list',
                    documentation: `Inserts explicit column list:\n${formattedList}`,
                    insertText: formattedList,
                    replacementRange: repRange,
                    isStarExpansion: true
                };
            }

            return null;
        }

        async _generateDataTypeCandidates(allCandidates, context, tabCtx, metadataErrors) {
            let rawTypes = [];
            let userTypes = [];

            if (this.dataProvider && typeof this.dataProvider.fetchDataTypes === 'function') {
                const dtData = await this.dataProvider.fetchDataTypes(tabCtx.connectionId, tabCtx.database);
                if (Array.isArray(dtData)) {
                    rawTypes = dtData;
                } else if (dtData && typeof dtData === 'object') {
                    rawTypes = dtData.types || [];
                    userTypes = dtData.user_types || [];
                }
            }

            if (rawTypes.length === 0) {
                const defaultList = (tabCtx.dbType === 'postgresql' || tabCtx.dbType === 'postgres')
                    ? ['bigint', 'bigserial', 'boolean', 'bytea', 'char', 'date', 'decimal', 'double precision', 'integer', 'interval', 'json', 'jsonb', 'numeric', 'real', 'serial', 'smallint', 'text', 'time', 'timestamp', 'timestamptz', 'uuid', 'varchar']
                    : ['bigint', 'binary', 'bit', 'char', 'date', 'datetime', 'datetime2', 'decimal', 'float', 'image', 'int', 'money', 'nchar', 'ntext', 'numeric', 'nvarchar', 'real', 'smalldatetime', 'smallint', 'smallmoney', 'text', 'time', 'tinyint', 'uniqueidentifier', 'varbinary', 'varchar', 'xml'];
                rawTypes = defaultList;
            }

            rawTypes.forEach(dt => {
                const dtStr = String(dt);
                allCandidates.push({
                    name: dtStr,
                    label: dtStr,
                    type: 'data_type',
                    kind: 'type',
                    level: 0,
                    displayType: 'Data Type',
                    insertText: dtStr
                });
            });

            userTypes.forEach(ut => {
                const utName = String(ut.name || ut);
                allCandidates.push({
                    name: utName,
                    label: utName,
                    type: 'data_type',
                    kind: 'type',
                    level: 0.1,
                    displayType: 'User Type',
                    insertText: utName
                });
            });
        }

        async _generateExecParamCandidates(allCandidates, context, tabCtx) {
            if (context.execContext && context.execContext.isExec && context.execContext.procedureName) {
                const procName = context.execContext.procedureName;
                const procSchema = context.execContext.procedureSchema || tabCtx.schema;

                if (tabCtx.connectionId && this.dataProvider && typeof this.dataProvider.fetchParameters === 'function') {
                    const params = await this.dataProvider.fetchParameters(tabCtx.connectionId, tabCtx.database, procSchema, procName, tabCtx.dbType);
                    (params || []).forEach(p => {
                        const pName = p.name.startsWith('@') ? p.name : `@${p.name}`;
                        allCandidates.push({
                            name: pName,
                            label: `${pName} = `,
                            type: 'parameter',
                            kind: 'parameter',
                            level: 1.0,
                            displayType: p.data_type ? `Param (${p.data_type})` : 'Parameter',
                            dataType: p.data_type,
                            direction: p.direction || 'IN',
                            insertText: `${pName} = `
                        });
                    });
                }
            }
        }

        _generateLocalSymbolCandidates(allCandidates, context, tabCtx) {
            // A. CTEs (Common Table Expressions - Section 39)
            const ctes = (context.activeScope && typeof context.activeScope.getSymbolsByType === 'function')
                ? context.activeScope.getSymbolsByType('cte')
                : (context.ctes || []);

            ctes.forEach(cte => {
                const cteName = cte.name || cte;
                allCandidates.push({
                    name: cteName,
                    label: cteName,
                    type: 'cte',
                    kind: 'table',
                    level: 1.2,
                    displayType: 'CTE',
                    columns: cte.columns || [],
                    insertText: this.formatInsertText(cteName, 'cte', context, tabCtx)
                });
            });

            // B. Local temp tables (#temp in SQL Server, temp_tbl in PostgreSQL - Section 46)
            const scopeTemp = (context.activeScope && typeof context.activeScope.getSymbolsByType === 'function')
                ? context.activeScope.getSymbolsByType('temp_table')
                : [];
            const tempNameSet = new Set(scopeTemp.map(t => (t.name || t).toLowerCase()));
            const fallbackTemp = (context.localTempTables || [])
                .filter(t => !tempNameSet.has((t || '').toLowerCase()))
                .map(t => ({ name: t, columns: [] }));
            const tempTables = [...scopeTemp, ...fallbackTemp];

            tempTables.forEach(tbl => {
                const tblName = tbl.name || tbl;
                allCandidates.push({
                    name: tblName,
                    label: tblName,
                    type: 'temp_table',
                    kind: 'table',
                    level: 1.3,
                    displayType: 'Temp Table',
                    columns: tbl.columns || [],
                    insertText: this.formatInsertText(tblName, 'temp_table', context, tabCtx)
                });
            });

            // C. Local table variables (@table - Section 47)
            const scopeTableVars = (context.activeScope && typeof context.activeScope.getSymbolsByType === 'function')
                ? context.activeScope.getSymbolsByType('table_variable')
                : [];
            const tvNameSet = new Set(scopeTableVars.map(v => (v.name || v).toLowerCase()));
            const fallbackTV = (context.localTableVars || [])
                .filter(v => !tvNameSet.has((v || '').toLowerCase()))
                .map(v => ({ name: v, columns: [] }));
            const tableVars = [...scopeTableVars, ...fallbackTV];

            tableVars.forEach(v => {
                const vName = v.name || v;
                allCandidates.push({
                    name: vName,
                    label: vName,
                    type: 'table_variable',
                    kind: 'variable',
                    level: 1.3,
                    displayType: 'Table Var',
                    insertText: vName
                });
            });

            // C2. Trigger Pseudo-tables (inserted / deleted in T-SQL, NEW / OLD in PostgreSQL - Spec 8.5)
            const scopePseudos = (context.activeScope && typeof context.activeScope.getSymbolsByType === 'function')
                ? context.activeScope.getSymbolsByType('pseudo_table')
                : [];
            scopePseudos.forEach(pt => {
                allCandidates.push({
                    name: pt.name,
                    label: pt.name,
                    type: 'pseudo_table',
                    kind: 'table',
                    level: 1.1,
                    displayType: pt.displayType || 'Pseudo Table',
                    tableName: pt.targetObject || pt.name,
                    schema: pt.schema || '',
                    columns: pt.columns || [],
                    insertText: pt.name
                });
            });

            const isInsertCols = Boolean(context.isInsertColumns || context.clause === 'INSERT_COLUMNS');
            const isUpdateSet = Boolean(context.isUpdateSet || (context.clause === 'SET' && !context.isUpdateSetValue));

            // Phase 3: Query Table Aliases in active scope (e.g. c for Customers)
            if (!context.qualifier && context.queryTables && context.queryTables.length > 0) {
                context.queryTables.forEach(tbl => {
                    // In UPDATE SET clause (left side of =): only suggest alias of the target table
                    if (isUpdateSet && context.targetTable && context.targetTable.table) {
                        const tgtName = (context.targetTable.table || '').toLowerCase();
                        const tgtAlias = (context.targetTable.alias || '').toLowerCase();
                        const tblName = (tbl.table || '').toLowerCase();
                        const tblAlias = (tbl.alias || '').toLowerCase();
                        const isTarget = (tblName === tgtName) ||
                                         (tblAlias && tblAlias === tgtName) ||
                                         (tgtAlias && (tblName === tgtAlias || tblAlias === tgtAlias));
                        if (!isTarget) return;
                    }
                    if (tbl.alias) {
                        allCandidates.push({
                            name: tbl.alias,
                            label: tbl.alias,
                            type: 'alias',
                            kind: 'table',
                            level: 1.0,
                            displayType: `Alias (${tbl.table})`,
                            tableName: tbl.table,
                            schema: tbl.schema,
                            insertText: tbl.alias
                        });
                    }
                });
            }

            // Phase 3: Select-list Aliases (Spec 8.2, 8.3)
            // Available in ORDER BY / GROUP BY; forbidden in WHERE / HAVING
            if ((context.clause === 'ORDER BY' || context.clause === 'GROUP BY') && context.selectAliases && context.selectAliases.length > 0) {
                context.selectAliases.forEach(sa => {
                    allCandidates.push({
                        name: sa.name,
                        label: sa.name,
                        type: 'select_alias',
                        kind: 'column',
                        level: 1.0,
                        displayType: 'Select Alias',
                        originalExpr: sa.originalExpr || '',
                        insertText: this.formatInsertText(sa.name, 'column', context, tabCtx)
                    });
                });
            }

            // D. Scalar variables & Parameters (@var in SQL Server, var_name in PostgreSQL)
            const isVarTrigger = (context.currentWord && context.currentWord.startsWith('@')) || context.triggerChar === '@';
            const isExprClause = (context.clause === 'SELECT' || context.clause === 'RETURNING' || context.clause === 'OUTPUT' || isInsertCols || isUpdateSet || !context.clause || ['WHERE', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'SET', 'VALUES', 'EXEC', 'EXECUTE'].includes(context.clause) || context.isInRoutineBody);

            if (isVarTrigger || isExprClause) {
                const scopeVars = (context.activeScope && typeof context.activeScope.getSymbolsByType === 'function')
                    ? context.activeScope.getSymbolsByType('scalar_variable')
                    : [];
                const varNameSet = new Set(scopeVars.map(v => (v.name || v).toLowerCase()));
                const fallbackVars = (context.localVariables || [])
                    .filter(v => !varNameSet.has((v.name || v || '').toLowerCase()));
                const vars = [...scopeVars, ...fallbackVars];

                vars.forEach(v => {
                    allCandidates.push({
                        name: v.name,
                        label: v.name,
                        type: 'scalar_variable',
                        kind: 'variable',
                        level: isVarTrigger ? 1.0 : 1.3,
                        displayType: v.dataType ? `Variable (${v.dataType})` : 'Variable',
                        dataType: v.dataType || '',
                        insertText: v.name
                    });
                });
            }
        }

        async _generateStatementColumnCandidates(allCandidates, context, tabCtx) {
            const isInsertCols = Boolean(context.isInsertColumns || context.clause === 'INSERT_COLUMNS');
            const isUpdateSet = Boolean(context.isUpdateSet || (context.clause === 'SET' && !context.isUpdateSetValue));
            const isExprClause = (context.clause === 'SELECT' || context.clause === 'RETURNING' || context.clause === 'OUTPUT' || isInsertCols || isUpdateSet || !context.clause || ['WHERE', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'SET', 'VALUES', 'EXEC', 'EXECUTE'].includes(context.clause) || context.isInRoutineBody);

            if (tabCtx.connectionId && context.queryTables && context.queryTables.length > 0) {
                if (isExprClause) {
                    const alreadySet = new Set((context.alreadyListed || []).map(s => s.toLowerCase()));

                    for (const tbl of context.queryTables) {
                        // In JOIN ON after '=': only suggest columns of the remaining table(s) (Issue I6)
                        if (context.clause === 'ON' && context.precedingOperator === '=' && context.onLeftOperand && context.onLeftOperand.tableOrAlias) {
                            const leftRef = context.onLeftOperand.tableOrAlias.toLowerCase();
                            const tblName = (tbl.table || '').toLowerCase();
                            const tblAlias = (tbl.alias || '').toLowerCase();
                            if (tblAlias === leftRef || tblName === leftRef) {
                                continue; // Skip the table that is already on the left of =
                            }
                        }

                        // In UPDATE SET target column position (left side of =):
                        // ONLY suggest columns from target table (physical, temp table, table variable, or alias)
                        if (isUpdateSet && context.targetTable && context.targetTable.table) {
                            const tgtName = (context.targetTable.table || '').toLowerCase();
                            const tgtAlias = (context.targetTable.alias || '').toLowerCase();
                            const tblName = (tbl.table || '').toLowerCase();
                            const tblAlias = (tbl.alias || '').toLowerCase();
                            const isTarget = (tblName === tgtName) ||
                                             (tblAlias && tblAlias === tgtName) ||
                                             (tgtAlias && (tblName === tgtAlias || tblAlias === tgtAlias));
                            if (!isTarget) {
                                continue; // Skip JOINed tables in UPDATE SET target position!
                            }
                        }

                        const targetSchema = tbl.schema || tabCtx.schema;
                        const isLocalTableType = ['subquery', 'apply_subquery', 'lateral_subquery', 'table_function', 'cte', 'temp_table', 'table_variable'].includes(tbl.type) ||
                            (tbl.table && (tbl.table.startsWith('#') || tbl.table.startsWith('@')));

                        // Only query database for physical tables, views, synonyms, foreign_table, remote_table
                        if (!isLocalTableType) {
                            let cols = null;
                            const isRemoteTable = Boolean(tbl.server || tbl.sourceType === 'REMOTE_TABLE');
                            if (isRemoteTable && tbl.server) {
                                const targetServer = tbl.server;
                                const targetDb = tbl.database || tabCtx.database;
                                if (this.metadataCache && typeof this.metadataCache.getRemoteColumns === 'function') {
                                    cols = this.metadataCache.getRemoteColumns(tabCtx.connectionId, targetServer, targetDb, targetSchema, tbl.table);
                                }
                                if (!cols && this.dataProvider && typeof this.dataProvider.getRemoteColumns === 'function') {
                                    cols = await this.dataProvider.getRemoteColumns(tabCtx.connectionId, targetServer, targetDb, targetSchema, tbl.table);
                                    if (cols && this.metadataCache && typeof this.metadataCache.setRemoteColumns === 'function') {
                                        this.metadataCache.setRemoteColumns(tabCtx.connectionId, targetServer, targetDb, targetSchema, tbl.table, cols);
                                    }
                                }
                            } else {
                                if (this.metadataCache && typeof this.metadataCache.getColumns === 'function') {
                                    cols = this.metadataCache.getColumns(tabCtx.connectionId, tabCtx.database, targetSchema, tbl.table);
                                }
                                if (!cols && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                                    cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, targetSchema, tbl.table);
                                } else if (!cols && this.dataProvider && typeof this.dataProvider.getColumns === 'function') {
                                    cols = await this.dataProvider.getColumns(tabCtx.connectionId, tabCtx.database, targetSchema, tbl.table);
                                }
                            }
                            (cols || []).forEach(c => {
                                const colName = c.name;
                                const colLower = (colName || '').toLowerCase();

                                // 1. Filter already listed columns in INSERT column list or UPDATE SET list
                                if ((isInsertCols || isUpdateSet) && alreadySet.has(colLower)) {
                                    return;
                                }

                                // 2. Filter non-insertable columns in INSERT column list (Spec Section 7.2)
                                if (isInsertCols) {
                                    const isNonInsertable = Boolean(
                                        c.is_identity || 
                                        c.is_computed || 
                                        c.generated || 
                                        c.is_generated ||
                                        (c.data_type && ['rowversion', 'timestamp'].includes(c.data_type.toLowerCase()))
                                    );
                                    if (isNonInsertable) {
                                        return;
                                    }
                                }

                                allCandidates.push({
                                    name: c.name,
                                    label: c.name,
                                    type: c.is_pk ? 'pk_column' : 'column',
                                    kind: 'column',
                                    level: isInsertCols ? 0.9 : 1.1,
                                    displayType: 'Column',
                                    dataType: c.data_type,
                                    isNullable: c.is_nullable,
                                    isPk: c.is_pk,
                                    isIdentity: c.is_identity,
                                    isComputed: c.is_computed,
                                    schema: targetSchema,
                                    tableName: tbl.table,
                                    tableAlias: tbl.alias,
                                    insertText: this.formatInsertText(c.name, 'column', context, tabCtx)
                                });
                            });
                        } else {
                            // Local CTE, subquery, temp_table, table_variable
                            let localCols = tbl.columns;
                            if ((!localCols || localCols.length === 0) && context.activeScope && typeof context.activeScope.getAllVisibleSymbols === 'function') {
                                const symbols = context.activeScope.getAllVisibleSymbols();
                                for (const [_, sym] of symbols) {
                                    const symName = sym.name || sym.alias;
                                    const matchesTable = symName && (symName.toLowerCase() === (tbl.table || '').toLowerCase() || (tbl.alias && symName.toLowerCase() === tbl.alias.toLowerCase()));
                                    if (matchesTable && sym.columns && Array.isArray(sym.columns) && sym.columns.length > 0) {
                                        localCols = sym.columns;
                                        break;
                                    }
                                }
                            }

                            // If localCols is empty and this is a subquery or temp table with SELECT * (hasStar or has underlying table):
                            if ((!localCols || localCols.length === 0) && ['subquery', 'apply_subquery', 'lateral_subquery', 'temp_table', 'table_variable'].includes(tbl.type) && tabCtx.connectionId) {
                                let uTblName = (tbl.underlyingTables && tbl.underlyingTables[0]) ? tbl.underlyingTables[0].table : (tbl.targetObject && tbl.targetObject !== tbl.alias && tbl.targetObject !== tbl.table ? tbl.targetObject : '');
                                if (!uTblName && tbl.table && tbl.table !== tbl.alias) {
                                    uTblName = tbl.table;
                                }
                                if (uTblName) {
                                    const uSchema = tbl.schema || tabCtx.schema;
                                    if (this.metadataCache && typeof this.metadataCache.getColumns === 'function') {
                                        localCols = this.metadataCache.getColumns(tabCtx.connectionId, tabCtx.database, uSchema, uTblName);
                                    }
                                    if (!localCols && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                                        localCols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, uSchema, uTblName);
                                    } else if (!localCols && this.dataProvider && typeof this.dataProvider.getColumns === 'function') {
                                        localCols = await this.dataProvider.getColumns(tabCtx.connectionId, tabCtx.database, uSchema, uTblName);
                                    }
                                }
                            }

                            if (Array.isArray(localCols)) {
                                localCols.forEach(c => {
                                    const colName = c.name || c;
                                    const colLower = (colName || '').toLowerCase();

                                    if ((isInsertCols || isUpdateSet) && alreadySet.has(colLower)) {
                                        return;
                                    }

                                    let colLevel = isInsertCols ? 0.9 : 1.1;
                                    if (context.clause === 'ON' && context.precedingOperator === '=' && context.onLeftOperand && context.onLeftOperand.column) {
                                        if (colLower === context.onLeftOperand.column.toLowerCase()) {
                                            colLevel = 0.7; // Prioritize FK/name matching column
                                        }
                                    }

                                    allCandidates.push({
                                        name: colName,
                                        label: colName,
                                        type: c.is_pk ? 'pk_column' : 'column',
                                        kind: 'column',
                                        level: colLevel,
                                        displayType: 'Column',
                                        dataType: c.data_type || '',
                                        tableName: tbl.table,
                                        tableAlias: tbl.alias,
                                        insertText: this.formatInsertText(colName, 'column', context, tabCtx)
                                    });
                                });
                            }
                        }
                    }
                }

                // Phase 9: Star Expansion (* Expansion to column list per Spec Section 8.4 & 10.6)
                if ((context.clause === 'SELECT' || !context.clause) && !isInsertCols && !isUpdateSet) {
                    const starItem = await this.expandStarColumns(context, tabCtx, null);
                    if (starItem) {
                        allCandidates.push(starItem);
                    }
                }
            }

            // Phase 5: Gợi ý ON dựa trên Foreign Key & Heuristic fallback (Spec 11.4, Issue I6)
            if (context.clause === 'ON' && tabCtx.connectionId) {
                if (!context.isPrecedingOperator) {
                    await this._generateJoinOnCandidates(allCandidates, context, tabCtx);
                }
            }
        }

        async _generateQualifierCandidates(allCandidates, context, tabCtx, wordLower, metadataErrors) {
            const qualLower = context.qualifier.toLowerCase();
            let targetTable = null;
            let targetSchema = tabCtx.schema;
            let targetDatabase = tabCtx.database;
            let targetServer = null;
            let isRemote = false;

            if (context.resolvedObject && context.resolvedObject.object) {
                targetTable = context.resolvedObject.object;
                if (context.resolvedObject.schema) targetSchema = context.resolvedObject.schema;
                if (context.resolvedObject.database) targetDatabase = context.resolvedObject.database;
                if (context.resolvedObject.server) {
                    targetServer = context.resolvedObject.server;
                    isRemote = true;
                } else if (context.resolvedObject.sourceType === 'REMOTE_TABLE') {
                    isRemote = true;
                }
            } else if (context.aliasMap && context.aliasMap[qualLower]) {
                const mapped = context.aliasMap[qualLower];
                targetTable = mapped.table || mapped.object;
                if (mapped.schema) targetSchema = mapped.schema;
                if (mapped.database) targetDatabase = mapped.database;
                if (mapped.server) {
                    targetServer = mapped.server;
                    isRemote = true;
                }
            } else {
                targetTable = context.qualifier;
            }

            const isLocalSymbol = Boolean(
                (context.resolvedObject && ['subquery', 'apply_subquery', 'lateral_subquery', 'table_function', 'cte', 'temp_table', 'table_variable', 'pseudo_table'].includes(context.resolvedObject.type)) ||
                (targetTable && (targetTable.startsWith('#') || targetTable.startsWith('@'))) ||
                (context.aliasMap && context.aliasMap[qualLower] && ['subquery', 'apply_subquery', 'lateral_subquery', 'table_function', 'cte', 'temp_table', 'table_variable', 'pseudo_table'].includes(context.aliasMap[qualLower].type)) ||
                (context.aliasMap && context.aliasMap[qualLower] && context.aliasMap[qualLower].table && (context.aliasMap[qualLower].table.startsWith('#') || context.aliasMap[qualLower].table.startsWith('@')))
            );

            // A. Columns from database connection (Physical tables / views / remote tables)
            if (tabCtx.connectionId && targetTable && !isLocalSymbol) {
                let cols = null;
                if (isRemote && targetServer) {
                    // Remote table (Linked Server) columns
                    if (this.metadataCache && typeof this.metadataCache.getRemoteColumns === 'function') {
                        cols = this.metadataCache.getRemoteColumns(tabCtx.connectionId, targetServer, targetDatabase, targetSchema, targetTable);
                    }
                    if (!cols && this.dataProvider && typeof this.dataProvider.getRemoteColumns === 'function') {
                        cols = await this.dataProvider.getRemoteColumns(tabCtx.connectionId, targetServer, targetDatabase, targetSchema, targetTable);
                        if (cols && this.metadataCache && typeof this.metadataCache.setRemoteColumns === 'function') {
                            this.metadataCache.setRemoteColumns(tabCtx.connectionId, targetServer, targetDatabase, targetSchema, targetTable, cols);
                        }
                    }
                    (cols || []).forEach(c => {
                        allCandidates.push({
                            name: c.name,
                            label: c.name,
                            type: c.is_pk ? 'pk_column' : 'column',
                            kind: 'column',
                            level: 2,
                            displayType: 'Remote Column',
                            dataType: c.data_type,
                            isNullable: c.is_nullable,
                            isPk: c.is_pk,
                            server: targetServer,
                            database: targetDatabase,
                            schema: targetSchema,
                            tableName: targetTable,
                            insertText: this.formatInsertText(c.name, 'column', context, tabCtx)
                        });
                    });
                } else if (!isRemote) {
                    // Local table columns
                    if (this.metadataCache && typeof this.metadataCache.getColumns === 'function') {
                        cols = this.metadataCache.getColumns(tabCtx.connectionId, tabCtx.database, targetSchema, targetTable);
                    }
                    if (!cols && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                        cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, targetSchema, targetTable);
                    } else if (!cols && this.dataProvider && typeof this.dataProvider.getColumns === 'function') {
                        cols = await this.dataProvider.getColumns(tabCtx.connectionId, tabCtx.database, targetSchema, targetTable);
                    }
                    (cols || []).forEach(c => {
                        allCandidates.push({
                            name: c.name,
                            label: c.name,
                            type: c.is_pk ? 'pk_column' : 'column',
                            kind: 'column',
                            level: 2,
                            displayType: 'Column',
                            dataType: c.data_type,
                            isNullable: c.is_nullable,
                            isPk: c.is_pk,
                            schema: targetSchema,
                            tableName: targetTable,
                            insertText: this.formatInsertText(c.name, 'column', context, tabCtx)
                        });
                    });
                }
            }

            // A2. Pseudo-table columns (NEW / OLD in PostgreSQL, inserted / deleted in SQL Server)
            if (context.resolvedObject && context.resolvedObject.type === 'pseudo_table') {
                const isPseudoName = (name) => ['new', 'old', 'inserted', 'deleted', 'excluded'].includes(String(name || '').toLowerCase());
                let trgTable = (context.resolvedObject.targetObject && !isPseudoName(context.resolvedObject.targetObject)) ? context.resolvedObject.targetObject : '';
                let trgSchema = context.resolvedObject.schema || tabCtx.schema;

                if (!trgTable && context.triggerTable && context.triggerTable.table && !isPseudoName(context.triggerTable.table)) {
                    trgTable = context.triggerTable.table;
                    if (context.triggerTable.schema) trgSchema = context.triggerTable.schema;
                }

                if (!trgTable && context.queryTables && context.queryTables.length > 0) {
                    const nonPseudo = context.queryTables.find(t => t.type !== 'pseudo_table' && !isPseudoName(t.table));
                    if (nonPseudo) {
                        trgTable = nonPseudo.table;
                        if (nonPseudo.schema) trgSchema = nonPseudo.schema;
                    }
                }

                if (trgTable && tabCtx.connectionId && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                    const cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, trgSchema, trgTable);
                    (cols || []).forEach(c => {
                        allCandidates.push({
                            name: c.name,
                            label: c.name,
                            type: c.is_pk ? 'pk_column' : 'column',
                            kind: 'column',
                            level: 1.0,
                            displayType: 'Column',
                            dataType: c.data_type,
                            isNullable: c.is_nullable,
                            isPk: c.is_pk,
                            schema: trgSchema,
                            tableName: trgTable,
                            insertText: this.formatInsertText(c.name, 'column', context, tabCtx)
                        });
                    });
                } else if (!trgTable && tabCtx.connectionId && this.dataProvider && typeof this.dataProvider.fetchObjects === 'function') {
                    // Fallback: If trigger table is unknown, try matching table from routine name or fetch schema tables
                    const dbObjs = await this.dataProvider.fetchObjects(tabCtx.connectionId, tabCtx.database, tabCtx.schema);
                    const tables = (dbObjs || []).filter(o => o.type === 'table');
                    const rName = (context.routineName || '').toLowerCase().replace(/^trg_|^check_|_trigger$|_trg$/, '');
                    const rParts = rName.split('_').filter(p => p.length >= 3);
                    const matched = tables.find(t => {
                        const tLower = (t.name || '').toLowerCase();
                        if (rName && (rName.includes(tLower) || tLower.includes(rName))) return true;
                        return rParts.some(p => tLower.includes(p) || p.includes(tLower));
                    }) || (tables.length === 1 ? tables[0] : null);

                    const targetTables = matched ? [matched] : (tables.length <= 5 ? tables : []);
                    for (const tbl of targetTables) {
                        if (typeof this.dataProvider.fetchColumns === 'function') {
                            const cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, tbl.schema || tabCtx.schema, tbl.name);
                            (cols || []).forEach(c => {
                                allCandidates.push({
                                    name: c.name,
                                    label: c.name,
                                    type: c.is_pk ? 'pk_column' : 'column',
                                    kind: 'column',
                                    level: 1.0,
                                    displayType: matched ? 'Column' : `Column (${tbl.name})`,
                                    dataType: c.data_type,
                                    isNullable: c.is_nullable,
                                    isPk: c.is_pk,
                                    schema: tbl.schema || tabCtx.schema,
                                    tableName: tbl.name,
                                    insertText: this.formatInsertText(c.name, 'column', context, tabCtx)
                                });
                            });
                        }
                    }
                }
            }

            // A3. Multi-tier Linked Server Completion Hierarchy (Spec Section 13, 14, 45)
            const qParts = (context.qualifierParts || []).map(p => CompletionEngine.cleanIdentifier(p).trim());
            const isKnownAlias = Boolean(context.resolvedObject && context.resolvedObject.isAlias);
            if (tabCtx.connectionId && qParts.length > 0 && !isKnownAlias && !isLocalSymbol) {
                if (qParts.length >= 4) {
                    const rServer = qParts[qParts.length - 4];
                    const rDb = qParts[qParts.length - 3];
                    const rSchema = qParts[qParts.length - 2] || 'dbo';
                    const rTbl = qParts[qParts.length - 1];
                    if (rServer && rTbl) {
                        const cols = await this._getRemoteColumns(tabCtx.connectionId, rServer, rDb, rSchema, rTbl);
                        (cols || []).forEach(c => {
                            const cName = c.name || c;
                            allCandidates.push({
                                name: cName,
                                label: cName,
                                type: c.is_pk ? 'pk_column' : 'column',
                                kind: 'column',
                                level: 1.5,
                                displayType: 'Remote Column',
                                dataType: c.data_type || '',
                                isNullable: c.is_nullable !== false,
                                isPk: Boolean(c.is_pk),
                                server: rServer,
                                database: rDb,
                                schema: rSchema,
                                tableName: rTbl,
                                insertText: this.formatInsertText(cName, 'column', context, tabCtx)
                            });
                        });
                    }
                } else if (qParts.length === 3) {
                    const rServer = qParts[0];
                    const rDb = qParts[1];
                    const rSchema = qParts[2] || 'dbo';
                    if (rServer && rDb) {
                        const objs = await this._getRemoteObjects(tabCtx.connectionId, rServer, rDb, rSchema);
                        (objs || []).forEach(o => {
                            const oName = o.name || o;
                            const oType = o.type || 'table';
                            allCandidates.push({
                                name: oName,
                                label: oName,
                                type: oType,
                                kind: oType,
                                level: 1.5,
                                displayType: oType === 'view' ? 'Remote View' : 'Remote Table',
                                server: rServer,
                                database: rDb,
                                schema: o.schema || rSchema,
                                insertText: this.formatInsertText(oName, oType, context, tabCtx)
                            });
                        });
                    }
                } else if (qParts.length === 2) {
                    const rServer = qParts[0];
                    const rDb = qParts[1];
                    if (rServer && rDb) {
                        const schemas = await this._getRemoteSchemas(tabCtx.connectionId, rServer, rDb);
                        (schemas || []).forEach(s => {
                            const sName = s.name || s;
                            allCandidates.push({
                                name: sName,
                                label: sName,
                                type: 'schema',
                                kind: 'schema',
                                level: 1.5,
                                displayType: 'Remote Schema',
                                server: rServer,
                                database: rDb,
                                insertText: this.formatInsertText(sName, 'schema', context, tabCtx)
                            });
                        });
                    }
                } else if (qParts.length === 1) {
                    const candidateServer = qParts[0];
                    const lservers = await this._getLinkedServers(tabCtx.connectionId);
                    const isLinked = (lservers || []).some(ls => (ls.name || ls.LinkedServerName || '').toLowerCase() === candidateServer.toLowerCase());
                    if (isLinked) {
                        const rDbs = await this._getRemoteDatabases(tabCtx.connectionId, candidateServer);
                        (rDbs || []).forEach(db => {
                            const dName = db.name || db;
                            allCandidates.push({
                                name: dName,
                                label: dName,
                                type: 'database',
                                kind: 'database',
                                level: 1.5,
                                displayType: 'Remote Database',
                                server: candidateServer,
                                insertText: this.formatInsertText(dName, 'database', context, tabCtx)
                            });
                        });
                    }
                }
            }

            // B. Columns discovered from local query scope (Subquery / APPLY / LATERAL / CTE / Temp table / Table var projections - Section 39, 40, 46, 47)
            let localCols = (context.resolvedObject && Array.isArray(context.resolvedObject.columns) && context.resolvedObject.columns.length > 0)
                ? context.resolvedObject.columns
                : (context.aliasMap && context.aliasMap[qualLower] && Array.isArray(context.aliasMap[qualLower].columns) ? context.aliasMap[qualLower].columns : []);

            // If localCols is still empty, look up in activeScope or queryTables
            if ((!localCols || localCols.length === 0) && context.activeScope && typeof context.activeScope.getAllVisibleSymbols === 'function') {
                const symbols = context.activeScope.getAllVisibleSymbols();
                for (const [_, sym] of symbols) {
                    const symName = sym.name || sym.alias;
                    const matchesTable = symName && (
                        symName.toLowerCase() === qualLower ||
                        (targetTable && symName.toLowerCase() === targetTable.toLowerCase()) ||
                        (sym.alias && sym.alias.toLowerCase() === qualLower)
                    );
                    if (matchesTable && sym.columns && Array.isArray(sym.columns) && sym.columns.length > 0) {
                        localCols = sym.columns;
                        break;
                    }
                }
            }
            if ((!localCols || localCols.length === 0) && context.queryTables && Array.isArray(context.queryTables)) {
                const matchedQ = context.queryTables.find(qt =>
                    (qt.alias && qt.alias.toLowerCase() === qualLower) ||
                    (qt.table && qt.table.toLowerCase() === qualLower) ||
                    (targetTable && qt.table && qt.table.toLowerCase() === targetTable.toLowerCase())
                );
                if (matchedQ && matchedQ.columns && Array.isArray(matchedQ.columns) && matchedQ.columns.length > 0) {
                    localCols = matchedQ.columns;
                }
            }

            if (localCols && localCols.length > 0) {
                localCols.forEach(col => {
                    const cName = col.name || col;
                    allCandidates.push({
                        name: cName,
                        label: cName,
                        type: col.is_pk ? 'pk_column' : 'column',
                        kind: 'column',
                        level: 1.1,
                        displayType: 'Column',
                        dataType: col.data_type || '',
                        isNullable: col.is_nullable !== false,
                        isPk: Boolean(col.is_pk),
                        schema: targetSchema || '',
                        tableName: targetTable || context.qualifier,
                        insertText: this.formatInsertText(cName, 'column', context, tabCtx)
                    });
                });
            }

            // B2. If subquery projected SELECT * (hasStar or localCols empty), fetch columns from underlying table(s)
            const targetObj = context.resolvedObject || (context.aliasMap ? context.aliasMap[qualLower] : null);
            const isSubqueryType = targetObj && ['subquery', 'apply_subquery', 'lateral_subquery', 'temp_table', 'table_variable'].includes(targetObj.type);
            if (isSubqueryType && (targetObj.hasStar || localCols.length === 0)) {
                let underlyingList = (targetObj && Array.isArray(targetObj.underlyingTables) && targetObj.underlyingTables.length > 0)
                    ? [...targetObj.underlyingTables]
                    : [];
                if (underlyingList.length === 0 && targetObj && targetObj.targetObject && targetObj.targetObject.toLowerCase() !== qualLower) {
                    underlyingList.push({
                        table: targetObj.targetObject,
                        schema: targetObj.schema || ''
                    });
                }
                if (underlyingList.length === 0 && targetTable && targetTable.toLowerCase() !== qualLower) {
                    underlyingList.push({
                        table: targetTable,
                        schema: targetSchema || ''
                    });
                }

                for (const uTbl of underlyingList) {
                    let fetchedCols = null;
                    // 1. Check local scope (temp table #temp / table var @tbl / CTE)
                    if (context.activeScope && typeof context.activeScope.resolve === 'function') {
                        const sym = context.activeScope.resolve(uTbl.table);
                        if (sym && sym.columns && Array.isArray(sym.columns) && sym.columns.length > 0) {
                            fetchedCols = sym.columns;
                        }
                    }
                    // 2. Check database connection
                    if (!fetchedCols && tabCtx.connectionId) {
                        const uSchema = uTbl.schema || targetSchema || tabCtx.schema;
                        if (this.metadataCache && typeof this.metadataCache.getColumns === 'function') {
                            fetchedCols = this.metadataCache.getColumns(tabCtx.connectionId, targetDatabase, uSchema, uTbl.table);
                        }
                        if (!fetchedCols && this.dataProvider) {
                            try {
                                if (typeof this.dataProvider.fetchColumns === 'function') {
                                    fetchedCols = await this.dataProvider.fetchColumns(tabCtx.connectionId, targetDatabase, uSchema, uTbl.table);
                                } else if (typeof this.dataProvider.getColumns === 'function') {
                                    fetchedCols = await this.dataProvider.getColumns(tabCtx.connectionId, targetDatabase, uSchema, uTbl.table);
                                }
                                if (fetchedCols && (fetchedCols.hasError || fetchedCols.error)) {
                                    metadataErrors.push(fetchedCols.error || new Error(`Error fetching columns for ${uTbl.table}`));
                                }
                            } catch (err) {
                                metadataErrors.push(err);
                            }
                        }
                    }
                    if (fetchedCols && Array.isArray(fetchedCols)) {
                        fetchedCols.forEach(c => {
                            const cName = c.name || c;
                            if (!allCandidates.some(cand => cand.name.toLowerCase() === cName.toLowerCase() && cand.kind === 'column')) {
                                allCandidates.push({
                                    name: cName,
                                    label: cName,
                                    type: c.is_pk ? 'pk_column' : 'column',
                                    kind: 'column',
                                    level: 1.1,
                                    displayType: 'Column',
                                    dataType: c.data_type || c.dataType || '',
                                    isNullable: c.is_nullable !== false,
                                    isPk: Boolean(c.is_pk),
                                    schema: uTbl.schema || targetSchema || '',
                                    tableName: targetTable || context.qualifier,
                                    insertText: this.formatInsertText(cName, 'column', context, tabCtx)
                                });
                            }
                        });
                    }
                }
            }

            // C. If qualifier is schema (e.g. dbo.), fetch objects in that schema
            const isStrictExec = Boolean(context.execContext && context.execContext.isExec && !context.execContext.procedureName);
            if (tabCtx.connectionId && !isKnownAlias && !isLocalSymbol && this.dataProvider && typeof this.dataProvider.fetchObjects === 'function') {
                const isExecContext = Boolean(isStrictExec || context.clause === 'EXEC' || context.clause === 'EXECUTE' || (context.execContext && context.execContext.isExec));
                let dbObjects = null;
                try {
                    dbObjects = await this.dataProvider.fetchObjects(tabCtx.connectionId, tabCtx.database, context.qualifier);
                    if (dbObjects && (dbObjects.hasError || dbObjects.error)) {
                        metadataErrors.push(dbObjects.error || new Error(`Error fetching objects for schema ${context.qualifier}`));
                    }
                } catch (err) {
                    metadataErrors.push(err);
                }
                (dbObjects || []).forEach(obj => {
                    if (isExecContext) {
                        // Apply procedure filter in EXEC context (Issue I7)
                        if (obj.type !== 'procedure') {
                            return;
                        }
                    }
                    allCandidates.push({
                        name: obj.name,
                        label: obj.name,
                        type: obj.type,
                        kind: obj.type,
                        level: isExecContext ? 1.0 : 2,
                        displayType: this._formatDisplayType(obj.type),
                        schema: obj.schema,
                        targetObject: obj.target_object,
                        insertText: this.formatInsertText(obj.name, obj.type, context, tabCtx)
                    });
                });
            }

            // Phase 9: Qualified Star Expansion (alias.* per Spec Section 8.4)
            if (context.clause === 'SELECT' || !context.clause) {
                const starItem = await this.expandStarColumns(context, tabCtx, context.qualifier);
                if (starItem) {
                    allCandidates.push(starItem);
                }
            }
        }

        async _generateUnqualifiedObjectCandidates(allCandidates, context, tabCtx, wordLower, metadataErrors) {
            const isStrictAlter = Boolean(context.isAlterContext && context.alterObjectType);
            const isStrictExec = Boolean(context.execContext && context.execContext.isExec && !context.execContext.procedureName);

            // Phase 5: Gợi ý JOIN dựa trên Foreign Key (Spec 11.4)
            let fkRelatedTables = new Map();
            if (context.clause === 'JOIN') {
                fkRelatedTables = await this._generateJoinTargetCandidates(allCandidates, context, tabCtx);
            }

            // Suggest Linked Servers (SQL Server) or Foreign Servers (PostgreSQL)
            const isSqlServer = !tabCtx.dbType || ['sqlserver', 'mssql', 'tsql'].includes(String(tabCtx.dbType).toLowerCase());
            const isPostgres = ['postgresql', 'postgres', 'pg'].includes(String(tabCtx.dbType).toLowerCase());
            const allowServerCandidates = !isStrictAlter && !(context.isInsertColumns || context.clause === 'INSERT_COLUMNS');

            if (allowServerCandidates) {
                if (isSqlServer) {
                    const lservers = await this._getLinkedServers(tabCtx.connectionId);
                    (lservers || []).forEach(ls => {
                        const sName = ls.name || ls.LinkedServerName || '';
                        if (!sName) return;
                        allCandidates.push({
                            name: sName,
                            label: sName,
                            type: 'linked_server',
                            kind: 'server',
                            level: 2.2,
                            displayType: 'Linked Server',
                            detail: (ls.product || ls.Product) ? `${ls.product || ls.Product} (${ls.data_source || ls.DataSource_IP_Or_Instance || ''})` : 'Linked Server',
                            insertText: this.formatInsertText(sName, 'server', context, tabCtx)
                        });
                    });
                }
                if (isPostgres) {
                    const fservers = await this._getForeignServers(tabCtx.connectionId);
                    (fservers || []).forEach(fs => {
                        const sName = fs.name || '';
                        if (!sName) return;
                        allCandidates.push({
                            name: sName,
                            label: sName,
                            type: 'foreign_server',
                            kind: 'server',
                            level: 2.2,
                            displayType: 'Foreign Server',
                            detail: fs.wrapper ? `FDW: ${fs.wrapper}` : 'Foreign Server',
                            insertText: this.formatInsertText(sName, 'server', context, tabCtx)
                        });
                    });
                }
            }

            // Phase 4: Schema candidates (Issue I5)
            // In FROM, JOIN, INSERT INTO, UPDATE, EXEC and ALTER contexts, suggest available schemas
            const isSchemaContext = Boolean(
                context.clause === 'FROM' ||
                context.clause === 'JOIN' ||
                context.clause === 'INSERT INTO' ||
                context.clause === 'UPDATE' ||
                context.clause === 'EXEC' ||
                context.clause === 'EXECUTE' ||
                (context.execContext && context.execContext.isExec) ||
                context.isAlterContext
            );
            let schemas = null;
            if (isSchemaContext && tabCtx.connectionId) {
                if (this.metadataCache && typeof this.metadataCache.getSchemas === 'function') {
                    schemas = this.metadataCache.getSchemas(tabCtx.connectionId, tabCtx.database);
                }
                if (!schemas && this.dataProvider) {
                    try {
                        if (typeof this.dataProvider.getSchemas === 'function') {
                            schemas = await this.dataProvider.getSchemas(tabCtx.connectionId, tabCtx.database);
                        } else if (typeof this.dataProvider.fetchSchemas === 'function') {
                            schemas = await this.dataProvider.fetchSchemas(tabCtx.connectionId, tabCtx.database);
                        }
                        if (schemas && (schemas.hasError || schemas.error)) {
                            metadataErrors.push(schemas.error || new Error('Error fetching schemas'));
                        }
                    } catch (err) {
                        metadataErrors.push(err);
                    }
                    if (schemas && !schemas.hasError && this.metadataCache && typeof this.metadataCache.setSchemas === 'function') {
                        this.metadataCache.setSchemas(tabCtx.connectionId, tabCtx.database, schemas);
                    }
                }

                (schemas || []).forEach(sch => {
                    const sName = typeof sch === 'string' ? sch : (sch.name || sch.schema || '');
                    if (!sName) return;
                    allCandidates.push({
                        name: sName,
                        label: sName,
                        type: 'schema',
                        kind: 'schema',
                        level: 1.5,
                        displayType: 'Schema',
                        insertText: `${this.formatInsertText(sName, 'schema', context, tabCtx)}.`
                    });
                });

                // Cross-Schema Object Suggestions (Issue I5, default false)
                let crossSchemaEnabled = Boolean(tabCtx && tabCtx.crossSchema);
                if (!crossSchemaEnabled) {
                    try {
                        const rawSettings = typeof localStorage !== 'undefined' ? localStorage.getItem('ide-settings') : null;
                        if (rawSettings) {
                            const s = JSON.parse(rawSettings);
                            crossSchemaEnabled = Boolean(s && (s['intellisense.crossSchema'] || (s.intellisense && s.intellisense.crossSchema)));
                        }
                    } catch (_) {}
                }

                if (crossSchemaEnabled && wordLower.length >= 2 && Array.isArray(schemas) && schemas.length > 0) {
                    const otherSchemas = schemas
                        .map(s => typeof s === 'string' ? s : (s.name || s.schema || ''))
                        .filter(s => s && s.toLowerCase() !== (tabCtx.schema || '').toLowerCase());

                    for (const othSch of otherSchemas) {
                        let othObjects = null;
                        if (this.metadataCache && typeof this.metadataCache.getObjects === 'function') {
                            othObjects = this.metadataCache.getObjects(tabCtx.connectionId, tabCtx.database, othSch);
                        }
                        if (!othObjects && this.dataProvider && typeof this.dataProvider.fetchObjects === 'function') {
                            othObjects = await this.dataProvider.fetchObjects(tabCtx.connectionId, tabCtx.database, othSch);
                            if (othObjects && this.metadataCache && typeof this.metadataCache.setObjects === 'function') {
                                this.metadataCache.setObjects(tabCtx.connectionId, tabCtx.database, othSch, othObjects);
                            }
                        }
                        (othObjects || []).slice(0, 50).forEach(obj => {
                            if (isStrictAlter && obj.type !== context.alterObjectType) return;
                            if (isStrictExec && obj.type !== 'procedure') return;
                            if (context.clause === 'FROM' || context.clause === 'JOIN' || context.clause === 'INSERT INTO' || context.clause === 'UPDATE') {
                                if (!['table', 'view', 'temp_table', 'table_variable', 'synonym', 'foreign_table'].includes(obj.type)) return;
                            }
                            const qualifiedName = `${othSch}.${obj.name}`;
                            allCandidates.push({
                                name: obj.name,
                                label: qualifiedName,
                                type: obj.type,
                                kind: obj.type,
                                level: 2.5,
                                displayType: `${this._formatDisplayType(obj.type)} (${othSch})`,
                                schema: othSch,
                                targetObject: obj.target_object,
                                insertText: `${this.formatInsertText(othSch, 'schema', context, tabCtx)}.${this.formatInsertText(obj.name, obj.type, context, tabCtx)}`
                            });
                        });
                    }
                }
            }

            // No qualifier: Fetch database objects for active schema
            let dbObjects = null;
            try {
                dbObjects = await this.dataProvider.fetchObjects(tabCtx.connectionId, tabCtx.database, tabCtx.schema);
                if (dbObjects && (dbObjects.hasError || dbObjects.error)) {
                    metadataErrors.push(dbObjects.error || new Error('Error fetching database objects'));
                }
            } catch (err) {
                metadataErrors.push(err);
            }
            if (this.dataProvider && typeof this.dataProvider.getLastError === 'function') {
                const lastErr = this.dataProvider.getLastError();
                if (lastErr && !metadataErrors.includes(lastErr)) {
                    metadataErrors.push(lastErr);
                }
            }
            const seenTableNames = new Set();

            (dbObjects || []).forEach(obj => {
                // SQL Prompt-style keyword filtering
                if (isStrictAlter) {
                    if (obj.type !== context.alterObjectType) return;
                } else if (isStrictExec) {
                    if (obj.type !== 'procedure') return;
                } else if (context.isInsertColumns || context.clause === 'INSERT_COLUMNS') {
                    return;
                } else if (context.clause === 'FROM' || context.clause === 'JOIN' || context.clause === 'INSERT INTO' || context.clause === 'UPDATE') {
                    if (!['table', 'view', 'temp_table', 'table_variable', 'synonym', 'foreign_table'].includes(obj.type)) return;
                }

                const hasAlias = context.queryTables && context.queryTables.some(
                    qt => (qt.table || '').toLowerCase() === (obj.name || '').toLowerCase() && qt.alias
                );

                const objLower = (obj.name || '').toLowerCase();
                seenTableNames.add(objLower);

                // Phase 5: Boost FK related tables when in JOIN clause
                const isFk = fkRelatedTables.has(objLower);
                const fkInfo = isFk ? fkRelatedTables.get(objLower) : null;

                allCandidates.push({
                    name: obj.name,
                    label: obj.name,
                    type: obj.type,
                    kind: obj.type,
                    level: isFk ? 0.7 : 2,
                    isFkTarget: Boolean(isFk),
                    displayType: obj.type === 'foreign_table' ? 'Foreign Table' : (isFk ? 'Table (FK)' : this._formatDisplayType(obj.type)),
                    detail: fkInfo ? fkInfo.detail : (obj.target_object || ''),
                    schema: obj.schema,
                    targetObject: obj.target_object,
                    isMaskedByAlias: Boolean(hasAlias),
                    insertText: this.formatInsertText(obj.name, obj.type, context, tabCtx)
                });
            });

            // Phase 5: If any FK-related table was not in dbObjects (e.g. different schema), add it
            if (fkRelatedTables.size > 0) {
                fkRelatedTables.forEach((fkInfo, tLower) => {
                    if (!seenTableNames.has(tLower)) {
                        allCandidates.push({
                            name: fkInfo.tableName,
                            label: fkInfo.tableName,
                            type: 'table',
                            kind: 'table',
                            level: 0.7,
                            isFkTarget: true,
                            displayType: 'Table (FK)',
                            detail: fkInfo.detail,
                            schema: fkInfo.schema || tabCtx.schema,
                            insertText: this.formatInsertText(fkInfo.tableName, 'table', context, tabCtx)
                        });
                    }
                });
            }
        }

        async generate(context, tabCtx, wordLower = '') {
            const allCandidates = [];
            const metadataErrors = [];

            // 0a. Data Type Context (Issue I3 - Section 11, Spec Phase 4)
            if (context.isDataTypePosition || context.contextType === 'data_type') {
                await this._generateDataTypeCandidates(allCandidates, context, tabCtx, metadataErrors);
                if (metadataErrors.length > 0) {
                    allCandidates.hasError = true;
                    allCandidates.meta = allCandidates.meta || {};
                    allCandidates.meta.errors = metadataErrors;
                }
                return allCandidates;
            }

            // 0. Level 0: Stored Procedure Parameters (EXEC context - Section 29, 51)
            await this._generateExecParamCandidates(allCandidates, context, tabCtx);

            const isStrictAlter = Boolean(context.isAlterContext && context.alterObjectType);
            const isStrictExec = Boolean(context.execContext && context.execContext.isExec && !context.execContext.procedureName);
            const shouldLoadStandardKeywords = (!context.qualifier && !isStrictAlter && !isStrictExec);

            if (context.hasFollowUp && context.followUpKeywords && context.followUpKeywords.length > 0) {
                context.followUpKeywords.forEach(kw => {
                    if (!wordLower || kw.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: kw,
                            label: kw,
                            type: 'keyword',
                            kind: 'keyword',
                            level: 1,
                            displayType: 'Keyword',
                            insertText: kw
                        });
                    }
                });

                // If inside routine body or following BEGIN, also load standard SQL statement keywords, functions & snippets
                if ((context.isInRoutineBody || context.previousToken === 'BEGIN') && shouldLoadStandardKeywords) {
                    this._loadStandardKeywordsAndSnippets(allCandidates, tabCtx, wordLower);
                }
            } else if (!context.qualifier && !isStrictAlter && !isStrictExec) {
                if (context.isInsertColumns || context.clause === 'INSERT_COLUMNS') {
                    ['VALUES', 'SELECT', 'DEFAULT'].forEach(kw => {
                        allCandidates.push({
                            name: kw,
                            label: kw,
                            type: 'keyword',
                            kind: 'keyword',
                            level: 1.5,
                            displayType: 'Keyword',
                            insertText: kw
                        });
                    });
                } else {
                    this._loadStandardKeywordsAndSnippets(allCandidates, tabCtx, wordLower);
                }
            }

            // 2. Level 2: Local Script Objects (CTEs, Variables, Temp Tables, Aliases)
            if (!context.qualifier && !isStrictAlter) {
                this._generateLocalSymbolCandidates(allCandidates, context, tabCtx);
                await this._generateStatementColumnCandidates(allCandidates, context, tabCtx);
            }

            // 3. Level 3: Database Metadata Objects & Columns (Qualified Resolution)
            if (context.qualifier) {
                await this._generateQualifierCandidates(allCandidates, context, tabCtx, wordLower, metadataErrors);
            } else if (tabCtx.connectionId && this.dataProvider && typeof this.dataProvider.fetchObjects === 'function') {
                // 4. Level 4: Unqualified Objects
                await this._generateUnqualifiedObjectCandidates(allCandidates, context, tabCtx, wordLower, metadataErrors);
            }

            if (metadataErrors.length > 0) {
                allCandidates.hasError = true;
                allCandidates.meta = allCandidates.meta || {};
                allCandidates.meta.errors = metadataErrors;
            }

            return allCandidates;
        }

        _formatDisplayType(type) {
            if (!type) return 'Object';
            return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }

        _loadStandardKeywordsAndSnippets(allCandidates, tabCtx, wordLower) {
            const dialect = (window.SqlDialectFactory)
                ? window.SqlDialectFactory.getDialect(tabCtx.dbType)
                : null;

            const keywordsToUse = dialect
                ? dialect.getKeywords()
                : ((window.SqlContextAnalyzer && window.SqlContextAnalyzer.getKeywordsForDbType)
                    ? window.SqlContextAnalyzer.getKeywordsForDbType(tabCtx.dbType)
                    : (window.SqlContextAnalyzer ? window.SqlContextAnalyzer.SQL_KEYWORDS : []));

            keywordsToUse.forEach(kw => {
                allCandidates.push({
                    name: kw,
                    label: kw,
                    type: 'keyword',
                    kind: 'keyword',
                    level: 1,
                    displayType: 'Keyword',
                    insertText: kw
                });
            });

            // Built-in SQL functions with signatures & documentation (Section 51)
            const functionsToUse = dialect
                ? dialect.getFunctions()
                : (window.SqlContextAnalyzer ? window.SqlContextAnalyzer.SQL_FUNCTIONS : []);

            functionsToUse.forEach(fn => {
                const fnUpper = fn.toUpperCase();
                const sigInfo = FUNCTION_SIGNATURES[fnUpper] || null;
                allCandidates.push({
                    name: fn,
                    label: fn,
                    type: 'sql_function',
                    kind: 'function',
                    level: 1.2,
                    displayType: 'Function',
                    signature: sigInfo ? sigInfo.signature : `${fn}()`,
                    detail: sigInfo ? sigInfo.signature : `${fn}()`,
                    documentation: sigInfo ? sigInfo.documentation : '',
                    insertText: `${fn}()`
                });
            });

            // Snippets
            if (window.AppSnippets && typeof window.AppSnippets.getSnippets === 'function') {
                const allSnips = window.AppSnippets.getSnippets();
                allSnips.forEach(snip => {
                    allCandidates.push({
                        name: snip.prefix,
                        label: snip.prefix,
                        type: 'snippet',
                        kind: 'snippet',
                        level: 1.5,
                        displayType: 'Snippet',
                        description: snip.description || '',
                        snippetData: snip,
                        insertText: snip.body || snip.prefix
                    });
                });
            }
        }

        async _generateJoinTargetCandidates(allCandidates, context, tabCtx) {
            const fkRelatedTables = new Map();
            if (!tabCtx.connectionId || !this.dataProvider || typeof this.dataProvider.fetchForeignKeys !== 'function') {
                return fkRelatedTables;
            }

            let precedingTables = context.queryTables || [];
            if (precedingTables.length === 0 && context.activeScope && typeof context.activeScope.getAllVisibleTables === 'function') {
                precedingTables = context.activeScope.getAllVisibleTables();
            }
            const useLegacyScope = (typeof window !== 'undefined' && window.__USE_LEGACY_SCOPE__) ||
                (typeof localStorage !== 'undefined' && localStorage.getItem('intellisense.v2.legacyScope') === 'true');
            if (useLegacyScope && precedingTables.length === 0 && (context.fullSql || context.statementRange)) {
                const fullSql = context.fullSql || '';
                const textToScan = context.statementRange && fullSql ? fullSql.substring(context.statementRange.start, context.statementRange.end) : fullSql;
                if (window.SqlContextAnalyzer && typeof window.SqlContextAnalyzer.extractAllTablesInQuery === 'function') {
                    precedingTables = window.SqlContextAnalyzer.extractAllTablesInQuery(textToScan);
                }
            }

            const existingAliases = new Set(precedingTables.map(t => (t.alias || '').toLowerCase()).filter(Boolean));

            for (const pt of precedingTables) {
                if (['subquery', 'apply_subquery', 'lateral_subquery', 'table_function', 'cte', 'temp_table', 'table_variable'].includes(pt.type)) continue;

                const ptSchema = pt.schema || '';
                const ptName = CompletionEngine.cleanIdentifier(pt.table || '');
                const ptLower = ptName.toLowerCase();
                const fks = await this.dataProvider.fetchForeignKeys(tabCtx.connectionId, tabCtx.database, ptSchema, ptName, tabCtx.dbType);

                (fks || []).forEach(fk => {
                    const fromLower = CompletionEngine.cleanIdentifier(fk.from_table || '').toLowerCase();
                    const toLower = CompletionEngine.cleanIdentifier(fk.to_table || '').toLowerCase();
                    let relatedName = null;
                    let relatedSchema = null;
                    let isPtParent = false;
                    let fromCols = fk.from_columns || [];
                    let toCols = fk.to_columns || [];

                    if (fromLower === ptLower) {
                        // pt is child, related table is parent (to_table)
                        relatedName = CompletionEngine.cleanIdentifier(fk.to_table || '');
                        relatedSchema = fk.to_schema;
                        isPtParent = false;
                    } else if (toLower === ptLower) {
                        // pt is parent, related table is child (from_table)
                        relatedName = CompletionEngine.cleanIdentifier(fk.from_table || '');
                        relatedSchema = fk.from_schema;
                        isPtParent = true;
                    }

                    if (relatedName && relatedName.toLowerCase() !== ptLower) {
                        const rLower = relatedName.toLowerCase();
                        const ptRef = pt.alias || pt.table;
                        const rAlias = CompletionEngine.generateTableAlias(relatedName, existingAliases);

                        const condParts = [];
                        const len = Math.min(fromCols.length, toCols.length);
                        for (let i = 0; i < len; i++) {
                            if (isPtParent) {
                                condParts.push(`${rAlias}.${fromCols[i]} = ${ptRef}.${toCols[i]}`);
                            } else {
                                condParts.push(`${rAlias}.${toCols[i]} = ${ptRef}.${fromCols[i]}`);
                            }
                        }
                        const condStr = condParts.join(' AND ');
                        const fkDesc = `${fk.from_table}.${fromCols.join(', ')} → ${fk.to_table}.${toCols.join(', ')}`;

                        if (!fkRelatedTables.has(rLower)) {
                            fkRelatedTables.set(rLower, {
                                tableName: relatedName,
                                schema: relatedSchema,
                                alias: rAlias,
                                condition: condStr,
                                detail: `FK: ${fkDesc}`
                            });
                        }
                    }
                });
            }

            // Generate JOIN snippet candidate for each related table
            fkRelatedTables.forEach(info => {
                const formattedTbl = this.formatInsertText(info.tableName, 'table', context, tabCtx);
                const snipText = `${formattedTbl} ${info.alias} ON ${info.condition}`;
                allCandidates.push({
                    name: `${info.tableName} ${info.alias} ON ${info.condition}`,
                    label: `${info.tableName} ${info.alias} ON ${info.condition}`,
                    type: 'snippet',
                    kind: 'snippet',
                    level: 0.6,
                    displayType: 'FK Join Snippet',
                    detail: info.detail,
                    insertText: snipText
                });
            });

            return fkRelatedTables;
        }

        async _generateJoinOnCandidates(allCandidates, context, tabCtx) {
            if (!tabCtx.connectionId) {
                return;
            }

            let queryTables = context.queryTables || [];
            if (queryTables.length < 2 && context.activeScope && typeof context.activeScope.getAllVisibleTables === 'function') {
                const scopeTables = context.activeScope.getAllVisibleTables();
                if (scopeTables && scopeTables.length > queryTables.length) {
                    queryTables = scopeTables;
                }
            }
            const useLegacyScope = (typeof window !== 'undefined' && window.__USE_LEGACY_SCOPE__) ||
                (typeof localStorage !== 'undefined' && localStorage.getItem('intellisense.v2.legacyScope') === 'true');
            if (useLegacyScope && queryTables.length < 2 && (context.fullSql || context.statementRange)) {
                const fullSql = context.fullSql || '';
                const textToScan = context.statementRange && fullSql ? fullSql.substring(context.statementRange.start, context.statementRange.end) : fullSql;
                if (window.SqlContextAnalyzer && typeof window.SqlContextAnalyzer.extractAllTablesInQuery === 'function') {
                    const extraTables = window.SqlContextAnalyzer.extractAllTablesInQuery(textToScan);
                    if (extraTables.length > queryTables.length) {
                        queryTables = extraTables;
                    }
                }
            }

            if (queryTables.length < 2) return;

            const rightTable = queryTables[queryTables.length - 1];
            const leftTables = queryTables.slice(0, queryTables.length - 1);
            const rightRef = rightTable.alias || rightTable.table;
            const rtName = CompletionEngine.cleanIdentifier(rightTable.table || '');
            const rtLower = rtName.toLowerCase();
            let foundFkMatch = false;

            if (this.dataProvider && typeof this.dataProvider.fetchForeignKeys === 'function') {
                const rtSchema = rightTable.schema || '';
                const fks = await this.dataProvider.fetchForeignKeys(tabCtx.connectionId, tabCtx.database, rtSchema, rtName, tabCtx.dbType);

                for (const lt of leftTables) {
                    const leftRef = lt.alias || lt.table;
                    const ltName = CompletionEngine.cleanIdentifier(lt.table || '');
                    const ltLower = ltName.toLowerCase();

                    (fks || []).forEach(fk => {
                        const fromLower = CompletionEngine.cleanIdentifier(fk.from_table || '').toLowerCase();
                        const toLower = CompletionEngine.cleanIdentifier(fk.to_table || '').toLowerCase();
                        let matched = false;
                        const condParts = [];
                        const fromCols = fk.from_columns || [];
                        const toCols = fk.to_columns || [];

                        if (fromLower === rtLower && toLower === ltLower) {
                            // rightTable is child referencing leftTable
                            matched = true;
                            const len = Math.min(fromCols.length, toCols.length);
                            for (let i = 0; i < len; i++) {
                                condParts.push(`${rightRef}.${fromCols[i]} = ${leftRef}.${toCols[i]}`);
                            }
                        } else if (fromLower === ltLower && toLower === rtLower) {
                            // leftTable is child referencing rightTable
                            matched = true;
                            const len = Math.min(fromCols.length, toCols.length);
                            for (let i = 0; i < len; i++) {
                                condParts.push(`${rightRef}.${toCols[i]} = ${leftRef}.${fromCols[i]}`);
                            }
                        }

                        if (matched && condParts.length > 0) {
                            foundFkMatch = true;
                            const condition = condParts.join(' AND ');
                            const fkDesc = `FK: ${fk.from_table}.${fromCols.join(', ')} → ${fk.to_table}.${toCols.join(', ')}`;
                            allCandidates.push({
                                name: condition,
                                label: condition,
                                type: 'join_condition',
                                kind: 'snippet',
                                level: 0.5, // Highest priority!
                                displayType: 'FK Join',
                                detail: fkDesc,
                                insertText: condition
                            });
                        }
                    });
                }
            }

            // Heuristic fallback if no explicit FK constraint found
            if (!foundFkMatch && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                const rtSchema = rightTable.schema || '';
                const rightCols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, rtSchema, rtName, tabCtx.dbType);

                const genericIgnore = new Set([
                    'name', 'code', 'status', 'type', 'description', 'notes', 'comment', 'comments',
                    'created_at', 'updated_at', 'created_date', 'modified_date', 'created_by', 'updated_by',
                    'deleted', 'is_active', 'active', 'rowguid', 'version', 'flag'
                ]);

                for (const lt of leftTables) {
                    const ltSchema = lt.schema || '';
                    const ltName = CompletionEngine.cleanIdentifier(lt.table || '');
                    const leftCols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, ltSchema, ltName, tabCtx.dbType);
                    const leftRef = lt.alias || lt.table;
                    const ltNameClean = ltName.toLowerCase();
                    const rtNameClean = rtName.toLowerCase();
                    const ltSingular = ltNameClean.endsWith('s') ? ltNameClean.slice(0, -1) : ltNameClean;
                    const rtSingular = rtNameClean.endsWith('s') ? rtNameClean.slice(0, -1) : rtNameClean;

                    const matchedPairs = [];

                    (rightCols || []).forEach(rc => {
                        const rcName = rc.name;
                        const rcLower = (rcName || '').toLowerCase();
                        if (genericIgnore.has(rcLower)) return;

                        (leftCols || []).forEach(lc => {
                            const lcName = lc.name;
                            const lcLower = (lcName || '').toLowerCase();
                            if (genericIgnore.has(lcLower)) return;

                            // Match 1: Exact column name match (e.g. CustomerId == CustomerId)
                            if (rcLower === lcLower && rcLower !== 'id') {
                                matchedPairs.push({ rightCol: rcName, leftCol: lcName, priority: 1 });
                            }
                            // Match 2: Pattern: rightCol is CustomerId and left table is Customer/Customers and lc is Id / PK
                            else if (rcLower === `${ltNameClean}id` || rcLower === `${ltNameClean}_id` || 
                                     rcLower === `${ltSingular}id` || rcLower === `${ltSingular}_id`) {
                                if (lcLower === 'id' || lc.is_pk) {
                                    matchedPairs.push({ rightCol: rcName, leftCol: lcName, priority: 2 });
                                }
                            }
                            // Match 3: Pattern: leftCol is OrderId and right table is Order/Orders and rc is Id / PK
                            else if (lcLower === `${rtNameClean}id` || lcLower === `${rtNameClean}_id` || 
                                     lcLower === `${rtSingular}id` || lcLower === `${rtSingular}_id`) {
                                if (rcLower === 'id' || rc.is_pk) {
                                    matchedPairs.push({ rightCol: rcName, leftCol: lcName, priority: 2 });
                                }
                            }
                        });
                    });

                    matchedPairs.sort((a, b) => b.priority - a.priority);

                    matchedPairs.forEach(pair => {
                        const condition = `${rightRef}.${pair.rightCol} = ${leftRef}.${pair.leftCol}`;
                        allCandidates.push({
                            name: condition,
                            label: condition,
                            type: 'join_condition',
                            kind: 'snippet',
                            level: 0.6,
                            displayType: 'Join Condition',
                            detail: 'Suggested by matching column names',
                            insertText: condition
                        });
                    });
                }
            }
        }
    }

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
            const scopeKey = `${context.clause || 'DEFAULT'}::${tablesKey}::${stmtHash}::${aliasSig}::${context.qualifier || ''}::${alterPart}::${execPart}::${dtPart}::${context.resolvedObject ? context.resolvedObject.name : ''}`;

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

        static registerMonacoProvider() {
            if (typeof monaco === 'undefined' || !monaco.languages || typeof monaco.languages.registerSignatureHelpProvider !== 'function') {
                return false;
            }
            if (window._sqlSignatureHelpRegistered) return true;
            window._sqlSignatureHelpRegistered = true;

            monaco.languages.registerSignatureHelpProvider('sql', {
                signatureHelpTriggerCharacters: ['(', ','],
                signatureHelpRetriggerCharacters: [','],
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

    window.SqlFunctionSignatures = FUNCTION_SIGNATURES;
    window.CandidateFilter = CandidateFilter;
    window.CompletionRanker = CompletionRanker;
    window.CandidateGenerator = CandidateGenerator;
    window.CompletionEngine = CompletionEngine;
    window.DefaultCompletionEngine = defaultEngine;
    window.SqlSignatureHelpResolver = signatureResolver;
    window.SqlHoverResolver = hoverResolver;
    window.SqlSignatureHelpResolverClass = SigResolverClass;
    window.SqlHoverResolverClass = HoverResolverClass;

})(typeof window !== 'undefined' ? window : globalThis);

