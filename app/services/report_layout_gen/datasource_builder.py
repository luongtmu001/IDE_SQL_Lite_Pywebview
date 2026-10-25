# -*- coding: utf-8 -*-
"""
Datasource Builder: Generates Bravo report_datasource.xml from routine name and parameters.
"""
from typing import Any, Dict, List, Optional
import xml.etree.ElementTree as ET

from app.bravo.xml_codec import beautify_xml_string, validate_xml_syntax

# Standard Bravo default expressions for common parameters
STANDARD_DEFAULT_EXPRESSIONS: Dict[str, str] = {
    "nUserId": "USER('Id')",
    "UserId": "USER('Id')",
    "LangId": "LANGID()",
    "nLangId": "LANGID()",
}


def build_report_datasource_xml(
    routine_name: str,
    input_params: Optional[List[Dict[str, Any]]] = None,
    custom_defaults: Optional[Dict[str, str]] = None,
) -> str:
    """
    Build Bravo report_datasource.xml structure:
    <root>
        <Command>routine_name</Command>
        <TableCollection>
            <ParametersTable>
                <DefaultValues>
                    <param>expr</param>
                </DefaultValues>
            </ParametersTable>
        </TableCollection>
    </root>
    """
    input_params = input_params or []
    custom_defaults = custom_defaults or {}

    root = ET.Element("root")
    cmd_el = ET.SubElement(root, "Command")
    cmd_el.text = routine_name

    table_coll = ET.SubElement(root, "TableCollection")
    params_table = ET.SubElement(table_coll, "ParametersTable")
    default_vals = ET.SubElement(params_table, "DefaultValues")

    # Map defaults
    for param in input_params:
        p_name = param.get("name", "").lstrip("@")
        if not p_name:
            continue

        expr = custom_defaults.get(p_name) or param.get("default_expr") or STANDARD_DEFAULT_EXPRESSIONS.get(p_name)
        if expr:
            p_node = ET.SubElement(default_vals, p_name)
            p_node.text = expr

    # If no parameters had defaults but custom defaults were supplied directly:
    for k, v in custom_defaults.items():
        if default_vals.find(k) is None:
            p_node = ET.SubElement(default_vals, k)
            p_node.text = v

    raw_xml = ET.tostring(root, encoding="utf-8").decode("utf-8")
    pretty_xml = beautify_xml_string(raw_xml)
    valid, err = validate_xml_syntax(pretty_xml)
    if not valid:
        raise ValueError(f"Generated datasource XML failed syntax validation: {err}")

    return pretty_xml
