# Skill: Khắc phục hiệu năng Result Grid cho Python PyWebView IDE

## 1. Mục tiêu

Khắc phục tình trạng Result Grid bị lag/giật khi:

- Query trả về khoảng 1.000 dòng trở lên.
- Chuyển đổi giữa các SQL editor có result lớn.
- Resize Result panel.
- Resize column.
- Select nhiều cell / drag selection.
- Filter/copy/edit dữ liệu trong grid lớn.

### Mục tiêu UX

- 100–500 dòng: phải mượt.
- 1.000–10.000 dòng: UI vẫn phải thao tác mượt, không tạo hàng nghìn DOM row cùng lúc.
- Grid lớn phải ưu tiên viewport rendering/virtual rendering.
- Scroll không được tạo lại toàn bộ table.
- Resize không được rebuild grid.
- Chuyển tab không được execute/render lại result nếu dữ liệu đã tồn tại.
- Giữ nguyên các nghiệp vụ hiện tại: sticky header, sticky STT, column resize, selection, filter, context menu, copy/edit nếu đang có.

## 2. Phạm vi

Project hiện tại:

- Python backend.
- PyWebView.
- WebView2/Chromium.
- Vanilla JavaScript.
- Bootstrap + CSS.
- Không sử dụng grid library.
- Result table được tự xây dựng bằng `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`.

Luồng hiện tại:

```text
F5
  ↓
/api/query/execute
  ↓
renderGrid(data, ms) trong query.js
  ↓
GridResultManager.attach(table, resSet, index)
  ↓
DOM Result Grid
```

File chính cần rà soát:

```text
static/js/query.js
static/js/grid-result.js
static/css/editor.css
```

Không thay framework.

Không thêm AG Grid, Handsontable, DataTables, Tabulator, SlickGrid, TanStack Table hoặc grid library khác.

---

# 3. Phân tích hiện trạng đã xác định

Trong `renderGrid()` hiện tại, data rows được tạo theo dạng:

```javascript
resSet.rows.forEach((row, idx) => {
    const tr = document.createElement('tr');

    const rnTd = document.createElement('td');
    ...
    tr.appendChild(rnTd);

    row.forEach(val => {
        const td = document.createElement('td');
        ...
        tr.appendChild(td);
    });

    tbody.appendChild(tr);
});
```

Điều này tạo toàn bộ DOM cho toàn bộ result.

Ví dụ:

```text
1.000 rows × 20 columns
≈ 20.000 td
+ 1.000 tr
+ row-number cells
+ header nodes
+ filter buttons
+ resizer nodes
+ selection state/event handling
```

Đây là bottleneck cần ưu tiên kiểm tra.

Ngoài ra:

```javascript
tableWrap.innerHTML = '';
```

đang xóa toàn bộ result DOM trước khi dựng lại.

Agent phải xác định tất cả nơi gọi `renderGrid()` và xem có trường hợp tab switch/resize khiến grid bị render lại không cần thiết hay không.

---

# 4. Quy tắc quan trọng trước khi sửa

## 4.1 Không rewrite toàn bộ Grid

Không được viết lại toàn bộ Result Grid nếu không cần.

Ưu tiên:

```text
giữ API hiện tại
giữ HTML contract hiện tại
giữ GridResultManager API
thay implementation bên trong
```

Ví dụ vẫn giữ:

```javascript
renderGrid(data, ms)
```

và:

```javascript
GridResultManager.attach(table, resSet, index)
```

Chỉ thay cơ chế render row.

## 4.2 Không thay đổi nghiệp vụ

Không được làm mất hoặc thay đổi:

- selection
- multi-cell selection
- BoundingBox
- filter
- context menu
- copy
- paste nếu đang có
- edit cell nếu đang có
- column resize
- sticky header
- sticky row number
- multi-result sets
- saved column widths
- footer row count
- execution time
- theme
- tab state

Nếu một thay đổi có khả năng ảnh hưởng nghiệp vụ, phải kiểm tra code hiện tại trước khi sửa.

## 4.3 Không tối ưu bằng cách giảm dữ liệu một cách âm thầm

Không được tự ý:

```text
SELECT TOP 100
```

hoặc cắt:

```javascript
rows.slice(0, 100)
```

chỉ để làm UI nhanh.

Người dùng phải vẫn có khả năng truy cập toàn bộ result.

Phase đầu tiên ưu tiên frontend virtualization.

---

# 5. Bắt buộc đọc toàn bộ code trước khi sửa

Agent phải đọc:

```text
static/js/query.js
static/js/grid-result.js
static/css/editor.css
```

và tìm:

```text
renderGrid
GridResultManager
attach
selection
BoundingBox
pointerdown
pointermove
pointerup
scroll
resize
contextmenu
filter
copy
paste
edit
column
row
tbody
innerHTML
appendChild
getBoundingClientRect
offsetWidth
offsetHeight
clientHeight
```

Đặc biệt phải xác định:

1. `GridResultManager.attach()` có scan toàn bộ DOM hay không.
2. Có event listener cho từng cell hay không.
3. Selection có duyệt toàn bộ cell hay không.
4. Filter có rebuild toàn bộ table hay không.
5. Edit cell có rebuild row/table hay không.
6. Resize có làm layout/re-render không.
7. Scroll có logic hiện tại nào cần giữ không.
8. Multi-result sets có phụ thuộc vào row DOM hay không.

Không được suy đoán khi code thực tế có thể kiểm tra được.

---

# 6. Giải pháp chính: Virtual Row Rendering

## 6.1 Mục tiêu

Thay vì:

```text
100.000 rows
→ 100.000 <tr>
```

sử dụng:

```text
100.000 rows
→ khoảng 40–100 <tr> thực tế
```

Số row DOM phụ thuộc viewport.

Ví dụ:

```text
rowHeight = 28px
viewportHeight = 600px
visibleRows ≈ 22
buffer = 10

DOM rows ≈ 42
```

Scrollbar vẫn phải thể hiện tổng chiều cao của toàn bộ dataset.

## 6.2 Không tạo lại DOM row khi scroll

Không được:

```javascript
tbody.innerHTML = '';
```

mỗi lần scroll.

Không được tạo mới hàng nghìn `<tr>`.

Nên sử dụng row pool:

```text
RowPool
 ├── tr #1
 ├── tr #2
 ├── ...
 └── tr #N
```

Khi scroll, tái sử dụng các `<tr>`.

## 6.3 Công thức cơ bản

Với row height cố định:

```javascript
startIndex = Math.floor(scrollTop / rowHeight);
visibleCount = Math.ceil(viewportHeight / rowHeight);
endIndex = Math.min(
    totalRows,
    startIndex + visibleCount + buffer
);
```

Có thể thêm buffer phía trên/dưới để scroll nhanh không bị trắng.

---

# 7. Cấu trúc Virtual Grid đề xuất

Ưu tiên giữ `<table>` hiện tại để giảm thay đổi CSS.

Một phương án:

```text
table
├── thead
└── tbody
    ├── top spacer
    ├── visible row pool
    └── bottom spacer
```

Hoặc nếu cấu trúc table khiến spacer `<tr>` ảnh hưởng selection/column layout, agent có thể dùng:

```text
scroll container
├── virtual-height wrapper
└── table viewport
```

nhưng phải đảm bảo:

- sticky header vẫn hoạt động.
- column widths vẫn đồng bộ.
- row-number column vẫn đồng bộ.
- horizontal scrolling vẫn hoạt động.

Agent phải chọn giải pháp ít phá CSS hiện tại nhất.

---

# 8. Row height

Ưu tiên row height cố định.

Ví dụ:

```css
.ide-results-table tbody tr {
    height: 28px;
}
```

Không nên cho row tự động tăng chiều cao theo text trong chế độ virtual grid nếu chưa có cơ chế đo dynamic row height.

Text dài nên:

- ellipsis/truncate trong cell;
- double click mở editor/popup;
- hoặc dùng cell editor hiện có.

Không được hy sinh dữ liệu.

---

# 9. Render cell

Ưu tiên:

```javascript
td.textContent = value;
```

Không dùng `innerHTML` nếu không cần.

Đặc biệt không tạo thêm nhiều nested DOM node cho mỗi cell.

NULL có thể giữ UI hiện tại nếu nghiệp vụ yêu cầu:

```html
<span class="ide-null-value">NULL</span>
```

nhưng agent phải cân nhắc giảm nested DOM trong các cell thường.

JSON/JSONB/Array vẫn phải được format như hiện tại.

---

# 10. Batch DOM update

Nếu vẫn có những trường hợp cần render nhiều row, không append trực tiếp từng row:

Không ưu tiên:

```javascript
tbody.appendChild(tr);
```

trong loop lớn.

Dùng:

```javascript
const fragment = document.createDocumentFragment();

for (...) {
    fragment.appendChild(tr);
}

tbody.appendChild(fragment);
```

Tuy nhiên:

> DocumentFragment chỉ là tối ưu bổ trợ. Nó không thay thế virtualization.

Không được coi DocumentFragment là giải pháp chính cho 1.000+ rows.

---

# 11. Scroll handling

Không xử lý render trực tiếp với mọi scroll event nếu có thể tránh.

Ưu tiên:

```javascript
let scheduled = false;

scrollContainer.addEventListener('scroll', () => {
    latestScrollTop = scrollContainer.scrollTop;

    if (scheduled) return;

    scheduled = true;

    requestAnimationFrame(() => {
        scheduled = false;
        renderVisibleRows(latestScrollTop);
    });
});
```

Không render lại nếu `startIndex` chưa thay đổi.

Ví dụ:

```text
scroll 0 → 1px → 2px → 3px
```

không nhất thiết phải rebuild row.

---

# 12. Column resize

Code hiện tại có logic:

```javascript
pointermove
    ↓
th.style.width = newW + 'px'
```

Agent phải kiểm tra layout cost.

Không đọc layout sau khi vừa ghi style trong cùng vòng lặp nếu không cần:

```text
write
→ read
→ write
→ read
```

vì có thể gây forced synchronous layout.

Nên dùng:

```javascript
requestAnimationFrame()
```

để giới hạn cập nhật UI.

Ví dụ:

```javascript
let pendingResize = false;
let latestWidth = startW;

const onMove = e => {
    latestWidth = Math.max(
        minW,
        startW + (e.clientX - startX)
    );

    if (pendingResize) return;

    pendingResize = true;

    requestAnimationFrame(() => {
        pendingResize = false;
        th.style.width = `${latestWidth}px`;
    });
};
```

Không thay đổi hành vi lưu:

```javascript
savedWidths[colKey]
```

---

# 13. Result panel resize

Đây là yêu cầu bắt buộc:

Resize Result panel KHÔNG được:

```text
resize
→ renderGrid()
→ recreate table
→ GridResultManager.attach()
```

Phải:

```text
resize
→ update layout
→ giữ nguyên DOM
```

Nếu virtual grid cần biết viewport height mới:

```text
resize
→ requestAnimationFrame
→ calculate visible row count
→ update row pool
```

Không rebuild toàn bộ result.

Có thể dùng `ResizeObserver` cho container nếu phù hợp.

---

# 14. Tab switching

Agent phải tìm tất cả nơi gọi:

```text
renderGrid()
clearResults()
GridResultManager.attach()
```

khi tab switch.

Mục tiêu:

```text
Tab A
 ↓
render result A một lần

Tab B
 ↓
render result B một lần

Tab A
 ↓
show result A
```

Không:

```text
Tab A
 ↓
destroy A

Tab B
 ↓
destroy B

Tab A
 ↓
fetch/render A lại
```

Nếu kiến trúc hiện tại đã có state/cache cho tab, phải tận dụng.

Không tạo cache mới nếu state hiện tại đã đủ.

---

# 15. GridResultManager

Đây là phần phải kiểm tra kỹ nhất.

## Không được

```text
attach()
 ↓
querySelectorAll('tr')
 ↓
querySelectorAll('td')
 ↓
add listener cho từng cell
```

nếu có thể thay bằng event delegation.

Ưu tiên:

```text
table
└── one pointer/click/contextmenu handler
```

Sau đó xác định cell bằng:

```javascript
event.target.closest('td')
```

Điều này đặc biệt quan trọng khi row virtualization được áp dụng.

## Selection

Selection engine phải làm việc với logical row index:

```text
logicalRowIndex
columnIndex
```

không phụ thuộc việc row đó có tồn tại trong DOM hay không.

Ví dụ:

```javascript
{
    minRow,
    maxRow,
    minCol,
    maxCol
}
```

vẫn phải được giữ.

---

# 16. Selection performance

Không được mỗi lần selection thay đổi lại:

```text
remove class khỏi toàn bộ grid
→ add class cho toàn bộ selection
```

Phải chỉ cập nhật:

```text
DOM rows đang visible
```

và tính selection dựa trên logical coordinates.

Ví dụ:

```text
selection:
row 10 → 10000

DOM:
row 200 → 240
```

chỉ những row đang visible cần được render trạng thái selection.

Khi scroll đến row 5000, row pool mới phải tự tính:

```text
5000 có nằm trong BoundingBox không?
```

---

# 17. Event delegation

Nếu hiện tại mỗi cell có:

```javascript
td.addEventListener(...)
```

phải đánh giá và ưu tiên chuyển sang delegation.

Ưu tiên:

```text
table.addEventListener('click', ...)
table.addEventListener('pointerdown', ...)
table.addEventListener('contextmenu', ...)
```

và:

```javascript
const cell = event.target.closest('td');
```

Điều này giúp giảm số listener khi grid lớn.

---

# 18. Filter

Filter không được làm:

```text
filter
→ rebuild 100.000 DOM rows
```

Nếu filter hiện tại là client-side:

```text
allRows
 ↓
filteredRows
 ↓
VirtualRenderer
```

chỉ render viewport.

Nếu filter được đưa xuống backend trong tương lai thì càng tốt, nhưng không bắt buộc trong phase đầu.

Phải giữ filter summary và nút clear filter hiện tại.

---

# 19. Copy

Copy nhiều cell phải lấy dữ liệu từ logical dataset:

```text
resSet.rows
```

không phụ thuộc toàn bộ cell DOM.

Không được:

```text
querySelectorAll('td')
→ đọc toàn bộ DOM
```

để copy một vùng lớn.

Selection BoundingBox đã có thì dùng nó:

```text
minRow
maxRow
minCol
maxCol
```

---

# 20. Edit cell

Nếu grid có edit:

Không được rebuild toàn bộ table sau khi sửa một cell.

Ưu tiên:

```text
edit cell
 ↓
update logical data
 ↓
update đúng DOM cell
```

Nếu save backend thành công:

```text
data[row][col] = newValue
```

Nếu thất bại:

```text
restore oldValue
```

Không gọi:

```javascript
renderGrid(...)
```

chỉ để cập nhật một cell.

---

# 21. Multi-result sets

`renderGrid()` hiện tại hỗ trợ:

```text
resultsList
  ├── result set 0
  ├── result set 1
  └── result set N
```

Không được phá tính năng này.

Mỗi result set phải có:

```text
own VirtualRenderer
own scroll state
own selection state
own filter state nếu hiện tại có
```

Splitter giữa các result set vẫn phải hoạt động.

Resize splitter không được rebuild result.

---

# 22. Không thay đổi API backend trong Phase 1

Phase 1 giữ:

```text
/api/query/execute
```

và result object hiện tại.

Không thay:

```text
rows
columns
row_count
```

trừ khi thật sự cần.

Virtualization phải làm việc trên:

```javascript
resSet.rows
```

trước.

---

# 23. Phase 2: dataset cực lớn

Chỉ thực hiện nếu Phase 1 vẫn gặp vấn đề với dataset rất lớn.

Khi đó có thể thiết kế:

```text
execute
 ↓
resultId
 ↓
fetch chunk
 ↓
Virtual Grid
```

hoặc:

```text
/api/query/execute
/api/query/fetch
```

Mỗi chunk:

```text
500–2000 rows
```

tùy benchmark.

Không mặc định dùng:

```sql
OFFSET 500000
```

cho dataset lớn nếu DB có thể dùng keyset pagination hoặc cursor/server-side result session.

Đây là phase riêng vì thay đổi backend nhiều hơn.

---

# 24. Cache

Không cache vô hạn các result lớn.

Agent phải cân nhắc:

```text
result data size
number of open tabs
memory usage
```

Không giữ toàn bộ hàng triệu row của mọi tab mãi mãi.

Có thể dùng:

```text
active tab
→ giữ full result

inactive tab
→ giữ state hoặc chunk
```

nhưng phải phù hợp với kiến trúc hiện tại.

Không tự ý thêm LRU phức tạp nếu chưa cần.

---

# 25. Performance instrumentation

Trước khi sửa, agent phải đo.

Dùng:

```javascript
performance.mark()
performance.measure()
```

hoặc:

```javascript
console.time()
console.timeEnd()
```

để tách:

```text
API/network
JSON parsing
render header
render rows
GridResultManager.attach
layout
```

Ví dụ:

```text
execute API:      120 ms
JSON parse:        20 ms
create DOM:       800 ms
attach grid:      500 ms
```

Nếu kết quả giống vậy thì không tối ưu database trước.

---

# 26. Benchmark bắt buộc

Test ít nhất:

```text
100 rows
500 rows
1,000 rows
5,000 rows
10,000 rows
```

với:

```text
5 columns
10 columns
20 columns
30+ columns nếu có
```

Test các thao tác:

1. Execute query.
2. Scroll nhanh từ đầu đến cuối.
3. Chuyển tab.
4. Resize Result panel.
5. Resize column.
6. Select một cell.
7. Drag select range.
8. Copy.
9. Filter.
10. Edit cell nếu có.
11. Multi-result set.

---

# 27. Acceptance criteria

## Rendering

Không được tạo toàn bộ `<tr>` cho dataset lớn.

Ví dụ:

```text
10.000 rows
```

DOM row count phải gần với:

```text
visible rows + buffer
```

không phải:

```text
10.000
```

## Scroll

Scroll không được:

- trắng lâu;
- giật mạnh;
- rebuild toàn table;
- tăng DOM count liên tục.

## Resize

Resize Result panel phải giữ được grid.

Column resize phải không gây freeze UI.

## Selection

Selection vẫn phải chính xác.

BoundingBox không được thay đổi behavior.

## Filter

Filter vẫn hoạt động như trước.

## Tab

Tab switching không được query/render lại nếu result đã có state.

## Data

Không được mất row.

Không được âm thầm cắt result.

---

# 28. Những cách KHÔNG được sử dụng

Không giải quyết bằng:

```text
setTimeout() để "cho UI nghỉ"
```

Không dùng:

```text
sleep
```

Không thêm loading animation để che lag.

Không cắt:

```text
rows.slice(0, 100)
```

để giả lập performance.

Không disable selection/filter/edit.

Không đổi sang grid library chỉ để tránh sửa code.

Không chuyển toàn bộ grid sang Canvas nếu chưa có lý do rõ ràng, vì sẽ làm việc với selection/edit/copy/accessibility phức tạp hơn.

Không tối ưu database khi bottleneck đã được xác định là DOM/layout.

---

# 29. Thứ tự triển khai bắt buộc

Agent thực hiện theo thứ tự:

```text
STEP 1
Đọc query.js
Đọc grid-result.js
Đọc CSS liên quan

STEP 2
Trace toàn bộ lifecycle:
execute → renderGrid → attach → interaction

STEP 3
Đo performance baseline

STEP 4
Tách row rendering thành renderer riêng

STEP 5
Implement virtual row rendering

STEP 6
Giữ GridResultManager tương thích với logical row index

STEP 7
Tối ưu selection

STEP 8
Tối ưu column resize bằng requestAnimationFrame

STEP 9
Đảm bảo Result panel resize không rebuild

STEP 10
Kiểm tra tab caching/state

STEP 11
Benchmark lại

STEP 12
Chỉ nếu cần mới đề xuất backend chunk/pagination
```

---

# 30. Kiến trúc code mục tiêu

Không bắt buộc đúng tên class, nhưng nên đạt separation:

```text
renderGrid()
    │
    ├── createGridHeader()
    │
    ├── createGridContainer()
    │
    ├── VirtualGridRenderer
    │       ├── renderViewport()
    │       ├── updateVisibleRows()
    │       ├── recycleRows()
    │       └── refreshRow()
    │
    └── GridResultManager
            ├── selection
            ├── filter
            ├── context menu
            ├── copy
            └── edit
```

`VirtualGridRenderer` chịu trách nhiệm:

```text
logical data → visible DOM
```

`GridResultManager` chịu trách nhiệm:

```text
user interaction → logical grid state
```

Không trộn hai trách nhiệm nếu không cần.

---

# 31. Yêu cầu cuối cùng đối với Agent

Sau khi sửa phải báo cáo:

```text
1. Bottleneck tìm được là gì?
2. File nào đã sửa?
3. Những hàm nào đã thay đổi?
4. Có thay đổi API backend không?
5. Có thay đổi data contract không?
6. DOM row count trước/sau?
7. Performance trước/sau với 100 / 1.000 / 5.000 rows?
8. Selection có thay đổi behavior không?
9. Filter có thay đổi behavior không?
10. Có regression nào chưa xử lý?
```

Nếu không thể benchmark trực tiếp, phải nói rõ lý do.

Không được tuyên bố "đã tối ưu" chỉ dựa trên việc code nhìn hợp lý.

---

# 32. Nguyên tắc cuối

Ưu tiên:

```text
Ít thay đổi code
        ↓
Giữ nguyên API
        ↓
Giữ nguyên nghiệp vụ
        ↓
Giảm DOM
        ↓
Virtual rendering
        ↓
Giảm layout/reflow
        ↓
Giảm event listeners
        ↓
Đo lại
```

Không tối ưu theo cảm tính.

Luôn xác định bottleneck bằng profiling/measurement trước khi thay đổi kiến trúc lớn.
