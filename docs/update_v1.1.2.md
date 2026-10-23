# Tài Liệu Cập Nhật Thay Đổi — LLTool IDE v1.1.2 (So với v1.1.1)

> **Ngày phát hành**: 23/10/2026  
> **Phiên bản trước**: `v1.1.1` (22/10/2026)  
> **Phiên bản hiện tại**: `v1.1.2` (Cross-Database Syntax Catalog & IntelliSense Context Optimization)

---

## 1. Tóm Tắt Tổng Quan Các Thay Đổi Chính

Phiên bản **v1.1.2** mang tới hai bước đột phá lớn: **Tra cứu & So sánh Cú pháp Đa Cơ sở Dữ liệu** (Cross-Database Syntax Reference & Catalog) với chế độ xem riêng rẽ từng CSDL hoặc so sánh song song, cùng với việc **Tối ưu hóa toàn diện Ngữ cảnh và Thứ tự Ưu tiên của IntelliSense SQL**:

| STT | Trọng tâm | Mã Nâng Cấp | Chi tiết |
|---|---|---|---|
| **1** | **Tra Cứu Cú Pháp Đa CSDL** | `FEAT-Syntax-Catalog` | Bộ tra cứu cú pháp 5 hệ quản trị: SQL Server (T-SQL), PostgreSQL, SQLite, MySQL, Oracle. Hỗ trợ hiển thị riêng rẽ từng CSDL hoặc so sánh đối chiếu tương đương. |
| **2** | **Tài Liệu Cú Pháp Mở Rộng** | `FEAT-Docs-Links` | Mở rộng liên kết tài liệu tham khảo chính thống và W3Schools, Microsoft Learn, PostgreSQL Docs cho từng mục cú pháp kèm code ví dụ thực tế. |
| **3** | **Cửa Sổ Tra Cứu Chuyên Dụng** | `UI-Syntax-Window` | Giao diện cửa sổ độc lập mở nhanh qua nút Helper trên toolbar hoặc phím tắt F1, lọc danh mục tức thì, tìm kiếm nhanh và nút sao chép mẫu code 1-click. |
| **4** | **Tối Ưu Ngữ Cảnh IntelliSense** | `INTELLISENSE-Context` | Phân tích chính xác ngữ cảnh clause (SELECT, FROM, JOIN, WHERE, GROUP BY, ORDER BY, SET); ưu tiên cột/hàm trong SELECT, schema/bảng trong FROM/JOIN. |
| **5** | **Xếp Hạng & Khớp Ứng Viên** | `INTELLISENSE-Ranking` | Tối ưu hóa trọng số điểm `_finalScore`, tinh chỉnh ngưỡng khớp alias từ khóa, ngăn ngừa mở rộng dấu sao (`* -> col1, col2, ...`) lấn át các từ khóa và cột thật khi gõ ký tự ngắn. |
| **6** | **Quản Trị Người Dùng & Phân Quyền** | `FEAT-Db-Users` | Module quản lý User, Login, Server Roles và Database Permissions trên SQL Server và PostgreSQL với giao diện trực quan và phân quyền chi tiết. |
| **7** | **Đồng Bộ Bản Đóng Gói & Patch** | `REL-Packaging` | Tự động đồng bộ toàn bộ tài nguyên sang `dist/LLTool` và `_internal/`, tạo gói cập nhật vá lỗi tại chỗ `dist/LLTool_v1.1.2_patch.zip` siêu nhẹ. |

---

## 2. Chi Tiết Các Tính Năng Mới & Nâng Cấp

### 2.1. Tra Cứu & So Sánh Cú Pháp Đa CSDL (Cross-Database Syntax Catalog)

- **Hỗ trợ 5 Hệ Quản Trị CSDL Phổ Biến**:
  - `SQL Server (T-SQL)`
  - `PostgreSQL (PL/pgSQL)`
  - `SQLite`
  - `MySQL`
  - `Oracle (PL/SQL)`

- **2 Chế Độ Xem Linh Hoạt**:
  1. **Chế độ Riêng Rẽ Từng CSDL (Database-Specific Mode)**:
     - Cho phép người dùng chọn một hệ CSDL cụ thể (ví dụ chỉ xem PostgreSQL hoặc chỉ xem SQL Server).
     - Hiển thị danh sách đầy đủ tất cả các lệnh, kiểu dữ liệu, mệnh đề đặc thù của riêng hệ quản trị đó.
     - Mỗi mục hiển thị rõ ràng: Tên lệnh, mô tả, cấu trúc cú pháp chuẩn (Syntax), ví dụ minh họa (Example), lưu ý đặc biệt (Notes), và liên kết tài liệu ngoài.
  2. **Chế độ So Sánh Tương Đương (Cross-Database Comparison Mode)**:
     - So sánh cú pháp tương đương giữa các hệ CSDL song song trên cùng một màn hình.
     - Giúp lập trình viên dễ dàng chuyển đổi mã SQL (SQL Migration) hoặc đối chiếu các hàm xử lý chuỗi, ngày tháng, phân trang, kiểu dữ liệu giữa SQL Server, Postgres, SQLite, MySQL và Oracle.

- **Mở Rộng Nguồn Tài Liệu Tham Khảo (External Documentation Links)**:
  - Tích hợp trực tiếp các liên kết tài liệu từ W3Schools SQL Tutorial, Microsoft Learn (T-SQL Reference), PostgreSQL Official Docs, MySQL Reference Manual.
  - Người dùng có thể nhấn liên kết để mở trực tiếp tài liệu chi tiết trên trình duyệt.

- **Cửa Sổ Tra Cứu Chuyên Dụng (Dedicated Syntax Reference Window)**:
  - Cửa sổ pywebview độc lập với thiết kế Modern Dark Glassmorphism đồng bộ theme IDE.
  - Bộ lọc theo danh mục: `DDL (Data Definition)`, `DML (Data Manipulation)`, `Querying`, `Functions (String/Date/Math)`, `Constraints & Indexes`, `Transactions & Locks`, `Control Flow & Variables`.
  - Ô tìm kiếm thời gian thực (Real-time filter) hỗ trợ tìm theo tên lệnh, từ khóa hoặc mô tả.
  - Nút Copy Code 1-click đưa ngay mẫu câu lệnh vào clipboard hoặc editor.

---

### 2.2. Tối Ưu Hóa Ngữ Cảnh & Thứ Tự Ưu Tiên IntelliSense SQL

- **Phân Loại Ngữ Cảnh Mệnh Đề (Clause-Aware Context Filtering)**:
  - **Mệnh đề `SELECT`**:
    - Ưu tiên cao nhất cho các cột thuộc các bảng đã được khai báo trong mệnh đề FROM/JOIN.
    - Ưu tiên các hàm tổng hợp (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`) và hàm xử lý thông dụng.
    - Giảm điểm ưu tiên từ khóa để tránh tình trạng từ khóa chiếm các vị trí đầu tiên của danh sách gợi ý.
  - **Mệnh đề `FROM` / `JOIN`**:
    - Tự động gợi ý Schemas, Tables, Views, Table-Valued Functions.
    - Ưu tiên từ khóa liên kết: `JOIN`, `LEFT JOIN`, `INNER JOIN`, `ON`.
  - **Mệnh đề `WHERE` / `HAVING` / `ON`**:
    - Ưu tiên tên cột, toán tử so sánh (`=`, `<>`, `IN`, `LIKE`, `BETWEEN`, `IS NULL`), và các biến (@param trong T-SQL).

- **Khắc Phục Xung Đột Từ Khóa Ngắn & Mở Rộng Dấu Sao (Star Expansion & Keyword Alias)**:
  - Trước đây, khi gõ các tiền tố ngắn 1-2 ký tự (như `c`, `co`), cơ chế mở rộng alias từ khóa có thể gợi ý `* -> col1, col2` hoặc alias không mong muốn lên đầu bảng xếp hạng, lấn át các từ khóa hoặc tên cột thực tế như `COUNT`, `COLLATE`, `ColumnName`.
  - Nâng ngưỡng độ dài tối thiểu của từ truy vấn lên ít nhất 3 ký tự trước khi kích hoạt gợi ý alias từ khóa.
  - Giảm trọng số của alias-based star expansion xuống điểm cơ sở 60 để đảm bảo các kết quả khớp tiền tố trực tiếp (prefix match) luôn có điểm số cao hơn và đứng top 1.

- **Đồng Bộ Hóa Phương Ngữ CSDL (Dialect Synchronization)**:
  - IntelliSense tự động nhận diện kết nối hiện hành của tab soạn thảo:
    - Nếu là SQL Server: Gợi ý các hàm built-in T-SQL, kiểu dữ liệu T-SQL, cú pháp TOP, TRY/CATCH, OUTPUT.
    - Nếu là PostgreSQL: Gợi ý cú pháp LIMIT/OFFSET, RETURNING, RAISE, PERFORM, ILIKE, các kiểu dữ liệu và hàm PL/pgSQL chuẩn.

---

### 2.3. Module Quản Lý Người Dùng & Phân Quyền CSDL (Database Users & Permissions)

- **Quản lý Toàn Diện User & Role**:
  - Giao diện trực quan cho phép duyệt danh sách người dùng CSDL (Database Users), tài khoản đăng nhập máy chủ (Server Logins), các vai trò cố định (Fixed Server/Database Roles).
  - Hỗ trợ cả Microsoft SQL Server và PostgreSQL.
- **Kiểm Tra & Phân Quyền Chi Tiết**:
  - Xem chi tiết bảng phân quyền: Quyền trên đối tượng (Object Permissions), quyền trên lược đồ (Schema Permissions), quyền trên cơ sở dữ liệu (Database Permissions).
  - Phân tích quyền thực tế (Effective Permissions) của từng người dùng.

---

### 2.4. Nâng Cấp Bộ Công Cụ Dữ Liệu & Clipboard

- Tối ưu hóa tính năng sao chép và dán giữa Data Grid kết quả truy vấn và các phần mềm bảng tính bên ngoài (Excel, Google Sheets).
- Hỗ trợ công cụ kết nối và chỉnh sửa dữ liệu Google Sheets trực tiếp trong môi trường IDE.

---

## 3. Danh Sách Tệp Thay Đổi Chính

| Tệp | Hành động | Nội dung thay đổi |
|---|---|---|
| `app/version.py` | Cập nhật | Nâng `__version__ = "1.1.2"` và `__version_tuple__ = (1, 1, 2)`. |
| `version.json` | Cập nhật | Nâng version `1.1.2`, cập nhật releaseNotes, highlights, fileSize và sha256 checksums. |
| `app/api/syntax_catalog_api.py` | Thêm mới | API endpoint cung cấp danh mục cú pháp, lọc theo dialect, category và từ khóa tìm kiếm. |
| `app/services/syntax_catalog/` | Thêm mới | Service xử lý logic tra cứu cú pháp, lọc riêng từng CSDL và so sánh tương đương đa CSDL. |
| `app/data/syntax_catalog/syntax_entries.json` | Thêm mới | Cơ sở dữ liệu mẫu cú pháp phong phú cho 5 CSDL: SQL Server, PostgreSQL, SQLite, MySQL, Oracle. |
| `static/css/syntax-catalog.css` | Thêm mới | Giao diện CSS Modern Glassmorphism cho cửa sổ tra cứu cú pháp. |
| `static/js/syntax-catalog.js` | Thêm mới | Logic điều khiển tìm kiếm, lọc danh mục, chuyển đổi chế độ xem riêng/so sánh, sao chép code. |
| `static/js/syntax-reference-window.js` | Thêm mới | Cửa sổ tra cứu độc lập pywebview tích hợp phím tắt F1 / Helper. |
| `templates/syntax_reference_window.html` | Thêm mới | Template HTML cửa sổ tra cứu cú pháp đa CSDL. |
| `static/js/candidate-generator.js` | Cập nhật | Tối ưu hóa nguồn ứng viên theo ngữ cảnh clause và dialect. |
| `static/js/candidate-filter.js` | Cập nhật | Tối ưu hóa thuật toán lọc, nâng ngưỡng khớp alias từ khóa, ngăn ngừa star expansion lấn át. |
| `static/js/completion-ranker.js` | Cập nhật | Tinh chỉnh trọng số xếp hạng `_finalScore` ưu tiên cột và hàm trong ngữ cảnh phù hợp. |
| `static/js/completion-engine.js` | Cập nhật | Kết nối logic phân tích ngữ cảnh clause và trả về kết quả đã xếp hạng tối ưu. |
| `static/js/trigger-controller.js` | Cập nhật | Tinh chỉnh điều kiện kích hoạt tự động popup IntelliSense khi gõ ký tự. |
| `app/api/database_users_api.py` | Thêm mới | API endpoints quản lý người dùng, login, roles và permissions. |
| `app/services/database_users/` | Thêm mới | Service quản trị user & permissions trên SQL Server và PostgreSQL. |
| `scripts/package_release.py` | Cập nhật | Cập nhật phiên bản phát hành `1.1.2`, hướng dẫn cập nhật và tự động tính toán mã băm SHA-256. |
| `dist/README_UPDATE.txt` | Cập nhật | Bản hướng dẫn phát hành và cập nhật v1.1.2 tại chỗ. |
| `docs/update_v1.1.2.md` | Thêm mới | Tài liệu chi tiết phát hành phiên bản `v1.1.2`. |

---

## 4. Kết Quả Kiểm Thử Toàn Diện (100% Passed)

Tất cả các bộ kiểm thử tự động của hệ thống đều vượt qua 100%:

- **Bộ kiểm thử Python Backend**:
  - `Ran 397 tests in 21.638s — OK (100% Passed)`
  - Kiểm thử cú pháp T-SQL ScriptDOM và PL/pgSQL Validator: `PASSED`
  - Kiểm thử Syntax Coordinator và Adapter Failover: `PASSED`
  - Kiểm thử API Surface, Settings API, Update Checker: `PASSED`
  - Kiểm thử Metadata Service, Database Connection Base: `PASSED`
  - Kiểm thử Table Data Editor, Table Designer: `PASSED`

- **Bộ kiểm thử JavaScript Frontend**:
  - `163 tests passed across all suites — 0 fail (100% Passed)`
  - L1 Context Analyzer Corpus Tests (40 cases): `PASSED`
  - L8 Fuzzing Cursor Positions (1301 cursor positions, 0 exceptions): `PASSED`
  - L9 Performance Benchmarking & PERF-1 under 50ms: `PASSED`
  - Phase 3 PostgreSQL Keywords & Dialect Sync: `PASSED`
  - Phase 4.1 T-SQL TRY/CATCH Context: `PASSED`
  - Phase 5 Monarch Tokenizer Syntax Highlighting: `PASSED`
  - Signature Help Stored Procedure & UDF Parameters: `PASSED`

---

## 5. Hướng Dẫn Cập Nhật Bản Đóng Gói

### Cách 1: Sử Dụng Gói Đầy Đủ (Full Distribution — `LLTool_v1.1.2.zip`)
1. Tải về file `dist/LLTool_v1.1.2.zip`.
2. Giải nén vào một thư mục bất kỳ trên máy tính.
3. Chạy trực tiếp `LLTool.exe` để sử dụng ngay mà không cần cài đặt. Toàn bộ lịch sử truy vấn và danh sách kết nối lưu tại `%APPDATA%\LLTool` sẽ được bảo toàn nguyên vẹn.

### Cách 2: Nâng Cấp Tại Chỗ Siêu Nhẹ (In-Place Patch Update — `LLTool_v1.1.2_patch.zip`)
1. Đóng ứng dụng `LLTool.exe` nếu đang hoạt động.
2. Giải nén đè toàn bộ nội dung từ file `dist/LLTool_v1.1.2_patch.zip` vào thư mục cài đặt hiện tại của bạn (`dist/LLTool/`).
3. Khởi động lại `LLTool.exe` để trải nghiệm ngay các tính năng tra cứu cú pháp và gợi ý IntelliSense tối ưu của phiên bản `v1.1.2`.
