/**
 * object-search-api.js
 * API communication layer for Object Content Search.
 */
(function (global) {
    'use strict';

    const ObjectSearchApi = {
        /**
         * Search for SQL objects containing keyword in definition.
         */
        async search(opts = {}) {
            const connectionId = opts.connectionId || opts.connection_id;
            const keyword = opts.keyword || '';
            const database = opts.database || null;
            const objectTypes = opts.objectTypes || opts.object_types || ['VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER'];
            const caseSensitive = (opts.caseSensitive !== undefined) ? opts.caseSensitive : (opts.case_sensitive || false);
            const wholeWord = (opts.wholeWord !== undefined) ? opts.wholeWord : (opts.whole_word || false);
            const isRegex = (opts.isRegex !== undefined) ? opts.isRegex : (opts.is_regex || false);
            const schema = opts.schema || null;

            const url = '/api/sql/object-search';
            const payload = {
                connection_id: connectionId,
                keyword,
                database,
                object_types: objectTypes,
                case_sensitive: caseSensitive,
                whole_word: wholeWord,
                is_regex: isRegex,
                schema
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || 'Search failed');
            }
            return await response.json();
        },

        /**
         * Retrieve DDL of a specific object and its match positions.
         */
        async getDdl({
            connectionId,
            schema,
            name,
            objectType,
            database = null,
            keyword = '',
            caseSensitive = false,
            wholeWord = false,
            isRegex = false
        }) {
            const params = new URLSearchParams({
                schema: schema || 'dbo',
                name: name || '',
                type: objectType || 'VIEW',
                case_sensitive: caseSensitive ? 'true' : 'false',
                whole_word: wholeWord ? 'true' : 'false',
                is_regex: isRegex ? 'true' : 'false'
            });

            if (connectionId) params.append('connection_id', connectionId);
            if (database) params.append('database', database);
            if (keyword) params.append('keyword', keyword);

            const url = `/api/sql/object-ddl?${params.toString()}`;
            const response = await fetch(url, { method: 'GET' });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || 'Failed to retrieve DDL');
            }
            return await response.json();
        }
    };

    global.ObjectSearchApi = ObjectSearchApi;
})(window);
