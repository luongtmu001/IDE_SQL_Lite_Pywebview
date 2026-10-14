# 31. Giới hạn của PostgreSQL Dependency Catalog

## 31.1. Không được coi `pg_depend` là "toàn bộ dependency"

PostgreSQL cung cấp hệ thống Dependency Catalog, trong đó các catalog quan trọng gồm:

```text
pg_depend
pg_rewrite
pg_class
pg_attribute
pg_proc
pg_trigger
pg_constraint
pg_namespace
```

Tuy nhiên:

> `pg_depend` không phải là một dependency index đầy đủ cho mọi reference xuất hiện trong source code của PostgreSQL Object.

Nói cách khác:

```text
pg_depend
    ≠
"Everything that references this column"
```

Nó phản ánh các dependency mà PostgreSQL ghi nhận trong hệ thống catalog / dependency mechanism, nhưng không thể đảm bảo phát hiện mọi dependency mang tính động hoặc nằm trong source code.

---

# 32. Những Dependency Catalog làm tốt

Catalog Dependency đặc biệt hữu ích với các dependency có cấu trúc mà PostgreSQL có thể phân tích khi Object được tạo.

Ví dụ:

```sql
CREATE VIEW public.v_customer AS
SELECT customer_id
FROM public.b30_customer;
```

PostgreSQL có thể lưu dependency giữa View và các object liên quan.

Tương tự có thể áp dụng tốt cho nhiều trường hợp:

```text
Table
Column
View
Materialized View
Rule
Constraint
Index
Trigger
Sequence
Function / Procedure trong các trường hợp PostgreSQL ghi nhận dependency
```

Do đó Catalog Dependency là **nguồn dữ liệu nền tảng** cho Dependency Explorer.

---

# 33. Những trường hợp Catalog có thể không phát hiện đầy đủ

## 33.1. Dynamic SQL

Ví dụ:

```sql
CREATE OR REPLACE FUNCTION public.fn_test()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    EXECUTE 'SELECT customer_id FROM public.b30_customer';
END;
$$;
```

Trong trường hợp này:

```text
customer_id
```

nằm trong một string.

PostgreSQL không nhất thiết tạo một dependency catalog trực tiếp từ:

```text
b30_customer.customer_id
```

đến:

```text
fn_test
```

IDE có thể không thấy dependency này thông qua `pg_depend`.

---

# 34. Dynamic SQL sử dụng biến

Ví dụ:

```sql
EXECUTE
    'SELECT ' || column_name ||
    ' FROM public.b30_customer';
```

Tên column thậm chí không tồn tại dưới dạng literal cố định.

Ví dụ:

```text
column_name = 'customer_id'
```

có thể chỉ được xác định lúc runtime.

Catalog Dependency không thể đảm bảo phát hiện trường hợp này.

Đây là một **runtime dependency**.

---

# 35. Dependency thông qua chuỗi

Ví dụ:

```sql
SELECT format(
    'SELECT customer_id FROM %I',
    table_name
);
```

hoặc:

```sql
EXECUTE format(
    'SELECT %I FROM public.b30_customer',
    p_column
);
```

Catalog không thể biết chắc:

```text
p_column = customer_id
```

ở mọi execution path.

Do đó IDE không được coi đây là:

```text
Confirmed Dependency
```

mà có thể đánh dấu:

```text
Possible Dependency
```

nếu source-code analyzer phát hiện dấu hiệu liên quan.

---

# 36. Function / Procedure là trường hợp cần đặc biệt thận trọng

Function và Procedure có source code.

Ví dụ:

```sql
CREATE FUNCTION fn_customer()
RETURNS void
AS $$
BEGIN
    SELECT customer_id
    FROM b30_customer;
END;
$$ LANGUAGE plpgsql;
```

Không nên thiết kế hệ thống với giả định đơn giản:

```text
pg_proc
    ↓
customer_id dependency
```

lúc nào cũng tồn tại.

Phải phân biệt:

```text
A. Catalog dependency
B. Source-code reference
C. Runtime / dynamic dependency
```

---

# 37. Source-code dependency

IDE có thể bổ sung một lớp phân tích source code.

Ví dụ lấy Definition:

```sql
SELECT pg_get_functiondef(...);
```

Sau đó phân tích:

```text
FROM public.b30_customer
customer_id
```

Kết quả:

```text
Catalog:
    No confirmed dependency

Source:
    Possible reference detected
```

UI nên hiển thị:

```text
⚠ Possible Dependency

Detected in function source code.

This dependency is based on source-code analysis and
may not represent an actual runtime dependency.
```

Không nên đánh đồng nó với dependency từ `pg_depend`.

---

# 38. SQL Parser cần được xem là lớp bổ sung

Kiến trúc nên là:

```text
                    ┌─────────────────────┐
                    │ PostgreSQL Catalog  │
                    │     Dependency      │
                    └──────────┬──────────┘
                               │
                               │
                    Confirmed Dependency
                               │
                               ▼
┌───────────────┐      ┌─────────────────────┐
│ Object Script │ ───► │ Source Code Analyzer│
└───────────────┘      └──────────┬──────────┘
                                  │
                                  │
                           Possible Reference
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Dependency Explorer │
                       └─────────────────────┘
```

Hai nguồn thông tin phải được giữ riêng.

---

# 39. Không dùng text search đơn giản làm Dependency Engine

Không nên làm:

```text
Search "customer_id"
```

trong toàn bộ database rồi kết luận:

```text
customer_id is used by X objects
```

Vì có thể xảy ra:

### False Positive

```sql
-- customer_id is only mentioned in a comment
-- customer_id example
```

hoặc:

```sql
RAISE NOTICE 'customer_id';
```

hoặc:

```sql
v_column_name := 'customer_id';
```

Không có nghĩa Object thực sự query Column đó.

---

# 40. False Negative

Ngược lại, search text cũng có thể bỏ sót:

```sql
EXECUTE format(
    'SELECT %I FROM public.b30_customer',
    p_column
);
```

Nếu:

```text
p_column = customer_id
```

thì dependency tồn tại ở runtime nhưng source code không chứa trực tiếp:

```text
customer_id
```

---

# 41. Dependency Confidence

Để UI phản ánh đúng mức độ chắc chắn, nên có field:

```text
dependency_confidence
```

Ví dụ:

```text
CONFIRMED
LIKELY
POSSIBLE
UNKNOWN
```

### CONFIRMED

Được PostgreSQL catalog xác định.

```text
Source:
    pg_depend
```

### LIKELY

Source-code parser phát hiện reference có cấu trúc rõ ràng.

### POSSIBLE

Text / heuristic analysis phát hiện dấu hiệu nhưng không đủ để khẳng định.

### UNKNOWN

Không đủ thông tin để xác định.

---

# 42. Dependency Source

Mỗi dependency nên lưu nguồn phát hiện:

```json
{
  "object": "public.fn_get_customer",
  "dependency": "public.b30_customer.customer_id",
  "source": "CATALOG",
  "confidence": "CONFIRMED"
}
```

Hoặc:

```json
{
  "object": "public.fn_dynamic_query",
  "dependency": "public.b30_customer.customer_id",
  "source": "SOURCE_ANALYSIS",
  "confidence": "POSSIBLE"
}
```

UI có thể hiển thị:

```text
✓ Confirmed
  PostgreSQL Catalog

⚠ Possible
  Source Code Analysis
```

---

# 43. Một giới hạn quan trọng khác: SQL ngoài Database

Dependency Catalog chỉ biết những Object nằm trong Database hiện tại.

Ví dụ:

```text
Database A
    ↓
Application
    ↓
Database B
```

hoặc:

```text
Database
    ↓
ETL
    ↓
Python
    ↓
External API
```

PostgreSQL Dependency Catalog không thể biết đầy đủ các dependency bên ngoài Database.

Ví dụ application có:

```sql
SELECT customer_id
FROM b30_customer;
```

thì PostgreSQL catalog không thể nói:

```text
Application X uses customer_id
```

trừ khi IDE có thêm integration với source code của application.

---

# 44. Cross-Database / External Dependency

Cần coi các trường hợp sau là ngoài phạm vi Catalog Dependency:

```text
Application code
Python
Java
C#
Node.js
ETL
BI Tool
Reporting Tool
External Database
FDW
External API
```

Một số trường hợp PostgreSQL có thể biết một phần thông tin thông qua Foreign Data Wrapper hoặc object definition, nhưng không nên tuyên bố rằng Dependency Explorer đã bao phủ toàn bộ external ecosystem.

---

# 45. Temporary Object

Temporary Object cũng cần được xem xét riêng.

Ví dụ:

```sql
CREATE TEMP TABLE tmp_customer AS
SELECT ...
```

Object này có lifecycle theo session.

Dependency Explorer có thể:

```text
Ignore
```

hoặc:

```text
Show only current session temporary objects
```

Không nên coi temporary objects là dependency lâu dài của schema.

---

# 46. Dynamic Object Name

Ví dụ:

```sql
EXECUTE 'SELECT * FROM ' || p_table_name;
```

Database Object được xác định runtime.

Catalog không thể biết chắc:

```text
p_table_name = b30_customer
```

trong mọi trường hợp.

UI nên hiển thị:

```text
⚠ Runtime dependency cannot be fully determined.
```

---

# 47. Search Path

PostgreSQL cho phép:

```sql
SELECT *
FROM customer;
```

thay vì:

```sql
SELECT *
FROM public.customer;
```

Kết quả có thể phụ thuộc vào:

```sql
search_path
```

Do đó source-code analysis không nên chỉ dựa trên tên:

```text
customer
```

mà phải cố gắng resolve:

```text
schema + object
```

khi context cho phép.

Nếu không resolve được:

```text
public.customer
```

thì đánh dấu:

```text
Unresolved Reference
```

thay vì tự đoán.

---

# 48. Synonym không phải mô hình chính của PostgreSQL

Không nên xây Dependency Engine theo tư duy:

```text
SQL Server
    synonym
    object dependency
```

PostgreSQL có cơ chế object resolution và search path khác.

Vì vậy abstraction layer của IDE nên được thiết kế riêng cho PostgreSQL thay vì bê nguyên Dependency Model của SQL Server sang.

---

# 49. `SELECT *` là trường hợp cần chú ý

Ví dụ:

```sql
CREATE VIEW v_customer AS
SELECT *
FROM b30_customer;
```

Dependency của View với Table có thể tồn tại, nhưng việc xác định chính xác:

```text
View sử dụng Column nào?
```

cần được xử lý cẩn thận.

Đặc biệt khi Schema thay đổi:

```text
ADD COLUMN
DROP COLUMN
ALTER COLUMN
```

IDE không nên đơn giản coi:

```text
SELECT *
```

là danh sách column tĩnh trong source code.

Có thể cần kết hợp:

```text
View definition
+
PostgreSQL catalog metadata
+
View output columns
```

---

# 50. Column Rename

Column rename cũng là một ví dụ cho thấy không nên chỉ dựa vào text search.

Ví dụ:

```sql
ALTER TABLE customer
RENAME COLUMN customer_id TO id;
```

Nếu PostgreSQL đã lưu dependency bằng object identity/catalog metadata, dependency có thể vẫn tồn tại dù source definition hiển thị tên mới.

Do đó:

```text
Catalog dependency
```

có giá trị hơn:

```text
String matching
```

đối với các dependency mà PostgreSQL đã quản lý.

---

# 51. Dependency theo Object Identity

Khi có thể, Dependency Engine nên dựa vào:

```text
OID
Object ID
Attribute Number
Dependency Record
```

thay vì chỉ:

```text
schema + object_name + column_name
```

Ví dụ:

```text
pg_class.oid
pg_attribute.attnum
pg_proc.oid
pg_namespace.oid
```

Sau đó mới resolve thành tên để hiển thị cho user.

Điều này giúp tránh nhầm lẫn khi:

- Rename object.
- Rename column.
- Object name trùng giữa schema.
- Object được recreate.

---

# 52. Định nghĩa "Find All Dependencies"

Trong sản phẩm cần tránh wording tuyệt đối như:

```text
Find All Dependencies
```

nếu tính năng chỉ sử dụng Catalog.

Nên dùng:

```text
Find Dependencies
```

và trong UI có disclaimer:

```text
Dependency information is based on PostgreSQL catalog
and source-code analysis where available.

Dynamic SQL and external application dependencies
may not be detected.
```

Hoặc ngắn hơn:

```text
Some runtime or external dependencies may not be detected.
```

---

# 53. Kiến trúc Dependency Engine cuối cùng

Nên thiết kế:

```text
                     Column
                        │
                        ▼
              ┌───────────────────┐
              │ Catalog Analyzer  │
              └─────────┬─────────┘
                        │
                 Confirmed
                        │
                        ▼
              ┌───────────────────┐
              │ Dependency Model  │
              └─────────┬─────────┘
                        ▲
                        │
                 Possible
                        │
              ┌─────────┴─────────┐
              │ Source Analyzer   │
              └─────────┬─────────┘
                        │
                        ▼
                 Object Definition
```

Kết quả cuối:

```text
Dependency
    ├── Confirmed
    │     └── PostgreSQL Catalog
    │
    ├── Likely
    │     └── Source Analysis
    │
    ├── Possible
    │     └── Heuristic / Text Analysis
    │
    └── Unknown
          └── Dynamic / Runtime
```

---

# 54. Quy tắc sản phẩm

Dependency Explorer phải tuân thủ 4 nguyên tắc:

### 1. Không overclaim

Không nói:

> "Column này không có dependency."

Nếu chỉ kiểm tra Catalog.

Nên nói:

> "No catalog dependencies were found."

---

### 2. Phân biệt certainty

Luôn phân biệt:

```text
Confirmed
Possible
Unknown
```

---

### 3. Catalog là nguồn chính

Ưu tiên:

```text
PostgreSQL Catalog
```

Source analysis chỉ là lớp bổ sung.

---

### 4. Runtime dependency không thể đảm bảo

Phải thừa nhận giới hạn:

```text
Dynamic SQL
Runtime-generated object names
External applications
External databases
ETL / BI tools
```

không thể được Dependency Catalog bao phủ đầy đủ.

---

# 55. Acceptance Criteria

Tính năng được coi là đạt yêu cầu khi:

- [ ] Có thể tìm dependency của một Column.
- [ ] Dependency lấy từ PostgreSQL catalog.
- [ ] Không nhầm `pg_depend` với toàn bộ dependency.
- [ ] Phân biệt Direct / Indirect.
- [ ] Phân biệt Catalog / Source Analysis.
- [ ] Có Confidence level.
- [ ] Có Object Definition.
- [ ] Có cảnh báo Dynamic SQL.
- [ ] Có cảnh báo External Dependency limitation.
- [ ] Không tuyên bố "no dependency" khi chỉ kiểm tra catalog.
- [ ] Không tự động execute DDL.
- [ ] Không tự động `DROP ... CASCADE`.
- [ ] Suggested SQL được đánh dấu rõ là suggestion.
- [ ] Có thể mở source của object để user tự review.

---

# 56. Thông điệp UX đề xuất

Khi không tìm thấy dependency:

```text
No catalog dependencies found.

This does not guarantee that the column is not used
by dynamic SQL, application code, external tools,
or other runtime dependencies.
```

Khi tìm thấy:

```text
8 catalog dependencies found.

Additional runtime or external dependencies may not
be visible to PostgreSQL's dependency catalog.
```

Khi phát hiện source reference:

```text
Possible dependency detected in object definition.

This reference was identified through source-code analysis
and is not confirmed by PostgreSQL dependency metadata.
```

---

# 57. Kết luận

Dependency Catalog nên được xem là:

> **Nguồn dữ liệu đáng tin cậy nhất cho các dependency mà PostgreSQL quản lý ở cấp database object, nhưng không phải là danh sách toàn bộ nơi một Column có thể được sử dụng.**

Kiến trúc đúng nên là:

```text
PostgreSQL Catalog
        +
Object Definition
        +
Source Analysis
        +
Clear Confidence Level
        ↓
Dependency Explorer
        ↓
Impact Analysis
        ↓
Suggested Resolution
```

Điều này giúp tính năng vừa mạnh vừa trung thực với giới hạn kỹ thuật của PostgreSQL, tránh tạo cho user cảm giác sai rằng:

```text
"No dependency found"
=
"No one uses this column"
```

Hai khái niệm này phải được coi là **hoàn toàn khác nhau**.