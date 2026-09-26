define('vs/basic-languages/sql/sql', ['require', 'exports'], function (require, exports) {
    'use strict';
    Object.defineProperty(exports, '__esModule', { value: true });
    exports.conf = {
        comments: {
            lineComment: '--',
            blockComment: ['/*', '*/']
        },
        brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')']
        ],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ],
        surroundingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ]
    };
    exports.language = {
        defaultToken: '',
        tokenPostfix: '.sql',
        ignoreCase: true,
        brackets: [
            { open: '[', close: ']', token: 'delimiter.square' },
            { open: '(', close: ')', token: 'delimiter.parenthesis' },
            { open: '{', close: '}', token: 'delimiter.curly' }
        ],
        keywords: [
            'ABORT', 'ACTION', 'ADD', 'AFTER', 'ALL', 'ALTER', 'ANALYZE', 'AND', 'ANY', 'AS', 'ASC',
            'ATTACH', 'AUTOINCREMENT', 'AUTO_INCREMENT', 'BACKUP', 'BEFORE', 'BEGIN', 'BETWEEN',
            'BREAK', 'BY', 'CASCADE', 'CASE', 'CAST', 'CATCH', 'CHECK', 'CHECKPOINT', 'CLOSE',
            'CLUSTERED', 'COLLATE', 'COLUMN', 'COMMIT', 'COMMITTED', 'CONFLICT', 'CONSTRAINT',
            'CONSTRAINTS', 'CONTINUE', 'CONVERT', 'CREATE', 'CROSS', 'CURRENT', 'CURRENT_DATE',
            'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURRENT_USER', 'CURSOR', 'DATABASE', 'DBCC',
            'DEALLOCATE', 'DECLARE', 'DEFAULT', 'DELETE', 'DENY', 'DESC', 'DETACH', 'DISABLE',
            'DISTINCT', 'DO', 'DROP', 'ELSE', 'ENABLE', 'END', 'ESCAPE', 'EXCEPT', 'EXEC',
            'EXECUTE', 'EXISTS', 'EXIT', 'EXPLAIN', 'FAIL', 'FETCH', 'FILTER', 'FOR', 'FOREIGN',
            'FROM', 'FULL', 'FUNCTION', 'GLOB', 'GO', 'GOTO', 'GRANT', 'GROUP', 'HAVING',
            'IDENTITY', 'IDENTITY_INSERT', 'IF', 'IGNORE', 'IN', 'INDEX', 'INDEXED', 'INITIALLY',
            'INNER', 'INSERT', 'INSTEAD', 'INTERSECT', 'INTO', 'IS', 'ISNULL', 'JOIN', 'KEY',
            'KILL', 'LEFT', 'LIKE', 'LIMIT', 'MATCH', 'MERGE', 'NATURAL', 'NOCHECK', 'NONCLUSTERED',
            'NOT', 'NOTNULL', 'NULL', 'NULLS', 'OF', 'OFF', 'OFFSET', 'ON', 'OPEN', 'OPTION',
            'OR', 'ORDER', 'OUTER', 'OVER', 'PARTITION', 'PLAN', 'PRAGMA', 'PRIMARY', 'PRINT',
            'PROC', 'PROCEDURE', 'RAISERROR', 'RECONFIGURE', 'RECURSIVE', 'REFERENCES', 'REGEXP',
            'REINDEX', 'RELEASE', 'RENAME', 'REPLACE', 'RESTRICT', 'RETURN', 'RETURNS', 'REVOKE',
            'RIGHT', 'ROLLBACK', 'ROLLUP', 'ROW', 'ROWCOUNT', 'ROWS', 'SAVE', 'SAVEPOINT',
            'SCHEMA', 'SELECT', 'SET', 'STATISTICS', 'TABLE', 'TEMP', 'TEMPORARY', 'THEN',
            'THROW', 'TO', 'TOP', 'TRAN', 'TRANSACTION', 'TRIGGER', 'TRUNCATE', 'TRY', 'UNION',
            'UNIQUE', 'UPDATE', 'UPDATETEXT', 'USE', 'USER', 'USING', 'VACUUM', 'VALUES',
            'VIEW', 'WAITFOR', 'WHEN', 'WHERE', 'WHILE', 'WINDOW', 'WITH', 'WITHOUT'
        ],
        operators: [
            'ALL', 'AND', 'ANY', 'BETWEEN', 'EXISTS', 'IN', 'LIKE', 'NOT', 'OR', 'SOME',
            'EXCEPT', 'INTERSECT', 'UNION', 'APPLY', 'CROSS', 'FULL', 'INNER', 'JOIN',
            'LEFT', 'OUTER', 'RIGHT',
            '=', '>', '<', '>=', '<=', '<>', '!=', '!<', '!>',
            '+=', '-=', '*=', '/=', '%=', '&=', '^-=', '|*=',
            '+', '-', '*', '/', '%', '&', '|', '^', '~', '||'
        ],
        builtinFunctions: [
            'ABS', 'ACOS', 'ASIN', 'ATAN', 'ATN2', 'CEILING', 'COS', 'COT', 'DEGREES', 'EXP',
            'FLOOR', 'LOG', 'LOG10', 'PI', 'POWER', 'RADIANS', 'RAND', 'ROUND', 'SIGN', 'SIN',
            'SQRT', 'SQUARE', 'TAN',
            'ASCII', 'CHAR', 'CHARINDEX', 'CONCAT', 'CONCAT_WS', 'DIFFERENCE', 'FORMAT',
            'LEFT', 'LEN', 'LENGTH', 'LOWER', 'LTRIM', 'NCHAR', 'PATINDEX', 'QUOTENAME', 'REPLACE',
            'REPLICATE', 'REVERSE', 'RIGHT', 'RTRIM', 'SOUNDEX', 'SPACE', 'STR', 'STRING_AGG',
            'STRING_ESCAPE', 'STRING_SPLIT', 'STUFF', 'SUBSTR', 'SUBSTRING', 'TRANSLATE', 'TRIM',
            'UNICODE', 'UPPER',
            'DATEADD', 'DATEDIFF', 'DATEFROMPARTS', 'DATENAME', 'DATEPART', 'DAY', 'EOMONTH',
            'GETDATE', 'GETUTCDATE', 'ISDATE', 'MONTH', 'NOW', 'SYSDATETIME', 'SYSDATETIMEOFFSET',
            'SYSUTCDATETIME', 'YEAR', 'AGE', 'DATE_TRUNC', 'EXTRACT',
            'CAST', 'CONVERT', 'PARSE', 'TRY_CAST', 'TRY_CONVERT', 'TRY_PARSE',
            'COALESCE', 'IIF', 'CHOOSE', 'ISNULL', 'ISNUMERIC', 'NULLIF', 'NVL',
            'COUNT', 'COUNT_BIG', 'MAX', 'MIN', 'SUM', 'AVG',
            'DENSE_RANK', 'NTILE', 'RANK', 'ROW_NUMBER', 'LEAD', 'LAG', 'FIRST_VALUE', 'LAST_VALUE',
            'OBJECT_ID', 'OBJECT_NAME', 'COL_NAME', 'SCHEMA_ID', 'SCHEMA_NAME', 'DB_NAME', 'DB_ID'
        ],
        builtinVariables: [
            '@@ERROR', '@@IDENTITY', '@@ROWCOUNT', '@@SERVERNAME', '@@SPID', '@@TRANCOUNT',
            '@@VERSION', '@@FETCH_STATUS', '@@MAX_CONNECTIONS', '@@LOCK_TIMEOUT', '@@NESTLEVEL'
        ],
        dataTypes: [
            'BIGINT', 'INT', 'INTEGER', 'SMALLINT', 'TINYINT', 'BIT', 'DECIMAL', 'NUMERIC',
            'MONEY', 'SMALLMONEY', 'FLOAT', 'REAL', 'DATE', 'DATETIME', 'DATETIME2', 'SMALLDATETIME',
            'TIME', 'DATETIMEOFFSET', 'TIMESTAMP', 'TIMESTAMPTZ',
            'CHAR', 'VARCHAR', 'TEXT', 'NCHAR', 'NVARCHAR', 'NTEXT',
            'BINARY', 'VARBINARY', 'IMAGE', 'BYTEA',
            'BOOLEAN', 'BOOL', 'UUID', 'UNIQUEIDENTIFIER', 'XML', 'JSON', 'JSONB', 'SERIAL', 'BIGSERIAL'
        ],
        tokenizer: {
            root: [
                { include: '@comments' },
                { include: '@whitespace' },
                { include: '@numbers' },
                { include: '@strings' },
                { include: '@complexIdentifiers' },
                [/[;,.]/, 'delimiter'],
                [/[()]/, '@brackets'],
                [/@@[a-zA-Z_]\w*/, 'variable.predefined'],
                [/@[a-zA-Z_]\w*/, 'variable'],
                [/#[a-zA-Z_]\w*/, 'type.identifier'],
                [/[a-zA-Z_]\w*/, {
                    cases: {
                        '@keywords': 'keyword',
                        '@dataTypes': 'type',
                        '@builtinFunctions': 'predefined',
                        '@operators': 'operator',
                        '@default': 'identifier'
                    }
                }],
                [/[<>=!%&+\-*/|~^]/, 'operator']
            ],
            whitespace: [
                [/\s+/, 'white']
            ],
            comments: [
                [/--.*$/, 'comment'],
                [/\/\*/, { token: 'comment.quote', next: '@comment' }]
            ],
            comment: [
                [/[^*/]+/, 'comment'],
                [/\*\//, { token: 'comment.quote', next: '@pop' }],
                [/./, 'comment']
            ],
            numbers: [
                [/0[xX][0-9a-fA-F]+/, 'number.hex'],
                [/\d+(\.\d+)?([eE][\-+]?\d+)?/, 'number']
            ],
            strings: [
                [/N'/, { token: 'string', next: '@string' }],
                [/'/, { token: 'string', next: '@string' }]
            ],
            string: [
                [/[^']+/, 'string'],
                [/''/, 'string.escape'],
                [/'/, { token: 'string', next: '@pop' }]
            ],
            complexIdentifiers: [
                [/\[/, { token: 'identifier.quote', next: '@bracketedIdentifier' }],
                [/"/, { token: 'identifier.quote', next: '@quotedIdentifier' }]
            ],
            bracketedIdentifier: [
                [/[^\]]+/, 'identifier'],
                [/]]/, 'identifier'],
                [/]/, { token: 'identifier.quote', next: '@pop' }]
            ],
            quotedIdentifier: [
                [/[^"]+/, 'identifier'],
                [/""/, 'identifier'],
                [/"/, { token: 'identifier.quote', next: '@pop' }]
            ]
        }
    };
});
