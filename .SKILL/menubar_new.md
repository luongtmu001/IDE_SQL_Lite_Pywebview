# Skill Rule: pywebview Custom Titlebar & Menubar Implementation

## 1. Overview & Goal

Kích hoạt quy tắc này khi cần tạo hoặc tái cấu trúc ứng dụng `pywebview` để sử dụng **Custom Titlebar/Menubar (HTML/CSS/JS)** thay thế cho khung viền và menu mặc định của hệ điều hành. Mục tiêu là đạt được giao diện phẳng, hiện đại tương tự phong cách VS Code và kiểm soát hoàn toàn giao diện qua web frontend.

---

## 2. Core Architecture Requirements

### 2.1. Backend (Python)

1. **Window Configuration**:
   - Cửa sổ bắt buộc cấu hình tham số `frameless=True` trong lệnh `webview.create_window()`.
   - Giữ tham chiếu đối tượng `window` để truyền vào hoặc cập nhật cho lớp API.
2. **API Class (`WindowAPI`)**:
   - Khởi tạo class chuyên biệt xử lý tương tác giữa UI và OS.
   - Bắt buộc cài đặt các phương thức điều khiển cửa sổ:
     - `minimize()`: Gọi `self._window.minimize()`
     - `toggle_maximize()`: Kiểm tra trạng thái hoặc gọi `self._window.toggle_fullscreen()` (hoặc logic resize tương đương)
     - `close()`: Gọi `self._window.destroy()`
   - Phương thức điều phối menu:
     - `handle_menu_action(menu_id: str, item_id: str, *args)`: Tiếp nhận event từ JavaScript và ánh xạ tới logic nghiệp vụ tương ứng.

### 2.2. Frontend (HTML/CSS/JS)

1. **Titlebar & Drag Area**:
   - Sử dụng một container trên cùng cố định (`position: fixed` hoặc `display: flex` ở đầu `body`).
   - Gán class `pywebview-drag-region` để hỗ trợ kéo/di chuyển cửa sổ.
2. **Event Isolation (Tránh xung đột Drag)**:
   - Các phần tử tương tác (Menu item, Dropdown, Nút Minimize/Maximize/Close) **không được phép** bị chặn bởi thao tác drag.
   - Thêm style `-webkit-app-region: no-drag;` hoặc cấu trúc layout để các button/menu không nằm dưới lớp phủ drag.
3. **Dropdown Behavior**:
   - Tự động đóng dropdown đang mở khi click ra ngoài vùng menu (`click outside listener`).
   - Đảm bảo `z-index` của menu dropdown đủ lớn để không bị che bởi nội dung web bên dưới.
4. **JS API Bridge**:
   - Sử dụng `window.pywebview.api.<method>()` trong các handler. Luôn lắng nghe sự kiện `pywebviewready` trước khi gọi các hàm khởi tạo nếu cần.

---

## 3. Strict Constraints & Conventions

- **DO NOT** sử dụng `webview.menu` gốc nếu yêu cầu giao diện đồng bộ màu sắc và icon kiểu web.
- **DO NOT** quên triển khai 3 nút điều khiển cửa sổ (Minimize, Maximize, Close) khi dùng `frameless=True`. Nếu thiếu, người dùng sẽ không thể thao tác cửa sổ bình thường.
- **DO NOT** viết cứng logic nghiệp vụ nặng trong class `WindowAPI`; hãy ủy quyền (dispatch) sang các controller hoặc service tương ứng.
- **ALWAYS** kiểm tra đối tượng `window` tồn tại trước khi gọi `.minimize()`, `.destroy()`.
