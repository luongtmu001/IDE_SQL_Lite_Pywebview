# Nhật Ký Thay Đổi & Cập Nhật (CHANGELOG) — LLTool IDE

Tất cả các thay đổi, sửa đổi, bổ sung tính năng và bản vá lỗi đáng chú ý của dự án **LLTool IDE** (Database Desktop Client for SQL Server & PostgreSQL) được ghi lại đầy đủ và chi tiết tại file này.

## [v1.1.5] — 24/10/2026

### 🐘 Sửa Lỗi Cú Pháp Bảng Tạm & Bổ Sung Gợi Ý/Cảnh Báo Kế Thừa Bảng Tạm PostgreSQL (Cross-Routine Temp Table Scope)

- **Khắc Phục Lỗi Syntax Check Báo Sai Kiểu Dữ Liệu Khi Tạo Bảng Tạm PostgreSQL**:
  - Sửa lỗi câu lệnh `CREATE TEMP TABLE ... (id integer)` bị báo gạch đỏ ở kiểu dữ liệu `integer`.
  - Mở rộng regex nhận diện câu lệnh DDL trong `validator_pg.py` để hỗ trợ đầy đủ các tiền tố `CREATE [GLOBAL|LOCAL] [TEMP|TEMPORARY|UNLOGGED] TABLE`, `INDEX`, `SEQUENCE`, `VIEW`.
  - Ngăn chặn việc gửi câu lệnh tạo bảng tạm xuống server thông qua `EXPLAIN` (vốn không hỗ trợ cú pháp `CREATE TABLE ... (cột kiểu)`), chuyển sang phân tích tĩnh ngữ nghĩa (`semantic_analyzer.py`) an toàn và không gây lỗi giả.

- **Gợi Ý IntelliSense Bảng Tạm Kế Thừa Giữa Các Routine (Hàm/Thủ tục/Trigger) Cho PostgreSQL**:
  - Khác với SQL Server (bảng tạm `#temp` bị hủy ngay khi procedure con kết thúc), PostgreSQL duy trì bảng tạm trong suốt phiên làm việc (Session Scope). Khi Routine A gọi Routine B (`CALL proc_b();` hoặc `PERFORM`), các bảng tạm tạo trong B vẫn tồn tại và sử dụng được trong A.
  - Tự động nhận diện và gợi ý các bảng tạm được sinh ra từ các routine được gọi (kể cả gọi bắc cầu $A \rightarrow B \rightarrow C$).
  - Hiển thị nhãn trực quan: `displayType: "Temp Table (proc_name)"`, `detail: "Kế thừa từ proc_name()"`, cùng đầy đủ danh sách cột khi truy cập `temp_table.`.

- **Hệ Thống Cảnh Báo Vàng (Warning) Nhận Diện Trạng Thái Bảng Tạm Trong Routine**:
  - **Cảnh báo nhận diện bảng tạm đã có**: Khi Routine A gọi Routine B và sử dụng bảng tạm được tạo trong B, hiển thị cảnh báo vàng (`PG_TEMP_TABLE_INHERITED`): `Bảng tạm "{tbl}" đã có trong routine "{proc}()" được gọi đến trong session.`
  - **Cảnh báo bảng tạm chưa tồn tại**: Khi Routine A gọi Routine B nhưng truy vấn bảng tạm chưa hề được khai báo trong routine con hay routine hiện tại, hiển thị cảnh báo vàng (`PG_TEMP_NOT_FOUND_IN_CALLEE`): `Cảnh báo: Bảng tạm "{tbl}" chưa có trong routine "{proc}()" được gọi đến hoặc routine hiện tại.`
  - **Cảnh báo xung đột tạo lại (Conflict Warning)**: Khi Routine A gọi Routine B (đã tạo bảng tạm) nhưng Routine A lại tiếp tục `CREATE TEMP TABLE` trùng tên mà không dùng `IF NOT EXISTS`, cảnh báo vàng (`PG_TEMP_CONFLICT_WARNING`) báo nguy cơ lỗi runtime `relation already exists` trong PostgreSQL.

## [v1.1.4] — 24/10/2026

### 🛡️ Kích Hoạt Mô Hình Phiên Độc Lập Theo Từng Tab (Per-Tab Session Model & Temp Table Isolation)

- **Sửa Lỗi Cầu Nối IPC Desktop PyWebview (`/api/connections/tab-session`)**:
  - Khắc phục lỗi `501 Unhandled IPC route` khi gọi `tab-session` trên môi trường Native Desktop.
  - Đăng ký đầy đủ `connections:tab_session_create` (POST) và `connections:tab_session_close` (DELETE) vào bảng điều phối IPC `ROUTE_DISPATCH_TABLE` trong `api.js`.
  - Bổ sung native methods `get_or_create_tab_session` và `close_tab_session` vào `ConnectionsApiMixin`, liên kết trực tiếp với `ConnectionManager`.

- **Phân Lập Kết Nối & Cô Lập Bảng Tạm Giữa Các Tab (SQL Server & PostgreSQL)**:
  - Mỗi Query Tab khi mở ra sẽ được cấp phát một kết nối thực thi độc lập (Dedicated Connection Session) với SPID (SQL Server) hoặc PID (PostgreSQL `pg_backend_pid()`) riêng biệt tương tự SSMS.
  - Khắc phục triệt để lỗi các tab dùng chung kết nối khiến bảng tạm `#temp` (SQL Server) và bảng tạm `CREATE TEMP TABLE` (PostgreSQL) bị rò rỉ hoặc truy vấn được xuyên tab.
  - Bảng tạm cục bộ tạo ở Tab 1 hoàn toàn cô lập với Tab 2; đóng tab sẽ tự động ngắt kết nối và giải phóng toàn bộ bảng tạm trên database server.

- **Hiển Thị Badge SPID/PID Thời Gian Thực & Hỗ Trợ Đổi Kết Nối**:
  - Tự động gán và hiển thị ngay lập tức badge `SPID: <số>` (SQL Server) hoặc `PID: <số>` (PostgreSQL) trên thanh trạng thái (Status Bar) ngay khi vừa tạo tab mới.
  - Tự động reset và cấp phát lại session độc lập tương ứng khi người dùng thực hiện chuyển đổi kết nối (Switch Connection) trên tab.
  - Kế thừa và duy trì chính xác ngữ cảnh `database` / `schema` riêng biệt cho từng tab thực thi.

## [v1.1.3] — 23/10/2026

### 🚀 Nâng Cấp Toàn Diện Hệ Thống Gợi Ý Thông Minh SQL IntelliSense 3.0 (Context & Ranking Overhaul)

- **Nhận Diện 11 Vị Trí Cú Pháp Chi Tiết (11 Fine-Grained Syntax Positions & Alias Slot)**:
  - Bổ sung bộ nhận diện vị trí con trỏ độc lập `position` trong `SqlContextAnalyzer`:
    - `statement_start`: Đầu câu truy vấn hoặc sau dấu chấm phẩy `;`, `GO`, `BEGIN`, `ELSE`, `THEN`, hoặc sau `AS` trong thân Stored Procedure / Function.
    - `after_source` & `aliasSlot`: Đứng sau nguồn dữ liệu bảng/view/subquery trong `FROM` hoặc `JOIN`, nhận biết chính xác khi nào đang ở vị trí đặt tên alias (`aliasSlot: true`) hoặc khi nào đã có alias (`aliasSlot: false`).
    - `after_operand`: Đứng sau toán hạng trong mệnh đề điều kiện `WHERE`, `HAVING`, `ON`, `CASE`.
    - `is_predicate`: Đứng ngay sau toán tử `IS` hoặc `IS NOT`.
    - `order_direction`: Đứng sau biểu thức cột trong mệnh đề `ORDER BY` (ưu tiên `ASC`, `DESC`).
    - `value_expression`: Vế phải phép gán `SET col =`, danh sách `VALUES (...)`, hoặc sau toán tử so sánh (`=`, `<>`, `LIKE`, `IN (...)`).
    - `column_definition_type`: Sau tên cột trong `CREATE TABLE`, `DECLARE @table TABLE`, hoặc `ALTER TABLE ADD`.
    - `table_hint`: Bên trong khối chỉ định bảng `WITH (...)` (SQL Server).
    - `aggregate_arg`: Bên trong đối số của hàm tổng hợp (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `STRING_AGG`...).
    - `alias_name`: Ngay sau từ khóa `AS` trong SELECT list hoặc FROM (trả về danh sách rỗng, không sinh rác).
    - `on_conflict`: Mệnh đề xử lý xung đột `ON CONFLICT` (PostgreSQL).

- **Sinh Ứng Viên Theo Vị Trí & Lọc Từ Khóa Mong Đợi (Position-Based Candidate Generation & Expected Keywords)**:
  - Bảng tra cứu `EXPECTED_KEYWORDS` theo từng hệ quản trị (`(dialect, position)`): Chỉ sinh các từ khóa có nghĩa về mặt ngữ pháp tại vị trí con trỏ, loại bỏ hoàn toàn các từ khóa không thể xuất hiện (ví dụ không sinh `WHERE` trong `SELECT`, không sinh `FROM` trong `WHERE`).
  - Gắn cờ `isExpected: true` (+90 điểm) cho từ khóa mong đợi và `isFollowUp: true` (+120 điểm) cho từ khóa bổ trợ liên tiếp (như `BY` sau `ORDER`, `BY` sau `GROUP`).
  - Chặn triệt để sinh hàm rác tại `statement_start`, `after_source`, `table_hint`, `order_direction`, `is_predicate`, trừ trường hợp đặc thù trong khối `BEGIN CATCH` (hiển thị `ERROR_MESSAGE()`, `ERROR_NUMBER()`, v.v.).

- **Thuật Toán Xếp Hạng Ranker v2 (Ranker v2, Exact Match Boost & Group Quotas)**:
  - **Khớp Chính Xác Ưu Tiên Tuyệt Đối (Exact Match Boost)**: Thưởng +150 điểm cho từ khóa mong đợi khớp chính xác (đảm bảo gõ `OR`, `AND`, `IN`, `IS`, `ASC`, `DESC` luôn đứng #1, không bị cột cùng tiền tố lấn át) và +80 điểm cho các đối tượng khác khớp chính xác.
  - **Bảng Trọng Số Phổ Biến (Popularity Weighting)**: Tích hợp `KEYWORD_POPULARITY` và `FUNCTION_POPULARITY` theo dialect (ưu tiên hàm thông dụng `COUNT`, `SUM`, `GETDATE`/`NOW` hơn các hàm hiếm `COT`, `GOTO`).
  - **Cắt Danh Sách Theo Hạn Mức Nhóm (Group Quotas Truncation)**: Thay thế việc cắt 150 mục sau sắp xếp A-Z (gây mất từ khóa cuối bảng chữ cái). Giữ 100% expected keywords, tối đa 30 keywords khác, 40 functions, 100 DB objects; nâng trần lên 1.000 ứng viên đối với các bảng có số lượng cột lớn.
  - **Hạ Trần Fuzzy & Tối Ưu Tỉ Lệ Tiền Tố (Fuzzy Score Cap & Prefix Ratio)**: Khống chế điểm trần Fuzzy ở mức 70 (thấp hơn dải Subword 72–79), công thức độ dài tiền tố mới không còn thiên vị quá mức cho các từ khóa quá ngắn (giải quyết triệt để RC3 & RC10).

- **Học Thứ Tự Gợi Ý Theo Lịch Sử Sử Dụng (MRU History Ranking)**:
  - Lớp `CompletionMruManager`: Quản lý tần suất và thời điểm sử dụng ứng viên, phân lập theo `${dbType}::${connectionId}::${type}::${nameLower}` và lưu trữ an toàn trong `localStorage`.
  - Thuật toán phân rã theo thời gian (Time Decay): Chu kỳ bán rã 72 giờ, hệ số recency từ 1.0 giảm dần về sàn 0.2.
  - Điểm thưởng MRU: Từ 0 đến tối đa `+15` điểm, chỉ cộng điểm trong cùng nhóm loại ứng viên, tuyệt đối không lấn át expected keywords hay exact match.
  - Tự động tỉa bớt (Pruning): Khi vượt quá 500 mục, tự động giữ lại 400 mục có điểm số cao nhất.
  - Tích hợp Settings UI: Bổ sung tùy chọn switch `editor.intellisenseMru` (bật mặc định) và nút hành động "Xóa Lịch sử Gợi ý..." trong giao diện Settings.

- **Vệ Sinh Mã Nguồn & Đồng Bộ Kiến Trúc Đơn Nguồn Chân Lý (Code Hygiene & RC13 Resolution)**:
  - Loại bỏ hoàn toàn hơn 2.900 dòng mã duplicate của `CandidateFilter`, `CompletionRanker` và `CandidateGenerator` bị nhúng đè bên trong `completion-engine.js`, giảm kích thước file từ 4.578 dòng xuống 1.692 dòng.
  - Chuẩn hóa liên kết Singleton: `completion-engine.js` sử dụng trực tiếp các instance canonical từ `window.CandidateFilter`, `window.CompletionRanker`, `window.CandidateGenerator` kèm stub dự phòng an toàn.
  - Tăng tốc độ thực thi toàn bộ test suite và giảm độ trễ khởi tạo runtime.

- **Độ Tin Cậy & Bộ Test Hồi Quy (Test Verification & Benchmarks)**:
  - 100% (76/76) ca probe xếp hạng nâng cao trong `ranking_l2r.json` chuyển sang trạng thái xanh (`pass`).
  - 15 test suites Node.js với 275 unit/integration test cases đạt 100% PASS (0 failing, 0 todo).
  - Benchmark L9 trên tài liệu SQL 100KB: Phân tích cú pháp đạt trung bình ~22–24ms (chỉ tiêu yêu cầu < 50ms); hoàn tất sinh gợi ý trên catalog 20.000 đối tượng trong ~109ms.

## [v1.1.2] — 23/10/2026

### 📚 Tra Cứu & So Sánh Cú Pháp Đa Cơ Sở Dữ Liệu (Cross-Database Syntax Reference & Catalog)
- **Hỗ Trợ 5 Hệ Quản Trị CSDL Phổ Biến**:
  - Hỗ trợ toàn diện SQL Server (T-SQL), PostgreSQL (PL/pgSQL), SQLite, MySQL, và Oracle (PL/SQL).
- **2 Chế Độ Xem Linh Hoạt**:
  - **Chế độ Riêng Rẽ Từng CSDL (Database-Specific Mode)**: Xem đầy đủ toàn bộ câu lệnh, kiểu dữ liệu, mệnh đề và hàm đặc thù của 1 CSDL được chọn.
  - **Chế độ So Sánh Tương Đương (Cross-Database Comparison Mode)**: Đối chiếu cú pháp tương đương giữa các hệ quản trị trên cùng một màn hình, hỗ trợ chuyển đổi mã SQL (SQL Migration) nhanh chóng.
- **Tài Liệu Tham Khảo Mở Rộng (External Documentation Links)**:
  - Tích hợp liên kết tài liệu từ W3Schools SQL Tutorial, Microsoft Learn, PostgreSQL Docs, MySQL Docs kèm mẫu code ví dụ thực tế.
- **Cửa Sổ Tra Cứu Chuyên Dụng (Dedicated Syntax Reference Window)**:
  - Cửa sổ độc lập pywebview với phong cách Modern Dark Glassmorphism, bộ lọc theo danh mục (DDL, DML, Functions, Constraints, Transactions...), ô tìm kiếm thời gian thực và nút Copy Code 1-click. Mở nhanh qua nút Helper trên toolbar hoặc phím tắt F1.

### 🧠 Tối Ưu Hóa Ngữ Cảnh & Thứ Tự Ưu Tiên IntelliSense SQL (IntelliSense Smart Context & Ranking)
- **Phân Loại Ngữ Cảnh Mệnh Đề (Clause-Aware Context Filtering)**:
  - `SELECT`: Ưu tiên hàng đầu tên cột thuộc bảng trong truy vấn và hàm tổng hợp (`COUNT`, `SUM`, `AVG`...), tự động giảm điểm từ khóa để không lấn át cột.
  - `FROM` / `JOIN`: Ưu tiên gợi ý Schema, Table, View và các từ khóa liên kết `JOIN`, `LEFT JOIN`, `ON`.
  - `WHERE` / `HAVING` / `ON`: Ưu tiên tên cột, toán tử so sánh logic và biến số.
- **Khắc Phục Xung Đột Tiền Tố Ngắn & Mở Rộng Dấu Sao (Star Expansion & Keyword Alias Polish)**:
  - Nâng ngưỡng ký tự tối thiểu khi khớp alias từ khóa lên ít nhất 3 ký tự, ngăn ngừa tình trạng gõ tiền tố ngắn (1-2 ký tự như `c`, `co`) bị bắt nhầm alias thay vì gợi ý tên cột hoặc hàm thực tế.
  - Tinh chỉnh điểm số mở rộng dấu sao (`* -> col1, col2, ...`) dựa trên alias xuống mức hợp lý (score 60) để các kết quả khớp tiền tố trực tiếp (prefix match) luôn đứng đầu danh sách.
- **Đồng Bộ Hóa Phương Ngữ CSDL (Dialect Synchronization)**:
  - Tự động nhận diện kết nối hiện hành của tab để gợi ý chính xác bộ từ khóa, kiểu dữ liệu và hàm của SQL Server hoặc PostgreSQL.

### 👥 Module Quản Trị Người Dùng & Phân Quyền CSDL (Database Users & Permissions)
- **Quản Lý User, Login, Role Trực Quan**:
  - Giao diện quản lý danh sách Database Users, Server Logins, Fixed Server/Database Roles trên SQL Server và PostgreSQL.
- **Xem & Kiểm Tra Phân Quyền Chi Tiết**:
  - Kiểm tra bảng phân quyền đối tượng, phân quyền schema, phân quyền database và quyền hạn thực tế (Effective Permissions).

### 📋 Nâng Cấp Data Grid, Table Data Editor & Google Sheets Host
- Tối ưu hóa tính năng sao chép và dán giữa Data Grid kết quả truy vấn và các phần mềm bảng tính bên ngoài.
- Nâng cấp bộ công cụ chỉnh sửa dữ liệu bảng và tích hợp Google Sheets data host.

### 📦 Đồng Bộ Bản Đóng Gói & Bản Cập Nhật Tại Chỗ (Packaging & Patch Update)
- Tự động đồng bộ toàn bộ tài nguyên, module mới vào `dist/LLTool` và `_internal/`.
- Tạo gói cập nhật vá lỗi tại chỗ siêu nhẹ `dist/LLTool_v1.1.2_patch.zip` và bản phân phối đầy đủ `dist/LLTool_v1.1.2.zip`.

## [v1.1.1] — 22/10/2026

### 🎨 Nâng Cấp Giao Diện (Modern Card Panels & UI Aesthetics Enhancement)
- **Bố Cục Card Panels Độc Lập Hiện Đại (Modern Card Panels Layout)**:
  - Tách biệt hoàn toàn các vùng giao diện chính (Object Explorer Sidebar, SQL Editor Pane, Query Results Panel) thành các khối Card độc lập với viền mỏng và bóng đổ nhẹ.
  - **Bo Góc 8px (`border-radius: 8px;`)**: Thiết kế bo góc hiện đại theo chuẩn VS Code, Linear và Raycast kết hợp `box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);`.
  - **Căn Chỉnh Góc Con 7px (Nested Radii)**: Bo góc 7px phía trên cho các thanh tiêu đề (Action bar, Sidebar header, Result tabs bar) và 7px phía dưới cho các thanh chân trang (Editor status bar, Result footer), loại bỏ triệt để hiện tượng thừa góc vuông.

- **Tương Phản Màu Nền Canvas Deep Obsidian (`#101114`)**:
  - Tinh chỉnh màu nền chung của IDE (`--ide-bg-main`) sang `#101114`, tối hơn bề mặt các card (`#18191E`, `#1C1D23`, `#202228`).
  - Tạo chiều sâu thị giác rõ rệt, làm các card nổi bật và tập trung tầm nhìn vào nội dung mã nguồn cũng như kết quả truy vấn.
  - Nội dung bảng kết quả, màn hình thông báo, Table Designer và Table Data Editor được thiết lập màu nền card tương ứng, bảo toàn tính thẩm mỹ.

- **Rãnh Kéo Phân Chia Sash Resizers Thanh Mảnh (6px)**:
  - Rãnh kéo dọc giữa Sidebar - Editor và rãnh kéo ngang giữa Editor - Results có độ dày 6px với `border-radius: 3px`.
  - Thiết kế trong suốt khi ở trạng thái nghỉ, tự động phát sáng màu accent của theme khi rê chuột hoặc kéo kích thước.
  - Căn lề `#ide-main-area` padding 6px đồng bộ, tạo khoảng đệm viền khung hoàn mỹ xung quanh các khối card.

- **Tích Hợp Editor Status Bar Liền Khối**:
  - Chuyển thanh trạng thái (zoom %, đếm lỗi cú pháp, chuẩn mã hóa UTF-8, CRLF, vị trí dòng/cột) vào đáy trong của Card Editor.
  - Khối soạn thảo trở thành một card độc lập, tự đóng gói toàn bộ chức năng từ Action bar, Tabs, Code Editor đến Status bar.
  - Căn chỉnh mượt mà cơ chế co giãn khi ẩn/hiện bảng kết quả (`hideResultPanel` / `showResultPanel`).

- **Căn Chỉnh Đồng Bộ Tab Bar & Icon Database**:
  - Căn thẳng hàng hoàn hảo đường viền đáy (`border-bottom`) của tabs bar và results tabs bar.
  - Đồng bộ hiển thị icon tương ứng với loại cơ sở dữ liệu kết nối cho từng tab query.
  - Đổi màu background cả tên tab đang mở theo màu chính của theme.

### 🐛 Sửa Lỗi Sao Chép & Cắt Dữ Liệu (Clipboard & Object Explorer Focus Isolation)
- **Khắc Phục Lỗi Bắt Nhầm Copy Object Explorer Khi Đang Viết SQL**:
  - Sửa lỗi khi người dùng đang soạn thảo mã SQL trong Monaco Editor hoặc các ô input, ấn phím tắt sao chép (`Ctrl+C`) bị ứng dụng bắt nhầm sang object đang highlight (selected) trong Object Explorer và hiện thông báo toast `"Đã sao chép tên bảng: ..."`.
  - Phân lập hoàn toàn phạm vi bắt sự kiện: Object Explorer chỉ sao chép tên đối tượng khi focus bàn phím thực sự nằm bên trong cây đối tượng (`.ide-tree`, `#ide-tree-root`, `.tree-item`).
- **Khắc Phục Lỗi `Ctrl+X` Cắt Cả Dòng Sau Khi Cắt Vùng Chọn (Fix Double Cut / Secondary Line Cut in Monaco Editor)**:
  - Sửa triệt để lỗi khi người dùng chọn một đoạn mã và ấn `Ctrl+X`: đoạn mã được chọn bị cắt nhưng ngay sau đó cả dòng văn bản cũng bị cắt theo dù không thao tác thêm bất kỳ phím nào.
  - **Nguyên nhân cốt lõi**: `handleGlobalCopyCapture` ở capturing phase thực hiện `targetEd.executeEdits('clipboard-cut')` để xóa đoạn văn bản được chọn, khiến vùng chọn trong editor trở về rỗng (`isEmpty() === true`). Do không chặn lan truyền sự kiện, DOM `cut` tiếp tục đi xuống `_textArea.onCut` của Monaco. Monaco nhận sự kiện cut với vùng chọn rỗng và tính năng `emptySelectionClipboard: true` mặc định kích hoạt, tiếp tục cắt toàn bộ dòng hiện tại.
  - **Giải pháp**: Gọi `e.stopPropagation()` và `e.stopImmediatePropagation()` để đóng băng sự kiện `cut` ngay sau khi xử lý. Khi có vùng chọn, chỉ đúng vùng chọn bị cắt bỏ; khi không có vùng chọn, cắt đúng 1 dòng hiện tại theo chuẩn VS Code, bảo đảm hoàn tác (`Ctrl+Z`) chính xác 100%.
- **Tắt Hoàn Toàn Tự Động Format Khi Paste Mã SQL (Format on Paste Disabled)**:
  - Vô hiệu hóa tính năng tự động format code khi người dùng dán (paste) mã SQL vào Monaco Editor.
  - Bảo toàn 100% nguyên trạng nội dung đoạn mã người dùng dán vào; người dùng sẽ hoàn toàn chủ động định dạng code khi cần thông qua phím tắt `Ctrl + K, Ctrl + D` hoặc nút "Format SQL" trên Action Bar.

### 🔍 Cải Tiến Kiểm Tra Cú Pháp PostgreSQL (PostgreSQL PL/pgSQL Syntax Check Enhancement)
- **Bổ Sung Kiểm Tra Cú Pháp Cho Trường Hợp `OPEN cursor FOR`**:
  - Hỗ trợ đầy đủ các dạng mở con trỏ không liên kết (unbound cursor) trong khối lệnh PL/pgSQL:
    - `OPEN cursor_name FOR <query>;`
    - `OPEN cursor_name FOR EXECUTE <query_string> [ USING ... ];`
    - `OPEN cursor_name SCROLL FOR <query>;`
    - `OPEN cursor_name NO SCROLL FOR EXECUTE <query_string>;`
  - **Khắc phục lỗi bắt nhầm FOR loop**: Trước đây bộ phân tích cú pháp khối thủ tục PostgreSQL (`PostgreSqlAdapter` / `check_offline_postgres_structural_blocks`) thấy từ khóa `FOR` mà không phân biệt ngữ cảnh, dẫn đến việc xem `OPEN cur FOR` là một vòng lặp `FOR ... LOOP` và báo lỗi sai lệch `"Missing LOOP keyword after FOR loop header"`.
  - **Bổ sung ngữ cảnh con trỏ và hàm**: Nhận diện chính xác câu lệnh bắt đầu bằng `OPEN`, khai báo con trỏ trong khối `DECLARE` (`cursor_name [ [ NO ] SCROLL ] CURSOR [ ( arguments ) ] FOR <query>`), các mệnh đề khóa `FOR UPDATE` / `FOR SHARE` / `FOR NO KEY UPDATE` / `FOR KEY SHARE`, cũng như các hàm chứa `FOR` trong ngoặc đơn như `SUBSTRING(str FROM pos FOR len)`.

### ⚡ Nâng Cấp Hệ Thống Snippet & Lọc Gợi Ý IntelliSense Theo Loại CSDL (SQL Snippets Database Type & Dialect-Aware IntelliSense)
- **Thêm Trường Phân Loại CSDL Cho Snippet (`dbType`)**:
  - Hỗ trợ gán loại hệ quản trị cơ sở dữ liệu cho từng SQL Snippet:
    - **Tất cả CSDL (`all` / không gán loại CSDL)**: Được đề xuất và mở rộng ở **cả 2 loại kết nối** (SQL Server & PostgreSQL).
    - **SQL Server (`sqlserver`)**: Chỉ hiển thị và mở rộng khi tab làm việc kết nối tới cơ sở dữ liệu SQL Server.
    - **PostgreSQL (`postgresql`)**: Chỉ hiển thị và mở rộng khi tab làm việc kết nối tới cơ sở dữ liệu PostgreSQL.
- **Nâng Cấp Giao Diện Quản Lý Snippets & Quick Bookmark**:
  - **Snippet Manager Modal (`Ctrl + Alt + S`)**: Thêm trường lựa chọn dropdown **Loại CSDL** (`Tất cả CSDL`, `SQL Server`, `PostgreSQL`) trong form tạo/chỉnh sửa; hiển thị huy hiệu loại CSDL trực quan (`MSSQL`, `PG`, `ALL`) trên danh sách snippet; bổ sung pill lọc nhanh theo loại CSDL trên thanh tag cloud.
  - **Quick Bookmark Popover (`Ctrl + Shift + B`)**: Thêm lựa chọn Loại CSDL, tự động nhận diện loại CSDL của tab đang kích hoạt để chọn trước phù hợp.
- **Tối Ưu Hóa Gợi Ý IntelliSense & Mở Rộng Snippet Tự Động Bằng Phím Tab**:
  - Bộ sinh ứng viên (`candidate-generator.js`), động cơ gợi ý (`completion-engine.js`), giao diện hoàn tất (`intellisense.js`) và bộ điều khiển kích hoạt (`trigger-controller.js`) tự động lọc danh sách snippet theo loại kết nối của tab hiện hành.
  - Khi người dùng gõ từ khóa viết tắt và nhấn `Tab`, phương thức `findSnippet` và `hasMatchingSnippet` chỉ mở rộng snippet phù hợp với loại CSDL hiện hành, ngăn chặn tình trạng mở rộng nhầm cú pháp đặc thù của hệ quản trị khác.


---

## [v1.1.0] — 21/10/2026

### 🌟 Tính Năng & Nâng Cấp Nổi Bật (Developer Productivity & Smart Refactor)
- **Thanh Thống Kê & Hiệu Năng Thực Thi Truy Vấn (Execution Statistics Bar - F3)**:
  - Tích hợp thanh thông tin hiệu năng động ngay trên đầu tab Result Grid:
    - **Thời Gian Thực Thi (Execution Time)**: Hiển thị chính xác thời gian chạy tính bằng `ms` hoặc `s`.
    - **Huy Hiệu Hiệu Năng (Performance Badge)**: Phân loại trực quan Nhanh (`Fast` < 200ms, xanh lá), Trung bình (`Medium` 200ms - 1s, vàng) và Chậm (`Slow` > 1s, cam/đỏ).
    - **Số Dòng Trả Về (Rows Returned / Affected)**: Đếm chính xác số dòng kèm định dạng dấu phẩy hàng nghìn.
    - **Dung Lượng Dữ Liệu (Payload Size)**: Tính toán kích thước dữ liệu nhận được từ database (`B`, `KB`, `MB`).
    - **Tốc Độ Truyền Tải (Data Transfer Rate)**: Đo lường băng thông truyền dữ liệu tức thời (`KB/s`, `MB/s`).
    - **Sao Chép Nhanh Tóm Tắt (Copy Summary - `Alt + S`)**: Nút sao chép định dạng chuẩn `Execution: 12ms | Rows: 50 | Data: 1.2 KB | Rate: 100 KB/s` để chia sẻ báo cáo nhanh.
  - Tự động lưu vết các chỉ số hiệu năng vào bảng lịch sử truy vấn (`query_history`) phục vụ phân tích xu hướng.

- **Hệ Thống Đánh Dấu Sao & Gắn Thẻ Lịch Sử Truy Vấn (Smart Bookmark & Tag System - F2)**:
  - **Bookmark Yêu Thích (⭐)**: Đánh dấu/bỏ đánh dấu sao các câu truy vấn quan trọng trực tiếp trên giao diện Query History hoặc thông qua phím tắt `Ctrl + D`.
  - **Gắn Thẻ Màu Sắc Linh Hoạt (Tags)**: Gán thẻ phân loại như `#report`, `#analytics`, `#prod`, `#dev`, `#maintenance`, `#bugfix` với badge màu sắc trực quan.
  - **Bộ Lọc Đa Chiều Nâng Cao**: Kết hợp đồng thời lọc theo từ khóa tìm kiếm, lọc theo Database, xem riêng danh sách câu truy vấn có gắn Bookmark, và lọc theo Tag chỉ định.
  - Lưu trữ bền vững trong cơ sở dữ liệu nội bộ SQLite và đồng bộ trạng thái tức thì trên toàn ứng dụng.

- **Tham Số Truy Vấn & Bộ Mẫu Thông Minh (Query Parameters & Presets - F7)**:
  - Hỗ trợ cú pháp tham số động `{{param_name}}` trong câu lệnh SQL cho cả SQL Server và PostgreSQL.
  - **Monaco Syntax Highlighting**: Monarch tokenizer nhận diện và tô màu nổi bật biến tham số `{{param_name}}` (`variable.parameter`) với sắc cam hổ phách cao cấp.
  - **Tự Động Suy Luận Kiểu Dữ Liệu (`inferParamType`)**: Tự động nhận diện kiểu dữ liệu theo tên biến (`date`/`time` -> Date input, `id`/`num`/`count` -> Number input, `is_`/`has_`/`active` -> Boolean selector).
  - **Hỗ Trợ Kiểu Boolean Toàn Diện**: Selector chọn `1 / 0` hoặc `true / false` tự động dịch sang chuẩn tương ứng từng DBMS (`1/0` cho T-SQL, `TRUE/FALSE` cho PostgreSQL).
  - **Parameter Sets / Presets Quản Lý**: Lưu trữ và quản lý các bộ tham số mẫu trong `localStorage` (`ide_query_param_presets`), chuyển đổi nhanh giữa các môi trường kiểm thử (Dev, Staging, Production).
  - **Hộp Thoại Nhập Tham Số (`Alt + P`)**: Phím tắt mở modal tham số nhanh, tự động kích hoạt khi thực thi câu lệnh có chứa tham số chưa được gán giá trị.

- **Động Cơ Tái Cấu Trúc Mã SQL Thông Minh (Smart SQL Refactor Engine - F5)**:
  - **Đổi Tên Đồng Bộ Biểu Tượng (`F2` - Rename Symbol Across Query)**: Đăng ký `monaco.languages.registerRenameProvider` cho ngôn ngữ SQL. Hỗ trợ đổi tên đồng loạt bí danh bảng (Alias), biến cục bộ (`@var`), tên CTE hoặc tên cột trong phạm vi truy vấn một cách an toàn và tức thì.
  - **Trích Xuất Subquery Thành CTE (`Alt + Shift + C` / `Ctrl + Shift + E`)**: Tự động nhận diện đoạn subquery được chọn và bọc thành mệnh đề `WITH cte_name AS (...)` ở đầu câu lệnh, tự động gộp vào mệnh đề `WITH` sẵn có nếu đã tồn tại. Tích hợp trên cả phím tắt, command palette và Context Menu chuột phải.
  - **Tự Động Chuẩn Hóa Khi Dán Mã (Format on Paste)**: Tự động phát hiện khi người dùng dán khối mã SQL nhiều dòng và định dạng lại theo chuẩn mực thụt lề, từ khóa viết hoa, nâng cao tính chuyên nghiệp và thẩm mỹ của mã nguồn.

- **Đạt 100% Bộ Kiểm Thử Tự Động (Automated Test Suite)**:
  - `tests/test_execution_stats.py`: 8/8 tests PASSED (100%).
  - `tests/test_snippets_bookmark_tags.py`: 12/12 tests PASSED (100%).
  - `tests/test_query_params_and_refactor.py`: 17/17 tests PASSED (100%).
  - `tests/test_api_surface_snapshot.py`: PASSED (100%).

---

## [v1.0.8] — 21/10/2026

### 🌟 Tính Năng & Nâng Cấp Nổi Bật (Smart IDE Highlights)
- **Hệ Thống Quy Tắc Cảnh Báo Best-Practice (BP001 - BP006)**:
  - Tích hợp động cơ phân tích thực hành tốt nhất khi soạn thảo SQL:
    - **`BP001` (Warning)**: Cảnh báo việc sử dụng `SELECT *` thay vì danh sách cột cụ thể; loại trừ thông minh và an toàn các cấu trúc `COUNT(*)`, `COUNT_BIG(*)`, `EXISTS (SELECT * ...)`.
    - **`BP002` (Warning)**: Cảnh báo gợi ý khóa bảng `(NOLOCK)` hoặc `WITH (NOLOCK)` trong T-SQL do nguy cơ đọc dữ liệu không nhất quán (dirty reads).
    - **`BP003` (Hint)**: Gợi ý chỉ định rõ schema qualification (ví dụ: `dbo.table` hoặc `public.table`) trong `FROM` / `JOIN` (bỏ qua `#temp`, `@var`, CTE và subqueries).
    - **`BP004` (Warning)**: Cảnh báo câu lệnh `TOP N` không có mệnh đề `ORDER BY` trong T-SQL sẽ trả về tập kết quả không tất định (non-deterministic).
    - **`BP005` (Hint)**: Gợi ý thay thế hàm độc quyền T-SQL `ISNULL(a, b)` bằng hàm chuẩn ANSI `COALESCE(a, b)`.
    - **`BP006` (Hint)**: Gợi ý thay thế hàm `CONVERT(type, val)` 2 đối số bằng hàm chuẩn ANSI `CAST(val AS type)`.
  - Cơ chế **Mask SQL Strings & Comments**: Bảo toàn vị trí dòng/cột và loại bỏ 100% hiện tượng bắt nhầm từ khóa nằm trong comment (`--`, `/* */`) hoặc chuỗi ký tự (`'...'`).

- **Bộ Sửa Nhanh Tự Động Monaco Editor (Quick-Fix CodeAction Provider)**:
  - Đăng ký `monaco.languages.registerCodeActionProvider` hỗ trợ biểu tượng bóng đèn thông minh (Lightbulb) hoặc phím tắt `Alt + Enter`:
    - **Quick-Fix BP002**: Tự động xóa sạch gợi ý bảng `(NOLOCK)` hoặc `WITH (NOLOCK)`.
    - **Quick-Fix BP005**: Tự động chuyển đổi `ISNULL(a, b)` thành `COALESCE(a, b)`.
    - **Quick-Fix BP006**: Tự động chuyển đổi cú pháp `CONVERT(type, val)` thành `CAST(val AS type)`.
  - Phân tầng trực quan mức độ nghiêm trọng: Gạch đỏ lượn sóng cho lỗi cú pháp (`Error`), gạch vàng cho cảnh báo thực hành (`Warning`), và dấu chấm xanh cho gợi ý tối ưu (`Hint`/`Info`).

- **Bộ Nhớ Đệm Kiểm Tra Cú Pháp Cấp Câu Lệnh (Statement-Level Syntax Caching)**:
  - Cache kết quả kiểm tra cú pháp với TTL 5 giây, băm khóa SHA-256 theo nội dung câu lệnh, dialect, session, database, schema và tùy chọn rules.
  - Tối ưu hóa phản hồi tức thì khi người dùng gõ phím trong Monaco Editor mà không làm tăng tải CPU.
  - Cơ chế Thread-Safe với LRU Eviction tự động tỉa các mục cũ khi đạt 512 entries.
  - **DDL Invalidation Hook**: Tự động làm mới bộ nhớ cache ngay khi người dùng thực thi thành công câu lệnh DDL (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`).

- **Hoàn Thiện Milestone B2 & Roadmap Syntax Check**:
  - **Milestone B2**: Kết nối thông suốt giữa ScriptDOM parser và Semantic Analyzer, phát hiện chính xác lỗi `SQL_INVALID_COLUMN` trên Table Variables (`@Employees`), CTEs (`WITH ... AS`), và Temp Tables (`#TempOrders`).
  - **A1**: Hỗ trợ toàn diện khối xử lý ngoại lệ `EXCEPTION WHEN` trong PostgreSQL PL/pgSQL mà không làm lệch ngăn xếp `BEGIN ... END;`.
  - **A2**: Theo dõi chính xác vòng lặp `FOR ... LOOP` trong PL/pgSQL, phân biệt rõ với mệnh đề khóa `SELECT ... FOR UPDATE`.
  - **A3**: Điều hướng an toàn câu lệnh `CALL procedure(...)` trong PostgreSQL sang phân tích offline nhằm triệt tiêu hoàn toàn tác dụng phụ (zero side-effect).
  - **B1**: Tối ưu hóa hàm trích xuất vị trí `_compute_token_position()` dùng chung, tăng độ chính xác vị trí token.
  - **C2**: Bổ sung bộ theo dõi cấu trúc khối `BEGIN TRY ... END TRY ... BEGIN CATCH ... END CATCH` trong T-SQL.

- **Đạt 100% Kiểm Thử Tự Động (Test Coverage)**:
  - Toàn bộ các bộ test chuyên biệt `test_syntax_sprint3.py`, `test_syntax_phase_a_roadmap.py`, `test_syntax_coordinator.py`, `test_syntax_check.py` và `test_phase8_step3_csp_meta_tags.py` đều đạt tỷ lệ vượt qua 100%.

---

## [v1.0.7] — 21/10/2026

### 🌟 Tính Năng & Nâng Cấp Nổi Bật (Highlights)
- **Khắc phục triệt để lỗi Syntax Validator nhận diện khối `END;` của toàn Function PL/pgSQL**:
  - Sửa lỗi báo sai `Unmatched END: no corresponding BEGIN block` tại khối `END;` kết thúc hàm khi thân hàm chứa các biểu thức nối chuỗi nhiều `CASE WHEN ... || CASE WHEN ...`.
  - Phân tách rạch ròi giữa câu lệnh thủ tục `END CASE;` (phải có dấu chấm phẩy đi kèm) và biểu thức vô hướng `END` (theo sau bởi `AS`, `||`, dấu phẩy, v.v.).
  - Loại bỏ hoàn toàn hiện tượng nuốt nhầm token `CASE` đứng sau toán tử nối chuỗi `||`.
  - Thiết lập ranh giới câu lệnh dấu chấm phẩy (`;`) ngăn các biểu thức trong mệnh đề `SELECT` rò rỉ làm lệch cấu trúc lồng nhau của khối `BEGIN ... END;` trong hàm.
- **Định vị chuẩn xác vị trí thiếu `END` của biểu thức `CASE WHEN` (Pinpoint Unclosed CASE Location)**:
  - Khi biểu thức `CASE WHEN` bị thiếu `END`, bộ kiểm tra cú pháp định vị chuẩn xác ngay tại từ khóa `CASE` bị thiếu (`Unclosed CASE expression: missing corresponding END`).
  - Loại bỏ hoàn toàn hiện tượng báo lỗi lệch hoặc gạch đỏ nhầm vào từ khóa `END` hợp lệ của các biểu thức `CASE` kế tiếp.
- **Bổ sung từ khóa gọi thủ tục `CALL` trong PostgreSQL**:
  - Nhận diện và highlight chuẩn từ khóa `CALL` cho việc gọi Stored Procedure trong PostgreSQL, hỗ trợ đầy đủ các tham số và cú pháp chuẩn.
- **Mở rộng toàn diện bộ từ khóa SQL Server (T-SQL)**:
  - Mệnh đề DML `OUTPUT`, `INSERTED`, `DELETED` phục vụ ghi log và trả dữ liệu trực tiếp từ các lệnh `INSERT`, `UPDATE`, `DELETE`, `MERGE`.
  - Toàn bộ bảng gợi ý khóa Table Hints: `NOLOCK`, `UPDLOCK`, `XLOCK`, `ROWLOCK`, `READPAST`, `PAGLOCK`, `TABLOCK`, `TABLOCKX`, `NOWAIT`, `HOLDLOCK`, `READCOMMITTED`, `READUNCOMMITTED`, `REPEATABLEREAD`, `SERIALIZABLE`.
  - Các từ khóa phân tích & chuyển dòng: `PIVOT`, `UNPIVOT`, `RANGE`, `UNBOUNDED`, `PRECEDING`, `FOLLOWING`, `WITHIN`.
- **Mở rộng các từ khóa DDL/DML nâng cao cho PostgreSQL**:
  - `MATERIALIZED`, `REFRESH`, `ANALYSE`, `COPY`, `LATERAL`, `GENERATED`, `EXCLUDE`, `EXTENSION`, `POLICY`, `PUBLICATION`, `SUBSCRIPTION`, `ROUTINE`, `STORED`, `UNLISTEN`, `UNTIL`, `VALID`, `VARIADIC`, `VERBOSE`, v.v.
- **Bổ sung +96 Hàm Built-in & +27 Kiểu Dữ Liệu Chuyên Dụng**:
  - **Built-in functions**: `GEN_RANDOM_UUID`, `UUID_GENERATE_V4`, `JSONB_SET`, `JSON_BUILD_OBJECT`, `SCOPE_IDENTITY`, `PARSENAME`, `OBJECT_DEFINITION`, `DATEDIFF_BIG`, `DATETIME2FROMPARTS`, `PERCENT_RANK`, `STRING_AGG`, `STRING_SPLIT`, v.v.
  - **Data types**: `INTERVAL`, `INET`, `CIDR`, `MACADDR`, `GEOMETRY`, `GEOGRAPHY`, `ROWVERSION`, `HIERARCHYID`, `POINT`, `POLYGON`, `TSVECTOR`, `TSQUERY`, v.v.
  - Đồng bộ đồng nhất trên toàn bộ hệ thống frontend: `monaco-sql-lang.js`, `sql-dialects.js`, `sql-formatter.js` và `sql-function-signatures.js`.
- **Bộ Kiểm Thử Tự Động Chuyên Biệt**:
  - Bổ sung `tests/test_postgres_case_and_function_end.py` (6/6 tests passed 100%) bao phủ toàn bộ các kịch bản Function PL/pgSQL phức tạp và biểu thức `CASE WHEN` lồng nhau.

---

## [v1.0.6] — 21/10/2026

### 🌟 Tính Năng Mới Nổi Bật (Highlights)
- **Database Users & Roles Explorer**: Quản lý danh sách người dùng và vai trò phân quyền trực quan trên cây Explorer:
  - **SQL Server**: Neo node `Users` (`sqlserver_users_group`) trực tiếp dưới từng Database (Database-level Principals). Phân biệt SQL User, Windows User/Group, User bị vô hiệu hóa.
  - **PostgreSQL**: Neo node `Roles / Users` (`postgres_roles_group`) ở cấp Connection/Cluster. Phân biệt Superuser, Group Role/NoLogin và Login Role.
- **Trình Tra Cứu Phân Quyền Chuyên Biệt (Permissions Viewer Tab)**:
  - Tab chuyên sâu `user-permissions` hiển thị 4 tầng thông tin:
    1. *Overview*: Loại tài khoản, trạng thái đăng nhập, default schema, đặc quyền hệ thống (superuser, replication, bypass RLS).
    2. *Role Membership*: Danh sách các role đang tham gia, kèm bộ lọc tìm kiếm.
    3. *Database Permissions*: Các quyền cấp database (CONNECT, CREATE TABLE, ALTER,...).
    4. *Object Permissions*: Chi tiết quyền hạn trên từng Schema, Bảng, View, Stored Procedure kèm bộ lọc đa chiều (theo tên đối tượng hoặc loại quyền).
  - Tích hợp 2 nút thao tác nhanh `Script CREATE` và `Script DROP` trực tiếp trên header tab.
  - Nhấp đúp chuột (Double-click) vào bất kỳ User/Role nào trên cây để mở ngay tab Permissions Viewer.
- **Phím Tắt Sao Chép Tên Đối Tượng Nhanh (`Ctrl + C`)**:
  - Khi focus hoặc click chọn bất kỳ đối tượng nào trên Object Explorer (Bảng, View, Stored Procedure, Function, Cột, Trigger, Sequence, User, Role,...), nhấn `Ctrl + C` để copy ngay tên đối tượng vào Clipboard của Windows.
  - **Tự động làm sạch tên (Clean Name Extraction)**: Tự động tách bỏ danh sách tham số (ví dụ: `sp_get_users(int)` ➔ `sp_get_users`) hoặc kiểu dữ liệu cột (`col_name (int, not null)` ➔ `col_name`).
  - **Cơ chế lưu Windows Clipboard đa tầng (Zero-loss)**: Kết hợp `execCommand`, Web `navigator.clipboard.writeText`, và cầu nối Python Win32 ctypes API (`set_clipboard_text`) ghi trực tiếp vào Windows OS Clipboard.
  - **Phản hồi trực quan**: Node được copy sẽ phát sáng nhẹ (`tree-item-copied`) kèm Toast Alert thông báo góc phải màn hình.
  - **Bảo vệ ngữ cảnh**: Không can thiệp `Ctrl + C` khi người dùng đang soạn thảo trong Monaco Editor, nhập chữ trong ô tìm kiếm hoặc chọn ô trong Result Grid.
- **Bộ Sinh Mã DDL An Toàn (Safe DDL Generation)**:
  - Tự động sinh mã `CREATE USER` / `CREATE ROLE` đầy đủ thuộc tính, role membership và các lệnh cấp quyền (`GRANT`).
  - Tự động sinh mã `DROP USER` / `DROP ROLE` kèm cảnh báo chuyển giao quyền sở hữu (`REASSIGN OWNED BY` / `DROP OWNED BY`).
  - **An toàn tuyệt đối**: Toàn bộ script chỉ mở trên tab Monaco Editor mới để người dùng review — **tuyệt đối không tự động thực thi ngầm**, không để lộ mật khẩu/hash, chuẩn hóa quote identifier (`[user]` cho MSSQL và `"role"` cho PG).

### 🛠️ Nâng Cấp & Cải Tiến
- **Table Designer Service**:
  - Cải tiến tính năng Rename Table an toàn: sinh mã DDL tương thích từng DBMS (`sp_rename` trên MSSQL và `ALTER TABLE RENAME TO` trên PG).
  - Tối ưu hóa xử lý giá trị mặc định (Default Values), xử lý đổi kiểu dữ liệu cột và ràng buộc Nullable.
  - Thêm bài kiểm thử tự động `tests/test_table_rename_and_default_improvements.py`.
- **Table Data Editor Service**:
  - Cải thiện sao chép / dán nhiều ô và hàng loạt dữ liệu (Batch Paste) từ Excel / Sheets mượt mà.
  - Tối ưu phân trang và hiệu năng kết xuất dữ liệu.
  - Thêm bài kiểm thử tự động `tests/test_table_data_editor.py`.
- **Syntax Validator & Signature Help (Foundation)**:
  - Thêm module `app/database/syntax/proc_body_detector.py` nhận diện chính xác phần thân Stored Procedure / Function để kiểm tra cú pháp độc lập, không báo lỗi giả.
  - Cải tiến kiểm tra cú pháp khối batch lệnh chứa `GO` và khối mã lệnh ẩn danh PostgreSQL (`DO $$ ... $$`).
  - Nâng cấp `signature-help-resolver.js` hiển thị gợi ý chữ ký tham số nhanh và chính xác hơn khi người dùng gõ mở ngoặc `(`.
- **Auto-updater**:
  - Tự động giải nén gói ZIP cập nhật trực tiếp vào thư mục ứng dụng sau khi tải xong.
- **Sửa Lỗi Bản Build Đóng Gói**:
  - Khắc phục sự cố trigger menu Google Sheets.
  - Sửa lỗi đường viền màu accent của tab kết quả (Result/Messages/Plan) chạy liền mạch đè lên chân các tab lân cận trong bản build PyInstaller.

### 🧪 Kiểm Thử Tự Động
- `tests/test_database_users.py`: 13/13 tests PASSED (100%).
- `tests/test_explorer_copy_object_name.py`: 5/5 tests PASSED (100%).
- `tests/test_clipboard_and_grid_copy.py`: 11/11 tests PASSED (100%).
- `tests/test_version_and_updates.py`: 9/9 tests PASSED (100%).
- `tests/test_api_surface_snapshot.py`: PASSED (100%).

---

## [v1.0.5] — 20/10/2026

### 🌟 Tính Năng Mới
- **Google Sheets Manager & Inline Editor**:
  - Quản lý và chỉnh sửa trực tiếp bảng tính Google Sheets trong IDE với điều hướng tab mượt mà.
- **Công Cụ So Sánh Bravo Layout XML**:
  - Phân tích và so sánh trực quan cấu trúc giao diện Form/Layout XML giữa các môi trường/phiên bản.
- **So Sánh Schema Dạng Tab**:
  - Hỗ trợ mở tính năng So sánh Schema trực tiếp dưới dạng Tab trong cửa sổ chính từ Context Menu của Object Explorer.

### 🛠️ Sửa Lỗi & Tinh Chỉnh
- Sửa lỗi dropdown tỷ lệ % zoom tại thanh trạng thái SQL Editor bị ẩn dưới Result Grid, đảm bảo menu luôn nổi lên trên (`z-index: 99999`).
- Tinh chỉnh đường viền bo chân (`border-bottom`) màu accent của tab kết quả (Result/Messages/Plan) chạy liền mạch.
- Khôi phục hoàn chỉnh bộ quản lý Tab: sửa lỗi hàm `createTab`, mở lại tạo tab mới (`+`), phím tắt, New Query và Search Object.

---

## [v1.0.4] — 19/10/2026

### 🌟 Tính Năng Mới
- **Trình Cập Nhật Tự Động (In-App Auto-Updater)**:
  - Tích hợp kiểm tra phiên bản từ xa qua GitHub Releases hoặc URL tùy chỉnh.
  - Hỗ trợ tải trực tiếp bản cập nhật trong ứng dụng với thanh tiến trình hoạt họa màu xanh lá.
  - Tự động áp dụng bản cập nhật khi tải xong và ẩn thông báo cập nhật trên thanh công cụ.
  - Nâng cấp giao diện hộp thoại About & Cập nhật chương trình, tự động căn giữa cửa sổ và loại bỏ viền thừa.

---

## [v1.0.3] — 18/10/2026

### 🌟 Tính Năng Mới
- **Cải Tiến PostgreSQL PL/pgSQL & SQL Server Cú Pháp**:
  - Bổ sung tokenizer cho PL/pgSQL và các hàm bắt lỗi T-SQL (`ERROR_MESSAGE()`, `ERROR_NUMBER()`, `THROW`) trong Monarch tokenizer của Monaco.
  - Tối ưu hóa thứ hạng gợi ý IntelliSense trong khối `CATCH` cho các hàm xử lý lỗi T-SQL.
  - Đồng bộ từ khóa dialect PostgreSQL và kiểm tra cân bằng khối lệnh `BEGIN ... END` trong PL/pgSQL.

---

## [v1.0.0 - v1.0.2] — Baseline Releases

- Nền tảng Desktop Client quản lý cơ sở dữ liệu Microsoft SQL Server & PostgreSQL trên pywebview.
- Tích hợp trình soạn thảo Monaco Editor với cú pháp SQL chuyên sâu, IntelliSense, Format SQL.
- Kết xuất kết quả truy vấn hiệu năng cao với AG Grid (hỗ trợ lọc đa cột, đóng băng cột, xuất Excel/CSV).
- Trình thiết kế bảng (Table Designer) và chỉnh sửa dữ liệu trực tiếp (Table Data Editor).
- Tìm kiếm nội dung đối tượng SQL (Object Content Search).
- Quản lý lịch sử truy vấn, yêu thích, gắn thẻ và lưu trữ mã hóa mật khẩu an toàn.
