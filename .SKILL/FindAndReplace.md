# Yêu cầu tính năng Find & Replace

## Mô tả chung
Thêm tính năng Tìm kiếm và Thay thế (Find & Replace) vào khu vực Editor, với trải nghiệm người dùng tương tự như SQL Server Management Studio (SSMS).

## Các tính năng chính
1. **Phím tắt**: Người dùng có thể nhấn `Ctrl + F` khi đang ở trong Editor để hiển thị popup Tìm kiếm.
2. **Giao diện Popup (SSMS-like)**:
   - Ô nhập văn bản cần tìm kiếm (Find).
   - Ô nhập văn bản để thay thế (Replace) mặc định bị ẩn.
   - Nút mũi tên mở rộng (Down arrow) để hiển thị/ẩn ô nhập giá trị thay thế.
   - Khi nhấn mũi tên xuống, giao diện sẽ mở rộng thêm ô Replace.
3. **Phạm vi tìm kiếm (Scope)**:
   - Có một thẻ Select/Dropdown để người dùng chọn phạm vi tìm kiếm.
   - Các tuỳ chọn: 
     - **Current Document** (Tìm theo file hiện thời).
     - **All Documents** (Tất cả các file đang mở / trong không gian làm việc).

## Giao diện dự kiến
- Một hộp thoại nhỏ (overlay) xuất hiện ở góc trên bên phải của Editor (hoặc vị trí phù hợp, không che khuất quá nhiều code).
- Gọn gàng, tích hợp chặt chẽ với CSS theme hiện tại (Light/Dark mode).
