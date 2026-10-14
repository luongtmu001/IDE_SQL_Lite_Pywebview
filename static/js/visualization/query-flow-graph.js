/**
 * SQL Visualization — Query Flow Graph Model
 * Implements Phase 1 of .SKILL/query_plan_visualization.md
 * 
 * Provides an intermediate Directed Acyclic Graph (DAG) representation
 * of complex SQL queries (CTE, UNION/UNION ALL, Subqueries, Joins, Aggregates)
 * independent of D3.js and Monaco Editor.
 */

(function (window) {
    'use strict';

    const SqlVisualization = window.SqlVisualization || {};

    let idCounter = 1;
    function generateId(prefix = 'node_') {
        return `${prefix}${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
    }

    /**
     * SourceRange: represents exact text span in SQL code
     */
    class SourceRange {
        constructor(opts = {}) {
            this.startOffset = typeof opts.startOffset === 'number' ? opts.startOffset : 0;
            this.endOffset = typeof opts.endOffset === 'number' ? opts.endOffset : 0;
            this.startLine = typeof opts.startLine === 'number' ? opts.startLine : 1;
            this.startColumn = typeof opts.startColumn === 'number' ? opts.startColumn : 1;
            this.endLine = typeof opts.endLine === 'number' ? opts.endLine : 1;
            this.endColumn = typeof opts.endColumn === 'number' ? opts.endColumn : 1;
        }

        contains(line, col) {
            if (line < this.startLine || line > this.endLine) return false;
            if (line === this.startLine && col < this.startColumn) return false;
            if (line === this.endLine && col > this.endColumn) return false;
            return true;
        }

        toJSON() {
            return {
                startOffset: this.startOffset,
                endOffset: this.endOffset,
                startLine: this.startLine,
                startColumn: this.startColumn,
                endLine: this.endLine,
                endColumn: this.endColumn
            };
        }

        static fromJSON(d) {
            return new SourceRange(d || {});
        }
    }

    /**
     * Enumeration of all Query Node types (Section 4.1)
     */
    const QueryNodeType = Object.freeze({
        TABLE: 'Table',
        VIEW: 'View',
        CTE: 'CTE',
        SUBQUERY: 'Subquery',
        DERIVED_TABLE: 'DerivedTable',
        SELECT: 'Select',
        JOIN: 'Join',
        FILTER: 'Filter',
        AGGREGATE: 'Aggregate',
        UNION: 'Union',
        SORT: 'Sort',
        DISTINCT: 'Distinct',
        FINAL_RESULT: 'FinalResult',
        UNKNOWN: 'Unknown'
    });

    /**
     * Enumeration of all Query Edge types (Section 4.2)
     */
    const QueryEdgeType = Object.freeze({
        DATA_FLOW: 'data_flow',
        DEPENDENCY: 'dependency',
        UNION_BRANCH: 'union_branch',
        CTE_REFERENCE: 'cte_reference',
        SUBQUERY_INPUT: 'subquery_input',
        JOIN_INPUT: 'join_input',
        RECURSIVE_CYCLE: 'recursive_cycle'
    });

    /**
     * QueryNode: encapsulates any query component in the Flow Graph
     */
    class QueryNode {
        constructor(opts = {}) {
            this.id = opts.id || generateId('qnode_');
            this.nodeType = opts.nodeType || QueryNodeType.TABLE;
            this.label = opts.label || this.nodeType;
            this.schema = opts.schema || '';
            this.tableName = opts.tableName || '';
            this.alias = opts.alias || '';
            this.columns = Array.isArray(opts.columns) ? opts.columns.map(c => ({
                name: c.name || '',
                type: c.type || 'varchar',
                isPk: !!c.isPk,
                isFk: !!c.isFk
            })) : [];

            this.sourceRange = opts.sourceRange instanceof SourceRange
                ? opts.sourceRange
                : new SourceRange(opts.sourceRange || {});

            this.sourceOrder = typeof opts.sourceOrder === 'number' ? opts.sourceOrder : 0;
            this.logicalStep = typeof opts.logicalStep === 'number' ? opts.logicalStep : 0;

            this.sqlFragment = opts.sqlFragment || '';
            this.status = opts.status || 'valid'; // 'valid' | 'warning' | 'unsupported' | 'recursive'

            this.isExpandable = !!opts.isExpandable;
            this.isExpanded = opts.isExpanded !== undefined ? opts.isExpanded : true;
            this.children = Array.isArray(opts.children) ? [...opts.children] : [];

            this.metadata = typeof opts.metadata === 'object' && opts.metadata !== null
                ? { ...opts.metadata }
                : {};

            this.x = typeof opts.x === 'number' ? opts.x : 0;
            this.y = typeof opts.y === 'number' ? opts.y : 0;
        }

        toJSON() {
            return {
                id: this.id,
                nodeType: this.nodeType,
                label: this.label,
                schema: this.schema,
                tableName: this.tableName,
                alias: this.alias,
                columns: this.columns,
                sourceRange: this.sourceRange ? this.sourceRange.toJSON() : null,
                sourceOrder: this.sourceOrder,
                logicalStep: this.logicalStep,
                sqlFragment: this.sqlFragment,
                status: this.status,
                isExpandable: this.isExpandable,
                isExpanded: this.isExpanded,
                children: this.children,
                metadata: this.metadata,
                x: this.x,
                y: this.y
            };
        }

        static fromJSON(d) {
            return new QueryNode(d || {});
        }

        clone() {
            return new QueryNode({
                ...this.toJSON(),
                id: generateId('qnode_copy_')
            });
        }
    }

    /**
     * QueryEdge: directed connection from data producer to data consumer
     * Convention: Edge goes from Source/Earlier Step -> Consumer/Later Step
     */
    class QueryEdge {
        constructor(opts = {}) {
            this.id = opts.id || generateId('qedge_');
            this.sourceNodeId = opts.sourceNodeId || '';
            this.targetNodeId = opts.targetNodeId || '';
            this.edgeType = opts.edgeType || QueryEdgeType.DATA_FLOW;
            this.label = opts.label || '';
            this.metadata = typeof opts.metadata === 'object' && opts.metadata !== null
                ? { ...opts.metadata }
                : {};
        }

        toJSON() {
            return {
                id: this.id,
                sourceNodeId: this.sourceNodeId,
                targetNodeId: this.targetNodeId,
                edgeType: this.edgeType,
                label: this.label,
                metadata: this.metadata
            };
        }

        static fromJSON(d) {
            return new QueryEdge(d || {});
        }

        clone() {
            return new QueryEdge({
                ...this.toJSON(),
                id: generateId('qedge_copy_')
            });
        }
    }

    /**
     * QueryFlowGraph: Directed Acyclic Graph (DAG) manager
     */
    class QueryFlowGraph {
        constructor(opts = {}) {
            this.id = opts.id || generateId('qflow_');
            this.dialect = opts.dialect || 'sqlserver';
            this.originalSql = opts.originalSql || '';
            this.nodes = new Map(); // id -> QueryNode
            this.edges = [];        // QueryEdge[]

            if (Array.isArray(opts.nodes)) {
                opts.nodes.forEach(n => this.addNode(n instanceof QueryNode ? n : new QueryNode(n)));
            }
            if (Array.isArray(opts.edges)) {
                opts.edges.forEach(e => this.addEdge(e instanceof QueryEdge ? e : new QueryEdge(e)));
            }
        }

        addNode(node) {
            if (!node || !node.id) return;
            this.nodes.set(node.id, node);
            return node;
        }

        removeNode(nodeId) {
            this.nodes.delete(nodeId);
            this.edges = this.edges.filter(e => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId);
        }

        getNode(nodeId) {
            return this.nodes.get(nodeId) || null;
        }

        hasNode(nodeId) {
            return this.nodes.has(nodeId);
        }

        addEdge(edge) {
            if (!edge || !edge.id || !edge.sourceNodeId || !edge.targetNodeId) return;
            this.edges.push(edge);
            return edge;
        }

        removeEdge(edgeId) {
            this.edges = this.edges.filter(e => e.id !== edgeId);
        }

        getIncomingEdges(nodeId) {
            return this.edges.filter(e => e.targetNodeId === nodeId);
        }

        getOutgoingEdges(nodeId) {
            return this.edges.filter(e => e.sourceNodeId === nodeId);
        }

        getPredecessors(nodeId) {
            const inEdges = this.getIncomingEdges(nodeId);
            return inEdges
                .map(e => this.getNode(e.sourceNodeId))
                .filter(Boolean);
        }

        getSuccessors(nodeId) {
            const outEdges = this.getOutgoingEdges(nodeId);
            return outEdges
                .map(e => this.getNode(e.targetNodeId))
                .filter(Boolean);
        }

        getRootNodes() {
            return Array.from(this.nodes.values()).filter(n => this.getIncomingEdges(n.id).length === 0);
        }

        getLeafNodes() {
            return Array.from(this.nodes.values()).filter(n => this.getOutgoingEdges(n.id).length === 0);
        }

        /**
         * Topological sort & Stable Logical Step Numbering (Section 8.2)
         *
         * Rules:
         * 1. Multi-input nodes (JOIN, UNION) are only numbered when ALL prerequisite inputs are satisfied.
         * 2. Cycles (recursive CTE) are detected: anchor member evaluated first, recursive cycle marked.
         * 3. Stable tie-breaking priority:
         *    a. Prerequisite dependency depth
         *    b. sourceOrder / startLine
         *    c. nodeType precedence (Source -> Transform -> Combine -> Final)
         *    d. Lexicographical ID
         */
        computeLogicalSteps() {
            const nodesArr = Array.from(this.nodes.values());
            if (nodesArr.length === 0) return [];

            // Calculate in-degree for each node, excluding explicit recursive cycles
            const inDegree = new Map();
            const adj = new Map(); // sourceId -> [targetId]

            nodesArr.forEach(n => {
                inDegree.set(n.id, 0);
                adj.set(n.id, []);
            });

            this.edges.forEach(e => {
                // If marked as recursive cycle back-edge, do not count in in-degree for initial DAG order
                if (e.edgeType === QueryEdgeType.RECURSIVE_CYCLE || e.metadata?.isCycle) {
                    return;
                }
                if (this.nodes.has(e.sourceNodeId) && this.nodes.has(e.targetNodeId)) {
                    inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) || 0) + 1);
                    adj.get(e.sourceNodeId).push(e.targetNodeId);
                }
            });

            // Tie-breaking comparator
            const nodeTypePrecedence = {
                [QueryNodeType.TABLE]: 1,
                [QueryNodeType.VIEW]: 1,
                [QueryNodeType.CTE]: 2,
                [QueryNodeType.SUBQUERY]: 3,
                [QueryNodeType.DERIVED_TABLE]: 3,
                [QueryNodeType.FILTER]: 4,
                [QueryNodeType.AGGREGATE]: 5,
                [QueryNodeType.JOIN]: 6,
                [QueryNodeType.UNION]: 7,
                [QueryNodeType.SORT]: 8,
                [QueryNodeType.DISTINCT]: 9,
                [QueryNodeType.SELECT]: 10,
                [QueryNodeType.FINAL_RESULT]: 11,
                [QueryNodeType.UNKNOWN]: 12
            };

            const compareNodes = (a, b) => {
                // 1. Source order (line in SQL)
                const ordA = a.sourceOrder || a.sourceRange?.startLine || 0;
                const ordB = b.sourceOrder || b.sourceRange?.startLine || 0;
                if (ordA !== ordB) return ordA - ordB;

                // 2. Node type logical precedence
                const precA = nodeTypePrecedence[a.nodeType] || 99;
                const precB = nodeTypePrecedence[b.nodeType] || 99;
                if (precA !== precB) return precA - precB;

                // 3. Stable string ID comparison
                return String(a.id).localeCompare(String(b.id));
            };

            // Ready queue: nodes with inDegree === 0
            let readyQueue = nodesArr.filter(n => inDegree.get(n.id) === 0);
            readyQueue.sort(compareNodes);

            const sorted = [];
            let currentStep = 1;

            while (readyQueue.length > 0) {
                const node = readyQueue.shift();
                node.logicalStep = currentStep++;
                sorted.push(node);

                const neighbors = adj.get(node.id) || [];
                const newlyReady = [];

                neighbors.forEach(tgtId => {
                    const d = inDegree.get(tgtId) - 1;
                    inDegree.set(tgtId, d);
                    if (d === 0) {
                        const tgtNode = this.getNode(tgtId);
                        if (tgtNode) newlyReady.push(tgtNode);
                    }
                });

                if (newlyReady.length > 0) {
                    readyQueue.push(...newlyReady);
                    readyQueue.sort(compareNodes);
                }
            }

            // Fallback for any cyclic/unvisited nodes (e.g. recursive CTE self-loops)
            nodesArr.forEach(n => {
                if (!sorted.includes(n)) {
                    n.logicalStep = currentStep++;
                    if (n.status !== 'recursive') n.status = 'warning';
                    sorted.push(n);
                }
            });

            return sorted;
        }

        /**
         * Finds the most specific QueryNode enclosing the given source line & column
         */
        findNodeAtSourcePosition(line, col) {
            let bestMatch = null;
            let smallestSpan = Infinity;

            for (const node of this.nodes.values()) {
                if (node.sourceRange && node.sourceRange.contains(line, col)) {
                    const span = (node.sourceRange.endLine - node.sourceRange.startLine) * 1000 +
                        (node.sourceRange.endColumn - node.sourceRange.startColumn);
                    if (span < smallestSpan) {
                        smallestSpan = span;
                        bestMatch = node;
                    }
                }
            }

            return bestMatch;
        }

        toJSON() {
            return {
                id: this.id,
                dialect: this.dialect,
                originalSql: this.originalSql,
                nodes: Array.from(this.nodes.values()).map(n => n.toJSON()),
                edges: this.edges.map(e => e.toJSON())
            };
        }

        static fromJSON(data) {
            if (!data) return new QueryFlowGraph();
            return new QueryFlowGraph({
                id: data.id,
                dialect: data.dialect,
                originalSql: data.originalSql,
                nodes: (data.nodes || []).map(QueryNode.fromJSON),
                edges: (data.edges || []).map(QueryEdge.fromJSON)
            });
        }
    }

    // Attach to namespace
    SqlVisualization.SourceRange = SourceRange;
    SqlVisualization.QueryNodeType = QueryNodeType;
    SqlVisualization.QueryEdgeType = QueryEdgeType;
    SqlVisualization.QueryNode = QueryNode;
    SqlVisualization.QueryEdge = QueryEdge;
    SqlVisualization.QueryFlowGraph = QueryFlowGraph;

    window.SqlVisualization = SqlVisualization;

})(typeof window !== 'undefined' ? window : globalThis);
