# -*- coding: utf-8 -*-
"""
Data models for Report Layout Generator (Excel -> Bravo XML).
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Tuple
import re

RegionKind = Literal["title", "header", "summary", "page_footer"]


def col_idx_to_letter(col_idx: int) -> str:
    """Convert 1-based column index to Excel column letters (1 -> 'A', 27 -> 'AA')."""
    result = []
    while col_idx > 0:
        col_idx, remainder = divmod(col_idx - 1, 26)
        result.append(chr(65 + remainder))
    return "".join(reversed(result))


def col_letter_to_idx(col_letter: str) -> int:
    """Convert Excel column letters to 1-based column index ('A' -> 1, 'AA' -> 27)."""
    idx = 0
    for char in col_letter.upper():
        if "A" <= char <= "Z":
            idx = idx * 26 + (ord(char) - ord("A") + 1)
    return idx


def parse_cell_coord(coord_str: str) -> Tuple[int, int]:
    """Parse cell reference (e.g. 'B5') into 1-based (row, col) -> (5, 2)."""
    m = re.match(r"^([A-Za-z]+)(\d+)$", coord_str.strip())
    if not m:
        raise ValueError(f"Invalid cell coordinate format: '{coord_str}'")
    col_str, row_str = m.groups()
    return int(row_str), col_letter_to_idx(col_str)


def format_cell_coord(row: int, col: int) -> str:
    """Format (row, col) into cell coordinate string (e.g. (5, 2) -> 'B5')."""
    return f"{col_idx_to_letter(col)}{row}"


def parse_range_string(range_str: str) -> Tuple[int, int, int, int]:
    """
    Parse range string (e.g. 'A8:F9' or 'C12') into (min_row, min_col, max_row, max_col).
    All indices are 1-based inclusive.
    """
    parts = range_str.strip().split(":")
    if len(parts) == 1:
        r, c = parse_cell_coord(parts[0])
        return r, c, r, c
    elif len(parts) == 2:
        r1, c1 = parse_cell_coord(parts[0])
        r2, c2 = parse_cell_coord(parts[1])
        return min(r1, r2), min(c1, c2), max(r1, r2), max(c1, c2)
    else:
        raise ValueError(f"Invalid range format: '{range_str}'")


def format_range_string(min_row: int, min_col: int, max_row: int, max_col: int) -> str:
    """Format bounds into 'A8:F9' string."""
    return f"{format_cell_coord(min_row, min_col)}:{format_cell_coord(max_row, max_col)}"


@dataclass
class MergeRange:
    """Represents a merged cell area in Excel (1-based indices)."""
    min_row: int
    min_col: int
    max_row: int
    max_col: int
    user_data: Optional[str] = None

    def contains(self, row: int, col: int) -> bool:
        return self.min_row <= row <= self.max_row and self.min_col <= col <= self.max_col

    @property
    def range_str(self) -> str:
        return format_range_string(self.min_row, self.min_col, self.max_row, self.max_col)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "min_row": self.min_row,
            "min_col": self.min_col,
            "max_row": self.max_row,
            "max_col": self.max_col,
            "range_str": self.range_str,
            "user_data": self.user_data,
        }


@dataclass
class Cell:
    """Represents a single cell in a worksheet."""
    row: int
    col: int
    value: Optional[str] = None
    raw_value: Any = None
    formatted_value: Optional[str] = None
    merge: Optional[MergeRange] = None
    is_anchor: bool = True  # True if standalone cell or top-left of a merge
    style_id: Optional[int] = None  # index into SheetModel.styles

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "row": self.row,
            "col": self.col,
            "value": self.formatted_value if self.formatted_value is not None else self.value,
            "is_anchor": self.is_anchor,
            "merge": self.merge.to_dict() if self.merge else None,
        }
        if self.style_id is not None:
            d["s"] = self.style_id
        if self.raw_value is not None and str(self.raw_value) != str(d["value"]):
            d["raw"] = str(self.raw_value)
        return d


@dataclass
class SheetModel:
    """Represents the extracted model of an Excel worksheet."""
    name: str
    max_row: int
    max_col: int
    cells: Dict[Tuple[int, int], Cell] = field(default_factory=dict)
    merges: List[MergeRange] = field(default_factory=list)
    col_widths_px: Dict[int, int] = field(default_factory=dict)  # col_idx (1-based) -> px
    row_heights_px: Dict[int, int] = field(default_factory=dict) # row_idx (1-based) -> px
    styles: List[Dict[str, Any]] = field(default_factory=list)   # Shared style table
    hidden_rows: List[int] = field(default_factory=list)
    hidden_cols: List[int] = field(default_factory=list)
    freeze_panes: Optional[str] = None
    default_col_width_px: int = 64
    default_row_height_px: int = 20
    show_grid_lines: bool = True
    page: Dict[str, Any] = field(default_factory=dict)           # paper, landscape, margins
    drawings: List[Dict[str, Any]] = field(default_factory=list) # Floating text boxes / shapes

    def get_cell(self, row: int, col: int) -> Optional[Cell]:
        return self.cells.get((row, col))

    def get_merge_for_cell(self, row: int, col: int) -> Optional[MergeRange]:
        for m in self.merges:
            if m.contains(row, col):
                return m
        return None

    def to_preview_dict(self, max_rows: int = 500, max_cols: int = 100) -> Dict[str, Any]:
        """Convert sheet model to JSON-serializable preview for frontend grid."""
        r_limit = min(self.max_row, max_rows)
        c_limit = min(self.max_col, max_cols)
        grid = []
        for r in range(1, r_limit + 1):
            row_data = []
            for c in range(1, c_limit + 1):
                cell = self.get_cell(r, c)
                row_data.append(cell.to_dict() if cell else {"row": r, "col": c, "value": None, "is_anchor": True, "merge": None})
            grid.append(row_data)

        return {
            "name": self.name,
            "max_row": self.max_row,
            "max_col": self.max_col,
            "preview_rows": r_limit,
            "preview_cols": c_limit,
            "truncated": {
                "rows": self.max_row > r_limit,
                "cols": self.max_col > c_limit,
                "total_rows": self.max_row,
                "total_cols": self.max_col,
            },
            "col_widths_px": {str(k): v for k, v in self.col_widths_px.items() if k <= c_limit},
            "row_heights_px": {str(k): v for k, v in self.row_heights_px.items() if k <= r_limit},
            "hidden_rows": [r for r in self.hidden_rows if r <= r_limit],
            "hidden_cols": [c for c in self.hidden_cols if c <= c_limit],
            "freeze_panes": self.freeze_panes,
            "show_grid_lines": self.show_grid_lines,
            "default_col_width_px": self.default_col_width_px,
            "default_row_height_px": self.default_row_height_px,
            "styles": self.styles,
            "merges": [m.to_dict() for m in self.merges if m.min_row <= r_limit and m.min_col <= c_limit],
            "grid": grid,
            "drawings": self.drawings,
            "page": self.page,
        }


@dataclass
class Region:
    """Represents a defined report zone in the Excel sheet."""
    kind: RegionKind
    min_row: int
    min_col: int
    max_row: int
    max_col: int

    @property
    def range_str(self) -> str:
        return format_range_string(self.min_row, self.min_col, self.max_row, self.max_col)

    def contains(self, row: int, col: int) -> bool:
        return self.min_row <= row <= self.max_row and self.min_col <= col <= self.max_col

    @classmethod
    def from_range_string(cls, kind: RegionKind, range_str: str) -> "Region":
        min_r, min_c, max_r, max_c = parse_range_string(range_str)
        return cls(kind=kind, min_row=min_r, min_col=min_c, max_row=max_r, max_col=max_c)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "min_row": self.min_row,
            "min_col": self.min_col,
            "max_row": self.max_row,
            "max_col": self.max_col,
            "range_str": self.range_str,
        }


@dataclass
class ResultShape:
    """Represents the static structure returned by a stored routine or query."""
    result_sets: List[Dict[str, Any]] = field(default_factory=list)   # [{index: 0, name: 'Table0', columns: [{name: 'DocNo', type: 'nvarchar'}]}]
    output_params: List[Dict[str, Any]] = field(default_factory=list) # [{name: '_DocNo', type: 'nvarchar'}]
    input_params: List[Dict[str, Any]] = field(default_factory=list)  # [{name: 'nUserId', type: 'int', default_expr: "USER('Id')"}]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "result_sets": self.result_sets,
            "output_params": self.output_params,
            "input_params": self.input_params,
        }


@dataclass
class WorkbookFileInfo:
    """Represents an uploaded Excel file within a wizard session."""
    id: str
    filename: str
    workbook_path: str
    size_bytes: int = 0
    sheets: List[str] = field(default_factory=list)
    selected_sheet: Optional[str] = None
    regions: List[Region] = field(default_factory=list)
    layout_xml: Optional[str] = None
    sheet_regions: Dict[str, List[Region]] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "filename": self.filename,
            "size_bytes": self.size_bytes,
            "sheets": self.sheets,
            "selected_sheet": self.selected_sheet,
            "regions": [r.to_dict() for r in self.regions],
            "sheet_regions": {k: [r.to_dict() for r in v] for k, v in self.sheet_regions.items()},
            "has_layout": bool(self.layout_xml),
        }


@dataclass
class GenSession:
    """Stores the working state of a report layout generation wizard session."""
    id: str
    workbook_path: str
    sheet: Optional[str] = None
    filename: Optional[str] = None
    files: List[WorkbookFileInfo] = field(default_factory=list)
    active_file_id: Optional[str] = None
    regions: List[Region] = field(default_factory=list)
    layout_xml: Optional[str] = None
    datasource_xml: Optional[str] = None
    sheet_layouts: Dict[str, str] = field(default_factory=dict)
    sheet_regions: Dict[str, List[Region]] = field(default_factory=dict)
    connection_id: Optional[str] = None
    routine: Optional[Dict[str, Any]] = None
    shape: Optional[ResultShape] = None
    data_member: Optional[str] = "Table0"
    mapping: Dict[str, str] = field(default_factory=dict)  # Excel pseudo col 'Col_A' -> Routine column 'DocNo'
    warnings: List[str] = field(default_factory=list)

    def get_region(self, kind: RegionKind) -> Optional[Region]:
        for r in self.regions:
            if r.kind == kind:
                return r
        return None

    def get_active_file(self) -> Optional[WorkbookFileInfo]:
        if not self.files:
            return None
        if self.active_file_id:
            for f in self.files:
                if f.id == self.active_file_id:
                    return f
        return self.files[0]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "active_file_id": self.active_file_id,
            "filename": self.filename,
            "files": [f.to_dict() for f in self.files],
            "sheet": self.sheet,
            "regions": [r.to_dict() for r in self.regions],
            "data_member": self.data_member,
            "has_layout": bool(self.layout_xml),
            "has_datasource": bool(self.datasource_xml),
            "warnings": self.warnings,
        }
