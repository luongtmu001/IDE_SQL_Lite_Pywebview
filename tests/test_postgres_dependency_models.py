import unittest
from app.services.postgres_dependency.models import (
    ObjectType,
    RelationType,
    DependencyType,
    Confidence,
    DependencySource,
    GraphDirection,
    Node,
    Edge,
    WarningInfo,
    DependencyGraphModel,
    make_node_id
)


class TestPostgresDependencyModels(unittest.TestCase):
    def test_enums_and_aliases(self):
        self.assertEqual(ObjectType.from_str("view"), ObjectType.VIEW)
        self.assertEqual(ObjectType.from_str("matview"), ObjectType.MATERIALIZED_VIEW)
        self.assertEqual(ObjectType.from_str("col"), ObjectType.COLUMN)
        self.assertEqual(ObjectType.from_str("fn"), ObjectType.FUNCTION)
        self.assertEqual(ObjectType.from_str("proc"), ObjectType.PROCEDURE)
        self.assertEqual(ObjectType.from_str("trig"), ObjectType.TRIGGER)
        self.assertEqual(ObjectType.from_str("invalid_xyz"), ObjectType.UNKNOWN)

        self.assertEqual(Confidence.from_str("confirmed"), Confidence.CONFIRMED)
        self.assertEqual(Confidence.from_str("likely"), Confidence.LIKELY)
        self.assertEqual(Confidence.from_str("possible"), Confidence.POSSIBLE)

        self.assertEqual(RelationType.from_str("uses_column"), RelationType.USES_COLUMN)
        self.assertEqual(RelationType.from_str("references_view"), RelationType.REFERENCES_VIEW)

        self.assertEqual(GraphDirection.from_str("dependents"), GraphDirection.DEPENDENTS)
        self.assertEqual(GraphDirection.from_str("dependencies"), GraphDirection.DEPENDENCIES)

    def test_make_node_id(self):
        col_id = make_node_id(ObjectType.COLUMN, "public", "customer_id", "b30_customer")
        self.assertEqual(col_id, "column:public.b30_customer.customer_id")

        view_id = make_node_id(ObjectType.VIEW, "public", "v_customer")
        self.assertEqual(view_id, "view:public.v_customer")

        fn_id = make_node_id(ObjectType.FUNCTION, "analytics", "fn_calculate_revenue")
        self.assertEqual(fn_id, "function:analytics.fn_calculate_revenue")

    def test_node_and_edge_serialization(self):
        node = Node(
            id="column:public.b30_customer.customer_id",
            object_type=ObjectType.COLUMN,
            schema="public",
            name="customer_id",
            parent_name="b30_customer",
            display_name="public.b30_customer.customer_id",
            oid=16452,
            confidence=Confidence.CONFIRMED,
            source=DependencySource.CATALOG,
            metadata={"data_type": "bigint", "is_pk": True}
        )

        d = node.to_dict()
        self.assertEqual(d["id"], "column:public.b30_customer.customer_id")
        self.assertEqual(d["object_type"], "COLUMN")
        self.assertEqual(d["confidence"], "CONFIRMED")
        self.assertEqual(d["metadata"]["data_type"], "bigint")

        restored_node = Node.from_dict(d)
        self.assertEqual(restored_node.id, node.id)
        self.assertEqual(restored_node.oid, 16452)
        self.assertEqual(restored_node.confidence, Confidence.CONFIRMED)

        edge = Edge(
            source="column:public.b30_customer.customer_id",
            target="view:public.v_customer",
            relation=RelationType.USES_COLUMN,
            confidence=Confidence.CONFIRMED,
            source_type=DependencySource.CATALOG
        )
        edge_dict = edge.to_dict()
        self.assertEqual(edge_dict["relation"], "USES_COLUMN")
        restored_edge = Edge.from_dict(edge_dict)
        self.assertEqual(restored_edge.target, "view:public.v_customer")

    def test_dependency_graph_model(self):
        graph = DependencyGraphModel(direction=GraphDirection.DEPENDENTS, depth_limit=2)

        root = Node(
            id="column:public.customer.id",
            object_type=ObjectType.COLUMN,
            schema="public",
            name="id",
            parent_name="customer",
            display_name="public.customer.id"
        )
        graph.set_root(root)

        v1 = Node(
            id="view:public.v_customer",
            object_type=ObjectType.VIEW,
            schema="public",
            name="v_customer",
            display_name="public.v_customer"
        )
        v2 = Node(
            id="view:public.v_customer_summary",
            object_type=ObjectType.VIEW,
            schema="public",
            name="v_customer_summary",
            display_name="public.v_customer_summary"
        )
        graph.add_node(v1)
        graph.add_node(v2)

        edge1 = Edge(source=root.id, target=v1.id, relation=RelationType.USES_COLUMN)
        edge2 = Edge(source=v1.id, target=v2.id, relation=RelationType.REFERENCES_VIEW)
        graph.add_edge(edge1)
        graph.add_edge(edge2)

        # Duplicate edge should be deduplicated
        graph.add_edge(Edge(source=root.id, target=v1.id, relation=RelationType.USES_COLUMN))
        self.assertEqual(len(graph.edges), 2)

        # Warning
        graph.add_warning(WarningInfo(
            type="DYNAMIC_SQL",
            level="WARNING",
            message="Possible runtime reference detected in fn_dynamic_query"
        ))

        graph_dict = graph.to_dict()
        self.assertEqual(graph_dict["stats"]["node_count"], 3)
        self.assertEqual(graph_dict["stats"]["edge_count"], 2)
        self.assertEqual(graph_dict["stats"]["warning_count"], 1)

        # Test Tree projection
        tree = graph.to_tree_projection()
        self.assertIsNotNone(tree)
        self.assertEqual(tree["id"], root.id)
        self.assertEqual(len(tree["children"]), 1)
        self.assertEqual(tree["children"][0]["id"], v1.id)
        self.assertEqual(len(tree["children"][0]["children"]), 1)
        self.assertEqual(tree["children"][0]["children"][0]["id"], v2.id)

    def test_cycle_handling_in_tree_projection(self):
        graph = DependencyGraphModel()
        n1 = Node(id="node:1", object_type=ObjectType.TABLE, schema="public", name="t1", display_name="t1")
        n2 = Node(id="node:2", object_type=ObjectType.VIEW, schema="public", name="v2", display_name="v2")
        graph.set_root(n1)
        graph.add_node(n2)

        # Create cycle n1 -> n2 -> n1
        graph.add_edge(Edge(source="node:1", target="node:2"))
        graph.add_edge(Edge(source="node:2", target="node:1"))

        # Should not get into infinite recursion
        tree = graph.to_tree_projection()
        self.assertIsNotNone(tree)
        self.assertEqual(tree["id"], "node:1")
        child = tree["children"][0]
        self.assertEqual(child["id"], "node:2")
        cyclic_child = child["children"][0]
        self.assertTrue(cyclic_child.get("is_cyclic_ref", False))


if __name__ == "__main__":
    unittest.main()
