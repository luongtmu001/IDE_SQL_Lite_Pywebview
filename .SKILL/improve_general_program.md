# Đề xuất nâng cấp và tính năng mới – IDE-SQL-Lite\_New\_Pyweb_Claude

Dựa trên bản review chỉ-đọc ngày 12/10/2026. Frontend, module Bravo và một số service chưa được đọc kỹ, nên có thể vài mục dưới đây đã có sẵn trong project.

## Thứ tự khuyến nghị

Làm xong **Phase 2, 3 và 6** trong kế hoạch chỉnh sửa rồi mới thêm tính năng. Hiện logic nằm trong một `main.py` khoảng 4.300 dòng; thêm tính năng lúc này sẽ làm file đó phình ra và khó sửa hơn.

## 1. Nâng cấp không phải tính năng mới

- **Ký số `LLTool.exe`** (code signing) để tránh cảnh báo SmartScreen/antivirus khi chia sẻ bản build.
- **Cơ chế cập nhật**: kiểm tra phiên bản mới và thông báo trong app. Hiện bản phát hành là thư mục `dist/` sao chép thủ công.
- **Log ra file** (xoay vòng) kèm nút «Mở thư mục log» trong app, để bắt các lỗi hiện đang bị `except: pass` nuốt.
- **Chế độ portable** (cờ đặt cạnh file exe), tiện khi dùng trên nhiều máy.
- **Tách chuỗi giao diện ra file i18n** nếu sau này có người dùng khác ngoài chủ project.

## 2. Tính năng đáng thêm

Sắp theo giá trị trên công sức, dựa trên kiến trúc hiện có.

1. **An toàn môi trường**: gắn nhãn kết nối (Dev/Test/Prod) với thanh màu đỏ cho Prod, chế độ **chỉ đọc** theo từng kết nối, xác nhận trước khi chạy DML/DDL trên Prod. Thêm nút **transaction tường minh** (Begin/Commit/Rollback) để thử rồi hoàn tác. Hợp với phần SQL Protection đang có và tốn rất ít công.
2. **Script nhiều câu lệnh với kết quả riêng cho từng câu**, kèm **biến/tham số** trong script (kiểu `:ten_bien` hoặc `$ten_bien`, có hộp nhập giá trị khi chạy).
3. **So sánh schema giữa hai database** và sinh script migration. Có thể tận dụng logic `generate_diff` của Table Designer, nên làm sau khi sửa xong Phase 4.
4. **Thêm adapter SQLite và MySQL/MariaDB.** `app/database/factory.py` đã theo mô hình adapter nên thêm loại mới không phải làm lại từ đầu. SQLite còn hợp với tên project và rất tiện để test không cần server.
5. **Trình xem phiên đang chạy và khóa chặn** (`pg_stat_activity`, `sys.dm_exec_requests`) kèm nút kill, bổ sung cho profiler hiện có.
6. **«Script as»** từ Object Explorer (CREATE/INSERT/DROP cho object đã chọn) và **so sánh hai kết quả truy vấn**.
7. **Lưu và khôi phục phiên làm việc** (các tab đang mở, vị trí con trỏ); yêu thích/gắn thẻ cho lịch sử truy vấn nếu chưa có.
8. **Trợ lý AI tùy chọn** (giải thích câu SQL hoặc query plan, gợi ý index, sinh SQL từ schema). Nếu làm, nên mặc định tắt và chỉ gửi schema chứ không gửi dữ liệu, vì dữ liệu DB có thể nhạy cảm.

## 3. Một điểm kiến trúc nên cân nhắc

Module **Bravo** có vẻ dành riêng cho hệ thống nội bộ, trong khi lõi là một SQL IDE dùng chung. Về lâu dài nên tách Bravo thành module tùy chọn (hoặc plugin) để lõi gọn hơn và dễ chia sẻ công khai nếu muốn.

## 4. Gợi ý bước tiếp theo

- Đọc mục 7 (thứ tự triển khai) và mục 8 (các điểm cần quyết định) trước khi bắt đầu tính năng đầu tiên.
- Chọn 1–2 tính năng giá trị cao, công sức thấp (mục 5.1 và 5.2) để làm ngay sau Phase 6.

## 5. Kế hoạch chi tiết cho từng tính năng

Quy ước chung cho mọi tính năng dưới đây (cùng nguyên tắc với tài liệu kế hoạch chỉnh sửa: thêm vào, không đập đi làm lại):

- Mỗi tính năng một nhánh `feature-<tên>`, mỗi bước một commit kèm test.
- Tính năng mới nằm sau **cờ trong settings** (`features.<tên>`), mặc định tắt cho tới khi ổn định.
- Chỉ thêm hoặc mở rộng: **không đổi tên method công khai**, không đổi định dạng file dữ liệu hiện có (chỉ thêm trường tùy chọn; thiếu trường = hành vi cũ).
- Thao tác trên kết nối dùng chung phải giữ `conn.lock` (Phase 5). Chuỗi SQL sinh ra dùng `sql_utils` (Phase 4).
- Cuối mỗi tính năng, agent báo cáo: file đã sửa, test đã thêm, rủi ro còn lại, quyết định đang chờ. Gặp mục **\[QUYẾT ĐỊNH\]** thì dừng và hỏi.

### 5.1 An toàn môi trường: nhãn Dev/Test/Prod, chỉ đọc, transaction tường minh

**Mục tiêu**: giảm rủi ro chạy nhầm lệnh ghi trên môi trường thật. **Phụ thuộc**: Phase 3 (lỗi `USE`), Phase 5 (khóa kết nối). **Ước lượng**: 3–4 ngày.

**Các bước**

1. **Dữ liệu**: thêm hai trường tùy chọn vào profile kết nối trong `connections.json`: `environment` (`dev` / `test` / `prod`, thiếu = không nhãn) và `read_only` (thiếu = false). Sửa các hàm lưu/đọc profile (`save_connection_profile` và nơi tạo `ConnectionSession`) để mang hai trường này; modal kết nối thêm ô chọn.
2. **Hiển thị**: thanh màu trên tab và status bar theo `environment` (Prod màu đỏ, nổi bật). Chỉ là CSS và vài dòng JS ở nơi vẽ tab kết nối.
3. **Chặn ở phía Python** trong đường chạy truy vấn (`execute_query`), không chỉ ở JS: phân loại câu lệnh bằng `sqlglot` (đã có trong dependencies), có fallback theo từ khóa cho T-SQL. Nếu `read_only` và câu lệnh không phải SELECT/EXPLAIN → từ chối với mã lỗi rõ ràng. Áp dụng tương tự cho `submit_table_changes`, `apply_table_design`, các API ghi dữ liệu khác.
4. **Lớp bảo vệ thứ hai**: PostgreSQL đặt `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` khi mở session chỉ đọc. SQL Server không có tương đương, nên ghi rõ trong UI rằng chỉ đọc là kiểm tra ở ứng dụng, khuyến nghị dùng login chỉ đọc.
5. **Xác nhận trên Prod**: thêm tham số tùy chọn `confirmed=False` cho `execute_query`; nếu `environment=prod` và câu lệnh là DML/DDL mà chưa `confirmed` → Python trả mã «cần xác nhận», JS mở hộp thoại (tận dụng `sql-protection.js`) rồi gọi lại với `confirmed=True`. Nhờ vậy đường gọi khác không bỏ qua được.
6. **Transaction tường minh**: thêm trạng thái `in_transaction` vào `ConnectionSession`; ba API `tx_begin`, `tx_commit`, `tx_rollback` (đặt `autocommit` tắt/bật, luôn trong `conn.lock`). UI có nhãn «TX đang mở», cảnh báo khi đóng tab, ngắt kết nối hoặc đóng app mà transaction còn mở. Cài tự rollback sau N phút không hoạt động (setting) để không giữ khóa trên server.
7. **Va chạm với editor**: `submit_changes` hiện tự bật/tắt `autocommit`. Khi transaction tường minh đang mở thì **\[QUYẾT ĐỊNH\]** từ chối thao tác hay chạy trong transaction hiện có (khuyến nghị: chạy trong transaction hiện có, không commit).

**Kiểm chứng**: test phân loại câu lệnh (CTE có DML, `SELECT INTO`, `EXEC` proc); test chế độ chỉ đọc chặn đúng; test bắt buộc xác nhận trên Prod; test begin/rollback trên PostgreSQL thật (Docker); test tự rollback khi idle. **Rủi ro**: phân loại bằng từ khóa có thể sót (ví dụ `EXEC` proc có ghi dữ liệu); vì vậy phải ghi rõ giới hạn và không quảng bá là bảo đảm tuyệt đối.

### 5.2 Script nhiều câu lệnh với kết quả riêng và tham số

**Mục tiêu**: chạy một script có nhiều câu lệnh, xem kết quả/lỗi/thời gian từng câu; dùng biến nhập lúc chạy. **Phụ thuộc**: Phase 4 (`sql_utils`), Phase 7 mục 5 (tách chuỗi đúng với dollar-quote). **Ước lượng**: 3–4 ngày.

**Các bước**

1. **Xác minh hiện trạng** (agent đọc trước khi sửa): `execute` hiện tách `GO` và trả kết quả thế nào, UI hiển thị nhiều result set ra sao. Ghi lại vào báo cáo; chỉ bổ sung phần còn thiếu.
2. **Kết quả theo câu lệnh**: backend trả thêm danh sách `statements: [{sql, start_line, rows, columns, rows_affected, duration_ms, error}]` (giữ nguyên các trường cũ để không phá JS hiện tại). Tách câu lệnh bằng hàm dùng chung đã sửa ở Phase 7 (xử lý chuỗi, comment, dollar-quote), không viết bộ tách mới.
3. **UI**: các tab kết quả con cho mỗi câu lệnh (tiêu đề dạng `#2 – 120 dòng – 35 ms` hoặc biểu tượng lỗi). Tùy chọn **dừng khi lỗi** hoặc **tiếp tục** (setting, mặc định dừng).
4. **Cú pháp tham số**: dùng `{{ten}}`. Không dùng `:ten` vì xung đột với `::` và `:=` của PostgreSQL, không dùng `@ten` vì là biến thật của T-SQL. **\[QUYẾT ĐỊNH\]** xác nhận cú pháp này.
5. **Khai báo kiểu** bằng comment đầu script, ví dụ `-- @param ten: string = mặc định`; kiểu gồm `string`, `number`, `identifier`, `date`. Thay thế **sau** khi tách câu lệnh và bỏ qua `{{...}}` nằm trong chuỗi hoặc comment.
6. **Chống chèn SQL**: `string` → `escape_literal`, `number` → kiểm tra là số, `identifier` → `quote_ident`, `date` → định dạng chuẩn rồi escape. Không bao giờ nối giá trị thô.
7. **Hộp nhập tham số** trước khi chạy, nhớ giá trị gần nhất theo từng tab. Lịch sử lưu **bản gốc** cùng bộ tham số, không lưu bản đã thay.

**Kiểm chứng**: test trích tham số, escape từng kiểu (kể cả giá trị chứa dấu nháy), tách câu lệnh với chuỗi/dollar-quote, và tham số trong comment. **Rủi ro**: người dùng cố ý cần nhúng đoạn SQL qua tham số; chỉ cho phép khi khai báo kiểu rõ ràng (không có kiểu «raw»).

### 5.3 So sánh schema giữa hai database [ĐÃ HOÀN THÀNH - CÁCH 3 HYBRID]

**Mục tiêu**: chọn nguồn A và đích B, xem khác biệt, sinh script migration có chọn từng mục. **Phụ thuộc**: **bắt buộc xong Phase 4** (`generate_diff` đúng) và Phase 6. **Ước lượng**: 5–7 ngày. **Trạng thái**: ✅ **Đã hoàn thành 100% (Kiến trúc Hybrid Tab trong IDE + Pop-out Window riêng biệt, 100% theme sync, strictly zero inline CSS)**.

**Các bước đã thực hiện**:

1. **Service mới** `app/services/schema_compare_service.py`:
   - `snapshot(adapter, database, schema)`: trích xuất metadata schema của toàn bộ bảng qua `adapter.get_table_design_metadata`, đảm bảo cùng chuẩn dữ liệu với Table Designer.
   - `_normalize_constraints_for_diff`: **Chuẩn hóa ràng buộc theo định nghĩa** (cột PK, biểu thức Default, cột Unique, mệnh đề Check, quan hệ FK, cột/chiều Index) để chống hiện tượng false positive DROP/ADD do RDBMS tự sinh tên ngẫu nhiên (e.g. `PK__users__123` vs `PK__users__456`).
   - `diff(source_snap, target_snap)`: phân loại bảng thành (a) Chỉ có ở Nguồn (`missing_in_target` -> tạo mới), (b) Chỉ có ở Đích (`extra_in_target` -> xóa/phá hủy), (c) Khác biệt cấu trúc (`different` -> phân tích cột thêm/xóa/sửa), (d) Trùng khớp (`identical`).
   - `generate_migration_script(diff_result, selected_tables, options)`: sinh script DDL hoàn chỉnh, có header, bọc transaction (`BEGIN / COMMIT`), cho phép chọn từng bảng, kiểm soát an toàn cờ `include_drop_tables`.
2. **Lớp API & Desktop Bridge**:
   - `app/api/schema_compare_api.py` (`SchemaCompareApiMixin`): cung cấp `schema_compare_get_connections`, `schema_compare_get_schemas`, `schema_compare_run`, `schema_compare_generate_script`, `open_schema_compare_window`.
   - `app/desktop/windows.py`: bổ sung `SchemaCompareSubwindowApi` và hàm `open_schema_compare_window` hỗ trợ pop-out window pywebview đồng bộ DWM titlebar.
3. **Giao diện người dùng (Cách 3 - Hybrid: In-Tab + Pop-out)**:
   - Giao diện dạng Tab tích hợp bên trong IDE (`openSchemaCompareTab`, phím tắt `Ctrl+Alt+C`, menu View, context menu connection/database/schema trong Explorer).
   - Nút "Pop-out" bung ra cửa sổ độc lập (`templates/schema_compare_window.html`).
   - Bộ chọn kết nối Nguồn (Source) vs Đích (Target), thanh KPI thống kê động (Tổng bảng, Khác biệt, Tạo mới, Xóa bảng, Trùng khớp), bộ lọc theo trạng thái, tìm kiếm nhanh theo tên bảng.
   - Bảng phân chia 2 panel: Bên trái là danh sách bảng kèm checkbox và sub-row mở rộng chi tiết cột; bên phải là preview script DDL có nút sao chép và "Mở trong Editor SQL".
4. **Đồng bộ Theme & Tuân thủ Zero Inline CSS**:
   - 100% đồng bộ theme IDE qua CSS variables `--ide-...`.
   - Toàn bộ stylesheet đặt trong `static/css/schema-compare.css`, **tuyệt đối không sử dụng CSS inline**.
5. **Kiểm thử tự động**:
   - `tests/test_schema_compare.py`: 9 bài kiểm thử toàn diện gồm snapshot, diff bảng trùng khớp, diff bảng thiếu/thừa, diff cột thay đổi kiểu/null, chuẩn hóa ràng buộc ngẫu nhiên, sinh script transaction, kiểm thử tích hợp end-to-end trên file SQLite thật (chạy script di trú thành công), kiểm thử tĩnh zero inline CSS (100% PASS).

### 5.4 Thêm adapter SQLite và MySQL/MariaDB [ĐÃ HOÀN THÀNH PHẦN SQLITE]

**Mục tiêu**: mở rộng loại cơ sở dữ liệu mà không đụng tới hai adapter hiện có. **Phụ thuộc**: Phase 4 (quote cho `sqlite`/`mysql`), Phase 6. **Ước lượng**: SQLite 4–5 ngày, MySQL 5–7 ngày (làm SQLite trước, xong rồi mới MySQL). **Trạng thái**: ✅ **Đã hoàn thành 100% phần SQLite Adapter & Adapter Contract Tests; sẵn sàng mở rộng MySQL/MariaDB**.

**Kết quả triển khai phần SQLite:**
- **Bộ kiểm thử hợp đồng adapter**: `tests/adapter_contract/test_adapter_contract.py` kiểm định lifecycle, parameterized queries, multi-statement batch, limits, transaction rollback, read-only mode, metadata schemas/tables/views/triggers/designer (100% PASS).
- **SQLite Database Adapter**: `app/database/sqlite.py` kế thừa `DatabaseAdapter`, hỗ trợ file `.db`/`.sqlite`/`:memory:`, bảo vệ an toàn `read_only` (URI mode=ro & `PRAGMA query_only = ON`), hủy truy vấn qua `self.connection.interrupt()`, trích xuất metadata PRAGMA & `sqlite_master`.
- **Lõi & Dịch vụ liên quan**:
  - `app/database/factory.py`: Đăng ký `sqlite` và `sqlite3`.
  - `app/database/sql_utils.py`: Hỗ trợ chuẩn quote identifier/qualified và literal SQLite.
  - `app/utils/sql_splitter.py`: Xử lý khối `CREATE TRIGGER ... BEGIN ... END;` không bị cắt vụn câu lệnh.
  - `app/utils/sql_safety.py`: Dialect mapping SQLite cho sqlglot.
  - `app/services/table_data_editor_service.py`: Tự động sử dụng `rowid` làm khóa chính khi bảng SQLite không khai báo PK; sinh `LIMIT` thay cho `TOP`.
  - `app/api/connections_api.py`: Thêm `select_sqlite_file()` mở hộp thoại native pywebview chọn file `.db`.
  - `run.spec`: Bổ sung `app.database.sqlite` vào `hiddenimports`.
- **Giao diện người dùng**:
  - Form thêm kết nối: chọn loại SQLite tự động hiển thị ô chọn file và nút browse, ẩn các trường máy chủ/cổng/tài khoản/mật khẩu không cần thiết.
  - Hoàn toàn tuân thủ **Zero Inline CSS** và đồng bộ CSS variables `--ide-...`.
- **Kiểm thử tích hợp**: `tests/test_sqlite_integration.py` kiểm thử end-to-end kết nối, query service, metadata, rowid editing, cancel interrupt, read-only mode, template scanning zero inline css (100% PASS).

**Các bước tiếp theo cho MySQL/MariaDB:**
1. Cài đặt thư viện `PyMySQL` (thuần Python, dễ đóng gói với PyInstaller không cần C-runtime DLLs).
2. Viết `app/database/mysql.py` triển khai `DatabaseAdapter` và chạy kiểm thử hợp đồng `tests/adapter_contract/test_adapter_contract.py`.
3. Cập nhật `ConnectionManager`, modal UI và dialect parser.

### 5.5 Trình xem phiên đang chạy và khóa chặn [ĐÃ HOÀN THÀNH - CÁCH 3 HYBRID]

**Mục tiêu**: xem session đang chạy, câu SQL, thời gian, đang chờ gì, ai đang chặn ai; hủy hoặc kill khi cần. **Phụ thuộc**: Phase 5 (kết nối phụ, vòng đời), Phase 6. **Ước lượng**: 3–4 ngày. **Trạng thái**: ✅ **Đã hoàn thành 100% (Kiến trúc Hybrid Tab trong IDE + Pop-out Window riêng biệt, 100% theme sync, strictly zero inline CSS)**.

**Các bước đã thực hiện**:

1. **Service mới** `app/services/activity_service.py`:
   - SQL Server DMVs: `sys.dm_exec_sessions`, `sys.dm_exec_requests`, `sys.dm_exec_connections`, `sys.dm_exec_sql_text`.
   - PostgreSQL: `pg_stat_activity` kết hợp `pg_catalog.pg_blocking_pids(pid)`.
   - Thuật toán **Head Blocker Detection**: phát hiện chính xác gốc gây khóa chặn không bị ai chặn để cảnh báo nổi bật.
2. **Kết nối riêng biệt (Out-of-band Dedicated Monitor Adapter)**:
   - Tự động tạo và tái sử dụng adapter giám sát độc lập, không dùng connection chính của người dùng nhằm tránh bị nghẽn (hang) khi đang có transaction hoặc câu lệnh dài khóa độc quyền.
3. **Hành động an toàn (Safe Cancel & Kill)**:
   - Cancel query (`pg_cancel_backend`, `KILL`) và Kill session (`pg_terminate_backend`, `KILL`).
   - Tự động phát hiện SPID của chính phiên làm việc IDE (`get_current_session_id`) và **chặn tuyệt đối việc tự kill chính mình**.
   - Chặn thao tác huỷ/ngắt kết nối trên kết nối ở chế độ chỉ đọc (`read_only`).
   - Hộp thoại xác nhận an toàn trước khi thực thi lệnh Kill/Cancel.
4. **Giao diện người dùng (Cách 3 - Hybrid: In-Tab + Pop-out)**:
   - Mặc định mở dạng Tab tích hợp bên trong IDE (`openActivityMonitorTab`, phím tắt `Ctrl+Alt+A`, menu View, context menu connection trong Explorer).
   - Nút "Pop-out" trên toolbar cho phép bung ra cửa sổ độc lập pywebview (`templates/activity_monitor_window.html`).
   - Tự động làm mới theo chu kỳ (Off, 2s, 3s, 5s, 10s), bộ lọc theo trạng thái, tìm kiếm nhanh theo SPID/Database/User/Host/SQL, KPI summary bar tương tác.
   - Bảng hiển thị thông tin chi tiết phiên + Panel soi SQL chi tiết có nút sao chép.
5. **Đồng bộ Theme & Tuân thủ Zero Inline CSS**:
   - 100% đồng bộ theme với IDE qua CSS variables và DWM titlebar syncing.
   - Toàn bộ stylesheet đặt trong `static/css/activity-monitor.css`, **tuyệt đối không sử dụng CSS inline**.
6. **Kiểm thử tự động**:
   - Suite `tests/test_activity_monitor.py` kiểm tra logic phát hiện head blocker, ngăn chặn self-kill, bảo vệ read-only, subwindow bridge và kiểm tra tĩnh không có css inline (100% pass).

### 5.6 «Script as» từ Object Explorer và so sánh hai kết quả

**Mục tiêu**: sinh nhanh CREATE/SELECT/INSERT/UPDATE/DELETE/DROP cho object đã chọn; so sánh hai tập kết quả truy vấn. **Phụ thuộc**: Phase 4 (quote), Phase 8 (escape HTML khi hiển thị ô). **Ước lượng**: Script as 2–3 ngày; so sánh kết quả 2–3 ngày.

**Script as**

1. **Kiểm tra hiện trạng** trong `explorer.js` và metadata service: có thể một phần đã có (grep «script», «generate»). Chỉ bổ sung phần còn thiếu.
2. Thêm API `script_object(connection, database, schema, name, type, action)` ở lớp metadata. Bảng: tái dụng `generate_create_table_ddl`. View/function/procedure: SQL Server dùng `sys.sql_modules` hoặc `OBJECT_DEFINITION`, PostgreSQL dùng `pg_get_viewdef` và `pg_get_functiondef`. SELECT/INSERT/UPDATE/DELETE: sinh từ danh sách cột, quote bằng `sql_utils`. DROP có `IF EXISTS`.
3. Menu chuột phải trong cây thêm mục «Script as», kết quả mở trong tab mới hoặc chép vào clipboard. **Không tự chạy.**

**So sánh hai kết quả**

1. Chọn hai kết quả (hai tab hoặc hai lần chạy trong lịch sử) và chọn cột khóa (mặc định là PK nếu có).
2. Xử lý phía client bằng AG Grid, không cần đụng backend: tạo map theo khóa, phân loại «chỉ ở A», «chỉ ở B», «khác giá trị» và tô màu ô khác. Chuẩn hóa kiểu trước khi so (số, ngày, khoảng trắng đầu/cuối).
3. Giới hạn khoảng 100.000 dòng mỗi bên; vượt thì cảnh báo và đề nghị giới hạn bằng truy vấn.

**Kiểm chứng**: test sinh script cho từng loại object và từng engine (bảng có tên chữ hoa/thường lẫn lộn, tên có khoảng trắng); test so sánh với dữ liệu có khóa trùng, thiếu khóa, giá trị NULL. **Rủi ro**: hiển thị giá trị lấy từ DB phải qua `escapeHtml` (Phase 8), nếu không dễ thành lỗ XSS.

### 5.7 Lưu và khôi phục phiên làm việc, yêu thích/gắn thẻ lịch sử

**Mục tiêu**: mở lại app là có nguyên các tab đang làm; tìm lại câu truy vấn quan trọng trong lịch sử. **Phụ thuộc**: Phase 2 (đường dẫn dữ liệu), Phase 6. **Ước lượng**: 3 ngày.

**Phiên làm việc**

1. Xác định module quản lý tab trong JS (grep nơi tạo/đóng tab editor); thêm hàm `serializeSession()` và `restoreSession()` mà không đổi cách tab hoạt động hiện tại.
2. Lưu mỗi tab: tên, nội dung, `connection_id`, database, vị trí con trỏ và cuộn, trạng thái chưa lưu file. Lưu định kỳ (debounce 3–5 giây) và khi đóng, để chịu được crash.
3. Backend: hai API `session_save` / `session_load` (đọc/ghi một file `session.json` trong thư mục dữ liệu người dùng, dùng `settings_store` sau Phase 6). **Không lưu mật khẩu**; chỉ lưu id profile kết nối. Khi profile không còn, tab khôi phục ở trạng thái ngắt kết nối.
4. Nội dung SQL có thể nhạy cảm, nên có công tắc bật/tắt trong settings và giới hạn kích thước mỗi tab (ví dụ 1 MB).

**Yêu thích và gắn thẻ lịch sử**

1. Đọc kỹ `app/services/history/storage.py` (chưa review kỹ lần trước) trước khi sửa.
2. Thêm migration có phiên bản bằng `PRAGMA user_version`: cột `is_favorite`, bảng `tags` và `history_tags`. Migration chỉ thêm, không xóa; chạy trên bản sao `history.db` cũ để kiểm tra giữ nguyên dữ liệu.
3. API `history_set_favorite`, `history_add_tag`, `history_remove_tag`; UI cửa sổ lịch sử thêm ngôi sao, ô thẻ và bộ lọc.
4. Chính sách giữ lịch sử (retention): xóa mục cũ hơn N ngày **trừ mục yêu thích**; tùy chọn che giá trị literal khi lưu.

**Kiểm chứng**: test migration từ `history.db` cũ; test vòng lưu–khôi phục phiên; test lọc theo thẻ và yêu thích. **Rủi ro**: mất nội dung tab nếu ghi file bị gián đoạn; ghi ra file tạm rồi đổi tên (atomic) để tránh hỏng.

### 5.8 Trợ lý AI tùy chọn

**Mục tiêu**: giải thích SQL và query plan, gợi ý sửa lỗi, sinh SQL từ mô tả, mà không làm lộ dữ liệu. **Phụ thuộc**: Phase 2 (nơi lưu khóa API), Phase 5/6, tính năng 5.1 (biết kết nối chỉ đọc). **Ước lượng**: 4–6 ngày.

**Nguyên tắc an toàn (bắt buộc)**

- Mặc định **tắt**, bật theo **từng kết nối** (`allow_ai`).
- **Không bao giờ gửi dòng dữ liệu hay kết quả truy vấn.** Chỉ gửi: câu SQL, query plan, và schema tối thiểu liên quan (tên bảng/cột/kiểu).
- Literal trong câu SQL được thay bằng `?` theo mặc định (tùy chọn tắt).
- Trước khi gửi có màn hình xem trước «sẽ gửi gì»; ghi log những gì đã gửi. Không gửi mật khẩu hay chuỗi kết nối.
- **SQL do AI sinh chỉ đưa vào editor, không bao giờ tự chạy.**

**Các bước**

1. `app/services/ai_service.py` với giao diện nhà cung cấp (Anthropic API, endpoint tương thích OpenAI, hoặc Ollama chạy cục bộ). Gọi từ Python, không gọi từ JS, để khóa API không lộ ra frontend; khóa lưu bằng `crypto.py` đã sửa ở Phase 2. Có timeout và nút hủy.
2. Hàm tạo ngữ cảnh: lấy schema liên quan (chỉ các bảng xuất hiện trong câu SQL, giới hạn số cột), che literal, ghép prompt. **Nội dung comment trong schema/SQL không được coi là chỉ thị** (chống prompt injection): đặt trong khối dữ liệu riêng, nói rõ cho mô hình.
3. Triển khai theo thứ tự giá trị: (a) Explain SQL và Explain plan (dùng đầu ra của `query_plan_service`); (b) gợi ý sửa lỗi từ thông báo lỗi; (c) sinh SQL từ mô tả với schema đã chọn; (d) gợi ý index dựa trên plan (chỉ gợi ý).
4. UI: nút «Explain» và ô hỏi trong panel; trang settings chọn nhà cung cấp, nhập khóa, công tắc che literal, danh sách kết nối được phép.

**Kiểm chứng**: test che literal (chuỗi, số, ngày, trong comment); test chỉ gửi đúng trường cho phép (nhà cung cấp giả ghi lại payload); test khi `allow_ai=false` thì không có request ra ngoài. **Rủi ro**: schema tự nó đã có thể nhạy cảm; **\[QUYẾT ĐỊNH\]** nhà cung cấp mặc định, ngân sách, và chấp nhận gửi tên bảng/cột ra ngoài hay chỉ dùng mô hình cục bộ.

## 6. Kế hoạch cho các mục nâng cấp (không phải tính năng)

### 6.1 Ký số `LLTool.exe` (0,5–1 ngày, có chi phí chứng chỉ)

1. **\[QUYẾT ĐỊNH\]** loại chứng chỉ (OV/EV hoặc Azure Trusted Signing).
2. Thêm bước `signtool` (kèm timestamp) vào script build sau `pyinstaller run.spec`; chứng chỉ và mật khẩu lấy từ biến môi trường hoặc kho khóa của máy build, **không lưu trong repo**.
3. Kiểm tra bằng `signtool verify /pa` trên file exe cuối cùng và thử mở trên máy sạch.

### 6.2 Cơ chế cập nhật (2–3 ngày) — ✅ Đã hoàn thành

1. **Nguồn phiên bản tập trung (`app/version.py`)**:
   - Định nghĩa `__version__ = "1.0.0"`, `__app_name__`, `__version_url__`, `__release_url__`, hàm chuẩn hóa và so sánh `parse_semver`, `compare_versions`.
   - `run.spec` tự động nạp phiên bản từ `app/version.py` và nhúng `version.json` vào bundle phân phối.
2. **Dịch vụ kiểm tra cập nhật (`app/services/update_checker.py`)**:
   - Khi khởi động, thread nền tự động kiểm tra `version.json` (tắt được trong cài đặt qua `updates.checkOnStartup`, hỗ trợ URL tùy chỉnh cho nội bộ doanh nghiệp).
   - So sánh semver chính xác, tuyệt đối không làm chậm quá trình mở app (hoạt động ngầm sau 3.5s delay).
   - Trả về thông tin phiên bản mới, highlights tính năng và liên kết tải về GitHub Releases.
3. **Giao diện người dùng & Menu**:
   - Cửa sổ Settings bổ sung mục **"Thông tin & Cập nhật" (About & Software Updates)**: hiển thị chi tiết phiên bản, chế độ Portable/Standard, runtime Python, nút kiểm tra cập nhật thủ công và nút mở thư mục dữ liệu người dùng.
   - Menu chính `Help`: bổ sung mục **"Kiểm tra Cập nhật..."** và **"Thông tin (About)..."**.
   - Thanh công cụ (Toolbar): tự động hiển thị nút/badge thông báo nhẹ nhàng khi phát hiện bản mới (`#ide-update-btn`).

### 6.3 Log ra file (1 ngày, làm cùng Phase 3 và 5)

1. `app/utils/logging_setup.py`: `RotatingFileHandler` trong thư mục `logs/` của dữ liệu người dùng (khoảng 5 file × 2 MB), có thời gian và mức log theo setting.
2. Bộ lọc che mật khẩu và chuỗi kết nối; gắn `sys.excepthook` và `threading.excepthook` để ghi lỗi chưa bắt.
3. API `open_log_folder` và nút trong settings. Các chỗ `except: pass` được thay bằng `logger.exception` khi đụng tới trong các phase trước.

### 6.4 Chế độ portable (1 ngày) — ✅ Đã hoàn thành

1. **Phát hiện và chuyển đổi cờ `portable.flag` (`app/utils/paths.py`)**:
   - Hỗ trợ các file cờ `portable.flag`, `portable.txt`, `.portable` nằm cạnh file thực thi.
   - Khi bật, `get_user_data_dir()` lập tức trỏ vào `<thư mục exe>/data`, đảm bảo toàn bộ database lịch sử, danh sách kết nối và cấu hình được gói gọn trong thư mục ứng dụng (tiện lưu trên USB).
   - Hàm `ensure_data_dir_migrated` bảo vệ an toàn, không sao chép lặp khi thư mục nguồn trùng thư mục đích.
2. **Khả năng mang mật khẩu di động (`app/utils/crypto.py`)**:
   - Windows DPAPI chỉ giải mã được trên cùng máy tính và cùng tài khoản Windows.
   - Khi ở Chế độ Portable (`is_portable_mode() == True`): hệ thống tự động ưu tiên mã hóa bằng Fernet (`ENC2:F:...`) sử dụng file khóa `.secret.key` đặt ngay trong thư mục `data/` của bản portable. Nhờ đó, người dùng có thể mang USB cắm sang máy tính khác mà vẫn giải mã và đăng nhập database bình thường.
   - Bổ sung thông báo lỗi thân thiện khi gặp mật khẩu cũ mã hoá bằng DPAPI của máy khác, hướng dẫn nhập lại mật khẩu để tự động nâng cấp sang định dạng di động.
3. **Giao diện & API chuyển đổi**:
   - Nút bật/tắt chế độ Portable trực quan ngay trong tab **"Thông tin & Cập nhật"** của Settings.
   - API `set_portable_mode(enable)` và `is_portable_mode()`.


### 6.5 Tách chuỗi giao diện ra i18n (1 ngày hạ tầng, rồi chuyển dần)

1. Thêm `static/i18n/vi.json`, `en.json` và hàm `t(key, params)`.
2. **Không dịch hàng loạt**: chuyển từng màn hình khi đụng tới. Lỗi từ Python trả **mã lỗi + tham số**, JS dịch ra câu hiển thị.
3. Làm cuối cùng, chỉ khi thật sự có người dùng khác.

### 6.6 Tách Bravo thành module tùy chọn (3–4 ngày, sau Phase 6)

1. Xác định phụ thuộc hai chiều: grep import từ Bravo vào lõi và từ lõi vào Bravo; liệt kê vào báo cáo.
2. Gom mã về `app/bravo/`, `app/api/bravo_api.py` và `static/js/bravo/` (Phase 6 đã chuẩn bị chỗ).
3. Cơ chế nạp tùy chọn: cờ `ENABLE_BRAVO` trong config/settings; menu và cửa sổ Bravo chỉ xuất hiện khi bật; import có bảo vệ để lõi chạy được khi thiếu Bravo.
4. `run.spec`: hai cấu hình build, «lõi» và «đầy đủ».
5. Test lõi chạy không có Bravo; **không đổi hành vi hay định dạng** của chính Bravo.

## 7. Thứ tự triển khai đề xuất

| Thứ tự | Hạng mục | Điều kiện bắt đầu |
| --- | --- | --- |
| 1 | 6.3 Log ra file | Cùng Phase 3 và 5 |
| 2 | 5.1 An toàn môi trường | Xong Phase 3, 5 |
| 3 | 5.2 Script nhiều câu và tham số | Xong Phase 4, 7 (mục 5) |
| 4 | 5.7 Phiên làm việc, yêu thích lịch sử | Xong Phase 2, 6 |
| 5 | 5.6 Script as, so sánh kết quả | Xong Phase 4, 8 |
| 6 | 5.5 Trình xem phiên và khóa chặn | ✅ Đã hoàn thành (Hybrid) |
| 7 | 6.1 Ký số, 6.2 Cập nhật | ✅ Đã hoàn thành 6.2 (Nguồn phiên bản, Update checker, UI & Menu) |
| 8 | 5.3 So sánh schema | ✅ Đã hoàn thành (Hybrid & Bulk Catalog) |
| 9 | 5.4 SQLite rồi MySQL | ✅ Đã hoàn thành SQLite |
| 10 | 6.6 Tách Bravo, 6.4 Portable, 5.8 Trợ lý AI, 6.5 i18n | ✅ Đã hoàn thành 6.4 (Portable mode & Roaming crypto) |

## 8. Các điểm cần bạn quyết định

1. **5.1**: khi transaction tường minh đang mở thì editor chạy trong transaction đó (khuyến nghị) hay từ chối.
2. **5.2**: cú pháp tham số `{{ten}}`.
3. **5.8**: nhà cung cấp AI, ngân sách, và có chấp nhận gửi tên bảng/cột ra ngoài không.
4. **6.1**: loại chứng chỉ ký số.
5. **6.4**: master password hay không lưu mật khẩu ở chế độ portable.
