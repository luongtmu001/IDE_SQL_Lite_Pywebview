# AG Grid Community Prototype cho SQL IDE Result Grid

Tài liệu hướng dẫn sử dụng, kiểm thử hiệu năng và đánh giá kỹ thuật cho prototype độc lập **AG Grid Community v31.3.2**.

---

## 1. Mục Tiêu & Phạm Vi

- **Mục tiêu**: Đánh giá độc lập khả năng thay thế hoặc song hành của AG Grid Community cho tính năng Result Grid trong SQL IDE (hiệu năng render hàng vạn dòng, hỗ trợ nhiều result set, streaming append batch, và resize linh hoạt).
- **Phạm vi bảo toàn**:
  - Prototype hoạt động **100% độc lập** trong thư mục `static/prototypes/ag-grid/`.
  - Không thay đổi bất kỳ file production nào của IDE (`grid-result.js`, `query.js`, `main.py`, adapters SQL Server/PostgreSQL, v.v.).
  - Không cần kết nối cơ sở dữ liệu; sử dụng bộ sinh dữ liệu PRNG xác định (deterministic seeded PRNG) mô phỏng chính xác các kiểu dữ liệu thực tế của SQL.
  - Chạy offline hoàn toàn trong môi trường WebView2 / EdgeChromium mà không phụ thuộc vào Internet hay CDN bên ngoài.

---

## 2. Cấu Trúc Thư Mục & Tài Nguyên

```
static/
├── vendor/
│   └── ag-grid/
│       ├── ag-grid-community.min.js   # AG Grid Community v31.3.2 (~1.89 MB, offline)
│       ├── ag-grid.css                # Core AG Grid styles
│       ├── ag-theme-quartz.css        # Modern Quartz theme (Dark/Light)
│       └── ag-theme-alpine.css        # Classic Alpine theme
└── prototypes/
    └── ag-grid/
        ├── prototype.html             # Trang giao diện chính của Prototype
        ├── prototype.css              # Style độc lập (scoped namespace)
        ├── prototype.js               # Logic điều khiển 5 Result Sets & Batch Updates
        ├── mock-data.js               # Bộ sinh dữ liệu PRNG đa kiểu dữ liệu
        ├── benchmark.js               # Engine đo kiểm hiệu năng rAF & performance.now()
        └── README.md                  # Tài liệu này
```

---

## 3. Hướng Dẫn Mở & Chạy Prototype

Có 2 cách để mở và trải nghiệm prototype:

### Cách 1: Mở trực tiếp bằng Trình duyệt Web (Khuyến nghị để dev/test nhanh)
1. Mở bất kỳ trình duyệt hiện đại nào (Google Chrome, Microsoft Edge).
2. Nhấn `Ctrl + O` (hoặc kéo thả) file:
   ```
   d:\Luong\NB_Personal\Python\IDE-SQL-Lite_New_Pyweb\static\prototypes\ag-grid\prototype.html
   ```
3. Prototype sẽ nạp dữ liệu mẫu ban đầu (2,000 dòng × 20 cột) ngay lập tức.

### Cách 2: Chạy qua Live Server / HTTP Server cục bộ
1. Tại thư mục gốc của project, khởi động một HTTP server đơn giản:
   ```powershell
   python -m http.server 8080
   ```
2. Truy cập URL:
   ```
   http://localhost:8080/static/prototypes/ag-grid/prototype.html
   ```

---

## 4. Các Chức Năng Chính & Kịch Bản Kiểm Thử

### A. Tùy Chọn Kích Thước Dataset
- **Số dòng (Rows)**: 100, 1,000, 2,000 (Mặc định), 5,000, 10,000 (Stress test), 20,000 (Max stress).
- **Số cột (Cols)**: 10, 20 (Mặc định), 50, 100 cột rộng.
- **Generate Data**: Nhấn nút này để sinh dữ liệu mới cho tab Result Set đang chọn và khởi tạo lại grid.

### B. Kiểm Thử 5 Result Sets (Multi-Tab)
- Prototype cung cấp sẵn **5 Result Sets độc lập** (`Result Set 1` đến `Result Set 5`), mỗi tab có metadata, số dòng, số cột và thể hiện grid riêng biệt.
- **2 Chế độ Khởi Tạo (Init Mode)**:
  - **Lazy Init (Khuyến nghị)**: Chỉ khởi tạo DOM và AG Grid instance khi người dùng click chuyển sang tab đó lần đầu. Tối ưu bộ nhớ tối đa.
  - **Eager Init**: Khởi tạo đồng thời toàn bộ 5 grids (thích hợp để đo tải bộ nhớ khi mở query nhiều SELECT cùng lúc).

### C. Batch Update (Append 1,000 Rows)
- Mô phỏng hành vi query streaming trong SQL IDE.
- Nhấn nút **Append 1,000 Rows**:
  - Dữ liệu 1,000 dòng mới được chèn trực tiếp qua API `gridApi.applyTransaction({ add: newRows })`.
  - **Không** render lại toàn bộ grid.
  - **Không** làm mất vị trí cuộn hiện tại của người dùng.
  - Thời gian thực thi API và thời gian hoàn tất frame đồ họa (visual paint) được đo và ghi vào bảng metrics.

### D. Resize Performance (Draggable Splitter)
- Kéo thanh chia (splitter màu xanh) giữa Grid Stage và Metrics Panel để kiểm tra độ phản hồi khi thay đổi kích thước container.
- Prototype sử dụng cơ chế throttle qua `requestAnimationFrame` và đo đạc số lượng sự kiện resize phát sinh mà không gây giật lag hay vỡ layout.

### E. Theme Switcher
- Hỗ trợ 4 giao diện: `Quartz Dark` (mặc định của IDE), `Quartz Light`, `Alpine Dark`, và `Alpine Light`.

---

## 5. Hướng Dẫn Chạy Benchmark & Đọc Chỉ Số

### Cách Chạy
Nhấn nút **Run Benchmark** trên thanh Toolbar. Hệ thống sẽ tự động thực hiện chuỗi kiểm thử 5 bước:
1. Sinh dữ liệu mock ngẫu nhiên theo cấu hình Rows × Cols đã chọn.
2. Nạp dữ liệu vào AG Grid và đo thời gian render JavaScript.
3. Chờ frame trình duyệt hoàn tất paint (`requestAnimationFrame`) để đo thời gian hiển thị thực tế (Visual Update).
4. Thêm batch 1,000 dòng qua `applyTransaction` và đo độ trễ đồ họa.
5. Đếm số lượng DOM nodes thực tế bên trong container để đánh giá virtual DOM virtualization.

### Cách Đọc Các Chỉ Số
| Chỉ số | Vị trí hiển thị | Ý nghĩa kỹ thuật |
| :--- | :--- | :--- |
| **Grid Init** | Footer bên phải | Thời gian gọi `agGrid.createGrid` cho dataset hiện tại. |
| **Last Action** | Footer bên phải | Thời gian thực thi của thao tác gần nhất (Generate, Append, v.v.). |
| **DOM Nodes** | Footer bên trái | Tổng số node HTML trong wrapper. Virtual scroll tốt sẽ giữ số node ở mức cố định (~300 - 800 nodes) bất kể có 2,000 hay 20,000 dòng. |
| **Execution Time** | Bảng Metrics Log | Thời gian thực thi thuần túy trong luồng JavaScript (ms). |
| **Visual Metrics** | Bảng Metrics Log | Thời gian từ lúc bắt đầu tác vụ cho đến khi trình duyệt hoàn thành layout & composite pixel trên màn hình (đo qua rAF). |

---

## 6. Phân Biệt & Khắc Phục Sự Cố

- **Cách mở Console**: Nhấn `F12` hoặc chuột phải &rarr; **Inspect** &rarr; chọn tab **Console**.
- **Lỗi tải thư viện**: Nếu thấy lỗi `agGrid is not defined`:
  - Kiểm tra xem đường dẫn `../../vendor/ag-grid/ag-grid-community.min.js` có tồn tại không.
- **Phân biệt lỗi Grid vs Lỗi Dữ liệu giả lập**:
  - Nếu xuất hiện lỗi liên quan đến `MockDataGenerator`: do tham số `rowCount` hoặc `colCount` không hợp lệ hoặc bộ nhớ máy bị quá tải khi chọn cấu hình cực đoan (> 50,000 dòng × 100 cột).
  - Nếu xuất hiện lỗi `applyTransaction of null`: do Result Set hiện tại chưa được khởi tạo (nhấn *Generate Data* trước khi Append).
- **Tràn bộ nhớ khi mở quá nhiều tabs**: Ở chế độ Eager Init với 5 tabs × 20,000 dòng × 100 cột, tổng số cell vượt 10,000,000 cells. Chế độ *Lazy Init* được khuyến nghị làm mặc định trong production.
