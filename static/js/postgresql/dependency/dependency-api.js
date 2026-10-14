/**
 * PostgreSQL Dependency Graph - API Client
 * Wraps communication with backend REST/IPC endpoints.
 */
(function (global) {
    'use strict';

    const PostgresDependencyApi = {
        async getColumnDependencies(connId, params = {}) {
            const query = new URLSearchParams({
                schema: params.schema || 'public',
                table: params.table || '',
                column: params.column || '',
                direction: params.direction || 'dependents',
                depth: params.depth || 2,
                include_source: params.includeSource !== false ? 'true' : 'false'
            });
            if (params.database) query.set('database', params.database);

            const url = `/api/postgresql/dependency/${encodeURIComponent(connId)}/column?${query.toString()}`;
            const res = await fetch(url);
            return await res.json();
        },

        async getObjectDependencies(connId, params = {}) {
            const query = new URLSearchParams({
                type: params.type || 'view',
                schema: params.schema || 'public',
                name: params.name || '',
                direction: params.direction || 'dependents',
                depth: params.depth || 2
            });
            if (params.database) query.set('database', params.database);

            const url = `/api/postgresql/dependency/${encodeURIComponent(connId)}/object?${query.toString()}`;
            const res = await fetch(url);
            return await res.json();
        },

        async getObjectDefinition(connId, params = {}) {
            const query = new URLSearchParams({
                type: params.type || 'view',
                schema: params.schema || 'public',
                name: params.name || ''
            });
            if (params.oid) query.set('oid', params.oid);
            if (params.database) query.set('database', params.database);

            const url = `/api/postgresql/dependency/${encodeURIComponent(connId)}/definition?${query.toString()}`;
            const res = await fetch(url);
            return await res.json();
        },

        async getSuggestedSteps(connId, params = {}) {
            const query = new URLSearchParams({
                schema: params.schema || 'public',
                table: params.table || '',
                column: params.column || '',
                action: params.action || 'ALTER'
            });
            if (params.database) query.set('database', params.database);

            const url = `/api/postgresql/dependency/${encodeURIComponent(connId)}/suggested-steps?${query.toString()}`;
            const res = await fetch(url);
            return await res.json();
        }
    };

    global.PostgresDependencyApi = PostgresDependencyApi;
})(window);
