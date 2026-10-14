"""PostgreSQL Dependency Graph Models
Conforms to specifications in .SKILL/postgres_dependcy_graph.md.

Separates Graph Data Model from UI rendering. Backend handles purely
graph models, nodes, edges, and confidence metadata.
"""

from enum import Enum
from typing import Dict, List, Optional, Any, Set, Union
from dataclasses import dataclass, field
import time


class ObjectType(str, Enum):
    """Supported PostgreSQL Database Object Types for Dependency Analysis."""
    DATABASE = "DATABASE"
    SCHEMA = "SCHEMA"
    TABLE = "TABLE"
    COLUMN = "COLUMN"
    VIEW = "VIEW"
    MATERIALIZED_VIEW = "MATERIALIZED_VIEW"
    FUNCTION = "FUNCTION"
    PROCEDURE = "PROCEDURE"
    TRIGGER = "TRIGGER"
    RULE = "RULE"
    CONSTRAINT = "CONSTRAINT"
    FOREIGN_KEY = "FOREIGN_KEY"
    SEQUENCE = "SEQUENCE"
    INDEX = "INDEX"
    TYPE = "TYPE"
    DOMAIN = "DOMAIN"
    FOREIGN_TABLE = "FOREIGN_TABLE"
    UNKNOWN = "UNKNOWN"

    @classmethod
    def from_str(cls, val: Optional[str]) -> "ObjectType":
        if not val:
            return cls.UNKNOWN
        clean = val.strip().upper()
        for member in cls:
            if member.value == clean:
                return member
        # Common aliases
        if clean in ("MATVIEW", "MAT_VIEW", "MVIEW"):
            return cls.MATERIALIZED_VIEW
        if clean in ("FUNC", "FN"):
            return cls.FUNCTION
        if clean in ("PROC", "SP"):
            return cls.PROCEDURE
        if clean in ("TRIG", "TRG"):
            return cls.TRIGGER
        if clean in ("FK", "FOREIGN KEY"):
            return cls.FOREIGN_KEY
        if clean in ("COL", "FIELD"):
            return cls.COLUMN
        if clean in ("TBL", "RELATION"):
            return cls.TABLE
        if clean in ("IDX",):
            return cls.INDEX
        if clean in ("SEQ",):
            return cls.SEQUENCE
        return cls.UNKNOWN


class RelationType(str, Enum):
    """Semantic relation between two graph objects."""
    USES_COLUMN = "USES_COLUMN"
    USES_TABLE = "USES_TABLE"
    REFERENCES_VIEW = "REFERENCES_VIEW"
    CALLS_FUNCTION = "CALLS_FUNCTION"
    USES_SEQUENCE = "USES_SEQUENCE"
    HAS_TRIGGER = "HAS_TRIGGER"
    HAS_INDEX = "HAS_INDEX"
    HAS_CONSTRAINT = "HAS_CONSTRAINT"
    FOREIGN_KEY_TO = "FOREIGN_KEY_TO"
    DEPENDS_ON = "DEPENDS_ON"
    UNKNOWN = "UNKNOWN"

    @classmethod
    def from_str(cls, val: Optional[str]) -> "RelationType":
        if not val:
            return cls.DEPENDS_ON
        clean = val.strip().upper()
        for member in cls:
            if member.value == clean:
                return member
        return cls.DEPENDS_ON


class DependencyType(str, Enum):
    """Direct vs Indirect dependency."""
    DIRECT = "DIRECT"
    INDIRECT = "INDIRECT"

    @classmethod
    def from_str(cls, val: Optional[str]) -> "DependencyType":
        if not val:
            return cls.DIRECT
        clean = val.strip().upper()
        return cls.INDIRECT if clean == "INDIRECT" else cls.DIRECT


class Confidence(str, Enum):
    """Level of certainty for the detected dependency."""
    CONFIRMED = "CONFIRMED"          # Catalog verified (pg_depend, pg_rewrite)
    LIKELY = "LIKELY"                # Source code analysis with clear structured reference
    POSSIBLE = "POSSIBLE"            # Heuristic, string literal, or dynamic SQL
    UNKNOWN = "UNKNOWN"              # Dynamic/runtime unresolved dependency

    @classmethod
    def from_str(cls, val: Optional[str]) -> "Confidence":
        if not val:
            return cls.CONFIRMED
        clean = val.strip().upper()
        for member in cls:
            if member.value == clean:
                return member
        return cls.CONFIRMED


class DependencySource(str, Enum):
    """Origin of dependency discovery."""
    CATALOG = "CATALOG"
    SOURCE_ANALYSIS = "SOURCE_ANALYSIS"
    HEURISTIC = "HEURISTIC"
    RUNTIME_UNKNOWN = "RUNTIME_UNKNOWN"

    @classmethod
    def from_str(cls, val: Optional[str]) -> "DependencySource":
        if not val:
            return cls.CATALOG
        clean = val.strip().upper()
        for member in cls:
            if member.value == clean:
                return member
        return cls.CATALOG


class GraphDirection(str, Enum):
    """Graph traversal direction."""
    DEPENDENTS = "dependents"        # Root -> Objects that use Root (e.g. Column -> Views, Functions)
    DEPENDENCIES = "dependencies"    # Root -> Objects that Root depends on (e.g. View -> Tables, Columns)

    @classmethod
    def from_str(cls, val: Optional[str]) -> "GraphDirection":
        if not val:
            return cls.DEPENDENTS
        clean = val.strip().lower()
        return cls.DEPENDENCIES if clean.startswith("dependenc") else cls.DEPENDENTS


def make_node_id(
    obj_type: Union[ObjectType, str],
    schema: str,
    name: str,
    parent_name: Optional[str] = None,
    oid: Optional[int] = None
) -> str:
    """Generate a stable, human-readable and unique identifier for a node."""
    type_str = (obj_type.value if isinstance(obj_type, ObjectType) else str(obj_type)).lower()
    sch = (schema or "public").strip()
    nm = (name or "").strip()
    
    if parent_name:
        p_nm = parent_name.strip()
        base_id = f"{type_str}:{sch}.{p_nm}.{nm}"
    else:
        base_id = f"{type_str}:{sch}.{nm}"
        
    return base_id


@dataclass
class Node:
    """Represents an object node in the PostgreSQL Dependency Graph."""
    id: str
    object_type: Union[ObjectType, str]
    schema: str
    name: str
    display_name: str
    oid: Optional[int] = None
    parent_name: Optional[str] = None     # e.g., table name for columns or triggers
    dependency_type: Union[DependencyType, str] = DependencyType.DIRECT
    confidence: Union[Confidence, str] = Confidence.CONFIRMED
    source: Union[DependencySource, str] = DependencySource.CATALOG
    definition_available: bool = True
    definition_type: Optional[str] = None # 'view', 'function', 'trigger', 'constraint'
    level: int = 0                        # Distance from root (0 = root)
    children_count: int = 0               # Number of dependencies if not fully fetched
    is_expanded: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        obj_type_str = self.object_type.value if isinstance(self.object_type, ObjectType) else str(self.object_type)
        dep_type_str = self.dependency_type.value if isinstance(self.dependency_type, DependencyType) else str(self.dependency_type)
        conf_str = self.confidence.value if isinstance(self.confidence, Confidence) else str(self.confidence)
        src_str = self.source.value if isinstance(self.source, DependencySource) else str(self.source)

        return {
            "id": self.id,
            "oid": self.oid,
            "object_type": obj_type_str,
            "schema": self.schema,
            "name": self.name,
            "parent_name": self.parent_name,
            "display_name": self.display_name,
            "dependency_type": dep_type_str,
            "confidence": conf_str,
            "source": src_str,
            "definition_available": self.definition_available,
            "definition_type": self.definition_type or obj_type_str.lower(),
            "level": self.level,
            "children_count": self.children_count,
            "is_expanded": self.is_expanded,
            "metadata": self.metadata or {}
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Node":
        return cls(
            id=data.get("id", ""),
            oid=data.get("oid"),
            object_type=ObjectType.from_str(data.get("object_type")),
            schema=data.get("schema", "public"),
            name=data.get("name", ""),
            parent_name=data.get("parent_name"),
            display_name=data.get("display_name") or data.get("name", ""),
            dependency_type=DependencyType.from_str(data.get("dependency_type")),
            confidence=Confidence.from_str(data.get("confidence")),
            source=DependencySource.from_str(data.get("source")),
            definition_available=bool(data.get("definition_available", True)),
            definition_type=data.get("definition_type"),
            level=int(data.get("level", 0)),
            children_count=int(data.get("children_count", 0)),
            is_expanded=bool(data.get("is_expanded", False)),
            metadata=data.get("metadata") or {}
        )


@dataclass
class Edge:
    """Represents a directional dependency edge between two nodes."""
    source: str                           # Origin Node ID
    target: str                           # Dependent Node ID
    relation: Union[RelationType, str] = RelationType.DEPENDS_ON
    dependency_type: Union[DependencyType, str] = DependencyType.DIRECT
    confidence: Union[Confidence, str] = Confidence.CONFIRMED
    source_type: Union[DependencySource, str] = DependencySource.CATALOG
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        rel_str = self.relation.value if isinstance(self.relation, RelationType) else str(self.relation)
        dep_str = self.dependency_type.value if isinstance(self.dependency_type, DependencyType) else str(self.dependency_type)
        conf_str = self.confidence.value if isinstance(self.confidence, Confidence) else str(self.confidence)
        src_str = self.source_type.value if isinstance(self.source_type, DependencySource) else str(self.source_type)

        return {
            "source": self.source,
            "target": self.target,
            "relation": rel_str,
            "dependency_type": dep_str,
            "confidence": conf_str,
            "source_type": src_str,
            "metadata": self.metadata or {}
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Edge":
        return cls(
            source=data.get("source", ""),
            target=data.get("target", ""),
            relation=RelationType.from_str(data.get("relation")),
            dependency_type=DependencyType.from_str(data.get("dependency_type")),
            confidence=Confidence.from_str(data.get("confidence")),
            source_type=DependencySource.from_str(data.get("source_type")),
            metadata=data.get("metadata") or {}
        )


@dataclass
class WarningInfo:
    """Represents a safety, dynamic SQL or external environment warning."""
    type: str                             # DYNAMIC_SQL, EXTERNAL_DEPENDENCY, CATALOG_NOTICE, PERMISSION
    level: str                            # WARNING, INFO, CAUTION
    message: str
    details: Optional[str] = None
    node_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "level": self.level,
            "message": self.message,
            "details": self.details,
            "node_id": self.node_id
        }


@dataclass
class DependencyGraphModel:
    """
    Complete PostgreSQL Dependency Graph representation.
    Decoupled from visualization engines (D3 Tree, D3 Force, SVG, etc.).
    """
    root: Optional[Node] = None
    nodes: Dict[str, Node] = field(default_factory=dict)
    edges: List[Edge] = field(default_factory=list)
    warnings: List[WarningInfo] = field(default_factory=list)
    direction: Union[GraphDirection, str] = GraphDirection.DEPENDENTS
    depth_limit: int = 1
    metadata: Dict[str, Any] = field(default_factory=dict)

    def set_root(self, node: Node) -> None:
        """Assign the root node of this graph."""
        self.root = node
        self.add_node(node)

    def add_node(self, node: Node) -> Node:
        """Add or update an object node in the graph."""
        if not node or not node.id:
            raise ValueError("Node must have a valid non-empty id")
        if node.id in self.nodes:
            existing = self.nodes[node.id]
            # Merge metadata if needed
            if node.metadata:
                existing.metadata.update(node.metadata)
            if node.oid and not existing.oid:
                existing.oid = node.oid
            if node.level > 0 and existing.level == 0 and existing != self.root:
                existing.level = node.level
            return existing
        self.nodes[node.id] = node
        return node

    def add_edge(self, edge: Edge) -> Optional[Edge]:
        """Add a directional dependency edge, deduplicating identical pairs."""
        if not edge or not edge.source or not edge.target:
            return None
        if edge.source == edge.target:
            return None # Ignore self-referential loops in dependency graph
            
        for existing in self.edges:
            if existing.source == edge.source and existing.target == edge.target:
                # Update relation or metadata if higher confidence
                return existing
        self.edges.append(edge)
        return edge

    def has_node(self, node_id: str) -> bool:
        return node_id in self.nodes

    def get_node(self, node_id: str) -> Optional[Node]:
        return self.nodes.get(node_id)

    def get_outgoing_edges(self, source_id: str) -> List[Edge]:
        """Get all edges starting from source_id."""
        return [e for e in self.edges if e.source == source_id]

    def get_incoming_edges(self, target_id: str) -> List[Edge]:
        """Get all edges pointing to target_id."""
        return [e for e in self.edges if e.target == target_id]

    def add_warning(self, warning: Union[WarningInfo, Dict[str, Any]]) -> None:
        if isinstance(warning, dict):
            w = WarningInfo(
                type=warning.get("type", "NOTICE"),
                level=warning.get("level", "INFO"),
                message=warning.get("message", ""),
                details=warning.get("details"),
                node_id=warning.get("node_id")
            )
            self.warnings.append(w)
        else:
            self.warnings.append(warning)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize complete model into REST-compliant JSON."""
        dir_str = self.direction.value if isinstance(self.direction, GraphDirection) else str(self.direction)
        return {
            "root": self.root.to_dict() if self.root else None,
            "nodes": [node.to_dict() for node in self.nodes.values()],
            "edges": [edge.to_dict() for edge in self.edges],
            "warnings": [w.to_dict() for w in self.warnings],
            "direction": dir_str,
            "depth_limit": self.depth_limit,
            "stats": {
                "node_count": len(self.nodes),
                "edge_count": len(self.edges),
                "warning_count": len(self.warnings)
            },
            "metadata": {
                **self.metadata,
                "timestamp": self.metadata.get("timestamp", time.time())
            }
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DependencyGraphModel":
        """Deserialize graph model from dictionary."""
        model = cls(
            direction=GraphDirection.from_str(data.get("direction")),
            depth_limit=int(data.get("depth_limit", 1)),
            metadata=data.get("metadata") or {}
        )
        if data.get("root"):
            model.root = Node.from_dict(data["root"])

        for n_dict in data.get("nodes", []):
            model.add_node(Node.from_dict(n_dict))

        for e_dict in data.get("edges", []):
            model.add_edge(Edge.from_dict(e_dict))

        for w_dict in data.get("warnings", []):
            model.add_warning(WarningInfo(
                type=w_dict.get("type", "NOTICE"),
                level=w_dict.get("level", "INFO"),
                message=w_dict.get("message", ""),
                details=w_dict.get("details"),
                node_id=w_dict.get("node_id")
            ))

        return model

    def to_tree_projection(self) -> Optional[Dict[str, Any]]:
        """
        Creates a hierarchical Tree projection from the Graph Model.
        Required by Section 16 & 42 of .SKILL/postgres_dependcy_graph.md.
        
        Transforms the Directed Acyclic Graph (DAG) into an expandable
        D3 hierarchy tree format without altering the underlying graph model.
        """
        if not self.root:
            return None

        def build_tree_node(node: Node, ancestors: Set[str]) -> Dict[str, Any]:
            tree_node = {
                **node.to_dict(),
                "children": []
            }

            if node.id in ancestors:
                tree_node["is_cyclic_ref"] = True
                return tree_node

            new_ancestors = ancestors | {node.id}
            outgoing = self.get_outgoing_edges(node.id)
            children_nodes = []
            for edge in outgoing:
                child = self.get_node(edge.target)
                if child:
                    child_tree = build_tree_node(child, new_ancestors)
                    child_tree["edge_relation"] = edge.relation.value if isinstance(edge.relation, RelationType) else str(edge.relation)
                    child_tree["edge_confidence"] = edge.confidence.value if isinstance(edge.confidence, Confidence) else str(edge.confidence)
                    children_nodes.append(child_tree)

            tree_node["children"] = children_nodes
            return tree_node

        return build_tree_node(self.root, set())

