# Phase 4 – Quoting Định Danh Dùng Chung & Table Designer Report

- **Thời điểm hoàn thành**: 2026-10-14 23:15:00
- **Nhánh thực hiện**: `phase4-quote-and-table-designer`
- **Môi trường Python**: Python 3.14.3 (`cp314-win_amd64`)
- **Nguyên tắc kỹ thuật tuân thủ**:
  - TDD nghiêm ngặt: Test viết trước (RED), code sửa sau (GREEN).
  - 1 mục tiêu / logical change = 1 commit + file test hồi quy tương ứng.
  - Snapshot API công khai được bảo vệ 100% không suy suyển (`test_api_surface_snapshot.py` PASSED).
  - Tương thích ngược 100%: Duy trì các hàm bọc cũ (`_quote_ident`, `_format_table_name`) làm wrapper chuyển tiếp gọi sang `sql_utils.py`.
  - Cập nhật có chủ đích các bài test cũ khẳng định đầu ra không quote trong `tests/test_table_designer.py`.

---

## 1. Chi tiết các Hạng mục Triển khai và Commits

| # | Hạng mục / Lỗi giải quyết | Vị trí thay đổi | Giải pháp kỹ thuật | Test File | Commit |
|---|---|---|---|---|---|
| **1** | Tạo module quote dùng chung chuẩn hóa | `app/database/sql_utils.py` (mới) | Cung cấp `quote_ident(name, engine)` (nhân đôi `]` cho sqlserver/sqlite, `"` cho postgres/oracle/mysql), `quote_qualified(...)`, `escape_literal(...)`. Xử lý chặt chẽ Unicode, khoảng trắng, từ khóa, định danh giả bọc | `tests/test_phase4_sql_utils.py` | `31afd11` |
| **2** | Tích hợp `sql_utils` vào Table Data Editor | `app/services/table_data_editor_service.py` | Thay thế các lệnh bọc thủ công `[col]` / `f"[{col}]"`; duy trì hàm `_quote_ident` và `_format_table_name` bọc chuyển tiếp sang `sql_utils` | `tests/test_phase4_table_data_editor_quoting.py` | `c887b30` |
| **3** | Tích hợp `sql_utils` vào Table Designer | `app/services/table_designer_service.py` | Thay thế regex/replace tự chế; giữ `_quote_ident` và `_format_table_name` làm wrapper tương thích ngược | `tests/test_phase4_table_designer_quoting.py` | `45733f9` |
| **4** | SQL Server: Escape db_prefix và trích xuất ràng buộc thật | `app/database/sqlserver.py` | Dùng `quote_ident(database, 'sqlserver')` thay cho `[{database}]` thô; trích xuất `pk_name` (từ `sys.key_constraints`) và `default_constraint_name` (từ `c.default_object_id`) | `tests/test_phase4_sqlserver_quoting.py` | `34cb275` |
| **5** | PostgreSQL: Trích xuất tên PK thật và dọn dẹp metadata query | `app/database/postgresql.py` | Lấy `pk_name` thật từ `pg_constraint` / `conname`; loại bỏ `limit=0` gây lỗi trong các truy vấn metadata hệ thống | `tests/test_phase4_postgresql_quoting.py` | `470eac0` |
| **6** | Table Designer 2A: Quote toàn bộ định danh trong DDL ALTER TABLE | `app/services/table_designer_service.py`<br>`tests/test_table_designer.py` | Quote toàn bộ table name, column name, new column name, USING clauses trong `generate_diff` (Postgres & SQL Server); cập nhật có chủ đích các test cũ đòi hỏi không quote | `tests/test_phase4_table_designer_diff_quoting.py`<br>`tests/test_table_designer.py` | `fa428c8` |
| **7** | Table Designer 2B & 2C: Sử dụng tên constraint thật & quản lý Default SQL Server | `app/services/table_designer_service.py` | Sử dụng `pk_name` thật thay vì đoán `PK_{table}`; sinh lệnh DROP default constraint cũ và ADD default constraint mới khi sửa giá trị mặc định trong SQL Server | `tests/test_phase4_real_constraint_names.py` | `0df620c` |
| **8** | Table Designer 2D & 2E: Thứ tự DDL an toàn & so sánh định nghĩa constraint | `app/services/table_designer_service.py` | Sắp xếp DDL chuẩn: Drop FK -> Drop Index -> Drop UQ -> Drop CK -> Drop Default -> Drop PK -> Drop Column -> Add Column -> Alter Column -> Add Default -> Add Constraint/Index -> Trigger. So sánh định nghĩa `definition` của check/unique/index/FK thay vì chỉ so sánh tên | `tests/test_phase4_ddl_ordering_and_constraint_diff.py` | `32bf9cd` |
| **9** | Table Designer 2F & 2G: Cảnh báo `destructive`, thu hẹp kiểu & thống nhất `nullable` | `app/services/table_designer_service.py` | Thêm hàm `is_type_narrowed`; gán cờ `destructive: True` khi thu hẹp kiểu hoặc thêm cột NOT NULL không có default; thống nhất mặc định `nullable: True` giữa compare và generate; không đánh dấu destructive cho drop non-PK index/constraint | `tests/test_phase4_destructive_and_nullable_unification.py` | `c916846` |
| **10** | Profiler MSSQL: Quote và escape an toàn Extended Events Session Name | `app/services/profiler/mssql_profiler.py` | Dùng `quote_ident(..., 'sqlserver')` cho định danh session và escape literal string cho chuỗi SQL target file | `tests/test_phase4_mssql_profiler_quoting.py` | `4509579` |
| **11** | Tương thích phân trang metadata trong `list_schemas` SQL Server | `app/database/sqlserver.py` | Khôi phục `limit=0` cho truy vấn `list_schemas` đảm bảo tương thích 100% với `test_metadata_limit_fix.py` | `tests/test_metadata_limit_fix.py` | `b1adda8` |

---

## 2. Các Cập nhật Có Chủ Đích đối với Test cũ (`test_table_designer.py`)

Theo đúng quy tắc của kế hoạch Phase 4: *"Test cũ khẳng định đầu ra không quote phải được cập nhật có chủ đích và nêu trong báo cáo."*
- Trong `tests/test_table_designer.py`, các bài test trước đây kiểm tra chuỗi DDL thô chưa được quote (ví dụ: `drop column OldColumn`, `drop column "OldColumn"`, `alter column [Age] drop default`).
- Khi tích hợp quote định danh chuẩn hóa:
  - SQL Server: Các định danh cột được bao bọc an toàn dạng `[OldColumn]`, `[Age]`.
  - PostgreSQL: Các định danh cột được bao bọc an toàn dạng `"OldColumn"`, `"Age"`.
- Các câu lệnh assertion tương ứng đã được cập nhật kỳ vọng chuỗi đã được quote chính xác, giúp bảo vệ hệ thống trước các lỗi SQL injection và xung đột từ khóa/ký tự đặc biệt.

---

## 3. Kết quả Kiểm thử Đối chiếu Baseline (Phase 0)

| Chỉ số | Baseline (Phase 0) | Hoàn thành Phase 4 | Chênh lệch / Đánh giá |
|---|---|---|---|
| **Số test PASSED** | **718 passed** | **811 passed** | **+93 tests** (bao gồm 44 tests mới của Phase 4 và các test venv pywebview) |
| **Số test FAILED** | **19 failed** | **17 failed** | **Giảm 2 lỗi**: 2 bài test lỗi Table Designer từ Phase 0 (`test_sqlserver_adapter_get_table_design_metadata_mock` và `test_user_defined_types_support`) **đã chuyển sang XANH hoàn toàn**. 17 bài test đỏ còn lại thuộc đúng phạm vi Phase 5 và Phase 8 |
| **Hồi quy (Regressions)** | - | **0 hồi quy** | Tất cả các module hiện hữu hoạt động ổn định |
| **Snapshot API Surface** | Khớp snapshot | **PASSED 100%** | Không làm rò rỉ hay thay đổi chữ ký API công khai |

---

## 4. Kế hoạch Chuyển giao tiếp theo

1. Merge nhánh `phase4-quote-and-table-designer` vào nhánh `main`.
2. Gắn nhãn git tag `phase4-completed`.
3. Sẵn sàng chuyển tiếp sang **Phase 5 – Khóa kết nối, vòng đời, profiler**.
