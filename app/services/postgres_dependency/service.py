"""PostgreSQL Dependency Coordinator Service
Combines PostgresCatalogAnalyzer and PostgresSourceAnalyzer to construct
unified DependencyGraphModel and provide Tree projections and suggested resolution steps.

Conforms to .SKILL/postgres_dependcy_graph.md.
"""

from typing import Dict, List, Optional, Any
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
from .catalog_analyzer import PostgresCatalogAnalyzer
from .source_analyzer import PostgresSourceAnalyzer

logger = logging.getLogger(__name__)


class PostgresDependencyService:
    """Coordinator service for PostgreSQL dependency graph generation."""

    def __init__(self, adapter: Any):
        self.adapter = adapter
        self.catalog = PostgresCatalogAnalyzer(adapter)

    def get_column_graph(
        self,
        schema: str,
        table_name: str,
        column_name: str,
        direction: str = "dependents",
        depth_limit: int = 2,
        database: Optional[str] = None,
        include_source_analysis: bool = True
    ) -> DependencyGraphModel:
        """
        Builds graph for a column, augmenting catalog dependencies with source code analysis.
        """
        dir_enum = GraphDirection.from_str(direction)
        if dir_enum == GraphDirection.DEPENDENTS:
            graph = DependencyGraphModel(
                direction=GraphDirection.DEPENDENTS,
                depth_limit=depth_limit,
                metadata={"database": database, "root_type": "COLUMN"}
            )
            col_info = self.catalog.resolve_column(schema, table_name, column_name, database=database)
            sch = col_info["schema_name"] if col_info else schema
            tbl = col_info["table_name"] if col_info else table_name
            col = col_info["column_name"] if col_info else column_name
            t_oid = col_info["table_oid"] if col_info else None
            attnum = col_info.get("attnum") if col_info else None

            root_id = make_node_id(ObjectType.COLUMN, sch, col, parent_name=tbl, oid=t_oid)
            root = Node(
                id=root_id,
                object_type=ObjectType.COLUMN,
                schema=sch,
                name=col,
                parent_name=tbl,
                display_name=f"{sch}.{tbl}.{col}",
                oid=t_oid,
                confidence=Confidence.CONFIRMED,
                source=DependencySource.CATALOG,
                level=0,
                metadata={
                    "data_type": col_info.get("data_type") if col_info else None,
                    "is_pk": col_info.get("is_pk", False) if col_info else False,
                    "attnum": attnum
                }
            )
            graph.set_root(root)

            # Discover Views & Routines whose DDL actually SELECTs target_column from target_table
            self._discover_column_dependents_by_ddl(
                graph=graph,
                schema=sch,
                table_name=tbl,
                column_name=col,
                database=database
            )
            return graph
        else:
            # Dependencies direction (Column depends on its Table)
            graph = DependencyGraphModel(direction=GraphDirection.DEPENDENCIES, depth_limit=depth_limit)
            col_info = self.catalog.resolve_column(schema, table_name, column_name, database=database)
            sch = col_info["schema_name"] if col_info else schema
            tbl = col_info["table_name"] if col_info else table_name
            col = col_info["column_name"] if col_info else column_name
            t_oid = col_info["table_oid"] if col_info else None

            root_id = make_node_id(ObjectType.COLUMN, sch, col, parent_name=tbl, oid=t_oid)
            root = Node(
                id=root_id,
                object_type=ObjectType.COLUMN,
                schema=sch,
                name=col,
                parent_name=tbl,
                display_name=f"{sch}.{tbl}.{col}",
                oid=t_oid,
                level=0
            )
            graph.set_root(root)

            tbl_id = make_node_id(ObjectType.TABLE, sch, tbl, oid=t_oid)
            tbl_node = Node(
                id=tbl_id,
                object_type=ObjectType.TABLE,
                schema=sch,
                name=tbl,
                display_name=f"{sch}.{tbl}",
                oid=t_oid,
                level=1
            )
            graph.add_node(tbl_node)
            graph.add_edge(Edge(
                source=root.id,
                target=tbl_node.id,
                relation=RelationType.USES_TABLE,
                confidence=Confidence.CONFIRMED,
                source_type=DependencySource.CATALOG
            ))
            return graph

    def get_object_graph(
        self,
        obj_type_str: str,
        schema: str,
        name: str,
        direction: str = "dependents",
        depth_limit: int = 1,
        database: Optional[str] = None,
        include_source_analysis: bool = True
    ) -> DependencyGraphModel:
        """Builds graph starting from any PostgreSQL database object (Table, View, Function, etc.)."""
        obj_type = ObjectType.from_str(obj_type_str)
        dir_enum = GraphDirection.from_str(direction)

        if dir_enum == GraphDirection.DEPENDENCIES:
            graph = self.catalog.get_object_dependencies(
                obj_type=obj_type,
                schema=schema,
                name=name,
                depth_limit=depth_limit,
                database=database
            )
            if obj_type == ObjectType.TABLE and len(graph.nodes) <= 1:
                graph.add_warning(WarningInfo(
                    type="DIRECTION_HINT",
                    level="INFO",
                    message=f"Bảng '{schema}.{name}' không phụ thuộc vào bảng cha nào ở chiều 'Dependencies (Nó dùng)'. Vui lòng chọn chiều 'Dependents (Dùng nó)' trên thanh công cụ để xem các View (như vb20customer) và Stored Procedure đang sử dụng bảng này."
                ))
            return graph
        else:
            # Dependents direction
            graph = self.catalog.get_object_dependents(
                obj_type=obj_type,
                schema=schema,
                name=name,
                depth_limit=depth_limit,
                database=database
            )

            # Enrich with routine and view source analysis
            if include_source_analysis and graph.root:
                self._enrich_with_source_routines(
                    graph=graph,
                    schema=schema,
                    table_name=name,
                    column_name=None,
                    database=database
                )
            return graph

    def get_object_definition(
        self,
        obj_type_str: str,
        schema: str,
        name: str,
        oid: Optional[int] = None,
        database: Optional[str] = None
    ) -> Optional[str]:
        """Gets SQL definition string for object."""
        return self.catalog.get_object_definition(
            obj_type=ObjectType.from_str(obj_type_str),
            schema=schema,
            name=name,
            oid=oid,
            database=database
        )

    def get_suggested_steps(
        self,
        schema: str,
        table: str,
        column: str,
        action: str = "ALTER",
        database: Optional[str] = None
    ) -> List[Dict[str, str]]:
        """
        Generates suggested resolution guidelines before altering/dropping a column.
        Read-only suggestion: never executes DDL.
        """
        graph = self.get_column_graph(schema, table, column, depth_limit=2, database=database, include_source_analysis=False)
        dependent_views = [n.display_name for n in graph.nodes.values() if n.object_type in (ObjectType.VIEW, ObjectType.MATERIALIZED_VIEW)]
        foreign_keys = [n.display_name for n in graph.nodes.values() if n.object_type == ObjectType.FOREIGN_KEY]
        triggers = [n.display_name for n in graph.nodes.values() if n.object_type == ObjectType.TRIGGER]

        steps = []
        step_idx = 1

        steps.append({
            "step": step_idx,
            "title": "Review Dependent Objects",
            "description": f"Found {len(dependent_views)} View(s), {len(foreign_keys)} Foreign Key(s), {len(triggers)} Trigger(s) linked to '{schema}.{table}.{column}'."
        })
        step_idx += 1

        if dependent_views:
            steps.append({
                "step": step_idx,
                "title": "Check View Compatibility",
                "description": f"Views [{', '.join(dependent_views[:3])}{'...' if len(dependent_views) > 3 else ''}] depend on this column. If column type or name changes, save their definitions and prepare to recreate them."
            })
            step_idx += 1

        if foreign_keys:
            steps.append({
                "step": step_idx,
                "title": "Evaluate Foreign Key Constraints",
                "description": f"Foreign key constraints [{', '.join(foreign_keys)}] reference this column. Altering data types must maintain compatible referential types."
            })
            step_idx += 1

        steps.append({
            "step": step_idx,
            "title": "Prepare & Validate DDL",
            "description": f"Draft the {action.upper()} COLUMN statement in the Query Editor and verify execution plan in a transaction block (BEGIN ... ROLLBACK)."
        })
        step_idx += 1

        steps.append({
            "step": step_idx,
            "title": "Revalidate Dependent Objects",
            "description": "After executing DDL, re-query or refresh the Dependency Graph to confirm that all dependent views and functions remain valid."
        })

        return steps

    def _enrich_with_source_routines(
        self,
        graph: DependencyGraphModel,
        schema: str,
        table_name: str,
        column_name: Optional[str] = None,
        database: Optional[str] = None
    ) -> None:
        """Inspects routines in database to discover functions/procedures referencing this table/column."""
        # 1. Query SQL and PL/pgSQL routines matching table_name and/or column_name in body
        try:
            where_clauses = [
                "l.lanname IN ('sql', 'plpgsql')",
                "n.nspname NOT IN ('pg_catalog', 'information_schema')",
                "p.prokind IN ('f', 'p')"
            ]
            params = []
            if table_name and column_name:
                where_clauses.append("p.prosrc ILIKE %s")
                params.append(f"%{table_name}%")
                where_clauses.append("p.prosrc ILIKE %s")
                params.append(f"%{column_name}%")
            elif table_name:
                where_clauses.append("p.prosrc ILIKE %s")
                params.append(f"%{table_name}%")
            elif column_name:
                where_clauses.append("p.prosrc ILIKE %s")
                params.append(f"%{column_name}%")
            else:
                return

            sql = f"""
            SELECT 
                p.oid,
                p.proname,
                n.nspname AS schema_name,
                p.prokind,
                l.lanname,
                p.prosrc AS body,
                p.prosrc AS defn
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            JOIN pg_catalog.pg_language l ON l.oid = p.prolang
            WHERE {' AND '.join(where_clauses)};
            """
            rows = self.catalog._execute(sql, tuple(params), database=database)

            for r in rows:
                code = r.get("defn") or r.get("body")
                if not code:
                    continue
                func_name = r["proname"]
                func_schema = r["schema_name"]
                obj_kind = ObjectType.PROCEDURE if r.get("prokind") == 'p' else ObjectType.FUNCTION

                if column_name:
                    analysis = PostgresSourceAnalyzer.analyze_source_for_column(
                        source_code=code,
                        target_column=column_name,
                        target_table=table_name,
                        target_schema=schema,
                        object_name=f"{func_schema}.{func_name}"
                    )
                else:
                    analysis = PostgresSourceAnalyzer.analyze_source_for_table(
                        source_code=code,
                        target_table=table_name,
                        target_schema=schema,
                        object_name=f"{func_schema}.{func_name}"
                    )

                if analysis.is_referenced and graph.root:
                    f_id = make_node_id(obj_kind, func_schema, func_name, oid=r["oid"])
                    if not graph.has_node(f_id):
                        f_node = Node(
                            id=f_id,
                            object_type=obj_kind,
                            schema=func_schema,
                            name=func_name,
                            display_name=f"{func_schema}.{func_name}()",
                            oid=r["oid"],
                            confidence=analysis.confidence,
                            source=DependencySource.SOURCE_ANALYSIS,
                            level=1,
                            definition_available=True,
                            definition_type="function",
                            metadata={"snippets": analysis.snippets}
                        )
                        graph.add_node(f_node)
                        rel = RelationType.USES_COLUMN if column_name else RelationType.USES_TABLE
                        graph.add_edge(Edge(
                            source=graph.root.id,
                            target=f_node.id,
                            relation=rel,
                            confidence=analysis.confidence,
                            source_type=DependencySource.SOURCE_ANALYSIS
                        ))

                # Record any dynamic SQL warnings
                for w in analysis.warnings:
                    if w.type == "DYNAMIC_SQL":
                        graph.add_warning(w)
        except Exception as e:
            logger.warning("Routine search error: %s", e)

        # 2. Also check pg_views and pg_matviews for any views whose definition mentions table_name
        try:
            if table_name and graph.root:
                v_where = ["schemaname NOT IN ('pg_catalog', 'information_schema')", "definition ILIKE %s"]
                v_params = [f"%{table_name}%"]
                if column_name:
                    v_where.append("definition ILIKE %s")
                    v_params.append(f"%{column_name}%")
                v_sql = f"""
                SELECT 
                    schemaname AS schema_name,
                    viewname AS view_name,
                    definition
                FROM pg_catalog.pg_views
                WHERE {' AND '.join(v_where)};
                """
                v_rows = self.catalog._execute(v_sql, tuple(v_params), database=database)
                for vr in v_rows:
                    v_schema = vr.get("schema_name", "public")
                    v_name = vr.get("view_name") or vr.get("name")
                    if not v_name or not isinstance(v_name, str):
                        continue
                    v_id = make_node_id(ObjectType.VIEW, v_schema, v_name)
                    if not graph.has_node(v_id) and v_name.lower() != table_name.lower():
                        v_node = Node(
                            id=v_id,
                            object_type=ObjectType.VIEW,
                            schema=v_schema,
                            name=v_name,
                            display_name=f"{v_schema}.{v_name}",
                            confidence=Confidence.CONFIRMED,
                            source=DependencySource.CATALOG,
                            level=1,
                            definition_available=True,
                            definition_type="view"
                        )
                        graph.add_node(v_node)
                        rel = RelationType.USES_COLUMN if column_name else RelationType.USES_TABLE
                        graph.add_edge(Edge(
                            source=graph.root.id,
                            target=v_node.id,
                            relation=rel,
                            confidence=Confidence.CONFIRMED,
                            source_type=DependencySource.CATALOG
                        ))

                # Materialized views
                m_sql = f"""
                SELECT 
                    schemaname AS schema_name,
                    matviewname AS view_name,
                    definition
                FROM pg_catalog.pg_matviews
                WHERE {' AND '.join(v_where)};
                """
                m_rows = self.catalog._execute(m_sql, tuple(v_params), database=database)
                for mr in m_rows:
                    m_schema = mr.get("schema_name", "public")
                    m_name = mr.get("view_name") or mr.get("name")
                    if not m_name or not isinstance(m_name, str):
                        continue
                    m_id = make_node_id(ObjectType.MATERIALIZED_VIEW, m_schema, m_name)
                    if not graph.has_node(m_id) and m_name.lower() != table_name.lower():
                        m_node = Node(
                            id=m_id,
                            object_type=ObjectType.MATERIALIZED_VIEW,
                            schema=m_schema,
                            name=m_name,
                            display_name=f"{m_schema}.{m_name}",
                            confidence=Confidence.CONFIRMED,
                            source=DependencySource.CATALOG,
                            level=1,
                            definition_available=True,
                            definition_type="view"
                        )
                        graph.add_node(m_node)
                        rel = RelationType.USES_COLUMN if column_name else RelationType.USES_TABLE
                        graph.add_edge(Edge(
                            source=graph.root.id,
                            target=m_node.id,
                            relation=rel,
                            confidence=Confidence.CONFIRMED,
                            source_type=DependencySource.CATALOG
                        ))
        except Exception as e:
            logger.warning("View search error: %s", e)

    def _discover_column_dependents_by_ddl(
        self,
        graph: DependencyGraphModel,
        schema: str,
        table_name: str,
        column_name: str,
        database: Optional[str] = None
    ) -> None:
        """
        Discovers Views/Materialized Views and Functions/Procedures whose DDL
        actively SELECTs/projects the target column from the target table.
        Prioritizes Views, and excludes objects that only JOIN without SELECTing the column.
        """
        if not graph.root:
            return

        # 1. Query Views and Materialized Views (Prioritized)
        try:
            view_sql = """
            SELECT 
                v.oid AS view_oid,
                v.relname AS view_name,
                n.nspname AS schema_name,
                v.relkind,
                pg_catalog.pg_get_viewdef(v.oid, true) AS definition
            FROM pg_catalog.pg_class v
            JOIN pg_catalog.pg_namespace n ON n.oid = v.relnamespace
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND v.relkind IN ('v', 'm')
              AND (
                  pg_catalog.pg_get_viewdef(v.oid, false) ILIKE %s
                  OR v.relname ILIKE %s
              )
            ORDER BY n.nspname, v.relname;
            """
            rows = self.catalog._execute(view_sql, (f"%{table_name}%", f"%{table_name}%"), database=database)
            for r in rows:
                v_name = r.get("view_name")
                v_schema = r.get("schema_name", "public")
                v_oid = r.get("view_oid")
                v_def = r.get("definition") or ""
                if not v_name or v_name.lower() == table_name.lower():
                    continue

                # Check if this view's DDL SELECTs the target column from target table
                if PostgresSourceAnalyzer.is_column_selected_from_table(
                    sql_text=v_def,
                    target_table=table_name,
                    target_column=column_name,
                    target_schema=schema
                ):
                    obj_type = ObjectType.MATERIALIZED_VIEW if r.get("relkind") == 'm' else ObjectType.VIEW
                    v_id = make_node_id(obj_type, v_schema, v_name, oid=v_oid)
                    if not graph.has_node(v_id):
                        v_node = Node(
                            id=v_id,
                            object_type=obj_type,
                            schema=v_schema,
                            name=v_name,
                            display_name=f"{v_schema}.{v_name}",
                            oid=v_oid,
                            confidence=Confidence.CONFIRMED,
                            source=DependencySource.CATALOG,
                            level=1,
                            definition_available=True,
                            definition_type="view",
                            metadata={"definition": v_def}
                        )
                        graph.add_node(v_node)
                        graph.add_edge(Edge(
                            source=graph.root.id,
                            target=v_node.id,
                            relation=RelationType.USES_COLUMN,
                            dependency_type=DependencyType.DIRECT,
                            confidence=Confidence.CONFIRMED,
                            source_type=DependencySource.CATALOG
                        ))
        except Exception as e:
            logger.warning("Error discovering view column dependents: %s", e)

        # 2. Query Functions and Procedures
        try:
            func_sql = """
            SELECT 
                p.oid,
                p.proname,
                n.nspname AS schema_name,
                p.prokind,
                l.lanname,
                p.prosrc AS body
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            JOIN pg_catalog.pg_language l ON l.oid = p.prolang
            WHERE l.lanname IN ('sql', 'plpgsql')
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND p.prokind IN ('f', 'p')
              AND p.prosrc ILIKE %s
            ORDER BY n.nspname, p.proname;
            """
            f_rows = self.catalog._execute(func_sql, (f"%{table_name}%",), database=database)
            for fr in f_rows:
                f_name = fr.get("proname")
                f_schema = fr.get("schema_name", "public")
                f_oid = fr.get("oid")
                f_body = fr.get("body") or ""
                if not f_name:
                    continue

                # Check if routine's body SELECTs the target column from target table
                if PostgresSourceAnalyzer.is_column_selected_from_table(
                    sql_text=f_body,
                    target_table=table_name,
                    target_column=column_name,
                    target_schema=schema
                ):
                    obj_kind = ObjectType.PROCEDURE if fr.get("prokind") == 'p' else ObjectType.FUNCTION
                    f_id = make_node_id(obj_kind, f_schema, f_name, oid=f_oid)
                    if not graph.has_node(f_id):
                        f_node = Node(
                            id=f_id,
                            object_type=obj_kind,
                            schema=f_schema,
                            name=f_name,
                            display_name=f"{f_schema}.{f_name}()",
                            oid=f_oid,
                            confidence=Confidence.LIKELY,
                            source=DependencySource.SOURCE_ANALYSIS,
                            level=1,
                            definition_available=True,
                            definition_type="function",
                            metadata={"body": f_body}
                        )
                        graph.add_node(f_node)
                        graph.add_edge(Edge(
                            source=graph.root.id,
                            target=f_node.id,
                            relation=RelationType.USES_COLUMN,
                            confidence=Confidence.LIKELY,
                            source_type=DependencySource.SOURCE_ANALYSIS
                        ))
        except Exception as e:
            logger.warning("Error discovering routine column dependents: %s", e)
