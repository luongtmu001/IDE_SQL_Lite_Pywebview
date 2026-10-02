/**
 * metadata-provider.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4 — Metadata Adapter (Sections 15, 16, 17 & 66)
 *
 * Implements standard MetadataProvider abstraction for IntelliSense without
 * duplicating any backend metadata implementations. Adapts existing project
 * endpoints (/api/metadata/...) cleanly with dialect-specific extensions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (window) {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. BASE METADATA PROVIDER (Section 15 Contract)
    // ─────────────────────────────────────────────────────────────────────────────
    class MetadataProvider {
        constructor(dbType = 'generic') {
            this.dbType = dbType;
        }

        async getDatabases(connectionId) {
            throw new Error('[MetadataProvider] getDatabases must be implemented by subclass');
        }

        async getSchemas(connectionId, database) {
            throw new Error('[MetadataProvider] getSchemas must be implemented by subclass');
        }

        async getTables(connectionId, database, schema) {
            const objs = await this.getObjects(connectionId, database, schema, 'table');
            return objs.filter(o => o.type === 'table');
        }

        async getViews(connectionId, database, schema) {
            const objs = await this.getObjects(connectionId, database, schema, 'view');
            return objs.filter(o => o.type === 'view');
        }

        async getColumns(connectionId, database, schema, table) {
            throw new Error('[MetadataProvider] getColumns must be implemented by subclass');
        }

        async getProcedures(connectionId, database, schema) {
            const objs = await this.getObjects(connectionId, database, schema, 'procedure');
            return objs.filter(o => o.type === 'procedure');
        }

        async getFunctions(connectionId, database, schema) {
            const objs = await this.getObjects(connectionId, database, schema, 'function');
            return objs.filter(o => o.type === 'function');
        }

        async getSynonyms(connectionId, database, schema) {
            const objs = await this.getObjects(connectionId, database, schema, 'synonym');
            return objs.filter(o => o.type === 'synonym');
        }

        async getParameters(connectionId, database, schema, name) {
            throw new Error('[MetadataProvider] getParameters must be implemented by subclass');
        }

        async getDefinition(connectionId, database, schema, name, type) {
            throw new Error('[MetadataProvider] getDefinition must be implemented by subclass');
        }

        async getSupportedTypes(connectionId, database) {
            throw new Error('[MetadataProvider] getSupportedTypes must be implemented by subclass');
        }

        async getObjects(connectionId, database, schema) {
            throw new Error('[MetadataProvider] getObjects must be implemented by subclass');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. PROJECT METADATA ADAPTER (Adapts Existing Backend Endpoints)
    // ─────────────────────────────────────────────────────────────────────────────
    class ProjectMetadataAdapter extends MetadataProvider {
        constructor(dbType = 'generic') {
            super(dbType);
        }

        async _fetchJson(url) {
            try {
                const res = await fetch(url);
                if (!res.ok) return null;
                const data = await res.json();
                return data && data.success ? data : null;
            } catch (err) {
                console.warn(`[MetadataAdapter] Error fetching ${url}:`, err);
                return null;
            }
        }

        async getDatabases(connectionId) {
            if (!connectionId) return [];
            const data = await this._fetchJson(`/api/metadata/${connectionId}/databases`);
            return data && Array.isArray(data.databases) ? data.databases : [];
        }

        async getSchemas(connectionId, database) {
            if (!connectionId) return [];
            const q = database ? `?database=${encodeURIComponent(database)}` : '';
            const data = await this._fetchJson(`/api/metadata/${connectionId}/schemas${q}`);
            return data && Array.isArray(data.schemas) ? data.schemas : [];
        }

        async getObjects(connectionId, database, schema) {
            if (!connectionId) return [];
            const params = new URLSearchParams();
            if (database) params.append('database', database);
            if (schema) params.append('schema', schema);
            const q = params.toString() ? `?${params.toString()}` : '';
            const data = await this._fetchJson(`/api/metadata/${connectionId}/intellisense/objects${q}`);
            return data && Array.isArray(data.items) ? data.items : [];
        }

        async getColumns(connectionId, database, schema, table) {
            if (!connectionId || !table) return [];
            const params = new URLSearchParams();
            if (database) params.append('database', database);
            if (schema) params.append('schema', schema);
            params.append('table', table);
            const q = `?${params.toString()}`;
            const data = await this._fetchJson(`/api/metadata/${connectionId}/intellisense/columns${q}`);
            return data && Array.isArray(data.items) ? data.items : [];
        }

        async getParameters(connectionId, database, schema, name) {
            if (!connectionId || !name) return [];
            const params = new URLSearchParams();
            if (database) params.append('database', database);
            if (schema) params.append('schema', schema);
            params.append('name', name);
            const q = `?${params.toString()}`;
            const data = await this._fetchJson(`/api/metadata/${connectionId}/intellisense/parameters${q}`);
            return data && Array.isArray(data.items) ? data.items : [];
        }

        async getDefinition(connectionId, database, schema, name, type) {
            if (!connectionId || !name) return '';
            const params = new URLSearchParams();
            if (database) params.append('database', database);
            if (schema) params.append('schema', schema);
            params.append('name', name);
            if (type) params.append('type', type);
            const q = `?${params.toString()}`;
            const data = await this._fetchJson(`/api/metadata/${connectionId}/definition${q}`);
            return data && data.definition ? data.definition : '';
        }

        async getSupportedTypes(connectionId, database) {
            if (!connectionId) return [];
            const params = new URLSearchParams();
            if (database) params.append('database', database);
            const q = params.toString() ? `?${params.toString()}` : '';
            const data = await this._fetchJson(`/api/metadata/${connectionId}/intellisense/types${q}`);
            return data && Array.isArray(data.items) ? data.items : [];
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. DIALECT SPECIFIC PROVIDERS (Sections 16 & 17)
    // ─────────────────────────────────────────────────────────────────────────────
    class SqlServerMetadataProvider extends ProjectMetadataAdapter {
        constructor() {
            super('sqlserver');
        }

        cleanIdentifier(ident) {
            if (!ident) return '';
            const s = String(ident).trim();
            if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1);
            return s;
        }

        quoteIdentifier(ident) {
            if (!ident) return '';
            const clean = this.cleanIdentifier(ident);
            return `[${clean}]`;
        }

        async getColumns(connectionId, database, schema, table) {
            const cleanTable = this.cleanIdentifier(table);
            const cleanSchema = this.cleanIdentifier(schema);
            return super.getColumns(connectionId, database, cleanSchema, cleanTable);
        }
    }

    class PostgresMetadataProvider extends ProjectMetadataAdapter {
        constructor() {
            super('postgresql');
        }

        cleanIdentifier(ident) {
            if (!ident) return '';
            const s = String(ident).trim();
            if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
            return s;
        }

        quoteIdentifier(ident) {
            if (!ident) return '';
            const clean = this.cleanIdentifier(ident);
            return `"${clean}"`;
        }

        async getColumns(connectionId, database, schema, table) {
            const cleanTable = this.cleanIdentifier(table);
            // Default PostgreSQL schema to 'public' if not specified
            const cleanSchema = this.cleanIdentifier(schema) || 'public';
            return super.getColumns(connectionId, database, cleanSchema, cleanTable);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. METADATA PROVIDER FACTORY (Dialect Resolution by connectionId)
    // ─────────────────────────────────────────────────────────────────────────────
    class MetadataProviderFactory {
        static _instances = new Map();
        static _connectionDbTypes = new Map();

        /**
         * Register the database type associated with a specific connectionId
         * @param {string|number} connectionId
         * @param {string} dbType ('sqlserver', 'postgresql', 'sqlite', etc.)
         */
        static registerConnection(connectionId, dbType) {
            if (!connectionId) return;
            this._connectionDbTypes.set(String(connectionId), (dbType || 'generic').toLowerCase());
        }

        /**
         * Detect the database type for a given connectionId
         * @param {string|number} connectionId
         * @returns {string} dbType
         */
        static getDbTypeForConnection(connectionId) {
            if (!connectionId) return 'generic';
            const strId = String(connectionId);
            if (this._connectionDbTypes.has(strId)) {
                return this._connectionDbTypes.get(strId);
            }

            // Inspect active tab state
            if (window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function') {
                const st = window.AppTabs.getActiveTabState();
                if (st && String(st.connectionId) === strId && st.dbType) {
                    const dt = st.dbType.toLowerCase();
                    this._connectionDbTypes.set(strId, dt);
                    return dt;
                }
            }

            // Inspect global active connection state
            if (window.ActiveConnectionId && String(window.ActiveConnectionId) === strId && window.ActiveDbType) {
                const dt = window.ActiveDbType.toLowerCase();
                this._connectionDbTypes.set(strId, dt);
                return dt;
            }

            // Default fallback
            return 'sqlserver';
        }

        /**
         * Get singleton provider by dbType
         * @param {string} dbType
         * @returns {MetadataProvider}
         */
        static getProvider(dbType = 'generic') {
            const normalized = (dbType || 'generic').toLowerCase();
            if (this._instances.has(normalized)) {
                return this._instances.get(normalized);
            }

            let provider;
            if (normalized === 'sqlserver' || normalized === 'mssql') {
                provider = new SqlServerMetadataProvider();
            } else if (normalized === 'postgresql' || normalized === 'postgres' || normalized === 'pg') {
                provider = new PostgresMetadataProvider();
            } else {
                provider = new ProjectMetadataAdapter(normalized);
            }

            this._instances.set(normalized, provider);
            return provider;
        }

        /**
         * Get the appropriate dialect-specific provider for a specific connectionId
         * @param {string|number} connectionId
         * @returns {MetadataProvider}
         */
        static getProviderForConnection(connectionId) {
            const dbType = this.getDbTypeForConnection(connectionId);
            return this.getProvider(dbType);
        }
    }

    // Export to global scope
    window.MetadataProvider = MetadataProvider;
    window.ProjectMetadataAdapter = ProjectMetadataAdapter;
    window.SqlServerMetadataProvider = SqlServerMetadataProvider;
    window.PostgresMetadataProvider = PostgresMetadataProvider;
    window.MetadataProviderFactory = MetadataProviderFactory;

})(typeof window !== 'undefined' ? window : globalThis);
