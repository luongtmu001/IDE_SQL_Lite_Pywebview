# Tài Liệu Cập Nhật Thay Đổi — LLTool IDE v1.1.6

> **Ngày phát hành**: 25/10/2026  
> **Phiên bản trước**: `v1.1.5` (24/10/2026)  
> **Trọng tâm**: Nâng cấp toàn diện công cụ "Sinh Layout Báo cáo Bravo từ Excel / Google Sheets" v2 (Excel to Bravo XML Report Generator)

---

## 1. Tóm Tắt Tổng Quan Các Nâng Cấp

Căn cứ theo kế hoạch chi tiết trong `docs/report_gen_v2_plan.md`, phiên bản **v1.1.6** giải quyết triệt để 3 nhóm vấn đề trọng tâm của công cụ Sinh Layout Báo cáo Bravo:

| Nhóm | Vấn đề ban đầu | Giải pháp trong v1.1.6 |
|---|---|---|
| **Phase 1: Quản lý Kết nối & An Toàn DB** | Dropdown connection rỗng, không tìm hay phân tích được routine từ các profile đã lưu chưa connect. | Tích hợp cơ chế lấy kết nối active và profile đã lưu (`rg_get_connections`), tự động kết nối runtime (`_rg_resolve_connection_id`), lọc bỏ SQLite. **Đảm bảo an toàn tuyệt đối:** bóc tách cấu trúc cột qua phân tích cú pháp tĩnh (`NO EXEC`). |
| **Phase 2: Trải nghiệm Bảng tính (SheetGrid)** | Bảng HTML cơ bản, mất màu sắc, border, font, chiều cao dòng lệch, không có name box hay chọn vùng kiểu Excel. | Xây dựng thành phần `SheetGrid` độc lập: fixed table-layout, `<colgroup>`, sticky headers, đọc đầy đủ định dạng (font, fill ARGB/theme, border, căn lề, format số/ngày), overlay vùng chọn và vùng báo cáo (Title/Header/Summary) tính toán theo O(1), thanh công thức `fx`, Name Box, zoom, tab sheets, và mini preview highlight cột khi mapping. |
| **Phase 3: Giao diện Chuẩn IDE** | Màu sắc cứng, vỡ ở theme sáng, thiếu typography, dùng `alert()` gây chặn giao diện. | Đồng bộ biến theme `--ide-*`, typography (font UI & cỡ chữ), toolbar 38px, stepper pills, thanh trạng thái status bar thông báo mượt mà, tích hợp trình soạn thảo Monaco Editor (chế độ readonly, XML folding, 2 tabs layout/datasource) kèm hộp thoại lưu thư mục native. |

---

## 2. Chi Tiết Kỹ Thuật Các Thay Đổi

### 2.1. Phase 1 — Kết Nối CSDL & Phân Tích Routine An Toàn (Database Routine Analyzer)
- **Truy cập ConnectionManager chính xác**:
  - `ReportGenApiMixin._get_report_gen_service`: Nhận diện `getattr(self, 'cm', None)` từ `MainApi` trước khi fallback, cache theo instance (`self._report_gen_service_inst`).
- **Danh sách kết nối đa nguồn & lọc hệ quản trị**:
  - `rg_get_connections()`: Tái sử dụng `schema_compare_get_connections()` để lấy đồng thời các kết nối đang active và các profile kết nối đã lưu.
  - Lọc bỏ SQLite, chỉ hiển thị Microsoft SQL Server và PostgreSQL (do SQLite không có Stored Procedures / Routines).
  - Tự động gán kết nối runtime qua `_rg_resolve_connection_id(connection_id)`.
- **An toàn CSDL Tuyệt Đối (`NO EXEC`)**:
  - Toàn bộ việc nhận diện tham số và cột đầu ra của Stored Procedure / Function được thực hiện thông qua việc đọc `ROUTINE_DEFINITION` từ `INFORMATION_SCHEMA` / `sys.sql_modules` / `pg_proc` và bóc tách cây ngữ pháp AST tĩnh. Không thực hiện `EXEC` hoặc truy vấn trực tiếp trên dữ liệu người dùng.

### 2.2. Phase 2 — Trình Kết Xuất Bảng Tính Tương Tác `SheetGrid`
- **Bộ đọc định dạng nâng cao (`workbook_reader.py`)**:
  - Trích xuất bảng màu font, fill nền solid hỗ trợ ARGB (8 ký tự) và bảng 10 màu Theme chuẩn Office kèm hệ số tint.
  - Đọc kiểu đường viền (thin, medium, double, dashed...) và màu viền 4 cạnh ô.
  - Đọc căn lề ngang/dọc, thuộc tính tự động xuống dòng (`wrap_text`).
  - Định dạng sơ bộ giá trị ô (phần trăm %, số thập phân có phân tách hàng nghìn, ngày tháng).
  - Tối ưu tra cứu ô gộp (merged cells) từ vòng lặp $O(n \times m)$ sang bảng băm $O(1)$ `merge_map[(row, col)]`.
  - Tối ưu dung lượng JSON: gom toàn bộ định dạng trùng lặp vào danh mục `styles: []`, mỗi ô chỉ mang chỉ số `style_id`.
  - Đọc thuộc tính dòng ẩn (`hidden_rows`), cột ẩn (`hidden_cols`), ô đóng băng (`freeze_panes`).
- **Thành phần `SheetGrid` (`static/js/report-gen/sheet-grid.js`)**:
  - Khung bảng tính fixed-layout với kích thước pixel thực từ file Excel.
  - Thanh header số dòng và chữ cột cố định khi cuộn (`sticky`).
  - Lớp Overlays tính toán toạ độ hình học thuần túy qua mảng cộng dồn vị trí (`rowOffsets`, `colOffsets`) đạt độ phức tạp $O(1)$, không gây hiện tượng giật giật (reflow/layout thrashing).
  - Khung chọn vùng kiểu Excel (nền mờ, viền xanh) hỗ trợ kéo chuột, Shift+Click, các phím mũi tên.
  - Điều hướng dải ô qua Name Box (nhập ví dụ `A1:F10` rồi nhấn Enter).
  - Thanh công thức `fx` hiển thị giá trị ô đang kích hoạt.
  - Menu ngữ cảnh chuột phải: Gán nhanh vùng `Title`, `Header`, `Summary` hoặc huỷ gán.
  - Hỗ trợ đổi tỷ lệ Zoom (75%, 100%, 125%).

### 2.4. Nâng Cấp Quản Lý Nhiều File Excel & Hiển Thị Danh Sách File Trực Quan
- **Hiển thị danh sách file sau khi chọn (Visual File Cards)**:
  - Khi người dùng kéo thả hoặc chọn file, hệ thống không tự động nhảy bước ngay lập tức mà hiển thị danh sách thẻ file (`File Cards`) rõ ràng tại Bước 1.
  - Mỗi thẻ file hiển thị: số thứ tự, icon Excel, tên file đầy đủ (kèm tooltip), kích thước định dạng đẹp (`KB`, `MB`), số lượng sheets và tên các sheet, huy hiệu "Đang chọn", nút "Khoanh vùng" và nút "Xóa file".
  - Giúp người dùng xác nhận chắc chắn 100% file nào đã được nạp thành công trước khi sang bước tiếp theo.
- **Hỗ trợ chọn nhiều file đồng thời (Multi-File Selection & Batch Session)**:
  - Thẻ chọn file hỗ trợ thuộc tính `multiple`, cho phép chọn hoặc kéo thả nhiều file Excel cùng một lúc.
  - Backend mở rộng mô hình dữ liệu `WorkbookFileInfo` và quản lý danh sách file trong `GenSession.files`.
  - Bộ API đa file hoàn chỉnh:
    - `rg_open_files(files)`: Khởi tạo phiên làm việc với nhiều file cùng lúc.
    - `rg_add_files(session_id, files)`: Thêm các file mới vào phiên đang mở.
    - `rg_remove_file(session_id, file_id)`: Xóa một file khỏi phiên và dọn dẹp file tạm trên ổ cứng.
    - `rg_select_file(session_id, file_id)`: Chuyển đổi file đang kích hoạt để khoanh vùng và sinh layout.
  - Tại Bước 2: Tự động hiển thị thanh chuyển đổi nhanh giữa các file (`File Switcher Bar`) giúp người dùng dễ dàng chuyển đổi qua lại giữa các file Excel mà không cần quay lại Bước 1.

### 2.5. Phase 4 — Thiết Kế Lại Giao Diện Bước 2, Bước 3 & Bước 4 (UI Redesign & Multi-Sheet)
- **Phân tích kỹ thuật Bước 2 (Preview Sheet & Vùng chọn)**:
  - Phân tích rõ tính khả thi: Không thể dùng Native Excel (do MS Excel là Win32 process độc lập, không nhúng được vào WebView2 DOM để bắt sự kiện chuột và vẽ overlay, rủi ro COM lock khi edit ô) hay Google Sheets WebView2 (do yêu cầu đưa file lên Google Drive, không thể vẽ overlay màu do CORS).
  - Khẳng định giải pháp `SheetGrid` tự dựng (offline 100%, đọc pixel chính xác từ openpyxl, vẽ overlay $O(1)$, điều hướng bàn phím) là giải pháp tối ưu chuẩn công nghiệp.
- **Bước 3: Thiết kế lại Mapping cột (Không hiển thị mini sheet)**:
  - Bỏ hoàn toàn mini grid preview để mở rộng bảng ánh xạ cột ra toàn bộ chiều cao màn hình.
  - Hỗ trợ tình huống có nhiều sheet: Thanh lọc sheet (`#step3-sheet-filter-bar`) dạng pills cho phép xem tất cả hoặc lọc theo từng sheet.
  - Bảng mapping tích hợp dropdown chọn Bảng dữ liệu (Table / Result Set) và dropdown chọn Cột Database tương ứng, tự động nạp danh sách cột theo bảng đã chọn.
  - Tự động so khớp thông minh (`autoMatchColumns`) dựa trên độ tương đồng tên cột.
- **Bước 4: Thiết kế lại giao diện xuất file XML**:
  - Thanh tab trên cùng (`#step4-sheet-tabs`) hiển thị danh sách các Sheet Excel đã cấu hình.
  - Bố cục 2 panel cố định (Split View):
    - **Panel trái (270px):** 2 Card tùy chọn cố định gồm **Datasource XML** (`report_datasource.xml`) và **Layout XML** (`report_layout.xml`), có icon và mô tả thông tin tham số/cột.
    - **Panel phải (flex-1):** Thanh công cụ hiển thị tiêu đề file, badge dòng/kích thước, nút Sao chép, Lưu ra thư mục… và Tải về, cùng trình soạn thảo Monaco Editor hiển thị XML tương ứng.

---

## 3. Danh Sách Bài Kiểm Thử Đạt Chuẩn (100% Passed)

Toàn bộ 23 bài kiểm thử liên quan đến Report Gen, Multi-file, Multi-sheet Mapping, Window Creation và API Surface Snapshot đều vượt qua:

```bash
============================= test session starts =============================
tests/test_api_surface_snapshot.py::test_public_api_surface_matches_snapshot PASSED
tests/test_phase6_step3_windows.py::test_open_report_gen_window_creation PASSED
tests/test_report_gen_api.py::test_rg_get_connections_filters_sqlite PASSED
tests/test_report_gen_api.py::test_api_mixin_workflow PASSED
tests/test_report_gen_api.py::test_flask_routes_workflow PASSED
tests/test_report_gen_api.py::test_multi_file_api_mixin_workflow PASSED
tests/test_report_gen_api.py::test_multi_file_flask_routes_workflow PASSED
tests/test_report_gen_api.py::test_multi_sheet_mapping_and_build_workflow PASSED
tests/test_report_gen_builder.py::test_golden_report_layout_structure PASSED
tests/test_report_gen_datasource.py::test_build_report_datasource_xml_matches_fixture PASSED
tests/test_report_gen_mapper.py::test_layout_reader PASSED
tests/test_report_gen_mapper.py::test_apply_column_mapping_rename PASSED
tests/test_report_gen_mapper.py::test_apply_column_mapping_name_tag PASSED
tests/test_report_gen_reader.py::test_list_sheets PASSED
tests/test_report_gen_reader.py::test_read_sheet PASSED
tests/test_report_gen_shape.py::test_clean_identifier PASSED
tests/test_report_gen_shape.py::test_extract_columns_from_select_clause PASSED
tests/test_report_gen_shape.py::test_parse_sql_server_selects_with_temp_table PASSED
tests/test_report_gen_shape.py::test_parse_postgres_cursors PASSED
tests/test_report_gen_units.py::test_excel_width_to_px PASSED
tests/test_report_gen_units.py::test_pt_to_px PASSED
tests/test_report_gen_userdata.py::test_userdata_generator_uniqueness PASSED
tests/test_report_gen_userdata.py::test_userdata_generator_determinism PASSED
===================== 23 passed, 1414 deselected in 3.45s =====================
```
