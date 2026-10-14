/**
 * SQL Visualization — Query Model & History State Manager
 * Implements Section 5 & 11 of .SKILL/sql_visualization.md
 */

(function (window) {
    'use strict';

    function generateId(prefix) {
        return (prefix || 'item_') + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    }

    /**
     * TableNode represents an individual table or view instance in the query canvas.
     * Note: id must be unique per instance, allowing the same table to appear multiple times with different aliases.
     */
    class TableNode {
        constructor(opts = {}) {
            this.id = opts.id || generateId('tbl_');
            this.database = opts.database || '';
            this.schema = opts.schema || 'dbo';
            this.tableName = opts.tableName || '';
            this.alias = opts.alias || opts.tableName || '';
            this.sourceType = opts.sourceType || 'table'; // 'table' | 'view'
            this.columns = Array.isArray(opts.columns) ? opts.columns.map(c => ({
                name: c.name || '',
                type: c.type || 'varchar',
                isPk: !!(c.isPk || c.is_pk),
                isFk: !!(c.isFk || c.is_fk),
                nullable: c.nullable !== undefined ? c.nullable : true
            })) : [];
            this.x = typeof opts.x === 'number' ? opts.x : 40;
            this.y = typeof opts.y === 'number' ? opts.y : 40;
            this.isExpanded = opts.isExpanded !== undefined ? opts.isExpanded : false;
        }

        clone() {
            return new TableNode({
                id: this.id,
                database: this.database,
                schema: this.schema,
                tableName: this.tableName,
                alias: this.alias,
                sourceType: this.sourceType,
                columns: this.columns.map(c => ({ ...c })),
                x: this.x,
                y: this.y,
                isExpanded: this.isExpanded
            });
        }
    }

    /**
     * JoinEdge represents a relationship between two table instances.
     * Supports multiple ON conditions and different join types.
     */
    class JoinEdge {
        constructor(opts = {}) {
            this.id = opts.id || generateId('join_');
            this.sourceTableId = opts.sourceTableId || '';
            this.targetTableId = opts.targetTableId || '';
            this.joinType = (opts.joinType || 'INNER').toUpperCase(); // INNER, LEFT, RIGHT, FULL, CROSS
            
            // conditions: array of { leftColumn, operator, rightColumn, leftTableId, rightTableId }
            if (Array.isArray(opts.conditions) && opts.conditions.length > 0) {
                this.conditions = opts.conditions.map(c => ({
                    leftColumn: c.leftColumn || '',
                    operator: c.operator || '=',
                    rightColumn: c.rightColumn || '',
                    leftTableId: c.leftTableId || opts.sourceTableId || '',
                    rightTableId: c.rightTableId || opts.targetTableId || ''
                }));
            } else if (opts.leftColumn && opts.rightColumn) {
                this.conditions = [{
                    leftColumn: opts.leftColumn,
                    operator: opts.operator || '=',
                    rightColumn: opts.rightColumn,
                    leftTableId: opts.sourceTableId || '',
                    rightTableId: opts.targetTableId || ''
                }];
            } else {
                this.conditions = [];
            }

            this.isInferred = !!opts.isInferred;
        }

        clone() {
            return new JoinEdge({
                id: this.id,
                sourceTableId: this.sourceTableId,
                targetTableId: this.targetTableId,
                joinType: this.joinType,
                conditions: this.conditions.map(c => ({ ...c })),
                isInferred: this.isInferred
            });
        }
    }

    /**
     * SelectItem represents a projected column or expression in SELECT.
     */
    class SelectItem {
        constructor(opts = {}) {
            this.id = opts.id || generateId('sel_');
            this.tableId = opts.tableId || null;
            this.tableAlias = opts.tableAlias || '';
            this.column = opts.column || '*';
            this.alias = opts.alias || '';
            this.output = opts.output !== undefined ? opts.output : true;
            this.aggregate = opts.aggregate || ''; // '', 'SUM', 'COUNT', 'AVG', 'MIN', 'MAX'
            this.sort = opts.sort || ''; // '', 'ASC', 'DESC'
            this.sortOrder = typeof opts.sortOrder === 'number' ? opts.sortOrder : 0;
            this.criteria = opts.criteria || '';
            this.rawExpression = opts.rawExpression || '';
        }

        clone() {
            return new SelectItem({
                id: this.id,
                tableId: this.tableId,
                tableAlias: this.tableAlias,
                column: this.column,
                alias: this.alias,
                output: this.output,
                aggregate: this.aggregate,
                sort: this.sort,
                sortOrder: this.sortOrder,
                criteria: this.criteria,
                rawExpression: this.rawExpression
            });
        }
    }

    /**
     * WhereCondition represents a filter criteria in WHERE.
     */
    class WhereCondition {
        constructor(opts = {}) {
            this.id = opts.id || generateId('where_');
            this.tableId = opts.tableId || null;
            this.tableAlias = opts.tableAlias || '';
            this.column = opts.column || '';
            this.operator = opts.operator || '=';
            this.value = opts.value !== undefined ? String(opts.value) : '';
            this.logic = (opts.logic || 'AND').toUpperCase(); // 'AND' | 'OR'
            this.rawSql = opts.rawSql || '';
        }

        clone() {
            return new WhereCondition({
                id: this.id,
                tableId: this.tableId,
                tableAlias: this.tableAlias,
                column: this.column,
                operator: this.operator,
                value: this.value,
                logic: this.logic,
                rawSql: this.rawSql
            });
        }
    }

    /**
     * QueryModel: Central decoupled intermediate data model between SQL and Designer canvas.
     */
    class QueryModel {
        constructor(opts = {}) {
            this.dialect = opts.dialect || 'sqlserver'; // 'sqlserver' | 'postgresql'
            this.originalSql = opts.originalSql || '';
            
            // Map tableId -> TableNode
            this.tables = new Map();
            if (Array.isArray(opts.tables)) {
                opts.tables.forEach(t => {
                    const node = t instanceof TableNode ? t : new TableNode(t);
                    this.tables.set(node.id, node);
                });
            }

            // Joins array
            this.joins = Array.isArray(opts.joins)
                ? opts.joins.map(j => j instanceof JoinEdge ? j : new JoinEdge(j))
                : [];

            // Select items array
            this.selectItems = Array.isArray(opts.selectItems)
                ? opts.selectItems.map(s => s instanceof SelectItem ? s : new SelectItem(s))
                : [];

            // Where conditions
            this.whereConditions = Array.isArray(opts.whereConditions)
                ? opts.whereConditions.map(w => w instanceof WhereCondition ? w : new WhereCondition(w))
                : [];

            this.groupByItems = Array.isArray(opts.groupByItems) ? [...opts.groupByItems] : [];
            this.havingConditions = Array.isArray(opts.havingConditions) ? [...opts.havingConditions] : [];
            this.orderByItems = Array.isArray(opts.orderByItems) ? [...opts.orderByItems] : [];
            this.distinct = !!opts.distinct;
            this.topLimit = typeof opts.topLimit === 'number' ? opts.topLimit : (opts.topLimit || null);
            
            // Unparsed / unsupported constructs (preserved to prevent SQL degradation)
            this.unsupportedFragments = Array.isArray(opts.unsupportedFragments) ? [...opts.unsupportedFragments] : [];
            this.parseStatus = opts.parseStatus || 'success'; // 'success' | 'partial' | 'unsupported' | 'error'
            this.syncStatus = opts.syncStatus || 'synced'; // 'synced' | 'code_modified' | 'design_modified' | 'parse_error' | 'unsupported_sql'
            
            // Intermediate Query Flow Graph (Phase 1-3)
            this.flowGraph = opts.flowGraph || null;

            this._listeners = new Set();
        }

        hasFlowGraph() {
            return !!(this.flowGraph && this.flowGraph.nodes && (this.flowGraph.nodes instanceof Map ? this.flowGraph.nodes.size > 0 : Object.keys(this.flowGraph.nodes).length > 0));
        }

        setFlowGraph(graph) {
            this.flowGraph = graph;
            this.notifyChange('flow-graph-changed', { flowGraph: graph });
        }

        addListener(fn) {
            if (typeof fn === 'function') this._listeners.add(fn);
        }

        removeListener(fn) {
            this._listeners.delete(fn);
        }

        notifyChange(changeType, detail) {
            for (const fn of this._listeners) {
                try {
                    fn(this, changeType, detail);
                } catch (e) {
                    console.error('[QueryModel] listener error:', e);
                }
            }
        }

        addTable(tableData) {
            const node = tableData instanceof TableNode ? tableData : new TableNode(tableData);
            
            // Ensure unique alias if collision with existing table
            let alias = node.alias || node.tableName;
            const existingAliases = new Set(Array.from(this.tables.values()).map(t => t.alias.toLowerCase()));
            if (existingAliases.has(alias.toLowerCase())) {
                let suffix = 1;
                while (existingAliases.has(`${alias}_${suffix}`.toLowerCase())) {
                    suffix++;
                }
                alias = `${alias}_${suffix}`;
                node.alias = alias;
            }

            this.tables.set(node.id, node);
            this.notifyChange('add-table', { table: node });
            return node;
        }

        removeTable(tableId) {
            const node = this.tables.get(tableId);
            if (!node) return false;

            // Remove table
            this.tables.delete(tableId);

            // Clean up related joins
            this.joins = this.joins.filter(j => j.sourceTableId !== tableId && j.targetTableId !== tableId);

            // Clean up related select items
            this.selectItems = this.selectItems.filter(s => s.tableId !== tableId && s.tableAlias !== node.alias);

            // Clean up related where conditions
            this.whereConditions = this.whereConditions.filter(w => w.tableId !== tableId && w.tableAlias !== node.alias);

            this.notifyChange('remove-table', { tableId, table: node });
            return true;
        }

        getTable(tableId) {
            if (!tableId) return null;
            if (this.tables.has(tableId)) return this.tables.get(tableId);
            return this.getTableByAlias(tableId) || null;
        }

        getTableByAlias(alias) {
            if (!alias) return null;
            const clean = alias.toLowerCase().trim();
            for (const t of this.tables.values()) {
                if (t.alias.toLowerCase().trim() === clean || t.tableName.toLowerCase().trim() === clean) {
                    return t;
                }
            }
            return null;
        }

        addJoin(joinData) {
            const edge = joinData instanceof JoinEdge ? joinData : new JoinEdge(joinData);
            if (!edge.sourceTableId || !edge.targetTableId) return null;
            if (edge.sourceTableId === edge.targetTableId) return null;

            // Check if identical join already exists
            const existing = this.joins.find(j => 
                (j.sourceTableId === edge.sourceTableId && j.targetTableId === edge.targetTableId) ||
                (j.sourceTableId === edge.targetTableId && j.targetTableId === edge.sourceTableId)
            );
            if (existing) {
                // Merge conditions
                edge.conditions.forEach(c => {
                    const hasCond = existing.conditions.some(ec => 
                        (ec.leftColumn === c.leftColumn && ec.rightColumn === c.rightColumn) ||
                        (ec.leftColumn === c.rightColumn && ec.rightColumn === c.leftColumn)
                    );
                    if (!hasCond) existing.conditions.push(c);
                });
                this.notifyChange('update-join', { join: existing });
                return existing;
            }

            this.joins.push(edge);
            this.notifyChange('add-join', { join: edge });
            return edge;
        }

        removeJoin(joinId) {
            const idx = this.joins.findIndex(j => j.id === joinId);
            if (idx >= 0) {
                const removed = this.joins.splice(idx, 1)[0];
                this.notifyChange('remove-join', { join: removed });
                return true;
            }
            return false;
        }

        updateJoinType(joinId, newType) {
            const join = this.joins.find(j => j.id === joinId);
            if (join) {
                join.joinType = newType.toUpperCase();
                this.notifyChange('update-join', { join });
                return true;
            }
            return false;
        }

        isColumnSelected(tableId, columnName) {
            const targetCol = (columnName || '').toLowerCase().trim();
            return this.selectItems.some(s => s.tableId === tableId && s.column.toLowerCase().trim() === targetCol && s.output !== false);
        }

        toggleColumnSelection(tableId, columnName) {
            const table = this.tables.get(tableId);
            if (!table) return false;

            const targetCol = (columnName || '').trim();
            const existingIdx = this.selectItems.findIndex(s => 
                s.tableId === tableId && s.column.toLowerCase().trim() === targetCol.toLowerCase()
            );

            if (existingIdx >= 0) {
                // Remove from select
                this.selectItems.splice(existingIdx, 1);
                this.notifyChange('select-items-changed', { tableId, column: targetCol, selected: false });
                return false;
            } else {
                // Add to select
                const newItem = new SelectItem({
                    tableId: table.id,
                    tableAlias: table.alias,
                    column: targetCol,
                    alias: '',
                    output: true
                });
                this.selectItems.push(newItem);
                this.notifyChange('select-items-changed', { tableId, column: targetCol, selected: true });
                return true;
            }
        }

        setTablePosition(tableId, x, y) {
            const table = this.tables.get(tableId);
            if (table) {
                table.x = Math.max(10, x);
                table.y = Math.max(10, y);
                this.notifyChange('table-moved', { tableId, x: table.x, y: table.y });
            }
        }

        validate() {
            const errors = [];
            if (this.tables.size === 0 && !this.originalSql) {
                errors.push('Chưa có bảng nào được chọn trong câu truy vấn.');
            }
            return {
                isValid: errors.length === 0,
                errors
            };
        }

        clone() {
            const newModel = new QueryModel({
                dialect: this.dialect,
                originalSql: this.originalSql,
                tables: Array.from(this.tables.values()).map(t => t.clone()),
                joins: this.joins.map(j => j.clone()),
                selectItems: this.selectItems.map(s => s.clone()),
                whereConditions: this.whereConditions.map(w => w.clone()),
                groupByItems: [...this.groupByItems],
                havingConditions: [...this.havingConditions],
                orderByItems: this.orderByItems.map(o => ({ ...o })),
                distinct: this.distinct,
                topLimit: this.topLimit,
                unsupportedFragments: [...this.unsupportedFragments],
                parseStatus: this.parseStatus,
                syncStatus: this.syncStatus
            });
            return newModel;
        }

        toJSON() {
            return {
                dialect: this.dialect,
                originalSql: this.originalSql,
                tables: Array.from(this.tables.values()).map(t => ({
                    id: t.id,
                    database: t.database,
                    schema: t.schema,
                    tableName: t.tableName,
                    alias: t.alias,
                    sourceType: t.sourceType,
                    columns: t.columns,
                    x: t.x,
                    y: t.y,
                    isExpanded: t.isExpanded
                })),
                joins: this.joins.map(j => ({
                    id: j.id,
                    sourceTableId: j.sourceTableId,
                    targetTableId: j.targetTableId,
                    joinType: j.joinType,
                    conditions: j.conditions,
                    isInferred: j.isInferred
                })),
                selectItems: this.selectItems.map(s => ({
                    id: s.id,
                    tableId: s.tableId,
                    tableAlias: s.tableAlias,
                    column: s.column,
                    alias: s.alias,
                    output: s.output,
                    aggregate: s.aggregate,
                    sort: s.sort,
                    sortOrder: s.sortOrder,
                    criteria: s.criteria,
                    rawExpression: s.rawExpression
                })),
                whereConditions: this.whereConditions.map(w => ({
                    id: w.id,
                    tableId: w.tableId,
                    tableAlias: w.tableAlias,
                    column: w.column,
                    operator: w.operator,
                    value: w.value,
                    logic: w.logic,
                    rawSql: w.rawSql
                })),
                groupByItems: [...this.groupByItems],
                havingConditions: [...this.havingConditions],
                orderByItems: [...this.orderByItems],
                distinct: this.distinct,
                topLimit: this.topLimit,
                unsupportedFragments: [...this.unsupportedFragments],
                parseStatus: this.parseStatus,
                syncStatus: this.syncStatus
            };
        }

        static fromJSON(json) {
            return new QueryModel(json || {});
        }
    }

    /**
     * HistoryManager manages undo and redo stack of QueryModel states.
     */
    class HistoryManager {
        constructor(maxHistory = 30) {
            this.maxHistory = maxHistory;
            this.undoStack = [];
            this.redoStack = [];
            this.isTracking = true;
        }

        pushState(queryModel) {
            if (!this.isTracking || !queryModel) return;
            const snapshot = JSON.stringify(queryModel.toJSON());
            
            // Avoid duplicate consecutive states
            if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snapshot) {
                return;
            }

            this.undoStack.push(snapshot);
            if (this.undoStack.length > this.maxHistory) {
                this.undoStack.shift();
            }
            this.redoStack = [];
        }

        canUndo() {
            return this.undoStack.length > 1;
        }

        canRedo() {
            return this.redoStack.length > 0;
        }

        undo(currentModel) {
            if (!this.canUndo()) return null;
            const currentState = this.undoStack.pop();
            this.redoStack.push(currentState);
            
            const prevState = this.undoStack[this.undoStack.length - 1];
            if (!prevState) return null;
            
            this.isTracking = false;
            try {
                return QueryModel.fromJSON(JSON.parse(prevState));
            } finally {
                this.isTracking = true;
            }
        }

        redo() {
            if (!this.canRedo()) return null;
            const nextState = this.redoStack.pop();
            this.undoStack.push(nextState);

            this.isTracking = false;
            try {
                return QueryModel.fromJSON(JSON.parse(nextState));
            } finally {
                this.isTracking = true;
            }
        }

        clear() {
            this.undoStack = [];
            this.redoStack = [];
        }
    }

    window.SqlVisualization = window.SqlVisualization || {};
    window.SqlVisualization.TableNode = TableNode;
    window.SqlVisualization.JoinEdge = JoinEdge;
    window.SqlVisualization.SelectItem = SelectItem;
    window.SqlVisualization.WhereCondition = WhereCondition;
    window.SqlVisualization.QueryModel = QueryModel;
    window.SqlVisualization.HistoryManager = HistoryManager;

})(window);
