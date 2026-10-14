# Phase 7 – Đường chạy kép và Pipeline cú pháp Report

- **Thời điểm hoàn thành**: 2026-10-15 02:30:00
- **Nhánh thực hiện**: `phase7-dualrun-syntax`
- **Môi trường Python**: Python 3.14.3 (`cp314-win_amd64`)
- **Nguyên tắc kỹ thuật tuân thủ**:
  - **TDD nghiêm ngặt**: Mỗi bước đều có test độc lập viết trước hoặc song hành, 1 mục tiêu = 1 commit + file test tương ứng.
  - **Lưới an toàn Snapshot & Hồi quy**: `tests/test_api_surface_snapshot.py` được bảo vệ 100% không vi phạm hợp đồng API công khai.
  - **Không breaking changes**: Pywebview Native IPC bridge và Flask routes giữ nguyên các route và hành vi đối ngoại.
  - **Phân tách tầng sạch sẽ (Clean Architecture)**: Loại bỏ triệt để các import ngược từ `app.routes` vào `app.api`. Các tầng presentation (pywebview và Flask) cùng gọi chung các core services tại `app/services/` và `app/bravo/`.

---

## 1. Chi tiết các Hạng mục Triển khai và Commits

| Bước | Hạng mục / Lỗi giải quyết | Vị trí thay đổi | Giải pháp kỹ thuật | Test File | Commit |
|---|---|---|---|---|---|
| **Step 1** | Bảo vệ cú pháp nâng cao trong `transform_pg_temp_tables` | `app/database/syntax/adapters/postgresql_regex.py` | Gia cố bộ tokenizer bảo vệ chuỗi dollar-quoted (`$$...$$`, `$tag$...$tag$`), chuỗi escape PostgreSQL (`E'...'`, `e'...'`), định danh bọc dấu ngoặc kép (`"..."`), chú thích đơn/đa dòng, và các toán tử JSON/hình học chứa `#` (`#>`, `#>>`, `#-`, `##`). Chỉ chuyển đổi các bảng tạm `#temp` thực sự | `tests/test_phase7_step1_transform_pg_temp_tables.py` | `b858c6b` |
| **Step 2** | Bundle DLL ScriptDom, hỗ trợ cấu hình đường dẫn và báo cáo chẩn đoán | `app/database/syntax/adapters/sqlserver_scriptdom.py`<br>`app/services/settings_store.py` | Xác thực DLL `Microsoft.SqlServer.TransactSql.ScriptDom.dll` đi kèm ứng dụng tại `app/database/syntax/bin/`; bổ sung thứ tự ưu tiên tìm DLL: `settings.json` (`syntax.scriptDomDllPath`) -> biến môi trường `SCRIPTDOM_DLL_PATH` -> bundled DLL -> PyInstaller sys._MEIPASS -> registry SSMS/ADS. Bổ sung phương thức `get_status()` trả về trạng thái rõ ràng (thay vì fallback âm thầm) | `tests/test_phase7_step2_scriptdom_bundle_and_settings.py` | `746f3bd` |
| **Step 3** | Thiết lập đường chạy kép (Dual-run) cho pipeline cú pháp | `app/api/query_api.py`<br>`app/routes/query.py`<br>`tests/fixtures/sql_corpus/` | Xây dựng bộ ngữ liệu SQL mẫu gồm 8 file T-SQL và PL/pgSQL; kết nối `validate_sql_pipeline` vào `MainApi.syntax_check` và Flask route sau cờ cấu hình `syntax.pipeline` (mặc định `False`); tự động fallback sang legacy `validate_sql` nếu pipeline gặp lỗi; thực hiện test so sánh dual-run đối chiếu chẩn đoán | `tests/test_phase7_step3_dual_run_syntax.py` | `c9f464b` |
| **Step 4** | Khai báo bảng ánh xạ Route Dispatch Table tường minh trong `api.js` | `static/js/api.js`<br>`dist/LLTool/_internal/static/js/api.js` | Thay thế thang `if-else` lồng nhau hơn 450 dòng bằng cấu trúc khai báo `ROUTE_DISPATCH_TABLE`. Kiểm tra kiểu `typeof api[method] === 'function'` tường minh cho từng route; trả về HTTP 501 kèm thông báo rõ ràng (`Native method '<name>' is not implemented on pywebview bridge`) khi thiếu method; đồng bộ hóa sang bản build `dist/` | `tests/test_phase7_step4_api_dispatch_table.py` | `fa457ca` |
| **Step 5** | Đồng bộ Flask routes tái sử dụng Core Services (Phương án A) | `app/services/session_service.py`<br>`app/services/styles_service.py`<br>`app/services/settings_store.py`<br>`app/routes/session.py`<br>`app/routes/styles.py`<br>`app/routes/connections.py`<br>`app/routes/bravo.py`<br>`app/api/session_api.py`<br>`app/api/settings_api.py`<br>`app/api/connections_api.py` | Trích xuất `session_service.py` và `styles_service.py` vào `app/services/`. Xóa bỏ hoàn toàn việc `app/api/` import từ `app/routes/`. Căn chỉnh Flask routes để tái sử dụng dịch vụ lõi: `connections.py` dùng `get_saved_connections`, `bravo.py` tái sử dụng `xml_codec` và `settings_store`. Bảo toàn tương thích ngược cho monkeypatching trong các bài test cũ | `tests/test_phase7_step5_flask_routes_service_reuse.py` | `6b1626f` |
| **Hardening 1** | Đồng bộ hóa các regression test với cờ syntax pipeline và tham số query | `tests/test_postgresql_adapter_fixes.py`<br>`tests/test_postgresql_debug_mode.py` | Mock `load_settings` trong test syntax check và cập nhật kwargs gọi execute trong test debug | `tests/test_postgresql_adapter_fixes.py`<br>`tests/test_postgresql_debug_mode.py` | `e756afd` |
| **Hardening 2** | Quản lý độ sâu ngoặc trong tách câu lệnh và cô lập mock test | `app/database/debug/instrumenter.py`<br>`tests/test_environment_safety.py` | Quản lý `paren_depth` trong `split_postgres_statements` để không cắt ngang `bs.trace(...)` có dấu chấm phẩy; cô lập mock `get_metadata` bằng `patch.object` | `tests/test_sql_context_engine.py`<br>`tests/test_phase5_non_destructive_validation.py`<br>`tests/test_table_data_editor.py` | `5944992` |

---

## 2. Các Quyết định Kỹ thuật Chính

### Quyết định 1: Phương án đối với Flask Routes (Chọn Phương án A)
- Giữ các Blueprint Flask trong `app/routes/` làm kênh giao tiếp phụ trợ (cho các trường hợp gọi qua HTTP/demo), nhưng **tuyệt đối không nhân đôi logic nghiệp vụ**.
- Toàn bộ nghiệp vụ được chuyển vào các module dịch vụ trong `app/services/` (`session_service`, `styles_service`, `settings_store`, `metadata_service`, `object_search_service`, v.v.) và `app/bravo/xml_codec.py`.
- Tầng Native IPC (`app/api/`) và tầng HTTP REST (`app/routes/`) đóng vai trò là hai presentation adapter song song, cùng phụ thuộc vào tầng dịch vụ chung (Zero Cross-Presentation Dependency).

### Quyết định 2: Phân phối và Quản lý Microsoft ScriptDom DLL
- Đóng gói trực tiếp thư viện `Microsoft.SqlServer.TransactSql.ScriptDom.dll` đi kèm thư mục cài đặt ứng dụng (`app/database/syntax/bin/`).
- Hỗ trợ người dùng tự cấu hình đường dẫn DLL tùy ý thông qua file cấu hình `data/settings.json` tại mục `syntax.scriptDomDllPath` hoặc biến môi trường `SCRIPTDOM_DLL_PATH`.
- Bổ sung phương thức chẩn đoán `SqlServerScriptDomAdapter.get_status()` để giao diện người dùng biết chính xác trạng thái sẵn sàng, phiên bản CLR .NET và đường dẫn DLL đang hoạt động.

### Quyết định 3: Thiết lập Đường chạy kép (Dual-run Pipeline)
- Chức năng kiểm tra cú pháp được bảo vệ bởi toggle `syntax.pipeline` trong cấu hình (mặc định tắt `False`).
- Khi bật `syntax.pipeline: true`, hệ thống chuyển tiếp sang `validate_sql_pipeline` đa tầng (AST ScriptDom + Regex). Nếu xảy ra ngoại lệ không lường trước trong pipeline mới, hệ thống tự động fallback êm dịu sang bộ kiểm tra cũ `validate_sql` và ghi log cảnh báo, đảm bảo trải nghiệm người dùng không bị gián đoạn.
- Tạo bộ dữ liệu kiểm thử đối chiếu `tests/fixtures/sql_corpus/` gồm các truy vấn phức tạp của cả SQL Server và PostgreSQL để đo lường độ chính xác.

---

## 3. Kết quả Kiểm thử Đối chiếu

| Nhóm bài kiểm thử | Số lượng test | Kết quả | Ghi chú |
|---|---|---|---|
| **Phase 7 Step 1 (Temp table protection)** | 13 tests | **13 passed (100%)** | Dollar-quotes, escape strings, quoted IDs, comments, operators |
| **Phase 7 Step 2 (ScriptDom bundle & status)** | 4 tests | **4 passed (100%)** | Load DLL, get_status, path override, settings lookup |
| **Phase 7 Step 3 (Dual-run syntax pipeline)** | 3 tests | **3 passed (100%)** | Dual-run corpus comparison, setting toggle, error fallback |
| **Phase 7 Step 4 (Route dispatch table)** | 5 tests | **5 passed (100%)** | Declarative registry, domain coverage, 501 status, dist sync |
| **Phase 7 Step 5 (Flask routes service reuse)** | 5 tests | **5 passed (100%)** | Zero cross-imports, session/styles/connections/bravo reuse |
| **Public API Surface Snapshot** | 1 snapshot test | **PASSED (100%)** | Bảo toàn 100% 105 Flask endpoints và toàn bộ MainApi methods |
| **Toàn bộ Phase 7 Suite độc lập** | **31 tests** | **31 passed (100%)** | Chạy độc lập trong 1.74s |
| **TOÀN BỘ TEST SUITE DỰ ÁN** | **904 tests** | **904 passed (100%)** | **Hoàn thành toàn bộ test suite dự án trong 53.46s (Zero Failures)** |
