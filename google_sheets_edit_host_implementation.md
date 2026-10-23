# BÁO CÁO TRIỂN KHAI THỰC TẾ — GOOGLE SHEETS EDITOR HOST (GIAI ĐOẠN 3, 4, 5)

**Tài liệu tham chiếu:** `.SKILL/google_sheet_manager_plan2.md`  
**Ngày hoàn thành:** 2026-10-20  
**Tác giả:** Antigravity Engineering  
**Trạng thái:** Hoàn thành toàn diện, sẵn sàng bàn giao  

---

## 1. Tổng Quan Kiến Trúc Triển Khai

Mục tiêu cốt lõi của tính năng là cho phép người dùng **xem và chỉnh sửa trực tiếp bảng tính Google Sheets ngay trong Pane 3** của Google Sheets Workspace bằng giao diện `/edit` chính thức của Google, thay vì chỉ xem tĩnh qua `/htmlembed` hoặc buộc phải mở cửa sổ riêng biệt.

### Phương Án Kỹ Thuật Đã Lựa Chọn:
* **Phương án 1 — Native Child Control:** Tích hợp trực tiếp control .NET `Microsoft.Web.WebView2.WinForms.WebView2` vào Form WinForms (`BrowserView.BrowserForm`) của `pywebview`.
* **Kế thừa phiên đăng nhập:** Control sử dụng cùng `UserDataFolder = cache_dir` (`DATA_DIR / ".webview_cache"`, `private_mode=False`), đồng bộ hoàn toàn Cookie và Auth Token của Google với toàn bộ ứng dụng LLTool IDE.
* **Xuyên thủng hàng rào iframe:** Do là một Native Control (HWND con độc lập) nằm trên Form WinForms, WebView2 tải URL `/edit` trực tiếp ở mức top-level frame của control đó, **hoàn toàn không bị chặn bởi HTTP Header `X-Frame-Options: SAMEORIGIN`** như khi dùng thẻ HTML `<iframe>`.

---

## 2. Danh Sách Các File Đã Tạo

| STT | Đường Dẫn File | Mục Đích & Trách Nhiệm |
| :---: | :--- | :--- |
| **1** | [`app/services/google_sheets/editor_host.py`](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/app/services/google_sheets/editor_host.py) | Module backend cốt lõi quản lý Native WebView2 Control: khởi tạo thread-safe trên STA Thread, điều hướng URL `/edit`, quản lý trạng thái (`EditorHostState`), đồng bộ tọa độ pixel, ngăn chặn liên kết ngoài thoát khỏi workspace (`NewWindowRequested`) và giải phóng tài nguyên. |
| **2** | [`tests/test_google_sheets_editor_host.py`](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/tests/test_google_sheets_editor_host.py) | Bộ unit test kiểm tra tính năng chuẩn hóa URL `/edit`, máy trạng thái vòng đời, bảo vệ gọi hàm khi chưa khởi tạo, và định tuyến liên kết ngoài sang trình duyệt hệ thống. |
| **3** | [`google_sheets_edit_host_implementation.md`](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/google_sheets_edit_host_implementation.md) | Tài liệu kỹ thuật chi tiết về cấu trúc triển khai, lý do chỉnh sửa các file và cơ chế vận hành. |
| **4** | [`google_sheets_edit_host_test_report.md`](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/google_sheets_edit_host_test_report.md) | Báo cáo kiểm thử hồi quy và đối chiếu 14 tiêu chí nghiệm thu (Mục 11). |

---

## 3. Danh Sách Các File Đã Sửa & Lý Do Chỉnh Sửa

### 3.1. `app/services/google_sheets/__init__.py`
* **Nội dung sửa:** Import và export `GoogleSheetsEditorHost`, `EditorHostState`, `normalize_sheet_edit_url` trong `__all__`.
* **Lý do:** Đóng gói thống nhất trong package `app.services.google_sheets`, cho phép các thành phần khác import sạch sẽ mà không phụ thuộc vào đường dẫn nội bộ.

### 3.2. `app/services/google_sheets/url_parser.py`
* **Nội dung sửa:** Bổ sung `htmlembed` và `pubhtml` vào biểu thức chính quy `PATH_REGEX`.
* **Lý do:** Đảm bảo khi người dùng nhập hoặc mở một sheet có sẵn link preview `/htmlembed` thì hệ thống vẫn nhận diện chính xác `spreadsheet_id` và `gid` để tự động chuyển đổi sang `/edit`.

### 3.3. `app/desktop/windows.py`
* **Nội dung sửa:**
  1. Thêm đối tượng `_editor_host` vào `GoogleSheetsSubwindowApi`.
  2. Khai báo các bridge methods: `gs_editor_host_init`, `gs_editor_host_navigate`, `gs_editor_host_set_bounds`, `gs_editor_host_set_visible`, `gs_editor_host_get_state`, `gs_editor_host_dispose`.
  3. Gắn hook tự động gọi `sub_api.gs_editor_host_dispose()` trong sự kiện `on_closed` của cửa sổ Workspace.
* **Lý do:** Tạo cầu nối giữa frontend JS và backend Native Host, đồng thời đảm bảo dọn dẹp control sạch sẽ khỏi Form Controls khi đóng cửa sổ nhằm chống rò rỉ bộ nhớ.

### 3.4. `templates/google_sheets_window.html`
* **Nội dung sửa:**
  1. Bổ sung container `#gs-native-editor-wrap` cùng phần tử neo `#gs-editor-anchor`.
  2. Nâng cấp thanh chuyển đổi chế độ xem (View Switcher) lên 3 cấp độ:
     * **🌐 Chỉnh Sửa Trực Tiếp (/edit)**: Mặc định chính thức.
     * **👁️ Xem Tĩnh (Preview Web)**: Chế độ dự phòng 1.
     * **📊 Bảng Tính IDE (Grid Editor)**: Chế độ dự phòng 2.
* **Lý do:** Chuẩn bị DOM layout độc lập không dùng inline CSS/JS để định vị control và cung cấp đầy đủ các chế độ fallback theo Mục 6.1.

### 3.5. `static/css/google-sheets/google-sheets.css`
* **Nội dung sửa:** Bổ sung rules cho `.gs-native-editor-wrap` và `.gs-editor-anchor`.
* **Lý do:** Đảm bảo container editor có vị trí `relative`, tràn đầy diện tích khả dụng của Pane 3 (`flex: 1`), màu nền `#ffffff` chuẩn bảng tính và neo tọa độ trong suốt `pointer-events: none`.

### 3.6. `static/js/google-sheets/view.js`
* **Nội dung sửa:**
  1. Khởi tạo mặc định `_currentViewMode = 'editor'`.
  2. Thêm hàm `syncEditorHostBounds()`: Đo `getBoundingClientRect()` của vùng neo và gửi tọa độ pixel về backend qua `gs_editor_host_set_bounds`.
  3. Thêm hàm `_navigateNativeEditor(sheet)`: Tự động tải URL `/edit` khi chọn sheet.
  4. Nâng cấp `_switchViewMode(mode)` hỗ trợ 3 chế độ `editor`, `live`, `grid`.
  5. **Giải quyết triệt để Airspace Overlap:**
     * Ẩn control khi mở modal Thêm Dự Án / Thêm Sheet (`openProjectDialog`, `openSheetDialog`).
     * Ẩn control trong suốt thời gian kéo Splitter Resizer (`mousedown` -> `mousemove`) và hiện lại khi thả chuột (`mouseup`).
     * Đồng bộ lại tọa độ khi Toggle Sidebar (`Ctrl+B`), resize cửa sổ (`window.onresize`), chuyển focus (`window.onfocus`) hoặc phục hồi sau khi thu nhỏ (`document.onvisibilitychange`).
* **Lý do:** Quản lý giao diện, sự kiện người dùng và giải quyết hoàn toàn các giới hạn hiển thị của Native HWND Win32 trên nền web.

### 3.7. `tests/test_google_sheets_window_and_theme.py`
* **Nội dung sửa:** Bổ sung test case `test_editor_host_api_bridge` kiểm tra tương tác của `GoogleSheetsSubwindowApi` với các phương thức editor host.
* **Lý do:** Bảo vệ chống hồi quy (regression) cho các API bridge.

---

## 4. Quản Lý Trạng Thái (State Management)

Theo yêu cầu Mục 6.3, `GoogleSheetsEditorHost` quản lý các trạng thái hoạt động thông qua enum `EditorHostState`:

```text
[ INITIALIZING ]  ──>  [ LOADING ]  ──>  [ READY ] (Chỉnh sửa bình thường)
                              │
                              ├──>  [ AUTH_REQUIRED ] (Cần đăng nhập Google)
                              ├──>  [ READ_ONLY ] (Chỉ có quyền xem)
                              ├──>  [ ACCESS_DENIED ] (Không có quyền)
                              └──>  [ NETWORK_ERROR ] (Mất kết nối mạng)
                                         │
[ DISPOSED ]  <──  [ CLOSING ]  <────────┘
```

---

## 5. Các Giới Hạn Còn Tồn Tại & Phương Án Dự Phòng

1. **Hiện tượng Airspace của Native Control:**
   * Vì WebView2 con là một HWND Win32, nó luôn hiển thị trên bề mặt DOM của WebView2 mẹ tại vị trí tọa độ của Pane 3.
   * *Giải pháp đã xử lý:* Tự động ẩn Native Control khi người dùng mở các hộp thoại modal và khi đang kéo rê Splitter Resizer. Khi đóng hộp thoại hoặc thả chuột, control hiện lại tức thì.
2. **Yêu cầu kết nối mạng:**
   * URL `/edit` yêu cầu kết nối tới máy chủ Google Docs.
   * *Phương án dự phòng:* Người dùng có thể chuyển sang tab **📊 Bảng Tính IDE (Grid Editor)** để xem và chỉnh sửa dữ liệu đã cache offline hoặc bấm **↗️ Mở Cửa Sổ Mới** để mở cửa sổ độc lập.
