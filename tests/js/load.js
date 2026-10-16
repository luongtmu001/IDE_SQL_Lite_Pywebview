/**
 * tests/js/load.js
 * 
 * VM loader for JavaScript IntelliSense & Syntax tests in Node.js.
 * Loads frontend scripts in the exact order specified in templates/index.html.
 * Simulates browser globals (window, document, performance, localStorage) and
 * provides sample schema & mock metadata provider as defined in Phase 0 / A2.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '../..');

// Script order matching templates/index.html
const SCRIPTS_TO_LOAD = [
    'static/js/sql-dialects.js',
    'static/js/sql-context-engine.js',
    'static/js/sql-tokenizer.js',
    'static/js/scope-resolver.js',
    'static/js/context-analyzer.js',
    'static/js/metadata-provider.js',
    'static/js/metadata-cache.js',
    'static/js/sql-function-signatures.js',
    'static/js/candidate-filter.js',
    'static/js/completion-ranker.js',
    'static/js/candidate-generator.js',
    'static/js/signature-help-resolver.js',
    'static/js/hover-resolver.js',
    'static/js/completion-engine.js',
    'static/js/syntax-check/diagnostic-model.js',
    'static/js/syntax-check/position-mapper.js'
];

/**
 * Sample Schema defined in Spec Section A2
 */
const SAMPLE_SCHEMA = {
    mssql: {
        schemas: ['dbo', 'sales', 'hr'],
        objects: [
            { name: 'Orders', schema: 'dbo', type: 'table' },
            { name: 'Customers', schema: 'dbo', type: 'table' },
            { name: 'OrderItems', schema: 'dbo', type: 'table' },
            { name: 'Order Details', schema: 'dbo', type: 'table' },
            { name: 'Tbl1', schema: 'dbo', type: 'table' }, // For 600-column test WIDE-1
            { name: 'vOrders', schema: 'dbo', type: 'view' },
            { name: 'usp_GetOrders', schema: 'dbo', type: 'procedure' },
            { name: 'fn_Total', schema: 'dbo', type: 'function' },
            { name: 'Region', schema: 'sales', type: 'table' },
            { name: 'Employees', schema: 'hr', type: 'table' }
        ],
        columns: {
            'dbo.Orders': [
                { name: 'OrderID', type: 'int', nullable: false, isPrimary: true },
                { name: 'CustomerID', type: 'int', nullable: false },
                { name: 'OrderDate', type: 'datetime', nullable: true },
                { name: 'Total', type: 'decimal', precision: 18, scale: 2, nullable: true }
            ],
            'dbo.Customers': [
                { name: 'CustomerID', type: 'int', nullable: false, isPrimary: true },
                { name: 'CustomerName', type: 'nvarchar', maxLength: 100, nullable: false },
                { name: 'ContactEmail', type: 'nvarchar', maxLength: 100, nullable: true }
            ],
            'dbo.OrderItems': [
                { name: 'ItemID', type: 'int', nullable: false, isPrimary: true },
                { name: 'OrderID', type: 'int', nullable: false },
                { name: 'ProductID', type: 'int', nullable: false },
                { name: 'Quantity', type: 'int', nullable: false },
                { name: 'UnitPrice', type: 'decimal', precision: 18, scale: 2, nullable: false }
            ],
            'dbo.Order Details': [
                { name: 'OrderID', type: 'int', nullable: false, isPrimary: true },
                { name: 'ProductID', type: 'int', nullable: false, isPrimary: true },
                { name: 'UnitPrice', type: 'money', nullable: false },
                { name: 'Quantity', type: 'smallint', nullable: false },
                { name: 'Discount', type: 'real', nullable: false }
            ],
            'dbo.Tbl1': Array.from({ length: 600 }, (_, i) => ({
                name: `Col_${i + 1}`,
                type: 'int',
                nullable: true
            })),
            'dbo.vOrders': [
                { name: 'OrderID', type: 'int' },
                { name: 'CustomerName', type: 'nvarchar' },
                { name: 'Total', type: 'decimal' }
            ],
            'sales.Region': [
                { name: 'RegionID', type: 'int', nullable: false, isPrimary: true },
                { name: 'RegionDescription', type: 'nchar', maxLength: 50, nullable: false },
                { name: 'RegionName', type: 'nvarchar', maxLength: 50, nullable: true }
            ],
            'hr.Employees': [
                { name: 'EmployeeID', type: 'int', nullable: false, isPrimary: true },
                { name: 'LastName', type: 'nvarchar', maxLength: 50, nullable: false },
                { name: 'FirstName', type: 'nvarchar', maxLength: 50, nullable: false },
                { name: 'Title', type: 'nvarchar', maxLength: 50, nullable: true }
            ]
        },
        parameters: {
            'dbo.usp_GetOrders': [
                { name: '@CustomerID', type: 'int', isOutput: false },
                { name: '@FromDate', type: 'datetime', isOutput: false }
            ],
            'dbo.fn_Total': [
                { name: '@OrderID', type: 'int', isOutput: false }
            ]
        },
        foreignKeys: {
            'dbo.OrderItems': [
                { constraint: 'FK_OrderItems_Orders', column: 'OrderID', foreignSchema: 'dbo', foreignTable: 'Orders', foreignColumn: 'OrderID' }
            ],
            'dbo.Orders': [
                { constraint: 'FK_Orders_Customers', column: 'CustomerID', foreignSchema: 'dbo', foreignTable: 'Customers', foreignColumn: 'CustomerID' }
            ],
            'dbo.Order Details': [
                { constraint: 'FK_OrderDetails_Orders', column: 'OrderID', foreignSchema: 'dbo', foreignTable: 'Orders', foreignColumn: 'OrderID' }
            ]
        },
        dataTypes: [
            'bigint', 'binary', 'bit', 'char', 'date', 'datetime', 'datetime2',
            'datetimeoffset', 'decimal', 'float', 'image', 'int', 'money', 'nchar',
            'ntext', 'numeric', 'nvarchar', 'real', 'smalldatetime', 'smallint',
            'smallmoney', 'text', 'time', 'tinyint', 'uniqueidentifier', 'varbinary', 'varchar', 'xml'
        ]
    },
    postgresql: {
        schemas: ['public', 'sales'],
        objects: [
            { name: 'orders', schema: 'public', type: 'table' },
            { name: 'Customers', schema: 'public', type: 'table' },
            { name: 'order_items', schema: 'public', type: 'table' },
            { name: 'v_orders', schema: 'public', type: 'view' },
            { name: 'region', schema: 'sales', type: 'table' }
        ],
        columns: {
            'public.orders': [
                { name: 'id', type: 'integer', nullable: false, isPrimary: true },
                { name: 'customer_id', type: 'integer', nullable: false },
                { name: 'order_date', type: 'timestamp', nullable: true },
                { name: 'total', type: 'numeric', precision: 18, scale: 2, nullable: true }
            ],
            'public.Customers': [
                { name: 'id', type: 'integer', nullable: false, isPrimary: true },
                { name: 'name', type: 'text', nullable: false },
                { name: 'email', type: 'text', nullable: true }
            ],
            'public.order_items': [
                { name: 'id', type: 'integer', nullable: false, isPrimary: true },
                { name: 'order_id', type: 'integer', nullable: false },
                { name: 'product_id', type: 'integer', nullable: false },
                { name: 'quantity', type: 'integer', nullable: false },
                { name: 'price', type: 'numeric', precision: 18, scale: 2, nullable: false }
            ],
            'public.v_orders': [
                { name: 'id', type: 'integer' },
                { name: 'customer_name', type: 'text' },
                { name: 'total', type: 'numeric' }
            ],
            'sales.region': [
                { name: 'id', type: 'integer', nullable: false, isPrimary: true },
                { name: 'name', type: 'text', nullable: false },
                { name: 'description', type: 'text', nullable: true }
            ]
        },
        parameters: {},
        foreignKeys: {
            'public.order_items': [
                { constraint: 'fk_order_items_orders', column: 'order_id', foreignSchema: 'public', foreignTable: 'orders', foreignColumn: 'id' }
            ],
            'public.orders': [
                { constraint: 'fk_orders_customers', column: 'customer_id', foreignSchema: 'public', foreignTable: 'Customers', foreignColumn: 'id' }
            ]
        },
        dataTypes: [
            'bigint', 'bigserial', 'boolean', 'bytea', 'char', 'date', 'decimal',
            'double precision', 'integer', 'interval', 'json', 'jsonb', 'numeric',
            'real', 'serial', 'smallint', 'text', 'time', 'timestamp', 'timestamptz', 'uuid', 'varchar'
        ]
    }
};

/**
 * Mock Metadata Provider implementation adhering to A2 contract
 */
class MockMetadataProvider {
    constructor(dbType = 'mssql') {
        this.dbType = (dbType === 'postgres' || dbType === 'postgresql') ? 'postgresql' : 'mssql';
        this.schemaData = SAMPLE_SCHEMA[this.dbType];
    }

    _resolveSchemaTable(schema, table) {
        const defaultSchema = this.dbType === 'postgresql' ? 'public' : 'dbo';
        const s = schema || defaultSchema;
        const key = `${s}.${table}`;
        return { s, key };
    }

    async getSchemas(connId, database) {
        return this.schemaData.schemas.slice();
    }

    async getDatabases(connId) {
        return ['testdb', 'master'];
    }

    async getObjects(connId, database, schema, type) {
        const s = schema || (this.dbType === 'postgresql' ? 'public' : 'dbo');
        let list = this.schemaData.objects.filter(o => o.schema.toLowerCase() === s.toLowerCase());
        if (type) {
            list = list.filter(o => o.type.toLowerCase() === type.toLowerCase());
        }
        return list;
    }

    async fetchObjects(connId, database, schema) {
        return this.getObjects(connId, database, schema);
    }

    async getColumns(connId, database, schema, table) {
        const { key } = this._resolveSchemaTable(schema, table);
        for (const [k, cols] of Object.entries(this.schemaData.columns)) {
            if (k.toLowerCase() === key.toLowerCase()) {
                return cols.slice();
            }
        }
        return [];
    }

    async fetchColumns(connId, database, schema, table) {
        return this.getColumns(connId, database, schema, table);
    }

    async getParameters(connId, database, schema, name, dbType) {
        const { key } = this._resolveSchemaTable(schema, name);
        for (const [k, params] of Object.entries(this.schemaData.parameters)) {
            if (k.toLowerCase() === key.toLowerCase()) {
                return params.slice();
            }
        }
        return [];
    }

    async fetchParameters(connId, database, schema, name, dbType) {
        return this.getParameters(connId, database, schema, name, dbType);
    }

    async getForeignKeys(connId, database, schema, table) {
        const { key } = this._resolveSchemaTable(schema, table);
        for (const [k, fks] of Object.entries(this.schemaData.foreignKeys)) {
            if (k.toLowerCase() === key.toLowerCase()) {
                return fks.slice();
            }
        }
        return [];
    }

    async fetchForeignKeys(connId, database, schema, table) {
        return this.getForeignKeys(connId, database, schema, table);
    }

    async getSupportedTypes(connId, database) {
        return this.schemaData.dataTypes.slice();
    }

    async fetchDataTypes(connId, database) {
        return this.getSupportedTypes(connId, database);
    }
}

/**
 * Creates an isolated VM execution context with all IDE scripts loaded
 */
function createIdeContext(options = {}) {
    const dbType = options.dbType || 'mssql';
    const mockProvider = new MockMetadataProvider(dbType);

    // Browser environment simulation
    const localStorageStore = new Map();
    const sandbox = {
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval,
        Promise: Promise,
        Set: Set,
        Map: Map,
        Array: Array,
        Object: Object,
        String: String,
        Number: Number,
        Boolean: Boolean,
        RegExp: RegExp,
        JSON: JSON,
        Math: Math,
        Date: Date,
        Error: Error,
        TypeError: TypeError,
        RangeError: RangeError,
        SyntaxError: SyntaxError,
        fetch: async () => ({ ok: false, json: async () => ({}) }),
        performance: {
            now: () => {
                const [sec, nano] = process.hrtime();
                return sec * 1000 + nano / 1e6;
            }
        },
        localStorage: {
            getItem: (key) => localStorageStore.get(String(key)) || null,
            setItem: (key, val) => localStorageStore.set(String(key), String(val)),
            removeItem: (key) => localStorageStore.delete(String(key)),
            clear: () => localStorageStore.clear()
        },
        document: {
            documentElement: {
                setAttribute: () => {},
                style: { setProperty: () => {} }
            },
            createElement: () => ({ style: {} })
        }
    };

    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;

    const vmContext = vm.createContext(sandbox);

    // Load each script into VM context
    for (const relPath of SCRIPTS_TO_LOAD) {
        const fullPath = path.join(ROOT_DIR, relPath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`Script file not found: ${fullPath}`);
        }
        const code = fs.readFileSync(fullPath, 'utf8');
        const script = new vm.Script(code, { filename: relPath });
        script.runInContext(vmContext);
    }

    // Configure completion engine with mock provider
    const engine = sandbox.DefaultCompletionEngine;
    if (engine && engine.generator) {
        engine.generator.dataProvider = mockProvider;
        engine.dataProvider = mockProvider;
    }

    // Tab context helper
    const defaultTabCtx = {
        connectionId: 'conn-1',
        database: 'testdb',
        schema: dbType === 'postgresql' ? 'public' : 'dbo',
        dbType: dbType
    };

    return {
        sandbox,
        mockProvider,
        defaultTabCtx,

        /**
         * Helper: Analyze SQL with cursor marked by ‸ or explicit offset
         */
        analyze(sqlWithCursor, offsetOverride = null, dialect = dbType) {
            let sql = sqlWithCursor;
            let cursor = offsetOverride;
            if (cursor === null || cursor === undefined) {
                const caretIndex = sqlWithCursor.indexOf('‸');
                if (caretIndex !== -1) {
                    sql = sqlWithCursor.slice(0, caretIndex) + sqlWithCursor.slice(caretIndex + 1);
                    cursor = caretIndex;
                } else {
                    cursor = sql.length;
                }
            }
            return sandbox.SqlContextAnalyzer.analyze(sql, cursor, dialect);
        },

        /**
         * Helper: Get completions with cursor marked by ‸ or explicit offset
         */
        async getCompletions(sqlWithCursor, offsetOverride = null, tabCtx = defaultTabCtx) {
            let sql = sqlWithCursor;
            let cursor = offsetOverride;
            if (cursor === null || cursor === undefined) {
                const caretIndex = sqlWithCursor.indexOf('‸');
                if (caretIndex !== -1) {
                    sql = sqlWithCursor.slice(0, caretIndex) + sqlWithCursor.slice(caretIndex + 1);
                    cursor = caretIndex;
                } else {
                    cursor = sql.length;
                }
            }
            const context = sandbox.SqlContextAnalyzer.analyze(sql, cursor, tabCtx.dbType || dbType);
            if (context.isInsideComment || context.isInsideString) {
                return [];
            }
            return engine.getCompletions(sql, cursor, context, tabCtx);
        },

        /**
         * Helper: Get signature help
         */
        async getSignatureHelp(sqlWithCursor, offsetOverride = null, tabCtx = defaultTabCtx) {
            let sql = sqlWithCursor;
            let cursor = offsetOverride;
            if (cursor === null || cursor === undefined) {
                const caretIndex = sqlWithCursor.indexOf('‸');
                if (caretIndex !== -1) {
                    sql = sqlWithCursor.slice(0, caretIndex) + sqlWithCursor.slice(caretIndex + 1);
                    cursor = caretIndex;
                } else {
                    cursor = sql.length;
                }
            }
            if (engine.signatureResolver && typeof engine.signatureResolver.resolve === 'function') {
                return engine.signatureResolver.resolve(sql, cursor, tabCtx);
            }
            return null;
        }
    };
}

module.exports = {
    createIdeContext,
    MockMetadataProvider,
    SAMPLE_SCHEMA,
    ROOT_DIR
};
