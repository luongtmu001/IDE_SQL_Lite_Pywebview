# -*- coding: utf-8 -*-
"""
Schema Compare Service.
Compares schemas between two databases of the same engine (SQL Server, PostgreSQL, SQLite).
Generates detailed differences for Tables, Columns, Primary Keys, Foreign Keys,
Unique Constraints, Check Constraints, and Indexes.
Normalizes constraints by definition to prevent false positives from random generated names.
Produces safe, selectable DDL migration scripts.
"""
from typing import Any, Dict, List, Optional, Set, Tuple
import copy
import logging
import re

from app.database.sql_utils import quote_ident, quote_qualified
from app.services.table_designer_service import TableDesignerService

logger = logging.getLogger("luobtool.schema_compare")


class SchemaCompareService:
    """Service for snapshotting and comparing database schemas and generating migration DDL."""

    @classmethod
    def snapshot(
        cls,
        adapter: Any,
        database: str,
        schema: str,
        cancel_event: Optional[Any] = None,
        object_types: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Extracts schema metadata for tables, views, procedures, functions, and triggers.
        Supports selective extraction via `object_types` (e.g. ['tables', 'views']) to avoid unnecessary loading.
        """
        engine = getattr(adapter, "db_type", "sqlserver").lower()
        if engine in ("sqlite", "sqlite3"):
            schema = schema or "main"
            database = database or "main"
        elif engine == "postgresql":
            schema = schema or "public"
        else:
            schema = schema or "dbo"

        # Determine which object categories to fetch
        if object_types is not None:
            norm_types = {str(t).lower().strip() for t in object_types}
            fetch_tables = ("tables" in norm_types or "table" in norm_types)
            fetch_views = ("views" in norm_types or "view" in norm_types)
            fetch_procs = ("procedures" in norm_types or "procedure" in norm_types)
            fetch_funcs = ("functions" in norm_types or "function" in norm_types)
            fetch_trigs = ("triggers" in norm_types or "trigger" in norm_types)
        else:
            fetch_tables = True
            fetch_views = True
            fetch_procs = True
            fetch_funcs = True
            fetch_trigs = True

        # 1. Fetch tables list & metadata
        tables_meta: Dict[str, Any] = {}
        if fetch_tables:
            raw_tables = adapter.list_objects(database, schema, "tables", limit=0)
            table_names = []
            for item in raw_tables:
                if isinstance(item, dict):
                    tname = item.get("name") or item.get("table_name")
                else:
                    tname = str(item)
                if tname and tname not in table_names:
                    table_names.append(tname)

            # If adapter supports bulk table metadata extraction (e.g. SQL Server, PostgreSQL), use it for high performance
            if hasattr(adapter, "get_all_tables_design_metadata") and callable(adapter.get_all_tables_design_metadata):
                try:
                    tables_meta = adapter.get_all_tables_design_metadata(database, schema, table_names) or {}
                except Exception as exc:
                    logger.warning("Bulk table metadata extraction failed, falling back: %s", exc)
                    tables_meta = {}

            # Per .SKILL/bulk-catalog.md Rule 1, 6 & 11: Fall back to individual query for any missing table
            if table_names:
                tables_meta_lower = {k.lower(): k for k in tables_meta}
                for tbl in table_names:
                    if cancel_event and getattr(cancel_event, "is_set", lambda: False)():
                        logger.info("Schema compare snapshot cancelled by user.")
                        break
                    if tbl not in tables_meta and tbl.lower() not in tables_meta_lower:
                        try:
                            meta = adapter.get_table_design_metadata(database, schema, tbl)
                            if meta:
                                tables_meta[tbl] = meta
                        except Exception as exc:
                            logger.warning("Failed to extract metadata for table %s.%s: %s", schema, tbl, exc)

        # 2. Programmability objects snapshot (views, procedures, functions, triggers)
        def _fetch_code_objects(obj_type: str) -> Dict[str, Dict[str, Any]]:
            res: Dict[str, Dict[str, Any]] = {}
            try:
                raw_list = adapter.list_objects(database, schema, obj_type, limit=0)
                target_names = []
                for item in raw_list:
                    name = item.get("name") if isinstance(item, dict) else str(item)
                    if name and name not in target_names:
                        target_names.append(name)

                # Attempt bulk retrieval if adapter supports it (.SKILL/bulk-catalog.md Rule 3)
                if hasattr(adapter, "get_all_code_objects_metadata") and callable(adapter.get_all_code_objects_metadata):
                    try:
                        res = adapter.get_all_code_objects_metadata(database, schema, obj_type, target_names) or {}
                    except Exception as exc:
                        logger.warning("Bulk %s metadata extraction failed, falling back: %s", obj_type, exc)
                        res = {}

                # Fallback for any missing items (Rule 1, 6 & 11)
                res_lower = {k.lower(): k for k in res}
                for name in target_names:
                    if cancel_event and getattr(cancel_event, "is_set", lambda: False)():
                        break
                    if name not in res and name.lower() not in res_lower:
                        try:
                            definition = adapter.get_object_definition(database, schema, name, obj_type) or ""
                            res[name] = {"name": name, "definition": definition, "type": obj_type}
                        except Exception as e:
                            logger.debug("Failed to get definition for %s %s: %s", obj_type, name, e)
            except Exception as exc:
                logger.debug("Failed to list %s: %s", obj_type, exc)
            return res

        views_meta = _fetch_code_objects("views") if fetch_views else {}
        procs_meta = _fetch_code_objects("procedures") if fetch_procs else {}
        funcs_meta = _fetch_code_objects("functions") if fetch_funcs else {}
        triggers_meta = _fetch_code_objects("triggers") if fetch_trigs else {}

        return {
            "engine": engine,
            "database": database,
            "schema": schema,
            "table_count": len(tables_meta),
            "tables": tables_meta,
            "views": views_meta,
            "procedures": procs_meta,
            "functions": funcs_meta,
            "triggers": triggers_meta
        }

    @classmethod
    def _normalize_constraints_for_diff(
        cls,
        source_meta: Dict[str, Any],
        target_meta: Dict[str, Any],
        engine: str
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """
        Normalizes constraint and index names in source_meta to match target_meta
        when their definitions (columns, actions, expressions) are logically identical.
        Prevents false positive DROP/ADD constraint statements caused by auto-generated random suffixes.
        """
        src = copy.deepcopy(source_meta)
        tgt = copy.deepcopy(target_meta)

        # 1. Primary Key: if both have PK and key columns match exactly, align pk_name
        src_pk_cols = [c["name"].lower() for c in src.get("columns", []) if c.get("is_pk")]
        tgt_pk_cols = [c["name"].lower() for c in tgt.get("columns", []) if c.get("is_pk")]
        if src_pk_cols and src_pk_cols == tgt_pk_cols:
            if tgt.get("pk_name"):
                src["pk_name"] = tgt.get("pk_name")

        # 2. Column Defaults: if default expression matches, align default constraint name (SQL Server)
        tgt_cols_map = {c["name"].lower(): c for c in tgt.get("columns", [])}
        for col in src.get("columns", []):
            cname = col.get("name", "").lower()
            if cname in tgt_cols_map:
                tcol = tgt_cols_map[cname]
                s_dflt = str(col.get("default_val") or col.get("default_value") or "").strip()
                t_dflt = str(tcol.get("default_val") or tcol.get("default_value") or "").strip()
                while s_dflt.startswith("(") and s_dflt.endswith(")"):
                    s_dflt = s_dflt[1:-1].strip()
                while t_dflt.startswith("(") and t_dflt.endswith(")"):
                    t_dflt = t_dflt[1:-1].strip()
                if s_dflt and s_dflt.lower() == t_dflt.lower():
                    if tcol.get("default_constraint_name"):
                        col["default_constraint_name"] = tcol["default_constraint_name"]

        # 3. Unique Constraints (match by normalized fields)
        def _uq_sig(uq):
            fields = tuple(sorted(str(f).strip('\"[]').lower() for f in uq.get("fields", [])))
            return fields

        tgt_uqs_by_fields = {_uq_sig(u): u for u in tgt.get("uniques", [])}
        for suq in src.get("uniques", []):
            f = _uq_sig(suq)
            if f in tgt_uqs_by_fields:
                suq["name"] = tgt_uqs_by_fields[f].get("name")

        # 4. Check Constraints (match by stripped check clause)
        def _chk_sig(chk):
            clause = str(chk.get("definition") or chk.get("check_clause") or "").strip().lower()
            while clause.startswith("(") and clause.endswith(")"):
                clause = clause[1:-1].strip()
            return re.sub(r"\s+", " ", clause)

        tgt_chks_by_sig = {_chk_sig(c): c for c in tgt.get("checks", [])}
        for schk in src.get("checks", []):
            sig = _chk_sig(schk)
            if sig in tgt_chks_by_sig:
                schk["name"] = tgt_chks_by_sig[sig].get("name")

        # 5. Foreign Keys (match by columns, ref_table, ref_columns, on_delete, on_update)
        def _fk_sig(fk):
            flds = fk.get("fields") or ([fk.get("column")] if fk.get("column") else [])
            local_cols = tuple(sorted(str(f).strip('\"[]').lower() for f in flds))
            ref_t = str(fk.get("ref_table") or "").strip().lower()
            ref_f = fk.get("ref_fields") or ([fk.get("ref_column")] if fk.get("ref_column") else [])
            ref_cols = tuple(sorted(str(f).strip('\"[]').lower() for f in ref_f))
            on_del = str(fk.get("on_delete") or "NO ACTION").upper()
            on_upd = str(fk.get("on_update") or "NO ACTION").upper()
            return (local_cols, ref_t, ref_cols, on_del, on_upd)

        tgt_fks_by_sig = {_fk_sig(f): f for f in tgt.get("foreign_keys", [])}
        for sfk in src.get("foreign_keys", []):
            sig = _fk_sig(sfk)
            if sig in tgt_fks_by_sig:
                sfk["name"] = tgt_fks_by_sig[sig].get("name")

        # 6. Indexes (match by columns with sort direction, uniqueness, index type)
        def _idx_sig(idx):
            cols = []
            for f in idx.get("fields", []):
                if isinstance(f, dict):
                    cols.append((str(f.get("column", "")).strip('\"[]').lower(), bool(f.get("desc"))))
                else:
                    cols.append((str(f).strip('\"[]').lower(), False))
            is_u = bool(idx.get("is_unique"))
            itype = str(idx.get("index_type") or "").upper()
            return (tuple(cols), is_u, itype)

        tgt_idxs_by_sig = {_idx_sig(i): i for i in tgt.get("indexes", [])}
        for sidx in src.get("indexes", []):
            sig = _idx_sig(sidx)
            if sig in tgt_idxs_by_sig:
                sidx["name"] = tgt_idxs_by_sig[sig].get("name")

        return src, tgt

    @classmethod
    def diff(cls, source_snap: Dict[str, Any], target_snap: Dict[str, Any]) -> Dict[str, Any]:
        """
        Compares Source (A) against Target (B).
        Migration goal: Generate DDL statements to bring Target B up to parity with Source A.
        Returns categorization of tables, detailed column/constraint diffs, statements, and statistics.
        """
        src_engine = source_snap.get("engine", "").lower()
        tgt_engine = target_snap.get("engine", "").lower()

        # Engine compatibility check
        def _normalize_eng(e):
            return "sqlite" if e in ("sqlite", "sqlite3") else e

        if _normalize_eng(src_engine) != _normalize_eng(tgt_engine):
            raise ValueError(
                f"So sánh schema yêu cầu 2 kết nối cùng loại hệ quản trị (Source: '{src_engine}', Target: '{tgt_engine}')."
            )

        engine = _normalize_eng(src_engine)
        src_tables = source_snap.get("tables", {})
        tgt_tables = target_snap.get("tables", {})

        src_names = set(src_tables.keys())
        tgt_names = set(tgt_tables.keys())

        only_in_src_names = sorted(list(src_names - tgt_names))
        only_in_tgt_names = sorted(list(tgt_names - src_names))
        common_names = sorted(list(src_names & tgt_names))

        table_diffs: List[Dict[str, Any]] = []

        # 1. Tables Only in Source (Missing in Target -> To Create)
        for tname in only_in_src_names:
            smeta = src_tables[tname]
            # Generate CREATE statements
            create_stmts = TableDesignerService.generate_create_table_statements(smeta)
            join_sep = "\n\nGO\n\n" if engine == "sqlserver" else "\n\n"
            create_sql = join_sep.join(create_stmts)
            if engine == "sqlserver" and create_sql.strip():
                create_sql += "\n\nGO\n"
            elif create_sql.strip():
                create_sql += "\n"

            cols_summary = [
                {
                    "name": c.get("name"),
                    "type": TableDesignerService.format_column_type(c, engine),
                    "nullable": bool(c.get("nullable", True)),
                    "is_pk": bool(c.get("is_pk")),
                    "action": "add"
                }
                for c in smeta.get("columns", [])
            ]

            table_diffs.append({
                "table": tname,
                "name": tname,
                "object_type": "table",
                "status": "missing_in_target",  # Chỉ có ở Source, cần tạo trên Target
                "action": "create",
                "destructive": False,
                "column_count_source": len(smeta.get("columns", [])),
                "column_count_target": 0,
                "changes_summary": {
                    "columns_added": len(cols_summary),
                    "columns_dropped": 0,
                    "columns_altered": 0,
                    "pk_changed": bool(smeta.get("has_pk")),
                    "indexes_changed": len(smeta.get("indexes", [])),
                    "fks_changed": len(smeta.get("foreign_keys", [])),
                },
                "columns_diff": cols_summary,
                "source_definition": create_sql,
                "target_definition": "",
                "migration_sql": create_sql,
                "statements": [
                    {"sql": s, "destructive": False, "description": f"Create table {tname}", "type": "tables"}
                    for s in create_stmts
                ]
            })

        # 2. Tables Only in Target (Extra in Target -> Dropping is Destructive)
        for tname in only_in_tgt_names:
            tmeta = tgt_tables[tname]
            schema = target_snap.get("schema") or "dbo"
            full_name = TableDesignerService._format_table_name(schema, tname, engine)
            drop_sql = f"DROP TABLE {full_name};\n"
            if engine == "sqlserver":
                drop_sql += "GO\n"

            tgt_create_sql = ""
            try:
                tm_copy = copy.deepcopy(tmeta)
                tm_copy["engine"] = engine
                tm_copy["schema"] = schema
                tgt_stmts = TableDesignerService.generate_create_table_statements(tm_copy)
                join_sep = "\n\nGO\n\n" if engine == "sqlserver" else "\n\n"
                tgt_create_sql = join_sep.join(tgt_stmts)
                if engine == "sqlserver" and tgt_create_sql.strip():
                    tgt_create_sql += "\n\nGO\n"
                elif tgt_create_sql.strip():
                    tgt_create_sql += "\n"
            except Exception as e:
                logger.debug("Failed to generate target create table ddl: %s", e)

            cols_summary = [
                {
                    "name": c.get("name"),
                    "type": TableDesignerService.format_column_type(c, engine),
                    "nullable": bool(c.get("nullable", True)),
                    "is_pk": bool(c.get("is_pk")),
                    "action": "drop"
                }
                for c in tmeta.get("columns", [])
            ]

            table_diffs.append({
                "table": tname,
                "name": tname,
                "object_type": "table",
                "status": "extra_in_target",  # Chỉ có ở Target
                "action": "drop",
                "destructive": True,
                "column_count_source": 0,
                "column_count_target": len(tmeta.get("columns", [])),
                "changes_summary": {
                    "columns_added": 0,
                    "columns_dropped": len(cols_summary),
                    "columns_altered": 0,
                    "pk_changed": False,
                    "indexes_changed": 0,
                    "fks_changed": 0,
                },
                "columns_diff": cols_summary,
                "source_definition": "",
                "target_definition": tgt_create_sql,
                "migration_sql": drop_sql,
                "statements": [
                    {
                        "sql": drop_sql.strip(),
                        "destructive": True,
                        "description": f"Drop table {full_name} (chỉ có ở Target)",
                        "type": "tables"
                    }
                ]
            })

        # 3. Common Tables (Analyze Differences)
        identical_count = 0
        different_count = 0

        for tname in common_names:
            raw_smeta = src_tables[tname]
            raw_tmeta = tgt_tables[tname]

            # Normalize constraints so auto-generated names don't create false diffs
            norm_smeta, norm_tmeta = cls._normalize_constraints_for_diff(raw_smeta, raw_tmeta, engine)

            # Ensure schema name in modified aligns with target's schema for DDL generation
            norm_smeta["schema"] = norm_tmeta.get("schema") or target_snap.get("schema")
            norm_smeta["engine"] = engine
            norm_tmeta["engine"] = engine

            # Generate diff between target (original) and source (modified)
            diff_res = TableDesignerService.generate_diff(original=norm_tmeta, modified=norm_smeta)
            stmts = diff_res.get("statements", [])

            # Compute detailed column diff list for UI
            s_cols = {c["name"].lower(): c for c in raw_smeta.get("columns", [])}
            t_cols = {c["name"].lower(): c for c in raw_tmeta.get("columns", [])}

            cols_diff = []
            cols_added = 0
            cols_dropped = 0
            cols_altered = 0

            # Check source columns against target
            for cname_lower, scol in s_cols.items():
                if cname_lower not in t_cols:
                    cols_added += 1
                    cols_diff.append({
                        "name": scol.get("name"),
                        "source_type": TableDesignerService.format_column_type(scol, engine),
                        "target_type": None,
                        "source_nullable": bool(scol.get("nullable", True)),
                        "target_nullable": None,
                        "action": "add"
                    })
                else:
                    tcol = t_cols[cname_lower]
                    stype = TableDesignerService.format_column_type(scol, engine)
                    ttype = TableDesignerService.format_column_type(tcol, engine)
                    s_null = bool(scol.get("nullable", True))
                    t_null = bool(tcol.get("nullable", True))
                    s_pk = bool(scol.get("is_pk"))
                    t_pk = bool(tcol.get("is_pk"))

                    if stype.lower() != ttype.lower() or s_null != t_null or s_pk != t_pk:
                        cols_altered += 1
                        cols_diff.append({
                            "name": scol.get("name"),
                            "source_type": stype,
                            "target_type": ttype,
                            "source_nullable": s_null,
                            "target_nullable": t_null,
                            "action": "modify"
                        })

            # Check target columns not in source
            for cname_lower, tcol in t_cols.items():
                if cname_lower not in s_cols:
                    cols_dropped += 1
                    cols_diff.append({
                        "name": tcol.get("name"),
                        "source_type": None,
                        "target_type": TableDesignerService.format_column_type(tcol, engine),
                        "source_nullable": None,
                        "target_nullable": bool(tcol.get("nullable", True)),
                        "action": "drop"
                    })

            is_different = len(stmts) > 0

            if not is_different:
                identical_count += 1
                status = "identical"
                action = "none"
            else:
                different_count += 1
                status = "different"
                action = "alter"

            # Generate full DDL for both Source and Target table for side-by-side Diff viewing
            join_sep = "\n\nGO\n\n" if engine == "sqlserver" else "\n\n"
            src_ddl = ""
            tgt_ddl = ""
            try:
                sm = copy.deepcopy(raw_smeta)
                sm["engine"] = engine
                sm["schema"] = source_snap.get("schema") or "dbo"
                s_stmts = TableDesignerService.generate_create_table_statements(sm)
                src_ddl = join_sep.join(s_stmts)
                if engine == "sqlserver" and src_ddl.strip():
                    src_ddl += "\n\nGO\n"
                elif src_ddl.strip():
                    src_ddl += "\n"
            except Exception as e:
                logger.debug("Failed to generate source create table ddl: %s", e)

            try:
                tm = copy.deepcopy(raw_tmeta)
                tm["engine"] = engine
                tm["schema"] = target_snap.get("schema") or "dbo"
                t_stmts = TableDesignerService.generate_create_table_statements(tm)
                tgt_ddl = join_sep.join(t_stmts)
                if engine == "sqlserver" and tgt_ddl.strip():
                    tgt_ddl += "\n\nGO\n"
                elif tgt_ddl.strip():
                    tgt_ddl += "\n"
            except Exception as e:
                logger.debug("Failed to generate target create table ddl: %s", e)

            table_diffs.append({
                "table": tname,
                "name": tname,
                "object_type": "table",
                "status": status,
                "action": action,
                "destructive": bool(diff_res.get("has_destructive")),
                "column_count_source": len(raw_smeta.get("columns", [])),
                "column_count_target": len(raw_tmeta.get("columns", [])),
                "changes_summary": {
                    "columns_added": cols_added,
                    "columns_dropped": cols_dropped,
                    "columns_altered": cols_altered,
                    "statement_count": len(stmts)
                },
                "columns_diff": cols_diff,
                "source_definition": src_ddl,
                "target_definition": tgt_ddl,
                "migration_sql": diff_res.get("migration_sql", ""),
                "statements": stmts,
                "warnings": diff_res.get("warnings", [])
            })

        # 4. Diff Programmability Objects (Views, Procedures, Functions, Triggers)
        target_schema = target_snap.get("schema") or "dbo"
        view_diffs = cls._diff_code_objects(source_snap.get("views", {}), target_snap.get("views", {}), "view", engine, target_schema)
        proc_diffs = cls._diff_code_objects(source_snap.get("procedures", {}), target_snap.get("procedures", {}), "procedure", engine, target_schema)
        func_diffs = cls._diff_code_objects(source_snap.get("functions", {}), target_snap.get("functions", {}), "function", engine, target_schema)
        trig_diffs = cls._diff_code_objects(source_snap.get("triggers", {}), target_snap.get("triggers", {}), "trigger", engine, target_schema)

        all_diffs = table_diffs + view_diffs + proc_diffs + func_diffs + trig_diffs

        # Sort diffs: Different first, then Missing in Target, Extra in Target, Identical last
        order_map = {"different": 0, "missing_in_target": 1, "extra_in_target": 2, "identical": 3}
        all_diffs.sort(key=lambda x: (order_map.get(x["status"], 9), x.get("object_type", "table"), x["table"].lower()))

        has_destructive_overall = any(t.get("destructive") for t in all_diffs if t.get("status") != "identical")
        identical_count = sum(1 for d in all_diffs if d["status"] == "identical")
        different_count = sum(1 for d in all_diffs if d["status"] == "different")
        missing_count = sum(1 for d in all_diffs if d["status"] == "missing_in_target")
        extra_count = sum(1 for d in all_diffs if d["status"] == "extra_in_target")

        return {
            "source": {
                "engine": source_snap.get("engine"),
                "database": source_snap.get("database"),
                "schema": source_snap.get("schema"),
                "table_count": len(src_tables)
            },
            "target": {
                "engine": target_snap.get("engine"),
                "database": target_snap.get("database"),
                "schema": target_snap.get("schema"),
                "table_count": len(tgt_tables)
            },
            "summary": {
                "total_source_tables": len(all_diffs),
                "total_target_tables": len(all_diffs),
                "identical_count": identical_count,
                "different_count": different_count,
                "missing_in_target_count": missing_count,
                "extra_in_target_count": extra_count,
                "has_destructive_changes": has_destructive_overall,
                "tables_count": len(table_diffs),
                "views_count": len(view_diffs),
                "procedures_count": len(proc_diffs),
                "functions_count": len(func_diffs),
                "triggers_count": len(trig_diffs)
            },
            "tables": all_diffs,
            "objects": all_diffs
        }

    @classmethod
    def _diff_code_objects(
        cls,
        src_dict: Dict[str, Any],
        tgt_dict: Dict[str, Any],
        obj_type: str,
        engine: str,
        schema: str
    ) -> List[Dict[str, Any]]:
        """Compares DDL definitions of Views, Procedures, Functions, or Triggers."""
        diffs = []
        src_keys = set(src_dict.keys())
        tgt_keys = set(tgt_dict.keys())

        only_src = sorted(list(src_keys - tgt_keys))
        only_tgt = sorted(list(tgt_keys - src_keys))
        common = sorted(list(src_keys & tgt_keys))

        def _clean_code(c):
            return re.sub(r'\s+', ' ', (c or "").strip())

        # 1. Missing in Target (Create)
        for name in only_src:
            s_obj = src_dict[name]
            s_def = s_obj.get("definition") or ""
            mig_sql = s_def.strip()
            if engine == "sqlserver" and mig_sql and not mig_sql.endswith("GO"):
                mig_sql += "\nGO\n"
            elif mig_sql:
                mig_sql += "\n"

            diffs.append({
                "table": name,
                "name": name,
                "object_type": obj_type,
                "status": "missing_in_target",
                "action": "create",
                "destructive": False,
                "source_definition": s_def,
                "target_definition": "",
                "migration_sql": mig_sql,
                "statements": [{"sql": mig_sql, "destructive": False, "description": f"Create {obj_type} {name}", "type": obj_type}]
            })

        # 2. Extra in Target (Drop)
        for name in only_tgt:
            t_obj = tgt_dict[name]
            t_def = t_obj.get("definition") or ""
            if engine == "sqlserver":
                type_kw = "PROCEDURE" if obj_type == "procedure" else ("VIEW" if obj_type == "view" else ("FUNCTION" if obj_type == "function" else "TRIGGER"))
                drop_sql = f"DROP {type_kw} [{schema}].[{name}];\nGO\n"
            elif engine == "postgresql":
                type_kw = "PROCEDURE" if obj_type == "procedure" else ("VIEW" if obj_type == "view" else ("FUNCTION" if obj_type == "function" else "TRIGGER"))
                drop_sql = f"DROP {type_kw} IF EXISTS {schema}.{name};\n"
            else:
                drop_sql = f"DROP VIEW IF EXISTS {name};\n"

            diffs.append({
                "table": name,
                "name": name,
                "object_type": obj_type,
                "status": "extra_in_target",
                "action": "drop",
                "destructive": True,
                "source_definition": "",
                "target_definition": t_def,
                "migration_sql": drop_sql,
                "statements": [{"sql": drop_sql, "destructive": True, "description": f"Drop {obj_type} {name}", "type": obj_type}]
            })

        # 3. Common objects (Check difference)
        for name in common:
            s_obj = src_dict[name]
            t_obj = tgt_dict[name]
            s_def = s_obj.get("definition") or ""
            t_def = t_obj.get("definition") or ""

            is_identical = (_clean_code(s_def) == _clean_code(t_def))
            if is_identical:
                diffs.append({
                    "table": name,
                    "name": name,
                    "object_type": obj_type,
                    "status": "identical",
                    "action": "none",
                    "destructive": False,
                    "source_definition": s_def,
                    "target_definition": t_def,
                    "migration_sql": "",
                    "statements": []
                })
            else:
                mig_sql = s_def.strip()
                if engine == "sqlserver":
                    mig_sql = re.sub(r'(?i)\bCREATE\s+(PROCEDURE|PROC|VIEW|FUNCTION|TRIGGER)\b', r'CREATE OR ALTER \1', mig_sql)
                    if not mig_sql.endswith("GO"):
                        mig_sql += "\nGO\n"
                elif engine == "postgresql":
                    mig_sql = re.sub(r'(?i)\bCREATE\s+(VIEW|FUNCTION)\b', r'CREATE OR REPLACE \1', mig_sql)
                    mig_sql += "\n"
                else:
                    mig_sql += "\n"

                diffs.append({
                    "table": name,
                    "name": name,
                    "object_type": obj_type,
                    "status": "different",
                    "action": "alter",
                    "destructive": False,
                    "source_definition": s_def,
                    "target_definition": t_def,
                    "migration_sql": mig_sql,
                    "statements": [{"sql": mig_sql, "destructive": False, "description": f"Alter {obj_type} {name}", "type": obj_type}]
                })

        return diffs


    @classmethod
    def generate_migration_script(
        cls,
        diff_result: Dict[str, Any],
        selected_tables: Optional[List[str]] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Assembles a consolidated, executable DDL migration script for selected tables.
        Options:
            - include_drop_tables (bool): whether to include DROP TABLE for extra_in_target tables (default: False).
            - wrap_transaction (bool): whether to wrap the batch in an atomic transaction (default: True).
        """
        opts = dict(options or {})
        include_drop_tables = bool(opts.get("include_drop_tables", False))
        wrap_transaction = bool(opts.get("wrap_transaction", True))

        target_info = diff_result.get("target", {})
        engine = str(target_info.get("engine") or "sqlserver").lower()
        if engine in ("sqlite3", "sqlite"):
            engine = "sqlite"

        tables = diff_result.get("tables", [])
        selected_set = set(selected_tables) if selected_tables is not None else None

        active_tables = []
        for t in tables:
            tname = t["table"]
            status = t["status"]
            if status == "identical":
                continue
            if selected_set is not None and tname not in selected_set:
                continue
            if status == "extra_in_target" and not include_drop_tables:
                continue
            active_tables.append(t)

        if not active_tables:
            return {
                "sql": "-- Không có thay đổi nào được chọn để sinh script migration.\n",
                "statement_count": 0,
                "has_destructive": False,
                "table_count": 0
            }

        lines = []
        total_stmts = 0
        has_destructive = False

        # Header Comments
        lines.append("-- ====================================================================")
        lines.append("-- luoBTool IDE - Schema Compare Migration Script")
        lines.append(f"-- Engine: {engine.upper()}")
        lines.append(f"-- Source: [{diff_result.get('source', {}).get('database')}].[{diff_result.get('source', {}).get('schema')}]")
        lines.append(f"-- Target: [{diff_result.get('target', {}).get('database')}].[{diff_result.get('target', {}).get('schema')}]")
        lines.append(f"-- Generated Tables: {len(active_tables)}")
        lines.append("-- ====================================================================")
        lines.append("")

        if wrap_transaction:
            if engine == "sqlserver":
                lines.append("SET XACT_ABORT ON;")
                lines.append("BEGIN TRANSACTION;")
                lines.append("GO")
            elif engine == "postgresql":
                lines.append("BEGIN;")
            elif engine == "sqlite":
                lines.append("BEGIN TRANSACTION;")
            lines.append("")

        for t in active_tables:
            tname = t["table"]
            status = t["status"]
            stmts = t.get("statements", [])
            mig_sql = (t.get("migration_sql") or "").strip()
            if not mig_sql:
                continue

            if t.get("destructive"):
                has_destructive = True
            total_stmts += len(stmts) if stmts else 1

            obj_type = t.get("object_type", "table")
            type_label = "Bảng" if obj_type == "table" else ("View" if obj_type == "view" else ("Procedure" if obj_type == "procedure" else ("Function" if obj_type == "function" else "Trigger")))
            status_vi = "Tạo mới" if status == "missing_in_target" else ("Xóa (Destructive)" if status == "extra_in_target" else "Điều chỉnh định nghĩa")
            lines.append(f"-- ── {type_label}: [{tname}] ({status_vi}) ──────────────────────────")
            lines.append(mig_sql)
            lines.append("")

        if wrap_transaction:
            if engine == "sqlserver":
                lines.append("COMMIT TRANSACTION;")
                lines.append("GO")
            elif engine == "postgresql":
                lines.append("COMMIT;")
            elif engine == "sqlite":
                lines.append("COMMIT;")
            lines.append("")

        final_sql = "\n".join(lines)
        return {
            "sql": final_sql,
            "statement_count": total_stmts,
            "has_destructive": has_destructive,
            "table_count": len(active_tables)
        }
