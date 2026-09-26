# Data Editor — Database Table Data Editing Specification

## 1. Mục đích

Xây dựng chức năng **Edit Data** cho phép người dùng xem, thêm, sửa, xóa dữ liệu trực tiếp trên một bảng cơ sở dữ liệu quan hệ.

Chức năng phải hướng tới trải nghiệm tương tự các công cụ:

- SQL Server Management Studio (SSMS)
- JetBrains DataGrip
- Navicat
- DBeaver

Nhưng kiến trúc phải được thiết kế độc lập với UI của các công cụ trên.

Mục tiêu chính:

1. Chỉnh sửa dữ liệu trực tiếp trên Data Grid.
2. Kiểm soát toàn bộ thay đổi trước khi ghi xuống database.
3. Validate dữ liệu trước và trong quá trình Save.
4. Tôn trọng toàn bộ constraint của database.
5. Hỗ trợ transaction và rollback.
6. Phát hiện xung đột khi dữ liệu bị người khác thay đổi.
7. Hỗ trợ thao tác nhập dữ liệu nhanh.
8. Không làm mất dữ liệu do thao tác nhầm.
9. Hỗ trợ SQL Server và PostgreSQL thông qua Database Adapter.
10. Không phụ thuộc vào một hệ quản trị CSDL duy nhất.

---

# 2. Nguyên tắc quan trọng

## 2.1. Không cập nhật database ngay khi người dùng sửa Cell

Khi người dùng sửa dữ liệu:

```text
User Edit
    ↓
Local Change
    ↓
Validation
    ↓
Change Tracking
    ↓
Generate SQL
    ↓
Transaction
    ↓
Database
```

Không được thực hiện:

```text
User Edit
    ↓
UPDATE Database ngay lập tức
```

Mục đích:

- Hỗ trợ Undo.
- Hỗ trợ Rollback.
- Cho phép sửa nhiều dòng trước khi Save.
- Cho phép Preview SQL.
- Có thể kiểm tra toàn bộ batch trước khi Commit.
- Tránh trạng thái database bị cập nhật một phần do lỗi.

---

# 3. Kiến trúc chức năng

Chức năng Data Editor phải được chia thành các thành phần:

```text
Data Editor UI
      │
      ▼
Change Tracking
      │
      ▼
Validation Engine
      │
      ▼
SQL Generator
      │
      ▼
Transaction Manager
      │
      ▼
Database Adapter
      │
      ▼
SQL Server / PostgreSQL
```

Không để UI trực tiếp xây dựng và thực thi SQL.

---

# 4. Data Grid

Data Grid phải hỗ trợ:

- Hiển thị dữ liệu dạng bảng.
- Chỉnh sửa trực tiếp Cell.
- Thêm Row.
- Xóa Row.
- Duplicate Row.
- Copy.
- Paste.
- Undo.
- Redo.
- Sort.
- Filter.
- Search.
- Resize Column.
- Reorder Column nếu kiến trúc cho phép.
- Pagination hoặc Virtual Scrolling.
- Chọn nhiều Row.
- Chọn nhiều Cell.

# 5. Metadata

Khi mở Edit Data, hệ thống phải lấy metadata của bảng.

Metadata tối thiểu:

```text
Table
Schema

Column
    Name
    Data Type
    Nullable
    Max Length
    Precision
    Scale
    Default
    Identity
    Computed
    Generated

Primary Key

Unique Constraints

Foreign Keys

Check Constraints

Default Constraints

Triggers

Row Version / Concurrency Column
```

Không được chỉ dựa vào:

```sql
SELECT *
FROM TableName
```

để xây dựng Data Editor.

Data Editor phải hiểu cấu trúc của bảng.

---

# 6. Column Editor

Editor của từng Column phải phụ thuộc vào metadata.

Quy tắc:

```text
INT
    → Numeric Editor

BIGINT
    → Numeric Editor

DECIMAL
    → Decimal Editor

DATE
    → Date Editor

DATETIME
    → DateTime Editor

BIT
    → Checkbox

VARCHAR / NVARCHAR
    → Text Editor

TEXT / NVARCHAR(MAX)
    → Multiline Text Editor

XML
    → XML Editor

JSON
    → JSON Editor

FOREIGN KEY
    → Lookup Editor nếu có thể

Computed
    → Read-only

Identity
    → Read-only

Generated
    → Read-only
```

---

# 7. Read-only Column

Không cho người dùng sửa trực tiếp:

- Identity column.
- Computed column.
- Generated column.
- RowVersion.
- Các column được Database Adapter xác định là read-only.
- Các column mà user không có quyền UPDATE.

UI phải thể hiện rõ trạng thái:

```text
🔒 Read-only
```

Không được chỉ disable input mà không giải thích lý do khi người dùng cố chỉnh sửa.

---

# 8. NULL và Empty String

Phải phân biệt rõ:

```text
NULL
```

và:

```text
''
```

Không được coi hai giá trị này là giống nhau.

Context menu của Cell nên hỗ trợ:

```text
Set NULL
Set Empty String
Edit Value
```

---

# 9. Validation Engine

Validation phải có ít nhất hai lớp:

```text
Client-side Validation
        +
Database Validation
```

Client-side validation nhằm phát hiện lỗi sớm.

Database validation là lớp bảo vệ cuối cùng.

Không được giả định rằng client-side validation thay thế database constraint.

---

# 10. Data Type Validation

Phải kiểm tra kiểu dữ liệu trước khi Save.

Ví dụ:

```text
Column:
Age INT

Input:
abc

Result:
❌ Invalid integer value
```

Ví dụ:

```text
Amount DECIMAL(18,2)

Input:
100.123

Result:
❌ Scale exceeds column definition
```

Không được tự động làm mất precision nếu người dùng chưa xác nhận.

---

# 11. NOT NULL Validation

Nếu Column có:

```text
NOT NULL
```

không cho phép:

```text
NULL
```

Ví dụ:

```text
CustomerName = NULL
```

phải hiển thị:

```text
❌ CustomerName cannot be NULL
```

Cell phải được đánh dấu lỗi.

---

# 12. PRIMARY KEY Validation

Hệ thống phải nhận diện:

- Single-column Primary Key.
- Composite Primary Key.

Không được giả định Primary Key chỉ có một Column.

Ví dụ Composite PK:

```text
CompanyId
+
CustomerId
```

mọi thao tác UPDATE/DELETE phải sử dụng đầy đủ khóa.

---

# 13. UNIQUE Validation

Phải hỗ trợ:

- Single-column Unique.
- Composite Unique.

Ví dụ:

```text
UNIQUE(CustomerCode)
```

hoặc:

```text
UNIQUE(BranchId, CustomerCode)
```

Không được chỉ kiểm tra từng Column độc lập.

Phải kiểm tra toàn bộ Constraint.

---

# 14. Unique Error

Khi phát hiện trùng:

```text
❌ Duplicate value

CustomerCode 'KH001' already exists.

Constraint:
UX_Customer_Code
```

Nếu có thể xác định Record trùng, cung cấp:

```text
[Go to conflicting row]
```

Không chỉ hiển thị mã lỗi SQL Server/PostgreSQL cho người dùng.

---

# 15. FOREIGN KEY Validation

Phải nhận diện:

```text
ChildTable.Column
        ↓
ParentTable.PrimaryKey
```

Ví dụ:

```text
Customer.BankId
    ↓
Bank.Id
```

Nếu nhập ID không tồn tại:

```text
❌ Foreign key violation

BankId = 999999 does not exist in Bank.Id.
```

---

# 16. Foreign Key Lookup

Nếu có Foreign Key, ưu tiên cung cấp Lookup.

Ví dụ:

```text
BankId
[ 1002 - BIDV ▼ ]
```

Lookup phải hỗ trợ:

- Search.
- Sort.
- Filter.
- Select.
- Hiển thị ID + Display Name nếu có thể.

Không bắt người dùng phải nhớ Foreign Key ID.

---

# 17. CHECK Constraint

Phải đọc CHECK Constraint từ database.

Ví dụ:

```sql
CHECK (Status IN (0,1))
```

Nếu nhập:

```text
Status = 5
```

hiển thị:

```text
❌ Invalid value

Value does not satisfy CHECK constraint.
```

Nếu có thể phân tích constraint an toàn, có thể chuyển thành UI phù hợp như:

```text
Dropdown
Checkbox
Numeric range
```

Không được tự ý suy đoán business rule từ một CHECK phức tạp.

---

# 18. DEFAULT Value

Nếu Column có Default:

```sql
DEFAULT GETDATE()
```

khi Add Row không nhất thiết phải tự tính giá trị Default ở application.

Ưu tiên để database xử lý:

```text
Database Default
```

Ví dụ:

```text
CreatedDate
[ DEFAULT ]
```

Khi INSERT, có thể bỏ Column khỏi câu SQL để Database áp dụng Default.

---

# 19. Business Rule

Không phải mọi quy tắc dữ liệu đều nằm trong:

```text
PK
FK
UNIQUE
CHECK
NOT NULL
```

Có thể tồn tại:

- Trigger.
- Stored Procedure.
- Business Logic.
- Application Rule.
- ERP Rule.

Không được tự động giả định toàn bộ business rule chỉ từ metadata.

Cho phép mở rộng:

```text
Custom Validation Rule
```

nhưng phải tách khỏi Database Constraint.

---

# 20. Change Tracking

Mọi thay đổi phải được lưu trong Change Set.

Ví dụ:

```json
{
    "operation": "UPDATE",
    "table": "Customer",
    "primary_key": {
        "CustomerId": 1001
    },
    "changes": {
        "CustomerName": {
            "old": "ABC",
            "new": "XYZ"
        }
    }
}
```

Các operation:

```text
INSERT
UPDATE
DELETE
```

---

# 21. Cell State

Mỗi Cell nên có trạng thái:

```text
NORMAL
MODIFIED
NEW
DELETED
ERROR
WARNING
READONLY
NULL
CONFLICT
```

UI phải phân biệt được các trạng thái này.

Không dùng một màu hoặc một trạng thái chung cho tất cả thay đổi.

---

# 22. Row State

Mỗi Row nên có trạng thái:

```text
UNCHANGED
NEW
MODIFIED
DELETED
CONFLICT
ERROR
```

Ví dụ:

```text
NEW
    → Row chưa tồn tại trong DB.

MODIFIED
    → Row đã tồn tại nhưng có thay đổi local.

DELETED
    → Row được đánh dấu xóa nhưng chưa DELETE DB.

CONFLICT
    → Database đã thay đổi sau khi Row được load.
```

---

# 23. Undo / Redo

Phải hỗ trợ:

```text
Ctrl + Z
Ctrl + Y
```

Undo phải áp dụng cho Local Change Set.

Không được dùng Undo để cố gắng khôi phục bằng SQL sau khi database đã Commit.

---

# 24. Add Row

Khi:

```text
+ Add Row
```

Row mới chỉ tồn tại trong Local Change Set.

Ví dụ:

```text
# NEW
CustomerCode    [      ]
CustomerName    [      ]
Status          [ 1 ▼  ]
```

Chỉ khi Save mới thực hiện INSERT.

---

# 25. Duplicate Row

Phải hỗ trợ:

```text
Duplicate Row
```

Khi Duplicate:

- Copy dữ liệu có thể copy.
- Identity không được copy.
- Computed không được copy.
- Generated column không được copy.
- Primary Key phải được xử lý phù hợp.
- Unique value phải được validation.

---

# 26. Delete Row

Delete phải thực hiện theo hai bước:

```text
User Delete
    ↓
Mark Row = DELETED
    ↓
Save
    ↓
DELETE Database
```

Trước Save phải cho phép:

```text
Undo Delete
```

Không DELETE database ngay khi người dùng click Delete.

---

# 27. Copy / Paste

Phải hỗ trợ thao tác giống Spreadsheet:

```text
Ctrl+C
Ctrl+V
Ctrl+X
Delete
Ctrl+Z
Ctrl+Y
```

Có thể hỗ trợ:

```text
Copy Cell
Copy Row
Copy Selected Rows
Paste Cell
Paste Range
```

Khi Paste nhiều dòng, toàn bộ dữ liệu phải đi qua Validation Engine.

---

# 28. Multi-cell Editing

Cho phép:

```text
Fill Down
Fill Right
Set Value
Clear
Copy
Paste
```

Ví dụ:

```text
Select 10 Status cells
        ↓
Set Value = 1
        ↓
10 local changes
```

Không được cập nhật database trực tiếp.

---

# 29. Search

Phải hỗ trợ:

```text
Ctrl + F
```

Search trong Data Grid.

Search phải có khả năng:

- Highlight kết quả.
- Next.
- Previous.
- Search theo Cell.
- Search theo Row nếu phù hợp.

---

# 30. Filter

Phải hỗ trợ Filter.

Phân biệt:

```text
Client-side Filter
Server-side Filter
```

Đối với bảng lớn phải ưu tiên Server-side Filter.

Không được load toàn bộ bảng vào Python/browser chỉ để thực hiện filter.

---

# 31. Pagination

Không được mặc định:

```sql
SELECT *
FROM HugeTable
```

đối với bảng lớn.

Phải hỗ trợ:

```text
Pagination
```

hoặc:

```text
Virtual Scrolling
```

Có thể cấu hình:

```text
Default Page Size
Maximum Page Size
Maximum Editable Rows
```

---

# 32. Sorting

Phải hỗ trợ:

```text
Sort Ascending
Sort Descending
Clear Sort
```

Server-side sorting được ưu tiên với dữ liệu lớn.

Sort phải sử dụng Column hợp lệ và được parameterize/whitelist, không nối trực tiếp input người dùng vào SQL.

---

# 33. SQL Generation

Mọi INSERT/UPDATE/DELETE phải được tạo bằng SQL Generator.

Không được viết SQL bằng string interpolation với dữ liệu người dùng.

Không được:

```python
f"UPDATE Customer SET Name = '{name}'"
```

Phải sử dụng Parameterized Query.

---

# 34. Parameterized SQL

Ví dụ:

```sql
UPDATE Customer
SET CustomerName = @CustomerName
WHERE CustomerId = @CustomerId
```

Parameters:

```text
CustomerName
CustomerId
```

Database Adapter chịu trách nhiệm chuyển parameter syntax phù hợp với từng database.

---

# 35. UPDATE Generation

UPDATE phải dựa trên Primary Key hoặc concurrency key.

Không được UPDATE dựa trên toàn bộ giá trị Row nếu không cần thiết.

Ví dụ:

```sql
UPDATE Customer
SET CustomerName = @NewName
WHERE CustomerId = @CustomerId
```

Chỉ UPDATE các Column thực sự thay đổi nếu có thể.

---

# 36. DELETE Generation

DELETE phải sử dụng Primary Key hoặc concurrency condition.

Ví dụ:

```sql
DELETE FROM Customer
WHERE CustomerId = @CustomerId
```

Không được dùng:

```sql
DELETE FROM Customer
WHERE CustomerName = @CustomerName
```

nếu Primary Key đã tồn tại.

---

# 37. SQL Preview

Trước khi Save, cho phép Preview SQL.

Ví dụ:

```text
Changes: 12

UPDATE Customer
SET CustomerName = @p1
WHERE CustomerId = @p2

INSERT INTO Customer (...)

DELETE FROM Customer
WHERE CustomerId = @p3
```

Có thể cung cấp:

```text
Copy SQL
View Parameters
Execute
Cancel
```

---

# 38. Transaction

Khi Save nhiều thay đổi:

```text
BEGIN TRANSACTION

INSERT
UPDATE
UPDATE
DELETE

COMMIT
```

Nếu bất kỳ thao tác quan trọng nào thất bại:

```text
ROLLBACK
```

Mặc định không được để database ở trạng thái commit một phần.

---

# 39. Partial Commit

Nếu muốn hỗ trợ Partial Commit, phải là một chức năng explicit.

Ví dụ:

```text
Save All
Save Selected Changes
```

Không được âm thầm thực hiện Partial Commit.

---

# 40. Database Constraint là lớp bảo vệ cuối cùng

Client-side validation chỉ là UX.

Database Constraint mới là lớp bảo vệ cuối cùng.

Ví dụ:

```text
Client:
CustomerCode KH001 chưa tồn tại.

        ↓

User khác INSERT KH001

        ↓

Database:
UNIQUE violation
```

Application phải xử lý Database Error chính xác.

---

# 41. Error Model

Backend phải chuẩn hóa Database Error.

Các loại lỗi:

```text
VALIDATION_ERROR
TYPE_ERROR
NULL_ERROR
PRIMARY_KEY_ERROR
UNIQUE_ERROR
FOREIGN_KEY_ERROR
CHECK_ERROR
CONSTRAINT_ERROR
CONCURRENCY_ERROR
PERMISSION_ERROR
TIMEOUT_ERROR
CONNECTION_ERROR
UNKNOWN_DATABASE_ERROR
```

Backend nên trả về cấu trúc thống nhất:

```json
{
    "success": false,
    "error_type": "UNIQUE_ERROR",
    "table": "Customer",
    "column": "CustomerCode",
    "constraint": "UX_Customer_Code",
    "value": "KH001",
    "message": "CustomerCode already exists."
}
```

---

# 42. Error UI

Không hiển thị raw database error làm thông báo chính.

Không nên chỉ hiển thị:

```text
SQL Error 2627
```

Phải chuyển thành:

```text
❌ Cannot save changes

Table:
Customer

Column:
CustomerCode

Value:
KH001

Reason:
CustomerCode already exists.

Constraint:
UX_Customer_Code
```

Có thể cung cấp:

```text
View Details
Copy Database Error
Go to Conflicting Row
```

---

# 43. Optimistic Concurrency

Data Editor phải hỗ trợ phát hiện dữ liệu bị thay đổi bởi user khác.

Nếu Database có:

```text
rowversion
xmin
updated_at
```

hoặc cơ chế tương đương, sử dụng nó khi có thể.

Ví dụ:

```sql
UPDATE Customer
SET CustomerName = @NewName
WHERE CustomerId = @Id
  AND RowVersion = @OriginalRowVersion
```

Nếu số Row affected = 0:

```text
CONCURRENCY_ERROR
```

---

# 44. Conflict UI

Khi xảy ra conflict:

```text
⚠ Record was modified by another user.

Original:
ABC

Database:
XYZ

Your change:
DEF
```

Cho phép:

```text
Reload
Compare
Cancel
```

Nếu có chức năng Overwrite, phải yêu cầu thao tác explicit từ user.

Không được tự động ghi đè dữ liệu mới nhất của người khác.

---

# 45. Trigger

Data Editor phải giả định rằng Trigger có thể thay đổi dữ liệu.

Ví dụ:

```text
User updates Status
        ↓
Trigger executes
        ↓
ModifiedDate changes
        ↓
Audit changes
        ↓
Other columns change
```

Sau Commit phải Reload affected rows khi cần.

Không được giả định rằng:

```text
Application value == Final database value
```

---

# 46. Schema Change Detection

Nếu metadata thay đổi trong lúc Data Editor đang mở:

```text
⚠ Table structure has changed.

The metadata of this table changed after
the editor was opened.
```

Không được âm thầm tiếp tục sử dụng metadata cũ.

Cho phép:

```text
Reload Metadata
Cancel
```

Nếu đang có unsaved changes phải cảnh báo trước khi reload.

---

# 47. Permission

Data Editor phải tôn trọng database permission.

Nếu user chỉ có:

```text
SELECT
```

Data Editor phải ở:

```text
Read-only
```

Nếu user có:

```text
SELECT + INSERT
```

cho phép Add Row.

Nếu user có:

```text
SELECT + UPDATE
```

cho phép Edit.

Nếu user có:

```text
DELETE
```

cho phép Delete.

Không được chỉ dựa vào UI permission.

Database permission vẫn là lớp bảo vệ cuối cùng.

---

# 48. Unsaved Changes

Tab Data Editor phải thể hiện trạng thái Dirty.

Ví dụ:

```text
Customer *
```

Khi đóng tab có thay đổi:

```text
Unsaved changes

Customer contains 12 unsaved changes.

[Save]
[Discard]
[Cancel]
```

Không được tự động discard.

---

# 49. Refresh

Phải hỗ trợ:

```text
Refresh Grid
Refresh Row
Refresh Selected Rows
```

Nếu có unsaved changes:

```text
There are unsaved changes.

Refreshing will discard local changes.

[Refresh & Discard]
[Cancel]
```

---

# 50. Change History

Trong phiên Data Editor có thể hiển thị:

```text
Change History

UPDATE Customer
CustomerId = 1001

CustomerName:
ABC → XYZ

Status:
0 → 1
```

History này phục vụ:

- Review.
- Undo.
- Debug.
- Preview.
- Kiểm tra thay đổi trước Save.

Không coi đây là Database Audit Log.

---

# 51. Context Menu

Context menu của Cell:

```text
Edit
Set NULL
Copy
Copy Row
Copy as SQL
Copy as JSON
Copy as CSV
Paste
Find
Filter by Value
Sort Ascending
Sort Descending
Go to Row
```

Context menu của Row:

```text
Edit Row
Duplicate Row
Delete Row
Copy Row
Copy as INSERT
Generate UPDATE
Refresh Row
```

Context menu không được sử dụng context menu mặc định của trình duyệt.

---

# 52. Copy as SQL

Cho phép:

```text
Copy as INSERT
Copy as UPDATE
Copy as DELETE
```

Ví dụ:

```sql
INSERT INTO dbo.Customer
(
    CustomerCode,
    CustomerName,
    Status
)
VALUES
(
    N'KH001',
    N'ABC',
    1
);
```

SQL sinh ra phải phù hợp với Database Adapter.

---

# 53. Copy as JSON

Cho phép:

```text
Copy as JSON
```

Ví dụ:

```json
{
    "CustomerCode": "KH001",
    "CustomerName": "ABC",
    "Status": 1
}
```

Có thể hỗ trợ thêm:

```text
Copy as CSV
Copy as TSV
```

---

# 54. Long Text

Các Column lớn như:

```text
TEXT
NTEXT
VARCHAR(MAX)
NVARCHAR(MAX)
CLOB
```

không nên hiển thị toàn bộ nội dung trong Cell.

Double click hoặc Enter để mở Text Editor.

Text Editor phải hỗ trợ:

```text
Edit
Search
Format nếu phù hợp
Apply
Cancel
```

---

# 55. XML / JSON Data

Nếu Column có kiểu XML hoặc JSON:

```text
View
Edit
Format
Validate
```

XML Editor có thể tích hợp syntax highlighting.

JSON Editor có thể hỗ trợ:

```text
Format JSON
Validate JSON
Minify JSON
```

Những chức năng này phải nằm trong Data Editor, không làm thay đổi kiến trúc Change Tracking.

---

# 56. Performance

Không được:

```text
SELECT toàn bộ bảng
→ Python xử lý
→ gửi toàn bộ browser
```

với bảng lớn.

Ưu tiên:

```text
Database
    ↓
Server-side Filter
    ↓
Server-side Sort
    ↓
Pagination
    ↓
Data Grid
```

Chỉ load dữ liệu cần thiết.

---

# 57. Database Adapter

Data Editor phải sử dụng abstraction:

```python
class DatabaseAdapter:

    get_table_metadata()

    get_columns()

    get_primary_key()

    get_unique_constraints()

    get_foreign_keys()

    get_check_constraints()

    get_defaults()

    get_rows()

    insert_rows()

    update_rows()

    delete_rows()

    begin_transaction()

    commit()

    rollback()

    check_concurrency()
```

Không viết logic SQL Server/PostgreSQL trực tiếp trong Data Editor UI.

---

# 58. SQL Server Adapter

SQL Server Adapter phải xử lý riêng:

- Identity.
- Computed Column.
- RowVersion.
- Primary Key.
- Unique Constraint.
- Foreign Key.
- Check Constraint.
- Default Constraint.
- Trigger.
- SQL Server data types.
- Parameter syntax.
- SQL Server error codes.
- Transaction.

---

# 59. PostgreSQL Adapter

PostgreSQL Adapter phải xử lý riêng:

- Identity.
- Generated Column.
- Sequence.
- Primary Key.
- Unique Constraint.
- Foreign Key.
- Check Constraint.
- Default.
- Trigger.
- PostgreSQL data types.
- JSON/JSONB.
- XML.
- xmin hoặc concurrency mechanism nếu sử dụng.
- PostgreSQL parameter syntax.
- PostgreSQL error codes.

---

# 60. Universal Data Editor

Phần UI và Change Tracking không được phụ thuộc vào:

```text
SQL Server
```

hoặc:

```text
PostgreSQL
```

Kiến trúc:

```text
                 Data Editor
                      │
              Universal Model
                      │
        ┌─────────────┴─────────────┐
        │                           │
 SQL Server Adapter         PostgreSQL Adapter
        │                           │
    SQL Server                  PostgreSQL
```

---

# 61. Change Set Model

Change Set nên có cấu trúc tương tự:

```json
{
    "table": "Customer",
    "schema": "dbo",
    "primary_key": [
        "CustomerId"
    ],
    "changes": [
        {
            "operation": "UPDATE",
            "key": {
                "CustomerId": 1001
            },
            "columns": {
                "CustomerName": {
                    "old": "ABC",
                    "new": "XYZ"
                }
            }
        },
        {
            "operation": "INSERT",
            "values": {
                "CustomerCode": "KH005",
                "CustomerName": "DEF"
            }
        },
        {
            "operation": "DELETE",
            "key": {
                "CustomerId": 1005
            }
        }
    ]
}
```

Change Set là nguồn dữ liệu để:

```text
Validation
Preview
Undo
Redo
SQL Generation
Transaction
Change History
```

---

# 62. Save Workflow

Workflow chuẩn:

```text
1. User Edit
       ↓
2. Update Local State
       ↓
3. Change Tracking
       ↓
4. Client Validation
       ↓
5. Generate Change Set
       ↓
6. Generate SQL
       ↓
7. Preview
       ↓
8. BEGIN TRANSACTION
       ↓
9. Execute
       ↓
10. Database Validation
       ↓
11. Concurrency Check
       ↓
12. COMMIT
       ↓
13. Reload affected rows
       ↓
14. Clear Change Set
```

Nếu xảy ra lỗi:

```text
Execute
   ↓
Error
   ↓
ROLLBACK
   ↓
Keep Local Changes
   ↓
Show Error
```

Không được mất Local Changes khi Save thất bại.

---

# 63. Quy tắc ưu tiên khi Validation

Thứ tự ưu tiên:

```text
1. Data Type
2. Required / NOT NULL
3. Length / Precision / Scale
4. Local Constraint Validation
5. Foreign Key Validation
6. Unique Validation
7. Check Validation
8. Custom Validation
9. Database Validation
10. Concurrency Validation
```

Tuy nhiên Database Constraint luôn là lớp xác nhận cuối cùng.

---

# 64. Không tự động suy đoán Business Logic

Không được suy luận:

```text
Column tên Status
→ tự tạo dropdown
```

nếu không có metadata hoặc configuration đủ rõ.

Không được suy luận:

```text
IsDeleted
→ tự động dùng Soft Delete
```

Không được suy luận:

```text
CreatedDate
→ tự động sửa khi UPDATE
```

Business logic phải đến từ:

```text
Database Metadata
Configuration
Explicit Rule
```

---

# 65. Security

Phải đảm bảo:

- Parameterized SQL.
- Không SQL injection.
- Không cho phép người dùng sửa Column không có quyền.
- Không cho phép tự ý thay đổi Table/Schema thông qua Data Editor.
- Validate Identifier bằng whitelist/metadata.
- Không nối trực tiếp user input vào SQL Identifier.
- Transaction phải được quản lý rõ ràng.
- Không log password hoặc sensitive connection information.

---

# 66. UX nguyên tắc

Data Editor phải ưu tiên:

```text
Fast Editing
Low Friction
Clear Feedback
Safe Commit
Easy Recovery
```

Người dùng phải nhìn thấy rõ:

```text
Đang sửa gì?
Có bao nhiêu thay đổi?
Thay đổi nào lỗi?
Database có thay đổi không?
Save có thành công không?
```

Không được bắt người dùng đọc raw SQL/database exception cho các lỗi phổ biến.

---

# 67. Trạng thái cuối cùng của Data Editor

Thanh trạng thái nên hiển thị:

```text
Rows: 500
Selected: 3
Changes: 12
Errors: 2
Warnings: 1

[Rollback] [Preview SQL] [Save]
```

Nếu không có thay đổi:

```text
Changes: 0
```

`Save` phải disabled khi không có thay đổi.

---

# 68. Các tính năng nâng cao có thể triển khai sau

Không bắt buộc trong phiên bản đầu tiên nhưng kiến trúc phải cho phép mở rộng:

```text
Column Lookup
Advanced Filter Builder
Multi-table Edit
Batch Edit
Generate SQL Script
Data Compare
Conflict Resolver
Import CSV
Export CSV
Import Excel
Data Generator
JSON/XML Editor
Data Masking
Audit Viewer
Record Lock Information
Query Plan Integration
```

---

# 69. MVP

Phiên bản đầu tiên tối thiểu phải có:

```text
[x] Data Grid
[x] Pagination
[x] Sort
[x] Filter
[x] Add Row
[x] Edit Cell
[x] Delete Row
[x] Duplicate Row
[x] Copy/Paste
[x] NULL handling
[x] Data Type Validation
[x] NOT NULL
[x] Primary Key
[x] Unique
[x] Foreign Key
[x] Check Constraint
[x] Change Tracking
[x] Undo
[x] Rollback
[x] Parameterized SQL
[x] SQL Preview
[x] Transaction
[x] Error Handling
[x] Permission
```

---

# 70. Phase 2

```text
[ ] Optimistic Concurrency
[ ] Conflict Resolver
[ ] Foreign Key Lookup
[ ] Long Text Editor
[ ] JSON Editor
[ ] XML Editor
[ ] Copy as SQL
[ ] Copy as JSON
[ ] Change History
[ ] Batch Editing
[ ] Advanced Filter
```

---

# 71. Phase 3

```text
[ ] Data Compare
[ ] Import CSV
[ ] Export CSV
[ ] Import Excel
[ ] Multi-table Editing
[ ] Data Generator
[ ] Advanced Business Validation
[ ] Audit Integration
[ ] Data Masking
```

---

# 72. Tiêu chí hoàn thành

Data Editor chỉ được xem là hoàn thành khi đáp ứng:

### Data Integrity

- Không bypass Primary Key.
- Không bypass Unique.
- Không bypass Foreign Key.
- Không bypass NOT NULL.
- Không bypass CHECK.
- Không làm mất dữ liệu khi Save lỗi.
- Không overwrite thay đổi của user khác mà không cảnh báo.

### UX

- Edit trực tiếp.
- Add/Delete dễ dàng.
- Copy/Paste.
- Undo/Redo.
- Filter.
- Sort.
- Search.
- Lookup.
- Error rõ ràng.

### Database

- Parameterized SQL.
- Transaction.
- Commit/Rollback.
- Database Adapter.
- SQL Server support.
- PostgreSQL support.

### Safety

- Không UPDATE ngay khi Edit.
- Không DELETE ngay khi click Delete.
- Không tự động discard unsaved changes.
- Không tự động overwrite concurrent changes.
- Không load toàn bộ bảng lớn không kiểm soát.

---

# 73. Nguyên tắc kiến trúc cuối cùng

Data Editor phải được xem là:

```text
Transactional Data Workspace
```

không phải:

```text
Simple CRUD Grid
```

Mọi thay đổi phải đi qua:

```text
User Input
     ↓
Local State
     ↓
Change Set
     ↓
Validation
     ↓
SQL Generator
     ↓
Transaction
     ↓
Database
     ↓
Verification
     ↓
Reload
```

Database Constraint là **nguồn sự thật cuối cùng**.

Application Validation là **lớp UX và kiểm tra sớm**.

Transaction là **cơ chế đảm bảo tính nguyên tử của batch update**.

Change Tracking là **cơ chế bảo vệ người dùng khỏi thao tác nhầm**.

Concurrency Control là **cơ chế bảo vệ dữ liệu khi nhiều người cùng chỉnh sửa**.

Database Adapter là **lớp tách biệt Data Editor khỏi từng hệ quản trị CSDL**.

Không được phá vỡ các nguyên tắc trên khi mở rộng chức năng.
