# -*- coding: utf-8 -*-
"""
Region Detector: Heuristically analyzes SheetModel to suggest Title, Header, Summary, and PageFooter zones.
"""
from typing import List, Optional
from .models import Region, SheetModel


def detect_suggested_regions(sheet: SheetModel) -> List[Region]:
    """
    Suggest report regions based on cell contents and merge patterns.
    Returns: List of Region objects for 'title', 'header', 'summary'.
    """
    regions: List[Region] = []
    max_r = sheet.max_row
    max_c = sheet.max_col

    if max_r < 1 or max_c < 1:
        return regions

    # 1. Find Header candidate rows
    # Look for rows containing merges with column headers, or rows with bold / uppercase text
    header_min_r: Optional[int] = None
    header_max_r: Optional[int] = None
    header_min_c = 1
    header_max_c = max_c

    # Check merge ranges
    if sheet.merges:
        # Group merges by row span, filtering out isolated title/tax code rows
        candidate_rows = set()
        min_cols_threshold = min(3, max(1, max_c // 4))
        for m in sheet.merges:
            for r in range(m.min_row, m.max_row + 1):
                cols_count = sum(
                    1 for c in range(1, max_c + 1)
                    if sheet.get_cell(r, c) and (sheet.get_cell(r, c).value or sheet.get_cell(r, c).merge)
                )
                if cols_count >= min_cols_threshold:
                    candidate_rows.add(r)

        if candidate_rows:
            # Find contiguous block of merge rows
            sorted_rows = sorted(candidate_rows)
            # Find the most prominent block
            curr_block = [sorted_rows[0]]
            blocks = [curr_block]
            for r in sorted_rows[1:]:
                if r == curr_block[-1] + 1:
                    curr_block.append(r)
                else:
                    curr_block = [r]
                    blocks.append(curr_block)

            # Score each block: Table headers have multiple distinct columns and header keywords
            best_block = None
            best_score = -1
            header_keywords = {"stt", "mã", "tên", "ngày", "số", "tiêu đề", "mặt hàng", "doanh số", "thuế", "ghi chú", "loại", "người", "diễn giải", "đơn giá", "thành tiền", "qty", "amount", "total", "code", "name", "date", "no", "item", "seq"}

            for blk in blocks:
                b_min = min(blk)
                b_max = max(blk)
                cols_with_text = set()
                keyword_matches = 0
                for r in range(b_min, b_max + 1):
                    for c in range(1, max_c + 1):
                        cell = sheet.get_cell(r, c)
                        if cell and cell.value:
                            cols_with_text.add(c)
                            val_lower = str(cell.value).lower()
                            if any(kw in val_lower for kw in header_keywords):
                                keyword_matches += 1

                score = len(cols_with_text) * 2 + keyword_matches * 5
                if score > best_score:
                    best_score = score
                    best_block = blk

            header_block = best_block or blocks[0]
            # Trim leading/trailing rows in the block that have low text column density compared to the core table header
            row_text_counts = {
                r: sum(1 for c in range(1, max_c + 1) if sheet.get_cell(r, c) and sheet.get_cell(r, c).value)
                for r in header_block
            }
            max_cnt = max(row_text_counts.values()) if row_text_counts else 0
            if max_cnt > 0:
                trimmed = [r for r in header_block if row_text_counts[r] >= 0.3 * max_cnt]
                if trimmed:
                    header_block = trimmed

            header_min_r = min(header_block)
            header_max_r = max(header_block)

            # Determine max_c for header by checking where merges/text end
            header_cols = set()
            for r in range(header_min_r, header_max_r + 1):
                for c in range(1, max_c + 1):
                    cell = sheet.get_cell(r, c)
                    if cell and (cell.value or cell.merge):
                        header_cols.add(c)
            if header_cols:
                header_max_c = max(header_cols)

    # Fallback if no merges found
    if header_min_r is None:
        if max_r >= 3:
            header_min_r = 2
            header_max_r = 2
        else:
            header_min_r = 1
            header_max_r = 1

    # Add Header Region
    header_reg = Region(
        kind="header",
        min_row=header_min_r,
        min_col=header_min_c,
        max_row=header_max_r,
        max_col=header_max_c,
    )
    regions.append(header_reg)

    # 2. Title Region (Rows above header)
    if header_min_r > 1:
        regions.append(Region(
            kind="title",
            min_row=1,
            min_col=1,
            max_row=header_min_r - 1,
            max_col=max_c,
        ))

    # 3. Detect data rows vs summary rows
    # Rows immediately after header with numeric values or repeating data
    last_data_r = header_max_r
    for r in range(header_max_r + 1, max_r + 1):
        has_number = False
        has_text = False
        for c in range(header_min_c, header_max_c + 1):
            cell = sheet.get_cell(r, c)
            if cell and cell.value:
                has_text = True
                val_clean = cell.value.replace(",", "").replace(".", "").strip()
                if val_clean.isdigit():
                    has_number = True
        if has_number or (has_text and (r - header_max_r <= 5)):
            last_data_r = r
        else:
            if r > header_max_r + 2:
                break

    # 4. Summary Region (Rows after data rows)
    if last_data_r < max_r:
        regions.append(Region(
            kind="summary",
            min_row=last_data_r + 1,
            min_col=1,
            max_row=max_r,
            max_col=max_c,
        ))

    return regions
