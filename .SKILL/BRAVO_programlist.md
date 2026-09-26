
## Name

Danh sách chương trình

## Tables

| Danh sách chương trình (70%) | Editor   (30%)     |
|--------      |-----------------------------------|
| run | Stt|Tên chương trình | Tên chương trình |    |
|    				|  |     | Đường dẫn   |    |
|    				|  |     | Username    |    |
|  |  |    					 | Password   |    |
|  |  |     				 | Nút lưu Sửa Thêm bản sao Xóa

- Left Slide bar
  - Danh sách các kết nối sẽ hiển thị ở bên trái giao diện
  - user có thể click double và dòng hoặc ấn nút run (theo từng dòng). Khi ấn backend sẽ đọc
 đường dẫn và truyền tham số -u: useranem và -p:password theo kết nối đã lưu để mở chương trình
  - user có thể di chuyển các kết nối để sẵp xếp lại thông tin
  - Tên chương trình thêm nut filter để người  udngf có thể lọc thông tin
  - Chức năng sort theo stt hoặc tên
  - Khi focus 1 kết nối thì hiển thị thông tin sang Editor (right slide bar)
- Rigth slide bar.
  - Đường dẫn: chọn ô này ở lên màn hình chọn file mặc định của OS. Chỉ chọn file dạng program (Ví dụ: exe)
  - username
  - pass: Nhập pass/Cho ẩn hiện
  - Lưu. THêm 1 bản ghi và hiển thị ở Left slide bar.
  - Sửa: Khi focus 1 chương trình có sẵn. Sửa thông tin chương trình hiện thời khi user focus ở Left Slidebar (hiển thị popup xác nhận sửa)
  - Thêm bản sao mới :Copy lại thông tin 1 chương trình
  - Thông tin sẽ lưu vào file programlist.json. mật khẩu sẽ được mã hóa khi lưu

***Thêm vào chức năng BRAVO tool và trước chức năng "Soạn thảo layout"***
***Không dùng css inline, css nội tuyến trong file html***
***Phải dùng boostrap vào đồng bộ với theme của ide***
