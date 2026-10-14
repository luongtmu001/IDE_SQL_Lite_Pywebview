# KẾ HOẠCH CHUYỂN ĐỔI KIẾN TRÚC SYNTAX CHECK (MIGRATION PLAN)
*(syntax_check_migration_plan.md — Hoàn thành theo Giai đoạn 3 & Mục 14.3 của .SKILL/SQL_Syntax_Check_Parser_Extension.md)*

---

## 1. Kiến trúc Đích (Target Architecture)

Hệ thống Syntax Check mới được thiết kế theo mô hình **Adapter & Pipeline Pattern**, tách biệt rõ ràng giữa phân tích cú pháp tĩnh (Grammar Parser) và phân tích ngữ nghĩa (Semantic Analyzer):

```text
                  Monaco Editor (WebView2)
                            │ (gõ phím, debounce 500ms)
                            ▼
                  [SqlSyntaxCheckService]
                            │ (POST /api/query/syntax-check)
                            ▼
                  [Flask Route: query.py]
                            │
                            ▼
                 [SyntaxCheckCoordinator]
                            │
                            ▼
               [Database Dialect Resolver]
                            │
             ┌──────────────┴──────────────┐
             │                             │
             ▼                             ▼
    [SQL Server Adapter]          [PostgreSQL Adapter]
             │                             │
      (Microsoft ScriptDOM)      (Hybrid: Live Rollback / Parser)
             │                             │
             ▼                             ▼
    [Native Diagnostics]          [Native Diagnostics]
             │                             │
             └──────────────┬──────────────┘
                            │
                            ▼
              [Semantic Analyzer Layer]
               (Cột trong #temp, @tbl, CTE, Physical)
                            │
                            ▼
              [Diagnostics Deduplicator]
                            │
                            ▼
              [Diagnostics Mapper & JSON API]
                            │
                            ▼
               [Monaco Markers & Underlines]
```

---

## 2. Thiết kế Chi tiết các Module Mới & Sửa Đổi

### 2.1. Thư mục Module Mới: `app/database/syntax/adapters/`
Tạo package mới để chứa các adapter chuyên biệt, **không ghi đè hay sửa đổi `validator.py`**:

1. **`app/database/syntax/adapters/__init__.py`**:
   - Export các adapter chính và entrypoint `get_syntax_adapter(dialect)`.
2. **`app/database/syntax/adapters/base.py`**:
   - Lớp cơ sở `BaseSyntaxAdapter` định nghĩa contract:
     ```python
     class BaseSyntaxAdapter(ABC):
         @abstractmethod
         def validate(
             self,
             sql: str,
             connection_session: Any = None,
             database: str | None = None,
             schema: str | None = None,
             is_debug: bool = False
         ) -> list[dict[str, Any]]:
             pass
     ```
3. **`app/database/syntax/adapters/sqlserver_scriptdom.py`**:
   - Triển khai `SqlServerScriptDomAdapter`:
     - Nạp `Microsoft.SqlServer.TransactSql.ScriptDom.dll` qua `pythonnet`.
     - Sử dụng `TSql160Parser(initialQuotedIdentifiers=True)`.
     - Chuyển đổi toàn bộ `ParseError` thành cấu trúc chuẩn:
       `{ severity, message, code, line, column, end_column, token, offset, source: "sqlserver" }`.
     - **Tự động bọc Fallback An toàn:** Nếu môi trường thiếu DLL hoặc pythonnet gặp sự cố, tự động gọi fallback sang `validate_sql_server` trong `validator.py`.
4. **`app/database/syntax/adapters/postgresql_adapter.py`**:
   - Triển khai `PostgreSqlAdapter` theo mô hình Hybrid:
     - **Khi có kết nối DB:** Sử dụng Live Parse Transaction Rollback (`BEGIN ... ROLLBACK;`) với `statement_position` để bắt lỗi chính xác cả SQL chuẩn lẫn toàn bộ thân hàm PL/pgSQL (`DO $$`).
     - **Khi không có kết nối:** Sử dụng parser tĩnh offline kết hợp kiểm tra regex cấu trúc cơ bản.
     - **Debug mode:** Tích hợp bộ mask `detect_debug_extensions` từ `instrumenter.py` để bỏ qua lỗi hàm `bs.*`.
5. **`app/database/syntax/adapters/diagnostics_mapper.py`**:
   - Chuẩn hóa đầu ra, chuẩn hóa vị trí token và message lỗi.
   - Loại bỏ trùng lặp giữa lỗi cú pháp và lỗi ngữ nghĩa (Deduplication).

### 2.2. Module Điều phối: `app/database/syntax/coordinator.py`
* Hàm `validate_sql_pipeline(...)` kết hợp:
  1. Gọi Adapter tương ứng với dialect.
  2. Gọi `analyze_sql_semantics(...)` từ [semantic_analyzer.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/app/database/syntax/semantic_analyzer.py).
  3. Deduplicate và trả về kết quả.

---

## 3. Danh sách File và Quy tắc: Giữ nguyên vs. Ngừng gọi

### 3.1. Các File Cũ Được Giữ Nguyên 100% (Không Xóa, Không Sửa Làm Mất Logic)
* [app/database/syntax/validator.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/app/database/syntax/validator.py) (giữ nguyên làm fallback & reference).
* [app/database/syntax/semantic_analyzer.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/app/database/syntax/semantic_analyzer.py) (tái sử dụng trực tiếp trong pipeline mới).
* [static/js/syntax-check/syntax-check-service.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/syntax-check/syntax-check-service.js).
* [static/js/syntax-check/diagnostic-model.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/syntax-check/diagnostic-model.js).
* [static/js/syntax-check/position-mapper.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/syntax-check/position-mapper.js).
* Toàn bộ 3 file test baseline: [test_syntax_check.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/tests/test_syntax_check.py), [test_semantic_syntax_check.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/tests/test_semantic_syntax_check.py), [test_syntax_check_regression_fix.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/tests/test_syntax_check_regression_fix.py).

### 3.2. Phân loại Custom Rules

| Custom Rule | Trạng thái trong Luồng Mới | Lý do kỹ thuật |
|---|:---:|---|
| **Semantic Column Validator** | **TIẾP TỤC DÙNG (Active)** | Parser tĩnh không có metadata schema; `semantic_analyzer.py` là duy nhất phát hiện cột sai trong `#temp`, `@tbl`, CTE, physical tables. |
| **Mask debug `bs.*`** | **TIẾP TỤC DÙNG (Active)** | Đảm bảo PostgreSQL debug mode không bị báo lỗi sai ngoài ý muốn. |
| **expandTokenRange & Monaco Markers** | **TIẾP TỤC DÙNG (Active)** | Đảm bảo gạch chân lượn sóng hiển thị trực quan và đẹp mắt trên Monaco Editor. |
| **Tách batch `GO` thủ công (`split_sqlserver_batches`)** | **NGỪNG GỌI trong luồng T-SQL** | ScriptDOM hỗ trợ nhiều batch với `GO` natively, tính chính xác số dòng lỗi mà không cần cắt chuỗi thủ công. |
| **Iterative Dummy Masking (`/* err */ SELECT 1;`)** | **NGỪNG GỌI trong luồng T-SQL** | ScriptDOM trả về toàn bộ lỗi cú pháp trong 1 lần parse (< 1ms), không cần gửi nhiều round-trip tới DB. |
| **sqlglot token checkers (`_find_all_empty_select_tokens`,...)**| **NGỪNG GỌI trong luồng T-SQL** | ScriptDOM bắt các lỗi này tự nhiên và chuẩn xác hơn nhiều so với regex token. |

---

## 4. Xử lý Các Khoảng trống Đã Xác định (Gap Handling)

1. **Khoảng trống PL/pgSQL Offline:**
   - Khi PostgreSQL không có kết nối, parser tĩnh chỉ kiểm tra được câu lệnh ngoài khối `$$`.
   - **Xử lý:** Ghi nhận rõ trong tài liệu; khi có kết nối thì Live Transaction Rollback tự động kiểm tra toàn diện. Khi offline, bổ sung một bước kiểm tra cân bằng cơ bản các cặp từ khóa khối lệnh (`BEGIN...END`, `IF...END IF`, `LOOP...END LOOP`, `$tag$...$tag$`) để cảnh báo lỗi cơ bản cho người dùng.
2. **Khoảng trống Đóng gói DLL ScriptDOM:**
   - ScriptDOM DLL được đặt trong thư mục vendor nội bộ của ứng dụng (hoặc nạp từ đường dẫn có sẵn) để đảm bảo khi đóng gói PyInstaller / phân phối tới máy người dùng không có SSMS thì vẫn hoạt động 100% offline.

---

## 5. Thứ tự Triển khai Chi tiết

* **Bước 1 (Phase 4):**
  - Xây dựng thư mục `app/database/syntax/adapters/`.
  - Viết `base.py`, `sqlserver_scriptdom.py`, `postgresql_adapter.py`, `diagnostics_mapper.py`.
  - Viết unit test riêng cho từng adapter trong `tests/test_syntax_adapters.py`.
* **Bước 2 (Phase 5):**
  - Tích hợp lớp `coordinator.py` kết nối Adapter và `semantic_analyzer.py`.
  - Viết bộ test đối chiếu giữa Validator cũ và Adapter mới.
* **Bước 3 (Phase 6):**
  - Nối luồng chính tại `app/routes/query.py` sang `coordinator.py`.
  - Giữ cờ cấu hình `USE_LEGACY_VALIDATOR = False` để có thể chuyển đổi tức thì.
  - Kiểm tra tương thích giao diện Monaco Editor (Markers, Debounce, Đa Tab, Đổi kết nối).
* **Bước 4 (Phase 7):**
  - Chạy toàn bộ bộ test hồi quy (30 test cũ + test mới).
  - Đo đạc hiệu năng thực tế.
  - Xuất báo cáo nghiệm thu `syntax_check_migration_test_report.md`.

---

## 6. Phương án Rollback Dự phòng (Rollback Strategy)

Nếu phát sinh bất kỳ lỗi nào trong quá trình chuyển đổi, hệ thống có thể quay lại luồng cũ ngay lập tức bằng một trong hai cách:

1. **Rollback tự động (Runtime Fallback):**
   Trong adapter `sqlserver_scriptdom.py`, toàn bộ logic được bọc trong khối `try...except`:
   ```python
   try:
       return self._parse_with_scriptdom(sql)
   except Exception as exc:
       logger.warning(f"ScriptDOM unavailable, falling back to legacy validator: {exc}")
       from app.database.syntax.validator import validate_sql_server
       return validate_sql_server(sql, connection_session, database, schema)
   ```
2. **Rollback thủ công (Config Toggle):**
   Trong `app/database/syntax/coordinator.py`, cung cấp biến cờ:
   `USE_LEGACY_SYNTAX_VALIDATOR = False`
   Nếu đặt thành `True`, toàn bộ request sẽ được chuyển hướng thẳng về `app.database.syntax.validator.validate_sql()` ban đầu mà không đi qua Adapter mới.

---

## 7. Tiêu chí Nghiệm thu (Acceptance Criteria)

1. **Độ chính xác Cú pháp:**
   - 100% các câu lệnh T-SQL hợp lệ trong bộ test không bị báo lỗi cú pháp sai (Zero False Positive).
   - Bắt chính xác các lỗi sai cú pháp với đầy đủ dòng (`line`), cột (`column`), và mô tả rõ ràng.
   - Thân Stored Procedure / Function không bị lệch dòng lỗi.
2. **Hiệu năng:**
   - Tốc độ phân tích cú pháp T-SQL < 30ms (giảm hơn 90% so với cơ chế lặp live parse cũ).
   - Không gây đơ giật Monaco Editor trên giao diện WebView2.
3. **Bảo toàn Tương thích:**
   - Không làm thay đổi hay ảnh hưởng đến IntelliSense (`completion-engine.js`, `intellisense.js`).
   - Không làm ảnh hưởng đến Connection Manager, Query Execution, Result Grid, Formatter.
   - Chuyển tab hoặc đổi kết nối không làm rò rỉ hay đè marker của tab khác.
   - Bộ test baseline 30 tests hiện có tiếp tục **PASS 100%**.
