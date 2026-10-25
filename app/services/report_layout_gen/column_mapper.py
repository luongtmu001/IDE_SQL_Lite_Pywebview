# -*- coding: utf-8 -*-
"""
Column Mapper: Applies DB routine column mappings to Bravo layout XML.
Supports tag renaming (mode='rename') or adding <Name> (mode='name_tag'),
and adding invisible auxiliary columns (<Visible>False</Visible>).
"""
from typing import Dict, List, Literal, Optional, Tuple
import xml.etree.ElementTree as ET

from app.bravo.xml_codec import beautify_xml_string, validate_xml_syntax

MappingMode = Literal["rename", "name_tag"]


def apply_column_mapping(
    layout_xml: str,
    mapping: Dict[str, str],
    data_member: Optional[str] = None,
    mode: MappingMode = "name_tag",
    unmapped_columns: Optional[List[str]] = None,
    param_mappings: Optional[Dict[str, str]] = None,
) -> Tuple[str, List[str]]:
    """
    Apply column mappings to an existing layout XML string.
    - mapping: e.g. {'Col_A': 'BuiltinOrder', 'Col_B': 'ItemName'}
    - data_member: e.g. 'Table0' or 'Table2'
    - mode: 'rename' (replaces <Col_A> with <BuiltinOrder>) or 'name_tag' (<Col_A><Name>BuiltinOrder</Name>)
    - unmapped_columns: list of DB columns to append with <Visible>False</Visible>
    - param_mappings: dict of {'Column_0': '@_DeptName', 'Bộ phận': '@_DeptName'} for Title and Summary bands
    Returns (new_layout_xml, warnings).
    """
    warnings: List[str] = []
    if not layout_xml or not layout_xml.strip():
        return layout_xml, ["Layout XML is empty."]

    try:
        root = ET.fromstring(layout_xml.strip())
    except ET.ParseError as err:
        return layout_xml, [f"Invalid input XML: {err}"]

    # 1. Update DataMember if specified
    if data_member:
        dm_node = root.find(".//Report_0/DataMember")
        if dm_node is not None:
            dm_node.text = data_member
        else:
            rep_node = root.find(".//Report_0")
            if rep_node is not None:
                new_dm = ET.Element("DataMember")
                new_dm.text = data_member
                rep_node.insert(0, new_dm)

    # 2. Update columns in <Content><Cols>
    cols_container = root.find(".//Content/Cols")
    if cols_container is not None:
        # 2. Update columns in <Content><Cols>
        for col_el in list(cols_container):
            orig_tag = col_el.tag

            # If column is in unmapped_columns (unchecked/ignored by user), set <Visible>False</Visible>
            if unmapped_columns and (orig_tag in unmapped_columns or f"Col_{orig_tag}" in unmapped_columns or orig_tag.replace("Col_", "") in unmapped_columns):
                vis_el = col_el.find("Visible")
                if vis_el is None:
                    vis_el = ET.Element("Visible")
                    col_el.insert(0, vis_el)
                vis_el.text = "False"

            target_name = mapping.get(orig_tag) or mapping.get(orig_tag.replace("Col_", ""))
            if not target_name or not target_name.strip():
                # If cleared by user
                if mode == "name_tag":
                    existing_name = col_el.find("Name")
                    if existing_name is not None:
                        col_el.remove(existing_name)
                continue

            clean_target = target_name.strip()

            if mode == "name_tag":
                # User rule: Nếu được chọn cột map thì thêm thẻ con <Name>tên cột</Name> bên dưới cột đó
                name_el = col_el.find("Name")
                if name_el is None:
                    name_el = ET.Element("Name")
                    col_el.insert(0, name_el)
                name_el.text = clean_target
            elif mode == "rename":
                sanitized = "".join(c if (c.isalnum() or c == "_") else "_" for c in clean_target)
                if not sanitized or sanitized[0].isdigit():
                    sanitized = f"Col_{sanitized}"
                col_el.tag = sanitized

        # 3. Append unmapped auxiliary columns from DB if requested
        if unmapped_columns:
            for unmapped_col in unmapped_columns:
                sanitized_unmapped = "".join(c if (c.isalnum() or c == "_") else "_" for c in unmapped_col)
                if not sanitized_unmapped or sanitized_unmapped[0].isdigit():
                    sanitized_unmapped = f"Col_{sanitized_unmapped}"

                # Only add if not already present under either tag
                existing = cols_container.find(sanitized_unmapped)
                if existing is None:
                    existing = cols_container.find(unmapped_col)
                if existing is None:
                    hidden_col = ET.SubElement(cols_container, sanitized_unmapped)
                    ET.SubElement(hidden_col, "Visible").text = "False"
                    rows_el = ET.SubElement(hidden_col, "Rows")
                    r0 = ET.SubElement(rows_el, "Row_0")
                    text_el = ET.SubElement(r0, "Text")
                    ET.SubElement(text_el, "Vietnamese").text = unmapped_col

    # 4. Replace output parameter placeholders in Title and Summary
    if param_mappings:
        for band_tag in ("Title", "Summary"):
            band_el = root.find(f".//{band_tag}")
            if band_el is None:
                continue
            for col_el in band_el.findall(".//Cols/*"):
                col_tag = col_el.tag
                for row_el in col_el.findall(".//Rows/*"):
                    row_tag = row_el.tag
                    for text_node in row_el.findall(".//Text/*"):
                        current_text = (text_node.text or "").strip()
                        current_clean = current_text.rstrip(":：").strip()
                        target_param = (
                            param_mappings.get(f"{band_tag.lower()}::{row_tag}::{col_tag}")
                            or param_mappings.get(f"{row_tag}::{col_tag}")
                            or param_mappings.get(f"{band_tag.lower()}::{row_tag}::{col_tag}::{current_text}")
                            or param_mappings.get(f"{band_tag.lower()}::{row_tag}::{col_tag}::{current_clean}")
                            or param_mappings.get(f"{band_tag.lower()}::{current_text}")
                            or param_mappings.get(f"{band_tag.lower()}::{current_clean}")
                            or param_mappings.get(current_text)
                            or param_mappings.get(current_clean)
                            or param_mappings.get(f"{band_tag.lower()}::{col_tag}")
                            or param_mappings.get(col_tag)
                        )
                        if target_param:
                            p_clean = target_param.strip()
                            if p_clean.startswith("{=") and p_clean.endswith("}"):
                                text_node.text = p_clean
                            else:
                                if not p_clean.startswith("@"):
                                    p_clean = f"@{p_clean}"
                                text_node.text = f"{{={p_clean}}}"

    raw_xml = ET.tostring(root, encoding="utf-8").decode("utf-8")
    pretty_xml = beautify_xml_string(raw_xml)
    valid, err = validate_xml_syntax(pretty_xml)
    if not valid:
        warnings.append(f"XML validation warning after mapping: {err}")

    return pretty_xml, warnings

