# -*- coding: utf-8 -*-
import xml.etree.ElementTree as ET
import pytest

from app.services.report_layout_gen.column_mapper import apply_column_mapping
from app.services.report_layout_gen.layout_reader import extract_columns, extract_output_param_placeholders

SAMPLE_XML = """<root>
  <panelReporter>
    <Controls>
      <Report_0>
        <DataMember>Table0</DataMember>
        <Title>
          <Cols>
            <Column_0>
              <Rows>
                <Row_0>
                  <Text>
                    <Vietnamese>Số: {=@_DocNoIO} ngày {=@_DocDateIO}</Vietnamese>
                  </Text>
                </Row_0>
              </Rows>
            </Column_0>
          </Cols>
        </Title>
        <Content>
          <Cols>
            <Col_A>
              <Width>35</Width>
            </Col_A>
            <Col_B>
              <Width>362</Width>
            </Col_B>
          </Cols>
        </Content>
      </Report_0>
    </Controls>
  </panelReporter>
</root>"""


def test_layout_reader():
    cols = extract_columns(SAMPLE_XML)
    assert cols == ["Col_A", "Col_B"]

    placeholders = extract_output_param_placeholders(SAMPLE_XML)
    assert "_DocNoIO" in placeholders
    assert "_DocDateIO" in placeholders


def test_apply_column_mapping_rename():
    mapping = {"Col_A": "BuiltinOrder", "Col_B": "ItemName"}
    updated, warnings = apply_column_mapping(
        layout_xml=SAMPLE_XML,
        mapping=mapping,
        data_member="Table2",
        mode="rename",
        unmapped_columns=["CurrencyCode"],
    )
    assert len(warnings) == 0

    root = ET.fromstring(updated)
    assert root.find(".//Report_0/DataMember").text == "Table2"

    cols = [c.tag for c in root.findall(".//Content/Cols/*")]
    assert "BuiltinOrder" in cols
    assert "ItemName" in cols
    assert "CurrencyCode" in cols

    hidden = root.find(".//Content/Cols/CurrencyCode")
    assert hidden.find("Visible").text == "False"
    assert hidden.find("./Rows/Row_0/Text/Vietnamese").text == "CurrencyCode"


def test_apply_column_mapping_name_tag():
    mapping = {"Col_A": "BuiltinOrder"}
    updated, warnings = apply_column_mapping(
        layout_xml=SAMPLE_XML,
        mapping=mapping,
        mode="name_tag",
    )
    assert len(warnings) == 0

    root = ET.fromstring(updated)
    col_a = root.find(".//Content/Cols/Col_A")
    assert col_a is not None
    assert col_a.find("Name").text == "BuiltinOrder"


def test_apply_column_mapping_title_param():
    sample_title_xml = """<root>
      <panelReporter>
        <Controls>
          <Report_0>
            <Title>
              <Cols>
                <Column_0>
                  <Rows>
                    <Row_0>
                      <Text>
                        <Vietnamese>Bộ phận</Vietnamese>
                      </Text>
                    </Row_0>
                  </Rows>
                </Column_0>
              </Cols>
            </Title>
          </Report_0>
        </Controls>
      </panelReporter>
    </root>"""
    param_map = {"Column_0": "@_DeptName"}
    updated, warnings = apply_column_mapping(
        layout_xml=sample_title_xml,
        mapping={},
        param_mappings=param_map,
    )
    assert len(warnings) == 0
    assert "{=@_DeptName}" in updated


def test_apply_column_mapping_row_specific_param():
    sample_title_xml = """<root>
      <panelReporter>
        <Controls>
          <Report_0>
            <Title>
              <Cols>
                <Column_0>
                  <Rows>
                    <Row_0>
                      <Text><Vietnamese>Công ty</Vietnamese></Text>
                    </Row_0>
                    <Row_1>
                      <Text><Vietnamese>Địa chỉ</Vietnamese></Text>
                    </Row_1>
                  </Rows>
                </Column_0>
              </Cols>
            </Title>
          </Report_0>
        </Controls>
      </panelReporter>
    </root>"""
    param_map = {
        "title::Row_0::Column_0": "@_CompanyName",
        "title::Row_1::Column_0": "@_Address",
    }
    updated, warnings = apply_column_mapping(
        layout_xml=sample_title_xml,
        mapping={},
        param_mappings=param_map,
    )
    assert len(warnings) == 0
    assert "{=@_CompanyName}" in updated
    assert "{=@_Address}" in updated


def test_apply_column_mapping_disabled_column():
    sample_xml = """<root>
      <panelReporter>
        <Controls>
          <Report_0>
            <Content>
              <Cols>
                <Col_A><Width>50</Width></Col_A>
                <Col_B><Width>100</Width></Col_B>
              </Cols>
            </Content>
          </Report_0>
        </Controls>
      </panelReporter>
    </root>"""
    updated, warnings = apply_column_mapping(
        layout_xml=sample_xml,
        mapping={"Col_A": "DocCode"},
        unmapped_columns=["Col_B"],
        mode="rename",
    )
    assert len(warnings) == 0
    assert "<DocCode>" in updated
    assert "<Col_B>" in updated
    assert "<Visible>False</Visible>" in updated


