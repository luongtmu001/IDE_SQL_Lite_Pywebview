# -*- coding: utf-8 -*-
"""
Syntax Catalog API Mixin.
Exposes Cross-Database Reference & Compare lookup methods to pywebview and frontend bridges.
"""
import logging
from typing import Any, Dict, List, Optional

from app.services.syntax_catalog.service import SyntaxCatalogService

logger = logging.getLogger("luobtool.api.syntax_catalog")


class SyntaxCatalogApiMixin:
    """API mixin for Cross-Database Syntax Reference & Compare."""

    def search_syntax_catalog(
        self,
        query: str = "",
        database: Optional[str] = None,
        category: Optional[str] = None,
        status: Optional[str] = None,
        is_exclusive: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Search syntax entries by keyword, operator, alias, or concept."""
        try:
            service = SyntaxCatalogService.get_instance()
            results = service.search_catalog(
                query=query, database=database, category=category, status=status, is_exclusive=is_exclusive
            )
            return {"success": True, "results": results, "total": len(results)}
        except Exception as exc:
            logger.exception("Error searching syntax catalog: %s", exc)
            return {"success": False, "error": str(exc), "results": [], "total": 0}

    def get_syntax_entry(self, syntax_id: str) -> Dict[str, Any]:
        """Retrieve single syntax entry detail by ID."""
        try:
            service = SyntaxCatalogService.get_instance()
            entry = service.get_syntax_entry(syntax_id)
            if not entry:
                return {"success": False, "error": f"Không tìm thấy mục cú pháp: {syntax_id}"}
            mappings = service.get_mappings_for_syntax(syntax_id)
            return {"success": True, "entry": entry, "mappings": mappings}
        except Exception as exc:
            logger.exception("Error getting syntax entry %s: %s", syntax_id, exc)
            return {"success": False, "error": str(exc)}

    def get_syntax_concept(self, concept_id: str) -> Dict[str, Any]:
        """Retrieve single concept and all its mappings."""
        try:
            service = SyntaxCatalogService.get_instance()
            concept = service.get_concept(concept_id)
            if not concept:
                return {"success": False, "error": f"Không tìm thấy concept: {concept_id}"}
            mappings = service.get_mappings_for_concept(concept_id)
            return {"success": True, "concept": concept, "mappings": mappings}
        except Exception as exc:
            logger.exception("Error getting concept %s: %s", concept_id, exc)
            return {"success": False, "error": str(exc)}

    def get_syntax_manifest(self) -> Dict[str, Any]:
        """Retrieve catalog metadata, version, and entity counts."""
        try:
            service = SyntaxCatalogService.get_instance()
            manifest = service.get_manifest()
            return {"success": True, "manifest": manifest}
        except Exception as exc:
            logger.exception("Error getting catalog manifest: %s", exc)
            return {"success": False, "error": str(exc)}

    def compare_syntax_selection(
        self,
        sql_text: str,
        source_db: str = "postgresql",
        target_db: str = "sqlserver",
    ) -> Dict[str, Any]:
        """Analyze SQL text selection and return recognized catalog mappings."""
        try:
            service = SyntaxCatalogService.get_instance()
            return service.compare_selection(
                sql_text=sql_text, source_db=source_db, target_db=target_db
            )
        except Exception as exc:
            logger.exception("Error comparing syntax selection: %s", exc)
            return {"success": False, "error": str(exc), "matched_concepts": []}

    def open_syntax_reference_window(
        self, initial_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Open or focus the Syntax Reference & Compare desktop subwindow."""
        try:
            from app.desktop.windows import open_syntax_reference_window as _open_win
            return _open_win(self, initial_filter=initial_filter)
        except Exception as exc:
            logger.exception("Error opening syntax reference window: %s", exc)
            return {"success": False, "error": str(exc)}

    def syntax_catalog_insert_to_editor(self, sql_content: str) -> Dict[str, Any]:
        """Insert SQL snippet into active editor of the main IDE window."""
        try:
            main_win = getattr(self, "window", None)
            if not main_win:
                return {"success": False, "error": "Main window is not available"}
            import json
            payload = json.dumps(sql_content or "")
            main_win.evaluate_js(
                f"if (window.AppEditor && typeof window.AppEditor.insertText === 'function') {{ "
                f"    window.AppEditor.insertText({payload}); "
                f"}} else if (window.editor && typeof window.editor.trigger === 'function') {{ "
                f"    var sel = window.editor.getSelection(); "
                f"    window.editor.executeEdits('syntax-catalog', [{{ range: sel, text: {payload}, forceMoveMarkers: true }}]); "
                f"}}"
            )
            return {"success": True}
        except Exception as exc:
            logger.exception("Error inserting SQL to main editor: %s", exc)
            return {"success": False, "error": str(exc)}

