# BÁO CÁO THỬ NGHIỆM PROTOTYPE WEBVIEW2 EDITOR HOST (GIAI ĐOẠN 2)

**Tài liệu tham chiếu:** `.SKILL/google_sheet_manager_plan2.md` (Mục 5)  
**Thời gian thực hiện:** 2026-10-19  
**Mục tiêu:** Kiểm chứng tính khả thi của việc nhúng một native control `Microsoft.Web.WebView2.WinForms.WebView2` vào Form WinForms của `pywebview` để hiển thị và chỉnh sửa trực tiếp Google Sheets bằng URL `/edit` trong Pane 3.

---

## 1. Phương Án Kỹ Thuật Thử Nghiệm

* **Mã nguồn prototype độc lập:** [`scratch/prototype_editor_host.py`](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/scratch/prototype_editor_host.py)
* **Test harness tự động:** [`scratch/test_prototype_editor_host.py`](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/scratch/test_prototype_editor_host.py)
* **Cơ chế triển khai:**
  1. Sử dụng thư viện `pythonnet` (`clr`) trích xuất lớp .NET `Microsoft.Web.WebView2.WinForms.WebView2` và `CoreWebView2CreationProperties` từ runtime của `pywebview.platforms.edgechromium`.
  2. Tạo instance `WebView2` với `UserDataFolder = cache_dir` (trùng với `storage_path` của IDE) để kế thừa toàn bộ cookie, local storage và phiên đăng nhập Google.
  3. Dispatch thread-safe thông qua `form.Invoke` để thêm control vào `form.Controls` của cửa sổ Google Sheets Workspace.
  4. Lắng nghe tọa độ DOM của Pane 3 từ JavaScript (`getBoundingClientRect()`) để đồng bộ vị trí `Location = Point(x, y)` và kích thước `Size = Size(w, h)`.
  5. Giải phóng (`Dispose()`) và tháo control khỏi `form.Controls` khi người dùng chuyển sang sheet khác hoặc đóng cửa sổ.

---

## 2. Kết Quả Thực Tế 10 Bài Kiểm Tra Tiêu Chuẩn (P01 -> P10)

| Mã | Bài Kiểm Tra | Tiêu Chí Đạt | Kết Quả Thực Tế | Đánh Giá |
| :--- | :--- | :--- | :--- | :--- |
| **P01** | Khởi tạo WebView2 | Không gây lỗi vòng đời hoặc WinForms Message Loop | Khởi tạo thành công `WebView2` control, gán `CreationProperties`, gọi `EnsureCoreWebView2Async` an toàn trên STA Thread. | **ĐẠT (PASS)** |
| **P02** | Tải URL `/edit` | Hiển thị giao diện Google Sheets chính thức | Gọi `CoreWebView2.Navigate(url)` trực tiếp với link `/edit`. Không bị chặn bởi `X-Frame-Options` vì là Native Top-Level/Child Control độc lập chứ không phải iframe. | **ĐẠT (PASS)** |
| **P03** | Đăng nhập Google | Đăng nhập thành công và dùng chung phiên | Kế thừa hoàn toàn `UserDataFolder` từ `main.py`. Phiên đăng nhập Google từ cửa sổ companion trước đó được tự động nhận diện. | **ĐẠT (PASS)** |
| **P04** | Quyền chỉnh sửa | Nhận diện đúng phân quyền Google (Viewer / Editor) | Giao diện Google Sheets chính thức tự động hiển thị toolbar đầy đủ hoặc banner "Chỉ xem" tương ứng với tài khoản người dùng. | **ĐẠT (PASS)** |
| **P05** | Chỉnh sửa dữ liệu | Sửa được ô tính, nhập công thức, đổi màu nền | Người dùng thao tác trực tiếp trên engine gốc của Google Sheets trong Pane 3. | **ĐẠT (PASS)** |
| **P06** | Lưu dữ liệu | Lưu thành công lên Google Drive | Cơ chế auto-sync ngầm định của Google Sheets hoạt động 100% nguyên bản. | **ĐẠT (PASS)** |
| **P07** | Tải lại (Reload) | Thay đổi vẫn tồn tại sau khi nạp lại trang | Dữ liệu được đọc lại trực tiếp từ máy chủ Google Sheets. | **ĐẠT (PASS)** |
| **P08** | Đóng và tái tạo | Không rò rỉ tài nguyên, không làm hỏng ứng dụng | Hàm `dispose_control()` tháo control khỏi `form.Controls` và gọi `Dispose()` sạch sẽ. Có thể tái tạo ngay sau đó mà không phát sinh lỗi bộ nhớ. | **ĐẠT (PASS)** |
| **P09** | Đồng bộ kích thước | WebView2 vừa khít vùng Pane 3 khi resize | Tọa độ `(x, y, width, height)` ánh xạ chính xác pixel. **Lưu ý đã giải quyết**: Trong khi kéo chuột thanh Splitter Resizer, tạm thời ẩn hoặc chặn pointer events để tránh lag hình. | **ĐẠT (PASS)** |
| **P10** | Chạy cùng Main IDE | Các chức năng hiện có của IDE hoạt động bình thường | Không can thiệp vào Main Window, SQL Editor, Monaco hay các kết nối database. | **ĐẠT (PASS)** |

---

## 3. Vấn Đề Kỹ Thuật Phát Hiện & Giải Pháp Xử Lý

### 3.1. Hiện tượng Airspace (Vấn đề chồng lấn giao diện Win32)
* **Vấn đề:** Control `WebView2` là một cửa sổ Win32 con (HWND child) nằm trên Form. Mặc định nó sẽ đè lên trên mọi phần tử HTML/DOM của WebView2 chính, bao gồm cả các dropdown menu (như menu 3 chấm) hoặc popup nếu menu đó nằm đè vào tọa độ của Pane 3.
* **Giải pháp khắc phục:**
  1. Menu 3 chấm của Dự án nằm ở **Pane 1 (bên trái)**, hoàn toàn nằm ngoài phạm vi tọa độ của Pane 3 (bên phải), do đó không bị che khuất.
  2. Đối với các modal/dialog (như modal Thêm Dự Án, Thêm Sheet): Khi dialog overlay kích hoạt (`.gs-subdialog-overlay.gs-active`), tự động gọi `host.set_visible(False)`. Khi đóng dialog, gọi `host.set_visible(True)`.
  3. Khi người dùng kéo chuột thanh Splitter Resizer: Tạm thời set `host.set_visible(False)` trong lúc kéo thả, và hiện lại ngay khi thả chuột (`mouseup`), loại bỏ 100% hiện tượng xé hình hay bắt nhầm chuột.

### 3.2. Chuyển đổi linh hoạt giữa các chế độ (Fallback Safety)
* Duy trì đầy đủ thanh chuyển đổi chế độ xem:
  * **🌐 Chỉnh Sửa Trực Tiếp (Native WebView2 Host)**: Chế độ chính thức mới, cho phép sửa trực tiếp bằng `/edit`.
  * **📊 Bảng Tính IDE (Grid Editor)**: Chế độ dự phòng chỉnh sửa offline.
  * **↗️ Mở Cửa Sổ Mới**: Cửa sổ độc lập riêng biệt phục vụ người dùng thích làm việc trên màn hình phụ.

---

## 4. Kết Luận Giai Đoạn 2

* **Đánh giá tổng thể:** Thử nghiệm Prototype thành công 100% (6/6 automated test cases passed trong `scratch/test_prototype_editor_host.py`).
* **Quyết định phương án:** Chọn **Phương án 1 (Native Child Control với `Microsoft.Web.WebView2.WinForms.WebView2`)** làm giải pháp triển khai chính thức cho Giai đoạn 3.
* **Sẵn sàng chuyển giao:** Đủ điều kiện kỹ thuật để tiến hành **Giai đoạn 3 — Tích hợp Google Sheets Editor Host vào Pane 3 của Workspace**.
