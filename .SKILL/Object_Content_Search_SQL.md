# OBJECT CONTENT SEARCH – KẾ HOẠCH TRIỂN KHAI

## 1. Mục tiêu

Xây dựng chức năng tìm kiếm nội dung bên trong DDL của các SQL Object.

User nhập từ khóa → hệ thống tìm trong nội dung DDL → hiển thị danh sách các Object chứa từ khóa → user chọn Object → hiển thị DDL → highlight tất cả vị trí khớp → phía dưới hiển thị danh sách các vị trí khớp.

Các Object hỗ trợ:

- View
- Stored Procedure
- Function
- Trigger

Chức năng chỉ thực hiện **search và navigation**, không tự động sửa DDL hoặc thực thi DDL.

---

# 2. UI Layout

Thiết kế màn hình theo mô hình 3 vùng:

```text
┌──────────────────────────────────────────────────────────────┐
│ Search: [ customer_id              ] [Search]                │
│                                                              │
│ [✓] View   [✓] Procedure   [✓] Function   [✓] Trigger       │
├───────────────────┬──────────────────────────────────────────┤
│ OBJECT RESULTS    │ DDL VIEWER                               │
│                   │                                          │
│ 4 Objects         │ 1  CREATE VIEW dbo.vCustomer AS          │
│                   │ 2      SELECT                            │
│ ▼ Views           │ 3          c.CustomerId,                 │
│   vCustomer       │ 4          c.CustomerName                │
│   vCustomerDebt   │ 5      FROM Customer c                   │
│                   │ 6      WHERE c.CustomerId = @customer_id│
│ ▼ Procedures      │                    ^^^^^^^^^^^            │
│   usp_GetCustomer │                                          │
│                   │                                          │
│ ▼ Functions       │                                          │
│   ufn_GetCustomer │                                          │
│                   ├──────────────────────────────────────────┤
│                   │ MATCHES (3)                         [⌃] │
│                   │ Line 18   WHERE CustomerId = ...        │
│                   │ Line 42   JOIN Customer ...             │
│                   │ Line 87   @customer_id ...              │
└───────────────────┴──────────────────────────────────────────┘
```

---

# 3. Search Bar

## 3.1 Thành phần

Search toolbar gồm:

- Search input
- Search button
- Clear button
- Case Sensitive
- Whole Word
- Filter Object Type

Ví dụ:

```text
Search:
[ customer_id                     ] [🔍]

☑ View
☑ Procedure
☑ Function
☑ Trigger

☐ Case Sensitive
☐ Whole Word
```

Không nên search ngay sau mỗi lần user gõ.

Chỉ thực hiện search khi:

- Enter
- Click Search
- Có thể bổ sung debounce nếu cần nhưng không phải mặc định.

Mục tiêu là tránh query DB liên tục khi user đang nhập.

---

# 4. Object Type Filter

Cho phép user lọc:

```text
View
Procedure
Function
Trigger
```

Filter có thể chọn nhiều loại.

Ví dụ:

```text
☑ View
☑ Procedure
☐ Function
☐ Trigger
```

Kết quả chỉ trả về:

```text
Views
Procedures
```

Nếu thay đổi filter nhưng keyword không đổi:

- Không cần lấy lại toàn bộ DDL nếu frontend đã có result cache.
- Có thể filter lại danh sách kết quả hiện tại.
- Nếu backend search theo object type thì gửi request mới.

---

# 5. Object Result List

Bên trái hiển thị danh sách Object có chứa keyword.

Ví dụ:

```text
RESULTS  12

VIEW
────────────────
dbo.vCustomer
dbo.vCustomerDebt
dbo.vCustomerSummary

PROCEDURE
────────────────
dbo.usp_GetCustomer
dbo.usp_GetCustomerDebt

FUNCTION
────────────────
dbo.ufn_GetCustomer
```

Mỗi item nên hiển thị:

```text
Object Name
Object Type
Schema
Match Count
```

Ví dụ:

```text
dbo.usp_GetCustomer
PROCEDURE
8 matches
```

## Object đang chọn

Object hiện tại phải có trạng thái active rõ ràng.

Khi click object:

1. Load DDL.
2. Hiển thị DDL trên Monaco.
3. Highlight tất cả keyword.
4. Tạo danh sách Match Location.
5. Focus match đầu tiên.

---

# 6. Backend Search

Không nên load toàn bộ DDL của tất cả object xuống frontend rồi mới search nếu database có số lượng object lớn.

Kiến trúc:

```text
Frontend
   │
   │ Search Request
   ▼
Backend API
   │
   ▼
SQL Server Metadata
   │
   ├── sys.objects
   ├── sys.sql_modules
   ├── sys.schemas
   └── object type
```

Nguồn chính để lấy nội dung DDL:

```sql
sys.sql_modules.definition
```

Kết hợp:

```sql
sys.objects
sys.schemas
sys.sql_modules
```

---

# 7. Search API

Đề xuất API:

```http
POST /api/sql/object-search
```

Request:

```json
{
    "keyword": "customer_id",
    "object_types": [
        "VIEW",
        "PROCEDURE",
        "FUNCTION",
        "TRIGGER"
    ],
    "case_sensitive": false,
    "whole_word": false
}
```

Response:

```json
{
    "total_objects": 3,
    "objects": [
        {
            "schema": "dbo",
            "name": "vCustomer",
            "type": "VIEW",
            "match_count": 4
        },
        {
            "schema": "dbo",
            "name": "usp_GetCustomer",
            "type": "PROCEDURE",
            "match_count": 8
        }
    ]
}
```

API search ban đầu chỉ cần trả:

- Object metadata
- Match count

Không nhất thiết trả toàn bộ DDL.

Điều này giúp giảm lượng dữ liệu truyền về frontend.

---

# 8. API lấy DDL

Khi user click Object:

```http
GET /api/sql/object-ddl
```

Ví dụ:

```text
/api/sql/object-ddl?schema=dbo&name=usp_GetCustomer&type=PROCEDURE
```

Response:

```json
{
    "schema": "dbo",
    "name": "usp_GetCustomer",
    "type": "PROCEDURE",
    "ddl": "CREATE PROCEDURE ...",
    "version": "...",
    "matches": [
        {
            "line": 18,
            "column": 21,
            "length": 11
        },
        {
            "line": 42,
            "column": 16,
            "length": 11
        }
    ]
}
```

Có thể để backend tính `matches`, hoặc frontend tính sau khi nhận DDL.

Đề xuất:

**Backend trả DDL + match metadata.**

Frontend chỉ chịu trách nhiệm render.

---

# 9. Monaco DDL Viewer

Sử dụng Monaco Editor hiện có.

Không cần tạo editor mới.

Cấu hình:

```text
readOnly = true
```

Mục đích của màn hình:

- Xem DDL
- Highlight
- Navigation
- Không chỉnh sửa

Nếu sau này muốn hỗ trợ Edit DDL có thể mở rộng.

---

# 10. Highlight Keyword

Sử dụng Monaco Decorations API.

Ví dụ:

```javascript
editor.deltaDecorations([], [
    {
        range: {
            startLineNumber: 18,
            startColumn: 21,
            endLineNumber: 18,
            endColumn: 32
        },
        options: {
            inlineClassName: 'sql-search-match'
        }
    }
]);
```

Có 2 trạng thái:

### Match bình thường

```text
customer_id
^^^^^^^^^^^
```

### Match đang active

Match được user chọn từ panel phía dưới phải có trạng thái nổi bật hơn.

Ví dụ:

```text
customer_id
^^^^^^^^^^^
```

và editor scroll tới dòng tương ứng.

---

# 11. Match Location Panel

Đây là panel nằm phía dưới vùng DDL.

Ví dụ:

```text
MATCHES (8)                                  [⌃]

1  Line 18    customer_id
2  Line 27    customer_id
3  Line 42    customer_id
4  Line 51    customer_id
5  Line 63    customer_id
6  Line 72    customer_id
7  Line 84    customer_id
8  Line 91    customer_id
```

Panel phải hỗ trợ:

- Collapse
- Expand
- Scroll
- Click từng match.

---

# 12. Click Match → Navigate Monaco

Khi user click:

```text
Line 42    customer_id
```

thực hiện:

```javascript
editor.revealLineInCenter(42);

editor.setPosition({
    lineNumber: 42,
    column: 16
});
```

Sau đó focus editor.

Không chỉ scroll tới dòng.

Phải đảm bảo:

- Cursor nằm tại match.
- Match được active.
- User nhìn thấy vị trí đó.

---

# 13. Match Navigation

Bổ sung:

```text
↑ Previous Match
↓ Next Match
```

Có thể đặt trên toolbar.

Ví dụ:

```text
Search: [customer_id] [🔍]

Matches: 3/8

[ ↑ ] [ ↓ ]
```

Behavior:

```text
Ctrl + Enter
```

hoặc button Next:

```text
Match 1
   ↓
Match 2
   ↓
Match 3
```

Khi tới cuối:

```text
Match 8 → Match 1
```

Có thể wrap-around.

---

# 14. Active Match

Quản lý:

```javascript
activeMatchIndex
```

Ví dụ:

```text
activeMatchIndex = 2
totalMatches = 8
```

UI:

```text
3 / 8
```

Khi click item:

```javascript
activeMatchIndex = index;
navigateToMatch(index);
```

---

# 15. DDL Line Number

Monaco tự quản lý line number.

Không tự xây dựng line-number component.

Điều này giúp tránh:

- lệch dòng
- lệch scroll
- lỗi khi DDL dài.

---

# 16. Search Result Cache

Có thể cache theo:

```text
connection
database
keyword
object_types
case_sensitive
whole_word
```

Ví dụ:

```javascript
searchCache.set(
    cacheKey,
    result
);
```

Mục tiêu:

User:

```text
customer
```

→ search

Sau đó:

```text
View OFF
```

→ không nhất thiết phải query database lại nếu dữ liệu đã có.

---

# 17. Không lưu DDL vào User Data

Đây là điểm quan trọng.

DDL lấy từ database là:

```text
Runtime Data
```

Không phải:

```text
User Configuration
```

Do đó **không lưu vào**:

```text
data/
connections.json
settings.json
snippets.json
```

DDL chỉ tồn tại trong:

```text
runtime memory
```

Cache nếu có cũng nên là:

```text
session cache
```

hoặc cache có TTL.

---

# 18. Database Scope

Search phải chạy trong:

```text
Current Connection
Current Database
```

Không tự động search tất cả database.

UI nên thể hiện:

```text
SQL Server
└── Database: BravoDB

Object Content Search
```

Điều này tránh một vấn đề nghiêm trọng:

User tưởng đang search database A nhưng backend lại search database B.

---

# 19. Permission

Không cố gắng bypass permission.

Nếu user không có quyền đọc definition của object:

```sql
sys.sql_modules.definition
```

có thể NULL.

UI nên hiển thị:

```text
Definition is unavailable because the current user
does not have permission to view this object definition.
```

Không coi đây là object không chứa keyword.

Phải phân biệt:

```text
No match
```

và

```text
Definition unavailable
```

---

# 20. Object Types

SQL Server mapping:

```text
V  = VIEW
P  = SQL_STORED_PROCEDURE
FN = SQL_SCALAR_FUNCTION
IF = SQL_INLINE_TABLE_VALUED_FUNCTION
TF = SQL_TABLE_VALUED_FUNCTION
TR = SQL_TRIGGER
```

Frontend chỉ cần 4 nhóm:

```text
VIEW
PROCEDURE
FUNCTION
TRIGGER
```

Backend mapping các subtype Function về:

```text
FUNCTION
```

---

# 21. Function Search

Function cần gom:

```text
FN
IF
TF
```

thành:

```text
FUNCTION
```

Ví dụ:

```text
FUNCTION
├── dbo.ufn_GetCustomer
├── dbo.ufn_GetTotal
└── dbo.ufn_GetBalance
```

---

# 22. Trigger Search

Cần xác định trigger thuộc:

```text
TABLE
DATABASE
SERVER
```

Nếu giai đoạn đầu chỉ hỗ trợ DDL của trigger gắn với table:

```text
SQL Trigger
```

thì phải ghi rõ scope.

Không nên giả định mọi trigger đều là table trigger.

Có thể mở rộng sau:

```text
TABLE TRIGGER
DATABASE TRIGGER
SERVER TRIGGER
```

---

# 23. Search Matching

Giai đoạn đầu:

```text
LIKE / CHARINDEX
```

hoặc xử lý matching tương ứng với collation của SQL Server.

Không nên tự ép lowercase toàn bộ DDL nếu đang hỗ trợ:

```text
Case Sensitive
```

Cần đảm bảo behavior của:

```text
Case Sensitive = OFF
```

và:

```text
Case Sensitive = ON
```

nhất quán.

---

# 24. Whole Word

Nếu:

```text
Whole Word = ON
```

và search:

```text
customer
```

thì:

```text
customer
```

match.

Nhưng:

```text
customer_id
customer_name
```

không nhất thiết được tính là whole-word match.

Logic whole-word nên xử lý ở backend/frontend một cách nhất quán.

---

# 25. Search Result Sorting

Mặc định:

```text
Object Type
    ↓
Schema
    ↓
Object Name
```

Ví dụ:

```text
VIEW
    dbo.vCustomer
    dbo.vCustomerDebt

PROCEDURE
    dbo.usp_GetCustomer
    dbo.usp_GetCustomerDebt

FUNCTION
    dbo.ufn_GetCustomer

TRIGGER
    dbo.trg_Customer_Update
```

Có thể bổ sung sort:

```text
Name
Match Count
Type
```

ở phase sau.

---

# 26. Loading State

Khi search:

```text
Searching objects...
```

Không để UI đứng im.

Ví dụ:

```text
RESULTS

🔄 Searching 1,245 objects...
```

Sau khi hoàn thành:

```text
RESULTS 12
```

---

# 27. Empty State

Không có kết quả:

```text
No objects found

No View, Procedure, Function or Trigger
contains "customer_xyz".
```

Không hiển thị DDL viewer rỗng gây khó hiểu.

---

# 28. Object Loading State

Khi click object:

```text
dbo.usp_GetCustomer

Loading definition...
```

Sau đó mới render Monaco.

---

# 29. Error Handling

Các lỗi cần phân biệt:

### Search lỗi

```text
Unable to search object definitions.
```

### Không có quyền

```text
Definition unavailable.
```

### Object đã bị xóa

```text
Object no longer exists.
```

### Connection mất

```text
Database connection is unavailable.
```

Không nên gom tất cả thành:

```text
Unknown error
```

---

# 30. Performance

Đây là phần cần đặc biệt chú ý.

Không nên:

```text
SELECT definition
FROM sys.sql_modules
```

rồi trả toàn bộ hàng nghìn object về frontend.

Flow nên là:

```text
Keyword
   ↓
SQL Server search
   ↓
Object metadata + match count
   ↓
User chọn object
   ↓
Load DDL của object đó
   ↓
Monaco
```

Như vậy nếu database có:

```text
5,000 Views
2,000 Procedures
1,000 Functions
```

frontend vẫn nhẹ.

---

# 31. Large DDL

Nếu DDL rất lớn:

```text
100 KB
500 KB
1 MB+
```

Monaco vẫn có thể xử lý nhưng phải tránh tạo quá nhiều decorations không cần thiết.

Chỉ tạo decoration cho:

```text
match locations
```

Không tạo DOM element riêng cho từng keyword.

---

# 32. Kiến trúc Frontend

Đề xuất tách module:

```text
object-content-search/
│
├── ObjectContentSearchController
├── ObjectSearchApi
├── ObjectSearchStore
├── ObjectResultList
├── DdlViewer
├── MatchPanel
├── SearchToolbar
└── MatchNavigator
```

Responsibility:

### ObjectSearchApi

Gọi backend.

### ObjectSearchStore

Quản lý:

```text
keyword
filters
results
selectedObject
ddl
matches
activeMatch
```

### ObjectResultList

Render danh sách object.

### DdlViewer

Quản lý Monaco.

### MatchPanel

Render match locations.

### MatchNavigator

Next/Previous match.

---

# 33. State Model

Có thể dùng state:

```javascript
{
    keyword: "",
    objectTypes: [
        "VIEW",
        "PROCEDURE",
        "FUNCTION",
        "TRIGGER"
    ],

    caseSensitive: false,
    wholeWord: false,

    results: [],

    selectedObject: null,

    ddl: null,

    matches: [],

    activeMatchIndex: -1,

    isSearching: false,
    isLoadingDdl: false,

    error: null,

    matchPanelCollapsed: false
}
```

---

# 34. Event Flow

## Search

```text
User nhập keyword
        ↓
Enter / Search
        ↓
Validate keyword
        ↓
Build request
        ↓
Backend search
        ↓
Render Object Results
        ↓
Auto-select first object
        ↓
Load DDL
```

## Click Object

```text
Click Object
      ↓
selectedObject
      ↓
Load DDL
      ↓
Parse matches
      ↓
Render Monaco
      ↓
Apply decorations
      ↓
Build Match Panel
      ↓
Focus first match
```

## Click Match

```text
Click Match
      ↓
activeMatchIndex
      ↓
Monaco revealLineInCenter()
      ↓
setPosition()
      ↓
active decoration
```

---

# 35. Không làm trong Phase 1

Không đưa các chức năng sau vào MVP:

- Edit DDL.
- Save DDL.
- Execute DDL.
- Replace keyword.
- Replace All.
- Rename object.
- Rename column.
- Dependency analysis.
- Cross-database search.
- Search lịch sử.
- Regex search phức tạp.
- Search trong dữ liệu table.

Các chức năng này dễ làm scope bị phình.

---

# 36. Phase 1 – MVP

Triển khai:

```text
✓ Search keyword
✓ View
✓ Procedure
✓ Function
✓ Trigger
✓ Object result list
✓ Match count
✓ DDL viewer
✓ Monaco
✓ Keyword highlight
✓ Match panel
✓ Collapse/Expand Match panel
✓ Click match → jump line
✓ Previous / Next match
✓ Loading state
✓ Empty state
✓ Error state
```

---

# 37. Phase 2 – UX Enhancement

Sau khi MVP ổn định:

```text
□ Search history
□ Regex
□ Match context preview
□ Sort result
□ Search result grouping
□ Keyboard shortcut
□ Pin object
□ Open DDL in editor tab
□ Copy object name
□ Open Object Explorer
```

Keyboard shortcut đề xuất:

```text
Ctrl + Shift + F
```

cho:

```text
Search Object Content
```

---

# 38. Phase 3 – Advanced Search

Có thể mở rộng:

```text
Search:
- Object name
- Object definition
- Column name
- Table name
- Procedure parameter
- Comment
```

Ví dụ:

```text
Search: CustomerId

Definition
├── dbo.vCustomer
├── dbo.usp_GetCustomer
└── dbo.trg_Customer

Object dependency
├── dbo.B20Customer
├── dbo.vCustomerSummary
└── dbo.usp_CustomerReport
```

Nhưng Dependency nên là chức năng riêng, không trộn vào Object Content Search MVP.

---

# 39. Điểm cần tránh

## Không search bằng cách lấy toàn bộ database metadata về frontend

Sai:

```text
DB
 ↓
10,000 objects
 ↓
Frontend
 ↓
JavaScript search
```

Đúng:

```text
Frontend
 ↓
Search request
 ↓
SQL Server
 ↓
Matched objects
 ↓
Frontend
```

## Không render từng keyword thành HTML

Sai:

```text
DDL → split string → HTML spans
```

Đúng:

```text
Monaco
+
Decorations
```

## Không tạo editor mới cho từng object

Chỉ sử dụng:

```text
1 Monaco instance
```

và thay model/content khi selected object thay đổi.

---

# 40. Tiêu chí hoàn thành

Feature được coi là hoàn thành khi:

### Search

- [ ] Nhập keyword và search được.
- [ ] Filter View/Procedure/Function/Trigger hoạt động.
- [ ] Case Sensitive hoạt động.
- [ ] Whole Word hoạt động.

### Results

- [ ] Hiển thị đúng Object.
- [ ] Hiển thị Object Type.
- [ ] Hiển thị Match Count.
- [ ] Có empty state.

### DDL

- [ ] Load đúng DDL.
- [ ] Monaco hiển thị đúng syntax.
- [ ] Line number chính xác.
- [ ] Keyword được highlight.

### Navigation

- [ ] Match panel hiển thị đúng số lượng.
- [ ] Panel có thể collapse.
- [ ] Click match → jump đúng dòng.
- [ ] Previous/Next hoạt động.
- [ ] Active match được phân biệt.

### Performance

- [ ] Không load toàn bộ DDL của database xuống frontend.
- [ ] Không tạo DOM node cho từng match.
- [ ] Không query DB mỗi lần user gõ một ký tự.
- [ ] DDL lớn không làm UI bị freeze.

### Safety

- [ ] Search không thực thi DDL.
- [ ] Search không sửa object.
- [ ] Không ghi DDL vào user settings.
- [ ] Tôn trọng database permission.

---

# 41. Kiến trúc tổng thể

```text
                    OBJECT CONTENT SEARCH
                             │
                             ▼
                    ┌─────────────────┐
                    │ Search Toolbar  │
                    │ Keyword         │
                    │ Object Filters  │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Backend API     │
                    │ Object Search   │
                    └────────┬────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ SQL Server Metadata  │
                  │ sys.objects          │
                  │ sys.schemas          │
                  │ sys.sql_modules      │
                  └──────────┬───────────┘
                             │
                             ▼
              ┌─────────────────────────────┐
              │ Object Result List          │
              │ View / Proc / Func / Trigger│
              └──────────────┬──────────────┘
                             │
                       Select Object
                             │
                             ▼
                  ┌─────────────────────┐
                  │ DDL API             │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │ Monaco DDL Viewer   │
                  │                     │
                  │ Highlight Matches   │
                  │ Line Navigation     │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │ Match Panel         │
                  │                     │
                  │ Line 18             │
                  │ Line 42             │
                  │ Line 87             │
                  └─────────────────────┘
```

# 42. Khuyến nghị triển khai

Thứ tự nên là:

```text
1. Backend metadata search
        ↓
2. Object Search API
        ↓
3. UI Search Toolbar
        ↓
4. Object Result List
        ↓
5. DDL API
        ↓
6. Monaco DDL Viewer
        ↓
7. Match detection
        ↓
8. Monaco highlighting
        ↓
9. Match Panel
        ↓
10. Click → Navigate
        ↓
11. Previous / Next
        ↓
12. Performance optimization
        ↓
13. Keyboard shortcuts
```

**Không nên bắt đầu từ UI trước rồi mới thiết kế API**, vì điểm khó nhất của tính năng này là xác định chính xác phạm vi object, permission, matching và cách lấy definition. UI chỉ là lớp hiển thị phía trên dữ liệu đó.

# 43. Phạm vi tác động

Feature này chỉ nên tác động tới:

```text
Frontend
├── New Object Content Search UI
├── Monaco DDL Viewer integration
└── Search state/navigation

Backend
├── Object Search API
└── Object DDL API

Database
└── READ ONLY metadata queries
```

Không thay đổi:

```text
User connection data
Existing editor
Existing Monaco configuration
CodeMirror IntelliSense
SQL execution engine
Object Explorer
Existing DDL generation
User settings
```

Đặc biệt, **CodeMirror 6 hiện đang phục vụ IntelliSense thì không cần tham gia vào chức năng này**. Monaco đã có sẵn khả năng decoration, line navigation và model management nên phù hợp hơn cho DDL viewer.

---

# 44. Cải tiến kiến trúc Multi-tab, Toolbar Layout & PostgreSQL Search Fix

### 44.1 Toolbar Layout Tách Biệt và Tối Ưu Diện Tích
- **Cụm Connection (Server › Database › Schema)**: Tách riêng trong `.ocs-scope-selectors` với `flex: 0 0 auto !important; flex-shrink: 0 !important; white-space: nowrap;`. Kích thước cố định vừa vặn với nhãn, hoàn toàn độc lập và không bao giờ bị ảnh hưởng co giãn bởi thanh tìm kiếm. Có đường kẻ `.ocs-toolbar-divider` phân cách rõ ràng.
- **Cụm Search Cluster**: Thiết lập `flex: 1 1 auto !important; min-width: 180px;`, chiếm trọn vẹn toàn bộ diện tích còn lại ở giữa thanh toolbar. Ô nhập từ khóa `#ocs-keyword-input` mở rộng tối đa (`width: 100% !important; flex: 1 1 auto !important; max-width: none !important;`).
- **Các Filter Checkboxes & Controls**: Được cố định ở góc phải với `flex-shrink: 0`.

### 44.2 Hỗ Trợ Nhiều Tab Search Độc Lập (Multi-Tab Sessions)
- **Quản lý phiên theo Tab ID**: `ObjectContentSearchController` duy trì `tabSessions = new Map<tabId, Session>()`.
- **Lưu trữ độc lập cho từng tab**: Mỗi tab lưu trữ riêng:
  - Scope: `connectionId`, `connectionName`, `database`, `schema`, `dbType`.
  - Từ khóa & tùy chọn tìm kiếm: `keyword`, `objectTypes`, `caseSensitive`, `wholeWord`, `isRegex`.
  - Dữ liệu kết quả & bộ lọc: `results`, `filterText`, `sortBy`, `pinnedObjects`.
  - Trạng thái xem DDL: `selectedObject`, `ddlData` (gồm code DDL và mảng matches), `activeMatchIndex`.
- **Đồng bộ khi đổi tab (`activateTab`)**: Tự động lưu snapshot của tab cũ và khôi phục đầy đủ trạng thái UI, input, checkboxes, danh sách kết quả, DDL viewer trên Monaco và Match Panel của tab mới.
- **Đồng bộ khi đổi Database / Connection**: Tự động cập nhật tiêu đề tab trên thanh tab (`Search: <DatabaseName>`) và lưu ngay vào session của tab đó.
- **Đóng tab (`closeTab`)**: Xóa phiên lưu trữ tương ứng trong Map để giải phóng bộ nhớ.

### 44.3 Sửa Lỗi Tìm Kiếm PostgreSQL
- **Nguyên nhân gốc**: PostgreSQL driver (`psycopg2`) sử dụng phép nội suy chuỗi dựa trên ký tự `%` khi có tham số `params`. Các câu truy vấn có chứa chuỗi như `LIKE 'pg_%'` bị hiểu nhầm là format specifier `%_`, gây văng ngoại lệ `ValueError: unsupported format character '\'' (0x27) at index ...`, khiến khối `except Exception: pass` bắt lỗi và trả về danh sách rỗng.
- **Khắc phục triệt để**:
  1. Thay thế mệnh đề `LIKE 'pg_%'` thành `LEFT(n.nspname, 3) != 'pg_'` (hoàn toàn không chứa ký tự `%`), tránh xung đột DB-API parser.
  2. Bổ sung làm sạch `schema_filter`: bỏ qua các giá trị như `All Schemas`, `All Schemas (*)`, `all`, `*`, `none`.
  3. Tối ưu tìm kiếm Views bằng cách truy vấn trực tiếp bảng danh mục hệ thống `pg_catalog.pg_views` và `pg_catalog.pg_matviews` (tốc độ cao, không gọi hàm nặng trong mệnh đề WHERE).
  4. Thêm fallback an toàn với `p.prosrc` cho Functions/Procedures nếu `pg_get_functiondef(p.oid)` gặp lỗi phân quyền.