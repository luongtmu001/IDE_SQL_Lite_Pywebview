/**
 * object-search-store.js
 * State Management & Session Cache for Object Content Search.
 */
(function (global) {
    'use strict';

    class ObjectSearchStore {
        constructor() {
            this.state = {
                connectionId: null,
                connectionName: '',
                database: null,
                schema: null,
                dbType: 'sqlserver',

                keyword: '',
                objectTypes: ['VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER'],
                caseSensitive: false,
                wholeWord: false,
                isRegex: false,

                // Results from search
                results: [],
                filterText: '',
                sortBy: 'default', // 'default', 'name', 'count'
                pinnedObjects: new Set(),

                // Currently selected object
                selectedObject: null,
                ddl: null,
                matches: [],
                activeMatchIndex: -1,

                // Loading & Error states
                isSearching: false,
                isLoadingDdl: false,
                error: null,
                ddlError: null,

                // Panel state
                matchPanelCollapsed: false,

                // History
                searchHistory: []
            };

            this.listeners = new Set();
            this.cache = new Map(); // runtime session cache
        }

        subscribe(listener) {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }

        notify(changeType, payload) {
            for (const listener of this.listeners) {
                try {
                    listener(this.state, changeType, payload);
                } catch (e) {
                    console.error('[ObjectSearchStore] Listener error:', e);
                }
            }
        }

        setScope(connectionId, connectionName, database, schema = null, dbType = 'sqlserver') {
            this.state.connectionId = connectionId;
            this.state.connectionName = connectionName || '';
            this.state.database = database;
            this.state.schema = schema || null;
            this.state.dbType = dbType || 'sqlserver';
            this.notify('scope_changed');
        }

        getCacheKey() {
            return [
                this.state.connectionId || '',
                this.state.database || '',
                this.state.schema || '',
                this.state.keyword,
                this.state.caseSensitive,
                this.state.wholeWord,
                this.state.isRegex
            ].join('::');
        }

        addToHistory(keyword) {
            if (!keyword || !keyword.trim()) return;
            const kw = keyword.trim();
            this.state.searchHistory = this.state.searchHistory.filter(k => k !== kw);
            this.state.searchHistory.unshift(kw);
            if (this.state.searchHistory.length > 20) {
                this.state.searchHistory.pop();
            }
            this.notify('history_updated');
        }

        setSearching(isSearching) {
            this.state.isSearching = isSearching;
            if (isSearching) {
                this.state.error = null;
            }
            this.notify('searching_changed', isSearching);
        }

        setResults(results, error = null) {
            this.state.results = results || [];
            this.state.error = error;
            this.state.isSearching = false;
            this.state.selectedObject = null;
            this.state.ddl = null;
            this.state.matches = [];
            this.state.activeMatchIndex = -1;
            this.notify('results_updated', { results: this.state.results, error });
        }

        togglePin(schema, name) {
            const key = `${schema}.${name}`.toLowerCase();
            if (this.state.pinnedObjects.has(key)) {
                this.state.pinnedObjects.delete(key);
            } else {
                this.state.pinnedObjects.add(key);
            }
            this.notify('pinned_changed');
        }

        isPinned(schema, name) {
            return this.state.pinnedObjects.has(`${schema}.${name}`.toLowerCase());
        }

        getFilteredResults() {
            let list = this.state.results.slice();

            // Filter by active object types
            const activeTypes = new Set(this.state.objectTypes.map(t => t.toUpperCase()));
            list = list.filter(item => activeTypes.has((item.type || '').toUpperCase()));

            // Filter by in-list search text
            if (this.state.filterText && this.state.filterText.trim()) {
                const q = this.state.filterText.trim().toLowerCase();
                list = list.filter(item => 
                    (item.name || '').toLowerCase().includes(q) ||
                    (item.schema || '').toLowerCase().includes(q)
                );
            }

            // Sort
            if (this.state.sortBy === 'name') {
                list.sort((a, b) => a.name.localeCompare(b.name));
            } else if (this.state.sortBy === 'count') {
                list.sort((a, b) => (b.match_count || 0) - (a.match_count || 0));
            } else {
                // Default: Pinned first -> Type order -> Schema -> Name
                const typeOrder = { 'VIEW': 1, 'PROCEDURE': 2, 'FUNCTION': 3, 'TRIGGER': 4 };
                list.sort((a, b) => {
                    const aPinned = this.isPinned(a.schema, a.name) ? 0 : 1;
                    const bPinned = this.isPinned(b.schema, b.name) ? 0 : 1;
                    if (aPinned !== bPinned) return aPinned - bPinned;

                    const tA = typeOrder[a.type] || 99;
                    const tB = typeOrder[b.type] || 99;
                    if (tA !== tB) return tA - tB;

                    const sComp = (a.schema || '').localeCompare(b.schema || '');
                    if (sComp !== 0) return sComp;
                    return (a.name || '').localeCompare(b.name || '');
                });
            }

            return list;
        }

        setLoadingDdl(isLoading) {
            this.state.isLoadingDdl = isLoading;
            this.notify('loading_ddl_changed', isLoading);
        }

        setSelectedObject(obj, ddlData = null, error = null) {
            this.state.selectedObject = obj;
            this.state.isLoadingDdl = false;
            this.state.ddlError = error;

            if (ddlData) {
                this.state.ddl = ddlData.ddl;
                this.state.matches = ddlData.matches || [];
                this.state.activeMatchIndex = this.state.matches.length > 0 ? 0 : -1;
            } else {
                this.state.ddl = null;
                this.state.matches = [];
                this.state.activeMatchIndex = -1;
            }

            this.notify('selected_object_changed', { obj, ddlData, error });
        }

        setActiveMatchIndex(index) {
            if (this.state.matches.length === 0) {
                this.state.activeMatchIndex = -1;
            } else {
                const total = this.state.matches.length;
                this.state.activeMatchIndex = ((index % total) + total) % total;
            }
            this.notify('active_match_changed', this.state.activeMatchIndex);
        }

        nextMatch() {
            if (this.state.matches.length === 0) return;
            this.setActiveMatchIndex(this.state.activeMatchIndex + 1);
        }

        prevMatch() {
            if (this.state.matches.length === 0) return;
            this.setActiveMatchIndex(this.state.activeMatchIndex - 1);
        }

        toggleMatchPanel() {
            this.state.matchPanelCollapsed = !this.state.matchPanelCollapsed;
            this.notify('match_panel_toggled', this.state.matchPanelCollapsed);
        }
    }

    global.ObjectSearchStore = ObjectSearchStore;
})(window);
