# Phase 3 – Critical Bugfixes Report

- **Thời điểm hoàn thành**: 2026-10-14 21:55:00
- **Nhánh thực hiện**: `phase3-critical-bugfixes`
- **Môi trường Python**: Python 3.14.3 (`cp314-win_amd64`)
- **Nguyên tắc kỹ thuật tuân thủ**:
  - TDD nghiêm ngặt: Test viết trước (RED), code sửa sau (GREEN).
  - 1 lỗi = 1 commit + 1 file test hồi quy tương ứng.
  - Snapshot API công khai được bảo vệ và cập nhật có chủ đích.
  - Tương thích ngược 100%: Mặc định `Encrypt=no, TrustServerCertificate=yes` được duy trì kèm cảnh báo bảo mật.

---

## 1. Chi tiết 12 Lỗi đã sửa và các Commit tương ứng

| # | Lỗi & Hiện tượng | Vị trí sửa | Giải pháp kỹ thuật | Test File | Commit |
|---|---|---|---|---|---|
| **1** | `USE [db]` thất bại bị nuốt exception âm thầm khiến truy vấn chạy sai database | `app/database/sqlserver.py`<br>`app/services/table_data_editor_service.py` | Bắt `Exception` khi đổi database, raise `RuntimeError` với thông báo rõ ràng về database không thể chuyển đổi | `tests/test_phase3_bug1_use_db.py` | `903a38c` |
| **2** | `explain_query` SQL Server lỗi vì `adapter._lock` không tồn tại; `SHOWPLAN` không tắt khi query lỗi | `main.py` | Sử dụng `conn.lock` của `ConnectionSession`; bọc `SET SHOWPLAN_TEXT OFF` trong khối `finally` đảm bảo luôn tắt | `tests/test_phase3_bug2_explain_query.py` | `9ac11dd` |
| **3 & 4** | Chuỗi kết nối ODBC ghép bằng f-string bị lỗi khi mật khẩu chứa `;` hoặc `}`; mặc định mã hóa | `app/database/sqlserver.py` | Thêm hàm `escape_odbc_value(val)` tuân thủ chuẩn ODBC `{...}` bọc và nhân đôi `}`; log cảnh báo bảo mật khi dùng `Encrypt=no` mặc định | `tests/test_phase3_bugs3_4_odbc.py` | `9033eba` |
| **5** | Trùng lặp phương thức `get_intellisense_*` trong `BravoApi` | `main.py` | So sánh và loại bỏ 2 phương thức thừa (`get_intellisense_types` và `get_intellisense_cache_diagnostics`) | `tests/test_phase3_bug5_intellisense_duplicates.py` | `5de2da0` |
| **6** | `table_designer_script`, `table_designer_save` gọi hàm không tồn tại | `main.py`<br>`tests/snapshots/api_surface.txt` | Grep xác nhận frontend JS không gọi; xóa 2 method chết, chuyển `get_table_designer_metadata` sang `get_table_design`; cập nhật snapshot API | `tests/test_phase3_bug6_dead_table_designer_methods.py` | `8a33122` |
| **7** | `ConnectionManager.create_or_get` tái sử dụng nhầm kết nối khi khác port hoặc authentication | `app/database/connection_manager.py` | Thêm kiểm tra `port` và cờ `trusted_connection` khi so khớp cấu hình kết nối tái sử dụng | `tests/test_phase3_bug7_connection_manager_reuse.py` | `f17c96a` |
| **8** | PostgreSQL: `_build_conn_params` bỏ qua `server`, `search_path` không escape `"`, lỗi rollback config | `app/database/postgresql.py` | Hỗ trợ tách `server:port` hoặc `host:port`; escape `"` trong `search_path`; thêm `sslmode` tùy chọn; rollback `session.config` khi `_ensure_database` lỗi | `tests/test_phase3_bug8_postgresql.py` | `8a0c0c7` |
| **9** | PostgreSQL: `setval` lỗi làm hỏng toàn bộ transaction; tăng sequence vô cớ | `app/services/table_data_editor_service.py` | Bọc lệnh `setval` trong `SAVEPOINT sp_setval` tự động rollback khi lỗi; chỉ gọi `setval` khi có thao tác chèn identity tường minh; định danh có schema | `tests/test_phase3_bug9_setval_savepoint.py` | `5ccbaab` |
| **10** | Chế độ không optimistic bỏ qua `rowcount`; `update_row` & `delete_row` mặc định báo 1 dòng dù ảnh hưởng 0 | `app/services/table_data_editor_service.py` | Kiểm tra `cursor.rowcount == 0` trong mọi chế độ (optimistic & non-optimistic); trả về số dòng thực tế ảnh hưởng (mặc định 0 khi thiếu) | `tests/test_phase3_bug10_rowcount_check.py` | `7785156` |
| **11** | Bộ lọc `like` / `not like` viết thường bị lỗi; `sort_order` không phải số gây văng exception | `app/services/table_data_editor_service.py` | Regex so khớp toán tử không phân biệt hoa thường (`(?i)\b(?:NOT\s+)?LIKE\b`); ép kiểu an toàn `int(sort_order)` với fallback 0 | `tests/test_phase3_bug11_filter_like_and_sort_order.py` | `d771d5a` |
| **12** | `custom_sql` trong `fetch_data` không có giới hạn số dòng | `app/services/table_data_editor_service.py` | Áp dụng giới hạn `top_n` hoặc `Config.MAX_QUERY_ROWS` (1000) cho truy vấn `custom_sql` bọc phân trang | `tests/test_phase3_bug12_custom_sql_limit.py` | `6349921` |

---

## 2. Kết quả Kiểm thử Toàn diện

- **Tổng số test pass**: **764 tests PASSED** (tăng 46 tests so với 718 tests ở Phase 0).
- **Hồi quy (Regressions)**: **0** hồi quy.
- **Tình trạng 19 tests thất bại ban đầu**: Duy trì độc lập, nguyên nhân thuộc về các Phase 4, Phase 5 và Phase 8 chưa triển khai.
- **Snapshot bề mặt API (`test_api_surface_snapshot.py`)**: **PASSED 100%**.

---

## 3. Kế hoạch Chuyển giao tiếp theo

- Merge nhánh `phase3-critical-bugfixes` vào nhánh `main`.
- Đánh dấu mốc git tag nếu cần (`phase3-completed`).
- Chuyển sang **Phase 4: Quote định danh dùng chung và Table Designer**.
