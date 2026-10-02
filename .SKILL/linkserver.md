# IntelliSense – Linked Server SQL Server & Foreign Data Source PostgreSQL

## 1. Mục tiêu

Bổ sung khả năng IntelliSense cho các nguồn dữ liệu nằm ngoài database hiện tại.

Phạm vi:

* SQL Server Linked Server.
* PostgreSQL Foreign Data Wrapper / Foreign Server.
* PostgreSQL foreign tables.
* Cross-database reference khi dialect hỗ trợ.
* Metadata discovery và caching cho remote objects.
* Context resolution cho remote objects.
* Alias và column completion trên remote source.

Mục tiêu cuối cùng:

```sql
SELECT ls.
FROM [REMOTE_SERVER].[RemoteDb].[dbo].[Customer] ls
WHERE ls.
```

IntelliSense phải hiểu:

```text
ls
 ↓
REMOTE_SERVER.RemoteDb.dbo.Customer
 ↓
Remote metadata
 ↓
Customer columns
```

Không được coi:

```text
REMOTE_SERVER
RemoteDb
dbo
Customer
```

là các object độc lập trong completion context.

---

# 2. Nguyên tắc kiến trúc

Không xây Linked Server IntelliSense thành một nhánh riêng của UI.

Kiến trúc phải là:

```text
Editor
   ↓
Context Engine
   ↓
Identifier Resolver
   ↓
Source Resolver
   ↓
Database/Server Resolver
   ↓
Metadata Provider
   ↓
Local / Remote Metadata
   ↓
Candidate Generator
```

Trong đó:

```text
Local Metadata Provider
Remote Metadata Provider
```

phải dùng chung interface.

---

# 3. SQL Server Linked Server

SQL Server hỗ trợ tham chiếu object dạng:

```sql
[server].[database].[schema].[object]
```

Ví dụ:

```sql
SELECT *
FROM [ERP_SERVER].[ERPDB].[dbo].[Customer]
```

Hoặc:

```sql
SELECT *
FROM ERP_SERVER.ERPDB.dbo.Customer
```

IntelliSense phải nhận diện đây là:

```text
4-part identifier
```

với:

```text
server
database
schema
object
```

---

# 4. Phân biệt 4-part identifier

Khi gặp:

```sql
ERP_SERVER.ERPDB.dbo.Customer
```

không được xử lý như:

```text
alias.column
```

Phải phân tích:

```text
Part 1 = Server
Part 2 = Database
Part 3 = Schema
Part 4 = Object
```

Context object:

```javascript
{
    type: "REMOTE_OBJECT",
    dialect: "sqlserver",
    server: "ERP_SERVER",
    database: "ERPDB",
    schema: "dbo",
    object: "Customer"
}
```

---

# 5. Local SQL Server 3-part name

Phải phân biệt:

```sql
ERPDB.dbo.Customer
```

với:

```sql
ERP_SERVER.ERPDB.dbo.Customer
```

### 3-part

```text
database.schema.object
```

### 4-part

```text
server.database.schema.object
```

Không được coi cả hai là Linked Server.

---

# 6. 2-part identifier

Ví dụ:

```sql
dbo.Customer
```

phải được xử lý:

```text
schema.object
```

Không được suy diễn thành:

```text
database.schema
```

---

# 7. Alias trên Linked Server

Ví dụ:

```sql
SELECT c.
FROM ERP_SERVER.ERPDB.dbo.Customer c
WHERE c.
```

Context phải:

```text
alias:
    c

source:
    REMOTE_OBJECT

server:
    ERP_SERVER

database:
    ERPDB

schema:
    dbo

object:
    Customer
```

Khi user gõ:

```sql
c.
```

chỉ query:

```text
ERP_SERVER
    ↓
ERPDB
    ↓
dbo
    ↓
Customer
    ↓
columns
```

---

# 8. Linked Server JOIN

Phải hỗ trợ:

```sql
SELECT *
FROM ERP_SERVER.ERPDB.dbo.Customer c
JOIN CRM_SERVER.CRMDB.dbo.CustomerType t
    ON t.Id = c.TypeId
```

Scope:

```text
c → ERP_SERVER.ERPDB.dbo.Customer
t → CRM_SERVER.CRMDB.dbo.CustomerType
```

Khi:

```sql
t.
```

phải trả column của:

```text
CRM_SERVER.CRMDB.dbo.CustomerType
```

Khi:

```sql
c.
```

phải trả column của:

```text
ERP_SERVER.ERPDB.dbo.Customer
```

---

# 9. Linked Server + local table

Bắt buộc test:

```sql
SELECT *
FROM Customer c
JOIN ERP_SERVER.ERPDB.dbo.Customer rc
    ON rc.Id = c.Id
WHERE rc.
```

Scope:

```text
c
    → local Customer

rc
    → remote Customer
```

Không được merge metadata của hai object.

---

# 10. Linked Server trong subquery

Test:

```sql
SELECT *
FROM Customer c
WHERE EXISTS (
    SELECT 1
    FROM ERP_SERVER.ERPDB.dbo.Order o
    WHERE o.CustomerId = c.Id
      AND o.
)
```

`o` phải resolve thành remote object.

`c` phải resolve từ outer scope.

---

# 11. Linked Server trong CTE

Test:

```sql
WITH RemoteCustomer AS (
    SELECT *
    FROM ERP_SERVER.ERPDB.dbo.Customer
)
SELECT *
FROM RemoteCustomer c
WHERE c.
```

Sau CTE:

```text
c
 ↓
RemoteCustomer
 ↓
CTE columns
```

Không được query Linked Server lại khi metadata của CTE đã xác định được.

---

# 12. Linked Server trong derived table

Test:

```sql
SELECT r.
FROM (
    SELECT Id, Name
    FROM ERP_SERVER.ERPDB.dbo.Customer
) r
```

`r.` chỉ được trả:

```text
Id
Name
```

Không trả toàn bộ column của remote Customer nếu SELECT bên trong chỉ expose 2 column.

---

# 13. Linked Server 4-part completion

Đây là phần quan trọng.

Khi user mới viết:

```sql
FROM ERP_SERVER.
```

IntelliSense phải có khả năng đề xuất:

```text
ERPDB
```

Nếu:

```sql
FROM ERP_SERVER.ERPDB.
```

đề xuất:

```text
dbo
sales
...
```

Nếu:

```sql
FROM ERP_SERVER.ERPDB.dbo.
```

đề xuất:

```text
Customer
Order
Product
...
```

Nếu:

```sql
FROM ERP_SERVER.ERPDB.dbo.Customer
```

thì object đã hoàn chỉnh.

---

# 14. Linked Server completion hierarchy

Phải triển khai theo tầng:

```text
Server
 ↓
Database
 ↓
Schema
 ↓
Object
 ↓
Column
```

Ví dụ:

```text
ERP_SERVER
    └── ERPDB
         └── dbo
              ├── Customer
              ├── Order
              └── Product
```

Không query tất cả object ở mọi cấp.

---

# 15. Linked Server metadata strategy

Không được thực hiện:

```text
mỗi lần gõ "."
    ↓
query linked server
```

Vì có thể gây:

```text
latency
timeout
blocking
network dependency
UI freeze
```

Phải có:

```text
Remote Metadata Cache
```

---

# 16. Remote Metadata Cache

Cache key nên bao gồm:

```text
server
database
schema
object
connection
```

Ví dụ:

```text
SQLSERVER:
ERP_SERVER
ERPDB
dbo
Customer
```

Cache:

```text
columns
data types
nullable
primary key
identity
computed
```

---

# 17. Remote Metadata Provider

Thiết kế interface:

```javascript
class MetadataProvider {

    getServers()

    getDatabases(server)

    getSchemas(server, database)

    getTables(server, database, schema)

    getViews(server, database, schema)

    getColumns(server, database, schema, object)
}
```

Không bắt buộc giữ nguyên tên method nếu codebase hiện tại có convention khác.

Quan trọng là phải tách abstraction.

---

# 18. Remote connection lifecycle

Không mở connection mới cho mỗi suggestion.

Phải có:

```text
Connection Manager
       ↓
Remote Connection Pool
       ↓
Metadata Provider
```

Có thể sử dụng connection hiện tại nếu architecture cho phép.

---

# 19. Linked Server không đồng nghĩa user có remote connection

Đây là điểm agent phải đặc biệt chú ý.

Ví dụ:

```sql
SELECT *
FROM ERP_SERVER.ERPDB.dbo.Customer
```

SQL Server hiện tại có thể truy cập Linked Server, nhưng application IntelliSense **không nhất thiết có credentials để kết nối trực tiếp tới ERP_SERVER**.

Vì vậy phải hỗ trợ hai chiến lược.

---

# 20. Strategy A – Query metadata thông qua SQL Server

Ưu tiên nếu connection hiện tại có quyền.

Ví dụ:

```text
IDE
 ↓
Current SQL Server
 ↓
Linked Server
 ↓
Remote metadata
```

Ưu điểm:

```text
Không cần user nhập lại credential remote.
```

Nhược điểm:

```text
phụ thuộc quyền Linked Server
phụ thuộc network
có thể chậm
```

---

# 21. Strategy B – Direct Remote Connection

Nếu architecture cho phép:

```text
IDE
 ↓
Remote SQL Server
```

thì metadata provider có thể sử dụng connection riêng.

Connection information phải được quản lý an toàn.

Không lưu plaintext password trong cache/log.

---

# 22. Strategy selection

Context engine không cần biết connection thực tế được thực hiện thế nào.

Nó chỉ gọi:

```javascript
metadataProvider.getColumns(remoteSource)
```

Provider tự quyết định:

```text
LinkedServerProvider
hoặc
DirectRemoteProvider
```

---

# 23. Linked Server metadata failure

Nếu remote server:

```text
offline
timeout
permission denied
```

IntelliSense không được crash.

Kết quả:

```text
remote metadata unavailable
```

UI có thể:

```text
không hiển thị remote columns
```

hoặc:

```text
hiển thị cached metadata
```

nếu cache còn hợp lệ.

---

# 24. Cached metadata fallback

Flow:

```text
Request remote metadata
        ↓
Remote available?
    ├── YES → update cache
    └── NO
          ↓
     cache exists?
       ├── YES → use cache
       └── NO → no remote completion
```

Không block editor.

---

# 25. PostgreSQL

PostgreSQL có nhiều cơ chế remote data khác nhau.

IntelliSense không nên gom tất cả thành "Linked Server".

Cần phân biệt:

```text
Foreign Server
Foreign Data Wrapper
Foreign Table
postgres_fdw
file_fdw
dblink
```

---

# 26. PostgreSQL Foreign Table

Ví dụ:

```sql
CREATE FOREIGN TABLE remote_customer (
    id integer,
    name text
)
SERVER remote_server;
```

Khi:

```sql
SELECT r.
FROM remote_customer r
```

IntelliSense phải xử lý:

```text
r
 ↓
foreign table
 ↓
columns
```

Về completion, foreign table có thể được xử lý gần giống local table.

---

# 27. PostgreSQL Foreign Server

Khi user duyệt database object:

```text
Foreign Servers
```

phải được coi là một loại object riêng:

```text
foreign_server
```

Không được hiển thị như table.

---

# 28. PostgreSQL FDW

Metadata engine nên nhận diện:

```text
Foreign Data Wrapper
Foreign Server
User Mapping
Foreign Table
```

Tuy nhiên:

```text
Foreign Data Wrapper
```

không nhất thiết là source trực tiếp cho SQL completion.

---

# 29. PostgreSQL postgres_fdw

Đối với:

```text
postgres_fdw
```

foreign table thường có metadata column ngay tại PostgreSQL local catalog.

Vì vậy IntelliSense ưu tiên:

```text
PostgreSQL local catalog
```

thay vì kết nối trực tiếp remote database.

---

# 30. PostgreSQL dblink

Đây là trường hợp khác:

```sql
SELECT *
FROM dblink(
    'connection string',
    'SELECT id, name FROM customer'
) AS t(id integer, name text);
```

IntelliSense không nên cố gắng kết nối remote chỉ để đoán metadata.

Nếu SQL có:

```text
AS t(id integer, name text)
```

thì source phải được tạo từ:

```text
derived table / function result
```

và columns:

```text
id
name
```

---

# 31. PostgreSQL LATERAL + remote source

Phải test:

```sql
SELECT c.
FROM customer c
CROSS JOIN LATERAL (...)
```

Nếu source trong LATERAL phụ thuộc outer source:

```text
LATERAL scope
    ↓
outer scope visible
```

Context resolver phải xử lý giống correlated subquery nhưng theo PostgreSQL syntax.

---

# 32. PostgreSQL schema.table

Phải hỗ trợ:

```sql
public.customer
sales.order
```

Context:

```text
schema = public
object = customer
```

Không được hiểu:

```text
public
```

là alias.

---

# 33. PostgreSQL search_path

Nếu:

```sql
SELECT *
FROM customer c
```

phải resolve theo:

```text
explicit schema
        ↓
search_path
        ↓
current schema
        ↓
metadata
```

Nếu metadata provider không xác định được object duy nhất:

```text
do not randomly select one
```

---

# 34. Remote Source abstraction

Nên tạo abstraction chung:

```javascript
ResolvedSource
```

Ví dụ local:

```javascript
{
    sourceType: "TABLE",
    server: null,
    database: "ERP",
    schema: "dbo",
    object: "Customer"
}
```

SQL Server Linked Server:

```javascript
{
    sourceType: "REMOTE_TABLE",
    server: "ERP_SERVER",
    database: "ERPDB",
    schema: "dbo",
    object: "Customer"
}
```

PostgreSQL foreign table:

```javascript
{
    sourceType: "FOREIGN_TABLE",
    server: "remote_server",
    schema: "public",
    object: "customer"
}
```

---

# 35. Không hard-code SQL Server Linked Server vào Alias Resolver

Sai:

```javascript
if (alias) {
    searchLocalTable(alias);
}
```

Đúng:

```text
alias
 ↓
Source Resolver
 ↓
ResolvedSource
 ↓
Metadata Provider
```

Alias chỉ là tên.

Source mới là object thực sự.

---

# 36. Cross-source JOIN

Bắt buộc test:

```sql
SELECT
    c.Name,
    r.OrderCount
FROM dbo.Customer c
JOIN ERP_SERVER.ERPDB.dbo.CustomerSummary r
    ON r.CustomerId = c.Id
WHERE r.
```

Context:

```text
c → local
r → remote
```

---

# 37. Cross-database JOIN

SQL Server:

```sql
SELECT c.
FROM DB_A.dbo.Customer c
JOIN DB_B.dbo.Order o
    ON o.CustomerId = c.Id
```

Phải resolve:

```text
DB_A.dbo.Customer
DB_B.dbo.Order
```

độc lập.

---

# 38. Cross-server JOIN

```sql
SELECT c.
FROM SERVER_A.DB_A.dbo.Customer c
JOIN SERVER_B.DB_B.dbo.Order o
    ON o.CustomerId = c.Id
```

Scope:

```text
c → SERVER_A.DB_A.dbo.Customer
o → SERVER_B.DB_B.dbo.Order
```

---

# 39. Remote object completion phải giữ source identity

Không được chỉ cache:

```text
Customer → columns
```

Phải cache:

```text
SERVER_A.DB_A.dbo.Customer → columns
SERVER_B.DB_B.dbo.Customer → columns
```

Nếu không sẽ xảy ra collision.

---

# 40. Cache key bắt buộc

SQL Server:

```text
connectionId
server
database
schema
object
objectType
```

PostgreSQL:

```text
connectionId
database
schema
object
objectType
```

Nếu cần:

```text
foreignServer
```

---

# 41. Remote metadata timeout

Phải có timeout riêng cho IntelliSense.

Không để:

```text
remote query
```

block:

```text
editor thread
```

Nếu timeout:

```text
return partial context
```

---

# 42. Không blocking UI

Flow:

```text
User types "."
      ↓
Context resolved immediately
      ↓
Remote metadata async
      ↓
Suggestion updated
```

Không:

```text
keypress
 ↓
wait remote SQL
 ↓
render
```

---

# 43. Remote metadata loading state

Có thể hỗ trợ:

```text
Loading remote metadata...
```

nhưng không bắt buộc UI phải thay đổi.

Quan trọng:

```text
editor remains responsive
```

---

# 44. Test Matrix SQL Server

## Local

```sql
SELECT c.
FROM dbo.Customer c
```

## 3-part

```sql
SELECT c.
FROM ERPDB.dbo.Customer c
```

## 4-part

```sql
SELECT c.
FROM ERP_SERVER.ERPDB.dbo.Customer c
```

## Mixed

```sql
SELECT c., r.
FROM dbo.Customer c
JOIN ERP_SERVER.ERPDB.dbo.Customer r
    ON r.Id = c.Id
```

---

# 45. SQL Server remote completion

Test từng cấp:

```sql
FROM ERP_SERVER.
```

Expected:

```text
databases
```

---

```sql
FROM ERP_SERVER.ERPDB.
```

Expected:

```text
schemas
```

---

```sql
FROM ERP_SERVER.ERPDB.dbo.
```

Expected:

```text
tables/views
```

---

```sql
FROM ERP_SERVER.ERPDB.dbo.Customer c
WHERE c.
```

Expected:

```text
Customer columns
```

---

# 46. PostgreSQL test matrix

## Foreign table

```sql
SELECT r.
FROM remote_customer r
```

## Schema

```sql
SELECT c.
FROM public.customer c
```

## Foreign server

Kiểm tra metadata:

```text
Foreign Servers
Foreign Tables
```

## postgres_fdw

```text
foreign table
→ local catalog metadata
```

## dblink

```text
dblink(...)
AS t(id, name)
```

→:

```text
t.id
t.name
```

---

# 47. Negative tests

SQL Server:

```sql
SELECT *
FROM ERP_SERVER.
```

khi server không tồn tại.

Phải:

```text
không crash
```

---

```sql
SELECT *
FROM ERP_SERVER.UnknownDB.dbo.Customer
```

Phải:

```text
remote metadata unavailable
```

---

PostgreSQL:

```sql
SELECT *
FROM unknown_schema.customer
```

Không được tự động chọn một schema khác.

---

# 48. Security

Không log:

```text
password
connection string
access token
secret
user credentials
```

Không đưa credential vào:

```text
Context Snapshot
Debug Log
Error Message
Telemetry
```

---

# 49. Debug Context

Khi debug:

```text
================================
REMOTE SOURCE
================================

Source Type:
REMOTE_TABLE

Server:
ERP_SERVER

Database:
ERPDB

Schema:
dbo

Object:
Customer

Alias:
c

Metadata:
AVAILABLE

Columns:
Id
Name
Code
...
================================
```

Nếu PostgreSQL:

```text
Source Type:
FOREIGN_TABLE

Foreign Server:
remote_server

Schema:
public

Object:
customer
```

---

# 50. Error classification

Không gom tất cả thành:

```text
Metadata Error
```

Phải phân loại:

```text
REMOTE_SERVER_NOT_FOUND
REMOTE_CONNECTION_FAILED
REMOTE_TIMEOUT
REMOTE_PERMISSION_DENIED
REMOTE_DATABASE_NOT_FOUND
REMOTE_SCHEMA_NOT_FOUND
REMOTE_OBJECT_NOT_FOUND
METADATA_QUERY_FAILED
METADATA_CACHE_AVAILABLE
```

---

# 51. Implementation phases

## Phase 1 – Audit

Agent tìm:

```text
[ ] Identifier parser
[ ] Alias resolver
[ ] Metadata provider
[ ] SQL Server dialect
[ ] PostgreSQL dialect
[ ] Metadata cache
[ ] Completion provider
```

Không sửa code.

---

## Phase 2 – 4-part identifier

Implement:

```text
[ ] server.database.schema.object
[ ] quoted identifiers
[ ] alias
[ ] source resolution
```

---

## Phase 3 – Remote metadata

Implement:

```text
[ ] RemoteMetadataProvider
[ ] cache
[ ] timeout
[ ] async loading
[ ] error handling
```

---

## Phase 4 – Completion hierarchy

Implement:

```text
server
 ↓
database
 ↓
schema
 ↓
object
 ↓
column
```

---

## Phase 5 – Cross-source scope

Implement:

```text
[ ] local + remote
[ ] remote + remote
[ ] cross-database
[ ] cross-server
[ ] subquery
[ ] CTE
[ ] derived table
```

---

## Phase 6 – PostgreSQL

Implement:

```text
[ ] foreign table
[ ] foreign server metadata
[ ] postgres_fdw
[ ] search_path
[ ] schema.table
[ ] dblink result alias
[ ] LATERAL
```

---

## Phase 7 – Performance

Benchmark:

```text
[ ] local metadata
[ ] remote metadata
[ ] cache hit
[ ] cache miss
[ ] remote timeout
[ ] large SQL
```

---

# 52. Definition of Done

SQL Server:

```text
[ ] 2-part name
[ ] 3-part name
[ ] 4-part name
[ ] Linked Server
[ ] local + remote JOIN
[ ] remote + remote JOIN
[ ] remote subquery
[ ] remote CTE
[ ] remote derived table
[ ] remote alias
[ ] remote column completion
[ ] server/database/schema/object completion
```

PostgreSQL:

```text
[ ] schema.table
[ ] search_path
[ ] foreign table
[ ] foreign server
[ ] postgres_fdw
[ ] dblink
[ ] LATERAL
[ ] foreign table column completion
```

Infrastructure:

```text
[ ] metadata cache
[ ] async metadata loading
[ ] timeout
[ ] failure fallback
[ ] security
[ ] regression tests
```

---

# 53. Quy tắc quan trọng cho Agent

Không được:

```text
1. Coi Linked Server là table bình thường.

2. Coi 4-part identifier là alias.column.

3. Query remote metadata ở mỗi lần gõ ".".

4. Block UI để chờ remote server.

5. Ghi credentials vào log.

6. Merge metadata của hai remote server chỉ vì object cùng tên.

7. Hard-code Linked Server logic vào UI.

8. Dùng SQL Server assumptions cho PostgreSQL.

9. Coi PostgreSQL FDW hoàn toàn giống SQL Server Linked Server.

10. Nếu remote metadata không lấy được thì crash IntelliSense.
```

---

# 54. Kiến trúc cuối cùng

```text
                    IntelliSense
                         │
                         ▼
                  Context Engine
                         │
                         ▼
                 Identifier Resolver
                         │
                         ▼
                   Source Resolver
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
       Local Source          Remote Source
              │                     │
              │             ┌───────┴────────┐
              │             │                │
              ▼             ▼                ▼
       Local Metadata   SQL Server       PostgreSQL
                         Linked Server       FDW
                              │                │
                              ▼                ▼
                       Remote Metadata   Foreign Metadata
                              │                │
                              └───────┬────────┘
                                      ▼
                              Metadata Cache
                                      │
                                      ▼
                             Candidate Provider
                                      │
                                      ▼
                              Candidate Filter
                                      │
                                      ▼
                                IntelliSense
```

---

# 55. Kết quả mong muốn

SQL Server:

```sql
SELECT
    c.Name,
    r.
FROM dbo.Customer c
JOIN ERP_SERVER.ERPDB.dbo.Customer r
    ON r.Id = c.Id
WHERE r.
```

Engine phải hiểu:

```text
c
→ LOCAL
→ dbo.Customer

r
→ REMOTE
→ ERP_SERVER.ERPDB.dbo.Customer
```

Và:

```text
r.
```

chỉ đề xuất:

```text
columns của ERP_SERVER.ERPDB.dbo.Customer
```

---

PostgreSQL:

```sql
SELECT
    c.name,
    r.
FROM public.customer c
JOIN remote_customer r
    ON r.customer_id = c.id
WHERE r.
```

Engine phải hiểu:

```text
c
→ public.customer

r
→ foreign_table remote_customer
```

và:

```text
r.
```

chỉ đề xuất column của foreign table.

---

# 56. Nguyên tắc cuối cùng

Remote IntelliSense không phải là một tính năng "search database từ xa".

Nó phải được coi là:

```text
SQL Context
      +
Source Resolution
      +
Remote Metadata Resolution
```

Trong đó:

```text
Context quyết định cần gì.
Source Resolver quyết định object nào.
Metadata Provider quyết định lấy metadata ở đâu.
Cache quyết định có cần truy vấn hay không.
Candidate Engine quyết định hiển thị gì.
```

Không đảo ngược thứ tự này.
