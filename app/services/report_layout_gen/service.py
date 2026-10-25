# -*- coding: utf-8 -*-
"""
ReportLayoutGenService: Orchestrator service for Report Layout Generation Wizard.
Coordinates between workbook reader, region detector, layout builder, column mapper, and datasource builder.
"""
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from .column_mapper import apply_column_mapping
from .datasource_builder import build_report_datasource_xml
from .gsheet_importer import fetch_gsheet_xlsx
from .layout_builder import build_report_layout_xml
from .layout_reader import (
    extract_band_items,
    extract_columns,
    extract_columns_detailed,
    extract_output_param_placeholders,
)
from .models import GenSession, Region, ResultShape, SheetModel
from .region_detector import detect_suggested_regions
from .result_shape import get_detector
from .session_store import SessionStore, get_session_store
from .userdata import UserDataGenerator
from .workbook_reader import list_sheets, read_sheet

logger = logging.getLogger("app.services.report_layout_gen.service")


class ReportLayoutGenService:
    """Core coordinator service for generating Bravo report_layout.xml and report_datasource.xml."""

    def __init__(self, session_store: Optional[SessionStore] = None, connection_manager: Optional[Any] = None):
        self.session_store = session_store or get_session_store()
        self.connection_manager = connection_manager

    def open_file(self, file_content: Union[str, Path, bytes], filename: Optional[str] = None) -> Dict[str, Any]:
        """Upload or open an Excel file, creating a new wizard session."""
        session = self.session_store.create_multi_file_session([{"content": file_content, "filename": filename}])
        active_f = session.get_active_file()
        sheets = active_f.sheets if active_f else []
        return {
            "session_id": session.id,
            "sheets": sheets,
            "files": [f.to_dict() for f in session.files],
            "active_file_id": session.active_file_id,
        }

    def open_files(self, files_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Upload or open multiple Excel files in a single session."""
        session = self.session_store.create_multi_file_session(files_data)
        active_f = session.get_active_file()
        return {
            "session_id": session.id,
            "files": [f.to_dict() for f in session.files],
            "active_file_id": session.active_file_id,
            "sheets": active_f.sheets if active_f else [],
        }

    def add_files(self, session_id: str, files_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Add more Excel files to an active session."""
        session = self.session_store.add_files_to_session(session_id, files_data)
        if not session:
            raise ValueError(f"Session '{session_id}' not found.")
        active_f = session.get_active_file()
        return {
            "session_id": session.id,
            "files": [f.to_dict() for f in session.files],
            "active_file_id": session.active_file_id,
            "sheets": active_f.sheets if active_f else [],
        }

    def remove_file(self, session_id: str, file_id: str) -> Dict[str, Any]:
        """Remove an Excel file from an active session."""
        session = self.session_store.remove_file_from_session(session_id, file_id)
        if not session:
            raise ValueError(f"Session '{session_id}' not found.")
        active_f = session.get_active_file()
        return {
            "session_id": session.id,
            "files": [f.to_dict() for f in session.files],
            "active_file_id": session.active_file_id,
            "sheets": active_f.sheets if active_f else [],
        }

    def select_file(self, session_id: str, file_id: str) -> Dict[str, Any]:
        """Switch active Excel file in session to configure its layout."""
        file_info = self.session_store.set_active_file(session_id, file_id)
        if not file_info:
            raise ValueError(f"File '{file_id}' not found in session '{session_id}'.")
        session = self._require_session(session_id)
        return {
            "session_id": session.id,
            "active_file_id": file_info.id,
            "filename": file_info.filename,
            "sheets": file_info.sheets,
            "selected_sheet": session.sheet,
            "regions": [r.to_dict() for r in session.regions],
            "files": [f.to_dict() for f in session.files],
        }

    def open_gsheet(self, url: str) -> Dict[str, Any]:
        """Download remote Google Sheet as xlsx and initialize a wizard session."""
        xlsx_bytes, target_gid = fetch_gsheet_xlsx(url)
        session = self.session_store.create_session(xlsx_bytes, filename="google_sheet.xlsx")
        sheets = list_sheets(session.workbook_path)
        return {
            "session_id": session.id,
            "sheets": sheets,
            "target_gid": target_gid,
        }

    def get_sheet(self, session_id: str, sheet_name: Optional[str] = None) -> Dict[str, Any]:
        """Read sheet model, preview data, and suggest initial regions."""
        session = self._require_session(session_id)
        if isinstance(sheet_name, dict):
            sheet_name = sheet_name.get("name")
        if isinstance(session.sheet, dict):
            session.sheet = session.sheet.get("name")
        sheet_key = str(sheet_name or session.sheet or "default")
        file_id = session.active_file_id
        sheet_model = self.session_store.get_cached_sheet(session_id, sheet_key, file_id=file_id)
        if sheet_model is None:
            sheet_model = read_sheet(session.workbook_path, sheet_name=sheet_name)
            self.session_store.cache_sheet(session_id, sheet_key, sheet_model, file_id=file_id)
            if sheet_model.name:
                self.session_store.cache_sheet(session_id, sheet_model.name, sheet_model, file_id=file_id)

        session.sheet = sheet_model.name
        self.session_store.save_session(session)

        suggested = detect_suggested_regions(sheet_model)
        return {
            "sheet": sheet_model.to_preview_dict(max_rows=500, max_cols=100),
            "suggested_regions": [r.to_dict() for r in suggested],
        }

    def set_regions(
        self,
        session_id: str,
        regions_data: List[Dict[str, Any]],
        sheet_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Set report regions and generate preliminary layout XML."""
        session = self._require_session(session_id)
        if sheet_name:
            session.sheet = str(sheet_name)
        elif isinstance(session.sheet, dict):
            session.sheet = session.sheet.get("name")
        sheet_key = str(session.sheet or "default")
        file_id = session.active_file_id
        sheet_model = self.session_store.get_cached_sheet(session_id, sheet_key, file_id=file_id)
        if sheet_model is None:
            sheet_model = read_sheet(session.workbook_path, sheet_name=session.sheet)
            self.session_store.cache_sheet(session_id, sheet_key, sheet_model, file_id=file_id)
            if sheet_model.name:
                self.session_store.cache_sheet(session_id, sheet_model.name, sheet_model, file_id=file_id)

        regions: List[Region] = []
        for rd in regions_data:
            if "range_str" in rd and rd["range_str"]:
                regions.append(Region.from_range_string(rd["kind"], rd["range_str"]))
            else:
                regions.append(Region(
                    kind=rd["kind"],
                    min_row=int(rd["min_row"]),
                    min_col=int(rd["min_col"]),
                    max_row=int(rd["max_row"]),
                    max_col=int(rd["max_col"]),
                ))

        session.regions = regions
        active_f = session.get_active_file()
        if active_f:
            active_f.regions = list(regions)
        if session.sheet:
            session.sheet_regions[session.sheet] = list(regions)
            if active_f:
                active_f.sheet_regions[session.sheet] = list(regions)

        xml_out, warnings = build_report_layout_xml(
            sheet=sheet_model,
            regions=regions,
            data_member=session.data_member or "Table0",
        )
        session.layout_xml = xml_out
        if session.sheet:
            session.sheet_layouts[session.sheet] = xml_out
        self.session_store.save_session(session)

        columns = extract_columns(xml_out)
        detailed_columns = extract_columns_detailed(xml_out)
        title_items = extract_band_items(xml_out, "Title")
        summary_items = extract_band_items(xml_out, "Summary")
        placeholders = extract_output_param_placeholders(xml_out)

        return {
            "layout_xml": xml_out,
            "columns": columns,
            "detailed_columns": detailed_columns,
            "title_items": title_items,
            "summary_items": summary_items,
            "output_placeholders": placeholders,
            "warnings": warnings,
            "sheet": session.sheet,
        }

    def list_routines(
        self,
        connection_id: str,
        schema: Optional[str] = None,
        search: Optional[str] = None,
        database: Optional[str] = None,
        owner_session_id: str = "main",
    ) -> List[Dict[str, Any]]:
        """List routines available on the specified database connection."""
        if not self.connection_manager:
            raise ValueError("ConnectionManager chưa được cấu hình cho ReportLayoutGenService.")
        detector = get_detector(self.connection_manager, connection_id, owner_session_id=owner_session_id)
        return detector.list_routines(schema=schema, search=search, database=database)

    def describe_routine(
        self,
        session_id: str,
        connection_id: str,
        routine_name: str,
        schema: Optional[str] = None,
        database: Optional[str] = None,
        owner_session_id: str = "main",
    ) -> Dict[str, Any]:
        """Statically inspect routine schema without executing it."""
        session = self._require_session(session_id)
        if not self.connection_manager:
            raise ValueError("ConnectionManager chưa được cấu hình cho ReportLayoutGenService.")

        detector = get_detector(self.connection_manager, connection_id, owner_session_id=owner_session_id)
        shape = detector.describe_routine(routine_name=routine_name, schema=schema, database=database)

        session.connection_id = connection_id
        session.routine = {"name": routine_name, "schema": schema, "database": database}
        session.shape = shape
        self.session_store.save_session(session)

        return shape.to_dict()

    def apply_mapping(
        self,
        session_id: str,
        data_member: str,
        mapping: Dict[str, str],
        mode: str = "name_tag",
        unmapped_columns: Optional[List[str]] = None,
        sheet_name: Optional[str] = None,
        param_mappings: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Apply column mappings from DB routine to the layout XML."""
        session = self._require_session(session_id)
        target_xml = None
        if sheet_name and sheet_name in session.sheet_layouts:
            target_xml = session.sheet_layouts[sheet_name]
        else:
            target_xml = session.layout_xml

        if not target_xml:
            raise ValueError("Chưa tạo layout XML. Vui lòng xác nhận vùng trước khi map cột.")

        updated_xml, warnings = apply_column_mapping(
            layout_xml=target_xml,
            mapping=mapping,
            data_member=data_member,
            mode=mode,  # type: ignore
            unmapped_columns=unmapped_columns,
            param_mappings=param_mappings,
        )

        session.layout_xml = updated_xml
        if sheet_name:
            session.sheet_layouts[sheet_name] = updated_xml
        session.data_member = data_member
        session.mapping.update(mapping)
        self.session_store.save_session(session)

        return {
            "layout_xml": updated_xml,
            "warnings": warnings,
            "sheet": sheet_name or session.sheet,
        }

    def build(self, session_id: str) -> Dict[str, Any]:
        """Finalize and return both layout_xml and datasource_xml."""
        session = self._require_session(session_id)
        if not session.layout_xml:
            raise ValueError("Chưa tạo layout XML.")

        datasource_xml = None
        if session.routine and session.routine.get("name"):
            r_name = session.routine["name"]
            input_params = session.shape.input_params if session.shape else []
            datasource_xml = build_report_datasource_xml(
                routine_name=r_name,
                input_params=input_params,
            )
            session.datasource_xml = datasource_xml
            self.session_store.save_session(session)

        return {
            "layout_xml": session.layout_xml,
            "datasource_xml": session.datasource_xml,
            "sheet_layouts": session.sheet_layouts,
        }

    def save_files(self, session_id: str, target_folder: str) -> Dict[str, Any]:
        """Save generated XML files to a folder on disk."""
        session = self._require_session(session_id)
        folder = Path(target_folder)
        folder.mkdir(parents=True, exist_ok=True)

        saved = []
        layout_path = folder / "report_layout.xml"
        if session.layout_xml:
            layout_path.write_text(session.layout_xml, encoding="utf-8")
            saved.append("report_layout.xml")

        ds_path = folder / "report_datasource.xml"
        if session.datasource_xml:
            ds_path.write_text(session.datasource_xml, encoding="utf-8")
            saved.append("report_datasource.xml")

        for s_name, s_xml in session.sheet_layouts.items():
            if s_xml and s_xml != session.layout_xml:
                clean_s = "".join(c for c in s_name if c.isalnum() or c in ("-", "_")).strip() or "sheet"
                s_path = folder / f"report_layout_{clean_s}.xml"
                s_path.write_text(s_xml, encoding="utf-8")
                saved.append(s_path.name)

        return {
            "layout_path": str(layout_path) if session.layout_xml else None,
            "datasource_path": str(ds_path) if session.datasource_xml else None,
            "saved_files": saved,
        }

    def _require_session(self, session_id: str) -> GenSession:
        session = self.session_store.get_session(session_id)
        if not session:
            raise ValueError(f"Phiên làm việc '{session_id}' đã hết hạn hoặc không tồn tại.")
        return session
