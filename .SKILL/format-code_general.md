# Kế hoạch thiết kế chức năng SQL Code Formatter & Style Management

## 1. Mục tiêu

Xây dựng chức năng Format SQL cho IDE với các yêu cầu:

1. Format toàn bộ SQL đang mở.
2. Format đoạn SQL được chọn.
3. SQL được format theo Style đang được chọn hiện thời.
4. User có thể tự tạo, chỉnh sửa và quản lý Style.
5. Có các Built-in Style được cung cấp sẵn.
6. User có thể Duplicate Built-in Style để tạo Style riêng.
7. Style của user phải được lưu độc lập với mã nguồn ứng dụng.
8. Khi cập nhật phiên bản IDE, Style và các dữ liệu cá nhân của user không được bị mất hoặc ghi đè.
9. Có khả năng mở rộng Formatter Engine và Style Schema trong các phiên bản sau.

---

# 2. Kiến trúc tổng thể

Formatter nên được tách thành các thành phần:

```text
Editor
   |
   v
Format Command
   |
   v
SQL Formatter Engine
   |
   +---- SQL Tokenizer / Parser
   |
   +---- SQL Dialect
   |
   +---- Formatting Rules
   |
   +---- Active Style
   |
   v
Formatted SQL

2. Nguyên tắc kiến trúc

Không để UI chứa trực tiếp logic formatter.

Tách thành 3 lớp:

Style Code UI
      |
      v
Style Configuration
      |
      v
Formatter Engine
      |
      v
Formatted SQL

Formatter phải nhận cấu hình từ Style Code:

formatter.format(sql, styleConfig)

Không để Formatter phụ thuộc trực tiếp vào DOM hoặc UI.

Mục tiêu:

Có thể thay đổi UI mà không ảnh hưởng Formatter.
Có thể thêm option mới mà không phải viết lại UI.
Có thể hỗ trợ SQL Server và PostgreSQL.
Có thể test Formatter độc lập.
Có thể import/export Style Code.
Có thể migrate Style Code khi schema thay đổi.

3. Cấu trúc màn hình

Màn hình gồm 3 khu vực chính:

+-------------------------------------------------------+
| Style: Company Standard                  [Save] [X]   |
+----------------+--------------------------------------+
| Search         |                                      |
|                | Category / Options                   |
| GLOBAL         |                                      |
|  Whitespace    |                                      |
|  Lists         |                                      |
|  Parentheses   |                                      |
|  Casing        |                                      |
|                |                                      |
| STATEMENTS     |                                      |
|  Data (DML)    |                                      |
|  Schema (DDL)  |                                      |
|  Control flow  |                                      |
|  CTE           |                                      |
|  Variables     |                                      |
|                |                                      |
| CLAUSES        |                                      |
|  JOIN          |                                      |
|  INSERT        |                                      |
|                +--------------------------------------+
| EXPRESSIONS   | SQL Preview                           |
|  Function      |                                      |
|  CASE          |                                      |
|  IN            |                                      |
|  Operators     |                                      |
+----------------+--------------------------------------+

Giữ lại mô hình Sidebar + Content + Preview giống giao diện hiện tại.

4. Header

Header phải hiển thị rõ Style Code hiện tại.

Ví dụ:

Style: Company Standard

Có thể hiển thị thêm:

Database: SQL Server
Modified: 07/10/2026

Khi có thay đổi chưa lưu:

Style: Company Standard *

Các action:

[Save]
[Reset]
[Close]

Nếu có thay đổi chưa lưu và user Close:

You have unsaved changes.

[Save]
[Discard]
[Cancel]

Không được tự động mất thay đổi.

5. Sidebar
5.1 Search

Giữ ô tìm kiếm:

Search for options...

Search phải tìm được trên:

Option name.
Option label.
Description.
Keyword.
Category.

Ví dụ:

AND

phải tìm được:

Operators
    AND / OR

Ví dụ:

uppercase

phải tìm được:

Casing

Search không chỉ tìm tên category.

6. Category

Category hiện tại:

GLOBAL
    Whitespace
    Lists
    Parentheses
    Casing

STATEMENTS
    Data (DML)
    Schema (DDL)
    Control flow
    CTE
    Variables

CLAUSES
    JOIN
    INSERT

EXPRESSIONS
    Function calls
    CASE
    IN
    Operators

Phải được định nghĩa bằng metadata thay vì hard-code toàn bộ HTML.

Ví dụ:

{
    "id": "operators",
    "name": "Operators",
    "group": "expressions",
    "order": 4
}

Lợi ích:

Dễ thêm category.
Dễ thay đổi thứ tự.
Dễ search.
Dễ mở rộng Style Code.
Không phải sửa HTML mỗi lần thêm option.
7. Option Metadata

Mỗi option cần có metadata.

Ví dụ:

{
    "id": "operators.and_or.place_on_new_line",
    "label": "Place on new line",
    "description": "Controls whether AND / OR is placed on a new line.",
    "type": "select",
    "default": "always"
}

Nên hỗ trợ:

id
label
description
type
default
value
category
order
dependencies
databaseSupport
8. Các loại Control

Style Editor phải hỗ trợ ít nhất các loại:

Boolean
[✓] Align comparison operators
Select
Place on new line
[ Always ▼ ]
Number
Indent size
[ 4 ]
Text
Keyword separator
[ " " ]
Radio
Alignment

( ) Left
(*) Right
( ) Center
Enum
Comma position

( ) Before
(*) After

Không nên thiết kế UI chỉ phụ thuộc vào checkbox.

9. Dependency giữa các option

Phải hỗ trợ dependency.

Ví dụ:

Place on new line
[ Never ▼ ]

Alignment
[ Right aligned to statement ▼ ]

Nếu Place on new line = Never thì Alignment không còn tác dụng.

UI phải:

Disable option không còn áp dụng.
Hoặc hiển thị trạng thái Not applicable.
Không để user hiểu rằng option vẫn có hiệu lực.

Ví dụ:

Alignment
[ Right aligned to statement ▼ ]  disabled

Dependency phải được định nghĩa trong metadata.

10. Operators

Khu vực Operators trong ảnh hiện tại cần được triển khai thành nhóm option thực tế.

Ví dụ:

AND / OR

Place on new line
[ Always ▼ ]

Alignment
[ Right aligned to statement ▼ ]

[✓] Place AND / OR keyword before the condition
BETWEEN
[ ] Place BETWEEN keyword on new line
[ ] Place AND keyword on new line

AND alignment
[ To BETWEEN ▼ ]
Comparison and arithmetic
[✓] Align comparison operators
[✓] Add spaces around comparison operators

Các option này phải được kết nối trực tiếp với Formatter Engine.

Không chỉ tạo UI giả lập.

11. Preview SQL

Phần Preview nằm phía dưới màn hình.

Có 2 chế độ:

11.1 Preview Sample SQL

Formatter sử dụng SQL mẫu được định nghĩa sẵn.

Ví dụ:

SELECT AddressID
FROM Person.Address
WHERE ModifiedDate BETWEEN DATEADD(MONTH, -6, GETDATE())
    AND GETDATE()
    AND City = 'Bothell'
    OR LEFT(PostalCode, 2) = 'CB'
    OR PostalCode = @prefix + @suffix
11.2 Preview Current Query

Checkbox:

[ ] Preview current query

Khi bật:

Current Editor SQL
        |
        v
Formatter
        |
        v
Preview

Nếu không có query đang mở:

No active SQL query available.
12. Preview phải độc lập Database

Preview không được thực thi SQL trên Database.

Không được làm:

Preview
    |
    v
Database
    |
    v
Parse SQL

Phải làm:

SQL
 +
Style Configuration
 |
 v
Formatter
 |
 v
Formatted SQL

Lợi ích:

Preview nhanh.
Không phụ thuộc connection.
Không tạo query ngoài ý muốn.
Có thể sử dụng khi không kết nối database.
Dễ test.
13. Preview cập nhật realtime

Khi user thay đổi option:

Option changed
      |
      v
Debounce 300-500ms
      |
      v
Formatter
      |
      v
Update Preview

Ví dụ thay:

Place on new line = Always

Preview lập tức chuyển sang:

WHERE A = 1
    AND B = 2
    AND C = 3

Không bắt user phải Save rồi mới Preview.

14. Preview Error

Nếu SQL không thể format:

Unable to format query.

Unexpected token near line 8.

Không được crash UI.

Có thể hỗ trợ:

[Try Partial Formatting]

nếu Formatter có khả năng format từng phần.

15. Formatter Engine

Không nên xây dựng Formatter bằng regex đơn thuần.

Ví dụ:

SELECT *
FROM A
WHERE Name = 'AND OR'
  AND Description = 'FROM WHERE'

Nếu formatter chỉ dùng regex để tìm:

AND
FROM
WHERE

có thể làm sai string literal.

Kiến trúc nên hướng tới:

SQL
 |
 v
Lexer / Tokenizer
 |
 v
Token Stream
 |
 v
Context Analysis / Parser
 |
 v
Formatting Rules
 |
 v
Formatted SQL

Không bắt buộc xây dựng full SQL parser ngay ở phiên bản đầu.

Tuy nhiên Formatter phải được thiết kế dựa trên token/context thay vì replace text bằng regex đơn giản.

16. SQL Server và PostgreSQL

Formatter phải có khái niệm Dialect.

Formatter
├── Common Rules
├── SQL Server Rules
└── PostgreSQL Rules

Ví dụ common:

Whitespace
Indentation
Casing
Lists
JOIN
CASE
Operators
Parentheses

SQL Server-specific:

TOP
GO
EXEC
[dbo].[Table]

PostgreSQL-specific:

LIMIT
OFFSET
RETURNING
"identifier"

Không được giả định SQL Server và PostgreSQL có cùng syntax.

17. Style Configuration

Không lưu UI state trực tiếp.

Không nên lưu:

{
    "checkbox1": true,
    "select2": "always",
    "sidebarWidth": 250
}

Phải lưu theo semantic formatter.

Ví dụ:

{
    "schemaVersion": 1,
    "styleId": "company-standard",
    "name": "Company Standard",
    "database": "sqlserver",
    "settings": {
        "operators": {
            "andOr": {
                "placeOnNewLine": "always",
                "alignment": "rightToStatement",
                "keywordBeforeCondition": true
            }
        }
    }
}
18. Style Schema Version

Mỗi Style phải có:

{
    "schemaVersion": 1
}

Khi cấu trúc thay đổi:

Style schema v1
      |
      v
Migration
      |
      v
Style schema v2

Không được làm Style cũ bị lỗi khi cập nhật IDE.

19. Option mới trong phiên bản mới

Ví dụ phiên bản mới thêm:

Align JOIN conditions

Style cũ không có property này.

Formatter phải dùng default:

Style value
    |
    +-- exists -> use user value
    |
    +-- missing -> use default

Không được coi missing property là lỗi.

20. User Data

Style Code là dữ liệu của user.

Không lưu Style Code trong các file thuộc application package:

templates/
static/
app/

Nên có:

data/
├── settings.json
├── connections.json
├── snippets.json
└── styles/
    ├── styles.json
    ├── company-standard.json
    └── my-style.json

Tốt hơn nữa, với ứng dụng Windows, user data nên nằm ngoài thư mục application/update:

Program Files/
    LLTool/

AppData/
    LLTool/
        data/
            styles/

Mục tiêu:

Update Application
        |
        +-- Replace application files
        |
        +-- KEEP user data
21. Default Style và User Style

Phân biệt rõ:

System Styles
├── Default
├── SQL Server Standard
└── PostgreSQL Standard

User Styles
├── Company Standard
├── My Style
└── Bravo Style

System Style:

Do application cung cấp.
Có thể thay đổi khi update.

User Style:

Do user tạo/chỉnh sửa.
Không được update ghi đè.
22. Style Manager

Cần có màn hình quản lý Style.

Ví dụ:

Style Manager

System Styles
    Default
    SQL Server Standard
    PostgreSQL Standard

User Styles
    Company Standard
    Bravo Style

[New]
[Duplicate]
[Import]
[Export]
[Delete]
23. Duplicate Style

User có thể chọn:

Company Standard
        |
        v
Duplicate
        |
        v
Company Standard Copy

Sau đó chỉnh một số option mà không ảnh hưởng Style gốc.

24. Import / Export

Export:

Company-Standard.sqlstyle.json

Import phải:

Đọc file.
Validate schema.
Kiểm tra version.
Migration nếu cần.
Kiểm tra Style ID.
Không ghi đè Style hiện tại ngoài ý muốn.
Tạo Style mới nếu bị trùng.

Nếu trùng:

Company Standard
Company Standard (1)
25. Reset

Hỗ trợ 3 cấp:

Reset Option
Reset this option

Đưa option về default.

Reset Category
Reset Operators

Đưa toàn bộ option trong category về default.

Reset Style
Reset Style

Đưa toàn bộ Style về default.

Reset Style phải có confirmation.

26. Unsaved Changes

Khi user thay đổi bất kỳ option nào:

Style: Company Standard *

Khi Close:

You have unsaved changes.

[Save]
[Discard]
[Cancel]

Không được tự động bỏ thay đổi.

27. Active Style theo Database

Không nên mặc định một Style duy nhất cho tất cả Database.

Có thể hỗ trợ:

SQL Server
[Company Standard ▼]

PostgreSQL
[PostgreSQL Standard ▼]

Hoặc:

Style scope:

( ) All databases
(*) SQL Server
( ) PostgreSQL

Mục tiêu là tránh việc Style SQL Server được áp dụng sai cho PostgreSQL.

28. Performance

Preview phải có debounce:

Option changed
    |
    v
300-500ms
    |
    v
Format Preview

Không format lại ngay lập tức hàng chục lần khi user thao tác liên tục.

Nếu SQL rất lớn, có thể chuyển sang:

Preview is large.

[Refresh Preview]

để tránh lag UI.

29. Các trạng thái cần xử lý

Phải test tối thiểu:

Trạng thái Kết quả
Mở Style Load toàn bộ config
Chọn category Hiển thị options
Search option Filter đúng option
Thay checkbox Preview cập nhật
Thay select Preview cập nhật
Dependency Option liên quan enable/disable
Preview sample Format SQL mẫu
Preview current query Format query Editor
SQL invalid Hiển thị lỗi formatter
Save Persist user data
Close chưa save Hiển thị confirmation
Reset option Về default
Reset category Về default
Reset style Về default
Duplicate Tạo Style mới
Import Validate + tạo Style
Export Tạo file Style
Update IDE Style vẫn tồn tại
Style schema cũ Migration
Option mới Dùng default
SQL Server Dùng SQL Server dialect
PostgreSQL Dùng PostgreSQL dialect
30. Thứ tự triển khai

Không triển khai tất cả cùng lúc.

Phase 1 — Style Data Model

Xây dựng:

Style schema
Option metadata
Default Style
User Style
schemaVersion

Kết quả:

Style Editor
    |
    v
Style Configuration Object
Phase 2 — Style Editor UI

Triển khai giao diện giống màn hình hiện tại:

Sidebar
Search
Category
Select
Checkbox
Number
Text
Radio

Chưa cần hoàn thiện Formatter.

Mục tiêu là UI có thể render động từ metadata.

Phase 3 — Formatter Preview

Triển khai:

SQL
+
Style Config
    |
    v
Formatter
    |
    v
Preview

Kết nối các option cơ bản:

Whitespace.
Casing.
Indentation.
Lists.
Operators.
Parentheses.
Phase 4 — Option Dependency

Triển khai:

Option A
    |
    v
Dependency Rule
    |
    v
Enable / Disable Option B
Phase 5 — Persistence

Triển khai:

Load Style
Save Style
Reset Option
Reset Category
Reset Style
Unsaved State

Đảm bảo dữ liệu nằm trong user data.

Phase 6 — Style Manager

Triển khai:

New
Duplicate
Delete
Import
Export
Phase 7 — Schema Migration

Triển khai:

schemaVersion
Migration
Default fallback
Backward compatibility
Phase 8 — SQL Server / PostgreSQL

Triển khai:

Common Formatter
SQL Server Dialect
PostgreSQL Dialect

Kiểm tra formatter không áp dụng syntax của dialect này sang dialect khác.

31. Phạm vi thay đổi

Agent phải chỉ thay đổi các khu vực liên quan tới Style Code.

Phạm vi dự kiến:

Style Code UI
Style Configuration
Formatter
Preview
User Style Storage
Style Manager

Không tự ý thay đổi:

Connection Manager
Database Explorer
Query Execution
Result Grid
IntelliSense
Monaco configuration
CodeMirror configuration
License
Update mechanism

trừ khi thực sự cần tích hợp Preview với Editor.

Nếu cần thay đổi module ngoài phạm vi trên, phải mô tả:

File / Module:
Reason:
Impact:
Risk:

trước khi thực hiện.

32. Quy tắc làm việc với Database

Màn hình Style Code chỉ thực hiện format SQL.

Không được tự động:

CREATE
ALTER
DROP
INSERT
UPDATE
DELETE
EXEC

hoặc bất kỳ thao tác Database nào.

Preview không được gửi SQL tới Database.

Nếu cần lấy query hiện tại từ Editor thì chỉ đọc text từ Editor.

33. Tiêu chí hoàn thành

Tính năng được xem là hoàn thành khi:

 Style Editor render được từ metadata.
 Search option hoạt động.
 Category hoạt động.
 Checkbox hoạt động.
 Select hoạt động.
 Number/Text/Radio hoạt động.
 Dependency hoạt động.
 Preview sample hoạt động.
 Preview current query hoạt động.
 Preview không truy cập Database.
 Formatter không phụ thuộc UI.
 Save/Load Style hoạt động.
 Unsaved changes được xử lý.
 Reset option hoạt động.
 Reset category hoạt động.
 Reset style hoạt động.
 Duplicate Style hoạt động.
 Import Style hoạt động.
 Export Style hoạt động.
 Style schema có version.
 Có migration cho schema.
 Option mới có default fallback.
 User Style không bị mất khi update IDE.
 SQL Server có dialect riêng.
 PostgreSQL có dialect riêng.
 Không phá vỡ các chức năng hiện tại của IDE.
34. Kiến trúc cuối cùng
                         Style Manager
                              |
                 +------------+------------+
                 |            |            |
                New        Duplicate     Import
                 |            |            |
                 +------------+------------+
                              |
                              v
                       Style Editor UI
                              |
             +----------------+----------------+
             |                |                |
           Search         Categories         Preview
             |                |                |
             +----------------+----------------+
                              |
                              v
                    Style Configuration
                              |
                    +---------+---------+
                    |                   |
               Persistence         Formatter
                    |                   |
                    |          +--------+--------+
                    |          |                 |
                    |      SQL Server       PostgreSQL
                    |          |                 |
                    |          +--------+--------+
                    |                   |
                    |                   v
                    |             Formatted SQL
                    |                   |
                    +-------------------+
                                        |
                                        v
                                  Editor Preview
Nguyên tắc quan trọng nhất
UI ≠ Formatter
UI ≠ Style Data
Style Data ≠ Application Files
Preview ≠ Database Execution

Style Code phải là một cấu hình độc lập, có version, có khả năng migration và được lưu trong user data. Formatter chỉ đọc cấu hình đó để biến SQL đầu vào thành SQL đầu ra. Điều này sẽ giúp hệ thống mở rộng được theo hướng SQL Prompt mà không làm kiến trúc IDE hiện tại bị phụ thuộc vào giao diện.
