# -*- coding: utf-8 -*-
"""
DTO and Domain Models for Cross-Database Syntax Reference & Compare.
Represents Concepts, Syntax Entries, Mappings, Sources, and Catalog Manifest.
"""
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any


VALID_DATABASES = {"postgresql", "sqlserver"}
VALID_EQUIVALENCE_LEVELS = {
    "equivalent",
    "conditional",
    "rewrite_required",
    "no_direct_equivalent",
    "related",
}
VALID_STATUSES = {"draft", "verified", "deprecated", "needs_review"}


@dataclass
class SourceEntry:
    """
    Official documentation source or verified specification.
    """
    id: str
    database: str                           # 'postgresql' | 'sqlserver'
    title: str                              # Document/Topic title
    url: str                                # Deep link to official docs
    documentation_version: str              # e.g. 'PostgreSQL 16' | 'SQL Server 2022 / Azure SQL'
    product_version: str                    # Supported product version range
    section: str                            # Section name or anchor
    retrieved_at: str                       # YYYY-MM-DD
    last_checked_at: str                    # YYYY-MM-DD
    source_type: str = "official_documentation" # 'official_documentation' | 'release_notes' | 'standard'
    content_hash: Optional[str] = None
    status: str = "active"                  # 'active' | 'deprecated' | 'archived'

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SyntaxEntry:
    """
    Specific syntax construct, keyword, or operator for a database engine.
    """
    id: str
    database: str                           # 'postgresql' | 'sqlserver'
    syntax: str                             # Actual syntax pattern or operator (e.g. 'LEFT JOIN LATERAL', '~~*')
    display_name: str                       # Clean display name (e.g. 'ILIKE (Case-Insensitive Match)')
    category: str                           # 'query', 'string', 'json', 'paging', 'aggregate', etc.
    description: str                        # Explanation of purpose and syntax rules
    context: str = "Mệnh đề SQL"            # Context of usage (e.g. 'FROM clause', 'WHERE clause', 'SELECT list')
    version_min: Optional[str] = None       # Minimum engine version (e.g. '9.3', '2005')
    version_max: Optional[str] = None       # Maximum engine version if deprecated/removed
    aliases: List[str] = field(default_factory=list) # Alternate aliases or internal operators (e.g. ['~~'] for LIKE)
    examples: List[Dict[str, str]] = field(default_factory=list) # [{'title': '...', 'sql': '...', 'explanation': '...'}]
    gotchas: List[str] = field(default_factory=list) # Edge cases, behavioral gotchas, limitations
    source_ids: List[str] = field(default_factory=list) # References to SourceEntry IDs
    status: str = "verified"                # 'verified' | 'draft' | 'needs_review' | 'deprecated'
    is_exclusive: bool = False              # True if this syntax is exclusive to this database engine
    workaround: Optional[str] = None        # Workaround or alternative approach for other engines
    ai_insights: Optional[str] = None       # AI architectural guidance, performance & migration tips
    updated_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class MappingEntry:
    """
    Cross-database or intra-database relationship between syntax entries.
    Explicitly documents equivalence level, conditions, and limitations.
    """
    id: str
    concept_id: str                         # Reference to Concept ID
    source_syntax_ids: List[str]            # SyntaxEntry IDs for source engine
    target_syntax_ids: List[str]            # SyntaxEntry IDs for target engine
    equivalence_level: str                  # 'equivalent' | 'conditional' | 'rewrite_required' | 'no_direct_equivalent' | 'related'
    conditions: str                         # Preconditions or rules when mapping is valid
    limitations: str                        # Incompatibilities, performance caveats, edge cases
    notes: str                              # Additional engineering remarks
    verification_status: str = "verified"   # 'verified' | 'draft' | 'needs_review'
    verified_by: str = "LLTool Architecture Team"
    verified_at: str = "2026-10-22"
    source_ids: List[str] = field(default_factory=list) # References to SourceEntry IDs
    comparison_examples: List[Dict[str, str]] = field(default_factory=list) # [{'postgresql': '...', 'sqlserver': '...', 'notes': '...'}]
    updated_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Concept:
    """
    Engine-agnostic database concept or query objective.
    """
    id: str
    name: str                               # Descriptive title (e.g. 'Lateral Subquery Correlation')
    category: str                           # 'query', 'string', 'json', 'paging', 'aggregate', etc.
    description: str                        # Conceptual explanation
    search_terms: List[str] = field(default_factory=list) # Synonyms and search keywords
    status: str = "verified"                # 'verified' | 'draft' | 'deprecated' | 'needs_review'
    updated_at: str = "2026-10-22"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CatalogManifest:
    """
    Metadata and version declaration for the syntax catalog.
    """
    catalog_version: str                    # Semantic version, e.g. '1.0.0'
    schema_version: str                     # e.g. '1.0'
    updated_at: str                         # YYYY-MM-DD
    supported_databases: List[str] = field(default_factory=lambda: ["postgresql", "sqlserver"])
    description: str = "Cross-Database Syntax Reference and Comparison Catalog"
    total_concepts: int = 0
    total_syntax_entries: int = 0
    total_mappings: int = 0
    total_sources: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
