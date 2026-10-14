"""PostgreSQL Catalog Analyzer
Implements direct querying against PostgreSQL system catalogs:
pg_depend, pg_rewrite, pg_class, pg_attribute, pg_proc, pg_trigger, pg_constraint, pg_index.

Extracts CONFIRMED dependencies with precise OIDs, schemas, and object identities.
Conforms to .SKILL/postgres_dependcy_graph.md and .SKILL/Dependency Catalog trong PostgreSQL.md.
"""

from typing import Dict, List, Optional, Any, Tuple, Set
import logging

from .models import (
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

logger = logging.getLogger(__name__)


class PostgresCatalogAnalyzer:
    """Queries PostgreSQL catalog metadata to discover confirmed dependencies."""

    def __init__(self, adapter: Any):
        """
        :param adapter: PostgreSqlAdapter instance from app.database.postgresql
        """
        self.adapter = adapter

    def _execute(self, sql: str, params: Optional[Tuple[Any, ...]] = None, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Helper to run parameterized SQL and return list of dict rows."""
        try:
            res = self.adapter.execute(sql, params=params, database=database)
            if not res or not res.get("rows"):
                return []
            cols = [c.get("name") if isinstance(c, dict) else str(c) for c in res.get("columns", [])]
            result = []
            for r in res["rows"]:
                result.append(dict(zip(cols, r)))
            return result
        except Exception as e:
            logger.warning("Error executing catalog query: %s", e)
            return []

    # -------------------------------------------------------------------------
    # Identity Resolution
    # -------------------------------------------------------------------------

    def resolve_column(self, schema: str, table_name: str, column_name: str, database: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Resolve a column's OID, attnum, and type."""
        # 1. Try with specified schema if provided
        if schema:
            sql = """
            SELECT 
                c.oid AS table_oid,
                c.relname AS table_name,
                n.nspname AS schema_name,
                c.relkind,
                a.attnum,
                a.attname AS column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                COALESCE(pk.is_pk, false) AS is_pk
            FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN (
                SELECT conrelid, unnest(conkey) AS attnum, true AS is_pk
                FROM pg_catalog.pg_constraint
                WHERE contype = 'p'
            ) pk ON pk.conrelid = c.oid AND pk.attnum = a.attnum
            WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
              AND (c.relname = %s OR lower(c.relname) = lower(%s))
              AND (a.attname = %s OR lower(a.attname) = lower(%s))
              AND a.attnum > 0
              AND NOT a.attisdropped
            LIMIT 1;
            """
            rows = self._execute(sql, (schema, schema, table_name, table_name, column_name, column_name), database=database)
            if rows:
                return rows[0]

        # 2. Fallback: Search without schema restriction (in case schema passed was wrong or 'public')
        sql_fallback = """
        SELECT 
            c.oid AS table_oid,
            c.relname AS table_name,
            n.nspname AS schema_name,
            c.relkind,
            a.attnum,
            a.attname AS column_name,
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
            COALESCE(pk.is_pk, false) AS is_pk
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN (
            SELECT conrelid, unnest(conkey) AS attnum, true AS is_pk
            FROM pg_catalog.pg_constraint
            WHERE contype = 'p'
        ) pk ON pk.conrelid = c.oid AND pk.attnum = a.attnum
        WHERE (c.relname = %s OR lower(c.relname) = lower(%s))
          AND (a.attname = %s OR lower(a.attname) = lower(%s))
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY CASE WHEN n.nspname = 'public' THEN 1 ELSE 2 END
        LIMIT 1;
        """
        rows = self._execute(sql_fallback, (table_name, table_name, column_name, column_name), database=database)
        return rows[0] if rows else None

    def resolve_object(self, obj_type: ObjectType, schema: str, name: str, database: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Resolve table, view, function or trigger identity."""
        if obj_type in (ObjectType.TABLE, ObjectType.VIEW, ObjectType.MATERIALIZED_VIEW, ObjectType.SEQUENCE):
            relkind_map = {
                ObjectType.TABLE: ('r', 'p'),
                ObjectType.VIEW: ('v',),
                ObjectType.MATERIALIZED_VIEW: ('m',),
                ObjectType.SEQUENCE: ('S',)
            }
            kinds = relkind_map.get(obj_type, ('r', 'p', 'v', 'm'))
            if schema:
                sql = f"""
                SELECT 
                    c.oid,
                    c.relname AS name,
                    n.nspname AS schema_name,
                    c.relkind
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (c.relname = %s OR lower(c.relname) = lower(%s))
                  AND c.relkind IN ({", ".join(f"'{k}'" for k in kinds)})
                LIMIT 1;
                """
                rows = self._execute(sql, (schema, schema, name, name), database=database)
                if rows:
                    return rows[0]

            # Fallback without schema
            sql_fallback = f"""
            SELECT 
                c.oid,
                c.relname AS name,
                n.nspname AS schema_name,
                c.relkind
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE (c.relname = %s OR lower(c.relname) = lower(%s))
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND c.relkind IN ({", ".join(f"'{k}'" for k in kinds)})
            ORDER BY CASE WHEN n.nspname = 'public' THEN 1 ELSE 2 END
            LIMIT 1;
            """
            rows = self._execute(sql_fallback, (name, name), database=database)
            return rows[0] if rows else None

        if obj_type in (ObjectType.FUNCTION, ObjectType.PROCEDURE):
            if schema:
                sql = """
                SELECT 
                    p.oid,
                    p.proname AS name,
                    n.nspname AS schema_name,
                    p.prokind
                FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE (n.nspname = %s OR lower(n.nspname) = lower(%s))
                  AND (p.proname = %s OR lower(p.proname) = lower(%s))
                LIMIT 1;
                """
                rows = self._execute(sql, (schema, schema, name, name), database=database)
                if rows:
                    return rows[0]

            sql_fallback = """
            SELECT 
                p.oid,
                p.proname AS name,
                n.nspname AS schema_name,
                p.prokind
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE (p.proname = %s OR lower(p.proname) = lower(%s))
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY CASE WHEN n.nspname = 'public' THEN 1 ELSE 2 END
            LIMIT 1;
            """
            rows = self._execute(sql_fallback, (name, name), database=database)
            return rows[0] if rows else None

        return None


    # -------------------------------------------------------------------------
    # Dependents Analysis (Who uses this object?)
    # -------------------------------------------------------------------------

    def get_column_dependents(
        self,
        schema: str,
        table_name: str,
        column_name: str,
        depth_limit: int = 2,
        database: Optional[str] = None
    ) -> DependencyGraphModel:
        """
        Builds graph of objects depending on a column (e.g. Views, Triggers, Constraints, FKey).
        Handles depth limit and multi-level indirect dependencies.
        """
        graph = DependencyGraphModel(
            direction=GraphDirection.DEPENDENTS,
            depth_limit=depth_limit,
            metadata={"database": database, "root_type": "COLUMN"}
        )

        col_info = self.resolve_column(schema, table_name, column_name, database=database)
        if not col_info:
            # Column identity could not be found in catalog
            root_id = make_node_id(ObjectType.COLUMN, schema, column_name, parent_name=table_name)
            root = Node(
                id=root_id,
                object_type=ObjectType.COLUMN,
                schema=schema,
                name=column_name,
                parent_name=table_name,
                display_name=f"{schema}.{table_name}.{column_name}",
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG
            )
            graph.set_root(root)
            graph.add_warning(WarningInfo(
                type="CATALOG_NOTICE",
                level="WARNING",
                message=f"Column '{schema}.{table_name}.{column_name}' could not be resolved in pg_catalog.",
                details="Verify schema and table existence or check permissions."
            ))
            return graph

        table_oid = col_info["table_oid"]
        attnum = col_info["attnum"]
        resolved_schema = col_info["schema_name"]
        resolved_table = col_info["table_name"]
        resolved_col = col_info["column_name"]

        root_id = make_node_id(ObjectType.COLUMN, resolved_schema, resolved_col, parent_name=resolved_table, oid=table_oid)
        root = Node(
            id=root_id,
            object_type=ObjectType.COLUMN,
            schema=resolved_schema,
            name=resolved_col,
            parent_name=resolved_table,
            display_name=f"{resolved_schema}.{resolved_table}.{resolved_col}",
            oid=table_oid,
            confidence=Confidence.CONFIRMED,
            source=DependencySource.CATALOG,
            level=0,
            metadata={
                "data_type": col_info.get("data_type"),
                "is_pk": col_info.get("is_pk", False),
                "attnum": attnum
            }
        )
        graph.set_root(root)

        # 1. Direct Dependents on this column:
        # 1A. Views & Materialized Views via pg_depend + pg_rewrite
        view_deps = self._get_views_using_column(table_oid, attnum, table_name=resolved_table, column_name=resolved_col, database=database)
        current_level_nodes: List[Tuple[Node, int]] = []

        for v in view_deps:
            obj_type = ObjectType.MATERIALIZED_VIEW if v.get("relkind") == 'm' else ObjectType.VIEW
            v_id = make_node_id(obj_type, v.get("schema_name", "public"), v.get("view_name", ""), oid=v.get("view_oid"))
            v_node = Node(
                id=v_id,
                object_type=obj_type,
                schema=v["schema_name"],
                name=v["view_name"],
                display_name=f"{v['schema_name']}.{v['view_name']}",
                oid=v["view_oid"],
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=1,
                definition_available=True,
                definition_type="view"
            )
            graph.add_node(v_node)
            graph.add_edge(Edge(
                source=root.id,
                target=v_node.id,
                relation=RelationType.USES_COLUMN,
                dependency_type=DependencyType.DIRECT,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))
            current_level_nodes.append((v_node, 1))

        # 1B. Foreign Keys referencing this column
        fk_deps = self._get_foreign_keys_referencing_column(table_oid, attnum, database=database)
        for fk in fk_deps:
            fk_id = make_node_id(ObjectType.FOREIGN_KEY, fk["src_schema"], fk["conname"], parent_name=fk["src_table"], oid=fk["con_oid"])
            fk_node = Node(
                id=fk_id,
                object_type=ObjectType.FOREIGN_KEY,
                schema=fk["src_schema"],
                name=fk["conname"],
                parent_name=fk["src_table"],
                display_name=f"{fk['src_schema']}.{fk['src_table']} ({fk['conname']})",
                oid=fk["con_oid"],
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=1,
                definition_available=True,
                definition_type="constraint"
            )
            graph.add_node(fk_node)
            graph.add_edge(Edge(
                source=root.id,
                target=fk_node.id,
                relation=RelationType.FOREIGN_KEY_TO,
                dependency_type=DependencyType.DIRECT,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))

        # 1C. Indexes referencing this column
        idx_deps = self._get_indexes_on_column(table_oid, attnum, database=database)
        for idx in idx_deps:
            idx_id = make_node_id(ObjectType.INDEX, idx["schema_name"], idx["index_name"], parent_name=resolved_table, oid=idx["idx_oid"])
            idx_node = Node(
                id=idx_id,
                object_type=ObjectType.INDEX,
                schema=idx["schema_name"],
                name=idx["index_name"],
                parent_name=resolved_table,
                display_name=f"{idx['schema_name']}.{idx['index_name']}",
                oid=idx["idx_oid"],
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=1,
                definition_available=False
            )
            graph.add_node(idx_node)
            graph.add_edge(Edge(
                source=root.id,
                target=idx_node.id,
                relation=RelationType.HAS_INDEX,
                dependency_type=DependencyType.DIRECT,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))

        # 1D. Constraints on this column
        con_deps = self._get_constraints_on_column(table_oid, attnum, database=database)
        for con in con_deps:
            con_id = make_node_id(ObjectType.CONSTRAINT, con["schema_name"], con["conname"], parent_name=resolved_table, oid=con["con_oid"])
            con_node = Node(
                id=con_id,
                object_type=ObjectType.CONSTRAINT,
                schema=con["schema_name"],
                name=con["conname"],
                parent_name=resolved_table,
                display_name=f"{con['schema_name']}.{con['conname']}",
                oid=con["con_oid"],
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=1,
                definition_available=True,
                definition_type="constraint",
                metadata={"definition": con.get("def")}
            )
            graph.add_node(con_node)
            graph.add_edge(Edge(
                source=root.id,
                target=con_node.id,
                relation=RelationType.HAS_CONSTRAINT,
                dependency_type=DependencyType.DIRECT,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))

        # 1E. Triggers on the table
        trig_deps = self._get_triggers_on_table(table_oid, database=database)
        for tr in trig_deps:
            tr_id = make_node_id(ObjectType.TRIGGER, tr["schema_name"], tr["tgname"], parent_name=resolved_table, oid=tr["trig_oid"])
            tr_node = Node(
                id=tr_id,
                object_type=ObjectType.TRIGGER,
                schema=tr["schema_name"],
                name=tr["tgname"],
                parent_name=resolved_table,
                display_name=f"{tr['schema_name']}.{tr['tgname']}",
                oid=tr["trig_oid"],
                confidence=Confidence.LIKELY if tr.get("tgattr") else Confidence.POSSIBLE,
                source=DependencySource.CATALOG,
                level=1,
                definition_available=True,
                definition_type="trigger"
            )
            graph.add_node(tr_node)
            graph.add_edge(Edge(
                source=root.id,
                target=tr_node.id,
                relation=RelationType.HAS_TRIGGER,
                dependency_type=DependencyType.DIRECT,
                confidence=tr_node.confidence,
                source_type=DependencySource.CATALOG
            ))

        # 2. Multi-level / Indirect dependencies (Depth > 1)
        if depth_limit > 1:
            visited_oids: Set[int] = {table_oid}
            frontier = list(current_level_nodes)
            while frontier:
                curr_node, curr_level = frontier.pop(0)
                if curr_level >= depth_limit or not curr_node.oid or curr_node.oid in visited_oids:
                    continue
                visited_oids.add(curr_node.oid)

                # If current node is a VIEW or MATERIALIZED_VIEW, find views that depend on it
                if curr_node.object_type in (ObjectType.VIEW, ObjectType.MATERIALIZED_VIEW):
                    child_views = self._get_views_using_view(curr_node.oid, database=database)
                    for cv in child_views:
                        cv_type = ObjectType.MATERIALIZED_VIEW if cv.get("relkind") == 'm' else ObjectType.VIEW
                        cv_id = make_node_id(cv_type, cv.get("schema_name", "public"), cv.get("view_name", ""), oid=cv.get("view_oid"))
                        cv_node = Node(
                            id=cv_id,
                            object_type=cv_type,
                            schema=cv.get("schema_name", "public"),
                            name=cv.get("view_name", ""),
                            display_name=f"{cv.get('schema_name', 'public')}.{cv.get('view_name', '')}",
                            oid=cv.get("view_oid"),
                            confidence=Confidence.CONFIRMED,
                            source=DependencySource.CATALOG,
                            level=curr_level + 1,
                            definition_available=True,
                            definition_type="view"
                        )
                        graph.add_node(cv_node)
                        graph.add_edge(Edge(
                            source=curr_node.id,
                            target=cv_node.id,
                            relation=RelationType.REFERENCES_VIEW,
                            dependency_type=DependencyType.INDIRECT,
                            confidence=Confidence.CONFIRMED,
                            source_type=DependencySource.CATALOG
                        ))
                        if curr_level + 1 < depth_limit:
                            frontier.append((cv_node, curr_level + 1))

        # Add statutory safety disclaimer warning
        graph.add_warning(WarningInfo(
            type="EXTERNAL_DEPENDENCY",
            level="INFO",
            message="Catalog dependencies verified via pg_depend and system catalogs.",
            details="Dynamic SQL (EXECUTE, format) or external client applications (APIs, ETL, BI) may not be recorded in PostgreSQL catalog."
        ))

        return graph

    # -------------------------------------------------------------------------
    # Catalog Queries
    # -------------------------------------------------------------------------

    def _get_views_using_column(self, table_oid: int, attnum: int, table_name: Optional[str] = None, column_name: Optional[str] = None, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find Views and Materialized Views referencing table_oid at attnum."""
        sql = """
        SELECT DISTINCT
            v.oid AS view_oid,
            v.relname AS view_name,
            n.nspname AS schema_name,
            v.relkind
        FROM pg_catalog.pg_depend d
        JOIN pg_catalog.pg_rewrite rw ON rw.oid = d.objid
        JOIN pg_catalog.pg_class v ON v.oid = rw.ev_class
        JOIN pg_catalog.pg_namespace n ON n.oid = v.relnamespace
        WHERE d.refclassid = 'pg_catalog.pg_class'::regclass
          AND d.refobjid = %s
          AND d.refobjsubid IN (%s, 0)
          AND d.classid = 'pg_catalog.pg_rewrite'::regclass
          AND v.oid != %s
          AND v.relkind IN ('v', 'm');
        """
        rows = self._execute(sql, (table_oid, attnum, table_oid), database=database)
        seen_names = {f"{r.get('schema_name', '')}.{r.get('view_name', '')}".lower() for r in rows}
        return rows

    def _get_views_using_view(self, view_oid: int, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find Views and Materialized Views referencing another view."""
        sql = """
        SELECT DISTINCT
            v.oid AS view_oid,
            v.relname AS view_name,
            n.nspname AS schema_name,
            v.relkind
        FROM pg_catalog.pg_depend d
        JOIN pg_catalog.pg_rewrite rw ON rw.oid = d.objid
        JOIN pg_catalog.pg_class v ON v.oid = rw.ev_class
        JOIN pg_catalog.pg_namespace n ON n.oid = v.relnamespace
        WHERE d.refclassid = 'pg_catalog.pg_class'::regclass
          AND d.refobjid = %s
          AND d.classid = 'pg_catalog.pg_rewrite'::regclass
          AND v.oid != %s
          AND v.relkind IN ('v', 'm');
        """
        return self._execute(sql, (view_oid, view_oid), database=database)

    def _get_foreign_keys_referencing_column(self, table_oid: int, attnum: int, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find foreign key constraints that target this column."""
        sql = """
        SELECT
            con.oid AS con_oid,
            con.conname,
            n.nspname AS src_schema,
            c.relname AS src_table,
            con.confrelid,
            con.conrelid
        FROM pg_catalog.pg_constraint con
        JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'f'
          AND con.confrelid = %s
          AND %s = ANY(con.confkey);
        """
        return self._execute(sql, (table_oid, attnum), database=database)

    def _get_indexes_on_column(self, table_oid: int, attnum: int, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find indexes on table containing attnum."""
        sql = """
        SELECT
            idx_c.oid AS idx_oid,
            idx_c.relname AS index_name,
            n.nspname AS schema_name
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class idx_c ON idx_c.oid = i.indexrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = idx_c.relnamespace
        WHERE i.indrelid = %s
          AND %s = ANY(i.indkey::int[]);
        """
        return self._execute(sql, (table_oid, attnum), database=database)

    def _get_constraints_on_column(self, table_oid: int, attnum: int, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find check constraints covering attnum."""
        sql = """
        SELECT
            con.oid AS con_oid,
            con.conname,
            n.nspname AS schema_name,
            pg_catalog.pg_get_constraintdef(con.oid, true) AS def
        FROM pg_catalog.pg_constraint con
        JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE con.conrelid = %s
          AND con.contype = 'c'
          AND %s = ANY(con.conkey);
        """
        return self._execute(sql, (table_oid, attnum), database=database)

    def _get_triggers_on_table(self, table_oid: int, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find triggers on table."""
        sql = """
        SELECT
            t.oid AS trig_oid,
            t.tgname,
            n.nspname AS schema_name,
            c.relname AS table_name,
            t.tgattr
        FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgrelid = %s
          AND NOT t.tgisinternal;
        """
        return self._execute(sql, (table_oid,), database=database)

    def _get_views_using_table(self, table_oid: int, table_name: Optional[str] = None, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find Views and Materialized Views referencing a table directly or via any column."""
        sql = """
        SELECT DISTINCT
            v.oid AS view_oid,
            v.relname AS view_name,
            n.nspname AS schema_name,
            v.relkind
        FROM pg_catalog.pg_depend d
        JOIN pg_catalog.pg_rewrite rw ON rw.oid = d.objid
        JOIN pg_catalog.pg_class v ON v.oid = rw.ev_class
        JOIN pg_catalog.pg_namespace n ON n.oid = v.relnamespace
        WHERE d.refclassid = 'pg_catalog.pg_class'::regclass
          AND d.refobjid = %s
          AND d.classid = 'pg_catalog.pg_rewrite'::regclass
          AND v.oid != %s
          AND v.relkind IN ('v', 'm');
        """
        rows = self._execute(sql, (table_oid, table_oid), database=database)
        seen_names = {f"{r.get('schema_name', '')}.{r.get('view_name', '')}".lower() for r in rows}
        return rows

    def _get_foreign_keys_referencing_table(self, table_oid: int, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find foreign key constraints in other tables pointing to this table."""
        sql = """
        SELECT
            con.oid AS con_oid,
            con.conname,
            n.nspname AS src_schema,
            c.relname AS src_table,
            c.oid AS src_table_oid,
            con.confrelid,
            con.conrelid
        FROM pg_catalog.pg_constraint con
        JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'f'
          AND con.confrelid = %s;
        """
        return self._execute(sql, (table_oid,), database=database)

    def _get_foreign_keys_from_table(self, table_oid: int, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find foreign key constraints on this table pointing to parent tables."""
        sql = """
        SELECT
            con.oid AS con_oid,
            con.conname,
            n.nspname AS target_schema,
            c.relname AS target_table,
            c.oid AS target_oid,
            con.confrelid,
            con.conrelid
        FROM pg_catalog.pg_constraint con
        JOIN pg_catalog.pg_class c ON c.oid = con.confrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'f'
          AND con.conrelid = %s;
        """
        return self._execute(sql, (table_oid,), database=database)

    def _get_indexes_on_table(self, table_oid: int, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find all indexes on table."""
        sql = """
        SELECT
            idx_c.oid AS idx_oid,
            idx_c.relname AS index_name,
            n.nspname AS schema_name
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class idx_c ON idx_c.oid = i.indexrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = idx_c.relnamespace
        WHERE i.indrelid = %s;
        """
        return self._execute(sql, (table_oid,), database=database)

    def _get_sequences_for_table(self, table_oid: int, database: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find sequence dependencies for auto-increment / serial columns of table."""
        sql = """
        SELECT DISTINCT
            s.oid AS seq_oid,
            s.relname AS seq_name,
            n.nspname AS schema_name
        FROM pg_catalog.pg_depend d
        JOIN pg_catalog.pg_class s ON s.oid = d.objid
        JOIN pg_catalog.pg_namespace n ON n.oid = s.relnamespace
        WHERE d.refclassid = 'pg_catalog.pg_class'::regclass
          AND d.refobjid = %s
          AND s.relkind = 'S';
        """
        return self._execute(sql, (table_oid,), database=database)

    def get_table_dependents(
        self,
        schema: str,
        table_name: str,
        depth_limit: int = 2,
        database: Optional[str] = None
    ) -> DependencyGraphModel:
        """
        Builds graph of objects depending on a Table (Views, Materialized Views, Foreign Keys, Triggers, Indexes).
        """
        graph = DependencyGraphModel(
            direction=GraphDirection.DEPENDENTS,
            depth_limit=depth_limit,
            metadata={"database": database, "root_type": "TABLE"}
        )

        tbl_info = self.resolve_object(ObjectType.TABLE, schema, table_name, database=database)
        if not tbl_info:
            root_id = make_node_id(ObjectType.TABLE, schema, table_name)
            root = Node(
                id=root_id,
                object_type=ObjectType.TABLE,
                schema=schema,
                name=table_name,
                display_name=f"{schema}.{table_name}",
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG
            )
            graph.set_root(root)
            graph.add_warning(WarningInfo(
                type="CATALOG_NOTICE",
                level="WARNING",
                message=f"Table '{schema}.{table_name}' could not be resolved in pg_catalog."
            ))
            return graph

        table_oid = tbl_info["oid"]
        resolved_schema = tbl_info["schema_name"]
        resolved_name = tbl_info["name"]

        root_id = make_node_id(ObjectType.TABLE, resolved_schema, resolved_name, oid=table_oid)
        root = Node(
            id=root_id,
            object_type=ObjectType.TABLE,
            schema=resolved_schema,
            name=resolved_name,
            display_name=f"{resolved_schema}.{resolved_name}",
            oid=table_oid,
            confidence=Confidence.CONFIRMED,
            source=DependencySource.CATALOG,
            level=0
        )
        graph.set_root(root)

        current_level_nodes: List[Tuple[Node, int]] = []

        # 1. Views using this table
        view_deps = self._get_views_using_table(table_oid, table_name=resolved_name, database=database)
        for v in view_deps:
            obj_type = ObjectType.MATERIALIZED_VIEW if v.get("relkind") == 'm' else ObjectType.VIEW
            v_id = make_node_id(obj_type, v.get("schema_name", "public"), v.get("view_name", ""), oid=v.get("view_oid"))
            v_node = Node(
                id=v_id,
                object_type=obj_type,
                schema=v["schema_name"],
                name=v["view_name"],
                display_name=f"{v['schema_name']}.{v['view_name']}",
                oid=v["view_oid"],
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=1,
                definition_available=True,
                definition_type="view"
            )
            graph.add_node(v_node)
            graph.add_edge(Edge(
                source=root.id,
                target=v_node.id,
                relation=RelationType.USES_TABLE,
                dependency_type=DependencyType.DIRECT,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))
            current_level_nodes.append((v_node, 1))

        # 2. Foreign Keys pointing to this table
        fk_deps = self._get_foreign_keys_referencing_table(table_oid, database=database)
        for fk in fk_deps:
            fk_id = make_node_id(ObjectType.FOREIGN_KEY, fk["src_schema"], fk["conname"], parent_name=fk["src_table"], oid=fk["con_oid"])
            fk_node = Node(
                id=fk_id,
                object_type=ObjectType.FOREIGN_KEY,
                schema=fk["src_schema"],
                name=fk["conname"],
                parent_name=fk["src_table"],
                display_name=f"{fk['src_schema']}.{fk['src_table']} ({fk['conname']})",
                oid=fk["con_oid"],
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=1,
                definition_available=True,
                definition_type="constraint"
            )
            graph.add_node(fk_node)
            graph.add_edge(Edge(
                source=root.id,
                target=fk_node.id,
                relation=RelationType.FOREIGN_KEY_TO,
                dependency_type=DependencyType.DIRECT,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))

        # 3. Triggers on table
        trig_deps = self._get_triggers_on_table(table_oid, database=database)
        for tr in trig_deps:
            tr_id = make_node_id(ObjectType.TRIGGER, tr["schema_name"], tr["tgname"], parent_name=resolved_name, oid=tr["trig_oid"])
            tr_node = Node(
                id=tr_id,
                object_type=ObjectType.TRIGGER,
                schema=tr["schema_name"],
                name=tr["tgname"],
                parent_name=resolved_name,
                display_name=f"{tr['schema_name']}.{tr['tgname']}",
                oid=tr["trig_oid"],
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=1,
                definition_available=True,
                definition_type="trigger"
            )
            graph.add_node(tr_node)
            graph.add_edge(Edge(
                source=root.id,
                target=tr_node.id,
                relation=RelationType.HAS_TRIGGER,
                dependency_type=DependencyType.DIRECT,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))

        # 4. Indexes on table
        idx_deps = self._get_indexes_on_table(table_oid, database=database)
        for idx in idx_deps:
            idx_id = make_node_id(ObjectType.INDEX, idx["schema_name"], idx["index_name"], parent_name=resolved_name, oid=idx["idx_oid"])
            idx_node = Node(
                id=idx_id,
                object_type=ObjectType.INDEX,
                schema=idx["schema_name"],
                name=idx["index_name"],
                parent_name=resolved_name,
                display_name=f"{idx['schema_name']}.{idx['index_name']}",
                oid=idx["idx_oid"],
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=1,
                definition_available=False
            )
            graph.add_node(idx_node)
            graph.add_edge(Edge(
                source=root.id,
                target=idx_node.id,
                relation=RelationType.HAS_INDEX,
                dependency_type=DependencyType.DIRECT,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))

        # 5. Multi-level indirect views (depth > 1)
        if depth_limit > 1:
            visited_oids: Set[int] = {table_oid}
            frontier = list(current_level_nodes)
            while frontier:
                curr_node, curr_level = frontier.pop(0)
                if curr_level >= depth_limit or not curr_node.oid or curr_node.oid in visited_oids:
                    continue
                visited_oids.add(curr_node.oid)

                if curr_node.object_type in (ObjectType.VIEW, ObjectType.MATERIALIZED_VIEW):
                    child_views = self._get_views_using_view(curr_node.oid, database=database)
                    for cv in child_views:
                        cv_type = ObjectType.MATERIALIZED_VIEW if cv.get("relkind") == 'm' else ObjectType.VIEW
                        cv_id = make_node_id(cv_type, cv.get("schema_name", "public"), cv.get("view_name", ""), oid=cv.get("view_oid"))
                        cv_node = Node(
                            id=cv_id,
                            object_type=cv_type,
                            schema=cv.get("schema_name", "public"),
                            name=cv.get("view_name", ""),
                            display_name=f"{cv.get('schema_name', 'public')}.{cv.get('view_name', '')}",
                            oid=cv.get("view_oid"),
                            confidence=Confidence.CONFIRMED,
                            source=DependencySource.CATALOG,
                            level=curr_level + 1,
                            definition_available=True,
                            definition_type="view"
                        )
                        graph.add_node(cv_node)
                        graph.add_edge(Edge(
                            source=curr_node.id,
                            target=cv_node.id,
                            relation=RelationType.REFERENCES_VIEW,
                            dependency_type=DependencyType.INDIRECT,
                            confidence=Confidence.CONFIRMED,
                            source_type=DependencySource.CATALOG
                        ))
                        if curr_level + 1 < depth_limit:
                            frontier.append((cv_node, curr_level + 1))

        return graph

    def get_table_dependencies(
        self,
        schema: str,
        table_name: str,
        depth_limit: int = 1,
        database: Optional[str] = None
    ) -> DependencyGraphModel:
        """
        Builds graph of objects this Table depends on (Parent Tables referenced by FK, Sequences).
        """
        graph = DependencyGraphModel(
            direction=GraphDirection.DEPENDENCIES,
            depth_limit=depth_limit,
            metadata={"database": database, "root_type": "TABLE"}
        )

        tbl_info = self.resolve_object(ObjectType.TABLE, schema, table_name, database=database)
        if not tbl_info:
            root_id = make_node_id(ObjectType.TABLE, schema, table_name)
            root = Node(
                id=root_id,
                object_type=ObjectType.TABLE,
                schema=schema,
                name=table_name,
                display_name=f"{schema}.{table_name}",
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG
            )
            graph.set_root(root)
            return graph

        table_oid = tbl_info["oid"]
        resolved_schema = tbl_info["schema_name"]
        resolved_name = tbl_info["name"]

        root_id = make_node_id(ObjectType.TABLE, resolved_schema, resolved_name, oid=table_oid)
        root = Node(
            id=root_id,
            object_type=ObjectType.TABLE,
            schema=resolved_schema,
            name=resolved_name,
            display_name=f"{resolved_schema}.{resolved_name}",
            oid=table_oid,
            confidence=Confidence.CONFIRMED,
            source=DependencySource.CATALOG,
            level=0
        )
        graph.set_root(root)

        # 1. Foreign Key parent tables
        fk_parents = self._get_foreign_keys_from_table(table_oid, database=database)
        for fk in fk_parents:
            p_id = make_node_id(ObjectType.TABLE, fk["target_schema"], fk["target_table"], oid=fk["target_oid"])
            p_node = Node(
                id=p_id,
                object_type=ObjectType.TABLE,
                schema=fk["target_schema"],
                name=fk["target_table"],
                display_name=f"{fk['target_schema']}.{fk['target_table']}",
                oid=fk["target_oid"],
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=1
            )
            graph.add_node(p_node)
            graph.add_edge(Edge(
                source=root.id,
                target=p_node.id,
                relation=RelationType.FOREIGN_KEY_TO,
                dependency_type=DependencyType.DIRECT,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))

        # 2. Sequences
        seqs = self._get_sequences_for_table(table_oid, database=database)
        for s in seqs:
            s_id = make_node_id(ObjectType.SEQUENCE, s["schema_name"], s["seq_name"], oid=s["seq_oid"])
            s_node = Node(
                id=s_id,
                object_type=ObjectType.SEQUENCE,
                schema=s["schema_name"],
                name=s["seq_name"],
                display_name=f"{s['schema_name']}.{s['seq_name']}",
                oid=s["seq_oid"],
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=1
            )
            graph.add_node(s_node)
            graph.add_edge(Edge(
                source=root.id,
                target=s_node.id,
                relation=RelationType.USES_SEQUENCE,
                dependency_type=DependencyType.DIRECT,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))

        return graph

    # -------------------------------------------------------------------------
    # Object Dependencies (What does this View/Object depend on?)
    # -------------------------------------------------------------------------

    def get_object_dependencies(
        self,
        obj_type: ObjectType,
        schema: str,
        name: str,
        depth_limit: int = 1,
        database: Optional[str] = None
    ) -> DependencyGraphModel:
        """
        Builds graph in 'dependencies' direction (Root -> Objects it depends on).
        e.g., View -> Tables and Columns; Table -> Parent Tables (FK) and Sequences.
        """
        if obj_type == ObjectType.TABLE:
            return self.get_table_dependencies(schema=schema, table_name=name, depth_limit=depth_limit, database=database)

        graph = DependencyGraphModel(
            direction=GraphDirection.DEPENDENCIES,
            depth_limit=depth_limit,
            metadata={"database": database, "root_type": str(obj_type)}
        )

        resolved = self.resolve_object(obj_type, schema, name, database=database)
        if not resolved:
            root_id = make_node_id(obj_type, schema, name)
            root = Node(
                id=root_id,
                object_type=obj_type,
                schema=schema,
                name=name,
                display_name=f"{schema}.{name}",
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG
            )
            graph.set_root(root)
            graph.add_warning(WarningInfo(
                type="CATALOG_NOTICE",
                level="WARNING",
                message=f"Object '{schema}.{name}' could not be resolved in catalog."
            ))
            return graph

        obj_oid = resolved["oid"]
        resolved_name = resolved["name"]
        resolved_schema = resolved["schema_name"]
        root_id = make_node_id(obj_type, resolved_schema, resolved_name, oid=obj_oid)
        root = Node(
            id=root_id,
            object_type=obj_type,
            schema=resolved_schema,
            name=resolved_name,
            display_name=f"{resolved_schema}.{resolved_name}",
            oid=obj_oid,
            confidence=Confidence.CONFIRMED,
            source=DependencySource.CATALOG,
            level=0,
            definition_available=True
        )
        graph.set_root(root)

        # For Views, find referenced tables and columns
        if obj_type in (ObjectType.VIEW, ObjectType.MATERIALIZED_VIEW):
            sql = """
            SELECT DISTINCT
                c.oid AS table_oid,
                c.relname AS table_name,
                n.nspname AS schema_name,
                c.relkind,
                d.refobjsubid AS attnum,
                a.attname AS col_name
            FROM pg_catalog.pg_rewrite rw
            JOIN pg_catalog.pg_depend d ON d.objid = rw.oid
            JOIN pg_catalog.pg_class c ON c.oid = d.refobjid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid
            WHERE rw.ev_class = %s
              AND d.refclassid = 'pg_catalog.pg_class'::regclass
              AND c.oid != %s
              AND n.nspname NOT IN ('pg_catalog', 'information_schema');
            """
            rows = self._execute(sql, (obj_oid, obj_oid), database=database)
            for r in rows:
                target_type = ObjectType.VIEW if r["relkind"] in ('v', 'm') else ObjectType.TABLE
                t_id = make_node_id(target_type, r["schema_name"], r["table_name"], oid=r["table_oid"])
                t_node = Node(
                    id=t_id,
                    object_type=target_type,
                    schema=r["schema_name"],
                    name=r["table_name"],
                    display_name=f"{r['schema_name']}.{r['table_name']}",
                    oid=r["table_oid"],
                    confidence=Confidence.CONFIRMED,
                    source=DependencySource.CATALOG,
                    level=1
                )
                graph.add_node(t_node)
                graph.add_edge(Edge(
                    source=root.id,
                    target=t_node.id,
                    relation=RelationType.USES_TABLE if target_type == ObjectType.TABLE else RelationType.REFERENCES_VIEW,
                    confidence=Confidence.CONFIRMED,
                    source_type=DependencySource.CATALOG
                ))

                # If specific column was referenced
                if r.get("col_name") and r.get("attnum", 0) > 0:
                    c_id = make_node_id(ObjectType.COLUMN, r["schema_name"], r["col_name"], parent_name=r["table_name"])
                    c_node = Node(
                        id=c_id,
                        object_type=ObjectType.COLUMN,
                        schema=r["schema_name"],
                        name=r["col_name"],
                        parent_name=r["table_name"],
                        display_name=f"{r['schema_name']}.{r['table_name']}.{r['col_name']}",
                        confidence=Confidence.CONFIRMED,
                        source=DependencySource.CATALOG,
                        level=2
                    )
                    graph.add_node(c_node)
                    graph.add_edge(Edge(
                        source=t_node.id,
                        target=c_node.id,
                        relation=RelationType.USES_COLUMN,
                        confidence=Confidence.CONFIRMED,
                        source_type=DependencySource.CATALOG
                    ))

        return graph

    def get_object_dependents(
        self,
        obj_type: ObjectType,
        schema: str,
        name: str,
        depth_limit: int = 2,
        database: Optional[str] = None
    ) -> DependencyGraphModel:
        """
        Builds graph in 'dependents' direction (Objects that depend on Root).
        """
        if obj_type == ObjectType.TABLE:
            return self.get_table_dependents(schema=schema, table_name=name, depth_limit=depth_limit, database=database)

        # For Views / Materialized Views: who uses this view?
        graph = DependencyGraphModel(
            direction=GraphDirection.DEPENDENTS,
            depth_limit=depth_limit,
            metadata={"database": database, "root_type": str(obj_type)}
        )

        resolved = self.resolve_object(obj_type, schema, name, database=database)
        if not resolved:
            root_id = make_node_id(obj_type, schema, name)
            root = Node(
                id=root_id,
                object_type=obj_type,
                schema=schema,
                name=name,
                display_name=f"{schema}.{name}",
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG
            )
            graph.set_root(root)
            return graph

        view_oid = resolved["oid"]
        resolved_name = resolved["name"]
        resolved_schema = resolved["schema_name"]
        root_id = make_node_id(obj_type, resolved_schema, resolved_name, oid=view_oid)
        root = Node(
            id=root_id,
            object_type=obj_type,
            schema=resolved_schema,
            name=resolved_name,
            display_name=f"{resolved_schema}.{resolved_name}",
            oid=view_oid,
            confidence=Confidence.CONFIRMED,
            source=DependencySource.CATALOG,
            level=0
        )
        graph.set_root(root)

        child_views = self._get_views_using_view(view_oid, database=database)
        for cv in child_views:
            cv_type = ObjectType.MATERIALIZED_VIEW if cv.get("relkind") == 'm' else ObjectType.VIEW
            cv_id = make_node_id(cv_type, cv.get("schema_name", "public"), cv.get("view_name", ""), oid=cv.get("view_oid"))
            cv_node = Node(
                id=cv_id,
                object_type=cv_type,
                schema=cv.get("schema_name", "public"),
                name=cv.get("view_name", ""),
                display_name=f"{cv.get('schema_name', 'public')}.{cv.get('view_name', '')}",
                oid=cv.get("view_oid"),
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=1,
                definition_available=True,
                definition_type="view"
            )
            graph.add_node(cv_node)
            graph.add_edge(Edge(
                source=root.id,
                target=cv_node.id,
                relation=RelationType.REFERENCES_VIEW,
                dependency_type=DependencyType.DIRECT,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))

        return graph

    # -------------------------------------------------------------------------
    # Object Definition Loader
    # -------------------------------------------------------------------------

    def get_object_definition(
        self,
        obj_type: ObjectType,
        schema: str,
        name: str,
        oid: Optional[int] = None,
        database: Optional[str] = None
    ) -> Optional[str]:
        """
        Retrieves the exact SQL definition from PostgreSQL catalog.
        Read-only safe; does not execute or alter anything.
        """
        if obj_type in (ObjectType.VIEW, ObjectType.MATERIALIZED_VIEW):
            sql = """
            SELECT 
                CASE WHEN c.relkind = 'm' THEN 'CREATE MATERIALIZED VIEW ' ELSE 'CREATE OR REPLACE VIEW ' END ||
                quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' AS' || E'\\n' ||
                pg_catalog.pg_get_viewdef(c.oid, true) AS definition
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE (c.oid = %s OR (n.nspname = %s AND c.relname = %s))
              AND c.relkind IN ('v', 'm')
            LIMIT 1;
            """
            rows = self._execute(sql, (oid or 0, schema, name), database=database)
            return rows[0]["definition"] if rows and rows[0].get("definition") else None

        if obj_type in (ObjectType.FUNCTION, ObjectType.PROCEDURE):
            sql = """
            SELECT pg_catalog.pg_get_functiondef(p.oid) AS definition
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE (p.oid = %s OR (n.nspname = %s AND p.proname = %s))
            LIMIT 1;
            """
            rows = self._execute(sql, (oid or 0, schema, name), database=database)
            return rows[0]["definition"] if rows and rows[0].get("definition") else None

        if obj_type == ObjectType.TRIGGER:
            sql = """
            SELECT pg_catalog.pg_get_triggerdef(t.oid, true) || ';' AS definition
            FROM pg_catalog.pg_trigger t
            WHERE t.oid = %s OR t.tgname = %s
            LIMIT 1;
            """
            rows = self._execute(sql, (oid or 0, name), database=database)
            return rows[0]["definition"] if rows and rows[0].get("definition") else None

        if obj_type in (ObjectType.CONSTRAINT, ObjectType.FOREIGN_KEY):
            sql = """
            SELECT pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
            FROM pg_catalog.pg_constraint c
            WHERE c.oid = %s OR c.conname = %s
            LIMIT 1;
            """
            rows = self._execute(sql, (oid or 0, name), database=database)
            return rows[0]["definition"] if rows and rows[0].get("definition") else None

        # Fallback to adapter.get_object_script if available
        if hasattr(self.adapter, "get_object_script"):
            try:
                return self.adapter.get_object_script(
                    object_type=obj_type.value.lower(),
                    name=name,
                    schema=schema,
                    database=database
                )
            except Exception:
                pass

        return None
