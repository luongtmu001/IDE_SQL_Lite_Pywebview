/**
 * api.js - Zero-Network Native IPC Bridge for pywebview.
 * Intercepts all fetch('/api/...') calls across the application
 * and routes them directly to window.pywebview.api without any TCP port!
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

        try {
            // === Connections Routes ===
            if (path === '/api/connections') {
                if (method === 'GET') {
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
                } else if (method === 'POST') {
                    result = await api.create_connection(body);
                }
            } else if (path.startsWith('/api/connections/')) {
                const sub = path.replace('/api/connections/', '');
                if (sub === 'fetch-metadata' && method === 'POST') {
                    result = await api.fetch_connection_metadata(body);
                } else if (sub === 'check-credential' && method === 'POST') {
                    result = await api.check_credential(body);
                } else if (sub === 'clear-credential' && method === 'POST') {
                    result = await api.clear_credential(body);
                } else if (sub.startsWith('password/')) {
                    const idOrName = decodeURIComponent(sub.replace('password/', ''));
                    result = await api.get_connection_password(idOrName);
                } else if (method === 'DELETE') {
                    result = await api.delete_connection(sub);
                }
            }

            // === Metadata Routes ===
            else if (path.startsWith('/api/metadata/')) {
                const parts = path.split('/').filter(Boolean);
                const connId = parts[2];
                const action = parts[3] || '';
                const subAction = parts[4] || '';

                if (action === 'databases') {
                    result = await api.get_databases(connId, searchParams.get('search'));
                } else if (action === 'schemas') {
                    result = await api.get_schemas(connId, searchParams.get('database'), searchParams.get('search'));
                } else if (action === 'objects') {
                    result = await api.get_objects(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('type') || 'tables', searchParams.get('search'));
                } else if (action === 'definition') {
                    result = await api.get_definition(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('name'), searchParams.get('type'));
                } else if (action === 'foreign_keys') {
                    result = await api.get_foreign_keys(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('table'));
                } else if (action === 'linked_servers') {
                    result = await api.get_linked_servers(connId);
                } else if (action === 'linked_server') {
                    const server = searchParams.get('server') || body.server;
                    if (subAction === 'databases') {
                        result = await api.get_remote_databases(connId, server);
                    } else if (subAction === 'schemas') {
                        result = await api.get_remote_schemas(connId, server, searchParams.get('database'));
                    } else if (subAction === 'objects') {
                        result = await api.get_remote_objects(connId, server, searchParams.get('database'), searchParams.get('schema'));
                    } else if (subAction === 'columns') {
                        result = await api.get_remote_columns(connId, server, searchParams.get('database'), searchParams.get('schema'), searchParams.get('table'));
                    } else if (subAction === 'test') {
                        result = await api.test_linked_server(connId, server);
                    } else if (subAction === 'script') {
                        result = await api.get_linked_server_script(connId, server, searchParams.get('mode') || 'create');
                    } else if (subAction === 'drop') {
                        result = await api.drop_linked_server(connId, server);
                    }
                } else if (action === 'foreign_servers') {
                    result = await api.get_foreign_servers(connId);
                } else if (action === 'foreign_tables') {
                    result = await api.get_foreign_tables(connId, searchParams.get('schema'));
                } else if (action === 'object_children') {
                    result = await api.get_object_children(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('name'), searchParams.get('type'), searchParams.get('child_type'));
                } else if (action === 'table-design') {
                    if (!subAction) {
                        result = await api.get_table_design(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('table'));
                    } else if (subAction === 'types') {
                        result = await api.get_table_design_types(connId, searchParams.get('database'));
                    } else if (subAction === 'preview') {
                        result = await api.preview_table_design(connId, body);
                    } else if (subAction === 'diff') {
                        result = await api.diff_table_design(connId, body.original, body.modified);
                    } else if (subAction === 'apply') {
                        result = await api.apply_table_design(connId, body.database, body.statements, body.migration_sql);
                    }
                } else if (action === 'intellisense') {
                    if (subAction === 'objects') {
                        result = await api.get_intellisense_objects(connId, searchParams.get('database'), searchParams.get('schema'));
                    } else if (subAction === 'columns') {
                        result = await api.get_intellisense_columns(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('table'));
                    } else if (subAction === 'parameters') {
                        result = await api.get_intellisense_parameters(connId, searchParams.get('database'), searchParams.get('schema'), searchParams.get('name'));
                    } else if (subAction === 'types') {
                        result = await api.get_intellisense_types(connId, searchParams.get('database'));
                    }
                }
            }

            // === Table Data Editor Routes ===
            else if (path.startsWith('/api/table-data-editor/')) {
                const sub = path.replace('/api/table-data-editor/', '');
                if (sub === 'metadata') {
                    result = await api.get_table_editor_metadata(searchParams.get('conn_id'), searchParams.get('database'), searchParams.get('schema'), searchParams.get('table'));
                } else if (sub === 'fetch' && method === 'POST') {
                    result = await api.fetch_table_data(body.conn_id, body.database, body.schema, body.table, body.select_cols, body.criteria, body.top_n, body.custom_sql);
                } else if (sub === 'update' && method === 'POST') {
                    result = await api.update_table_row(body.conn_id, body.database, body.schema, body.table, body.pk_conditions, body.changes);
                } else if (sub === 'delete' && method === 'POST') {
                    result = await api.delete_table_row(body.conn_id, body.database, body.schema, body.table, body.pk_conditions);
                } else if (sub === 'insert' && method === 'POST') {
                    result = await api.insert_table_row(body.conn_id, body.database, body.schema, body.table, body.values, body.identity_columns, body.computed_columns);
                } else if ((sub === 'submit-changes' || sub === 'submit_changes') && method === 'POST') {
                    result = await api.submit_table_changes(body.conn_id, body.database, body.schema, body.table, body.changes, body.concurrency_mode);
                } else if (sub === 'validate-rows' && method === 'POST') {
                    result = await api.validate_table_rows(body.conn_id, body.database, body.schema, body.table, body.rows);
                } else if (sub === 'validate-row' && method === 'POST') {
                    result = await api.validate_table_row(body.conn_id, body.database, body.schema, body.table, body.values, body.keys, body.is_new !== false, body.target_column);
                }
            }

            // === Query Routes ===
            else if (path === '/api/query/execute' && method === 'POST') {
                result = await api.execute_query(
                    body.connection_id,
                    body.sql,
                    body.limit,
                    body.database,
                    body.schema,
                    body.query_id,
                    body.mode,
                    body.debug_session_id,
                    body.traces,
                    body.confirmed,
                    body.parameters,
                    body.stop_on_error !== undefined ? body.stop_on_error : true
                );
            } else if (path === '/api/query/parse-parameters' && method === 'POST') {
                result = typeof api.parse_query_parameters === 'function'
                    ? await api.parse_query_parameters(body.sql, body.dialect)
                    : { success: false, error: 'parse_query_parameters not supported' };
            } else if (path === '/api/query/cancel' && method === 'POST') {
                result = await api.cancel_query(body.connection_id);
            } else if (path === '/api/query/explain' && method === 'POST') {
                result = await api.explain_query(body.connection_id, body.sql, body.database);
            } else if (path === '/api/query/syntax-check' && method === 'POST') {
                result = await api.syntax_check(body.connection_id, body.sql, body.dialect, body.database, body.schema, body.is_debug, body.cached_tables);
            }

            // === Explicit Transaction Routes ===
            else if (path === '/api/tx/begin' && method === 'POST') {
                result = typeof api.tx_begin === 'function'
                    ? await api.tx_begin(body.connection_id)
                    : { success: false, error: 'tx_begin not supported by native api' };
            } else if (path === '/api/tx/commit' && method === 'POST') {
                result = typeof api.tx_commit === 'function'
                    ? await api.tx_commit(body.connection_id)
                    : { success: false, error: 'tx_commit not supported by native api' };
            } else if (path === '/api/tx/rollback' && method === 'POST') {
                result = typeof api.tx_rollback === 'function'
                    ? await api.tx_rollback(body.connection_id)
                    : { success: false, error: 'tx_rollback not supported by native api' };
            } else if (path === '/api/tx/status' && (method === 'GET' || method === 'POST')) {
                const connId = body.connection_id || searchParams.get('connection_id');
                result = typeof api.tx_status === 'function'
                    ? await api.tx_status(connId)
                    : { success: false, error: 'tx_status not supported by native api' };
            } else if (path === '/api/connection/set_read_only' && method === 'POST') {
                result = typeof api.set_connection_read_only === 'function'
                    ? await api.set_connection_read_only(body.connection_id, body.read_only)
                    : { success: false, error: 'set_connection_read_only not supported by native api' };
            }

            // === Profiler Routes ===
            else if (path.startsWith('/api/profiler/')) {
                const pAction = path.replace('/api/profiler/', '');
                if (pAction === 'connections') {
                    result = await api.profiler_list_connections();
                } else if (pAction === 'open-window' && method === 'POST') {
                    result = await api.open_profiler_window(body.connection_id, body.db_type);
                } else if (pAction === 'start' && method === 'POST') {
                    result = await api.profiler_start_trace(body.connection_id, body.config);
                } else if (pAction === 'pause' && method === 'POST') {
                    result = await api.profiler_pause_trace(body.session_id);
                } else if (pAction === 'resume' && method === 'POST') {
                    result = await api.profiler_resume_trace(body.session_id);
                } else if (pAction === 'stop' && method === 'POST') {
                    result = await api.profiler_stop_trace(body.session_id);
                } else if (pAction.startsWith('status/')) {
                    const sid = pAction.replace('status/', '');
                    result = await api.profiler_get_status(sid);
                }
            }

            // === Bravo Tool Routes ===
            else if (path.startsWith('/api/bravo/')) {
                const bAction = path.replace('/api/bravo/', '');
                if (bAction === 'config') {
                    result = await api.get_config();
                } else if (bAction === 'open-window' && method === 'POST') {
                    const cId = body.connection_id || searchParams.get('connection_id');
                    const cName = body.connection_name || searchParams.get('connection_name');
                    const cDb = body.database || searchParams.get('database');
                    const cType = body.db_type || searchParams.get('db_type');
                    const cSchema = body.schema || searchParams.get('schema');
                    result = await api.open_bravo_window(cId, cName, cDb, cType, cSchema);
                } else if (bAction === 'initial-context') {
                    result = typeof api.get_initial_context === 'function' ? await api.get_initial_context() : { success: true, context: {} };
                } else if (bAction === 'set-title' && method === 'POST') {
                    result = typeof api.set_window_title === 'function' ? await api.set_window_title(body.title) : { success: true };
                } else if (bAction === 'features') {
                    result = await api.list_features();
                } else if (bAction === 'connections') {
                    result = await api.list_connections();
                } else if (bAction === 'session' && method === 'POST') {
                    result = await api.create_session(body, body.connection_id, body.window_id);
                } else if (bAction.startsWith('session/') && method === 'DELETE') {
                    const sid = bAction.replace('session/', '');
                    result = await api.destroy_session(sid);
                } else if (bAction.startsWith('session/') && method === 'GET') {
                    const sid = bAction.replace('session/', '');
                    result = await api.get_session(sid);
                } else if (bAction === 'layout-editor/list') {
                    result = await api.layout_editor_list(body.connection_id, body.database, body.platform, body.version, body.custom_where);
                } else if (bAction === 'layout-editor/payload') {
                    result = await api.layout_editor_payload(body.connection_id, body.id, body.database, body.platform, body.version);
                } else if (bAction === 'layout-editor/commit') {
                    result = await api.layout_editor_commit(body.connection_id, body.forms, body.database, body.platform, body.version);
                } else if (bAction === 'layout-editor/search-xml') {
                    result = await api.layout_editor_search_xml(body.connection_id, body.keyword, body.form_ids, body.database, body.platform, body.version, body.is_regex);
                }
            }

            // === Query History Routes (Phase 2 & Phase 3) ===
            else if (path.startsWith('/api/history/')) {
                const hAction = path.replace('/api/history/', '');
                if (hAction === 'log_execution' && method === 'POST') {
                    result = await api.history_log_execution(body);
                } else if (hAction === 'update_execution' && method === 'POST') {
                    result = await api.history_update_execution(body);
                } else if (hAction === 'update_document' && method === 'POST') {
                    result = await api.history_update_document(body);
                } else if (hAction === 'document_by_path' && method === 'GET') {
                    result = await api.history_get_document_by_path(searchParams.get('path'));
                } else if (hAction === 'documents' && method === 'GET') {
                    result = await api.history_get_documents(
                        searchParams.get('search'),
                        searchParams.get('favorites_only') === 'true',
                        searchParams.get('limit') ? parseInt(searchParams.get('limit'), 10) : 200,
                        searchParams.get('server'),
                        searchParams.get('database'),
                        searchParams.get('from_timestamp') ? parseInt(searchParams.get('from_timestamp'), 10) : null,
                        searchParams.get('to_timestamp') ? parseInt(searchParams.get('to_timestamp'), 10) : null
                    );
                } else if (hAction.startsWith('document/') && method === 'GET') {
                    const docId = hAction.replace('document/', '');
                    result = await api.history_get_document(docId);
                } else if (hAction.startsWith('document/') && method === 'DELETE') {
                    const docId = hAction.replace('document/', '');
                    result = await api.history_delete_document(docId);
                } else if (hAction === 'entries' && method === 'GET') {
                    result = await api.history_get_entries(
                        searchParams.get('doc_id'),
                        searchParams.get('status') ? parseInt(searchParams.get('status'), 10) : null,
                        searchParams.get('limit') ? parseInt(searchParams.get('limit'), 10) : 200,
                        searchParams.get('server'),
                        searchParams.get('database'),
                        searchParams.get('from_timestamp') ? parseInt(searchParams.get('from_timestamp'), 10) : null,
                        searchParams.get('to_timestamp') ? parseInt(searchParams.get('to_timestamp'), 10) : null,
                        searchParams.get('tag'),
                        searchParams.get('entry_type') ? parseInt(searchParams.get('entry_type'), 10) : null
                    );
                } else if (hAction.startsWith('entry/') && hAction.endsWith('/note') && method === 'POST') {
                    const entryId = parseInt(hAction.replace('entry/', '').replace('/note', ''), 10);
                    result = await api.history_update_entry_note(entryId, body.note, body.tag);
                } else if (hAction.startsWith('entry/') && method === 'GET') {
                    const entryId = parseInt(hAction.replace('entry/', ''), 10);
                    result = await api.history_get_entry_detail(entryId);
                } else if (hAction.startsWith('entry/') && method === 'DELETE') {
                    const entryId = parseInt(hAction.replace('entry/', ''), 10);
                    result = await api.history_delete_entry(entryId);
                } else if (hAction === 'filters' && method === 'GET') {
                    result = typeof api.history_get_filters === 'function' ? await api.history_get_filters() : { success: false, filters: { servers: [], databases: [], tags: [] } };
                } else if (hAction === 'export' && method === 'POST') {
                    result = typeof api.history_export === 'function' ? await api.history_export(body) : { success: false, error: 'Not supported' };
                } else if (hAction === 'import' && method === 'POST') {
                    result = typeof api.history_import === 'function' ? await api.history_import(body) : { success: false, error: 'Not supported' };
                } else if (hAction === 'active_editor_content' && method === 'GET') {
                    result = typeof api.get_active_editor_content === 'function' ? await api.get_active_editor_content() : (typeof api.history_get_active_editor_content === 'function' ? await api.history_get_active_editor_content() : { success: false, content: '' });
                } else if (hAction === 'open_diff_in_editor' && method === 'POST') {
                    result = typeof api.open_diff_in_editor === 'function' ? await api.open_diff_in_editor(body) : (typeof api.history_open_diff_in_editor === 'function' ? await api.history_open_diff_in_editor(body) : { success: false, error: 'Not supported' });
                } else if (hAction === 'toggle_star' && method === 'POST') {
                    result = await api.history_toggle_star(body.doc_id, body.is_starred);
                } else if (hAction === 'purge' && method === 'POST') {
                    result = await api.history_purge(body.max_age_days, body.max_entries_per_doc, body.max_db_size_mb);
                } else if (hAction === 'compact' && method === 'POST') {
                    result = typeof api.history_compact === 'function' ? await api.history_compact() : { success: false, error: 'Not supported' };
                } else if (hAction === 'clear_all' && method === 'POST') {
                    result = typeof api.history_clear_all === 'function' ? await api.history_clear_all(body.keep_favorites) : { success: false, error: 'Not supported' };
                } else if (hAction === 'stats' && method === 'GET') {
                    result = await api.history_get_stats();
                } else if (hAction === 'open-window' && method === 'POST') {
                    result = typeof api.open_query_history_window === 'function' ? await api.open_query_history_window() : { success: false, error: 'Not supported' };
                } else if (hAction === 'open_in_editor' && method === 'POST') {
                    result = typeof api.open_in_editor === 'function' ? await api.open_in_editor(body) : (typeof api.history_open_in_editor === 'function' ? await api.history_open_in_editor(body) : { success: false, error: 'Not supported' });
                } else if (hAction === 'open_containing_folder' && method === 'POST') {
                    result = typeof api.open_containing_folder === 'function' ? await api.open_containing_folder(body.file_path) : (typeof api.history_open_containing_folder === 'function' ? await api.history_open_containing_folder(body.file_path) : { success: false, error: 'Not supported' });
                }
            }

            // === PostgreSQL Dependency Graph Routes ===
            else if (path.startsWith('/api/postgresql/dependency/')) {
                const parts = path.split('/').filter(Boolean);
                // URL: /api/postgresql/dependency/<connId>/<action>
                const connId = decodeURIComponent(parts[3] || '');
                const action = parts[4] || '';

                if (action === 'column') {
                    result = typeof api.pg_dependency_get_column === 'function'
                        ? await api.pg_dependency_get_column(
                            connId,
                            searchParams.get('schema') || 'public',
                            searchParams.get('table'),
                            searchParams.get('column'),
                            searchParams.get('direction') || 'dependents',
                            parseInt(searchParams.get('depth') || '2', 10),
                            searchParams.get('database'),
                            searchParams.get('include_source') !== 'false'
                        )
                        : { success: false, error: 'Native method pg_dependency_get_column not available' };
                } else if (action === 'object') {
                    result = typeof api.pg_dependency_get_object === 'function'
                        ? await api.pg_dependency_get_object(
                            connId,
                            searchParams.get('type') || 'view',
                            searchParams.get('schema') || 'public',
                            searchParams.get('name'),
                            searchParams.get('direction') || 'dependents',
                            parseInt(searchParams.get('depth') || '2', 10),
                            searchParams.get('database')
                        )
                        : { success: false, error: 'Native method pg_dependency_get_object not available' };
                } else if (action === 'definition') {
                    result = typeof api.pg_dependency_get_definition === 'function'
                        ? await api.pg_dependency_get_definition(
                            connId,
                            searchParams.get('type') || 'view',
                            searchParams.get('schema') || 'public',
                            searchParams.get('name'),
                            searchParams.get('oid'),
                            searchParams.get('database')
                        )
                        : { success: false, error: 'Native method pg_dependency_get_definition not available' };
                } else if (action === 'suggested-steps') {
                    result = typeof api.pg_dependency_get_suggested_steps === 'function'
                        ? await api.pg_dependency_get_suggested_steps(
                            connId,
                            searchParams.get('schema') || 'public',
                            searchParams.get('table'),
                            searchParams.get('column'),
                            searchParams.get('action') || 'ALTER',
                            searchParams.get('database')
                        )
                        : { success: false, error: 'Native method pg_dependency_get_suggested_steps not available' };
                }
            }

            // === Object Content Search Routes ===
            else if (path === '/api/sql/object-search' && method === 'POST') {
                result = typeof api.sql_object_search === 'function'
                    ? await api.sql_object_search(
                        body.connection_id || searchParams.get('connection_id'),
                        body.keyword,
                        body.database || searchParams.get('database'),
                        body.object_types,
                        body.case_sensitive,
                        body.whole_word,
                        body.is_regex,
                        body.schema || searchParams.get('schema')
                    )
                    : { success: false, error: 'Native method sql_object_search not available' };
            } else if (path === '/api/sql/object-ddl' && method === 'GET') {
                result = typeof api.sql_object_ddl === 'function'
                    ? await api.sql_object_ddl(
                        searchParams.get('connection_id'),
                        searchParams.get('schema') || 'dbo',
                        searchParams.get('name'),
                        searchParams.get('type') || 'VIEW',
                        searchParams.get('database'),
                        searchParams.get('keyword'),
                        searchParams.get('case_sensitive') === 'true',
                        searchParams.get('whole_word') === 'true',
                        searchParams.get('is_regex') === 'true'
                    )
                    : { success: false, error: 'Native method sql_object_ddl not available' };
            }

            // === Grid Export Routes ===
            else if (path === '/api/grid/open-excel' && method === 'POST') {
                result = await api.grid_open_in_excel(body.columns, body.rows);
            } else if (path === '/api/grid/save-results' && method === 'POST') {
                result = await api.grid_save_results_as(body.columns, body.rows, body.defaultFilename);
            }

            // === System Fonts Route ===
            else if (path === '/api/system/fonts' && method === 'GET') {
                if (typeof api.get_system_fonts === 'function') {
                    result = await api.get_system_fonts();
                } else {
                    result = { success: false, error: 'get_system_fonts not supported by native api' };
                }
            }

            // === System Logs Routes ===
            else if (path === '/api/system/logs/open' && method === 'POST') {
                if (typeof api.open_log_folder === 'function') {
                    result = await api.open_log_folder();
                } else {
                    result = { success: false, error: 'open_log_folder not supported by native api' };
                }
            } else if (path === '/api/system/logs/info' && method === 'GET') {
                if (typeof api.get_log_info === 'function') {
                    result = await api.get_log_info();
                } else {
                    result = { success: false, error: 'get_log_info not supported by native api' };
                }
            }
        } catch (ipcErr) {
            console.error('[IPC] Bridge error for', path, ipcErr);
            result = { success: false, error: String(ipcErr) };
        }

        if (result === null) {
            console.warn('[IPC] Unhandled route:', method, path);
            result = { success: false, error: `Unhandled IPC route: ${path}` };
        }

        const resBody = JSON.stringify(result);
        const status = (result && result.success === false && !path.includes('check-credential')) ? 400 : 200;

        return new Response(resBody, {
            status: status,
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
})(window);
