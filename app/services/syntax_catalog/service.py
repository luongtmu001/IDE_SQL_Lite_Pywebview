# -*- coding: utf-8 -*-
"""
SyntaxCatalogService - In-memory query and comparison service for Cross-Database Syntax Reference.
Provides fast local lookup, multi-attribute search, and relation resolution between PostgreSQL and SQL Server.
"""
import json
import logging
import re
from pathlib import Path
from typing import Dict, List, Any, Optional

from app.utils.paths import get_app_dir, get_bundle_dir
from app.services.syntax_catalog.models import (
    Concept,
    SyntaxEntry,
    MappingEntry,
    SourceEntry,
    CatalogManifest,
)
from app.services.syntax_catalog.validator import CatalogValidator, CatalogValidationError

logger = logging.getLogger("luobtool.syntax_catalog")

# Accurate pattern recognition for verified catalog entries
SYNTAX_DETECTION_PATTERNS: Dict[str, List[str]] = {
    "pg_left_join_lateral": [r"\bLEFT\s+(?:OUTER\s+)?JOIN\s+LATERAL\b", r"\bLATERAL\s+LEFT\s+JOIN\b"],
    "pg_cross_join_lateral": [r"\bCROSS\s+JOIN\s+LATERAL\b", r",\s*LATERAL\b", r"(?<!LEFT\s)\bJOIN\s+LATERAL\b", r"\bLATERAL\b"],
    "ms_outer_apply": [r"\bOUTER\s+APPLY\b"],
    "ms_cross_apply": [r"\bCROSS\s+APPLY\b"],
    "pg_ilike": [r"\bILIKE\b", r"~~\*"],
    "pg_tilde_tilde_star": [r"~~\*"],
    "pg_like": [r"(?<!I)\bLIKE\b", r"(?<!~)~~(?!\*)"],
    "pg_tilde_tilde": [r"(?<!~)~~(?!\*)"],
    "ms_like": [r"\bLIKE\b"],
    "pg_limit_offset": [r"\bLIMIT\b"],
    "pg_offset_fetch": [r"\bOFFSET\b[\s\S]*?\bFETCH\b"],
    "ms_top": [r"\bTOP\b(?:\s*\(\s*\d+\s*\)|\s+\d+)"],
    "ms_offset_fetch": [r"\bOFFSET\b[\s\S]*?\bFETCH\b"],
    "pg_string_agg": [r"\bSTRING_AGG\s*\("],
    "ms_string_agg": [r"\bSTRING_AGG\s*\("],
    "pg_coalesce": [r"\bCOALESCE\s*\("],
    "ms_coalesce": [r"\bCOALESCE\s*\("],
    "ms_isnull": [r"\bISNULL\s*\("],
    "pg_json_arrow_text": [r"->>"],
    "ms_json_value": [r"\bJSON_VALUE\s*\("],
    "pg_current_timestamp": [r"\bCURRENT_TIMESTAMP\b", r"\bNOW\s*\(\s*\)"],
    "ms_getdate": [r"\bGETDATE\s*\(\s*\)"],
    "pg_concat_operator": [r"\|\|"],
    "pg_concat_func": [r"\bCONCAT\s*\("],
    "ms_concat_operator": [r"\bCONCAT\s*\(", r"(?:'[^']*'\s*\+|\+\s*'[^']*')"],
    "ms_concat_func": [r"\bCONCAT\s*\("],
    "pg_substr": [r"\bSUBSTR\s*\(", r"\bSUBSTRING\s*\("],
    "ms_substring": [r"\bSUBSTRING\s*\("],
    "pg_length": [r"\bLENGTH\s*\(", r"\bCHAR_LENGTH\s*\("],
    "ms_len": [r"\bLEN\s*\("],
    "ms_datalength": [r"\bDATALENGTH\s*\("],
    "pg_interval_add": [r"\bINTERVAL\s+'[^']+'", r"\+\s*INTERVAL\b", r"-\s*INTERVAL\b"],
    "ms_dateadd": [r"\bDATEADD\s*\("],
    "pg_date_trunc": [r"\bdate_trunc\s*\("],
    "ms_datetrunc": [r"\bDATETRUNC\s*\("],
    "pg_cast_double_colon": [r"::[a-zA-Z0-9_]+"],
    "ms_try_cast": [r"\bTRY_CAST\s*\(", r"\bTRY_CONVERT\s*\("],
    "ms_convert_func": [r"\bCONVERT\s*\("],
    "pg_dml_returning": [r"\bRETURNING\b"],
    "ms_dml_output": [r"\bOUTPUT\s+(?:inserted|deleted)\b", r"\bOUTPUT\b"],
    "ms_iif": [r"\bIIF\s*\("],
    "pg_random": [r"\bRANDOM\s*\(\s*\)"],
    "ms_rand": [r"\bRAND\s*\(", r"\bNEWID\s*\(\s*\)", r"\bCHECKSUM\s*\(\s*NEWID\s*\(\s*\)\s*\)"],
    "pg_regex_match": [r"(?<!~)~(?!\*)", r"~\*"],
    "pg_generate_series": [r"\bgenerate_series\s*\("],
    "pg_on_conflict_upsert": [r"\bON\s+CONFLICT\b", r"\bDO\s+UPDATE\b", r"\bDO\s+NOTHING\b"],
    "pg_distinct_on": [r"\bDISTINCT\s+ON\s*\("],
    "pg_array_construct_ops": [r"\bARRAY\s*\[", r"@>", r"&&"],
    "pg_anonymous_do_block": [r"\bDO\s+\$\$", r"\bDO\s+LANGUAGE\b"],
    "pg_copy_command": [r"\bCOPY\s+[a-zA-Z0-9_\.\"]+\s+(?:FROM|TO)\b"],
    "pg_listen_notify": [r"\bLISTEN\s+[a-zA-Z0-9_]+", r"\bNOTIFY\s+[a-zA-Z0-9_]+"],
    "pg_regexp_split_to_table": [r"\bregexp_split_to_table\s*\("],
    "ms_select_into_temp": [r"\bINTO\s+#[a-zA-Z0-9_]+"],
    "ms_merge_statement": [r"\bMERGE\s+INTO\b", r"\bWHEN\s+MATCHED\b", r"\bWHEN\s+NOT\s+MATCHED\b"],
    "ms_table_variable": [r"\bDECLARE\s+@[a-zA-Z0-9_]+\s+TABLE\b"],
    "ms_set_nocount": [r"\bSET\s+NOCOUNT\s+(?:ON|OFF)\b"],
    "ms_string_split": [r"\bSTRING_SPLIT\s*\("],
    "ms_try_convert_parse": [r"\bTRY_CONVERT\s*\(", r"\bTRY_PARSE\s*\("],
    "ms_scope_identity": [r"\bSCOPE_IDENTITY\s*\(\s*\)", r"\b@@IDENTITY\b"],
    "ms_dbcc_checkdb": [r"\bDBCC\s+CHECKDB\b"],
}


class SyntaxCatalogService:
    """
    Singleton-capable service for reading, caching, and searching the Syntax Catalog.
    """
    _instance: Optional["SyntaxCatalogService"] = None

    def __init__(self, catalog_dir: Optional[Path] = None):
        self.catalog_dir = catalog_dir or self._resolve_catalog_dir()
        self._manifest: Optional[CatalogManifest] = None
        self._concepts: Dict[str, Concept] = {}
        self._syntax_entries: Dict[str, SyntaxEntry] = {}
        self._mappings: Dict[str, MappingEntry] = {}
        self._sources: Dict[str, SourceEntry] = {}
        self._is_loaded = False
        self._load_errors: List[str] = []

    @classmethod
    def get_instance(cls) -> "SyntaxCatalogService":
        if cls._instance is None:
            cls._instance = SyntaxCatalogService()
        return cls._instance

    def _resolve_catalog_dir(self) -> Path:
        """Resolve catalog data directory in development and bundled environments."""
        candidates = [
            get_app_dir() / "app" / "data" / "syntax_catalog",
            get_bundle_dir() / "app" / "data" / "syntax_catalog",
            get_bundle_dir() / "_internal" / "app" / "data" / "syntax_catalog",
            Path(__file__).resolve().parent.parent.parent / "data" / "syntax_catalog",
        ]
        for c in candidates:
            if c.exists() and (c / "catalog_manifest.json").exists():
                return c
        # Default fallback
        return candidates[0]

    def _read_json(self, file_name: str, default: Any = None) -> Any:
        path = self.catalog_dir / file_name
        if not path.exists():
            logger.warning("[SyntaxCatalog] File does not exist: %s", path)
            return default
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                return json.load(f)
        except Exception as e:
            logger.error("[SyntaxCatalog] Failed reading %s: %s", path, e)
            return default

    def load_catalog(self, force_reload: bool = False) -> bool:
        """
        Loads and validates catalog JSON files into memory.
        """
        if self._is_loaded and not force_reload:
            return True

        self._load_errors.clear()
        manifest_raw = self._read_json("catalog_manifest.json", {})
        concepts_raw = self._read_json("concepts.json", [])
        syntax_raw = self._read_json("syntax_entries.json", [])
        mappings_raw = self._read_json("mappings.json", [])
        sources_raw = self._read_json("sources.json", [])

        bundle = {
            "manifest": manifest_raw,
            "concepts": concepts_raw,
            "syntax_entries": syntax_raw,
            "mappings": mappings_raw,
            "sources": sources_raw,
        }

        is_valid, errors = CatalogValidator.validate_catalog(bundle)
        if not is_valid:
            self._load_errors = errors
            logger.error("[SyntaxCatalog] Validation errors:\n%s", "\n".join(errors))
            # Continue loading valid entries with warning instead of crashing
        
        # Populate Manifest
        self._manifest = CatalogManifest(
            catalog_version=manifest_raw.get("catalog_version", "1.0.0"),
            schema_version=manifest_raw.get("schema_version", "1.0"),
            updated_at=manifest_raw.get("updated_at", "2026-10-22"),
            supported_databases=manifest_raw.get("supported_databases", ["postgresql", "sqlserver"]),
            description=manifest_raw.get("description", ""),
            total_concepts=len(concepts_raw),
            total_syntax_entries=len(syntax_raw),
            total_mappings=len(mappings_raw),
            total_sources=len(sources_raw),
        )

        # Populate Sources
        self._sources = {
            s["id"]: SourceEntry(**s) for s in sources_raw if isinstance(s, dict) and "id" in s
        }

        # Populate Concepts
        self._concepts = {
            c["id"]: Concept(**c) for c in concepts_raw if isinstance(c, dict) and "id" in c
        }

        # Populate Syntax Entries
        self._syntax_entries = {}
        for se in syntax_raw:
            if not isinstance(se, dict) or "id" not in se:
                continue
            entry_copy = dict(se)
            if "example" in entry_copy and not entry_copy.get("examples"):
                entry_copy["examples"] = [{"title": entry_copy.get("display_name", ""), "sql": entry_copy.pop("example")}]
            elif "example" in entry_copy:
                entry_copy.pop("example")
            self._syntax_entries[se["id"]] = SyntaxEntry(**entry_copy)

        # Populate Mappings
        self._mappings = {
            m["id"]: MappingEntry(**m) for m in mappings_raw if isinstance(m, dict) and "id" in m
        }

        self._is_loaded = True
        logger.info(
            "[SyntaxCatalog] Catalog v%s loaded successfully (%d concepts, %d syntaxes, %d mappings, %d sources)",
            self._manifest.catalog_version,
            len(self._concepts),
            len(self._syntax_entries),
            len(self._mappings),
            len(self._sources),
        )
        return True

    def get_manifest(self) -> Dict[str, Any]:
        self.load_catalog()
        return self._manifest.to_dict() if self._manifest else {}

    def get_concept(self, concept_id: str) -> Optional[Dict[str, Any]]:
        self.load_catalog()
        c = self._concepts.get(concept_id)
        return c.to_dict() if c else None

    def get_syntax_entry(self, syntax_id: str) -> Optional[Dict[str, Any]]:
        self.load_catalog()
        se = self._syntax_entries.get(syntax_id)
        if not se:
            return None
        res = se.to_dict()
        # Attach resolved sources
        res["sources"] = [self._sources[sid].to_dict() for sid in se.source_ids if sid in self._sources]
        return res

    def get_mappings_for_concept(
        self,
        concept_id: str,
        source_db: Optional[str] = None,
        target_db: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Returns all mappings belonging to a concept, optionally filtered by source/target database.
        """
        self.load_catalog()
        results = []
        for m in self._mappings.values():
            if m.concept_id != concept_id:
                continue

            # Check database match if requested
            if source_db:
                src_db_match = any(
                    self._syntax_entries.get(sid) and self._syntax_entries[sid].database == source_db
                    for sid in m.source_syntax_ids
                )
                if not src_db_match:
                    continue

            if target_db:
                tgt_db_match = any(
                    self._syntax_entries.get(tid) and self._syntax_entries[tid].database == target_db
                    for tid in m.target_syntax_ids
                )
                if not tgt_db_match:
                    continue

            m_dict = m.to_dict()
            m_dict["concept"] = self._concepts.get(m.concept_id).to_dict() if m.concept_id in self._concepts else None
            m_dict["source_syntaxes"] = [
                self._syntax_entries[sid].to_dict() for sid in m.source_syntax_ids if sid in self._syntax_entries
            ]
            m_dict["target_syntaxes"] = [
                self._syntax_entries[tid].to_dict() for tid in m.target_syntax_ids if tid in self._syntax_entries
            ]
            m_dict["sources"] = [
                self._sources[sid].to_dict() for sid in m.source_ids if sid in self._sources
            ]
            results.append(m_dict)

        return results

    def get_mappings_for_syntax(self, syntax_id: str) -> List[Dict[str, Any]]:
        """
        Returns all mappings where syntax_id is either in source_syntax_ids or target_syntax_ids.
        """
        self.load_catalog()
        results = []
        for m in self._mappings.values():
            if syntax_id in m.source_syntax_ids or syntax_id in m.target_syntax_ids:
                m_dict = m.to_dict()
                m_dict["concept"] = self._concepts.get(m.concept_id).to_dict() if m.concept_id in self._concepts else None
                m_dict["source_syntaxes"] = [
                    self._syntax_entries[sid].to_dict() for sid in m.source_syntax_ids if sid in self._syntax_entries
                ]
                m_dict["target_syntaxes"] = [
                    self._syntax_entries[tid].to_dict() for tid in m.target_syntax_ids if tid in self._syntax_entries
                ]
                m_dict["sources"] = [
                    self._sources[sid].to_dict() for sid in m.source_ids if sid in self._sources
                ]
                results.append(m_dict)
        return results

    def get_sources(self, source_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        self.load_catalog()
        if source_ids:
            return [self._sources[sid].to_dict() for sid in source_ids if sid in self._sources]
        return [s.to_dict() for s in self._sources.values()]

    def search_catalog(
        self,
        query: str = "",
        database: Optional[str] = None,
        category: Optional[str] = None,
        status: Optional[str] = None,
        is_exclusive: Optional[bool] = None,
    ) -> List[Dict[str, Any]]:
        """
        Multi-attribute search across Concepts, Syntax Entries, Aliases, and Mappings.
        Returns matching Syntax Entries annotated with their associated concept and mappings.
        """
        self.load_catalog()
        q = (query or "").strip().lower()
        db_filter = (database or "").strip().lower() if database and database != "all" else None
        cat_filter = (category or "").strip().lower() if category and category != "all" else None
        stat_filter = (status or "").strip().lower() if status and status != "all" else None

        matched_results: List[Dict[str, Any]] = []

        for se in self._syntax_entries.values():
            # 1. Filter by database
            if db_filter and se.database != db_filter:
                continue

            # 2. Filter by category
            if cat_filter and se.category.lower() != cat_filter:
                continue

            # 3. Filter by status
            if stat_filter and se.status.lower() != stat_filter:
                continue

            # 4. Filter by is_exclusive
            if is_exclusive is not None and getattr(se, "is_exclusive", False) != is_exclusive:
                continue

            # 4. Search Query matching
            is_match = False
            match_score = 0
            if not q:
                is_match = True
            else:
                # Exact operator or syntax match (highest priority)
                if q == se.syntax.lower() or q == se.display_name.lower():
                    is_match = True
                    match_score += 100
                elif any(q == alias.lower() for alias in se.aliases):
                    is_match = True
                    match_score += 90
                elif q in se.syntax.lower() or q in se.display_name.lower():
                    is_match = True
                    match_score += 50
                elif any(q in alias.lower() for alias in se.aliases):
                    is_match = True
                    match_score += 40
                elif q in se.description.lower():
                    is_match = True
                    match_score += 20

                # Check Concept name and search terms
                if not is_match:
                    for m in self._mappings.values():
                        if se.id in m.source_syntax_ids or se.id in m.target_syntax_ids:
                            concept = self._concepts.get(m.concept_id)
                            if concept:
                                if q in concept.name.lower():
                                    is_match = True
                                    match_score += 30
                                    break
                                if any(q in st.lower() for st in concept.search_terms):
                                    is_match = True
                                    match_score += 25
                                    break
                                if q in concept.description.lower():
                                    is_match = True
                                    match_score += 15
                                    break

            if is_match:
                entry_dict = se.to_dict()
                entry_dict["match_score"] = match_score
                # Attach resolved mappings
                entry_dict["mappings"] = self.get_mappings_for_syntax(se.id)
                entry_dict["sources"] = [
                    self._sources[sid].to_dict() for sid in se.source_ids if sid in self._sources
                ]
                matched_results.append(entry_dict)

        # Sort by match score descending, then by display_name
        matched_results.sort(key=lambda x: (-x.get("match_score", 0), x.get("display_name", "")))
        return matched_results

    def compare_selection(
        self,
        sql_text: str,
        source_db: str = "postgresql",
        target_db: str = "sqlserver",
    ) -> Dict[str, Any]:
        """
        Analyzes an input SQL text against known catalog patterns.
        Identifies recognized concepts and presents verified mappings, conditions, and limitations.
        MVP DOES NOT execute SQL and DOES NOT claim general semantic equivalence.
        """
        self.load_catalog()
        sql_clean = (sql_text or "").strip()
        if not sql_clean:
            return {
                "success": True,
                "found": False,
                "message": "Nội dung SQL trống.",
                "matched_concepts": [],
            }

        source_db = source_db.lower()
        target_db = target_db.lower()

        matched_syntaxes = []
        # Match tokens/operators in sql_text against syntax_entries of source_db
        for se in self._syntax_entries.values():
            if se.database != source_db:
                continue

            pattern_matched = False
            # 1. Check verified detection patterns
            patterns = SYNTAX_DETECTION_PATTERNS.get(se.id, [])
            for pat in patterns:
                if re.search(pat, sql_clean, re.IGNORECASE):
                    pattern_matched = True
                    break

            # 2. Generic fallback if no specific patterns or pattern did not match yet
            if not pattern_matched and not patterns:
                is_symbol = bool(re.match(r"^[^a-zA-Z0-9_\s]+$", se.syntax))
                if is_symbol:
                    if se.syntax in sql_clean:
                        pattern_matched = True
                else:
                    esc_syntax = re.escape(se.syntax.split("(")[0].strip())
                    if re.search(r"\b" + esc_syntax + r"\b", sql_clean, re.IGNORECASE):
                        pattern_matched = True

                # Also check aliases
                if not pattern_matched:
                    for alias in se.aliases:
                        is_alias_sym = bool(re.match(r"^[^a-zA-Z0-9_\s]+$", alias))
                        if is_alias_sym and alias in sql_clean:
                            pattern_matched = True
                            break
                        elif not is_alias_sym and re.search(r"\b" + re.escape(alias) + r"\b", sql_clean, re.IGNORECASE):
                            pattern_matched = True
                            break

            if pattern_matched:
                matched_syntaxes.append(se)

        if not matched_syntaxes:
            return {
                "success": True,
                "found": False,
                "message": "Chưa có mapping đã xác minh cho cú pháp trong đoạn SQL này.",
                "matched_concepts": [],
            }

        # Build comparison details for each matched syntax
        matched_concepts_map: Dict[str, Dict[str, Any]] = {}
        for se in matched_syntaxes:
            mappings = self.get_mappings_for_syntax(se.id)
            for m in mappings:
                # Find counterpart syntaxes in the mapping that match target_db
                all_mapping_syntaxes = m.get("source_syntaxes", []) + m.get("target_syntaxes", [])
                target_matches = [
                    ts for ts in all_mapping_syntaxes
                    if ts.get("database") == target_db and ts.get("id") != se.id
                ]

                # If source_db == target_db, we can also match counterpart syntaxes within same db
                if not target_matches and source_db != target_db:
                    continue

                cid = m.get("concept_id")
                if cid not in matched_concepts_map:
                    concept = self._concepts.get(cid)
                    matched_concepts_map[cid] = {
                        "concept": concept.to_dict() if concept else None,
                        "concept_id": cid,
                        "concept_title": concept.name if concept else cid,
                        "category": concept.category if concept else se.category,
                        "detected_syntaxes": [],
                        "mappings": [],
                        "primary_target_syntax": "",
                        "primary_target_example": "",
                        "primary_source_example": "",
                        "primary_equivalence_level": m.get("equivalence_level", "equivalent"),
                        "conditions": m.get("conditions", ""),
                        "limitations": m.get("limitations", ""),
                        "differences": m.get("notes", ""),
                    }

                matched_concepts_map[cid]["detected_syntaxes"].append(se.to_dict())

                m_enriched = dict(m)
                m_enriched["counterpart_syntaxes"] = target_matches

                target_code = target_matches[0].get("syntax", "") if target_matches else ""
                target_ex = ""
                source_ex = ""

                for cex in m.get("comparison_examples", []):
                    if target_db in cex and not target_ex:
                        target_ex = cex[target_db]
                    if source_db in cex and not source_ex:
                        source_ex = cex[source_db]

                if not target_ex and target_matches:
                    first_exs = target_matches[0].get("examples", [])
                    if first_exs and isinstance(first_exs, list):
                        target_ex = first_exs[0].get("sql", "")

                m_enriched["resolved_target_syntax"] = target_code
                m_enriched["resolved_target_example"] = target_ex
                m_enriched["resolved_source_example"] = source_ex

                if not matched_concepts_map[cid]["primary_target_syntax"]:
                    matched_concepts_map[cid]["primary_target_syntax"] = target_code
                if not matched_concepts_map[cid]["primary_target_example"]:
                    matched_concepts_map[cid]["primary_target_example"] = target_ex
                if not matched_concepts_map[cid]["primary_source_example"]:
                    matched_concepts_map[cid]["primary_source_example"] = source_ex

                matched_concepts_map[cid]["mappings"].append(m_enriched)
                has_mapped = True

            # If not mapped to target DB and this is an engine-exclusive syntax, provide direct exclusive guidance
            if not has_mapped and getattr(se, "is_exclusive", False):
                cid = se.concept_id or se.id
                if cid not in matched_concepts_map:
                    concept = self._concepts.get(cid)
                    counterpart_db_label = "SQL Server" if se.database == "postgresql" else "PostgreSQL"
                    matched_concepts_map[cid] = {
                        "concept": concept.to_dict() if concept else None,
                        "concept_id": cid,
                        "concept_title": f"{se.display_name} (Đặc thù {'PostgreSQL' if se.database == 'postgresql' else 'SQL Server'})",
                        "category": se.category,
                        "detected_syntaxes": [se.to_dict()],
                        "mappings": [],
                        "primary_target_syntax": getattr(se, "workaround", "") or f"-- Không có câu lệnh trực tiếp trên {counterpart_db_label}",
                        "primary_target_example": getattr(se, "workaround", ""),
                        "primary_source_example": se.examples[0].get("sql", "") if se.examples else "",
                        "primary_equivalence_level": "workaround_only" if getattr(se, "workaround", "") else "no_direct_equivalent",
                        "conditions": f"Tính năng độc quyền của {('PostgreSQL' if se.database == 'postgresql' else 'SQL Server')}. Không có cú pháp tương đương 1-1 trên {counterpart_db_label}.",
                        "limitations": f"{counterpart_db_label} không hỗ trợ native cú pháp này.",
                        "differences": getattr(se, "ai_insights", "") or getattr(se, "workaround", "") or se.description,
                        "is_exclusive": True,
                        "workaround": getattr(se, "workaround", ""),
                        "ai_insights": getattr(se, "ai_insights", ""),
                    }

        return {
            "success": True,
            "found": len(matched_concepts_map) > 0,
            "source_db": source_db,
            "target_db": target_db,
            "matched_concepts": list(matched_concepts_map.values()),
        }
