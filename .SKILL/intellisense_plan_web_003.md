# Kế hoạch Thay đổi IntelliSense Web: plan_web_003 (Phase 1)

- **Ngày thực hiện**: 2026-09-30
- **Phase**: Phase 1 — Tách IntelliSense Controller (Section 63 của intellisense_improvement_plan_v2.md)
- **Trạng thái**: Hoàn thành (Completed)
- **Mục tiêu**:
  1. **Tách biệt Editor và IntelliSense**: Xây dựng lớp `EditorAdapter` chuẩn tắc, cô lập `window.AppEditor` khỏi business logic của IntelliSense.
  2. **Tái cấu trúc IntelliSense Controller**: Phân chia `intellisense.js` thành 3 thành phần có trách nhiệm rõ ràng:
     - `EditorAdapter`: Hợp đồng chuẩn hóa giao tiếp văn bản, con trỏ, vùng chọn, tọa độ pixel, sự kiện (`change`, `cursorActivity`, `keydown`).
     - `IntelliSenseController`: Bộ điều phối nghiệp vụ debouncing (120ms), trigger detection, xếp hạng ứng viên, xác nhận chèn gợi ý (snippet expansion, ALTER proc/view rewrite).
     - `IntelliSensePopupUI`: Quản lý hiển thị popup `#ide-intellisense-popup`, thanh kéo splitter, drag header, xem trước Summary & Script tabs.
     - `IntelliSenseDataProvider`: Quản lý fetch API và client-side cache.
  3. **Bảo toàn 100% Giao diện & Trải nghiệm**:
     - Không sửa đổi bất kỳ thẻ HTML hay CSS nào của popup Dual-Panel.
     - Bảo toàn đầy đủ 9 tính năng cốt lõi (F12 Go to Definition, ALTER auto-template, snippets, follow-up keywords, selection navigation).
     - Đảm bảo tương thích ngược 100% cho `window.AppIntelliSense` facade.

---

### Chi tiết các tập tin thay đổi:

1. **`static/js/editor-adapter.js` (Tạo mới)**:
   - Triển khai lớp `EditorAdapter` với các phương thức: `getText()`, `getLine()`, `getCurrentLine()`, `getTextBeforeCursor()`, `getTextAfterCursor()`, `getCursor()`, `getCursorOffset()`, `posFromIndex()`, `indexFromPos()`, `setCursor()`, `setSelection()`, `findWordAt()`, `replaceRange()`, `getRange()`, `getCursorCoordinates()`, `scrollIntoView()`, `focus()`, `on()`.
   - Export ra `window.EditorAdapter`.

2. **`templates/index.html` (Cập nhật)**:
   - Thêm thẻ `<script src="../static/js/editor-adapter.js"></script>` ngay trước `intellisense.js`. Không can thiệp bất kỳ phần tử DOM nào.

3. **`static/js/intellisense.js` (Tái cấu trúc & Sửa lỗi ALTER VIEW)**:
   - Đóng gói các lớp:
     - `IntelliSenseDataProvider`: quản lý bộ nhớ đệm Maps (`objectsCache`, `columnsCache`, `parametersCache`, `definitionsCache`, `dataTypesCache`).
     - `IntelliSensePopupUI`: phụ trách toàn bộ DOM `#ide-intellisense-popup`, splitter kéo co giãn, header kéo di chuyển, mouse threshold 35px, preview Summary / Script.
     - `IntelliSenseController`: điều phối luồng debounce 120ms, phân tích ngữ cảnh `SqlContextAnalyzer.analyze()`, xếp hạng candidates, xử lý chọn item (Snippet placeholder expansion, ALTER proc/view/func script rewriting), và F12 Go to Definition.
   - Thêm hàm chuẩn hóa `normalizeAdapter(editorOrAdapter)` giúp tự động bọc bất kỳ editor instance nào (kể cả gọi trực tiếp từ `editor.js` cũ) qua `EditorAdapter`.
   - Giữ nguyên toàn bộ API công khai trên `window.AppIntelliSense` (`attachEditor`, `triggerIntelliSense`, `hidePopup`, `goToDefinition`, `isPopupVisible`, `chooseCurrentItem`, `getController`, `getPopupUI`, `getDataProvider`).
   - **Khắc phục lỗi sinh DDL cho `ALTER VIEW`**:
     - Bổ sung điều kiện `context.isAlterContext` vào trigger condition của Controller để popup gợi ý ngay khi người dùng gõ `ALTER VIEW ` (kể cả khi sau dấu cách chưa có ký tự).
     - Bảo toàn `currentContext` trong hàm `chooseItem` trước khi đóng popup, khắc phục lỗi mất ngữ cảnh khiến lệnh ALTER bị bỏ qua.
     - Nâng cấp regex thay thế header sang đa dòng `\bCREATE\s+(?:OR\s+(?:ALTER|REPLACE)\s+)?(VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER)\b`, hoạt động chính xác với cả các view có comment đầu dòng hoặc thiết lập `SET ANSI_NULLS ON` trong SQL Server / PostgreSQL.

4. **`tests/test_editor_adapter_phase1.py` (Tạo mới)**:
   - Automated unit test kiểm tra sự tồn tại của `EditorAdapter`, kiểm tra thứ tự nạp script trong `index.html`, và xác thực các lớp kiến trúc mới trong `intellisense.js`.
   - Bổ sung test case `test_alter_view_regex_transformation()` kiểm thử việc chuyển đổi DDL cho cả `ALTER VIEW`, `CREATE OR ALTER VIEW` và vị trí đặt con trỏ sau tên view. 100% PASS.

---

### Kết quả kiểm thử:
- Toàn bộ test suite: **129 / 129 tests PASS** (`pytest -s tests/`).
- Thời gian chạy test suite: ~3.89s.
- Hiệu năng phân tích & hiển thị: Không có bất kỳ độ trễ bổ sung nào.
