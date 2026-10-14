# Feature — Tab Overflow & Show All Tabs

## 1. Mục tiêu

Khi số lượng tab editor quá nhiều và không còn đủ chiều rộng để hiển thị toàn bộ tab trên thanh tab, IDE không được làm mất khả năng truy cập các tab bị khuất.

Thay vào đó:

```text
Tab 1 | Tab 2 | Tab 3 | Tab 4 | ... 
```

Hiển thị nút:

```text
...
```

Nút `...` dùng để mở danh sách toàn bộ tab hiện đang tồn tại.

---

# 2. Tab Overflow Indicator

Khi tổng chiều rộng các tab vượt quá chiều rộng khả dụng của Tab Bar:

```text
Tab Bar width < Total Tab Width
```

IDE phải chuyển sang trạng thái overflow.

Ví dụ:

```text
┌─────────────────────────────────────────────────────┐
│ Query 1 | Query 2 | Procedure | Function | ...      │
└─────────────────────────────────────────────────────┘
```

### Yêu cầu

* Hiển thị nút `...` ở vị trí phù hợp trên Tab Bar.
* Không làm mất các tab đang tồn tại.
* Không tạo thêm tab.
* Không thay đổi thứ tự tab.
* Không thay đổi connection/database context của tab.

Nếu đủ diện tích để hiển thị tất cả tab thì không cần hiển thị `...`.

---

# 3. Click `...` → Tab List

Khi user click:

```text
...
```

hiển thị danh sách **tất cả tab hiện đang tồn tại**.

Ví dụ:

```text
┌───────────────────────────────┐
│ Query.sql                     │
│ Customer.sql                  │
│ Procedure_GetData.sql         │
│ Function_Calculate.sql        │
│ View_Customer.sql             │
│ XML Layout.xml                │
│ ...                           │
│ ────────────────────────────  │
│ Show All Tabs                 │
└───────────────────────────────┘
```

---

# 4. Tab State trong Tab List

Danh sách phải thể hiện rõ trạng thái của tab.

## Tab đang được hiển thị trên Tab Bar

Tên tab phải được **in đậm (bold)**.

Ví dụ:

```text
Query.sql
Customer.sql
Procedure_GetData.sql
Function_Calculate.sql
```

Trong đó:

```text
Query.sql              normal
Customer.sql           bold
Procedure_GetData.sql  normal
Function_Calculate.sql bold
```

Trong đó `bold` nghĩa là tab hiện đang nằm trong vùng Tab Bar đang hiển thị.

### Không nhầm với Active Tab

Không sử dụng `activeTab` để xác định trạng thái này.

Cần phân biệt:

```text
Active Tab
    = tab editor hiện đang được user focus

Visible Tab
    = tab đang hiển thị trên Tab Bar

Overflow Tab
    = tab đang tồn tại nhưng bị ẩn do thiếu diện tích
```

Ví dụ:

```text
Tab A | Tab B | Tab C | ... 
        ↑
    Active Tab
```

Tab A/B/C là Visible Tabs.

Các tab còn lại là Overflow Tabs.

Trong popup:

```text
Tab A       bold
Tab B       bold
Tab C       bold
Tab D       normal
Tab E       normal
Tab F       normal
```

---

# 5. Click vào Tab trong danh sách

Khi user click một tab:

```text
Tab List
   ↓
Select Tab
```

IDE phải:

1. Activate tab được chọn.
2. Đưa editor của tab đó lên foreground.
3. Nếu tab đang nằm trong overflow:

   * Có thể tự động điều chỉnh Tab Bar để tab đó trở thành visible.
4. Giữ nguyên:

   * Connection ID.
   * Database.
   * Schema.
   * Editor state.
   * Cursor.
   * Selection.
   * Scroll position.

---

# 6. Show All Tabs

Trong Tab List bổ sung tùy chọn:

```text
Show All Tabs
```

Mục đích: chuyển Tab Bar sang chế độ hiển thị toàn bộ tab.

Ví dụ:

```text
Query 1 | Query 2 | Query 3 | Query 4 | Query 5
Query 6 | Query 7 | Query 8 | Query 9 | Query 10
```

Thay vì:

```text
Query 1 | Query 2 | Query 3 | Query 4 | ...
```

---

# 7. Multi-line Tab Bar

Khi `Show All Tabs` được bật:

Tab Bar được phép mở rộng theo chiều dọc.

Nếu một dòng không đủ diện tích:

```text
┌──────────────────────────────────────────────┐
│ Tab 1 | Tab 2 | Tab 3 | Tab 4 | Tab 5       │
│ Tab 6 | Tab 7 | Tab 8 | Tab 9 | Tab 10      │
│ Tab 11| Tab 12| Tab 13| Tab 14| Tab 15      │
└──────────────────────────────────────────────┘
```

Các tab tiếp tục được đưa xuống dòng tiếp theo.

### Nguyên tắc

```text
Horizontal space insufficient
        ↓
Wrap to next line
```

Không:

```text
Shrink tab text quá mức
```

Không:

```text
Hide tab
```

Không:

```text
Create horizontal scrollbar
```

trừ khi kiến trúc hiện tại thực sự yêu cầu.

---

# 8. Show All Tabs State

Cần lưu trạng thái:

```text
tabDisplayMode
```

Ví dụ:

```text
overflow
all
```

### Mode `overflow`

```text
Tab Bar
├── Hiển thị các tab vừa đủ
└── Hiển thị ... nếu bị overflow
```

### Mode `all`

```text
Tab Bar
├── Hiển thị toàn bộ tab
├── Cho phép nhiều dòng
└── Không ẩn tab vì thiếu chiều rộng
```

---

# 9. Resize Window

Phải xử lý khi user resize cửa sổ IDE.

Ví dụ:

```text
Window rộng
    ↓
Tất cả tab hiển thị
```

Sau đó:

```text
Window thu nhỏ
    ↓
Không đủ width
    ↓
Overflow
    ↓
Hiển thị ...
```

Ngược lại:

```text
Window mở rộng
    ↓
Đủ width
    ↓
Tab có thể hiển thị lại
```

Không được mất trạng thái hoặc thứ tự tab khi resize.

---

# 10. Pin Tab Compatibility

Tính năng này phải tương thích với `Pin Tab`.

Thứ tự ưu tiên:

```text
Pinned Tabs
        ↓
Normal Tabs
        ↓
Overflow
```

Ví dụ:

```text
[Pin A] [Pin B] [Query 1] [Query 2] ... 
```

Khi overflow:

```text
[Pin A] [Pin B] [Query 1] [...]
```

Các tab bị overflow vẫn phải xuất hiện trong danh sách `...`.

---

# 11. Reorder Compatibility

Khi user drag & drop để thay đổi thứ tự tab:

* Cập nhật tab order.
* Cập nhật danh sách overflow.
* Cập nhật trạng thái visible/overflow.
* Không thay đổi tab context.

Sau khi reorder phải tính toán lại:

```text
Visible Tabs
Overflow Tabs
```

---

# 12. Acceptance Criteria

* [x] Khi tab không bị overflow → không hiển thị `...`.
* [x] Khi tab bị overflow → hiển thị `...`.
* [x] Click `...` → hiển thị toàn bộ tab.
* [x] Tab đang visible được hiển thị bold trong danh sách.
* [x] Tab đang overflow được hiển thị normal.
* [x] Phân biệt rõ Active / Visible / Overflow.
* [x] Click tab trong danh sách → activate tab.
* [x] Tab overflow được chọn → tự động đưa tab vào vùng visible.
* [x] Có tùy chọn `Show All Tabs`.
* [x] `Show All Tabs` hiển thị toàn bộ tab.
* [x] Khi hết chiều rộng → tab tự động xuống dòng.
* [x] Resize window → layout tự tính toán lại.
* [x] Không mất tab.
* [x] Không thay đổi thứ tự tab ngoài thao tác của user.
* [x] Tương thích với Pin Tab.
* [x] Tương thích với Tab Reorder.
* [x] Không làm mất connection/database/schema context.
* [x] Không làm mất editor state.

# 13. Implementation Note

Không hard-code số lượng tab để xác định overflow.

Không sử dụng:

```javascript
if (tabs.length > 10) {
    showOverflow();
}
```

Phải xác định dựa trên **actual rendered width**:

```text
Available Tab Bar Width
        vs
Total Required Tab Width
```

Có thể sử dụng:

* ResizeObserver.
* DOM measurement.
* Layout calculation hiện tại của Tab Manager.

Mỗi khi thay đổi:

```text
Add Tab
Close Tab
Reorder Tab
Pin/Unpin
Resize Window
Font Size Change
Tab Title Change
```

phải trigger lại quá trình:

```text
calculateTabLayout()
        ↓
calculateVisibleTabs()
        ↓
calculateOverflowTabs()
        ↓
renderTabBar()
```

Mục tiêu là đảm bảo Tab Manager có một **single source of truth** cho trạng thái:

```text
All Tabs
Visible Tabs
Overflow Tabs
Pinned Tabs
Active Tab
Display Mode
```

Không tạo nhiều state độc lập có thể dẫn đến việc danh sách `...` và Tab Bar hiển thị không đồng bộ.
