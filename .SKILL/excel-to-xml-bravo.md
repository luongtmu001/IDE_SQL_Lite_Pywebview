# Kế hoạch triển khai chi tiết

Tính năng được xây thành một service mới `app/services/report_layout_gen/` cộng một API mixin, theo đúng khuôn các tính năng hiện có (Google Sheets, Table Designer). Ước tính tổng khoảng 14–18 ngày công cho 6 phase; phase 1–2 (đủ để sinh layout từ Excel, chưa cần DB) chiếm khoảng 7 ngày.

## Hiện trạng codebase

Mình đã đọc `app/`, `tests/`; thư mục `static/` và `templates/` (JS/HTML frontend) chưa được cấp quyền nên phần frontend dưới đây mô tả theo mẫu chung, cần khớp lại tên file.

| Thành phần có sẵn | Dùng cho | Ghi chú |
| --- | --- | --- |
| `app/api/*_api.py` (mixin, gọi qua `window.pywebview.api.*`) | Khuôn cho `ReportGenApiMixin` | Trả về `{"success": bool, ...}`; đăng ký trong `app/api/__init__.py` và lớp API của `app/desktop/windows.py` |
| `app/routes/*.py` (Flask blueprint, `create_app`) | Endpoint REST song song cho chế độ web | Blueprint mới `/api/report-gen` |
| `app/services/google_sheets/url_parser.py` (`parse_google_sheets_url`) | Tách `spreadsheetId` + `gid` từ link | Tái sử dụng nguyên |
| `GoogleSheetsService.fetch_remote_sheet_data` | Tham khảo cách tải | Đang export **CSV** → mất merge, độ rộng; cần hàm mới export **xlsx** |
| `ConnectionManager` + `conn.adapter` / `conn.metadata_service` | Lấy kết nối, chạy SQL | Adapter có: SQL Server, PostgreSQL, SQLite (chưa có MySQL) |
| `metadata_service.get_intellisense_parameters`, `adapter.get_routine_signatures`, `list_objects(type=procedures/functions)` | Liệt kê routine + tham số (IN/OUT) | Kiểm tra đã trả `mode`/`is_output` chưa; thiếu thì bổ sung |
| `app/bravo/xml_codec.py` (`beautify_xml_string`, `validate_xml_syntax`, `encode_xml_payload`) | Format + validate XML đầu ra | `encode_xml_payload` cho phép sau này ghi thẳng vào `B00LayoutData` |
| `BravoLayoutCompareService` + Layout Editor (`/api/bravo/layout-editor/*`) | Mở rộng tùy chọn: lưu layout sinh ra vào DB Bravo | Không nằm trong phạm vi bắt buộc |
| `tests/` (pytest, có `fixtures/`, `snapshots/`) | Golden test cho XML | Thêm `tests/fixtures/report_gen/` |

## Cấu trúc file mới

Lõi chuyển đổi là Python thuần (không import Flask/pywebview) để test độc lập; API mixin và blueprint chỉ là lớp vỏ mỏng.

```text
app/services/report_layout_gen/
  __init__.py            # export ReportLayoutGenService
  models.py              # dataclass: SheetModel, Cell, MergeRange, Region, HeaderMatrix, ResultShape, ColumnMapping, GenSession
  workbook_reader.py     # xlsx → SheetModel (openpyxl): ô, merge, width, height, page setup
  gsheet_importer.py     # link Google Sheet → tải xlsx (export?format=xlsx) → workbook_reader
  region_detector.py     # gợi ý vùng Title / Header / Summary / PageFooter
  units.py               # ký tự Excel → px, pt → px
  userdata.py            # sinh id 8 ký tự cho mỗi merge (seed được để test ổn định)
  layout_builder.py      # Region/HeaderMatrix → cây XML report_layout
  layout_reader.py       # đọc ngược layout XML → danh sách cột tự sinh + {=@_X}
  column_mapper.py       # áp mapping: đổi tên thẻ / thêm <Name>, thêm cột Visible=False
  datasource_builder.py  # routine + params → report_datasource.xml
  result_shape/
    __init__.py          # get_detector(conn)
    base.py              # ResultShapeDetector (ABC)
    parser.py            # bóc tách static SQL: SELECT columns, aliases, OPEN cursor
    postgresql.py        # metadata (RETURNS TABLE/OUT) + parse DDL refcursor
    sqlserver.py         # sp_describe_first_result_set (static) + parse DDL SELECT/#temp
    sqlite.py            # chỉ SELECT/view
  session_store.py       # giữ GenSession theo session_id (bộ nhớ + TTL)
  service.py             # ReportLayoutGenService: điều phối các bước wizard
app/api/report_gen_api.py   # ReportGenApiMixin (pywebview)
app/routes/report_gen.py    # Blueprint /api/report-gen (Flask)
static/js/report-gen/       # wizard UI (khớp theo cấu trúc static/ hiện có)
frontend/css/report-gen.css
tests/fixtures/report_gen/  # report.xlsx, report_layout.xml, report_datasource.xml
tests/test_report_gen_*.py
```

Phụ thuộc mới: `openpyxl` (nếu chưa có trong requirements). Không cần `lxml`: `xml.etree.ElementTree` + `beautify_xml_string` sẵn có là đủ.

## Mô hình dữ liệu & hợp đồng API

**Model chính** (`models.py`):

```python
@dataclass
class MergeRange:  min_row: int; min_col: int; max_row: int; max_col: int; user_data: str | None = None

@dataclass
class Cell:        row: int; col: int; value: str | None; merge: MergeRange | None; is_anchor: bool

@dataclass
class SheetModel:
    name: str; max_row: int; max_col: int
    cells: dict[tuple[int, int], Cell]
    merges: list[MergeRange]
    col_widths_px: dict[int, int]; row_heights_px: dict[int, int]
    page: dict  # paper, landscape, margins

@dataclass
class Region:      kind: Literal['title', 'header', 'summary', 'page_footer']; min_row: int; min_col: int; max_row: int; max_col: int

@dataclass
class ResultShape:
    result_sets: list[dict]   # [{index, name: 'Table0' | cursor, columns: [{name, type}]}]
    output_params: list[dict] # [{name: '_DocNo', type}]
    input_params: list[dict]  # [{name, type, default_expr}]

@dataclass
class GenSession:
    id: str; workbook_path: str; sheet: str | None
    regions: list[Region]; layout_xml: str | None
    connection_id: str | None; routine: dict | None; shape: ResultShape | None
    data_member: str | None; mapping: dict[str, str]  # 'Col_B' -> 'ItemName'
```

**API mixin** (`ReportGenApiMixin`, gọi từ JS `window.pywebview.api.rg_*`); Flask blueprint `/api/report-gen` bọc đúng các hàm này.

| Hàm mixin | Flask | Vào | Ra |
| --- | --- | --- | --- |
| `rg_open_file(path \| base64, filename)` | `POST /source` (multipart) | file xlsx | `{session_id, sheets: [{name, dimension, merge_count}]}` |
| `rg_open_gsheet(url)` | `POST /source` (`{url}`) | link Google Sheet | như trên |
| `rg_get_sheet(session_id, sheet)` | `GET /{sid}/sheet/{name}` | – | SheetModel dạng JSON (giới hạn 200 dòng × 50 cột) + `suggested_regions` |
| `rg_set_regions(session_id, regions)` | `PUT /{sid}/regions` | 2–4 Region | `{layout_xml, columns: ['Col_A', …], warnings}` |
| `rg_list_routines(connection_id, database, schema, search)` | `GET /routines` | – | `[{schema, name, kind}]` |
| `rg_describe_routine(session_id, connection_id, routine)` | `POST /{sid}/describe` | routine | ResultShape |
| `rg_apply_mapping(session_id, data_member, mapping, mode)` | `PUT /{sid}/mapping` | `mode`: `rename` \| `name_tag` | `{layout_xml, warnings}` |
| `rg_build(session_id)` | `POST /{sid}/build` | – | `{layout_xml, datasource_xml}` (đã beautify + validate) |
| `rg_save_files(session_id, folder)` | – (desktop) | thư mục | ghi 2 file XML |

Mọi hàm trả `{"success": False, "error": "<tiếng Việt>"}` khi lỗi, giống các mixin hiện có.

## Các phase triển khai

6 phase làm tuần tự; phase 3 (Google Sheet) có thể làm song song với phase 4. Mỗi phase kết thúc bằng test xanh và một bản dùng được.

| Phase | Mục tiêu | Ước tính | Tiêu chí xong |
| --- | --- | --- | --- |
| 0. Chuẩn bị | Khung module, fixture, model | 0.5 ngày | `pytest tests/test_report_gen_*` chạy được (rỗng) |
| 1. Lõi Excel → XML | Sinh report\_layout.xml từ report.xlsx + vùng cho trước | 4 ngày | Golden test khớp cấu trúc report\_layout.xml mẫu |
| 2. Wizard không DB | Upload → chọn sheet → khoanh vùng → xem/tải XML | 3 ngày | User tự sinh layout trong IDE không cần connection |
| 3. Google Sheet | Dán link → cùng luồng phase 2 | 1.5 ngày | Sheet công khai chạy; sheet riêng tư báo lỗi rõ ràng |
| 4. Routine & datasource | Chọn routine, detect Table/cursor + OUTPUT, map cột, sinh datasource | 4 ngày | Xuất cặp XML hợp lệ với PostgreSQL và SQL Server |
| 5. Hoàn thiện | Gợi ý vùng, PrintSettings, validate, hiệu năng | 2 ngày | Chạy được với 3 mẫu Excel thật khác nhau |

### Phase 0 – Chuẩn bị

- [x] Tạo `app/services/report_layout_gen/` với các file rỗng như cây ở trên; viết `models.py`.
- [x] Chép `report.xlsx`, `report_layout.xml`, `report_datasource.xml` vào `tests/fixtures/report_gen/`.
- [x] Thêm `openpyxl` vào requirements và cấu hình build (PyInstaller spec nếu có hidden-import).
- [x] Ghi lại trong fixture vùng chuẩn của mẫu: Title `A1:H7`, Header `A8:F9`, Summary `A12:H18`.

### Phase 1 – Lõi Excel → layout XML

- [x] `workbook_reader.py`: đọc sheet bằng `openpyxl.load_workbook(data_only=True)`; lấy `merged_cells.ranges`, `column_dimensions` (kể cả nhóm cột `min..max`), `row_dimensions`, `sheet_format.defaultColWidth/defaultRowHeight`, `page_setup`.
- [x] `units.py`: `excel_width_to_px(w) ≈ round(w * 7.2)`, `pt_to_px(h) = round(h * 4 / 3)`; kiểm chứng bằng mẫu (4.78 → 35, 50.22 → 362, 12.22 → 88, 19.8 → 27).
- [x] `userdata.py`: `new_id(rng)` 8 ký tự `[a-z0-9]`, không trùng trong một layout; nhận `random.Random(seed)` để test ổn định.
- [x] `layout_builder.build_content(sheet, header_region)`: `<Rows>` theo chiều cao; `<Cols><Col_X>` với `<Width>`, `<Rows><Row_i>` đủ n\_rows; ô gốc merge có `<Text><Vietnamese>`, ô con chỉ `<Style>UserData:id;</Style>`; không merge thì không có Style.
- [x] `layout_builder.build_band(sheet, region, tag)` dùng chung cho `<Title>`, `<Summary>`, `<PageFooter>`: `<autoFitRowHeight>None`, `<Rows>` + `<Cols><Column_k>`, chỉ sinh Row\_i có text/UserData; cột rộng nhất → `<Width>-1</Width>`.
- [x] `layout_builder.build_report(...)`: khung `root/panelReporter/Controls/Report_0`, `<DataMember>Table0`, `<ReportSetup>`, `<PrintSettings>` mặc định, `<bAutoHideEmptyAutoTextRows>False`; xuất qua `beautify_xml_string` + `validate_xml_syntax`.
- [x] Xử lý biên: merge cắt ngang vùng (cắt + warning), ô có xuống dòng, ký tự `&` `<`, cột ẩn trong Excel (bỏ qua), vùng rỗng.
- [x] Test: `test_report_gen_units.py`, `test_report_gen_builder.py` (golden so sánh cấu trúc: số Row, cặp cột chung UserData, text; bỏ qua giá trị id ngẫu nhiên).

### Phase 2 – Wizard (chưa cần DB)

- [x] `session_store.py`: dict `session_id → GenSession`, TTL 2 giờ, file tạm lưu dưới thư mục data của app (`app/utils/paths.py`).
- [x] `service.py` + `app/api/report_gen_api.py`: `rg_open_file`, `rg_get_sheet`, `rg_set_regions`, `rg_build`, `rg_save_files`; đăng ký mixin trong `app/api/__init__.py` và lớp API của cửa sổ chính.
- [x] `app/routes/report_gen.py`: blueprint `/api/report-gen` bọc các hàm trên; đăng ký trong `create_app`.
- [x] Frontend: mục menu/tab "Sinh Layout Bravo từ Excel"; bước 1 (kéo thả file / link Google Sheets), bước 2 (lưới `<table>` với `rowspan/colspan`, chiều rộng px; kéo chuột chọn vùng, 4 màu cho 4 loại vùng), bước 3 (Routine & map cột), bước 4 (xem XML + nút Tải/Sao chép).
- [x] Test: `test_report_gen_api.py` (gọi mixin với fixture), test route Flask bằng `app.test_client()`.

### Phase 3 – Google Sheet

- [x] `gsheet_importer.py`: `parse_google_sheets_url` → tải `https://docs.google.com/spreadsheets/d/{id}/export?format=xlsx` (toàn workbook để có danh sách sheet), timeout 15 giây, giới hạn 25 MB; chọn sẵn sheet theo `gid` nếu link có.
- [x] HTTP 401/403 → thông báo "Sheet riêng tư – chuyển quyền 'Bất kỳ ai có liên kết' hoặc tải file xlsx lên".
- [x] `rg_open_gsheet(url)`; frontend: ô dán link ở bước 1.

### Phase 4 – Routine, datasource, map cột (Phân tích tĩnh, không chạy DB)

- [x] `rg_list_routines`: dùng `adapter.list_objects(..., object_type='procedures' | 'functions')`.
- [x] Tham số: đọc qua `metadata_service.get_intellisense_parameters` / `get_routine_signatures`; bổ sung trường `mode` (IN/OUT/INOUT) nếu chưa có.
- [x] `result_shape/parser.py`: Bộ phân tích tĩnh cú pháp SQL (regex/token parser) bóc tách các mệnh đề `SELECT ...` cuối, alias `AS [ColName]` hoặc `AS ColName`, và các khối `OPEN <cur> FOR SELECT ...`.
- [x] `result_shape/postgresql.py`: `RETURNS TABLE`/OUT → đọc metadata từ catalog (`pg_proc`, `information_schema`); với `refcursor` → đọc source DDL từ `pg_proc.prosrc`, parse khối `OPEN <name> FOR SELECT` lấy danh sách cột. Tuyệt đối không gọi `SELECT fn(...)`.
- [x] `result_shape/sqlserver.py`: thử phân tích tĩnh bằng `sp_describe_first_result_set` (SQL Server engine phân tích metadata tĩnh, không chạy lệnh); nếu nhiều result set hoặc có bảng tạm `#temp` → đọc DDL từ `sys.sql_modules.definition`, parse các câu `SELECT` cuối hoặc khai báo bảng tạm. Tuyệt đối không chạy `EXEC`.
- [x] `datasource_builder.py`: `<root><Command>tên routine</Command><TableCollection><ParametersTable><DefaultValues>` mỗi tham số IN một thẻ; bảng tra biểu thức mặc định (`nUserId → USER('Id')`, `LangId → LANGID()`) đặt trong settings để mở rộng.
- [x] `layout_reader.py` + `column_mapper.py`: đọc cột `Col_*` từ layout, áp mapping theo `mode` (`rename` → đổi tên thẻ; `name_tag` → giữ thẻ + `<Name>`), thêm cột thừa với `<Visible>False`, set `<DataMember>`.
- [x] Frontend: tìm routine, danh sách Table/cursor, bảng map cột (auto-gợi ý theo tên tương ứng), danh sách OUTPUT param để chèn `{=@_X}` vào ô Title/Summary/PageFooter.
- [x] Test: unit test parser với các mẫu DDL procedure/function thực tế (SQL Server & PG).

### Phase 5 – Hoàn thiện

- [x] `region_detector.py`: Header = cụm dòng liền nhau có merge và nhiều ô chữ in hoa; dữ liệu mẫu = các dòng ngay sau có số; Title = trên Header; Summary = sau dữ liệu mẫu.
- [x] `<PrintSettings>` từ `ws.page_setup` (paperSize, orientation) và `ws.page_margins` (inch → px).
- [x] Validate tổng: tên thẻ XML hợp lệ/không trùng, mọi `{=@_X}` thuộc OUTPUT param, cột đã map tồn tại trong result set; hiển thị warning trong wizard.
- [x] Hiệu năng: sheet > 2.000 dòng chỉ trả 200 dòng đầu cho lưới preview; đọc với `read_only=False` (cần merge) nhưng giới hạn kích thước file.
- [ ] Thử với 3 mẫu Excel thật; viết hướng dẫn ngắn trong `docs/`.
- [ ] (Tuỳ chọn, sau) Nút "Lưu vào Bravo": ghi layout vào `B00LayoutData` qua `encode_xml_payload` + `BravoLayoutCompareService`.

## Test & quyết định kỹ thuật

**Kế hoạch test**

| Loại | File | Nội dung |
| --- | --- | --- |
| Unit | `test_report_gen_units.py` | Quy đổi width/height, sinh UserData không trùng |
| Unit | `test_report_gen_reader.py` | Đọc report.xlsx: 4 merge, chiều rộng/cao, text header |
| Golden | `test_report_gen_builder.py` | Content: 2 Row; BuiltinOrder/ItemName gộp dòng; 2 cặp cột gộp Row\_0; Row\_1 TẤN/BAO không UserData |
| Unit | `test_report_gen_mapper.py` | `rename` vs `name_tag`, cột Visible=False, DataMember |
| Unit | `test_report_gen_datasource.py` | Khớp report\_datasource.xml mẫu với `usp_B30AccDoc_VoucherFormSales` |
| Unit | `test_report_gen_shape.py` | Parser DDL tĩnh: trích xuất cột từ SQL Server proc (nhiều SELECT, #temp) và PG (refcursor, RETURNS TABLE) |
| API | `test_report_gen_api.py` | Luồng mixin đầy đủ + Flask `test_client` |
| Integration | `test_report_gen_integration.py` (`-m integration`) | PG + SQL Server thật, routine mẫu nhiều result set |

**Quyết định kỹ thuật**

- Golden test so sánh **cấu trúc** (thẻ, số Row, nhóm ô cùng UserData, text) chứ không so chuỗi XML, vì UserData ngẫu nhiên và mẫu có style (font, align) mà phase 1 chưa sinh.
- Google Sheet dùng export **xlsx** (giữ merge, width, height), không dùng CSV như `fetch_remote_sheet_data`.
- **An toàn DB tuyệt đối**: Hoàn toàn **không thực thi** routine (`EXEC`/`SELECT`). Toàn bộ cấu trúc bảng/cursor được trích xuất tĩnh qua metadata catalog và parser phân tích mã nguồn DDL SQL. Giao diện cho phép người dùng tự sửa/bổ sung cột nếu routine dùng dynamic SQL.
- Style ô (font, căn lề, `Format`) từ Excel để phase 5 trở đi, sau khi lõi ổn định.
- MySQL chưa có adapter trong IDE → ngoài phạm vi; SQLite chỉ hỗ trợ SELECT/view.
