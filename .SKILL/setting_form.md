# HƯỚNG DẪN PHÁT TRIỂN TÍNH NĂNG CÀI ĐẶT (SETTINGS)

Tài liệu này đặc tả yêu cầu và các bước triển khai tính năng bảng Cài đặt (Settings) cho ứng dụng.

---

## 1. Yêu cầu tổng quan

- **Vị trí kích hoạt:** Nút bấm Settings được đặt trên thanh taskbar (header) trên cùng của ứng dụng, ngay sau biểu tượng (icon) chuyển đổi chế độ Sáng / Tối (Light / Dark mode).
- **Giao diện mẫu:** Thiết kế và bố cục tuân theo layout tham khảo tại thư mục `_concept_/settings_template`.
- **Hệ thống màu sắc (Theme):** Đồng bộ hoàn toàn theo theme hiện tại của ứng dụng (hỗ trợ cả Light Mode và Dark Mode thông qua biến CSS / Design Tokens).
- **Nguồn dữ liệu:** Cấu trúc và nội dung cấu hình được nạp động từ file `settings.js`.
- **Cơ chế áp dụng:** Mọi thay đổi về thiết lập phải có hiệu lực ngay lập tức trong ứng dụng (hot-apply) mà không yêu cầu khởi động lại hay reload app.
- **Bỏ qua self test**: Tôi sẽ tự test tính năng

---

## 2. Đặc tả giao diện & Vị trí

### 2.1. Nút Settings trên Taskbar

- Đặt cạnh và nằm phía sau nút chuyển đổi Dark/Light mode.
- Sử dụng icon hình bánh răng (gear / settings icon) đồng bộ phong cách thiết kế của hệ thống icon hiện hành.
- Có tooltip hiển thị khi hover (ví dụ: "Cài đặt" hoặc "Settings").
- Khi click: Mở bảng/modal Cài đặt.

### 2.2. Bố cục cửa sổ Cài đặt

Cửa sổ Cài đặt chia làm 2 khu vực chính dựa theo template `_concept_/settings_template`:

- **Cột bên trái (Slide Panel / Navigation Menu):** Danh sách các menu chức năng tương ứng với các node cấp cao nhất (root nodes) từ `settings.js`.
- **Cột bên phải (Detail Content Area):** Hiển thị chi tiết danh sách các tùy chọn cấu hình tương ứng với mục menu đang được chọn ở cột trái.
- **Thanh tiêu đề / Đóng:** Có nút đóng ($\times$) hoặc click ra ngoài vùng modal (backdrop) để thoát.

---

## 3. Quy tắc đọc và hiển thị dữ liệu từ `settings.js`

File `settings.js` đóng vai trò là schema định nghĩa cấu hình:

1. **Menu cấp 1 (Cột trái):**
   - Đọc các node gốc của đối tượng cấu hình trong `settings.js`.
   - Mỗi node tương ứng với một mục điều hướng (ví dụ: *Cài đặt chung*, *Giao diện*, *Phím tắt*, *Nâng cao*,...).
   - Hiển thị tiêu đề mục và icon tương ứng (nếu có khai báo).
   - Tự động kích hoạt (active) mục đầu tiên khi vừa mở bảng cài đặt.

2. **Chi tiết cấu hình (Cột phải):**
   - Khi người dùng bấm vào một menu bên trái, cột bên phải sẽ chuyển đổi nội dung để hiển thị các thiết lập con của node đó.
   - Hỗ trợ các kiểu điều khiển dữ liệu cơ bản được khai báo trong schema, bao gồm:
     - Dạng công tắc bật/tắt (Toggle / Switch).
     - Dạng danh sách chọn (Dropdown / Select).
     - Dạng thanh kéo giá trị (Range Slider / Number input).
     - Dạng trường nhập chữ (Text input / Key binding).

---

## 4. Cơ chế phản hồi và áp dụng (Hot-Apply)

- **Không cần reload:** Khi người dùng thay đổi giá trị của bất kỳ trường thiết lập nào (sự kiện `change` / `input`), ứng dụng phải:
  1. Ghi nhận và lưu trữ giá trị mới (vào bộ nhớ tạm và `localStorage` hoặc cơ sở dữ liệu cấu hình cục bộ).
  2. Kích hoạt hàm xử lý tương ứng (`onChange` callback / Event listener) để áp dụng thay đổi vào runtime của ứng dụng ngay lập tức.
- **Khôi phục trạng thái:** Khi ứng dụng khởi động lại ở các phiên tiếp theo, tự động nạp các giá trị đã lưu và áp dụng sẵn vào hệ thống.

## 5. Cấu trúc các mục cài đặt có thể theo nhóm cây (tree) nếu có

## 6. Tiêu chí nghiệm thu (Acceptance Criteria)

- [ ] Nút Cài đặt xuất hiện đúng vị trí sau icon sáng/tối trên taskbar.
- [ ] Giao diện khớp với mẫu `_concept_/settings_template` và tự đổi màu theo theme sáng/tối của app.
- [ ] Cột trái hiển thị đầy đủ danh mục từ các node đầu tiên trong `settings.js`.
- [ ] Bấm chuyển tab ở cột trái hiển thị đúng các trường cấu hình ở cột phải.
- [ ] Thay đổi giá trị bất kỳ được áp dụng ngay lập tức trên app mà không cần mở lại hoặc tải lại trang.
