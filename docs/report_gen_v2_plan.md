# Kế hoạch sửa đổi lần 2 — Sinh Layout Báo cáo Bravo từ Excel

> Phạm vi: `templates/report_gen_window.html`, `static/js/report-gen/wizard.js`, `static/css/report-gen.css`,
> `app/api/report_gen_api.py`, `app/desktop/windows.py` (ReportGenSubwindowApi), `app/routes/report_gen.py`,
> `app/services/report_layout_gen/{workbook_reader,models,service}.py`.

## Mục tiêu

1. **Lỗi kết nối:** sửa để chọn được connection trong phần mềm, rồi tìm và phân tích được routine.
2. **Preview giống Excel / Google Sheets:** Bước 2 hiển thị lưới giống bảng tính và cho phép chọn cột, dòng hoặc vùng.
3. **Giao diện theo style dự án:** dùng biến theme `--ide-*`, font và cỡ chữ từ typography, cùng pattern với Schema Compare.

---

## 0. Phân tích hiện trạng (nguyên nhân gốc)

### 0.1 Không chọn được connection

| # | Vị trí | Vấn đề |
|---|--------|--------|
| C1 | `windows.py` → `ReportGenSubwindowApi.get_connections()` | Gọi `main_api.get_connections`, nhưng **MainApi không có hàm này**. Hàm có thật là `list_connections()` và `schema_compare_get_connections()`. Vì vậy hàm luôn trả `[]` và dropdown rỗng. |
| C2 | `report_gen_api.py` → `_get_report_gen_service()` | Lấy `self.connection_manager` / `self._connection_manager`, nhưng MainApi lưu ở **`self.cm`**. Service nhận `connection_manager=None`, nên mọi `list_routines` / `describe_routine` đều lỗi "ConnectionManager chưa được cấu hình". Service còn được cache ở biến class (`_report_gen_service_instance`), nên giá trị None bị giữ lại mãi. |
| C3 | `result_shape/__init__.py` → `get_detector()` | Dùng `cm.get(owner, id)`, nên **chỉ thấy connection đang mở**. Profile đã lưu nhưng chưa connect thì không dùng được. Schema Compare đã giải quyết việc này bằng `_resolve_connection()` (tự connect từ profile). |
| C4 | `wizard.js` | Nút `btn-search-routine` và `btn-describe-routine` **chưa gắn event**. `rg_list_routines` chưa có trong `endpointMap` (chế độ web). `state.dbColumns` không bao giờ được nạp, nên dropdown map cột luôn rỗng. |
| C5 | `wizard.js` → `loadConnections()` | Chế độ web giả `conn1`. Blueprint chưa có endpoint liệt kê connection. |

### 0.2 Preview hiện tại

- Bảng `<table>` thuần chỉ có giá trị text. `workbook_reader` **không đọc style** (font, fill, border, align, number format, wrap).
- Không dùng `row_heights_px`. Bảng không đặt `table-layout: fixed`, nên độ rộng cột bị lệch.
- Không có header cột/dòng dính (sticky), name box, thanh công thức hay tab sheet.
- Không chọn được cả cột hoặc cả dòng. Không có Shift/Ctrl, bàn phím hay vùng chọn dạng overlay. Hiện tại tô từng `td` bằng `querySelector` trong vòng lặp, nên chậm khi vùng lớn.
- Giới hạn preview 200×50 nhưng không báo cho người dùng.

### 0.3 Style

- Dùng màu hardcode (`#3b82f6`, `#10b981`…) và class Bootstrap `bg-dark text-light table-dark`, nên **vỡ ở theme sáng** (light, win-xp…).
- Không nạp `theme-registry.js`, `theme.js`, `typography.js` và không có script khôi phục font như Schema Compare. Vì vậy `ThemeManager.applyTheme()` từ `windows.py` không có tác dụng.
- Dùng `alert()` cho mọi thông báo, khác với toast/status của dự án.

---

## Phase 1 — Sửa lỗi Connection (ưu tiên cao, làm trước)

**Backend**

1. `report_gen_api.py`
   - `_get_report_gen_service()`: lấy `getattr(self, "cm", None)` trước rồi mới fallback. Bỏ cache ở biến class, cache theo instance (`self.__dict__`).
   - Thêm `rg_get_connections()`: tái sử dụng `schema_compare_get_connections()` (gồm connection đang mở và profile đã lưu, có `db_type`, `database`, `schema`). Lọc chỉ giữ SQL Server và PostgreSQL, vì SQLite không có routine.
   - Thêm `_rg_resolve_connection_id(connection_id)`: gọi `self._resolve_connection()` (mixin SchemaCompare) để tự connect profile đã lưu và trả về `connection_id` runtime. `rg_list_routines` và `rg_describe_routine` gọi hàm này trước khi sang service.
2. `windows.py` → `ReportGenSubwindowApi`
   - Thay `get_connections()` bằng `rg_get_connections()`, ủy quyền sang `main_api.rg_get_connections()`.
   - Bổ sung uỷ quyền `get_settings` / `get_typography` (nếu có) để subwindow nạp được font và theme.
3. `routes/report_gen.py` (chế độ web)
   - `GET /api/report-gen/connections`: trả danh sách tương tự.
   - `list_routines` / `describe`: resolve connection giống desktop.

**Frontend (`wizard.js`)**

4. `loadConnections()` → gọi `rg_get_connections`. Hiển thị theo nhóm "Đang kết nối" và "Đã lưu", kèm icon `sqlserver.png` / `postgresql.png`. Tự chọn connection đang active của tab chính nếu có.
5. Thêm `rg_list_routines` và `rg_get_connections` vào `endpointMap`.
6. Gắn event:
   - Đổi connection hoặc gõ ô tìm kiếm (debounce 300ms) → `rg_list_routines` → đổ vào danh sách routine (tên, schema, loại P/FN).
   - Chọn routine (double-click) hoặc nút "Bóc tách" → `rg_describe_routine` → nạp `state.dbColumns` từ `shape.result_sets[i].columns`, vẽ badge cột, **dựng lại dropdown mapping** rồi chạy `autoMatchColumns()`.
   - Nếu routine có nhiều result set, thêm dropdown chọn `Table0/Table1…` và gán vào `data_member`.
7. Trạng thái loading và lỗi hiển thị ngay trong panel (spinner, dòng lỗi), không dùng `alert`.

**Kiểm thử Phase 1:** chọn một profile đã lưu chưa connect → danh sách routine nạp được → describe ra cột → map → build ra `report_datasource.xml` có tên routine và tham số input.

---

## Phase 2 — Preview giống Excel / Google Sheets

### 2.1 Backend: đọc thêm định dạng ô

- `models.Cell`: thêm `style: Optional[Dict]` gọn nhẹ gồm `b`, `i`, `u`, `fs` (size), `fc` (màu chữ), `bg` (fill), `ha`/`va` (căn lề), `wrap`, `bd` (border 4 cạnh: style và màu), `nf` (number format).
- `workbook_reader.read_sheet()`:
  - Đọc `cell.font`, `cell.fill` (chỉ `patternType == solid`), `cell.alignment`, `cell.border`, `cell.number_format`. Chuyển màu ARGB/theme sang hex. Màu theme/tint: map bảng theme mặc định của Office, nếu không xác định được thì bỏ qua.
  - Thêm `hidden_rows`, `hidden_cols`, `freeze_panes` (`ws.freeze_panes`), `default_col_width_px`, `default_row_height_px`.
  - Tạo **style table dùng chung** (`styles: [..]`, cell chỉ giữ `s: idx`) để payload nhỏ.
  - Hiển thị giá trị đã format: số, ngày và phần trăm theo `number_format` cơ bản. Giữ thêm `raw` nếu cần.
- `to_preview_dict()`: thêm `styles`, `hidden_*`, `freeze`, `truncated: {rows, cols}`. Nâng giới hạn lên khoảng 500×100 và cho phép tham số `max_rows`/`max_cols`.
- Hiệu năng: tra merge bằng dict `(r,c) → merge` thay cho vòng lặp O(n·m) hiện tại trong `read_sheet`. Cache `SheetModel` theo `(session_id, sheet)` trong `session_store` để `set_regions` không phải đọc lại file.

### 2.2 Frontend: lưới bảng tính mới (`static/js/report-gen/sheet-grid.js`)

Tách lưới thành module riêng `SheetGrid` (wizard.js chỉ điều phối).

**Bố cục giống Excel**

```
┌ Name box [B5:H5] │ fx  Nội dung ô đang chọn ─────────────────────────┐
├──┬────A────┬──B──┬────C────┬ …  (header cột sticky top, có resize hiển thị)
│1 │         │     │         │
│2 │  ô có font/fill/border/căn lề, merge, chiều cao dòng thật
│… (header dòng sticky left; góc trái trên = nút Select All)
├──────────────────────────────────────────────────────────────────┤
│ ◂ ▸ │ Sheet1 │ Sheet2 │ …      (tab sheet ở đáy, thay cho dropdown)  │
└──────────────────────────────────────────────────────────────────┘
```

- `table-layout: fixed` cùng `<colgroup>` theo `col_widths_px`, và `height` theo `row_heights_px`. Ẩn cột/dòng hidden, có vạch báo giống Excel.
- Gridline nhạt theo theme (`--ide-border`). Border thật của ô vẽ đè lên gridline.
- Freeze panes theo file: sticky các dòng/cột bị freeze.
- Ô số căn phải, text căn trái (mặc định giống Excel nếu không có alignment).
- Hiển thị cảnh báo "Đang xem 500/1.240 dòng" khi bị cắt.
- Zoom 75 / 100 / 125% (CSS `zoom` hoặc `transform`), lưu lựa chọn vào `localStorage`.

**Chọn vùng / cột / dòng**

| Thao tác | Kết quả |
|---|---|
| Click ô / kéo chuột | Chọn ô / vùng chữ nhật (tự mở rộng khi vùng chạm merge) |
| Click **chữ cột** (A, B…) | Chọn cả cột (trong phạm vi dữ liệu) |
| Kéo trên header cột | Chọn nhiều cột liền nhau |
| Click **số dòng** | Chọn cả dòng; kéo để chọn nhiều dòng |
| Shift + click | Mở rộng vùng chọn từ ô neo |
| Ctrl + click | Thêm vùng chọn rời (chỉ dùng để chọn cột cho mapping) |
| Mũi tên / Shift+mũi tên | Di chuyển / mở rộng vùng chọn |
| Click góc trái trên | Chọn toàn bộ vùng dữ liệu |
| Esc | Bỏ chọn |

- Vẽ vùng chọn bằng **overlay tuyệt đối** (1 div viền xanh và nền mờ, giống Excel), không tô từng `td`. Highlight cột/dòng trên header tương ứng.
- Vùng Title / Header / Summary cũng vẽ bằng overlay có màu và nhãn góc (`TITLE`, `HEADER`, `SUMMARY`). Có thể kéo cạnh overlay để chỉnh vùng (giai đoạn sau, tùy chọn).
- Name box hiển thị dải đang chọn (`B5:H7`, `C:F`, `3:5`). Cho phép **gõ dải** vào name box rồi Enter để chọn.
- Thanh `fx` hiển thị giá trị ô đang active.
- Chuột phải trên vùng chọn mở menu ngữ cảnh: "Gán làm Title / Header / Summary", "Xoá gán vùng". Dùng `context-menu.css` của dự án.

**Chọn cột (để mapping)**

- Sau khi gán Header, header cột của các cột nằm trong vùng Header có checkbox/biểu tượng. Người dùng **bật/tắt cột** được đưa vào layout (cột tắt sẽ thành `unmapped_columns` / bỏ qua).
- Ở Bước 3, hover một dòng trong bảng mapping thì preview mini **highlight đúng cột** tương ứng trên lưới (dùng lại `SheetGrid` ở chế độ read-only, thu nhỏ). Nhờ vậy người dùng thấy rõ đang map cột nào.

### 2.3 Hiệu năng

- Render bằng `DocumentFragment` / chuỗi HTML một lần. Với file vượt 500 dòng, dùng **virtual scroll theo dòng** (chỉ render các dòng trong viewport ±20) vì chiều cao dòng đã biết.
- Tra ô theo `Map` thay cho `querySelector` trong vòng lặp.

---

## Phase 3 — Thiết kế lại giao diện theo style dự án

### 3.1 Khung trang

- Head giống `schema_compare_window.html`: script khôi phục theme và typography (font, cỡ chữ từ `localStorage`), nạp `theme-registry.js`, `theme.js`, `typography.js`, `utils.js`. Bỏ Google Fonts riêng (dùng font UI của IDE).
- **Bỏ toàn bộ** `bg-dark`, `text-light`, `table-dark`, `btn-primary` mặc định. Thay bằng class `rg-*` dùng biến:
  - Nền: `--ide-bg-main`, `--ide-bg-panel`, `--ide-bg-toolbar`, `--ide-bg-input`, `--ide-bg-dropdown`
  - Chữ: `--ide-text-main`, `--ide-text-muted`, `--ide-text-dim`
  - Viền / nhấn: `--ide-border`, `--ide-accent`, `--ide-accent-hover`, `--ide-accent-subtle`, `--ide-selection-bg`
  - Trạng thái: `--ide-success`, `--ide-warning`, `--ide-danger`, `--ide-info`
  - Lưới: `--ide-grid-header-bg`, `--ide-grid-row-hover`
  - Font: `--ide-ui-font-family`, `--ide-ui-font-size`
- Màu vùng (title/header/summary) giữ riêng nhưng dùng `color-mix(... transparent)` để hợp cả theme sáng lẫn tối.

### 3.2 Bố cục mới (gọn, kiểu IDE thay vì wizard to)

```
┌ Toolbar (cao 36px, --ide-bg-toolbar) ───────────────────────────────────┐
│ [icon] Sinh Layout Báo cáo │ ①Nguồn ─ ②Vùng ─ ③Map cột ─ ④XML │ Phiên #xx│
├─────────────────────────────────────────────────────────────────────────┤
│ Nội dung bước                                                            │
│  B1: Card nguồn gọn (dropzone + ô URL Google Sheets + danh sách file gần │
│      đây)                                                                │
│  B2: [Sheet grid chiếm toàn bộ] + panel phải 260px: "Vùng báo cáo"       │
│      (3 thẻ Title/Header/Summary có dải, nút Gán/Xoá/Định vị) + nút Gợi ý│
│  B3: Trái 300px: Connection ▸ Routine (search + list) ▸ Result set ▸     │
│      badge cột │ Phải: bảng mapping (Excel col | DB col | trạng thái ✓/!)│
│      + mini preview lưới                                                │
│  B4: Monaco editor XML (dùng lại monaco-init.js, readonly, có folding) + │
│      2 tab file; nút Copy / Lưu ra thư mục (rg_save_files) / Mở trong    │
│      Bravo                                                               │
├─────────────────────────────────────────────────────────────────────────┤
│ Status bar: thông báo / cảnh báo (warnings từ backend) │ ◂ Quay lại  Tiếp ▸│
└─────────────────────────────────────────────────────────────────────────┘
```

- Nút, select, input dùng lại kiểu `sc-btn`, `sc-ctx-select` (copy pattern sang `rg-btn`, `rg-select`) để thống nhất.
- Stepper có thể click quay lại bước đã hoàn thành.
- Thay `alert()` bằng toast nhỏ góc dưới phải cùng status bar. `warnings` từ `set_regions` / `apply_mapping` hiển thị trong status bar (có thể mở rộng).
- Bước 4: thêm nút **"Lưu file…"** gọi `rg_save_files` (desktop: hộp thoại chọn thư mục qua pywebview) thay cho download blob, vì blob không hoạt động trong pywebview.

### 3.3 Kiểm tra theme

- Chạy với các theme: dark mặc định, light, win-xp, win-nt, cùng ít nhất 1 theme custom. Kiểm tra độ tương phản của lưới, overlay vùng chọn và dropdown.

---

## Thứ tự thực hiện và ước lượng

| # | Hạng mục | File chính | Ước lượng |
|---|----------|-----------|-----------|
| 1 | Phase 1: sửa connection, routine, describe, mapping | `report_gen_api.py`, `windows.py`, `routes/report_gen.py`, `wizard.js` | 0,5 ngày |
| 2 | Phase 2.1: đọc style, freeze, hidden, cache | `workbook_reader.py`, `models.py`, `session_store.py` | 0,5 ngày |
| 3 | Phase 2.2: module `sheet-grid.js` (render, chọn, overlay, name box, tab sheet) | `sheet-grid.js`, `report-gen.css` | 1–1,5 ngày |
| 4 | Phase 3: viết lại HTML/CSS theo theme, toolbar, status bar, toast, Monaco ở B4 | `report_gen_window.html`, `report-gen.css`, `wizard.js` | 1 ngày |
| 5 | Phase 2.2 nâng cao: chọn cột cho mapping, mini preview, menu chuột phải | `sheet-grid.js`, `wizard.js` | 0,5 ngày |
| 6 | Test và CHANGELOG | `tests/`, `CHANGELOG.md`, `docs/update_v1.x.md` | 0,5 ngày |

## Kiểm thử

- **Unit (pytest):**
  - `workbook_reader`: style (bold, fill, border, căn lề), merge, hidden, freeze với `docs/archive/report.xlsx`.
  - `ReportGenApiMixin._get_report_gen_service()` nhận đúng `cm`.
  - `rg_get_connections` lọc bỏ SQLite.
- **Tích hợp:** profile SQL Server và PostgreSQL chưa connect → list routines → describe → build. So sánh XML với `docs/archive/report_layout.xml` và `report_datasource.xml`.
- **UI thủ công:**
  - Chọn ô, cột, dòng, Shift/Ctrl, bàn phím, name box.
  - File lớn (5.000 dòng) vẫn mượt.
  - Đổi theme khi cửa sổ đang mở.
  - Google Sheets link.

## Rủi ro / lưu ý

- Màu theme/tint trong Excel phức tạp → giai đoạn đầu chỉ hỗ trợ RGB và màu theme cơ bản, ghi chú vào CHANGELOG.
- `data_only=True` trả `None` cho công thức chưa được Excel tính lại (file sinh bằng code). Khi đó hiển thị công thức gốc ở thanh `fx`, cần mở thêm workbook với `data_only=False`.
- Payload preview lớn qua pywebview bridge → dùng style table và giới hạn dòng, tải thêm khi cuộn (endpoint `rg_get_sheet` thêm `offset`).
