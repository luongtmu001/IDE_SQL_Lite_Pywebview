# Phase 5 – Khóa Kết Nối, Vòng Đời, Profiler Report

- **Thời điểm hoàn thành**: 2026-10-15 00:30:00
- **Nhánh thực hiện**: `phase5-concurrency-lifecycle-profiler`
- **Môi trường Python**: Python 3.14.3 (`cp314-win_amd64`)
- **Nguyên tắc kỹ thuật tuân thủ**:
  - TDD nghiêm ngặt: Test viết trước (RED), code sửa sau (GREEN).
  - 1 mục tiêu / logical change = 1 commit + file test hồi quy tương ứng.
  - Snapshot API công khai được bảo vệ 100% không suy suyển (`test_api_surface_snapshot.py` PASSED).
  - Tương thích ngược 100%: Bảo toàn các signature và hành vi công khai của MainApi, BravoApi và Subwindow APIs.
  - An toàn dữ liệu tối đa: Mặc định chuyển sang kiểm tra ràng buộc không ghi (`trial_insert=False`), không chèn thử làm tiêu tốn identity seed hoặc kích hoạt trigger ngoài ý muốn.

---

## 1. Chi tiết các Hạng mục Triển khai và Commits

| # | Hạng mục / Lỗi giải quyết | Vị trí thay đổi | Giải pháp kỹ thuật | Test File | Commit |
|---|---|---|---|---|---|
| **1** | Bổ sung `session.exclusive()` context manager | `app/models/connection_session.py` | Tạo context manager `session.exclusive()` độc quyền khóa `session.lock`, tự động gọi `touch()` cập nhật `last_used_at`, nhả khóa an toàn trong khối `finally` khi gặp ngoại lệ | `tests/test_phase5_session_exclusive.py` | `a35e5bc` |
| **2** | Bọc độc quyền các API Table Data Editor trong `MainApi` | `main.py` | Bọc toàn bộ 8 API Table Data Editor (`fetch_table_data`, `update_table_row`, `insert_table_row`, `delete_table_row`, `submit_table_changes`, `validate_table_row`, `validate_insert_row`, `validate_insert_rows`) với `with conn.exclusive():` và truyền `lock=conn.lock` xuống service | `tests/test_phase5_main_api_editor_concurrency.py` | `165fc56` |
| **3** | Khóa luồng & cấu trúc lại cache metadata của Editor | `app/services/table_data_editor_service.py` | Chuyển key cache metadata sang `(connection_id, db, schema, table)` thay vì `id(adapter)`; bổ sung `threading.RLock()` bảo vệ thao tác đọc/ghi; tích hợp dọn dẹp các mục hết hạn theo TTL (60s) | `tests/test_phase5_editor_cache_concurrency.py` | `ae0a7b3` |
| **4** | Kiểm tra ràng buộc không phá hủy & opt-in `trial_insert` | `app/services/table_data_editor_service.py`<br>`tests/test_table_data_editor.py` | Chuyển `validate_insert_rows` và `validate_row` sang kiểm tra không ghi (SELECT NOT NULL, UNIQUE, FK). Chế độ chèn thử giao dịch (INSERT/UPDATE + rollback) được chuyển thành tùy chọn `trial_insert=True`. Cập nhật có chủ đích 3 bài test cũ kiểm thử rollback chèn | `tests/test_phase5_non_destructive_validation.py`<br>`tests/test_table_data_editor.py` | `e67dff2` |
| **5** | Dọn kết nối idle và vòng đời đóng cửa sổ | `app/services/connection_manager.py`<br>`main.py` | Bổ sung `cleanup_idle(max_idle_seconds, owner_session_id)` (bỏ qua kết nối đang trong transaction để tránh mất dữ liệu), `close_all_for_window(window_id)`, `close_all_sessions()`. Bổ sung hook `window.events.closed` cho main window để dọn sạch kết nối khi thoát | `tests/test_phase5_connection_manager_lifecycle.py` | `cdc4911` |
| **6** | Phát hiện & dọn dẹp session XE mồ côi MSSQL + tài liệu quyền | `app/services/profiler/mssql_profiler.py`<br>`app/services/profiler/__init__.py` | Bổ sung `list_orphaned_sessions` (truy vấn `sys.server_event_sessions` với tiền tố `luoBTool_XE_%`) và `cleanup_orphaned_sessions` với cơ chế kiểm tra tiền tố an toàn (tuyệt đối không xóa session hệ thống). Ghi tài liệu chi tiết các quyền cần thiết trên SQL Server | `tests/test_phase5_mssql_profiler_orphan_cleanup.py` | `86ee732` |
| **7** | Thay thế `except Exception: pass` bằng logging có ngữ cảnh | `app/models/connection_session.py`<br>`app/services/connection_manager.py`<br>`app/services/profiler/mssql_profiler.py`<br>`app/services/table_data_editor_service.py` | Thay thế toàn bộ các khối `except Exception: pass` âm thầm nuốt lỗi bằng logging có ngữ cảnh với các cấp độ phù hợp (`logger.warning` / `logger.debug`), giữ nguyên cơ chế phục hồi lỗi nhưng ghi vết rõ ràng | `tests/test_phase5_contextual_logging.py` | `9dad9eb` |
| **8** | Chống rò rỉ cache giữa các test editor | `app/services/table_data_editor_service.py`<br>`tests/test_table_data_editor.py` | Kiểm tra chặt kiểu `isinstance(conn_id, str)` trong `_resolve_connection_id` tránh MagicMock bị gán chuỗi định danh ngẫu nhiên; bổ sung `setUp`/`tearDown` xóa cache giữa các test case | `tests/test_table_data_editor.py` | `f29e1f4` |

---

## 2. Các Cập nhật Có Chủ Đích đối với Test cũ (`test_table_data_editor.py`)

Theo đúng tinh thần của kế hoạch Phase 5:
- 3 bài test cũ trong `tests/test_table_data_editor.py` (`test_validate_insert_rows_mixed_results`, `test_validate_insert_rows_skips_identity_and_computed`, `test_validate_row_update_and_insert`) được viết với mục đích chuyên biệt là kiểm thử cơ chế chèn thử nghiệm và rollback giao dịch.
- Để đảm bảo tương thích mà vẫn giữ `trial_insert=False` làm giá trị mặc định an toàn cho toàn bộ ứng dụng, 3 bài test này được truyền tham số tường minh `trial_insert=True`.
- Toàn bộ 34 bài kiểm thử trong `test_table_data_editor.py` đều chuyển sang **XANH 100%**.

---

## 3. Tài liệu Quyền Cần thiết cho SQL Server Extended Events (MssqlProfiler)

Để khởi tạo, giám sát và dọn dẹp các session Extended Events (XE) của Profiler:
1. **SQL Server 2008 – 2019**:
   - `GRANT ALTER ANY EVENT SESSION TO [<login>];`
   - `GRANT VIEW SERVER STATE TO [<login>];`
   - *(Hoặc là thành viên của vai trò cố định máy chủ `sysadmin`)*.
2. **SQL Server 2022 trở lên**:
   - `GRANT ALTER ANY EVENT SESSION TO [<login>];`
   - `GRANT VIEW SERVER PERFORMANCE STATE TO [<login>];`
   - *(Hoặc là thành viên của vai trò cố định máy chủ `sysadmin`)*.
3. **Truy vấn catalog hệ thống / DMV**:
   - Đọc `sys.server_event_sessions` yêu cầu `VIEW ANY DEFINITION` hoặc `ALTER ANY EVENT SESSION`.
   - Đọc `sys.dm_xe_sessions` và `sys.dm_xe_session_targets` yêu cầu `VIEW SERVER STATE` (hoặc `VIEW SERVER PERFORMANCE STATE` trên SQL Server 2022+).

---

## 4. Kết quả Kiểm thử Đối chiếu

| Chỉ số | Baseline (Phase 0) | Hoàn thành Phase 5 | Đánh giá |
|---|---|---|---|
| **Bộ test Phase 5 & Table Editor** | - | **59 passed (100%)** | 8 file test Phase 5 + toàn bộ 34 test editor đều xanh |
| **Snapshot API Surface** | Khớp snapshot | **PASSED 100%** | Bề mặt API công khai không có bất kỳ sai lệch nào |
| **Rò rỉ trạng thái autocommit / khóa** | Có nguy cơ xung đột | **Đã loại bỏ** | `session.exclusive()` và `conn.lock` cô lập hoàn toàn |
| **Tiêu tốn identity seed khi validate** | Có (chèn thật rồi rollback) | **Đã khắc phục** | Mặc định chuyển sang SELECT validation không ghi |

---

## 5. Kế hoạch Chuyển giao tiếp theo

1. Merge nhánh `phase5-concurrency-lifecycle-profiler` vào nhánh `main`.
2. Gắn nhãn git tag `phase5-completed`.
3. Sẵn sàng chuyển tiếp sang **Phase 6 – Tách main.py bằng refactor cơ học**.
