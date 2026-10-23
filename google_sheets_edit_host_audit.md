# BÁO CÁO AUDIT KIẾN TRÚC CHO GOOGLE SHEETS EDIT HOST (GIAI ĐOẠN 1)

**Tài liệu tham chiếu:** `.SKILL/google_sheet_manager_plan2.md` (Mục 4)  
**Thời gian thực hiện:** 2026-10-19  
**Mục tiêu:** Khảo sát toàn diện kiến trúc hiện tại của LLTool IDE (pywebview, WinForms, WebView2, DOM Workspace) để xác định phương án kỹ thuật khả thi cho việc chỉnh sửa trực tiếp Google Sheets trong Pane 3.

---

## 1. Kết Quả Khảo Sát Các Thành Phần Hiện Tại

### 1.1. `main.py` & Vòng Đời Cửa Sổ Ứng Dụng
* **Khởi tạo GUI Loop:** `webview.start(gui="edgechromium", storage_path=str(cache_dir.resolve()), private_mode=False, debug=False)` (dòng 352).
* **Kiến trúc luồng:**
  * `webview.start()` là hàm **blocking** chạy WinForms Message Loop (`Application.Run()`) trên Main STA Thread của tiến trình Windows.
  * Việc tạo các cửa sổ con (subwindows) như Settings, Profiler, Activity Monitor, Schema Compare và Google Sheets Workspace đều được gọi thông qua `webview.create_window(...)` sau khi Message Loop đã chạy.
  * `pywebview` tự động hook vào message loop hiện có và hiển thị thêm Form WinForms mới mà **không cần khởi động lại `webview.start()`**.

### 1.2. Cấu hình WebView2 & Phiên Bản `pywebview`
* **Phiên bản `pywebview`:** **6.2.1** (sử dụng thư viện cầu nối `pythonnet` / `clr`).
* **Backend Windows:** `webview.platforms.winforms` kết hợp với `webview.platforms.edgechromium`.
* **Cấu trúc Lớp Native bên trong pywebview 6.2.1:**
  * `window.native`: Là một instance của `BrowserView.BrowserForm` (kế thừa trực tiếp từ `System.Windows.Forms.Form`).
  * `BrowserForm.browser`: Là một instance của `EdgeChrome`.
  * `BrowserForm.browser.webview`: Là một control .NET **`Microsoft.Web.WebView2.WinForms.WebView2`**.
  * Trong hàm `EdgeChrome.__init__`:
    ```python
    self.webview = WebView2()
    props = CoreWebView2CreationProperties()
    props.UserDataFolder = cache_dir  # Thư mục từ storage_path
    props.set_IsInPrivateModeEnabled(_state['private_mode'])
    self.webview.CreationProperties = props
    form.Controls.Add(self.webview)
    self.webview.Dock = WinForms.DockStyle.Fill
    ```
* **Quản lý Session & Cookie:**
  * Toàn bộ các cửa sổ do `webview.create_window(...)` tạo ra đều chia sẻ cùng một `UserDataFolder` (`EBWebView` trong thư mục cache).
  * `private_mode=False` -> **Phiên đăng nhập Google (Cookie, Session, Token) được tự động lưu trữ và chia sẻ giữa các cửa sổ WebView2 trong cùng ứng dụng**.

### 1.3. `view.js` & `google_sheets_window.html` (Pane 3 Hiện Tại)
* **Khung hiển thị Pane 3:** Đang chứa `#gs-embed-wrap` với thẻ `<iframe>` tải URL nhúng:
  `https://docs.google.com/spreadsheets/d/{spreadsheetId}/htmlembed?widget=true&headers=true&gid={gid}`.
* **Hạn chế:** Endpoint `/htmlembed` chỉ cung cấp chế độ xem tĩnh/bán tương tác, không hỗ trợ thanh công cụ, menu và các tính năng chỉnh sửa chính thức của Google Sheets.
* **Rào cản khi dùng iframe cho `/edit`:** Khi cố tình đổi `iframe.src` sang link `/edit`, Google trả về header HTTP `X-Frame-Options: SAMEORIGIN` và CSP `frame-ancestors 'self'`, khiến WebView2 chặn hoàn toàn frame này.

### 1.4. `webview_host.py` & Cơ Chế Mở Cửa Sổ Độc Lập
* Hàm `GoogleSheetsWindowManager.open_sheet_window(...)` trong `app/services/google_sheets/webview_host.py` tạo một cửa sổ WebView2 độc lập thông qua `webview.create_window()`.
* Cửa sổ này tải trực tiếp URL `https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit`, do đó hiển thị 100% giao diện chỉnh sửa của Google Sheets và lưu dữ liệu trực tiếp lên cloud.

---

## 2. Trả Lời 7 Câu Hỏi Bắt Buộc Của Giai Đoạn 1

### Câu 1: Phiên bản `pywebview` đang sử dụng là phiên bản nào?
* **Trả lời:** `pywebview` phiên bản **6.2.1** (cài đặt trong `venv`, sử dụng `pythonnet 3.x` và `Microsoft.Web.WebView2.WinForms.dll`).

### Câu 2: `pywebview` có cung cấp API công khai phù hợp để tích hợp WebView2 native vào vùng giao diện hiện tại không?
* **Trả lời:** **KHÔNG**.
  * API công khai của `pywebview` (`webview.create_window()`, `window.load_url()`, `window.evaluate_js()`) chỉ quản lý các cửa sổ Top-level (mỗi window là một Form WinForms độc lập).
  * `pywebview` không có API sẵn để nhúng một WebView2 thứ hai làm child element bên trong cây DOM HTML của một cửa sổ hiện có.

### Câu 3: Có thể mở rộng hoặc tích hợp với Form/Control nội bộ mà không phụ thuộc quá nhiều vào implementation riêng của thư viện không?
* **Trả lời:** **CÓ, thông qua 2 cơ chế:**
  1. **Cơ chế Can thiệp WinForms Controls (`window.native.Controls`):** Vì `window.native` là WinForms `Form`, ta có thể tạo thêm một instance `Microsoft.Web.WebView2.WinForms.WebView2`, gán `Parent = form`, và định vị tọa độ.
  2. **Cơ chế Win32 `SetParent(child_hwnd, parent_hwnd)`:** Tạo một subwindow bằng `webview.create_window(frameless=True)` rồi gọi Win32 `SetParent` để gắn HWND con vào HWND của cửa sổ cha.

### Câu 4: Có thể tạo WebView2 trong STA Thread hiện tại mà không gây xung đột với WinForms Message Loop không?
* **Trả lời:** **CÓ**.
  * WinForms Message Loop đang chạy ổn định trên Main STA Thread (`webview.start()`). Mọi thao tác thêm Control, Form hoặc khởi tạo `WebView2` đều có thể dispatch an toàn thông qua `form.Invoke(...)` hoặc các event thread-safe của WinForms mà không làm treo hay xung đột Message Loop.

### Câu 5: WebView2 có thể được bố trí trực tiếp trong Pane 3 và cập nhật kích thước theo Pane không?
* **Trả lời:** **CÓ, nhưng cần xử lý kỹ thuật đồng bộ:**
  * Vị trí Pane 3 được xác định bằng DOM Rect trong JavaScript: `document.getElementById('gs-editor-pane').getBoundingClientRect()`.
  * Khi người dùng kéo Splitter Resizer, toggle sidebar, hoặc resize cửa sổ chính, JavaScript gửi tọa độ `(x, y, width, height)` về Python backend qua API bridge.
  * Python backend gọi `Invoke` để set bounds (`Location`, `Size`) cho WebView2 native control tương ứng.
  * **Cần lưu ý:** Phải ẩn hoặc disable pointer events của native control trong lúc kéo thả chuột (mousedown -> mouseup) để tránh hiện tượng mouse grab và giật hình (flicker).

### Câu 6: Cơ chế `storage_path` hiện tại có cho phép sử dụng lại phiên đăng nhập Google không?
* **Trả lời:** **CÓ**.
  * `main.py` cấu hình: `webview.start(gui="edgechromium", storage_path=str(cache_dir.resolve()), private_mode=False)`.
  * Mọi instance `WebView2` được tạo ra trong tiến trình, nếu truyền cùng `props.UserDataFolder = cache_dir`, đều chia sẻ chung toàn bộ Cookie Jar, LocalStorage và Session của Google.
  * Khi người dùng đã đăng nhập Google trên một cửa sổ hoặc form đăng nhập, Editor Host sẽ nhận diện phiên làm việc ngay lập tức mà không bắt đăng nhập lại.

### Câu 7: Cần thay đổi những file nào để triển khai mà không ảnh hưởng các chức năng hiện có?
* **Trả lời:**
  1. `app/services/google_sheets/editor_host.py` *(Tạo mới)*: Chịu trách nhiệm khởi tạo, định vị, resize và giải phóng native WebView2 Editor Control trong Form.
  2. `app/desktop/windows.py`: Bổ sung hook để gắn `editor_host` vào `GoogleSheetsSubwindowApi` và quản lý vòng đời khi đóng cửa sổ Workspace.
  3. `templates/google_sheets_window.html`: Chuẩn bị container `#gs-editor-host-container` trong Pane 3.
  4. `static/js/google-sheets/view.js`: Gửi tọa độ Rect khi render, resize hoặc toggle sidebar; đồng thời gọi API đồng bộ Editor Host.
  5. Giữ nguyên toàn bộ các module khác (SQL Editor, Connections, Activity Monitor, Schema Compare, Monaco).

---

## 3. Đánh Giá Các Phương Án Triển Khai Cho Giai Đoạn 2 (Prototype)

| Phương Án | Mô Tả Kỹ Thuật | Ưu Điểm | Thách Thức / Rủi Ro | Đánh Giá Khả Thi |
| :--- | :--- | :--- | :--- | :--- |
| **Phương án 1 (Native Child Control)** | Dùng .NET `WebView2` control add trực tiếp vào `form.Controls` của cửa sổ Workspace, định vị theo tọa độ Pane 3. | Hiển thị 100% URL `/edit`, không bị Google chặn `X-Frame-Options`, dùng chung Session. | Hiện tượng Airspace (control native luôn đè lên HTML), cần đồng bộ vị trí khi kéo Splitter. | **Khả thi cao nhất** (Được ưu tiên làm prototype ở Giai đoạn 2). |
| **Phương án 2 (Win32 SetParent)** | Dùng `webview.create_window(frameless=True)` rồi gọi Win32 `SetParent(child, parent)` để gắn vào Pane 3. | Tận dụng sẵn toàn bộ wrapper của pywebview. | Phức tạp trong quản lý Message Loop, dễ bị lỗi focus và z-order trên Windows 11. | Dự phòng cho Phương án 1. |
| **Phương án 3 (Loại bỏ X-Frame-Options qua Network Filter)** | Dùng `CoreWebView2.WebResourceRequested` để can thiệp xóa header `X-Frame-Options` của Google Sheets khi nhúng `<iframe>`. | 100% nằm trong DOM HTML, không có lỗi Airspace hay lệch tọa độ khi resize. | Google Sheets có thêm nhiều lớp bảo mật JS chống frame busting nội bộ (`window.top !== window.self`), dễ bị màn hình trắng hoặc redirect. | Rủi ro cao do cơ chế bảo mật của Google. |

---

## 4. Kết Luận & Kế Hoạch Tiếp Theo

1. **Kết luận Giai đoạn 1:**
   * Việc tích hợp chỉnh sửa Google Sheets trực tiếp trong Pane 3 là **khả thi về mặt kỹ thuật** bằng cách nhúng native control `WebView2` vào Form WinForms của cửa sổ Google Sheets Workspace.
   * Cấu hình `storage_path` hiện tại đảm bảo việc chia sẻ phiên đăng nhập an toàn giữa các cửa sổ.
2. **Kế hoạch Giai đoạn 2 (Xây dựng Prototype):**
   * Xây dựng một prototype độc lập: `scratch/prototype_editor_host.py` để kiểm nghiệm việc khởi tạo `Microsoft.Web.WebView2.WinForms.WebView2`, gắn vào Form, tải URL `/edit`, kiểm tra chỉnh sửa dữ liệu và đồng bộ resize theo 10 bài test tiêu chuẩn (`P01` -> `P10`) quy định tại Mục 5.3 của Kế hoạch.
   * Viết báo cáo `google_sheets_edit_host_prototype.md` sau khi hoàn thành thử nghiệm.
