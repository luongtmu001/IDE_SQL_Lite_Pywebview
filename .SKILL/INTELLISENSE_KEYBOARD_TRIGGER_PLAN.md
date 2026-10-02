# IntelliSense Keyboard Trigger Analysis & Control Plan

## 1. Mục tiêu

Phân tích và cải thiện cơ chế kích hoạt IntelliSense trong IDE SQL hiện tại, tập trung vào:

- Kiểm soát chính xác thời điểm IntelliSense được kích hoạt.
- Không tự động mở suggestion popup sau mọi thao tác bàn phím.
- Phân biệt:
  - ký tự nên trigger IntelliSense;
  - ký tự chỉ cần cập nhật context;
  - thao tác phải đóng popup;
  - thao tác cần giữ popup;
  - thao tác không được trigger IntelliSense.
- Giữ nguyên giao diện IntelliSense hiện tại.
- Không thay đổi kiến trúc UI nếu không cần thiết.
- Không thay thế CodeMirror.
- Không đưa framework IntelliSense mới vào ở giai đoạn này.
- Tập trung vào logic trigger, keyboard handling, context detection và lifecycle của suggestion popup.

---

# 2. Nguyên tắc quan trọng

Không được coi:

```text
keyup
keydown
input
change
cursorActivity
```

là đồng nghĩa với:

```text
"hãy mở IntelliSense"
```

Đây là lỗi kiến trúc thường gặp ở IntelliSense tự xây dựng.

Cần tách thành:

```text
Keyboard Event
      ↓
Input Classification
      ↓
SQL Context Analysis
      ↓
Trigger Decision
      ↓
Suggestion Provider
      ↓
Popup Lifecycle
```

Trong đó:

```text
Keyboard Event
```

chỉ là tín hiệu đầu vào.

Nó không được trực tiếp gọi:

```javascript
showSuggestions()
```

---

# 3. Kiểm tra kiến trúc hiện tại trước khi sửa

Agent phải tìm toàn bộ code liên quan đến IntelliSense.

Tìm các pattern:

```javascript
keydown
keyup
keypress
input
beforeChange
change
cursorActivity
mousedown
mouseup
focus
blur
paste
drop
compositionstart
compositionend
```

Đồng thời tìm:

```javascript
showSuggestions
showCompletion
openCompletion
triggerCompletion
autocomplete
suggestions
completion
intellisense
hideSuggestions
closeSuggestions
refreshSuggestions
updateSuggestions
```

Và các đoạn:

```javascript
editor.on(...)
```

đặc biệt:

```javascript
editor.on("keydown", ...)
editor.on("inputRead", ...)
editor.on("cursorActivity", ...)
```

---

# 4. Lập Trigger Map

Agent phải tạo một bảng mô tả hiện trạng.

Ví dụ:

| Event | Key/Input | Hiện tại | Mong muốn |
|---|---|---|---|
| keydown | Ctrl+Space | mở suggestion | mở |
| input | `.` | mở suggestion | mở |
| input | chữ | mở suggestion | chỉ mở nếu context phù hợp |
| input | Space | mở suggestion | thường không mở |
| input | `(` | mở suggestion | tùy context |
| input | `,` | mở suggestion | tùy context |
| keydown | ArrowDown | refresh | không refresh |
| keydown | ArrowUp | refresh | không refresh |
| keydown | Enter | refresh | accept suggestion |
| keydown | Escape | refresh | đóng popup |
| keydown | Backspace | refresh | cập nhật hoặc đóng |
| keydown | Delete | refresh | cập nhật hoặc đóng |
| paste | SQL text | mở suggestion | phân tích lại context |
| mouse click | cursor move | mở suggestion | không mở |

Không được sửa code trước khi hoàn thành bảng này.

---

# 5. Phân loại Keyboard Action

Tạo một lớp logic trung gian:

```javascript
class IntelliSenseTriggerController {
    classifyKey(event) {}
    shouldTrigger(event, context) {}
    shouldRefresh(event, context) {}
    shouldClose(event, context) {}
}
```

Không bắt buộc phải dùng class nếu codebase hiện tại không theo OOP.

Có thể dùng:

```javascript
function classifyKeyEvent(event) {}

function shouldTriggerIntelliSense(event, context) {}

function shouldRefreshIntelliSense(event, context) {}

function shouldCloseIntelliSense(event, context) {}
```

Điều quan trọng là **tách decision logic khỏi CodeMirror event handler**.

---

# 6. Phân loại phím

Tạo các nhóm:

## 6.1 Explicit Trigger

Đây là các thao tác mà người dùng chủ động yêu cầu IntelliSense.

Ví dụ:

```text
Ctrl + Space
```

Kết quả:

```text
TRIGGER_EXPLICIT
```

Đây là trigger có độ tin cậy cao nhất.

---

# 7. Character Trigger

Một số ký tự có ý nghĩa đặc biệt trong SQL.

Ví dụ:

```text
.
```

Khi user viết:

```sql
SELECT *
FROM Customer c
WHERE c.
```

ký tự:

```text
.
```

có thể trigger column suggestion.

Nhưng phải kiểm tra context.

Không được đơn giản:

```javascript
if (char === ".") {
    showSuggestions();
}
```

Phải:

```text
.
↓
phân tích token
↓
identifier trước dấu .
↓
xác định alias/table
↓
column provider
↓
show suggestion
```

---

# 8. Identifier Typing

Đây là nhóm dễ gây popup liên tục nhất.

Ví dụ:

```sql
SEL
SELE
SELEC
SELECT
SELECT *
FRO
FROM
FROM C
FROM Cu
FROM Cus
```

Không nên:

```text
mỗi key → mở popup → query metadata → render popup
```

Thay vào đó:

```text
User typing
    ↓
detect identifier
    ↓
update current token
    ↓
check context
    ↓
if completion is already active:
       update existing completion
else:
       decide whether auto-trigger is appropriate
```

---

# 9. Phân biệt Trigger và Refresh

Đây là điểm bắt buộc phải kiểm tra.

Ví dụ:

```sql
SELECT Cu
```

Sau khi popup được mở:

```text
C
Cu
Cus
Cust
```

không phải mỗi lần đều là:

```text
TRIGGER
```

mà thường là:

```text
TRIGGER
   ↓
ACTIVE COMPLETION
   ↓
REFRESH
```

Hai trạng thái phải khác nhau.

Ví dụ:

```javascript
completionState = {
    visible: true,
    mode: "identifier",
    start: 7,
    end: 9,
    query: "Cu"
};
```

Khi user gõ:

```text
s
```

chỉ:

```javascript
refreshCompletion()
```

không phải:

```javascript
triggerCompletion()
```

---

# 10. State Machine

Nên xây dựng state machine tối thiểu:

```text
IDLE
  │
  │ explicit trigger
  ▼
OPENING
  │
  ▼
VISIBLE
  │
  ├── typing identifier ──→ REFRESHING
  │
  ├── ArrowUp/Down ───────→ NAVIGATING
  │
  ├── Enter ───────────────→ ACCEPTING
  │
  ├── Escape ──────────────→ IDLE
  │
  ├── invalid context ────→ IDLE
  │
  └── cursor moved ───────→ IDLE / REPOSITION
```

Không được để popup lifecycle phụ thuộc trực tiếp vào từng `keydown`.

---

# 11. Kiểm tra từng phím quan trọng

Agent phải tạo test matrix.

## A. Navigation

```text
ArrowUp
ArrowDown
ArrowLeft
ArrowRight
Home
End
PageUp
PageDown
```

Yêu cầu:

```text
không trigger IntelliSense mới
```

Nếu popup đang mở:

```text
ArrowUp/ArrowDown
```

chỉ điều hướng suggestion.

---

# 12. Enter

Enter có hai trạng thái.

### Popup đang mở

```text
Enter
```

→ accept selected suggestion.

Không được:

```text
accept
+
trigger IntelliSense mới
```

Ví dụ:

```sql
SELECT Cust
```

chọn:

```text
CustomerName
```

Enter phải tạo:

```sql
SELECT CustomerName
```

và kết thúc action.

---

### Popup không mở

```text
Enter
```

→ newline.

Không được trigger IntelliSense chỉ vì Enter.

---

# 13. Escape

Nếu popup đang mở:

```text
Escape
```

→ đóng popup.

Sau đó:

```text
Escape
```

không được lập tức mở lại.

Đây là bug rất phổ biến khi logic `input/cursorActivity` tự động trigger.

---

# 14. Backspace

Backspace cần được kiểm tra kỹ.

Ví dụ:

```sql
SELECT Cus
```

xóa:

```text
s
```

thành:

```sql
SELECT Cu
```

Nếu completion đang active:

```text
refresh
```

Nhưng nếu xóa đến:

```sql
SELECT 
```

thì:

```text
close
```

Không được:

```text
Backspace → trigger new completion
```

---

# 15. Delete

Delete cũng phải giống Backspace.

Phân biệt:

```text
delete trong identifier
```

và:

```text
delete làm mất context
```

Ví dụ:

```sql
Customer.
```

xóa `.`:

```sql
Customer
```

→ column completion phải đóng.

---

# 16. Space

Space là một trigger đặc biệt.

Không được mặc định:

```javascript
if (event.key === " ") {
    trigger();
}
```

Ví dụ:

```sql
SELECT 
```

Không nhất thiết phải popup ngay.

Nhưng:

```sql
SELECT * FROM 
```

có thể cần table/view suggestion tùy thiết kế IntelliSense.

Do đó:

```text
SPACE
↓
analyze SQL context
↓
determine completion category
```

Không phải:

```text
SPACE → show all objects
```

---

# 17. Dấu phẩy

Ví dụ:

```sql
SELECT CustomerId,
```

Sau `,` có thể cần column suggestion.

Nhưng:

```sql
SELECT COUNT(a,b)
```

hoặc:

```sql
VALUES (1,2)
```

không nên trigger cùng loại suggestion.

Vì vậy:

```text
,
↓
context parser
↓
SQL construct
↓
completion category
```

---

# 18. Dấu chấm

Đây là trigger quan trọng nhất.

Kiểm tra:

```sql
table.
alias.
schema.
database.schema.
```

Ví dụ:

```sql
SELECT c.
```

→ columns của alias `c`.

Nhưng:

```sql
SELECT 10.
```

không được coi là table/alias completion.

Ngoài ra phải xử lý:

```sql
dbo.Customer.
Database.dbo.Customer.
```

nếu engine hỗ trợ.

---

# 19. Parentheses

Kiểm tra:

```text
(
)
```

Ví dụ:

```sql
SELECT COUNT(
```

không nên tự động hiển thị table list.

Trong:

```sql
WHERE CustomerId IN (
```

context hoàn toàn khác.

Trong:

```sql
FROM (
```

lại là subquery context.

Do đó parenthesis phải được đưa vào SQL context parser.

---

# 20. Quote

Kiểm tra:

```text
'
"
[
]
```

Ví dụ:

```sql
SELECT *
FROM [Customer
```

không nên xử lý:

```text
Customer
```

giống identifier bình thường nếu SQL Server bracket identifier đang mở.

Tương tự:

```sql
'Cus
```

phải được nhận diện là string literal.

Trong string literal:

```text
IntelliSense identifier
```

thường phải:

```text
DISABLED
```

---

# 21. Comment

Đây là test bắt buộc.

```sql
-- SELECT Cus
```

và:

```sql
/*
SELECT Cus
*/
```

Trong comment:

```text
không trigger IntelliSense
```

Nếu hiện tại popup vẫn xuất hiện khi gõ trong comment thì đó là lỗi context detection.

---

# 22. String Literal

Test:

```sql
SELECT 'Customer'
```

Khi user gõ:

```text
Cus
```

trong string:

```text
không được mở table/column suggestion
```

Đặc biệt:

```sql
WHERE Name = 'Cus
```

---

# 23. SQL Keyword

Cần phân biệt:

```text
keyword
identifier
function
table
column
alias
schema
```

Ví dụ:

```sql
SEL
```

có thể suggestion:

```text
SELECT
```

Nhưng:

```sql
SELECT Cus
```

phải ưu tiên:

```text
column/object
```

thay vì liên tục hiện keyword.

---

# 24. Context-Based Trigger

Xây dựng completion context:

```javascript
{
    type: "keyword",
    token: "SEL"
}
```

hoặc:

```javascript
{
    type: "table",
    token: "Cus"
}
```

hoặc:

```javascript
{
    type: "column",
    token: "Cus",
    alias: "c"
}
```

hoặc:

```javascript
{
    type: "function",
    token: "COU"
}
```

Ví dụ:

```sql
SELECT c.Cus
FROM Customer c
```

Context phải là:

```text
completionType = COLUMN
alias = c
token = Cus
```

Không phải:

```text
completionType = ALL
```

---

# 25. Không dùng "Show All Suggestions" làm fallback mặc định

Đây là lỗi cần đặc biệt tìm.

Nếu parser không xác định được context:

KHÔNG nên:

```javascript
return allSuggestions;
```

Thay vào đó:

```javascript
return NO_TRIGGER;
```

hoặc:

```javascript
return LIMITED_CONTEXT;
```

Nguyên tắc:

```text
Không chắc → không tự động mở
```

Nhưng:

```text
Ctrl + Space
```

có thể yêu cầu explicit completion.

---

# 26. Explicit Trigger và Automatic Trigger

Phải tách:

```javascript
triggerCompletion({
    reason: "explicit"
});
```

và:

```javascript
triggerCompletion({
    reason: "automatic"
});
```

Ví dụ:

```text
Ctrl + Space
```

→ explicit.

```text
.
```

→ automatic.

```text
typing identifier
```

→ automatic/refresh tùy context.

Điều này giúp debug rất dễ.

---

# 27. Trigger Reason

Mỗi lần IntelliSense được kích hoạt phải ghi nhận:

```javascript
{
    reason: "character",
    key: ".",
    context: "column",
    token: "c",
    cursor: 124
}
```

Hoặc:

```javascript
{
    reason: "explicit",
    key: "Ctrl+Space",
    context: "table"
}
```

Không cần log production vĩnh viễn.

Chỉ cần:

```text
IntelliSense Debug Mode
```

---

# 28. Debug Timeline

Tạo debug log dạng:

```text
14:22:01 KEYDOWN C
14:22:01 INPUT "C"
14:22:01 CONTEXT identifier
14:22:01 COMPLETION ACTIVE
14:22:01 REFRESH token="C"

14:22:02 KEYDOWN U
14:22:02 INPUT "Cu"
14:22:02 CONTEXT identifier
14:22:02 REFRESH token="Cu"

14:22:03 KEYDOWN ESC
14:22:03 CLOSE reason="escape"
```

Điều này cực kỳ hữu ích để phát hiện:

```text
1 key → nhiều trigger
```

---

# 29. Phát hiện Double Trigger

Agent phải kiểm tra các trường hợp:

```text
keydown
↓
trigger
↓
input
↓
trigger
```

hoặc:

```text
keyup
↓
trigger

cursorActivity
↓
trigger
```

Một thao tác người dùng chỉ nên tạo:

```text
ONE logical completion action
```

trừ trường hợp cần refresh.

---

# 30. Debounce không phải giải pháp chính

Không được giải quyết toàn bộ vấn đề bằng:

```javascript
debounce(triggerCompletion, 200)
```

Debounce chỉ giải quyết:

```text
quá nhiều request liên tiếp
```

Nó không giải quyết:

```text
trigger sai context
trigger bởi ArrowDown
trigger bởi Enter
trigger trong comment
trigger trong string
trigger sau Escape
```

Do đó thứ tự phải là:

```text
Correct Trigger Decision
        ↓
Correct Context
        ↓
Correct State
        ↓
Debounce / Throttle
```

---

# 31. Metadata Request

Nếu IntelliSense có gọi backend để lấy metadata:

Không được:

```text
mỗi key
→ query database
```

Cần:

```text
Trigger
   ↓
Context
   ↓
Provider
   ↓
Cache
   ↓
Filter locally
```

Ví dụ metadata:

```text
Customer
 ├── CustomerId
 ├── CustomerName
 ├── Address
 └── Phone
```

Sau khi đã load:

```text
Cus
Cust
Custo
```

phải filter local.

Không query database lại cho từng ký tự.

---

# 32. Cancellation

Nếu request async tồn tại:

```javascript
fetch(...)
```

hoặc backend API:

```text
request A
request B
request C
```

thì phải đảm bảo:

```text
A không được ghi đè kết quả của C
```

Có thể dùng:

```javascript
requestId
```

hoặc:

```javascript
AbortController
```

Ví dụ:

```text
request 101 → token "C"
request 102 → token "Cu"
request 103 → token "Cus"

Chỉ request 103 được phép update popup.
```

---

# 33. Cursor Movement

Kiểm tra:

```text
ArrowLeft
ArrowRight
mouse click
Home
End
Ctrl+Left
Ctrl+Right
```

Nếu cursor rời khỏi completion token:

```text
close completion
```

Không được:

```text
cursor move
→ auto trigger
```

---

# 34. Selection Change

Kiểm tra:

```text
Shift + Arrow
Ctrl + A
mouse selection
```

Khi user đang chọn text:

```text
không auto trigger completion
```

trừ khi explicit trigger.

---

# 35. Paste

Test:

```text
Ctrl + V
```

với:

```sql
SELECT *
FROM Customer
WHERE CustomerId = 10
```

Sau paste:

```text
không được mở hàng loạt popup
```

Có thể:

```text
update parser/context
```

nhưng không tự động trigger nếu không có lý do rõ ràng.

---

# 36. Cut

Test:

```text
Ctrl + X
```

Phải:

```text
update context
```

và:

```text
close/recalculate completion
```

không trigger suggestion mới một cách vô điều kiện.

---

# 37. Undo / Redo

Test:

```text
Ctrl + Z
Ctrl + Y
```

Đây là nhóm dễ bị bỏ sót.

Sau Undo:

```text
recalculate context
```

nhưng:

```text
không automatic trigger
```

trừ khi completion vẫn đang active và chỉ cần refresh theo thiết kế.

---

# 38. IME / Composition

Không được bỏ qua:

```text
compositionstart
compositionupdate
compositionend
```

Nếu IDE hỗ trợ input Unicode hoặc IME:

```text
không trigger completion giữa composition
```

Chỉ xử lý sau:

```text
compositionend
```

---

# 39. Multi-Cursor

Nếu CodeMirror configuration có hỗ trợ multi-selection/multi-cursor:

phải kiểm tra:

```text
Ctrl + click
multiple selections
```

Không được giả định chỉ có:

```javascript
single cursor
```

Completion phải có behavior rõ ràng.

Nếu chưa hỗ trợ:

```text
explicitly disable auto completion
```

thay vì xử lý sai.

---

# 40. Test Matrix

Agent phải tạo test case tối thiểu:

### Basic typing

```text
SELECT
SEL
SELE
SELECT
```

### Table

```sql
FROM Cus
```

### Alias

```sql
FROM Customer c
SELECT c.
```

### Column

```sql
SELECT c.Cus
```

### WHERE

```sql
WHERE Cus
```

### JOIN

```sql
JOIN Customer c ON c.
```

### Function

```sql
COUNT(
CONCAT(
COALESCE(
```

### String

```sql
WHERE Name = 'Cus
```

### Comment

```sql
-- Cus
```

### Block comment

```sql
/*
Cus
*/
```

### Subquery

```sql
SELECT *
FROM (
    SELECT Cus
)
```

### CTE

```sql
WITH CustomerCTE AS (
    SELECT Cus
)
SELECT *
FROM CustomerCTE
```

---

# 41. Keyboard Regression Matrix

Phải test tối thiểu:

```text
Ctrl + Space
Escape
Enter
Tab
Space
Backspace
Delete
ArrowUp
ArrowDown
ArrowLeft
ArrowRight
Home
End
Ctrl + Left
Ctrl + Right
Ctrl + A
Ctrl + C
Ctrl + V
Ctrl + X
Ctrl + Z
Ctrl + Y
```

và:

```text
.
,
(
)
'
"
[
]
;
```

---

# 42. Expected Behavior

Nguyên tắc tổng quát:

```text
USER ACTION
     ↓
Is this an explicit completion request?
     │
     ├── YES → trigger
     │
     └── NO
          ↓
Is this a valid automatic trigger character?
          │
          ├── YES
          │    ↓
          │  Analyze SQL context
          │    ↓
          │  Context supports completion?
          │    ├── YES → trigger
          │    └── NO → do nothing
          │
          └── NO
               ↓
        Is completion already active?
               │
               ├── YES → refresh/close according to context
               └── NO → do nothing
```

---

# 43. Không được để UI quyết định Trigger

Không viết:

```javascript
popup.show();
```

trực tiếp trong:

```javascript
keydown
input
keyup
cursorActivity
```

Thay vào đó:

```text
Editor Event
    ↓
Trigger Controller
    ↓
Completion Decision
    ↓
Completion Engine
    ↓
Popup UI
```

UI chỉ chịu trách nhiệm:

```text
render
position
highlight
navigation
show/hide
```

Không chịu trách nhiệm quyết định:

```text
khi nào cần IntelliSense
```

---

# 44. Completion Decision Object

Nên chuẩn hóa kết quả decision:

```javascript
{
    action: "trigger",
    reason: "dot",
    kind: "column",
    token: "c",
    replaceRange: {
        from: 120,
        to: 121
    }
}
```

Các action:

```text
none
trigger
refresh
close
accept
```

Ví dụ:

```javascript
{
    action: "none"
}
```

hoặc:

```javascript
{
    action: "refresh",
    kind: "column",
    token: "Cus"
}
```

Điều này giúp toàn bộ IntelliSense dễ debug hơn.

---

# 45. Thứ tự triển khai

Không sửa tất cả cùng lúc.

## Phase 1 — Audit

Chỉ đọc code.

Output:

```text
IntelliSense event map
Trigger map
Provider map
Popup lifecycle
Metadata request flow
```

Không sửa behavior.

---

## Phase 2 — Keyboard Event Layer

Tách:

```text
keyboard classification
```

ra khỏi:

```text
completion provider
```

Chưa thay đổi UI.

---

## Phase 3 — Trigger Controller

Implement:

```text
explicit trigger
automatic trigger
refresh
close
accept
none
```

---

## Phase 4 — Context Detection

Kiểm tra:

```text
keyword
table
column
alias
function
string
comment
subquery
CTE
```

---

## Phase 5 — Completion State

Implement:

```text
IDLE
VISIBLE
REFRESHING
NAVIGATING
```

và lifecycle rõ ràng.

---

## Phase 6 — Async / Cache

Kiểm tra:

```text
duplicate requests
race conditions
request cancellation
metadata caching
local filtering
```

---

## Phase 7 — Regression Test

Chạy toàn bộ keyboard matrix.

Không thay đổi UI.

---

# 46. Tiêu chí thành công

Sau khi hoàn thành:

### Không được xảy ra

```text
gõ chữ → popup liên tục
Space → popup không cần thiết
Enter → popup mới
Arrow → popup mới
Escape → popup lập tức xuất hiện lại
Backspace → popup mới
gõ trong string → object suggestions
gõ trong comment → suggestions
paste → nhiều popup
mỗi key → database request
```

### Phải xảy ra

```text
Ctrl + Space → explicit completion
. → context-aware completion
typing khi popup active → refresh
ArrowUp/Down → navigation
Enter → accept
Escape → close
Backspace/Delete → refresh hoặc close
cursor rời token → close
string/comment → disable automatic completion
```

---

# 47. Performance Acceptance Criteria

Không đánh giá IntelliSense chỉ bằng:

```text
popup có xuất hiện hay không
```

Phải kiểm tra:

```text
Trigger frequency
Provider execution count
Metadata request count
Popup render count
Context parse count
```

Ví dụ:

```text
User nhập 10 ký tự

Không nên:

10 database requests
10 popup destroy/create
10 metadata loads
```

Mục tiêu nên gần:

```text
1 metadata load
+
10 local filtering/update
```

hoặc ít hơn tùy cache.

---

# 48. Debug Metrics

Trong development mode nên có:

```text
Completion Trigger Count
Completion Refresh Count
Completion Close Count
Provider Call Count
Metadata Request Count
Cache Hit Count
Cache Miss Count
Average Provider Time
Average Popup Render Time
```

Ví dụ:

```text
Typing: 12 keys

Triggers: 1
Refreshes: 11
DB Requests: 0
Cache Hits: 11
Popup Renders: 11
```

Đây sẽ là cách xác định IntelliSense có thực sự hoạt động giống IDE chuyên nghiệp hay không.

---

# 49. Các lỗi agent không được tự ý sửa

Trong quá trình implementation, agent KHÔNG được:

- thay CodeMirror bằng Monaco;
- thay UI IntelliSense;
- thay popup component;
- thay màu sắc;
- thay UX;
- thêm framework autocomplete mới;
- viết lại toàn bộ IntelliSense;
- thêm database query cho mỗi key;
- dùng debounce như giải pháp duy nhất;
- sửa SQL parser nếu chưa chứng minh parser gây lỗi;
- refactor các module không liên quan.

Mục tiêu của phase này chỉ là:

```text
CONTROL WHEN INTELLISENSE IS TRIGGERED
```

---

# 50. Deliverables bắt buộc

Sau khi hoàn thành audit, agent phải trả về:

## 1. Event Map

```text
File
Function
Event
Current behavior
Problem
Recommended behavior
```

## 2. Trigger Matrix

```text
Key/Event
Trigger?
Refresh?
Close?
Accept?
Context required?
```

## 3. State Diagram

```text
IDLE
VISIBLE
REFRESHING
NAVIGATING
ACCEPTING
```

## 4. Context Matrix

```text
SQL Context
Completion Type
Trigger Rule
```

## 5. Request Flow

```text
Keyboard
→ Context
→ Trigger
→ Provider
→ Cache
→ Popup
```

## 6. Regression Test

Danh sách toàn bộ keyboard test case.

## 7. Performance Report

So sánh trước/sau:

```text
trigger count
provider count
DB/API request count
render count
latency
```

---

# 51. Quy tắc quan trọng nhất

Agent phải luôn tuân thủ:

> IntelliSense không được hỏi "người dùng vừa nhấn phím gì?" rồi lập tức mở popup.

Nó phải hỏi:

> "Người dùng vừa thực hiện hành động gì, cursor đang ở SQL context nào, completion hiện tại có đang active không, và hành động này có thực sự yêu cầu trigger/refresh/close hay không?"

Đây là khác biệt giữa:

```text
Autocomplete đơn giản
```

và:

```text
SQL IDE IntelliSense
```

---

# 52. Kiến trúc mục tiêu

```text
                 CodeMirror
                     │
                     ▼
              Editor Event Layer
                     │
                     ▼
             Keyboard Classifier
                     │
                     ▼
            SQL Context Analyzer
                     │
                     ▼
          IntelliSense Trigger Controller
                     │
          ┌──────────┼───────────┐
          ▼          ▼           ▼
       Trigger     Refresh      Close
          │          │
          └────┬─────┘
               ▼
       Completion Provider
               │
               ▼
          Metadata Cache
               │
               ▼
       Local Filtering/Ranking
               │
               ▼
       IntelliSense Popup
```

Không được để:

```text
CodeMirror
   ↓
showSuggestions()
```

là kiến trúc cuối cùng.

---

# 53. Thứ tự ưu tiên khi debug

Nếu IntelliSense đang "gợi ý liên tục", agent phải kiểm tra theo thứ tự:

```text
1. Có bao nhiêu event đang gọi completion?
2. Một key có tạo nhiều trigger không?
3. Trigger và refresh có bị nhầm không?
4. Popup active state có chính xác không?
5. Context parser có nhận diện đúng không?
6. Có trigger trong string/comment không?
7. Cursor movement có trigger không?
8. Async request cũ có ghi đè request mới không?
9. Metadata có bị query lại không?
10. Cuối cùng mới xem xét debounce/throttle.
```

Không được bắt đầu bằng bước 10.

---

# 54. Definition of Done

Task chỉ được coi là hoàn thành khi:

- [ ] Đã audit toàn bộ keyboard/event handler.
- [ ] Đã xác định tất cả nơi có thể trigger IntelliSense.
- [ ] Đã tách trigger khỏi refresh.
- [ ] Đã có explicit trigger.
- [ ] Đã có automatic trigger.
- [ ] Đã có close/accept behavior.
- [ ] Đã xử lý Escape.
- [ ] Đã xử lý Enter.
- [ ] Đã xử lý Backspace/Delete.
- [ ] Đã xử lý Arrow keys.
- [ ] Đã xử lý Space.
- [ ] Đã xử lý `.`, `,`, `(`, `)`.
- [ ] Đã xử lý string.
- [ ] Đã xử lý comment.
- [ ] Đã kiểm tra paste/cut.
- [ ] Đã kiểm tra undo/redo.
- [ ] Đã kiểm tra cursor movement.
- [ ] Đã kiểm tra duplicate trigger.
- [ ] Đã kiểm tra async race condition.
- [ ] Đã kiểm tra metadata caching.
- [ ] Đã có regression test matrix.
- [ ] UI hiện tại không bị thay đổi.
- [ ] CodeMirror hiện tại không bị thay thế.
- [ ] Không có database/API request không cần thiết cho từng phím.

## Final principle

```text
KEY EVENT ≠ INTELLISENSE TRIGGER

KEY EVENT
    ↓
CLASSIFY
    ↓
UNDERSTAND SQL CONTEXT
    ↓
CHECK COMPLETION STATE
    ↓
DECIDE:
    NONE / TRIGGER / REFRESH / CLOSE / ACCEPT
    ↓
EXECUTE
```

Đây phải là nguyên tắc trung tâm của toàn bộ IntelliSense implementation.