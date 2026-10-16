// Scope and Alias Resolver for Web IDE IntelliSense
// Compliant with Section 12, 13, 14, 39, 40, 46, 47, 48, 65, and 70 of intellisense_improvement_plan_v2.md

(function (window) {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. SYMBOL & SYMBOL TABLE (Hierarchical Scope Tree)
    // ─────────────────────────────────────────────────────────────────────────────
    class SqlSymbol {
        constructor({ name, type = 'table', schema = '', database = '', server = '', sourceType = '', alias = '', columns = [], dataType = '', targetObject = '', hasStar = false, underlyingTables = [] }) {
            this.name = name;
            this.type = type; // 'table', 'view', 'cte', 'subquery', 'temp_table', 'table_variable', 'scalar_variable', 'pseudo_table', 'remote_table', 'foreign_table'
            this.schema = schema;
            this.database = database;
            this.server = server;
            this.sourceType = sourceType || (server ? 'REMOTE_TABLE' : (type === 'foreign_table' ? 'FOREIGN_TABLE' : 'TABLE'));
            this.alias = alias;
            this.columns = columns; // Projected or defined columns
            this.dataType = dataType; // Data type (if scalar variable)
            this.targetObject = targetObject || this.name;
            this.hasStar = Boolean(hasStar);
            this.underlyingTables = underlyingTables || [];
        }

        toContextObject() {
            return {
                object: this.targetObject || this.name,
                table: this.targetObject || this.name,
                targetObject: this.targetObject || this.name,
                schema: this.schema,
                database: this.database || null,
                server: this.server || null,
                sourceType: this.sourceType,
                alias: this.alias || '',
                type: this.type,
                columns: this.columns,
                dataType: this.dataType,
                hasStar: Boolean(this.hasStar),
                underlyingTables: this.underlyingTables || []
            };
        }
    }

    class SymbolTable {
        constructor(parentScope = null, range = { start: 0, end: Infinity }) {
            this.parentScope = parentScope;
            this.childScopes = [];
            this.range = range; // { start, end } character offset
            this.symbols = new Map(); // lowercase object name -> Symbol
            this.aliases = new Map(); // lowercase alias -> Symbol

            if (parentScope) {
                parentScope.childScopes.push(this);
            }
        }

        addSymbol(symbol) {
            if (!symbol || !symbol.name) return;
            const key = symbol.name.toLowerCase();
            this.symbols.set(key, symbol);

            if (symbol.alias) {
                this.aliases.set(symbol.alias.toLowerCase(), symbol);
            }
        }

        resolve(identifier) {
            if (!identifier) return null;
            const key = identifier.toLowerCase().trim();

            // 1. Check local aliases in current scope first
            if (this.aliases.has(key)) {
                return this.aliases.get(key);
            }

            // 2. Check local symbols (table/cte/temp/var names) in current scope
            if (this.symbols.has(key)) {
                return this.symbols.get(key);
            }

            // 3. Walk up lexical scope chain to parent query / outer scope
            if (this.parentScope) {
                return this.parentScope.resolve(identifier);
            }

            return null;
        }

        getAllVisibleSymbols() {
            const result = new Map();
            // Inherit from parent first
            if (this.parentScope) {
                const parentSyms = this.parentScope.getAllVisibleSymbols();
                parentSyms.forEach((sym, k) => result.set(k, sym));
            }
            // Local symbols override or add to parent
            this.symbols.forEach((sym, k) => result.set(k, sym));
            this.aliases.forEach((sym, k) => result.set(k, sym));
            return result;
        }

        getSymbolsByType(type) {
            if (!type) return [];
            const targetType = type.toLowerCase();
            const result = [];
            const seen = new Set();

            const all = this.getAllVisibleSymbols();
            all.forEach(sym => {
                if (sym.type && sym.type.toLowerCase() === targetType) {
                    const key = sym.name.toLowerCase();
                    if (!seen.has(key)) {
                        seen.add(key);
                        result.push(sym);
                    }
                }
            });

            return result;
        }

        getAllVisibleCtes() {
            return this.getSymbolsByType('cte');
        }

        getAllVisibleVariables() {
            return [...this.getSymbolsByType('scalar_variable'), ...this.getSymbolsByType('table_variable')];
        }

        getAllVisibleTempTables() {
            return this.getSymbolsByType('temp_table');
        }

        getAllVisibleTables() {
            const map = this.getAllVisibleSymbols();
            const seen = new Set();
            const tables = [];

            map.forEach(sym => {
                if (['table', 'view', 'cte', 'subquery', 'apply_subquery', 'lateral_subquery', 'table_function', 'temp_table', 'table_variable', 'pseudo_table', 'remote_table', 'foreign_table'].includes(sym.type)) {
                    const key = `${(sym.server || '').toLowerCase()}::${(sym.database || '').toLowerCase()}::${(sym.schema || '').toLowerCase()}::${sym.name.toLowerCase()}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        tables.push({
                            server: sym.server || null,
                            database: sym.database || null,
                            schema: sym.schema,
                            table: sym.name,
                            targetObject: sym.targetObject || sym.name,
                            alias: sym.alias || '',
                            type: sym.type,
                            sourceType: sym.sourceType || (sym.server ? 'REMOTE_TABLE' : (sym.type === 'foreign_table' ? 'FOREIGN_TABLE' : 'TABLE')),
                            columns: sym.columns || []
                        });
                    }
                }
            });

            return tables;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. ALIAS RESOLVER (Section 13, 39, 40, 46, 47)
    // ─────────────────────────────────────────────────────────────────────────────
    class AliasResolver {
        constructor() {
            this.nonAliases = new Set([
                "WHERE", "ON", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER",
                "GROUP", "ORDER", "HAVING", "LIMIT", "UNION", "APPLY", "LATERAL", "NATURAL", "WITH",
                "SELECT", "FROM", "INTO", "SET", "VALUES", "IN", "AND", "OR",
                "MERGE", "USING", "WHEN", "MATCHED", "THEN"
            ]);
        }

        cleanIdentifier(name) {
            if (!name) return "";
            name = name.trim();
            if ((name.startsWith("[") && name.endsWith("]")) ||
                (name.startsWith('"') && name.endsWith('"')) ||
                (name.startsWith('`') && name.endsWith('`'))) {
                return name.substring(1, name.length - 1);
            }
            return name;
        }

        parseSelectProjection(codeTokens, startIndex, endIndex) {
            if (!codeTokens || startIndex >= endIndex) return [];
            const columns = [];
            let i = startIndex;

            // Advance past SELECT, DISTINCT, TOP ...
            while (i < endIndex) {
                const upper = (codeTokens[i].upper || codeTokens[i].value).toUpperCase();
                if (upper === 'SELECT' || upper === 'DISTINCT' || upper === 'ALL') {
                    i++;
                } else if (upper === 'TOP') {
                    i++;
                    if (i < endIndex && codeTokens[i].value === '(') {
                        let depth = 1;
                        i++;
                        while (i < endIndex && depth > 0) {
                            if (codeTokens[i].value === '(') depth++;
                            else if (codeTokens[i].value === ')') depth--;
                            i++;
                        }
                    } else if (i < endIndex && codeTokens[i].type === 'NUMBER') {
                        i++;
                    }
                } else {
                    break;
                }
            }

            // Collect projection tokens until FROM, WHERE, GROUP, HAVING, ORDER, UNION at depth 0
            const projTokens = [];
            let parenDepth = 0;
            while (i < endIndex) {
                const tok = codeTokens[i];
                if (tok.value === '(') parenDepth++;
                else if (tok.value === ')') parenDepth--;

                if (parenDepth === 0) {
                    const upper = (tok.upper || tok.value).toUpperCase();
                    if (['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION'].includes(upper)) {
                        break;
                    }
                }
                projTokens.push(tok);
                i++;
            }

            // Split projTokens by comma at depth 0
            const items = [];
            let currentItem = [];
            parenDepth = 0;

            for (const tok of projTokens) {
                if (tok.value === '(') parenDepth++;
                else if (tok.value === ')') parenDepth--;

                if (parenDepth === 0 && tok.value === ',') {
                    if (currentItem.length > 0) items.push(currentItem);
                    currentItem = [];
                } else {
                    currentItem.push(tok);
                }
            }
            if (currentItem.length > 0) items.push(currentItem);

            let hasStar = false;
            const starQualifiers = [];

            // Parse each column item
            for (const chunk of items) {
                if (chunk.length === 0) continue;

                // Check for wildcard: * or alias.* or table.*
                const starIdx = chunk.findIndex(t => t.value === '*');
                if (starIdx !== -1) {
                    hasStar = true;
                    if (starIdx > 0 && chunk[starIdx - 1].value === '.' && starIdx >= 2) {
                        const qual = this.cleanIdentifier(chunk[starIdx - 2].value);
                        if (qual) starQualifiers.push(qual);
                    } else {
                        starQualifiers.push('*');
                    }
                    continue;
                }

                let colName = "";
                let asIdx = -1;

                // Check for AS keyword at depth 0
                parenDepth = 0;
                for (let k = 0; k < chunk.length; k++) {
                    if (chunk[k].value === '(') parenDepth++;
                    else if (chunk[k].value === ')') parenDepth--;
                    if (parenDepth === 0 && (chunk[k].upper || chunk[k].value).toUpperCase() === 'AS') {
                        asIdx = k;
                        break;
                    }
                }

                if (asIdx !== -1 && asIdx + 1 < chunk.length) {
                    colName = this.cleanIdentifier(chunk[asIdx + 1].value);
                } else {
                    // Check if last token is an identifier alias (e.g. `colName alias` or `expr alias`)
                    const lastTok = chunk[chunk.length - 1];
                    if (chunk.length > 1 && lastTok.type === 'IDENTIFIER' && !this.nonAliases.has((lastTok.upper || lastTok.value).toUpperCase())) {
                        colName = this.cleanIdentifier(lastTok.value);
                    } else {
                        // Look for last identifier in chunk (e.g. `t.CustomerId` or `CustomerId`)
                        for (let k = chunk.length - 1; k >= 0; k--) {
                            if (chunk[k].type === 'IDENTIFIER' || chunk[k].type === 'KEYWORD') {
                                const val = (chunk[k].upper || chunk[k].value).toUpperCase();
                                if (!this.nonAliases.has(val) && chunk[k].value !== '*') {
                                    colName = this.cleanIdentifier(chunk[k].value);
                                    break;
                                }
                            }
                        }
                    }
                }

                if (colName && colName !== '*' && !columns.some(c => c.name.toLowerCase() === colName.toLowerCase())) {
                    columns.push({
                        name: colName,
                        type: 'column',
                        displayType: 'Column'
                    });
                }
            }

            columns.hasStar = hasStar;
            columns.starQualifiers = starQualifiers;
            return columns;
        }

        extractSubquerySourceTables(codeTokens, startIndex, endIndex) {
            if (!codeTokens || startIndex >= endIndex) return [];
            const tables = [];
            let parenDepth = 0;

            // Find FROM keyword at depth 0 inside subquery
            let fromIdx = -1;
            for (let i = startIndex; i < endIndex; i++) {
                const tok = codeTokens[i];
                if (tok.value === '(') parenDepth++;
                else if (tok.value === ')') {
                    if (parenDepth > 0) parenDepth--;
                }
                if (parenDepth === 0 && (tok.upper || tok.value).toUpperCase() === 'FROM') {
                    fromIdx = i;
                    break;
                }
            }
            if (fromIdx === -1) return tables;

            // Scan table references from FROM until WHERE, GROUP, HAVING, ORDER, LIMIT, UNION, ';' at depth 0
            parenDepth = 0;
            for (let i = fromIdx; i < endIndex; i++) {
                const tok = codeTokens[i];
                if (tok.value === '(') parenDepth++;
                else if (tok.value === ')') {
                    if (parenDepth > 0) parenDepth--;
                }

                if (parenDepth === 0) {
                    const up = (tok.upper || tok.value).toUpperCase();
                    if (['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', ';'].includes(up)) {
                        break;
                    }
                    if (up === 'FROM' || up === 'JOIN') {
                        let j = i + 1;
                        if (j < endIndex && codeTokens[j].value === '(') {
                            continue; // skip nested subqueries
                        }
                        let tableParts = [];
                        while (j < endIndex) {
                            const t = codeTokens[j];
                            const tVal = (t.upper || t.value).toUpperCase();
                            if (this.nonAliases.has(tVal) || t.value === '(' || t.value === ')' || t.value === ';' || t.value === ',') {
                                break;
                            }
                            if (t.type === 'IDENTIFIER' || t.type === 'PARAMETER' || t.type === 'KEYWORD') {
                                tableParts.push(this.cleanIdentifier(t.value));
                                j++;
                                if (j < endIndex && codeTokens[j].value === '.') {
                                    j++;
                                } else {
                                    break;
                                }
                            } else {
                                break;
                            }
                        }
                        if (tableParts.length > 0) {
                            let schemaName = "";
                            let tableName = "";
                            if (tableParts.length === 1) {
                                tableName = tableParts[0];
                            } else if (tableParts.length === 2) {
                                schemaName = tableParts[0];
                                tableName = tableParts[1];
                            } else if (tableParts.length >= 3) {
                                schemaName = tableParts[tableParts.length - 2];
                                tableName = tableParts[tableParts.length - 1];
                            }

                            let aliasName = "";
                            if (j < endIndex) {
                                const nextWord = (codeTokens[j].upper || codeTokens[j].value).toUpperCase();
                                if (nextWord === 'AS') {
                                    j++;
                                    if (j < endIndex && codeTokens[j].type === 'IDENTIFIER') {
                                        aliasName = this.cleanIdentifier(codeTokens[j].value);
                                    }
                                } else if (!this.nonAliases.has(nextWord) && codeTokens[j].value !== ')' && codeTokens[j].value !== '(' && codeTokens[j].value !== ';' && codeTokens[j].value !== ',') {
                                    if (codeTokens[j].type === 'IDENTIFIER') {
                                        aliasName = this.cleanIdentifier(codeTokens[j].value);
                                    }
                                }
                            }

                            tables.push({
                                schema: schemaName,
                                table: tableName,
                                alias: aliasName
                            });
                        }
                    }
                }
            }
            return tables;
        }

        parseColumnDefinitions(codeTokens, openParenIndex, closeParenIndex) {
            if (!codeTokens || openParenIndex >= closeParenIndex) return [];
            const columns = [];
            const innerTokens = codeTokens.slice(openParenIndex + 1, closeParenIndex);

            // Split by comma at paren depth 0
            const defChunks = [];
            let current = [];
            let depth = 0;

            for (const t of innerTokens) {
                if (t.value === '(') depth++;
                else if (t.value === ')') depth--;

                if (depth === 0 && t.value === ',') {
                    if (current.length > 0) defChunks.push(current);
                    current = [];
                } else {
                    current.push(t);
                }
            }
            if (current.length > 0) defChunks.push(current);

            const constraintKeywords = new Set([
                'CONSTRAINT', 'PRIMARY', 'FOREIGN', 'CHECK', 'UNIQUE', 'INDEX', 'KEY'
            ]);

            for (const chunk of defChunks) {
                if (chunk.length === 0) continue;
                const firstUpper = (chunk[0].upper || chunk[0].value).toUpperCase();
                if (constraintKeywords.has(firstUpper)) continue;

                // Column name is first identifier
                const colName = this.cleanIdentifier(chunk[0].value);
                if (!colName) continue;

                // Data type is subsequent tokens up to constraints (NULL, NOT, PRIMARY, DEFAULT, etc.)
                let dataTypeParts = [];
                let dDepth = 0;
                for (let k = 1; k < chunk.length; k++) {
                    const tk = chunk[k];
                    if (tk.value === '(') dDepth++;
                    else if (tk.value === ')') dDepth--;

                    const up = (tk.upper || tk.value).toUpperCase();
                    if (dDepth === 0 && ['NULL', 'NOT', 'PRIMARY', 'DEFAULT', 'CHECK', 'IDENTITY', 'REFERENCES', 'COLLATE'].includes(up)) {
                        break;
                    }
                    dataTypeParts.push(tk.value);
                }

                const dataType = dataTypeParts.join('').trim() || 'INT';

                if (!columns.some(c => c.name.toLowerCase() === colName.toLowerCase())) {
                    columns.push({
                        name: colName,
                        data_type: dataType,
                        type: 'column',
                        displayType: 'Column'
                    });
                }
            }

            return columns;
        }

        extractCtes(codeTokens, symbolTable) {
            if (!codeTokens || !symbolTable) return;

            for (let i = 0; i < codeTokens.length; i++) {
                const upper = (codeTokens[i].upper || codeTokens[i].value).toUpperCase();
                if (upper === 'WITH') {
                    let j = i + 1;

                    // Parse comma-separated CTE list
                    while (j < codeTokens.length) {
                        // Skip recursive keyword if present
                        if ((codeTokens[j].upper || codeTokens[j].value).toUpperCase() === 'RECURSIVE') {
                            j++;
                            if (j >= codeTokens.length) break;
                        }

                        // CTE name
                        if (codeTokens[j].type !== 'IDENTIFIER' && codeTokens[j].type !== 'KEYWORD') break;
                        const cteName = this.cleanIdentifier(codeTokens[j].value);
                        j++;
                        if (j >= codeTokens.length) break;

                        // Optional explicit column list: cteName (col1, col2)
                        let explicitCols = [];
                        if (codeTokens[j].value === '(') {
                            j++; // skip '('
                            while (j < codeTokens.length && codeTokens[j].value !== ')') {
                                if (codeTokens[j].type === 'IDENTIFIER' || codeTokens[j].type === 'KEYWORD') {
                                    if (codeTokens[j].value !== ',') {
                                        explicitCols.push(this.cleanIdentifier(codeTokens[j].value));
                                    }
                                }
                                j++;
                            }
                            if (j < codeTokens.length && codeTokens[j].value === ')') {
                                j++; // skip ')'
                            }
                        }

                        if (j >= codeTokens.length) break;
                        if ((codeTokens[j].upper || codeTokens[j].value).toUpperCase() !== 'AS') break;
                        j++; // skip 'AS'
                        if (j >= codeTokens.length || codeTokens[j].value !== '(') break;

                        const subStart = j;
                        let depth = 1;
                        j++;
                        while (j < codeTokens.length && depth > 0) {
                            if (codeTokens[j].value === '(') depth++;
                            else if (codeTokens[j].value === ')') depth--;
                            j++;
                        }
                        const subEnd = j - 1; // index of closing ')'

                        let columns = [];
                        if (explicitCols.length > 0) {
                            columns = explicitCols.map(col => ({
                                name: col,
                                type: 'column',
                                displayType: 'Column'
                            }));
                        } else {
                            // Extract projection from inside the CTE subquery
                            columns = this.parseSelectProjection(codeTokens, subStart + 1, subEnd);
                        }

                        const cteSym = new SqlSymbol({
                            name: cteName,
                            type: 'cte',
                            columns: columns
                        });
                        symbolTable.addSymbol(cteSym);

                        // Check if another CTE follows (comma separated)
                        if (j < codeTokens.length && codeTokens[j].value === ',') {
                            j++; // skip ',' and parse next CTE
                        } else {
                            break;
                        }
                    }
                }
            }
        }

        parseRoutineParams(codeTokens, openP, closeP, symbolTable) {
            const innerTokens = codeTokens.slice(openP + 1, closeP);
            const chunks = [];
            let current = [];
            let depth = 0;
            for (const t of innerTokens) {
                if (t.value === '(') depth++;
                else if (t.value === ')') depth--;

                if (depth === 0 && t.value === ',') {
                    if (current.length > 0) chunks.push(current);
                    current = [];
                } else {
                    current.push(t);
                }
            }
            if (current.length > 0) chunks.push(current);

            for (const chunk of chunks) {
                if (chunk.length === 0) continue;
                let idx = 0;
                // Skip PostgreSQL direction keywords: IN, OUT, INOUT, VARIADIC
                const firstUp = (chunk[0].upper || chunk[0].value).toUpperCase();
                if (['IN', 'OUT', 'INOUT', 'VARIADIC'].includes(firstUp)) {
                    idx = 1;
                }
                if (idx >= chunk.length) continue;

                const rawVal = chunk[idx].value;
                const pName = rawVal.startsWith('@') ? rawVal : this.cleanIdentifier(rawVal);
                idx++;

                let dtParts = [];
                while (idx < chunk.length && chunk[idx].value !== '=' && (chunk[idx].upper || chunk[idx].value).toUpperCase() !== 'DEFAULT') {
                    dtParts.push(chunk[idx].value);
                    idx++;
                }

                if (pName && (rawVal.startsWith('@') || dtParts.length > 0)) {
                    symbolTable.addSymbol(new SqlSymbol({
                        name: pName,
                        type: 'scalar_variable',
                        dataType: dtParts.join('').trim(),
                        displayType: 'Parameter'
                    }));
                }
            }
        }

        extractTempTablesAndVariables(codeTokens, symbolTable) {
            if (!codeTokens || !symbolTable) return;

            for (let i = 0; i < codeTokens.length; i++) {
                const upper = (codeTokens[i].upper || codeTokens[i].value).toUpperCase();

                // 1. CREATE [LOCAL|GLOBAL] TABLE / TEMP TABLE (#temp in SQL Server, temp_tbl in Postgres/SQLite)
                if (upper === 'CREATE') {
                    let k = i + 1;
                    while (k < codeTokens.length && ['OR', 'REPLACE', 'GLOBAL', 'LOCAL', 'UNLOGGED'].includes((codeTokens[k].upper || codeTokens[k].value).toUpperCase())) {
                        k++;
                    }
                    let isTable = false;
                    const isTempKw = k < codeTokens.length && ['TEMP', 'TEMPORARY'].includes((codeTokens[k].upper || codeTokens[k].value).toUpperCase());
                    if (isTempKw) {
                        k++;
                        if (k < codeTokens.length && (codeTokens[k].upper || codeTokens[k].value).toUpperCase() === 'TABLE') {
                            k++;
                        }
                        isTable = true;
                    } else if (k < codeTokens.length && (codeTokens[k].upper || codeTokens[k].value).toUpperCase() === 'TABLE') {
                        k++;
                        isTable = true;
                    }

                    if (isTable) {
                        if (k < codeTokens.length && (codeTokens[k].upper || codeTokens[k].value).toUpperCase() === 'IF' && k + 2 < codeTokens.length) {
                            k += 3; // skip IF NOT EXISTS
                        }

                        if (k < codeTokens.length) {
                            const tableName = this.cleanIdentifier(codeTokens[k].value);
                            const isTempTable = isTempKw || tableName.startsWith('#');
                            if (tableName && !/^#+$/.test(tableName)) {
                                let openParen = -1;
                                let asIdx = -1;
                                for (let m = k + 1; m < codeTokens.length; m++) {
                                    const mUp = (codeTokens[m].upper || codeTokens[m].value).toUpperCase();
                                    if (codeTokens[m].value === '(') { openParen = m; break; }
                                    if (mUp === 'AS') { asIdx = m; break; }
                                    if (codeTokens[m].value === ';') break;
                                }
                                let columns = [];
                                let sourceTables = [];
                                if (openParen !== -1) {
                                    let depth = 1;
                                    let closeParen = -1;
                                    for (let m = openParen + 1; m < codeTokens.length; m++) {
                                        if (codeTokens[m].value === '(') depth++;
                                        else if (codeTokens[m].value === ')') {
                                            depth--;
                                            if (depth === 0) { closeParen = m; break; }
                                        }
                                    }
                                    if (closeParen !== -1) {
                                        columns = this.parseColumnDefinitions(codeTokens, openParen, closeParen);
                                    }
                                } else if (asIdx !== -1 && asIdx + 1 < codeTokens.length) {
                                    let stmtEnd = codeTokens.length;
                                    for (let m = asIdx + 1; m < codeTokens.length; m++) {
                                        if (codeTokens[m].value === ';') { stmtEnd = m; break; }
                                    }
                                    columns = this.parseSelectProjection(codeTokens, asIdx + 1, stmtEnd);
                                    sourceTables = this.extractSubquerySourceTables(codeTokens, asIdx + 1, stmtEnd);
                                }
                                const primarySource = sourceTables.length > 0 ? sourceTables[0] : null;
                                symbolTable.addSymbol(new SqlSymbol({
                                    name: tableName,
                                    type: isTempTable ? 'temp_table' : 'table',
                                    columns: columns,
                                    displayType: isTempTable ? 'Temp Table' : 'Table',
                                    hasStar: Boolean(columns.hasStar),
                                    targetObject: primarySource ? primarySource.table : tableName,
                                    schema: primarySource ? primarySource.schema : '',
                                    underlyingTables: sourceTables
                                }));
                            }
                        }
                    }
                }

                // 2. SELECT ... INTO #temp / INTO TEMP tbl (SQL Server & Postgres)
                if (upper === 'INTO') {
                    let k = i + 1;
                    let isTemp = false;
                    if (k < codeTokens.length && ['TEMP', 'TEMPORARY', 'UNLOGGED'].includes((codeTokens[k].upper || codeTokens[k].value).toUpperCase())) {
                        isTemp = true;
                        k++;
                        if (k < codeTokens.length && (codeTokens[k].upper || codeTokens[k].value).toUpperCase() === 'TABLE') {
                            k++;
                        }
                    }
                    if (k < codeTokens.length) {
                        const tbl = this.cleanIdentifier(codeTokens[k].value);
                        if ((isTemp || tbl.startsWith('#')) && tbl && !/^#+$/.test(tbl)) {
                            let selectIdx = -1;
                            for (let b = i - 1; b >= 0; b--) {
                                if (codeTokens[b].value === ';') break;
                                if ((codeTokens[b].upper || codeTokens[b].value).toUpperCase() === 'SELECT') {
                                    selectIdx = b;
                                    break;
                                }
                            }
                            let columns = [];
                            if (selectIdx !== -1) {
                                columns = this.parseSelectProjection(codeTokens, selectIdx, i);
                            }
                            let sourceTables = [];
                            let stmtEnd = codeTokens.length;
                            for (let m = k + 1; m < codeTokens.length; m++) {
                                if (codeTokens[m].value === ';') { stmtEnd = m; break; }
                            }
                            sourceTables = this.extractSubquerySourceTables(codeTokens, k + 1, stmtEnd);
                            const primarySource = sourceTables.length > 0 ? sourceTables[0] : null;

                            symbolTable.addSymbol(new SqlSymbol({
                                name: tbl,
                                type: 'temp_table',
                                columns: columns,
                                displayType: 'Temp Table',
                                hasStar: Boolean(columns.hasStar),
                                targetObject: primarySource ? primarySource.table : tbl,
                                schema: primarySource ? primarySource.schema : '',
                                underlyingTables: sourceTables
                            }));
                        }
                    }
                }

                // 3. Routine Parameters: CREATE/ALTER PROCEDURE|FUNCTION [schema.]name ( params ) or @param1 ...
                if (['CREATE', 'ALTER'].includes(upper)) {
                    let k = i + 1;
                    if (k < codeTokens.length && (codeTokens[k].upper || codeTokens[k].value).toUpperCase() === 'OR') {
                        k++;
                        if (k < codeTokens.length && ['ALTER', 'REPLACE'].includes((codeTokens[k].upper || codeTokens[k].value).toUpperCase())) {
                            k++;
                        }
                    }
                    if (k < codeTokens.length && ['PROCEDURE', 'PROC', 'FUNCTION', 'FUNC', 'TRIGGER'].includes((codeTokens[k].upper || codeTokens[k].value).toUpperCase())) {
                        const routineKind = (codeTokens[k].upper || codeTokens[k].value).toUpperCase();
                        k++; // skip PROCEDURE / FUNCTION / TRIGGER

                        // Extract routine name: [schema.]name
                        let rSchema = '';
                        let rName = '';
                        if (k < codeTokens.length && codeTokens[k].value !== '(' && !codeTokens[k].value.startsWith('@')) {
                            rName = this.cleanIdentifier(codeTokens[k].value);
                            k++;
                            if (k + 1 < codeTokens.length && codeTokens[k].value === '.') {
                                rSchema = rName;
                                rName = this.cleanIdentifier(codeTokens[k + 1].value);
                                k += 2;
                            }
                        }

                        // Check for T-SQL TRIGGER: ON [schema.]tableName
                        let triggerTable = null;
                        if (routineKind === 'TRIGGER') {
                            while (k < codeTokens.length && (codeTokens[k].upper || codeTokens[k].value).toUpperCase() !== 'AS' && (codeTokens[k].upper || codeTokens[k].value).toUpperCase() !== 'BEGIN') {
                                const tkUp = (codeTokens[k].upper || codeTokens[k].value).toUpperCase();
                                if (tkUp === 'ON' && k + 1 < codeTokens.length) {
                                    let firstIdent = this.cleanIdentifier(codeTokens[k + 1].value);
                                    let sName = '';
                                    let tName = firstIdent;
                                    if (k + 3 < codeTokens.length && codeTokens[k + 2].value === '.') {
                                        sName = firstIdent;
                                        tName = this.cleanIdentifier(codeTokens[k + 3].value);
                                        k += 2;
                                    }
                                    triggerTable = { schema: sName, table: tName };
                                    k += 2;
                                    break;
                                }
                                k++;
                            }

                            if (triggerTable && triggerTable.table) {
                                symbolTable.addSymbol(new SqlSymbol({
                                    name: 'inserted',
                                    type: 'pseudo_table',
                                    targetObject: triggerTable.table,
                                    schema: triggerTable.schema || '',
                                    displayType: 'Pseudo Table'
                                }));
                                symbolTable.addSymbol(new SqlSymbol({
                                    name: 'deleted',
                                    type: 'pseudo_table',
                                    targetObject: triggerTable.table,
                                    schema: triggerTable.schema || '',
                                    displayType: 'Pseudo Table'
                                }));
                            }
                        }

                        // Check for PostgreSQL Trigger Function: RETURNS TRIGGER
                        if (routineKind === 'FUNCTION' || routineKind === 'FUNC') {
                            let isPgTriggerFunc = false;
                            for (let m = k; m < codeTokens.length; m++) {
                                const mUp = (codeTokens[m].upper || codeTokens[m].value).toUpperCase();
                                if (mUp === 'AS' || codeTokens[m].value === '$$' || mUp === 'BEGIN') break;
                                if (mUp === 'RETURNS' && m + 1 < codeTokens.length) {
                                    if ((codeTokens[m + 1].upper || codeTokens[m + 1].value).toUpperCase() === 'TRIGGER') {
                                        isPgTriggerFunc = true;
                                        break;
                                    }
                                }
                            }

                            if (isPgTriggerFunc) {
                                let pgTrgTable = null;
                                for (let s = 0; s < codeTokens.length; s++) {
                                    const sUp = (codeTokens[s].upper || codeTokens[s].value).toUpperCase();
                                    if (sUp === 'CREATE' && s + 2 < codeTokens.length && (codeTokens[s + 1].upper || codeTokens[s + 1].value).toUpperCase() === 'TRIGGER') {
                                        for (let n = s + 2; n < codeTokens.length; n++) {
                                            const nUp = (codeTokens[n].upper || codeTokens[n].value).toUpperCase();
                                            if (nUp === ';' || nUp === 'BEGIN') break;
                                            if (nUp === 'ON' && n + 1 < codeTokens.length) {
                                                let tFirst = this.cleanIdentifier(codeTokens[n + 1].value);
                                                let tSch = '';
                                                let tTbl = tFirst;
                                                if (n + 3 < codeTokens.length && codeTokens[n + 2].value === '.') {
                                                    tSch = tFirst;
                                                    tTbl = this.cleanIdentifier(codeTokens[n + 3].value);
                                                }
                                                pgTrgTable = { schema: tSch, table: tTbl };
                                                break;
                                            }
                                        }
                                        if (pgTrgTable) break;
                                    }
                                }

                                symbolTable.addSymbol(new SqlSymbol({
                                    name: 'NEW',
                                    type: 'pseudo_table',
                                    targetObject: pgTrgTable ? pgTrgTable.table : '',
                                    schema: pgTrgTable ? pgTrgTable.schema : '',
                                    displayType: 'Pseudo Record'
                                }));
                                symbolTable.addSymbol(new SqlSymbol({
                                    name: 'OLD',
                                    type: 'pseudo_table',
                                    targetObject: pgTrgTable ? pgTrgTable.table : '',
                                    schema: pgTrgTable ? pgTrgTable.schema : '',
                                    displayType: 'Pseudo Record'
                                }));

                                const pgTriggerVars = [
                                    { name: 'TG_OP', dt: 'text' },
                                    { name: 'TG_NAME', dt: 'name' },
                                    { name: 'TG_TABLE_NAME', dt: 'name' },
                                    { name: 'TG_TABLE_SCHEMA', dt: 'name' },
                                    { name: 'TG_WHEN', dt: 'text' },
                                    { name: 'TG_LEVEL', dt: 'text' }
                                ];
                                for (const pv of pgTriggerVars) {
                                    symbolTable.addSymbol(new SqlSymbol({
                                        name: pv.name,
                                        type: 'scalar_variable',
                                        dataType: pv.dt,
                                        displayType: 'Trigger Variable'
                                    }));
                                }
                            }
                        }

                        // skip routine name: [schema.]name to '(' or '@'
                        while (k < codeTokens.length && codeTokens[k].value !== '(' && !codeTokens[k].value.startsWith('@') && codeTokens[k].value !== ';' && (codeTokens[k].upper || codeTokens[k].value).toUpperCase() !== 'AS') {
                            k++;
                        }
                        if (k < codeTokens.length) {
                            if (codeTokens[k].value === '(') {
                                // Parameters in parentheses (SQL Server or PostgreSQL)
                                const openP = k;
                                let depth = 1;
                                let closeP = -1;
                                for (let m = openP + 1; m < codeTokens.length; m++) {
                                    if (codeTokens[m].value === '(') depth++;
                                    else if (codeTokens[m].value === ')') {
                                        depth--;
                                        if (depth === 0) { closeP = m; break; }
                                    }
                                }
                                if (closeP !== -1) {
                                    this.parseRoutineParams(codeTokens, openP, closeP, symbolTable);
                                    i = closeP;
                                }
                            } else if (codeTokens[k].value && codeTokens[k].value.startsWith('@')) {
                                // SQL Server procedure parameters without parentheses: @p1 INT, @p2 VARCHAR...
                                while (k < codeTokens.length && codeTokens[k].value && codeTokens[k].value.startsWith('@')) {
                                    const pName = codeTokens[k].value;
                                    k++;
                                    let dtParts = [];
                                    while (k < codeTokens.length && codeTokens[k].value !== ',' && codeTokens[k].value !== '=') {
                                        const tkUp = (codeTokens[k].upper || codeTokens[k].value).toUpperCase();
                                        if (tkUp === 'AS' || tkUp === 'BEGIN' || tkUp === 'WITH') break;
                                        dtParts.push(codeTokens[k].value);
                                        k++;
                                    }
                                    symbolTable.addSymbol(new SqlSymbol({
                                        name: pName,
                                        type: 'scalar_variable',
                                        dataType: dtParts.join('').trim(),
                                        displayType: 'Parameter'
                                    }));
                                    if (k < codeTokens.length && codeTokens[k].value === '=') {
                                        while (k < codeTokens.length && codeTokens[k].value !== ',') {
                                            const tkUp = (codeTokens[k].upper || codeTokens[k].value).toUpperCase();
                                            if (tkUp === 'AS' || tkUp === 'BEGIN') break;
                                            k++;
                                        }
                                    }
                                    if (k < codeTokens.length && codeTokens[k].value === ',') {
                                        k++;
                                    } else {
                                        break;
                                    }
                                }
                                if (k > i) {
                                    i = k - 1;
                                }
                            }
                        }
                    }
                }

                // 4. DECLARE @var TABLE (...) or DECLARE @var INT, ... or Postgres DECLARE v_name TYPE;
                if (upper === 'DECLARE') {
                    let j = i + 1;
                    const STATEMENT_BREAK_KEYWORDS = new Set([
                        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP',
                        'EXEC', 'EXECUTE', 'WITH', 'IF', 'WHILE', 'RETURN', 'GO', 'BEGIN',
                        'END', 'SET', 'MERGE', 'TRUNCATE', 'USE', 'PRINT', 'THROW', 'RAISERROR'
                    ]);

                    let isSqlServerDeclare = false;

                    while (j < codeTokens.length) {
                        const tok = codeTokens[j];
                        const tokUpper = (tok.upper || tok.value).toUpperCase();

                        if (tok.value === ';' || tokUpper === 'GO') {
                            if (isSqlServerDeclare) {
                                j++;
                                break;
                            }
                            // In Postgres, skip ';' between variable declarations
                            j++;
                            continue;
                        }

                        if (tokUpper === 'BEGIN' || STATEMENT_BREAK_KEYWORDS.has(tokUpper)) {
                            break;
                        }

                        if (tok.value.startsWith('@')) {
                            isSqlServerDeclare = true;
                            // SQL Server @var: DECLARE @var INT, @tbl TABLE(...)
                            const varName = tok.value;
                            j++;
                            if (j >= codeTokens.length) break;

                            let varUpper = (codeTokens[j].upper || codeTokens[j].value).toUpperCase();
                            if (varUpper === 'AS' && j + 1 < codeTokens.length && (codeTokens[j + 1].upper || codeTokens[j + 1].value).toUpperCase() === 'TABLE') {
                                j++;
                                varUpper = 'TABLE';
                            }
                            if (varUpper === 'TABLE') {
                                j++; // skip 'TABLE'
                                if (j < codeTokens.length && codeTokens[j].value === '(') {
                                    const openP = j;
                                    let depth = 1;
                                    j++;
                                    while (j < codeTokens.length && depth > 0) {
                                        if (codeTokens[j].value === '(') depth++;
                                        else if (codeTokens[j].value === ')') depth--;
                                        j++;
                                    }
                                    const closeP = j - 1;
                                    const cols = this.parseColumnDefinitions(codeTokens, openP, closeP);
                                    symbolTable.addSymbol(new SqlSymbol({
                                        name: varName,
                                        type: 'table_variable',
                                        columns: cols,
                                        displayType: 'Table Variable'
                                    }));
                                }
                            } else {
                                let dtParts = [];
                                let dtDepth = 0;
                                while (j < codeTokens.length && (dtDepth > 0 || (codeTokens[j].value !== ',' && codeTokens[j].value !== ';' && codeTokens[j].value !== '='))) {
                                    const tkUp = (codeTokens[j].upper || codeTokens[j].value).toUpperCase();
                                    if (dtDepth === 0 && (STATEMENT_BREAK_KEYWORDS.has(tkUp) || tkUp === 'DECLARE')) break;
                                    if (codeTokens[j].value === '(') dtDepth++;
                                    else if (codeTokens[j].value === ')') dtDepth--;
                                    dtParts.push(codeTokens[j].value);
                                    j++;
                                }
                                const dt = dtParts.join('').trim();
                                symbolTable.addSymbol(new SqlSymbol({
                                    name: varName,
                                    type: 'scalar_variable',
                                    dataType: dt,
                                    displayType: 'Variable'
                                }));

                                if (j < codeTokens.length && codeTokens[j].value === '=') {
                                    while (j < codeTokens.length && codeTokens[j].value !== ',' && codeTokens[j].value !== ';') {
                                        const tkUp = (codeTokens[j].upper || codeTokens[j].value).toUpperCase();
                                        if (STATEMENT_BREAK_KEYWORDS.has(tkUp)) break;
                                        j++;
                                    }
                                }
                            }
                        } else if (!isSqlServerDeclare && !['BEGIN', 'DECLARE', 'CONSTANT', 'CURSOR', 'TABLE'].includes(tokUpper) && ![';', ',', '(', ')'].includes(tok.value)) {
                            // PostgreSQL PL/pgSQL variable: var_name [CONSTANT] type [:= expr]; or cur CURSOR FOR ...
                            const varName = this.cleanIdentifier(tok.value);
                            j++;
                            let isConstant = false;
                            if (j < codeTokens.length && (codeTokens[j].upper || codeTokens[j].value).toUpperCase() === 'CONSTANT') {
                                isConstant = true;
                                j++;
                            }
                            let isCursor = false;
                            if (j < codeTokens.length && (codeTokens[j].upper || codeTokens[j].value).toUpperCase() === 'CURSOR') {
                                isCursor = true;
                            }
                            let dtParts = [];
                            let dtDepth = 0;
                            while (j < codeTokens.length && (dtDepth > 0 || (codeTokens[j].value !== ';' && codeTokens[j].value !== ':=' && codeTokens[j].value !== '=' && (codeTokens[j].upper || codeTokens[j].value).toUpperCase() !== 'DEFAULT'))) {
                                const tkUp = (codeTokens[j].upper || codeTokens[j].value).toUpperCase();
                                if (dtDepth === 0 && (STATEMENT_BREAK_KEYWORDS.has(tkUp) || tkUp === 'DECLARE')) break;
                                if (codeTokens[j].value === '(') dtDepth++;
                                else if (codeTokens[j].value === ')') dtDepth--;
                                dtParts.push(codeTokens[j].value);
                                j++;
                            }
                            if (varName && (dtParts.length > 0 || isCursor)) {
                                symbolTable.addSymbol(new SqlSymbol({
                                    name: varName,
                                    type: 'scalar_variable',
                                    dataType: dtParts.join('').trim() || (isCursor ? 'CURSOR' : ''),
                                    displayType: isCursor ? 'Cursor' : (isConstant ? 'Constant' : 'Variable')
                                }));
                            }
                            while (j < codeTokens.length && codeTokens[j].value !== ';') {
                                const tkUp = (codeTokens[j].upper || codeTokens[j].value).toUpperCase();
                                if (STATEMENT_BREAK_KEYWORDS.has(tkUp)) break;
                                j++;
                            }
                        } else {
                            break;
                        }

                        if (j < codeTokens.length && codeTokens[j].value === ',') {
                            j++;
                        } else if (j < codeTokens.length && codeTokens[j].value === ';') {
                            if (isSqlServerDeclare) {
                                j++;
                                break;
                            }
                            j++;
                        } else {
                            break;
                        }
                    }
                    if (j > i) {
                        i = j - 1;
                    }
                }
            }
        }

        extractDerivedTables(codeTokens, symbolTable, subquerySpans) {
            if (!codeTokens || !symbolTable || !subquerySpans) return;

            subquerySpans.forEach(span => {
                const startIdx = span.startIndex;
                if (startIdx > 0) {
                    const prevTok = codeTokens[startIdx - 1];
                    const prevUpper = (prevTok.upper || prevTok.value).toUpperCase();
                    if (prevUpper === 'FROM' || prevUpper === 'JOIN' || prevUpper === 'APPLY' || prevUpper === 'LATERAL' || prevUpper === 'USING') {
                        const endIdx = span.endIndex;
                        let aliasName = "";
                        let nextIdx = endIdx + 1;

                        if (nextIdx < codeTokens.length) {
                            const nextUpper = (codeTokens[nextIdx].upper || codeTokens[nextIdx].value).toUpperCase();
                            if (nextUpper === 'AS' && nextIdx + 1 < codeTokens.length) {
                                aliasName = this.cleanIdentifier(codeTokens[nextIdx + 1].value);
                                nextIdx += 2;
                            } else if (!this.nonAliases.has(nextUpper) && codeTokens[nextIdx].type === 'IDENTIFIER') {
                                aliasName = this.cleanIdentifier(codeTokens[nextIdx].value);
                                nextIdx += 1;
                            }
                        }

                        if (aliasName) {
                            let cols = [];
                            // Parse explicit column aliases: alias(c1, c2, ...)
                            if (nextIdx < codeTokens.length && codeTokens[nextIdx].value === '(') {
                                const openP = nextIdx;
                                let depth = 1;
                                let closeP = -1;
                                for (let p = nextIdx + 1; p < codeTokens.length; p++) {
                                    if (codeTokens[p].value === '(') depth++;
                                    else if (codeTokens[p].value === ')') {
                                        depth--;
                                        if (depth === 0) { closeP = p; break; }
                                    }
                                }
                                if (closeP > openP) {
                                    for (let p = openP + 1; p < closeP; p++) {
                                        const cTok = codeTokens[p];
                                        const cVal = (cTok.upper || cTok.value).toUpperCase();
                                        if ((cTok.type === 'IDENTIFIER' || !this.nonAliases.has(cVal)) && cTok.value !== ',') {
                                            const cName = this.cleanIdentifier(cTok.value);
                                            if (cName && !cols.some(x => x.name.toLowerCase() === cName.toLowerCase())) {
                                                cols.push({ name: cName, type: 'column', displayType: 'Column' });
                                            }
                                        }
                                    }
                                }
                            }
                            if (cols.length === 0) {
                                cols = this.parseSelectProjection(codeTokens, startIdx + 1, endIdx);
                            }
                            const sourceTables = this.extractSubquerySourceTables(codeTokens, startIdx + 1, endIdx);
                            const primarySourceTable = sourceTables.length > 0 ? sourceTables[0] : null;
                            const hasStar = Boolean(cols.hasStar);

                            // If subquery has SELECT * or no explicit projection, inherit columns from local scope tables (#temp, @tbl, cte)
                            if (hasStar || cols.length === 0) {
                                for (const src of sourceTables) {
                                    const resolved = symbolTable.resolve(src.table);
                                    if (resolved && resolved.columns && resolved.columns.length > 0) {
                                        resolved.columns.forEach(c => {
                                            const cName = c.name || c;
                                            if (!cols.some(x => x.name.toLowerCase() === cName.toLowerCase())) {
                                                cols.push({
                                                    name: cName,
                                                    type: 'column',
                                                    displayType: 'Column',
                                                    dataType: c.dataType || c.data_type || ''
                                                });
                                            }
                                        });
                                    }
                                }
                            }

                            const isApply = (prevUpper === 'APPLY');
                            const isLateral = (prevUpper === 'LATERAL');
                            const sym = new SqlSymbol({
                                name: aliasName,
                                alias: aliasName,
                                type: isApply ? 'apply_subquery' : (isLateral ? 'lateral_subquery' : 'subquery'), // type: 'subquery'
                                displayType: isApply ? 'Apply Subquery' : (isLateral ? 'Lateral Subquery' : 'Subquery'),
                                columns: cols,
                                targetObject: primarySourceTable ? primarySourceTable.table : aliasName,
                                schema: primarySourceTable ? primarySourceTable.schema : '',
                                hasStar: hasStar,
                                underlyingTables: sourceTables
                            });
                            symbolTable.addSymbol(sym);
                        }
                    }
                }
            });
        }

        extractSymbolsFromTokens(codeTokens, symbolTable) {
            if (!codeTokens || !symbolTable) return;

            for (let i = 0; i < codeTokens.length; i++) {
                const upper = (codeTokens[i].upper || codeTokens[i].value).toUpperCase();
                if (upper === 'FROM' || upper === 'JOIN' || upper === 'APPLY' || upper === 'LATERAL' || upper === 'USING' || upper === 'MERGE') {
                    if (i + 1 >= codeTokens.length) continue;

                    let j = i + 1;
                    if (upper === 'MERGE') {
                        // Skip TOP (...) or TOP n [PERCENT]
                        if (j < codeTokens.length && (codeTokens[j].upper || codeTokens[j].value).toUpperCase() === 'TOP') {
                            j++;
                            if (j < codeTokens.length && codeTokens[j].value === '(') {
                                let depth = 1;
                                j++;
                                while (j < codeTokens.length && depth > 0) {
                                    if (codeTokens[j].value === '(') depth++;
                                    else if (codeTokens[j].value === ')') depth--;
                                    j++;
                                }
                            } else if (j < codeTokens.length && codeTokens[j].type === 'NUMBER') {
                                j++;
                            }
                            if (j < codeTokens.length && (codeTokens[j].upper || codeTokens[j].value).toUpperCase() === 'PERCENT') {
                                j++;
                            }
                        }
                        if (j < codeTokens.length && (codeTokens[j].upper || codeTokens[j].value).toUpperCase() === 'INTO') {
                            j++;
                        }
                    }
                    if (j < codeTokens.length && (codeTokens[j].upper || codeTokens[j].value).toUpperCase() === 'ONLY') {
                        j++;
                    }

                    let tableParts = [];

                    // Collect table reference tokens: [server.][db.][schema.]table
                    // Or with empty schema: [server.][db.]..table
                    while (j < codeTokens.length) {
                        const tok = codeTokens[j];
                        const tokVal = (tok.upper || tok.value).toUpperCase();
                        if (this.nonAliases.has(tokVal) || tok.value === '(' || tok.value === ')' || tok.value === ';' || tok.value === ',') {
                            break;
                        }
                        if (tok.type === 'IDENTIFIER' || tok.type === 'PARAMETER' || tok.type === 'KEYWORD') {
                            tableParts.push(this.cleanIdentifier(tok.value));
                            j++;
                            if (j < codeTokens.length && codeTokens[j].value === '.') {
                                j++; // skip dot
                                // Check if followed by another dot: e.g. server.database..table
                                if (j < codeTokens.length && codeTokens[j].value === '.') {
                                    tableParts.push(""); // empty schema slot
                                    j++; // skip second dot
                                }
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    }

                    if (tableParts.length === 0) continue;

                    let serverName = "";
                    let databaseName = "";
                    let schemaName = "";
                    let tableName = "";

                    if (tableParts.length === 1) {
                        tableName = tableParts[0];
                    } else if (tableParts.length === 2) {
                        schemaName = tableParts[0];
                        tableName = tableParts[1];
                    } else if (tableParts.length === 3) {
                        if (tableParts[1] === "") {
                            // e.g. database..table or server..table
                            databaseName = tableParts[0];
                            schemaName = "dbo";
                            tableName = tableParts[2];
                        } else {
                            databaseName = tableParts[0];
                            schemaName = tableParts[1];
                            tableName = tableParts[2];
                        }
                    } else if (tableParts.length >= 4) {
                        // 4-part identifier: server.database.schema.table
                        serverName = tableParts[tableParts.length - 4];
                        databaseName = tableParts[tableParts.length - 3];
                        schemaName = tableParts[tableParts.length - 2] || "dbo";
                        tableName = tableParts[tableParts.length - 1];
                    }

                    // Check if followed by function call arguments: func(...)
                    let isFunctionCall = false;
                    if (j < codeTokens.length && codeTokens[j].value === '(') {
                        isFunctionCall = true;
                        let depth = 1;
                        j++;
                        while (j < codeTokens.length && depth > 0) {
                            if (codeTokens[j].value === '(') depth++;
                            else if (codeTokens[j].value === ')') depth--;
                            j++;
                        }
                    }

                    // Optional alias
                    let aliasName = "";
                    if (j < codeTokens.length) {
                        const nextWord = (codeTokens[j].upper || codeTokens[j].value).toUpperCase();
                        if (nextWord === 'AS') {
                            j++;
                            if (j < codeTokens.length && codeTokens[j].type === 'IDENTIFIER') {
                                aliasName = this.cleanIdentifier(codeTokens[j].value);
                                j++;
                            }
                        } else if (!this.nonAliases.has(nextWord) && codeTokens[j].value !== ')' && codeTokens[j].value !== '(' && codeTokens[j].value !== ';' && codeTokens[j].value !== ',') {
                            if (codeTokens[j].type === 'IDENTIFIER') {
                                aliasName = this.cleanIdentifier(codeTokens[j].value);
                                j++;
                            }
                        }
                    }

                    // Check for explicit column aliases: alias(c1, c2, ...)
                    let explicitCols = [];
                    if (j < codeTokens.length && codeTokens[j].value === '(') {
                        const colOpen = j;
                        let colDepth = 1;
                        let colClose = -1;
                        for (let p = colOpen + 1; p < codeTokens.length; p++) {
                            if (codeTokens[p].value === '(') colDepth++;
                            else if (codeTokens[p].value === ')') {
                                colDepth--;
                                if (colDepth === 0) { colClose = p; break; }
                            }
                        }
                        if (colClose > colOpen) {
                            for (let p = colOpen + 1; p < colClose; p++) {
                                const cTok = codeTokens[p];
                                const cVal = (cTok.upper || cTok.value).toUpperCase();
                                if ((cTok.type === 'IDENTIFIER' || !this.nonAliases.has(cVal)) && cTok.value !== ',') {
                                    const cName = this.cleanIdentifier(cTok.value);
                                    if (cName && !explicitCols.some(x => x.name.toLowerCase() === cName.toLowerCase())) {
                                        explicitCols.push({ name: cName, type: 'column', displayType: 'Column' });
                                    }
                                }
                            }
                        }
                    }

                    let symType = isFunctionCall ? 'table_function' : 'table';
                    let sourceType = isFunctionCall ? 'FUNCTION' : 'TABLE';
                    if (serverName) {
                        symType = 'remote_table';
                        sourceType = 'REMOTE_TABLE';
                    } else if (tableName.startsWith('#')) {
                        symType = 'temp_table';
                    } else if (tableName.startsWith('@')) {
                        symType = 'table_variable';
                    }

                    // Check if table references an existing CTE or temp table in scope
                    const existingSym = symbolTable.resolve(tableName);
                    let initialCols = [];
                    let targetObj = tableName;
                    let symUnderlying = [];
                    let symHasStar = false;
                    if (existingSym) {
                        if (existingSym.columns && existingSym.columns.length > 0) {
                            initialCols = [...existingSym.columns];
                        }
                        symType = existingSym.type;
                        sourceType = existingSym.sourceType || sourceType;
                        if (existingSym.targetObject) targetObj = existingSym.targetObject;
                        if (existingSym.underlyingTables) symUnderlying = existingSym.underlyingTables;
                        symHasStar = Boolean(existingSym.hasStar);
                    }

                    if (!tableName || /^#+$/.test(tableName) || /^@+$/.test(tableName)) {
                        continue;
                    }

                    const sym = new SqlSymbol({
                        name: tableName,
                        type: symType,
                        schema: schemaName,
                        database: databaseName,
                        server: serverName,
                        sourceType: sourceType,
                        alias: aliasName,
                        columns: initialCols,
                        targetObject: targetObj,
                        underlyingTables: symUnderlying,
                        hasStar: symHasStar
                    });

                    symbolTable.addSymbol(sym);
                }
            }

            // Scan for referenced columns on aliases/tables: e.g. c.Id, o.CustomerId
            for (let k = 0; k < codeTokens.length - 2; k++) {
                if ((codeTokens[k].type === 'IDENTIFIER' || codeTokens[k].type === 'KEYWORD') &&
                    codeTokens[k + 1].value === '.' &&
                    (codeTokens[k + 2].type === 'IDENTIFIER' || codeTokens[k + 2].type === 'KEYWORD')) {
                    if (codeTokens[k + 1].end !== codeTokens[k + 2].start) continue;

                    const nextUpper = (codeTokens[k + 2].upper || codeTokens[k + 2].value).toUpperCase();
                    if (this.nonAliases.has(nextUpper)) continue;

                    const qual = this.cleanIdentifier(codeTokens[k].value).toLowerCase();
                    const colName = this.cleanIdentifier(codeTokens[k + 2].value);
                    const sym = symbolTable.resolve(qual);
                    if (sym && colName && colName !== '.') {
                        if (!sym.columns) sym.columns = [];
                        if (!sym.columns.some(col => (col.name || col).toLowerCase() === colName.toLowerCase())) {
                            sym.columns.push({
                                name: colName,
                                type: 'column',
                                displayType: 'Column',
                                isReferenced: true
                            });
                        }
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. QUALIFIED IDENTIFIER RESOLVER (Section 14)
    // ─────────────────────────────────────────────────────────────────────────────
    class QualifiedIdentifierResolver {
        constructor(aliasResolver) {
            this.aliasResolver = aliasResolver;
        }

        resolve(fullQualifier, currentScope) {
            if (!fullQualifier) return null;
            // Split preserving empty components for '..'
            const rawParts = fullQualifier.split('.');
            const parts = rawParts.map(p => this.aliasResolver.cleanIdentifier(p));
            const nonEmptyParts = parts.filter(Boolean);
            if (nonEmptyParts.length === 0) return null;

            // Single qualifier: c. or Customer. or #temp. or @table.
            if (parts.length === 1 || nonEmptyParts.length === 1) {
                const target = nonEmptyParts[0];
                if (currentScope) {
                    const resolved = currentScope.resolve(target);
                    if (resolved) {
                        const isAlias = Boolean(resolved.alias && resolved.alias.toLowerCase() === target.toLowerCase());
                        const isMaskedByAlias = Boolean(resolved.alias && resolved.alias.toLowerCase() !== target.toLowerCase());
                        return {
                            object: resolved.targetObject || resolved.name,
                            targetObject: resolved.targetObject || resolved.name,
                            schema: resolved.schema,
                            database: resolved.database,
                            server: resolved.server || null,
                            sourceType: resolved.sourceType || (resolved.server ? 'REMOTE_TABLE' : (resolved.type === 'foreign_table' ? 'FOREIGN_TABLE' : 'TABLE')),
                            type: resolved.type,
                            isAlias: isAlias,
                            isMaskedByAlias: isMaskedByAlias,
                            preferredAlias: resolved.alias || '',
                            columns: resolved.columns || [],
                            hasStar: Boolean(resolved.hasStar),
                            underlyingTables: resolved.underlyingTables || []
                        };
                    }
                }
                return {
                    object: target,
                    schema: '',
                    database: null,
                    server: null,
                    sourceType: 'TABLE',
                    type: 'table',
                    isAlias: false,
                    columns: []
                };
            }

            // Two-part qualifier: schema.table. (e.g. dbo.Customer.)
            if (parts.length === 2) {
                return {
                    object: parts[1],
                    schema: parts[0],
                    database: null,
                    server: null,
                    sourceType: 'TABLE',
                    type: 'table',
                    isAlias: false,
                    columns: []
                };
            }

            // Four-part qualifier: server.database.schema.table.
            if (parts.length >= 4) {
                return {
                    object: parts[parts.length - 1],
                    schema: parts[parts.length - 2] || 'dbo',
                    database: parts[parts.length - 3],
                    server: parts[parts.length - 4],
                    sourceType: 'REMOTE_TABLE',
                    type: 'remote_table',
                    isAlias: false,
                    columns: []
                };
            }

            // Three-part qualifier: database.schema.table. (or server.database..table)
            if (parts.length === 3) {
                return {
                    object: parts[2],
                    schema: parts[1] || 'dbo',
                    database: parts[0],
                    server: null,
                    sourceType: 'TABLE',
                    type: 'table',
                    isAlias: false,
                    columns: []
                };
            }

            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. SCOPE RESOLVER (Hierarchical Scope Tree Builder)
    // ─────────────────────────────────────────────────────────────────────────────
    class ScopeResolver {
        constructor() {
            this.aliasResolver = new AliasResolver();
            this.qualifiedResolver = new QualifiedIdentifierResolver(this.aliasResolver);
        }

        buildScopeTree(tokens, fullLength = Infinity, cursorOffset = 0, statementRange = null) {
            const rootScope = new SymbolTable(null, { start: 0, end: fullLength });
            if (!tokens || tokens.length === 0) return rootScope;

            // Filter out non-code tokens (whitespace, comments) for symbol extraction
            const codeTokens = tokens.filter(t => t && t.type !== 'WHITESPACE' && t.type !== 'COMMENT_LINE' && t.type !== 'COMMENT_BLOCK');
            if (codeTokens.length === 0) return rootScope;

            // 1. Extract Temp Tables & Variable declarations (#temp, @tbl, @var, routine params) into batch scope
            this.aliasResolver.extractTempTablesAndVariables(codeTokens, rootScope);

            // 2. Identify statement tokens for statement isolation
            let stmtTokens = codeTokens;
            let stmtRange = { start: 0, end: fullLength };

            if (statementRange && typeof statementRange.start === 'number' && typeof statementRange.end === 'number' && (statementRange.start > 0 || statementRange.end < fullLength)) {
                stmtTokens = codeTokens.filter(t => t.end >= statementRange.start && t.start <= statementRange.end);
                stmtRange = { start: statementRange.start, end: statementRange.end };
            }

            // Target scope for current statement (isolated child of batch rootScope)
            const targetScope = (stmtTokens !== codeTokens && stmtTokens.length > 0)
                ? new SymbolTable(rootScope, stmtRange)
                : rootScope;

            // 3. Extract CTE definitions (WITH cte AS (SELECT ...))
            this.aliasResolver.extractCtes(stmtTokens, targetScope);
            if (targetScope !== rootScope) {
                this.aliasResolver.extractCtes(codeTokens, rootScope);
            }

            // 4. Find subquery parenthesis spans within stmtTokens: (SELECT ...
            const parenStack = [];
            const subquerySpans = [];

            for (let i = 0; i < stmtTokens.length; i++) {
                const t = stmtTokens[i];
                if (t.value === '(') {
                    let isSubquery = false;
                    for (let k = i + 1; k < stmtTokens.length; k++) {
                        if (tokens[k] && (tokens[k].type === 'WHITESPACE' || tokens[k].type === 'COMMENT_LINE' || tokens[k].type === 'COMMENT_BLOCK')) continue;
                        if (stmtTokens[k] && (stmtTokens[k].upper || stmtTokens[k].value).toUpperCase() === 'SELECT') {
                            isSubquery = true;
                        }
                        break;
                    }
                    parenStack.push({ start: t.start, index: i, isSubquery });
                } else if (t.value === ')') {
                    if (parenStack.length > 0) {
                        const open = parenStack.pop();
                        if (open.isSubquery) {
                            subquerySpans.push({
                                start: open.start,
                                end: t.end,
                                startIndex: open.index,
                                endIndex: i
                            });
                        }
                    }
                }
            }

            // Sort subquery spans by start ascending
            subquerySpans.sort((a, b) => a.start - b.start);

            // 5. Extract derived tables within stmtTokens
            this.aliasResolver.extractDerivedTables(stmtTokens, targetScope, subquerySpans);

            // 6. Populate target scope with non-subquery tokens from stmtTokens ONLY
            const rootTokens = [];
            for (let i = 0; i < stmtTokens.length; i++) {
                const t = stmtTokens[i];
                const insideSubquery = subquerySpans.some(span => t.start > span.start && t.end < span.end);
                if (!insideSubquery) {
                    rootTokens.push(t);
                }
            }
            this.aliasResolver.extractSymbolsFromTokens(rootTokens, targetScope);

            // 7. Build child scopes for each subquery within targetScope
            subquerySpans.forEach(span => {
                const subTokens = stmtTokens.slice(span.startIndex, span.endIndex + 1);
                const subScope = new SymbolTable(targetScope, { start: span.start, end: span.end });
                this.aliasResolver.extractSymbolsFromTokens(subTokens, subScope);
            });

            return rootScope;
        }

        getScopeAt(rootScope, cursorOffset) {
            if (!rootScope) return null;

            function findDeepestScope(scope, offset) {
                if (!scope || !scope.childScopes || scope.childScopes.length === 0) return scope;
                for (const child of scope.childScopes) {
                    if (offset >= child.range.start && offset <= child.range.end) {
                        return findDeepestScope(child, offset);
                    }
                }
                return scope;
            }

            return findDeepestScope(rootScope, cursorOffset);
        }

        resolveQualifier(fullQualifier, activeScope) {
            return this.qualifiedResolver.resolve(fullQualifier, activeScope);
        }
    }

    const defaultScopeResolver = new ScopeResolver();

    // Export to window
    window.SqlSymbol = SqlSymbol;
    window.SymbolTable = SymbolTable;
    window.AliasResolver = AliasResolver;
    window.QualifiedIdentifierResolver = QualifiedIdentifierResolver;
    window.ScopeResolver = ScopeResolver;
    window.DefaultScopeResolver = defaultScopeResolver;

})(typeof window !== 'undefined' ? window : globalThis);
