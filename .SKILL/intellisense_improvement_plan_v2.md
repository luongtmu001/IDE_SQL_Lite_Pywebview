# SQL IntelliSense Architecture & Improvement Plan

## 1. Mục tiêu

Cải thiện hệ thống SQL IntelliSense hiện tại của IDE.

### Nguyên tắc bắt buộc

1. Không thay đổi giao diện IntelliSense hiện tại.
2. Không thay CodeMirror editor hiện tại.
3. Không thay đổi UX hiện có nếu chức năng đó đang hoạt động tốt.
4. Không rewrite toàn bộ IntelliSense chỉ vì muốn sử dụng framework mới.
5. Chỉ cải thiện kiến trúc xử lý IntelliSense, độ chính xác, hiệu năng và khả năng mở rộng.
6. Những phần hiện tại đang hoạt động tốt phải được giữ nguyên.
7. Không đưa Monaco vào editor chỉ để phục vụ IntelliSense.
8. Có thể tận dụng các thành phần language-service/parser phù hợp nếu chúng cải thiện độ chính xác.
9. IntelliSense phải hoạt động tốt với database lớn.
10. Không query database mỗi lần người dùng gõ một ký tự.

---

# 2. Kiến trúc hiện tại

Project hiện tại sử dụng:

- CodeMirror làm SQL editor.
- Monaco đã tồn tại trong project nhưng chưa được sử dụng cho IntelliSense.
- Backend Python/Flask/pywebview.
- Database hỗ trợ SQL Server và PostgreSQL.
- IDE có metadata database gồm:
  - Database
  - Schema
  - Table
  - View
  - Column
  - Procedure
  - Function
  - Trigger
  - Synonym
  - Các database object khác.

Không được giả định rằng Monaco phải thay thế CodeMirror.

---

# 3. Kiến trúc mục tiêu

Xây dựng IntelliSense thành một hệ thống độc lập với editor.

```text
CodeMirror
    │
    ▼
Editor Adapter
    │
    ▼
IntelliSense Controller
    │
    ├── Document State
    │
    ├── SQL Tokenizer
    │
    ├── SQL Context Analyzer
    │
    ├── SQL Parser
    │
    ├── Scope / Alias Resolver
    │
    ├── Metadata Provider
    │
    ├── Completion Engine
    │
    ├── Ranking Engine
    │
    ├── Cache Manager
    │
    └── Diagnostics Engine
            │
            ▼
      CodeMirror UI
```

Editor chỉ cung cấp:

```text
document text
cursor position
selection
current statement
```

IntelliSense Engine chịu trách nhiệm quyết định:

```text
user đang ở context nào?
nên hiển thị loại suggestion nào?
object nào hợp lệ?
column nào hợp lệ?
alias nào hợp lệ?
suggestion nào được ưu tiên?
```

---

# 4. Framework / thư viện nên sử dụng

## 4.1. CodeMirror

### Vai trò

Tiếp tục sử dụng CodeMirror làm editor.

Không thay thế.

CodeMirror chịu trách nhiệm:

- editor
- cursor
- selection
- keyboard
- completion popup
- syntax highlighting
- document events.

IntelliSense engine không nên phụ thuộc sâu vào implementation UI của CodeMirror.

Tạo adapter:

```javascript
class CodeMirrorIntelliSenseAdapter {
    getDocument() {}
    getCursorPosition() {}
    getCurrentLine() {}
    getTextBeforeCursor() {}
    getTextAfterCursor() {}
    replaceRange() {}
    showCompletion() {}
    closeCompletion() {}
}
```

Mục đích:

Sau này nếu đổi editor, IntelliSense engine không phải viết lại.

---

# 5. Monaco

## 5.1. Không sử dụng Monaco để thay CodeMirror

Monaco hiện đã tồn tại trong project nhưng chưa dùng cho IntelliSense.

Không được thực hiện:

```text
CodeMirror → Monaco migration
```

chỉ vì Monaco có IntelliSense API.

## 5.2. Có thể nghiên cứu Monaco Language Service

Monaco có kiến trúc language provider:

```javascript
registerCompletionItemProvider()
registerHoverProvider()
registerDefinitionProvider()
registerReferenceProvider()
registerSignatureHelpProvider()
```

Các khái niệm này có thể dùng làm reference architecture.

Tuy nhiên:

Không bắt buộc phải render IntelliSense bằng Monaco.

Có thể xây dựng:

```text
Custom SQL IntelliSense Engine
        +
CodeMirror Completion UI
```

## 5.3. Khi nào Monaco nên được sử dụng?

Chỉ sử dụng Monaco nếu sau khi kiểm tra project thấy một thành phần language-service cụ thể giúp giải quyết vấn đề mà CodeMirror không có.

Không đưa Monaco vào runtime path của SQL editor nếu điều đó tạo thêm:

- bundle size
- memory
- duplicate editor state
- event synchronization
- complexity.

---

# 6. SQL Parser

Đây là phần cần ưu tiên nghiên cứu.

Không nên xây dựng IntelliSense bằng hàng loạt regex.

Ví dụ không nên phụ thuộc vào:

```javascript
if (text.includes("SELECT"))
if (text.includes("FROM"))
if (text.endsWith("."))
```

Cách này nhanh ở prototype nhưng sẽ nhanh chóng thất bại với:

```sql
SELECT *
FROM dbo.Customer c
WHERE c.Name IN (
    SELECT Name
    FROM dbo.Customer
)
```

hoặc:

```sql
SELECT *
FROM (
    SELECT *
    FROM dbo.Customer
) x
```

hoặc:

```sql
SELECT *
FROM dbo.Customer AS c
JOIN dbo.Order o
    ON o.CustomerId = c.Id
WHERE c.
```

---

# 7. SQL Parser Framework

Agent phải khảo sát các parser hiện có trước khi tự viết parser.

Ưu tiên nghiên cứu:

## 7.1. ANTLR

ANTLR là lựa chọn phù hợp nếu cần parser SQL có grammar rõ ràng.

Kiến trúc:

```text
SQL text
   ↓
Lexer
   ↓
Token
   ↓
Parser
   ↓
Parse Tree
   ↓
AST / Context
```

Có thể sử dụng grammar riêng cho:

- T-SQL
- PostgreSQL
- SQL dialect khác.

Không copy một grammar lớn vào project mà chưa đánh giá compatibility.

---

## 7.2. SQLGlot

Backend Python có thể nghiên cứu SQLGlot.

SQLGlot phù hợp cho:

- parsing SQL
- AST
- dialect
- expression analysis
- SQL transformation.

Có thể sử dụng backend:

```text
CodeMirror
    ↓
Frontend context request
    ↓
Flask
    ↓
SQL parser
    ↓
AST
    ↓
context information
```

Nhưng không được gửi request server cho mỗi lần keypress.

Parser nên được dùng theo chiến lược:

```text
local lightweight analysis
+
background parser
```

---

# 8. Không nên bắt đầu bằng parser hoàn chỉnh

Agent phải triển khai theo từng giai đoạn.

### Phase 1

Giữ parser hiện tại.

Cải thiện:

- tokenization
- context detection
- alias detection
- metadata cache.

### Phase 2

Thêm parser cho những context phức tạp.

### Phase 3

AST-based completion.

Không được rewrite toàn bộ hệ thống ngay từ Phase 1.

---

# 9. SQL Tokenizer

Tạo module riêng:

```text
sql-tokenizer.js
```

Tokenizer phải nhận biết:

```text
KEYWORD
IDENTIFIER
QUALIFIED_IDENTIFIER
STRING
NUMBER
OPERATOR
PUNCTUATION
COMMENT
WHITESPACE
PARAMETER
FUNCTION
```

Ví dụ:

```sql
SELECT c.Name
FROM dbo.Customer c
WHERE c.
```

Tokenizer phải tạo được:

```text
SELECT       KEYWORD
c            IDENTIFIER
.            PUNCTUATION
Name         IDENTIFIER
FROM         KEYWORD
dbo          IDENTIFIER
.            PUNCTUATION
Customer     IDENTIFIER
c            IDENTIFIER
WHERE        KEYWORD
c            IDENTIFIER
.            PUNCTUATION
```

---

# 10. Cursor Context Analyzer

Đây là thành phần quan trọng nhất của IntelliSense.

Tại cursor:

```sql
SELECT c.
FROM dbo.Customer c
```

engine phải trả:

```javascript
{
    type: "COLUMN",
    qualifier: "c",
    statement: "SELECT",
    scope: "current"
}
```

Nếu:

```sql
SELECT *
FROM
```

trả:

```javascript
{
    type: "FROM_OBJECT"
}
```

Nếu:

```sql
SELECT *
FROM dbo.Customer
WHERE
```

trả:

```javascript
{
    type: "COLUMN"
}
```

Nếu:

```sql
EXEC
```

trả:

```javascript
{
    type: "PROCEDURE"
}
```

---

# 11. Context Types

Chuẩn hóa context.

```javascript
const IntelliSenseContextType = {
    KEYWORD: "keyword",

    DATABASE: "database",
    SCHEMA: "schema",

    TABLE: "table",
    VIEW: "view",

    COLUMN: "column",

    ALIAS: "alias",

    FUNCTION: "function",

    PROCEDURE: "procedure",

    TRIGGER: "trigger",

    SYNONYM: "synonym",

    PARAMETER: "parameter",

    JOIN_COLUMN: "join_column",

    ORDER_COLUMN: "order_column",

    GROUP_COLUMN: "group_column",

    UNKNOWN: "unknown"
};
```

Không để các module tự tạo string context khác nhau.

---

# 12. Scope Resolver

Phải xây dựng scope.

Ví dụ:

```sql
SELECT *
FROM Customer c
WHERE c.
```

resolver:

```text
c → Customer
```

Ví dụ:

```sql
SELECT *
FROM Customer c
JOIN Orders o
    ON o.CustomerId = c.Id
WHERE o.
```

resolver:

```text
c → Customer
o → Orders
```

---

# 13. Alias Resolver

Alias phải được lưu thành cấu trúc:

```javascript
{
    alias: "c",
    object: "Customer",
    schema: "dbo",
    database: null,
    type: "table"
}
```

Không chỉ lưu:

```javascript
{
    c: "Customer"
}
```

vì sau này cần xử lý:

```text
database.schema.table
schema.table
table
view
CTE
subquery
```

---

# 14. Qualified Identifier Resolver

Phải hỗ trợ:

```sql
c.
dbo.Customer.
Database.dbo.Customer.
```

Phân biệt:

```text
c
dbo
Customer
Database
```

và xác định đúng object.

---

# 15. Metadata Provider

Tạo abstraction:

```javascript
class MetadataProvider {

    async getDatabases(connectionId) {}

    async getSchemas(connectionId, database) {}

    async getTables(connectionId, database, schema) {}

    async getViews(connectionId, database, schema) {}

    async getColumns(connectionId, database, schema, table) {}

    async getProcedures(connectionId, database, schema) {}

    async getFunctions(connectionId, database, schema) {}

    async getTriggers(connectionId, database, schema) {}

    async getSynonyms(connectionId, database, schema) {}

    async getParameters(connectionId, database, schema, name) {}

    async getDefinition(connectionId, database, schema, name, type) {}

    async getSupportedTypes(connectionId, database) {}
}
```

Không để IntelliSense trực tiếp gọi API database ở nhiều nơi.

---

# 16. SQL Server Metadata Provider

Tạo:

```text
SqlServerMetadataProvider
```

Có thể sử dụng metadata từ:

```text
sys.databases
sys.schemas
sys.tables
sys.views
sys.columns
sys.objects
sys.procedures
sys.types
sys.synonyms
```

Nhưng phải kiểm tra metadata hiện tại của project trước khi triển khai.

Nếu project đã có metadata service tốt:

```text
KHÔNG tạo service thứ hai.
```

Thay vào đó adapter metadata service hiện tại vào:

```text
MetadataProvider
```

---

# 17. PostgreSQL Metadata Provider

Tạo:

```text
PostgresMetadataProvider
```

Có thể sử dụng:

```text
information_schema
pg_catalog
```

Đặc biệt:

```text
pg_class
pg_namespace
pg_attribute
pg_proc
pg_type
```

Không hard-code logic PostgreSQL vào core IntelliSense.

---

# 18. Metadata Cache

Đây là yêu cầu bắt buộc.

Không được:

```text
keypress
   ↓
database query
   ↓
return suggestions
```

Thay vào đó:

```text
Database
   ↓
Metadata Loader
   ↓
Cache
   ↓
IntelliSense
```

Ví dụ:

```javascript
MetadataCache
{
    databases: [],
    schemas: {},
    objects: {},
    columns: {}
}
```

---

# 19. Cache Levels

## Level 1 — Connection cache

Metadata gắn với:

```text
connection
database
schema
```

## Level 2 — Object cache

Ví dụ:

```text
dbo.Customer
```

cache:

```text
columns
indexes
keys
constraints
```

## Level 3 — Completion cache

Cache kết quả completion đã tính toán.

---

# 20. Cache Invalidation

Không cache vô thời hạn.

Metadata phải có:

```text
TTL
manual refresh
connection refresh
database switch refresh
schema switch refresh
```

Nếu user thực hiện:

```sql
ALTER TABLE Customer ADD NewColumn ...
```

có thể cung cấp:

```text
Refresh metadata
```

Không cần refresh toàn bộ database nếu chỉ một object thay đổi.

---

# 21. Completion Engine

Tạo module:

```text
completion-engine.js
```

Input:

```javascript
{
    document,
    cursor,
    context,
    scope,
    metadata
}
```

Output:

```javascript
[
    {
        label: "CustomerId",
        kind: "column",
        detail: "int",
        insertText: "CustomerId"
    }
]
```

---

# 22. Completion Pipeline

Phải xử lý theo thứ tự:

```text
1. Get cursor
2. Tokenize nearby SQL
3. Detect statement
4. Detect context
5. Resolve scope
6. Resolve aliases
7. Load metadata
8. Generate candidates
9. Filter
10. Rank
11. Return
```

Không query tất cả object trước rồi mới filter.

---

# 23. Candidate Sources

Completion candidate phải được lấy từ:

```text
Keywords
Current scope
Aliases
Tables
Views
Columns
Functions
Procedures
Schemas
Databases
Snippets
Parameters
```

---

# 24. Context-aware completion

Ví dụ:

```sql
SELECT c.
```

Chỉ ưu tiên:

```text
columns của c
```

Không đưa lên đầu:

```text
tables
views
procedures
schemas
```

---

# 25. FROM completion

Khi:

```sql
SELECT *
FROM
```

ưu tiên:

```text
tables
views
synonyms
```

---

# 26. JOIN completion

Khi:

```sql
SELECT *
FROM Customer c
JOIN
```

ưu tiên:

```text
tables
views
```

Sau:

```sql
JOIN Orders o
    ON
```

có thể ưu tiên:

```text
columns
```

---

# 27. WHERE completion

Khi:

```sql
WHERE
```

ưu tiên:

```text
columns
functions
parameters
operators
```

---

# 28. ORDER BY / GROUP BY

Ví dụ:

```sql
ORDER BY
```

ưu tiên column của scope hiện tại.

---

# 29. Procedure completion

Khi:

```sql
EXEC dbo.
```

hiển thị procedure phù hợp.

Sau khi chọn procedure:

```sql
EXEC dbo.usp_Test
```

có thể cung cấp parameter information nếu metadata đã có.

---

# 30. Ranking Engine

Không sử dụng ranking tùy tiện.

Tạo:

```javascript
class CompletionRanker {
    rank(items, context) {}
}
```

Các tín hiệu có thể sử dụng:

```text
exact prefix match
prefix match
context match
scope match
alias match
object type
recent usage
same schema
same database
```

Ví dụ:

```text
c.CustomerId
```

thì:

```text
CustomerId
```

phải được ưu tiên cao hơn:

```text
CustomerName
OrderId
```

---

# 31. Fuzzy Search

Không fuzzy search toàn bộ database ngay lập tức.

Pipeline:

```text
exact prefix
↓
prefix
↓
substring
↓
fuzzy
```

Chỉ dùng fuzzy khi số candidate còn lại nhỏ hoặc user đã nhập đủ ký tự.

---

# 32. Debounce

Không tính IntelliSense cho mỗi keypress ngay lập tức.

Ví dụ:

```text
user typing:
c
cu
cus
cust
```

có thể debounce khoảng:

```text
50–150ms
```

Nhưng:

```text
"."
CTRL+SPACE
```

phải trigger ngay.

Không hard-code delay trước khi đo thực tế.

---

# 33. Cancellation

Nếu request IntelliSense cũ chưa hoàn thành:

```text
request #10
```

nhưng user đã gõ tiếp:

```text
request #11
```

request #10 không được phép ghi kết quả cũ lên UI.

Sử dụng:

```javascript
AbortController
```

hoặc request generation:

```javascript
requestId
```

Ví dụ:

```javascript
const requestId = ++state.requestId;

const result = await getCompletion();

if (requestId !== state.requestId) {
    return;
}
```

---

# 34. Không gửi toàn bộ document mỗi lần

Nếu document lớn:

```text
5000 lines
```

không gửi toàn bộ document cho backend ở mỗi keypress.

Frontend nên giữ:

```text
document state
```

và gửi:

```text
changed range
cursor
current statement
```

khi có thể.

---

# 35. Multi-statement SQL

Phải hỗ trợ:

```sql
SELECT ...
GO

SELECT ...
FROM ...
```

hoặc PostgreSQL:

```sql
SELECT ...;

SELECT ...
```

Cursor phải được xác định đang thuộc statement nào.

---

# 36. Comment awareness

Không trigger IntelliSense trong:

```sql
-- comment
```

hoặc:

```sql
/*
    comment
*/
```

Ví dụ:

```sql
SELECT *
FROM Customer -- c.
```

không được coi `c.` là context.

---

# 37. String awareness

Không trigger completion trong string:

```sql
SELECT *
WHERE Name = 'c.'
```

---

# 38. Bracket awareness

Hỗ trợ:

```sql
[cus
```

và:

```sql
"customer
```

và PostgreSQL identifier:

```sql
"Customer".
```

---

# 39. CTE

Phải hỗ trợ:

```sql
WITH CustomerData AS (
    SELECT *
    FROM Customer
)
SELECT *
FROM CustomerData
WHERE
```

`CustomerData` phải được coi là object trong scope hiện tại.

---

# 40. Subquery

Phải hỗ trợ:

```sql
SELECT *
FROM (
    SELECT Id, Name
    FROM Customer
) c
WHERE c.
```

Resolver phải biết:

```text
c.Id
c.Name
```

không phải toàn bộ column của Customer nếu subquery chỉ expose hai column.

---

# 41. JOIN scope

Ví dụ:

```sql
FROM Customer c
JOIN Orders o
    ON o.CustomerId = c.Id
```

Scope phải chứa:

```text
c → Customer
o → Orders
```

---

# 42. SELECT alias

Phân biệt:

```sql
SELECT CustomerName AS Name
FROM Customer
ORDER BY
```

và:

```sql
WHERE
```

Alias của SELECT không phải lúc nào cũng hợp lệ ở mọi SQL clause.

Không dùng một scope chung cho tất cả clause.

---

# 43. Dialect abstraction

Core engine không được hard-code SQL Server.

Tạo:

```javascript
class SqlDialect {
    getKeywords() {}
    quoteIdentifier(name) {}
    getIdentifierRules() {}
    getMetadataProvider() {}
}
```

Implement:

```text
SqlServerDialect
PostgresDialect
```

---

# 44. SQL Server differences

Phải hỗ trợ:

```sql
[dbo].[Customer]
```

```sql
dbo.Customer
```

```sql
Database.dbo.Customer
```

và:

```sql
#TempTable
##GlobalTempTable
```

nếu project có nhu cầu.

---

# 45. PostgreSQL differences

Phải hỗ trợ:

```sql
public.customer
```

quoted identifier:

```sql
"Customer"
```

và schema/database semantics của PostgreSQL.

---

# 46. Temporary objects

Nếu SQL Server:

```sql
CREATE TABLE #TempCustomer (...)
```

sau đó:

```sql
SELECT *
FROM #TempCustomer
WHERE
```

IntelliSense nên biết column của temp table nếu parser/context engine có đủ thông tin.

Đây là Phase nâng cao, không triển khai trước khi core completion ổn định.

---

# 47. Local symbols

Ngoài database metadata, IntelliSense phải có symbol table cục bộ:

```text
CTE
alias
temporary table
table variable
parameters
DECLARE variables
subquery alias
```

Ví dụ:

```sql
DECLARE @CustomerId INT;

SELECT *
FROM Customer
WHERE Id = @
```

phải nhận biết:

```text
@CustomerId
```

---

# 48. Symbol Table

Tạo:

```javascript
class SqlSymbolTable {

    add(symbol) {}

    remove(symbol) {}

    resolve(name) {}

    getCurrentScope() {}

    enterScope() {}

    exitScope() {}
}
```

Symbol:

```javascript
{
    name: "c",
    kind: "alias",
    object: "dbo.Customer",
    scope: "statement"
}
```

---

# 49. Completion UI

Không thay đổi UI hiện tại.

Chỉ thay dữ liệu đầu vào.

Hiện tại:

```text
CodeMirror
    ↓
Current IntelliSense
    ↓
Popup
```

Sau cải thiện:

```text
CodeMirror
    ↓
IntelliSense Controller
    ↓
Completion Engine
    ↓
Popup hiện tại
```

---

# 50. Hover

Sau khi completion ổn định có thể bổ sung:

```text
hover table
hover column
hover procedure
hover function
```

Ví dụ:

```text
CustomerId
int
NOT NULL
Primary Key
```

Nhưng không triển khai trước completion core.

---

# 51. Signature Help

Phase sau:

```sql
SELECT ISNULL(
```

hiển thị:

```text
ISNULL(check_expression, replacement_value)
```

Hoặc:

```sql
EXEC dbo.usp_Test
```

hiển thị parameter list.

---

# 52. Diagnostics

Sau completion mới triển khai diagnostics.

Ví dụ:

```sql
SELECT abc
FROM Customer
```

có thể phát hiện:

```text
abc không tồn tại trong scope
```

Không biến diagnostics thành requirement của Phase 1.

---

# 53. Architecture of files

Agent phải kiểm tra project trước.

Không tạo file trùng chức năng nếu project đã có module tương ứng.

Kiến trúc mục tiêu có thể giống:

```text
static/
  js/
    intellisense/
      core/
        intellisense-controller.js
        context-analyzer.js
        tokenizer.js
        scope-resolver.js
        symbol-table.js

      completion/
        completion-engine.js
        completion-ranker.js
        completion-filter.js

      metadata/
        metadata-provider.js
        metadata-cache.js

      dialects/
        sql-server-dialect.js
        postgres-dialect.js

      parser/
        sql-parser.js

      adapters/
        codemirror-adapter.js

      diagnostics/
        diagnostics-engine.js
```

Tên file chỉ là đề xuất.

Nếu project hiện tại đã có architecture tương tự, phải reuse.

---

# 54. Backend architecture

Backend có thể:

```text
app/
  services/
    intellisense/
      metadata_service.py
      parser_service.py
```

Nhưng frontend không được phụ thuộc backend cho các thao tác đơn giản như:

```text
prefix filtering
alias lookup
candidate ranking
```

Các thao tác này nên xử lý local.

---

# 55. Khi nào gọi backend?

Backend chỉ nên được gọi khi cần:

```text
database metadata chưa cache
parser phức tạp cần backend
database object information
procedure signature
large schema metadata
```

Không gọi backend cho:

```text
user typed "c"
user typed "cu"
user typed "cus"
```

nếu metadata đã có cache.

---

# 56. Preloading

Sau khi connect database:

```text
connection established
        ↓
load database metadata
        ↓
load schemas
        ↓
load lightweight object metadata
```

Không load toàn bộ columns của hàng chục nghìn tables ngay lập tức nếu không cần.

---

# 57. Lazy loading

Ví dụ user gõ:

```sql
SELECT c.
```

mới load:

```text
dbo.Customer columns
```

Sau đó cache.

---

# 58. Performance budget

Agent phải đo:

```text
keypress → context detection
keypress → candidate generation
keypress → popup
```

Mục tiêu UX:

```text
normal cached completion:
< 50ms

context analysis:
< 10ms

metadata cache lookup:
< 5ms
```

Các giá trị trên là mục tiêu ban đầu, không được coi là số đo thực tế của project.

Phải benchmark trước và sau.

---

# 59. Memory

Không giữ toàn bộ metadata duplicate ở:

```text
CodeMirror
IntelliSense
backend
UI
```

Nếu metadata service hiện tại đã có cache:

```text
reuse it
```

IntelliSense chỉ nên giữ reference hoặc normalized index cần thiết.

---

# 60. Testing

Phải tạo test cases cho context.

## Basic

```sql
SELECT
SELECT *
FROM
WHERE
JOIN
ORDER BY
GROUP BY
```

## Alias

```sql
SELECT c.
FROM Customer c
```

## Join

```sql
SELECT c.
FROM Customer c
JOIN Orders o ON ...
```

## CTE

```sql
WITH x AS (...)
SELECT x.
FROM x
```

## Subquery

```sql
SELECT *
FROM (
   SELECT Id, Name FROM Customer
) c
WHERE c.
```

## Multi database

```sql
Database.dbo.Customer
```

## Comments

```sql
-- SELECT c.
```

## Strings

```sql
SELECT 'c.'
```

## PostgreSQL

```sql
public.customer
```

---

# 61. Regression requirement

Trước khi sửa:

```text
ghi lại behavior hiện tại
```

Sau mỗi phase:

```text
run existing IntelliSense tests
```

Không được đánh đổi các chức năng đang chạy tốt để lấy kiến trúc mới.

---

# 62. Implementation phases

## Phase 0 — Audit

Agent phải:

1. Tìm toàn bộ code IntelliSense hiện tại.
2. Tìm CodeMirror integration.
3. Tìm metadata service.
4. Tìm API database metadata.
5. Tìm cache hiện tại.
6. Tìm Monaco integration.
7. Tìm completion UI.
8. Xác định những chức năng đang hoạt động tốt.
9. Ghi lại dependency graph.

Output:

```text
INTELLISENSE_AUDIT.md
```

Không sửa code ở Phase 0.

---

# 63. Phase 1 — Tách IntelliSense Controller

Tạo abstraction:

```text
Editor
 ↓
Adapter
 ↓
Controller
```

Mục tiêu:

CodeMirror không chứa business logic IntelliSense.

Không thay đổi UI.

---

# 64. Phase 2 — Context Analyzer

Xây dựng:

```text
Tokenizer
Context Analyzer
Statement Detector
```

Test:

```text
SELECT |
SELECT c.|
FROM |
WHERE |
JOIN |
ORDER BY |
```

---

# 65. Phase 3 — Scope / Alias

Implement:

```text
SymbolTable
AliasResolver
ScopeResolver
```

Test:

```sql
FROM Customer c
JOIN Orders o
```

và:

```sql
WHERE c.
WHERE o.
```

---

# 66. Phase 4 — Metadata Adapter

Kết nối metadata hiện tại vào:

```text
MetadataProvider
```

Không duplicate metadata implementation.

---

# 67. Phase 5 — Metadata Cache

Implement:

```text
connection cache
object cache
column cache
invalidation
lazy loading
```

Đo performance.

---

# 68. Phase 6 — Completion Engine

Implement:

```text
candidate generation
filter
ranking
```

Không sửa popup UI.

---

# 69. Phase 7 — Dialects

Hoàn thiện:

```text
SQL Server
PostgreSQL
```

Tách dialect-specific logic.

---

# 70. Phase 8 — Advanced SQL

Sau khi core ổn định:

```text
CTE
subquery
temp table
table variable
procedure parameter
function signature
```

---

# 71. Phase 9 — Advanced language features

Có thể triển khai:

```text
Hover
Signature Help
Go to Definition
Find References
Diagnostics
```

Không bắt buộc trong IntelliSense Phase 1.

---

# 72. Monaco decision

Sau khi Phase 1–8 hoàn thành, đánh giá Monaco.

Chỉ chuyển sang Monaco nếu benchmark hoặc tính năng cho thấy:

```text
Monaco mang lại lợi ích rõ ràng
```

Không chuyển editor chỉ vì:

```text
Monaco có IntelliSense API.
```

---

# 73. Framework decision

Không thêm frontend framework như:

```text
React
Vue
Angular
Svelte
```

chỉ để xây IntelliSense.

Project hiện tại dùng vanilla JavaScript/CodeMirror.

Giữ kiến trúc đó nếu không có vấn đề thực tế.

Các framework UI không giải quyết vấn đề cốt lõi của SQL IntelliSense.

---

# 74. Recommended technology stack

### Editor

```text
CodeMirror
```

### IntelliSense core

```text
Vanilla JavaScript / TypeScript
```

Nếu project hiện tại là JavaScript thuần thì ưu tiên JavaScript trước; không migrate toàn project sang TypeScript chỉ vì IntelliSense.

### Parser

Ưu tiên khảo sát:

```text
SQLGlot
ANTLR
```

sau đó chọn theo benchmark và mức hỗ trợ dialect.

### Backend

```text
Python / Flask
```

### Database metadata

```text
SQL Server system catalogs
PostgreSQL pg_catalog / information_schema
```

### Async

```text
Promise
AbortController
```

### Cache

```text
Memory cache
```

có thể mở rộng sang IndexedDB nếu metadata lớn và thực sự cần persistence.

---

# 75. Những thứ KHÔNG được làm

Không được:

```text
1. Rewrite toàn bộ IntelliSense ngay lập tức.
2. Thay CodeMirror bằng Monaco.
3. Query database mỗi keypress.
4. Dùng regex cho toàn bộ SQL parsing.
5. Hard-code SQL Server logic vào core.
6. Duplicate metadata service.
7. Duplicate cache.
8. Thay đổi UI popup.
9. Thêm React/Vue chỉ để render completion.
10. Load toàn bộ database metadata mỗi lần mở completion.
```

---

# 76. Quy tắc kiểm tra sau mỗi bước

Sau mỗi phase phải trả về:

```text
1. Files changed
2. Files created
3. Existing behavior preserved
4. New behavior
5. Performance before
6. Performance after
7. Tests executed
8. Known limitations
```

Không được thực hiện nhiều phase cùng lúc.

Agent phải dừng sau mỗi phase nếu có regression.

---

# 77. Definition of Done

IntelliSense được coi là đạt khi:

### Accuracy

Có thể xác định chính xác:

```text
table
schema
column
alias
scope
CTE
subquery
procedure
function
```

trong các context phổ biến.

### Performance

Cached completion phải phản hồi nhanh và ổn định.

Không có database request cho mỗi keypress.

### Architecture

Core IntelliSense không phụ thuộc trực tiếp vào CodeMirror.

### Database

Hỗ trợ riêng:

```text
SQL Server
PostgreSQL
```

### Maintainability

Có thể thêm dialect mới mà không sửa toàn bộ core.

### UI

Không thay đổi giao diện IntelliSense hiện tại.

### Regression

Các chức năng IntelliSense đang hoạt động tốt phải tiếp tục hoạt động.

---

# 78. Agent execution rule

Agent KHÔNG được bắt đầu bằng việc viết code.

Trình tự bắt buộc:

```text
AUDIT
  ↓
DOCUMENT CURRENT ARCHITECTURE
  ↓
IDENTIFY REUSABLE COMPONENTS
  ↓
BENCHMARK CURRENT VERSION
  ↓
PHASE 1
  ↓
TEST
  ↓
PHASE 2
  ↓
TEST
  ↓
PHASE 3
  ↓
TEST
...
```

Mỗi phase phải nhỏ, có thể rollback độc lập.

Nếu phát hiện architecture hiện tại đã giải quyết tốt một vấn đề:

```text
KEEP IT
```

Không refactor chỉ để code "đẹp hơn".

---

# 79. Final architectural principle

Mục tiêu không phải:

```text
làm IntelliSense giống Monaco
```

Mục tiêu là:

```text
CodeMirror
+
SQL-aware language engine
+
database metadata engine
+
scope/symbol engine
+
fast cache
+
completion ranking
```

để tạo thành một SQL IntelliSense có khả năng mở rộng theo hướng:

```text
DataGrip / SSMS / Navicat
```

nhưng vẫn phù hợp với kiến trúc hiện tại của IDE.

Quan trọng nhất:

```text
Editor ≠ IntelliSense

UI ≠ Language Engine

Metadata ≠ Completion

Parser ≠ Database

Cache ≠ Source of Truth
```

Tách được 5 lớp này thì sau này có thể phát triển thêm:

```text
Completion
Hover
Signature Help
Go To Definition
Find References
Rename
Diagnostics
SQL Formatting
SQL Refactoring
```

mà không phải viết lại CodeMirror integration.