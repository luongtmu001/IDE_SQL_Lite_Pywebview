# -*- coding: utf-8 -*-
"""
Application API layer: modular domain mixins for pywebview desktop bridges.
"""
from app.api.connections_api import ConnectionsApiMixin
from app.api.designer_api import DesignerApiMixin
from app.api.history_api import HistoryApiMixin
from app.api.metadata_api import MetadataApiMixin, MainMetadataApiMixin
from app.api.profiler_api import ProfilerApiMixin
from app.api.query_api import QueryApiMixin
from app.api.session_api import SessionApiMixin
from app.api.settings_api import SettingsApiMixin
from app.api.table_editor_api import TableEditorApiMixin
from app.api.activity_api import ActivityApiMixin
from app.api.schema_compare_api import SchemaCompareApiMixin
from app.api.google_sheets_api import GoogleSheetsApiMixin
from app.api.syntax_catalog_api import SyntaxCatalogApiMixin
from app.api.report_gen_api import ReportGenApiMixin

__all__ = [
    "ActivityApiMixin",
    "ConnectionsApiMixin",
    "DesignerApiMixin",
    "GoogleSheetsApiMixin",
    "HistoryApiMixin",
    "MetadataApiMixin",
    "MainMetadataApiMixin",
    "ProfilerApiMixin",
    "QueryApiMixin",
    "ReportGenApiMixin",
    "SchemaCompareApiMixin",
    "SessionApiMixin",
    "SettingsApiMixin",
    "SyntaxCatalogApiMixin",
    "TableEditorApiMixin",
]
