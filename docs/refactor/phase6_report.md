# Phase 6 – Tách main.py bằng Refactor Cơ học Report

- **Thời điểm hoàn thành**: 2026-10-15 01:50:00
- **Nhánh thực hiện**: `phase6-split-main`
- **Môi trường Python**: Python 3.14.3 (`cp314-win_amd64`)
- **Nguyên tắc kỹ thuật tuân thủ**:
  - **Refactor cơ học thuần túy**: Không sửa logic, bảo toàn 100% chữ ký phương thức, tên hàm và hợp đồng cầu nối `js_api` của pywebview.
  - **Lưới an toàn Snapshot & TDD**: Chạy kiểm tra `tests/test_api_surface_snapshot.py` và bộ test tương ứng sau mỗi bước commit.
  - **1 thay đổi logic/miền = 1 commit + file test độc lập**.
  - **Mục tiêu quy mô**: `main.py` rút gọn từ **4.599 dòng** ban đầu xuống còn **322 dòng** (giảm ~93%), chỉ đảm nhận khởi động ứng dụng và khởi tạo cửa sổ chính.

---

## 1. Chi tiết các Hạng mục Triển khai và Commits

| Bước | Hạng mục / Module trích xuất | File tạo mới / chỉnh sửa | Giải pháp kỹ thuật | Test File | Commit |
|---|---|---|---|---|---|
| **Step 1** | Trích xuất các hàm tiện ích thuần (Stateless Utilities) | `app/utils/paths.py`<br>`app/services/settings_store.py`<br>`app/desktop/themes.py`<br>`app/desktop/clipboard.py`<br>`app/bravo/xml_codec.py`<br>`main.py` | Di chuyển các hàm xử lý parser JSONC, chuyển đổi màu theme VSIX, clipboard Win32 ctypes/Tkinter, bộ mã hóa/giải mã XML Bravo (Deflate/Gzip/Zlib), và đọc/ghi file settings, snippets sang các module dịch vụ độc lập | `tests/test_phase6_step1_utilities.py` | `ecadcee` |
| **Step 2** | Trích xuất bộ xuất dữ liệu truy vấn dạng bảng | `app/desktop/exports.py`<br>`main.py` | Đưa `grid_open_in_excel` và `grid_save_results_as` ra `app/desktop/exports.py`; `BravoApi` và `MainApi` chuyển tiếp xử lý | `tests/test_phase6_step2_exports.py` | `1bf3a8d` |
| **Step 3** | Trích xuất quản lý cửa sổ & cầu nối Subwindow | `app/desktop/windows.py`<br>`main.py` | Di chuyển các class Subwindow API (`QueryHistorySubwindowApi`, `SettingsSubwindowApi`, `ProfilerSubwindowApi`, `EventListenerSubwindowApi`), các hàm mở cửa sổ con (`open_settings_window`, `open_profiler_window`, `open_event_listener_window`, `open_query_history_window`, `open_bravo_window`), titlebar DWM theming và IPC broadcast ra `app/desktop/windows.py` | `tests/test_phase6_step3_windows.py` | `cb90309` |
| **Step 4** | Phân tách `BravoApi` và `MainApi` thành Domain Mixins | `app/api/connections_api.py`<br>`app/api/settings_api.py`<br>`app/api/table_editor_api.py`<br>`app/api/designer_api.py`<br>`app/api/profiler_api.py`<br>`app/api/metadata_api.py`<br>`app/bravo/api.py`<br>`app/api/query_api.py`<br>`app/api/history_api.py`<br>`app/api/session_api.py`<br>`app/api/__init__.py`<br>`main.py` | Chia tách 96 phương thức của `BravoApi` và 55 phương thức của `MainApi` thành 10 class Mixin phân theo miền nghiệp vụ rõ ràng trong `app/api/` và `app/bravo/`. `BravoApi` và `MainApi` trong `main.py` chỉ định nghĩa kế thừa đa mixin, không trùng lặp method (đáp ứng AST parser check của Phase 3) | `tests/test_phase6_step4_mixins.py` | `f4c9d0a` |
| **Step 5** | Loại bỏ `__getattr__` catch-all tại Subwindow APIs, thiết lập Whitelist tường minh | `app/desktop/windows.py`<br>`tests/snapshots/api_surface.txt` | Xóa bỏ `def __getattr__(self, name)` chuyển tiếp tùy tiện tới `_main_api` ở cả 4 class Subwindow API. Khai báo tường minh tất cả các phương thức mà frontend của cửa sổ con thực sự gọi (bao gồm quản lý trace, stats lịch sử, clipboard). Cập nhật có chủ đích snapshot bề mặt API | `tests/test_phase6_step5_subwindow_whitelist.py` | `d7bcc4d` |
| **Hardening** | Bảo toàn tương thích ngược cho test monkeypatches | `app/api/history_api.py`<br>`app/api/query_api.py`<br>`app/api/settings_api.py`<br>`main.py` | Bổ sung cơ chế tra cứu delegate động cho các hàm thường được monkeypatch trong test suite (`main._save_settings_file`, `main._load_settings_file`, `main.get_history_service`), và xử lý an toàn kiểu chuỗi cho `dialect` khi nhận MagicMock adapter | `tests/test_logging_setup.py`<br>`tests/test_history_phase4_retention.py`<br>`tests/test_history_favorites_and_tags.py` | `b0bfa61` |

---

## 2. Cấu trúc Mô-đun Hóa Mới của Ứng dụng

```
IDE-SQL-Lite_New_Pyweb_Claude/
├── main.py                          # 322 dòng (Khởi động pywebview, cấu hình cửa sổ, tích hợp Mixin)
├── app/
│   ├── api/                         # Domain Mixins phục vụ pywebview js_api bridge
│   │   ├── __init__.py
│   │   ├── connections_api.py       # ConnectionsApiMixin (profiles, credentials, metadata)
│   │   ├── designer_api.py          # DesignerApiMixin (schema design, diff, preview, DDL)
│   │   ├── history_api.py           # HistoryApiMixin (27 methods lịch sử thực thi, tags, search)
│   │   ├── metadata_api.py          # MetadataApiMixin & MainMetadataApiMixin (explorer, dependency)
│   │   ├── profiler_api.py          # ProfilerApiMixin (trace control, status, sessions)
│   │   ├── query_api.py             # QueryApiMixin (execute_query, syntax, explain, plan, flow)
│   │   ├── session_api.py           # SessionApiMixin (save, load, clear workspace session)
│   │   ├── settings_api.py          # SettingsApiMixin (settings, themes, fonts, clipboard, styles)
│   │   └── table_editor_api.py      # TableEditorApiMixin (fetch, edit, tx, validation)
│   ├── bravo/
│   │   ├── api.py                   # BravoApiMixin (Bravo forms, programs, layout editor XML)
│   │   └── xml_codec.py             # Bravo XML syntax validator, compressor, beautifier
│   └── desktop/
│       ├── clipboard.py             # Native Win32 clipboard API (ctypes + fallbacks)
│       ├── exports.py               # Excel / CSV background tabular exports
│       ├── themes.py                # VSIX theme importer, JSONC cleaner, CSS generator
│       └── windows.py               # Subwindow APIs, DWM titlebar sync, IPC broadcast
```

---

## 3. Kết quả Kiểm thử Đối chiếu

| Bộ kiểm thử | Trước refactor (Phase 0 Baseline) | Sau Phase 6 | Đánh giá |
|---|---|---|---|
| **Tổng số test PASSED toàn repo** | **718 passed** | **852 passed** | Tăng thêm **+134 tests xanh**, toàn bộ chức năng đều ổn định |
| **Quy mô file `main.py`** | 4.599 dòng | **322 dòng** | **Giảm 93% số dòng**, đạt tiêu chuẩn dưới 600 dòng |
| **Test Snapshot Bề mặt API (`api_surface.txt`)** | Passed | **Passed (100%)** | `BravoApi` (93 methods) và `MainApi` (143 methods) giữ nguyên vẹn 100% |
| **Bộ test chuyên biệt Phase 6 (Steps 1–5)** | - | **22 passed (100%)** | 5 file test hồi quy cho 5 bước tách đều đạt kết quả xuất sắc |
| **Kiểm tra trùng lặp AST (`test_phase3_bug5`)** | Passed | **Passed (100%)** | `BravoApi` và `MainApi` không chứa bất kỳ method trùng tên nào |

---

## 4. Các [QUYẾT ĐỊNH] Đang Chờ cho Phase 7

Theo kế hoạch `.SKILL/update_program.md`:
1. **Số phận Flask routes**:
   - Khuyến nghị: Giữ làm kênh phụ nhưng gọi chung các mixin/service đã tách trong `app/api/`, không nhân đôi logic.
2. **Pipeline Cú pháp Mới (`validate_sql_pipeline`)**:
   - Nối vào `QueryApiMixin.syntax_check` sau cờ setting `syntax.pipeline` (mặc định tắt), đối chiếu kết quả trên bộ `tests/fixtures/sql_corpus/`.
3. **Phân phối ScriptDom DLL**:
   - Quyết định đóng gói DLL hay tiếp tục dò tìm trong cài đặt SSMS / Azure Data Studio của máy người dùng.
