# INSTRUCTION FOR AGENT: AUTOMATED FRAMELESS WINDOW & NAVBAR CONTROLLER

## Mục tiêu

Tự động cấu hình ứng dụng `pywebview` thành cửa sổ không viền (`frameless`), nhận diện các thẻ HTML đóng vai trò thanh điều hướng/tiêu đề (navbar/titlebar) và gắn các sự kiện điều khiển cửa sổ như Windows gốc.

---

## 1. Cấu hình phía Python (`pywebview.create_window`)

Khi khởi tạo `webview.create_window`, bắt buộc phải thiết lập các thuộc tính sau:

- `frameless=True`: Bỏ thanh viền và taskbar/titlebar mặc định của hệ điều hành.
- `easy_drag=False`: Ngăn chặn việc người dùng click vào bất cứ đâu trên giao diện cũng bị kéo cửa sổ.
- `resizable=True`: Cho phép người dùng resize cửa sổ ở 4 cạnh và 4 góc.
- `js_api=WindowAPI()`: Expose class chứa tối thiểu 3 phương thức:
  - `minimize()`: Gọi `self.window.minimize()`
  - `toggle_maximize()`: Quản lý cờ boolean `is_maximized`, gọi `self.window.maximize()` hoặc `self.window.restore()`
  - `close()`: Gọi `self.window.destroy()`

---

## 2. Quét DOM và Nhận diện Navbar (Frontend)

Agent phải quét toàn bộ file HTML/CSS/JS của ứng dụng để tìm phần tử ứng viên làm thanh điều hướng:

1. **Tiêu chí Selector**: Tìm phần tử khớp với biểu thức:
   - `[id*="navbar" i], [class*="navbar" i]`
   - `[id*="titlebar" i], [class*="titlebar" i]`
   - Thẻ `<header>` nằm ở vị trí trên cùng của `<body>`
2. **Quy tắc CSS cần tiêm vào Navbar**:
   - Thêm class hoặc thuộc tính CSS: `-webkit-app-region: drag;` (hoặc class `pywebview-drag-region`).
   - Thêm style: `user-select: none;` để tránh bị bôi đen text khi kéo cửa sổ.
3. **Quy tắc cho các phần tử con bên trong Navbar (Nút bấm, Menu, Input)**:
   - Tất cả các thẻ `<button>`, `<input>`, `<a>`, `.menu-item` nằm bên trong navbar phải được thêm thuộc tính: `-webkit-app-region: no-drag;` hoặc class `.no-drag`. Nếu thiếu, các phần tử này sẽ không thể click được vì bị hệ thống hiểu lầm là sự kiện kéo cửa sổ.

---

## 3. Tiêm Cụm Nút Điều Khiển (Window Controls)

Nếu trong navbar chưa có cụm nút điều khiển cửa sổ, Agent tự động thêm vào góc phải ngoài cùng:

```html
<div class="window-controls no-drag">
  <button id="win-btn-minimize" aria-label="Minimize">&#9472;</button>
  <button id="win-btn-maximize" aria-label="Maximize">&#9634;</button>
  <button id="win-btn-close" aria-label="Close">&#10005;</button>
</div>

Hãy viết thêm mã JS và CSS tạo viền resize 8 hướng cho cửa sổ frameless trong pywebview."
