# Tài Liệu Cập Nhật Thay Đổi — LLTool IDE v1.0.6 (So với v1.0.5)

> **Ngày phát hành**: 21/10/2026  
> **Phiên bản trước**: `v1.0.5` (20/10/2026)  
> **Phiên bản hiện tại**: `v1.0.6`  

---

## 1. Tóm Tắt Tổng Quan Các Thay Đổi Chính

So với bản phát hành **v1.0.5**, phiên bản **v1.0.6** tập trung vào 4 trọng tâm lớn:

| STT | Trọng tâm | Chi tiết |
|---|---|---|
| **1** | **Database Users & Roles Explorer** | Quản lý người dùng và vai trò phân quyền trực quan cho cả **Microsoft SQL Server** (Database Users) và **PostgreSQL** (Cluster Roles). |
| **2** | **Permissions Viewer Tab** | Giao diện tra cứu phân quyền chuyên biệt với 4 tab con: *Overview*, *Role Membership*, *Database Permissions*, *Object Permissions*. |
| **3** | **Sao chép tên đối tượng nhanh (`Ctrl + C`)** | Cho phép focus vào bất kỳ đối tượng nào trên Object Explorer (Bảng, View, Stored Procedure, Function, Column, User,...) và nhấn `Ctrl + C` để copy tên tinh gọn trực tiếp vào Windows OS Clipboard. |
| **4** | **Nâng cấp Cú pháp, Table Designer & Data Editor** | Bổ sung module phát hiện thân thủ tục (`proc_body_detector`), cải tiến gợi ý chữ ký (`signature-help-resolver`), tối ưu hóa đổi tên bảng và dán hàng loạt trên Data Editor. |

---

## 2. Chi Tiết Các Tính Năng & Thay Đổi

### 2.1. Quản lý Người Dùng & Vai Trò (Database Users & Roles Explorer)

#### A. Kiến trúc & Vị trí hiển thị trên Cây Explorer:
- **Microsoft SQL Server (Database-level Principals):**
  - Node `Users` (`sqlserver_users_group`) được neo trực tiếp bên dưới từng Database (cùng cấp với Schemas).
  - Hiển thị danh sách người dùng với biểu tượng phân biệt: SQL User, Windows User/Group, User bị vô hiệu hóa (`is_disabled`).
- **PostgreSQL (Cluster-wide Roles):**
  - Node `Roles / Users` (`postgres_roles_group`) được neo ở cấp Root Connection (ngang hàng với danh sách Databases).
  - Phân biệt trực quan: Superuser (icon khiên vàng), Group Role/NoLogin (icon nhóm xanh lá), và Login Role (icon người dùng).

#### B. Trình xem phân quyền chuyên biệt (Permissions Viewer Tab):
- Đăng ký tab type `user-permissions` trong hệ thống tab chính của IDE, không xung đột với Monaco Editor.
- Thiết kế chuẩn CSS Variables của IDE, tuân thủ nguyên tắc zero inline style.
- Gồm 4 phân hệ thông tin:
  1. **Overview**: Tổng quan loại principal, trạng thái đăng nhập, default schema, các đặc quyền hệ thống (superuser, replication, bypass RLS).
  2. **Role Membership**: Bảng danh sách các vai trò mà tài khoản tham gia (hỗ trợ lọc tìm kiếm nhanh theo tên role).
  3. **Database Permissions**: Danh mục quyền cấp database (CONNECT, CREATE TABLE, ALTER,...).
  4. **Object Permissions**: Chi tiết quyền hạn trên từng Schema, Table, View, Procedure kèm bộ lọc đa chiều (lọc theo tên đối tượng hoặc loại quyền GRANT/DENY).
- Tích hợp 2 nút hành động `Script CREATE` và `Script DROP` trực tiếp trên Header của Viewer.

#### C. Bộ sinh Script an toàn (Safe DDL Generation):
- **CREATE Script**: Sinh mã DDL tạo User/Role, gán Role Memberships (`ALTER ROLE ... ADD MEMBER` / `GRANT ... TO ...`) và các quyền hạn đã cấp (`GRANT ...`).
- **DROP Script**: Sinh mã xóa User/Role, kèm comment cảnh báo an toàn và hướng dẫn chuyển giao quyền sở hữu (`REASSIGN OWNED BY` / `DROP OWNED BY` đối với PostgreSQL).
- **Nguyên tắc an toàn tuyệt đối**:
  - Script được mở trên tab Monaco Editor mới để người dùng chủ động review — **tuyệt đối không tự động thực thi ngầm**.
  - Không để lộ mật khẩu, hash mật khẩu trong metadata.
  - Chuẩn hóa quote identifier (`[user]` cho SQL Server và `"role"` cho PostgreSQL).

#### D. Tích hợp Context Menu & Thao tác nhanh:
- Chuột phải vào User / Role cung cấp các lệnh:
  - `New Query`: Mở tab soạn thảo truy vấn với context hiện tại.
  - `Script User/Role as` ➔ `CREATE To`, `DROP To`.
  - `View Permissions`: Mở tab Permissions Viewer.
  - `Copy Name`: Sao chép tên User / Role vào clipboard.
  - `Refresh`: Nạp lại dữ liệu node.
- **Double-click**: Nhấp đúp chuột vào bất kỳ User/Role nào trên cây để mở ngay tab Permissions Viewer.

---

### 2.2. Phím Tắt Sao Chép Tên Đối Tượng Nhanh (`Ctrl + C`)

- **Thao tác đơn giản**: Focus/click vào bất kỳ node đối tượng nào trên cây Object Explorer (Bảng, View, Stored Procedure, Function, Trigger, Sequence, Column, User, Role,...), ấn tổ hợp phím `Ctrl + C`.
- **Tự động làm sạch tên (Clean Name Extraction)**:
  - Thủ tục / Hàm: Tự động loại bỏ danh sách tham số (ví dụ: `sp_search_orders(p_id int, p_date date)` ➔ `sp_search_orders`).
  - Cột: Tự động lọc bỏ kiểu dữ liệu và nullability (ví dụ: `customer_name (varchar(100), not null)` ➔ `customer_name`).
- **Cơ chế lưu Clipboard Windows OS đa tầng (Zero-loss)**:
  - Đồng bộ qua DOM `document.execCommand('copy')`.
  - Đồng bộ qua Web `navigator.clipboard.writeText`.
  - Ghi trực tiếp vào Windows OS Clipboard thông qua Python Win32 `ctypes` API (`window.pywebview.api.set_clipboard_text`).
- **Phản hồi trực quan**:
  - Dòng node vừa sao chép sẽ phát sáng nhẹ (hiệu ứng flash animation `.tree-item-copied`).
  - Hiển thị Toast Alert góc trên bên phải: `Đã sao chép tên [bảng / stored procedure / function / ...]: <tên>`.
- **Bảo vệ ngữ cảnh**: Không can thiệp tổ hợp phím `Ctrl + C` khi người dùng đang soạn thảo mã trong Monaco Editor, nhập chữ trong ô tìm kiếm (`<input>`, `<textarea>`) hoặc đang chọn ô trong Result Grid.

---

### 2.3. Cải tiến Table Designer & Table Data Editor

- **Table Designer Service (`app/services/table_designer_service.py`, `static/js/table-designer.js`)**:
  - Tối ưu hóa tính năng đổi tên bảng (Rename Table) với sinh mã DDL tương thích từng DBMS (`sp_rename` trên MSSQL và `ALTER TABLE RENAME TO` trên PostgreSQL).
  - Cải tiến xử lý giá trị mặc định (Default Values), xử lý đổi kiểu dữ liệu cột và ràng buộc Nullable.
  - Bổ sung bộ test kiểm thử `tests/test_table_rename_and_default_improvements.py`.
- **Table Data Editor Service (`app/services/table_data_editor_service.py`, `static/js/table-data-editor.js`)**:
  - Cải tiến hỗ trợ dán dữ liệu nhiều ô/hàng (Batch Paste) từ Excel / Google Sheets.
  - Tối ưu hóa phân trang và hiệu năng cập nhật dữ liệu.
  - Bổ sung bộ test tự động `tests/test_table_data_editor.py`.

---

### 2.4. Nâng cấp Bộ Phân Tích Cú pháp & Gợi Ý Chữ Ký (Syntax & IntelliSense)

- **Module mới `app/database/syntax/proc_body_detector.py`**:
  - Nhận diện phạm vi thân của Stored Procedure và User-defined Function để kiểm tra cú pháp độc lập, không báo lỗi giả khi thủ tục chứa các lệnh DDL/DML phức tạp.
- **Cải tiến `validator_mssql.py` & `validator_pg.py`**:
  - Hỗ trợ tốt hơn cho các khối lệnh batch có chứa từ khóa `GO`.
  - Hỗ trợ cú pháp khối mã lệnh ẩn danh PostgreSQL (`DO $$ ... $$`).
- **Gợi ý Chữ ký Tham số (`static/js/signature-help-resolver.js`)**:
  - Phân tích vị trí con trỏ và danh sách tham số của hàm/thủ tục chính xác hơn, hiển thị tooltip hướng dẫn tham số ngay khi gõ dấu `(` hoặc dấu phẩy `,`.

---

### 2.5. Cải tiến Auto-updater & Tối ưu Giao diện

- **Auto-updater (`app/services/update_checker.py`)**:
  - Bổ sung cơ chế tự động giải nén gói ZIP cập nhật trực tiếp vào thư mục ứng dụng sau khi tải xong.
- **Sửa lỗi bản build đóng gói PyInstaller**:
  - Khắc phục sự cố trigger menu Google Sheets.
  - Đảm bảo đường viền màu accent của tab kết quả (Result/Messages/Plan) hiển thị chuẩn xác và liền mạch trên bản phân phối.

---

## 3. Danh Sách File Tạo Mới & Chỉnh Sửa

### File tạo mới:
1. `app/services/database_users/__init__.py`: Package khởi tạo module database users.
2. `app/services/database_users/models.py`: DTOs `PrincipalSummary`, `PermissionEntry`.
3. `app/services/database_users/sqlserver_provider.py`: Trích xuất metadata User/Role/Permission SQL Server.
4. `app/services/database_users/postgres_provider.py`: Trích xuất metadata Role/Permission PostgreSQL.
5. `app/services/database_users/sqlserver_scripts.py`: Sinh mã DDL CREATE/DROP cho SQL Server.
6. `app/services/database_users/postgres_scripts.py`: Sinh mã DDL CREATE/DROP cho PostgreSQL.
7. `app/services/database_users/service.py`: Điều phối nghiệp vụ database users.
8. `app/api/database_users_api.py`: `DatabaseUsersApiMixin` chứa 5 API endpoints IPC.
9. `static/css/user-permissions.css`: Stylesheet cho tab Permissions Viewer.
10. `static/js/user-permissions.js`: Component giao diện Permissions Viewer.
11. `app/database/syntax/proc_body_detector.py`: Bộ nhận diện thân thủ tục/hàm.
12. `tests/test_database_users.py`: 13 bài test tự động cho module database users.
13. `tests/test_explorer_copy_object_name.py`: 5 bài test tự động cho tính năng copy tên object.
14. `tests/test_table_rename_and_default_improvements.py`: Test cho Table Designer cải tiến.
15. `tests/test_table_data_editor.py`: Test cho Table Data Editor cải tiến.
16. `docs/update_v1.0.6.md`: Tài liệu này.

### File chỉnh sửa chính:
1. `main.py`: Kế thừa `_DatabaseUsersApiMixin` vào `MainApi`.
2. `static/js/api.js`: Đăng ký dispatch routes `/api/database-users/*`.
3. `static/js/explorer.js`: Thêm node Users (MSSQL), Roles (PG), lazy loading, tabIndex focus, và handler `Ctrl + C`.
4. `static/js/context-menu.js`: Thêm menu actions cho Users & Roles, cải tiến `copy-name`.
5. `static/js/tabs.js`: Đăng ký tab `user-permissions`, điều phối ẩn/hiện container.
6. `static/js/clipboard-bridge.js`: Tích hợp fallback lấy tên Object Explorer khi sao chép.
7. `static/css/explorer.css`: Thêm outline `:focus` và animation `.tree-item-copied`.
8. `templates/index.html`: Khai báo layout container và include script/css của Permissions Viewer.
9. `version.json`: Cập nhật metadata phiên bản `1.0.6`.
10. `tests/snapshots/api_surface.txt`: Cập nhật lưới an toàn API snapshot.

---

## 4. Kết Quả Kiểm Thử (Verification & Testing)

| Test Suite | Số lượng test | Kết quả | Ghi chú |
|---|---|---|---|
| `tests/test_database_users.py` | 13 | **13/13 PASSED** | Kiểm thử Models, Providers, Scripts, API |
| `tests/test_explorer_copy_object_name.py` | 5 | **5/5 PASSED** | Kiểm thử phím tắt Ctrl+C, CSS, Name Extractor |
| `tests/test_clipboard_and_grid_copy.py` | 11 | **11/11 PASSED** | Kiểm thử Clipboard Bridge & Native Win32 |
| `tests/test_api_surface_snapshot.py` | 1 | **1/1 PASSED** | Kiểm thử hợp đồng toàn bộ Public API Surface |

---

## 5. Kết Luận & Hướng Dẫn Nâng Cấp

Phiên bản **v1.0.6** nâng cao đáng kể trải nghiệm quản trị cơ sở dữ liệu trên LLTool IDE: người dùng có thể dễ dàng quản lý phân quyền người dùng của cả SQL Server và PostgreSQL, tra cứu quyền hạn đa tầng và sao chép nhanh tên đối tượng chỉ với một phím tắt `Ctrl + C`.
