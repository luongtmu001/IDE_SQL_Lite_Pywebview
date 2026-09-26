---
name: migrate-flask-to-pywebview-zero-network
description: Hướng dẫn Agent tự động chuyển đổi dự án Flask sang Desktop Native pywebview chạy chế độ Zero-Network (không port, không HTTP server), tách tầng lưu trữ (connections.json, settings.json, localStorage session) và quản lý Multi-Window cho Form BRAVO.
---

# SKILL: Chuyển đổi Flask sang Desktop Native pywebview (Zero-Network)

Tài liệu này là đặc tả kỹ thuật (Skill Specification) dành riêng cho AI Agent (Cursor, Cline, Roo Code, Copilot Workspace...) đọc và tự động thực thi việc tái cấu trúc dự án.

---

## 1. Nguyên tắc & Ràng buộc bắt buộc (Non-Negotiable Rules)

1. **Kiến trúc Zero-Network (Tuyệt đối không dùng Web Server):**
   - Loại bỏ hoàn toàn `Flask`, `Werkzeug`, `app.run()`, `requests` nội bộ.
   - Không mở bất kỳ cổng mạng TCP/socket nào (không dùng cổng `5000`, `28055`, không dùng `http://127.0.0.1` hay `localhost`).
   - Cửa sổ ứng dụng phải nạp giao diện trực tiếp từ đường dẫn file HTML cục bộ trên đĩa cứng (`file://` hoặc `Path.resolve()`).

2. **Native IPC Bridge (`js_api`):**
   - Thay thế toàn bộ endpoint `@app.route` bằng các phương thức (methods) bên trong các class API Python.
   - Thay thế toàn bộ lời gọi `fetch('/api/...')`, `axios` hay AJAX ở frontend thành `await window.pywebview.api.<method_name>()`.

3. **Phân tầng dữ liệu độc lập (Storage Decoupling):**
   - `data/connections.json`: Nơi duy nhất lưu trữ cấu hình database, connection string, credentials.
   - `data/settings.json`: Nơi duy nhất lưu trữ cấu hình IDE lâu dài (theme, fontSize, tabSize, autoSave).
   - `localStorage`: **Nghiêm cấm lưu connection string hay theme**. Chỉ được dùng để lưu trạng thái phiên làm việc (Active Tab, vị trí thanh cuộn, trạng thái đóng/mở sidebar, bản nháp code chưa lưu).

4. **Multi-Window cho Form BRAVO:**
   - Không mở tab trình duyệt bằng `target="_blank"` hay `window.open()`.
   - Mở cửa sổ Desktop thứ hai độc lập thông qua lệnh `webview.create_window()` từ Python API, nạp file `bravo_form.html` cục bộ và gắn kèm `BravoApi` riêng.

5. **Bảo toàn 100% logic nghiệp vụ:**
   - Giữ nguyên các thuật toán xử lý SQL, logic parser, hàm đọc/ghi tệp nghiệp vụ. Chỉ thay đổi cơ chế truyền nhận dữ liệu giữa UI và Python.

---

## 2. Cấu trúc thư mục mục tiêu (Target Directory Structure)

Agent phải cấu trúc lại dự án theo đúng sơ đồ sau:

```text
├── data/
│   ├── .webview_cache/      # Cache tự sinh của WebView2 (đưa vào .gitignore)
│   ├── connections.json     # Danh sách cấu hình kết nối DB
│   └── settings.json        # Cấu hình IDE (theme, font, editor)
├── templates/
│   ├── index.html           # Giao diện cửa sổ IDE chính
│   └── bravo_form.html      # Giao diện cửa sổ phụ Form BRAVO
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── storage.js       # Module gọi Python đọc/ghi settings & connections
│       ├── session.js       # Module quản lý localStorage (chỉ lưu session)
│       └── app.js           # Logic giao diện & tích hợp Monaco Editor
└── main.py                  # Điểm vào chính: chứa MainApi, BravoApi và pywebview runner
