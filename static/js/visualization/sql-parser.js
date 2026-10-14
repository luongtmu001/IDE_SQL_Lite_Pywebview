/**
 * SQL Visualization — Dialect-Aware SQL Parser
 * Compliant with Section 8 & Section 13 (Tests 1-6) of .SKILL/sql_visualization.md
 */

(function (window) {
    'use strict';

    const SqlVisualization = window.SqlVisualization || {};
    const { TableNode, JoinEdge, SelectItem, WhereCondition, QueryModel } = SqlVisualization;

    function cleanIdentifier(id) {
        if (!id) return '';
        id = id.trim();
        if ((id.startsWith('[') && id.endsWith(']')) ||
            (id.startsWith('"') && id.endsWith('"')) ||
            (id.startsWith('`') && id.endsWith('`'))) {
            return id.substring(1, id.length - 1).trim();
        }
        return id;
    }

    /**
     * Splits string by top-level delimiter ignoring parentheses, brackets, quotes.
     */
    function splitTopLevel(str, delimiter = ',', caseInsensitive = false) {
        const results = [];
        let current = '';
        let parenDepth = 0;
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let inBracket = false;

        const target = caseInsensitive ? delimiter.toUpperCase() : delimiter;
        const targetLen = delimiter.length;

        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            const nextCh = i + 1 < str.length ? str[i + 1] : '';

            // Handle string literals
            if (ch === "'" && !inDoubleQuote && !inBracket) {
                if (inSingleQuote && nextCh === "'") {
                    current += "''";
                    i++;
                    continue;
                }
                inSingleQuote = !inSingleQuote;
                current += ch;
                continue;
            }

            // Handle double-quoted identifiers
            if (ch === '"' && !inSingleQuote && !inBracket) {
                if (inDoubleQuote && nextCh === '"') {
                    current += '""';
                    i++;
                    continue;
                }
                inDoubleQuote = !inDoubleQuote;
                current += ch;
                continue;
            }

            // Handle bracketed identifiers
            if (ch === '[' && !inSingleQuote && !inDoubleQuote) {
                inBracket = true;
                current += ch;
                continue;
            }
            if (ch === ']' && inBracket) {
                inBracket = false;
                current += ch;
                continue;
            }

            if (!inSingleQuote && !inDoubleQuote && !inBracket) {
                if (ch === '(') parenDepth++;
                else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);

                if (parenDepth === 0) {
                    const slice = str.substr(i, targetLen);
                    const match = caseInsensitive ? (slice.toUpperCase() === target) : (slice === target);
                    if (match) {
                        // Ensure word boundary if delimiter is a word
                        if (/^[A-Za-z0-9_]+$/.test(delimiter)) {
                            const prevChar = i > 0 ? str[i - 1] : ' ';
                            const afterChar = i + targetLen < str.length ? str[i + targetLen] : ' ';
                            if (/\s/.test(prevChar) && /\s/.test(afterChar)) {
                                results.push(current.trim());
                                current = '';
                                i += targetLen - 1;
                                continue;
                            }
                        } else {
                            results.push(current.trim());
                            current = '';
                            i += targetLen - 1;
                            continue;
                        }
                    }
                }
            }

            current += ch;
        }

        if (current.trim().length > 0) {
            results.push(current.trim());
        }
        return results;
    }

    class SqlParser {
        constructor() {
            this.cleanIdentifier = cleanIdentifier;
        }

        /**
         * Extracts SELECT query from View DDL if present
         */
        extractSelectQuery(sql) {
            if (!sql || typeof sql !== 'string') {
                return { isView: false, viewName: '', schema: '', querySql: '', originalSql: '' };
            }

            const cleanSql = sql.trim();
            // Match CREATE [OR ALTER] [MATERIALIZED] VIEW [schema].[name] AS ...
            const viewRegex = /CREATE\s+(?:OR\s+(?:ALTER|REPLACE)\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:(?:\[([^\]]+)\]|"([^"]+)"|([A-Za-z0-9_]+))\.)?(?:\[([^\]]+)\]|"([^"]+)"|([A-Za-z0-9_]+))\s+AS\s+([\s\S]+)$/i;
            const m = cleanSql.match(viewRegex);
            if (m) {
                const schema = m[1] || m[2] || m[3] || 'dbo';
                const viewName = m[4] || m[5] || m[6] || '';
                const queryBody = m[7] ? m[7].trim() : '';
                return {
                    isView: true,
                    viewName,
                    schema,
                    querySql: queryBody,
                    originalSql: cleanSql
                };
            }

            return {
                isView: false,
                viewName: '',
                schema: '',
                querySql: cleanSql,
                originalSql: cleanSql
            };
        }

        /**
         * Detect dialect based on query constructs
         */
        detectDialect(sql, fallback = 'sqlserver') {
            if (!sql) return fallback;
            if (/\[[A-Za-z0-9_]+\]/i.test(sql) || /\bSELECT\s+TOP\b/i.test(sql)) {
                return 'sqlserver';
            }
            if (/"[A-Za-z0-9_]+"/i.test(sql) || /\bLIMIT\s+\d+/i.test(sql)) {
                return 'postgresql';
            }
            return fallback;
        }

        /**
         * Check for unsupported complex constructs
         * CTEs, UNIONs, and Derived Tables are now fully supported via QueryFlowAnalyzer (Phase 2-3).
         */
        isUnsupported(querySql) {
            const trimmed = querySql.trim();
            // Non-SELECT statements (DDL / DML other than VIEW / SELECT)
            if (/^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP|ALTER|TRUNCATE|EXEC|EXECUTE)\b/i.test(trimmed)) {
                return { unsupported: true, reason: 'Chỉ hỗ trợ trực quan hóa các truy vấn SELECT, CTE, UNION, Derived Table, và View DDL.' };
            }
            return { unsupported: false, reason: '' };
        }

        /**
         * Parses table reference string into { schema, tableName, alias }
         * Examples:
         * "dbo.B20Customer AS c"
         * "[dbo].[B20Customer] c"
         * ""public"."b20_customer""
         */
        parseTableSpec(spec, defaultSchema = 'dbo') {
            const raw = (spec || '').trim();
            if (!raw) return null;

            // Check for alias: table [AS] alias
            // Split by whitespace or AS
            let tablePart = raw;
            let aliasPart = '';

            const asMatch = raw.match(/^([\s\S]+?)\s+AS\s+([\s\S]+)$/i);
            if (asMatch) {
                tablePart = asMatch[1].trim();
                aliasPart = asMatch[2].trim();
            } else {
                // Check if two tokens without AS: e.g. "dbo.Customer c" or "[dbo].[Customer] [c]"
                const tokens = splitTopLevel(raw, ' ', false).filter(t => t.length > 0);
                if (tokens.length >= 2) {
                    tablePart = tokens[0].trim();
                    aliasPart = tokens[tokens.length - 1].trim();
                }
            }

            // Parse schema and table name from tablePart
            let schema = defaultSchema;
            let tableName = tablePart;

            if (tablePart.includes('.')) {
                const parts = tablePart.split('.');
                if (parts.length === 2) {
                    schema = cleanIdentifier(parts[0]);
                    tableName = cleanIdentifier(parts[1]);
                } else if (parts.length === 3) {
                    // db.schema.table
                    schema = cleanIdentifier(parts[1]);
                    tableName = cleanIdentifier(parts[2]);
                }
            } else {
                tableName = cleanIdentifier(tablePart);
            }

            const cleanAlias = aliasPart ? cleanIdentifier(aliasPart) : tableName;

            return {
                schema: schema || defaultSchema,
                tableName,
                alias: cleanAlias
            };
        }

        /**
         * Main parse entry point
         */
        parse(sql, options = {}) {
            const dialect = options.dialect || this.detectDialect(sql);
            const defaultSchema = options.defaultSchema || (dialect === 'postgresql' ? 'public' : 'dbo');
            const existingModel = options.existingModel || null;

            const extracted = this.extractSelectQuery(sql);
            let querySql = extracted.querySql.trim();

            // Strip trailing semicolon
            if (querySql.endsWith(';')) {
                querySql = querySql.substring(0, querySql.length - 1).trim();
            }

            const model = new QueryModel({
                dialect,
                originalSql: sql
            });

            // Check if unsupported
            const check = this.isUnsupported(querySql);
            if (check.unsupported) {
                model.parseStatus = 'unsupported';
                model.syncStatus = 'unsupported_sql';
                model.unsupportedFragments.push(check.reason);
                return model;
            }

            // 1. Build QueryFlowGraph via QueryFlowAnalyzer (Phases 1-3)
            try {
                if (SqlVisualization.DefaultQueryFlowAnalyzer) {
                    const flowGraph = SqlVisualization.DefaultQueryFlowAnalyzer.analyze(querySql, { dialect, defaultSchema });
                    model.setFlowGraph(flowGraph);
                }
            } catch (flowErr) {
                console.warn('[SqlParser] QueryFlowAnalyzer error:', flowErr);
            }

            // 2. Check if complex multi-branch/multi-level query (CTE, UNION, Derived Table)
            const isComplex = /^\s*WITH\s+[A-Za-z0-9_\[\]"`\s,]+\s+AS\s*\(/i.test(querySql) ||
                              /\b(UNION\s+ALL|UNION|INTERSECT|EXCEPT)\b/i.test(querySql) ||
                              /\bFROM\s*\(\s*SELECT\b/i.test(querySql);

            if (isComplex) {
                // If it contains UNION, also extract tables from branches so Table Cards view is populated
                if (/\b(UNION\s+ALL|UNION|INTERSECT|EXCEPT)\b/i.test(querySql)) {
                    try {
                        const rawBranches = splitTopLevel(querySql, 'UNION', true);
                        rawBranches.forEach((bStr, bIdx) => {
                            let cleanBranch = bStr.trim();
                            if (bIdx > 0 && cleanBranch.toUpperCase().startsWith('ALL')) {
                                cleanBranch = cleanBranch.substring(3).trim();
                            }
                            this._parseSelectBody(cleanBranch, model, defaultSchema, existingModel);
                        });
                    } catch (uErr) {
                        console.warn('[SqlParser] Parse union branches tables warning:', uErr);
                    }
                }
                model.parseStatus = 'success';
                model.syncStatus = 'synced';
                return model;
            }

            // 3. For standard single-level SELECT/JOIN query, also parse into tables & joins (Preserving backward compatibility)
            try {
                this._parseSelectBody(querySql, model, defaultSchema, existingModel);
                model.parseStatus = 'success';
                model.syncStatus = 'synced';
            } catch (err) {
                console.error('[SqlParser] Parse error:', err);
                model.parseStatus = 'error';
                model.syncStatus = 'parse_error';
                model.unsupportedFragments.push(err.message || 'Không thể phân tích cú pháp SQL.');
            }

            return model;
        }

        /**
         * Asynchronous parse with backend AST support
         */
        async parseAsync(sql, options = {}) {
            const model = this.parse(sql, options);
            const extracted = this.extractSelectQuery(sql);
            const querySql = extracted.querySql.trim().replace(/;+$/, '');
            const dialect = options.dialect || this.detectDialect(sql);

            if (SqlVisualization.DefaultQueryFlowAnalyzer && typeof SqlVisualization.DefaultQueryFlowAnalyzer.analyzeAsync === 'function') {
                try {
                    const asyncGraph = await SqlVisualization.DefaultQueryFlowAnalyzer.analyzeAsync(querySql, {
                        dialect,
                        defaultSchema: options.defaultSchema
                    });
                    if (asyncGraph && asyncGraph.nodes && (asyncGraph.nodes instanceof Map ? asyncGraph.nodes.size > 0 : Object.keys(asyncGraph.nodes).length > 0)) {
                        model.setFlowGraph(asyncGraph);
                    }
                } catch (e) {
                    console.warn('[SqlParser] parseAsync error:', e);
                }
            }
            return model;
        }

        _parseSelectBody(querySql, model, defaultSchema, existingModel) {
            // Find keyword indices at top level
            const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT'];
            const clauseSpans = [];

            // Token-based clause scan
            const re = /\b(SELECT|FROM|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT)\b/gi;
            let m;
            let lastIdx = 0;
            let currentClause = null;

            while ((m = re.exec(querySql)) !== null) {
                // Ensure outside parentheses/quotes
                const prefix = querySql.substring(0, m.index);
                if (this._isInsideParenOrQuote(prefix)) continue;

                if (currentClause) {
                    currentClause.content = querySql.substring(currentClause.endIndex, m.index).trim();
                }

                currentClause = {
                    type: m[1].toUpperCase().replace(/\s+/g, ' '),
                    startIndex: m.index,
                    endIndex: m.index + m[0].length,
                    content: ''
                };
                clauseSpans.push(currentClause);
            }

            if (currentClause) {
                currentClause.content = querySql.substring(currentClause.endIndex).trim();
            }

            const getClause = (type) => {
                const found = clauseSpans.find(c => c.type === type);
                return found ? found.content : '';
            };

            const selectClause = getClause('SELECT');
            const fromClause = getClause('FROM');
            const whereClause = getClause('WHERE');
            const groupByClause = getClause('GROUP BY');
            const havingClause = getClause('HAVING');
            const orderByClause = getClause('ORDER BY');
            const limitClause = getClause('LIMIT');

            if (!fromClause && !selectClause) {
                throw new Error('Không tìm thấy mệnh đề SELECT hoặc FROM hợp lệ.');
            }

            // 1. Parse FROM & JOINs
            this._parseFromAndJoins(fromClause, model, defaultSchema, existingModel);

            // 2. Parse SELECT
            this._parseSelectItems(selectClause, model);

            // 3. Parse WHERE
            if (whereClause) {
                this._parseWhere(whereClause, model);
            }

            // 4. Parse GROUP BY & HAVING
            if (groupByClause) {
                model.groupByItems = splitTopLevel(groupByClause, ',').map(c => cleanIdentifier(c));
            }
            if (havingClause) {
                model.havingConditions = splitTopLevel(havingClause, 'AND', true);
            }

            // 5. Parse ORDER BY
            if (orderByClause) {
                this._parseOrderBy(orderByClause, model);
            }

            // 6. Parse LIMIT
            if (limitClause) {
                const num = parseInt(limitClause.trim(), 10);
                if (!isNaN(num)) model.topLimit = num;
            }
        }

        _isInsideParenOrQuote(str) {
            let paren = 0;
            let inS = false;
            let inD = false;
            let inB = false;
            for (let i = 0; i < str.length; i++) {
                const c = str[i];
                if (c === "'" && !inD && !inB) inS = !inS;
                else if (c === '"' && !inS && !inB) inD = !inD;
                else if (c === '[' && !inS && !inD) inB = true;
                else if (c === ']' && inB) inB = false;
                else if (!inS && !inD && !inB) {
                    if (c === '(') paren++;
                    else if (c === ')') paren = Math.max(0, paren - 1);
                }
            }
            return paren > 0 || inS || inD || inB;
        }

        _parseFromAndJoins(fromClause, model, defaultSchema, existingModel) {
            if (!fromClause) return;

            // Pattern to match join types:
            // INNER JOIN | LEFT [OUTER] JOIN | RIGHT [OUTER] JOIN | FULL [OUTER] JOIN | CROSS JOIN
            const joinRegex = /\b((?:INNER\s+|LEFT\s+(?:OUTER\s+)?|RIGHT\s+(?:OUTER\s+)?|FULL\s+(?:OUTER\s+)?|CROSS\s+)?JOIN)\b/gi;

            const chunks = [];
            let lastIdx = 0;
            let lastType = 'FROM';
            let m;

            while ((m = joinRegex.exec(fromClause)) !== null) {
                const prefix = fromClause.substring(0, m.index);
                if (this._isInsideParenOrQuote(prefix)) continue;

                const textBefore = fromClause.substring(lastIdx, m.index).trim();
                chunks.push({ type: lastType, text: textBefore });

                // Normalize join type
                let rawJoin = m[1].toUpperCase().replace(/\s+/g, ' ');
                if (rawJoin.includes('LEFT')) lastType = 'LEFT';
                else if (rawJoin.includes('RIGHT')) lastType = 'RIGHT';
                else if (rawJoin.includes('FULL')) lastType = 'FULL';
                else if (rawJoin.includes('CROSS')) lastType = 'CROSS';
                else lastType = 'INNER';

                lastIdx = m.index + m[0].length;
            }

            chunks.push({ type: lastType, text: fromClause.substring(lastIdx).trim() });

            // First chunk is FROM source table
            const fromChunk = chunks[0];
            if (fromChunk && fromChunk.text) {
                // If comma-separated cross joins in FROM: e.g. FROM tblA, tblB
                const fromTables = splitTopLevel(fromChunk.text, ',');
                fromTables.forEach((tSpec, idx) => {
                    const parsed = this.parseTableSpec(tSpec, defaultSchema);
                    if (parsed) {
                        this._addOrReuseTableNode(parsed, model, existingModel, idx);
                    }
                });
            }

            // Remaining chunks are JOINs with ON conditions
            for (let i = 1; i < chunks.length; i++) {
                const chunk = chunks[i];
                // Split by ON: "tableSpec ON condition1 AND condition2"
                let tablePart = chunk.text;
                let onPart = '';

                const onMatch = chunk.text.match(/^([\s\S]+?)\s+ON\s+([\s\S]+)$/i);
                if (onMatch) {
                    tablePart = onMatch[1].trim();
                    onPart = onMatch[2].trim();
                }

                const parsed = this.parseTableSpec(tablePart, defaultSchema);
                if (!parsed) continue;

                const targetNode = this._addOrReuseTableNode(parsed, model, existingModel, i);

                // Parse ON conditions
                if (onPart) {
                    this._parseOnConditions(onPart, chunk.type, targetNode, model);
                }
            }
        }

        _addOrReuseTableNode(parsed, model, existingModel, index = 0) {
            // Check if existing model had a node with same alias
            let existingNode = null;
            if (existingModel && existingModel.tables) {
                for (const t of existingModel.tables.values()) {
                    if (t.alias.toLowerCase() === parsed.alias.toLowerCase() &&
                        t.tableName.toLowerCase() === parsed.tableName.toLowerCase()) {
                        existingNode = t;
                        break;
                    }
                }
            }

            const xPos = existingNode ? existingNode.x : (40 + index * 260);
            const yPos = existingNode ? existingNode.y : (50 + (index % 2) * 30);

            const node = new TableNode({
                id: existingNode ? existingNode.id : ('tbl_' + Math.random().toString(36).substring(2, 9)),
                database: existingNode ? existingNode.database : '',
                schema: parsed.schema,
                tableName: parsed.tableName,
                alias: parsed.alias,
                columns: existingNode ? existingNode.columns : [],
                x: xPos,
                y: yPos,
                isExpanded: existingNode ? existingNode.isExpanded : false
            });

            model.tables.set(node.id, node);
            return node;
        }

        _parseOnConditions(onPart, joinType, targetNode, model) {
            // Split conditions by AND
            const condStrings = splitTopLevel(onPart, 'AND', true);
            const conditions = [];
            let sourceTableNode = null;
            const isLiteral = (val) => /^('.*'|".*"|\d+(\.\d+)?|NULL|TRUE|FALSE)$/i.test((val || '').trim());

            condStrings.forEach(condStr => {
                // Match leftCol = rightCol or leftCol <> rightCol
                const eqMatch = condStr.match(/^([\s\S]+?)\s*(=|!=|<>|<=|>=|<|>|LIKE)\s*([\s\S]+)$/i);
                if (eqMatch) {
                    const leftExpr = eqMatch[1].trim();
                    const op = eqMatch[2].trim();
                    const rightExpr = eqMatch[3].trim();

                    const leftIsLit = isLiteral(leftExpr);
                    const rightIsLit = isLiteral(rightExpr);

                    const leftParsed = this._parseColRef(leftExpr);
                    const rightParsed = this._parseColRef(rightExpr);

                    let leftNode = leftIsLit ? null : model.getTableByAlias(leftParsed.alias);
                    let rightNode = rightIsLit ? null : model.getTableByAlias(rightParsed.alias);

                    // If alias omitted, try matching by column name
                    if (!leftNode && !leftIsLit && typeof model.findTableWithColumn === 'function') {
                        leftNode = model.findTableWithColumn(leftParsed.col);
                    }
                    if (!rightNode && !rightIsLit && typeof model.findTableWithColumn === 'function') {
                        rightNode = model.findTableWithColumn(rightParsed.col);
                    }

                    // Check if condition links two distinct tables
                    let isInterTable = false;
                    if (leftNode && rightNode && leftNode.id !== rightNode.id) {
                        isInterTable = true;
                        if (leftNode.id === targetNode.id) {
                            sourceTableNode = rightNode;
                        } else if (rightNode.id === targetNode.id) {
                            sourceTableNode = leftNode;
                        } else if (!sourceTableNode) {
                            sourceTableNode = leftNode;
                        }
                    } else if (!sourceTableNode) {
                        // Only establish source if ONE side belongs to another table and NOT targetNode
                        if (leftNode && leftNode.id !== targetNode.id && rightIsLit) {
                            sourceTableNode = leftNode;
                        } else if (rightNode && rightNode.id !== targetNode.id && leftIsLit) {
                            sourceTableNode = rightNode;
                        }
                    }

                    // Strict safety check: Never let sourceTableNode be targetNode (avoids self-join loop)
                    if (sourceTableNode && sourceTableNode.id === targetNode.id) {
                        sourceTableNode = null;
                    }

                    conditions.push({
                        leftColumn: leftIsLit ? leftExpr : leftParsed.col,
                        operator: op,
                        rightColumn: rightIsLit ? rightExpr : rightParsed.col,
                        leftTableId: leftNode ? leftNode.id : '',
                        rightTableId: rightNode ? rightNode.id : '',
                        isInterTable: isInterTable
                    });
                }
            });

            // Prioritize inter-table conditions first so conditions[0] anchors the true inter-table join line
            conditions.sort((a, b) => (b.isInterTable ? 1 : 0) - (a.isInterTable ? 1 : 0));

            // If source table not found, pick first table in model before targetNode
            if (!sourceTableNode) {
                for (const t of model.tables.values()) {
                    if (t.id !== targetNode.id) {
                        sourceTableNode = t;
                        break;
                    }
                }
            }

            if (sourceTableNode) {
                const joinEdge = new JoinEdge({
                    sourceTableId: sourceTableNode.id,
                    targetTableId: targetNode.id,
                    joinType: joinType,
                    conditions: conditions
                });
                model.joins.push(joinEdge);
            }
        }

        _parseColRef(expr) {
            const clean = expr.trim();
            if (clean.includes('.')) {
                const parts = clean.split('.');
                return {
                    alias: cleanIdentifier(parts[0]),
                    col: cleanIdentifier(parts[1])
                };
            }
            return {
                alias: '',
                col: cleanIdentifier(clean)
            };
        }

        _parseSelectItems(selectClause, model) {
            let str = (selectClause || '').trim();
            if (!str) return;

            // Check for DISTINCT
            if (/^DISTINCT\b/i.test(str)) {
                model.distinct = true;
                str = str.replace(/^DISTINCT\s+/i, '').trim();
            }

            // Check for TOP n (SQL Server)
            const topMatch = str.match(/^TOP\s+(?:\()?(\d+)(?:\))?\s+/i);
            if (topMatch) {
                model.topLimit = parseInt(topMatch[1], 10);
                str = str.substring(topMatch[0].length).trim();
            }

            const rawItems = splitTopLevel(str, ',');
            rawItems.forEach(itemStr => {
                const item = this._parseSingleSelectItem(itemStr.trim(), model);
                if (item) {
                    model.selectItems.push(item);
                }
            });
        }

        _parseSingleSelectItem(str, model) {
            if (!str) return null;

            let expr = str;
            let alias = '';

            // Check: expr AS alias
            const asMatch = str.match(/^([\s\S]+?)\s+AS\s+([\s\S]+)$/i);
            if (asMatch) {
                expr = asMatch[1].trim();
                alias = cleanIdentifier(asMatch[2].trim());
            } else {
                // Check T-SQL alias style: alias = expr
                const eqMatch = str.match(/^([A-Za-z0-9_\[\]"]+)\s*=\s*([\s\S]+)$/);
                if (eqMatch) {
                    alias = cleanIdentifier(eqMatch[1].trim());
                    expr = eqMatch[2].trim();
                }
            }

            // Parse aggregate e.g. COUNT(c.Id), SUM(Total)
            let aggregate = '';
            const aggMatch = expr.match(/^(COUNT|SUM|AVG|MIN|MAX)\s*\(([\s\S]+)\)$/i);
            if (aggMatch) {
                aggregate = aggMatch[1].toUpperCase();
                expr = aggMatch[2].trim();
            }

            const colRef = this._parseColRef(expr);
            let targetNode = null;
            if (colRef.alias) {
                targetNode = model.getTableByAlias(colRef.alias);
            } else if (model.tables.size === 1) {
                targetNode = Array.from(model.tables.values())[0];
            }

            return new SelectItem({
                tableId: targetNode ? targetNode.id : null,
                tableAlias: targetNode ? targetNode.alias : colRef.alias,
                column: colRef.col,
                alias: alias,
                output: true,
                aggregate: aggregate,
                rawExpression: str
            });
        }

        _parseWhere(whereClause, model) {
            const conds = splitTopLevel(whereClause, 'AND', true);
            conds.forEach(cStr => {
                const m = cStr.match(/^([\s\S]+?)\s*(=|!=|<>|<=|>=|<|>|LIKE|IS\s+NOT\s+NULL|IS\s+NULL)\s*([\s\S]*)$/i);
                if (m) {
                    const left = m[1].trim();
                    const op = m[2].trim().toUpperCase();
                    const right = m[3] ? m[3].trim() : '';

                    const colRef = this._parseColRef(left);
                    const node = colRef.alias ? model.getTableByAlias(colRef.alias) : null;

                    model.whereConditions.push(new WhereCondition({
                        tableId: node ? node.id : null,
                        tableAlias: node ? node.alias : colRef.alias,
                        column: colRef.col,
                        operator: op,
                        value: right,
                        logic: 'AND',
                        rawSql: cStr.trim()
                    }));
                } else {
                    model.whereConditions.push(new WhereCondition({
                        rawSql: cStr.trim(),
                        logic: 'AND'
                    }));
                }
            });
        }

        _parseOrderBy(orderByClause, model) {
            const items = splitTopLevel(orderByClause, ',');
            items.forEach(it => {
                const parts = it.trim().split(/\s+/);
                const col = parts[0];
                const dir = (parts[1] || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
                model.orderByItems.push({
                    column: cleanIdentifier(col),
                    direction: dir
                });
            });
        }
    }

    const defaultParser = new SqlParser();
    SqlVisualization.SqlParser = SqlParser;
    SqlVisualization.DefaultSqlParser = defaultParser;
    window.SqlVisualization = SqlVisualization;

})(window);
