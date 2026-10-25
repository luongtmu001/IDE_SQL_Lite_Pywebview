# -*- coding: utf-8 -*-
from pathlib import Path
import xml.etree.ElementTree as ET
import pytest

from app.bravo.xml_codec import validate_xml_syntax
from app.services.report_layout_gen.datasource_builder import build_report_datasource_xml

FIXTURE_DATASOURCE_XML = Path("tests/fixtures/report_gen/report_datasource.xml")


def test_build_report_datasource_xml_matches_fixture():
    params = [
        {"name": "nUserId", "type": "int"},
        {"name": "LangId", "type": "smallint"},
    ]
    xml_out = build_report_datasource_xml(
        routine_name="usp_B30AccDoc_VoucherFormSales",
        input_params=params,
    )

    valid, err = validate_xml_syntax(xml_out)
    assert valid is True, f"Syntax error: {err}"

    root = ET.fromstring(xml_out)
    assert root.find("Command").text == "usp_B30AccDoc_VoucherFormSales"

    defaults = root.find(".//TableCollection/ParametersTable/DefaultValues")
    assert defaults is not None
    assert defaults.find("nUserId").text == "USER('Id')"
    assert defaults.find("LangId").text == "LANGID()"

    # Compare with fixture XML
    fixture_content = FIXTURE_DATASOURCE_XML.read_text(encoding="utf-8")
    fix_root = ET.fromstring(fixture_content)
    assert fix_root.find("Command").text == root.find("Command").text
    assert fix_root.find(".//DefaultValues/nUserId").text == root.find(".//DefaultValues/nUserId").text
    assert fix_root.find(".//DefaultValues/LangId").text == root.find(".//DefaultValues/LangId").text
