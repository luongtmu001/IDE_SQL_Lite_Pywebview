/**
 * api.js - Zero-Network Native IPC Bridge for pywebview.
 * Intercepts all fetch('/api/...') calls across the application
 * and routes them directly to window.pywebview.api without any TCP port!
 */
(function (global) {
    'use strict';

    global.waitForPywebview = function () {
        return new Promise((resolve) => {
            if (window.pywebview && window.pywebview.api) {
                resolve(window.pywebview.api);
            } else {
                const onReady = () => {
                    window.removeEventListener('pywebviewready', onReady);
                    resolve(window.pywebview.api);
                };
                window.addEventListener('pywebviewready', onReady);
                setTimeout(() => resolve(window.pywebview?.api || null), 2000);
            }
        });
    };

    const originalFetch = global.fetch;

    global.fetch = async function (input, init = {}) {
        let url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        
        if (!url.startsWith('/api/') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
            return originalFetch ? originalFetch(input, init) : Promise.reject(new Error("No network"));
        }

        const api = await global.waitForPywebview();
        if (!api) {
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
                    result = await api.list_connections();
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
                result = await api.execute_query(body.connection_id, body.sql, body.limit, body.database, body.schema);
            } else if (path === '/api/query/explain' && method === 'POST') {
                result = await api.explain_query(body.connection_id, body.sql, body.database);
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
