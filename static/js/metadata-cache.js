/**
 * metadata-cache.js - Multi-Tier Metadata Cache Architecture (Phase 5)
 * 
 * Implements:
 * - Level 1: Connection Cache (Databases, Schemas, Object Lists)
 * - Level 2: Object-level Cache (Columns, Parameters, Definitions, Data Types)
 * - Level 3: Completion/Query Candidates Cache (Short TTL memoization)
 * - LRU Eviction: Max capacity bounded caching with LRU policy
 * - Invalidation: Configurable TTL, Object-level invalidation, DDL detection (CREATE, ALTER, DROP for TABLE, VIEW, PROCEDURE, FUNCTION, TYPE), Manual refresh
 * - Lazy Loading: Loads columns and definitions on-demand, not upfront
 * - Performance Metrics: Hit/Miss counters, Latency measurement
 */

(function(window) {
    'use strict';

    // Default Cache Configuration
    const DEFAULT_TTL = 300000;       // 5 minutes (300000 ms)
    const OBJECTS_TTL = 300000;       // 5 minutes (300000 ms)
    const COLUMNS_TTL = 600000;       // 10 minutes (600000 ms)
    const PARAMETERS_TTL = 600000;    // 10 minutes (600000 ms)
    const FOREIGN_KEYS_TTL = 600000;  // 10 minutes (600000 ms)
    const DEFINITIONS_TTL = 900000;   // 15 minutes
    const DATA_TYPES_TTL = 1800000;   // 30 minutes
    const COMPLETIONS_TTL = 10000;    // 10 seconds (short-lived)
    const MAX_ENTRIES = 500;          // Maximum LRU entries per cache tier

    /**
     * Cache Entry with TTL Expiration
     */
    class CacheEntry {
        constructor(data, ttlMs = DEFAULT_TTL) {
            this.data = data;
            this.timestamp = Date.now();
            this.ttlMs = ttlMs;
        }

        isExpired() {
            if (this.ttlMs <= 0) return false; // Infinite TTL
            return (Date.now() - this.timestamp) > this.ttlMs;
        }
    }

    /**
     * Least-Recently-Used (LRU) In-Memory Cache
     * Automatically evicts oldest entries when reaching maxSize (MAX_ENTRIES)
     */
    class LRUCache {
        constructor(maxSize = MAX_ENTRIES) {
            this.maxSize = maxSize;
            this.cache = new Map();
        }

        get(key) {
            if (!this.cache.has(key)) return null;
            const entry = this.cache.get(key);
            // Refresh recency: remove and re-insert at end of Map
            this.cache.delete(key);
            this.cache.set(key, entry);
            return entry;
        }

        set(key, entry) {
            if (this.cache.has(key)) {
                this.cache.delete(key);
            } else if (this.cache.size >= this.maxSize) {
                // Evict oldest entry (first item returned by keys iterator)
                const oldestKey = this.cache.keys().next().value;
                if (oldestKey !== undefined) {
                    this.cache.delete(oldestKey);
                }
            }
            this.cache.set(key, entry);
        }

        delete(key) {
            return this.cache.delete(key);
        }

        clear() {
            this.cache.clear();
        }

        keys() {
            return this.cache.keys();
        }

        has(key) {
            return this.cache.has(key);
        }

        get size() {
            return this.cache.size;
        }
    }

    /**
     * StorageTier encapsulating LRU and TTL policies for a specific cache category
     */
    class StorageTier {
        constructor(name, defaultTTL = DEFAULT_TTL, maxSize = MAX_ENTRIES) {
            this.name = name;
            this.defaultTTL = defaultTTL;
            this.maxSize = maxSize;
            this.lru = new LRUCache(maxSize);
        }

        get(key) {
            const entry = this.lru.get(key);
            if (!entry) return null;
            if (entry.isExpired()) {
                this.lru.delete(key);
                return null;
            }
            return entry.data;
        }

        set(key, data, ttlMs = this.defaultTTL) {
            this.lru.set(key, new CacheEntry(data, ttlMs));
        }

        delete(key) {
            return this.lru.delete(key);
        }

        clear() {
            this.lru.clear();
        }

        keys() {
            return this.lru.keys();
        }

        has(key) {
            const entry = this.lru.get(key);
            if (!entry) return false;
            if (entry.isExpired()) {
                this.lru.delete(key);
                return false;
            }
            return true;
        }

        get size() {
            return this.lru.size;
        }
    }

    /**
     * AppMetadataCache - Multi-Tier Metadata Cache Architecture (Phase 5)
     */
    class AppMetadataCache {
        constructor(options = {}) {
            // Configurable TTLs
            this.defaultTTL = options.defaultTTL || DEFAULT_TTL;
            this.objectsTTL = options.objectsTTL || OBJECTS_TTL;
            this.columnsTTL = options.columnsTTL || COLUMNS_TTL;
            this.parametersTTL = options.parametersTTL || PARAMETERS_TTL;
            this.foreignKeysTTL = options.foreignKeysTTL || FOREIGN_KEYS_TTL;
            this.definitionsTTL = options.definitionsTTL || DEFINITIONS_TTL;
            this.dataTypesTTL = options.dataTypesTTL || DATA_TYPES_TTL;
            this.completionTTL = options.completionTTL || COMPLETIONS_TTL;
            this.maxEntries = options.maxEntries || MAX_ENTRIES;

            // Level 1: Connection & Schema Tiers
            this.databasesTier = new StorageTier('databases', this.defaultTTL, this.maxEntries);
            this.schemasTier = new StorageTier('schemas', this.defaultTTL, this.maxEntries);
            this.objectsTier = new StorageTier('objects', this.objectsTTL, this.maxEntries);

            // Level 2: Object-level Tiers (Columns, Parameters, ForeignKeys, Definitions, Types)
            this.columnsTier = new StorageTier('columns', this.columnsTTL, this.maxEntries);
            this.parametersTier = new StorageTier('parameters', this.parametersTTL, this.maxEntries);
            this.foreignKeysTier = new StorageTier('foreignKeys', this.foreignKeysTTL, this.maxEntries);
            this.definitionsTier = new StorageTier('definitions', this.definitionsTTL, this.maxEntries);
            this.typesTier = new StorageTier('types', this.dataTypesTTL, this.maxEntries);

            // Level 3: Completion Candidates Tier
            this.completionsTier = new StorageTier('completions', this.completionTTL, this.maxEntries);

            // Performance Measurement
            this.metrics = {
                hits: 0,
                misses: 0,
                totalLookups: 0,
                totalLookupDurationMs: 0,
                lastLookupDurationMs: 0
            };
        }

        // Backward compatibility getters
        get _databases() { return this.databasesTier; }
        get _schemas() { return this.schemasTier; }
        get _objects() { return this.objectsTier; }
        get _columns() { return this.columnsTier; }
        get _parameters() { return this.parametersTier; }
        get _foreignKeys() { return this.foreignKeysTier; }
        get _definitions() { return this.definitionsTier; }
        get _types() { return this.typesTier; }
        get _completions() { return this.completionsTier; }

        // ─────────────────────────────────────────────────────────────────────────────
        // PERFORMANCE & METRICS
        // ─────────────────────────────────────────────────────────────────────────────
        _recordHit(durationMs) {
            this.metrics.hits++;
            this.metrics.totalLookups++;
            this.metrics.totalLookupDurationMs += durationMs;
            this.metrics.lastLookupDurationMs = durationMs;
        }

        _recordMiss(durationMs) {
            this.metrics.misses++;
            this.metrics.totalLookups++;
            this.metrics.totalLookupDurationMs += durationMs;
            this.metrics.lastLookupDurationMs = durationMs;
        }

        getMetrics() {
            const total = this.metrics.totalLookups;
            const hitRatio = total > 0 ? (this.metrics.hits / total) * 100 : 0;
            const avgDurationMs = total > 0 ? (this.metrics.totalLookupDurationMs / total) : 0;

            return {
                hits: this.metrics.hits,
                misses: this.metrics.misses,
                totalLookups: total,
                hitRatioPercent: Number(hitRatio.toFixed(2)),
                avgLookupDurationMs: Number(avgDurationMs.toFixed(4)),
                lastLookupDurationMs: Number(this.metrics.lastLookupDurationMs.toFixed(4)),
                activeEntries: {
                    databases: this.databasesTier.size,
                    schemas: this.schemasTier.size,
                    objects: this.objectsTier.size,
                    columns: this.columnsTier.size,
                    parameters: this.parametersTier.size,
                    foreignKeys: this.foreignKeysTier.size,
                    definitions: this.definitionsTier.size,
                    types: this.typesTier.size,
                    completions: this.completionsTier.size
                }
            };
        }

        resetMetrics() {
            this.metrics.hits = 0;
            this.metrics.misses = 0;
            this.metrics.totalLookups = 0;
            this.metrics.totalLookupDurationMs = 0;
            this.metrics.lastLookupDurationMs = 0;
        }

        // Helper key builder
        _buildKey(connId, ...parts) {
            const cleanParts = parts.map(p => (p != null ? String(p).trim().toLowerCase() : ''));
            return `${String(connId || '')}::${cleanParts.join('::')}`;
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // LEVEL 1: CONNECTION CACHE (Databases, Schemas, Objects)
        // ─────────────────────────────────────────────────────────────────────────────
        getDatabases(connectionId) {
            const t0 = performance.now();
            const key = String(connectionId || '');
            const data = this.databasesTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        static _isValidMetadataPayload(data) {
            if (data === null || data === undefined) return false;
            if (data.hasError || data.error || data.isError) return false;
            if (Array.isArray(data) && data.length === 0 && (data.hasError || data.error || data.isError)) return false;
            return true;
        }

        setDatabases(connectionId, databases, ttlMs = this.defaultTTL) {
            if (!AppMetadataCache._isValidMetadataPayload(databases)) return;
            const key = String(connectionId || '');
            this.databasesTier.set(key, databases, ttlMs);
        }

        getSchemas(connectionId, database) {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, database);
            const data = this.schemasTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setSchemas(connectionId, database, schemas, ttlMs = this.defaultTTL) {
            if (!AppMetadataCache._isValidMetadataPayload(schemas)) return;
            const key = this._buildKey(connectionId, database);
            this.schemasTier.set(key, schemas, ttlMs);
        }

        getObjects(connectionId, database, schema) {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, database, schema);
            const data = this.objectsTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setObjects(connectionId, database, schema, objects, ttlMs = this.objectsTTL) {
            if (!AppMetadataCache._isValidMetadataPayload(objects)) return;
            const key = this._buildKey(connectionId, database, schema);
            this.objectsTier.set(key, objects, ttlMs);
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // LEVEL 2: OBJECT-LEVEL CACHE (Columns, Parameters, Definitions, Types)
        // ─────────────────────────────────────────────────────────────────────────────
        getColumns(connectionId, database, schema, table, server = null) {
            const t0 = performance.now();
            const key = server
                ? this._buildKey(connectionId, server, database, schema, table)
                : this._buildKey(connectionId, database, schema, table);
            const data = this.columnsTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setColumns(connectionId, database, schema, table, columns, server = null, ttlMs = this.columnsTTL) {
            if (!AppMetadataCache._isValidMetadataPayload(columns)) return;
            const key = server
                ? this._buildKey(connectionId, server, database, schema, table)
                : this._buildKey(connectionId, database, schema, table);
            this.columnsTier.set(key, columns, ttlMs);
        }

        getLinkedServers(connectionId) {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, 'linked_servers');
            const data = this.databasesTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setLinkedServers(connectionId, servers, ttlMs = this.defaultTTL) {
            const key = this._buildKey(connectionId, 'linked_servers');
            this.databasesTier.set(key, servers, ttlMs);
        }

        clearLinkedServers(connectionId) {
            const key = this._buildKey(connectionId, 'linked_servers');
            this.databasesTier.delete(key);
        }

        getRemoteDatabases(connectionId, server) {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, server, 'databases');
            const data = this.databasesTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setRemoteDatabases(connectionId, server, databases, ttlMs = this.defaultTTL) {
            const key = this._buildKey(connectionId, server, 'databases');
            this.databasesTier.set(key, databases, ttlMs);
        }

        getRemoteSchemas(connectionId, server, database) {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, server, database, 'schemas');
            const data = this.schemasTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setRemoteSchemas(connectionId, server, database, schemas, ttlMs = this.defaultTTL) {
            const key = this._buildKey(connectionId, server, database, 'schemas');
            this.schemasTier.set(key, schemas, ttlMs);
        }

        getRemoteObjects(connectionId, server, database, schema) {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, server, database, schema);
            const data = this.objectsTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setRemoteObjects(connectionId, server, database, schema, objects, ttlMs = this.objectsTTL) {
            const key = this._buildKey(connectionId, server, database, schema);
            this.objectsTier.set(key, objects, ttlMs);
        }

        getRemoteColumns(connectionId, server, database, schema, table) {
            return this.getColumns(connectionId, database, schema, table, server);
        }

        setRemoteColumns(connectionId, server, database, schema, table, columns, ttlMs = this.columnsTTL) {
            return this.setColumns(connectionId, database, schema, table, columns, server, ttlMs);
        }

        getForeignServers(connectionId) {
            return this.getLinkedServers(connectionId);
        }

        setForeignServers(connectionId, servers, ttlMs = this.defaultTTL) {
            return this.setLinkedServers(connectionId, servers, ttlMs);
        }

        getForeignTables(connectionId, schema) {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, 'foreign_tables', schema || '');
            const data = this.objectsTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setForeignTables(connectionId, schema, tables, ttlMs = this.objectsTTL) {
            const key = this._buildKey(connectionId, 'foreign_tables', schema || '');
            this.objectsTier.set(key, tables, ttlMs);
        }

        getParameters(connectionId, database, schema, name) {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, database, schema, name);
            const data = this.parametersTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setParameters(connectionId, database, schema, name, parameters, ttlMs = this.parametersTTL) {
            const key = this._buildKey(connectionId, database, schema, name);
            this.parametersTier.set(key, parameters, ttlMs);
        }

        getForeignKeys(connectionId, database, schema, table) {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, database, schema, table || '');
            const data = this.foreignKeysTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setForeignKeys(connectionId, database, schema, table, foreignKeys, ttlMs = this.foreignKeysTTL) {
            const key = this._buildKey(connectionId, database, schema, table || '');
            this.foreignKeysTier.set(key, foreignKeys, ttlMs);
        }

        getDefinition(connectionId, database, schema, name, type) {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, database, schema, name, type);
            const data = this.definitionsTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setDefinition(connectionId, database, schema, name, type, definition, ttlMs = this.definitionsTTL) {
            const key = this._buildKey(connectionId, database, schema, name, type);
            this.definitionsTier.set(key, definition, ttlMs);
        }

        getSupportedTypes(connectionId, database) {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, database);
            const data = this.typesTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setSupportedTypes(connectionId, database, types, ttlMs = this.dataTypesTTL) {
            const key = this._buildKey(connectionId, database);
            this.typesTier.set(key, types, ttlMs);
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // LEVEL 3: COMPLETION CANDIDATE CACHE (Short-Lived)
        // ─────────────────────────────────────────────────────────────────────────────
        getCompletions(connectionId, database, schema, scopeKey, prefix = '') {
            const t0 = performance.now();
            const key = this._buildKey(connectionId, database, schema, scopeKey, prefix);
            const data = this.completionsTier.get(key);
            if (data !== null) {
                this._recordHit(performance.now() - t0);
                return data;
            }
            this._recordMiss(performance.now() - t0);
            return null;
        }

        setCompletions(connectionId, database, schema, scopeKey, prefix, candidates, ttlMs = this.completionTTL) {
            if (!AppMetadataCache._isValidMetadataPayload(candidates)) return;
            if (candidates && (candidates.hasError || (candidates.meta && candidates.meta.errors && candidates.meta.errors.length > 0))) return;
            const key = this._buildKey(connectionId, database, schema, scopeKey, prefix);
            this.completionsTier.set(key, candidates, ttlMs);
        }

        clearCompletions() {
            this.completionsTier.clear();
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // CACHE INVALIDATION (Section 20 & 67)
        // ─────────────────────────────────────────────────────────────────────────────
        /**
         * Invalidate entire cache across all levels
         */
        invalidateAll() {
            this.databasesTier.clear();
            this.schemasTier.clear();
            this.objectsTier.clear();
            this.columnsTier.clear();
            this.parametersTier.clear();
            this.foreignKeysTier.clear();
            this.definitionsTier.clear();
            this.typesTier.clear();
            this.completionsTier.clear();
            console.log('[MetadataCache] InvalidateAll: All caches cleared');
        }

        /**
         * Invalidate everything for a specific connection
         */
        invalidateConnection(connectionId) {
            if (!connectionId) return;
            const prefix = `${String(connectionId)}::`;
            this.databasesTier.delete(String(connectionId));

            const cleanTier = (tier) => {
                const toDelete = [];
                for (const k of tier.keys()) {
                    if (k.startsWith(prefix) || k === String(connectionId)) toDelete.push(k);
                }
                toDelete.forEach(k => tier.delete(k));
            };

            cleanTier(this.schemasTier);
            cleanTier(this.objectsTier);
            cleanTier(this.columnsTier);
            cleanTier(this.parametersTier);
            cleanTier(this.foreignKeysTier);
            cleanTier(this.definitionsTier);
            cleanTier(this.typesTier);
            cleanTier(this.completionsTier);
            console.log(`[MetadataCache] InvalidateConnection: Cleared for connection ${connectionId}`);
        }

        /**
         * Invalidate everything for a specific database
         */
        invalidateDatabase(connectionId, database) {
            if (!connectionId || !database) return;
            const prefix = this._buildKey(connectionId, database) + '::';
            const exactKey = this._buildKey(connectionId, database);

            this.schemasTier.delete(exactKey);
            this.typesTier.delete(exactKey);

            const cleanTier = (tier) => {
                const toDelete = [];
                for (const k of tier.keys()) {
                    if (k === exactKey || k.startsWith(prefix)) toDelete.push(k);
                }
                toDelete.forEach(k => tier.delete(k));
            };

            cleanTier(this.objectsTier);
            cleanTier(this.columnsTier);
            cleanTier(this.parametersTier);
            cleanTier(this.foreignKeysTier);
            cleanTier(this.definitionsTier);
            cleanTier(this.completionsTier);
            console.log(`[MetadataCache] InvalidateDatabase: Cleared for ${connectionId}::${database}`);
        }

        /**
         * Invalidate everything for a specific schema
         */
        invalidateSchema(connectionId, database, schema) {
            if (!connectionId || !database) return;
            const prefix = this._buildKey(connectionId, database, schema) + '::';
            const exactKey = this._buildKey(connectionId, database, schema);

            this.objectsTier.delete(exactKey);

            const cleanTier = (tier) => {
                const toDelete = [];
                for (const k of tier.keys()) {
                    if (k === exactKey || k.startsWith(prefix)) toDelete.push(k);
                }
                toDelete.forEach(k => tier.delete(k));
            };

            cleanTier(this.columnsTier);
            cleanTier(this.parametersTier);
            cleanTier(this.foreignKeysTier);
            cleanTier(this.definitionsTier);
            cleanTier(this.completionsTier);
            console.log(`[MetadataCache] InvalidateSchema: Cleared for ${connectionId}::${database}::${schema}`);
        }

        /**
         * Invalidate a specific object (table, view, proc, function, type, trigger, etc.)
         */
        invalidateObject(connectionId, database, schema, objectName) {
            if (!connectionId || !objectName) return;
            const cleanObj = String(objectName).trim().toLowerCase().replace(/^[\["`]|[\]"`]$/g, '');
            const cleanDb = database ? String(database).trim().toLowerCase() : '';
            const cleanSchema = schema ? String(schema).trim().toLowerCase() : '';
            const objKeyPrefix = this._buildKey(connectionId, database, schema, cleanObj);

            // Invalidate columns
            const colsToDelete = [];
            for (const k of this.columnsTier.keys()) {
                const parts = k.split('::');
                const kConn = parts[0];
                const kDb = parts[1] || '';
                const kObj = parts[3] || '';
                if (kConn === String(connectionId) && (!cleanDb || kDb === cleanDb) && kObj === cleanObj) {
                    colsToDelete.push(k);
                } else if (k.startsWith(objKeyPrefix)) {
                    colsToDelete.push(k);
                }
            }
            colsToDelete.forEach(k => this.columnsTier.delete(k));

            // Invalidate parameters
            const paramsToDelete = [];
            for (const k of this.parametersTier.keys()) {
                const parts = k.split('::');
                const kConn = parts[0];
                const kDb = parts[1] || '';
                const kObj = parts[3] || '';
                if (kConn === String(connectionId) && (!cleanDb || kDb === cleanDb) && kObj === cleanObj) {
                    paramsToDelete.push(k);
                } else if (k.startsWith(objKeyPrefix)) {
                    paramsToDelete.push(k);
                }
            }
            paramsToDelete.forEach(k => this.parametersTier.delete(k));

            // Invalidate foreign keys associated with this object
            const fksToDelete = [];
            for (const k of this.foreignKeysTier.keys()) {
                if (k.includes(`::${cleanObj}`) || k.endsWith(`::${cleanObj}`)) fksToDelete.push(k);
            }
            fksToDelete.forEach(k => this.foreignKeysTier.delete(k));

            // Invalidate definitions (clear exact match and any schema variation)
            const defsToDelete = [];
            for (const k of this.definitionsTier.keys()) {
                const parts = k.split('::');
                const kConn = parts[0];
                const kDb = parts[1] || '';
                const kObj = parts[3] || '';
                if (kConn === String(connectionId) && (!cleanDb || kDb === cleanDb) && kObj === cleanObj) {
                    defsToDelete.push(k);
                } else if (k.startsWith(objKeyPrefix)) {
                    defsToDelete.push(k);
                }
            }
            defsToDelete.forEach(k => this.definitionsTier.delete(k));

            // Invalidate schema objects list so new/removed tables reflect
            if (cleanSchema) {
                const schemaKey = this._buildKey(connectionId, database, schema);
                this.objectsTier.delete(schemaKey);
            } else {
                for (const k of this.objectsTier.keys()) {
                    if (k.startsWith(String(connectionId))) this.objectsTier.delete(k);
                }
            }

            // Invalidate Level 3 completion cache
            this.completionsTier.clear();

            // Invalidate IntelliSense DataProvider definition cache
            if (window.AppIntelliSense && window.AppIntelliSense.dataProvider && typeof window.AppIntelliSense.dataProvider.invalidateDefinition === 'function') {
                window.AppIntelliSense.dataProvider.invalidateDefinition(connectionId, database, schema, cleanObj);
            }

            // Invalidate Explorer tree node if available
            if (window.AppExplorer && typeof window.AppExplorer.refreshNode === 'function') {
                window.AppExplorer.refreshNode({ connId: connectionId, database, schema, name: cleanObj });
            }

            console.log(`[MetadataCache] InvalidateObject: Cleared cache for object [${schema || '*' }].[${cleanObj}]`);
        }

        /**
         * Parse DDL SQL statement and automatically invalidate target object or schema
         * Supports:
         * - Action: CREATE, CREATE OR ALTER, CREATE OR REPLACE, ALTER, DROP
         * - Target: TABLE, VIEW, PROCEDURE, PROC, FUNCTION, TYPE, TRIGGER
         */
        handleDdlExecution(connectionId, database, sql) {
            if (!sql || typeof sql !== 'string') return null;

            // Pattern: (CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER|DROP) (TABLE|VIEW|PROCEDURE|PROC|FUNCTION|TYPE|TRIGGER)
            const ddlHeaderRegex = /\b(CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER|DROP)\s+(TABLE|VIEW|PROCEDURE|PROC|FUNCTION|TYPE|TRIGGER)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?/i;
            const match = sql.match(ddlHeaderRegex);

            if (match) {
                const action = match[1].replace(/\s+/g, ' ').toUpperCase();
                let objType = match[2].toUpperCase();
                if (objType === 'PROC') objType = 'PROCEDURE';

                const afterHeader = sql.slice(match.index + match[0].length).trim();
                // Tokenize dot-separated identifier parts: [part1].[part2].[part3] or part1.part2.part3
                const parts = [];
                let rest = afterHeader;
                while (rest.length > 0) {
                    const partMatch = rest.match(/^(?:\[([^\]]+)\]|"([^"]+)"|`([^`]+)`|([a-zA-Z0-9_#$@]+))/);
                    if (!partMatch) break;
                    const token = partMatch[1] || partMatch[2] || partMatch[3] || partMatch[4];
                    parts.push(token);
                    rest = rest.slice(partMatch[0].length).trim();
                    if (rest.startsWith('.')) {
                        rest = rest.slice(1).trim();
                    } else {
                        break;
                    }
                }

                let targetDb = database;
                let schema = null;
                let name = null;

                if (parts.length === 3) {
                    targetDb = parts[0];
                    schema = parts[1];
                    name = parts[2];
                } else if (parts.length === 2) {
                    schema = parts[0];
                    name = parts[1];
                } else if (parts.length === 1) {
                    name = parts[0];
                }

                if (name) {
                    this.invalidateObject(connectionId, targetDb, schema, name);
                    if (objType === 'TYPE') {
                        this.typesTier.delete(this._buildKey(connectionId, targetDb));
                    }
                    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.invalidate_metadata_cache === 'function') {
                        window.pywebview.api.invalidate_metadata_cache(connectionId, targetDb, schema, name).catch(() => {});
                    }
                    console.log(`[MetadataCache] DDL Invalidation: Handled ${action} ${objType} [${targetDb || ''}].[${schema || ''}].[${name}]`);
                    return { action, objType, schema, name, targetDb };
                }
            }

            // Fallback for general DDL statements (e.g. TRUNCATE, ALTER DATABASE, etc.)
            if (/\b(?:CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql)) {
                this.invalidateDatabase(connectionId, database);
                if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.invalidate_metadata_cache === 'function') {
                    window.pywebview.api.invalidate_metadata_cache(connectionId, database, null, null).catch(() => {});
                }
                console.log(`[MetadataCache] DDL Invalidation: General DDL detected, refreshed database ${database}`);
                return { action: 'GENERAL_DDL' };
            }

            return null;
        }
    }

    // Export singleton instance and class definition
    const defaultCache = new AppMetadataCache();
    window.LRUCache = LRUCache;
    window.StorageTier = StorageTier;
    window.AppMetadataCache = defaultCache;
    window.MetadataCache = defaultCache; // Backward compatibility with instance methods
    window.AppMetadataCacheClass = AppMetadataCache;

})(typeof window !== 'undefined' ? window : globalThis);
