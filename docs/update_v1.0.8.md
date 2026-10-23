# Tài Liệu Cập Nhật Thay Đổi — LLTool IDE v1.0.8 (So với v1.0.7)

> **Ngày phát hành**: 21/10/2026  
> **Phiên bản trước**: `v1.0.7` (21/10/2026)  
> **Phiên bản hiện tại**: `v1.0.8` (Smart IDE — Modern Syntax, Semantic Engine & Quick-Fix)

---

## 1. Tóm Tắt Tổng Quan Các Thay Đổi Chính

Phiên bản **v1.0.8** là bước nhảy vọt biến LLTool thành **"Smart IDE"**, tập trung vào hệ thống phân tích cú pháp và ngữ nghĩa chuyên sâu (Syntax & Semantic Validation), bộ quy tắc cảnh báo thực hành tốt nhất (Best-Practice Rules) và cơ chế tự động sửa lỗi (Monaco Quick-Fix CodeAction Provider):

| STT | Trọng tâm | Chi tiết |
|---|---|---|
| **1** | **Best-Practice Warning Rules (BP001 - BP006)** | Động cơ phân tích cảnh báo thông minh: `BP001` (`SELECT *`), `BP002` (`(NOLOCK)`), `BP003` (thiếu schema qualification), `BP004` (`TOP N` không có `ORDER BY`), `BP005` (`ISNULL`), `BP006` (`CONVERT` 2 đối số). |
| **2** | **Monaco Quick-Fix CodeAction Provider** | Hỗ trợ bóng đèn Lightbulb / `Alt + Enter` tự động sửa code: Xóa `(NOLOCK)`, chuyển `ISNULL` sang ANSI `COALESCE`, chuyển `CONVERT` sang ANSI `CAST`. |
| **3** | **Statement-Level Syntax Caching (5s TTL)** | Cache kiểm tra cú pháp cấp câu lệnh với khóa SHA-256, LRU eviction thread-safe, tự động xóa cache ngay khi người dùng thực thi DDL (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`). |
| **4** | **Hoàn thiện Milestone B2 (Semantic Analyzer)** | Kết nối thông suốt ScriptDOM parser và Semantic Analyzer, phát hiện chính xác `SQL_INVALID_COLUMN` trên Table Variables (`@Employees`), CTEs (`WITH ... AS`), và Temp Tables (`#TempOrders`). |
| **5** | **Khối `EXCEPTION WHEN` trong PL/pgSQL** | Hỗ trợ đầy đủ khối xử lý lỗi `EXCEPTION WHEN` trong Function/Procedure PL/pgSQL mà không làm lệch ngăn xếp `BEGIN ... END;`. |
| **6** | **Theo dõi vòng lặp `FOR ... LOOP` (PL/pgSQL)** | Nhận diện chính xác vòng lặp `FOR ... LOOP`, phân biệt rõ ràng với mệnh đề khóa hàng `SELECT ... FOR UPDATE`. |
| **7** | **Điều hướng an toàn câu lệnh `CALL` (PostgreSQL)** | Điều hướng câu lệnh gọi thủ tục `CALL procedure(...)` sang phân tích offline an toàn (zero side-effect, không gọi qua `EXPLAIN`). |
| **8** | **Cặp khối `TRY ... CATCH` trong T-SQL** | Bổ sung bộ theo dõi cấu trúc khối `BEGIN TRY ... END TRY ... BEGIN CATCH ... END CATCH` trong offline validator T-SQL. |
| **9** | **Tối ưu vị trí Token Position** | Hàm dùng chung `_compute_token_position()` tính toán chính xác dòng/cột của token có lỗi, loại bỏ trùng lặp mã nguồn. |

---

## 2. Chi Tiết Các Tính Năng Mới & Nâng Cấp

### 2.1. Động cơ Best-Practice Rules (`app/database/syntax/best_practice_rules.py`)

Hệ thống cung cấp các khuyến nghị kỹ thuật theo chuẩn chuyên gia cơ sở dữ liệu:

- **`BP001` (`warning`) — Tránh sử dụng `SELECT *`**:
  - *Lý do*: `SELECT *` làm suy giảm hiệu năng do truyền tải dữ liệu thừa qua mạng, tăng tải disk I/O, và dễ phát sinh lỗi khi cấu trúc bảng thay đổi.
  - *Ngoại trừ an toàn*: Bỏ qua các biểu thức `COUNT(*)`, `COUNT_BIG(*)` hoặc truy vấn con kiểm tra tồn tại `EXISTS (SELECT * ...)`.
- **`BP002` (`warning`) — Tránh gợi ý khóa bảng `(NOLOCK)` trong T-SQL**:
  - *Lý do*: Gợi ý bảng `(NOLOCK)` (hoặc `READUNCOMMITTED`) có nguy cơ gây đọc dữ liệu chưa commit (dirty read), đọc trùng dòng dữ liệu (duplicate row read) hoặc bỏ sót dòng khi chỉ mục bị tách trang (page split).
- **`BP003` (`hint`) — Chỉ định rõ Schema Qualification**:
  - *Lý do*: Viết `FROM dbo.Users` thay vì `FROM Users` giúp SQL Server / PostgreSQL bỏ qua bước phân giải schema động (Name Resolution), tối ưu hóa việc tái sử dụng Execution Plan trong Plan Cache.
  - *Ngoại trừ an toàn*: Bỏ qua bảng tạm (`#temp`, `##temp`), biến bảng (`@tbl`), các CTE đã khai báo trong mệnh đề `WITH`, và subquery alias.
- **`BP004` (`warning`) — `TOP N` bắt buộc phải đi kèm `ORDER BY`**:
  - *Lý do*: Lệnh `SELECT TOP N ...` không có mệnh đề `ORDER BY` sẽ trả về tập kết quả không tất định (non-deterministic), dữ liệu có thể thay đổi tùy thuộc vào vị trí quét vật lý của storage engine.
- **`BP005` (`hint`) — Chuẩn hóa `ISNULL` sang ANSI `COALESCE`**:
  - *Lý do*: Hàm `ISNULL(a, b)` là hàm độc quyền của T-SQL, trong khi `COALESCE(a, b)` là hàm tiêu chuẩn ANSI SQL và có khả năng tương thích cao hơn trên nhiều hệ quản trị CSDL.
- **`BP006` (`hint`) — Chuẩn hóa `CONVERT` (2 đối số) sang ANSI `CAST`**:
  - *Lý do*: Khi hàm `CONVERT(datatype, expr)` không sử dụng đối số style định dạng thứ 3, việc chuyển đổi sang cú pháp chuẩn `CAST(expr AS datatype)` tăng tính tường minh và tuân thủ ANSI SQL.

> **Cơ chế Mask SQL Strings & Comments**:
> Hàm `_mask_sql_strings_and_comments()` thay thế toàn bộ ký tự trong comment (`-- ...`, `/* ... */`) và chuỗi (`'...'`) bằng dấu cách nhưng bảo toàn chính xác độ dài ký tự và vị trí xuống dòng `\n`. Nhờ đó, 100% token tìm thấy trên chuỗi đã mask đều có chỉ số dòng/cột khớp chính xác với mã SQL gốc.

---

### 2.2. Monaco Quick-Fix CodeAction Provider (`static/js/syntax-check/quick-fix-provider.js`)

Tích hợp trực tiếp vào Monaco Editor:
- Khi con trỏ chuột dừng trên từ khóa có cảnh báo hoặc nhấn tổ hợp phím **`Alt + Enter`**, bóng đèn gợi ý (Lightbulb) sẽ xuất hiện:
  1. Với **`BP002`**: Gợi ý **"Xóa gợi ý bảng (NOLOCK)"** $\rightarrow$ Tự động xóa chuỗi `(NOLOCK)` hoặc `WITH (NOLOCK)`.
  2. Với **`BP005`**: Gợi ý **"Chuyển đổi thành chuẩn ANSI COALESCE"** $\rightarrow$ Tự động đổi `ISNULL(...)` thành `COALESCE(...)`.
  3. Với **`BP006`**: Gợi ý **"Chuyển thành chuẩn ANSI CAST(... AS ...)"** $\rightarrow$ Tự động phân tích 2 đối số và biến đổi cú pháp `CONVERT(T, X)` thành `CAST(X AS T)`.
- Phân biệt màu sắc trực quan:
  - **Lỗi cú pháp (Error)**: Gạch lượn sóng đỏ đậm.
  - **Cảnh báo (Warning)**: Gạch lượn sóng vàng cam.
  - **Gợi ý (Hint / Info)**: Dấu chấm hoặc gạch mờ màu xanh dương.

---

### 2.3. Statement-Level Syntax Caching (`app/database/syntax/coordinator.py`)

- **Thời gian sống (TTL)**: 5.0 giây.
- **Khóa Cache**: Băm SHA-256 từ `(sql + dialect + connection_id + database + schema + is_debug + include_best_practice)`.
- **An toàn luồng**: Được bao bọc bởi `threading.Lock()` và thuật toán tự động giải phóng LRU (khi đạt 512 entries).
- **DDL Invalidation Hook**: Trong [`app/routes/query.py`](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/app/routes/query.py), khi người dùng thực thi thành công một câu lệnh DDL (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`), hàm `invalidate_syntax_cache(connection_id)` sẽ tự động được kích hoạt để xóa sạch cache, đảm bảo không bị hiện tượng cache cũ.

---

### 2.4. Hoàn Thiện Milestone B2 & Roadmap Syntax Phase A

- **B2 (Semantic Analyzer integration)**:
  - Khi adapter ScriptDOM hoàn thành việc kiểm tra cú pháp T-SQL, `coordinator.py` ngay lập tức chuyển tiếp đến `analyze_sql_semantics()`.
  - Bắt chính xác lỗi cột không tồn tại (`SQL_INVALID_COLUMN`) trên biến bảng (`@table`), CTE (`WITH cte AS`), bảng tạm (`#temp`) và bảng vật lý trong bộ nhớ cache client.
- **A1 (PostgreSQL EXCEPTION WHEN)**:
  - Khối `EXCEPTION WHEN` trong PL/pgSQL không làm đóng khối `BEGIN` cha, bảo vệ cấu trúc lồng nhau của Function không bị báo sai `Unmatched END`.
- **A2 (PostgreSQL FOR ... LOOP)**:
  - Bộ tokenizer ghi nhận cờ `for_pending` khi gặp `FOR`, và đẩy khối lặp vào `loop_stack` khi gặp `LOOP` tiếp theo; không coi `SELECT ... FOR UPDATE` là vòng lặp.
- **A3 (PostgreSQL CALL procedure)**:
  - Câu lệnh `CALL procedure(...)` được nhận diện và điều hướng sang offline validator, tuyệt đối không gửi qua lệnh `EXPLAIN` tránh lỗi phân tích trên server live.
- **C2 (T-SQL TRY ... CATCH tracking)**:
  - Theo dõi cặp khối `BEGIN TRY ... END TRY` và `BEGIN CATCH ... END CATCH` trong offline validator T-SQL.

---

## 3. Danh Sách Các File Thay Đổi & Tạo Mới

| File | Trạng thái | Mô tả chi tiết |
|---|---|---|
| `app/version.py` | Cập nhật | Nâng `__version__ = "1.0.8"` và `__version_tuple__ = (1, 0, 8)`. |
| `version.json` | Cập nhật | Đồng bộ metadata release `v1.0.8`, release notes, SHA256 và kích thước file. |
| `CHANGELOG.md` | Cập nhật | Bổ sung mục `## [v1.0.8] — 21/10/2026`. |
| `docs/update_v1.0.8.md` | Tạo mới | Tài liệu chi tiết các thay đổi và tính năng mới trong bản v1.0.8. |
| `app/database/syntax/best_practice_rules.py` | Tạo mới | Động cơ kiểm tra Best-Practice Rules (BP001 - BP006) và hàm mask SQL string/comment. |
| `app/database/syntax/coordinator.py` | Cập nhật | Tích hợp Statement-level caching (5s TTL), B2 semantic verification, và Best-Practice Rules. |
| `app/database/syntax/validator_mssql.py` | Cập nhật | Trích xuất `_compute_token_position()` và bổ sung `_find_all_tsql_try_catch_blocks()`. |
| `app/database/syntax/validator_pg.py` | Cập nhật | Điều hướng lệnh `CALL` sang offline parser an toàn. |
| `app/database/syntax/adapters/postgresql_adapter.py` | Cập nhật | Hỗ trợ khối `EXCEPTION WHEN` và theo dõi vòng lặp `FOR ... LOOP`. |
| `app/routes/query.py` | Cập nhật | Tích hợp DDL Invalidation Hook và truyền cờ `include_best_practice` vào syntax-check API. |
| `static/js/syntax-check/diagnostic-model.js` | Cập nhật | Hỗ trợ ánh xạ `severity: 'hint'` sang `monaco.MarkerSeverity.Hint`. |
| `static/js/syntax-check/syntax-check-service.js` | Cập nhật | Bảo toàn trường `d.source` (ví dụ: `best-practice`, `semantic`). |
| `static/js/syntax-check/quick-fix-provider.js` | Tạo mới | Monaco CodeAction Provider cho các quick-fix: BP002, BP005, BP006. |
| `templates/index.html` | Cập nhật | Nhúng `quick-fix-provider.js` vào pipeline frontend. |
| `scripts/package_release.py` | Cập nhật | Cập nhật `VERSION = "1.0.8"` và hướng dẫn release notes v1.0.8. |
| `tests/test_syntax_sprint3.py` | Tạo mới | Bộ kiểm thử tự động cho B2, C1 (BP001 - BP006) và C3 (Cache & Invalidation) (13/13 Passed). |
| `tests/test_syntax_phase_a_roadmap.py` | Tạo mới | Bộ kiểm thử tự động cho Phase A roadmap (A1, A2, A3, B1, C2) (16/16 Passed). |

---

## 4. Hướng Dẫn Nâng Cấp Lên v1.0.8

### Cách 1: Nâng cấp tại chỗ bằng gói Patch (`LLTool_v1.0.8_patch.zip` — Khuyên dùng)
1. Tải file `LLTool_v1.0.8_patch.zip`.
2. Tắt ứng dụng LLTool IDE nếu đang chạy.
3. Giải nén toàn bộ nội dung của file `LLTool_v1.0.8_patch.zip` đè trực tiếp vào thư mục cài đặt hiện tại của LLTool IDE (ví dụ: `dist/LLTool/`).
4. Khởi động lại `LLTool.exe` để trải nghiệm các tính năng Smart IDE mới.

### Cách 2: Sử dụng gói cài đặt đầy đủ (`LLTool_v1.0.8.zip`)
1. Tải về và giải nén file `LLTool_v1.0.8.zip` vào một thư mục mới tùy ý.
2. Chạy trực tiếp `LLTool.exe` để sử dụng ngay mà không cần cài đặt. Toàn bộ cấu hình kết nối và lịch sử truy vấn vẫn được lưu trữ nguyên vẹn tại `%APPDATA%\LLTool`.
