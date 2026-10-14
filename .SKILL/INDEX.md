# Chỉ Mục Tài Liệu Kỹ Thuật (.SKILL/INDEX.md)

Tài liệu này phân loại toàn bộ 63 file trong thư mục `.SKILL/`, chỉ rõ file nào đang là **kế hoạch hiện hành cao nhất**, file nào là **đặc tả chức năng đang sử dụng**, và file nào là **tài liệu lịch sử / các phase đã hoàn thành**.

---

## 1. Kế hoạch hiện hành cao nhất (Active Master Plans)

Các tài liệu định hướng tổng thể cho mọi hoạt động refactor, hardening và sửa lỗi của dự án:

| File | Trạng thái | Mô tả / Mục đích |
|---|---|---|
| [update_program.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/update_program.md) | **HIỆU LỰC CAO NHẤT** | Kế hoạch chỉnh sửa theo Phase (Phase 0 đến Phase 8) dựa trên bản review chỉ-đọc ngày 12/10/2026. |
| [AGENTS.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/AGENTS.md) | **HIỆU LỰC** | Quy ước kiến trúc, nguyên tắc mã nguồn, và hướng dẫn nhiệm vụ dành cho các AI Agent. |
| [improve_general_program.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/improve_general_program.md) | **HIỆU LỰC** | Hướng dẫn cải tiến tổng thể trải nghiệm và độ ổn định của ứng dụng. |

---

## 2. Đặc tả chức năng đang sử dụng (Active Feature Specs)

Tài liệu mô tả chi tiết logic nghiệp vụ, giao tiếp IPC bridge và mô hình dữ liệu của các module chính:

### 2.1. Cốt lõi ứng dụng & Giao diện (Core & Desktop Shell)
- [general.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/general.md): Kiến trúc tổng quan hệ thống.
- [convert_project_to_pywebview.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/convert_project_to_pywebview.md): Đặc tả kiến trúc pywebview native bridge thay thế web truyền thống.
- [BRAVO_programlist.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/BRAVO_programlist.md): Quản lý danh sách chương trình Bravo và khởi chạy bảo mật.
- [s1_themes.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/s1_themes.md): Hệ thống theme màu, nạp file `.vsix` và CSS biến động.
- [taskbar_mofify_DWM.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/taskbar_mofify_DWM.md) & [taskbar_mofify_new.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/taskbar_mofify_new.md): Tùy biến titlebar và Windows Desktop Window Manager (DWM).
- [global_ide_ui_typography_skill.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/global_ide_ui_typography_skill.md): Thiết kế typography, font chữ toàn hệ thống.

### 2.2. Trình soạn thảo & Lịch sử (Editor & History)
- [text_editor_monaco.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/text_editor_monaco.md): Tích hợp Monaco Editor, cấu hình phím tắt và keybindings.
- [text_editor_history.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/text_editor_history.md): Quản lý lịch sử truy vấn SQLite (`history.db`), tag, star và diff view.
- [format-code_general.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/format-code_general.md) & [format-code_viewstyle.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/format-code_viewstyle.md): Bộ định dạng mã SQL và lưu trữ phong cách code (`code_styles.json`).
- [SQL_Parameter_Placeholder_Parse.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/SQL_Parameter_Placeholder_Parse.md): Nhận diện và parse placeholder tham số truy vấn (`@param`, `$1`).

### 2.3. Dữ liệu bảng & Thiết kế (Table Data Editor & Table Designer)
- [data_editor.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/data_editor.md) & [edtit_data_tabel.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/edtit_data_tabel.md): Chỉnh sửa dữ liệu bảng, phân trang, optimistic locking và validation.
- [design_table.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/design_table.md): Giao diện thiết kế bảng (Table Designer) và bộ sinh mã DDL di chuyển schema.
- [STRUCTURED_DATA_VIEWER.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/STRUCTURED_DATA_VIEWER.md): Trình xem và phân tích dữ liệu JSON, XML, Image trực quan.

### 2.4. Khám phá đối tượng & Giám sát (Explorer, Profiler, Analytics)
- [Object_Content_Search_SQL.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/Object_Content_Search_SQL.md): Tìm kiếm nội dung định nghĩa stored procedures, views, functions.
- [Object_Explorer_Filter_Context_Menu_Synonyms_Plan.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/Object_Explorer_Filter_Context_Menu_Synonyms_Plan.md): Cây đối tượng, bộ lọc nhiều tiêu chí và hỗ trợ Synonyms.
- [linkserver.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/linkserver.md): Kết nối và duyệt Linked Servers trong MSSQL.
- [postgres_dependcy_graph.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/postgres_dependcy_graph.md) & [Dependency Catalog trong PostgreSQL.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/Dependency Catalog trong PostgreSQL.md): Phân tích cây phụ thuộc đối tượng PostgreSQL.
- [postgres_event_listener.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/postgres_event_listener.md): Giám sát sự kiện kết nối PostgreSQL (NOTIFY/LISTEN).
- [profiler.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/profiler.md) & [ssms_profiler.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/ssms_profiler.md): Trình giám sát truy vấn Profiler kiểu SSMS.
- [query_plan_visualization.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/query_plan_visualization.md) & [sql_visualization.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/sql_visualization.md): Trực quan hóa cây kế hoạch thực thi (Execution Plan) và luồng truy vấn.
- [custom_function_debug.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/custom_function_debug.md): Cơ chế debug hàm/thủ tục SQL.

---

## 3. Hệ thống IntelliSense (Đặc tả hoàn chỉnh & Lịch sử triển khai)

- [SQL_INTELLISENSE_AGENT_SPEC.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/SQL_INTELLISENSE_AGENT_SPEC.md): **Đặc tả hoàn chỉnh nhất** về kiến trúc IntelliSense, phân tích ngữ cảnh và bộ gợi ý.
- [INTELLISENSE_KEYBOARD_TRIGGER_PLAN.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/INTELLISENSE_KEYBOARD_TRIGGER_PLAN.md) & [audit_phase1_keyboard_trigger.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/audit_phase1_keyboard_trigger.md): Điều khiển phím kích hoạt (Tab, Space, Enter, Dot).
- [intellisense_overview.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/intellisense_overview.md), [intellisense_improvement_plan_v2.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/intellisense_improvement_plan_v2.md), [INTELLISENSE_AUDIT.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/INTELLISENSE_AUDIT.md): Báo cáo kiểm toán và kế hoạch cải tiến.
- [intellisense_plan_web_001.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/.SKILL/intellisense_plan_web_001.md) đến `intellisense_plan_web_010.md`: Kế hoạch 10 phase triển khai chi tiết *(Đã hoàn thành và sáp nhập vào codebase)*.

---

## 4. Tài liệu lịch sử & Kế hoạch đã hoàn thành / Nghiên cứu sơ bộ (Historical / Prototypes)

Các tài liệu này dùng để tra cứu lịch sử quyết định thiết kế:

- `AGGrid_prototype.md`, `research_result_grid.md`, `research_result_grid_report.md`: Quá trình đánh giá và thử nghiệm AG-Grid đối ứng với lưới hiển thị kết quả.
- `auto_update.md`, `auto_update_detail.md`, `check_for_update_agent_skill.md`: Thiết kế ban đầu của tính năng tự động cập nhật qua GitHub/server.
- `SQL_Syntax_Check_Parser_Extension.md`, `sytax_check.md`: Bản nháp cú pháp sơ khởi *(Đã được cập nhật và thay thế bởi tài liệu chính thức trong `docs/`)*.
- `fix_whitescreen.md`: Hướng dẫn sửa màn hình trắng pywebview trong giai đoạn phát triển ban đầu.
- `FindAndReplace.md`, `menubar_new.md`, `setting_form.md`, `taskbar_mofify.md`: Ghi chú UI sơ khai.
