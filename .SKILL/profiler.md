# ĐẶC TẢ KIẾN TRÚC VÀ HƯỚNG DẪN THIẾT KẾ: UNIVERSAL DATABASE TRACE PROFILER

Tài liệu này đóng vai trò là bản đặc tả kỹ thuật (Technical Specification) mô tả toàn bộ kiến trúc, luồng xử lý dữ liệu và nguyên lý thiết kế cho công cụ giám sát truy vấn thời gian thực (**Trace Profiler**) tương thích đa cơ sở dữ liệu (**Microsoft SQL Server** và **PostgreSQL**), sử dụng giải pháp hiển thị Webview đa nền tảng kết hợp Virtual DOM.

---

## 1. Kiến Trúc Tổng Thể (System Architecture)

Hệ thống được tổ chức theo mô hình **4-Tier Event Pipeline** kết hợp mẫu thiết kế **Adapter Pattern**, đảm bảo tách biệt hoàn toàn giữa engine sinh log của cơ sở dữ liệu và cơ chế render của giao diện:

┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│       SQL Server Engine         │       │       PostgreSQL Engine         │
│  (Extended Events: Ring Buffer) │       │  (Engine CSVLog: Log Rotation)  │
└────────────────┬────────────────┘       └────────────────┬────────────────┘
│                                         │
▼                                         ▼
[MSSQL Collector Adapter]                 [PG Collector Adapter]
• Đọc XML buffer từ RAM server            • Theo dõi file log (tail -f)
• Khử trùng lặp qua Hash Set              • Parser ghép nối multiline query
│                                         │
└────────────────────┬────────────────────┘
│
[Thread-Safe FIFO Queue]
(Bộ đệm trung gian chống nghẽn)
│
[Batch Dispatcher Thread]
(Gom cụm: Time/Size Window)
│
[IPC Bridge Serializer]
(Gửi 1 mảng JSON qua evaluate_js)
│
▼
[Frontend Virtual DOM Grid]
┌───────────────────────────────────────┐
│ • Viewport Virtualization (60 FPS)    │
│ • Client Ring Buffer (Khống chế RAM)  │
│ • In-Memory Filter Engine (Đa luật)   │
│ • Master-Detail SQL Viewer Pane       │
└───────────────────────────────────────┘

---

## 2. Cơ Chế Thu Thập Dữ Liệu Theo Từng Hệ Quản Trị

### 2.1. Microsoft SQL Server Adapter (Extended Events Engine)

* **Thu thập qua bộ nhớ đệm (In-Memory Ring Buffer):** Sử dụng target `package0.ring_buffer` với dung lượng cấp phát cố định từ 16 MB đến 32 MB. Phương thức này hoạt động hoàn toàn trên RAM của SQL Server, không gây áp lực I/O đọc/ghi đĩa như SQL Trace truyền thống.
* **Lọc tại nguồn (Server-side Filtration):** Cấu hình thuộc tính `WHERE` ngay trong định nghĩa Session để loại bỏ kết nối mang tên ứng dụng của chính công cụ giám sát (`client_app_name`), triệt tiêu hoàn toàn hiện tượng tự trace chính mình (loopback trace).
* **Cơ chế đọc và khử trùng lặp (De-duplication):**
  * Định kỳ mỗi 200–300 ms, luồng thu thập quét Dynamic Management View (`sys.dm_xe_session_targets`).
  * Sử dụng bộ phân tích XML để bóc tách các trường: thời gian, mã sự kiện, SPID, Database, Client App, Duration và nội dung câu lệnh.
  * Duy trì một tập hợp băm (In-memory Set) lưu trữ khóa kết hợp giữa dấu thời gian và ID phiên để lọc bỏ các bản ghi cũ còn tồn lưu trong Ring Buffer giữa các chu kỳ đọc liên tiếp.

### 2.2. PostgreSQL Adapter (Structured CSVLog Tailer)

* **Ghi nhận toàn diện qua CSVLog:** Kích hoạt tính năng `logging_collector = on` với định dạng xuất `log_destination = 'csvlog'` và thiết lập `log_min_duration_statement = 0`. Cấu hình này bắt buộc máy chủ PostgreSQL ghi nhận 100% câu lệnh thực thi kèm thời gian chạy chi tiết ra file CSV chuẩn RFC 4180.
* **Theo dõi liên tục (Streaming Tailer):** Luồng thu thập hoạt động theo nguyên lý `tail -f`, mở file log có đuôi `.csv` mới nhất trong thư mục lưu trữ và tự động đặt con trỏ đọc ở cuối file khi bắt đầu để bỏ qua dữ liệu lịch sử.
* **Bảo toàn truy vấn nhiều dòng (Multiline Query Preservation):** Đưa luồng đọc file vào một trình phân tích cú pháp CSV chuyên dụng. Khi gặp các câu lệnh SQL phức tạp chứa ký tự ngắt dòng (`\n`) hoặc ký tự đặc biệt nằm trong dấu ngoặc kép, parser tự động đọc tiếp các dòng vật lý kế tiếp và ghép thành một bản ghi logic trọn vẹn trước khi chuyển tiếp.
* **Tự động nhận diện xoay vòng file (Log Rotation Handling):** Quét thư mục log định kỳ để phát hiện tệp mới nhất. Khi máy chủ PostgreSQL chuyển sang file log của ngày/giờ mới, luồng thu thập tự động đóng luồng đọc cũ và chuyển con trỏ sang file mới mà không làm gián đoạn việc giám sát.

---

## 3. Chuẩn Hóa Dữ Liệu (Unified Data Contract)

Tất cả các adapter thu thập bắt buộc phải chuẩn hóa cấu trúc dữ liệu thô từ hai cơ sở dữ liệu về một đối tượng JSON duy nhất trước khi đưa vào hàng đợi trung gian:

| Thuộc tính | Kiểu dữ liệu | Mô tả nguồn SQL Server | Mô tả nguồn PostgreSQL |
| :--- | :--- | :--- | :--- |
| `id` | Số nguyên (`number`) | ID tự tăng sinh ra tại collector | ID tự tăng sinh ra tại collector |
| `time` | Chuỗi (`string`) | Giờ thực thi (HH:mm:ss) từ `timestamp` | Giờ thực thi (HH:mm:ss) từ `log_time` |
| `event` | Chuỗi (`string`) | Tên sự kiện (`sql_statement_completed`...) | Loại lệnh (`command_tag`: SELECT, UPDATE...) |
| `spid` | Số nguyên (`number`) | Session ID từ action `session_id` | Worker PID từ trường `process_id` |
| `db` | Chuỗi (`string`) | Tên database từ action `database_name` | Tên database từ trường `database_name` |
| `app` | Chuỗi (`string`) | Tên client từ action `client_app_name` | Tên client từ trường `application_name` |
| `duration` | Số thực (`number`) | Thời gian thực thi (ms) = `duration / 1000` | Bóc tách bằng regex từ trường `message` (ms) |
| `sql` | Chuỗi (`string`) | Trích xuất từ `statement` hoặc `sql_text` | Trích xuất phần text sau `statement:` |

## 4. Tầng Xử Lý Trung Gian Phía Backend (Decoupling & IPC Optimization)

### 4.1. Hàng Đợi Bất Đồng Bộ (Thread-Safe FIFO Queue)

* Phân tách hoàn toàn tốc độ sinh sự kiện của cơ sở dữ liệu và tốc độ tiêu thụ của giao diện bằng một cấu trúc `Queue` đa luồng có giới hạn dung lượng tối đa (ví dụ: 50.000 phần tử).
* Nếu máy chủ cơ sở dữ liệu gặp đợt tăng tải đột ngột (spike), hàng đợi đóng vai trò hồ chứa đệm, ngăn chặn tình trạng tràn bộ nhớ hoặc làm nghẽn tiến trình xử lý chính.

### 4.2. Chiến Lược Gom Cụm (Dual-Trigger Batching Strategy)

* Không chuyển tiếp đơn lẻ từng sự kiện qua cầu nối IPC của Webview để tránh làm cạn kiệt tài nguyên xử lý luồng giao diện.
* Luồng phân phối dữ liệu (Batch Dispatcher) áp dụng cơ chế xả gói kép (Dual Trigger):
  * **Kích thước gói:** Tích lũy đủ **50 đến 100 sự kiện**.
  * **Thời gian trễ tối đa:** Quá **100 ms** kể từ lần xả gói gần nhất.
* Khi một trong hai điều kiện được đáp ứng, toàn bộ danh sách sự kiện được tuần tự hóa (serialize) thành một chuỗi JSON duy nhất và gửi sang frontend qua một lời gọi hàm thực thi duy nhất (`evaluate_js`).

---

## 5. Tầng Trình Diễn Phía Frontend (Virtual DOM & Performance)

### 5.1. Dựng Hình Qua Bộ Nhớ Ảo (Viewport Virtualization)

* Chỉ khởi tạo và duy trì trong cây DOM số lượng thẻ phần tử tương ứng với kích thước vùng nhìn thực tế của màn hình (khoảng 30–40 dòng).
* Khi người dùng cuộn danh sách, hệ thống tái sử dụng lại các thẻ DOM hiện có và chỉ cập nhật lại dữ liệu bên trong, giữ tốc độ khung hình ổn định ở mức 60 FPS ngay cả khi danh sách theo dõi chứa hàng chục nghìn dòng dữ liệu.
* Dữ liệu nhận từ batch được đưa vào bảng theo cơ chế bổ sung trực tiếp (silent append), không kích hoạt chu kỳ tính toán lại toàn bộ giao diện (reflow/repaint).

### 5.2. Khống Chế Bộ Nhớ Trình Duyệt (Client Ring Buffer)

* Thiết lập trần lưu trữ tối đa tại trình duyệt (ví dụ: 15.000 dòng sự kiện).
* Khi số lượng bản ghi vượt ngưỡng giới hạn, hệ thống tự động loại bỏ các bản ghi cũ nhất ở đầu danh sách theo nguyên tắc FIFO. Cơ chế này đảm bảo lượng RAM tiêu thụ của tiến trình Webview luôn ổn định dưới ngưỡng 300 MB, cho phép công cụ chạy liên tục trong thời gian dài mà không bị sập ứng dụng.

### 5.3. Bảng Điều Khiển Bộ Lọc Đa Điều Kiện (In-Memory Filter Engine)

* Cho phép người dùng cấu hình đồng thời nhiều tiêu chí lọc (AND logic) dựa trên:
  * **Kiểu số:** Lọc so sánh lớn hơn, nhỏ hơn, bằng trên các trường `duration`, `spid`.
  * **Kiểu văn bản:** Lọc chính xác hoặc lọc tương đối (`like`) trên các trường `db`, `app`, `event`, `sql`.
* Toàn bộ thao tác lọc và sắp xếp (sorting) được xử lý trực tiếp trên tập dữ liệu in-memory của Virtual Grid, không gửi yêu cầu truy vấn ngược về backend.

### 5.4. Giao Diện Phân Tách Master-Detail

* Phân chia bố cục theo tỷ lệ 60% chiều cao cho bảng danh sách sự kiện tổng quan và 40% cho khung xem chi tiết câu lệnh.
* Bắt sự kiện chọn dòng: Khi người dùng nhấp chuột vào một sự kiện trên bảng, toàn bộ nội dung câu lệnh SQL nguyên bản được kết xuất vào khung chi tiết với phông chữ cố định (monospace), giữ nguyên định dạng ngắt dòng và cấu trúc thụt lề ban đầu.
* Cung cấp công tắc khóa cuộn tự động (Auto-scroll Toggle): Tự động cuộn theo các sự kiện mới nhất, nhưng cho phép tạm ngắt cuộn khi người dùng đang dừng lại để phân tích một câu lệnh cụ thể.

---

## 6. Quản Lý Vòng Đời & An Toàn Hệ Thống (Lifecycle & Safety)

* **Khởi tạo sạch (Clean Initialization):** Khi bắt đầu phiên làm việc, hệ thống tự động kiểm tra và giải phóng các phiên trace mồ côi (orphaned sessions) còn tồn đọng trên máy chủ do các lần tắt đột ngột trước đó.
* **Thu hồi tài nguyên an toàn (Graceful Teardown):** Đăng ký các hook xử lý sự kiện đóng cửa sổ giao diện hoặc tín hiệu ngắt tiến trình (SIGINT/SIGTERM):
  * **Phía SQL Server:** Gửi lệnh dừng (`ALTER EVENT SESSION ... STOP`) và xóa hoàn toàn Session (`DROP EVENT SESSION ...`) trên máy chủ để trả lại bộ nhớ RAM cho hệ điều hành.
  * **Phía PostgreSQL:** Đóng an toàn toàn bộ luồng đọc và tệp mô tả (file descriptor) liên quan đến file log đang theo dõi.
* **Bảo vệ tài nguyên máy chủ:** Luôn thiết lập giới hạn trần cứng cho bộ nhớ Ring Buffer trên SQL Server để đảm bảo trong trường hợp ứng dụng giám sát bị mất kết nối đột ngột, tài nguyên của cơ sở dữ liệu mục tiêu vẫn được bảo vệ nguyên vẹn.

---

## 7. Tiêu Chuẩn Kiểm Thử & Nghiệm Thu (Verification Criteria)

| Hạng mục kiểm tra | Thao tác thực hiện | Tiêu chí đạt chuẩn |
| :--- | :--- | :--- |
| **Loại trừ truy vấn nội bộ** | Kích hoạt phiên trace trên máy chủ đang chạy. | Câu lệnh đọc dữ liệu hệ thống từ công cụ giám sát không xuất hiện trên giao diện. |
| **Bảo toàn Multiline SQL** | Chạy câu lệnh SQL chứa nhiều đoạn ngắt dòng và ký tự nháy kép trên PostgreSQL. | Khung chi tiết hiển thị đầy đủ toàn bộ văn bản câu lệnh, không bị phân mảnh thành nhiều dòng rời rạc. |
| **Khả năng chịu tải cao** | Sinh tải nhân tạo từ 500 đến 1.000 truy vấn/giây liên tục trong 2 phút. | Giao diện duy trì độ mượt 60 FPS, thao tác cuộn không bị giật, hàng đợi backend không xảy ra lỗi tràn bộ nhớ. |
| **Độ chính xác bộ lọc** | Thiết lập điều kiện lọc kết hợp: `duration >= 100` và `db = 'ERP'`. | Toàn bộ dòng hiển thị trên bảng khớp chính xác điều kiện; các câu lệnh dưới 100ms bị ẩn ngay lập tức. |
| **Giải phóng phiên làm việc** | Tắt ứng dụng giám sát đột ngột bằng nút đóng cửa sổ. | Session trên SQL Server biến mất hoàn toàn khỏi danh mục `sys.server_event_sessions`; không rò rỉ tiến trình nền. |
