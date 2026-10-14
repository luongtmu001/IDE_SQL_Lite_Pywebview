# Kế hoạch: Object Explorer Filter, Context Menu và SQL Server Synonyms

## 1. Mục tiêu

Cải thiện Object Explorer theo 3 nhóm chức năng:

1. Chuẩn hóa cách hiển thị **filter/action menu** khi hover các node.
2. Nâng cấp **Filter Popup** từ một điều kiện thành nhiều điều kiện.
3. Bổ sung **New Query** vào context menu của Database/Object.
4. Riêng connection type `SSMS`, bổ sung node **Synonyms** và khả năng **Generate DDL Script**.

### Nguyên tắc bắt buộc

> **Không tự ý sửa các chức năng, UI hoặc logic không nằm trong phạm vi tài liệu này.**

Nếu trong quá trình triển khai phát hiện cần sửa thành phần dùng chung với chức năng khác:

1. Không tự động sửa.
2. Phân tích dependency.
3. Ghi rõ:
   - File/module bị ảnh hưởng.
   - Chức năng nào khác có thể bị tác động.
   - Mức độ ảnh hưởng: `Low / Medium / High`.
   - Lý do cần sửa.
   - Phương án thay thế nếu có.
4. Chỉ thực hiện thay đổi sau khi phạm vi ảnh hưởng được xác nhận.

---

# 2. Phạm vi tổng thể

| Hạng mục | Phạm vi |
| --- | --- |
| Hover Object Explorer node | Có |
| Filter action | Có |
| Action menu khi Object Explorer bị thu nhỏ | Có |
| Filter Popup | Có |
| Multiple filter conditions | Có |
| Context menu | Có |
| New Query | Có |
| Synonyms | Có, **chỉ SSMS connection** |
| Generate Synonym DDL | Có, **chỉ SSMS connection** |
| SQL Server Tables | Không thay đổi |
| SQL Server Views | Không thay đổi |
| Procedures | Không thay đổi |
| Functions | Không thay đổi |
| Triggers | Không thay đổi |
| PostgreSQL | Không thay đổi Synonym |
| IntelliSense | Không thay đổi |
| Query Editor | Chỉ mở query mới khi `New Query`, không sửa logic editor |
| Connection logic | Không thay đổi |

---

# 3. Phần 1 — Chỉnh sửa Filter và Action Menu

## 3.1. Hiện trạng

Object Explorer có các node như:

```text
Database
 └── dbo
      ├── Tables
      ├── Views
      ├── Procedures
      ├── Functions
      ├── Triggers
      ├── Sequences
      └── User Defined Types
```

Các node có hỗ trợ filter.

Hiện tại khi Object Explorer bị kéo nhỏ, phần action/filter có thể bị khuất hoặc bị container cắt.

### Vấn đề

Action menu đang phụ thuộc quá nhiều vào chiều rộng của Object Explorer.

Điều này làm giảm khả năng sử dụng khi user thu nhỏ sidebar.

---

# 4. 1.1 — Thiết kế lại Hover Action

## 4.1. Mục tiêu

Khi user hover vào các đối tượng hỗ trợ action:

- Database
- Object
- Collection

phải hiển thị action menu ở **bên phải node**, thay vì để action bị cắt theo chiều rộng của Object Explorer.

Ví dụ:

```text
Tables                         [⋮] [Filter]
Views                          [⋮] [Filter]
Procedures                     [⋮] [Filter]
```

Nếu không đủ chiều rộng, action menu có thể được hiển thị bằng cơ chế overlay/floating phù hợp với kiến trúc hiện tại.

---

## 4.2. Thứ tự ưu tiên hiển thị

Khi hover:

### Priority 1 — Action menu

Action của object phải được đảm bảo hiển thị trước.

### Priority 2 — Filter

Filter là một action trong nhóm thao tác của node.

### Priority 3 — Các action hiện có

Các chức năng đã tồn tại phải được giữ nguyên.

**Không được tự ý thêm action mới** ngoài những action được mô tả trong kế hoạch này.

---

## 4.3. Quy tắc positioning

Action menu phải:

- Nằm phía bên phải node.
- Không bị `overflow: hidden` của Object Explorer cắt.
- Không làm thay đổi chiều rộng node.
- Không làm thay đổi chiều rộng sidebar.
- Không gây horizontal scrollbar ngoài ý muốn.
- Không che nội dung quan trọng của node.
- Tự điều chỉnh vị trí nếu gần cạnh phải màn hình.

Ví dụ khi Object Explorer nhỏ:

```text
Tables             [⋮] [Filter]
```

Không được xảy ra tình trạng action bị cắt:

```text
Tables              [⋮
                     ↑
                  bị cắt
```

---

## 4.4. Những node cần kiểm tra

Phải kiểm tra toàn bộ node hiện đang hỗ trợ filter, không chỉ:

- Tables
- Views

Mà phải xác định implementation hiện tại đang áp dụng cho:

- Database
- Schema/Collection
- Tables
- Views
- Procedures
- Functions
- Triggers
- Sequences
- User Defined Types
- Các collection/object khác nếu hiện tại đã hỗ trợ filter.

**Không tự ý thêm filter cho node chưa hỗ trợ.**

---

# 5. 1.2 — Filter Popup hỗ trợ nhiều điều kiện

## 5.1. Hiện trạng

Filter popup hiện chỉ cho phép một điều kiện.

Ví dụ:

```text
Filter:
[ Customer________ ]

[Apply]
```

---

# 6. Thiết kế Filter mới

Chuyển thành mô hình:

```text
Filter

Field        Operator       Value
────────────────────────────────────
[Name ▼]     [Contains ▼]   [abc____] [−]

[+ Add condition]

Logic:
(AND ▼)

[Clear]                         [Apply]
```

Ví dụ:

```text
Name contains "customer"
AND
Schema equals "dbo"
```

---

# 7. Các thành phần của Filter Condition

Mỗi condition gồm:

```text
Field
Operator
Value
Remove
```

Ví dụ:

```text
[Name ▼] [Contains ▼] [customer____] [×]
```

---

## 7.1. Add condition

Khi user bấm:

```text
+ Add condition
```

thêm một dòng mới:

```text
Name       Contains       customer       [×]
Schema     Equals         dbo            [×]
```

Không giới hạn cứng số lượng condition nếu kiến trúc hiện tại không yêu cầu.

Tuy nhiên cần tránh tạo quá nhiều DOM component gây ảnh hưởng hiệu năng.

---

# 8. Logic kết hợp điều kiện

Phiên bản đầu tiên hỗ trợ:

```text
AND
OR
```

Ví dụ:

```text
Name contains "customer"
AND
Schema equals "dbo"
```

hoặc:

```text
Name contains "customer"
OR
Name contains "client"
```

### Giới hạn phạm vi

Không cần ngay lập tức xây dựng expression builder phức tạp kiểu:

```text
(A AND B) OR (C AND D)
```

nếu hệ thống hiện tại chưa có nhu cầu.

MVP chỉ cần:

```text
Condition 1
AND/OR
Condition 2
AND/OR
Condition 3
...
```

---

# 9. Operator

Operator phải phụ thuộc vào kiểu field.

Ví dụ đối với text:

```text
Contains
Starts with
Ends with
Equals
Not equals
```

Nếu filter hiện tại đã có danh sách operator thì **tái sử dụng danh sách hiện tại**, không tự ý thay đổi semantics.

Đối với object name, ưu tiên:

```text
Contains
Starts with
Equals
```

---

# 10. Filter State

Filter nhiều điều kiện phải được lưu dưới dạng cấu trúc thay vì một string duy nhất.

Ví dụ:

```javascript
{
    conditions: [
        {
            field: "name",
            operator: "contains",
            value: "customer"
        },
        {
            field: "schema",
            operator: "equals",
            value: "dbo"
        }
    ],
    logic: "AND"
}
```

Không nên tiếp tục ép nhiều điều kiện vào:

```javascript
filterText = "customer"
```

vì sau này sẽ khó mở rộng.

---

# 11. Clear Filter

Khi user chọn:

```text
Clear
```

phải:

1. Xóa toàn bộ conditions.
2. Reset UI.
3. Reset trạng thái filter của node.
4. Reload danh sách object.
5. Không ảnh hưởng filter của node khác.

Ví dụ:

```text
Tables
    filter A

Views
    filter B
```

Clear Tables không được làm mất filter của Views.

---

# 12. Ảnh hưởng dự kiến của phần Filter

### Mức độ: **Medium**

Có khả năng phải sửa các thành phần dùng chung:

```text
Object Explorer
Filter component
Filter state
Object loading/filtering
```

Nhưng **không được sửa database metadata query** nếu không cần thiết.

Nếu filter hiện tại được dùng chung cho SQL Server và PostgreSQL:

- Không thay đổi query riêng cho PostgreSQL chỉ để phục vụ UI multiple filter.
- Giữ behavior hiện tại.
- Chỉ thay đổi representation/filter condition ở mức cần thiết.

---

# 13. Phần 2 — Context Menu thêm New Query

## 13.1. Database

Context menu của Database bổ sung:

```text
New Query
──────────────
Refresh
...
```

Khi chọn `New Query`, IDE mở một query tab mới với connection/database tương ứng.

Ví dụ:

```text
Database: Bravo10Setup
```

thì query mới phải sử dụng:

```text
Connection = connection hiện tại
Database   = Bravo10Setup
```

---

# 14. Object Context Menu

Các object/database có context menu thì bổ sung:

```text
New Query
```

### Database

Query context:

```text
Connection
Database
```

### Schema/Collection

Nếu Query Editor hiện tại hỗ trợ schema context thì truyền:

```text
Connection
Database
Schema
```

### Object

Không được tự động biến `New Query` thành:

```sql
SELECT * FROM object
```

nếu user chưa yêu cầu.

`New Query` chỉ có nhiệm vụ mở query editor với context phù hợp.

---

# 15. Context Menu — không phá chức năng hiện tại

Các item hiện tại:

```text
Refresh
Generate Script
Delete
...
```

phải giữ nguyên.

Chỉ bổ sung:

```text
New Query
```

Không được tự ý:

- Đổi thứ tự toàn bộ menu.
- Đổi icon.
- Đổi shortcut.
- Đổi behavior của các item khác.

Nếu cần thay đổi vị trí `New Query`, ưu tiên đặt ở đầu menu:

```text
New Query
────────────
Refresh
...
```

---

# 16. Phần 3 — Synonyms cho SSMS Connection

## 16.1. Phạm vi

**Chỉ áp dụng khi connection type là `SSMS`.**

Không áp dụng cho:

- PostgreSQL
- MySQL
- SQLite
- Các connection type khác.

Nếu hệ thống hiện tại gọi connection type là tên khác như `sqlserver`, phải xác định chính xác mapping trước khi code.

Không được tự ý thay đổi kiến trúc connection chỉ để triển khai Synonyms.

---

# 17. Object Explorer mới

Trong Database, bổ sung:

```text
Bravo10Setup
└── dbo
    ├── Tables
    ├── Views
    ├── Procedures
    ├── Functions
    ├── Triggers
    ├── Sequences
    ├── Synonyms
    └── User Defined Types
```

Nếu kiến trúc hiện tại đặt `Synonyms` ở Database level thì phải tuân theo cấu trúc hiện tại.

**Không thay đổi hierarchy hiện tại chỉ để thêm Synonyms.**

---

# 18. SQL Server metadata cho Synonyms

Nguồn metadata dự kiến:

```sql
sys.synonyms
```

Các thông tin tối thiểu:

```sql
name
schema_id
base_object_name
object_id
```

Có thể join:

```sql
sys.schemas
```

để lấy schema.

Ví dụ concept:

```sql
SELECT
    s.name AS SchemaName,
    sy.name AS SynonymName,
    sy.base_object_name
FROM sys.synonyms sy
INNER JOIN sys.schemas s
    ON s.schema_id = sy.schema_id
ORDER BY
    s.name,
    sy.name;
```

**Không được hard-code database/schema cụ thể.**

---

# 19. Synonym hiển thị

Ví dụ:

```text
Synonyms
├── Customer
├── Item
├── Employee
└── Warehouse
```

Nếu UI hiện tại hỗ trợ metadata phụ có thể hiển thị:

```text
Customer
    dbo.Customer
    → [OtherDatabase].[dbo].[Customer]
```

Nhưng nếu UI hiện tại chỉ hiển thị object name thì không cần mở rộng UI ngoài phạm vi.

---

# 20. Filter Synonyms

Synonyms phải sử dụng cơ chế filter chung đã xây dựng ở phần 1.

Không tạo một filter component riêng cho Synonyms nếu không cần thiết.

Ví dụ:

```text
Synonyms
    [Filter]

    Customer
    CustomerOld
    CustomerRemote
```

Filter phải hoạt động giống các collection khác.

---

# 21. Generate DDL Script cho Synonym

Context menu:

```text
Synonym
 ├── New Query
 ├── Generate DDL Script
 ├── Refresh
 └── ...
```

Khi chọn:

```text
Generate DDL Script
```

IDE lấy metadata Synonym và tạo script tương ứng, ví dụ:

```sql
CREATE SYNONYM [dbo].[Customer]
FOR [OtherDatabase].[dbo].[Customer];
```

---

# 22. DDL phải phản ánh metadata thật

Không được tự xây dựng DDL bằng cách suy đoán.

Nguồn phải là:

```text
sys.synonyms
sys.schemas
```

`base_object_name` phải được xử lý đúng theo SQL Server.

Target có thể chứa:

```text
Database
Schema
Object
```

hoặc:

```text
Server
Database
Schema
Object
```

Do đó không được giả định target luôn có đúng 3 thành phần.

---

# 23. DDL Script — xử lý identifier

Tên:

- Schema
- Synonym
- Database
- Server
- Object

có thể chứa:

- Space
- `]`
- Reserved keyword
- Special character

Phải sử dụng cơ chế quote identifier phù hợp SQL Server.

Nếu hệ thống hiện tại đã có utility quote identifier thì **tái sử dụng utility đó**.

Không tạo thêm implementation khác nếu không cần thiết.

---

# 24. Generate DDL — không thực thi SQL

`Generate DDL Script` chỉ thực hiện:

```text
Metadata
    ↓
Generate Script
    ↓
Editor / Script panel
```

Không được tự động execute DDL.

---

# 25. Phân biệt New Query và Generate DDL

Hai chức năng phải độc lập.

### New Query

```text
Open empty query editor
```

### Generate DDL

```text
Read metadata
↓
Generate SQL
↓
Show SQL
```

Không được để `New Query` tự động generate DDL.

---

# 26. Kiến trúc triển khai đề xuất

```text
Object Explorer
      │
      ├── Node Hover Action
      │       ├── Filter
      │       └── Existing Actions
      │
      ├── Filter Popup
      │       ├── Condition[]
      │       ├── AND / OR
      │       └── Apply
      │
      ├── Context Menu
      │       └── New Query
      │
      └── SSMS Connection
              │
              └── Synonyms
                    ├── List
                    ├── Filter
                    ├── New Query
                    └── Generate DDL
```

---

# 27. Thứ tự triển khai

## Phase 1 — Khảo sát code hiện tại

**Không sửa code.**

Xác định:

- Component Object Explorer.
- Node rendering.
- Hover action.
- Filter component.
- Filter state.
- Context menu.
- New Query flow.
- Connection type detection.
- SQL Server metadata provider.
- Generate DDL infrastructure hiện tại.

### Output

Tạo dependency map:

```text
Object Explorer
 ├── Node
 ├── Hover Action
 ├── Filter
 ├── Context Menu
 └── Metadata Provider
```

---

# 28. Phase 2 — Hover Action

Thực hiện:

1. Xác định action hiện tại.
2. Tách positioning khỏi node width nếu cần.
3. Đưa action menu thành overlay/floating nếu phù hợp.
4. Đảm bảo hiển thị bên phải.
5. Kiểm tra Object Explorer ở:
   - Width bình thường.
   - Width nhỏ.
   - Width rất nhỏ.
   - Fullscreen.
   - Gần cạnh màn hình.

### Không sửa

- Node hierarchy.
- Metadata query.
- Filter logic.

---

# 29. Phase 3 — Multiple Filter

Thực hiện:

1. Refactor filter state.
2. Tạo `conditions[]`.
3. Render nhiều condition.
4. Add condition.
5. Remove condition.
6. AND/OR.
7. Apply.
8. Clear.
9. Giữ compatibility với filter hiện tại.

### Regression bắt buộc

Filter một điều kiện phải vẫn hoạt động giống trước:

```text
Contains customer
```

Không được thay đổi kết quả chỉ vì chuyển sang model multiple-condition.

---

# 30. Phase 4 — New Query

Thực hiện:

1. Thêm context menu item.
2. Reuse query-tab creation flow hiện tại.
3. Truyền connection context.
4. Truyền database context.
5. Không thay đổi editor.

---

# 31. Phase 5 — Synonyms

Chỉ kích hoạt:

```text
Connection.type === SSMS
```

Thực hiện:

1. Metadata query.
2. Node Synonyms.
3. Load list.
4. Refresh.
5. Filter.
6. Context menu.
7. Generate DDL.

---

# 32. Phase 6 — Regression Test

## Object Explorer

- [ ] Sidebar rộng.
- [ ] Sidebar nhỏ.
- [ ] Sidebar rất nhỏ.
- [ ] Hover node.
- [ ] Hover Database.
- [ ] Hover Collection.
- [ ] Action không bị cắt.
- [ ] Action cũ vẫn hoạt động.

## Filter

- [ ] Một condition.
- [ ] Hai conditions.
- [ ] Nhiều conditions.
- [ ] AND.
- [ ] OR.
- [ ] Remove condition.
- [ ] Clear.
- [ ] Apply.
- [ ] Refresh.
- [ ] Filter riêng từng collection.

## Context Menu

- [ ] Database → New Query.
- [ ] Object → New Query.
- [ ] Connection đúng.
- [ ] Database đúng.
- [ ] Existing menu không thay đổi.

## Synonyms

- [ ] SSMS connection → có Synonyms.
- [ ] Non-SSMS → không xuất hiện Synonyms.
- [ ] Load Synonyms.
- [ ] Refresh.
- [ ] Filter.
- [ ] New Query.
- [ ] Generate DDL.
- [ ] Synonym có schema khác `dbo`.
- [ ] Target object ở database khác.
- [ ] Target object có server/database/schema đầy đủ.

---

# 33. Quy tắc kiểm soát phạm vi cho Agent

```text
SCOPE CONTROL RULE

Only modify code required for the following features:

1. Object Explorer hover action/filter positioning.
2. Multi-condition filter popup and filter state.
3. "New Query" context menu item for database/object nodes.
4. SQL Server/SSMS Synonyms metadata, tree node, filtering and DDL generation.

Do NOT modify unrelated:
- IntelliSense
- Monaco
- CodeMirror
- Query execution
- SQL editor behavior
- Connection management
- Database metadata unrelated to Synonyms
- Tables
- Views
- Procedures
- Functions
- Triggers
- Sequences
- User Defined Types
- PostgreSQL behavior
- Existing context-menu actions

If an existing shared component must be modified, STOP before implementing the change and report:

- File/module
- Current responsibility
- Why the change is required
- Other features affected
- Impact level: Low / Medium / High
- Proposed minimal change
- Alternative solution, if available

Do not refactor unrelated code.
Do not rename existing APIs/components unless strictly required.
Do not replace an existing implementation with a new architecture without approval.
Prefer the smallest possible change that satisfies the requirements.

For SSMS Synonyms:
- Only enable the feature for the existing SSMS connection type.
- Do not expose Synonyms for other connection types.
- Read metadata from SQL Server system catalogs.
- Generate DDL from actual metadata.
- Do not execute generated DDL automatically.
```

---

# 34. Nguyên tắc kỹ thuật quan trọng

1. **Không refactor lớn chỉ để triển khai tính năng nhỏ.**
2. Ưu tiên tái sử dụng component/utility hiện tại.
3. Multiple Filter chỉ mở rộng model filter; không viết lại toàn bộ Object Explorer.
4. New Query chỉ mở query với context phù hợp; không thay đổi Query Editor.
5. Synonyms là object type riêng của SQL Server/SSMS.
6. DDL Synonym phải dựa trên metadata thực tế.
7. Không execute DDL tự động.
8. PostgreSQL không bị ảnh hưởng bởi phần Synonyms.
9. Các object type hiện tại không được thay đổi behavior ngoài phạm vi.
10. Bất kỳ thay đổi shared component nào ngoài phạm vi phải được báo cáo impact trước khi thực hiện.

# 35. Format Code và Goto Begin / Goto End

## 35.1. Format Code

### Mục tiêu

Bổ sung chức năng **Format Code** cho SQL Editor tại:

1. Nav bar / menu của SQL Editor.
2. Context menu khi click chuột phải trong Monaco Editor.

Phải sử dụng **Monaco Editor Menu/Action API** hiện tại, không xây dựng một menu UI độc lập nếu Monaco đã hỗ trợ cơ chế tương ứng.

### A. Format toàn bộ file đang mở

Khi user chọn `Format Code` và **không có selection**:

- Hiển thị popup xác nhận trước khi format toàn bộ nội dung file.
- Popup phải thông báo rõ rằng toàn bộ SQL đang mở sẽ được format lại.
- Chỉ sau khi user xác nhận mới thực hiện format.
- Không tự động execute SQL sau khi format.

Flow:

```text
Current Editor
    ↓
Popup xác nhận
    ↓
User Confirm
    ↓
Format Document
    ↓
Replace editor content
```

### B. Format đoạn code đang chọn

Nếu user đang select một đoạn SQL:

```text
User Selection
    ↓
Format Selection
    ↓
Replace selected range
```

Không format phần SQL nằm ngoài selection.

Không cần popup xác nhận cho selection, trừ khi behavior hiện tại của IDE đã quy định khác.

---

## 35.2. Monaco Integration

Phải sử dụng **Monaco Editor Action/Menu API** hiện tại.

Ưu tiên sử dụng cơ chế:

```javascript
editor.addAction(...)
editor.getAction(...)
editor.getContribution(...)
```

và menu/context-menu mechanism của Monaco.

Format Code phải xuất hiện tại:

### Nav bar

```text
SQL Editor
 ├── Run
 ├── ...
 └── Format Code
```

### Monaco context menu

```text
Cut
Copy
Paste
────────────
Format Code
────────────
...
```

Không tự ý thay đổi hoặc loại bỏ các menu/action hiện tại.

---

## 35.3. Phân biệt Format Document và Format Selection

Logic phải phân biệt rõ:

```text
Không có selection
    → Format Document
```

và:

```text
Có selection
    → Format Selection
```

Không được format toàn bộ file khi user chỉ chọn một đoạn SQL.

---

## 35.4. SQL Dialect

Formatter phải nhận biết dialect của connection/editor hiện tại.

Ít nhất phải hỗ trợ:

- SQL Server
- PostgreSQL

Không được sử dụng formatter SQL Server cho PostgreSQL nếu syntax formatter khác nhau.

Ví dụ SQL Server:

```sql
IF ...
BEGIN
    ...
END
```

PostgreSQL:

```sql
IF ... THEN
    ...
END IF;
```

PostgreSQL DO block:

```sql
DO $$
BEGIN
    ...
END;
$$;
```

Formatter không được làm thay đổi semantics của SQL.

---

## 35.5. Nguyên tắc an toàn của Formatter

Formatter chỉ được thay đổi:

- Indentation.
- Whitespace.
- Line break.
- Keyword casing nếu formatter hiện tại cho phép.
- Spacing.
- Formatting của SQL expression.

Không được:

- Đổi tên biến.
- Đổi tên table.
- Đổi tên column.
- Thay đổi literal.
- Thay đổi operator.
- Thay đổi logic `AND/OR`.
- Thêm hoặc xóa câu lệnh.
- Thay đổi thứ tự câu SQL.
- Tự động refactor SQL.
- Tự động sửa syntax error thành một câu SQL khác.

Formatter chỉ là **formatting operation**, không phải SQL refactoring operation.

---

# 36. Goto Begin / Goto End

## 36.1. Mục tiêu

Bổ sung hai action cho Monaco Editor:

```text
Goto Begin
Goto End
```

Mục đích là cho phép user đang đứng trong một SQL block nhanh chóng nhảy đến delimiter tương ứng của block.

Ví dụ:

```sql
IF @Value = 1
BEGIN

    SELECT *
    FROM Customer;

END
```

Nếu cursor đang nằm trong phần `SELECT`:

```text
Goto Begin
```

phải nhảy đến `BEGIN`.

```text
Goto End
```

phải nhảy đến `END` tương ứng.

---

## 36.2. Monaco Menu

Hai action phải được đăng ký thông qua Monaco Editor Action/Menu API.

Ví dụ:

```text
SQL Editor
 ├── Format Code
 ├── Goto Begin
 └── Goto End
```

Trong context menu:

```text
Cut
Copy
Paste
────────────
Format Code
Goto Begin
Goto End
────────────
...
```

Không tạo context menu độc lập nếu Monaco đã có cơ chế phù hợp.

---

# 37. Goto Begin / Goto End phải hiểu cấu trúc SQL

Không được implement đơn giản bằng:

```javascript
find previous "BEGIN"
```

hoặc:

```javascript
find next "END"
```

vì sẽ nhảy sai trong các trường hợp:

- Nested block.
- `BEGIN/END` trong comment.
- `BEGIN/END` trong string literal.
- Dynamic SQL.
- `END IF`.
- `END LOOP`.
- `END TRY`.
- `END CATCH`.

Phải xây dựng cơ chế nhận biết **token/block structure** theo SQL dialect.

---

# 38. SQL Server — các cấu trúc cần hỗ trợ

Ít nhất phải hỗ trợ:

### BEGIN / END

```sql
BEGIN
    ...
END
```

### IF / ELSE

```sql
IF condition
BEGIN
    ...
END
ELSE
BEGIN
    ...
END
```

### WHILE

```sql
WHILE condition
BEGIN
    ...
END
```

### TRY / CATCH

```sql
BEGIN TRY
    ...
END TRY
BEGIN CATCH
    ...
END CATCH
```

Phải hiểu:

```text
BEGIN TRY ↔ END TRY
BEGIN CATCH ↔ END CATCH
```

Không được coi tất cả `BEGIN` / `END` là một cặp đơn giản.

### Stored Procedure / Function / Trigger

Ví dụ:

```sql
CREATE PROCEDURE ...
AS
BEGIN
    ...
END
```

Cursor bên trong procedure/function/trigger phải có khả năng tìm đúng block tương ứng.

---

# 39. PostgreSQL — các cấu trúc cần hỗ trợ

Phải hỗ trợ syntax đặc trưng của PL/pgSQL.

### BEGIN / END

```sql
BEGIN
    ...
END;
```

### IF / END IF

```sql
IF condition THEN
    ...
END IF;
```

Cặp:

```text
IF ... THEN
    ↕
END IF
```

Không được coi `END IF` chỉ là token `END` thông thường.

### IF / ELSIF / ELSE

```sql
IF condition THEN
    ...
ELSIF condition THEN
    ...
ELSE
    ...
END IF;
```

Goto phải hiểu toàn bộ cấu trúc IF.

### LOOP

```sql
LOOP
    ...
END LOOP;
```

Cặp:

```text
LOOP ↔ END LOOP
```

### WHILE LOOP

```sql
WHILE condition LOOP
    ...
END LOOP;
```

### FOR LOOP

```sql
FOR record IN query LOOP
    ...
END LOOP;
```

### BEGIN / EXCEPTION / END

```sql
BEGIN
    ...
EXCEPTION
    WHEN OTHERS THEN
        ...
END;
```

Phải coi đây là một block hoàn chỉnh.

### DO Block

```sql
DO $$
BEGIN
    ...
END;
$$;
```

Nếu cursor nằm trong DO block, phải xác định đúng `BEGIN` / `END` tương ứng.

---

# 40. Nested Block

Đây là yêu cầu bắt buộc.

Ví dụ:

```sql
BEGIN

    IF condition THEN

        BEGIN
            SELECT 1;
        END;

    END IF;

END;
```

Nếu cursor đang ở:

```sql
SELECT 1;
```

thì:

```text
Goto Begin
```

phải đến `BEGIN` gần nhất đang bao quanh cursor.

```text
Goto End
```

phải đến `END` tương ứng của block đó.

Không được nhảy đến:

```text
END IF
```

hoặc `END` của outer block.

---

# 41. Ignore String và Comment

Parser/tokenizer phải bỏ qua keyword nằm trong string.

Ví dụ:

```sql
SELECT 'BEGIN';
SELECT 'END';
```

Line comment:

```sql
-- BEGIN
-- END
```

Block comment:

```sql
/*
    BEGIN
    END
*/
```

Các keyword này không được tham gia vào block matching.

Không được implement Goto Begin/End chỉ bằng regex hoặc tìm text đơn giản.

---

# 42. Dynamic SQL

Ví dụ SQL Server:

```sql
DECLARE @sql nvarchar(max);

SET @sql = N'
BEGIN
    SELECT *
    FROM Customer;
END';
```

`BEGIN` và `END` bên trong string không được coi là block của SQL hiện tại.

Tương tự PostgreSQL:

```sql
EXECUTE 'BEGIN ... END';
```

Phải coi nội dung bên trong string/dynamic SQL là string và không tham gia structural matching của editor.

---

# 43. Cơ chế Matching đề xuất

Nên xây dựng một lớp riêng:

```text
SQL Block Structure Analyzer
```

Flow:

```text
Editor Text
    ↓
Tokenizer / SQL lexical analysis
    ↓
Ignore comments + strings
    ↓
Identify block tokens
    ↓
Build block pairs
    ↓
Goto Begin / Goto End
```

Không cần xây dựng full SQL parser ngay nếu quá phức tạp.

Có thể bắt đầu bằng lexical/token-level analyzer nhưng phải thiết kế extensible cho từng dialect.

Ví dụ:

```javascript
{
    dialect: "sqlserver",
    blocks: [...]
}
```

và:

```javascript
{
    dialect: "postgresql",
    blocks: [...]
}
```

Mục tiêu là tách:

```text
Block Detection
```

khỏi:

```text
Monaco UI Action
```

để sau này có thể tái sử dụng cho các tính năng khác.

---

# 44. Block Model

Có thể sử dụng model tương tự:

```javascript
{
    type: "if",
    dialect: "postgresql",
    start: {
        line: 10,
        column: 1,
        token: "IF"
    },
    end: {
        line: 15,
        column: 1,
        token: "END IF"
    }
}
```

Hoặc:

```javascript
{
    type: "begin-end",
    startToken: "BEGIN",
    endToken: "END"
}
```

Mục tiêu là tách logic block matching khỏi Monaco.

---

# 45. Goto Begin

Khi user chọn:

```text
Goto Begin
```

flow:

```text
Current Cursor
      ↓
Analyze current SQL block
      ↓
Find nearest enclosing block
      ↓
Find corresponding opening token
      ↓
Move Monaco cursor
      ↓
Reveal line
```

Nếu cursor đang đứng ngay trên opening token thì không được nhảy sang block bên ngoài.

Có thể giữ nguyên vị trí hoặc áp dụng behavior nhất quán với editor hiện tại.

---

# 46. Goto End

Flow:

```text
Current Cursor
      ↓
Analyze current SQL block
      ↓
Find nearest enclosing block
      ↓
Find corresponding closing token
      ↓
Move Monaco cursor
      ↓
Reveal line
```

---

# 47. Không tìm thấy block tương ứng

Nếu không xác định được block:

- Không di chuyển cursor.
- Không throw exception.
- Không làm thay đổi nội dung editor.
- Có thể hiển thị notification nhẹ nếu hệ thống hiện tại có notification mechanism.

Ví dụ:

```text
No matching SQL block found.
```

---

# 48. Khả năng mở rộng

Thiết kế `SQL Block Structure Analyzer` theo hướng có thể tái sử dụng cho các tính năng tương lai:

- Highlight matching block.
- Collapse/Expand block.
- Code folding.
- Breadcrumb SQL block.
- Block navigation.
- Structure outline.
- Error location.
- Bracket/block matching.
- Procedure/function structure.
- IF/ELSE navigation.
- TRY/CATCH navigation.
- LOOP navigation.

Tuy nhiên:

> **Không triển khai các chức năng trên trong task này nếu chưa được yêu cầu.**

Chỉ thiết kế analyzer đủ tốt để không chặn việc mở rộng sau này.

---

# 49. Keyboard Shortcut

Không tự ý gán shortcut mới nếu dự án hiện tại chưa có quy ước.

Nếu hệ thống hiện tại có cơ chế quản lý shortcut thì:

- Format Code.
- Goto Begin.
- Goto End.

phải đăng ký thông qua hệ thống command/action hiện tại.

Không hard-code shortcut vào logic xử lý.

---

# 50. Scope Control

Chỉ được thay đổi các thành phần cần thiết cho:

1. Format Code.
2. Monaco menu/context menu action.
3. Goto Begin.
4. Goto End.
5. SQL Block Structure Analyzer cần thiết cho hai chức năng trên.

Không được tự ý sửa:

- IntelliSense.
- Completion Provider.
- Syntax Highlighting.
- Query Execution.
- Connection Management.
- SQL Metadata.
- Object Explorer.
- Result Grid.
- Database Query.
- Existing Monaco Actions.
- Existing Keyboard Shortcuts.

Nếu cần sửa một component dùng chung:

**STOP và báo cáo trước khi thực hiện**, bao gồm:

```text
File/module:
Current responsibility:
Why modification is required:
Features affected:
Impact: Low / Medium / High
Minimal proposed change:
Alternative solution:
```

Chỉ tiếp tục sau khi phạm vi ảnh hưởng được xác nhận.

---

# 51. Acceptance Criteria

## Format Code

- [ ] Có trên Nav bar.
- [ ] Có trong Monaco context menu.
- [ ] Không có selection → Format Document.
- [ ] Có selection → Format Selection.
- [ ] Format toàn file có popup xác nhận.
- [ ] Format selection không format phần ngoài selection.
- [ ] Không execute SQL sau khi format.
- [ ] SQL Server được format đúng dialect.
- [ ] PostgreSQL được format đúng dialect.
- [ ] Không thay đổi semantics của SQL.

## Goto Begin / Goto End

- [ ] Có trong Monaco context menu.
- [ ] Có thể gọi từ Monaco command/action.
- [ ] SQL Server BEGIN/END.
- [ ] SQL Server IF/ELSE.
- [ ] SQL Server WHILE.
- [ ] SQL Server TRY/CATCH.
- [ ] PostgreSQL IF/END IF.
- [ ] PostgreSQL ELSIF/ELSE.
- [ ] PostgreSQL LOOP.
- [ ] PostgreSQL WHILE LOOP.
- [ ] PostgreSQL FOR LOOP.
- [ ] PostgreSQL BEGIN/EXCEPTION/END.
- [ ] PostgreSQL DO block.
- [ ] Nested block.
- [ ] Ignore string literal.
- [ ] Ignore line comment.
- [ ] Ignore block comment.
- [ ] Ignore dynamic SQL string.
- [ ] Không tìm thấy block → không làm hỏng editor.
- [ ] Không thay đổi nội dung SQL khi Goto.
- [ ] Cursor được đưa đến đúng token tương ứng.
- [ ] Không ảnh hưởng IntelliSense hiện tại.

## Regression

- [ ] SQL Editor hiện tại vẫn hoạt động.
- [ ] F5/Run SQL không thay đổi.
- [ ] IntelliSense không thay đổi.
- [ ] Syntax highlighting không thay đổi.
- [ ] Existing Monaco menu actions không thay đổi.
- [ ] Existing keyboard shortcuts không thay đổi.

# 52: Hiển thị số lượng Object và trạng thái lọc

## Mục đích

Bổ sung thông tin số lượng object trong Object Explorer để người dùng nhanh chóng biết tổng số object đang tồn tại và số lượng object còn lại sau khi áp dụng bộ lọc.

## Quy tắc hiển thị

- Khi **không áp dụng bộ lọc**:

  - Hiển thị tổng số object.
  - Ví dụ:

    ```
    Views    200
    ```

- Khi **đang áp dụng bộ lọc**:

  - Hiển thị số lượng object phù hợp với bộ lọc trên tổng số object.
  - Ví dụ:

    ```
    Views    4/200
    ```

  - Trong đó:

    - `4`: số object đang được hiển thị sau khi lọc.
    - `200`: tổng số object thực tế của loại object đó trước khi lọc.

## Yêu cầu UX

- Số lượng phải được cập nhật ngay khi người dùng thay đổi nội dung bộ lọc.
- Khi xóa bộ lọc, hiển thị lại dạng tổng số:

  ```
  Views    200
  ```

* Không được hiểu `4/200` là số trang hoặc pagination; đây chỉ là **số object phù hợp / tổng số object**.
- Nếu bộ lọc không trả về kết quả:

  ```
  Views    0/200
  ```

* Tổng số `200` phải được giữ nguyên theo tập object đã load từ database, không thay đổi chỉ vì người dùng lọc trên UI.
- Cách hiển thị này áp dụng thống nhất cho các nhóm object như:

  - Tables
  - Views
  - Procedures
  - Functions
  - Triggers
  - Synonyms
  - Các loại object khác nếu có.
