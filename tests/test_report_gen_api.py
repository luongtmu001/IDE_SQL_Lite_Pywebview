# -*- coding: utf-8 -*-
import base64
import json
from pathlib import Path
import pytest

from app.api.report_gen_api import ReportGenApiMixin
from app import create_app

FIXTURE_XLSX = Path("tests/fixtures/report_gen/report.xlsx")


class DummyApi(ReportGenApiMixin):
    def __init__(self):
        self.cm = None
        self.owner_session_id = "test_user"

    def schema_compare_get_connections(self):
        return {
            "success": True,
            "connections": [
                {"id": "c1", "name": "SQL Server Prod", "db_type": "sqlserver", "database": "BravoDB"},
                {"id": "c2", "name": "Postgres Analytics", "db_type": "postgresql", "database": "Analytics"},
                {"id": "c3", "name": "Local SQLite", "db_type": "sqlite", "database": "local.db"},
            ]
        }


def test_rg_get_connections_filters_sqlite():
    api = DummyApi()
    res = api.rg_get_connections()
    assert res["success"] is True
    conns = res["connections"]
    assert len(conns) == 2
    types = [c["db_type"] for c in conns]
    assert "sqlserver" in types
    assert "postgresql" in types
    assert "sqlite" not in types


def test_api_mixin_workflow(tmp_path):
    api = DummyApi()

    # 1. Open file
    xlsx_bytes = FIXTURE_XLSX.read_bytes()
    b64_str = base64.b64encode(xlsx_bytes).decode("ascii")
    res_open = api.rg_open_file(b64_str, filename="report.xlsx")
    assert res_open["success"] is True
    sid = res_open["session_id"]
    assert len(res_open["sheets"]) == 1

    # 2. Get sheet preview
    res_sheet = api.rg_get_sheet(sid)
    assert res_sheet["success"] is True
    assert "sheet" in res_sheet
    assert len(res_sheet["suggested_regions"]) == 3

    # 3. Set regions
    regions = [
        {"kind": "title", "range_str": "A1:H7"},
        {"kind": "header", "range_str": "A8:F9"},
        {"kind": "summary", "range_str": "A12:H18"},
    ]
    res_regions = api.rg_set_regions(sid, regions)
    assert res_regions["success"] is True
    assert "layout_xml" in res_regions
    assert len(res_regions["columns"]) == 6

    # 4. Apply mapping
    mapping = {
        "Col_A": "BuiltinOrder",
        "Col_B": "ItemName",
        "Col_C": "RequestQuantity",
        "Col_D": "QuantityBags",
        "Col_E": "WeightQuantity",
        "Col_F": "QuantityBagText",
    }
    res_map = api.rg_apply_mapping(sid, data_member="Table0", mapping=mapping)
    assert res_map["success"] is True
    assert "BuiltinOrder" in res_map["layout_xml"]

    # 5. Build
    res_build = api.rg_build(sid)
    assert res_build["success"] is True
    assert res_build["layout_xml"] is not None

    # 6. Save files
    out_dir = tmp_path / "saved_report"
    res_save = api.rg_save_files(sid, str(out_dir))
    assert res_save["success"] is True
    assert (out_dir / "report_layout.xml").exists()


def test_flask_routes_workflow():
    app = create_app()
    client = app.test_client()

    # 1. POST /api/report-gen/source
    with open(FIXTURE_XLSX, "rb") as f:
        resp = client.post("/api/report-gen/source", data={"file": f})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    sid = data["session_id"]

    # 2. GET /api/report-gen/<sid>/sheet
    resp = client.get(f"/api/report-gen/{sid}/sheet")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert "grid" in data["sheet"]

    # 3. PUT /api/report-gen/<sid>/regions
    regions = [
        {"kind": "title", "range_str": "A1:H7"},
        {"kind": "header", "range_str": "A8:F9"},
        {"kind": "summary", "range_str": "A12:H18"},
    ]
    resp = client.put(f"/api/report-gen/{sid}/regions", json={"regions": regions})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert len(data["columns"]) == 6

    # 4. PUT /api/report-gen/<sid>/mapping
    resp = client.put(
        f"/api/report-gen/{sid}/mapping",
        json={
            "data_member": "Table0",
            "mapping": {"Col_A": "BuiltinOrder"},
            "mode": "rename",
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert "BuiltinOrder" in data["layout_xml"]

    # 5. POST /api/report-gen/<sid>/build
    resp = client.post(f"/api/report-gen/{sid}/build")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["layout_xml"] is not None

    # 6. GET /api/report-gen/connections
    resp = client.get("/api/report-gen/connections")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert "connections" in data


def test_multi_file_api_mixin_workflow():
    api = DummyApi()
    xlsx_bytes = FIXTURE_XLSX.read_bytes()
    b64_str = base64.b64encode(xlsx_bytes).decode("ascii")

    # 1. Open multiple files
    files_payload = [
        {"content": b64_str, "filename": "report_1.xlsx"},
        {"content": b64_str, "filename": "report_2.xlsx"},
    ]
    res = api.rg_open_files(files_payload)
    assert res["success"] is True
    assert len(res["files"]) == 2
    assert res["files"][0]["filename"] == "report_1.xlsx"
    assert res["files"][1]["filename"] == "report_2.xlsx"
    assert res["active_file_id"] == "file_1"
    sid = res["session_id"]

    # 2. Select / switch file
    res_select = api.rg_select_file(sid, "file_2")
    assert res_select["success"] is True
    assert res_select["active_file_id"] == "file_2"
    assert res_select["filename"] == "report_2.xlsx"

    # 3. Add files to existing session
    res_add = api.rg_add_files(sid, [{"content": b64_str, "filename": "report_3.xlsx"}])
    assert res_add["success"] is True
    assert len(res_add["files"]) == 3
    assert res_add["files"][2]["filename"] == "report_3.xlsx"

    # 4. Remove file from session
    res_remove = api.rg_remove_file(sid, "file_1")
    assert res_remove["success"] is True
    assert len(res_remove["files"]) == 2
    filenames = [f["filename"] for f in res_remove["files"]]
    assert "report_1.xlsx" not in filenames
    assert "report_2.xlsx" in filenames
    assert "report_3.xlsx" in filenames


def test_multi_file_flask_routes_workflow():
    app = create_app()
    client = app.test_client()
    xlsx_bytes = FIXTURE_XLSX.read_bytes()
    b64_str = base64.b64encode(xlsx_bytes).decode("ascii")

    # 1. POST /api/report-gen/source with multiple files
    resp = client.post(
        "/api/report-gen/source",
        json={
            "files": [
                {"content": b64_str, "filename": "batch_a.xlsx"},
                {"content": b64_str, "filename": "batch_b.xlsx"},
            ]
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert len(data["files"]) == 2
    sid = data["session_id"]

    # 2. POST /api/report-gen/<sid>/select-file
    resp_sel = client.post(f"/api/report-gen/{sid}/select-file", json={"file_id": "file_2"})
    assert resp_sel.status_code == 200
    data_sel = resp_sel.get_json()
    assert data_sel["success"] is True
    assert data_sel["active_file_id"] == "file_2"

    # 3. POST /api/report-gen/<sid>/add-files
    resp_add = client.post(
        f"/api/report-gen/{sid}/add-files",
        json={"files": [{"content": b64_str, "filename": "batch_c.xlsx"}]},
    )
    assert resp_add.status_code == 200
    data_add = resp_add.get_json()
    assert data_add["success"] is True
    assert len(data_add["files"]) == 3

    # 4. DELETE /api/report-gen/<sid>/file/<file_id>
    resp_del = client.delete(f"/api/report-gen/{sid}/file/file_1")
    assert resp_del.status_code == 200
    data_del = resp_del.get_json()
    assert data_del["success"] is True
    assert len(data_del["files"]) == 2


def test_multi_sheet_mapping_and_build_workflow():
    api = DummyApi()
    res = api.rg_open_file(str(FIXTURE_XLSX), filename="sample_multi.xlsx")
    assert res["success"] is True
    sid = res["session_id"]
    sheets = res.get("sheets") or []
    sheet_name = sheets[0] if sheets else "Sheet1"

    # Set regions for sheet
    regions = [
        {"kind": "header", "range_str": "A8:K9"},
        {"kind": "title", "range_str": "A2:K5"},
    ]
    res_reg = api.rg_set_regions(sid, regions, sheet_name=sheet_name)
    assert res_reg["success"] is True
    assert len(res_reg["columns"]) > 0

    # Apply mapping with sheet_name and data_member
    mapping = {res_reg["columns"][0]: "DocNo"}
    res_map = api.rg_apply_mapping(sid, "Table0", mapping, mode="rename", sheet_name=sheet_name)
    assert res_map["success"] is True
    assert "DocNo" in res_map["layout_xml"]

    # Build
    res_build = api.rg_build(sid)
    assert res_build["success"] is True
    assert "DocNo" in res_build["layout_xml"]
    assert sheet_name in res_build.get("sheet_layouts", {})
