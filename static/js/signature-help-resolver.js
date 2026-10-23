/**
 * signature-help-resolver.js - SQL Parameter Info & Signature Help Resolver
 */
(function(window) {
    'use strict';

    const FUNCTION_SIGNATURES = window.SqlFunctionSignatures || {};
    const PARAMETER_DOCS = window.SqlParameterDocs || {};

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
            if (typeof CompletionEngine !== 'undefined' && typeof CompletionEngine.cleanIdentifier === 'function') {
                return CompletionEngine.cleanIdentifier(name);
            }
            return name.replace(/^[\["']+|[\]"']+$/g, '');
        }

        formatParamInfo(p, dbType) {
            const rawName = p.name || '';
            const isPg = (dbType === 'postgres' || dbType === 'postgresql');
            let pName = rawName;
            if (isPg) {
                if (pName.startsWith('@')) pName = pName.slice(1);
            } else {
                if (pName && !pName.startsWith('@')) pName = `@${pName}`;
            }

            const dt = p.data_type || p.dataType || p.type || 'any';
            const isOut = Boolean(p.is_output || p.isOutput || (p.direction && p.direction.toUpperCase().includes('OUT')));
            const dir = p.direction ? ` [${p.direction}]` : (isOut ? ' [OUTPUT]' : '');
            const defVal = (p.default_value !== undefined && p.default_value !== null)
                ? p.default_value
                : (p.defaultValue !== undefined ? p.defaultValue : null);

            const docParts = [`Type: ${dt}`];
            if (dir) docParts.push(dir.trim());
            if (defVal !== null && defVal !== undefined) docParts.push(`Default: ${defVal}`);

            return {
                name: pName,
                rawName: rawName,
                dataType: dt,
                isOutput: isOut,
                defaultValue: defVal,
                label: pName,
                documentation: docParts.join(' | ')
            };
        }

        async fetchParameters(connectionId, database, schema, name, dbType) {
            if (!name) return [];

            // 1. Check local in-memory cache if metadataCache provided
            const metaCache = this.getMetadataCache();
            if (metaCache && typeof metaCache.getParameters === 'function') {
                try {
                    const cached = metaCache.getParameters(connectionId, database, schema, name);
                    if (cached && Array.isArray(cached) && cached.length > 0) {
                        return cached;
                    }
                } catch (e) {}
            }

            // 2. Try AppIntelliSense.fetchParameters
            if (typeof window !== 'undefined' && window.AppIntelliSense && typeof window.AppIntelliSense.fetchParameters === 'function') {
                try {
                    const res = await window.AppIntelliSense.fetchParameters(connectionId, database, schema, name, dbType);
                    if (res && Array.isArray(res) && res.length > 0) {
                        return res;
                    }
                } catch (e) {}
            }

            // 3. Try dataProvider (fetchParameters or getParameters)
            const provider = this.getDataProvider();
            if (provider) {
                if (typeof provider.fetchParameters === 'function') {
                    try {
                        const res = await provider.fetchParameters(connectionId, database, schema, name, dbType);
                        if (res && Array.isArray(res) && res.length > 0) {
                            if (metaCache && typeof metaCache.setParameters === 'function') {
                                metaCache.setParameters(connectionId, database, schema, name, res);
                            }
                            return res;
                        }
                    } catch (e) {}
                }
                if (typeof provider.getParameters === 'function') {
                    try {
                        const res = await provider.getParameters(connectionId, database, schema, name, dbType);
                        if (res && Array.isArray(res) && res.length > 0) {
                            if (metaCache && typeof metaCache.setParameters === 'function') {
                                metaCache.setParameters(connectionId, database, schema, name, res);
                            }
                            return res;
                        }
                    } catch (e) {}
                }
            }

            // 4. Try window.pywebview.api or window.api desktop bridge
            if (typeof window !== 'undefined') {
                const api = (window.pywebview && window.pywebview.api) || window.api;
                if (api) {
                    if (typeof api.get_proc_params === 'function') {
                        try {
                            const res = await api.get_proc_params(connectionId, database, schema, name);
                            if (res && res.success && Array.isArray(res.params) && res.params.length > 0) {
                                if (metaCache && typeof metaCache.setParameters === 'function') {
                                    metaCache.setParameters(connectionId, database, schema, name, res.params);
                                }
                                return res.params;
                            }
                        } catch (e) {}
                    }
                    if (typeof api.get_intellisense_parameters === 'function') {
                        try {
                            const res = await api.get_intellisense_parameters(connectionId, database, schema, name);
                            if (res && res.success && Array.isArray(res.items) && res.items.length > 0) {
                                if (metaCache && typeof metaCache.setParameters === 'function') {
                                    metaCache.setParameters(connectionId, database, schema, name, res.items);
                                }
                                return res.items;
                            }
                        } catch (e) {}
                    }
                }

                // 5. Try HTTP fetch fallbacks (POST /proc-params or GET /api/metadata/.../parameters)
                if (typeof fetch === 'function') {
                    try {
                        const postRes = await fetch('/proc-params', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ connection_id: connectionId, database, schema, proc_name: name })
                        });
                        if (postRes.ok) {
                            const data = await postRes.json();
                            if (data && data.success && Array.isArray(data.params) && data.params.length > 0) {
                                if (metaCache && typeof metaCache.setParameters === 'function') {
                                    metaCache.setParameters(connectionId, database, schema, name, data.params);
                                }
                                return data.params;
                            }
                        }
                    } catch (e) {}

                    try {
                        const getUrl = `/api/metadata/${connectionId}/intellisense/parameters?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}&name=${encodeURIComponent(name)}`;
                        const getRes = await fetch(getUrl);
                        if (getRes.ok) {
                            const data = await getRes.json();
                            if (data && data.success && Array.isArray(data.items) && data.items.length > 0) {
                                if (metaCache && typeof metaCache.setParameters === 'function') {
                                    metaCache.setParameters(connectionId, database, schema, name, data.items);
                                }
                                return data.items;
                            }
                        }
                    } catch (e) {}
                }
            }

            return [];
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
                    let callKeyword = null;
                    const k = i - 1;
                    if (k >= 0 && (tokensBefore[k].type === 'IDENTIFIER' || tokensBefore[k].type === 'KEYWORD')) {
                        funcName = this.cleanIdentifier(tokensBefore[k].value);
                        let nameIdx = k;
                        if (k >= 2 && tokensBefore[k - 1].value === '.' &&
                            (tokensBefore[k - 2].type === 'IDENTIFIER' || tokensBefore[k - 2].type === 'KEYWORD')) {
                            funcSchema = this.cleanIdentifier(tokensBefore[k - 2].value);
                            nameIdx = k - 2;
                        }
                        if (nameIdx >= 1) {
                            const prevUp = tokensBefore[nameIdx - 1].value.toUpperCase();
                            if (prevUp === 'EXEC' || prevUp === 'EXECUTE' || prevUp === 'CALL') {
                                callKeyword = prevUp;
                            }
                        }
                    }
                    const isFunc = Boolean(funcName && !nonFuncKeywords.has(funcName.toUpperCase()));
                    parenStack.push({
                        isFunc,
                        funcName: isFunc ? funcName : null,
                        funcSchema: isFunc ? funcSchema : null,
                        callKeyword: isFunc ? callKeyword : null,
                        tokenIndex: i,
                        openIndex: tk.start,
                        commaCount: 0,
                        currentArgNamedParam: null
                    });
                } else if (tk.value === ')') {
                    if (parenStack.length > 0) {
                        parenStack.pop();
                    }
                } else if (tk.value === ',') {
                    if (parenStack.length > 0) {
                        parenStack[parenStack.length - 1].commaCount++;
                        parenStack[parenStack.length - 1].currentArgNamedParam = null;
                    }
                } else {
                    if (parenStack.length > 0) {
                        if (i + 1 < tokensBefore.length && (tokensBefore[i + 1].value === '=' || tokensBefore[i + 1].value === '=>' || tokensBefore[i + 1].value === ':=')) {
                            parenStack[parenStack.length - 1].currentArgNamedParam = tk.value;
                        }
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

            // 4A. Function or Parenthesized Procedure call found
            if (activeFuncCall) {
                const fnName = activeFuncCall.funcName;
                const fnSchema = activeFuncCall.funcSchema;
                const callKeyword = activeFuncCall.callKeyword;
                let activeParamIdx = activeFuncCall.commaCount;
                const fnUpper = fnName.toUpperCase();

                // Check built-in function signatures first (if not an explicit EXEC/CALL)
                if (!callKeyword && FUNCTION_SIGNATURES[fnUpper]) {
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

                // Check User-Defined Function (UDF) or Stored Procedure via fetchParameters
                try {
                    const uParams = await this.fetchParameters(
                        effectiveTabCtx.connectionId,
                        effectiveTabCtx.database,
                        fnSchema || effectiveTabCtx.schema,
                        fnName,
                        effectiveTabCtx.dbType
                    );
                    if (uParams && Array.isArray(uParams) && uParams.length > 0) {
                        const formattedParams = uParams.map(p => this.formatParamInfo(p, effectiveTabCtx.dbType));
                        const paramList = formattedParams.map(p => ({
                            label: p.label,
                            documentation: p.documentation
                        }));

                        if (activeFuncCall.currentArgNamedParam) {
                            const cleanSearch = activeFuncCall.currentArgNamedParam.replace(/^[@"']+|["']+$/g, '').toLowerCase();
                            const matchIdx = formattedParams.findIndex(p => {
                                const pClean = p.name.replace(/^[@"']+|["']+$/g, '').toLowerCase();
                                const rClean = p.rawName.replace(/^[@"']+|["']+$/g, '').toLowerCase();
                                return pClean === cleanSearch || rClean === cleanSearch;
                            });
                            if (matchIdx !== -1) {
                                activeParamIdx = matchIdx;
                            }
                        }

                        const clamped = Math.max(0, Math.min(activeParamIdx, paramList.length - 1));
                        const prefix = callKeyword ? `${callKeyword} ` : '';
                        const paramSigStrs = formattedParams.map(p => {
                            let s = `${p.label} ${p.dataType}`;
                            if (p.isOutput) s += ' OUTPUT';
                            if (p.defaultValue !== null && p.defaultValue !== undefined) s += ` = ${p.defaultValue}`;
                            return s;
                        });
                        const sigLabel = `${prefix}${fnSchema ? `${fnSchema}.` : ''}${fnName}(${paramSigStrs.join(', ')})`;
                        const docDesc = callKeyword 
                            ? `Stored procedure ${fnSchema ? `${fnSchema}.` : ''}${fnName}`
                            : `User-defined function ${fnSchema ? `${fnSchema}.` : ''}${fnName}`;

                        return {
                            signatures: [{
                                label: sigLabel,
                                documentation: docDesc,
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

            // 4B. Check EXEC / EXECUTE / CALL Stored Procedure context (without parentheses)
            let callIdx = -1;
            let callKeyword = null;
            for (let i = tokensBefore.length - 1; i >= 0; i--) {
                const up = tokensBefore[i].value.toUpperCase();
                if (up === 'EXEC' || up === 'EXECUTE' || up === 'CALL') {
                    callIdx = i;
                    callKeyword = up;
                    break;
                }
                if (tokensBefore[i].value === ';' || up === 'GO' ||
                    ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER'].includes(up)) {
                    break;
                }
            }

            if (callIdx !== -1) {
                let j = callIdx + 1;
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
                    let currentArgNamedParam = null;
                    let parenDepth = 0;

                    for (let k = j; k < tokensBefore.length; k++) {
                        const tk = tokensBefore[k];
                        if (tk.value === '(') {
                            parenDepth++;
                        } else if (tk.value === ')') {
                            if (parenDepth > 0) parenDepth--;
                        } else if (parenDepth === 0) {
                            if (tk.value === ',') {
                                commaCount++;
                                currentArgNamedParam = null;
                            } else if (k + 1 < tokensBefore.length && (tokensBefore[k + 1].value === '=' || tokensBefore[k + 1].value === '=>' || tokensBefore[k + 1].value === ':=')) {
                                currentArgNamedParam = tk.value;
                            }
                        }
                    }

                    try {
                        const procParams = await this.fetchParameters(
                            effectiveTabCtx.connectionId,
                            effectiveTabCtx.database,
                            procSchema || effectiveTabCtx.schema,
                            procName,
                            effectiveTabCtx.dbType
                        );
                        if (procParams && Array.isArray(procParams) && procParams.length > 0) {
                            const formattedParams = procParams.map(p => this.formatParamInfo(p, effectiveTabCtx.dbType));
                            const paramList = formattedParams.map(p => ({
                                label: p.label,
                                documentation: p.documentation
                            }));

                            let activeParamIdx = commaCount;
                            if (currentArgNamedParam) {
                                const cleanSearch = currentArgNamedParam.replace(/^[@"']+|["']+$/g, '').toLowerCase();
                                const matchIdx = formattedParams.findIndex(p => {
                                    const pClean = p.name.replace(/^[@"']+|["']+$/g, '').toLowerCase();
                                    const rClean = p.rawName.replace(/^[@"']+|["']+$/g, '').toLowerCase();
                                    return pClean === cleanSearch || rClean === cleanSearch;
                                });
                                if (matchIdx !== -1) {
                                    activeParamIdx = matchIdx;
                                }
                            }
                            const clamped = Math.max(0, Math.min(activeParamIdx, paramList.length - 1));

                            const isCall = (callKeyword === 'CALL');
                            let sigLabel = '';
                            if (isCall) {
                                const paramStrs = formattedParams.map(p => {
                                    let s = `${p.label} ${p.dataType}`;
                                    if (p.defaultValue !== null && p.defaultValue !== undefined) s += ` = ${p.defaultValue}`;
                                    return s;
                                });
                                sigLabel = `CALL ${procSchema ? `${procSchema}.` : ''}${procName}(${paramStrs.join(', ')})`;
                            } else {
                                const paramStrs = formattedParams.map(p => {
                                    let s = `${p.label} ${p.dataType}`;
                                    if (p.isOutput) s += ' OUTPUT';
                                    if (p.defaultValue !== null && p.defaultValue !== undefined) s += ` = ${p.defaultValue}`;
                                    return s;
                                });
                                sigLabel = `EXEC ${procSchema ? `${procSchema}.` : ''}${procName} ${paramStrs.join(', ')}`;
                            }

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

    window.SqlSignatureHelpResolverClass = SqlSignatureHelpResolver;
    if (!window.SqlSignatureHelpResolver) {
        window.SqlSignatureHelpResolver = new SqlSignatureHelpResolver();
    }
})(typeof window !== 'undefined' ? window : globalThis);
