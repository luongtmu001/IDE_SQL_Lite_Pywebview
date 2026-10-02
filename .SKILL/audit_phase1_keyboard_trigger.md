# Phase 1 — IntelliSense Keyboard Event & Trigger Architecture Audit

Compliant with **Section 4, 45, and 50** of `.SKILL/INTELLISENSE_KEYBOARD_TRIGGER_PLAN.md`.

---

## 1. IntelliSense Event Map

| File | Handler / Hook | Event Type | Previous Behavior | Problem Identified | Target Architecture |
|---|---|---|---|---|---|
| `static/js/editor-adapter.js` | `hasSelection()` | N/A | Không có phương thức kiểm tra selection | Không thể nhận biết khi người dùng đang bôi đen text (`Ctrl+A`, `Shift+Arrow`) | Bổ sung `hasSelection()` bọc `somethingSelected()` của CodeMirror |
| `static/js/context-analyzer.js` | `analyze()` | Lexical analysis | Phân tích token trước con trỏ, không kiểm tra comment / chuỗi | Khi gõ trong `-- comment` hoặc `'chuỗi'`, context vẫn trả về từ khóa/cột, gây popup sai | Cách ly `COMMENT_LINE`, `COMMENT_BLOCK`, `STRING`; trả về `contextType = 'comment'/'string'` |
| `static/js/context-analyzer.js` | `analyze()` (dot qualifier) | Lexical analysis | Dấu chấm sau bất kỳ token nào đều coi là qualifier | Số thập phân `10.` bị nhận diện thành table qualifier, kích hoạt tìm cột | Bổ sung guard chống số thập phân: nếu token trước `.` là số, bỏ qua trigger |
| `static/js/trigger-controller.js` | `classifyKey()` | `keydown` | Logic nằm rải rác trong `handleKeyDown` | Không có tầng phân loại phím độc lập; phím điều khiển bị lẫn với phím soạn thảo | Chuẩn hóa 10 nhóm `KeyCategory` độc lập với CodeMirror và UI |
| `static/js/trigger-controller.js` | `decideKeyDown()` | `keydown` | Xử lý trực tiếp và có nguy cơ kích hoạt double trigger | `keydown` và `change` cùng gọi mở completion cho 1 lần nhấn phím | Phân tách: `keydown` chỉ xử lý điều khiển tương tác (`Enter`, `Escape`, `Arrow`, `Ctrl+Space`) |
| `static/js/trigger-controller.js` | `decideChange()` | `change` | Debounce 120ms gọi mù quáng `trigger()` cho mọi thay đổi | Gõ thêm ký tự re-query toàn bộ metadata; dán/cắt text tự bật popup | Phân biệt `TRIGGER` mới vs `REFRESH` tại chỗ vs `CLOSE` vs `NONE`. Khóa paste/cut/undo |
| `static/js/trigger-controller.js` | `decideCursor()` | `cursorActivity` | Kiểm tra khoảng cách offset 10 ký tự cứng nhắc | Con trỏ chuyển dòng hoặc rời token không đóng popup kịp thời | Kiểm tra biên token `[start, end]` và dòng hiện tại; không bao giờ auto-trigger từ `IDLE` |
| `static/js/intellisense.js` | `refresh()` | `change` | Chưa có hàm `refresh` riêng biệt | Mỗi phím gõ thêm gửi lại request backend / database | Lọc trực tiếp trên danh sách `activeCandidates` in-memory mà không gọi database |
| `static/js/intellisense.js` | `hidePopup()` | Lifecycle | Chỉ gọi `popupUI.hide()` và xóa `activeContext` | Trạng thái State Machine và candidate cache không được reset | Xóa cache candidates, xóa active token, chuyển state machine về `IDLE` |

---

## 2. Trigger Map

| Phím / Thao tác | Trạng thái Popup | Hành động Logic | Lý do (Reason) | Yêu cầu Ngữ cảnh SQL | Ghi chú Thiết kế |
|---|---|---|---|---|---|
| `Ctrl + Space` | `IDLE` hoặc `VISIBLE` | `TRIGGER` | `explicit` | Không bắt buộc | **Explicit Trigger**: Ưu tiên tuyệt đối, luôn mở gợi ý bất kể ngữ cảnh |
| `.` (Dấu chấm) | `IDLE` | `TRIGGER` | `character` | Có (table/alias/schema hợp lệ) | Kích hoạt danh sách cột của alias/bảng; bỏ qua nếu là số thập phân `10.` |
| `@` (Biến/Tham số) | `IDLE` | `TRIGGER` | `character` | Có | Kích hoạt danh sách tham số stored procedure hoặc biến cục bộ |
| Ký tự chữ/số (a-z, 0-9) | `IDLE` | `TRIGGER` | `automatic` | Có (trong mệnh đề SQL hợp lệ) | Chỉ mở nếu đang trong mệnh đề (`SELECT`, `FROM`, `WHERE`...) và từ >= 1 ký tự |
| Ký tự chữ/số (a-z, 0-9) | `VISIBLE` | `REFRESH` | `identifier` | Có | **Lọc cục bộ tại chỗ**: Cập nhật query, lọc lại list candidates, không gọi DB |
| Phím Space (` `) | `IDLE` | `NONE` | `space_idle` | Không | Không bao giờ tự động mở popup khi vừa nhấn Space từ trạng thái nghỉ |
| Phím Space (` `) | `VISIBLE` | `CLOSE` | `delimiter` | Có | Kết thúc token và đóng popup (trừ follow-up keyword như `CREATE OR `) |
| Dấu phân cách (`,`, `(`, `;`) | `VISIBLE` | `CLOSE` | `delimiter` | Không | Kết thúc token và đóng popup |
| `Backspace` / `Delete` | `IDLE` | `NONE` | `delete_idle` | Không | Xóa ký tự khi popup đang đóng không được tự tiện mở gợi ý |
| `Backspace` / `Delete` | `VISIBLE` | `REFRESH` / `CLOSE` | `backspace` | Có | Nếu token vẫn còn: refresh lọc lại; nếu token rỗng: đóng popup |
| `ArrowUp` / `ArrowDown` | `IDLE` | `NONE` | `cursor_nav` | Không | Di chuyển con trỏ soạn thảo; không kích hoạt gợi ý |
| `ArrowUp` / `ArrowDown` | `VISIBLE` | `NAVIGATE` | `navigate` | Không | Di chuyển vệt sáng chọn gợi ý trong popup (+1, -1) |
| `PageUp` / `PageDown` | `VISIBLE` | `NAVIGATE` | `navigate` | Không | Di chuyển nhanh vệt sáng trong popup (+8, -8) |
| `Enter` / `Tab` | `IDLE` | `NONE` | `newline` | Không | Xuống dòng hoặc thụt lề thông thường; không kích hoạt gợi ý |
| `Enter` / `Tab` | `VISIBLE` | `ACCEPT` | `accept` | Không | Chấp nhận gợi ý đang chọn và chèn vào văn bản |
| `Escape` | `IDLE` | `NONE` | `ignored` | Không | Bỏ qua |
| `Escape` | `VISIBLE` | `CLOSE` | `escape` | Không | Đóng popup ngay lập tức và bật cờ chặn mở lại tức thì trong 300ms |
| Gõ trong comment (`--`, `/* */`) | Bất kỳ | `NONE` / `CLOSE` | `comment_or_string` | Có | Vô hiệu hóa triệt để tự động gợi ý bên trong comment |
| Gõ trong chuỗi (`'...'`) | Bất kỳ | `NONE` / `CLOSE` | `comment_or_string` | Có | Vô hiệu hóa triệt để tự động gợi ý bên trong string literal |
| Dán text (`Ctrl+V` / Paste) | Bất kỳ | `NONE` / `CLOSE` | `change_origin` | Không | Cập nhật context nhưng không tự động mở popup |
| Cắt text (`Ctrl+X` / Cut) | Bất kỳ | `NONE` / `CLOSE` | `change_origin` | Không | Cập nhật context nhưng không tự động mở popup |
| Undo / Redo (`Ctrl+Z`, `Ctrl+Y`) | Bất kỳ | `NONE` / `CLOSE` | `change_origin` | Không | Cập nhật context nhưng không tự động mở popup |
| Bôi đen văn bản (`hasSelection`) | Bất kỳ | `NONE` | `selection` | Không | Khi đang có vùng chọn, chỉ mở nếu có `Ctrl+Space` rõ ràng |
| Con trỏ rời khỏi token | `VISIBLE` | `CLOSE` | `cursor_leave` | Có | Đóng popup khi con trỏ di chuyển ra ngoài phạm vi token đang gợi ý |

---

## 3. Provider Map

```text
                               ┌────────────────────────────────┐
                               │     SqlContextAnalyzer         │
                               │  (Tokens, Clauses, Scopes,     │
                               │   Comment/String Isolation)    │
                               └───────────────┬────────────────┘
                                               │
                                               ▼
                              ┌──────────────────────────────────┐
                              │      CompletionEngine            │
                              │  (Pipeline, Ranker, Generator)   │
                              └───────────────┬──────────────────┘
                                               │
                      ┌────────────────────────┼────────────────────────┐
                      ▼                        ▼                        ▼
           ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
           │ CandidateGenerator   │ │   AppMetadataCache   │ │ CompletionRanker     │
           │ (Keywords, Tables,   │ │ (LRU, TTL, L3 Scope  │ │ (Clause, Type,       │
           │  Columns, Functions, │ │  Completions Memo)   │ │  Match Score)        │
           │  Snippets, Scopes)   │ └──────────────────────┘ └──────────────────────┘
           └──────────┬───────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │ IntelliSenseData-    │
           │ Provider             │
           │ (Connection, Schema) │
           └──────────────────────┘
```

---

## 4. Popup Lifecycle Map

```text
[Người dùng gõ phím]
         │
         ▼
  EditorAdapter (on 'keydown')
         │
         ├── Đã nhấn Ctrl+Space? ───► [OPENING] ──► Thu thập Candidates ──► Có kết quả? ──► [VISIBLE]
         │                                                                                  │
         ├── Đã nhấn Enter/Tab khi VISIBLE? ──► [ACCEPTING] ──► Chèn Text ──► [IDLE]       │
         │                                                                                  │
         ├── Đã nhấn Escape khi VISIBLE? ──► [CLOSE] ──► Kích hoạt cờ 300ms ──► [IDLE]     │
         │                                                                                  │
         └── Đã nhấn Arrow khi VISIBLE? ──► [NAVIGATING] ──► Cập nhật highlight ───────────┘
         │
         ▼ (Phím gõ ký tự)
  CodeMirror chèn ký tự vào buffer
         │
         ▼
  EditorAdapter (on 'change')
         │
         ├── Nguồn thay đổi là paste/cut/undo/setValue? ──► [CLOSE] / [NONE]
         │
         ├── Vừa đóng bởi Escape (<300ms)? ──► [NONE] (Chặn mở lại tức thì)
         │
         ├── Con trỏ trong Comment / String? ──► [CLOSE] / [NONE]
         │
         ├── Đang ở trạng thái [VISIBLE]?
         │        │
         │        ├── Người dùng gõ tiếp ký tự? ──► [REFRESHING] ──► Lọc in-memory ──► [VISIBLE]
         │        ├── Người dùng Backspace? ──► Token còn? ──► [REFRESHING] / Token rỗng? ──► [IDLE]
         │        └── Người dùng gõ dấu phân cách? ──► [CLOSE] ──► [IDLE]
         │
         └── Đang ở trạng thái [IDLE]?
                  │
                  ├── Ký tự kích hoạt (., @)? ──► [OPENING] ──► Thu thập Candidates ──► [VISIBLE]
                  ├── Từ khóa hợp lệ trong clause? ──► [OPENING] ──► Thu thập Candidates ──► [VISIBLE]
                  └── Phím Space hoặc xóa khi IDLE? ──► [NONE] (Giữ nguyên IDLE)
```

---

## 5. Metadata Request Flow Map

| Thao tác người dùng | Cơ chế Trước cải tiến | Cơ chế Sau cải tiến | Tỷ lệ giảm tải |
|---|---|---|---|
| Gõ `SELECT c.` | Gửi request lấy cột cho `c` | Gửi 1 request lấy cột cho `c` (hoặc lấy từ Cache L3) | 0% (cần thiết ban đầu) |
| Gõ tiếp `C` (`c.C`) | Gửi tiếp request query DB | Lọc trực tiếp trong bộ nhớ từ danh sách đã nạp | **Giảm 100% request DB** |
| Gõ tiếp `u` (`c.Cu`) | Gửi tiếp request query DB | Lọc trực tiếp trong bộ nhớ từ danh sách đã nạp | **Giảm 100% request DB** |
| Gõ tiếp `s` (`c.Cus`) | Gửi tiếp request query DB | Lọc trực tiếp trong bộ nhớ từ danh sách đã nạp | **Giảm 100% request DB** |
| Backspace xóa `s` | Gửi tiếp request query DB | Lọc trực tiếp trong bộ nhớ từ danh sách đã nạp | **Giảm 100% request DB** |
| Gõ trong comment | Gửi request lấy metadata | Không gửi bất kỳ request nào (`NO_TRIGGER`) | **Giảm 100% request lãng phí** |
| Nhấn Space sau `FROM ` | Tự động quét toàn bộ bảng | Giữ nguyên trạng thái nghỉ đến khi gõ ký tự | **Giảm request không mong muốn** |
