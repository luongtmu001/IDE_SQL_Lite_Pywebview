# Skill: Global IDE UI Font & Font Size

## 1. Mục tiêu

Xây dựng chức năng cho phép người dùng thay đổi:

- Font chữ của toàn bộ giao diện IDE.
- Cỡ chữ của toàn bộ giao diện IDE.
- Thay đổi phải được áp dụng ngay lập tức, không cần restart IDE.
- Các thành phần giao diện phải tự điều chỉnh kích thước tương ứng để không bị:
  - Cắt mất nội dung.
  - Tràn nội dung.
  - Chồng lấn.
  - Lệch icon/text.
  - Vỡ layout.
  - Mất khả năng thao tác.

### Phạm vi

Chức năng này CHỈ áp dụng cho UI của IDE.

Bao gồm:

- Sidebar.
- Object Explorer.
- Toolbar.
- Menu.
- Context menu.
- Tab.
- Status bar.
- Action bar.
- Button.
- Input.
- Select.
- Checkbox.
- Radio.
- Label.
- Tooltip.
- Modal/Dialog.
- Tree view.
- Data grid UI nếu đang sử dụng font UI.
- Các component giao diện khác của IDE.

### Không áp dụng

KHÔNG thay đổi font/cỡ chữ của:

- SQL Editor.
- Monaco Editor.
- XML Editor.
- Code Editor.
- Terminal.
- Các vùng editor chuyên dụng.
- Code/monospace rendering riêng của từng module.

Các khu vực trên phải tiếp tục sử dụng cấu hình font riêng.

---

# 2. Nguyên tắc thiết kế

## 2.1. Tách UI Font khỏi Editor Font

Không sử dụng một biến font-size chung cho toàn bộ ứng dụng.

Phải phân biệt:

```text
IDE UI Typography
        │
        ├── UI Font Family
        └── UI Font Size

Editor Typography
        │
        ├── SQL Editor
        ├── XML Editor
        └── Other Editors
```

Thay đổi UI Font không được làm thay đổi Monaco hoặc các editor.

---

# 3. Cấu hình người dùng

Tạo cấu hình tương đương: (file lưu: D:\Luong\NB_Personal\Python\IDE-SQL-Lite_New_Pyweb\data\settings.json)

```json
{
    "appearance": {
        "uiFontFamily": "Inter",
        "uiFontSize": 14
    }
}
```

Có thể mở rộng sau:

```json
{
    "appearance": {
        "uiFontFamily": "Inter",
        "uiFontSize": 14,
        "uiFontWeight": 400
    }
}
```

Ở giai đoạn này chỉ bắt buộc:

```text
Font Family
Font Size
```

Không tự ý thêm các option khác nếu project hiện tại chưa có nhu cầu.

---

# 4. Font Family

## 4.1. Font phải được chọn từ danh sách hợp lệ

Không hard-code font vào từng component.

Ví dụ:

```text
Inter
Segoe UI
Arial
Roboto
System UI
JetBrains Mono
```

Danh sách thực tế phải dựa trên font đang được project hỗ trợ và font có sẵn trên máy

Nếu project có font assets riêng, phải sử dụng font từ assets theo cấu trúc hiện tại của project.

Không copy font trực tiếp vào từng CSS/component.

---

# 5. CSS Architecture

Không sửa từng component bằng cách thay:

```css
font-family: Inter;
font-size: 14px;
```

Phải tạo CSS variables cho typography của IDE.

Ví dụ:

```css
:root {
    --ide-ui-font-family: "Inter", sans-serif;
    --ide-ui-font-size: 14px;
}
```

Các component UI phải sử dụng:

```css
font-family: var(--ide-ui-font-family);
font-size: var(--ide-ui-font-size);
```

hoặc scale tương đối dựa trên biến typography chung.

---

# 6. Không sử dụng một kích thước cố định cho mọi thành phần

Không được biến tất cả UI thành:

```css
font-size: var(--ide-ui-font-size);
```

một cách máy móc.

Các thành phần có thể có hierarchy:

```css
:root {
    --ide-ui-font-size: 14px;

    --ide-font-xs: 0.75rem;
    --ide-font-sm: 0.875rem;
    --ide-font-md: 1rem;
    --ide-font-lg: 1.125rem;
}
```

Ví dụ:

```text
Status bar      → small
Normal UI       → medium
Dialog title    → large
```

Khi UI font size thay đổi, các kích thước này phải thay đổi theo.

---

# 7. Font Size Range

Phải xác định giới hạn để tránh phá vỡ UI.

Đề xuất:

```text
Minimum: 10px
Maximum: 24px
Default: 14px
```

Có thể thay đổi theo thiết kế thực tế của project.

Không giới hạn bằng CSS cứng ở từng component.

Settings phải kiểm soát range tập trung.

---

# 8. Runtime Apply

Đây là yêu cầu bắt buộc.

Khi user thay đổi:

```text
Font Family
hoặc
Font Size
```

UI phải cập nhật ngay.

Không yêu cầu:

```text
Restart IDE
Reload page
Reload window
```

Luồng:

```text
Settings
   ↓
User thay đổi Font
   ↓
Settings Manager
   ↓
Update CSS Variables
   ↓
DOM re-render/reflow
   ↓
UI thay đổi ngay
   ↓
Persist settings
```

---

# 9. Runtime Font Update

Ví dụ:

```javascript
document.documentElement.style.setProperty(
    "--ide-ui-font-family",
    selectedFont
);
```

Cỡ chữ:

```javascript
document.documentElement.style.setProperty(
    "--ide-ui-font-size",
    `${fontSize}px`
);
```

Không reload toàn bộ ứng dụng.

---

# 10. Settings Manager

Không để Settings UI tự thao tác trực tiếp với DOM ở nhiều nơi.

Nên có một nơi quản lý:

```text
Settings Manager
```

Ví dụ API:

```javascript
Settings.get("appearance.uiFontFamily");

Settings.get("appearance.uiFontSize");

Settings.set("appearance.uiFontFamily", value);

Settings.set("appearance.uiFontSize", value);
```

Khi setting thay đổi:

```javascript
Settings.set(...)
        ↓
Persist
        ↓
Emit settingsChanged
        ↓
Typography Manager
        ↓
Update CSS variables
```

---

# 11. Typography Manager

Tạo một lớp/module chịu trách nhiệm áp dụng typography.

Ví dụ:

```javascript
TypographyManager.apply({
    fontFamily: "Inter",
    fontSize: 14
});
```

Nhiệm vụ:

1. Validate font.
2. Validate font size.
3. Update CSS variables.
4. Đảm bảo component UI sử dụng variables.
5. Trigger layout adjustment nếu cần.
6. Không tác động đến editor typography.

---

# 12. Layout phải responsive theo Font Size

Đây là phần quan trọng nhất.

Không chỉ thay đổi:

```css
font-size
```

mà phải kiểm tra các thành phần phụ thuộc vào text.

Ví dụ:

```text
Font size tăng
       ↓
Text width tăng
       ↓
Button width cần tăng
       ↓
Toolbar cần điều chỉnh
       ↓
Tab cần điều chỉnh
       ↓
Sidebar cần điều chỉnh
```

Không được dùng:

```css
height: 28px;
```

cho component có text nếu chiều cao cố định có thể làm mất nội dung khi font lớn.

Ưu tiên:

```css
min-height
height: auto
padding
line-height
```

---

# 13. Button

Không để button phụ thuộc vào chiều rộng cố định nếu text có thể thay đổi.

Không ưu tiên:

```css
button {
    width: 80px;
    height: 28px;
}
```

Ưu tiên:

```css
button {
    min-height: 28px;
    padding-inline: 10px;
    white-space: nowrap;
}
```

Khi font tăng:

```text
Text tăng kích thước
        ↓
Button tự tăng width/height
```

---

# 14. Toolbar / Action Bar

Kiểm tra:

- Icon.
- Text.
- Button.
- Dropdown.
- Search box.
- Connection selector.
- Run button.
- Action button.

Không để text bị:

```text
ellipsis
```

hoặc cắt mất nếu phần tử có thể mở rộng.

Nếu không đủ không gian:

```text
Toolbar
   ↓
flex
   ↓
shrink / overflow
```

Không để các control chồng lên nhau.

---

# 15. Sidebar

Sidebar phải hoạt động đúng khi font tăng.

Kiểm tra:

- Database tree.
- Object name.
- Folder.
- Search box.
- Context menu.
- Filter.
- Connection information.

Text dài phải được xử lý bằng:

```css
overflow
text-overflow
```

theo đúng UX hiện tại.

Không được làm mất nội dung chỉ vì font tăng.

---

# 16. Tree View

Tree node phải tính đến:

```text
Font size
+
Line height
+
Padding
+
Indent
```

Ví dụ:

```css
.tree-node {
    min-height: calc(var(--ide-ui-font-size) * 1.8);
}
```

Không hard-code chiều cao node quá nhỏ.

---

# 17. Tabs

Tab phải hỗ trợ font lớn.

Kiểm tra:

- Tab title.
- Close button.
- Dirty indicator.
- Active tab.
- Overflow.
- Tab context menu.

Không để:

```text
[VeryLongTa...]
```

trong trường hợp UI có thể mở rộng hoặc scroll.

Nếu không đủ chiều ngang:

```text
Horizontal scrolling
```

hoặc cơ chế overflow hiện tại của IDE phải tiếp tục hoạt động.

---

# 18. Modal / Dialog

Khi font tăng:

```text
Dialog width
Dialog height
Input height
Button height
Label height
```

phải điều chỉnh.

Không dùng:

```css
height: 400px;
```

nếu nội dung bên trong có thể tăng kích thước.

Ưu tiên:

```css
min-height
max-height
height: auto
```

và scroll nội dung khi cần.

---

# 19. Input / Select

Input phải tăng theo typography.

Kiểm tra:

```text
Input text
Placeholder
Label
Dropdown
Search box
```

Không để placeholder hoặc text bị cắt theo chiều dọc.

---

# 20. Context Menu

Context menu là thành phần dễ bị bỏ sót.

Phải kiểm tra:

- Menu item.
- Shortcut text.
- Icon.
- Separator.
- Submenu.
- Hover state.

Font lớn phải làm menu item tự tăng chiều cao.

---

# 21. Tooltip

Tooltip phải:

- Hiển thị đầy đủ text.
- Không bị giới hạn bởi chiều cao cố định.
- Không bị cắt.
- Không bị lệch khỏi target.

---

# 22. Icon và Font

Không để icon phụ thuộc trực tiếp vào font size nếu icon đang sử dụng SVG/image.

Ví dụ:

```css
.ide-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
}
```

Font thay đổi nhưng icon phải giữ tỷ lệ phù hợp.

Cần kiểm tra lại:

```text
Icon ↔ Text vertical alignment
```

---

# 23. Line Height

Không chỉ thay đổi font-size.

Phải xác định line-height phù hợp:

```css
line-height: 1.4;
```

hoặc sử dụng biến:

```css
--ide-ui-line-height: 1.4;
```

Mục tiêu:

```text
Font lớn
    ↓
Line height lớn tương ứng
    ↓
Không cắt glyph
    ↓
Không chồng text
```

---

# 24. Theme

Chức năng phải hoạt động với:

```text
Light Theme
Dark Theme
```

Không tạo riêng một implementation cho từng theme.

Typography variables nên tồn tại ở root và theme chỉ quản lý màu sắc/background/border.

---

# 25. Không tác động Editor

Sau khi implement phải xác nhận:

```text
Change IDE Font
       ↓
Sidebar       YES
Toolbar       YES
Menu          YES
Dialog        YES
Grid UI       YES

Monaco        NO
SQL Editor    NO
XML Editor    NO
Terminal      NO
```

Nếu editor đang nằm bên trong một container kế thừa font từ root, phải đảm bảo CSS của editor override rõ ràng.

---

# 26. Persistence

Khi user chọn:

```text
Font: Segoe UI
Size: 16px
```

phải lưu vào settings.

Sau khi mở lại IDE:

```text
Load Settings
      ↓
Apply Typography
      ↓
Render UI
```

Không yêu cầu user thiết lập lại.

---

# 27. Apply ngay khi Save

Khi user nhấn:

```text
Save
```

phải thực hiện:

```text
Validate
   ↓
Persist
   ↓
Apply Runtime
```

Không:

```text
Save
 ↓
Restart required
```

---

# 28. Cancel / Reset

Nếu Settings UI hiện tại có Cancel:

```text
Change
 ↓
Preview
 ↓
Cancel
 ↓
Restore previous value
```

Nếu có Reset:

```text
Reset to Default
```

Default phải được định nghĩa tập trung:

```javascript
const DEFAULT_UI_TYPOGRAPHY = {
    fontFamily: "Inter",
    fontSize: 14
};
```

---

# 29. Validation

Font size:

```text
10px <= value <= 24px
```

Không cho:

```text
0
negative
NaN
null
invalid string
```

Font family:

```text
selected font phải nằm trong danh sách supported fonts
```

Nếu font không tồn tại:

```text
Fallback font
```

không để UI mất font.

---

# 30. Performance

Thay đổi font có thể khiến browser reflow/repaint rất nhiều.

Không thực hiện:

```javascript
querySelectorAll(...)
    -> từng element.style.fontSize = ...
```

trên toàn bộ DOM.

Ưu tiên:

```javascript
document.documentElement.style.setProperty(...)
```

và CSS inheritance/variables.

Mục tiêu:

```text
1 runtime update
        ↓
CSS cascade
        ↓
Browser layout
```

thay vì cập nhật hàng nghìn DOM element.

---

# 31. Accessibility / Readability

Không được giả định rằng 14px là kích thước phù hợp cho tất cả user.

User có thể cần:

```text
12px
14px
16px
18px
20px
```

Do đó UI phải chịu được font lớn mà không mất chức năng.

Đây là lý do phải ưu tiên:

```text
responsive layout
auto height
min-height
flex
overflow
```

thay vì fixed-size layout.

---

# 32. Các khu vực phải kiểm tra

Agent phải rà soát toàn bộ UI và lập danh sách:

```text
[ ] Sidebar
[ ] Explorer
[ ] Toolbar
[ ] Action bar
[ ] Tabs
[ ] Status bar
[ ] Menu
[ ] Context menu
[ ] Modal
[ ] Dialog
[ ] Form
[ ] Input
[ ] Select
[ ] Checkbox
[ ] Radio
[ ] Tree
[ ] Data grid UI
[ ] Tooltip
[ ] Notification
[ ] Search UI
[ ] Settings UI
```

Đặc biệt tìm các CSS:

```text
font-family
font-size
line-height
height
min-height
max-height
width
min-width
padding
overflow
white-space
text-overflow
```

đang ảnh hưởng đến UI typography.

---

# 33. Không sửa bừa toàn bộ CSS

Trước khi sửa:

1. Tìm typography hiện tại.
2. Xác định CSS architecture.
3. Xác định component nào dùng shared styles.
4. Xác định component nào đang hard-code font.
5. Xác định component nào thuộc Editor và phải loại khỏi phạm vi.
6. Sau đó mới refactor.

Không rewrite toàn bộ UI nếu không cần thiết.

Ưu tiên thay đổi nhỏ, có kiểm soát.

---

# 34. Testing

## Font size

Test tối thiểu:

```text
10px
12px
14px
16px
18px
20px
24px
```

## Font

Test:

```text
Font mặc định
Font phổ biến
Font có ký tự rộng
Font fallback
```

## Theme

```text
Light
Dark
```

## Layout

Kiểm tra:

```text
Sidebar
Toolbar
Tabs
Dialog
Context menu
Tree
Grid
Status bar
Settings
```

## Runtime

Test:

```text
Change font
→ UI cập nhật ngay

Change size
→ UI cập nhật ngay

Change font + size
→ UI cập nhật ngay

Save
→ không restart

Restart
→ settings vẫn được giữ
```

---

# 35. Acceptance Criteria

Feature chỉ được xem là hoàn thành khi:

- [ ] User có thể chọn font chữ UI.
- [ ] User có thể chọn cỡ chữ UI.
- [ ] Font và cỡ chữ được áp dụng ngay lập tức.
- [ ] Không cần restart IDE.
- [ ] Không ảnh hưởng SQL Editor.
- [ ] Không ảnh hưởng XML Editor.
- [ ] Không ảnh hưởng Monaco Editor.
- [ ] Không làm mất nội dung UI.
- [ ] Không gây overlap giữa các control.
- [ ] Button tự thích nghi với text.
- [ ] Dialog tự thích nghi với nội dung.
- [ ] Tree node tự thích nghi với font.
- [ ] Tab không bị cắt nội dung bất hợp lý.
- [ ] Context menu hoạt động đúng với font lớn.
- [ ] Light/Dark theme đều hoạt động.
- [ ] Settings được lưu persistent.
- [ ] Mở lại IDE sử dụng typography đã lưu.
- [ ] Không cập nhật từng DOM element riêng lẻ nếu có thể dùng CSS variables.

---

# 36. Deliverables

Agent phải hoàn thành:

1. Typography configuration.
2. Settings integration.
3. Typography Manager.
4. CSS variables.
5. Runtime apply.
6. Persistent settings.
7. UI component adjustments.
8. Layout fixes.
9. Font-size validation.
10. Regression testing.

Không tạo implementation riêng cho từng màn hình nếu có thể giải quyết bằng shared typography system.

---

# 37. Kết quả kiến trúc mong muốn

```text
                    Settings
                       │
                       ▼
              Settings Manager
                       │
             ┌─────────┴─────────┐
             │                   │
             ▼                   ▼
        Persistence       Typography Manager
                                 │
                         ┌───────┴───────┐
                         │               │
                         ▼               ▼
                    CSS Variables    UI Layout
                         │               │
                         └───────┬───────┘
                                 ▼
                              IDE UI
```

Editor architecture nằm ngoài hệ thống này:

```text
IDE UI Typography
        │
        └── UI only

Editor Typography
        │
        ├── SQL Monaco
        ├── XML Editor
        └── Other Editors
```

Hai hệ thống phải độc lập.

---

# 38. Nguyên tắc cuối cùng

Mục tiêu không phải chỉ là:

> "Đổi font-size toàn bộ DOM."

Mục tiêu là xây dựng:

> "Một hệ thống Typography cho IDE có thể thay đổi font và kích thước UI runtime mà không phá vỡ layout."

Ưu tiên theo thứ tự:

```text
1. Không mất nội dung
2. Không phá layout
3. Không ảnh hưởng Editor
4. Apply runtime
5. Persist settings
6. Performance
7. Dễ mở rộng
```
