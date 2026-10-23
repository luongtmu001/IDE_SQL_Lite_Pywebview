# Tài Liệu Cập Nhật Thay Đổi — LLTool IDE v1.1.0 (So với v1.0.8)

> **Ngày phát hành**: 21/10/2026  
> **Phiên bản trước**: `v1.0.8` (21/10/2026)  
> **Phiên bản hiện tại**: `v1.1.0` (Developer Productivity & Smart Refactor Engine)

---

## 1. Tóm Tắt Tổng Quan Các Thay Đổi Chính

Phiên bản **v1.1.0** mang đến bước tiến vượt bậc về năng suất làm việc (Developer Productivity) và khả năng tái cấu trúc mã nguồn SQL thông minh (Smart Refactor Engine) cho cả Microsoft SQL Server và PostgreSQL:

| STT | Trọng tâm | Mã Tính Năng | Chi tiết |
|---|---|---|---|
| **1** | **Thanh Thống Kê & Hiệu Năng Thực Thi** | `Sprint 1 - F3` | Hiển thị thời gian thực thi chính xác (`ms`/`s`), huy hiệu hiệu năng (`Fast` <200ms, `Medium` 200ms-1s, `Slow` >1s), đếm số dòng (`Rows Returned / Affected`), kích thước payload (`B`/`KB`/`MB`), tốc độ truyền tải (`KB/s`/`MB/s`) và nút sao chép tóm tắt nhanh (`Alt + S`). |
| **2** | **Đánh Dấu Sao & Gắn Thẻ Lịch Sử** | `Sprint 2 - F2` | Đánh dấu sao yêu thích (⭐) trực tiếp hoặc qua phím tắt `Ctrl + D`, gắn thẻ màu sắc đa năng (`#report`, `#analytics`, `#prod`, `#dev`), bộ lọc kết hợp đa chiều trong lịch sử truy vấn (Text + DB + Bookmark + Tags). |
| **3** | **Tham Số Truy Vấn & Bộ Mẫu Thông Minh** | `Sprint 2 - F7` | Cú pháp tham số động `{{param_name}}` với Monaco syntax highlighting màu cam hổ phách, tự động suy luận kiểu dữ liệu (`inferParamType`: Date, Number, Boolean, Text), dropdown boolean (`1/0` hoặc `true/false`), quản lý Parameter Presets trong `localStorage` và phím tắt `Alt + P`. |
| **4** | **Động Cơ Tái Cấu Trúc Mã SQL Thông Minh** | `Sprint 3 - F5` | Đổi tên đồng bộ biểu tượng/alias/biến/cột bằng phím `F2` (Monaco Rename Provider), phím tắt trích xuất subquery thành `WITH cte_name AS (...)` (`Alt + Shift + C` / `Ctrl + Shift + E` / Context Menu), và tự động chuẩn hóa khi dán khối mã SQL nhiều dòng (Format on Paste). |
| **5** | **Đạt 100% Bộ Kiểm Thử Tự Động** | `Tests` | 100% test case vượt qua thành công: `test_execution_stats.py`, `test_snippets_bookmark_tags.py`, `test_query_params_and_refactor.py`, `test_version_and_updates.py`, `test_api_surface_snapshot.py`. |

---

## 2. Chi Tiết Các Tính Năng Mới & Nâng Cấp

### 2.1. Thanh Thống Kê & Hiệu Năng Thực Thi (Execution Statistics Bar - F3)

- **Vị trí**: Nằm ngay trên thanh công cụ của tab Result Grid sau mỗi lần chạy truy vấn.
- **Các thông số hiển thị**:
  1. **Execution Time**: Thời gian phản hồi từ lúc gửi truy vấn đến khi hoàn tất nhận dữ liệu. Tự động chuyển đổi `ms` và `s`.
  2. **Performance Badge**: Phân tầng màu sắc cảnh báo tốc độ:
     - 🟢 **Fast**: Dưới 200ms.
     - 🟡 **Medium**: Từ 200ms đến 1,000ms (1s).
     - 🔴 **Slow**: Trên 1,000ms (1s).
  3. **Rows Returned / Affected**: Số bản ghi nhận được hoặc số dòng bị ảnh hưởng bởi lệnh DML/DDL.
  4. **Data Size**: Kích thước dữ liệu thô (`Bytes`, `KB`, `MB`).
  5. **Transfer Rate**: Tốc độ truyền tải mạng ước tính (`KB/s`, `MB/s`).
  6. **Copy Summary (`Alt + S`)**: Sao chép nhanh chuỗi tóm tắt dạng:
     `Execution: 45ms | Rows: 1,250 | Data: 124.5 KB | Rate: 2.7 MB/s`.

---

### 2.2. Đánh Dấu Sao & Gắn Thẻ Lịch Sử (Smart Bookmark & Tag System - F2)

- **Đánh dấu sao Bookmark (⭐)**:
  - Bấm vào biểu tượng ngôi sao bên cạnh mỗi mục lịch sử hoặc bấm phím tắt `Ctrl + D` trong Monaco Editor để đánh dấu câu truy vấn hiện tại.
- **Hệ thống Tags (#tag)**:
  - Cho phép người dùng gán các nhãn linh hoạt như `#prod`, `#dev`, `#analytics`, `#daily-report`, `#migration`.
  - Mỗi thẻ được kết xuất với huy hiệu màu sắc bắt mắt.
- **Bộ lọc đa chiều (Multi-facet Filter)**:
  - Kết hợp lọc theo từ khóa gõ vào ô tìm kiếm.
  - Lọc theo cơ sở dữ liệu kết nối.
  - Nút chuyển nhanh chế độ "Chỉ hiện Bookmark".
  - Danh sách chọn lọc theo từng Tag cụ thể.

---

### 2.3. Tham Số Truy Vấn Động & Presets (Query Parameters - F7)

- **Cú pháp**: `{{param_name}}` (ví dụ: `SELECT * FROM Orders WHERE OrderDate >= '{{start_date}}' AND Status = {{is_active}}`).
- **Monaco Syntax Highlighting**: Tokenizer tô màu cam hổ phách cao cấp (`variable.parameter`), dễ dàng nhận diện biến mẫu trong câu lệnh phức tạp.
- **Tự động suy luận kiểu dữ liệu (`inferParamType`)**:
  - Tên chứa `date`, `time` $\rightarrow$ Date input picker.
  - Tên chứa `id`, `num`, `count`, `amount`, `total` $\rightarrow$ Number input.
  - Tên chứa `is_`, `has_`, `active`, `enabled` $\rightarrow$ Dropdown Boolean (`1/0` cho SQL Server, `TRUE/FALSE` cho PostgreSQL).
  - Còn lại $\rightarrow$ Text input / Identifier.
- **Parameter Sets / Presets**:
  - Lưu và nạp nhanh các bộ giá trị tham số vào `localStorage` (`ide_query_param_presets`), giúp kiểm thử nhiều kịch bản (Dev, Test, Production) mà không phải gõ lại.
- **Phím tắt & Kích hoạt**: Nhấn `Alt + P` để mở hộp thoại tham số hoặc tự động bật khi người dùng nhấn F5/Run mà câu lệnh còn biến chưa gán.

---

### 2.4. Động Cơ Tái Cấu Trúc Mã SQL Thông Minh (Smart SQL Refactor Engine - F5)

- **Đổi tên biểu tượng đồng loạt (`F2` - Rename Symbol Across Query)**:
  - Tích hợp chuẩn Monaco `registerRenameProvider` cho SQL.
  - Đặt con trỏ vào bí danh bảng (`e` trong `Employees e`), biến T-SQL (`@TotalAmount`), CTE (`OrderSummary`), hoặc cột $\rightarrow$ bấm `F2` $\rightarrow$ nhập tên mới $\rightarrow$ đổi đồng bộ toàn bộ các vị trí xuất hiện trong câu lệnh.
- **Trích xuất Subquery thành CTE (`Alt + Shift + C` / `Ctrl + Shift + E`)**:
  - Bôi đen một subquery (ví dụ: `(SELECT CustomerId, SUM(Amount) FROM Orders GROUP BY CustomerId)`) $\rightarrow$ bấm phím tắt hoặc chọn "Extract Subquery to CTE" trong menu chuột phải $\rightarrow$ câu lệnh tự động được chuyển hóa thành:
    ```sql
    WITH cte_extracted AS (
        SELECT CustomerId, SUM(Amount) FROM Orders GROUP BY CustomerId
    )
    ...
    ```
- **Tự động định dạng khi dán (Format on Paste)**:
  - Khi dán đoạn mã SQL nhiều dòng vào editor, hệ thống tự động chuẩn hóa thụt lề và viết hoa từ khóa mà không làm mất cấu trúc logic.

---

## 3. Danh Sách Tệp Thay Đổi & Tạo Mới

| Tệp tin | Trạng thái | Mô tả |
|---|---|---|
| `app/version.py` | Cập nhật | Nâng `__version__ = "1.1.0"` và `__version_tuple__ = (1, 1, 0)`. |
| `version.json` | Cập nhật | Đồng bộ metadata release `v1.1.0`, release notes, SHA256 và kích thước file. |
| `CHANGELOG.md` | Cập nhật | Bổ sung mục `## [v1.1.0] — 21/10/2026`. |
| `docs/update_v1.1.0.md` | Tạo mới | Tài liệu chi tiết các thay đổi và tính năng mới trong bản v1.1.0. |
| `static/js/sql-refactor.js` | Tạo mới | Động cơ tái cấu trúc mã SQL (F2 rename, CTE extract, Format on Paste). |
| `static/js/query-params.js` | Cập nhật | Bổ sung auto-infer kiểu dữ liệu, selector boolean, parameter sets / presets. |
| `static/js/monaco-sql-lang.js` | Cập nhật | Monarch tokenizer hỗ trợ cú pháp `{{param_name}}` với token `variable.parameter`. |
| `static/js/monaco-init.js` | Cập nhật | Quy tắc tô màu amber/orange cho token `variable.parameter`. |
| `static/js/editor.js` | Cập nhật | Đăng ký các action `Alt+P` (Params), `Alt+Shift+C` (CTE), `Ctrl+D` (Bookmark), hook paste. |
| `static/js/context-menu.js` | Cập nhật | Bổ sung mục "Trích xuất Subquery thành CTE" trong context menu Monaco. |
| `static/js/query.js` | Cập nhật | Tích hợp thanh thống kê hiệu năng Execution Statistics Bar và lưu metrics. |
| `static/js/query-history.js` | Cập nhật | Tích hợp hệ thống Bookmark ⭐, Tags màu sắc và bộ lọc đa chiều. |
| `templates/index.html` | Cập nhật | Bổ sung script `sql-refactor.js` và modal tham số presets. |
| `templates/partials/results.html` | Cập nhật | Giao diện thanh thống kê hiệu năng Execution Statistics Bar. |
| `app/utils/sql_params.py` | Cập nhật | Hỗ trợ biên dịch tham số boolean tương thích từng DBMS. |
| `scripts/package_release.py` | Cập nhật | Nâng cấp đóng gói release `v1.1.0`, tự động đồng bộ workspace sang `dist/LLTool`. |
| `tests/test_execution_stats.py` | Tạo mới | Bộ kiểm thử tự động cho Execution Statistics Bar (8 tests). |
| `tests/test_snippets_bookmark_tags.py` | Tạo mới | Bộ kiểm thử tự động cho Bookmarks & Tags (12 tests). |
| `tests/test_query_params_and_refactor.py` | Tạo mới | Bộ kiểm thử tự động cho Query Params & SQL Refactor (17 tests). |
| `tests/test_version_and_updates.py` | Cập nhật | Đồng bộ phiên bản kiểm thử cập nhật. |

---

## 4. Hướng Dẫn Cập Nhật & Tự Động Nâng Cấp

### Cách 1: Tự động cập nhật qua In-App Auto-Updater (Khuyên dùng cho người dùng)
1. Khởi động **LLTool IDE**.
2. Ứng dụng sẽ tự động kiểm tra phiên bản mới từ xa trong luồng nền.
3. Khi phát hiện bản **v1.1.0**, thông báo cập nhật sẽ xuất hiện trên thanh công cụ góc phải hoặc trong hộp thoại **Trợ giúp ➔ Về LLTool IDE (About)**.
4. Bấm **"Tải & Cập nhật ngay"**: Ứng dụng sẽ tự động tải gói patch siêu nhẹ `LLTool_v1.1.0_patch.zip`, tự động giải nén đè vào thư mục cài đặt và kích hoạt phiên bản mới mà không cần cài đặt lại!

### Cách 2: Nâng cấp thủ công tại chỗ bằng gói Patch (`LLTool_v1.1.0_patch.zip`)
1. Tải file `LLTool_v1.1.0_patch.zip`.
2. Tắt ứng dụng LLTool nếu đang mở.
3. Giải nén toàn bộ nội dung của file `LLTool_v1.1.0_patch.zip` đè trực tiếp vào thư mục cài đặt hiện tại của LLTool IDE (ví dụ: `dist/LLTool/`).
4. Khởi động lại `LLTool.exe`.

### Cách 3: Sử dụng gói cài đặt đầy đủ (`LLTool_v1.1.0.zip`)
1. Tải về và giải nén file `LLTool_v1.1.0.zip` vào một thư mục mới tùy ý.
2. Chạy trực tiếp `LLTool.exe` để sử dụng ngay (toàn bộ cấu hình và kết nối được lưu trữ an toàn tại `%APPDATA%\LLTool`).
