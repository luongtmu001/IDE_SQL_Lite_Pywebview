# Tài Liệu Cập Nhật Thay Đổi — LLTool IDE v1.1.1 (So với v1.1.0)

> **Ngày phát hành**: 22/10/2026  
> **Phiên bản trước**: `v1.1.0` (21/10/2026)  
> **Phiên bản hiện tại**: `v1.1.1` (Modern Card Panels & UI Aesthetics Enhancement)

---

## 1. Tóm Tắt Tổng Quan Các Thay Đổi Chính

Phiên bản **v1.1.1** nâng cấp thiết kế giao diện toàn diện theo phong cách **Modern Card Panels** độc lập (chuẩn thiết kế hiện đại của VS Code, Linear và Raycast):

| STT | Trọng tâm | Mã Nâng Cấp | Chi tiết |
|---|---|---|---|
| **1** | **Bố Cục Card Panels Độc Lập** | `UI-Card-Panels` | Tách biệt hoàn toàn Sidebar Object Explorer, Editor Pane và Results Panel thành 3 Card nổi độc lập có viền 1px mỏng và bo góc 8px sang trọng. |
| **2** | **Độ Tương Phản Nền Canvas** | `UI-Canvas-Obsidian` | Màu nền chung `--ide-bg-main` được chuyển sang `#101114` (Deep Obsidian), tối hơn bề mặt các card (`#18191E`, `#1C1D23`) giúp các card nổi bật trực quan và tăng chiều sâu. |
| **3** | **Rãnh Kéo Sash Resizers 6px** | `UI-Sash-Gutters` | Rãnh kéo dọc và ngang 6px với bo góc 3px, trong suốt khi nghỉ và phát sáng bằng màu accent khi hover/drag, đồng bộ khoảng đệm 6px xung quanh. |
| **4** | **Tích Hợp Editor Status Bar Liền Khối** | `UI-Editor-Card` | Chuyển thanh trạng thái (zoom %, đếm lỗi cú pháp, UTF-8, CRLF, dòng/cột) vào đáy trong của Card Editor, tự đóng gói toàn bộ chức năng soạn thảo. |
| **5** | **Căn Chỉnh Đồng Bộ Tab Bar & Icon** | `UI-Tabs-Polish` | Căn thẳng hàng border-bottom, bo góc trên 7px cho các thanh tiêu đề card, đồng bộ icon database và màu nền active tab theo theme. |

---

## 2. Chi Tiết Các Tính Năng Mới & Nâng Cấp Giao Diện

### 2.1. Bo Góc 8px & Đổ Bóng Chiều Sâu (Elevated Card Panels)

- **Bo góc 8px (`border-radius: 8px;`)**:
  - Áp dụng trên cả 3 khối làm việc cốt lõi:
    - `.ide-sidebar`: Card Object Explorer
    - `#ide-editor-pane`: Card khung soạn thảo SQL
    - `#ide-result-panel`: Card hiển thị kết quả truy vấn
  - Thêm hiệu ứng đổ bóng `box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);` tạo cảm giác khối card nổi nhẹ trên bề mặt nền canvas.
- **Căn chỉnh bán kính góc con bên trong (Nested Radii)**:
  - Header trên cùng (`.ide-sidebar-header`, `.ide-action-bar`, `.ide-result-tabs-bar`): `border-top-left-radius: 7px; border-top-right-radius: 7px;`
  - Footer đáy dưới (`.ide-tree`, `.ide-sidebar-collapsed-rail`, `.ide-editor-status-bar`, `.ide-result-footer`): `border-bottom-left-radius: 7px; border-bottom-right-radius: 7px;`
  - Đảm bảo các góc cong khớp hoàn hảo, không bị lem góc hay lộ viền vuông.

---

### 2.2. Tương Phản Màu Nền Canvas Deep Obsidian (`#101114`)

- **Nền chung của IDE**:
  - Cập nhật `--ide-bg-main: #101114;` (và alias `--ide-bg-base`) trong toàn bộ hệ thống biến CSS.
  - Phân tầng màu sắc trực quan rõ rệt:
    - Nền Canvas tổng thể: `#101114` (tối sâu)
    - Mặt card Editor: `#18191E` (sáng hơn +8 RGB)
    - Mặt card Sidebar & Results: `#1C1D23` (sáng hơn +12 RGB)
    - Action Bar & Toolbars: `#202228` (sáng hơn +16 RGB)
- **Bảo toàn bề mặt bên trong Card**:
  - Các khối hiển thị dữ liệu bảng (`.ide-grid-pane`), thông báo (`#ide-results-messages-view`), Table Designer và Table Data Editor được thiết lập màu nền card (`--ide-bg-result` / `--ide-bg-editor`), không bị lẫn màu canvas.

---

### 2.3. Rãnh Kéo Phân Chia Sash Resizers (6px)

- **Sash Gutters hiện đại**:
  - Rãnh kéo dọc giữa Sidebar và Editor (`.ide-sidebar-resizer`): `width: 6px; border-radius: 3px;`
  - Rãnh kéo ngang giữa Editor và Results (`.ide-resizer-horizontal`): `height: 6px; border-radius: 3px;`
  - Nền trong suốt (`background: transparent; border: none;`) khi ở trạng thái nghỉ; tự động chuyển sang màu nhấn của theme (`var(--ide-accent)`) khi rê chuột hoặc kéo thay đổi kích thước.
- **Đệm lề viền khung đồng bộ**:
  - Căn lề `#ide-main-area` lên `padding: 6px;` tạo khoảng cách viền 6px đồng đều bao quanh tất cả các card.

---

### 2.4. Khối Soạn Thảo SQL Độc Lập Toàn Diện

- **Cấu trúc tự đóng gói (Self-contained)**:
  - `#ide-editor-pane` tích hợp trọn vẹn:
    1. Action Bar trên cùng (chọn Connection, Database, Schema, nút Run, Max rows, các công cụ phân tích).
    2. Editor Tabs Bar (quản lý các file truy vấn đang mở).
    3. Vùng soạn thảo Monaco / CodeMirror Editor (hỗ trợ chia màn hình split view, diff viewer).
    4. Editor Status Bar dưới cùng (mức Zoom %, trạng thái cú pháp, encoding UTF-8, CRLF, vị trí con trỏ Ln/Col).
- **Phục hồi kích thước mượt mà**:
  - Khi ẩn/hiện Result Panel (`hideResultPanel` / `showResultPanel`), Card Editor tự động co giãn linh hoạt 100% diện tích mà không bị vỡ layout hoặc đè lên status bar.

---

## 3. Danh Sách Tệp Thay Đổi

| Tệp | Hành động | Nội dung thay đổi |
|---|---|---|
| `app/version.py` | Cập nhật | Nâng `__version__ = "1.1.1"` và `__version_tuple__ = (1, 1, 1)`. |
| `version.json` | Cập nhật | Nâng version `1.1.1`, cập nhật releaseNotes, highlights và checksums. |
| `static/css/theme-variables.css` | Cập nhật | Cập nhật `--ide-bg-main: #101114;` (dark) và `#e2e4e8` (light). |
| `static/css/themes.css` | Cập nhật | Đồng bộ `--ide-bg-main: #101114;` cho toàn bộ bộ theme. |
| `static/css/style.css` | Cập nhật | Đồng bộ biến màu nền canvas, bo góc card 8px, bóng đổ và rãnh kéo 6px. |
| `static/css/explorer.css` | Cập nhật | Nâng bo góc card Sidebar lên 8px, header 7px, rãnh kéo dọc 6px sash gutter. |
| `static/css/editor.css` | Cập nhật | Nâng bo góc Card Editor và Result Panel lên 8px, header/footer 7px, padding 6px, rãnh kéo ngang 6px. |
| `static/css/app.css` | Cập nhật | Đồng bộ rãnh kéo ngang 6px và padding. |
| `static/css/table-designer.css` | Cập nhật | Chuyển background sang `--ide-bg-editor` để đồng bộ bề mặt card. |
| `static/css/table-data-editor.css` | Cập nhật | Chuyển background sang `--ide-bg-editor` để đồng bộ bề mặt card. |
| `templates/index.html` | Cập nhật | Đưa status bar vào trong `#ide-editor-pane`, thêm class `.ide-editor-column`. |
| `static/js/app.js` | Cập nhật | Cập nhật tính toán chiều cao co giãn factoring status bar. |
| `scripts/package_release.py` | Cập nhật | Nâng cấp đóng gói release `v1.1.1`, tự động đồng bộ workspace sang `dist/LLTool`. |
| `tests/test_version_and_updates.py` | Cập nhật | Cập nhật test case kiểm thử update version lên `1.1.2`. |
| `docs/update_v1.1.1.md` | Thêm mới | Tài liệu chi tiết phát hành phiên bản `v1.1.1`. |
