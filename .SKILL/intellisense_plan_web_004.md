# Kế hoạch Thay đổi IntelliSense Web: plan_web_004 (Phase 2)

- **Ngày thực hiện**: 2026-09-30
- **Phase**: Phase 2 — Context Analyzer (Section 64 của intellisense_improvement_plan_v2.md)
- **Trạng thái**: Hoàn thành (Completed)
- **Mục tiêu**:
  1. **Xây dựng SqlTokenizer (`static/js/sql-tokenizer.js`)**:
     - Phân rã văn bản SQL thành danh sách token có cấu trúc (`KEYWORD`, `IDENTIFIER`, `STRING`, `NUMBER`, `OPERATOR`, `PUNCTUATION`, `PARAMETER`, `COMMENT_LINE`, `COMMENT_BLOCK`, `WHITESPACE`).
     - Hỗ trợ đầy đủ các định dạng tên định danh: `[dbo].[Table]`, `"schema"."table"`, `` `col` ``.
     - Xử lý chuỗi ký tự escape `''` và comment đa dòng `/* ... */`, comment một dòng `--`.
  2. **Chuẩn hóa Context Types (`IntelliSenseContextType`)**:
     - Áp dụng đầy đủ bảng mã Context Type theo chuẩn Section 11 của plan v2 (`KEYWORD`, `DATABASE`, `SCHEMA`, `TABLE`, `VIEW`, `COLUMN`, `ALIAS`, `FUNCTION`, `PROCEDURE`, `TRIGGER`, `SYNONYM`, `PARAMETER`, `JOIN_COLUMN`, `ORDER_COLUMN`, `GROUP_COLUMN`, `ALTER_OBJECT`, `UNKNOWN`).
  3. **Statement Boundary Detector (`detectStatementBoundary`)**:
     - Xác định phạm vi câu lệnh hiện tại quanh con trỏ dựa trên token `;` hoặc `GO`, chỉ phân tích câu lệnh con trỏ đang đứng thay vì quét toàn bộ file lớn.
  4. **Loại bỏ False Positives trong Clause Detection**:
     - Quét ngược token stream ở cùng độ sâu ngoặc `depth == 0`, bỏ qua 100% comment và chuỗi literal.
     - Xử lý chính xác 6 ngữ cảnh cốt lõi:
       - `SELECT |` $\to$ `clause: 'SELECT'`, `contextType: 'column'`
       - `SELECT c.|` $\to$ `qualifier: 'c'`, `triggerChar: '.'`
       - `FROM |` $\to$ `clause: 'FROM'`, `contextType: 'table'`
       - `WHERE |` $\to$ `clause: 'WHERE'`, `contextType: 'column'`
       - `JOIN |` $\to$ `clause: 'JOIN'`, `contextType: 'table'`
       - `ORDER BY |` $\to$ `clause: 'ORDER BY'`, `contextType: 'order_column'`

---

### Chi tiết các tập tin thay đổi:

1. **`static/js/sql-tokenizer.js` (Tạo mới)**:
   - Triển khai lớp `SqlTokenizer` và từ điển `TokenType`.
   - Export `window.TokenType`, `window.SqlTokenizer`, `window.DefaultSqlTokenizer`.

2. **`templates/index.html` (Cập nhật)**:
   - Thêm `<script src="../static/js/sql-tokenizer.js"></script>` ngay trước `context-analyzer.js`.

3. **`static/js/context-analyzer.js` (Nâng cấp toàn diện)**:
   - Tích hợp `SqlTokenizer` để bóc tách token stream.
   - Thêm `IntelliSenseContextType`, `detectStatementBoundary`, `detectClauseFromTokens`.
   - Nâng cấp `extractAliases`, `extractLocalTempTables`, `extractLocalTableVars` sang sử dụng token stream thay vì regex thô.
   - **Xử lý Subquery trong mệnh đề `IN (...)`**:
     - Cải tiến hàm `extractAliases` nhận diện đúng cấu trúc `[schema.]table [alias]` và ngăn chặn việc gom nhầm từ khóa tiếp theo (`WHERE`, `IN`, v.v.) vào tên bảng.
     - Hỗ trợ trích xuất cả bảng của query cha (`b30accdoc a`) lẫn bảng của subquery (`b20customer`) vào `aliasMap` và `queryTables`.
   - Giữ nguyên 100% các hàm và biến export cũ để bảo đảm tính tương thích với `intellisense.js`.

4. **`tests/test_context_analyzer_phase2.py` (Tạo mới)**:
   - Unit test kiểm tra sự hiện diện, thứ tự nạp script trong `index.html`, kiểm tra 6 context cốt lõi, và kiểm thử subquery `IN(SELECT id FROM b20customer)`. 100% PASS.

---

### Kết quả kiểm thử:
- Toàn bộ test suite: **132 / 132 tests PASS** (`pytest -s tests/`).
- Thời gian chạy test suite: ~3.72s.
- Hiệu năng lexer phân tích: $< 0.1\text{ ms}$ cho câu truy vấn thông thường, chạy hoàn toàn cục bộ trên client.
