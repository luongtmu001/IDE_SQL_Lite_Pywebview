/**
 * candidate-generator.js - Multi-tier IntelliSense Candidate Generator
 */
(function(window) {
    'use strict';

    const FUNCTION_SIGNATURES = window.SqlFunctionSignatures || {};

    class CandidateGenerator {
        constructor(dataProvider, metadataCache) {
            this.dataProvider = dataProvider;
            this.metadataCache = metadataCache;
        }

        async _getServerDatabases(connId, dbType) {
            if (!connId) return [];
            if (this.metadataCache && typeof this.metadataCache.getDatabases === 'function') {
                const cached = this.metadataCache.getDatabases(connId);
                if (cached && Array.isArray(cached) && cached.length > 0) return cached;
            }
            let res = null;
            if (this.dataProvider && typeof this.dataProvider.getDatabases === 'function') {
                res = await this.dataProvider.getDatabases(connId, dbType, true);
            } else if (this.dataProvider && typeof this.dataProvider.fetchDatabases === 'function') {
                res = await this.dataProvider.fetchDatabases(connId, dbType, true);
            } else if (window.AppMetadataProvider && typeof window.AppMetadataProvider.getDatabases === 'function') {
                res = await window.AppMetadataProvider.getDatabases(connId, true);
            } else if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:' && !window.pywebview && typeof window.waitForPywebview !== 'function') {
                res = [];
            } else {
                try {
                    const fetchRes = await fetch(`/api/metadata/${connId}/databases?accessible_only=1`);
                    const data = await fetchRes.json();
                    res = data && data.success && Array.isArray(data.items) ? data.items : [];
                } catch (e) {
                    res = [];
                }
            }
            if (res && this.metadataCache && typeof this.metadataCache.setDatabases === 'function') {
                this.metadataCache.setDatabases(connId, res);
            }
            return res || [];
        }

        async _getDatabaseSchemas(connId, database, dbType) {
            if (!connId || !database) return [];
            if (this.metadataCache && typeof this.metadataCache.getSchemas === 'function') {
                const cached = this.metadataCache.getSchemas(connId, database);
                if (cached && Array.isArray(cached) && cached.length > 0) return cached;
            }
            let res = null;
            if (this.dataProvider && typeof this.dataProvider.getSchemas === 'function') {
                res = await this.dataProvider.getSchemas(connId, database, dbType);
            } else if (this.dataProvider && typeof this.dataProvider.fetchSchemas === 'function') {
                res = await this.dataProvider.fetchSchemas(connId, database, dbType);
            } else if (window.AppMetadataProvider && typeof window.AppMetadataProvider.getSchemas === 'function') {
                res = await window.AppMetadataProvider.getSchemas(connId, database);
            } else if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:' && !window.pywebview && typeof window.waitForPywebview !== 'function') {
                res = [];
            } else {
                try {
                    const fetchRes = await fetch(`/api/metadata/${connId}/schemas?database=${encodeURIComponent(database)}`);
                    const data = await fetchRes.json();
                    res = data && data.success && Array.isArray(data.items) ? data.items : [];
                } catch (e) {
                    res = [];
                }
            }
            if (res && this.metadataCache && typeof this.metadataCache.setSchemas === 'function') {
                this.metadataCache.setSchemas(connId, database, res);
            }
            return res || [];
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
            if (context.isAggregateArg || context.enclosingFunction === 'COUNT') return null;

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
                        const targetDb = tbl.database || tabCtx.database;
                        if (this.metadataCache && typeof this.metadataCache.getColumns === 'function') {
                            cols = this.metadataCache.getColumns(tabCtx.connectionId, targetDb, targetSchema, tblName);
                        }
                        if (!cols && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                            cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, targetDb, targetSchema, tblName);
                        } else if (!cols && this.dataProvider && typeof this.dataProvider.getColumns === 'function') {
                            cols = await this.dataProvider.getColumns(tabCtx.connectionId, targetDb, targetSchema, tblName);
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
                        const uDb = (tbl.underlyingTables && tbl.underlyingTables[0] && tbl.underlyingTables[0].database) || tbl.database || tabCtx.database;
                        const uSchema = tbl.schema || tabCtx.schema;
                        let cols = this.metadataCache && typeof this.metadataCache.getColumns === 'function' ? this.metadataCache.getColumns(tabCtx.connectionId, uDb, uSchema, uTblName) : null;
                        if (!cols && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                            cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, uDb, uSchema, uTblName);
                        } else if (!cols && this.dataProvider && typeof this.dataProvider.getColumns === 'function') {
                            cols = await this.dataProvider.getColumns(tabCtx.connectionId, uDb, uSchema, uTblName);
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
                const procDb = context.execContext.procedureDatabase || tabCtx.database;

                if (tabCtx.connectionId && this.dataProvider && typeof this.dataProvider.fetchParameters === 'function') {
                    const params = await this.dataProvider.fetchParameters(tabCtx.connectionId, procDb, procSchema, procName, tabCtx.dbType);
                    (params || []).forEach((p, idx) => {
                        const pName = p.name.startsWith('@') ? p.name : `@${p.name}`;
                        allCandidates.push({
                            name: pName,
                            label: `${pName} = `,
                            type: 'parameter',
                            kind: 'parameter',
                            paramIndex: idx,
                            level: 1.0 + (idx * 0.001),
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
            if (context && (
                context.position === 'after_source' ||
                context.position === 'table_hint' ||
                context.position === 'order_direction' ||
                context.position === 'is_predicate' ||
                context.position === 'on_conflict' ||
                context.position === 'alias_name' ||
                context.position === 'column_definition_type'
            )) {
                return;
            }

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
                ? context.activeScope.getSymbolsByType('temp_table').filter(t => t.isDeclared !== false && t.sourceType !== 'QUERY_REFERENCE')
                : [];
            const tempNameSet = new Set(scopeTemp.map(t => (t.name || t).toLowerCase()));
            const fallbackTemp = (!context.activeScope && context.localTempTables)
                ? (context.localTempTables || [])
                    .filter(t => !tempNameSet.has((t || '').toLowerCase()))
                    .filter(t => !context.currentWord || (t || '').toLowerCase() !== (context.currentWord || '').toLowerCase())
                : [];
            const tempTables = [...scopeTemp, ...fallbackTemp].filter(tbl => {
                const tblName = tbl.name || tbl;
                if (!tblName) return false;
                if (context.currentWord && tblName.toLowerCase() === context.currentWord.toLowerCase() && (!tbl.columns || tbl.columns.length === 0)) {
                    return false;
                }
                return true;
            });

            tempTables.forEach(tbl => {
                const tblName = tbl.name || tbl;
                const inherited = tbl.inheritedFrom || tbl.originRoutine;
                allCandidates.push({
                    name: tblName,
                    label: tblName,
                    type: 'temp_table',
                    kind: 'table',
                    level: inherited ? 1.32 : 1.3,
                    displayType: inherited ? `Temp Table (${inherited})` : 'Temp Table',
                    detail: inherited ? `Kế thừa từ ${inherited}()` : undefined,
                    documentation: inherited ? `Bảng tạm kế thừa từ routine ${inherited}() trong cùng session.` : undefined,
                    columns: tbl.columns || [],
                    insertText: this.formatInsertText(tblName, 'temp_table', context, tabCtx)
                });
            });

            // B2. Global temporary tables (##global_temp in SQL Server - shared across tabs in same connection)
            const globalTempTables = [];
            const isSqlServer = !tabCtx.dbType || tabCtx.dbType.toLowerCase() === 'sqlserver';
            if (isSqlServer && typeof window !== 'undefined' && window.AppTabs && typeof window.AppTabs.getAllTabs === 'function') {
                try {
                    const allTabs = window.AppTabs.getAllTabs();
                    const curTabId = tabCtx.tabId;
                    const connId = tabCtx.connectionId;
                    const seenGlobals = new Set();
                    tempTables.forEach(t => {
                        const n = (t.name || t || '').toLowerCase();
                        if (n.startsWith('##')) seenGlobals.add(n);
                    });

                    if (allTabs && typeof allTabs.forEach === 'function') {
                        allTabs.forEach((tabState, tId) => {
                            if (tId === curTabId) return;
                            if (connId && tabState.connectionId && String(tabState.connectionId) !== String(connId)) {
                                return;
                            }
                            let tabText = '';
                            if (tabState.monacoModel && !tabState.monacoModel.isDisposed()) {
                                tabText = tabState.monacoModel.getValue();
                            } else if (tabState.content) {
                                tabText = tabState.content;
                            }
                            if (tabText && tabText.includes('##')) {
                                const re = /\b(?:CREATE\s+TABLE|INTO)\s+(##[a-zA-Z0-9_#]+)/gi;
                                let m;
                                while ((m = re.exec(tabText)) !== null) {
                                    const gName = m[1];
                                    const gLower = gName.toLowerCase();
                                    if (!seenGlobals.has(gLower) && !/^#+$/.test(gName)) {
                                        seenGlobals.add(gLower);
                                        globalTempTables.push({
                                            name: gName,
                                            label: gName,
                                            type: 'temp_table',
                                            kind: 'table',
                                            level: 1.35,
                                            displayType: 'Global Temp Table',
                                            columns: [],
                                            insertText: this.formatInsertText(gName, 'temp_table', context, tabCtx)
                                        });
                                    }
                                }
                            }
                        });
                    }
                } catch (_) {}
            }
            globalTempTables.forEach(gt => allCandidates.push(gt));

            // C. Local table variables (@table - Section 47)
            const scopeTableVars = (context.activeScope && typeof context.activeScope.getSymbolsByType === 'function')
                ? context.activeScope.getSymbolsByType('table_variable').filter(v => v.isDeclared !== false && v.sourceType !== 'QUERY_REFERENCE')
                : [];
            const tvNameSet = new Set(scopeTableVars.map(v => (v.name || v).toLowerCase()));
            const fallbackTV = (!context.activeScope && context.localTableVars)
                ? (context.localTableVars || [])
                    .filter(v => !tvNameSet.has((v || '').toLowerCase()))
                    .map(v => ({ name: v, columns: [] }))
                : [];
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

                        const targetDb = tbl.database || tabCtx.database;
                        const targetSchema = tbl.schema || tabCtx.schema;
                        const isLocalTableType = ['subquery', 'apply_subquery', 'lateral_subquery', 'table_function', 'cte', 'temp_table', 'table_variable'].includes(tbl.type) ||
                            (tbl.table && (tbl.table.startsWith('#') || tbl.table.startsWith('@')));

                        // Only query database for physical tables, views, synonyms, foreign_table, remote_table
                        if (!isLocalTableType) {
                            let cols = null;
                            const isRemoteTable = Boolean(tbl.server || tbl.sourceType === 'REMOTE_TABLE');
                            if (isRemoteTable && tbl.server) {
                                const targetServer = tbl.server;
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
                                    cols = this.metadataCache.getColumns(tabCtx.connectionId, targetDb, targetSchema, tbl.table);
                                }
                                if (!cols && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                                    cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, targetDb, targetSchema, tbl.table);
                                } else if (!cols && this.dataProvider && typeof this.dataProvider.getColumns === 'function') {
                                    cols = await this.dataProvider.getColumns(tabCtx.connectionId, targetDb, targetSchema, tbl.table);
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

                                const isPk = Boolean(c.is_pk || c.isPrimary || c.is_primary);
                                allCandidates.push({
                                    name: c.name,
                                    label: c.name,
                                    type: isPk ? 'pk_column' : 'column',
                                    kind: 'column',
                                    level: isInsertCols ? 0.9 : 1.1,
                                    displayType: 'Column',
                                    dataType: c.data_type || c.type,
                                    isNullable: c.is_nullable !== undefined ? c.is_nullable : c.nullable,
                                    isPk: isPk,
                                    isIdentity: c.is_identity,
                                    isComputed: c.is_computed,
                                    database: targetDb,
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
                                    const uDb = (tbl.underlyingTables && tbl.underlyingTables[0] && tbl.underlyingTables[0].database) || tbl.database || tabCtx.database;
                                    const uSchema = tbl.schema || tabCtx.schema;
                                    if (this.metadataCache && typeof this.metadataCache.getColumns === 'function') {
                                        localCols = this.metadataCache.getColumns(tabCtx.connectionId, uDb, uSchema, uTblName);
                                    }
                                    if (!localCols && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                                        localCols = await this.dataProvider.fetchColumns(tabCtx.connectionId, uDb, uSchema, uTblName);
                                    } else if (!localCols && this.dataProvider && typeof this.dataProvider.getColumns === 'function') {
                                        localCols = await this.dataProvider.getColumns(tabCtx.connectionId, uDb, uSchema, uTblName);
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

                // Inside COUNT(...) function: suggest * operator and DISTINCT keyword
                if (context.enclosingFunction === 'COUNT') {
                    allCandidates.push({
                        name: '*',
                        label: '*',
                        type: 'operator',
                        kind: 'operator',
                        level: 0.9,
                        displayType: 'Operator',
                        insertText: '*'
                    });
                    allCandidates.push({
                        name: 'DISTINCT',
                        label: 'DISTINCT',
                        type: 'keyword',
                        kind: 'keyword',
                        level: 1.0,
                        displayType: 'Keyword',
                        insertText: 'DISTINCT '
                    });
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
                    // Local / Same-server database table columns
                    const effectiveDb = targetDatabase || tabCtx.database;
                    if (this.metadataCache && typeof this.metadataCache.getColumns === 'function') {
                        cols = this.metadataCache.getColumns(tabCtx.connectionId, effectiveDb, targetSchema, targetTable);
                    }
                    if (!cols && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                        cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, effectiveDb, targetSchema, targetTable);
                    } else if (!cols && this.dataProvider && typeof this.dataProvider.getColumns === 'function') {
                        cols = await this.dataProvider.getColumns(tabCtx.connectionId, effectiveDb, targetSchema, targetTable);
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
                            database: effectiveDb,
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

            // A3. Cross-Database & Multi-tier Linked Server Completion Hierarchy (Spec Section 13, 14, 45)
            const qParts = (context.qualifierParts || []).map(p => CompletionEngine.cleanIdentifier(p).trim());
            const isKnownAlias = Boolean(context.resolvedObject && context.resolvedObject.isAlias);
            if (tabCtx.connectionId && qParts.length > 0 && !isKnownAlias && !isLocalSymbol) {
                const isSqlServer = !tabCtx.dbType || ['sqlserver', 'mssql', 'tsql'].includes(String(tabCtx.dbType).toLowerCase());
                const serverDbs = isSqlServer ? await this._getServerDatabases(tabCtx.connectionId, tabCtx.dbType) : [];
                const firstPartLower = (qParts[0] || '').toLowerCase();
                const matchedDb = (serverDbs || []).find(d => ((typeof d === 'string' ? d : d.name) || '').toLowerCase() === firstPartLower);
                const localDbName = matchedDb ? (typeof matchedDb === 'string' ? matchedDb : matchedDb.name) : null;

                if (qParts.length >= 4) {
                    // 4-part: server.database.schema.table
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
                    // 3-part: could be local DB (database.schema.table) or linked server (server.database.schema)
                    if (localDbName) {
                        // Local database on same server: database.schema.table. -> Columns of table
                        const targetSchema = qParts[1] || 'dbo';
                        const targetTable = qParts[2];
                        if (targetTable) {
                            let cols = null;
                            if (this.metadataCache && typeof this.metadataCache.getColumns === 'function') {
                                cols = this.metadataCache.getColumns(tabCtx.connectionId, localDbName, targetSchema, targetTable);
                            }
                            if (!cols && this.dataProvider && typeof this.dataProvider.fetchColumns === 'function') {
                                cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, localDbName, targetSchema, targetTable, tabCtx.dbType);
                            } else if (!cols && this.dataProvider && typeof this.dataProvider.getColumns === 'function') {
                                cols = await this.dataProvider.getColumns(tabCtx.connectionId, localDbName, targetSchema, targetTable);
                            }
                            if (cols && this.metadataCache && typeof this.metadataCache.setColumns === 'function') {
                                this.metadataCache.setColumns(tabCtx.connectionId, localDbName, targetSchema, targetTable, cols);
                            }
                            (cols || []).forEach(c => {
                                const cName = c.name || c;
                                allCandidates.push({
                                    name: cName,
                                    label: cName,
                                    type: c.is_pk ? 'pk_column' : 'column',
                                    kind: 'column',
                                    level: 1.5,
                                    displayType: `Column (${localDbName})`,
                                    dataType: c.data_type || '',
                                    isNullable: c.is_nullable !== false,
                                    isPk: Boolean(c.is_pk),
                                    database: localDbName,
                                    schema: targetSchema,
                                    tableName: targetTable,
                                    insertText: this.formatInsertText(cName, 'column', context, tabCtx)
                                });
                            });
                        }
                    }

                    // Also check linked server
                    const rServer = qParts[0];
                    const rDb = qParts[1];
                    const rSchema = qParts[2] || 'dbo';
                    if (rServer && rDb) {
                        const lservers = await this._getLinkedServers(tabCtx.connectionId);
                        const isLinked = (lservers || []).some(ls => (ls.name || ls.LinkedServerName || '').toLowerCase() === rServer.toLowerCase());
                        if (isLinked) {
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
                    }
                } else if (qParts.length === 2) {
                    // 2-part: could be local DB (database.schema. or database..) or linked server (server.database.)
                    if (localDbName) {
                        // Local database: database.schema. -> Objects in database.schema
                        const targetSchema = qParts[1] || 'dbo';
                        let dbObjs = null;
                        try {
                            if (this.dataProvider && typeof this.dataProvider.fetchObjects === 'function') {
                                dbObjs = await this.dataProvider.fetchObjects(tabCtx.connectionId, localDbName, targetSchema, tabCtx.dbType);
                            }
                        } catch (err) {
                            metadataErrors.push(err);
                        }
                        const isStrictExec = Boolean(context.execContext && context.execContext.isExec && !context.execContext.procedureName);
                        const isExecContext = Boolean(isStrictExec || context.clause === 'EXEC' || context.clause === 'EXECUTE' || (context.execContext && context.execContext.isExec));
                        (dbObjs || []).forEach(obj => {
                            if (isExecContext) {
                                if (obj.type !== 'procedure') return;
                            } else if (context.clause === 'FROM' || context.clause === 'JOIN' || context.clause === 'INSERT INTO' || context.clause === 'UPDATE') {
                                if (!['table', 'view', 'function', 'synonym'].includes(obj.type)) return;
                            }
                            allCandidates.push({
                                name: obj.name,
                                label: obj.name,
                                type: obj.type,
                                kind: obj.type,
                                level: isExecContext ? 1.0 : 1.5,
                                displayType: `${this._formatDisplayType(obj.type)} (${localDbName})`,
                                database: localDbName,
                                schema: targetSchema,
                                targetObject: obj.target_object,
                                insertText: this.formatInsertText(obj.name, obj.type, context, tabCtx)
                            });
                        });
                    }

                    // Also check linked server
                    const rServer = qParts[0];
                    const rDb = qParts[1];
                    if (rServer && rDb) {
                        const lservers = await this._getLinkedServers(tabCtx.connectionId);
                        const isLinked = (lservers || []).some(ls => (ls.name || ls.LinkedServerName || '').toLowerCase() === rServer.toLowerCase());
                        if (isLinked) {
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
                    }
                } else if (qParts.length === 1) {
                    const candidateName = qParts[0];
                    // 1. Check local database on same server: database. -> Schemas in database
                    if (localDbName) {
                        const dSchemas = await this._getDatabaseSchemas(tabCtx.connectionId, localDbName, tabCtx.dbType);
                        (dSchemas || []).forEach(s => {
                            const sName = typeof s === 'string' ? s : (s.name || s.schema || '');
                            if (!sName) return;
                            allCandidates.push({
                                name: sName,
                                label: sName,
                                type: 'schema',
                                kind: 'schema',
                                level: 1.5,
                                displayType: `Schema (${localDbName})`,
                                database: localDbName,
                                insertText: `${this.formatInsertText(sName, 'schema', context, tabCtx)}.`
                            });
                        });
                    }

                    // 2. Check linked server
                    const lservers = await this._getLinkedServers(tabCtx.connectionId);
                    const isLinked = (lservers || []).some(ls => (ls.name || ls.LinkedServerName || '').toLowerCase() === candidateName.toLowerCase());
                    if (isLinked) {
                        const rDbs = await this._getRemoteDatabases(tabCtx.connectionId, candidateName);
                        (rDbs || []).forEach(db => {
                            const dName = db.name || db;
                            allCandidates.push({
                                name: dName,
                                label: dName,
                                type: 'database',
                                kind: 'database',
                                level: 1.5,
                                displayType: 'Remote Database',
                                server: candidateName,
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
            if (tabCtx.connectionId && !isKnownAlias && !isLocalSymbol && (!qParts || qParts.length <= 1) && this.dataProvider && typeof this.dataProvider.fetchObjects === 'function') {
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
                        database: tabCtx.database,
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
            if (context && (
                context.position === 'after_source' ||
                context.position === 'table_hint' ||
                context.position === 'order_direction' ||
                context.position === 'is_predicate' ||
                context.position === 'on_conflict' ||
                context.position === 'alias_name' ||
                context.position === 'column_definition_type'
            )) {
                return;
            }

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

            // Suggest local databases for SQL Server (Cross-Database Intelligence)
            const isDatabaseContext = Boolean(
                context.clause === 'FROM' ||
                context.clause === 'JOIN' ||
                context.clause === 'INSERT INTO' ||
                context.clause === 'UPDATE' ||
                context.clause === 'EXEC' ||
                context.clause === 'EXECUTE' ||
                context.clause === 'USE' ||
                context.clause === 'DELETE' ||
                context.clause === 'MERGE' ||
                (context.execContext && context.execContext.isExec) ||
                context.isAlterContext
            );
            if (isSqlServer && tabCtx.connectionId && isDatabaseContext && !isStrictAlter && !(context.isInsertColumns || context.clause === 'INSERT_COLUMNS')) {
                const sysDbSet = new Set(['master', 'model', 'msdb', 'tempdb']);
                const serverDbs = await this._getServerDatabases(tabCtx.connectionId, tabCtx.dbType);
                const currentDbLower = (tabCtx.database || '').toLowerCase();
                (serverDbs || []).forEach(db => {
                    const dName = typeof db === 'string' ? db : (db.name || '');
                    if (!dName) return;
                    const isSystem = (typeof db === 'object' && db.is_system) || sysDbSet.has(dName.toLowerCase());
                    const isCurrent = dName.toLowerCase() === currentDbLower;
                    const isUseClause = context.clause === 'USE';
                    allCandidates.push({
                        name: dName,
                        label: dName,
                        type: 'database',
                        kind: 'database',
                        level: isSystem ? 2.8 : 2.0,
                        displayType: isSystem ? 'System Database' : 'Database',
                        detail: isCurrent ? 'Database (current)' : (isSystem ? 'System Database' : 'Database'),
                        isSystemDb: isSystem,
                        isCurrentDb: isCurrent,
                        insertText: isUseClause
                            ? this.formatInsertText(dName, 'database', context, tabCtx)
                            : `${this.formatInsertText(dName, 'database', context, tabCtx)}.`
                    });
                });
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
                } else if (context.execContext && context.execContext.isExec && context.execContext.procedureName) {
                    if (obj.name && obj.name.toLowerCase() === context.execContext.procedureName.toLowerCase()) return;
                } else if (context.isInsertColumns || context.clause === 'INSERT_COLUMNS') {
                    return;
                } else if (context.clause === 'FROM' || context.clause === 'JOIN' || context.clause === 'INSERT INTO' || context.clause === 'UPDATE') {
                    if (context.clause === 'INSERT INTO' || context.clause === 'UPDATE') {
                        if (!['table', 'view', 'temp_table', 'table_variable', 'synonym', 'foreign_table'].includes(obj.type)) return;
                    } else {
                        if (!['table', 'view', 'temp_table', 'table_variable', 'synonym', 'foreign_table', 'function'].includes(obj.type)) return;
                    }
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

        _isFunctionForbidden(context) {
            if (!context) return false;
            if (context.isInCatchBlock) return false;
            const pos = context.position;
            if (['statement_start', 'after_source', 'table_hint', 'order_direction', 'is_predicate', 'on_conflict', 'alias_name', 'column_definition_type'].includes(pos)) {
                return true;
            }
            if (context.contextType === 'table' && pos !== 'after_source') {
                return true;
            }
            return false;
        }

        async generate(context, tabCtx, wordLower = '') {
            const allCandidates = [];
            const metadataErrors = [];

            // Alias name position: immediately return empty list (Spec GĐ3, ALIAS-POS)
            if (context.position === 'alias_name') {
                return allCandidates;
            }

            // 0a. Data Type Context (Issue I3 - Section 11, Spec Phase 4, GĐ3 column_definition_type)
            if (context.position === 'column_definition_type' || context.isDataTypePosition || context.contextType === 'data_type') {
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

            const seenKeywords = new Set();

            // Load Follow-up keywords if present
            if (context.hasFollowUp && context.followUpKeywords && context.followUpKeywords.length > 0) {
                context.followUpKeywords.forEach(kw => {
                    const kwUpper = kw.toUpperCase();
                    seenKeywords.add(kwUpper);
                    allCandidates.push({
                        name: kw,
                        label: kw,
                        type: 'keyword',
                        kind: 'keyword',
                        level: 1,
                        displayType: 'Keyword',
                        insertText: kw,
                        isFollowUp: true,
                        isExpected: true
                    });
                });
            }

            // Load Expected Keywords according to position × dialect (Spec GĐ3 & GĐ4)
            const dialect = (window.SqlDialectFactory)
                ? window.SqlDialectFactory.getDialect(tabCtx.dbType)
                : null;
            const isNoFromSelect = (!context.qualifier && context.clause === 'SELECT' && (!context.queryTables || context.queryTables.length === 0));
            const posOrClause = context.position || (isNoFromSelect ? 'select_clause' : null);
            const expectedKeywords = (!context.qualifier && dialect && typeof dialect.getExpectedKeywords === 'function' && posOrClause)
                ? dialect.getExpectedKeywords(posOrClause, context)
                : [];

            expectedKeywords.forEach(kw => {
                const kwUpper = kw.toUpperCase();
                if (!seenKeywords.has(kwUpper)) {
                    seenKeywords.add(kwUpper);
                    allCandidates.push({
                        name: kw,
                        label: kw,
                        type: 'keyword',
                        kind: 'keyword',
                        level: 1,
                        displayType: 'Keyword',
                        insertText: kw,
                        isExpected: true
                    });
                }
            });

            // Standard keywords and snippets loading logic (Spec GĐ3)
            const isExcludedPosition = Boolean(
                ['table_hint', 'order_direction', 'is_predicate', 'on_conflict', 'alias_name', 'column_definition_type'].includes(context.position) ||
                (context.contextType === 'table' && context.position !== 'after_source')
            );

            const isRestrictedLenPosition = Boolean(
                context.position === 'statement_start' || context.position === 'after_source'
            );

            const canLoadStandardKeywords = shouldLoadStandardKeywords && !isExcludedPosition &&
                (!isRestrictedLenPosition || (wordLower && wordLower.length >= 2));

            if (canLoadStandardKeywords) {
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
                    this._loadStandardKeywordsAndSnippets(allCandidates, tabCtx, wordLower, {
                        context,
                        excludeKeywords: seenKeywords,
                        allowSnippets: !isExcludedPosition && (!isRestrictedLenPosition || (wordLower && wordLower.length >= 1))
                    });
                }
            } else if (shouldLoadStandardKeywords && !isExcludedPosition && !this._isFunctionForbidden(context)) {
                // If keywords are excluded or restricted by length, but functions/snippets might be allowed
                this._loadStandardKeywordsAndSnippets(allCandidates, tabCtx, wordLower, {
                    context,
                    allowKeywords: false,
                    allowFunctions: !this._isFunctionForbidden(context),
                    allowSnippets: (wordLower && wordLower.length >= 1)
                });
            }

            // 2. Level 2: Local Script Objects (CTEs, Variables, Temp Tables, Aliases)
            if (!context.qualifier && !isStrictAlter) {
                this._generateLocalSymbolCandidates(allCandidates, context, tabCtx);
                if (context.position !== 'after_source' && context.position !== 'table_hint' && context.position !== 'order_direction' && context.position !== 'is_predicate' && context.position !== 'on_conflict') {
                    await this._generateStatementColumnCandidates(allCandidates, context, tabCtx);
                }
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

        _loadSnippets(allCandidates, tabCtx) {
            if (window.AppSnippets && typeof window.AppSnippets.getSnippets === 'function') {
                const currentDbType = (tabCtx && tabCtx.dbType) || (window.AppTabs && window.AppTabs.getActiveTabState && window.AppTabs.getActiveTabState()?.dbType) || window.ActiveDbType || null;
                const allSnips = window.AppSnippets.getSnippets(currentDbType);
                allSnips.forEach(snip => {
                    if (window.AppSnippets.matchesDbType && !window.AppSnippets.matchesDbType(snip.dbType, currentDbType)) {
                        return;
                    }
                    const isPinned = Boolean(snip.isPinned);
                    const tagList = Array.isArray(snip.tags) ? snip.tags : (typeof snip.tags === 'string' ? snip.tags.split(',').map(t => t.trim()).filter(Boolean) : []);
                    const tagsSuffix = tagList.length > 0 ? ` [${tagList.join(', ')}]` : '';
                    const normDb = window.AppSnippets.normalizeDbType ? window.AppSnippets.normalizeDbType(snip.dbType) : (snip.dbType || 'all');
                    const dbBadge = (normDb && normDb !== 'all') ? ` [${normDb === 'sqlserver' ? 'MSSQL' : 'PG'}]` : '';
                    allCandidates.push({
                        name: snip.prefix,
                        label: snip.prefix,
                        type: 'snippet',
                        kind: 'snippet',
                        level: isPinned ? 0.5 : 1.5,
                        sortText: isPinned ? `00_snip_${snip.prefix}` : `50_snip_${snip.prefix}`,
                        displayType: isPinned ? '📌 Snippet' : 'Snippet',
                        description: (isPinned ? '★ [Pinned] ' : '') + (snip.description || '') + dbBadge + tagsSuffix,
                        snippetData: snip,
                        isPinned: isPinned,
                        dbType: normDb,
                        tags: tagList,
                        insertText: snip.body || snip.prefix
                    });
                });
            }
        }

        _loadStandardKeywordsAndSnippets(allCandidates, tabCtx, wordLower, options = {}) {
            const context = options.context || null;
            const allowFunctions = options.allowFunctions !== false && !this._isFunctionForbidden(context);
            const allowKeywords = options.allowKeywords !== false;
            const excludeKeywords = options.excludeKeywords || null;

            if (allowKeywords) {
                const dialect = (window.SqlDialectFactory)
                    ? window.SqlDialectFactory.getDialect(tabCtx.dbType)
                    : null;

                const keywordsToUse = dialect
                    ? dialect.getKeywords()
                    : ((window.SqlContextAnalyzer && window.SqlContextAnalyzer.getKeywordsForDbType)
                        ? window.SqlContextAnalyzer.getKeywordsForDbType(tabCtx.dbType)
                        : (window.SqlContextAnalyzer ? window.SqlContextAnalyzer.SQL_KEYWORDS : []));

                keywordsToUse.forEach(kw => {
                    if (excludeKeywords && excludeKeywords.has(kw.toUpperCase())) return;
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
            }

            // Built-in SQL functions with signatures & documentation (Section 51)
            if (allowFunctions) {
                const dialect = (window.SqlDialectFactory)
                    ? window.SqlDialectFactory.getDialect(tabCtx.dbType)
                    : null;

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
            }

            // Snippets
            if (options.allowSnippets !== false) {
                this._loadSnippets(allCandidates, tabCtx);
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

                const ptDb = pt.database || tabCtx.database;
                const ptSchema = pt.schema || '';
                const ptName = CompletionEngine.cleanIdentifier(pt.table || '');
                const ptLower = ptName.toLowerCase();
                const fks = await this.dataProvider.fetchForeignKeys(tabCtx.connectionId, ptDb, ptSchema, ptName, tabCtx.dbType);

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
                const rtDb = rightTable.database || tabCtx.database;
                const rtSchema = rightTable.schema || '';
                const fks = await this.dataProvider.fetchForeignKeys(tabCtx.connectionId, rtDb, rtSchema, rtName, tabCtx.dbType);

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
                const rtDb = rightTable.database || tabCtx.database;
                const rtSchema = rightTable.schema || '';
                const rightCols = await this.dataProvider.fetchColumns(tabCtx.connectionId, rtDb, rtSchema, rtName, tabCtx.dbType);

                const genericIgnore = new Set([
                    'name', 'code', 'status', 'type', 'description', 'notes', 'comment', 'comments',
                    'created_at', 'updated_at', 'created_date', 'modified_date', 'created_by', 'updated_by',
                    'deleted', 'is_active', 'active', 'rowguid', 'version', 'flag'
                ]);

                for (const lt of leftTables) {
                    const ltDb = lt.database || tabCtx.database;
                    const ltSchema = lt.schema || '';
                    const ltName = CompletionEngine.cleanIdentifier(lt.table || '');
                    const leftCols = await this.dataProvider.fetchColumns(tabCtx.connectionId, ltDb, ltSchema, ltName, tabCtx.dbType);
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

    window.CandidateGenerator = CandidateGenerator;
})(typeof window !== 'undefined' ? window : globalThis);
