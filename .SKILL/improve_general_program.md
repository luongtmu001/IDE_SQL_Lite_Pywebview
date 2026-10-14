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

### 5.3 So sánh schema giữa hai database

**Mục tiêu**: chọn nguồn A và đích B, xem khác biệt, sinh script migration có chọn từng mục. **Phụ thuộc**: **bắt buộc xong Phase 4** (`generate_diff` đúng) và Phase 6. **Ước lượng**: 5–7 ngày.

**Các bước**

1. **Phạm vi giai đoạn 1**: cùng engine (SQL Server↔SQL Server hoặc PostgreSQL↔PostgreSQL), đối tượng gồm bảng, cột, PK/FK/unique/check, index. View, function, procedure để giai đoạn 2.
2. **Service mới** `app/services/schema_compare_service.py`: `snapshot(adapter, schema)` trả cấu trúc **cùng định dạng** với `original` mà Table Designer đang dùng (tái dụng `get_table_design_metadata`, không viết bộ đọc metadata thứ hai); `diff(snap_a, snap_b)` trả danh sách khác biệt (chỉ ở A, chỉ ở B, khác định nghĩa).
3. **Sinh script**: bảng chung gọi `generate_diff(original=B, modified=A)`; bảng chỉ có ở A dùng `generate_create_table_ddl`; bảng chỉ có ở B sinh `DROP` và gắn `destructive`. Với tên constraint tự sinh khác nhau, so khớp theo **định nghĩa** (cột, hành động), không theo tên.
4. **UI**: cửa sổ phụ theo mẫu có sẵn trong `windows.py` (như profiler/event listener): chọn hai kết nối và schema, cây khác biệt có checkbox, xem script, nút «Mở trong editor». **Không tự chạy trên đích**; nếu cần chạy thì đi qua đường `apply_table_design` đã có transaction và xác nhận.
5. **Hiệu năng**: snapshot chạy trong thread có thanh tiến trình và nút hủy; lấy metadata theo lô, không gọi từng bảng một lần cho schema lớn.

**Kiểm chứng**: test `diff` trên hai snapshot cố định (fixture); test tích hợp với hai database PostgreSQL trong Docker; so sánh script sinh ra với kỳ vọng viết tay. **Rủi ro**: kết quả sai nếu `generate_diff` chưa được sửa như Phase 4; vì vậy không bắt đầu tính năng này trước khi Phase 4 xong.

### 5.4 Thêm adapter SQLite và MySQL/MariaDB

**Mục tiêu**: mở rộng loại cơ sở dữ liệu mà không đụng tới hai adapter hiện có. **Phụ thuộc**: Phase 4 (quote cho `sqlite`/`mysql`), Phase 6. **Ước lượng**: SQLite 4–5 ngày, MySQL 5–7 ngày (làm SQLite trước, xong rồi mới MySQL).

**Các bước**

1. **Bộ test hợp đồng adapter**: tạo `tests/adapter_contract/`, chạy cùng một bộ kiểm tra (kết nối, thực thi, danh sách database/schema/bảng/cột, hủy truy vấn) cho từng adapter qua `pytest.parametrize`. Chạy trước trên SQL Server/PostgreSQL hiện có để chốt hợp đồng, rồi mọi adapter mới phải qua.
2. **Đọc** `app/database/base.py` (interface) và `factory.py`; viết `sqlite.py` tối thiểu bằng `sqlite3` có sẵn của Python: kết nối bằng đường dẫn file (trường `database` là file, modal thêm ô chọn file), danh sách bảng/cột/index/FK/view/trigger qua `PRAGMA` và `sqlite_master`, hủy truy vấn bằng `interrupt()`.
3. **Đăng ký** loại mới trong `factory.py`, modal kết nối, ánh xạ dialect cho `sqlglot` (`sqlite`, `mysql`) trong phần kiểm tra cú pháp, và `ConnectionManager` (SQLite không có mật khẩu).
4. **Chỗ phụ thuộc engine**: grep các nhánh `if engine == ...` trong `main.py`, explorer, intellisense, editor để thêm nhánh mới hoặc ẩn tính năng chưa hỗ trợ. Table Designer với SQLite chỉ cho tạo bảng (ALTER của SQLite hạn chế), table editor dùng `rowid` khi bảng không có PK.
5. **Đóng gói**: thêm hidden imports vào `run.spec`; MySQL dùng `PyMySQL` (thuần Python, dễ đóng gói) thay vì `mysqlclient`.
6. **MySQL** theo cùng quy trình sau khi SQLite qua bộ test hợp đồng; quote dùng backtick, `SHOW`/`information_schema` cho metadata.

**Kiểm chứng**: toàn bộ test hợp đồng xanh cho adapter mới; test thủ công mở file `.db`, duyệt cây, chạy truy vấn, sửa dữ liệu. **Rủi ro**: khác biệt ngữ nghĩa (kiểu động của SQLite, `ON DUPLICATE`, `AUTO_INCREMENT`); chấp nhận hỗ trợ tập con rõ ràng và ghi vào tài liệu.

### 5.5 Trình xem phiên đang chạy và khóa chặn

**Mục tiêu**: xem session đang chạy, câu SQL, thời gian, đang chờ gì, ai đang chặn ai; hủy hoặc kill khi cần. **Phụ thuộc**: Phase 5 (kết nối phụ, vòng đời), Phase 6. **Ước lượng**: 3–4 ngày.

**Các bước**

1. **Service mới** `app/services/activity_service.py`. SQL Server: `sys.dm_exec_sessions`, `sys.dm_exec_requests`, `sys.dm_exec_sql_text`, cột `blocking_session_id`. PostgreSQL: `pg_stat_activity` kết hợp `pg_blocking_pids(pid)`. Trả về danh sách phẳng kèm quan hệ chặn; client dựng cây, tìm «head blocker».
2. **Kết nối riêng**: không dùng connection mà người dùng đang chạy truy vấn dài (nếu không, chính nó bị kẹt). Tạo adapter phụ từ cấu hình của session, theo mẫu profiler đang dùng (`profiler/base.py`), đóng khi cửa sổ đóng.
3. **Hành động**: SQL Server `KILL <spid>`; PostgreSQL `pg_cancel_backend` (nhẹ, hủy câu lệnh) và `pg_terminate_backend` (mạnh, ngắt kết nối). Luôn có hộp xác nhận hiển thị câu SQL và user của session đích; không cho kill session của chính mình; bị chặn khi kết nối ở chế độ chỉ đọc (tính năng 5.1).
4. **UI**: cửa sổ phụ theo mẫu của profiler/event listener (`windows.py`); bảng tự làm mới 2–5 giây (tùy chọn), lọc theo database/user/trạng thái, sao chép câu SQL.
5. **Quyền**: SQL Server cần `VIEW SERVER STATE`; thiếu quyền thì báo rõ thay vì trả danh sách rỗng.

**Kiểm chứng**: test phân tích kết quả bằng dữ liệu giả; test tích hợp PostgreSQL (Docker) mở hai session, một session giữ khóa, kiểm tra chuỗi chặn và nút hủy. **Rủi ro**: kill nhầm session quan trọng; giảm bằng xác nhận hai bước trên Prod và không có thao tác hàng loạt.

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

### 6.2 Cơ chế cập nhật (2–3 ngày)

1. Tạo `app/version.py` (nguồn phiên bản duy nhất) và để `run.spec` đọc từ đó.
2. Giai đoạn 1: khi khởi động, một thread nền (timeout ngắn, tắt được trong settings) tải `version.json` từ nơi bạn chọn (GitHub Releases hoặc thư mục chia sẻ nội bộ), so semver, hiện banner «Có bản mới» kèm nút mở trang tải. Chỉ đọc, không tự cài.
3. Giai đoạn 2 (làm sau nếu cần): tải bản mới, kiểm tra SHA256, rồi dùng một updater riêng thay thư mục (xử lý việc exe đang chạy).

### 6.3 Log ra file (1 ngày, làm cùng Phase 3 và 5)

1. `app/utils/logging_setup.py`: `RotatingFileHandler` trong thư mục `logs/` của dữ liệu người dùng (khoảng 5 file × 2 MB), có thời gian và mức log theo setting.
2. Bộ lọc che mật khẩu và chuỗi kết nối; gắn `sys.excepthook` và `threading.excepthook` để ghi lỗi chưa bắt.
3. API `open_log_folder` và nút trong settings. Các chỗ `except: pass` được thay bằng `logger.exception` khi đụng tới trong các phase trước.

### 6.4 Chế độ portable (1 ngày)

1. Cờ `portable.flag` cạnh exe → `get_user_data_dir()` (Phase 2) trả `<thư mục exe>/data`.
2. Khóa DPAPI gắn với máy và tài khoản Windows nên **không mang được giữa các máy**. **\[QUYẾT ĐỊNH\]**: dùng mật khẩu chủ (master password) để dẫn xuất khóa, hay ở chế độ portable không lưu mật khẩu kết nối.

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
| 6 | 5.5 Trình xem phiên và khóa chặn | Xong Phase 5, 6 |
| 7 | 6.1 Ký số, 6.2 Cập nhật | Trước khi phát hành rộng |
| 8 | 5.3 So sánh schema | **Bắt buộc xong Phase 4** |
| 9 | 5.4 SQLite rồi MySQL | Xong Phase 4, 6 và bộ test hợp đồng |
| 10 | 6.6 Tách Bravo, 6.4 Portable, 5.8 Trợ lý AI, 6.5 i18n | Sau cùng, tùy nhu cầu |

## 8. Các điểm cần bạn quyết định

1. **5.1**: khi transaction tường minh đang mở thì editor chạy trong transaction đó (khuyến nghị) hay từ chối.
2. **5.2**: cú pháp tham số `{{ten}}`.
3. **5.8**: nhà cung cấp AI, ngân sách, và có chấp nhận gửi tên bảng/cột ra ngoài không.
4. **6.1**: loại chứng chỉ ký số.
5. **6.4**: master password hay không lưu mật khẩu ở chế độ portable.
