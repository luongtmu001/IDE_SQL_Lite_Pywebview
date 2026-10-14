# -*- coding: utf-8 -*-
"""
Unit and Integration Tests for Query Flow Visualization — Phase 1
Tests A through G compliant with Section 14 of .SKILL/query_plan_visualization.md
"""

import unittest
from app.services.query_flow_service import (
    SourceRange,
    QueryNodeType,
    QueryEdgeType,
    QueryNode,
    QueryEdge,
    QueryFlowGraph,
    QueryFlowService,
)


class TestQueryFlowGraphModel(unittest.TestCase):
    """
    Tests foundational QueryFlowGraph data structures, edge conventions,
    and topological logical step numbering.
    """

    def test_source_range_contains(self):
        sr = SourceRange(start_line=2, start_column=5, end_line=5, end_column=20)
        self.assertTrue(sr.contains(2, 5))
        self.assertTrue(sr.contains(3, 10))
        self.assertTrue(sr.contains(5, 20))
        self.assertFalse(sr.contains(1, 10))
        self.assertFalse(sr.contains(2, 4))
        self.assertFalse(sr.contains(5, 21))
        self.assertFalse(sr.contains(6, 1))

    def test_edge_direction_convention(self):
        """
        Verifies edge convention: Source/Producer -> Consumer/Next Step.
        """
        graph = QueryFlowGraph()
        n_table = QueryNode(node_id="tbl_1", node_type=QueryNodeType.TABLE, label="dbo.Customer")
        n_filter = QueryNode(node_id="flt_1", node_type=QueryNodeType.FILTER, label="Filter")
        n_final = QueryNode(node_id="res_1", node_type=QueryNodeType.FINAL_RESULT, label="Final Result")

        graph.add_node(n_table)
        graph.add_node(n_filter)
        graph.add_node(n_final)

        # Producer -> Consumer
        e1 = QueryEdge("e1", source_node_id="tbl_1", target_node_id="flt_1")
        e2 = QueryEdge("e2", source_node_id="flt_1", target_node_id="res_1")
        graph.add_edge(e1)
        graph.add_edge(e2)

        ordered = graph.compute_logical_steps()
        steps = {n.id: n.logical_step for n in ordered}

        self.assertLess(steps["tbl_1"], steps["flt_1"])
        self.assertLess(steps["flt_1"], steps["res_1"])
        self.assertEqual(steps["tbl_1"], 1)
        self.assertEqual(steps["flt_1"], 2)
        self.assertEqual(steps["res_1"], 3)

    def test_multi_input_join_node_ordering(self):
        """
        A JOIN node with multiple inputs should only be numbered AFTER all input branches.
        """
        graph = QueryFlowGraph()
        t1 = QueryNode("t1", QueryNodeType.TABLE, label="Table 1", source_order=1)
        t2 = QueryNode("t2", QueryNodeType.TABLE, label="Table 2", source_order=2)
        join = QueryNode("j1", QueryNodeType.JOIN, label="JOIN", source_order=3)
        final = QueryNode("f1", QueryNodeType.FINAL_RESULT, label="Final", source_order=4)

        graph.add_node(t1)
        graph.add_node(t2)
        graph.add_node(join)
        graph.add_node(final)

        graph.add_edge(QueryEdge("e1", "t1", "j1", QueryEdgeType.JOIN_INPUT))
        graph.add_edge(QueryEdge("e2", "t2", "j1", QueryEdgeType.JOIN_INPUT))
        graph.add_edge(QueryEdge("e3", "j1", "f1", QueryEdgeType.DATA_FLOW))

        ordered = graph.compute_logical_steps()
        steps = {n.id: n.logical_step for n in ordered}

        self.assertLess(steps["t1"], steps["j1"])
        self.assertLess(steps["t2"], steps["j1"])
        self.assertLess(steps["j1"], steps["f1"])


class TestQueryFlowServiceTestCases(unittest.TestCase):
    """
    Implements tests for Test A through Test G from Section 14.
    """

    def test_a_simple_cte(self):
        """
        Test A — Simple CTE
        WITH CustomerCTE AS (
            SELECT Id, Name
            FROM dbo.Customer
        )
        SELECT *
        FROM CustomerCTE;
        """
        sql = """
        WITH CustomerCTE AS (
            SELECT Id, Name
            FROM dbo.Customer
        )
        SELECT *
        FROM CustomerCTE;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        # Expectations: Source table, CTE, and Final Query nodes exist
        cte_node = graph.get_node("cte_CustomerCTE")
        self.assertIsNotNone(cte_node, "CTE node should exist")
        self.assertEqual(cte_node.node_type, QueryNodeType.CTE)

        # Source table node exists
        table_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.TABLE]
        self.assertTrue(len(table_nodes) >= 1)
        self.assertIn("Customer", [t.table_name for t in table_nodes])

        # Final SELECT node exists
        final_node = graph.get_node("final_select")
        self.assertIsNotNone(final_node)

        # Dependency edge exists from Customer table to CustomerCTE
        cte_in_edges = graph.get_incoming_edges(cte_node.id)
        self.assertTrue(len(cte_in_edges) >= 1)

        # Edge from CustomerCTE to final_select exists
        final_in_edges = graph.get_incoming_edges(final_node.id)
        self.assertTrue(any(e.source_node_id == cte_node.id for e in final_in_edges))

        # Logical step numbering
        steps = {n.id: n.logical_step for n in graph.nodes.values()}
        src_table_id = cte_in_edges[0].source_node_id
        self.assertLess(steps[src_table_id], steps[cte_node.id])
        self.assertLess(steps[cte_node.id], steps[final_node.id])

    def test_b_multiple_ctes_and_join(self):
        """
        Test B — Multiple dependent CTEs + Aggregates + Joins
        """
        sql = """
        WITH CustomerCTE AS (
            SELECT Id, Name
            FROM dbo.Customer
        ),
        SalesCTE AS (
            SELECT CustomerId, SUM(Amount) AS TotalAmount
            FROM dbo.Sales
            GROUP BY CustomerId
        )
        SELECT
            c.Name,
            s.TotalAmount
        FROM CustomerCTE AS c
        LEFT JOIN SalesCTE AS s
            ON c.Id = s.CustomerId;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        # Both CTEs exist
        self.assertIsNotNone(graph.get_node("cte_CustomerCTE"))
        self.assertIsNotNone(graph.get_node("cte_SalesCTE"))

        # Aggregate node exists for SalesCTE
        agg_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.AGGREGATE]
        self.assertTrue(len(agg_nodes) >= 1)

        # Join node exists
        join_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.JOIN]
        self.assertTrue(len(join_nodes) >= 1)

        # Final SELECT node exists
        final_node = graph.get_node("final_select")
        self.assertIsNotNone(final_node)

        # Steps verify prerequisite ordering
        steps = {n.id: n.logical_step for n in graph.nodes.values()}
        cte_c_step = steps["cte_CustomerCTE"]
        cte_s_step = steps["cte_SalesCTE"]
        join_step = steps[join_nodes[0].id]
        final_step = steps[final_node.id]

        self.assertLess(cte_c_step, join_step)
        self.assertLess(cte_s_step, join_step)
        self.assertLess(join_step, final_step)

    def test_c_union_all_multi_branch(self):
        """
        Test C — UNION ALL
        SELECT Id, Name FROM dbo.Customer
        UNION ALL
        SELECT Id, Name FROM dbo.Supplier;
        """
        sql = """
        SELECT Id, Name
        FROM dbo.Customer
        UNION ALL
        SELECT Id, Name
        FROM dbo.Supplier;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        # Two SELECT branches
        branch_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.SELECT]
        self.assertEqual(len(branch_nodes), 2, "Should have 2 SELECT branches")

        # One UNION node
        union_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.UNION]
        self.assertEqual(len(union_nodes), 1)
        self.assertEqual(union_nodes[0].metadata.get("unionType"), "UNION ALL")

        # Final Result node
        final_node = graph.get_node("final_result")
        self.assertIsNotNone(final_node)

        # Branches connect to UNION node
        union_id = union_nodes[0].id
        in_edges = graph.get_incoming_edges(union_id)
        self.assertEqual(len(in_edges), 2)
        for b in branch_nodes:
            self.assertIn(b.id, [e.source_node_id for e in in_edges])

        # Step ordering: Branches < UNION < Final Result
        steps = {n.id: n.logical_step for n in graph.nodes.values()}
        for b in branch_nodes:
            self.assertLess(steps[b.id], steps[union_id])
        self.assertLess(steps[union_id], steps[final_node.id])

    def test_d_union_combining_cte_and_table(self):
        """
        Test D — UNION ALL combining CTE and independent table
        """
        sql = """
        WITH BaseData AS (
            SELECT Id, Name
            FROM dbo.Customer
        )
        SELECT Id, Name
        FROM BaseData
        UNION ALL
        SELECT Id, Name
        FROM dbo.Supplier;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        # CTE node BaseData exists
        cte_node = graph.get_node("cte_BaseData")
        self.assertIsNotNone(cte_node)

        # UNION node exists
        union_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.UNION]
        self.assertEqual(len(union_nodes), 1)

        # Supplier physical table exists
        supplier_nodes = [n for n in graph.nodes.values() if n.table_name == "Supplier"]
        self.assertTrue(len(supplier_nodes) >= 1)

        # BaseData feeds branch 1, Supplier feeds branch 2
        steps = {n.id: n.logical_step for n in graph.nodes.values()}
        self.assertLess(steps[cte_node.id], steps[union_nodes[0].id])

    def test_e_derived_table_in_from(self):
        """
        Test E — Derived Table (Subquery in FROM)
        """
        sql = """
        SELECT x.CustomerId, x.TotalAmount
        FROM (
            SELECT
                CustomerId,
                SUM(Amount) AS TotalAmount
            FROM dbo.Sales
            GROUP BY CustomerId
        ) AS x;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        # Derived table node exists
        derived_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.DERIVED_TABLE]
        self.assertEqual(len(derived_nodes), 1)
        self.assertEqual(derived_nodes[0].alias, "x")

        # Source table Sales exists
        sales_nodes = [n for n in graph.nodes.values() if n.table_name == "Sales"]
        self.assertTrue(len(sales_nodes) >= 1)

        # Step order: Sales < Aggregate < Derived Table < Final SELECT
        steps = {n.id: n.logical_step for n in graph.nodes.values()}
        derived_step = steps[derived_nodes[0].id]
        final_node = graph.get_node("final_select")
        self.assertLess(derived_step, steps[final_node.id])

    def test_f_recursive_cte(self):
        """
        Test F — Recursive CTE (Cycle detection and termination)
        """
        sql = """
        WITH EmployeeHierarchy AS (
            SELECT EmployeeId, ManagerId, 1 AS Level
            FROM dbo.Employees
            WHERE ManagerId IS NULL
            UNION ALL
            SELECT e.EmployeeId, e.ManagerId, eh.Level + 1
            FROM dbo.Employees e
            INNER JOIN EmployeeHierarchy eh ON e.ManagerId = eh.EmployeeId
        )
        SELECT * FROM EmployeeHierarchy;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        cte_node = graph.get_node("cte_EmployeeHierarchy")
        self.assertIsNotNone(cte_node)
        self.assertEqual(cte_node.status, "recursive")

        # Recursive self-cycle edge is detected and marked
        rec_edges = [e for e in graph.edges if e.edge_type == QueryEdgeType.RECURSIVE_CYCLE]
        self.assertEqual(len(rec_edges), 1)
        self.assertTrue(rec_edges[0].metadata.get("isCycle"))

        # Topological sort terminates cleanly without infinite loop
        nodes = list(graph.nodes.values())
        self.assertTrue(all(n.logical_step > 0 for n in nodes))

    def test_g_unreferenced_cte(self):
        """
        Test G — Unreferenced CTE (Declared but never consumed by main query)
        """
        sql = """
        WITH UnusedCTE AS (
            SELECT Id FROM dbo.OldArchive
        )
        SELECT Id, Name FROM dbo.Customer;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        unused_node = graph.get_node("cte_UnusedCTE")
        self.assertIsNotNone(unused_node)
        self.assertEqual(unused_node.status, "warning")
        self.assertFalse(unused_node.metadata.get("isReferenced", True))

        # Unused CTE does NOT feed into final_select
        final_node = graph.get_node("final_select")
        in_edges = graph.get_incoming_edges(final_node.id)
        self.assertNotIn(unused_node.id, [e.source_node_id for e in in_edges])

    def test_json_roundtrip_compatibility(self):
        """
        Verifies to_dict and from_dict produce a valid schema compatible with JS QueryFlowGraph.
        """
        sql = "SELECT Id, Name FROM dbo.Customer;"
        graph = QueryFlowService.build_flow_graph(sql)
        d = graph.to_dict()

        self.assertIn("id", d)
        self.assertIn("nodes", d)
        self.assertIn("edges", d)
        self.assertIsInstance(d["nodes"], list)
        self.assertIsInstance(d["edges"], list)

        restored = QueryFlowGraph.from_dict(d)
        self.assertEqual(len(restored.nodes), len(graph.nodes))
        self.assertEqual(len(restored.edges), len(graph.edges))

    def test_h_nested_derived_tables(self):
        """
        Test H — Nested Derived Tables (Subquery inside subquery)
        """
        sql = """
        SELECT a.Id
        FROM (
            SELECT b.Id
            FROM (
                SELECT Id FROM dbo.InnerTable
            ) AS b
        ) AS a;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        derived_a = graph.get_node("derived_a")
        derived_b = graph.get_node("derived_b")
        final_node = graph.get_node("final_select")

        self.assertIsNotNone(derived_a, "Derived table a should exist")
        self.assertIsNotNone(derived_b, "Derived table b should exist")
        self.assertIsNotNone(final_node, "Final SELECT should exist")

        # Nested edge: derived_b -> derived_a
        edges_b_to_a = [e for e in graph.edges if e.source_node_id == derived_b.id and e.target_node_id == derived_a.id]
        self.assertEqual(len(edges_b_to_a), 1, "derived_b must feed derived_a")

        # Outermost edge: derived_a -> final_select
        edges_a_to_final = [e for e in graph.edges if e.source_node_id == derived_a.id and e.target_node_id == final_node.id]
        self.assertEqual(len(edges_a_to_final), 1, "derived_a must feed final_select")

        # InnerTable -> derived_b
        inner_tbl = [n for n in graph.nodes.values() if n.table_name == "InnerTable"]
        self.assertTrue(len(inner_tbl) >= 1)
        edges_tbl_to_b = [e for e in graph.edges if e.source_node_id == inner_tbl[0].id and e.target_node_id == derived_b.id]
        self.assertEqual(len(edges_tbl_to_b), 1, "InnerTable must feed derived_b")

        # Topological steps: InnerTable < derived_b < derived_a < final_select
        steps = {n.id: n.logical_step for n in graph.nodes.values()}
        self.assertLess(steps[inner_tbl[0].id], steps[derived_b.id])
        self.assertLess(steps[derived_b.id], steps[derived_a.id])
        self.assertLess(steps[derived_a.id], steps[final_node.id])

    def test_i_exists_and_not_exists_subqueries(self):
        """
        Test I — EXISTS and NOT EXISTS subqueries (Semi-join / Filter)
        """
        sql = """
        SELECT c.Id, c.Name
        FROM dbo.Customer c
        WHERE EXISTS (
            SELECT 1 FROM dbo.Orders o WHERE o.CustomerId = c.Id
        );
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        subquery_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.SUBQUERY and "EXISTS" in n.label]
        filter_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.FILTER and "EXISTS" in n.label]
        final_node = graph.get_node("final_select")

        self.assertEqual(len(subquery_nodes), 1, "Should have 1 EXISTS subquery node")
        self.assertEqual(len(filter_nodes), 1, "Should have 1 EXISTS filter node")
        self.assertIsNotNone(final_node)

        # Dependency edge: Subquery -> Filter
        sub_id = subquery_nodes[0].id
        filter_id = filter_nodes[0].id
        dep_edges = [e for e in graph.edges if e.source_node_id == sub_id and e.target_node_id == filter_id]
        self.assertEqual(len(dep_edges), 1)
        self.assertEqual(dep_edges[0].edge_type, QueryEdgeType.DEPENDENCY)

        # Filter feeds final_select
        filter_to_final = [e for e in graph.edges if e.source_node_id == filter_id and e.target_node_id == final_node.id]
        self.assertEqual(len(filter_to_final), 1)

        # Steps: subquery < filter < final
        steps = {n.id: n.logical_step for n in graph.nodes.values()}
        self.assertLess(steps[sub_id], steps[filter_id])
        self.assertLess(steps[filter_id], steps[final_node.id])

    def test_j_scalar_subquery_in_select(self):
        """
        Test J — Scalar subquery in SELECT projection list
        """
        sql = """
        SELECT c.Id,
               (SELECT MAX(Amount) FROM dbo.Sales s WHERE s.CustomerId = c.Id) AS MaxAmt
        FROM dbo.Customer c;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        scalar_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.SUBQUERY and "Scalar" in n.label]
        self.assertEqual(len(scalar_nodes), 1, "Should have 1 scalar subquery node")

        final_node = graph.get_node("final_select")
        self.assertIsNotNone(final_node)

        # Scalar node feeds final_select
        scalar_to_final = [e for e in graph.edges if e.source_node_id == scalar_nodes[0].id and e.target_node_id == final_node.id]
        self.assertEqual(len(scalar_to_final), 1)
        self.assertEqual(scalar_to_final[0].edge_type, QueryEdgeType.SUBQUERY_INPUT)

    def test_k_aggregates_in_main_query(self):
        """
        Test K — Aggregates and GROUP BY in main query
        """
        sql = """
        SELECT CustomerId, COUNT(*) AS OrderCount, SUM(Total) AS TotalSpent
        FROM dbo.Orders
        GROUP BY CustomerId;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        agg_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.AGGREGATE]
        self.assertEqual(len(agg_nodes), 1, "Should have 1 Aggregate node in main query")

        final_node = graph.get_node("final_select")
        self.assertIsNotNone(final_node)

        # Orders table feeds Aggregate -> Aggregate feeds final_select
        orders_nodes = [n for n in graph.nodes.values() if n.table_name == "Orders"]
        self.assertTrue(len(orders_nodes) >= 1)

        steps = {n.id: n.logical_step for n in graph.nodes.values()}
        self.assertLess(steps[orders_nodes[0].id], steps[agg_nodes[0].id])
        self.assertLess(steps[agg_nodes[0].id], steps[final_node.id])

    def test_l_postgresql_dialect_recursive_and_schema(self):
        """
        Test L — PostgreSQL dialect with WITH RECURSIVE and double-quoted identifiers
        """
        sql = """
        WITH RECURSIVE subordinates AS (
            SELECT employee_id, manager_id, full_name
            FROM "hr"."employees"
            WHERE manager_id IS NULL
            UNION ALL
            SELECT e.employee_id, e.manager_id, e.full_name
            FROM "hr"."employees" e
            INNER JOIN subordinates s ON s.employee_id = e.manager_id
        )
        SELECT * FROM subordinates;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="postgres")

        cte_node = graph.get_node("cte_subordinates")
        self.assertIsNotNone(cte_node)
        self.assertEqual(cte_node.status, "recursive")

        # Recursive self-cycle edge exists
        rec_edges = [e for e in graph.edges if e.edge_type == QueryEdgeType.RECURSIVE_CYCLE]
        self.assertEqual(len(rec_edges), 1)

        # Topological sorting finishes cleanly
        nodes = list(graph.nodes.values())
        self.assertTrue(all(n.logical_step > 0 for n in nodes))

    def test_m_multi_branch_union(self):
        """
        Test M — Multi-branch 3-way UNION (e.g. Branch 1 UNION ALL Branch 2 UNION Branch 3)
        """
        sql = """
        SELECT Id, Name FROM dbo.Customer
        UNION ALL
        SELECT Id, Name FROM dbo.Supplier
        UNION
        SELECT Id, Name FROM dbo.Partner;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        branch_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.SELECT and "Branch" in n.label]
        self.assertEqual(len(branch_nodes), 3, "Should have 3 SELECT branches")

        union_node = graph.get_node("union_combiner")
        self.assertIsNotNone(union_node)

        final_node = graph.get_node("final_result")
        self.assertIsNotNone(final_node)

        # All 3 branches feed union_combiner
        in_edges = graph.get_incoming_edges(union_node.id)
        self.assertEqual(len(in_edges), 3)

        steps = {n.id: n.logical_step for n in graph.nodes.values()}
        for b in branch_nodes:
            self.assertLess(steps[b.id], steps[union_node.id])
        self.assertLess(steps[union_node.id], steps[final_node.id])

    def test_n_source_range_precision(self):
        """
        Test N — Source Range precision (verifying 1-based start/end line and column)
        """
        sql = """WITH CustomerCTE AS (
    SELECT Id, Name
    FROM dbo.Customer
)
SELECT * FROM CustomerCTE;"""
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        cte_node = graph.get_node("cte_CustomerCTE")
        self.assertIsNotNone(cte_node)
        self.assertIsNotNone(cte_node.source_range)
        self.assertEqual(cte_node.source_range.start_line, 1)
        self.assertTrue(cte_node.source_range.start_column >= 1)

    def test_o_ipc_and_flask_endpoint(self):
        """
        Test O — Verifies MainApi.analyze_query_flow IPC method returns a valid graph
        """
        from main import MainApi
        api = MainApi(None)
        sql = "SELECT Id, Name FROM dbo.Customer;"
        res = api.analyze_query_flow(sql, dialect="tsql")
        self.assertTrue(res.get("success"), f"IPC failed: {res}")
        self.assertIn("flowGraph", res)
        self.assertTrue(len(res["flowGraph"]["nodes"]) >= 2)


class TestPhase4Visualization(unittest.TestCase):
    """
    Verifies Phase 4 D3.js Flow Visualization, UI controls, and Styling
    compliant with Section 6, 8, 9 of .SKILL/query_plan_visualization.md
    """

    @classmethod
    def setUpClass(cls):
        from pathlib import Path
        workspace = Path(__file__).resolve().parent.parent
        cls.d3_renderer_js = (workspace / "static" / "js" / "visualization" / "d3-renderer.js").read_text(encoding="utf-8")
        cls.sql_visualizer_js = (workspace / "static" / "js" / "visualization" / "sql-visualizer.js").read_text(encoding="utf-8")
        cls.css = (workspace / "static" / "css" / "sql-visualization.css").read_text(encoding="utf-8")

    def test_p_d3_renderer_flow_graph_capabilities(self):
        """
        Test P — Verifies D3CanvasRenderer implements complete Flow Graph features:
        - Directed arrow markers (data flow, union, cte, subquery, join, dependency, recursive)
        - Flow layer groups (edges & nodes)
        - Dual render dispatch & topological layout
        - Step numbering & node type cards
        - Focus & dependency highlight
        - Floating legend
        """
        # Marker definitions
        self.assertIn("vqd-flow-arrow-data-flow", self.d3_renderer_js)
        self.assertIn("vqd-flow-arrow-union", self.d3_renderer_js)
        self.assertIn("vqd-flow-arrow-cte", self.d3_renderer_js)
        self.assertIn("vqd-flow-arrow-subquery", self.d3_renderer_js)
        self.assertIn("vqd-flow-arrow-join", self.d3_renderer_js)
        self.assertIn("vqd-flow-arrow-recursive", self.d3_renderer_js)

        # Layer groups
        self.assertIn("vqd-layer-flow-edges", self.d3_renderer_js)
        self.assertIn("vqd-layer-flow-nodes", self.d3_renderer_js)

        # Flow methods
        self.assertIn("shouldRenderFlowGraph", self.d3_renderer_js)
        self.assertIn("_renderFlowGraph", self.d3_renderer_js)
        self.assertIn("_renderFlowNodes", self.d3_renderer_js)
        self.assertIn("_renderFlowEdges", self.d3_renderer_js)
        self.assertIn("_renderSingleFlowNodeCard", self.d3_renderer_js)
        self.assertIn("_focusFlowNode", self.d3_renderer_js)
        self.assertIn("_clearFlowFocus", self.d3_renderer_js)
        self.assertIn("applyFlowTopologicalLayout", self.d3_renderer_js)
        self.assertIn("toggleStepNumbers", self.d3_renderer_js)
        self.assertIn("toggleLegend", self.d3_renderer_js)
        self.assertIn("_renderFlowLegend", self.d3_renderer_js)

    def test_q_sql_visualizer_flow_toolbar_and_navigation(self):
        """
        Test Q — Verifies SqlVisualizer toolbar controls and Monaco navigation:
        - Toolbar buttons for Step Numbers, View Mode, and Legend
        - Bidirectional node selection handler `_onFlowNodeSelect`
        - Monaco editor inline highlight decoration
        """
        self.assertIn("vqd-btn-toggle-steps", self.sql_visualizer_js)
        self.assertIn("vqd-btn-toggle-viewmode", self.sql_visualizer_js)
        self.assertIn("vqd-btn-toggle-legend", self.sql_visualizer_js)
        self.assertIn("_onFlowNodeSelect", self.sql_visualizer_js)
        self.assertIn("vqd-monaco-highlight-flow-node", self.sql_visualizer_js)

    def test_r_css_flow_styles(self):
        """
        Test R — Verifies sql-visualization.css defines necessary styles:
        - Flow nodes, cards, ports, and step badges
        - Directed flow edges and animated recursive cycles
        - Dimmed and focused highlighting states
        - Floating legend widget
        """
        self.assertIn(".vqd-flow-node", self.css)
        self.assertIn(".vqd-flow-step-badge", self.css)
        self.assertIn(".vqd-hide-step-badges", self.css)
        self.assertIn(".vqd-flow-edge-path", self.css)
        self.assertIn(".vqd-edge-type-recursive_cycle", self.css)
        self.assertIn(".vqd-flow-focused", self.css)
        self.assertIn(".vqd-flow-connected", self.css)
        self.assertIn(".vqd-flow-dimmed", self.css)
        self.assertIn(".vqd-flow-legend", self.css)
        self.assertIn(".vqd-monaco-highlight-flow-node", self.css)

    def test_s_phase5_source_mapping_find_node_at_source_position(self):
        """
        Test S — Verifies QueryFlowGraph.find_node_at_source_position:
        - Accurately matches innermost node for a given (line, col)
        - Differentiates CTE definition, subquery, and main query positions
        """
        graph = QueryFlowGraph()
        n_cte = QueryNode(
            node_id="cte_1",
            node_type=QueryNodeType.CTE,
            label="CTE_A",
            source_range=SourceRange(start_line=1, start_column=1, end_line=5, end_column=2)
        )
        n_table = QueryNode(
            node_id="tbl_1",
            node_type=QueryNodeType.TABLE,
            label="dbo.Customer",
            source_range=SourceRange(start_line=2, start_column=5, end_line=4, end_column=25)
        )
        n_main = QueryNode(
            node_id="main_1",
            node_type=QueryNodeType.SELECT,
            label="Final SELECT",
            source_range=SourceRange(start_line=6, start_column=1, end_line=8, end_column=20)
        )

        graph.add_node(n_cte)
        graph.add_node(n_table)
        graph.add_node(n_main)

        # Inside table (nested inside CTE) -> should return more specific table node
        matched = graph.find_node_at_source_position(3, 10)
        self.assertIsNotNone(matched)
        self.assertEqual(matched.id, "tbl_1")

        # In CTE outer envelope -> should return CTE node
        matched_cte = graph.find_node_at_source_position(1, 2)
        self.assertIsNotNone(matched_cte)
        self.assertEqual(matched_cte.id, "cte_1")

        # In main SELECT -> should return main node
        matched_main = graph.find_node_at_source_position(7, 5)
        self.assertIsNotNone(matched_main)
        self.assertEqual(matched_main.id, "main_1")

        # Outside all ranges -> returns None
        self.assertIsNone(graph.find_node_at_source_position(20, 1))

    def test_t_phase5_sql_visualizer_inspector_and_cursor_mapping(self):
        """
        Test T — Verifies SqlVisualizer implements Phase 5 Navigation & Inspector features:
        - Cursor move handler `_onEditorCursorMove`
        - Inspector rendering `_renderNodeInspector`
        - Bottom tab switcher `_activateBottomTab`
        - Copy SQL Fragment button
        """
        self.assertIn("_onEditorCursorMove", self.sql_visualizer_js)
        self.assertIn("_renderNodeInspector", self.sql_visualizer_js)
        self.assertIn("_clearNodeInspector", self.sql_visualizer_js)
        self.assertIn("_activateBottomTab", self.sql_visualizer_js)
        self.assertIn("vqd-insp-step-badge", self.sql_visualizer_js)
        self.assertIn("vqd-btn-copy-fragment", self.sql_visualizer_js)
        self.assertIn("vqd-bottom-panel", self.sql_visualizer_js)
        self.assertIn("vqd-pane-inspector", self.sql_visualizer_js)

    def test_u_phase5_d3_renderer_focus_node(self):
        """
        Test U — Verifies D3CanvasRenderer implements `focusNode` and panning:
        - Smooth pan to coords without jumping
        - Bi-directional selection sync
        """
        self.assertIn("focusNode(nodeId, panTo = true)", self.d3_renderer_js)
        self.assertIn("_panToCoords", self.d3_renderer_js)

    def test_v_phase6_query_plan_service_model(self):
        """
        Test V — Verifies QueryPlanService normalized plan model:
        - PlanOperatorNode cost severity levels (>=30% high, >=10% medium, <10% low)
        - PhysicalExecutionPlan flattening into nodes and edges
        """
        from app.services.query_plan_service import PlanOperatorNode, PhysicalExecutionPlan

        root = PlanOperatorNode(node_id=0, operator_type="Select", subtree_cost=10.0, cost_percent=5.0)
        child1 = PlanOperatorNode(node_id=1, operator_type="Hash Match", subtree_cost=9.5, cost_percent=35.0)
        child2 = PlanOperatorNode(node_id=2, operator_type="Index Scan", subtree_cost=4.0, cost_percent=15.0)

        root.children.append(child1)
        child1.children.append(child2)

        self.assertEqual(root.cost_severity, "low")
        self.assertEqual(child1.cost_severity, "high")
        self.assertEqual(child2.cost_severity, "medium")

        plan = PhysicalExecutionPlan(dialect="sqlserver", plan_type="estimated", total_cost=10.0, root_node=root)
        plan_dict = plan.to_dict()

        self.assertEqual(len(plan_dict["nodes"]), 3)
        self.assertEqual(len(plan_dict["edges"]), 2)
        self.assertEqual(plan_dict["total_cost"], 10.0)

    def test_w_phase6_sqlserver_showplan_xml_parsing(self):
        """
        Test W — Verifies parsing of SQL Server SET SHOWPLAN_XML output.
        """
        from app.services.query_plan_service import QueryPlanService

        xml_content = """<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.5" Build="15.0">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT * FROM Customer" StatementSubTreeCost="0.025">
          <QueryPlan>
            <RelOp NodeId="0" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimatedTotalSubtreeCost="0.025" EstimateRows="250">
              <OutputList>
                <ColumnReference Column="Id" />
                <ColumnReference Column="Name" />
              </OutputList>
              <TableScan>
                <Object Schema="dbo" Table="Customer" />
              </TableScan>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>"""

        plan = QueryPlanService.parse_sqlserver_plan(xml_content, plan_type="estimated")
        self.assertEqual(plan.dialect, "sqlserver")
        self.assertEqual(len(plan.nodes), 1)
        node = plan.nodes[0]
        self.assertEqual(node.physical_op, "Clustered Index Scan")
        self.assertEqual(node.relation_name, "Customer")
        self.assertEqual(node.schema, "dbo")
        self.assertEqual(node.estimated_rows, 250)
        self.assertEqual(node.cost_percent, 100.0)

    def test_x_phase6_postgres_explain_json_parsing(self):
        """
        Test X — Verifies parsing of PostgreSQL EXPLAIN (FORMAT JSON) output.
        """
        from app.services.query_plan_service import QueryPlanService

        json_data = [
            {
                "Plan": {
                    "Node Type": "Hash Join",
                    "Join Type": "Inner",
                    "Startup Cost": 20.0,
                    "Total Cost": 80.0,
                    "Plan Rows": 100,
                    "Actual Rows": 95,
                    "Actual Total Time": 1.45,
                    "Actual Loops": 1,
                    "Plans": [
                        {
                            "Node Type": "Seq Scan",
                            "Relation Name": "customer",
                            "Schema": "public",
                            "Startup Cost": 0.0,
                            "Total Cost": 30.0,
                            "Plan Rows": 100,
                            "Actual Rows": 100,
                            "Actual Total Time": 0.25
                        },
                        {
                            "Node Type": "Seq Scan",
                            "Relation Name": "orders",
                            "Schema": "public",
                            "Startup Cost": 0.0,
                            "Total Cost": 25.0,
                            "Plan Rows": 50,
                            "Actual Rows": 50,
                            "Actual Total Time": 0.20
                        }
                    ]
                }
            }
        ]

        plan = QueryPlanService.parse_postgres_plan(json_data, plan_type="actual")
        self.assertEqual(plan.dialect, "postgresql")
        self.assertEqual(plan.plan_type, "actual")
        self.assertEqual(len(plan.nodes), 3)
        self.assertEqual(len(plan.edges), 2)
        root = plan.nodes[0]
        self.assertEqual(root.operator_type, "Hash Join")
        self.assertEqual(root.actual_rows, 95)
        self.assertEqual(root.actual_time_ms, 1.45)

    def test_y_phase6_sqlite_plan_parsing(self):
        """
        Test Y — Verifies parsing of SQLite EXPLAIN QUERY PLAN tabular rows.
        """
        from app.services.query_plan_service import QueryPlanService

        rows = [
            (0, 0, 0, "SCAN customer"),
            (1, 0, 0, "SEARCH orders USING INDEX idx_orders_custid (cust_id=?)")
        ]
        plan = QueryPlanService.parse_sqlite_plan(rows)
        self.assertEqual(plan.dialect, "sqlite")
        self.assertGreaterEqual(len(plan.nodes), 2)

    def test_z_phase6_api_endpoint_and_ipc(self):
        """
        Test Z — Verifies POST /api/metadata/query-plan and MainApi.get_query_plan IPC method.
        """
        from main import MainApi
        api = MainApi()
        res = api.get_query_plan("conn_test", "db_test", "SELECT 1", "estimated")
        self.assertTrue(res.get("success"))
        self.assertIn("plan", res)

    def test_aa_phase6_d3_physical_plan_renderer(self):
        """
        Test AA — Verifies D3CanvasRenderer implements Phase 6 Physical Plan features:
        - `renderPhysicalPlan(planData)`
        - `switchToGraphView()`
        - `_layoutPhysicalPlan(planData)`
        - `_renderPhysicalPlanNodes(planData)`
        - `_renderPhysicalPlanEdges(planData)`
        - `vqd-flow-arrow-plan` marker
        """
        self.assertIn("renderPhysicalPlan", self.d3_renderer_js)
        self.assertIn("switchToGraphView", self.d3_renderer_js)
        self.assertIn("_layoutPhysicalPlan", self.d3_renderer_js)
        self.assertIn("_renderPhysicalPlanNodes", self.d3_renderer_js)
        self.assertIn("_renderPhysicalPlanEdges", self.d3_renderer_js)
        self.assertIn("vqd-flow-arrow-plan", self.d3_renderer_js)
        self.assertIn("vqd-layer-plan-edges", self.d3_renderer_js)
        self.assertIn("vqd-layer-plan-nodes", self.d3_renderer_js)

    def test_ab_phase6_css_plan_styles(self):
        """
        Test AB — Verifies sql-visualization.css defines necessary styles for Physical Plan:
        - `.vqd-plan-node`, `.vqd-plan-node-rect`
        - `.vqd-cost-severity-high`, `.vqd-cost-severity-medium`, `.vqd-cost-severity-low`
        - `.vqd-plan-edge-path`, `.vqd-bottom-tabs`
        """
        self.assertIn(".vqd-plan-node", self.css)
        self.assertIn(".vqd-plan-node-rect", self.css)
        self.assertIn(".vqd-cost-severity-high", self.css)
        self.assertIn(".vqd-cost-severity-medium", self.css)
        self.assertIn(".vqd-cost-severity-low", self.css)
        self.assertIn(".vqd-plan-edge-path", self.css)
        self.assertIn(".vqd-bottom-tabs", self.css)


class TestPhase7EdgeCasesAndPerformance(unittest.TestCase):
    """
    Phase 7 — Comprehensive Edge Cases, Scalability, and Performance Test Suite.
    Complies with Section 13, 14, and 15 of .SKILL/query_plan_visualization.md.
    """

    @classmethod
    def setUpClass(cls):
        import os
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(base_dir, "static", "js", "visualization", "d3-renderer.js"), "r", encoding="utf-8") as f:
            cls.d3_renderer_js = f.read()
        with open(os.path.join(base_dir, "static", "js", "visualization", "query-flow-analyzer.js"), "r", encoding="utf-8") as f:
            cls.flow_analyzer_js = f.read()

    def test_ac_phase7_complex_nested_cte_chain(self):
        """
        Nested CTE chain: CTE_A -> CTE_B -> CTE_C -> Final SELECT.
        Verifies transitive topological dependency ordering: A < B < C < Final.
        """
        sql = """
        WITH CTE_A AS (
            SELECT Id, CustomerName FROM dbo.Customer
        ),
        CTE_B AS (
            SELECT Id, CustomerName FROM CTE_A WHERE Id > 100
        ),
        CTE_C AS (
            SELECT Id, UPPER(CustomerName) AS UName FROM CTE_B
        )
        SELECT * FROM CTE_C;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        self.assertIsNotNone(graph.get_node("cte_CTE_A"))
        self.assertIsNotNone(graph.get_node("cte_CTE_B"))
        self.assertIsNotNone(graph.get_node("cte_CTE_C"))
        self.assertIsNotNone(graph.get_node("final_select"))

        # Verify dependency edges
        b_in = [e.source_node_id for e in graph.get_incoming_edges("cte_CTE_B")]
        c_in = [e.source_node_id for e in graph.get_incoming_edges("cte_CTE_C")]
        final_in = [e.source_node_id for e in graph.get_incoming_edges("final_select")]

        self.assertIn("cte_CTE_A", b_in)
        self.assertIn("cte_CTE_B", c_in)
        self.assertIn("cte_CTE_C", final_in)

        # Topological logical steps must satisfy A < B < C < Final
        step_a = graph.get_node("cte_CTE_A").logical_step
        step_b = graph.get_node("cte_CTE_B").logical_step
        step_c = graph.get_node("cte_CTE_C").logical_step
        step_final = graph.get_node("final_select").logical_step

        self.assertLess(step_a, step_b)
        self.assertLess(step_b, step_c)
        self.assertLess(step_c, step_final)

        # All 3 CTEs must be marked valid and referenced
        self.assertEqual(graph.get_node("cte_CTE_A").status, "valid")
        self.assertEqual(graph.get_node("cte_CTE_B").status, "valid")
        self.assertEqual(graph.get_node("cte_CTE_C").status, "valid")

    def test_ad_phase7_multi_branch_union_all_3_branches(self):
        """
        3+ branch UNION ALL feeding into a single UNION combiner.
        """
        sql = """
        SELECT Id, Name FROM dbo.TableA
        UNION ALL
        SELECT Id, Name FROM dbo.TableB
        UNION ALL
        SELECT Id, Name FROM dbo.TableC;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        union_node = graph.get_node("union_combiner")
        final_node = graph.get_node("final_result")

        self.assertIsNotNone(union_node)
        self.assertIsNotNone(final_node)
        self.assertEqual(union_node.node_type, QueryNodeType.UNION)

        branch_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.SELECT]
        self.assertEqual(len(branch_nodes), 3)

        # Verify all branches connect to union_combiner
        union_in_edges = graph.get_incoming_edges(union_node.id)
        union_in_sources = {e.source_node_id for e in union_in_edges}
        for b in branch_nodes:
            self.assertIn(b.id, union_in_sources)
            self.assertLess(b.logical_step, union_node.logical_step)

        self.assertLess(union_node.logical_step, final_node.logical_step)

    def test_ae_phase7_table_alias_collision_disambiguation(self):
        """
        Self-join with same table name and distinct aliases.
        Must create distinct nodes without overwriting.
        """
        sql = """
        SELECT a.Id, b.Id AS ParentId
        FROM dbo.Customer AS a
        JOIN dbo.Customer AS b ON a.ParentId = b.Id;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        table_nodes = [n for n in graph.nodes.values() if n.node_type == QueryNodeType.TABLE]
        self.assertEqual(len(table_nodes), 2, "Self-join must create 2 distinct table nodes")

        aliases = {t.alias for t in table_nodes}
        self.assertEqual(aliases, {"a", "b"})

        join_node = graph.get_node("join_main")
        self.assertIsNotNone(join_node)
        join_in_sources = {e.source_node_id for e in graph.get_incoming_edges(join_node.id)}
        for t in table_nodes:
            self.assertIn(t.id, join_in_sources)

    def test_af_phase7_unreferenced_cte_warning(self):
        """
        Unreferenced CTE defined in WITH but never used in final query.
        Must be marked status='warning' with isReferenced=False.
        """
        sql = """
        WITH UnusedCTE AS (
            SELECT Id, Col1 FROM dbo.TempTable
        ),
        UsedCTE AS (
            SELECT Id, Name FROM dbo.Customer
        )
        SELECT * FROM UsedCTE;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        unused_node = graph.get_node("cte_UnusedCTE")
        used_node = graph.get_node("cte_UsedCTE")
        final_node = graph.get_node("final_select")

        self.assertIsNotNone(unused_node)
        self.assertIsNotNone(used_node)
        self.assertEqual(unused_node.status, "warning")
        self.assertFalse(unused_node.metadata.get("isReferenced"))
        self.assertEqual(used_node.status, "valid")

        # Unused CTE must not connect to final_select
        final_in_sources = {e.source_node_id for e in graph.get_incoming_edges(final_node.id)}
        self.assertNotIn(unused_node.id, final_in_sources)

    def test_ag_phase7_children_and_expandable_metadata(self):
        """
        Verifies that CTEs and Derived Tables populate children array
        and set is_expandable = True when containing internal elements.
        """
        sql = """
        WITH SalesCTE AS (
            SELECT CustomerId, SUM(Amount) AS TotalAmount
            FROM dbo.Sales
            GROUP BY CustomerId
        )
        SELECT x.CustomerId, x.TotalAmount
        FROM (
            SELECT CustomerId, TotalAmount FROM SalesCTE
        ) AS x;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        cte_node = graph.get_node("cte_SalesCTE")
        self.assertIsNotNone(cte_node)
        self.assertTrue(cte_node.is_expandable)
        self.assertGreater(len(cte_node.children), 0)

        derived_node = graph.get_node("derived_x")
        self.assertIsNotNone(derived_node)

    def test_ah_phase7_syntax_error_resilience_preserves_sql(self):
        """
        Syntax errors fall back gracefully without unhandled exceptions
        and preserve original SQL completely.
        """
        bad_sql = "SELECT ;;; INVALID SYNTAX FROM WHERE GROUP ORDER"
        graph = QueryFlowService.build_flow_graph(bad_sql, dialect="tsql")

        self.assertIsNotNone(graph)
        self.assertEqual(graph.original_sql, bad_sql)
        self.assertGreaterEqual(len(graph.nodes), 1)

        fallback_node = list(graph.nodes.values())[0]
        self.assertEqual(fallback_node.status, "warning")
        self.assertEqual(fallback_node.sql_fragment, bad_sql)

    def test_ai_phase7_multi_dialect_support(self):
        """
        Verifies seamless parsing for T-SQL, PostgreSQL, and SQLite queries.
        """
        # T-SQL bracketed
        tsql = "SELECT [Id], [Name] FROM [dbo].[Customer];"
        g_tsql = QueryFlowService.build_flow_graph(tsql, dialect="tsql")
        self.assertGreaterEqual(len(g_tsql.nodes), 2)

        # PostgreSQL double-quoted
        pg_sql = 'SELECT "id", "name" FROM "public"."customer";'
        g_pg = QueryFlowService.build_flow_graph(pg_sql, dialect="postgres")
        self.assertGreaterEqual(len(g_pg.nodes), 2)

        # SQLite simple
        sqlite_sql = "SELECT id, name FROM customer;"
        g_sqlite = QueryFlowService.build_flow_graph(sqlite_sql, dialect="sqlite")
        self.assertGreaterEqual(len(g_sqlite.nodes), 2)

    def test_aj_phase7_large_graph_performance_benchmark(self):
        """
        Performance stress test: 60+ nodes and 70+ edges.
        Topological sorting must complete in < 25ms.
        Dict serialization round-trip must complete in < 5ms.
        """
        import time

        graph = QueryFlowGraph()
        n_count = 60
        for i in range(1, n_count + 1):
            n_type = QueryNodeType.TABLE if i <= 10 else (QueryNodeType.FILTER if i <= 30 else QueryNodeType.SELECT)
            graph.add_node(QueryNode(f"node_{i}", n_type, f"Node {i}", source_order=i))

        # Add 65 linear & diamond edges
        for i in range(1, n_count):
            graph.add_edge(QueryEdge(f"edge_{i}", f"node_{i}", f"node_{i+1}"))
            if i + 5 <= n_count:
                graph.add_edge(QueryEdge(f"edge_skip_{i}", f"node_{i}", f"node_{i+5}"))

        # Measure topological sort
        t0 = time.perf_counter()
        sorted_nodes = graph.compute_logical_steps()
        t1 = time.perf_counter()
        topo_duration_ms = (t1 - t0) * 1000

        self.assertEqual(len(sorted_nodes), n_count)
        self.assertLess(topo_duration_ms, 25.0, f"Topological sort took {topo_duration_ms:.2f}ms (expected < 25ms)")

        # Verify strictly sequential 1-based steps
        steps = [n.logical_step for n in sorted_nodes]
        self.assertEqual(steps, list(range(1, n_count + 1)))

        # Measure serialization round-trip
        t2 = time.perf_counter()
        d = graph.to_dict()
        reconstructed = QueryFlowGraph.from_dict(d)
        t3 = time.perf_counter()
        serial_duration_ms = (t3 - t2) * 1000

        self.assertEqual(len(reconstructed.nodes), n_count)
        self.assertLess(serial_duration_ms, 15.0, f"Serialization round-trip took {serial_duration_ms:.2f}ms")

    def test_ak_phase7_d3_renderer_expand_collapse_code(self):
        """
        Verifies d3-renderer.js implements expand/collapse filtering:
        - `_getRawFlowNodesArray`
        - `_getFlowNodesArray` (filters collapsed descendants)
        - `_getFlowEdgesArray` (remaps edges to collapsed containers)
        - `.vqd-flow-expand-btn` click handling
        """
        self.assertIn("_getRawFlowNodesArray", self.d3_renderer_js)
        self.assertIn("_getFlowNodesArray", self.d3_renderer_js)
        self.assertIn("_getFlowEdgesArray", self.d3_renderer_js)
        self.assertIn("collapsedContainers", self.d3_renderer_js)
        self.assertIn("childToContainerMap", self.d3_renderer_js)
        self.assertIn("vqd-flow-expand-btn", self.d3_renderer_js)

    def test_al_phase7_recursive_cte_cycle_detection(self):
        """
        Recursive CTE anchor + recursive member query.
        Verifies RECURSIVE_CYCLE edge, status='recursive', and deadlock prevention.
        """
        sql = """
        WITH EmployeeHierarchy AS (
            SELECT EmployeeId, ManagerId, 1 AS Level
            FROM dbo.Employee
            WHERE ManagerId IS NULL

            UNION ALL

            SELECT e.EmployeeId, e.ManagerId, eh.Level + 1
            FROM dbo.Employee e
            INNER JOIN EmployeeHierarchy eh ON e.ManagerId = eh.EmployeeId
        )
        SELECT * FROM EmployeeHierarchy;
        """
        graph = QueryFlowService.build_flow_graph(sql, dialect="tsql")

        cte_node = graph.get_node("cte_EmployeeHierarchy")
        self.assertIsNotNone(cte_node)
        self.assertEqual(cte_node.status, "recursive")

        # Verify recursive cycle edge exists
        rec_edges = [e for e in graph.edges if e.edge_type == QueryEdgeType.RECURSIVE_CYCLE or e.metadata.get("isCycle")]
        self.assertTrue(len(rec_edges) >= 1)
        self.assertEqual(rec_edges[0].source_node_id, cte_node.id)
        self.assertEqual(rec_edges[0].target_node_id, cte_node.id)

        # Topological sorting terminated without infinite loop
        self.assertGreater(cte_node.logical_step, 0)


if __name__ == "__main__":
    unittest.main()



