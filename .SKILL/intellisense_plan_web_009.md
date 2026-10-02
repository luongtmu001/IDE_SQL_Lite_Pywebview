# Kế hoạch Thay đổi IntelliSense Web: plan_web_009 (Phase 7)

- **Ngày thực hiện**: 2026-09-30
- **Phase**: Phase 7 — Dialects (Section 69 của [intellisense_improvement_plan_v2.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/.SKILL/intellisense_improvement_plan_v2.md))
- **Trạng thái**: Hoàn thành (Completed)
- **Mục tiêu**:
  1. **Tách Rời Dialect-Specific Logic khỏi Core Engine ([sql-dialects.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/sql-dialects.js) - Section 43, 69)**:
     - Xây dựng lớp trừu tượng `SqlDialect` định nghĩa toàn bộ hợp đồng tương tác giữa Core IntelliSense và từng hệ quản trị CSDL.
     - Cung cấp các phương thức hợp đồng chuẩn:
       - `quoteIdentifier(name)`
       - `unquoteIdentifier(name)`
       - `normalizeIdentifier(name)`
       - `isQuotedIdentifier(name)`
       - `isTempObject(name)`
       - `getKeywords()`
       - `getFunctions()`
       - `getDataTypes()`
       - `getBatchSeparators()`
       - `getAlterHeaderTemplate(objectType, objectName, schema)`
  2. **Triển khai Chi tiết SQL Server Dialect ([SqlServerDialect](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/sql-dialects.js) - Section 44)**:
     - Định dạng quoting: Dấu ngoặc vuông `[schema].[table]`.
     - Phân biệt đối tượng tạm thời: Bảng tạm `#temp`, `##global`, và biến bảng `@table`.
     - Từ khóa đặc thù: `TOP`, `CROSS APPLY`, `OUTER APPLY`, `NOLOCK`, `IDENTITY`, `CLUSTERED`, `GO`, `RAISERROR`, v.v.
     - Hàm đặc thù: `GETDATE`, `DATEADD`, `DATEDIFF`, `ISNULL`, `NEWID`, `STRING_SPLIT`, v.v.
     - Kiểu dữ liệu: `NVARCHAR`, `UNIQUEIDENTIFIER`, `BIT`, `DATETIME2`, `MONEY`, `IMAGE`, `XML`, v.v.
     - Cú pháp sửa đổi: `CREATE OR ALTER <TYPE> [schema].[name]`.
     - Ký tự phân tách batch: `GO`, `;`.
  3. **Triển khai Chi tiết PostgreSQL Dialect ([PostgresDialect](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/sql-dialects.js) - Section 45)**:
     - Định dạng quoting: Dấu ngoặc kép `"schema"."table"`.
     - Cơ chế chuẩn hóa ngữ nghĩa (Case folding): Định danh không có ngoặc kép tự động chuyển về chữ thường (`Customer` $\to$ `customer`), trong khi định danh có ngoặc kép giữ nguyên định dạng chính xác (`"Customer"` $\to$ `Customer`).
     - Schema mặc định: `public`.
     - Từ khóa đặc thù: `LIMIT`, `OFFSET`, `RETURNING`, `ILIKE`, `SIMILAR TO`, `SERIAL`, `BIGSERIAL`, `ON CONFLICT`, `DO NOTHING`, `DO UPDATE`, `DISTINCT ON`, v.v.
     - Hàm đặc thù: `NOW`, `CURRENT_TIMESTAMP`, `COALESCE`, `GEN_RANDOM_UUID`, `ARRAY_AGG`, `STRING_AGG`, `JSONB`, v.v.
     - Kiểu dữ liệu: `VARCHAR`, `TEXT`, `BOOLEAN`, `UUID`, `SERIAL`, `BIGSERIAL`, `JSON`, `JSONB`, `BYTEA`, v.v.
     - Cú pháp sửa đổi: `CREATE OR REPLACE <TYPE> "schema"."name"` cho View/Function.
     - Ký tự phân tách batch: `;`.
  4. **Nhà máy Phân giải Dialect Thông minh ([SqlDialectFactory](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/sql-dialects.js) - Section 43)**:
     - Quản lý các instance singleton cho `sqlserver` (aliases: `mssql`) và `postgresql` (aliases: `postgres`, `pg`).
     - Cung cấp `getDialect(dbType)` và `getDialectForConnection(connectionId)` tự động nhận diện hệ CSDL từ kết nối hoặc tab soạn thảo đang hoạt động.
  5. **Tích hợp Liền mạch vào CandidateGenerator ([completion-engine.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/completion-engine.js))**:
     - `CandidateGenerator` gọi `SqlDialectFactory.getDialect(tabCtx.dbType)` để nạp đúng bộ từ khóa và hàm tích hợp theo đúng hệ CSDL đang kết nối thay vì sử dụng danh sách tĩnh chung.

---

### Chi tiết các tập tin thay đổi:

1. **`static/js/sql-dialects.js` (Tạo mới)**:
   - Triển khai: `SqlDialect`, `SqlServerDialect`, `PostgresDialect`, `SqlDialectFactory`.
   - Export: `window.SqlDialect`, `window.SqlServerDialect`, `window.PostgresDialect`, `window.SqlDialectFactory`.
2. **`templates/index.html` (Cập nhật)**:
   - Thêm `<script src="../static/js/sql-dialects.js"></script>` vào ngay đầu pipeline kịch bản IDE trước `sql-tokenizer.js`.
3. **`static/js/completion-engine.js` (Cập nhật)**:
   - Kết nối `CandidateGenerator` với `SqlDialectFactory` để sinh gợi ý chính xác theo dialect.
4. **`tests/test_dialects_phase7.py` (Tạo mới)**:
   - 6 bài kiểm thử unit test kiểm tra toàn diện: thứ tự script, hợp đồng lớp, quy tắc SQL Server, quy tắc PostgreSQL kèm case-folding, phân giải qua Factory, và tích hợp CompletionEngine.

---

### Kết quả kiểm thử:
- Toàn bộ suite Phase 1–7: **27 / 27 tests PASS (0.17s)**.
- Toàn bộ test suite hệ thống: **154 / 154 tests PASS**.
