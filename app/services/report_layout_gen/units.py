# -*- coding: utf-8 -*-
"""
Unit conversion utilities (Excel width/height -> Pixels).
"""
import math
from typing import Optional


def excel_width_to_px(width: Optional[float], default_width: float = 8.43) -> int:
    """
    Convert Excel character column width to screen pixels.
    Standard approximation: ceil(width * 7.2).
    Verified against Bravo templates:
        4.78 -> 35
        50.22 -> 362
        12.22 -> 88
    """
    w = width if width is not None and width > 0 else default_width
    return math.ceil(w * 7.2)


def pt_to_px(pt_height: Optional[float], default_height: float = 15.0) -> int:
    """
    Convert Excel point height to screen pixels (96 DPI: 1 pt = 4/3 px).
    Standard approximation: ceil(pt * 4 / 3).
    Verified against Bravo templates:
        19.8 -> 27
        21.0 -> 28
        10.2 -> 14
        28.2 -> 38
        15.0 -> 20
    """
    h = pt_height if pt_height is not None and pt_height > 0 else default_height
    return math.ceil(h * 4.0 / 3.0)
