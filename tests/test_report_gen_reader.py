# -*- coding: utf-8 -*-
from pathlib import Path
import pytest

from app.services.report_layout_gen.workbook_reader import list_sheets, read_sheet

FIXTURE_XLSX = Path("tests/fixtures/report_gen/report.xlsx")


def test_list_sheets():
    sheets = list_sheets(FIXTURE_XLSX)
    assert len(sheets) == 1
    assert "Mẫu in" in sheets[0]["name"]
    assert sheets[0]["max_row"] == 18
    assert sheets[0]["max_col"] == 8
    assert sheets[0]["merge_count"] == 4


def test_read_sheet():
    model = read_sheet(FIXTURE_XLSX)
    assert model.max_row == 18
    assert model.max_col == 8
    assert len(model.merges) >= 4
    assert len(model.drawings) > 0

    # Merges: B8:B9, A8:A9, E8:F8, C8:D8
    merge_ranges = {m.range_str for m in model.merges}
    assert "A8:A9" in merge_ranges
    assert "B8:B9" in merge_ranges
    assert "C8:D8" in merge_ranges
    assert "E8:F8" in merge_ranges

    # Widths in pixels
    assert model.col_widths_px[1] == 35  # Col A
    assert model.col_widths_px[2] == 362 # Col B
    assert model.col_widths_px[3] == 88  # Col C
    assert model.col_widths_px[4] == 88  # Col D
    assert model.col_widths_px[5] == 88  # Col E
    assert model.col_widths_px[6] == 88  # Col F

    # Row heights
    assert model.row_heights_px[8] == 27 # 19.8pt -> 27px
    assert model.row_heights_px[9] == 28 # 21.0pt -> 28px

    # Cell anchors
    c_a8 = model.get_cell(8, 1)
    assert c_a8 is not None
    assert c_a8.value == "STT"
    assert c_a8.is_anchor is True
    assert c_a8.merge is not None

    c_a9 = model.get_cell(9, 1)
    assert c_a9 is not None
    assert c_a9.is_anchor is False
    assert c_a9.merge == c_a8.merge

    # Preview dict
    preview = model.to_preview_dict(max_rows=10, max_cols=6)
    assert preview["preview_rows"] == 10
    assert preview["preview_cols"] == 6
    assert len(preview["grid"]) == 10
    assert "styles" in preview
    assert len(preview["styles"]) > 0
    assert "truncated" in preview
    assert preview["truncated"]["rows"] is True  # 18 > 10

    # Verify style extraction for A8 header
    assert c_a8.style_id is not None
    style_a8 = model.styles[c_a8.style_id]
    assert style_a8.get("b") is True  # bold
    assert "bd" in style_a8  # has borders
