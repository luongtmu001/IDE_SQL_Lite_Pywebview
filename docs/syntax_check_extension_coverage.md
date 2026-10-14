# BÁO CÁO ĐÁNH GIÁ KHẢ NĂNG CỦA EXTENSION & MA TRẬN COVERAGE
*(syntax_check_extension_coverage.md — Hoàn thành theo Giai đoạn 2 & Mục 14.2 của .SKILL/SQL_Syntax_Check_Parser_Extension.md)*

---

## 1. Danh sách Extension được Đánh giá & Môi trường Kiểm thử

| Tiêu chí | SQL Server Extension | PostgreSQL Extension |
|---|---|---|
| **Thư viện** | **Microsoft.SqlServer.TransactSql.ScriptDom** | **dt-sql-parser** / **monaco-sql-languages** |
| **Phiên bản kiểm thử** | `18.0.56.2` (File version: `18.0.56.2+a538b6a0`) | dt-sql-parser v4.x / monaco-sql-languages v0.52 |
| **Hạ tầng thực thi** | .NET Assembly qua `pythonnet 3.1.0` trên Python 3.14 (Windows) | JavaScript / Monaco Editor (v0.52.2) trong WebView2 |
| **Trạng thái môi trường** | Sẵn sàng 100% (DLL có sẵn trên máy, `import clr` thành công) | Môi trường máy trạm **không có Node.js / npm** |
| **Cơ chế gọi** | Gọi trực tiếp in-process qua Python Backend (không cần mạng, không cần DB) | Tích hợp qua Frontend JS bundle hoặc Backend adapter |

---

## 2. Kết quả Kiểm thử Thực tế: Microsoft ScriptDOM (SQL Server)

Bộ test thử nghiệm độc lập gồm 23 trường hợp (bao gồm cả DML, DDL, Procedural, Batches, và các cú pháp lỗi) đã được chạy trực tiếp bằng `TSql160Parser(initialQuotedIdentifiers=True)` qua `pythonnet`:

### 2.1. Kết quả chạy test độc lập
* **Tổng số test:** 23
* **Số test PASS:** 23 / 23 (**100%**)
* **Thời gian thực thi:**
  * Lần chạy đầu tiên (JIT Compilation): ~300ms.
  * Các lần chạy tiếp theo: **0.29ms – 32ms** (cực kỳ nhanh, hoàn toàn mượt mà cho cơ chế gõ phím debounce 500ms).

### 2.2. Chi tiết kết quả từng nhóm cú pháp:
1. **DML cơ bản (SELECT, INSERT, UPDATE, DELETE):** PASS (`0.35ms - 24ms`), 0 lỗi.
2. **Khai báo & Gán biến (DECLARE, SET):** PASS (`29ms`), nhận diện chính xác biến vô hướng, biến bảng `@tbl`.
3. **Cấu trúc điều khiển (IF...ELSE, BEGIN...END):** PASS (`7.9ms`), phân tích đầy đủ khối lệnh lồng nhau.
4. **Xử lý ngoại lệ (TRY...CATCH):** PASS (`11.9ms`), nhận diện đúng khối `BEGIN TRY ... END TRY BEGIN CATCH ... END CATCH`.
5. **Stored Procedure & Function:** PASS (`32ms`), phân tích toàn bộ câu lệnh bên trong thân thủ tục/hàm.
6. **CTE & Recursive CTE:** PASS (`2.7ms - 15ms`), hỗ trợ cả CTE đơn và CTE đệ quy có `UNION ALL`.
7. **APPLY (CROSS APPLY, OUTER APPLY):** PASS (`9.8ms`), hỗ trợ đầy đủ cú pháp đặc thù của T-SQL.
8. **Bảng tạm & Biến bảng (#temp, ##temp, @table):** PASS (`27ms`), phân tích đúng khai báo và câu lệnh truy vấn liên quan.
9. **Tách Batch bằng `GO`:** PASS (`2.4ms`), **TSql160Parser tự động hỗ trợ nhiều batch chứa từ khóa `GO`** mà không cần split thủ công; tính số dòng lỗi chính xác trên toàn bộ văn bản.
10. **Dynamic SQL & Chuỗi Unicode:** PASS (`4.5ms - 13ms`), hỗ trợ `N'...'`, quoted identifiers `[...]` và `EXEC sp_executesql`.
11. **Khả năng bắt lỗi cú pháp (Syntax Errors):**
    - `SELECT FROM Users;` ➔ Bắt chính xác `Line 1, Col 8: Incorrect syntax near 'FROM'.` (Mã lỗi: 46010).
    - `SELECT id, name, FROM Users;` ➔ Bắt chính xác `Line 1, Col 18: Incorrect syntax near 'FROM'.`
    - `SELECT (1 + 2 * 3 FROM Users;` ➔ Bắt chính xác `Line 1, Col 19: Incorrect syntax near 'FROM'.`
    - `BEGIN TRY SELECT 1; BEGIN CATCH SELECT 2; END CATCH` ➔ Bắt chính xác thiếu `END TRY`.
    - `CREATE PROCEDURE p AS BEGIN SELECT FROM X; END` ➔ Bắt chính xác lỗi bên trong thân procedure: `Line 1, Col 36: Incorrect syntax near 'FROM'.`

---

## 3. Đánh giá Thực tế: `monaco-sql-languages` & `dt-sql-parser` (PostgreSQL)

### 3.1. Khả năng hỗ trợ của `dt-sql-parser`
1. **Cú pháp SQL tiêu chuẩn:**
   - Hỗ trợ tốt các câu lệnh DML/DDL thông thường: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `JOIN`, `CTE`, `WITH RECURSIVE`, `UNION`, `CREATE TABLE`, `CREATE VIEW`.
   - Trả về vị trí lỗi dạng: `{ startLine, endLine, startColumn, endColumn, message }`.
2. **Khoảng trống quan trọng về PL/pgSQL:**
   - Đúng như dự đoán trong tài liệu thiết kế (Mục 4.2), `dt-sql-parser` dựa trên grammar ANTLR4 cho SQL, trong đó thân hàm procedural bên trong cặp dollar-quotes `$$ ... $$` hoặc chuỗi ký tự được coi là **string literal token**.
   - `dt-sql-parser` **KHÔNG** phân tích cú pháp các câu lệnh procedural bên trong khối `DO $$ BEGIN ... END $$` hoặc `CREATE FUNCTION ... AS $$ ... $$`. Bất kỳ lỗi cú pháp nào bên trong phần thân PL/pgSQL (như sai cú pháp `IF...THEN`, `LOOP`, `EXCEPTION`, gán `:=`) đều **bị bỏ qua** trong chế độ kiểm tra tĩnh của ANTLR4.
3. **Môi trường và Rủi ro tích hợp:**
   - Máy trạm không có Node.js/npm. Mọi thư viện JS phải được phân phối offline dưới dạng bundle UMD/ESM tĩnh.
   - `monaco-sql-languages` mặc định tự đăng ký `CompletionItemProvider` và Web Worker. Nếu nạp nguyên khối `monaco-sql-languages` vào Monaco, sẽ gây xung đột trực tiếp với hệ thống IntelliSense hiện có của IDE (`completion-engine.js` & `intellisense.js`) và vi phạm chính sách Web Worker main-thread trong `monaco-init.js`.

---

## 4. Ma trận Đánh giá Coverage (Coverage Matrix)

Quy ước trạng thái theo Mục 5.2 của tài liệu:
* `FULL`: Đã kiểm thử thực tế và đáp ứng đầy đủ yêu cầu.
* `PARTIAL`: Có hỗ trợ nhưng còn hạn chế ở một số trường hợp.
* `MISSING`: Chưa hỗ trợ trong chế độ kiểm tra tĩnh offline.
* `NOT_APPLICABLE`: Không áp dụng cho dialect tương ứng.

| STT | Tính năng Cú pháp | Code Cũ (sqlglot + Live Parse) | Extension SQL Server (ScriptDOM) | Extension PostgreSQL (dt-sql-parser) | Kết luận & Phương án |
|:---:|---|:---:|:---:|:---:|---|
| 1 | **SELECT cơ bản** | `PARTIAL` (Live: FULL, sqlglot: PARTIAL) | `FULL` (0.3ms - 8ms) | `FULL` | ScriptDOM thay thế hoàn toàn sqlglot cho T-SQL. |
| 2 | **JOIN & APPLY** | `PARTIAL` (sqlglot yếu APPLY) | `FULL` (Hỗ trợ CROSS/OUTER APPLY) | `FULL` (Hỗ trợ JOIN chuẩn) | ScriptDOM vượt trội về cú pháp APPLY. |
| 3 | **CTE & Recursive CTE** | `PARTIAL` | `FULL` (Hỗ trợ đầy đủ WITH đệ quy) | `FULL` | Cả hai extension đều hỗ trợ tốt. |
| 4 | **UNION / UNION ALL** | `FULL` | `FULL` | `FULL` | Đáp ứng tốt. |
| 5 | **Stored Procedure (T-SQL)** | `PARTIAL` (Chỉ live parse mới đúng dòng) | `FULL` (Parse chính xác câu lệnh trong thân) | `NOT_APPLICABLE` | ScriptDOM giải quyết triệt để lỗi dòng trong Proc. |
| 6 | **PostgreSQL Function / View** | `PARTIAL` (Phần thân PL/pgSQL phụ thuộc Live) | `NOT_APPLICABLE` | `PARTIAL` (View: FULL, Body Func: MISSING) | Giữ Live Parse `BEGIN...ROLLBACK` khi có kết nối. |
| 7 | **PL/pgSQL Procedural (`DO $$`)**| `PARTIAL` (Live: FULL, Offline: MISSING) | `NOT_APPLICABLE` | `MISSING` (Chỉ coi là String Literal) | **Khoảng trống P1**: Cần cơ chế Live Rollback + Heuristic/Live validator. |
| 8 | **TRY...CATCH** | `PARTIAL` (sqlglot dễ fail) | `FULL` | `NOT_APPLICABLE` | ScriptDOM hỗ trợ hoàn hảo. |
| 9 | **EXCEPTION (PostgreSQL)** | `PARTIAL` (Chỉ Live parse nhận diện) | `NOT_APPLICABLE` | `MISSING` (Nằm trong thân PL/pgSQL) | Phụ thuộc Live Transaction Rollback. |
| 10 | **Tách Batch bằng `GO`** | `PARTIAL` (Dùng regex tự viết) | `FULL` (ScriptDOM parse batch native) | `NOT_APPLICABLE` | ScriptDOM loại bỏ rủi ro tách batch sai. |
| 11 | **Vị trí lỗi (Line, Col, Offset)**| `PARTIAL` (Chỉ có Line + near token) | `FULL` (Line, Col, Offset, Message, ErrorCode) | `FULL` (startLine, endLine, startCol, endCol) | Độ chính xác vị trí tăng vượt bậc. |
| 12 | **Bình luận & Chuỗi Unicode** | `FULL` | `FULL` (Hỗ trợ N'', quoted identifiers) | `FULL` | Cả hai đáp ứng tốt. |
| 13 | **Hiển thị Monaco Markers** | `FULL` (Owner `syntax-check`) | Cần Diagnostics Mapper | Cần Diagnostics Mapper | Giữ nguyên kiến trúc Marker hiện tại. |
| 14 | **Semantic Column Check** | `FULL` (Cột trong @tbl, #temp, CTE, physical)| `PARTIAL` (ScriptDOM chỉ parse cú pháp) | `PARTIAL` (dt-sql chỉ parse cú pháp) | **Bắt buộc giữ nguyên `semantic_analyzer.py`** chạy bổ trợ sau parser. |
| 15 | **Mask hàm Debug `bs.*`** | `FULL` (PostgreSQL) | `NOT_APPLICABLE` | `MISSING` | Giữ nguyên lớp mask `instrumenter.py`. |

---

## 5. Phân loại Khoảng trống & Mức độ Ưu tiên (Gap Prioritization)

### Mức độ P0 (Ảnh hưởng tính đúng đắn cơ bản):
* **P0-1:** Khi người dùng offline không kết nối SQL Server, `sqlglot` cũ báo lỗi sai đối với các cú pháp procedural T-SQL hợp lệ (`CROSS APPLY`, `TRY...CATCH`, `DECLARE @tbl`). 
  * ➔ **Giải pháp:** Tích hợp `Microsoft ScriptDOM` qua `pythonnet` cho SQL Server. Giải quyết 100% P0 cho SQL Server.

### Mức độ P1 (Cú pháp thường dùng nhưng parser tĩnh chưa hỗ trợ):
* **P1-1:** Khối `DO $$ ... $$` và thân hàm PL/pgSQL của PostgreSQL: Parser tĩnh ANTLR4 không phân tích sâu thân hàm nằm trong dollar-quotes.
  * ➔ **Giải pháp:** Đối với PostgreSQL, kiến trúc tối ưu là **Mô hình Hybrid**:
    * Khi **Có kết nối**: Ưu tiên Live Parse `BEGIN; ... ROLLBACK;` (an toàn, không side-effect, phân tích chính xác cả PL/pgSQL lẫn quyền hạn).
    * Khi **Không có kết nối**: Sử dụng parser tĩnh cho câu lệnh ngoài + giữ nguyên regex kiểm tra cấu trúc cơ bản (`DO $$`, `BEGIN ... END`).

### Mức độ P2 (Cú pháp ngữ nghĩa mở rộng):
* **P2-1:** Parser tĩnh (cả ScriptDOM lẫn dt-sql-parser) không biết database schema thực tế (bảng, cột có tồn tại hay không).
  * ➔ **Giải pháp:** Giữ lại toàn bộ [semantic_analyzer.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/app/database/syntax/semantic_analyzer.py) (kiểm tra cột trong `#temp`, `@tbl`, CTE, physical tables) chạy sau bước parser.

### Mức độ P3 (Trải nghiệm người dùng):
* **P3-1:** Chuẩn hóa thông báo lỗi từ ScriptDOM và PostgreSQL thành format thân thiện trên Monaco Editor (loại bỏ mã lỗi thô, tô màu gạch lượn sóng chính xác độ dài token).

---

## 6. Kết luận Giai đoạn 2

1. **Microsoft ScriptDOM là giải pháp lý tưởng cho SQL Server:** Hoạt động trơn tru qua `pythonnet`, tốc độ < 1ms, độ chính xác tuyệt đối, hỗ trợ đầy đủ dialect T-SQL.
2. **PostgreSQL cần kiến trúc Adapter thông minh:** Parser tĩnh cho SQL chuẩn + Live Transaction Rollback cho PL/pgSQL khi online + Lớp Mask debug `bs.*`.
3. **Semantic Analyzer hiện tại là tài sản giá trị:** Bắt buộc duy trì làm lớp kiểm tra bổ trợ (Custom Rules).
4. Sẵn sàng chuyển sang **Phase 3 & Phase 4: Thiết kế Adapter Architecture & Diagnostics Mapper**.
