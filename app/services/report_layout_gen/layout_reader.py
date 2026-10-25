# -*- coding: utf-8 -*-
"""
Layout Reader: Inspects generated Bravo layout XML.
Extracts column list and output parameter placeholders like {=@_DocNo}.
"""
import re
import xml.etree.ElementTree as ET
from typing import List, Set


def extract_columns_detailed(layout_xml: str) -> List[dict]:
    """Extract list of columns with their header text and tag."""
    if not layout_xml or not layout_xml.strip():
        return []
    try:
        root = ET.fromstring(layout_xml.strip())
        cols_container = root.find(".//Content/Cols")
        if cols_container is None:
            return []
        res = []
        for col in cols_container:
            tag = col.tag
            texts = []
            for t in col.findall(".//Text/Vietnamese"):
                if t.text and t.text.strip():
                    texts.append(t.text.strip())
            header_text = " - ".join(texts) if texts else tag
            width = col.findtext("Width") or "80"
            res.append({
                "name": tag,
                "header_text": header_text,
                "width": width,
            })
        return res
    except Exception:
        return []


def extract_band_items(layout_xml: str, band_name: str) -> List[dict]:
    """Extract text items from Title or Summary band."""
    if not layout_xml or not layout_xml.strip():
        return []
    try:
        root = ET.fromstring(layout_xml.strip())
        band = root.find(f".//{band_name}")
        if band is None:
            return []
        items = []
        for col in band.findall(".//Cols/*"):
            col_tag = col.tag
            for row in col.findall(".//Rows/*"):
                row_tag = row.tag
                txt = row.findtext(".//Text/Vietnamese")
                if txt and txt.strip():
                    items.append({
                        "col": col_tag,
                        "row": row_tag,
                        "text": txt.strip(),
                    })
        return items
    except Exception:
        return []


def extract_columns(layout_xml: str) -> List[str]:
    """Extract list of column tags from the <Content><Cols> container."""
    detailed = extract_columns_detailed(layout_xml)
    return [c["name"] for c in detailed]


def extract_output_param_placeholders(layout_xml: str) -> List[str]:
    """
    Search for Bravo parameter placeholders such as {=@_DocNo} or {=@_DocDateIO} in the XML.
    Returns list of distinct parameter names (e.g. ['_DocNo', '_DocDateIO']).
    """
    if not layout_xml or not layout_xml.strip():
        return []
    pattern = re.compile(r"\{=@_([A-Za-z0-9_]+)")
    matches: Set[str] = set(pattern.findall(layout_xml))
    return sorted(f"_{m}" for m in matches)
