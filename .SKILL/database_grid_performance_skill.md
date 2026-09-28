# Skill: Database IDE Grid Performance Audit & Optimization

## 1. Mục tiêu

Skill này dùng để rà soát, đo lường và cải thiện hiệu năng của Data Grid trong Database IDE.

Phạm vi chính:

- SQL execution
- Database fetch
- Backend data preparation
- JSON serialization / deserialization
- IPC / network transport
- JavaScript data processing
- Grid initialization
- DOM rendering
- Virtual scrolling
- Filtering
- Searching
- Sorting
- Copy/Paste
- Selection
- Data editing
- Memory usage
- Large dataset handling

Mục tiêu cuối cùng:

> Làm cho Data Grid có cảm giác nhanh và ổn định khi xử lý từ vài nghìn đến hàng trăm nghìn hoặc hàng triệu records, theo kiến trúc tương tự các Database IDE như DataGrip/Navicat.

Không được mặc định rằng SQL chậm hoặc Grid chậm. Phải đo từng tầng trước khi thay đổi kiến trúc.

Dữ liệu test tạm thời:
Server: Localhost,1433
Database: Bravo10Setup_Data
Table: B20Class

---

# 2. Nguyên tắc bắt buộc

## 2.1. Không tối ưu bằng cảm giác

Không được kết luận:

- SQL chậm
- HTML table chậm
- JSON chậm
- Python chậm
- JavaScript chậm
- Grid chậm

chỉ dựa trên cảm giác của người dùng.

Phải tạo benchmark và đo thời gian từng giai đoạn.

---

## 2.2. Không thay framework khi chưa xác định bottleneck

Nếu project đang sử dụng HTML `<table>` thì không được tự ý chuyển sang AG Grid, Glide Data Grid hoặc framework khác chỉ vì dataset lớn.

Phải kiểm tra:

1. SQL execution
2. Fetch
3. Serialization
4. Transport
5. JavaScript processing
6. Grid initialization
7. Rendering
8. Filtering/search/sort

Chỉ đề xuất thay renderer/framework khi renderer hiện tại thực sự là bottleneck sau khi benchmark.

---

## 2.3. Không phá chức năng hiện tại

Mọi tối ưu phải giữ nguyên:

- Cell selection
- Row selection
- Multi-selection
- Keyboard navigation
- Copy/Paste
- Context menu
- Column resize
- Column filter
- Search
- Aggregate
- Edit cell
- NULL display
- Number/Boolean formatting
- Row number
- Active cell
- Dirty state
- Insert/Delete nếu đã có
- Transaction behavior nếu đã có

Nếu thay đổi behavior, phải ghi rõ lý do.

---

# 3. Kiến trúc hiệu năng cần kiểm tra

Phân tích pipeline theo thứ tự:

```text
User Execute
    |
    v
SQL Executor
    |
    v
Database Execution
    |
    v
Fetch Rows
    |
    v
Backend Data Preparation
    |
    v
Serialization
    |
    v
IPC / Network Transport
    |
    v
JavaScript Receive
    |
    v
JSON Parse / Data Conversion
    |
    v
Grid Data Model
    |
    v
Grid Initialization
    |
    v
Virtual Renderer
    |
    v
DOM Update
    |
    v
Browser Layout / Paint
```

Không được gộp tất cả thành một metric `total execution time`.

---

# 4. Performance instrumentation

## 4.1. Bắt buộc có các mốc thời gian

Tối thiểu phải đo:

```text
T0 = trước khi execute SQL
T1 = database execute hoàn tất
T2 = fetch hoàn tất
T3 = serialization hoàn tất
T4 = frontend nhận dữ liệu
T5 = data model hoàn tất
T6 = grid initialization bắt đầu
T7 = first render hoàn tất
```

Từ đó tạo:

```text
SQL Execute
DB Fetch
Serialize
Transfer
JS Processing
Grid Init
Grid Render
Total
```

Ví dụ:

```text
[Performance]
SQL Execute :   82 ms
DB Fetch    :  145 ms
Serialize   :   31 ms
Transfer    :   18 ms
JS Process  :   24 ms
Grid Init   :   11 ms
Grid Render :    8 ms
----------------------
Total       :  319 ms
```

---

## 4.2. Không sử dụng một timer duy nhất

Không được làm:

```javascript
const start = performance.now();

await executeSQL();
renderGrid();

console.log(performance.now() - start);
```

rồi kết luận toàn bộ thời gian là SQL.

Phải chia nhỏ từng phase.

---

# 5. Benchmark dataset

Phải kiểm tra tối thiểu các mức:

```text
100 rows
1,000 rows
5,000 rows
10,000 rows
50,000 rows
100,000 rows
500,000 rows
1,000,000 rows
```

Nếu database không thể tạo dữ liệu thật thì sử dụng dataset benchmark tương đương.

Kiểm tra thêm số lượng columns:

```text
5 columns
20 columns
50 columns
100 columns
```

Benchmark theo ma trận:

```text
Rows × Columns
```

Ví dụ:

```text
10,000 × 20
10,000 × 100
100,000 × 20
100,000 × 100
```

---

# 6. Grid Renderer

## 6.1. Kiểm tra virtualization

Nếu renderer đã có virtualization, phải xác nhận:

- Không tạo DOM node cho toàn bộ rows.
- Chỉ render viewport + buffer.
- Row pool được tái sử dụng.
- Scroll không tạo thêm row vô hạn.
- Không append/remove hàng nghìn DOM nodes liên tục.

Ví dụ kiến trúc mong muốn:

```text
100,000 logical rows
        |
        v
Virtual Renderer
        |
        v
~30-100 DOM rows
```

Không được biến thành:

```text
100,000 logical rows
        |
        v
100,000 <tr>
```

---

## 6.2. Row pool

Nếu sử dụng row pool:

- Tái sử dụng `<tr>`.
- Không tạo row mới mỗi lần scroll nếu row pool đã đủ.
- Không bind event listener riêng cho từng row/cell.
- Không tạo closure mới không cần thiết cho từng cell.

Ưu tiên event delegation:

```text
table
 |
 +-- mousedown
 +-- mouseover
 +-- keydown
 +-- contextmenu
```

thay vì:

```text
cell 1 -> listener
cell 2 -> listener
cell 3 -> listener
...
```

---

# 7. DOM performance

Kiểm tra các vấn đề:

- `innerHTML` quá thường xuyên.
- `appendChild` từng node gây nhiều layout.
- Đọc layout sau khi vừa ghi layout.
- `offsetHeight`, `offsetWidth`, `clientHeight`, `getBoundingClientRect()` bị gọi trong loop lớn.
- Thay đổi `style` từng cell.
- Thay đổi class từng cell.
- Trigger reflow/repaint nhiều lần.

Đặc biệt tìm pattern:

```javascript
write DOM
read offsetHeight
write DOM
read offsetWidth
```

trong cùng một loop.

Nếu cần tạo nhiều DOM node mới, ưu tiên:

```javascript
DocumentFragment
```

hoặc batch update.

---

# 8. `updateRowCells()` / Cell Rendering

Nếu grid sử dụng hàm tương đương:

```javascript
updateRowCells(tr, rowIndex)
```

phải kiểm tra:

- Bao nhiêu cells được update mỗi frame.
- Có ghi lại `dataset` không cần thiết không.
- Có reset className liên tục không.
- Có `JSON.stringify()` cho object mỗi lần render không.
- Có tính selection state lại cho từng cell không.
- Có xử lý formatting lặp lại cho cùng một value không.

Không được tối ưu bằng cách bỏ behavior selection/editing nếu các tính năng đó đang được sử dụng.

---

# 9. Data Model

Renderer không được là nơi duy nhất lưu trạng thái dữ liệu.

Nên tách:

```text
Grid Controller
    |
    +-- Data Model
    +-- Selection Manager
    +-- Edit Manager
    +-- Filter Manager
    +-- Search Manager
    +-- Clipboard Manager
    +-- Renderer
```

Data Model quản lý:

```text
columns
rows/cache
dirty cells
inserted rows
deleted rows
selection state
filter state
sort state
```

Renderer chỉ chịu trách nhiệm hiển thị.

---

# 10. Server-side Data Loading

Đây là mục tiêu quan trọng đối với dataset lớn.

Không nên:

```text
SELECT 1,000,000 rows
        |
        v
Python
        |
        v
JSON 1,000,000 rows
        |
        v
JavaScript
```

Thay vào đó:

```text
Database
   |
   v
Data Provider
   |
   v
Page / Chunk
   |
   v
Frontend Cache
   |
   v
Virtual Renderer
```

Ví dụ:

```text
Initial:
rows 0-200

Scroll:
rows 200-400

Scroll:
rows 400-600
```

Không được fetch toàn bộ dataset chỉ để virtualization có thể hoạt động.

---

# 11. Pagination

Phải đánh giá strategy:

### OFFSET/FETCH

Phù hợp khi:

- Dataset vừa phải.
- Query đơn giản.
- Cần nhảy tới page cụ thể.

Ví dụ:

```sql
ORDER BY Id
OFFSET @offset ROWS
FETCH NEXT @limit ROWS ONLY
```

### Keyset/Cursor Pagination

Ưu tiên nghiên cứu khi:

- Dataset rất lớn.
- Có khóa/index phù hợp.
- User chủ yếu scroll tuần tự.

Ví dụ:

```sql
WHERE Id > @lastId
ORDER BY Id
FETCH NEXT @limit ROWS ONLY
```

Không được thay OFFSET bằng keyset một cách máy móc nếu query có nhiều kiểu `ORDER BY`.

---

# 12. Server-side Filtering

Nếu dataset lớn, filter không nên luôn chạy trên toàn bộ `this.rows[]`.

Không nên:

```javascript
rows.filter(...)
```

trên hàng triệu records nếu dữ liệu chưa được giới hạn.

Nên:

```text
User filter
    |
    v
Backend
    |
    v
SQL WHERE
    |
    v
Database
    |
    v
Only matching rows
```

Ví dụ:

```sql
WHERE Code LIKE @keyword
```

Phải kiểm tra SQL injection bằng parameterized query.

Không được nối chuỗi input trực tiếp vào SQL.

---

# 13. Server-side Sorting

Không nên luôn:

```javascript
rows.sort(...)
```

trên dataset lớn.

Khi phù hợp:

```text
User click column
       |
       v
Backend
       |
       v
ORDER BY
       |
       v
Database
```

Phải whitelist tên column trước khi đưa vào `ORDER BY`.

Không đưa raw user input trực tiếp vào SQL identifier.

---

# 14. Column Filter / Distinct Values

Đặc biệt kiểm tra các code tương đương:

```javascript
rows.forEach(...)
```

để tạo danh sách distinct values.

Nếu có:

```text
1,000,000 rows
```

mỗi lần mở filter mà scan toàn bộ dataset sẽ gây lag.

Phải cân nhắc:

- Server-side distinct query.
- Giới hạn số distinct values hiển thị.
- Search value server-side.
- Cache kết quả filter.
- Lazy loading danh sách values.

Không render hàng nghìn checkbox cùng lúc.

---

# 15. Search trong Grid

Kiểm tra search có scan toàn bộ data mỗi lần gõ hay không.

Không nên:

```text
keydown
   |
   v
scan 1,000,000 rows
```

ở mỗi ký tự.

Ưu tiên:

```text
debounce 150-300ms
```

và với dataset lớn:

```text
server-side search
```

Nếu search chỉ trên dữ liệu đã cache, phải cache kết quả hoặc tránh lặp lại phép xử lý không cần thiết.

---

# 16. Copy / Paste

Kiểm tra:

- Copy hàng trăm nghìn cells có tạo string khổng lồ không.
- Có block UI không.
- Có xử lý từng cell bằng DOM không.
- Có đọc dữ liệu từ DOM thay vì Data Model không.

Ưu tiên:

```text
Data Model
    |
    v
Clipboard serialization
```

không phải:

```text
DOM
    |
    v
querySelectorAll()
    |
    v
đọc từng cell
```

---

# 17. Selection

Selection phải hoạt động dựa trên state:

```text
anchorCell
leadCell
selection range
```

Không nên tìm lại toàn bộ DOM để xác định selection.

Đối với selection lớn:

```text
100,000 selected rows
```

không nên tạo 100,000 object hoặc listener riêng nếu không cần.

---

# 18. Memory

Phải đo:

- JS heap.
- Số lượng rows đang giữ.
- Kích thước JSON.
- Số lượng DOM nodes.
- Cache size.

Đặc biệt phân biệt:

```text
Virtual DOM
```

với:

```text
Virtual Data
```

Có virtualization DOM nhưng vẫn giữ:

```text
1,000,000 rows
```

trong:

```javascript
this.rows
```

thì memory vẫn có thể rất lớn.

---

# 19. JSON / Transport Optimization

Kiểm tra payload.

Không ưu tiên format:

```json
[
  {
    "Id": 1,
    "Code": "A001",
    "Name": "ABC"
  }
]
```

nếu tên column lặp lại hàng triệu lần.

Có thể dùng schema + array:

```json
{
  "columns": ["Id", "Code", "Name"],
  "rows": [
    [1, "A001", "ABC"],
    [2, "A002", "XYZ"]
  ]
}
```

Chỉ áp dụng nếu backend/frontend hiện tại có thể xử lý an toàn.

Không tối ưu serialization trước khi đo payload thực tế.

---

# 20. Database Performance

Nếu metric cho thấy SQL thực sự chậm, lúc đó mới phân tích:

- Execution Plan
- Index
- JOIN
- WHERE
- ORDER BY
- GROUP BY
- Subquery
- APPLY
- Function trong predicate
- Implicit conversion
- SELECT *
- Statistics
- Locking
- Blocking
- Network latency

Không được tối ưu frontend để giải quyết vấn đề nằm trong database.

---

# 21. Performance Budget

Thiết lập benchmark mục tiêu.

Ví dụ tham khảo:

```text
Small result:
< 100 ms cảm giác tức thời

Medium result:
< 300 ms

Large result:
Không block UI

Scroll:
Không dropped frame nghiêm trọng

Cell edit:
< 16-50 ms phản hồi UI

Filter:
Không block main thread lâu

Open Data Editor:
Render viewport trước
load phần còn lại sau
```

Các con số trên là target để benchmark, không phải quy định tuyệt đối. Phải đo trên môi trường thực tế.

---

# 22. Quy trình Agent phải thực hiện

## Phase 1 — Audit

1. Đọc toàn bộ code liên quan.
2. Xác định flow Execute SQL → Grid.
3. Xác định renderer.
4. Xác định data model.
5. Xác định backend endpoint.
6. Xác định transport.
7. Tìm tất cả loop xử lý rows.
8. Tìm tất cả thao tác DOM trong loop.
9. Tìm tất cả `JSON.stringify`, `JSON.parse`.
10. Tìm tất cả filter/sort/search scan toàn dataset.

Không sửa code trong phase này.

---

## Phase 2 — Instrumentation

Thêm performance markers:

```text
SQL_EXECUTE
DB_FETCH
SERIALIZE
TRANSFER
JS_PARSE
DATA_PREPARE
GRID_INIT
GRID_RENDER
FILTER
SEARCH
SORT
```

Sử dụng:

```javascript
performance.mark()
performance.measure()
```

hoặc timestamp tương đương ở backend.

Không dùng console spam trong production path.

---

## Phase 3 — Benchmark

Test:

```text
100
1K
5K
10K
50K
100K
500K
1M
```

với:

```text
5 columns
20 columns
50 columns
100 columns
```

Ghi kết quả trước khi tối ưu.

---

## Phase 4 — Identify Bottleneck

Phân loại:

```text
A. Database bottleneck
B. Fetch bottleneck
C. Serialization bottleneck
D. Transport bottleneck
E. JavaScript processing bottleneck
F. Memory bottleneck
G. DOM/render bottleneck
```

Chỉ tối ưu bottleneck đã được chứng minh.

---

## Phase 5 — Optimize

Ưu tiên theo thứ tự:

```text
1. Loại bỏ công việc thừa
2. Giảm lượng dữ liệu truyền
3. Server-side paging/filter/sort
4. Cache
5. Virtualization
6. Batch DOM update
7. Giảm object allocation
8. Tối ưu serialization
9. Tối ưu database query/index
10. Chỉ sau cùng mới cân nhắc đổi framework
```

---

# 23. Regression Test

Sau mỗi thay đổi phải kiểm tra:

### Functional

- Selection
- Multi-selection
- Keyboard
- Copy/Paste
- Filter
- Search
- Sort
- Edit
- NULL
- Number
- Boolean
- Context menu
- Resize

### Performance

So sánh:

```text
Before
After
Improvement %
```

Ví dụ:

```text
100K rows

Before:
Grid render = 850 ms

After:
Grid render = 210 ms

Improvement = 75.3%
```

Không được tuyên bố "đã tối ưu" nếu chưa có số liệu Before/After.

---

# 24. Quy tắc quan trọng đối với code hiện tại

Nếu project đã có `VirtualGridRenderer`:

- Không tạo lại virtualization thứ hai.
- Không render toàn bộ rows vào DOM.
- Không bỏ row pool nếu chưa có benchmark chứng minh cần thay.
- Không chuyển framework grid chỉ vì dataset lớn.
- Tập trung kiểm tra Data Loading và Data Model.
- Kiểm tra các thao tác scan `this.rows`.
- Kiểm tra filter distinct.
- Kiểm tra search.
- Kiểm tra aggregate.
- Kiểm tra serialization.
- Kiểm tra memory.

Nếu project đang có event delegation:

- Giữ event delegation.
- Không chuyển sang listener cho từng cell.

Nếu project đang dùng `requestAnimationFrame` cho scroll:

- Giữ cơ chế scheduling.
- Chỉ thay đổi nếu benchmark cho thấy cần thiết.

---

# 25. Output bắt buộc của Agent

Sau khi audit phải tạo báo cáo:

```text
# Performance Audit

## 1. Current Architecture

## 2. Measured Performance

| Phase | Time |
|---|---:|
| SQL Execute | |
| DB Fetch | |
| Serialization | |
| Transfer | |
| JS Processing | |
| Grid Init | |
| Grid Render | |
| Total | |

## 3. Bottlenecks

### Critical
...

### High
...

### Medium
...

### Low
...

## 4. Root Cause

...

## 5. Recommended Changes

...

## 6. Before / After

...

## 7. Regression Test

...

## 8. Remaining Risks

...
```

Không được chỉ ghi:

```text
"Grid đã nhanh hơn"
```

mà phải có số liệu.

---

# 26. Mục tiêu kiến trúc cuối

Kiến trúc mong muốn:

```text
                       DATABASE
                           |
                    SQL Execution
                           |
                           v
                    Data Provider
                           |
             +-------------+-------------+
             |                           |
          Metadata                  Data Request
                                         |
                                   Paging / Filter
                                   Sorting / Search
                                         |
                                         v
                                  Backend Response
                                         |
                                         v
                                   Data Cache
                                         |
                                  +------+------+
                                  |             |
                              Data Model     Metadata
                                  |
                                  v
                           Virtual Renderer
                                  |
                                  v
                              HTML Table
                                  |
                                  v
                           Visible DOM only
```

Nguyên tắc:

> Database chịu trách nhiệm xử lý dữ liệu lớn. Backend chịu trách nhiệm cung cấp đúng phần dữ liệu cần thiết. Data Model chịu trách nhiệm trạng thái. Renderer chỉ render viewport.

---

# 27. Kết luận

Không coi "Execute SQL" và "Render Grid" là một operation.

Phải phân biệt:

```text
SQL nhanh
≠
IDE nhanh
```

và:

```text
Grid render nhanh
≠
Data pipeline nhanh
```

Một Database IDE tốt phải tối ưu toàn bộ pipeline:

```text
Database
→ Backend
→ Transport
→ Data Model
→ Renderer
→ DOM
```

Mọi quyết định tối ưu phải dựa trên benchmark thực tế và phải giữ nguyên các chức năng Data Editor đang có.
