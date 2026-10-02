# Kế hoạch Thay đổi IntelliSense Web: plan_web_005 (Phase 3)

- **Ngày thực hiện**: 2026-09-30
- **Phase**: Phase 3 — Scope / Alias Resolver (Section 65 của intellisense_improvement_plan_v2.md)
- **Trạng thái**: Hoàn thành (Completed)
- **Mục tiêu**:
  1. **Xây dựng Symbol & SymbolTable (`static/js/scope-resolver.js`)**:
     - Cấu trúc cây Scope phân cấp (Hierarchical Scope Tree) hỗ trợ lexical scoping.
     - Phân giải biểu tượng theo thứ tự: Local Aliases $\to$ Local Tables $\to$ Outer Query Parent Scope.
     - Cô lập Scope: Subquery nhìn thấy bảng/alias của chính nó và kế thừa từ cha; query ngoài không bị ô nhiễm bởi các alias tạm của subquery.
  2. **Xây dựng AliasResolver (Section 13)**:
     - Chuẩn hóa cấu trúc lưu trữ của Alias:
       `{ object: "Customer", schema: "dbo", database: null, alias: "c", type: "table" }`.
     - Hỗ trợ các cú pháp: `FROM Table t`, `FROM Table AS t`, `JOIN Table t`, `[schema].[table] [alias]`.
  3. **Xây dựng QualifiedIdentifierResolver (Section 14)**:
     - Phân giải chuỗi qualifier trước dấu chấm `.`:
       - `c.` $\to$ Resolve bảng `Customer`, schema `dbo` (qua alias `c`).
       - `Customer.` $\to$ Resolve trực tiếp bảng `Customer`.
       - `dbo.Customer.` $\to$ Resolve schema `dbo`, table `Customer`.
       - `MyDb.dbo.Customer.` $\to$ Resolve database `MyDb`, schema `dbo`, table `Customer`.
  4. **Xây dựng ScopeResolver (Section 12, 40)**:
     - Duyệt cây token, nhận diện các cặp ngoặc `(SELECT ...)` tạo thành các Child Scopes.
     - Hàm `getScopeAt(cursorOffset)` định vị con trỏ đang ở Root Scope hay Subquery Scope cụ thể để lấy đúng `SymbolTable`.
  5. **Tích hợp liền mạch với Context Analyzer & IntelliSense Controller**:
     - `context-analyzer.js` gắn `resolvedObject` và `activeScope` vào context object.
     - `intellisense.js` ưu tiên dùng `context.resolvedObject` để nạp ngay danh sách cột chính xác của bảng mục tiêu.

---

### Chi tiết các tập tin thay đổi:

1. **`static/js/scope-resolver.js` (Tạo mới)**:
   - Triển khai các lớp: `Symbol`, `SymbolTable`, `AliasResolver`, `QualifiedIdentifierResolver`, `ScopeResolver`.
   - Export ra `window.DefaultScopeResolver`.

2. **`templates/index.html` (Cập nhật)**:
   - Thêm `<script src="../static/js/scope-resolver.js"></script>` sau `sql-tokenizer.js` và trước `context-analyzer.js`.

3. **`static/js/context-analyzer.js` (Cập nhật)**:
   - Tích hợp `DefaultScopeResolver` để xây dựng Scope Tree cho câu truy vấn.
   - Trích xuất bảng và alias theo từng scope, xuất `resolvedObject` ra context.

4. **`static/js/intellisense.js` (Cập nhật)**:
   - Tận dụng `context.resolvedObject` trong `collectAndShowCandidates` để ưu tiên fetch chính xác cột của bảng tương ứng khi có qualifier.

5. **`tests/test_scope_resolver_phase3.py` (Tạo mới)**:
   - Unit tests kiểm tra:
     - Multi-table JOIN (`FROM Customer c JOIN Orders o` $\to$ resolve `c.` và `o.`).
     - Subquery Scope hierarchy & isolation (`IN (SELECT ...)`).
     - Script loading order trong `index.html`.
     - 100% PASS.

---

### Kết quả kiểm thử:
- Toàn bộ test suite: **135 / 135 tests PASS** (`pytest -s tests/`).
- Thời gian chạy test suite: ~2.66s.
- Hiệu năng phân giải scope: $< 0.1\text{ ms}$, chạy hoàn toàn trên client.
