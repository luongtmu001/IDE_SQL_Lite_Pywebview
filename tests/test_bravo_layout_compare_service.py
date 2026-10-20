# -*- coding: utf-8 -*-
"""
Tests for BravoLayoutCompareService.
Covers:
1. Engine detection (SQL Server vs PostgreSQL).
2. Layout list metadata query and hierarchical grouping by FormName.
3. Layout detail retrieval, ZIP/XML payload decoding, and NULL draft handling.
4. Update script generation with atomic transactions and concurrency checks.
5. Apply update with optimistic concurrency validation, atomicity, and rollback on failure.
"""
from unittest.mock import MagicMock
import pytest

from app.bravo.xml_codec import encode_xml_payload, decode_xml_payload
from app.services.bravo_layout_compare_service import BravoLayoutCompareService


class MockConnection:
    """Mock connection session mimicking luoBTool connection object."""

    def __init__(self, db_type="sqlserver", is_postgres=False):
        self.config = {"type": "postgresql" if is_postgres else "sqlserver"}
        self.adapter = MagicMock()
        self.adapter.db_type = "postgresql" if is_postgres else "sqlserver"
        self.query_service = MagicMock()


SAMPLE_XML_1 = '<?xml version="1.0" encoding="utf-8"?><FormLayout Name="B30AccDoc"><Header Title="Test 1"/></FormLayout>'
SAMPLE_XML_2 = '<?xml version="1.0" encoding="utf-8"?><FormLayout Name="B30AccDoc"><Header Title="Draft Test"/></FormLayout>'


def test_is_postgres_detection():
    """Verify is_postgres accurately detects postgres connections and strings."""
    assert BravoLayoutCompareService.is_postgres("postgresql") is True
    assert BravoLayoutCompareService.is_postgres("Postgres") is True
    assert BravoLayoutCompareService.is_postgres("pgsql") is True
    assert BravoLayoutCompareService.is_postgres("sqlserver") is False
    assert BravoLayoutCompareService.is_postgres("sqlite") is False

    pg_conn = MockConnection(is_postgres=True)
    assert BravoLayoutCompareService.is_postgres(pg_conn) is True

    ms_conn = MockConnection(is_postgres=False)
    assert BravoLayoutCompareService.is_postgres(ms_conn) is False


def test_get_layout_list_grouping():
    """Verify get_layout_list hierarchically groups layouts under their parent FormName."""
    conn = MockConnection()
    conn.query_service.execute.return_value = {
        "success": True,
        "columns": ["Id", "FormName", "LayoutName", "ModifiedAt", "HasDraft", "IsTemplate", "CreatedBy"],
        "rows": [
            [1, "B30AccDoc", "Default", "2026-10-18 00:00:00", 1, 0, "Admin"],
            [2, "B30AccDoc", "CustomGrid", "2026-10-17 12:00:00", 0, 0, "User01"],
            [3, "B20Customer", "Default", "2026-10-16 08:30:00", 0, 1, "Admin"],
        ]
    }

    res = BravoLayoutCompareService.get_layout_list(conn, database="BravoDB")
    assert res["success"] is True
    assert res["total_forms"] == 2
    assert res["total_layouts"] == 3

    forms = res["forms"]
    assert forms[0]["formName"] == "B30AccDoc"
    assert forms[0]["layoutCount"] == 2
    assert forms[0]["layouts"][0]["layoutName"] == "Default"
    assert forms[0]["layouts"][0]["hasDraft"] is True
    assert forms[0]["layouts"][1]["layoutName"] == "CustomGrid"
    assert forms[0]["layouts"][1]["hasDraft"] is False

    assert forms[1]["formName"] == "B20Customer"
    assert forms[1]["layoutCount"] == 1


def test_get_layout_list_search_filter():
    """Verify search_term filters both FormName and LayoutName."""
    conn = MockConnection()
    conn.query_service.execute.return_value = {
        "success": True,
        "columns": ["Id", "FormName", "LayoutName", "ModifiedAt", "HasDraft", "IsTemplate", "CreatedBy"],
        "rows": [
            [1, "B30AccDoc", "Default", "2026-10-18 00:00:00", 1, 0, "Admin"],
            [2, "B20Customer", "SpecialLayout", "2026-10-16 08:30:00", 0, 0, "Admin"],
        ]
    }

    res = BravoLayoutCompareService.get_layout_list(conn, search_term="Customer")
    assert res["success"] is True
    assert res["total_forms"] == 1
    assert res["forms"][0]["formName"] == "B20Customer"

    res2 = BravoLayoutCompareService.get_layout_list(conn, search_term="SpecialLayout")
    assert res2["success"] is True
    assert res2["total_forms"] == 1
    assert res2["forms"][0]["layouts"][0]["layoutName"] == "SpecialLayout"


def test_get_layout_detail_decoding():
    """Verify get_layout_detail correctly fetches and decodes ZIP/XML payloads."""
    conn = MockConnection()

    zip_payload = encode_xml_payload(SAMPLE_XML_1, format_type="zip")
    draft_zip_payload = encode_xml_payload(SAMPLE_XML_2, format_type="zip")

    conn.query_service.execute.return_value = {
        "success": True,
        "columns": ["Id", "FormName", "LayoutName", "ModifiedAt", "LayoutData", "LastLayoutData"],
        "rows": [
            [10, "B30AccDoc", "Layout1", "2026-10-18 01:00:00", zip_payload, draft_zip_payload]
        ]
    }

    res = BravoLayoutCompareService.get_layout_detail(conn, layout_id=10)
    assert res["success"] is True
    assert res["id"] == 10
    assert res["formName"] == "B30AccDoc"
    assert res["layoutName"] == "Layout1"
    assert res["hasDraft"] is True
    assert "<FormLayout Name=\"B30AccDoc\">" in res["xml"]
    assert "Draft Test" in res["draftXml"]


def test_get_layout_detail_null_draft():
    """Verify get_layout_detail gracefully handles NULL draft payload without fabricating XML."""
    conn = MockConnection()
    zip_payload = encode_xml_payload(SAMPLE_XML_1, format_type="zip")

    conn.query_service.execute.return_value = {
        "success": True,
        "columns": ["Id", "FormName", "LayoutName", "ModifiedAt", "LayoutData", "LastLayoutData"],
        "rows": [
            [11, "B30AccDoc", "Layout1", "2026-10-18 01:00:00", zip_payload, None]
        ]
    }

    res = BravoLayoutCompareService.get_layout_detail(conn, layout_id=11)
    assert res["success"] is True
    assert res["draftXml"] == ""
    assert res["hasDraft"] is False
    assert res["isLastLayoutNull"] is True


def test_generate_update_script_sqlserver():
    """Verify generate_update_script produces transactional SQL Server script with Concurrency check."""
    res = BravoLayoutCompareService.generate_update_script(
        db_type_or_conn="sqlserver",
        layout_id=42,
        layout_xml=SAMPLE_XML_1,
        draft_layout_xml=SAMPLE_XML_2,
        expected_modified_at="2026-10-18 00:00:00",
        form_name="B30AccDoc",
        layout_name="Standard",
        database="Bravo10DB",
    )

    assert res["success"] is True
    sql = res["sql"]

    assert "BEGIN TRANSACTION;" in sql
    assert "COMMIT TRANSACTION;" in sql
    assert "UPDATE B00LayoutData" in sql
    assert "LayoutData = 0x504B0304" in sql
    assert "LastLayoutData = 0x504B0304" in sql
    assert "WHERE Id = 42;" in sql
    assert "UPDATE B00Layout" in sql
    assert "SET ModifiedAt = GETDATE()" in sql
    assert "@@ROWCOUNT <> 1" in sql
    assert "ROLLBACK TRANSACTION;" in sql
    assert "Optimistic Concurrency Check" in sql


def test_generate_update_script_postgresql():
    """Verify generate_update_script produces transactional PostgreSQL script."""
    res = BravoLayoutCompareService.generate_update_script(
        db_type_or_conn="postgresql",
        layout_id=99,
        layout_xml=SAMPLE_XML_1,
        draft_layout_xml=None,
        expected_modified_at="2026-10-18 00:00:00",
        form_name="B50Inv",
        layout_name="Stock",
    )

    assert res["success"] is True
    sql = res["sql"]

    assert "BEGIN;" in sql
    assert "COMMIT;" in sql
    assert "UPDATE b00layoutdata" in sql
    assert "decode('504b0304" in sql
    assert "lastlayoutdata = NULL" in sql
    assert "UPDATE b00layout" in sql
    assert "CURRENT_TIMESTAMP" in sql


def test_generate_update_script_xml_syntax_error():
    """Verify generate_update_script rejects invalid XML syntax."""
    res = BravoLayoutCompareService.generate_update_script(
        db_type_or_conn="sqlserver",
        layout_id=42,
        layout_xml="<UnclosedTag>Content",
    )
    assert res["success"] is False
    assert "Cú pháp XML" in res["error"]


def test_apply_update_layout_optimistic_concurrency_conflict():
    """Verify apply_update_layout rejects update when ModifiedAt in DB differs from expected."""
    conn = MockConnection()
    # Mock current DB ModifiedAt
    conn.query_service.execute.return_value = {
        "success": True,
        "rows": [["2026-10-18 02:00:00"]]
    }

    res = BravoLayoutCompareService.apply_update_layout(
        conn=conn,
        layout_id=50,
        layout_xml=SAMPLE_XML_1,
        expected_modified_at="2026-10-18 01:00:00",  # Outdated timestamp
    )

    assert res["success"] is False
    assert res.get("concurrency_conflict") is True
    assert "Xung đột ghi đè đồng thời" in res["error"]
    assert res["preserved_xml"] == SAMPLE_XML_1


def test_apply_update_layout_success():
    """Verify apply_update_layout executes transaction and reloads layout."""
    conn = MockConnection()

    # Step 1: Concurrency check -> returns matching timestamp
    # Step 2: Exec update script -> returns success
    # Step 3: Reload layout -> returns reloaded detail
    zip_payload = encode_xml_payload(SAMPLE_XML_1, format_type="zip")
    conn.query_service.execute.side_effect = [
        {"success": True, "rows": [["2026-10-18 01:00:00"]]},
        {"success": True, "rows": []},
        {
            "success": True,
            "columns": ["Id", "FormName", "LayoutName", "ModifiedAt", "LayoutData", "LastLayoutData"],
            "rows": [[55, "B30AccDoc", "Default", "2026-10-18 01:05:00", zip_payload, None]]
        }
    ]

    res = BravoLayoutCompareService.apply_update_layout(
        conn=conn,
        layout_id=55,
        layout_xml=SAMPLE_XML_1,
        expected_modified_at="2026-10-18 01:00:00",
    )

    assert res["success"] is True
    assert "thành công" in res["message"]
    assert res["layout"]["id"] == 55


def test_compare_layout_metadata_two_databases():
    """Verify compare_layout_metadata matches layouts between Source and Target databases."""
    source_conn = MockConnection()
    target_conn = MockConnection()

    # Source has B30AccDoc/Default, B30AccDoc/OnlySource
    source_conn.query_service.execute.return_value = {
        "success": True,
        "columns": ["Id", "FormName", "LayoutName", "ModifiedAt", "HasDraft", "IsTemplate", "CreatedBy", "PayloadLength"],
        "rows": [
            [101, "B30AccDoc", "Default", "2026-10-18 00:00:00", 0, 0, "Admin", 1200],
            [102, "B30AccDoc", "OnlySource", "2026-10-18 01:00:00", 0, 0, "Admin", 850],
        ]
    }

    # Target has B30AccDoc/Default (different length), B20Customer/OnlyTarget
    target_conn.query_service.execute.return_value = {
        "success": True,
        "columns": ["Id", "FormName", "LayoutName", "ModifiedAt", "HasDraft", "IsTemplate", "CreatedBy", "PayloadLength"],
        "rows": [
            [201, "B30AccDoc", "Default", "2026-10-17 12:00:00", 0, 0, "Admin", 1400],
            [202, "B20Customer", "OnlyTarget", "2026-10-16 08:00:00", 0, 0, "Admin", 900],
        ]
    }

    res = BravoLayoutCompareService.compare_layout_metadata(
        source_conn=source_conn,
        target_conn=target_conn,
        source_database="SourceDB",
        target_database="TargetDB",
    )

    assert res["success"] is True
    assert res["total_layouts"] == 3
    assert res["different_count"] == 1
    assert res["missing_in_target_count"] == 1
    assert res["extra_in_target_count"] == 1

    forms = {f["formName"]: f for f in res["forms"]}
    assert "B30AccDoc" in forms
    assert "B20Customer" in forms

    acc_layouts = {l["layoutName"]: l for l in forms["B30AccDoc"]["layouts"]}
    assert acc_layouts["Default"]["status"] == "different"
    assert acc_layouts["Default"]["sourceId"] == 101
    assert acc_layouts["Default"]["targetId"] == 201

    assert acc_layouts["OnlySource"]["status"] == "missing_in_target"
    assert acc_layouts["OnlySource"]["sourceId"] == 102
    assert acc_layouts["OnlySource"]["targetId"] is None

    cust_layouts = {l["layoutName"]: l for l in forms["B20Customer"]["layouts"]}
    assert cust_layouts["OnlyTarget"]["status"] == "extra_in_target"
    assert cust_layouts["OnlyTarget"]["sourceId"] is None
    assert cust_layouts["OnlyTarget"]["targetId"] == 202


def test_get_layout_pair_detail():
    """Verify get_layout_pair_detail retrieves XML from both databases independently."""
    source_conn = MockConnection()
    target_conn = MockConnection()

    src_zip = encode_xml_payload(SAMPLE_XML_1, format_type="zip")
    tgt_zip = encode_xml_payload(SAMPLE_XML_2, format_type="zip")

    source_conn.query_service.execute.return_value = {
        "success": True,
        "columns": ["Id", "FormName", "LayoutName", "ModifiedAt", "LayoutData", "LastLayoutData"],
        "rows": [[101, "B30AccDoc", "Default", "2026-10-18 00:00:00", src_zip, None]]
    }
    target_conn.query_service.execute.return_value = {
        "success": True,
        "columns": ["Id", "FormName", "LayoutName", "ModifiedAt", "LayoutData", "LastLayoutData"],
        "rows": [[201, "B30AccDoc", "Default", "2026-10-17 12:00:00", tgt_zip, None]]
    }

    res = BravoLayoutCompareService.get_layout_pair_detail(
        source_conn=source_conn,
        target_conn=target_conn,
        source_layout_id=101,
        target_layout_id=201,
        source_database="SourceDB",
        target_database="TargetDB",
    )

    assert res["success"] is True
    assert res["isIdentical"] is False
    assert "<Header Title=\"Test 1\"/>" in res["sourceXml"]
    assert "<Header Title=\"Draft Test\"/>" in res["targetXml"]
    assert res["sourceId"] == 101
    assert res["targetId"] == 201


def test_get_program_list_resilience(tmp_path, monkeypatch):
    """Verify get_program_list does not crash if an individual program password fails decryption."""
    from app.bravo.api import BravoApiMixin
    import app.bravo.api as bravo_api_module
    import json

    test_file = tmp_path / "test_programs.json"
    test_data = [
        {
            "id": "prog_1",
            "name": "NormalApp",
            "path": "C:\\Program.exe",
            "password": "plain_password"
        },
        {
            "id": "prog_2",
            "name": "CorruptApp",
            "path": "C:\\Corrupt.exe",
            "password": "ENC:corrupt_or_different_machine_token_12345"
        }
    ]
    test_file.write_text(json.dumps(test_data), encoding="utf-8")
    monkeypatch.setattr(bravo_api_module, "PROGRAM_LIST_FILE", test_file)

    api = BravoApiMixin()
    res = api.get_program_list()

    assert res["success"] is True
    assert len(res["programs"]) == 2
    assert res["programs"][0]["name"] == "NormalApp"
    assert res["programs"][0]["password"] == "plain_password"
    assert res["programs"][1]["name"] == "CorruptApp"
    assert res["programs"][1]["password"] == ""  # Gracefully cleared on decrypt failure

