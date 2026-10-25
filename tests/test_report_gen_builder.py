# -*- coding: utf-8 -*-
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import pytest

from app.bravo.xml_codec import validate_xml_syntax
from app.services.report_layout_gen.layout_builder import build_report_layout_xml
from app.services.report_layout_gen.models import Region
from app.services.report_layout_gen.userdata import UserDataGenerator
from app.services.report_layout_gen.workbook_reader import read_sheet

FIXTURE_XLSX = Path("tests/fixtures/report_gen/report.xlsx")
FIXTURE_LAYOUT_XML = Path("tests/fixtures/report_gen/report_layout.xml")


def extract_userdata_id(style_str: str) -> str:
    m = re.search(r"UserData:([a-z0-9]{8});", style_str or "")
    return m.group(1) if m else ""


def test_golden_report_layout_structure():
    sheet = read_sheet(FIXTURE_XLSX)
    regions = [
        Region.from_range_string("title", "A1:H7"),
        Region.from_range_string("header", "A8:F9"),
        Region.from_range_string("summary", "A12:H18"),
    ]
    mapping = {
        "Col_A": "BuiltinOrder",
        "Col_B": "ItemName",
        "Col_C": "RequestQuantity",
        "Col_D": "QuantityBags",
        "Col_E": "WeightQuantity",
        "Col_F": "QuantityBagText",
    }
    gen = UserDataGenerator(seed=42)
    xml_out, warnings = build_report_layout_xml(
        sheet=sheet,
        regions=regions,
        data_member="Table2",
        userdata_gen=gen,
        col_mapping=mapping,
    )

    # 1. Syntax check
    valid, err = validate_xml_syntax(xml_out)
    assert valid is True, f"XML syntax error: {err}"
    assert len(warnings) == 0

    root = ET.fromstring(xml_out)
    report = root.find(".//Report_0")
    assert report is not None
    assert report.find("DataMember").text == "Table2"

    # 2. Check Content band structure
    content = report.find("Content")
    assert content is not None

    rows = content.findall("./Rows/*")
    assert len(rows) == 2
    assert rows[0].tag == "Row_0" and rows[0].find("Height").text == "27"
    assert rows[1].tag == "Row_1" and rows[1].find("Height").text == "28"

    cols = content.findall("./Cols/*")
    col_tags = [c.tag for c in cols]
    assert col_tags == [
        "BuiltinOrder",
        "ItemName",
        "RequestQuantity",
        "QuantityBags",
        "WeightQuantity",
        "QuantityBagText",
    ]

    # BuiltinOrder (Col A)
    bo = content.find("./Cols/BuiltinOrder")
    assert bo.find("Width").text == "35"
    bo_r0_style = bo.find("./Rows/Row_0/Style").text
    bo_r1_style = bo.find("./Rows/Row_1/Style").text
    assert extract_userdata_id(bo_r0_style) != ""
    assert extract_userdata_id(bo_r0_style) == extract_userdata_id(bo_r1_style)
    assert bo.find("./Rows/Row_0/Text/Vietnamese").text == "STT"
    assert bo.find("./Rows/Row_1/Text") is None

    # ItemName (Col B)
    item = content.find("./Cols/ItemName")
    assert item.find("Width").text == "362"
    item_r0_style = item.find("./Rows/Row_0/Style").text
    item_r1_style = item.find("./Rows/Row_1/Style").text
    assert extract_userdata_id(item_r0_style) != ""
    assert extract_userdata_id(item_r0_style) == extract_userdata_id(item_r1_style)
    assert item.find("./Rows/Row_0/Text/Vietnamese").text == "TÊN SẢN PHẨM"
    assert item.find("./Rows/Row_1/Text") is None

    # RequestQuantity & QuantityBags (Cols C & D merged on Row 0)
    req = content.find("./Cols/RequestQuantity")
    bags = content.find("./Cols/QuantityBags")
    assert req.find("Width").text == "88"
    assert bags.find("Width").text == "88"

    req_r0_uid = extract_userdata_id(req.find("./Rows/Row_0/Style").text)
    bags_r0_uid = extract_userdata_id(bags.find("./Rows/Row_0/Style").text)
    assert req_r0_uid != ""
    assert req_r0_uid == bags_r0_uid, "C8:D8 merge must share UserData ID"
    assert req.find("./Rows/Row_0/Text/Vietnamese").text == "SỐ LƯỢNG YÊU CẦU"
    assert bags.find("./Rows/Row_0/Text") is None

    # Row 1 of C & D: unmerged TẤN and BAO
    assert req.find("./Rows/Row_1/Text/Vietnamese").text == "TẤN"
    assert req.find("./Rows/Row_1/Style") is None
    assert bags.find("./Rows/Row_1/Text/Vietnamese").text == "BAO"
    assert bags.find("./Rows/Row_1/Style") is None

    # WeightQuantity & QuantityBagText (Cols E & F merged on Row 0)
    wq = content.find("./Cols/WeightQuantity")
    qbt = content.find("./Cols/QuantityBagText")
    assert wq.find("Width").text == "88"
    assert qbt.find("Width").text == "88"

    wq_r0_uid = extract_userdata_id(wq.find("./Rows/Row_0/Style").text)
    qbt_r0_uid = extract_userdata_id(qbt.find("./Rows/Row_0/Style").text)
    assert wq_r0_uid != ""
    assert wq_r0_uid == qbt_r0_uid, "E8:F8 merge must share UserData ID"
    assert wq.find("./Rows/Row_0/Text/Vietnamese").text == "SỐ LƯỢNG THỰC XUẤT"
    assert qbt.find("./Rows/Row_0/Text") is None

    # Row 1 of E & F: unmerged TẤN and BAO
    assert wq.find("./Rows/Row_1/Text/Vietnamese").text == "TẤN"
    assert wq.find("./Rows/Row_1/Style") is None
    assert qbt.find("./Rows/Row_1/Text/Vietnamese").text == "BAO"
    assert qbt.find("./Rows/Row_1/Style") is None


def test_build_report_layout_single_region_title():
    sheet = read_sheet(FIXTURE_XLSX)
    regions = [Region.from_range_string("title", "A1:H7")]
    xml_out, warnings = build_report_layout_xml(sheet=sheet, regions=regions)
    valid, err = validate_xml_syntax(xml_out)
    assert valid is True
    root = ET.fromstring(xml_out)
    report = root.find(".//Report_0")
    assert report.find("Title") is not None
    assert report.find("Content") is None
    assert report.find("Summary") is None


def test_build_report_layout_single_region_content():
    sheet = read_sheet(FIXTURE_XLSX)
    regions = [Region.from_range_string("header", "A8:F9")]
    xml_out, warnings = build_report_layout_xml(sheet=sheet, regions=regions)
    valid, err = validate_xml_syntax(xml_out)
    assert valid is True
    root = ET.fromstring(xml_out)
    report = root.find(".//Report_0")
    assert report.find("Title") is None
    assert report.find("Content") is not None
    assert report.find("Summary") is None


def test_build_report_layout_content_alias():
    sheet = read_sheet(FIXTURE_XLSX)
    regions = [Region.from_range_string("content", "A8:F9")]
    xml_out, warnings = build_report_layout_xml(sheet=sheet, regions=regions)
    valid, err = validate_xml_syntax(xml_out)
    assert valid is True
    root = ET.fromstring(xml_out)
    report = root.find(".//Report_0")
    assert report.find("Content") is not None


def test_band_strict_isolation():
    sheet = read_sheet(FIXTURE_XLSX)
    regions = [
        Region.from_range_string("title", "A1:H7"),
        Region.from_range_string("header", "A8:F9"),
    ]
    xml_out, _ = build_report_layout_xml(sheet=sheet, regions=regions)
    root = ET.fromstring(xml_out)
    content = root.find(".//Report_0/Content")
    # Header is A8:F9 -> 2 rows (Row_0, Row_1)
    content_rows = content.findall("./Rows/*")
    assert len(content_rows) == 2
    # Content has 6 columns (A through F)
    content_cols = content.findall("./Cols/*")
    assert len(content_cols) == 6
    # Title has 7 rows (Row_0 to Row_6)
    title = root.find(".//Report_0/Title")
    title_rows = title.findall("./Rows/*")
    assert len(title_rows) == 7
