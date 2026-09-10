# Kế hoạch Triển khai IntelliSense cho Web SQL IDE (Web Platform)

Tài liệu này ghi nhận kế hoạch phân tích, thiết kế kiến trúc và triển khai hệ thống IntelliSense cho Web SQL Editor (`CodeMirror 5`) trong dự án `IDE-SQL-Lite_New`, tuân thủ 100% nguyên tắc cốt lõi từ [`.SKILL/intellisense_overview.md`](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New/.SKILL/intellisense_overview.md) và các kế hoạch đã hoàn thiện từ bản Desktop (`plan_001` đến `plan_005`).

---

## plan_web_001: Xây dựng Hệ thống IntelliSense Context-Aware Toàn diện cho Web IDE

- **Ngày tạo**: 2026-09-10
- **Trạng thái**: Đang chờ xác nhận từ người dùng (Pending Approval)
- **Mục tiêu**:
  1. Xây dựng toàn bộ hệ thống IntelliSense theo ngữ cảnh (Context-Aware) cho Web CodeMirror editor.
  2. Giao diện Popup 2 cột kéo thả kích thước (Dual-Panel Resizable): Cột trái gợi ý object có chiều rộng lớn hơn cột phải preview script/summary (`Object Suggestion width > Script / Summary width`).
  3. Phân cấp gợi ý: Level 1 (SQL Keywords ưu tiên trên cùng), Level 2 (Database & Script Objects).
  4. Gợi ý từ đơn liên tiếp theo ngữ cảnh (Contextual Follow-up Trigger) khi gõ khoảng trắng sau trigger keywords (`ALTER`, `CREATE`, `GROUP`, `ORDER`, `FROM`, `JOIN`...), tuyệt đối không gợi ý cụm từ ghép.
  5. Quét bảng tạm (`#temp`, `##temp`) và biến bảng (`@var`) cục bộ strictly trong nội dung file đang mở, không truy vấn database server.
  6. Cô lập Connection Context theo từng Tab: mỗi tab editor độc lập metadata theo `(connectionId, database, schema, dbType)`.
  7. Tích hợp Go to Definition (`F12` / Context menu) mở definition trong tab mới.
  8. Hỗ trợ ngữ cảnh `ALTER` / `CREATE OR ALTER` / `DROP`: chọn object tự động sinh DDL script vào editor và đặt con trỏ chuột ngay sau tên object trong dòng tiêu đề.
  9. Cơ chế chạy ngầm (Non-blocking): Debounce 120ms, client-side cache + backend cache, `limit=0` (`fetchall`) tránh mất object trong database lớn (như `Bravo10Setup` với 4,500+ objects).
  10. Tương tác chuột & bàn phím:
      - Hover chuột trên danh sách gợi ý cập nhật chi tiết không làm gián đoạn phím mũi tên Lên/Xuống.
      - **Quan trọng (User feedback)**: Khung/Tab định nghĩa object (Summary Columns & Script Preview bên phải) **vẫn phải tương tác bình thường** (người dùng có thể click chuyển tab, chọn văn bản, cuộn, sao chép script...). Tuyệt đối không được làm mất popup khi người dùng rê chuột sang panel xem chi tiết này.
      - Click ra ngoài toàn bộ popup (`click outside`) hoặc di chuột rời xa hẳn khỏi toàn bộ popup (>35px) mới đóng popup.
  11. Chuẩn SSMS cho Results Tab & Lệnh PRINT: Xóa kết quả cũ khi chạy truy vấn mới; tự động ẩn tab Results khi không có dữ liệu bảng và chuyển sang Messages; hiển thị thông điệp PRINT trên Messages.

---

### 1. Phân tích Yêu cầu & Kiến trúc Tổng thể

Kiến trúc phân tầng rõ ràng theo Section 19 của `intellisense_overview.md`:

```text
CodeMirror Editor (editor.js)
       │
       ▼
IntelliSense Controller (intellisense.js)
       ├── Context Analyzer (context-analyzer.js) [Pure JS: tokens, clauses, aliases, #temp, @var]
       ├── Completion Popup UI (Dual-panel resizable overlay with QSplitter-like CSS)
       └── Client Cache (partitioned by conn_id::db::schema)
               │
               ▼ (Async fetch with debounce 120ms)
Flask Backend Routes (/api/metadata/<conn_id>/intellisense/...)
       │
       ▼
Metadata Service (app/services/metadata_service.py)
       │
       ▼
DB Adapters (SqlServerAdapter / PostgreSqlAdapter with limit=0)
```

---

### 2. Thiết kế Chi tiết các Thành phần

#### 2.1. Backend API (Flask)
Tạo các endpoint metadata tối ưu cho IntelliSense trong `app/routes/metadata.py` và `app/services/metadata_service.py`:
1. `GET /api/metadata/<connection_id>/intellisense/objects?database=...&schema=...`:
   - Truy vấn toàn bộ objects (tables, views, procedures, functions, triggers, synonyms) trong **1 câu lệnh duy nhất** với `limit=0`.
   - SQL Server: Dùng câu lệnh chuẩn đã được kiểm chứng tại `plan_005`:
     ```sql
     SELECT o.name, s.name AS schema_name, RTRIM(o.type) AS type, base.base_object_name
     FROM [{database}].sys.objects o
     JOIN [{database}].sys.schemas s ON o.schema_id = s.schema_id
     LEFT JOIN [{database}].sys.synonyms base ON o.object_id = base.object_id
     WHERE o.type IN ('U', 'V', 'P', 'PC', 'X', 'FN', 'IF', 'TF', 'FS', 'FT', 'AF', 'TR', 'SN', 'SO')
       AND LOWER(s.name) = LOWER(?)
     UNION ALL
     SELECT tr.name, 'dbo' AS schema_name, 'TR' AS type, NULL AS base_object_name
     FROM [{database}].sys.triggers tr
     WHERE tr.parent_id = 0
     ORDER BY 1
     ```
   - PostgreSQL: Truy vấn `information_schema.tables`, `routines`, `triggers`.
   - Kết quả được cache trong `MetadataService` theo `(database, schema)`.
2. `GET /api/metadata/<connection_id>/intellisense/columns?database=...&schema=...&table=...`:
   - Trả về danh sách cột kèm: `name`, `type_name`, `max_length`, `precision`, `scale`, `is_nullable`, `is_pk`.
3. `GET /api/metadata/<connection_id>/intellisense/parameters?database=...&schema=...&name=...`:
   - Trả về danh sách tham số của Stored Procedure / Function: `name`, `type_name`, `is_output`.
4. `GET /api/metadata/<connection_id>/definition?database=...&schema=...&name=...&type=...`:
   - Lấy DDL script định nghĩa của object (hiển thị preview script và sinh script khi ALTER).

#### 2.2. Context Analyzer Frontend (`static/js/context-analyzer.js`)
Chuyển đổi hoàn toàn bộ phân tích ngữ cảnh từ Python sang JavaScript:
- `SQL_KEYWORDS`: Danh sách từ khóa đơn 100% (gồm cả `PRINT`).
- `SQL_FUNCTIONS`: Danh sách các hàm chuẩn SQL (`COUNT`, `SUM`, `GETDATE`...).
- `FOLLOW_UP_KEYWORDS`: Ánh xạ từ khóa tiếp theo cho `ALTER`, `CREATE`, `CREATE OR`, `DROP`, `GROUP`, `ORDER`, `INSERT`, `DELETE`, `TRUNCATE`, `INNER`, `LEFT`, `RIGHT`, `FULL`, `CROSS`, `PRIMARY`, `FOREIGN`, `UNION`...
- `extractLocalTempTables(sqlText)`: Regex trích xuất `#temp`, `##temp` trong phạm vi file hiện thời.
- `extractLocalTableVars(sqlText)`: Regex trích xuất `DECLARE @var TABLE (...)` trong phạm vi file hiện thời.
- `extractAliases(sqlText)`: Quét mệnh đề `FROM` và `JOIN` để lập bản đồ alias -> `{schema, table}`.
- `detectClause(textBeforeCursor)`: Xác định mệnh đề SQL hiện tại (`SELECT`, `FROM`, `WHERE`, `JOIN`, `ON`, `GROUP BY`, `ORDER BY`...).
- `detectAlterContext(textBeforeCursor)`: Phát hiện người dùng đang gõ câu lệnh `ALTER`, `DROP`, `CREATE OR ALTER` cho `PROCEDURE`, `FUNCTION`, `TRIGGER`, `VIEW`, `TABLE`.
- `analyze(fullSql, cursorIndex)`: Trả về đối tượng `SqlContext` hoàn chỉnh (currentWord, qualifier, clause, previousToken, followUpKeywords, aliasMap, localTempTables, localTableVars, isAlterContext).

#### 2.3. Completion Popup UI & CSS (`editor.html`, `static/css/editor.css`)
Xây dựng giao diện popup nổi dual-panel đặt tại tọa độ con trỏ của CodeMirror:
```text
┌─────────────────────────────────────────────────────────────┐
│ 🔍 Suggestions (420px)         │ ℹ Summary & Script (320px)  │
│ [Table] Customer               │ --------------------------- │
│ [View]  Customer_View          │ Columns:                    │
│ [Proc]  Customer_Get           │ - Id (int, PK)              │
│ [Func]  fn_Customer_Balance    │ - Code (nvarchar(50))       │
│ [Temp]  #temp_orders           │ --------------------------- │
│ [Var]   @tbl_items             │ DDL Script Preview...       │
└─────────────────────────────────────────────────────────────┘
```
- **Quy tắc kích thước**: Chiều rộng cột gợi ý bên trái luôn lớn hơn khung preview bên phải (mặc định 420px : 320px = 740px tổng).
- **Splitter resizer**: Thanh ngăn cách giữa 2 cột có thể kéo thả chuột để co giãn chiều rộng.
- **Badge loại đối tượng**: Hiển thị rõ ràng badge `[Table]`, `[View]`, `[Procedure]`, `[Function]`, `[Trigger]`, `[Synonym]`, `[Column]`, `[Keyword]`, `[Temp Table]`, `[Table Var]`.
- **Theme**: Sử dụng hệ thống CSS Variable của IDE (`--ide-bg-panel`, `--ide-border`, `--ide-accent`, `--ide-text-main`, `--ide-text-muted`) tương thích hoàn hảo Dark/Light mode.

#### 2.4. IntelliSense Controller (`static/js/intellisense.js`)
Điều phối tương tác giữa CodeMirror và hệ thống gợi ý:
- Lắng nghe sự kiện `change`, `cursorActivity`, `keydown` trên CodeMirror.
- **Debounce timer**: 120ms đảm bảo tốc độ gõ phím không bị delay.
- **Connection Isolation**:
  - Luôn đọc `(connectionId, database, schema, dbType)` từ active tab qua `window.AppTabs.getActiveTabState()`.
  - Bộ nhớ cache phân vùng theo `connId::database::schema`.
- **Phân cấp gợi ý**:
  - Khớp từ khóa: Ưu tiên Level 1 (Keywords) lên đầu danh sách.
  - Ngữ cảnh `FROM` / `JOIN`: Ưu tiên bảng, views, synonyms, `#temp`, `@var`.
  - Ngữ cảnh dot (`c.` hoặc `dbo.`): Gợi ý các cột của bảng tương ứng hoặc các object thuộc schema.
- **Điều khiển phím**:
  - Mũi tên `Up` / `Down`: Duyệt danh sách (tự động cuộn và đồng bộ chi tiết cột/script).
  - `PageUp` / `PageDown`: Nhảy trang.
  - `Enter` / `Tab`: Chấp nhận gợi ý.
    - Nếu là keyword có follow-up (`ALTER`, `CREATE`...): Thêm dấu cách và kích hoạt gợi ý từ đơn tiếp theo.
    - Nếu là ngữ cảnh `ALTER` / `CREATE OR ALTER`: Gọi API lấy DDL script, chèn toàn bộ vào editor, đặt con trỏ chuột ngay sau tên object trong dòng tiêu đề.
  - `Escape`: Đóng popup.
  - `Ctrl + Space`: Kích hoạt IntelliSense thủ công.
- **Tương tác chuột**:
  - Di chuột qua item (`mouseenter` / `mousemove`): Đồng bộ ngay item đang chọn và cập nhật Summary/Script mà không làm mất focus phím mũi tên.
  - Click ra ngoài (`click outside`) hoặc di chuột ra xa (>35px): Đóng popup ngay lập tức.
- **Go to Definition**:
  - Bắt phím `F12` hoặc bấm "Go to Definition" trên Context Menu của Editor.
  - Lấy từ dưới con trỏ -> Xác định object trong schema hiện thời -> Tải definition script -> Mở tab query mới (`AppTabs.createTab({ title: objectName + '.sql', content: ddlScript })`).

#### 2.5. SSMS Parity cho Results Tab & PRINT Statements
- Cập nhật trong `static/js/query.js`:
  - Khi người dùng nhấn thực thi (`F5`, `Ctrl+E`): Lập tức gọi hàm clear/reset dữ liệu Results cũ.
  - Khi nhận kết quả từ backend:
    - Nếu có bảng dữ liệu (`rows.length > 0` hoặc `columns.length > 0`): Hiển thị tab "Results" và active tab đó.
    - Nếu câu lệnh không trả về bảng dữ liệu (chẳng hạn `PRINT`, `INSERT`, `UPDATE`, `CREATE`, `ALTER`): Tự động ẩn tab "Results" và chuyển focus sang tab "Messages".
    - Trích xuất thông điệp in ra từ lệnh `PRINT` và hiển thị trên tab Messages.

---

### 3. Kế hoạch Kiểm thử & Nghiệm thu (Verification)

1. **Kiểm thử Unit Tests Backend**:
   - Viết bài test kiểm tra các endpoint `/api/metadata/<conn_id>/intellisense/objects`, `/columns`, `/parameters`.
   - Kiểm tra `limit=0` không làm mất object trong database lớn.
2. **Kiểm thử Phân tích Ngữ cảnh Context Analyzer**:
   - Kiểm tra gợi ý từ đơn: 100% keywords là từ đơn không chứa khoảng trắng.
   - Kiểm tra follow-up keywords: `ALTER ` -> gợi ý `TABLE`, `VIEW`, `PROCEDURE`...
   - Kiểm tra quét bảng tạm `#temp` và biến bảng `@var` trong file hiện thời.
   - Kiểm tra alias mapping: `FROM Customer c` -> `c.` gợi ý các cột của `Customer`.
3. **Kiểm thử Giao diện & Tương tác**:
   - Popup hiển thị 2 cột, chiều rộng gợi ý lớn hơn preview script, có thể kéo giãn resizer.
   - Phím mũi tên Lên/Xuống, Enter/Tab chèn từ chính xác.
   - Click outside và di chuột ra xa đóng popup.
   - Chèn script khi ALTER đặt con trỏ ngay sau tên object.
   - F12 mở tab mới chứa definition.
   - Ẩn/hiện tab Results và hiển thị lệnh PRINT chuẩn SSMS.
