# Phân Tích & Kế Hoạch Triển Khai: Google Sheets Manager

## Tổng Quan

Tài liệu `.SKILL/google_sheet_manager.md` là một **đặc tả kỹ thuật chi tiết** (technical spec) cho tính năng tích hợp Google Sheets vào LLTool IDE — không phải một skill Antigravity thông thường. Nó định nghĩa toàn bộ yêu cầu, kiến trúc, quy tắc và kế hoạch giai đoạn.

---

## 1. Phân Tích Tài Liệu

### 1.1. Mục tiêu cốt lõi

- Người dùng **paste link** Google Sheets → lưu vào danh mục theo dự án.
- Click vào Sheet → mở **giao diện Google Sheets thực tế** trong vùng **WebView2** nhúng trong IDE.
- Google chịu trách nhiệm lưu/đồng bộ nội dung. LLTool chỉ quản lý **metadata**.

### 1.2. Ràng buộc quan trọng cần chú ý

| Ràng buộc | Lý do |
|-----------|-------|
| Không ghi logic vào `main.py` | Tránh làm phức tạp file khởi tạo |
| Không nhúng CSS/JS inline vào HTML | Quy tắc tách biệt module bắt buộc |
| Không dùng OAuth nội bộ WebView2 | Rủi ro bảo mật; dùng phiên trình duyệt sẵn có |
| Không thay đổi Monaco, Result Grid, SQL | Bảo toàn chức năng hiện tại |
| Không thay iframe/preview nếu không được phê duyệt | Yêu cầu WebView2 thực sự, không giả lập |
| Ghi file tạm trước khi thay thế file chính | Bảo toàn dữ liệu người dùng |

### 1.3. Rủi ro kỹ thuật chính

> **Rủi ro #1 — WebView2 Embedding:** pywebview dùng WebView2 nhưng chưa chắc hỗ trợ tạo một vùng WebView2 **độc lập** nằm *bên trong* cửa sổ IDE. Đây là điểm chưa được xác minh.

> **Rủi ro #2 — Xác thực Google:** WebView2 có thể không duy trì phiên Google qua các lần mở lại ứng dụng. Google cũng có thể chặn embedded browser.

> **Rủi ro #3 — Isolation:** Tab Google Sheets không được làm treo/ảnh hưởng các tab SQL/XML đang hoạt động.

---

## 2. Kế Hoạch Triển Khai (6 Giai Đoạn)

### Giai đoạn A — Khảo Sát Kiến Trúc ⬅️ **BẮT ĐẦU Ở ĐÂY**

> **Điều kiện tiên quyết trước mọi code.**

```
Đọc cấu trúc project hiện tại
├── Cơ chế mở/đóng tab
├── Cách khởi tạo pywebview/WebView2
├── Python bridge (JS ↔ Python)
├── Cơ chế lưu dữ liệu người dùng
├── Quy tắc giao diện (màu sắc, font, spacing)
└── File nào sẽ bị ảnh hưởng
```

**Đầu ra:** `google_sheets_architecture_audit.md`

---

### Giai đoạn B — Prototype WebView2 ⚠️ **GATE QUAN TRỌNG NHẤT**

> **Không triển khai giao diện trước khi giai đoạn này xác nhận khả thi.**

Kiểm tra 10 trường hợp (P01–P10):
- Mở link Google Sheets thực tế ✓
- Đăng nhập hoạt động ✓
- Chỉnh sửa và lưu ✓
- Duy trì phiên ✓
- **Gắn vào cửa sổ IDE (không phải cửa sổ rời)** ✓

**Đầu ra:** `google_sheets_webview2_spike_report.md`

---

### Giai đoạn C — Backend & Registry

Sau khi B được xác nhận:

```
backend/google_sheets/
├── __init__.py
├── service.py       → CRUD dự án & Sheet
├── registry.py      → Đọc/ghi google_sheets.json
├── url_parser.py    → Validate & normalize URL
└── webview_host.py  → Quản lý WebView2 instance
```

**APIs cần triển khai:**
- `list_projects()`, `create_project()`, `update_project()`, `delete_project()`
- `add_sheet()`, `update_sheet()`, `remove_sheet()`
- `save_workspace()`

**File dữ liệu:** `google_sheets.json` — độc lập, không ghi đè `connections.json` / `settings.json`.

---

### Giai đoạn D — Giao Diện Quản Lý

```
static/js/google-sheets/
├── manager.js  → Danh sách dự án & Sheet
├── tabs.js     → Điều phối tab
└── view.js     → Trạng thái giao diện

static/css/google-sheets/
└── google-sheets.css  → Namespace riêng, không ảnh hưởng global

templates/
└── google-sheets.html → Chỉ cấu trúc, không CSS/JS inline
```

Tham khảo UI tại:  
`D:\Luong\NB_Personal\Python\IDE-SQL-Lite_New_Pyweb_Claude\project_workspace_prototype.html`

---

### Giai đoạn E — Tích Hợp WebView2 Vào IDE

- Áp dụng kết quả prototype B vào production.
- Mở URL `/edit` (có `gid` nếu cần).
- Hiển thị loading → Ready / Failed.
- Xử lý popup, link ngoài, quyền.
- Nút **"Open in Browser"** làm fallback.
- Kiểm soát vòng đời: Registered → Initializing → Loading → Ready/Failed → Closing → Disposed.

---

### Giai đoạn F — Kiểm Thử Hồi Quy

Phải kiểm tra các chức năng **hiện có không bị ảnh hưởng:**
- SQL Editor, Monaco Editor, Result Grid
- Kết nối SQL Server / PostgreSQL
- XML/JSON Viewer, Object Explorer
- Cấu hình người dùng
- Bản build đóng gói

**Đầu ra:** `google_sheets_test_report.md`

---

## 3. Checklist Triển Khai Tổng Hợp

```
GIAI ĐOẠN A
[x] Đọc cấu trúc project
[x] Xác định cơ chế tab, bridge, pywebview
[x] Xác định vị trí lưu dữ liệu người dùng
[x] Khảo sát UI tokens (màu, font, spacing)
[x] Liệt kê file dự kiến thay đổi
[x] Tạo google_sheets_architecture_audit.md

GIAI ĐOẠN B
[x] Tạo prototype WebView2 độc lập (Prototype A, B, C)
[x] Kiểm tra P01–P10
[x] Xác nhận gắn được vào cửa sổ IDE (mô hình Companion Subwindow như Bravo)
[x] Xác nhận đăng nhập & chỉnh sửa (UDF session persistence, X-Frame-Options: DENY)
[x] Tạo google_sheets_webview2_spike_report.md
✅ Giai đoạn B ĐẠT (PASS) — Tiếp tục triển khai Giai đoạn C

GIAI ĐOẠN C
[x] service.py, registry.py, url_parser.py, webview_host.py
[x] google_sheets.json (không đụng file cũ, lưu tại user data dir)
[x] Unit test CRUD (9/9 pass) & hồi quy hệ thống (351/351 pass)
[x] Test phục hồi khi JSON lỗi (tự động backup .corrupt.*)
[x] Tích hợp GoogleSheetsApiMixin vào MainApi trong main.py

GIAI ĐOẠN D
[x] manager.js, tabs.js, view.js (tách riêng modular trong static/js/google-sheets/)
[x] google-sheets.css (namespace riêng .gs-* trong static/css/google-sheets/)
[x] Giao diện quản lý modal trong DOM (đầy đủ header, sidebar dự án, sheet cards)
[x] Sidebar dự án + Sheet list
[x] Dialog thêm link & kiểm tra URL trực tiếp khi gõ (live validation)
[x] Tìm kiếm, ghim, sửa tên, xóa, lọc yêu thích

GIAI ĐOẠN E
[x] Tích hợp WebView2 host (GoogleSheetsWindowManager + DWM Dark Theme)
[x] Vòng đời cửa sổ đầy đủ (Opened -> Focused -> Closed sync)
[x] Fallback "Open in Browser" (nút quả địa cầu gọi webbrowser)
[x] Kiểm tra giải phóng tài nguyên (closed event dọn dẹp window reference)

GIAI ĐOẠN F
[x] Kiểm thử hồi quy toàn bộ (351/351 tests pass, 9/9 unit tests pass)
[x] Tạo google_sheets_test_report.md
[x] Chốt danh sách lỗi còn lại (0 lỗi)
[x] Hoàn thành & Sẵn sàng phát hành
```

---

## 4. Hành Động Tiếp Theo

Bước tiếp theo **ngay lập tức** là thực hiện **Giai đoạn A — Khảo Sát Kiến Trúc**.

Tôi có thể:
1. **Khảo sát ngay** — đọc cấu trúc project, bridge, tab system và tạo `google_sheets_architecture_audit.md`.
2. **Kiểm tra prototype WebView2** — nếu bạn muốn xác nhận tính khả thi trước.
3. **Cả hai theo thứ tự** — A rồi B liên tiếp.

> Bạn muốn bắt đầu với bước nào?
