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

    window.SqlSignatureHelpResolverClass = SqlSignatureHelpResolver;
    if (!window.SqlSignatureHelpResolver) {
        window.SqlSignatureHelpResolver = new SqlSignatureHelpResolver();
    }
})(typeof window !== 'undefined' ? window : globalThis);
