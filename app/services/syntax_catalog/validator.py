# -*- coding: utf-8 -*-
"""
Validation engine for Cross-Database Syntax Reference & Compare Catalog.
Ensures schema adherence, relational integrity, valid URLs, and strict DoD compliance.
"""
from typing import Dict, List, Any, Tuple
import re

from app.services.syntax_catalog.models import (
    VALID_DATABASES,
    VALID_EQUIVALENCE_LEVELS,
    VALID_STATUSES,
)

URL_REGEX = re.compile(
    r"^https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)$"
)


class CatalogValidationError(Exception):
    """Raised when catalog validation fails."""
    def __init__(self, errors: List[str]):
        super().__init__(f"Catalog validation failed with {len(errors)} error(s):\n" + "\n".join(f"- {e}" for e in errors))
        self.errors = errors


class CatalogValidator:
    """
    Validates syntax catalog data structures and semantic references.
    """

    @classmethod
    def validate_catalog(cls, catalog_data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Validates the entire catalog bundle.
        catalog_data contains:
          - 'manifest': Dict
          - 'concepts': List[Dict]
          - 'syntax_entries': List[Dict]
          - 'mappings': List[Dict]
          - 'sources': List[Dict]

        Returns (is_valid, errors_list).
        """
        errors: List[str] = []

        manifest = catalog_data.get("manifest") or {}
        concepts = catalog_data.get("concepts") or []
        syntax_entries = catalog_data.get("syntax_entries") or []
        mappings = catalog_data.get("mappings") or []
        sources = catalog_data.get("sources") or []

        # 1. Validate Manifest
        if not manifest.get("catalog_version"):
            errors.append("Manifest missing 'catalog_version'.")
        if not manifest.get("updated_at"):
            errors.append("Manifest missing 'updated_at'.")

        # 2. Validate Sources & track Source IDs
        source_ids = set()
        for idx, src in enumerate(sources):
            sid = src.get("id")
            if not sid:
                errors.append(f"Source at index {idx} is missing 'id'.")
                continue
            if sid in source_ids:
                errors.append(f"Duplicate Source ID detected: '{sid}'.")
            source_ids.add(sid)

            db = src.get("database")
            if db not in VALID_DATABASES:
                errors.append(f"Source '{sid}' has invalid database '{db}'. Must be in {VALID_DATABASES}.")

            url = src.get("url", "")
            if not url or not URL_REGEX.match(url):
                errors.append(f"Source '{sid}' has invalid URL format: '{url}'.")

            if not src.get("title"):
                errors.append(f"Source '{sid}' is missing 'title'.")
            if not src.get("documentation_version"):
                errors.append(f"Source '{sid}' is missing 'documentation_version'.")

        # 3. Validate Concepts & track Concept IDs
        concept_ids = set()
        for idx, c in enumerate(concepts):
            cid = c.get("id")
            if not cid:
                errors.append(f"Concept at index {idx} is missing 'id'.")
                continue
            if cid in concept_ids:
                errors.append(f"Duplicate Concept ID detected: '{cid}'.")
            concept_ids.add(cid)

            if not c.get("name"):
                errors.append(f"Concept '{cid}' is missing 'name'.")
            if not c.get("category"):
                errors.append(f"Concept '{cid}' is missing 'category'.")
            if not c.get("description"):
                errors.append(f"Concept '{cid}' is missing 'description'.")

            status = c.get("status", "draft")
            if status not in VALID_STATUSES:
                errors.append(f"Concept '{cid}' has invalid status '{status}'.")

        # 4. Validate Syntax Entries & track Syntax IDs
        syntax_ids = set()
        for idx, se in enumerate(syntax_entries):
            seid = se.get("id")
            if not seid:
                errors.append(f"Syntax entry at index {idx} is missing 'id'.")
                continue
            if seid in syntax_ids:
                errors.append(f"Duplicate Syntax Entry ID detected: '{seid}'.")
            syntax_ids.add(seid)

            db = se.get("database")
            if db not in VALID_DATABASES:
                errors.append(f"Syntax Entry '{seid}' has invalid database '{db}'. Must be in {VALID_DATABASES}.")

            if not se.get("syntax"):
                errors.append(f"Syntax Entry '{seid}' is missing 'syntax'.")
            if not se.get("display_name"):
                errors.append(f"Syntax Entry '{seid}' is missing 'display_name'.")
            if not se.get("category"):
                errors.append(f"Syntax Entry '{seid}' is missing 'category'.")
            if not se.get("description"):
                errors.append(f"Syntax Entry '{seid}' is missing 'description'.")

            # Check source references
            entry_sources = se.get("source_ids") or []
            if se.get("status") == "verified" and not entry_sources:
                errors.append(f"Verified Syntax Entry '{seid}' must have at least one source in 'source_ids'.")
            for ref_sid in entry_sources:
                if ref_sid not in source_ids:
                    errors.append(f"Syntax Entry '{seid}' references non-existent source_id '{ref_sid}'.")

        # 5. Validate Mappings & cross references
        mapping_ids = set()
        for idx, m in enumerate(mappings):
            mid = m.get("id")
            if not mid:
                errors.append(f"Mapping at index {idx} is missing 'id'.")
                continue
            if mid in mapping_ids:
                errors.append(f"Duplicate Mapping ID detected: '{mid}'.")
            mapping_ids.add(mid)

            cid = m.get("concept_id")
            if not cid or cid not in concept_ids:
                errors.append(f"Mapping '{mid}' references invalid or missing concept_id '{cid}'.")

            src_syn_ids = m.get("source_syntax_ids") or []
            tgt_syn_ids = m.get("target_syntax_ids") or []
            if not src_syn_ids:
                errors.append(f"Mapping '{mid}' must specify at least one item in 'source_syntax_ids'.")
            if not tgt_syn_ids:
                errors.append(f"Mapping '{mid}' must specify at least one item in 'target_syntax_ids'.")

            for sid in src_syn_ids:
                if sid not in syntax_ids:
                    errors.append(f"Mapping '{mid}' references non-existent source_syntax_id '{sid}'.")
            for sid in tgt_syn_ids:
                if sid not in syntax_ids:
                    errors.append(f"Mapping '{mid}' references non-existent target_syntax_id '{sid}'.")

            level = m.get("equivalence_level")
            if level not in VALID_EQUIVALENCE_LEVELS:
                errors.append(
                    f"Mapping '{mid}' has invalid equivalence_level '{level}'. Must be in {VALID_EQUIVALENCE_LEVELS}."
                )

            # Verification rule (Principle 5 & 6)
            v_status = m.get("verification_status", "draft")
            if v_status not in VALID_STATUSES:
                errors.append(f"Mapping '{mid}' has invalid verification_status '{v_status}'.")

            if v_status == "verified":
                m_sources = m.get("source_ids") or []
                if not m_sources:
                    errors.append(f"Verified Mapping '{mid}' must have at least one valid source in 'source_ids'.")
                for ref_sid in m_sources:
                    if ref_sid not in source_ids:
                        errors.append(f"Mapping '{mid}' references non-existent source_id '{ref_sid}'.")

                if level == "conditional" and not m.get("conditions"):
                    errors.append(f"Conditional Mapping '{mid}' must explicitly specify 'conditions'.")

        return len(errors) == 0, errors
