# BỔ SUNG: POSTGRESQL DEBUG MODE VÀ CUSTOM DEBUG FUNCTIONS

## 1. Mục tiêu

Đối với các connection sử dụng PostgreSQL, IDE phải có thêm chế độ:

```text
Run
Run Debug
```

### Run

Thực thi SQL/function theo PostgreSQL bình thường.

Các IDE custom debug function như:

```text
bs.trace()
bs.print()
bs.assert()
bs.watch()
```

**không được thực thi**.

### Run Debug

Dùng cho quá trình develop/debug PL/pgSQL.

IDE sẽ:

1. Phân tích source.
2. Nhận diện các IDE Debug Extension.
3. Instrument source.
4. Thực thi function trong PostgreSQL.
5. Thu thập runtime trace.
6. Hiển thị kết quả đúng thứ tự thực thi.
7. Cho phép click trace để quay lại đúng vị trí `bs.trace()` trong source.

---

# 2. UI

Đối với PostgreSQL connection, action bar phải có:

```text
[ Connection ] [ Database ] [ Schema ] [ Run ] [ Run Debug ]
```

Ví dụ:

```text
PostgreSQL
────────────────────────────────────────────
Connection: PostgreSQL Dev
Database: Bravo
Schema: public

[▶ Run] [🐞 Run Debug]
```

Không yêu cầu thay đổi UI lớn.

Chỉ bổ sung action:

```text
Run Debug
```

vào khu vực action hiện tại.

---

# 3. Điều kiện hiển thị Run Debug

`Run Debug` chỉ hiển thị/kích hoạt khi:

```text
Current Connection
        ↓
Database Type
        ↓
PostgreSQL
```

Ví dụ:

```text
PostgreSQL
    → Run
    → Run Debug

SQL Server
    → Run
```

SQL Server không được tự động có `Run Debug` nếu chưa triển khai debugger tương ứng.

---

# 4. Run và Run Debug là hai execution mode khác nhau

Không sử dụng một boolean đơn giản trong từng extension.

Phải tạo execution context:

```javascript
{
    mode: "normal"
}
```

hoặc:

```javascript
{
    mode: "debug"
}
```

### Normal

```javascript
{
    mode: "normal",
    debugExtensions: false
}
```

### Debug

```javascript
{
    mode: "debug",
    debugExtensions: true
}
```

---

# 5. Quy tắc tuyệt đối

## Run

Khi user bấm:

```text
Run
```

IDE phải gửi SQL PostgreSQL bình thường.

Ví dụ source:

```sql
CREATE OR REPLACE FUNCTION test()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN

    bs.trace(
        SELECT *
        FROM customer
    );

END;
$$;
```

Trong `Run` mode:

```text
bs.trace()
```

không được thực thi như IDE Debug Extension.

Không được tự động tạo Trace Result.

---

# 6. Xử lý custom function trong Run

Có hai lựa chọn implementation.

### Ưu tiên

IDE phải phát hiện source có IDE extension nhưng đang ở Normal Mode và báo rõ:

```text
IDE Debug Extension detected.

This function contains:
    bs.trace()

Run Debug is required to execute IDE debug extensions.
```

Sau đó cho user lựa chọn:

```text
[Cancel]
[Run Debug]
```

### Không được

Âm thầm chuyển:

```text
Run
```

thành:

```text
Run Debug
```

vì user phải chủ động lựa chọn chế độ debug.

---

# 7. Run Debug

Khi user bấm:

```text
Run Debug
```

IDE tạo:

```javascript
{
    mode: "debug",

    debugSessionId: "...",

    connectionId: "...",

    database: "...",

    schema: "..."
}
```

Sau đó:

```text
Editor
   ↓
Parser
   ↓
Extension Detector
   ↓
Debug Instrumentation
   ↓
PostgreSQL
   ↓
Trace Collector
   ↓
Result Manager
```

---

# 8. Debug Session

Mỗi lần bấm `Run Debug` tạo một session mới.

Ví dụ:

```text
DEBUG SESSION
────────────────────────

Session ID:
DBG_20261001_00001
```

Session chứa:

```javascript
{
    debugSessionId,
    connectionId,
    database,
    schema,
    startedAt,
    mode: "debug"
}
```

Mọi trace event phải thuộc một `debugSessionId`.

---

# 9. Debug Session không phải PostgreSQL Session

Phải phân biệt:

```text
IDE Debug Session
```

và:

```text
PostgreSQL Connection/Session
```

Quan hệ:

```text
IDE Debug Session
        │
        ▼
PostgreSQL Connection
        │
        ▼
PostgreSQL Backend Session
```

Một Debug Session có thể sử dụng một PostgreSQL connection/session cụ thể.

Không được nhầm hai khái niệm này.

---

# 10. PostgreSQL Connection Preservation

Run Debug phải ưu tiên giữ nguyên PostgreSQL execution context.

Đặc biệt:

```text
connection
transaction
temporary table
search_path
SET variables
role
database
session state
```

Ví dụ:

```sql
CREATE TEMP TABLE tmp_test AS
SELECT ...;

CREATE FUNCTION test()
...
```

Khi `Run Debug`, `bs.trace()` phải có khả năng truy cập đúng session context nếu function phụ thuộc vào nó.

---

# 11. Custom Debug Extension chỉ hoạt động trong Debug Mode

Registry extension phải kiểm tra execution mode.

Ví dụ:

```javascript
if (
    extension.debugOnly &&
    executionContext.mode !== "debug"
) {
    // Không execute
}
```

Metadata:

```javascript
{
    name: "bs.trace",

    debugOnly: true,

    capabilities: {
        instrumentation: true,
        resultGrid: true
    }
}
```

Sau này:

```javascript
{
    name: "bs.print",
    debugOnly: true
}
```

```javascript
{
    name: "bs.assert",
    debugOnly: true
}
```

---

# 12. Không đưa Debug Extension vào PostgreSQL Runtime

`bs.trace()` không được tồn tại trong function PostgreSQL thực tế.

Source developer có:

```sql
bs.trace(...)
```

nhưng execution version được IDE instrument.

Ví dụ:

```text
Developer Source
        │
        │ Run Debug
        ▼
Debug Instrumenter
        │
        ▼
Instrumented Execution
        │
        ▼
PostgreSQL
```

PostgreSQL không cần biết `bs.trace` là gì.

---

# 13. Instrumentation chỉ xảy ra khi Run Debug

### Run

```text
Source
  ↓
PostgreSQL Execute
```

### Run Debug

```text
Source
  ↓
Parse
  ↓
Detect bs.*
  ↓
Instrument
  ↓
PostgreSQL Execute
  ↓
Collect Debug Events
```

Đây là sự khác biệt cốt lõi giữa hai action.

---

# 14. Debug Extension Registry

Mỗi extension phải khai báo:

```javascript
{
    name: "bs.trace",

    namespace: "bs",

    command: "trace",

    dialects: ["postgresql"],

    debugOnly: true,

    capabilities: {
        completion: true,
        parameterHint: true,
        validation: true,
        instrumentation: true,
        resultGrid: true
    }
}
```

Không được hard-code:

```javascript
if (text.includes("bs.trace")) {
    ...
}
```

ở nhiều nơi.

---

# 15. Debug Extension Context

Parser phải tạo:

```javascript
{
    type: "ide-extension",

    name: "bs.trace",

    mode: "debug",

    sourceTraceId: "trace_001",

    sourceOrder: 1,

    sourceRange: {
        start: 120,
        end: 220
    }
}
```

Execution engine chỉ xử lý extension khi:

```text
mode = debug
```

---

# 16. Normal Mode Validation

Nếu user bấm Run và source chứa:

```sql
bs.trace(...)
```

IDE có thể hiển thị warning:

```text
Debug extension detected.

bs.trace() is only available in Run Debug mode.
```

Có thể cung cấp action:

```text
[Run Debug]
```

nhưng không tự động chuyển mode.

---

# 17. Debug Mode Validation

Khi Run Debug:

```text
bs.trace()
```

được parse và validate.

Nếu hợp lệ:

```text
Continue
```

Nếu lỗi:

```text
Stop before PostgreSQL execution
```

Ví dụ:

```sql
bs.trace();
```

→

```text
BS_TRACE_INVALID_ARGUMENT
Trace expression is required.
```

Không chạy function nếu source debug extension không hợp lệ.

---

# 18. Runtime Trace Order

Mỗi `bs.trace` phải có:

```text
sourceTraceId
sourceOrder
runtimeOrder
```

Ví dụ:

```text
Source:

Trace A → sourceOrder 1
Trace B → sourceOrder 2
Trace C → sourceOrder 3
```

Runtime:

```text
Trace B → runtimeOrder 1
Trace B → runtimeOrder 2
Trace C → runtimeOrder 3
```

UI:

```text
Trace #1 → B
Trace #2 → B
Trace #3 → C
```

Không được sắp xếp Result Grid theo `sourceOrder`.

Result phải được sắp xếp theo:

```text
runtimeOrder
```

---

# 19. Source Navigation

Mỗi Result phải lưu:

```javascript
{
    debugSessionId,
    runtimeOrder,
    sourceTraceId,

    sourceLocation: {
        documentId,
        functionName,
        schema,
        startLine,
        startColumn,
        endLine,
        endColumn
    }
}
```

Khi user click:

```text
Trace #3
```

IDE:

```text
Trace #3
   ↓
sourceTraceId
   ↓
sourceLocation
   ↓
Editor
   ↓
bs.trace(...)
```

---

# 20. Result Grouping

Result Manager phải phân biệt:

```text
Function Result
Debug Trace Result
```

Ví dụ:

```text
Result
├── Function Result
│
├── Trace #1
│
├── Trace #2
│
└── Trace #3
```

Không được ghi đè:

```text
Trace #1
```

bằng:

```text
Trace #2
```

---

# 21. Multiple Trace

Function:

```sql
BEGIN

    bs.trace(
        SELECT *
        FROM customer
    );

    ...

    bs.trace(
        SELECT *
        FROM invoice
    );

    ...

    bs.trace(
        SELECT *
        FROM invoice_detail
    );

END;
```

Run Debug:

```text
Trace #1
customer

Trace #2
invoice

Trace #3
invoice_detail
```

Nếu runtime branch thay đổi:

```text
Trace #1
invoice

Trace #2
invoice_detail
```

thì UI phải phản ánh **runtime thực tế**, không phải source order.

---

# 22. Loop

Ví dụ:

```sql
FOR item IN
    SELECT *
    FROM invoice
LOOP

    bs.trace(
        SELECT *
        FROM invoice_detail
        WHERE invoice_id = item.id
    );

END LOOP;
```

Nếu loop chạy 3 lần:

```text
Trace #1
sourceTraceId = trace_001
runtimeOrder = 1

Trace #2
sourceTraceId = trace_001
runtimeOrder = 2

Trace #3
sourceTraceId = trace_001
runtimeOrder = 3
```

UI phải cho user biết đây là:

```text
bs.trace #1
Iteration 1

bs.trace #1
Iteration 2

bs.trace #1
Iteration 3
```

không coi chúng là ba `bs.trace` khác nhau trong source.

---

# 23. Nested Function

Nếu:

```text
Function A
    ↓
Function B
        ↓
Function C
```

và cả ba có:

```text
bs.trace()
```

Runtime phải lưu:

```javascript
{
    functionName,
    schema,
    callDepth,
    sourceTraceId,
    runtimeOrder
}
```

Ví dụ:

```text
Trace #1
A.bs.trace

Trace #2
B.bs.trace

Trace #3
C.bs.trace
```

---

# 24. Debug Output

Ngoài Result Grid, framework phải chuẩn bị khả năng hỗ trợ:

```text
Debug Output
```

Ví dụ tương lai:

```sql
bs.print(v_total);
```

sẽ hiển thị:

```text
DEBUG OUTPUT

v_total = 1250000
```

Nhưng `bs.print` chưa cần triển khai trong phase đầu.

Framework chỉ cần đảm bảo kiến trúc có thể mở rộng.

---

# 25. Debug-only Functions

Các extension sau này mặc định:

```text
debugOnly = true
```

Ví dụ:

```text
bs.trace
bs.print
bs.assert
bs.watch
```

Chỉ khi:

```text
Run Debug
```

mới được instrument/execute.

---

# 26. Không lưu Debug Extension vào Function Production

IDE không được:

```text
Run Debug
    ↓
CREATE OR REPLACE FUNCTION
    ↓
lưu bs.trace vào database production
```

Debug instrumentation phải là execution-time behavior.

Developer source có thể chứa:

```text
bs.trace
```

nhưng function production chỉ được deploy sau khi developer loại bỏ debug extension hoặc sử dụng một deployment validation step.

---

# 27. Deploy Protection

Trước khi deploy function có chứa:

```text
bs.*
```

IDE nên kiểm tra:

```text
Debug extensions detected.
```

Ví dụ:

```text
Function contains debug-only extensions:

- bs.trace() × 3

These extensions are not valid PostgreSQL syntax.

[Cancel Deploy]
[Show Locations]
```

Không tự động deploy source có `bs.*` xuống PostgreSQL production.

---

# 28. Debug Mode Indicator

Khi đang ở Debug Mode, IDE phải có trạng thái rõ ràng:

```text
🐞 Debug
```

hoặc:

```text
RUNNING DEBUG
```

để user biết:

> Các IDE debug extension đang được instrument.

Không được để user nhầm rằng họ đang chạy SQL PostgreSQL nguyên bản.

---

# 29. Debug Session Lifecycle

```text
User clicks Run Debug
        ↓
Create Debug Session
        ↓
Parse Source
        ↓
Detect Extensions
        ↓
Validate
        ↓
Build Instrumentation
        ↓
Execute PostgreSQL
        ↓
Collect Runtime Events
        ↓
Render Result
        ↓
Debug Session Complete
```

Nếu Cancel:

```text
Cancel
 ↓
Stop Execution
 ↓
Stop Trace Collector
 ↓
Cleanup Debug Session
```

Nếu Error:

```text
Error
 ↓
Map sourceTraceId
 ↓
Render error
 ↓
Allow source navigation
```

---

# 30. Không ảnh hưởng Run bình thường

Đây là yêu cầu regression quan trọng nhất.

Code PostgreSQL không có extension:

```sql
SELECT *
FROM customer;
```

phải chạy giống hệt trước đây.

Function PostgreSQL bình thường:

```sql
CREATE FUNCTION ...
```

không có `bs.*`:

```text
Run
Run Debug
```

có thể dùng chung execution infrastructure nhưng:

```text
Run
    debugExtensions = false

Run Debug
    debugExtensions = true
```

---

# 31. Run Debug không phải Full Debugger

Phase đầu chỉ hỗ trợ:

```text
Run Debug
+
Custom Debug Extensions
+
Trace Result
```

Không triển khai ngay:

```text
Breakpoint
Step Into
Step Over
Step Out
Watch Window
Call Stack
Variable Inspector
```

Những tính năng đó có thể được xây dựng trên cùng framework trong tương lai.

---

# 32. Phase triển khai

## Phase 1 — Execution Mode

Tạo:

```text
normal
debug
```

và action:

```text
Run
Run Debug
```

chỉ cho PostgreSQL.

---

## Phase 2 — Extension Framework

Tạo:

```text
Extension Registry
Extension Detector
Extension Parser
Extension AST
Extension Validator
```

---

## Phase 3 — Trace Model

Tạo:

```text
Debug Session
Source Trace ID
Runtime Trace Event
Runtime Order
Source Location
```

---

## Phase 4 — Instrumentation

Implement:

```text
bs.trace()
```

và transform execution.

---

## Phase 5 — PostgreSQL Context

Đảm bảo:

```text
same connection
same transaction
same temporary tables
same search_path
same session state
```

---

## Phase 6 — Result Integration

Tích hợp:

```text
Trace Collector
Result Manager
GridResultManager
Source Navigation
```

---

## Phase 7 — Edge Cases

Test:

```text
IF
ELSE
LOOP
FOR
nested function
recursive function
temporary table
transaction
exception
dollar quote
comments
strings
```

---

## Phase 8 — Future Extensions

Sau khi `bs.trace` ổn định:

```text
bs.print
bs.assert
bs.watch
```

---

# 33. Definition of Done

Feature chỉ được coi là hoàn thành khi:

* PostgreSQL connection có `Run`.
* PostgreSQL connection có `Run Debug`.
* SQL Server không bị ảnh hưởng.
* `Run` không execute debug extensions.
* `Run Debug` nhận diện debug extensions.
* `bs.trace()` chỉ được instrument trong Debug Mode.
* Có Debug Session riêng cho mỗi lần Run Debug.
* Có Source Trace ID.
* Có Runtime Order.
* Có Source Order.
* Có source location.
* Trace được hiển thị đúng thứ tự runtime.
* Hai `bs.trace()` khác nhau được phân biệt.
* Một `bs.trace()` trong loop có thể sinh nhiều runtime event.
* IF/ELSE phản ánh đúng runtime.
* Nested function có call context.
* Trace có thể click để quay lại đúng source.
* Function result và Trace result độc lập.
* Trace sử dụng đúng PostgreSQL session context.
* Temporary table hoạt động.
* Transaction không bị phá vỡ.
* Debug session được cleanup.
* Cancel/timeout được xử lý.
* Source editor không bị thay đổi bởi instrumentation.
* Debug extension không bị ghi vào production database.
* Deploy có validation đối với debug-only extension.
* Có regression test cho Run bình thường.
* Có regression test cho Run Debug.

---

# 34. Nguyên tắc kiến trúc cuối cùng

Thiết kế phải tuân thủ:

```text
PostgreSQL
    │
    ├── Normal Execution
    │       └── Run
    │
    └── Debug Execution
            └── Run Debug
                    │
                    ├── IDE Extension Parser
                    │
                    ├── Instrumentation
                    │
                    ├── Trace Collector
                    │
                    └── Result Manager
```

Và:

```text
Run
    ≠
Run Debug
```

`Run` là PostgreSQL execution bình thường.

`Run Debug` là PostgreSQL execution được IDE instrument để phục vụ develop/debug.

Các hàm:

```text
bs.trace()
bs.print()
bs.assert()
bs.watch()
```

là:

```text
IDE Debug Extensions
```

và mặc định:

```text
debugOnly = true
```

Không được để chúng trở thành một phần của PostgreSQL runtime hoặc production function.

---

# 35. Quy tắc quan trọng nhất

Luôn phân biệt:

```text
SOURCE
```

```text
INSTRUMENTED EXECUTION
```

```text
RUNTIME TRACE
```

Ví dụ:

```text
SOURCE

Trace A
Trace B
Trace C
```

có thể tạo:

```text
RUNTIME

Trace B
Trace B
Trace C
```

và IDE phải biểu diễn:

```text
Trace #1
    → sourceTraceId = B
    → runtimeOrder = 1

Trace #2
    → sourceTraceId = B
    → runtimeOrder = 2

Trace #3
    → sourceTraceId = C
    → runtimeOrder = 3
```

Đồng thời:

```text
Trace #2
    ↓
sourceTraceId
    ↓
sourceLocation
    ↓
Editor
    ↓
bs.trace() chính xác trong function
```

Đây là nguyên tắc nền tảng để hệ thống sau này có thể phát triển từ `Run Debug + bs.trace()` thành một bộ công cụ debug PL/pgSQL hoàn chỉnh.
