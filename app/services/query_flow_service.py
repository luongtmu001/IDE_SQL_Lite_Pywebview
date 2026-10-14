# -*- coding: utf-8 -*-
"""
Query Flow Service — AST Analysis & Query Flow Graph Generation
Complies with Phase 1 of .SKILL/query_plan_visualization.md
"""

from typing import Dict, List, Optional, Any, Set
import re
import sqlglot
from sqlglot import exp


class SourceRange:
    def __init__(
        self,
        start_offset: int = 0,
        end_offset: int = 0,
        start_line: int = 1,
        start_column: int = 1,
        end_line: int = 1,
        end_column: int = 1,
    ):
        self.start_offset = start_offset
        self.end_offset = end_offset
        self.start_line = start_line
        self.start_column = start_column
        self.end_line = end_line
        self.end_column = end_column

    def contains(self, line: int, col: int) -> bool:
        if line < self.start_line or line > self.end_line:
            return False
        if line == self.start_line and col < self.start_column:
            return False
        if line == self.end_line and col > self.end_column:
            return False
        return True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "startOffset": self.start_offset,
            "endOffset": self.end_offset,
            "startLine": self.start_line,
            "startColumn": self.start_column,
            "endLine": self.end_line,
            "endColumn": self.end_column,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "SourceRange":
        return cls(
            start_offset=d.get("startOffset", 0),
            end_offset=d.get("endOffset", 0),
            start_line=d.get("startLine", 1),
            start_column=d.get("startColumn", 1),
            end_line=d.get("endLine", 1),
            end_column=d.get("endColumn", 1),
        )


def find_source_range(full_sql: str, fragment: str) -> SourceRange:
    """
    Computes precise 1-based SourceRange from character indices in SQL text.
    """
    if not full_sql or not fragment:
        return SourceRange()
    clean_frag = fragment.strip().rstrip(";")
    start_idx = full_sql.find(clean_frag)
    if start_idx == -1:
        start_idx = full_sql.lower().find(clean_frag.lower())
    if start_idx == -1:
        return SourceRange()
    end_idx = start_idx + len(clean_frag)

    lines = full_sql.splitlines(keepends=True)
    cur_offset = 0
    start_line, start_col = 1, 1
    end_line, end_col = 1, 1
    start_found = False

    for line_num, line in enumerate(lines, start=1):
        line_len = len(line)
        if not start_found and cur_offset <= start_idx <= cur_offset + line_len:
            start_line = line_num
            start_col = (start_idx - cur_offset) + 1
            start_found = True
        if cur_offset <= end_idx <= cur_offset + line_len:
            end_line = line_num
            end_col = (end_idx - cur_offset) + 1
            break
        cur_offset += line_len

    return SourceRange(
        start_offset=start_idx,
        end_offset=end_idx,
        start_line=start_line,
        start_column=start_col,
        end_line=end_line,
        end_column=end_col,
    )



class QueryNodeType:
    TABLE = "Table"
    VIEW = "View"
    CTE = "CTE"
    SUBQUERY = "Subquery"
    DERIVED_TABLE = "DerivedTable"
    SELECT = "Select"
    JOIN = "Join"
    FILTER = "Filter"
    AGGREGATE = "Aggregate"
    UNION = "Union"
    SORT = "Sort"
    DISTINCT = "Distinct"
    FINAL_RESULT = "FinalResult"
    UNKNOWN = "Unknown"


class QueryEdgeType:
    DATA_FLOW = "data_flow"
    DEPENDENCY = "dependency"
    UNION_BRANCH = "union_branch"
    CTE_REFERENCE = "cte_reference"
    SUBQUERY_INPUT = "subquery_input"
    JOIN_INPUT = "join_input"
    RECURSIVE_CYCLE = "recursive_cycle"


class QueryNode:
    def __init__(
        self,
        node_id: str,
        node_type: str = QueryNodeType.TABLE,
        label: str = "",
        schema: str = "",
        table_name: str = "",
        alias: str = "",
        columns: Optional[List[Dict[str, Any]]] = None,
        source_range: Optional[SourceRange] = None,
        source_order: int = 0,
        logical_step: int = 0,
        sql_fragment: str = "",
        status: str = "valid",
        is_expandable: bool = False,
        is_expanded: bool = True,
        children: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        x: float = 0.0,
        y: float = 0.0,
    ):
        self.id = node_id
        self.node_type = node_type
        self.label = label or node_type
        self.schema = schema
        self.table_name = table_name
        self.alias = alias
        self.columns = columns or []
        self.source_range = source_range or SourceRange()
        self.source_order = source_order
        self.logical_step = logical_step
        self.sql_fragment = sql_fragment
        self.status = status
        self.is_expandable = is_expandable
        self.is_expanded = is_expanded
        self.children = children or []
        self.metadata = metadata or {}
        self.x = x
        self.y = y

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "nodeType": self.node_type,
            "label": self.label,
            "schema": self.schema,
            "tableName": self.table_name,
            "alias": self.alias,
            "columns": self.columns,
            "sourceRange": self.source_range.to_dict() if self.source_range else None,
            "sourceOrder": self.source_order,
            "logicalStep": self.logical_step,
            "sqlFragment": self.sql_fragment,
            "status": self.status,
            "isExpandable": self.is_expandable,
            "isExpanded": self.is_expanded,
            "children": self.children,
            "metadata": self.metadata,
            "x": self.x,
            "y": self.y,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "QueryNode":
        sr_dict = d.get("sourceRange")
        sr = SourceRange.from_dict(sr_dict) if sr_dict else None
        return cls(
            node_id=d.get("id", ""),
            node_type=d.get("nodeType", QueryNodeType.TABLE),
            label=d.get("label", ""),
            schema=d.get("schema", ""),
            table_name=d.get("tableName", ""),
            alias=d.get("alias", ""),
            columns=d.get("columns", []),
            source_range=sr,
            source_order=d.get("sourceOrder", 0),
            logical_step=d.get("logicalStep", 0),
            sql_fragment=d.get("sqlFragment", ""),
            status=d.get("status", "valid"),
            is_expandable=d.get("isExpandable", False),
            is_expanded=d.get("isExpanded", True),
            children=d.get("children", []),
            metadata=d.get("metadata", {}),
            x=d.get("x", 0.0),
            y=d.get("y", 0.0),
        )


class QueryEdge:
    def __init__(
        self,
        edge_id: str,
        source_node_id: str,
        target_node_id: str,
        edge_type: str = QueryEdgeType.DATA_FLOW,
        label: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.id = edge_id
        self.source_node_id = source_node_id
        self.target_node_id = target_node_id
        self.edge_type = edge_type
        self.label = label
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "sourceNodeId": self.source_node_id,
            "targetNodeId": self.target_node_id,
            "edgeType": self.edge_type,
            "label": self.label,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "QueryEdge":
        return cls(
            edge_id=d.get("id", ""),
            source_node_id=d.get("sourceNodeId", ""),
            target_node_id=d.get("targetNodeId", ""),
            edge_type=d.get("edgeType", QueryEdgeType.DATA_FLOW),
            label=d.get("label", ""),
            metadata=d.get("metadata", {}),
        )


class QueryFlowGraph:
    def __init__(self, graph_id: str = "qflow_main", dialect: str = "tsql", original_sql: str = ""):
        self.id = graph_id
        self.dialect = dialect
        self.original_sql = original_sql
        self.nodes: Dict[str, QueryNode] = {}
        self.edges: List[QueryEdge] = []

    def add_node(self, node: QueryNode) -> QueryNode:
        self.nodes[node.id] = node
        return node

    def remove_node(self, node_id: str) -> None:
        if node_id in self.nodes:
            del self.nodes[node_id]
        self.edges = [e for e in self.edges if e.source_node_id != node_id and e.target_node_id != node_id]

    def get_node(self, node_id: str) -> Optional[QueryNode]:
        return self.nodes.get(node_id)

    def has_node(self, node_id: str) -> bool:
        return node_id in self.nodes

    def add_edge(self, edge: QueryEdge) -> QueryEdge:
        self.edges.append(edge)
        return edge

    def get_incoming_edges(self, node_id: str) -> List[QueryEdge]:
        return [e for e in self.edges if e.target_node_id == node_id]

    def get_outgoing_edges(self, node_id: str) -> List[QueryEdge]:
        return [e for e in self.edges if e.source_node_id == node_id]

    def get_predecessors(self, node_id: str) -> List[QueryNode]:
        in_edges = self.get_incoming_edges(node_id)
        result = []
        for e in in_edges:
            n = self.get_node(e.source_node_id)
            if n:
                result.append(n)
        return result

    def get_successors(self, node_id: str) -> List[QueryNode]:
        out_edges = self.get_outgoing_edges(node_id)
        result = []
        for e in out_edges:
            n = self.get_node(e.target_node_id)
            if n:
                result.append(n)
        return result

    def find_node_at_source_position(self, line: int, col: int) -> Optional[QueryNode]:
        """
        Finds the most specific QueryNode enclosing the given source line & column.
        """
        best_match = None
        smallest_span = float("inf")

        for node in self.nodes.values():
            if node.source_range and node.source_range.contains(line, col):
                span = (node.source_range.end_line - node.source_range.start_line) * 1000 + (
                    node.source_range.end_column - node.source_range.start_column
                )
                if span < smallest_span:
                    smallest_span = span
                    best_match = node

        return best_match

    def compute_logical_steps(self) -> List[QueryNode]:
        """
        Computes 1-based topological logical step numbers.
        Handles multi-input joins/unions, cycles (recursive CTEs), and stable tie-breaking.
        """
        nodes_list = list(self.nodes.values())
        if not nodes_list:
            return []

        in_degree: Dict[str, int] = {n.id: 0 for n in nodes_list}
        adj: Dict[str, List[str]] = {n.id: [] for n in nodes_list}

        for e in self.edges:
            # Skip cycle edges for initial in-degree to prevent deadlock
            if e.edge_type == QueryEdgeType.RECURSIVE_CYCLE or e.metadata.get("isCycle"):
                continue
            if e.source_node_id in self.nodes and e.target_node_id in self.nodes:
                in_degree[e.target_node_id] += 1
                adj[e.source_node_id].append(e.target_node_id)

        node_type_prec = {
            QueryNodeType.TABLE: 1,
            QueryNodeType.VIEW: 1,
            QueryNodeType.CTE: 2,
            QueryNodeType.SUBQUERY: 3,
            QueryNodeType.DERIVED_TABLE: 3,
            QueryNodeType.FILTER: 4,
            QueryNodeType.AGGREGATE: 5,
            QueryNodeType.JOIN: 6,
            QueryNodeType.UNION: 7,
            QueryNodeType.SORT: 8,
            QueryNodeType.DISTINCT: 9,
            QueryNodeType.SELECT: 10,
            QueryNodeType.FINAL_RESULT: 11,
            QueryNodeType.UNKNOWN: 12,
        }

        def sort_key(n: QueryNode):
            return (
                n.source_order or (n.source_range.start_line if n.source_range else 0),
                node_type_prec.get(n.node_type, 99),
                n.id,
            )

        ready_queue = [n for n in nodes_list if in_degree[n.id] == 0]
        ready_queue.sort(key=sort_key)

        sorted_nodes: List[QueryNode] = []
        current_step = 1

        while ready_queue:
            node = ready_queue.pop(0)
            node.logical_step = current_step
            current_step += 1
            sorted_nodes.append(node)

            for target_id in adj.get(node.id, []):
                in_degree[target_id] -= 1
                if in_degree[target_id] == 0:
                    target_node = self.get_node(target_id)
                    if target_node:
                        ready_queue.append(target_node)
                        ready_queue.sort(key=sort_key)

        # Cyclic nodes fallback (e.g. recursive members)
        for n in nodes_list:
            if n not in sorted_nodes:
                n.logical_step = current_step
                current_step += 1
                if n.status != "recursive":
                    n.status = "warning"
                sorted_nodes.append(n)

        return sorted_nodes

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "dialect": self.dialect,
            "originalSql": self.original_sql,
            "nodes": [n.to_dict() for n in self.nodes.values()],
            "edges": [e.to_dict() for e in self.edges],
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "QueryFlowGraph":
        graph = cls(
            graph_id=d.get("id", "qflow_main"),
            dialect=d.get("dialect", "tsql"),
            original_sql=d.get("originalSql", ""),
        )
        for nd in d.get("nodes", []):
            graph.add_node(QueryNode.from_dict(nd))
        for ed in d.get("edges", []):
            graph.add_edge(QueryEdge.from_dict(ed))
        return graph


class QueryFlowService:
    """
    High-level analyzer that converts complex SQL statements into a QueryFlowGraph.
    """

    @staticmethod
    def _normalize_dialect(dialect: str) -> str:
        d = (dialect or "").lower().strip()
        if "postgre" in d or "pg" in d:
            return "postgres"
        return "tsql"

    @classmethod
    def build_flow_graph(cls, sql: str, dialect: str = "tsql") -> QueryFlowGraph:
        read_dialect = cls._normalize_dialect(dialect)
        graph = QueryFlowGraph(dialect=read_dialect, original_sql=sql)

        if not sql or not sql.strip():
            return graph

        clean_sql = sql.strip().rstrip(";")

        try:
            tree = sqlglot.parse_one(clean_sql, read=read_dialect)
        except Exception:
            # Fallback to basic dialect if parsing with specific dialect fails
            try:
                tree = sqlglot.parse_one(clean_sql)
            except Exception:
                # If sqlglot completely fails, construct fallback single node
                single_node = QueryNode(
                    node_id="node_fallback",
                    node_type=QueryNodeType.UNKNOWN,
                    label="Query",
                    sql_fragment=clean_sql,
                    status="warning",
                )
                graph.add_node(single_node)
                graph.compute_logical_steps()
                return graph

        cls._analyze_ast_into_graph(tree, graph, read_dialect, clean_sql)
        graph.compute_logical_steps()
        return graph

    @classmethod
    def _analyze_ast_into_graph(
        cls,
        tree: exp.Expression,
        graph: QueryFlowGraph,
        dialect: str,
        full_sql: str,
    ) -> None:
        cte_nodes: Dict[str, QueryNode] = {}
        cte_table_refs: Dict[str, Set[str]] = {}
        outer_referenced_ctes: Set[str] = set()

        # 1. Identify CTEs (Common Table Expressions)
        with_exp = tree.find(exp.With)
        if with_exp:
            ctes = list(with_exp.find_all(exp.CTE))
            for order_idx, cte in enumerate(ctes, start=1):
                cte_name = cte.alias
                inner_sql = cte.this.sql(dialect) if cte.this else ""

                # Discover inner tables and CTEs referenced inside this CTE
                inner_tables = [t.name for t in cte.find_all(exp.Table) if t.name]
                cte_table_refs[cte_name] = set(inner_tables)

                is_recursive = cte_name in inner_tables

                cte_node = QueryNode(
                    node_id=f"cte_{cte_name}",
                    node_type=QueryNodeType.CTE,
                    label=f"CTE: {cte_name}",
                    alias=cte_name,
                    sql_fragment=inner_sql,
                    source_range=find_source_range(full_sql, cte_name),
                    source_order=order_idx,
                    status="recursive" if is_recursive else "valid",
                    metadata={"cteName": cte_name, "isRecursive": is_recursive},
                )
                graph.add_node(cte_node)
                cte_nodes[cte_name] = cte_node

                # Create nodes for source tables within this CTE
                for tbl in cte.find_all(exp.Table):
                    t_name = tbl.name
                    if not t_name:
                        continue
                    if t_name == cte_name:
                        # Recursive self-loop edge
                        graph.add_edge(
                            QueryEdge(
                                edge_id=f"edge_rec_{cte_name}",
                                source_node_id=cte_node.id,
                                target_node_id=cte_node.id,
                                edge_type=QueryEdgeType.RECURSIVE_CYCLE,
                                label="Recursive Member",
                                metadata={"isCycle": True},
                            )
                        )
                    elif t_name in cte_nodes:
                        # CTE depending on another CTE (e.g. CTE_B -> CTE_A)
                        graph.add_edge(
                            QueryEdge(
                                edge_id=f"edge_cte_dep_{t_name}_{cte_name}",
                                source_node_id=cte_nodes[t_name].id,
                                target_node_id=cte_node.id,
                                edge_type=QueryEdgeType.CTE_REFERENCE,
                                label=f"References {t_name}",
                            )
                        )
                    else:
                        # Physical source table feeding into this CTE
                        schema_name = tbl.db or ""
                        tbl_id = f"table_{schema_name}_{t_name}_{cte_name}".strip("_")
                        if not graph.has_node(tbl_id):
                            tbl_node = QueryNode(
                                node_id=tbl_id,
                                node_type=QueryNodeType.TABLE,
                                label=f"Table: {t_name}",
                                schema=schema_name,
                                table_name=t_name,
                                source_range=find_source_range(full_sql, t_name),
                                source_order=0,
                            )
                            graph.add_node(tbl_node)

                        if tbl_id not in cte_node.children:
                            cte_node.children.append(tbl_id)

                        # Check if Aggregate inside CTE
                        agg_funcs = list(cte.find_all(exp.AggFunc))
                        has_group = bool(cte.find(exp.Group))
                        if agg_funcs or has_group:
                            agg_id = f"agg_{cte_name}"
                            if not graph.has_node(agg_id):
                                agg_node = QueryNode(
                                    node_id=agg_id,
                                    node_type=QueryNodeType.AGGREGATE,
                                    label="GROUP BY / Aggregate",
                                    source_order=order_idx,
                                )
                                graph.add_node(agg_node)
                                graph.add_edge(
                                    QueryEdge(
                                        edge_id=f"edge_tbl_agg_{tbl_id}_{agg_id}",
                                        source_node_id=tbl_id,
                                        target_node_id=agg_id,
                                        edge_type=QueryEdgeType.DATA_FLOW,
                                    )
                                )
                                graph.add_edge(
                                    QueryEdge(
                                        edge_id=f"edge_agg_cte_{agg_id}_{cte_node.id}",
                                        source_node_id=agg_id,
                                        target_node_id=cte_node.id,
                                        edge_type=QueryEdgeType.DATA_FLOW,
                                    )
                                )
                            if agg_id not in cte_node.children:
                                cte_node.children.append(agg_id)
                        else:
                            graph.add_edge(
                                QueryEdge(
                                    edge_id=f"edge_src_cte_{tbl_id}_{cte_node.id}",
                                    source_node_id=tbl_id,
                                    target_node_id=cte_node.id,
                                    edge_type=QueryEdgeType.DATA_FLOW,
                                    label="Source Feed",
                                )
                            )
                cte_node.is_expandable = len(cte_node.children) > 0

        # 2. Main Query body (outside WITH clause)
        main_body = tree
        if isinstance(tree, exp.Create) and tree.expression:
            main_body = tree.expression
        elif isinstance(tree, exp.Select) and tree.parent and isinstance(tree.parent, exp.With):
            main_body = tree

        # Handle UNION / UNION ALL
        if isinstance(main_body, exp.Union):
            cls._process_union(main_body, graph, dialect, cte_nodes, outer_referenced_ctes, full_sql)
            # Mark unreferenced CTEs for UNION queries
            all_referenced_ctes = set(outer_referenced_ctes)
            changed = True
            while changed:
                changed = False
                for c_name in list(all_referenced_ctes):
                    for dep in cte_table_refs.get(c_name, set()):
                        if dep in cte_nodes and dep not in all_referenced_ctes:
                            all_referenced_ctes.add(dep)
                            changed = True
            for cte_name, cte_node in cte_nodes.items():
                if cte_name not in all_referenced_ctes:
                    cte_node.status = "warning"
                    cte_node.metadata["isReferenced"] = False
            return

        # 3. Main SELECT Query Decomposition
        active_feeds: List[str] = []

        # 3A. Derived Tables (Subqueries in FROM and JOIN)
        from_clause = main_body.find(exp.From)
        join_clauses = list(main_body.find_all(exp.Join))
        from_subqueries: List[exp.Subquery] = []
        if from_clause:
            from_subqueries.extend(from_clause.find_all(exp.Subquery))
        for j in join_clauses:
            from_subqueries.extend(j.find_all(exp.Subquery))

        subquery_nodes: Dict[exp.Subquery, QueryNode] = {}
        for sq_idx, sub in enumerate(from_subqueries, start=1):
            sub_alias = sub.alias or f"sub_{sq_idx}"
            sub_id = f"derived_{sub_alias}"
            sub_sql = sub.this.sql(dialect) if sub.this else ""

            derived_node = QueryNode(
                node_id=sub_id,
                node_type=QueryNodeType.DERIVED_TABLE,
                label=f"Derived Table: {sub_alias}",
                alias=sub_alias,
                sql_fragment=sub_sql,
                source_range=find_source_range(full_sql, sub_alias),
                source_order=20 + sq_idx,
            )
            graph.add_node(derived_node)
            subquery_nodes[sub] = derived_node

        # Parent-child linking for nested derived tables
        for sub, derived_node in subquery_nodes.items():
            parent_sub = None
            curr = sub.parent
            while curr:
                if isinstance(curr, exp.Subquery) and curr in subquery_nodes:
                    parent_sub = curr
                    break
                curr = curr.parent

            if parent_sub:
                # Nested: inner feeds into outer
                parent_node = subquery_nodes[parent_sub]
                if derived_node.id not in parent_node.children:
                    parent_node.children.append(derived_node.id)
                parent_node.is_expandable = True
                graph.add_edge(
                    QueryEdge(
                        edge_id=f"edge_nested_{derived_node.id}_{parent_node.id}",
                        source_node_id=derived_node.id,
                        target_node_id=parent_node.id,
                        edge_type=QueryEdgeType.DATA_FLOW,
                        label="Nested Input",
                    )
                )
            else:
                # Outermost derived table feeds the main query
                active_feeds.append(derived_node.id)

            # Discover inner tables strictly belonging to this derived table (not inside a deeper child subquery)
            for tbl in sub.find_all(exp.Table):
                # Ensure tbl is not inside a nested child subquery of this subquery
                tbl_parent_sub = None
                curr_t = tbl.parent
                while curr_t and curr_t != sub:
                    if isinstance(curr_t, exp.Subquery):
                        tbl_parent_sub = curr_t
                        break
                    curr_t = curr_t.parent

                if tbl_parent_sub:
                    continue  # Owned by deeper subquery

                t_name = tbl.name
                if not t_name:
                    continue
                if t_name in cte_nodes:
                    outer_referenced_ctes.add(t_name)
                    graph.add_edge(
                        QueryEdge(
                            edge_id=f"edge_cte_sub_{t_name}_{derived_node.id}",
                            source_node_id=cte_nodes[t_name].id,
                            target_node_id=derived_node.id,
                            edge_type=QueryEdgeType.CTE_REFERENCE,
                            label=f"From {t_name}",
                        )
                    )
                else:
                    schema_name = tbl.db or ""
                    tbl_id = f"tbl_sub_{schema_name}_{t_name}_{derived_node.alias}".strip("_")
                    if not graph.has_node(tbl_id):
                        tbl_node = QueryNode(
                            node_id=tbl_id,
                            node_type=QueryNodeType.TABLE,
                            label=f"Table: {t_name}",
                            schema=schema_name,
                            table_name=t_name,
                            source_range=find_source_range(full_sql, t_name),
                            source_order=10 + sq_idx,
                        )
                        graph.add_node(tbl_node)

                    if tbl_id not in derived_node.children:
                        derived_node.children.append(tbl_id)

                    # Aggregates inside this derived table?
                    has_agg = bool(sub.find(exp.AggFunc) or sub.find(exp.Group))
                    if has_agg:
                        agg_id = f"agg_sub_{derived_node.alias}"
                        if not graph.has_node(agg_id):
                            agg_node = QueryNode(
                                node_id=agg_id,
                                node_type=QueryNodeType.AGGREGATE,
                                label="Aggregate",
                                source_order=15 + sq_idx,
                            )
                            graph.add_node(agg_node)
                            graph.add_edge(
                                QueryEdge(
                                    edge_id=f"edge_tbl_agg_{tbl_id}",
                                    source_node_id=tbl_id,
                                    target_node_id=agg_id,
                                    edge_type=QueryEdgeType.DATA_FLOW,
                                )
                            )
                            graph.add_edge(
                                QueryEdge(
                                    edge_id=f"edge_agg_sub_{agg_id}",
                                    source_node_id=agg_id,
                                    target_node_id=derived_node.id,
                                    edge_type=QueryEdgeType.DATA_FLOW,
                                )
                            )
                        if agg_id not in derived_node.children:
                            derived_node.children.append(agg_id)
                    else:
                        graph.add_edge(
                            QueryEdge(
                                edge_id=f"edge_sub_feed_{tbl_id}_{derived_node.id}",
                                source_node_id=tbl_id,
                                target_node_id=derived_node.id,
                                edge_type=QueryEdgeType.SUBQUERY_INPUT,
                            )
                        )
            derived_node.is_expandable = len(derived_node.children) > 0

        # 3B. Physical Tables and CTE references in Main Query (not inside any Subquery)
        main_tables = list(main_body.find_all(exp.Table))
        for tbl in main_tables:
            # Check if tbl is inside any Subquery or Exists
            is_inside_sub = False
            curr = tbl.parent
            while curr and curr != main_body:
                if isinstance(curr, (exp.Subquery, exp.Exists)):
                    is_inside_sub = True
                    break
                curr = curr.parent
            if is_inside_sub:
                continue

            t_name = tbl.name
            if not t_name:
                continue

            if t_name in cte_nodes:
                outer_referenced_ctes.add(t_name)
                active_feeds.append(cte_nodes[t_name].id)
            else:
                schema_name = tbl.db or ""
                tbl_alias = tbl.alias or ""
                tbl_id = f"table_{schema_name}_{t_name}_{tbl_alias}".strip("_") if tbl_alias else f"table_{schema_name}_{t_name}".strip("_")
                if graph.has_node(tbl_id):
                    tbl_id = f"{tbl_id}_{len(graph.nodes)}"
                if not graph.has_node(tbl_id):
                    lbl = f"Table: {t_name} ({tbl_alias})" if tbl_alias else f"Table: {t_name}"
                    tbl_node = QueryNode(
                        node_id=tbl_id,
                        node_type=QueryNodeType.TABLE,
                        label=lbl,
                        schema=schema_name,
                        table_name=t_name,
                        alias=tbl_alias,
                        source_range=find_source_range(full_sql, t_name),
                        source_order=10,
                    )
                    graph.add_node(tbl_node)
                active_feeds.append(tbl_id)

        # 3C. WHERE Subqueries (EXISTS and NOT EXISTS)
        exists_list = list(main_body.find_all(exp.Exists))
        for ex_idx, ex in enumerate(exists_list, start=1):
            is_not = isinstance(ex.parent, exp.Not)
            op_name = "NOT EXISTS" if is_not else "EXISTS"
            sub_sql = ex.this.sql(dialect) if ex.this else ""

            sub_node = QueryNode(
                node_id=f"sub_exists_{ex_idx}",
                node_type=QueryNodeType.SUBQUERY,
                label=f"Subquery ({op_name})",
                sql_fragment=sub_sql,
                source_range=find_source_range(full_sql, sub_sql),
                source_order=30 + ex_idx,
            )
            graph.add_node(sub_node)

            # Discover inner tables of EXISTS
            for tbl in ex.find_all(exp.Table):
                t_name = tbl.name
                if not t_name:
                    continue
                if t_name in cte_nodes:
                    outer_referenced_ctes.add(t_name)
                    graph.add_edge(
                        QueryEdge(
                            edge_id=f"edge_cte_ex_{t_name}_{ex_idx}",
                            source_node_id=cte_nodes[t_name].id,
                            target_node_id=sub_node.id,
                            edge_type=QueryEdgeType.CTE_REFERENCE,
                        )
                    )
                else:
                    schema_name = tbl.db or ""
                    tbl_id = f"tbl_ex_{ex_idx}_{schema_name}_{t_name}".strip("_")
                    if not graph.has_node(tbl_id):
                        tbl_node = QueryNode(
                            node_id=tbl_id,
                            node_type=QueryNodeType.TABLE,
                            label=f"Table: {t_name}",
                            schema=schema_name,
                            table_name=t_name,
                            source_range=find_source_range(full_sql, t_name),
                            source_order=25 + ex_idx,
                        )
                        graph.add_node(tbl_node)
                    graph.add_edge(
                        QueryEdge(
                            edge_id=f"edge_tbl_ex_{tbl_id}_{sub_node.id}",
                            source_node_id=tbl_id,
                            target_node_id=sub_node.id,
                            edge_type=QueryEdgeType.DATA_FLOW,
                        )
                    )

            # Filter node
            filter_node = QueryNode(
                node_id=f"filter_exists_{ex_idx}",
                node_type=QueryNodeType.FILTER,
                label=f"{op_name} Filter",
                source_order=35 + ex_idx,
            )
            graph.add_node(filter_node)
            graph.add_edge(
                QueryEdge(
                    edge_id=f"edge_sub_filter_{sub_node.id}",
                    source_node_id=sub_node.id,
                    target_node_id=filter_node.id,
                    edge_type=QueryEdgeType.DEPENDENCY,
                    label=op_name,
                )
            )

            # Route active feeds through this filter
            for feed_id in list(set(active_feeds)):
                graph.add_edge(
                    QueryEdge(
                        edge_id=f"edge_feed_filter_{feed_id}_{filter_node.id}",
                        source_node_id=feed_id,
                        target_node_id=filter_node.id,
                        edge_type=QueryEdgeType.DATA_FLOW,
                    )
                )
            active_feeds = [filter_node.id]

        # 3D. JOINs in Main Query
        join_nodes = list(main_body.find_all(exp.Join))
        unique_feeds = list(set(active_feeds))
        if join_nodes and len(unique_feeds) >= 2:
            join_node = QueryNode(
                node_id="join_main",
                node_type=QueryNodeType.JOIN,
                label="JOIN",
                source_order=50,
            )
            graph.add_node(join_node)
            for feed_id in unique_feeds:
                graph.add_edge(
                    QueryEdge(
                        edge_id=f"edge_feed_join_{feed_id}",
                        source_node_id=feed_id,
                        target_node_id=join_node.id,
                        edge_type=QueryEdgeType.JOIN_INPUT,
                    )
                )
            active_feeds = [join_node.id]

        # 3E. Aggregates / GROUP BY in Main Query
        def is_in_subquery(node: exp.Expression) -> bool:
            curr = node.parent
            while curr and curr != main_body:
                if isinstance(curr, (exp.Subquery, exp.Exists, exp.CTE)):
                    return True
                curr = curr.parent
            return False

        has_main_group = bool(main_body.find(exp.Group) and not is_in_subquery(main_body.find(exp.Group)))
        has_main_agg = any(
            isinstance(agg, exp.AggFunc) and not is_in_subquery(agg)
            for agg in main_body.find_all(exp.AggFunc)
        )
        if has_main_group or has_main_agg:
            agg_node = QueryNode(
                node_id="agg_main",
                node_type=QueryNodeType.AGGREGATE,
                label="GROUP BY / Aggregate",
                source_order=75,
            )
            graph.add_node(agg_node)
            for feed_id in list(set(active_feeds)):
                graph.add_edge(
                    QueryEdge(
                        edge_id=f"edge_feed_agg_{feed_id}",
                        source_node_id=feed_id,
                        target_node_id=agg_node.id,
                        edge_type=QueryEdgeType.DATA_FLOW,
                    )
                )
            active_feeds = [agg_node.id]

        # 3F. Final Result Node
        final_node = QueryNode(
            node_id="final_select",
            node_type=QueryNodeType.FINAL_RESULT,
            label="Final SELECT",
            source_order=100,
        )
        graph.add_node(final_node)

        for feed_id in list(set(active_feeds)):
            graph.add_edge(
                QueryEdge(
                    edge_id=f"edge_feed_final_{feed_id}",
                    source_node_id=feed_id,
                    target_node_id=final_node.id,
                    edge_type=QueryEdgeType.DATA_FLOW,
                )
            )

        # 3G. SELECT List Scalar Subqueries
        for sc_idx, expr in enumerate(main_body.expressions, start=1):
            scalar_subs = list(expr.find_all(exp.Subquery))
            for sq in scalar_subs:
                scalar_alias = expr.alias or f"col_{sc_idx}"
                scalar_id = f"scalar_{scalar_alias}"
                scalar_sql = sq.this.sql(dialect) if sq.this else ""

                scalar_node = QueryNode(
                    node_id=scalar_id,
                    node_type=QueryNodeType.SUBQUERY,
                    label=f"Scalar Subquery: {scalar_alias}",
                    alias=scalar_alias,
                    sql_fragment=scalar_sql,
                    source_range=find_source_range(full_sql, scalar_sql),
                    source_order=60 + sc_idx,
                )
                graph.add_node(scalar_node)

                # Connect inner tables of scalar subquery
                for tbl in sq.find_all(exp.Table):
                    t_name = tbl.name
                    if not t_name:
                        continue
                    if t_name in cte_nodes:
                        outer_referenced_ctes.add(t_name)
                        graph.add_edge(
                            QueryEdge(
                                edge_id=f"edge_cte_sc_{t_name}_{scalar_id}",
                                source_node_id=cte_nodes[t_name].id,
                                target_node_id=scalar_node.id,
                                edge_type=QueryEdgeType.CTE_REFERENCE,
                            )
                        )
                    else:
                        schema_name = tbl.db or ""
                        tbl_id = f"tbl_sc_{schema_name}_{t_name}_{scalar_alias}".strip("_")
                        if not graph.has_node(tbl_id):
                            tbl_node = QueryNode(
                                node_id=tbl_id,
                                node_type=QueryNodeType.TABLE,
                                label=f"Table: {t_name}",
                                schema=schema_name,
                                table_name=t_name,
                                source_range=find_source_range(full_sql, t_name),
                                source_order=55 + sc_idx,
                            )
                            graph.add_node(tbl_node)
                        graph.add_edge(
                            QueryEdge(
                                edge_id=f"edge_tbl_sc_{tbl_id}_{scalar_node.id}",
                                source_node_id=tbl_id,
                                target_node_id=scalar_node.id,
                                edge_type=QueryEdgeType.DATA_FLOW,
                            )
                        )

                # Connect scalar subquery into final_select
                graph.add_edge(
                    QueryEdge(
                        edge_id=f"edge_sc_final_{scalar_id}",
                        source_node_id=scalar_node.id,
                        target_node_id=final_node.id,
                        edge_type=QueryEdgeType.SUBQUERY_INPUT,
                        label=scalar_alias,
                    )
                )

        # 4. Mark unreferenced CTEs (Test G) with full transitive closure
        all_referenced_ctes = set(outer_referenced_ctes)
        changed = True
        while changed:
            changed = False
            for c_name in list(all_referenced_ctes):
                for dep in cte_table_refs.get(c_name, set()):
                    if dep in cte_nodes and dep not in all_referenced_ctes:
                        all_referenced_ctes.add(dep)
                        changed = True

        for cte_name, cte_node in cte_nodes.items():
            if cte_name not in all_referenced_ctes:
                cte_node.status = "warning"
                cte_node.metadata["isReferenced"] = False

    @classmethod
    def _process_union(
        cls,
        union_exp: exp.Union,
        graph: QueryFlowGraph,
        dialect: str,
        cte_nodes: Dict[str, QueryNode],
        outer_referenced_ctes: Set[str],
        full_sql: str = "",
    ) -> None:
        """
        Processes a multi-branch UNION / UNION ALL tree into a Flow Graph.
        """
        branches: List[exp.Expression] = []
        distinct_ops: List[bool] = []

        def collect_branches(node: exp.Expression):
            if isinstance(node, exp.Union):
                is_distinct = bool(node.args.get("distinct"))
                distinct_ops.append(is_distinct)
                if node.left:
                    collect_branches(node.left)
                if node.right:
                    collect_branches(node.right)
            else:
                branches.append(node)

        collect_branches(union_exp)

        is_overall_distinct = any(distinct_ops)
        union_type_label = "UNION" if is_overall_distinct else "UNION ALL"

        union_node = QueryNode(
            node_id="union_combiner",
            node_type=QueryNodeType.UNION,
            label=union_type_label,
            metadata={"isDistinct": is_overall_distinct, "unionType": union_type_label},
            source_order=50,
        )
        graph.add_node(union_node)

        final_node = QueryNode(
            node_id="final_result",
            node_type=QueryNodeType.FINAL_RESULT,
            label="Final Result",
            source_order=100,
        )
        graph.add_node(final_node)

        graph.add_edge(
            QueryEdge(
                edge_id="edge_union_final",
                source_node_id=union_node.id,
                target_node_id=final_node.id,
                edge_type=QueryEdgeType.DATA_FLOW,
            )
        )

        for b_idx, branch in enumerate(branches, start=1):
            branch_id = f"select_branch_{b_idx}"
            branch_sql = branch.sql(dialect) if branch else ""
            branch_node = QueryNode(
                node_id=branch_id,
                node_type=QueryNodeType.SELECT,
                label=f"Branch {b_idx}",
                sql_fragment=branch_sql,
                source_range=find_source_range(full_sql, branch_sql),
                source_order=10 + b_idx,
            )
            graph.add_node(branch_node)

            # Link Branch -> UNION Combiner
            graph.add_edge(
                QueryEdge(
                    edge_id=f"edge_branch_union_{b_idx}",
                    source_node_id=branch_node.id,
                    target_node_id=union_node.id,
                    edge_type=QueryEdgeType.UNION_BRANCH,
                    label=f"Branch {b_idx}",
                )
            )

            # Connect source tables or CTEs feeding this branch
            branch_tables = list(branch.find_all(exp.Table))
            for tbl in branch_tables:
                t_name = tbl.name
                if not t_name:
                    continue
                if t_name in cte_nodes:
                    outer_referenced_ctes.add(t_name)
                    graph.add_edge(
                        QueryEdge(
                            edge_id=f"edge_cte_branch_{t_name}_{b_idx}",
                            source_node_id=cte_nodes[t_name].id,
                            target_node_id=branch_node.id,
                            edge_type=QueryEdgeType.CTE_REFERENCE,
                            label=f"From {t_name}",
                        )
                    )
                else:
                    schema_name = tbl.db or ""
                    tbl_id = f"table_branch_{schema_name}_{t_name}_{b_idx}".strip("_")
                    tbl_node = QueryNode(
                        node_id=tbl_id,
                        node_type=QueryNodeType.TABLE,
                        label=f"Table: {t_name}",
                        schema=schema_name,
                        table_name=t_name,
                        source_range=find_source_range(full_sql, t_name),
                        source_order=5 + b_idx,
                    )
                    graph.add_node(tbl_node)
                    graph.add_edge(
                        QueryEdge(
                            edge_id=f"edge_tbl_branch_{tbl_id}_{b_idx}",
                            source_node_id=tbl_node.id,
                            target_node_id=branch_node.id,
                            edge_type=QueryEdgeType.DATA_FLOW,
                        )
                    )

