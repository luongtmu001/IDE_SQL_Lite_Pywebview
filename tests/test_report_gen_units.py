# -*- coding: utf-8 -*-
import pytest
from app.services.report_layout_gen.units import excel_width_to_px, pt_to_px


def test_excel_width_to_px():
    # Target values from Bravo templates
    assert excel_width_to_px(4.77777777777778) == 35
    assert excel_width_to_px(50.2222222222222) == 362
    assert excel_width_to_px(12.2222222222222) == 88
    assert excel_width_to_px(13.0) == 94
    # Default fallback
    assert excel_width_to_px(None, default_width=8.43) == 61


def test_pt_to_px():
    # Target values from Bravo templates
    assert pt_to_px(19.8) == 27
    assert pt_to_px(21.0) == 28
    assert pt_to_px(10.2) == 14
    assert pt_to_px(28.2) == 38
    assert pt_to_px(15.0) == 20
    # Default fallback
    assert pt_to_px(None, default_height=15.0) == 20
