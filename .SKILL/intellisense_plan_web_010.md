# Kế hoạch Thay đổi IntelliSense Web: plan_web_010 (Phase 8)

- **Ngày thực hiện**: 2026-09-30
- **Phase**: Phase 8 — Advanced SQL (Section 70 của [intellisense_improvement_plan_v2.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/.SKILL/intellisense_improvement_plan_v2.md))
- **Trạng thái**: Hoàn thành (Completed)
- **Mục tiêu**:
  1. **Common Table Expressions (CTE) (Section 39, 47, 70)**:
     - Phân tích và trích xuất cấu trúc CTE: `WITH cte_name [(col1, col2)] AS (SELECT ...)` và danh sách nhiều CTE ngăn cách bởi dấu phẩy `,`.
     - Lưu trữ dưới dạng `SqlSymbol` với `type: 'cte'` kèm danh sách cột chiếu `columns` (từ danh sách cột tường minh hoặc phân tích projection `SELECT ...`).
     - Gợi ý CTE trong mệnh đề `FROM` và `JOIN`.
     - Phân giải `cte_name.` hoặc alias để gợi ý chính xác các cột được chiếu của CTE.
  2. **Subquery Projections / Derived Tables (Section 40, 70)**:
     - Trích xuất projection từ bảng dẫn xuất: `FROM (SELECT Id, CustomerName AS Name FROM Customer) c`.
     - Cô lập danh sách cột trong scope của alias `c`: Chỉ expose `Id`, `Name` mà không rò rỉ toàn bộ cột vật lý của `Customer`.
     - Thiết lập cơ chế bảo vệ trong `CompletionEngine` (`isLocalSymbol`): Không gửi truy vấn DB vật lý khi qualifier là subquery/derived table.
  3. **Temporary Tables (Bảng Tạm) (Section 44, 46, 70)**:
     - Phân tích định nghĩa cột từ câu lệnh `CREATE TABLE #temp (...)` và `CREATE TABLE ##global (...)`.
     - Hỗ trợ phân tích đa dạng kiểu dữ liệu có dấu ngoặc (`VARCHAR(50)`, `DECIMAL(18,2)`), bỏ qua các ràng buộc khóa chính/ngoại (`PRIMARY KEY`, `CONSTRAINT`).
     - Lưu trữ dưới dạng `SqlSymbol` với `type: 'temp_table'` và gợi ý đầy đủ khi gõ `#temp.` hoặc alias `t.`.
  4. **Table Variables & Scalar Variables (Section 47, 48, 70)**:
     - Phân tích biến bảng `DECLARE @table TABLE (...)` và các cột định nghĩa.
     - Phân tích biến vô hướng `DECLARE @var <type> [= default]`.
     - Gợi ý biến vô hướng khi người dùng gõ `@` hoặc trong các mệnh đề biểu thức (`SELECT`, `WHERE`, `ON`, `SET`, `VALUES`, `ORDER BY`).
     - Gợi ý biến bảng trong `FROM`/`JOIN` và gợi ý cột của biến bảng khi gõ `@table.` hoặc alias.
  5. **Stored Procedure Parameters (Section 29, 51, 70)**:
     - Phát hiện ngữ cảnh thực thi `EXEC [schema].[proc_name] ` hoặc `EXEC proc_name @`.
     - Xác định tên Stored Procedure và trạng thái vị trí tham số (`isParameterPosition = true`, `contextType = PARAMETER`).
     - Gọi `dataProvider.fetchParameters` để lấy danh sách tham số và gợi ý dạng `@Param = ` kèm kiểu dữ liệu và hướng tham số (IN/OUT).
     - Đưa tham số thủ tục lên mức ưu tiên cao nhất (`contextScore += 110`) trong bộ xếp hạng `CompletionRanker`.
  6. **Function Signatures & Documentation (Section 51, 70)**:
     - Xây dựng từ điển chữ ký hàm tích hợp chuẩn `FUNCTION_SIGNATURES` bao quát các hàm phổ biến: `ISNULL`, `COALESCE`, `NULLIF`, `DATEADD`, `DATEDIFF`, `GETDATE`, `NOW`, `SUBSTRING`, `REPLACE`, `TRIM`, `CAST`, `CONVERT`, `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `ROUND`, `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, v.v.
     - Tự động gắn thuộc tính `signature`, `detail`, và `documentation` vào từng candidate thuộc loại `sql_function`.
     - Xuất phương thức `CompletionEngine.getFunctionSignature(name)` và đối tượng `window.SqlFunctionSignatures`.

---

### Chi tiết các tập tin thay đổi:

1. **`static/js/scope-resolver.js` (Cập nhật)**:
   - Mở rộng `SqlSymbol` hỗ trợ trường `dataType` và cấu trúc cột linh hoạt cho symbol cục bộ.
   - Bổ sung các phương thức vào `SymbolTable`: `getSymbolsByType(type)`, `getAllVisibleCtes()`, `getAllVisibleVariables()`, `getAllVisibleTempTables()`.
   - Bổ sung vào `AliasResolver`:
     - `parseSelectProjection(codeTokens, startIndex, endIndex)`: Phân tích danh sách cột và bí danh của mệnh đề SELECT.
     - `parseColumnDefinitions(codeTokens, openParen, closeParen)`: Phân tích định nghĩa cột trong CREATE TABLE / DECLARE TABLE với nhận diện độ sâu ngoặc đơn.
     - `extractCtes(codeTokens, symbolTable)`: Quét và trích xuất mệnh đề WITH.
     - `extractTempTablesAndVariables(codeTokens, symbolTable)`: Quét và trích xuất bảng tạm và biến.
     - `extractDerivedTables(codeTokens, symbolTable, subquerySpans)`: Trích xuất projection từ bảng dẫn xuất.
2. **`static/js/context-analyzer.js` (Cập nhật)**:
   - Thêm `detectExecContext(codeTokens)`: Nhận diện thủ tục và trạng thái hoàn thành tham số.
   - Tối ưu nhận diện `triggerChar = '@'` khi người dùng bắt đầu gõ biến hoặc tham số.
   - Gắn `ctes`, `localVariables`, `localTableVars`, `localTempTables`, và `execContext` vào đối tượng `context` trả về.
3. **`static/js/completion-engine.js` (Cập nhật)**:
   - Thêm `FUNCTION_SIGNATURES` và tích hợp chữ ký/tài liệu cho ứng viên hàm.
   - Thêm `CompletionEngine.getFunctionSignature(name)`.
   - Sinh ứng viên CTE trong `FROM`/`JOIN`.
   - Sinh ứng viên biến vô hướng khi gõ `@` hoặc trong các biểu thức.
   - Sinh ứng viên tham số thủ tục dạng `@Param = ` khi ở ngữ cảnh `EXEC`.
   - Thiết lập `isLocalSymbol` bảo vệ các symbol cục bộ (subquery, CTE, temp table, table variable) không bị gửi request truy vấn bảng vật lý thừa thãi tới DB.
   - Nâng cấp `CompletionRanker` với trọng số tối ưu cho CTEs, biến, và tham số thủ tục.
4. **`tests/test_advanced_sql_phase8.py` (Tạo mới)**:
   - 6 bài kiểm thử toàn diện kiểm chứng:
     - `test_advanced_sql_cte_support`: CTE symbol và column projection.
     - `test_advanced_sql_derived_table_subquery_projection`: Cô lập cột của derived table (Section 40).
     - `test_advanced_sql_temp_tables`: Bảng tạm `#temp` (Section 46).
     - `test_advanced_sql_table_and_scalar_variables`: Biến bảng `@table` và biến `@var` (Section 47, 48).
     - `test_advanced_sql_procedure_parameters`: Tham số thủ tục trong `EXEC` (Section 29, 51).
     - `test_advanced_sql_function_signatures`: Chữ ký hàm và tài liệu trợ giúp (Section 51).

---

### Kết quả kiểm thử:
- **Phase 8 tests**: **6 / 6 tests PASS (0.20s)**.
- **Toàn bộ Phase 1 đến 8**: **33 / 33 tests PASS (0.41s)**.
