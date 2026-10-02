# Kế hoạch Thay đổi IntelliSense Web: plan_web_008 (Phase 6)

- **Ngày thực hiện**: 2026-09-30
- **Phase**: Phase 6 — Completion Engine (Section 68 của [intellisense_improvement_plan_v2.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/.SKILL/intellisense_improvement_plan_v2.md))
- **Trạng thái**: Hoàn thành (Completed)
- **Mục tiêu**:
  1. **Xây dựng Completion Pipeline chuẩn hóa ([completion-engine.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/completion-engine.js) - Section 21, 22)**:
     - Tách rời toàn bộ logic tính toán gợi ý ra khỏi controller và editor.
     - Thực thi pipeline 11 bước chuẩn mực: `Get cursor` $\to$ `Tokenize nearby SQL` $\to$ `Detect statement` $\to$ `Detect context` $\to$ `Resolve scope` $\to$ `Resolve aliases` $\to$ `Load metadata` $\to$ `Generate candidates` $\to$ `Filter` $\to$ `Rank` $\to$ `Return`.
  2. **Tổng hợp Nguồn Ứng viên Đầy đủ ([CandidateGenerator](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/completion-engine.js) - Section 23-29)**:
     - Từ khóa SQL (theo dialect SQL Server/Postgres) & Hàm tích hợp (`SQL_FUNCTIONS`).
     - Snippets & Templates (`AppSnippets`).
     - Bảng tạm nội bộ `#temp` & Biến bảng `@table` trong scope file script hiện tại.
     - Cột của các bảng trong truy vấn khi ở mệnh đề biểu thức (`SELECT`, `WHERE`, `ON`, `GROUP BY`, `ORDER BY`, `HAVING`).
     - Định tuyến ngữ cảnh:
       - Khi có `qualifier` (`c.`): Ưu tiên tuyệt đối cột của bảng tương ứng, phân biệt cột khóa chính `pk_column` (Section 24).
       - Mệnh đề `FROM` & `JOIN`: Ưu tiên bảng, view, bảng tạm, biến bảng, synonym (Section 25, 26).
       - Mệnh đề `WHERE` / `ON` / `ORDER BY`: Ưu tiên cột, hàm, biến (Section 27, 28).
       - Mệnh đề `EXEC`: Ưu tiên stored procedures (Section 29).
       - Ngữ cảnh `ALTER`: Ưu tiên đối tượng trùng với loại cần sửa (`ALTER VIEW` $\to$ view, `ALTER PROC` $\to$ procedure).
  3. **Lọc Đa Tầng Thông Minh ([CandidateFilter](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/completion-engine.js) - Section 31)**:
     - Thực hiện 4 tầng lọc: `Exact Prefix` $\to$ `Prefix Match` $\to$ `Substring Match` $\to$ `Fuzzy Subsequence`.
     - Ngưỡng lọc thông minh: Nếu số lượng prefix matches dồi dào, tự động bỏ qua fuzzy để tránh nhiễu; chỉ áp dụng fuzzy khi người dùng gõ từ 2 ký tự trở lên (vd: `custid` $\to$ `CustomerId`).
  4. **Bộ Xếp Hạng Ngữ Cảnh ([CompletionRanker](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/completion-engine.js) - Section 30)**:
     - Kết hợp trọng số: độ khớp từ khóa + ngữ cảnh câu lệnh (`contextScore`) + phạm vi scope (`scopeScore`) + loại đối tượng + cấp độ ưu tiên (`levelScore`).
     - Loại bỏ trùng lặp và sắp xếp theo độ phù hợp cao nhất.
  5. **Quản lý Đồng thời & Hủy Yêu cầu Lỗi thời (Concurrency & Cancellation - Section 33)**:
     - Sử dụng `requestId` tăng dần: nếu người dùng tiếp tục gõ trong lúc tác vụ fetch metadata bất đồng bộ đang chạy, yêu cầu cũ sẽ tự động bị bỏ qua, không ghi đè kết quả cũ lên giao diện.
     - Hỗ trợ `cancelPending()`.
  6. **Bảo tồn 100% Giao diện UI & Trải nghiệm (Section 68)**:
     - Tuyệt đối không thay đổi bất kỳ thành phần HTML/CSS nào của popup `#ide-intellisense-popup`.
     - Giữ nguyên các tính năng chọn phím tắt, snippet placeholder expansion, và ALTER script header rewriting.

---

### Chi tiết các tập tin thay đổi:

1. **`static/js/completion-engine.js` (Tạo mới)**:
   - Triển khai: `CandidateFilter`, `CompletionRanker`, `CandidateGenerator`, `CompletionEngine`.
   - Export: `window.CandidateFilter`, `window.CompletionRanker`, `window.CandidateGenerator`, `window.CompletionEngine`, `window.DefaultCompletionEngine`.
2. **`templates/index.html` (Cập nhật)**:
   - Thêm `<script src="../static/js/completion-engine.js"></script>` ngay trước `intellisense.js`.
3. **`static/js/intellisense.js` (Cập nhật)**:
   - Thêm `completionEngine` getter kết nối với `DefaultCompletionEngine`.
   - `collectAndShowCandidates` ủy nhiệm việc sinh ứng viên và xếp hạng cho `CompletionEngine`.
   - `rankAndFilterCandidates` ủy nhiệm cho `CompletionRanker`.
   - Expose `getCompletionEngine` trên facade `window.AppIntelliSense`.
4. **`tests/test_completion_engine_phase6.py` (Tạo mới)**:
   - 5 bài kiểm thử unit test kiểm tra toàn bộ pipeline, thứ tự script, logic lọc đa tầng, bộ xếp hạng ngữ cảnh, và tích hợp với `IntelliSenseController`.

---

### Kết quả kiểm thử:
- Toàn bộ suite Phase 1–6: **21 / 21 tests PASS (0.21s)**.
- Toàn bộ test suite hệ thống: **148 / 148 tests PASS**.
