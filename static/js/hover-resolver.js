/**
 * hover-resolver.js - SQL Hover Tooltip & Symbol Documentation Resolver
 */
(function(window) {
    'use strict';

    const FUNCTION_SIGNATURES = window.SqlFunctionSignatures || {};

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


    window.SqlHoverResolverClass = SqlHoverResolver;
    if (!window.SqlHoverResolver) {
        window.SqlHoverResolver = new SqlHoverResolver();
    }
})(typeof window !== 'undefined' ? window : globalThis);
