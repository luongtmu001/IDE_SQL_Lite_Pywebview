# Kế hoạch Thay đổi IntelliSense Web: plan_web_002

- **Ngày tạo**: 2026-09-10
- **Trạng thái**: Hoàn thành (Completed)
- **Mục tiêu**:
  1. **Vị trí và Kéo thả (Positioning & Dragging)**: Định vị popup chính xác ngay cạnh con trỏ và phía dưới một chút (`coords.bottom + 4`, `coords.left`), sử dụng `position: fixed` với tọa độ viewport từ `cm.cursorCoords(cursor, 'window')`. Cho phép người dùng kéo thả popup (`drag`) bằng thanh tiêu đề để di chuyển vị trí bất kỳ lúc nào.
  2. **Gợi ý Kiểu dữ liệu (Data Types)**: Bổ sung danh mục kiểu dữ liệu hệ thống (System types: `INT`, `BIGINT`, `NVARCHAR`, `VARCHAR`, `DECIMAL`, `DATETIME`, `BIT`, `UNIQUEIDENTIFIER`...) và kiểu dữ liệu người dùng (User-defined types UDT). Cung cấp endpoint backend `/api/metadata/<conn>/intellisense/types`.
  3. **Tự động Gợi ý Cột trong SELECT**: Khi câu lệnh đã có bảng (trong mệnh đề `FROM` hoặc `JOIN`), câu `SELECT` sẽ tự động gợi ý toàn bộ các cột của các bảng đó mà không bắt buộc người dùng phải gõ tiền tố alias (`c.`). Cột của các bảng trong query được ưu tiên xếp hạng hàng đầu trong mệnh đề `SELECT`.
  4. **Cấu hình Font JetBrains Mono & Line Height 1.4**: Nạp font `JetBrains Mono` từ Google Fonts trong `templates/index.html`, áp dụng triệt để cho CodeMirror với `line-height: 1.4` trong cả `static/css/editor.css` và `static/css/themes.css` theo Section 13 của `intellisense_overview.md`.
  5. **Tắt Bảng Gợi ý Sau Khi Chọn**: Khi người dùng nhấn Enter/Tab hoặc click chọn item, popup lập tức đóng lại hoàn toàn. Thiết lập cờ `isConfirmingCompletion` chặn sự kiện `change` do `replaceRange` gây ra; loại bỏ việc auto re-trigger sau khi chọn; chỉ khi người dùng bắt đầu gõ phím ký tự tiếp theo (`typing`) thì hệ thống mới gợi ý tiếp.

---

### Các thay đổi chi tiết đã thực hiện

1. **`templates/index.html`**:
   - Thêm liên kết Google Fonts nạp font `JetBrains Mono`.

2. **`templates/partials/editor.html`**:
   - Bổ sung icon kéo thả `ide-drag-handle` (`fa-grip-vertical`) và tiêu đề "Click and drag to move suggestions" vào `.ide-intellisense-header`.

3. **`static/css/themes.css` & `static/css/editor.css`**:
   - Đồng bộ thiết lập font `JetBrains Mono`, `line-height: 1.4` và `font-size: 13px` cho `.CodeMirror`, loại bỏ ghi đè từ `themes.css`.
   - Cấu hình `#ide-intellisense-popup` thành `position: fixed !important; z-index: 2000 !important;`.
   - Cấu hình `.ide-intellisense-header` có `cursor: move; user-select: none;`.

4. **`app/routes/metadata.py`**:
   - Thêm endpoint `@metadata_bp.get("/<connection_id>/intellisense/types")` trả về cả kiểu dữ liệu hệ thống (`types`) và kiểu dữ liệu người dùng (`user_types`).

5. **`static/js/context-analyzer.js`**:
   - Bổ sung danh sách chuẩn `SQL_DATA_TYPES`.
   - Xây dựng hàm `extractAllTablesInQuery(sqlText)` phân tích mọi bảng xuất hiện trong các mệnh đề `FROM` và `JOIN` của câu lệnh.
   - Thêm trường `queryTables` vào kết quả trả về của `SqlContextAnalyzer.analyze(fullSql, cursorIndex)`.
   - Export `SQL_DATA_TYPES` và `extractAllTablesInQuery` trên `window.SqlContextAnalyzer`.

6. **`static/js/intellisense.js`**:
   - Thêm `initPopupDrag()` cho phép kéo thả popup trên header; ghi nhớ trạng thái kéo thả (`popupHasBeenDragged`) trong suốt phiên gõ hiện tại và reset khi popup ẩn.
   - Định vị `position: fixed` chuẩn xác dựa trên `cm.cursorCoords(cursor, 'window')` với `top = coords.bottom + 4` và `left = coords.left`.
   - Thêm cơ chế tự động lấy cột của tất cả các bảng trong câu lệnh (`context.queryTables`) khi ở ngữ cảnh `SELECT`, gán mức ưu tiên cao (`level: 1.1`) và sắp xếp đưa lên đầu danh sách gợi ý.
   - Thêm hàm `fetchDataTypes(connectionId, database)` và đưa các kiểu dữ liệu hệ thống và UDT vào danh sách gợi ý khi người dùng gõ.
   - Bổ sung preview chi tiết trong Summary tab và Script tab cho kiểu dữ liệu và cột của bảng query.
   - Xử lý triệt để việc ẩn popup sau khi chọn: đặt cờ `isConfirmingCompletion = true`, hủy `debounceTimer`, loại bỏ auto re-trigger; sự kiện `change` tiếp sau do `replaceRange` phát sinh sẽ bị bỏ qua, chỉ gợi ý lại khi người dùng chủ động gõ phím ký tự tiếp theo.

7. **`tests/test_intellisense_api.py`**:
   - Bổ sung unit test cho endpoint `/api/metadata/<conn>/intellisense/types`. Tất cả 100% test cases đều PASS.
