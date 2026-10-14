# KẾ HOẠCH THIẾT KẾ GIAO DIỆN VIEW STYLE CODE

## 1. Mục tiêu

Xây dựng màn hình `View Style Code` để người dùng có thể:

- Xem toàn bộ cấu hình Style Code hiện tại.
- Tạo mới Style Code.
- Chỉnh sửa Style Code.
- Nhân bản Style Code.
- Xóa Style Code.
- Đặt một Style Code làm Style mặc định/đang sử dụng.
- Xem trước kết quả format SQL theo Style đang chọn.
- Kiểm tra nhanh sự khác biệt giữa SQL gốc và SQL sau khi format.
- Quản lý Style Code độc lập với dữ liệu SQL của từng editor/tab.
- Đảm bảo cấu hình Style Code của user không bị mất khi update/rebuild ứng dụng.

Màn hình này là nơi quản lý cấu hình formatter, còn việc thực thi format trên editor sẽ sử dụng Style Code đang được chọn.

---

# 2. Phạm vi

## Bao gồm

1. Thiết kế màn hình View Style Code.
2. Danh sách Style Code.
3. Hiển thị Style Code đang được sử dụng.
4. Các thao tác:
   - New
   - Edit
   - Duplicate
   - Delete
   - Set as Default
   - Preview
5. Hiển thị chi tiết cấu hình của Style Code.
6. Preview SQL sau khi áp dụng Style.
7. Lưu cấu hình Style Code vào user data.
8. Load lại cấu hình khi ứng dụng khởi động.
9. Tích hợp với chức năng Format Code trên Monaco Editor.

## Không bao gồm

- Thay đổi kiến trúc Monaco Editor.
- Thay đổi cơ chế IntelliSense.
- Thay đổi SQL execution.
- Thay đổi Result Grid.
- Thay đổi connection manager.
- Thay đổi Object Explorer.

---

# 3. Nguyên tắc thiết kế

## 3.1. Style Code là cấu hình của User

Style Code phải được xem là user configuration.

Không lưu Style Code vào source code hoặc dữ liệu build cố định.

Không để quá trình update/rebuild ứng dụng ghi đè dữ liệu Style Code của user.

Ví dụ:

```text
Application
│
├── static/
├── templates/
├── ...
│
└── data/
    ├── connections.json
    ├── settings.json
    ├── snippets.json
    └── code_styles.json

Trong đó:

code_styles.json

là dữ liệu riêng của user.

4. Cấu trúc giao diện tổng thể

Màn hình View Style Code nên chia thành 3 khu vực chính:

┌──────────────────────────────────────────────────────────────┐
│ Style Code                                      [ + New ]    │
├───────────────────────┬──────────────────────────────────────┤
│                       │                                      │
│ Style List            │ Style Detail                         │
│                       │                                      │
│ ● Default             │ Style Name                           │
│   SQL Prompt          │ Description                          │
│   Compact SQL         │                                      │
│   My Style             │ Formatting Options                   │
│                       │                                      │
│                       │                                      │
│                       │                                      │
│                       │                                      │
├───────────────────────┴──────────────────────────────────────┤
│ [Duplicate] [Delete] [Set Default]       [Preview] [Save]    │
└──────────────────────────────────────────────────────────────┘

Không nên nhồi toàn bộ cấu hình vào một popup nhỏ.

Màn hình cần đủ không gian để người dùng có thể nhìn thấy:

tên Style;
trạng thái;
các nhóm cấu hình;
preview;
thao tác.
5. Header

Header:

Style Code

Bên phải:

[ + New Style ]

Có thể bổ sung:

[ Import ]
[ Export ]

nhưng Import/Export không phải yêu cầu bắt buộc của phiên bản đầu tiên.

6. Style List

Khu vực bên trái hiển thị danh sách Style Code.

Ví dụ:

Style Codes

┌─────────────────────────────┐
│ ● Default                   │
│   SQL Prompt                │
│                             │
│   Compact                   │
│                             │
│   Bravo SQL                 │
│                             │
│   My Style                  │
└─────────────────────────────┘
Mỗi item cần hiển thị
Style name.
Icon hoặc marker cho Style đang active.
Có thể hiển thị description ngắn.

Ví dụ:

● Default
  SQL Prompt

Trong đó:

●

biểu thị Style hiện tại đang được sử dụng.

7. Active Style

Style đang được sử dụng cần được nhận biết rõ ràng.

Không chỉ dựa vào màu nền.

Nên có ít nhất:

✓ Default

hoặc:

● Default

và badge:

Active

Ví dụ:

┌──────────────────────────┐
│ ✓ SQL Prompt             │
│   Active                 │
└──────────────────────────┘

Điều này đặc biệt quan trọng vì khi user bấm:

Format Code

formatter sẽ lấy Style đang Active.

8. Style Detail

Khi user chọn một Style Code, panel bên phải hiển thị chi tiết.

Cấu trúc:

Style Detail

Name
[ SQL Prompt                         ]

Description
[ SQL formatting style              ]

-------------------------------------

Formatting

Keyword Case
[ UPPERCASE ▼ ]

Identifier Case
[ Preserve ▼ ]

Indent Size
[ 4 ]

Use Tabs
[ ]

-------------------------------------

Statement

Comma Position
[ Leading ▼ ]

Keyword Alignment
[ None ▼ ]

AND / OR Alignment
[ Indent ▼ ]

-------------------------------------

Parentheses

Function
[ Same Line ▼ ]

Condition
[ Same Line ▼ ]

-------------------------------------

JOIN

JOIN Type
[ Same Line ▼ ]

ON Condition
[ New Line ▼ ]

-------------------------------------

Preview

SELECT
    ...
9. Phân nhóm cấu hình

Không hiển thị tất cả option thành một danh sách dài.

Chia thành các nhóm.

Đề xuất:

General
Indentation
Keyword
SELECT
FROM / JOIN
WHERE
GROUP BY
ORDER BY
CASE
Function
Parentheses
Comments
Comma
Advanced

Có thể sử dụng:

Accordion
Tabs
Section

Ưu tiên Accordion vì người dùng có thể mở nhiều nhóm cùng lúc.

10. General

Các thuộc tính chung:

Style Name
Description

Ví dụ:

Style Name
[ Bravo SQL ]

Description
[ SQL style used for Bravo development ]
11. Indentation

Các option:

Indent Size
[ 4 ]

Use Tabs
[ ]

Continuation Indent
[ 4 ]

Cần giới hạn giá trị hợp lệ.

Ví dụ:

Indent Size: 1 → 16

Không cho phép giá trị âm hoặc giá trị không hợp lệ.

12. Keyword

Các option:

Keyword Case
[ UPPERCASE ▼ ]

Built-in Function Case
[ UPPERCASE ▼ ]

Data Type Case
[ UPPERCASE ▼ ]

Giá trị có thể:

UPPERCASE
lowercase
Capitalize
Preserve
13. SELECT

Các option liên quan SELECT:

SELECT Keyword
[ Same Line ▼ ]

Column Layout
[ One Per Line ▼ ]

Comma Style
[ Leading ▼ ]

Column Indent
[ 4 ]

Ví dụ preview:

SELECT
    a.Id
    ,a.Code
    ,a.Name
FROM B20Customer a

hoặc:

SELECT
    a.Id,
    a.Code,
    a.Name
FROM B20Customer a

Formatter phải lấy cấu hình từ Style Code.

14. FROM / JOIN

Các option:

FROM Position
[ New Line ▼ ]

JOIN Position
[ New Line ▼ ]

JOIN Indent
[ Same Level ▼ ]

ON Position
[ New Line ▼ ]

AND in JOIN
[ Indent ▼ ]

Preview:

FROM B20Customer c
LEFT JOIN B20CustomerGroup g
    ON g.Id = c.CustomerGroupId
15. WHERE

Các option:

WHERE Position
[ New Line ▼ ]

AND / OR
[ New Line ▼ ]

Condition Indent
[ 4 ]

Preview:

WHERE c.IsActive = 1
    AND c.BranchCode = 'A01'
    AND c.CustomerId = @CustomerId
16. GROUP BY / ORDER BY

Cấu hình tương tự:

GROUP BY
ORDER BY
HAVING

Ví dụ:

GROUP BY
    c.CustomerId,
    c.CustomerCode

ORDER BY
    c.CustomerCode
17. CASE

Cấu hình:

CASE Layout
[ Multi Line ▼ ]

WHEN Indent
[ 4 ]

THEN Position
[ Same Line ▼ ]

ELSE Position
[ Same Line ▼ ]

END Position
[ New Line ▼ ]

Preview:

CASE
    WHEN c.IsActive = 1 THEN 'Active'
    WHEN c.IsActive = 0 THEN 'Inactive'
    ELSE 'Unknown'
END
18. Function

Cấu hình:

Function Name
[ Same Line ▼ ]

Function Arguments
[ Multi Line ▼ ]

Argument Indent
[ 4 ]

Ví dụ:

COALESCE(
    c.Name,
    ''
)
19. Comments

Cấu hình:

Preserve Comments
[ ✓ ]

Indent Comments
[ ✓ ]

Format Comment
[ ]

Keep Comment Position
[ ✓ ]

Mặc định:

Preserve Comments = true

Formatter không được tự ý làm mất comment của user.

20. Advanced

Các option nâng cao không nên hiển thị cho user mới ngay lập tức.

Ví dụ:

[ Advanced Options ]

Khi mở:

Parser Behavior
Formatting Priority
Unsupported Syntax Behavior
Dialect

Dialect:

SQL Server
PostgreSQL
Generic SQL

Điểm quan trọng:

Style Code không nên giả định SQL Server và PostgreSQL giống nhau.

Formatter phải biết dialect hiện tại.

Ví dụ:

SQL Server
    TOP
    [Identifier]
    GETDATE()

PostgreSQL
    LIMIT
    "Identifier"
    CURRENT_DATE
21. Preview

Preview là thành phần quan trọng của màn hình.

User không nên phải:

Save Style.
Mở editor.
Viết SQL.
Format.
Quay lại Style Code.

Chỉ để biết Style hoạt động như thế nào.

Do đó màn hình cần có:

Preview

với SQL mẫu.

22. Preview Input

Preview nên có SQL mẫu mặc định.

Ví dụ:

SELECT a.Id,a.Code,a.Name
FROM B20Customer a
LEFT JOIN B20CustomerGroup g ON g.Id=a.CustomerGroupId
WHERE a.IsActive=1 AND a.BranchCode=@BranchCode
ORDER BY a.Code

Sau khi format:

SELECT
    a.Id
    ,a.Code
    ,a.Name
FROM B20Customer a
LEFT JOIN B20CustomerGroup g
    ON g.Id = a.CustomerGroupId
WHERE a.IsActive = 1
    AND a.BranchCode = @BranchCode
ORDER BY
    a.Code

Preview phải cập nhật khi thay đổi cấu hình.

23. Preview không được làm ảnh hưởng editor

Preview chỉ là dữ liệu tạm.

Không được:

thay đổi SQL đang mở;
thay đổi editor;
thay đổi undo stack;
thay đổi active tab;
thay đổi file hiện tại.

Preview formatter phải chạy độc lập.

24. Nút thao tác

Footer:

[Duplicate] [Delete] [Set as Default]

                         [Cancel] [Save]

Preview có thể nằm ở khu vực riêng:

[Format Preview]
25. New Style

Khi user bấm:

+ New Style

Tạo Style mới.

Không copy trực tiếp object reference của Style cũ.

Nếu tạo từ Style hiện tại:

Clone Style

phải tạo deep copy.

Ví dụ:

SQL Prompt
    ↓ Duplicate
SQL Prompt Copy

Hai Style phải hoàn toàn độc lập.

26. Duplicate

Khi Duplicate:

SQL Prompt

thành:

SQL Prompt Copy

Nếu đã tồn tại:

SQL Prompt Copy 2

hoặc:

SQL Prompt (1)
SQL Prompt (2)

Không overwrite Style cũ.

27. Delete

Khi user Delete:

Nếu Style không active:

Delete "SQL Prompt"?

[Cancel] [Delete]

Nếu Style đang active:

Không cho xóa trực tiếp nếu đây là Style đang được sử dụng.

Có thể yêu cầu:

This style is currently active.
Please select another style before deleting it.

Hoặc tự động chuyển active sang Default nhưng cách này dễ gây hành vi ngoài ý muốn.

Ưu tiên yêu cầu user chọn Style khác trước.

28. Set Default

User có thể chọn:

Set as Default

Sau đó Style được đánh dấu:

✓ Default

Khi ứng dụng khởi động:

Active Style = Default Style

Tuy nhiên cần phân biệt:

Default Style

và:

Active Style

Hai khái niệm không nhất thiết phải giống nhau.

Ví dụ:

Default = SQL Prompt
Active = Bravo SQL

Nếu user mở ứng dụng mới:

Active = SQL Prompt
29. Active Style trong Editor

Editor không cần biết toàn bộ cấu hình Style.

Editor chỉ cần nhận:

activeStyleId

Formatter chịu trách nhiệm load:

styleId

và cấu hình tương ứng.

Flow:

Monaco
   │
   │ Format Code
   ▼
Format Service
   │
   │ activeStyleId
   ▼
Style Manager
   │
   ▼
Style Configuration
   │
   ▼
SQL Formatter
   │
   ▼
Formatted SQL
   │
   ▼
Monaco
30. Format Code trên Editor

Khi user:

Right Click
    ↓
Format Code

hoặc:

Nav Bar
    ↓
Format Code

formatter lấy:

Active Style

Không hỏi lại Style mỗi lần format.

Nếu user muốn đổi Style:

Style Code
    ↓
Set Active

Sau đó Format Code sẽ dùng Style mới.

31. Format File và Format Selection

Phải phân biệt:

Format toàn bộ file

Khi không có selection:

Format Code

→ format toàn bộ SQL đang mở.

Có popup xác nhận nếu đây là thao tác có khả năng thay đổi lớn:

Format entire document?

[Cancel] [Format]
Format selection

Nếu user đang select SQL:

Format Code

→ chỉ format vùng selection.

Không được format toàn bộ document.

32. Unsaved Changes

Nếu user chỉnh Style:

Indent = 4

nhưng chưa Save.

Khi chuyển sang Style khác:

Save changes to "Bravo SQL"?

[Discard] [Cancel] [Save]

Không được tự động mất dữ liệu.

33. Dirty State

Style đang chỉnh sửa cần có trạng thái:

Bravo SQL *

Dấu:

*

biểu thị unsaved changes.

Ví dụ:

Style Code

✓ SQL Prompt
  Bravo SQL *
  Compact
34. Reset

Có thể bổ sung:

Reset to Default

Nhưng Reset không được xóa Style.

Reset chỉ đưa các option về cấu hình mặc định.

Phải có confirmation:

Reset all formatting options?

[Cancel] [Reset]
35. Import / Export

Có thể triển khai sau.

Mục đích:

backup Style;
chia sẻ Style giữa máy;
chia sẻ Style trong team.

Format:

{
    "version": 1,
    "styles": [
        {
            "id": "sql_prompt",
            "name": "SQL Prompt",
            "description": "...",
            "dialect": "sqlserver",
            "options": {}
        }
    ]
}

Không import trực tiếp đè dữ liệu hiện tại.

Nếu trùng ID:

Import as Copy

hoặc:

Overwrite

phải được user xác nhận.

36. Data Model đề xuất

File:

data/code_styles.json

Cấu trúc:

{
    "version": 1,
    "activeStyleId": "sql_prompt",
    "defaultStyleId": "sql_prompt",
    "styles": [
        {
            "id": "sql_prompt",
            "name": "SQL Prompt",
            "description": "SQL Prompt style",
            "dialect": "sqlserver",
            "options": {
                "keywordCase": "upper",
                "indentSize": 4,
                "useTabs": false,
                "commaStyle": "leading",
                "whereAndOr": "newLine",
                "joinOn": "newLine",
                "preserveComments": true
            }
        }
    ]
}

ID phải ổn định.

Không dùng:

name

làm primary key.

Ví dụ:

name = "SQL Prompt"

có thể thay đổi.

ID:

sql_prompt

không nên thay đổi.

37. User Data và Application Data

Phải phân biệt rõ:

Application Default Data

và:

User Data

Application có thể chứa:

default_code_styles.json

làm dữ liệu mặc định.

User có:

data/code_styles.json

Khi lần đầu chạy:

default_code_styles.json
        ↓
copy
        ↓
user code_styles.json

Sau đó chỉ đọc dữ liệu user.

Không được mỗi lần startup copy lại default đè lên user.

38. Migration

Khi nâng version application:

code_styles.json
version = 1

Nếu schema mới:

version = 2

phải có migration:

v1
 ↓
migration
 ↓
v2

Không được reset toàn bộ Style.

Ví dụ:

v1:
indentSize

v2:
indentSize
continuationIndent

Migration có thể bổ sung:

continuationIndent = indentSize
39. Error Handling

Nếu:

code_styles.json

bị lỗi JSON:

Không crash ứng dụng.

Hiển thị:

Unable to load Code Styles.

The style configuration may be corrupted.

[Restore Backup] [Use Default]

Nếu file bị mất:

Create default code_styles.json

nhưng không ảnh hưởng:

connections.json
settings.json
snippets.json
40. UI Responsive

Màn hình phải hoạt động tốt khi:

1920x1080;
1366x768;
cửa sổ bị resize;
sidebar thu nhỏ.

Style List có width tối thiểu.

Style Detail sử dụng phần diện tích còn lại.

Preview có thể chuyển từ:

2 columns

sang:

1 column

khi cửa sổ quá nhỏ.

41. Context Menu

Trong Style List có thể hỗ trợ right-click:

SQL Prompt

---------------------
Edit
Duplicate
Set as Default
Delete
---------------------
Export

Không cần tạo quá nhiều action trên giao diện chính.

42. Keyboard Shortcut

Nên hỗ trợ:

Ctrl + N

→ New Style

Ctrl + S

→ Save Style

Ctrl + D

→ Duplicate Style

Delete

→ Delete Style

Không override shortcut của Monaco khi focus đang nằm trong editor/preview editor.

43. Preview Editor

Preview nên sử dụng editor component có syntax highlighting.

Không nhất thiết phải dùng một instance Monaco đầy đủ.

Nếu sử dụng Monaco:

readOnly = true

Không bật IntelliSense.

Không kết nối database.

Không gọi backend để lấy metadata.

Mục đích chỉ là:

Input SQL
    ↓
Formatter
    ↓
Preview SQL
44. Performance

Preview không được format sau mỗi lần user gõ nếu formatter nặng.

Có thể debounce:

150–300ms

hoặc chỉ cập nhật khi:

Option changed

Không gọi API server cho từng thay đổi nhỏ nếu formatter có thể chạy local.

45. Kiến trúc Component

Đề xuất:

StyleCodeView
│
├── StyleCodeHeader
│
├── StyleCodeList
│   └── StyleCodeListItem
│
├── StyleCodeEditor
│   ├── GeneralSection
│   ├── IndentationSection
│   ├── KeywordSection
│   ├── SelectSection
│   ├── JoinSection
│   ├── WhereSection
│   ├── CaseSection
│   ├── CommentSection
│   └── AdvancedSection
│
├── StylePreview
│
└── StyleCodeFooter
46. Service Layer

Không xử lý trực tiếp JSON trong UI.

Tạo:

StyleCodeService

Chịu trách nhiệm:

getStyles()
getStyle(id)
createStyle()
updateStyle()
deleteStyle()
duplicateStyle()
setActiveStyle()
setDefaultStyle()
save()
load()
migrate()

Formatter:

SqlFormatterService

chịu trách nhiệm:

format(sql, style, dialect)

UI không tự format SQL.

47. State Management

State tối thiểu:

styles
activeStyleId
defaultStyleId
selectedStyleId
editingStyle
isDirty
previewSql
formattedPreviewSql

Phải phân biệt:

selectedStyle

và:

activeStyle

Ví dụ:

Active = SQL Prompt
Selected = Bravo SQL

User có thể chỉnh Bravo SQL nhưng editor vẫn đang sử dụng SQL Prompt.

Chỉ khi user:

Set Active

thì activeStyleId mới thay đổi.

48. Không tự động Active khi Select

Đây là điểm quan trọng.

Không nên:

Click Style
→ Style lập tức trở thành Active

Vì user có thể chỉ muốn xem/chỉnh sửa Style.

Flow đúng:

Click Style
→ View/Edit

Set Active
→ Active Style thay đổi
49. Confirmation Rules

Không hỏi confirmation cho thao tác không nguy hiểm.

Không cần:

Open Style?

Nhưng cần confirmation cho:

Delete
Discard Changes
Reset
Format Entire Document
Overwrite Import
50. Accessibility

Các control phải có:

tooltip;
label;
keyboard navigation;
focus state;
disabled state.

Không dùng màu sắc duy nhất để biểu thị trạng thái.

Ví dụ Active phải có:

✓ Active

không chỉ đổi màu xanh.

51. Các trạng thái UI cần xử lý

Phải thiết kế đầy đủ các trạng thái:

Empty
No Style Code

[ + Create Style ]
Loading
Loading Style Codes...
Normal
Style list + detail
Editing
Bravo SQL *
Error
Unable to load Style Code
No Selection
Select a Style Code
52. Tích hợp với Settings

Có thể thêm:

Settings
    └── Editor
        └── Code Formatting

Các setting chung:

Format on Paste
Format on Save
Default Style

Tuy nhiên:

Format on Save

không nên triển khai mặc định.

Mặc định:

false

vì format SQL có thể làm thay đổi rất nhiều dòng và gây khó chịu cho user.

53. SQL Dialect

Style Code cần xác định dialect.

Ví dụ:

SQL Server
PostgreSQL
Generic SQL

Có thể cho:

Dialect = Auto

Trong trường hợp đó editor truyền:

connection type

vào formatter.

Flow:

Editor
 ↓
Current Connection
 ↓
SQL Server / PostgreSQL
 ↓
Formatter
 ↓
Active Style

Không nên để formatter đoán dialect chỉ dựa vào text SQL nếu connection hiện tại đã biết rõ.

54. Tương thích SQL Server và PostgreSQL

Cần tránh thiết kế Style Code quá phụ thuộc SQL Server.

Ví dụ không nên tạo option:

Use TOP

trong formatter generic.

Nên tạo rule theo dialect:

Pagination

SQL Server:

TOP 10

PostgreSQL:

LIMIT 10

Tương tự với:

Identifier quoting
Function formatting
Type formatting
55. Logging

Khi formatter lỗi:

Không hiển thị stack trace trực tiếp cho user.

UI:

Unable to format SQL.

[View Details]

Developer log:

Style ID
Dialect
Formatter version
Error

Không log:

password;
access token;
connection string chứa credential.
56. Testing UI

Phải test:

Style
Create
Edit
Save
Duplicate
Delete
Set Active
Set Default
Data
Restart app
Update app
Missing JSON
Invalid JSON
Migration
Formatter
SQL Server
PostgreSQL
SELECT
JOIN
WHERE
CASE
Function
Comment
Subquery
CTE
Editor
Format full document
Format selection
Undo
Redo
Multiple tabs
Unsaved SQL
57. Quy tắc không được phá vỡ
Không overwrite user Style Code khi update application.
Không lưu Style Code vào static/template source.
Không dùng Style Name làm ID.
Không tự động Active Style khi chỉ Select Style.
Không làm mất comment khi format nếu user đã bật Preserve Comments.
Không format toàn bộ document khi user chỉ select một đoạn.
Không để Preview ảnh hưởng editor thật.
Không để formatter phụ thuộc trực tiếp vào UI.
Không để SQL Server formatter phá PostgreSQL syntax.
Không thay đổi IntelliSense hiện tại khi triển khai Style Code.
Không thay đổi connection manager.
Không thay đổi Object Explorer.
Không thay đổi Result Grid.
Không refactor các module không liên quan chỉ để triển khai Style Code.
58. Phạm vi ảnh hưởng

Các module được phép thay đổi:

UI
├── Style Code View
├── Style Code List
├── Style Code Editor
└── Style Preview

Data
└── code_styles.json

Service
├── StyleCodeService
└── SqlFormatterService

Editor
└── Format Code integration

Các module không được thay đổi nếu không cần thiết:

Connection Manager
Object Explorer
IntelliSense
Result Grid
Query Execution
Authentication
Terminal
Project Management

Nếu implementation phát hiện cần thay đổi các module ngoài phạm vi trên, phải xác định rõ:

Why
Impact
Risk
Alternative

trước khi thực hiện.

59. Implementation Order

Thực hiện theo thứ tự:

Phase 1 — Data Model

Tạo:

code_styles.json

và:

StyleCodeService

Hoàn thành CRUD.

Phase 2 — UI Skeleton

Tạo:

StyleCodeView
StyleCodeList
StyleCodeEditor
StylePreview

Chưa cần formatter hoàn chỉnh.

Phase 3 — Style Configuration

Implement toàn bộ nhóm option.

Phase 4 — Preview

Kết nối:

StyleCode
    ↓
SqlFormatterService
    ↓
Preview
Phase 5 — Editor Integration

Kết nối:

Format Code

với:

activeStyleId
Phase 6 — Persistence

Kiểm tra:

Restart
Update
Migration
Backup
Invalid JSON
Phase 7 — Polish

Hoàn thiện:

Context Menu
Keyboard Shortcut
Tooltip
Loading
Empty State
Error State
Responsive UI
60. Acceptance Criteria

Feature chỉ được coi là hoàn thành khi:

 User có thể tạo Style Code.
 User có thể chỉnh sửa Style Code.
 User có thể Duplicate Style Code.
 User có thể Delete Style Code.
 User có thể Set Active Style.
 User có thể Set Default Style.
 User có thể xem Preview.
 Preview phản ánh cấu hình hiện tại.
 Active Style được Format Code sử dụng.
 Format Selection chỉ format selection.
 Format Document format toàn bộ document.
 User data không bị mất sau khi update application.
 Style được load lại sau khi restart.
 Có migration cho schema version.
 SQL Server và PostgreSQL được phân biệt dialect.
 Không ảnh hưởng IntelliSense.
 Không ảnh hưởng Connection Manager.
 Không ảnh hưởng Object Explorer.
 Không ảnh hưởng Result Grid.
 Không có thao tác ghi DB ngoài phạm vi feature.
 Không thực hiện thay đổi ngoài phạm vi mà không xác định impact trước.
61. Nguyên tắc UX cuối cùng

Màn hình View Style Code phải giúp user trả lời được 3 câu hỏi ngay lập tức:

Tôi đang dùng Style nào?
Style này đang format SQL theo quy tắc nào?
Nếu tôi bấm Format Code thì SQL sẽ thay đổi như thế nào?

Do đó:

Active Style
     ↓
Style Configuration
     ↓
Live Preview

phải là luồng chính của màn hình.

Không biến màn hình thành một "settings form" quá dài mà user không thể hình dung kết quả formatter.
