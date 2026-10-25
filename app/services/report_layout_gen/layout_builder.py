# -*- coding: utf-8 -*-
"""
Layout builder: Converts SheetModel and Regions into Bravo report_layout.xml.
"""
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional, Tuple

from app.bravo.xml_codec import beautify_xml_string, validate_xml_syntax
from .models import MergeRange, Region, SheetModel, col_idx_to_letter
from .userdata import UserDataGenerator


def escape_cdata_or_text(val: Optional[str]) -> str:
    """Return string value or empty string for XML text."""
    if val is None:
        return ""
    return str(val)


def ensure_merge_userdata(merge: MergeRange, userdata_gen: UserDataGenerator) -> str:
    """Assign an 8-char UserData ID to a merge range if not already assigned."""
    if not merge.user_data:
        merge.user_data = userdata_gen.new_id()
    return merge.user_data


def build_content(
    sheet: SheetModel,
    header_region: Region,
    userdata_gen: UserDataGenerator,
    col_mapping: Optional[Dict[str, str]] = None,
    warnings: Optional[List[str]] = None,
) -> ET.Element:
    """
    Build <Content> band representing report detail/table header.
    Maps header_region rows to <Rows> and columns to <Cols>.
    """
    if warnings is None:
        warnings = []
    col_mapping = col_mapping or {}

    content_el = ET.Element("Content")

    # 1. <Rows>
    rows_el = ET.SubElement(content_el, "Rows")
    num_rows = header_region.max_row - header_region.min_row + 1
    for r_idx in range(num_rows):
        excel_row = header_region.min_row + r_idx
        row_el = ET.SubElement(rows_el, f"Row_{r_idx}")
        h_el = ET.SubElement(row_el, "Height")
        h_el.text = str(sheet.row_heights_px.get(excel_row, 24))

    # 2. <Cols>
    cols_el = ET.SubElement(content_el, "Cols")

    for col in range(header_region.min_col, header_region.max_col + 1):
        col_letter = col_idx_to_letter(col)
        default_tag = f"Col_{col_letter}"
        tag_name = col_mapping.get(default_tag, default_tag)

        # XML tags cannot contain invalid characters
        sanitized_tag = "".join(c if (c.isalnum() or c == "_") else "_" for c in tag_name)
        if not sanitized_tag or sanitized_tag[0].isdigit():
            sanitized_tag = f"Col_{sanitized_tag}"

        col_el = ET.SubElement(cols_el, sanitized_tag)

        # <Width>
        width_el = ET.SubElement(col_el, "Width")
        width_el.text = str(sheet.col_widths_px.get(col, 80))

        # <Rows> inside column
        col_rows_el = ET.SubElement(col_el, "Rows")

        for r_idx in range(num_rows):
            excel_row = header_region.min_row + r_idx
            cell = sheet.get_cell(excel_row, col)

            cell_row_el = ET.Element(f"Row_{r_idx}")
            has_content = False

            if cell and cell.merge:
                # Merge cell
                uid = ensure_merge_userdata(cell.merge, userdata_gen)
                if cell.is_anchor:
                    if cell.value:
                        text_el = ET.SubElement(cell_row_el, "Text")
                        vn_el = ET.SubElement(text_el, "Vietnamese")
                        vn_el.text = escape_cdata_or_text(cell.value)
                    style_el = ET.SubElement(cell_row_el, "Style")
                    style_el.text = f"UserData:{uid};"
                    has_content = True
                else:
                    # Non-anchor cell in merge: only UserData style
                    style_el = ET.SubElement(cell_row_el, "Style")
                    style_el.text = f"UserData:{uid};"
                    has_content = True
            elif cell and cell.value:
                # Standalone cell with text
                text_el = ET.SubElement(cell_row_el, "Text")
                vn_el = ET.SubElement(text_el, "Vietnamese")
                vn_el.text = escape_cdata_or_text(cell.value)
                has_content = True

            # In Content, all rows are emitted to preserve grid structure
            col_rows_el.append(cell_row_el)

    return content_el


def build_band(
    sheet: SheetModel,
    region: Region,
    tag_name: str,
    userdata_gen: UserDataGenerator,
    warnings: Optional[List[str]] = None,
) -> ET.Element:
    """
    Build common section band (<Title>, <Summary>, or <PageFooter>).
    """
    if warnings is None:
        warnings = []

    band_el = ET.Element(tag_name)
    ET.SubElement(band_el, "autoFitRowHeight").text = "None"

    # 1. <Rows>
    rows_el = ET.SubElement(band_el, "Rows")
    num_rows = region.max_row - region.min_row + 1
    for r_idx in range(num_rows):
        excel_row = region.min_row + r_idx
        row_el = ET.SubElement(rows_el, f"Row_{r_idx}")
        h_el = ET.SubElement(row_el, "Height")
        h_el.text = str(sheet.row_heights_px.get(excel_row, 20))

    # 2. Find widest column to set <Width>-1</Width> (auto-expand)
    widest_col = region.min_col
    max_w = -1
    for col in range(region.min_col, region.max_col + 1):
        w = sheet.col_widths_px.get(col, 80)
        if w > max_w:
            max_w = w
            widest_col = col

    # 3. <Cols>
    cols_el = ET.SubElement(band_el, "Cols")
    num_cols = region.max_col - region.min_col + 1

    for c_idx in range(num_cols):
        excel_col = region.min_col + c_idx
        col_el = ET.SubElement(cols_el, f"Column_{c_idx}")

        width_el = ET.SubElement(col_el, "Width")
        if excel_col == widest_col:
            width_el.text = "-1"
        else:
            width_el.text = str(sheet.col_widths_px.get(excel_col, 80))

        col_rows_el = ET.SubElement(col_el, "Rows")

        for r_idx in range(num_rows):
            excel_row = region.min_row + r_idx
            cell = sheet.get_cell(excel_row, excel_col)

            if not cell:
                continue

            # In bands, only emit Row_i if cell has text or is in a merge
            if cell.merge:
                uid = ensure_merge_userdata(cell.merge, userdata_gen)
                cell_row_el = ET.SubElement(col_rows_el, f"Row_{r_idx}")
                if cell.is_anchor:
                    text_el = ET.SubElement(cell_row_el, "Text")
                    vn_el = ET.SubElement(text_el, "Vietnamese")
                    vn_el.text = escape_cdata_or_text(cell.value)
                style_el = ET.SubElement(cell_row_el, "Style")
                style_el.text = f"UserData:{uid};"
            elif cell.value:
                cell_row_el = ET.SubElement(col_rows_el, f"Row_{r_idx}")
                text_el = ET.SubElement(cell_row_el, "Text")
                vn_el = ET.SubElement(text_el, "Vietnamese")
                vn_el.text = escape_cdata_or_text(cell.value)

    return band_el


def build_print_settings(sheet: SheetModel) -> ET.Element:
    """Build <PrintSettings> element from SheetModel page setup."""
    ps_el = ET.Element("PrintSettings")
    page = sheet.page or {}

    paper_size = page.get("paper_size", 9)
    orientation = page.get("orientation", "portrait")
    margins = page.get("margins", {})

    ET.SubElement(ps_el, "PaperSize").text = str(paper_size)
    ET.SubElement(ps_el, "Landscape").text = "True" if orientation == "landscape" else "False"

    # Margins in 96 DPI px: inches * 96
    m_left = int(float(margins.get("left", 0.7)) * 96)
    m_right = int(float(margins.get("right", 0.7)) * 96)
    m_top = int(float(margins.get("top", 0.75)) * 96)
    m_bottom = int(float(margins.get("bottom", 0.75)) * 96)

    margins_el = ET.SubElement(ps_el, "Margins")
    margins_el.set("Left", str(m_left))
    margins_el.set("Right", str(m_right))
    margins_el.set("Top", str(m_top))
    margins_el.set("Bottom", str(m_bottom))

    return ps_el


def build_report_layout_xml(
    sheet: SheetModel,
    regions: List[Region],
    data_member: str = "Table0",
    userdata_gen: Optional[UserDataGenerator] = None,
    col_mapping: Optional[Dict[str, str]] = None,
) -> Tuple[str, List[str]]:
    """
    Build full report_layout.xml from SheetModel and designated Regions.
    Returns (beautified_xml_string, warnings_list).
    """
    warnings: List[str] = []
    gen = userdata_gen or UserDataGenerator()

    # Index regions by kind
    reg_by_kind: Dict[str, Region] = {r.kind: r for r in regions}

    # Root hierarchy
    root = ET.Element("root")
    panel_reporter = ET.SubElement(root, "panelReporter")
    controls = ET.SubElement(panel_reporter, "Controls")
    report_0 = ET.SubElement(controls, "Report_0")

    # DataMember
    dm_el = ET.SubElement(report_0, "DataMember")
    dm_el.text = data_member

    # ReportSetup
    report_setup = ET.SubElement(report_0, "ReportSetup")
    ET.SubElement(report_setup, "bAutoCompanyTitle").text = "False"

    # Title band (<Title>)
    title_reg = reg_by_kind.get("title")
    if title_reg:
        report_0.append(build_band(sheet, title_reg, "Title", gen, warnings))

    # Content band (<Content>)
    content_reg = reg_by_kind.get("header") or reg_by_kind.get("content")
    if content_reg:
        report_0.append(build_content(sheet, content_reg, gen, col_mapping, warnings))

    # Summary band (<Summary>)
    summary_reg = reg_by_kind.get("summary")
    if summary_reg:
        report_0.append(build_band(sheet, summary_reg, "Summary", gen, warnings))

    # PageFooter band (<PageFooter>)
    page_footer_reg = reg_by_kind.get("page_footer")
    if page_footer_reg:
        report_0.append(build_band(sheet, page_footer_reg, "PageFooter", gen, warnings))

    # PrintSettings
    report_0.append(build_print_settings(sheet))

    # Trailer flags
    ET.SubElement(report_0, "bAutoHideEmptyAutoTextRows").text = "False"

    # Serialize
    raw_xml = ET.tostring(root, encoding="utf-8").decode("utf-8")
    pretty_xml = beautify_xml_string(raw_xml)

    # Validate
    valid, err = validate_xml_syntax(pretty_xml)
    if not valid:
        warnings.append(f"Generated XML syntax validation warning: {err}")

    return pretty_xml, warnings
