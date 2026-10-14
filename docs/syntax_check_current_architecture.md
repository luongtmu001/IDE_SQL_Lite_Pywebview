# BÁO CÁO KHẢO SÁT KIẾN TRÚC HỆ THỐNG SYNTAX CHECK HIỆN TẠI
*(syntax_check_current_architecture.md — Hoàn thành theo Giai đoạn 1 & Mục 14.1 của .SKILL/SQL_Syntax_Check_Parser_Extension.md)*

---

## 1. Tổng quan Kiến trúc Hệ thống Hiện tại

Hệ thống SQL Syntax Check hiện tại của IDE-SQL-Lite hoạt động theo mô hình lai (Hybrid):
1. **Frontend (Monaco Editor / JavaScript):** Quản lý trạng thái nhập liệu, debounce (500ms), hủy tác vụ cũ (AbortController), quản lý theo Tab (Tab isolation), ánh xạ tọa độ token (`expandTokenRange`) và hiển thị Monaco Markers với owner cố định `'syntax-check'`.
2. **Backend (Python / Flask / PyWebView):** Cung cấp API `POST /api/query/syntax-check`.
3. **Cơ chế kiểm tra cú pháp (Validator Core):**
   - **SQL Server:** Ưu tiên live parse qua ODBC với lệnh `SET PARSEONLY ON` (bọc trong transaction an toàn, không thực thi dữ liệu). Nếu mất kết nối hoặc kết nối bận (Lock busy), fallback về offline parser `sqlglot` (dialect `tsql`).
   - **PostgreSQL:** Ưu tiên live parse qua psycopg2 với khối `BEGIN ... ROLLBACK;`. Vị trí lỗi được trích xuất từ thuộc tính `statement_position` của PostgreSQL driver. Nếu mất kết nối, fallback về `sqlglot` (dialect `postgres`).
   - **Semantic Analyzer:** Phân tích ngữ nghĩa bổ trợ (kiểm tra tồn tại của cột trong Bảng vật lý, Table variable `@tbl`, Bảng tạm `#temp`, và CTEs `WITH cte`).

---

## 2. Sơ đồ Luồng Thực tế (Actual Call Flow)

```text
[Người dùng gõ code trên Monaco Editor]
         │
         ▼
[model.onDidChangeContent] 
         │ (debounce 500ms, AbortController hủy request đang chạy của Tab)
         ▼
[SqlSyntaxCheckService.scheduleCheck]
         │ 
         ├─ Trích xuất metadata bảng từ client cache (AppMetadataCache)
         ├─ Xác định Dialect: 'sqlserver' hoặc 'postgresql' từ TabState / ConnectionManager
         ├─ Xác định trạng thái Debug (nếu PostgreSQL) để mask các hàm bs.*
         ▼
[Fetch POST /api/query/syntax-check]
         │
         ▼
[app.routes.query.syntax_check()]
         │ (Lấy connection_session nếu có, nếu busy/lỗi -> fallback offline an toàn)
         ▼
[app.database.syntax.validator.validate_sql()]
         │
    ┌────┴───────────────────────────────────────────────────────┐
    │ Dialect = SQL Server                                      │ Dialect = PostgreSQL
    ▼                                                           ▼
[validate_sql_server()]                                     [validate_postgresql()]
 ├─ split_sqlserver_batches (tách batch 'GO')                ├─ mask_debug_extensions_for_validation (nếu debug)
 ├─ Live ODBC: SET PARSEONLY ON                              ├─ Live psycopg2: BEGIN ... ROLLBACK
 └─ Fallback: _validate_with_sqlglot(dialect="tsql")         └─ Fallback: _validate_with_sqlglot(dialect="postgres")
    └─ _find_all_empty_select_tokens                            └─ _find_all_empty_select_tokens
    └─ _find_all_trailing_comma_tokens                          └─ _find_all_trailing_comma_tokens
    └─ _find_all_missing_join_tokens                            └─ _find_all_missing_join_tokens
         │                                                           │
         └───────────────────────────┬───────────────────────────────┘
                                     │
                                     ▼
                   [analyze_sql_semantics()]
                    ├─ Kiểm tra Table Variables (@tbl)
                    ├─ Kiểm tra Temporary Tables (#temp, ##temp, CREATE TEMP TABLE)
                    ├─ Kiểm tra CTEs (WITH cte AS (...))
                    └─ Kiểm tra Physical Tables (từ cache/metadata)
                                     │
                                     ▼
                 [Hợp nhất & Deduplicate Diagnostics]
                                     │
                                     ▼
                [JSON Response: { success: true, diagnostics }]
                                     │
                                     ▼
            [SqlSyntaxCheckService nhận kết quả]
             ├─ Kiểm tra Stale Request (requestId === _latestRequestId)
             ├─ expandTokenRange (mở rộng gạch lượn sóng token)
             ├─ SqlDiagnosticModel.createDiagnostic -> toMonacoMarker
             ├─ monaco.editor.setModelMarkers(model, 'syntax-check', markers)
             ├─ deltaDecorations (vẽ highlight warning cột không tồn tại)
             └─ EditorStatusBar.updateIssues() (cập nhật đếm lỗi trên status bar)
```

---

## 3. Danh sách Toàn bộ File Liên quan đến Syntax Check

### 3.1. Frontend Modules
| File | Đường dẫn | Trách nhiệm |
|---|---|---|
| `syntax-check-service.js` | [syntax-check-service.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/syntax-check/syntax-check-service.js) | Điều phối kiểm tra cú pháp, debounce, hủy request cũ, quản lý isolation theo tab, gọi API, gắn marker vào Monaco model. |
| `diagnostic-model.js` | [diagnostic-model.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/syntax-check/diagnostic-model.js) | Định nghĩa cấu trúc `Diagnostic`, chuẩn hóa severity (`error`, `warning`, `info`), convert sang Monaco Marker format. |
| `position-mapper.js` | [position-mapper.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/syntax-check/position-mapper.js) | Tính toán offset <-> line/column, mở rộng phạm vi từ khóa/token (`expandTokenRange`) để Monaco vẽ gạch lượn sóng rõ nét. |
| `monaco-init.js` | [monaco-init.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/monaco-init.js) | Cấu hình Monaco AMD loader (phiên bản Monaco: **0.52.2**), thiết lập theme `ide-dark` và `ide-light`. |
| `monaco-sql-lang.js` | [monaco-sql-lang.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/monaco-sql-lang.js) | Đăng ký ngôn ngữ `sql`, cấu hình Monarch tokenizer (keywords, operators, auto-closing pairs). |
| `editor.js` | [editor.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/editor.js) | Bắt sự kiện tạo editor (`AppEditor`, `AppEditor2`), attach `SqlSyntaxCheckService`, context menu toggle, cập nhật `EditorStatusBar.updateIssues`. |
| `query.js` | [query.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/query.js) | Bắt nút Parse (`#ide-btn-parse`), phím tắt `Ctrl+F5` gọi `checkSqlSyntax()`. |
| `settings.js` | [settings.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/settings.js) | Toggle bật/tắt Syntax Check trong Settings UI (`editor.syntaxCheck`). |
| `index.html` | [index.html](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/templates/index.html) | Nhúng các thẻ script và định nghĩa nút `#ide-btn-parse`, container `#monaco-sql-editor`. |

### 3.2. Backend Modules
| File | Đường dẫn | Trách nhiệm |
|---|---|---|
| `query.py` | [app/routes/query.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/app/routes/query.py) | Định nghĩa endpoint `POST /api/query/syntax-check`, giải quyết session kết nối, gọi validator. |
| `validator.py` | [app/database/syntax/validator.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/app/database/syntax/validator.py) | Core validator: `validate_sql`, `validate_sql_server`, `validate_postgresql`, `split_sqlserver_batches`, `_validate_with_sqlglot`, masking debug functions. |
| `semantic_analyzer.py` | [app/database/syntax/semantic_analyzer.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/app/database/syntax/semantic_analyzer.py) | Phân tích ngữ nghĩa: trích xuất `@table_variable`, `#temp_table`, CTEs, kiểm tra tính hợp lệ của danh sách cột trong physical tables. |
| `instrumenter.py` | [app/database/debug/instrumenter.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/app/database/debug/instrumenter.py) | Cung cấp `detect_debug_extensions` giúp nhận diện và mask các hàm debug `bs.*` khi kiểm tra cú pháp PostgreSQL. |

### 3.3. Test Modules
| File | Đường dẫn | Số test case | Trạng thái |
|---|---|---|---|
| `test_syntax_check.py` | [tests/test_syntax_check.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/tests/test_syntax_check.py) | 16 | PASSED |
| `test_semantic_syntax_check.py` | [tests/test_semantic_syntax_check.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/tests/test_semantic_syntax_check.py) | 10 | PASSED |
| `test_syntax_check_regression_fix.py` | [tests/test_syntax_check_regression_fix.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/tests/test_syntax_check_regression_fix.py) | 4 | PASSED |
| **Tổng cộng Baseline** | | **30 tests** | **100% OK (0.11s)** |

---

## 4. Danh mục Tính năng & Custom Rules Hiện có

| Nhóm Tính Năng | File xử lý | Hàm / Quy tắc | Hỗ trợ Dialect | Test hiện có | Giới hạn đã biết |
|---|---|---|---|---|---|
| **Tách Batch `GO`** | `validator.py` | `split_sqlserver_batches` | T-SQL | Có test đầy đủ (5 tests) | Tách đúng standalone GO, bỏ qua GO trong comment hoặc string. |
| **T-SQL Live Parse** | `validator.py` | `validate_sql_server` (`SET PARSEONLY ON`) | T-SQL | Có mock test | Đòi hỏi kết nối DB đang hoạt động; lặp tối đa 5 lỗi bằng cách mask dòng lỗi (`/* err */ SELECT 1;`). |
| **Procedure Line Offset** | `validator.py` | Regex `Procedure <name>, Line <N>` | T-SQL | Có test | Bù trừ số dòng định nghĩa stored procedure vào dòng lỗi tương đối. |
| **Postgres Live Parse** | `validator.py` | `validate_postgresql` (`BEGIN...ROLLBACK`) | PostgreSQL | Có mock test | Dùng `statement_position` để tính dòng/cột. Rollback đảm bảo không lưu side-effect. |
| **Debug Mode Masking** | `validator.py` | `mask_debug_extensions_for_validation` | PostgreSQL | Có test | Mask hàm `bs.*` thành khoảng trắng/comment để không bị báo lỗi ngoài debug mode. |
| **Empty SELECT Check** | `validator.py` | `_find_all_empty_select_tokens` | T-SQL + Postgres | Có test | Kiểm tra token sau SELECT bị thiếu biểu thức (ví dụ: `SELECT FROM table`). |
| **JOIN missing ON** | `validator.py` | `_find_all_missing_join_tokens` | T-SQL + Postgres | Có test | Kiểm tra các JOIN (ngoại trừ CROSS/NATURAL) thiếu mệnh đề ON/USING. |
| **Trailing Comma** | `validator.py` | `_find_all_trailing_comma_tokens` | T-SQL + Postgres | Có test | Phát hiện dấu phẩy thừa trước FROM, WHERE, `)`, `;`. |
| **Fallback sqlglot** | `validator.py` | `_validate_with_sqlglot` | T-SQL + Postgres | Có test | Dùng khi không có kết nối DB. Bị hạn chế nặng ở cú pháp procedural T-SQL và PL/pgSQL. |
| **Table Variable Cols** | `semantic_analyzer.py` | `extract_table_variables` | T-SQL | Có test (2 tests) | Nhận diện cột khai báo trong `DECLARE @tbl TABLE (...)`. |
| **Temp Table Cols** | `semantic_analyzer.py` | `extract_temporary_tables` | T-SQL + Postgres | Có test (3 tests) | Nhận diện `#temp`, `##temp`, `CREATE TEMP TABLE`, `SELECT ... INTO #temp`. |
| **CTE Projections** | `semantic_analyzer.py` | `extract_ctes` | T-SQL + Postgres | Có test (2 tests) | Nhận diện cột trong `WITH cte (col1, col2) AS (...)` hoặc qua SELECT alias. |
| **Physical Table Cols** | `semantic_analyzer.py` | `analyze_sql_semantics` | T-SQL + Postgres | Có test | Cảnh báo cột không tồn tại (`SQL_INVALID_COLUMN`) dựa trên client/metadata cache. |
| **Monaco Markers** | `syntax-check-service.js` | `executeCheck` | Chung | Có test tích hợp | Đặt marker với owner `'syntax-check'`, cập nhật decoration underline cho invalid column. |
| **Debounce & Hủy request** | `syntax-check-service.js` | `scheduleCheck` (500ms) | Chung | Có test | Dùng `AbortController` và `_latestRequestId` chống ghi đè kết quả lỗi thời. |
| **Cô lập Tab** | `syntax-check-service.js` | `handleTabClosed` | Chung | Có test | Hủy timer và request khi đóng tab; mỗi tab model độc lập. |

---

## 5. Các Giới Hạn Đã Biết của Hệ thống Hiện tại (Known Limitations)

1. **Sự phụ thuộc vào Kết nối Live:**
   - Hệ thống hiện tại phụ thuộc chủ yếu vào live parse của Database (`SET PARSEONLY ON` cho SQL Server và `BEGIN...ROLLBACK` cho PostgreSQL).
   - Khi không có kết nối hoặc kết nối đang bận thực thi query khác, hệ thống bắt buộc fallback về `sqlglot`.
2. **Hạn chế của `sqlglot` khi kiểm tra Offline:**
   - **T-SQL:** `sqlglot` không phân tích chuẩn xác các câu lệnh procedural T-SQL phức tạp: khối `BEGIN...END` lồng nhau, `CROSS APPLY` / `OUTER APPLY` kết hợp subquery, cú pháp XML (`.value()`, `.nodes()`), `TRY...CATCH` trong batch, dynamic SQL `EXEC()`.
   - **PostgreSQL:** `sqlglot` hoàn toàn không hỗ trợ phân tích thân hàm PL/pgSQL (`DO $$ BEGIN ... END $$`, cấu trúc rẽ nhánh `IF...THEN...ELSE`, vòng lặp `FOR/WHILE LOOP`, xử lý ngoại lệ `EXCEPTION WHEN`). Các khối này thường bị `sqlglot` báo lỗi sai (False Positive) hoặc phải bỏ qua.
3. **Độ chính xác của Token Range:**
   - ODBC driver và error message của SQL Server / PostgreSQL thường chỉ cung cấp số dòng và tên token gần nhất (`near 'xyz'`), không cung cấp chính xác `endColumn`.
   - Hệ thống hiện tại phải dùng giải thuật heuristic regex (`expandTokenRange`) trong JavaScript để tìm vị trí token trên dòng, có thể bị lệch nếu token xuất hiện nhiều lần trên cùng một dòng.
4. **Hiệu năng khi Script lớn:**
   - Cơ chế phát hiện nhiều lỗi của SQL Server hiện tại sử dụng vòng lặp thay thế dòng lỗi bằng `/* err */ SELECT 1;` và chạy lại `SET PARSEONLY ON` tối đa 5 lần. Việc này gửi nhiều round-trip tới database server cho mỗi lần gõ phím.

---

## 6. Kết luận & Khuyến nghị cho Giai đoạn tiếp theo (Phase 2)

* **Bảo toàn Code Cũ:** Toàn bộ file cũ (`validator.py`, `semantic_analyzer.py`, `syntax-check-service.js`, `diagnostic-model.js`, `position-mapper.js`) và 30 test case hiện có được giữ nguyên vẹn 100%.
* **Hướng đi cho Phase 2:**
  1. Thử nghiệm **Microsoft ScriptDOM** (thông qua `pythonnet>=3.0.0`) trong môi trường Python/Windows để đánh giá khả năng parse T-SQL tĩnh hoàn toàn offline với AST và vị trí lỗi chính xác (dòng, cột, token).
  2. Thử nghiệm **`dt-sql-parser` / `monaco-sql-languages`** cho dialect PostgreSQL và xác định rõ phạm vi hỗ trợ giữa SQL tiêu chuẩn và khối PL/pgSQL.
