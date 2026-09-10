# IntelliSense Overview Skill

# Tổng quan Skill IntelliSense

## 1. Purpose / Mục đích

### Tiếng Việt

Skill này định nghĩa phạm vi, nguyên tắc và yêu cầu tổng quan để xây dựng IntelliSense cho SQL Text Editor của IDE.

Mục tiêu chính:

- Cung cấp IntelliSense khi người dùng viết SQL.
- Gợi ý object của database hiện tại: table, view, procedure, function, trigger, synonym và các object khác mà DBMS hỗ trợ.
- Gợi ý column phù hợp với ngữ cảnh SQL.
- Hiển thị thông tin bổ sung của object được chọn:
  - Script/definition.
  - Summary/metadata.
- Hỗ trợ nhiều connection, nhiều server và nhiều loại database đồng thời.
- Luôn xác định đúng connection/session/database/schema của editor hiện tại.
- Hỗ trợ SQL Server và PostgreSQL theo kiến trúc có thể mở rộng cho DBMS khác.
- Tham khảo hành vi IntelliSense của SQL Prompt, nhưng không sao chép cứng kiến trúc của SQL Prompt.
- Ưu tiên hiệu năng và không làm chậm thao tác gõ SQL.

### English

This skill defines the scope, principles, and high-level requirements for building IntelliSense for the IDE's SQL Text Editor.

Primary goals:

- Provide IntelliSense while users write SQL.
- Suggest database objects such as tables, views, procedures, functions, triggers, synonyms, and other DBMS-supported objects.
- Suggest columns according to SQL context.
- Display additional information for the selected object:
  - Script/definition.
  - Summary/metadata.
- Support multiple connections, servers, and database types simultaneously.
- Always resolve the correct connection/session/database/schema belonging to the current editor.
- Support SQL Server and PostgreSQL through an extensible architecture for future DBMS providers.
- Use SQL Prompt behavior as a reference, without hard-coding its architecture.
- Prioritize performance and avoid slowing down SQL typing.

---

## 2. Mandatory Workflow / Quy trình bắt buộc

### Tiếng Việt

Không được bắt đầu implementation ngay khi nhận yêu cầu thay đổi IntelliSense.

Trước khi thực hiện bất kỳ thay đổi có ảnh hưởng đến kiến trúc, UI, behavior, metadata, connection handling hoặc performance:

1. Phân tích yêu cầu.
2. Kiểm tra các assumption và dependency liên quan.
3. Kiểm tra concept UI trong thư mục `intellisense` khi thay đổi giao diện.
4. Đề xuất phương án implementation.
5. Nêu rõ các trade-off, rủi ro và điểm có thể ảnh hưởng đến hệ thống hiện tại.
6. Chờ user xác nhận.
7. Chỉ sau khi user xác nhận mới thực hiện thay đổi.
8. Ghi lại thay đổi vào `.SKILL/intellisense_plan.md`.

Mỗi lần thay đổi phải tạo một plan mới:

```text
plan_001
plan_002
plan_003
...
```

Không xóa hoặc ghi đè các plan trước đó.

File lịch sử:

```text
.SKILL/
└── intellisense_plan.md
```

### English

Do not start implementation immediately when an IntelliSense change is requested.

Before implementing any change affecting architecture, UI, behavior, metadata, connection handling, or performance:

1. Analyze the requirement.
2. Check relevant assumptions and dependencies.
3. Inspect UI concepts in the `intellisense` directory when changing the UI.
4. Propose an implementation approach.
5. Explain trade-offs, risks, and potential impact on the existing system.
6. Wait for user confirmation.
7. Implement only after confirmation.
8. Record the change in `.SKILL/intellisense_plan.md`.

Every approved change must create a new plan:

```text
plan_001
plan_002
plan_003
...
```

Never delete or overwrite previous plans.

History file:

```text
.SKILL/
└── intellisense_plan.md
```

---

## 3. UI Concept / Concept giao diện

### Tiếng Việt

Khi triển khai hoặc thay đổi UI IntelliSense, phải tham khảo concept trong thư mục:

```text
intellisense
```

Không tự ý thay đổi visual language nếu concept đã mô tả thành phần tương ứng.

UI IntelliSense cần có khu vực gợi ý object và khu vực thông tin chi tiết.

Concept tổng quát:

```text
┌─────────────────────────────────────────────────────────────┐
│ Object Suggestion              │ Script / Summary            │
│                                │                            │
│ Table                          │ Object Name                │
│ View                           │ Object Type                │
│ Procedure                      │                            │
│ Function                       │ Columns / Parameters       │
│ Trigger                        │                            │
│ Synonym                        │ Script / Definition        │
└─────────────────────────────────────────────────────────────┘
```

Các panel/menu gợi ý phải hỗ trợ resize bằng thao tác kéo thả khi concept và implementation cho phép.

**Quy tắc kích thước hiển thị popup gợi ý**:

- Panel danh sách gợi ý object bên trái luôn luôn phải có kích thước mặc định rộng hơn panel script / summary bên phải (`Object Suggestion width > Script / Summary width`), đảm bảo hiển thị đầy đủ tên object và badge loại đối tượng mà không bị cắt bớt hay thu nhỏ quá mức.

Thiết kế phải để dành khả năng cho user tùy chỉnh layout trong tương lai.

### English

When implementing or changing IntelliSense UI, inspect the concepts in:

```text
intellisense
```

Do not arbitrarily change the visual language when the concept already defines the corresponding component.

The IntelliSense UI should provide an object suggestion area and a detail information area.

High-level concept:

```text
┌─────────────────────────────────────────────────────────────┐
│ Object Suggestion              │ Script / Summary            │
│                                │                            │
│ Table                          │ Object Name                │
│ View                           │ Object Type                │
│ Procedure                      │                            │
│ Function                       │ Columns / Parameters       │
│ Trigger                        │                            │
│ Synonym                        │ Script / Definition        │
└─────────────────────────────────────────────────────────────┘
```

Suggestion/detail panels should support drag-to-resize where supported by the concept and implementation.

**Popup Sizing Proportions**:

- The object suggestion panel on the left must always have a default width larger than the script/summary preview panel on the right (`Object Suggestion width > Script / Summary width`), ensuring full object names and type badges are clearly readable without truncation.

The design must allow future user customization of the layout.

---

## 4. Database Metadata / Metadata Database

### Tiếng Việt

IntelliSense phải lấy metadata từ database thông qua database-specific metadata provider.

Không hard-code SQL Server metadata logic vào core IntelliSense.

Kiến trúc khuyến nghị:

```text
IntelliSense Core
       │
       ▼
Metadata Provider
       ├── SQL Server
       ├── PostgreSQL
       └── Future DBMS
```

### SQL Server

Có thể sử dụng các system catalog phù hợp, bao gồm nhưng không giới hạn:

- `sys.objects`
- `sys.tables`
- `sys.columns`
- `sys.views`
- `sys.procedures`
- `sys.sql_modules`
- `sys.triggers`
- `sys.synonyms`
- Các system catalog liên quan khác.

Phải xem xét metadata ở database/schema/object level.

### PostgreSQL

Có thể sử dụng:

- `pg_catalog`
- `information_schema`
- Các system catalog/view phù hợp khác.

Phải xác định đúng schema, relation, function, trigger và object definition theo PostgreSQL.

### English

IntelliSense must retrieve database metadata through database-specific metadata providers.

Do not hard-code SQL Server metadata logic into the IntelliSense core.

Recommended architecture:

```text
IntelliSense Core
       │
       ▼
Metadata Provider
       ├── SQL Server
       ├── PostgreSQL
       └── Future DBMS
```

### SQL Server

Relevant system catalogs may include, but are not limited to:

- `sys.objects`
- `sys.tables`
- `sys.columns`
- `sys.views`
- `sys.procedures`
- `sys.sql_modules`
- `sys.triggers`
- `sys.synonyms`
- Other relevant system catalogs.

Metadata must be resolved at the database/schema/object level.

### PostgreSQL

Relevant sources may include:

- `pg_catalog`
- `information_schema`
- Other appropriate PostgreSQL system catalogs/views.

Schema, relation, function, trigger, and object definitions must be resolved correctly.

---

## 5. Object Suggestions / Gợi ý Object

### Tiếng Việt

IntelliSense phải có khả năng gợi ý object dựa trên token và SQL context.

Object types tối thiểu:

- Table
- View
- Procedure
- Function
- Trigger
- Synonym
- Schema
- Column
- Các object khác được DBMS hỗ trợ.

Ví dụ:

```sql
SELECT *
FROM Cus
```

Có thể gợi ý:

```text
Customer
CustomerGroup
CustomerView
Customer_Get
Customer_Insert
```

Không được chỉ tìm kiếm theo tên. Kết quả phải được lọc theo context khi có thể xác định.

**Quy tắc phân cấp & mức độ gợi ý (Suggestion Levels & Prioritization)**:

- **Level 1: Các keyword của SQL**:
  - Luôn được ưu tiên hiển thị đầu tiên (trên cùng) trong danh sách gợi ý khi khớp ký tự người dùng gõ trong câu lệnh thông thường.
  - Bao gồm các từ khóa chuẩn của SQL (như `SELECT`, `FROM`, `WHERE`, `JOIN`, `ALTER`, `CREATE`, `TABLE`, `VIEW`, `COLUMN`, `ORDER`, `GROUP`, `BY`, v.v.).
- **Level 2: Các object của Database & Script**:
  - Hiển thị tiếp sau Level 1 khi cùng khớp ký tự.
  - Bao gồm: Tables, Views, Procedures, Functions, Triggers, Synonyms, Columns.
  - Bao gồm các đối tượng tạm thời cục bộ trong file: Bảng tạm (`#temp`, `##temp`) và Biến bảng (`@var`).

**Quy tắc kiểm tra từ vừa nhập & Tách từ khóa theo ngữ cảnh liên tiếp (Contextual Follow-up Trigger)**:

- **Kiểm tra từ vừa nhập khi gõ phím khoảng trắng (space) hoặc ký tự kế tiếp**:
  - Sau khi hoàn thành một từ khóa (nhập hoặc chọn từ gợi ý kèm phím cách), hệ thống lập tức kiểm tra từ khóa vừa nhập (`previous_token`) để gợi ý các bước tiếp theo phù hợp với cú pháp SQL mà không bắt buộc người dùng phải gõ thêm ký tự.
- **Nguyên tắc từ đơn kế tiếp (Không gợi ý combo từ ghép)**:
  - Tuyệt đối không gợi ý các cụm từ ghép (như `ALTER TABLE`, `ALTER VIEW`, `GROUP BY`, `INNER JOIN`). Thay vào đó, phải tách thành từng từ đơn độc lập theo từng bước kế tiếp:
    - Gõ `ALTER` => kiểm tra từ vừa nhập là `ALTER` để gợi ý danh sách từ đơn: `TABLE`, `VIEW`, `PROCEDURE`, `FUNCTION`, `TRIGGER`, `COLUMN`, `DATABASE`, `SCHEMA`, `INDEX`.
    - Sau khi chọn `TABLE` => nội dung thành `ALTER TABLE` => tiếp tục gợi ý các bảng (Level 2) hoặc `ALTER`, `ADD`, `DROP`.
    - Nếu viết `ALTER TABLE tbl ALTER` => kiểm tra từ vừa nhập là `ALTER` trong ngữ cảnh bảng => gợi ý `COLUMN`.
    - Gõ `CREATE` => gợi ý các từ đơn: `TABLE`, `VIEW`, `PROCEDURE`, `FUNCTION`, `TRIGGER`, `INDEX`, `DATABASE`, `SCHEMA`, `OR`...
    - Gõ `CREATE OR` => gợi ý: `ALTER`, `REPLACE`.
    - Gõ `GROUP` hoặc `ORDER` => gợi ý: `BY`.
    - Gõ `INSERT` => gợi ý: `INTO`.
    - Gõ `DELETE` => gợi ý: `FROM`.
    - Gõ `TRUNCATE` => gợi ý: `TABLE`.
    - Gõ `INNER`, `LEFT`, `RIGHT`, `FULL`, `CROSS` => gợi ý: `JOIN`.
    - Gõ `PRIMARY` hoặc `FOREIGN` => gợi ý: `KEY`.
    - Gõ `UNION` => gợi ý: `ALL`.
- **Ngữ cảnh mệnh đề nguồn dữ liệu (FROM / JOIN)**:
  - Khi người dùng gõ `FROM` hoặc `JOIN`:
    - Kiểm tra từ vừa nhập là `FROM` hoặc `JOIN`, hệ thống ưu tiên gợi ý ngay các đối tượng nguồn dữ liệu (Level 2):
      - Các bảng thật (`Tables`), `Views`, `Synonyms` từ database hiện hành.
      - **Biến dạng bảng (`@table_var`)**: ví dụ `@table TABLE (...)` hoặc `@tbl` được khai báo trong file.
      - **Bảng tạm thời (`#temp_table`, `##temp_table`)**: ví dụ `CREATE TABLE #temp` hoặc `SELECT ... INTO #temp`.
  - **Phạm vi gợi ý bảng tạm thời & biến bảng (Strict Local File Scope)**:
    - Bảng tạm (`#temp`, `##temp`) và biến bảng (`@var`) **chỉ được quét và gợi ý trong phạm vi nội dung của file/editor đang lập**.
    - Tuyệt đối không gửi request truy vấn bảng tạm hay biến bảng lên server database.

### English

IntelliSense must suggest objects based on the current token and SQL context.

Minimum object types:

- Table
- View
- Procedure
- Function
- Trigger
- Synonym
- Schema
- Column
- Temporary Table (`#temp`, `##temp`)
- Table Variable (`@var`)
- Other DBMS-supported objects.

Example:

```sql
SELECT *
FROM Cus
```

Possible suggestions:

```text
Customer
CustomerGroup
CustomerView
Customer_Get
Customer_Insert
```

Suggestions should not be based only on name matching. Filter results according to SQL context whenever the context can be determined.

**Suggestion Levels & Prioritization**:

- **Level 1: SQL Keywords**:
  - Given highest priority at the top of suggestions in general SQL statements when characters match.
  - Standard SQL keywords (such as `SELECT`, `FROM`, `WHERE`, `JOIN`, `ALTER`, `CREATE`, `TABLE`, `VIEW`, `COLUMN`, `ORDER`, `GROUP`, `BY`, etc.).
- **Level 2: Database & Script Objects**:
  - Displayed following Level 1 keywords for matching prefixes.
  - Includes: Tables, Views, Procedures, Functions, Triggers, Synonyms, Columns.
  - Includes transient local script objects: Temporary Tables (`#temp`, `##temp`) and Table Variables (`@var`).

**Contextual Follow-Up Trigger & Step-by-Step Keyword Separation**:

- **Checking recently entered token on space or subsequent typing**:
  - Immediately upon entering or completing a trigger keyword (e.g. typing a keyword followed by space), inspect `previous_token` to provide next-step suggestions according to SQL syntax.
- **Single-word sequential progression (No compound combo keywords)**:
  - Never suggest compound phrases (e.g. `ALTER TABLE`, `ALTER VIEW`, `GROUP BY`, `INNER JOIN`). Separate them into consecutive single-word steps:
    - After typing `ALTER`, inspect previous token `ALTER` and suggest single words: `TABLE`, `VIEW`, `PROCEDURE`, `FUNCTION`, `TRIGGER`, `COLUMN`, `DATABASE`, `SCHEMA`, `INDEX`.
    - Selecting `TABLE` produces `ALTER TABLE`, followed by table objects or `ALTER`, `ADD`, `DROP`.
    - Typing `ALTER TABLE tbl ALTER` suggests `COLUMN`.
    - After typing `CREATE`, suggest: `TABLE`, `VIEW`, `PROCEDURE`, `FUNCTION`, `TRIGGER`, `INDEX`, `DATABASE`, `SCHEMA`, `OR`...
    - After typing `CREATE OR`, suggest: `ALTER`, `REPLACE`.
    - After typing `GROUP` or `ORDER`, suggest: `BY`.
    - After typing `INSERT`, suggest: `INTO`.
    - After typing `DELETE`, suggest: `FROM`.
    - After typing `TRUNCATE`, suggest: `TABLE`.
    - After typing `INNER`, `LEFT`, `RIGHT`, `FULL`, `CROSS`, suggest: `JOIN`.
    - After typing `PRIMARY` or `FOREIGN`, suggest: `KEY`.
    - After typing `UNION`, suggest: `ALL`.
- **Data Source Clause Context (FROM / JOIN)**:
  - When typing `FROM` or `JOIN`:
    - Inspect preceding token `FROM`/`JOIN` and immediately suggest table-like source objects (Level 2):
      - Database Tables, Views, Synonyms from the active connection and schema.
      - **Table variables (`@table_var`)**: e.g., `DECLARE @tbl TABLE (...)` declared in the current file.
      - **Temporary tables (`#temp_table`, `##temp_table`)**: e.g., `CREATE TABLE #temp` or `SELECT ... INTO #temp`.
  - **Strict Local File Scope for Temporary Objects**:
    - Temporary tables (`#temp`, `##temp`) and table variables (`@var`) **must be parsed and scoped strictly within the active editor text**.
    - Never query the server database for local script temporary tables or variables.

---

## 6. Column Suggestions / Gợi ý Column

### Tiếng Việt

Column suggestion phải hiểu SQL context.

Ví dụ:

```sql
SELECT c.
FROM Customer c
```

phải có khả năng xác định `c` là alias của `Customer` và gợi ý các column của object đó.

Phải cân nhắc các context:

- SELECT
- WHERE
- JOIN
- ON
- GROUP BY
- ORDER BY
- HAVING
- INSERT
- UPDATE
- MERGE
- Các context SQL khác tùy DBMS.

### English

Column suggestions must understand SQL context.

Example:

```sql
SELECT c.
FROM Customer c
```

The system should resolve `c` as the alias of `Customer` and suggest columns from that object.

Consider contexts including:

- SELECT
- WHERE
- JOIN
- ON
- GROUP BY
- ORDER BY
- HAVING
- INSERT
- UPDATE
- MERGE
- Other DBMS-specific SQL contexts.

---

## 7. Object Summary / Summary Object

### Tiếng Việt

Khi user chọn object trong suggestion, UI phải có thể hiển thị Summary phù hợp với loại object.

### Table / View

Hiển thị tối thiểu:

- Object name
- Object type
- Column name
- Data type
- Description/comment nếu có
- Thông tin metadata hữu ích khác nếu có.

### Procedure / Function

Hiển thị:

- Object name
- Object type
- Parameters
- Parameter data types
- Direction nếu DBMS hỗ trợ
- Return type đối với function
- Metadata liên quan khác.

### Trigger

Hiển thị các thông tin phù hợp như:

- Trigger name
- Target object
- Event
- Timing
- Definition/script khi có thể.

### English

When a user selects an object from the suggestion list, the UI should display an appropriate Summary based on the object type.

### Table / View

At minimum:

- Object name
- Object type
- Column name
- Data type
- Description/comment when available
- Other useful metadata when available.

### Procedure / Function

Display:

- Object name
- Object type
- Parameters
- Parameter data types
- Direction when supported by the DBMS
- Return type for functions
- Other relevant metadata.

### Trigger

Display relevant information such as:

- Trigger name
- Target object
- Event
- Timing
- Definition/script when available.

---

## 8. Script Preview / Script

### Tiếng Việt

Khu vực Script phải hiển thị definition/script của object được chọn khi metadata provider có thể lấy definition.

Script phải được lấy từ đúng database context của editor.

Không được lấy definition từ connection global hoặc connection cuối cùng được sử dụng trong IDE.

### English

The Script area must display the definition/script of the selected object when the metadata provider can retrieve it.

The script must be resolved using the editor's database context.

Never retrieve the definition from a global connection or the last connection used by the IDE.

---

## 9. ALTER / REPLACE Object Generation

### Tiếng Việt

Khi user đang viết các statement dạng:

- ALTER PROCEDURE
- ALTER FUNCTION
- ALTER TRIGGER
- CREATE OR ALTER
- CREATE OR REPLACE
- Các statement tương đương tùy DBMS

và chọn object từ IntelliSense, hệ thống phải có khả năng generate definition/script của object trực tiếp vào editor hiện tại khi behavior đó phù hợp với DBMS.

Ví dụ:

```sql
ALTER PROCEDURE Cus
```

Sau khi chọn `Customer_Get` và Enter:

```text
Resolve object
      ↓
Load definition
      ↓
Generate script
      ↓
Insert into current editor
      ↓
Set cursor right after object name
```

**Vị trí con trỏ sau khi sinh script**:

- Sau khi chèn script vào editor, vị trí con trỏ chuột phải được đặt ngay ở cuối cùng của tên object (ngay sau object name trong dòng tiêu đề định nghĩa ALTER/CREATE). Tuyệt đối không để con trỏ nhảy về cuối file.

Không được nhầm giữa:

```text
Normal object reference
```

và:

```text
Definition/ALTER/REPLACE context
```

### English

When the user is writing statements such as:

- ALTER PROCEDURE
- ALTER FUNCTION
- ALTER TRIGGER
- CREATE OR ALTER
- CREATE OR REPLACE
- DBMS-equivalent statements

and selects an object from IntelliSense, the system should be able to generate the object's definition/script directly into the current editor when supported by the DBMS behavior.

Example:

```sql
ALTER PROCEDURE Cus
```

After selecting `Customer_Get` and pressing Enter:

```text
Resolve object
      ↓
Load definition
      ↓
Generate script
      ↓
Insert into current editor
      ↓
Set cursor right after object name
```

**Cursor Position After Script Generation**:

- After inserting the generated script into the editor, the cursor must be positioned immediately after the object name in the definition header. It must never jump to the end of the file.

Do not confuse:

```text
Normal object reference
```

with:

```text
Definition/ALTER/REPLACE context
```

---

## 10. Go to Definition / Đi tới định nghĩa

### Tiếng Việt

Nếu user chọn tên object trong editor, có thể sử dụng:

- F12
- Context menu → Go to Definition

Luồng:

```text
Selected Object
      ↓
Resolve editor context
      ↓
Resolve object
      ↓
Load definition
      ↓
Open a new editor
```

Definition phải được mở ở editor/file mới, không ghi đè editor hiện tại.

Ví dụ:

```text
[query.sql] [Customer_Get.sql]
```

### English

When the user selects an object name in the editor, support:

- F12
- Context menu → Go to Definition

Flow:

```text
Selected Object
      ↓
Resolve editor context
      ↓
Resolve object
      ↓
Load definition
      ↓
Open a new editor
```

The definition must open in a new editor/file and must not overwrite the current editor.

Example:

```text
[query.sql] [Customer_Get.sql]
```

---

## 11. Connection Context Isolation / Cô lập Connection Context

### Tiếng Việt

Đây là requirement bắt buộc.

IDE có thể đồng thời kết nối:

- Nhiều server.
- Nhiều database.
- Nhiều connection.
- SQL Server.
- PostgreSQL.
- Các DBMS khác trong tương lai.

Mỗi editor/tab phải giữ context riêng, tối thiểu:

```text
Editor
 ├── ConnectionId
 ├── SessionId
 ├── DBMS Type
 ├── Server
 ├── Database
 └── Schema
```

Ví dụ:

```text
Editor A
Connection = SQLServer_01
Database   = DB_A

Editor B
Connection = SQLServer_02
Database   = DB_B

Editor C
Connection = PostgreSQL_01
Database   = DB_C
```

IntelliSense của Editor A không được lấy metadata của Editor B hoặc C.

Không sử dụng khái niệm `global current connection` làm nguồn duy nhất để resolve IntelliSense.

### English

This is a mandatory requirement.

The IDE may simultaneously connect to:

- Multiple servers.
- Multiple databases.
- Multiple connections.
- SQL Server.
- PostgreSQL.
- Future DBMS types.

Each editor/tab must retain its own context, at minimum:

```text
Editor
 ├── ConnectionId
 ├── SessionId
 ├── DBMS Type
 ├── Server
 ├── Database
 └── Schema
```

Example:

```text
Editor A
Connection = SQLServer_01
Database   = DB_A

Editor B
Connection = SQLServer_02
Database   = DB_B

Editor C
Connection = PostgreSQL_01
Database   = DB_C
```

IntelliSense for Editor A must never use metadata from Editor B or C.

Do not use a `global current connection` as the sole source for IntelliSense resolution.

---

## 12. SQL Server Synonyms / SQL Server Synonym

### Tiếng Việt

SQL Server Synonym phải được hỗ trợ trong object resolution.

Ví dụ:

```text
Database A
└── dbo.CustomerSynonym
        │
        └── Database B.dbo.Customer
```

Khi user đang ở Database A và sử dụng synonym, IntelliSense phải có khả năng:

1. Nhận diện object là synonym.
2. Resolve target của synonym.
3. Xác định database/schema/object đích.
4. Lấy metadata của target nếu connection/session có quyền và khả năng truy cập.
5. Không làm mất context của editor.

Không giả định synonym luôn trỏ đến object trong cùng database.

### English

SQL Server Synonyms must be supported during object resolution.

Example:

```text
Database A
└── dbo.CustomerSynonym
        │
        └── Database B.dbo.Customer
```

When the user is in Database A and uses the synonym, IntelliSense should be able to:

1. Identify the object as a synonym.
2. Resolve its target.
3. Determine the target database/schema/object.
4. Retrieve target metadata when the connection/session has access.
5. Preserve the editor's connection context.

Do not assume that a synonym always targets an object in the same database.

---

## 13. Editor Requirements / Yêu cầu Editor

### Tiếng Việt

Editor phải được thiết kế có khả năng mở rộng để sau này user có thể tùy chỉnh.

Default configuration:

```text
Tab Size   = 4
Line Space = 1.4
Font       = JetBrains Mono
```

Cursor status phải hiển thị:

```text
Ln 1, Col 1
```

theo vị trí thực tế của cursor.

Zoom:

- Có khả năng phóng to/thu nhỏ text.
- Hiển thị mức zoom hiện tại.
- Không làm mất thông tin `Ln`, `Col`.

### English

The editor must be designed for future extensibility and user customization.

Default configuration:

```text
Tab Size    = 4
Line Height = 1.3
Font        = JetBrains Mono
```

Cursor status must display:

```text
Ln 1, Col 1
```

based on the actual cursor position.

Zoom:

- Support text zoom in/out.
- Display the current zoom level.
- Keep `Ln`, `Col` information visible.

---

## 14. Code Folding / Thu gọn code

### Tiếng Việt

Các block SQL có thể fold phải có indicator:

```text
▼
```

khi đang mở và:

```text
▶
```

khi đang thu gọn.

Folding phải được thiết kế để có thể mở rộng cho nhiều loại SQL statement và block khác nhau.

### English

Foldable SQL blocks must display an indicator:

```text
▼
```

when expanded and:

```text
▶
```

when collapsed.

Folding must be designed for extensibility across different SQL statements and block types.

---

## 15. Lazy Syntax Highlighting / Lazy Syntax Highlighting

### Tiếng Việt

Syntax highlighting phải cân nhắc hiệu năng với file SQL lớn.

Không bắt buộc parse/highlight toàn bộ file mỗi lần nội dung thay đổi.

Ưu tiên:

```text
Visible viewport
      ↓
Parse / highlight visible region
      ↓
Lazy-load additional regions when needed
```

Khi file lớn, chỉ xử lý vùng cần thiết trước.

### English

Syntax highlighting must consider performance for large SQL files.

Do not reparse/highlight the entire file on every content change.

Prefer:

```text
Visible viewport
      ↓
Parse / highlight visible region
      ↓
Lazy-load additional regions when needed
```

For large files, process the required visible region first.

---

## 16. Database Error Messages / Hiển thị lỗi Database

### Tiếng Việt

Editor phải có khu vực/tab `Messages`.

Error message tối thiểu:

```text
Line
Column
Database Error Message
```

Ví dụ:

```text
┌──────┬──────┬─────────────────────────────────────┐
│ Line │ Col  │ Error                               │
├──────┼──────┼─────────────────────────────────────┤
│ 15   │ 12   │ Invalid column name 'CustomerCode' │
│ 22   │ 5    │ Invalid object name 'Customer'     │
└──────┴──────┴─────────────────────────────────────┘
```

Error phải hiển thị màu đỏ theo concept UI.

Double click vào error:

```text
Messages
   ↓
Double click
   ↓
Editor focus
   ↓
Navigate to line/column
```

Nếu DBMS cung cấp vị trí lỗi, phải sử dụng vị trí đó.

### English

The editor must provide a `Messages` area/tab.

Minimum error information:

```text
Line
Column
Database Error Message
```

Example:

```text
┌──────┬──────┬─────────────────────────────────────┐
│ Line │ Col  │ Error                               │
├──────┼──────┼─────────────────────────────────────┤
│ 15   │ 12   │ Invalid column name 'CustomerCode' │
│ 22   │ 5    │ Invalid object name 'Customer'     │
└──────┴──────┴─────────────────────────────────────┘
```

Errors must use the red error presentation defined by the UI concept.

Double-clicking an error must:

```text
Messages
   ↓
Double click
   ↓
Editor focus
   ↓
Navigate to line/column
```

When the DBMS provides an error location, use that location.

---

## 17. Performance Requirements / Yêu cầu hiệu năng

### Tiếng Việt

Performance là requirement cốt lõi.

Không được thực hiện database metadata query đồng bộ trên mỗi ký tự user gõ.

Không sử dụng flow kiểu:

```text
User types
   ↓
Query database
   ↓
Load all metadata
   ↓
Render
```

Ưu tiên:

```text
Editor Input
    ↓
Debounce
    ↓
Analyze SQL Context
    ↓
Check Cache
    ├── Hit → Return suggestions
    │
    └── Miss
          ↓
      Background metadata request
          ↓
      Cache result
          ↓
      Render suggestions
```

Phải cân nhắc:

- Debounce.
- Cancellation của request cũ.
- Background loading.
- Metadata cache.
- Cache theo connection/database/schema.
- Lazy loading.
- Chỉ load metadata cần thiết.
- Không load toàn bộ definition khi chưa cần.
- Virtualized suggestion list nếu danh sách lớn.
- Không block UI/editor thread.

Ví dụ khi user gõ nhanh:

```text
C
CU
CUS
CUST
```

request cũ không còn cần thiết phải được cancel hoặc bỏ qua kết quả stale.

### English

Performance is a core requirement.

Do not execute synchronous database metadata queries for every character typed.

Avoid:

```text
User types
   ↓
Query database
   ↓
Load all metadata
   ↓
Render
```

Prefer:

```text
Editor Input
    ↓
Debounce
    ↓
Analyze SQL Context
    ↓
Check Cache
    ├── Hit → Return suggestions
    │
    └── Miss
          ↓
      Background metadata request
          ↓
      Cache result
          ↓
      Render suggestions
```

Consider:

- Debouncing.
- Cancellation of obsolete requests.
- Background loading.
- Metadata caching.
- Cache partitioning by connection/database/schema.
- Lazy loading.
- Loading only required metadata.
- Avoiding definition loading until needed.
- Virtualized suggestion lists for large result sets.
- Never blocking the UI/editor thread.

When the user types quickly:

```text
C
CU
CUS
CUST
```

obsolete requests should be cancelled or their stale results ignored.

---

## 18. IntelliSense Context Analysis / Phân tích Context

### Tiếng Việt

IntelliSense phải phân tích context hiện tại thay vì chỉ thực hiện fuzzy search trên text.

Context analyzer nên có khả năng nhận biết:

- Current token.
- Previous token.
- SQL statement hiện tại.
- Alias.
- Database-qualified object.
- Schema-qualified object.
- Object-qualified column.
- SELECT/FROM/JOIN/WHERE/... context.
- ALTER/CREATE/REPLACE context.
- Cursor position.
- Quoted identifiers khi DBMS hỗ trợ.

Kiến trúc phải cho phép thay thế hoặc nâng cấp parser/context analyzer mà không phải viết lại metadata provider.

### English

IntelliSense must analyze the current context rather than only performing fuzzy text search.

The context analyzer should be able to identify:

- Current token.
- Previous token.
- Current SQL statement.
- Aliases.
- Database-qualified objects.
- Schema-qualified objects.
- Object-qualified columns.
- SELECT/FROM/JOIN/WHERE/... contexts.
- ALTER/CREATE/REPLACE contexts.
- Cursor position.
- Quoted identifiers where supported by the DBMS.

The architecture must allow the parser/context analyzer to be replaced or upgraded without rewriting metadata providers.

---

## 19. Extensibility / Khả năng mở rộng

### Tiếng Việt

Kiến trúc phải tách rõ:

```text
Editor
  ↓
IntelliSense UI
  ↓
Context Analyzer
  ↓
Metadata Service
  ↓
DB Adapter / Metadata Provider
```

DB-specific behavior phải nằm trong DB adapter/provider.

Không viết logic SQL Server/PostgreSQL trực tiếp vào UI.

Mục tiêu tương lai:

```text
SQL Server
PostgreSQL
Oracle
MySQL
MariaDB
...
```

Việc thêm DBMS mới phải chủ yếu là thêm metadata provider và DB-specific parser/behavior cần thiết, không phải viết lại IntelliSense core.

### English

The architecture must clearly separate:

```text
Editor
  ↓
IntelliSense UI
  ↓
Context Analyzer
  ↓
Metadata Service
  ↓
DB Adapter / Metadata Provider
```

DB-specific behavior must live inside the DB adapter/provider.

Do not place SQL Server/PostgreSQL logic directly inside the UI.

Future target:

```text
SQL Server
PostgreSQL
Oracle
MySQL
MariaDB
...
```

Adding a new DBMS should primarily require a new metadata provider and required DB-specific parser/behavior rather than rewriting the IntelliSense core.

---

## 20. Important Design Constraints / Ràng buộc thiết kế quan trọng

### Tiếng Việt

Mọi implementation IntelliSense phải cân nhắc đồng thời:

1. Correctness — gợi ý đúng context.
2. Connection isolation — đúng connection/session của editor.
3. Database awareness — đúng DBMS/database/schema.
4. Performance — không làm chậm typing.
5. Scalability — hoạt động với database có rất nhiều object.
6. Extensibility — hỗ trợ DBMS mới.
7. UI consistency — tuân thủ concept.
8. Cancellation — không để request cũ ghi đè kết quả mới.
9. Cache invalidation — metadata phải có cơ chế refresh/invalidate phù hợp.
10. Security — không expose metadata mà session hiện tại không có quyền truy cập.

Không được đánh đổi correctness của connection context chỉ để implementation đơn giản hơn.

### English

Every IntelliSense implementation must consider all of the following simultaneously:

1. Correctness — suggestions must match the current context.
2. Connection isolation — use the editor's connection/session.
3. Database awareness — resolve the correct DBMS/database/schema.
4. Performance — do not slow down typing.
5. Scalability — support databases with large numbers of objects.
6. Extensibility — support future DBMS providers.
7. UI consistency — follow the concept.
8. Cancellation — obsolete requests must not overwrite newer results.
9. Cache invalidation — provide an appropriate metadata refresh/invalidation mechanism.
10. Security — do not expose metadata that the current session is not authorized to access.

Do not sacrifice connection-context correctness merely to simplify implementation.

---

## 21. Acceptance Criteria / Tiêu chí nghiệm thu

### Tiếng Việt

Một implementation được xem là phù hợp với skill khi tối thiểu đáp ứng:

- [ ] Gợi ý object theo context.
- [ ] Gợi ý column theo alias/object.
- [ ] Hỗ trợ Table/View/Procedure/Function/Trigger/Synonym.
- [ ] Hiển thị Summary phù hợp với object type.
- [ ] Hiển thị Script/Definition.
- [ ] Hỗ trợ SQL Server metadata.
- [ ] Hỗ trợ PostgreSQL metadata.
- [ ] Resolve đúng editor connection/session.
- [ ] Hỗ trợ SQL Server Synonym.
- [ ] Hỗ trợ cross-database synonym khi có quyền truy cập.
- [ ] ALTER/CREATE OR ALTER/REPLACE có behavior generate script phù hợp.
- [ ] F12 → Go to Definition.
- [ ] Context menu → Go to Definition.
- [ ] Definition mở trong editor mới.
- [ ] Panel suggestion/detail có thể resize theo concept.
- [ ] Editor có tab size 4.
- [ ] Line height 1.3.
- [ ] JetBrains Mono.
- [ ] Ln/Col theo cursor.
- [ ] Editor zoom.
- [ ] Code folding.
- [ ] Lazy syntax highlighting.
- [ ] Messages hiển thị line/column/error.
- [ ] Double click error → focus đúng vị trí.
- [ ] Metadata loading không block typing/UI.
- [ ] Có cache/lazy loading/debounce/cancellation phù hợp.
- [ ] Không sử dụng global connection làm context duy nhất.
- [ ] Các quyết định thay đổi đã được ghi vào `intellisense_plan.md`.

### English

An implementation is considered aligned with this skill when it minimally satisfies:

- [ ] Context-aware object suggestions.
- [ ] Alias/object-aware column suggestions.
- [ ] Table/View/Procedure/Function/Trigger/Synonym support.
- [ ] Object-type-specific Summary.
- [ ] Script/Definition display.
- [ ] SQL Server metadata support.
- [ ] PostgreSQL metadata support.
- [ ] Correct editor connection/session resolution.
- [ ] SQL Server Synonym support.
- [ ] Cross-database synonym resolution when accessible.
- [ ] Appropriate script generation for ALTER/CREATE OR ALTER/REPLACE.
- [ ] F12 → Go to Definition.
- [ ] Context menu → Go to Definition.
- [ ] Definition opens in a new editor.
- [ ] Suggestion/detail panels can be resized according to the concept.
- [ ] Editor tab size 4.
- [ ] Line height 1.3.
- [ ] JetBrains Mono.
- [ ] Cursor-based Ln/Col.
- [ ] Editor zoom.
- [ ] Code folding.
- [ ] Lazy syntax highlighting.
- [ ] Messages showing line/column/error.
- [ ] Double-click error focuses the correct location.
- [ ] Metadata loading does not block typing/UI.
- [ ] Appropriate caching/lazy loading/debounce/cancellation.
- [ ] No global connection as the sole context source.
- [ ] All approved design changes are recorded in `intellisense_plan.md`.

---

## 22. Rule for Future Changes / Quy tắc cho các thay đổi sau này

### Tiếng Việt

Khi user yêu cầu thêm hoặc thay đổi bất kỳ behavior nào của IntelliSense:

- Không tự động coi requirement mới là thay thế requirement cũ.
- Kiểm tra conflict với các plan trước.
- Xác định impact đến:
  - UI.
  - Editor.
  - Context Analyzer.
  - Metadata Provider.
  - Connection/Session Manager.
  - Cache.
  - Performance.
- Đề xuất phương án trước.
- Chờ xác nhận.
- Sau khi xác nhận, cập nhật `intellisense_plan.md` bằng plan tiếp theo.

Nếu requirement mới mâu thuẫn với requirement cũ, phải nêu rõ conflict trước khi implementation.

### English

When the user requests any new or changed IntelliSense behavior:

- Do not assume the new requirement replaces an old requirement.
- Check for conflicts with previous plans.
- Identify impact on:
  - UI.
  - Editor.
  - Context Analyzer.
  - Metadata Provider.
  - Connection/Session Manager.
  - Cache.
  - Performance.
- Propose an approach first.
- Wait for confirmation.
- After confirmation, update `intellisense_plan.md` using the next plan number.

If a new requirement conflicts with an existing requirement, explicitly identify the conflict before implementation.

---

## 23. Final Principle / Nguyên tắc cuối cùng

### Tiếng Việt

IntelliSense không chỉ là một popup tìm kiếm tên object.

Đây là một hệ thống context-aware metadata service gắn với từng SQL editor, có khả năng hiểu SQL context, resolve database objects, truy vấn metadata theo DBMS, cache metadata, và tương tác trực tiếp với editor.

Mọi thiết kế phải ưu tiên:

```text
Correct Context
      ↓
Correct Metadata
      ↓
Correct Suggestion
      ↓
Fast Interaction
      ↓
Extensible Architecture
```

### English

IntelliSense is not merely a popup that searches object names.

It is a context-aware metadata service attached to each SQL editor, capable of understanding SQL context, resolving database objects, retrieving DBMS-specific metadata, caching metadata, and interacting directly with the editor.

Every design should prioritize:

```text
Correct Context
      ↓
Correct Metadata
      ↓
Correct Suggestion
      ↓
Fast Interaction
      ↓
Extensible Architecture
```

---

## 24. Query Execution, Results Tab & PRINT Statements / Thực thi truy vấn, Quản lý Tab Result & Lệnh PRINT

### Tiếng Việt

Khi người dùng thực thi truy vấn SQL:

1. **Reset kết quả khi chạy truy vấn mới**:
   - Khi bấm thực thi một truy vấn mới (F5 / Ctrl+E / Execute), hệ thống phải lập tức reset/clear nội dung tab kết quả cũ trước khi bắt đầu thực thi.
2. **Ẩn/Hiện Tab Result theo chuẩn SSMS**:
   - Nếu câu lệnh có trả về dữ liệu dạng bảng (`rows` > 0 hoặc `columns` có sẵn): Hiển thị tab "Results" và active tab này để hiển thị bảng dữ liệu.
   - Nếu câu lệnh không trả về dữ liệu dạng bảng (chẳng hạn như các lệnh `PRINT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP` hoặc gặp lỗi): Tự động ẩn/loại bỏ tab "Results" giống như SSMS, và chuyển sang hiển thị tab "Messages".
3. **Hỗ trợ lệnh PRINT & Hiển thị sang tab Messages**:
   - `PRINT` là một từ khóa SQL hợp lệ và phải có trong danh sách từ khóa SQL (syntax highlighting và IntelliSense).
   - Khi thực thi lệnh `PRINT`, kết quả in ra (PRINT output messages) phải được trích xuất từ driver/kết nối và hiển thị sang tab "Messages" tương tự như SSMS.

### English

When the user executes a SQL query:

1. **Reset previous results on new execution**:
   - Immediately upon executing a new query (F5 / Ctrl+E / Execute), previous result sets must be reset/cleared before the new query runs.
2. **SSMS-like Results Tab Visibility**:
   - If the statement returns tabular data (columns/rows present): Display and focus the "Results" tab.
   - If the statement does not return tabular data (such as `PRINT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, or execution errors): Automatically hide the "Results" tab (matching SSMS behavior) and switch focus to the "Messages" tab.
3. **PRINT Statement Support & Message Output**:
   - `PRINT` is a valid SQL keyword and must be recognized in both syntax highlighting and IntelliSense keywords.
   - Output from `PRINT` statements must be captured from the database driver/connection and displayed directly in the "Messages" tab.
