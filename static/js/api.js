/**
 * api.js - Zero-Network Native IPC Bridge for pywebview.
 * Intercepts all fetch('/api/...') calls across the application
 * and routes them directly to window.pywebview.api via a declarative Route Dispatch Table!
 */
(function (global) {
    'use strict';

    let _cachedNativeApi = null;

    global.waitForPywebview = function () {
        if (_cachedNativeApi) return Promise.resolve(_cachedNativeApi);
        if (window.pywebview && window.pywebview.api) {
            _cachedNativeApi = window.pywebview.api;
            return Promise.resolve(_cachedNativeApi);
        }
        return new Promise((resolve) => {
            let done = false;
            const finish = (api) => {
                if (done) return;
                done = true;
                window.removeEventListener('pywebviewready', onReady);
                if (api) {
                    _cachedNativeApi = api;
                }
                resolve(_cachedNativeApi || null);
            };

            const onReady = () => {
                finish(window.pywebview?.api || null);
            };
            window.addEventListener('pywebviewready', onReady);

            // Active interval polling (up to 2500ms max, 30ms interval)
            let elapsed = 0;
            const poll = setInterval(() => {
                elapsed += 30;
                if (window.pywebview && window.pywebview.api) {
                    clearInterval(poll);
                    finish(window.pywebview.api);
                } else if (elapsed >= 2500) {
                    clearInterval(poll);
                    finish(null);
                }
            }, 30);
        });
    };

    window.addEventListener('pywebviewready', () => {
        if (window.pywebview && window.pywebview.api) {
            _cachedNativeApi = window.pywebview.api;
        }
    });

    /**
     * Helper to verify if a required method exists on the pywebview API bridge.
     * Throws an explicit error with status 501 if missing.
     */
    function verifyNativeMethod(api, methodName) {
        if (!api || typeof api[methodName] !== 'function') {
            const error = new Error(`Native method '${methodName}' is not implemented on pywebview bridge`);
            error.status = 501;
            error.notImplemented = true;
            throw error;
        }
    }

    /**
     * Helper to resolve one of multiple fallback methods.
     */
    function resolveNativeMethod(api, methodNames) {
        if (!api) return null;
        for (const name of methodNames) {
            if (typeof api[name] === 'function') {
                return name;
            }
        }
        return null;
    }

    /**
     * Declarative Route Dispatch Table
     * Maps URL patterns and HTTP methods to their handlers and native target methods.
     */
    const ROUTE_DISPATCH_TABLE = [
        // =========================================================================
        // Connections
        // =========================================================================
        {
            id: 'connections:list',
            method: 'GET',
            pattern: '/api/connections',
            targetMethods: ['list_connections', 'get_saved_connections'],
            handler: async (api) => {
                let result = null;
                if (typeof api.list_connections === 'function') {
                    result = await api.list_connections();
                }
                if (!result || result.success === false) {
                    if (typeof api.get_saved_connections === 'function') {
                        const savedRes = await api.get_saved_connections();
                        if (savedRes && savedRes.success) {
                            result = {
                                success: true,
                                connections: [],
                                saved_connections: savedRes.connections || [],
                                active_connections: []
                            };
                        }
                    }
                }
                if (!result && typeof api.list_connections !== 'function' && typeof api.get_saved_connections !== 'function') {
                    verifyNativeMethod(api, 'list_connections');
                }
                return result;
            }
        },
        {
            id: 'connections:create',
            method: 'POST',
            pattern: '/api/connections',
            targetMethods: ['create_connection'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'create_connection');
                return await api.create_connection(ctx.body);
            }
        },
        {
            id: 'connections:fetch_metadata',
            method: 'POST',
            pattern: '/api/connections/fetch-metadata',
            targetMethods: ['fetch_connection_metadata'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'fetch_connection_metadata');
                return await api.fetch_connection_metadata(ctx.body);
            }
        },
        {
            id: 'connections:select_sqlite_file',
            method: 'POST',
            pattern: '/api/connections/select-sqlite-file',
            targetMethods: ['select_sqlite_file'],
            handler: async (api) => {
                verifyNativeMethod(api, 'select_sqlite_file');
                return await api.select_sqlite_file();
            }
        },
        {
            id: 'connections:check_credential',
            method: 'POST',
            pattern: '/api/connections/check-credential',
            targetMethods: ['check_credential'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'check_credential');
                return await api.check_credential(ctx.body);
            }
        },
        {
            id: 'connections:clear_credential',
            method: 'POST',
            pattern: '/api/connections/clear-credential',
            targetMethods: ['clear_credential'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'clear_credential');
                return await api.clear_credential(ctx.body);
            }
        },
        {
            id: 'connections:get_password',
            method: 'GET',
            pattern: /^\/api\/connections\/password\/(.+)$/,
            targetMethods: ['get_connection_password'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'get_connection_password');
                const idOrName = decodeURIComponent(ctx.match[1]);
                return await api.get_connection_password(idOrName);
            }
        },
        {
            id: 'connections:delete',
            method: 'DELETE',
            pattern: /^\/api\/connections\/([^/]+)$/,
            targetMethods: ['delete_connection'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'delete_connection');
                return await api.delete_connection(ctx.match[1]);
            }
        },

        // =========================================================================
        // Metadata & Schema
        // =========================================================================
        {
            id: 'metadata:dispatch',
            method: '*',
            pattern: /^\/api\/metadata\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/,
            targetMethods: [
                'get_databases', 'get_schemas', 'get_objects', 'get_definition', 'script_object', 'get_foreign_keys',
                'get_linked_servers', 'get_remote_databases', 'get_remote_schemas', 'get_remote_objects',
                'get_remote_columns', 'test_linked_server', 'get_linked_server_script', 'drop_linked_server',
                'get_foreign_servers', 'get_foreign_tables', 'get_object_children',
                'get_table_design', 'get_table_design_types', 'preview_table_design', 'diff_table_design', 'apply_table_design',
                'get_intellisense_objects', 'get_intellisense_columns', 'get_intellisense_parameters', 'get_intellisense_types'
            ],
            handler: async (api, ctx) => {
                const connId = ctx.match[1];
                const action = ctx.match[2] || '';
                const subAction = ctx.match[3] || '';
                const searchParams = ctx.searchParams;
                const body = ctx.body;
                let result = null;

                if (action === 'databases') {
                    verifyNativeMethod(api, 'get_databases');
                    result = await api.get_databases(connId, searchParams.get('search'));
                } else if (action === 'schemas') {
                    verifyNativeMethod(api, 'get_schemas');
                    result = await api.get_schemas(connId, searchParams.get('database'), searchParams.get('search'));
                } else if (action === 'objects') {
                    verifyNativeMethod(api, 'get_objects');
                    result = await api.get_objects(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('type') || 'tables', searchParams.get('search'));
                } else if (action === 'definition') {
                    verifyNativeMethod(api, 'get_definition');
                    result = await api.get_definition(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('name'), searchParams.get('type'));
                } else if (action === 'script') {
                    verifyNativeMethod(api, 'script_object');
                    result = await api.script_object(
                        connId,
                        searchParams.get('database') || (body && body.database),
                        searchParams.get('schema') || (body && body.schema),
                        searchParams.get('name') || (body && body.name),
                        searchParams.get('type') || (body && body.type) || 'table',
                        searchParams.get('action') || (body && body.action) || 'CREATE'
                    );
                } else if (action === 'foreign_keys') {
                    verifyNativeMethod(api, 'get_foreign_keys');
                    result = await api.get_foreign_keys(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('table'));
                } else if (action === 'linked_servers') {
                    verifyNativeMethod(api, 'get_linked_servers');
                    result = await api.get_linked_servers(connId);
                } else if (action === 'linked_server') {
                    const server = searchParams.get('server') || body.server;
                    if (subAction === 'databases') {
                        verifyNativeMethod(api, 'get_remote_databases');
                        result = await api.get_remote_databases(connId, server);
                    } else if (subAction === 'schemas') {
                        verifyNativeMethod(api, 'get_remote_schemas');
                        result = await api.get_remote_schemas(connId, server, searchParams.get('database'));
                    } else if (subAction === 'objects') {
                        verifyNativeMethod(api, 'get_remote_objects');
                        result = await api.get_remote_objects(connId, server, searchParams.get('database'), searchParams.get('schema'));
                    } else if (subAction === 'columns') {
                        verifyNativeMethod(api, 'get_remote_columns');
                        result = await api.get_remote_columns(connId, server, searchParams.get('database'), searchParams.get('schema'), searchParams.get('table'));
                    } else if (subAction === 'test') {
                        verifyNativeMethod(api, 'test_linked_server');
                        result = await api.test_linked_server(connId, server);
                    } else if (subAction === 'script') {
                        verifyNativeMethod(api, 'get_linked_server_script');
                        result = await api.get_linked_server_script(connId, server, searchParams.get('mode') || 'create');
                    } else if (subAction === 'drop') {
                        verifyNativeMethod(api, 'drop_linked_server');
                        result = await api.drop_linked_server(connId, server);
                    }
                } else if (action === 'foreign_servers') {
                    verifyNativeMethod(api, 'get_foreign_servers');
                    result = await api.get_foreign_servers(connId);
                } else if (action === 'foreign_tables') {
                    verifyNativeMethod(api, 'get_foreign_tables');
                    result = await api.get_foreign_tables(connId, searchParams.get('schema'));
                } else if (action === 'object_children') {
                    verifyNativeMethod(api, 'get_object_children');
                    result = await api.get_object_children(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('name'), searchParams.get('type'), searchParams.get('child_type'));
                } else if (action === 'table-design') {
                    if (!subAction) {
                        verifyNativeMethod(api, 'get_table_design');
                        result = await api.get_table_design(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('table'));
                    } else if (subAction === 'types') {
                        verifyNativeMethod(api, 'get_table_design_types');
                        result = await api.get_table_design_types(connId, searchParams.get('database'));
                    } else if (subAction === 'preview') {
                        verifyNativeMethod(api, 'preview_table_design');
                        result = await api.preview_table_design(connId, body);
                    } else if (subAction === 'diff') {
                        verifyNativeMethod(api, 'diff_table_design');
                        result = await api.diff_table_design(connId, body.original, body.modified);
                    } else if (subAction === 'apply') {
                        verifyNativeMethod(api, 'apply_table_design');
                        result = await api.apply_table_design(connId, body.database, body.statements, body.migration_sql);
                    }
                } else if (action === 'intellisense') {
                    if (subAction === 'objects') {
                        verifyNativeMethod(api, 'get_intellisense_objects');
                        result = await api.get_intellisense_objects(connId, searchParams.get('database'), searchParams.get('schema'));
                    } else if (subAction === 'columns') {
                        verifyNativeMethod(api, 'get_intellisense_columns');
                        result = await api.get_intellisense_columns(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('table'));
                    } else if (subAction === 'parameters') {
                        verifyNativeMethod(api, 'get_intellisense_parameters');
                        result = await api.get_intellisense_parameters(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('name'));
                    } else if (subAction === 'types') {
                        verifyNativeMethod(api, 'get_intellisense_types');
                        result = await api.get_intellisense_types(connId, searchParams.get('database'));
                    }
                }
                return result;
            }
        },

        // =========================================================================
        // Table Data Editor
        // =========================================================================
        {
            id: 'table_editor:metadata',
            method: 'GET',
            pattern: '/api/table-data-editor/metadata',
            targetMethods: ['get_table_editor_metadata'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'get_table_editor_metadata');
                const s = ctx.searchParams;
                return await api.get_table_editor_metadata(s.get('conn_id'), s.get('database'), s.get('schema'), s.get('table'));
            }
        },
        {
            id: 'table_editor:fetch',
            method: 'POST',
            pattern: '/api/table-data-editor/fetch',
            targetMethods: ['fetch_table_data'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'fetch_table_data');
                const b = ctx.body;
                return await api.fetch_table_data(b.conn_id, b.database, b.schema, b.table, b.select_cols, b.criteria, b.top_n, b.custom_sql);
            }
        },
        {
            id: 'table_editor:update',
            method: 'POST',
            pattern: '/api/table-data-editor/update',
            targetMethods: ['update_table_row'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'update_table_row');
                const b = ctx.body;
                return await api.update_table_row(b.conn_id, b.database, b.schema, b.table, b.pk_conditions, b.changes);
            }
        },
        {
            id: 'table_editor:delete',
            method: 'POST',
            pattern: '/api/table-data-editor/delete',
            targetMethods: ['delete_table_row'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'delete_table_row');
                const b = ctx.body;
                return await api.delete_table_row(b.conn_id, b.database, b.schema, b.table, b.pk_conditions);
            }
        },
        {
            id: 'table_editor:insert',
            method: 'POST',
            pattern: '/api/table-data-editor/insert',
            targetMethods: ['insert_table_row'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'insert_table_row');
                const b = ctx.body;
                return await api.insert_table_row(b.conn_id, b.database, b.schema, b.table, b.values, b.identity_columns, b.computed_columns);
            }
        },
        {
            id: 'table_editor:submit_changes',
            method: 'POST',
            pattern: /^\/api\/table-data-editor\/submit[-_]changes$/,
            targetMethods: ['submit_table_changes'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'submit_table_changes');
                const b = ctx.body;
                return await api.submit_table_changes(b.conn_id, b.database, b.schema, b.table, b.changes, b.concurrency_mode);
            }
        },
        {
            id: 'table_editor:validate_rows',
            method: 'POST',
            pattern: '/api/table-data-editor/validate-rows',
            targetMethods: ['validate_table_rows'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'validate_table_rows');
                const b = ctx.body;
                return await api.validate_table_rows(b.conn_id, b.database, b.schema, b.table, b.rows);
            }
        },
        {
            id: 'table_editor:validate_row',
            method: 'POST',
            pattern: '/api/table-data-editor/validate-row',
            targetMethods: ['validate_table_row'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'validate_table_row');
                const b = ctx.body;
                return await api.validate_table_row(b.conn_id, b.database, b.schema, b.table, b.values, b.keys, b.is_new !== false, b.target_column);
            }
        },

        // =========================================================================
        // Query Execution & Syntax
        // =========================================================================
        {
            id: 'query:execute',
            method: 'POST',
            pattern: '/api/query/execute',
            targetMethods: ['execute_query'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'execute_query');
                const b = ctx.body;
                return await api.execute_query(
                    b.connection_id,
                    b.sql,
                    b.limit,
                    b.database,
                    b.schema,
                    b.query_id,
                    b.mode,
                    b.debug_session_id,
                    b.traces,
                    b.confirmed,
                    b.parameters,
                    b.stop_on_error !== undefined ? b.stop_on_error : true
                );
            }
        },
        {
            id: 'query:parse_parameters',
            method: 'POST',
            pattern: '/api/query/parse-parameters',
            targetMethods: ['parse_query_parameters'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'parse_query_parameters');
                return await api.parse_query_parameters(ctx.body.sql, ctx.body.dialect);
            }
        },
        {
            id: 'query:cancel',
            method: 'POST',
            pattern: '/api/query/cancel',
            targetMethods: ['cancel_query'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'cancel_query');
                return await api.cancel_query(ctx.body.connection_id);
            }
        },
        {
            id: 'query:explain',
            method: 'POST',
            pattern: '/api/query/explain',
            targetMethods: ['explain_query'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'explain_query');
                return await api.explain_query(ctx.body.connection_id, ctx.body.sql, ctx.body.database);
            }
        },
        {
            id: 'query:syntax_check',
            method: 'POST',
            pattern: '/api/query/syntax-check',
            targetMethods: ['syntax_check'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'syntax_check');
                const b = ctx.body;
                return await api.syntax_check(b.connection_id, b.sql, b.dialect, b.database, b.schema, b.is_debug, b.cached_tables);
            }
        },

        // =========================================================================
        // Explicit Transactions
        // =========================================================================
        {
            id: 'tx:begin',
            method: 'POST',
            pattern: '/api/tx/begin',
            targetMethods: ['tx_begin'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'tx_begin');
                return await api.tx_begin(ctx.body.connection_id);
            }
        },
        {
            id: 'tx:commit',
            method: 'POST',
            pattern: '/api/tx/commit',
            targetMethods: ['tx_commit'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'tx_commit');
                return await api.tx_commit(ctx.body.connection_id);
            }
        },
        {
            id: 'tx:rollback',
            method: 'POST',
            pattern: '/api/tx/rollback',
            targetMethods: ['tx_rollback'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'tx_rollback');
                return await api.tx_rollback(ctx.body.connection_id);
            }
        },
        {
            id: 'tx:status',
            method: '*',
            pattern: '/api/tx/status',
            targetMethods: ['tx_status'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'tx_status');
                const connId = ctx.body.connection_id || ctx.searchParams.get('connection_id');
                return await api.tx_status(connId);
            }
        },
        {
            id: 'tx:set_read_only',
            method: 'POST',
            pattern: '/api/connection/set_read_only',
            targetMethods: ['set_connection_read_only'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'set_connection_read_only');
                return await api.set_connection_read_only(ctx.body.connection_id, ctx.body.read_only);
            }
        },

        // =========================================================================
        // Profiler
        // =========================================================================
        {
            id: 'profiler:connections',
            method: 'GET',
            pattern: '/api/profiler/connections',
            targetMethods: ['profiler_list_connections'],
            handler: async (api) => {
                verifyNativeMethod(api, 'profiler_list_connections');
                return await api.profiler_list_connections();
            }
        },
        {
            id: 'profiler:open_window',
            method: 'POST',
            pattern: '/api/profiler/open-window',
            targetMethods: ['open_profiler_window'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'open_profiler_window');
                return await api.open_profiler_window(ctx.body.connection_id, ctx.body.db_type);
            }
        },
        {
            id: 'profiler:start',
            method: 'POST',
            pattern: '/api/profiler/start',
            targetMethods: ['profiler_start_trace'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'profiler_start_trace');
                return await api.profiler_start_trace(ctx.body.connection_id, ctx.body.config);
            }
        },
        {
            id: 'profiler:pause',
            method: 'POST',
            pattern: '/api/profiler/pause',
            targetMethods: ['profiler_pause_trace'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'profiler_pause_trace');
                return await api.profiler_pause_trace(ctx.body.session_id);
            }
        },
        {
            id: 'profiler:resume',
            method: 'POST',
            pattern: '/api/profiler/resume',
            targetMethods: ['profiler_resume_trace'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'profiler_resume_trace');
                return await api.profiler_resume_trace(ctx.body.session_id);
            }
        },
        {
            id: 'profiler:stop',
            method: 'POST',
            pattern: '/api/profiler/stop',
            targetMethods: ['profiler_stop_trace'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'profiler_stop_trace');
                return await api.profiler_stop_trace(ctx.body.session_id);
            }
        },
        {
            id: 'profiler:status',
            method: 'GET',
            pattern: /^\/api\/profiler\/status\/(.+)$/,
            targetMethods: ['profiler_get_status'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'profiler_get_status');
                const sid = ctx.match[1];
                return await api.profiler_get_status(sid);
            }
        },

        // =========================================================================
        // Bravo Tool
        // =========================================================================
        {
            id: 'bravo:config',
            method: 'GET',
            pattern: '/api/bravo/config',
            targetMethods: ['get_config'],
            handler: async (api) => {
                verifyNativeMethod(api, 'get_config');
                return await api.get_config();
            }
        },
        {
            id: 'bravo:open_window',
            method: 'POST',
            pattern: '/api/bravo/open-window',
            targetMethods: ['open_bravo_window'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'open_bravo_window');
                const body = ctx.body;
                const searchParams = ctx.searchParams;
                const cId = body.connection_id || searchParams.get('connection_id');
                const cName = body.connection_name || searchParams.get('connection_name');
                const cDb = body.database || searchParams.get('database');
                const cType = body.db_type || searchParams.get('db_type');
                const cSchema = body.schema || searchParams.get('schema');
                return await api.open_bravo_window(cId, cName, cDb, cType, cSchema);
            }
        },
        {
            id: 'bravo:initial_context',
            method: 'GET',
            pattern: '/api/bravo/initial-context',
            targetMethods: ['get_initial_context'],
            handler: async (api) => {
                return typeof api.get_initial_context === 'function' ? await api.get_initial_context() : { success: true, context: {} };
            }
        },
        {
            id: 'bravo:set_title',
            method: 'POST',
            pattern: '/api/bravo/set-title',
            targetMethods: ['set_window_title'],
            handler: async (api, ctx) => {
                return typeof api.set_window_title === 'function' ? await api.set_window_title(ctx.body.title) : { success: true };
            }
        },
        {
            id: 'bravo:features',
            method: 'GET',
            pattern: '/api/bravo/features',
            targetMethods: ['list_features'],
            handler: async (api) => {
                verifyNativeMethod(api, 'list_features');
                return await api.list_features();
            }
        },
        {
            id: 'bravo:connections',
            method: 'GET',
            pattern: '/api/bravo/connections',
            targetMethods: ['list_connections'],
            handler: async (api) => {
                verifyNativeMethod(api, 'list_connections');
                return await api.list_connections();
            }
        },
        {
            id: 'bravo:session_create',
            method: 'POST',
            pattern: '/api/bravo/session',
            targetMethods: ['create_session'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'create_session');
                const body = ctx.body;
                return await api.create_session(body, body.connection_id, body.window_id);
            }
        },
        {
            id: 'bravo:session_destroy',
            method: 'DELETE',
            pattern: /^\/api\/bravo\/session\/(.+)$/,
            targetMethods: ['destroy_session'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'destroy_session');
                const sid = ctx.match[1];
                return await api.destroy_session(sid);
            }
        },
        {
            id: 'bravo:session_get',
            method: 'GET',
            pattern: /^\/api\/bravo\/session\/(.+)$/,
            targetMethods: ['get_session'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'get_session');
                const sid = ctx.match[1];
                return await api.get_session(sid);
            }
        },
        {
            id: 'bravo:layout_editor_list',
            method: 'POST',
            pattern: '/api/bravo/layout-editor/list',
            targetMethods: ['layout_editor_list'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'layout_editor_list');
                const b = ctx.body;
                return await api.layout_editor_list(b.connection_id, b.database, b.platform, b.version, b.custom_where);
            }
        },
        {
            id: 'bravo:layout_editor_payload',
            method: 'POST',
            pattern: '/api/bravo/layout-editor/payload',
            targetMethods: ['layout_editor_payload'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'layout_editor_payload');
                const b = ctx.body;
                return await api.layout_editor_payload(b.connection_id, b.id, b.database, b.platform, b.version);
            }
        },
        {
            id: 'bravo:layout_editor_commit',
            method: 'POST',
            pattern: '/api/bravo/layout-editor/commit',
            targetMethods: ['layout_editor_commit'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'layout_editor_commit');
                const b = ctx.body;
                return await api.layout_editor_commit(b.connection_id, b.forms, b.database, b.platform, b.version);
            }
        },
        {
            id: 'bravo:layout_editor_search_xml',
            method: 'POST',
            pattern: '/api/bravo/layout-editor/search-xml',
            targetMethods: ['layout_editor_search_xml'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'layout_editor_search_xml');
                const b = ctx.body;
                return await api.layout_editor_search_xml(b.connection_id, b.keyword, b.form_ids, b.database, b.platform, b.version, b.is_regex);
            }
        },

        // =========================================================================
        // History
        // =========================================================================
        {
            id: 'history:log_execution',
            method: 'POST',
            pattern: '/api/history/log_execution',
            targetMethods: ['history_log_execution'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_log_execution');
                return await api.history_log_execution(ctx.body);
            }
        },
        {
            id: 'history:update_execution',
            method: 'POST',
            pattern: '/api/history/update_execution',
            targetMethods: ['history_update_execution'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_update_execution');
                return await api.history_update_execution(ctx.body);
            }
        },
        {
            id: 'history:update_document',
            method: 'POST',
            pattern: '/api/history/update_document',
            targetMethods: ['history_update_document'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_update_document');
                return await api.history_update_document(ctx.body);
            }
        },
        {
            id: 'history:document_by_path',
            method: 'GET',
            pattern: '/api/history/document_by_path',
            targetMethods: ['history_get_document_by_path'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_get_document_by_path');
                return await api.history_get_document_by_path(ctx.searchParams.get('path'));
            }
        },
        {
            id: 'history:documents',
            method: 'GET',
            pattern: '/api/history/documents',
            targetMethods: ['history_get_documents'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_get_documents');
                const s = ctx.searchParams;
                return await api.history_get_documents(
                    s.get('search'),
                    s.get('favorites_only') === 'true',
                    s.get('limit') ? parseInt(s.get('limit'), 10) : 200,
                    s.get('server'),
                    s.get('database'),
                    s.get('from_timestamp') ? parseInt(s.get('from_timestamp'), 10) : null,
                    s.get('to_timestamp') ? parseInt(s.get('to_timestamp'), 10) : null
                );
            }
        },
        {
            id: 'history:document_get',
            method: 'GET',
            pattern: /^\/api\/history\/document\/(.+)$/,
            targetMethods: ['history_get_document'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_get_document');
                return await api.history_get_document(ctx.match[1]);
            }
        },
        {
            id: 'history:document_delete',
            method: 'DELETE',
            pattern: /^\/api\/history\/document\/(.+)$/,
            targetMethods: ['history_delete_document'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_delete_document');
                return await api.history_delete_document(ctx.match[1]);
            }
        },
        {
            id: 'history:entries',
            method: 'GET',
            pattern: '/api/history/entries',
            targetMethods: ['history_get_entries'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_get_entries');
                const s = ctx.searchParams;
                return await api.history_get_entries(
                    s.get('doc_id'),
                    s.get('status') ? parseInt(s.get('status'), 10) : null,
                    s.get('limit') ? parseInt(s.get('limit'), 10) : 200,
                    s.get('server'),
                    s.get('database'),
                    s.get('from_timestamp') ? parseInt(s.get('from_timestamp'), 10) : null,
                    s.get('to_timestamp') ? parseInt(s.get('to_timestamp'), 10) : null,
                    s.get('tag'),
                    s.get('entry_type') ? parseInt(s.get('entry_type'), 10) : null
                );
            }
        },
        {
            id: 'history:entry_note',
            method: 'POST',
            pattern: /^\/api\/history\/entry\/(\d+)\/note$/,
            targetMethods: ['history_update_entry_note'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_update_entry_note');
                const entryId = parseInt(ctx.match[1], 10);
                return await api.history_update_entry_note(entryId, ctx.body.note, ctx.body.tag);
            }
        },
        {
            id: 'history:entry_detail',
            method: 'GET',
            pattern: /^\/api\/history\/entry\/(\d+)$/,
            targetMethods: ['history_get_entry_detail'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_get_entry_detail');
                const entryId = parseInt(ctx.match[1], 10);
                return await api.history_get_entry_detail(entryId);
            }
        },
        {
            id: 'history:entry_delete',
            method: 'DELETE',
            pattern: /^\/api\/history\/entry\/(\d+)$/,
            targetMethods: ['history_delete_entry'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_delete_entry');
                const entryId = parseInt(ctx.match[1], 10);
                return await api.history_delete_entry(entryId);
            }
        },
        {
            id: 'history:filters',
            method: 'GET',
            pattern: '/api/history/filters',
            targetMethods: ['history_get_filters'],
            handler: async (api) => {
                return typeof api.history_get_filters === 'function' ? await api.history_get_filters() : { success: false, filters: { servers: [], databases: [], tags: [] } };
            }
        },
        {
            id: 'history:export',
            method: 'POST',
            pattern: '/api/history/export',
            targetMethods: ['history_export'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_export');
                return await api.history_export(ctx.body);
            }
        },
        {
            id: 'history:import',
            method: 'POST',
            pattern: '/api/history/import',
            targetMethods: ['history_import'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_import');
                return await api.history_import(ctx.body);
            }
        },
        {
            id: 'history:active_editor_content',
            method: 'GET',
            pattern: '/api/history/active_editor_content',
            targetMethods: ['get_active_editor_content', 'history_get_active_editor_content'],
            handler: async (api) => {
                const method = resolveNativeMethod(api, ['get_active_editor_content', 'history_get_active_editor_content']);
                if (method) return await api[method]();
                return { success: false, content: '' };
            }
        },
        {
            id: 'history:open_diff_in_editor',
            method: 'POST',
            pattern: '/api/history/open_diff_in_editor',
            targetMethods: ['open_diff_in_editor', 'history_open_diff_in_editor'],
            handler: async (api, ctx) => {
                const method = resolveNativeMethod(api, ['open_diff_in_editor', 'history_open_diff_in_editor']);
                if (!method) {
                    verifyNativeMethod(api, 'open_diff_in_editor');
                }
                return await api[method](ctx.body);
            }
        },
        {
            id: 'history:toggle_star',
            method: 'POST',
            pattern: '/api/history/toggle_star',
            targetMethods: ['history_toggle_star'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_toggle_star');
                return await api.history_toggle_star(ctx.body.doc_id, ctx.body.is_starred);
            }
        },
        {
            id: 'history:purge',
            method: 'POST',
            pattern: '/api/history/purge',
            targetMethods: ['history_purge'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_purge');
                const b = ctx.body;
                return await api.history_purge(b.max_age_days, b.max_entries_per_doc, b.max_db_size_mb);
            }
        },
        {
            id: 'history:compact',
            method: 'POST',
            pattern: '/api/history/compact',
            targetMethods: ['history_compact'],
            handler: async (api) => {
                verifyNativeMethod(api, 'history_compact');
                return await api.history_compact();
            }
        },
        {
            id: 'history:clear_all',
            method: 'POST',
            pattern: '/api/history/clear_all',
            targetMethods: ['history_clear_all'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'history_clear_all');
                return await api.history_clear_all(ctx.body.keep_favorites);
            }
        },
        {
            id: 'history:stats',
            method: 'GET',
            pattern: '/api/history/stats',
            targetMethods: ['history_get_stats'],
            handler: async (api) => {
                verifyNativeMethod(api, 'history_get_stats');
                return await api.history_get_stats();
            }
        },
        {
            id: 'history:open_window',
            method: 'POST',
            pattern: '/api/history/open-window',
            targetMethods: ['open_query_history_window'],
            handler: async (api) => {
                verifyNativeMethod(api, 'open_query_history_window');
                return await api.open_query_history_window();
            }
        },
        {
            id: 'history:open_in_editor',
            method: 'POST',
            pattern: '/api/history/open_in_editor',
            targetMethods: ['open_in_editor', 'history_open_in_editor'],
            handler: async (api, ctx) => {
                const method = resolveNativeMethod(api, ['open_in_editor', 'history_open_in_editor']);
                if (!method) {
                    verifyNativeMethod(api, 'open_in_editor');
                }
                return await api[method](ctx.body);
            }
        },
        {
            id: 'history:open_containing_folder',
            method: 'POST',
            pattern: '/api/history/open_containing_folder',
            targetMethods: ['open_containing_folder', 'history_open_containing_folder'],
            handler: async (api, ctx) => {
                const method = resolveNativeMethod(api, ['open_containing_folder', 'history_open_containing_folder']);
                if (!method) {
                    verifyNativeMethod(api, 'open_containing_folder');
                }
                return await api[method](ctx.body.file_path);
            }
        },

        // =========================================================================
        // PostgreSQL Dependency Graph: /api/postgresql/dependency/
        // =========================================================================
        {
            id: 'postgres_dependency:column',
            method: 'GET',
            pattern: /^\/api\/postgresql\/dependency\/([^/]+)\/column$/,
            targetMethods: ['pg_dependency_get_column'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'pg_dependency_get_column');
                const connId = decodeURIComponent(ctx.match[1]);
                const s = ctx.searchParams;
                return await api.pg_dependency_get_column(
                    connId,
                    s.get('schema') || 'public',
                    s.get('table'),
                    s.get('column'),
                    s.get('direction') || 'dependents',
                    parseInt(s.get('depth') || '2', 10),
                    s.get('database'),
                    s.get('include_source') !== 'false'
                );
            }
        },
        {
            id: 'postgres_dependency:object',
            method: 'GET',
            pattern: /^\/api\/postgresql\/dependency\/([^/]+)\/object$/,
            targetMethods: ['pg_dependency_get_object'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'pg_dependency_get_object');
                const connId = decodeURIComponent(ctx.match[1]);
                const s = ctx.searchParams;
                return await api.pg_dependency_get_object(
                    connId,
                    s.get('type') || 'view',
                    s.get('schema') || 'public',
                    s.get('name'),
                    s.get('direction') || 'dependents',
                    parseInt(s.get('depth') || '2', 10),
                    s.get('database')
                );
            }
        },
        {
            id: 'postgres_dependency:definition',
            method: 'GET',
            pattern: /^\/api\/postgresql\/dependency\/([^/]+)\/definition$/,
            targetMethods: ['pg_dependency_get_definition'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'pg_dependency_get_definition');
                const connId = decodeURIComponent(ctx.match[1]);
                const s = ctx.searchParams;
                return await api.pg_dependency_get_definition(
                    connId,
                    s.get('type') || 'view',
                    s.get('schema') || 'public',
                    s.get('name'),
                    s.get('oid'),
                    s.get('database')
                );
            }
        },
        {
            id: 'postgres_dependency:suggested_steps',
            method: 'GET',
            pattern: /^\/api\/postgresql\/dependency\/([^/]+)\/suggested-steps$/,
            targetMethods: ['pg_dependency_get_suggested_steps'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'pg_dependency_get_suggested_steps');
                const connId = decodeURIComponent(ctx.match[1]);
                const s = ctx.searchParams;
                return await api.pg_dependency_get_suggested_steps(
                    connId,
                    s.get('schema') || 'public',
                    s.get('table'),
                    s.get('column'),
                    s.get('action') || 'ALTER',
                    s.get('database')
                );
            }
        },

        // =========================================================================
        // SQL Object Search & DDL
        // =========================================================================
        {
            id: 'sql_object:search',
            method: 'POST',
            pattern: '/api/sql/object-search',
            targetMethods: ['sql_object_search'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'sql_object_search');
                const b = ctx.body;
                const s = ctx.searchParams;
                return await api.sql_object_search(
                    b.connection_id || s.get('connection_id'),
                    b.keyword,
                    b.database || s.get('database'),
                    b.object_types,
                    b.case_sensitive,
                    b.whole_word,
                    b.is_regex,
                    b.schema || s.get('schema')
                );
            }
        },
        {
            id: 'sql_object:ddl',
            method: 'GET',
            pattern: '/api/sql/object-ddl',
            targetMethods: ['sql_object_ddl'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'sql_object_ddl');
                const s = ctx.searchParams;
                return await api.sql_object_ddl(
                    s.get('connection_id'),
                    s.get('schema') || 'dbo',
                    s.get('name'),
                    s.get('type') || 'VIEW',
                    s.get('database'),
                    s.get('keyword'),
                    s.get('case_sensitive') === 'true',
                    s.get('whole_word') === 'true',
                    s.get('is_regex') === 'true'
                );
            }
        },

        // =========================================================================
        // Activity & Blocking Locks Monitor
        // =========================================================================
        {
            id: 'activity:sessions',
            method: 'GET',
            pattern: '/api/activity/sessions',
            targetMethods: ['activity_get_sessions'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'activity_get_sessions');
                const s = ctx.searchParams;
                return await api.activity_get_sessions(
                    s.get('connection_id'),
                    s.get('database') || null,
                    s.get('active_only') === 'true'
                );
            }
        },
        {
            id: 'activity:cancel',
            method: 'POST',
            pattern: '/api/activity/cancel',
            targetMethods: ['activity_cancel_session'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'activity_cancel_session');
                return await api.activity_cancel_session(ctx.body.connection_id, ctx.body.session_id);
            }
        },
        {
            id: 'activity:kill',
            method: 'POST',
            pattern: '/api/activity/kill',
            targetMethods: ['activity_kill_session'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'activity_kill_session');
                return await api.activity_kill_session(ctx.body.connection_id, ctx.body.session_id);
            }
        },
        {
            id: 'activity:open_window',
            method: 'POST',
            pattern: '/api/activity/open-window',
            targetMethods: ['open_activity_monitor_window'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'open_activity_monitor_window');
                return await api.open_activity_monitor_window(ctx.body.connection_id, ctx.body.db_type);
            }
        },

        // =========================================================================
        // Desktop Exports & System
        // =========================================================================
        {
            id: 'grid:open_excel',
            method: 'POST',
            pattern: '/api/grid/open-excel',
            targetMethods: ['grid_open_in_excel'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'grid_open_in_excel');
                return await api.grid_open_in_excel(ctx.body.columns, ctx.body.rows);
            }
        },
        {
            id: 'grid:save_results',
            method: 'POST',
            pattern: '/api/grid/save-results',
            targetMethods: ['grid_save_results_as'],
            handler: async (api, ctx) => {
                verifyNativeMethod(api, 'grid_save_results_as');
                return await api.grid_save_results_as(ctx.body.columns, ctx.body.rows, ctx.body.defaultFilename);
            }
        },
        {
            id: 'system:fonts',
            method: 'GET',
            pattern: '/api/system/fonts',
            targetMethods: ['get_system_fonts'],
            handler: async (api) => {
                verifyNativeMethod(api, 'get_system_fonts');
                return await api.get_system_fonts();
            }
        },
        {
            id: 'system:logs_open',
            method: 'POST',
            pattern: '/api/system/logs/open',
            targetMethods: ['open_log_folder'],
            handler: async (api) => {
                verifyNativeMethod(api, 'open_log_folder');
                return await api.open_log_folder();
            }
        },
        {
            id: 'system:logs_info',
            method: 'GET',
            pattern: '/api/system/logs/info',
            targetMethods: ['get_log_info'],
            handler: async (api) => {
                verifyNativeMethod(api, 'get_log_info');
                return await api.get_log_info();
            }
        }
    ];

    // Expose ROUTE_DISPATCH_TABLE for testing and diagnostics
    global.ROUTE_DISPATCH_TABLE = ROUTE_DISPATCH_TABLE;

    /**
     * Matches a method and path against the route table.
     */
    function findMatchingRoute(method, path) {
        for (const entry of ROUTE_DISPATCH_TABLE) {
            if (entry.method !== '*' && entry.method !== method) {
                continue;
            }
            if (typeof entry.pattern === 'string') {
                if (entry.pattern === path) {
                    return { route: entry, match: [path] };
                }
            } else if (entry.pattern instanceof RegExp) {
                const match = path.match(entry.pattern);
                if (match) {
                    return { route: entry, match: match };
                }
            }
        }
        return null;
    }

    const originalFetch = global.fetch;

    global.fetch = async function (input, init = {}) {
        let url = typeof input === 'string' ? input : (input && input.url ? input.url : '');

        if (!url.startsWith('/api/') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
            return originalFetch ? originalFetch(input, init) : Promise.reject(new Error("No network"));
        }

        const api = await global.waitForPywebview();
        if (!api) {
            if (originalFetch) {
                return originalFetch(input, init);
            }
            console.error('[IPC] pywebview.api not ready for url:', url);
            return new Response(JSON.stringify({ success: false, error: "Native API bridge not ready" }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const method = (init.method || 'GET').toUpperCase();
        let body = {};
        if (init.body) {
            try {
                body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
            } catch (_) {
                body = {};
            }
        }

        const urlObj = new URL(url, 'http://localhost');
        const path = urlObj.pathname;
        const searchParams = urlObj.searchParams;

        let result = null;
        let statusCode = 200;

        try {
            const matched = findMatchingRoute(method, path);
            if (!matched) {
                console.warn('[IPC] Unhandled route:', method, path);
                result = { success: false, error: `Unhandled IPC route: ${path}`, notImplemented: true };
                statusCode = 501;
            } else {
                result = await matched.route.handler(api, {
                    path,
                    method,
                    body,
                    searchParams,
                    url,
                    match: matched.match
                });

                if (result && result.success === false && !path.includes('check-credential')) {
                    statusCode = 400;
                }
            }
        } catch (ipcErr) {
            console.error('[IPC] Bridge error for', path, ipcErr);
            const isNotImpl = Boolean(ipcErr && (ipcErr.notImplemented || ipcErr.status === 501));
            statusCode = isNotImpl ? 501 : 400;
            result = {
                success: false,
                error: (ipcErr && ipcErr.message) ? ipcErr.message : String(ipcErr),
                notImplemented: isNotImpl
            };
        }

        const resBody = JSON.stringify(result);
        return new Response(resBody, {
            status: statusCode,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    global.api = async function (url, options = {}) {
        const response = await global.fetch(url, {
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            throw new Error(data.error || "Request failed");
        }
        return data;
    };
})(typeof window !== 'undefined' ? window : globalThis);
