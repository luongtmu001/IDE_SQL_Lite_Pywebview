# SQL Context Engine

## Kiến trúc dùng chung cho IntelliSense và Parameter Parser

---

# 1. Mục tiêu

IDE hiện tại hỗ trợ:

* SQL Server
* PostgreSQL
* CodeMirror 6 đang sử dụng cho IntelliSense
* Monaco đã có trong project nhưng **chưa sử dụng làm IntelliSense**
* Query execution riêng
* Syntax highlighting riêng
* Parameter processing riêng

Hiện tại phát sinh lỗi PostgreSQL:

```text
only '%s', '%b', '%t' are allowed as placeholders, got '%I'
```

Nguyên nhân định hướng:

> Layer xử lý parameter của IDE đang nhận diện `%I` trong PostgreSQL `format()` như một query placeholder.

Ví dụ SQL hợp lệ:

```sql
SELECT format(
    'SELECT * FROM %I WHERE id = %L',
    'customer',
    10
);
```

Trong PostgreSQL:

```text
%I → identifier
%L → literal
%s → string
```

Nhưng IDE có thể đang coi `%I` là parameter.

Nếu sửa riêng Parameter Parser bằng một vài điều kiện đặc biệt sẽ tạo thêm technical debt.

Vì vậy cần xây dựng:

```text
SQL Context Engine
```

làm tầng phân tích SQL dùng chung cho:

```text
IntelliSense
Parameter Parser
Syntax Highlight
Validation
Future Debug Extension
```

---

# 2. Nguyên tắc quan trọng nhất

## Không được viết lại IntelliSense hiện tại

CodeMirror 6 hiện đang đảm nhiệm IntelliSense.

Không thay thế bằng Monaco.

Không thay đổi UI IntelliSense.

Không thay đổi hành vi suggestion đang hoạt động tốt nếu không cần thiết.

Kiến trúc mới phải:

```text
Existing IntelliSense
        │
        ▼
   Context Engine
```

thay vì:

```text
Rewrite IntelliSense
        │
        ▼
New Parser
```

---

# 3. Kiến trúc tổng thể

```text
                         CodeMirror 6
                              │
                              ▼
                     Current Cursor Position
                              │
                              ▼
                       SQL Context Engine
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
         Tokenizer       Context Analyzer   Dialect Analyzer
             │                │                │
             └────────────────┼────────────────┘
                              ▼
                       SQL Context Model
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
       IntelliSense     Parameter Parser    Validator
            │                 │
            ▼                 ▼
       Suggestions        Query Execution
```

Sau này có thể mở rộng:

```text
SQL Context Engine
       │
       ├── IntelliSense
       ├── Parameter Parser
       ├── Syntax Highlight
       ├── Syntax Check
       ├── Debug Extension
       └── SQL Formatter
```

---

# 4. Dialect Resolver

Mọi phân tích SQL phải biết database dialect.

Model:

```javascript
{
    dialect: "postgresql",
    connectionId: "...",
    database: "Odoo19",
    schema: "public"
}
```

hoặc:

```javascript
{
    dialect: "sqlserver",
    connectionId: "...",
    database: "Bravo",
    schema: "dbo"
}
```

Ưu tiên xác định dialect từ:

```text
Active Connection
       ↓
Database Driver
       ↓
Dialect
```

Không được sử dụng một bộ rule parameter chung cho cả hai database.

---

# 5. SQL Context Engine

SQL Context Engine là tầng trung gian.

Nó không chịu trách nhiệm:

* hiển thị suggestion
* chạy query
* binding parameter
* render UI

Nó chỉ trả lời:

> "Tại vị trí hiện tại trong SQL, user đang ở context nào?"

Ví dụ:

```javascript
{
    dialect: "postgresql",

    cursor: {
        line: 12,
        column: 25,
        offset: 352
    },

    context: {
        type: "where_expression",
        function: null,
        string: false,
        comment: false,
        dynamicSql: false
    }
}
```

---

# 6. Tokenizer

Tokenizer phải nhận diện tối thiểu:

```text
Keyword
Identifier
Quoted Identifier
String
Number
Operator
Comment
Parameter
Function
Punctuation
Dollar Quote
Format Placeholder
```

Tokenizer phải giữ:

```text
startOffset
endOffset
line
column
tokenType
rawText
```

Ví dụ:

```sql
SELECT * FROM customer WHERE id = $1
```

có thể tạo:

```text
SELECT       Keyword
*            Operator
FROM         Keyword
customer     Identifier
WHERE        Keyword
id           Identifier
=            Operator
$1           PostgreSQLParameter
```

---

# 7. Không dùng Regex làm parser chính

Không được triển khai:

```javascript
sql.match(/%[a-zA-Z]/g)
```

làm source of truth.

Không được:

```javascript
if (sql.includes("%I")) ...
```

Regex chỉ được phép dùng cho:

* quick scan
* optimization
* preliminary detection

Parser chính phải dựa trên token/context.

---

# 8. String Context

Phải phân biệt:

```sql
SELECT '%I';
```

với:

```sql
SELECT format('%I', 'customer');
```

và:

```sql
SELECT *
FROM customer
WHERE id = $1;
```

`%I` trong string bình thường:

```text
StringContent
```

`%I` trong PostgreSQL `format()`:

```text
FormatPlaceholder
```

`$1` ngoài string:

```text
PostgreSQLParameter
```

---

# 9. Comment Context

Không được detect parameter bên trong:

```sql
-- @CustomerId
```

hoặc:

```sql
/*
    @CustomerId
    $1
    %I
*/
```

---

# 10. PostgreSQL Context

## 10.1 Positional Parameter

```sql
SELECT *
FROM customer
WHERE id = $1
AND status = $2;
```

Context:

```javascript
{
    type: "parameter",
    dialect: "postgresql",
    style: "positional",
    index: 1
}
```

---

# 11. PostgreSQL `format()`

Đây là phần bắt buộc để sửa lỗi hiện tại.

Ví dụ:

```sql
SELECT format(
    'SELECT * FROM %I WHERE id = %L',
    'customer',
    10
);
```

Parser phải nhận biết:

```text
FunctionCall
└── format
    ├── Argument 1
    │   └── FormatString
    │       ├── %I
    │       └── %L
    │
    ├── Argument 2
    │   └── Expression
    │
    └── Argument 3
        └── Expression
```

Kết quả:

```text
%I → FormatPlaceholder(identifier)
%L → FormatPlaceholder(literal)
```

Không được:

```text
%I → QueryParameter
%L → QueryParameter
```

---

# 12. PostgreSQL Dollar Quoting

Phải hỗ trợ:

```sql
$$
BEGIN
    ...
END;
$$;
```

và:

```sql
$function$
BEGIN
    ...
END;
$function$;
```

Ví dụ:

```sql
CREATE OR REPLACE FUNCTION test()
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN

    EXECUTE format(
        'SELECT * FROM %I',
        'customer'
    );

END;
$function$;
```

Parser phải hiểu toàn bộ dollar-quoted block.

Không được coi:

```text
$function$
```

là parameter.

---

# 13. SQL Server Context

## 13.1 Named Parameter

```sql
SELECT *
FROM Customer
WHERE CustomerId = @CustomerId;
```

Nhận diện:

```text
@CustomerId → SQLServerParameter
```

---

# 14. SQL Server System Variable

Phải phân biệt:

```sql
@@ROWCOUNT
@@SPID
@@IDENTITY
@@VERSION
```

với:

```sql
@CustomerId
```

Model:

```text
@@ROWCOUNT → SystemVariable
@CustomerId → Parameter
```

---

# 15. SQL Server Dynamic SQL

Ví dụ:

```sql
DECLARE @sql NVARCHAR(MAX);

SET @sql = N'
    SELECT *
    FROM Customer
    WHERE CustomerId = @CustomerId
';

EXEC sp_executesql
    @sql,
    N'@CustomerId INT',
    @CustomerId = 10;
```

Không được coi tất cả:

```text
@xxx
```

là cùng một loại.

Phải phân biệt:

```text
Outer Variable
Dynamic SQL Parameter
sp_executesql Parameter
```

---

# 16. SQL Context Model

Tạo model dùng chung:

```javascript
{
    dialect: "postgresql",

    cursor: {
        line: 10,
        column: 20,
        offset: 320
    },

    scope: {
        type: "query",
        function: null,
        procedure: null
    },

    context: {
        type: "where_expression",

        insideString: false,
        insideComment: false,
        insideFunction: false,
        insideFormat: false,
        insideDynamicSql: false
    },

    tokens: []
}
```

---

# 17. IntelliSense sử dụng Context Model

CodeMirror 6 vẫn giữ completion system hiện tại.

Chỉ thay đổi nguồn context:

```text
CodeMirror
     │
     ▼
Existing Completion Provider
     │
     ▼
Context Engine
     │
     ▼
Context Model
```

Ví dụ:

```sql
SELECT *
FROM cus...
```

Context Engine:

```text
dialect = PostgreSQL
context = FROM
```

IntelliSense:

```text
customer
customer_bank
customer_group
...
```

---

# 18. IntelliSense không phụ thuộc Parameter Parser

Đây là nguyên tắc quan trọng.

Không được:

```text
IntelliSense
    ↓
Parameter Parser
    ↓
Context
```

Mà:

```text
             Context Engine
              /          \
             /            \
            ▼              ▼
    IntelliSense      Parameter Parser
```

Hai module độc lập.

---

# 19. Parameter Parser

Parameter Parser sử dụng Context Engine.

Ví dụ PostgreSQL:

```sql
SELECT *
FROM customer
WHERE id = $1;
```

Parameter Parser:

```javascript
{
    parameters: [
        {
            name: "$1",
            type: "positional",
            index: 1
        }
    ]
}
```

---

# 20. PostgreSQL `format()` không đi vào Parameter Binder

Ví dụ:

```sql
SELECT format('%I', 'customer');
```

Context Engine:

```text
format()
 └── %I → FormatPlaceholder
```

Parameter Parser:

```text
parameters = []
```

Không được gửi `%I` sang parameter binder.

Đây chính là điểm sửa lỗi hiện tại.

---

# 21. Parameter Model

Dùng model thống nhất:

```javascript
{
    type: "query_parameter",

    dialect: "postgresql",

    style: "positional",

    name: "$1",

    index: 1,

    location: {
        start: 120,
        end: 122,
        line: 10,
        column: 20
    }
}
```

PostgreSQL format:

```javascript
{
    type: "format_placeholder",

    dialect: "postgresql",

    formatType: "identifier",

    value: "%I",

    location: {
        start: 120,
        end: 122
    }
}
```

SQL Server:

```javascript
{
    type: "query_parameter",

    dialect: "sqlserver",

    style: "named",

    name: "@CustomerId"
}
```

---

# 22. Syntax Highlight

Syntax Highlight cũng có thể dùng token model:

```text
PostgreSQLParameter
PostgreSQLFormatPlaceholder
SQLServerParameter
SQLServerSystemVariable
String
Comment
Keyword
Identifier
```

Tuy nhiên:

> Không bắt buộc phải refactor syntax highlighting ngay trong phase đầu.

Nếu syntax highlighting hiện tại đang ổn, giữ nguyên.

---

# 23. Validation

Validation có thể sử dụng Context Engine để phát hiện:

```text
Invalid parameter
Unknown placeholder
Invalid PostgreSQL format placeholder
Invalid SQL Server variable
```

Nhưng phải phân biệt:

```text
Error
Warning
Unknown
```

Không được báo lỗi chỉ vì parser chưa hiểu một token.

---

# 24. Debug Extension

Kiến trúc này cũng phục vụ `bs.trace()` sau này.

Ví dụ:

```sql
bs.trace(
    SELECT *
    FROM customer
);
```

Context Engine có thể nhận biết:

```text
FunctionCall
 └── bs.trace
     └── PostgreSQL SQL Context
```

Từ đó Debug Extension có thể sử dụng context chung.

Không cần tạo một parser hoàn toàn riêng cho `bs.trace`.

---

# 25. API

Đề xuất:

```javascript
const context = sqlContextEngine.analyze({
    sql,
    cursorOffset,
    dialect,
    connectionContext
});
```

Trả về:

```javascript
{
    dialect,
    cursor,
    tokens,
    context,
    scopes,
    parameters,
    formatPlaceholders,
    errors
}
```

---

# 26. API cho IntelliSense

```javascript
const context = sqlContextEngine.getCursorContext({
    sql,
    cursorOffset,
    dialect
});

const suggestions = completionProvider.getSuggestions(context);
```

Completion Provider không cần biết cách tokenizer hoạt động.

---

# 27. API cho Parameter Parser

```javascript
const analysis = sqlContextEngine.analyze({
    sql,
    dialect
});

const parameters =
    parameterParser.extract(analysis);
```

---

# 28. API cho Debug Extension

```javascript
const analysis = sqlContextEngine.analyze({
    sql,
    dialect: "postgresql"
});

const traces =
    debugExtensionDetector.detect(analysis);
```

---

# 29. CodeMirror 6 Integration

Không thay editor.

Không thay completion UI.

Chỉ bổ sung:

```text
CodeMirror Completion
        │
        ▼
Context Adapter
        │
        ▼
SQL Context Engine
```

Context Adapter chịu trách nhiệm chuyển:

```text
CodeMirror EditorState
```

thành:

```text
SQL Context Engine Input
```

---

# 30. Cache

Vì IntelliSense chạy thường xuyên khi user gõ, Context Engine cần cache.

Không parse toàn bộ document từ đầu sau mỗi ký tự nếu không cần.

Có thể dùng:

```text
Document Version
Token Cache
Parse Range
Cursor Context Cache
```

Ví dụ:

```javascript
{
    documentVersion: 125,
    dialect: "postgresql",
    tokens: [...]
}
```

Khi user nhập một ký tự:

```text
Editor Change
    ↓
Incremental Update
    ↓
Update affected token range
```

---

# 31. Performance

Đặc biệt không được làm:

```text
Every keystroke
    ↓
Parse entire 10,000-line function
    ↓
Database query
```

Context Engine phải:

* không gọi database
* không query schema
* không gọi network
* không execute SQL

trong quá trình lexical/context analysis.

---

# 32. Schema IntelliSense

Context Engine chỉ xác định:

```text
FROM context
JOIN context
WHERE context
SELECT context
```

Còn schema provider xử lý:

```text
Tables
Views
Columns
Functions
Procedures
Schemas
```

Kiến trúc:

```text
Context Engine
       │
       ▼
Completion Context
       │
       ▼
Schema Provider
       │
       ▼
Suggestions
```

---

# 33. Không làm thay đổi UI

Các thành phần sau giữ nguyên:

```text
CodeMirror
Completion Popup
Result Grid
Result Manager
Tabs
Sidebar
Action Bar
Theme
```

Feature này chủ yếu thay đổi backend/frontend parsing architecture.

---

# 34. Execution Flow

## SQL Server

```text
Editor
 ↓
Context Engine
 ↓
Parameter Parser
 ↓
Parameter Binding
 ↓
SQL Server Driver
 ↓
SQL Server
```

## PostgreSQL

```text
Editor
 ↓
Context Engine
 ↓
Parameter Parser
 ↓
Parameter Binding
 ↓
PostgreSQL Driver
 ↓
PostgreSQL
```

PostgreSQL:

```sql
format('%I', ...)
```

không được đưa vào Parameter Binding.

---

# 35. Run Debug Flow

Với PostgreSQL:

```text
Run Debug
   ↓
Context Engine
   ↓
Detect Debug Extension
   ↓
bs.trace()
   ↓
Debug Instrumentation
   ↓
PostgreSQL
```

Context Engine được tái sử dụng.

---

# 36. Test bắt buộc cho IntelliSense

## PostgreSQL

```sql
SELECT * FROM customer WHERE id = $1;
```

Cursor sau:

```text
FROM
```

phải tiếp tục suggestion table.

Cursor sau:

```text
WHERE id =
```

phải tiếp tục suggestion phù hợp.

---

## PostgreSQL format

```sql
SELECT format('%I', cus...)
```

Không được xuất hiện:

```text
parameter suggestion
```

chỉ vì có `%I`.

---

## SQL Server

```sql
SELECT *
FROM Customer
WHERE CustomerId = @Cust...
```

IntelliSense phải tiếp tục hoạt động với:

```text
@CustomerId
```

---

# 37. Regression Test quan trọng nhất

Phải test lại lỗi hiện tại:

```sql
SELECT format(
    'SELECT * FROM %I WHERE id = %L',
    'customer',
    10
);
```

Kết quả:

```text
No placeholder error
```

và:

```text
%I → PostgreSQL Format Placeholder
%L → PostgreSQL Format Placeholder
```

---

# 38. Những thứ Agent KHÔNG được làm

Agent không được:

1. Viết lại toàn bộ IntelliSense.
2. Chuyển IntelliSense từ CodeMirror sang Monaco.
3. Thay đổi UI suggestion.
4. Thay đổi Completion Provider nếu không cần.
5. Dùng regex làm parser chính.
6. Dùng chung parameter rule cho SQL Server/PostgreSQL.
7. Query database trong Context Engine.
8. Tự động rewrite SQL source.
9. Tự động đổi `%I` thành `%s`.
10. Xóa `%I` hoặc `%L` để tránh lỗi.
11. Bỏ qua PostgreSQL `format()`.
12. Làm thay đổi hành vi normal Run nếu không liên quan.

---

# 39. Quy trình triển khai

## Phase 1 — Audit

Tìm:

```text
placeholder
parameter
%s
%b
%t
%
@
$
execute
bind
query parameters
```

Xác định chính xác:

```text
Editor
 ↓
Parameter Parser
 ↓
Execution
```

đang đi qua file/function nào.

**Không sửa code ở phase này.**

---

# 40. Phase 2 — Xây Dialect Layer

Tạo:

```text
SqlDialect
PostgreSQLDialect
SqlServerDialect
```

Chỉ định nghĩa rules.

---

# 41. Phase 3 — Tokenizer

Triển khai tokenizer.

Test:

```text
String
Comment
Identifier
Parameter
FormatPlaceholder
DollarQuote
```

---

# 42. Phase 4 — Context Engine

Xây:

```text
Context Analyzer
Function Analyzer
String Analyzer
Comment Analyzer
Dynamic SQL Analyzer
Format Analyzer
```

---

# 43. Phase 5 — Parameter Parser

Chuyển Parameter Parser hiện tại sang sử dụng Context Engine.

Mục tiêu:

```text
Old Parameter Parser
        ↓
Context Adapter
        ↓
New Context Engine
```

Không thay đổi API nếu không cần.

---

# 44. Phase 6 — IntelliSense Adapter

Đây là phase cần đặc biệt cẩn thận.

Không rewrite IntelliSense.

Chỉ:

```text
Current IntelliSense
       ↓
Context Adapter
       ↓
Context Engine
```

Nếu IntelliSense hiện tại đã có logic context tốt:

> Giữ lại logic đó và migrate từng phần.

Không thay toàn bộ một lần.

---

# 45. Phase 7 — Regression

Chạy:

```text
Existing IntelliSense tests
Existing SQL Server tests
Existing PostgreSQL tests
New Parameter tests
New Context tests
```

Đặc biệt phải đảm bảo:

```text
Before:
IntelliSense hoạt động

After:
IntelliSense vẫn hoạt động
```

---

# 46. Phase 8 — Debug Extension Integration

Sau khi Context Engine ổn định:

```text
bs.trace()
```

mới sử dụng:

```text
Context Engine
```

để detect extension.

Không xây parser thứ hai cho `bs.trace()`.

---

# 47. Definition of Done

## Context Engine

* [ ] Detect SQL Server
* [ ] Detect PostgreSQL
* [ ] Tokenize SQL
* [ ] Detect string
* [ ] Detect comment
* [ ] Detect function
* [ ] Detect nested parentheses
* [ ] Detect dynamic SQL context
* [ ] Detect PostgreSQL dollar quote
* [ ] Detect PostgreSQL format context

## PostgreSQL

* [ ] `$1`
* [ ] `$2`
* [ ] `%I`
* [ ] `%L`
* [ ] `%s`
* [ ] `format()`
* [ ] dollar quoting
* [ ] PL/pgSQL

## SQL Server

* [ ] `@parameter`
* [ ] `@@system_variable`
* [ ] dynamic SQL
* [ ] `sp_executesql`

## IntelliSense

* [ ] CodeMirror 6 vẫn được sử dụng
* [ ] Completion UI không thay đổi
* [ ] Existing suggestions không bị mất
* [ ] Context mới được sử dụng từng bước
* [ ] Không query DB trong parser
* [ ] Không gây lag khi gõ

## Parameter

* [ ] Không nhận `%I` là parameter
* [ ] Không nhận `%L` là parameter
* [ ] Không nhận `%` trong string là parameter
* [ ] Không nhận parameter trong comment
* [ ] Không nhận `@@ROWCOUNT` là `@parameter`
* [ ] PostgreSQL `$1` được nhận diện
* [ ] SQL Server `@xxx` được nhận diện

---

# 48. Kiến trúc cuối cùng

```text
                         ┌──────────────────┐
                         │   CodeMirror 6   │
                         │  Existing Editor │
                         └────────┬─────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │   SQL Context Engine │
                       └──────────┬───────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
        ┌───────────┐      ┌──────────────┐    ┌────────────┐
        │ Tokenizer │      │Context Model │    │Dialect     │
        │           │      │              │    │Rules       │
        └───────────┘      └──────────────┘    └────────────┘
              │                   │
              └───────────────────┼───────────────────┐
                                  │                   │
                                  ▼                   ▼
                         ┌────────────────┐   ┌─────────────────┐
                         │  IntelliSense  │   │Parameter Parser │
                         └───────┬────────┘   └────────┬────────┘
                                 │                     │
                                 ▼                     ▼
                           Suggestions            Query Binding
                                                       │
                                                       ▼
                                                  DB Driver
                                                       │
                                     ┌─────────────────┴──────────────┐
                                     │                                │
                                     ▼                                ▼
                                SQL Server                       PostgreSQL
```

---

# 49. Kết luận kiến trúc

Mục tiêu không phải là:

> "Sửa lỗi `%I`."

Mục tiêu thực sự là:

> **Xây một SQL Context Engine có hiểu dialect, để IntelliSense và Parameter Parser cùng hiểu SQL đúng context nhưng vẫn độc lập về nghiệp vụ.**

Điều này đặc biệt quan trọng với IDE của fen vì sau này cùng một Context Engine có thể phục vụ:

```text
SQL Server IntelliSense
PostgreSQL IntelliSense
Parameter Detection
Syntax Check
Syntax Highlight
Dynamic SQL Analysis
bs.trace()
bs.print()
bs.assert()
bs.watch()
```

Trong đó **CodeMirror 6 vẫn là IntelliSense hiện tại**, còn Monaco không cần tham gia vào thay đổi này.
