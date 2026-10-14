# KẾ HOẠCH TRIỂN KHAI SYNTAX CHECK TRÊN MONACO

## 1. Phạm vi

Hiện tại IDE có:

* Monaco Editor
* CodeMirror 6

Trong đó:

* **CodeMirror 6 đang được sử dụng cho IntelliSense hiện tại.**
* **Monaco được sử dụng làm nền tảng editor và sẽ là nơi triển khai Syntax Check.**

### Quyết định kiến trúc

Syntax Check **chỉ triển khai trên Monaco Editor**.

Không triển khai Syntax Check cho CodeMirror 6.

Không refactor IntelliSense CodeMirror 6 trong task này.

Không chuyển IntelliSense từ CodeMirror sang Monaco trong task này.

---

# 2. Mục tiêu

Xây dựng Syntax Check cho:

* SQL Server
* PostgreSQL

Syntax Check phải:

* Hiển thị lỗi trực tiếp trên Monaco.
* Gạch chân vị trí lỗi.
* Hiển thị message khi hover.
* Có thể click lỗi để tới vị trí.
* Hỗ trợ nhiều statement.
* Hỗ trợ SQL nhiều dòng.
* Không làm editor lag.
* Không kiểm tra database sau mỗi phím.
* Không ảnh hưởng IntelliSense hiện tại.
* Không thay đổi UI editor hiện tại nếu không cần thiết.

---

# 3. Kiến trúc

```text
                    Monaco Editor
                         │
                         │ SQL Document
                         ▼
                Syntax Check Service
                         │
                 Dialect Resolver
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
       SQL Server Validator   PostgreSQL Validator
              │                     │
              └──────────┬──────────┘
                         ▼
                  Diagnostic Model
                         │
                         ▼
                 Monaco Markers
                         │
                         ▼
                 Problems / Message
```

CodeMirror 6 nằm ngoài phạm vi:

```text
CodeMirror 6
     │
     └── IntelliSense hiện tại
```

Không được sửa CodeMirror trong quá trình triển khai Syntax Check.

---

# 4. Vì sao chọn Monaco

Monaco đã có sẵn cơ chế:

```text
Model
Markers
Diagnostics
Hover
Decorations
Position
Range
```

Do đó Syntax Check chỉ cần chuyển kết quả validation thành Monaco diagnostics.

Ví dụ:

```javascript
monaco.editor.setModelMarkers(
    model,
    "syntax-check",
    markers
);
```

Không cần tự xây hệ thống underline lỗi.

---

# 5. Diagnostic Model

Tạo format trung gian thống nhất:

```javascript
{
    severity: "error",

    message: "Incorrect syntax near 'FROM'.",

    code: "SQL_SYNTAX_ERROR",

    source: "sqlserver",

    startLine: 10,
    startColumn: 15,

    endLine: 10,
    endColumn: 19
}
```

Syntax Check Service trả về model này.

Sau đó mới convert sang Monaco Marker.

---

# 6. Monaco Marker

Mapping:

```text
Diagnostic
     ↓
Monaco Marker
```

Ví dụ:

```javascript
{
    severity: monaco.MarkerSeverity.Error,
    message: diagnostic.message,
    startLineNumber: diagnostic.startLine,
    startColumn: diagnostic.startColumn,
    endLineNumber: diagnostic.endLine,
    endColumn: diagnostic.endColumn,
    source: diagnostic.source,
    code: diagnostic.code
}
```

Sau đó:

```javascript
monaco.editor.setModelMarkers(
    model,
    "syntax-check",
    markers
);
```

Marker owner phải cố định:

```text
syntax-check
```

để có thể clear riêng diagnostics của Syntax Check.

---

# 7. Syntax Check Service

Tạo service độc lập:

```text
syntax-check/
    syntax-check-service.js
    diagnostic-model.js
    position-mapper.js
    sqlserver-validator.js
    postgresql-validator.js
```

API:

```javascript
syntaxCheckService.check({
    sql,
    dialect,
    connection,
    model
});
```

Kết quả:

```javascript
{
    diagnostics: []
}
```

Service không được trực tiếp thao tác DOM.

---

# 8. Xác định SQL Server / PostgreSQL

Không tự đoán database từ câu SQL.

Lấy từ connection hiện tại:

```text
Current Connection
        │
        ▼
Database Type
        │
        ├── SQL Server
        │
        └── PostgreSQL
```

Ví dụ:

```javascript
if (connection.type === "sqlserver") {
    // SQL Server validator
}

if (connection.type === "postgresql") {
    // PostgreSQL validator
}
```

---

# 9. SQL Server Validator

Ưu tiên sử dụng chính SQL Server để validation thay vì tự xây parser T-SQL hoàn chỉnh bằng JavaScript.

Lý do SQL Server có nhiều syntax đặc thù:

* T-SQL
* CTE
* temporary table
* variable
* procedure
* function
* trigger
* `GO`
* linked server
* SQL Server-specific syntax

Flow:

```text
Monaco
   ↓
SQL
   ↓
Syntax Check Service
   ↓
SQL Server Validator
   ↓
SQL Server
   ↓
Error
   ↓
Diagnostic
   ↓
Monaco Marker
```

---

# 10. PostgreSQL Validator

Tương tự PostgreSQL.

Flow:

```text
Monaco
   ↓
Syntax Check Service
   ↓
PostgreSQL Validator
   ↓
PostgreSQL
   ↓
Error
   ↓
Diagnostic
   ↓
Monaco Marker
```

Cần lấy được tối thiểu:

* message
* SQLSTATE nếu có
* position
* line/column nếu có
* severity

---

# 11. Không execute SQL có side effect

Syntax Check không được chạy trực tiếp:

```sql
INSERT
UPDATE
DELETE
EXEC
CALL
```

hoặc các statement có thể gây thay đổi dữ liệu chỉ để kiểm tra syntax.

Cần thiết kế validator theo hướng:

```text
Parse / Validate
```

thay vì:

```text
Execute Business SQL
```

Nếu một cơ chế validation cụ thể có rủi ro execute statement, phải loại bỏ hoặc cô lập cơ chế đó.

---

# 12. Mapping vị trí lỗi

Đây là phần quan trọng.

Database có thể trả:

```text
POSITION 125
```

Monaco cần:

```text
Line 8
Column 17
```

Phải có:

```javascript
offsetToMonacoPosition(sql, offset)
```

Xử lý đúng:

* `\n`
* `\r\n`
* tab
* Unicode
* multiline SQL

Không hard-code line/column.

---

# 13. SQL Server `GO`

Không xử lý:

```javascript
sql.split("GO")
```

vì có thể gây sai vị trí hoặc gặp `GO` trong string/comment.

Cần có batch-aware processing:

```text
SQL Document
     │
     ▼
Batch Parser
     │
 ┌───┼────┐
 ▼   ▼    ▼
B1  B2    B3
```

Mỗi batch giữ:

```javascript
{
    text,
    startOffset,
    endOffset
}
```

Nếu SQL Server trả position tương đối trong batch:

```text
batch offset
      ↓
document offset
      ↓
Monaco line/column
```

---

# 14. PostgreSQL không dùng `split(";")`

Không được:

```javascript
sql.split(";")
```

vì:

```sql
SELECT ';';
```

và:

```sql
DO $$
BEGIN
    RAISE NOTICE ';';
END
$$;
```

có thể chứa `;`.

Nếu PostgreSQL validator có thể kiểm tra toàn bộ document thì ưu tiên gửi toàn bộ document.

Chỉ thực hiện statement splitting khi thực sự cần.

---

# 15. Debounce

Không check database sau từng ký tự.

Sai:

```text
S
SE
SEL
SELE
SELEC
SELECT
```

→ 6 request.

Đúng:

```text
User typing
      ↓
Debounce 500ms
      ↓
No typing
      ↓
Syntax Check
```

Giá trị ban đầu:

```text
500 ms
```

Sau đó benchmark và điều chỉnh.

---

# 16. Request Versioning

Phải tránh stale result.

Ví dụ:

```text
Request A
Request B
Request C
```

Nhưng:

```text
C hoàn thành
A hoàn thành
B hoàn thành
```

Kết quả cuối cùng phải là của C.

Mỗi request có:

```javascript
requestId
```

hoặc:

```javascript
AbortController
```

Có thể kết hợp cả hai.

---

# 17. Chỉ apply kết quả mới nhất

Ví dụ:

```javascript
const requestId = ++latestRequestId;

const result = await syntaxCheck(...);

if (requestId !== latestRequestId) {
    return;
}

applyDiagnostics(result);
```

Không được apply kết quả của request cũ.

---

# 18. Automatic Syntax Check

Khi user dừng gõ:

```text
500ms
```

thì chạy check.

Nhưng không nên check các document:

* chưa có connection
* đang đóng tab
* editor/model đã dispose
* request cũ
* editor đang trong trạng thái loading

---

# 19. Manual Syntax Check

Thêm action:

```text
Check Syntax
```

hoặc sử dụng action hiện tại nếu IDE đã có khu vực phù hợp.

Manual check:

```text
User click Check Syntax
       ↓
Cancel request cũ
       ↓
Check ngay
       ↓
Update Monaco markers
```

Không cần debounce cho manual check.

---

# 20. Không check khi chưa có connection

Nếu không có connection:

```text
Monaco
   ↓
Local validation nếu có
```

Không được gọi database.

Nếu muốn giai đoạn đầu đơn giản hơn, có thể:

```text
No connection
    ↓
Syntax Check disabled
```

Sau khi database validation ổn định mới thêm local validation.

---

# 21. Connection Error

Phải phân biệt:

### SQL Error

```text
Incorrect syntax near 'FROM'.
```

→ Monaco Error Marker.

### Connection Error

```text
Connection timeout.
```

Không được đánh dấu:

```text
SQL syntax error
```

Thay vào đó đưa vào Message/Problems:

```text
Syntax Check unavailable:
Database connection failed.
```

---

# 22. Problems Panel

Nếu IDE đã có khu vực Message/Result, tận dụng khu vực đó.

Ví dụ:

```text
Problems (2)

❌ Line 12, Column 15
Incorrect syntax near 'FROM'.

❌ Line 25, Column 7
Invalid column name 'CustomerCode'.
```

Click:

```text
Problem
   ↓
Monaco
   ↓
revealLineInCenter()
   ↓
setPosition()
```

Không tạo một hệ thống UI hoàn toàn mới nếu UI hiện tại đã có thể mở rộng.

---

# 23. Monaco Hover

Marker có thể hiển thị message khi hover.

Ví dụ:

```text
Incorrect syntax near 'FROM'.
```

Không cần tự xây tooltip riêng nếu Monaco đã đáp ứng được.

---

# 24. Clear Diagnostics

Khi SQL đã sửa đúng:

```text
Old Error
    ↓
Syntax Check
    ↓
No Error
    ↓
Clear old markers
```

Ví dụ:

```javascript
monaco.editor.setModelMarkers(
    model,
    "syntax-check",
    []
);
```

Không để marker cũ tồn tại sau khi document đã thay đổi.

---

# 25. Tab isolation

Mỗi Monaco model phải có diagnostics riêng.

Ví dụ:

```text
Tab A
SQL Error A

Tab B
SQL Error B
```

Không được để Tab A hiển thị diagnostic của Tab B.

Dùng:

```text
Monaco Model
      +
Syntax Check Request
      +
Diagnostic lifecycle
```

---

# 26. Khi đóng tab

Phải:

```text
Cancel pending request
        ↓
Clear diagnostics
        ↓
Dispose references
```

Tránh memory leak.

---

# 27. IntelliSense CodeMirror 6

Không thay đổi trong task này.

Giữ nguyên:

```text
CodeMirror 6
     ↓
IntelliSense
```

Không chuyển:

```text
CodeMirror IntelliSense
```

sang:

```text
Monaco IntelliSense
```

Không refactor logic suggestion.

Không thêm Syntax Check vào CodeMirror.

---

# 28. Monaco và CodeMirror có thể tồn tại song song

Kiến trúc hiện tại có thể tiếp tục:

```text
                IDE
                 │
       ┌─────────┴─────────┐
       │                   │
 CodeMirror 6           Monaco
       │                   │
 IntelliSense        Syntax Check
```

Đây là trạng thái hoàn toàn chấp nhận được.

Không cần ép hai editor sử dụng chung implementation trong task này.

---

# 29. Phase triển khai

## Phase 1 — Kiểm tra Monaco hiện tại

Agent phải xác định:

* Monaco được khởi tạo ở đâu.
* Model được tạo ở đâu.
* Tab quản lý model như thế nào.
* SQL được lấy từ đâu.
* Connection hiện tại được lưu ở đâu.
* F5/Run SQL hiện tại đi qua flow nào.
* Result/Message panel hiện tại nằm ở đâu.

Không sửa code ngay.

---

## Phase 2 — Diagnostic thử nghiệm

Tạo một diagnostic giả:

```text
Line 2
Column 5
Test Syntax Error
```

Hiển thị trên Monaco.

Mục tiêu:

```text
Monaco
   ↓
setModelMarkers()
   ↓
red underline
   ↓
hover message
```

Nếu Phase này chưa ổn thì chưa kết nối database.

---

## Phase 3 — Diagnostic Service

Tạo:

```text
syntax-check-service.js
diagnostic-model.js
position-mapper.js
```

Service chỉ nhận SQL và trả diagnostics.

---

## Phase 4 — SQL Server

Implement:

```text
sqlserver-validator
```

Kiểm tra:

* syntax
* position
* multiple statement
* GO
* multiline
* procedure/function
* CTE

---

## Phase 5 — PostgreSQL

Implement:

```text
postgresql-validator
```

Kiểm tra:

* syntax
* position
* SQLSTATE
* multiline
* CTE
* function
* DO block
* dollar quote

---

## Phase 6 — Debounce + Cancellation

Implement:

```text
500ms debounce
requestId
AbortController nếu phù hợp
```

---

## Phase 7 — Problems Integration

Tích hợp với Message/Problems hiện tại.

Không thay đổi layout nếu không cần.

---

## Phase 8 — F5 / Run SQL

Xem xét tích hợp:

```text
F5
 ↓
Syntax Check
 ↓
Nếu syntax error
     ↓
Không execute
```

Nhưng chỉ áp dụng nếu flow execution hiện tại có thể tích hợp an toàn.

Không được phá flow Run SQL hiện tại.

---

# 30. Test bắt buộc

## Monaco

* [ ] Marker hiển thị.
* [ ] Hover message.
* [ ] Click/jump tới lỗi.
* [ ] Multiple errors.
* [ ] Clear marker.
* [ ] Multiple tabs.
* [ ] Close tab.
* [ ] Reopen tab.

## SQL Server

* [ ] SELECT sai syntax.
* [ ] WHERE sai.
* [ ] CTE.
* [ ] Procedure.
* [ ] Function.
* [ ] Trigger.
* [ ] GO.
* [ ] Multiple batch.
* [ ] Linked server syntax.

## PostgreSQL

* [ ] SELECT sai syntax.
* [ ] CTE.
* [ ] Function.
* [ ] DO block.
* [ ] Dollar quote.
* [ ] String chứa `;`.
* [ ] Multiple statement.

## Performance

Test:

```text
100 lines
500 lines
1,000 lines
5,000 lines
10,000 lines
```

và:

```text
typing nhanh
typing liên tục
switch tab
F5
syntax check
```

---

# 31. Tiêu chí hoàn thành

Syntax Check được coi là hoàn thành khi:

* [ ] Chỉ chạy trên Monaco.
* [ ] CodeMirror 6 không bị sửa.
* [ ] IntelliSense CodeMirror hoạt động như cũ.
* [ ] SQL Server được hỗ trợ.
* [ ] PostgreSQL được hỗ trợ.
* [ ] Marker hiển thị đúng vị trí.
* [ ] Message chính xác.
* [ ] Không stale result.
* [ ] Có debounce.
* [ ] Không gây lag editor.
* [ ] Nhiều tab độc lập.
* [ ] Connection error không bị coi là SQL error.
* [ ] SQL Server `GO` được xử lý.
* [ ] PostgreSQL dollar quote được xử lý.
* [ ] Không execute SQL có side effect chỉ để check syntax.

---

# 32. Quy tắc cho Agent

Agent thực hiện task phải tuân thủ:

1. **Chỉ triển khai Syntax Check cho Monaco.**
2. Không sửa CodeMirror 6.
3. Không sửa IntelliSense hiện tại.
4. Không chuyển IntelliSense sang Monaco.
5. Không thay đổi giao diện editor.
6. Tận dụng Monaco Marker/Diagnostic API.
7. Không tự xây hệ thống underline lỗi nếu Monaco đã hỗ trợ.
8. Không check database sau mỗi keystroke.
9. Không để request cũ ghi đè request mới.
10. Không dùng `split(";")` để xử lý PostgreSQL.
11. Không dùng `split("GO")` để xử lý SQL Server.
12. Không đánh đồng connection error với syntax error.
13. Không execute SQL có side effect chỉ để kiểm tra syntax.
14. Không thay đổi flow Run SQL hiện tại nếu chưa xác định rõ tác động.
15. Mọi thay đổi phải được test trên cả SQL Server và PostgreSQL.

---

# 33. Kiến trúc mục tiêu

```text
                    ┌───────────────────┐
                    │      IDE          │
                    └─────────┬─────────┘
                              │
                 ┌────────────┴────────────┐
                 │                         │
          CodeMirror 6                 Monaco
                 │                         │
           IntelliSense              SQL Editor
                                           │
                                  ┌────────┴────────┐
                                  │                 │
                             Syntax Check      Syntax Highlight
                                  │
                         ┌────────┴────────┐
                         │                 │
                    SQL Server        PostgreSQL
                         │                 │
                         └────────┬────────┘
                                  │
                           Diagnostics
                                  │
                                  ▼
                          Monaco Markers
                                  │
                                  ▼
                         Problems / Message
```

## Kết luận kiến trúc

Trong giai đoạn hiện tại, **Monaco nên là nền tảng duy nhất cho Syntax Check**. CodeMirror 6 giữ nguyên vai trò IntelliSense hiện có.

Không cần xây abstraction để hỗ trợ hai editor. Điều đó chỉ làm tăng code và complexity trong khi chưa mang lại lợi ích thực tế.
