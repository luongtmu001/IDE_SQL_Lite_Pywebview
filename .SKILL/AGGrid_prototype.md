# TASK: XÂY DỰNG AG GRID COMMUNITY PROTOTYPE ĐỘC LẬP CHO SQL IDE

## 1. MỤC TIÊU

Xây dựng một prototype độc lập sử dụng AG Grid Community để đánh giá khả năng thay thế Result Grid hiện tại trong tương lai.

Prototype phải cho phép:

- Hiển thị dữ liệu giả lập.
- Kiểm thử hàng nghìn đến hàng chục nghìn dòng.
- Kiểm thử bảng nhiều cột.
- Kiểm thử nhiều result set.
- Kiểm thử resize.
- Kiểm thử cập nhật dữ liệu theo batch.
- Đo hiệu năng frontend.
- So sánh với grid hiện tại ở giai đoạn sau.

Đây là prototype nghiên cứu hiệu năng, chưa phải phiên bản thay thế Result Grid chính thức.

## 2. NGUYÊN TẮC QUAN TRỌNG

Prototype phải độc lập với grid hiện tại.

Không sửa:

- grid-result.js.
- GridResultManager.
- GridResultInstance.
- VirtualGridRenderer.
- query.js.
- api.js.
- SQL Server adapter.
- PostgreSQL adapter.

Chỉ được đọc các file trên để tham khảo giao diện hoặc quy ước của project khi cần thiết.

Không được thay đổi:

- Luồng thực thi SQL.
- PyWebView API hiện tại.
- Cấu trúc dữ liệu của tab editor.
- Cơ chế streaming hiện tại.
- IntelliSense.
- Monaco.
- CodeMirror.
- SQL Formatter.
- Object Explorer.

Trước khi sửa:

1. Khảo sát cấu trúc project.
2. Xác định nơi phù hợp để đặt prototype.
3. Liệt kê file sẽ tạo hoặc sửa.
4. Nêu rõ phạm vi ảnh hưởng.

Nếu việc tích hợp yêu cầu sửa file ngoài phạm vi prototype, hãy dừng và báo cáo trước.

## 3. CẤU TRÚC THƯ MỤC

Ưu tiên tạo thư mục độc lập:

static/prototypes/ag-grid/

Cấu trúc dự kiến:

static/prototypes/ag-grid/
├── prototype.html
├── prototype.css
├── prototype.js
├── mock-data.js
├── benchmark.js
└── README.md

Đây là cấu trúc đề xuất.

Nếu project có quy ước khác, hãy sử dụng cấu trúc phù hợp nhưng vẫn giữ prototype độc lập.

Không sửa hoặc ghi đè file đang tồn tại nếu chưa kiểm tra.

## 4. CÀI ĐẶT AG GRID

Sử dụng AG Grid Community.

Trước khi triển khai:

- Kiểm tra cách quản lý JavaScript dependency hiện tại.
- Kiểm tra package.json nếu tồn tại.
- Kiểm tra cách đóng gói static resources.
- Xác định phiên bản AG Grid phù hợp.
- Xác nhận API tương ứng với phiên bản đã chọn.
- Kiểm tra giấy phép và yêu cầu phân phối.

Ưu tiên cách tải thư viện local để chạy offline trong WebView2.

Không phụ thuộc CDN tại runtime.

Không cài thêm React, Vue hoặc framework frontend khác.

Không tự tạo đường dẫn đến file thư viện chưa tồn tại.

Nếu cần cài dependency mới, hãy báo cáo thay đổi và chỉ cài trong phạm vi prototype đã được phê duyệt.

## 5. GIAO DIỆN

Tạo một trang HTML độc lập.

Giao diện gồm:

A. Toolbar:

- Dataset size.
- Column count.
- Generate Data.
- Append 1,000 Rows.
- Clear Data.
- Run Benchmark.

B. Result set selector:

- Result 1.
- Result 2.
- Result 3.
- Result 4.
- Result 5.

C. AG Grid:

- Header.
- Data rows.
- Vertical scrolling.
- Horizontal scrolling.
- Column resize.
- Sorting.
- Filtering.
- Cell selection hoặc row selection phù hợp với phiên bản được chọn.
- Copy dữ liệu nếu hỗ trợ bằng Community hoặc triển khai bằng chức năng phù hợp.

D. Footer:

- Total rows.
- Total columns.
- Initialization time.
- Data update time.
- Resize measurements.
- Active result set.

Không sử dụng React hoặc framework frontend.

Ưu tiên giao diện sáng, đơn giản, gần với Result Grid hiện tại.

Không sửa CSS toàn cục của IDE.

Mọi CSS phải được giới hạn trong namespace của prototype.

## 6. MOCK DATA GENERATOR

Tạo mock-data.js.

Cho phép sinh dữ liệu với:

- 100 rows.
- 2,000 rows.
- 10,000 rows.
- 20,000 rows.
- 20 columns.
- 50 columns.
- 100 columns.

Có thể tùy chỉnh số dòng và số cột.

Sử dụng seed cố định để tái tạo bộ dữ liệu.

Các kiểu dữ liệu:

- Integer.
- Decimal.
- Boolean.
- String.
- NULL.
- Date/time.
- Long text.
- Repeated values.

Dữ liệu phải được sinh trực tiếp trong JavaScript.

Không kết nối database.

Không gọi API thực thi SQL.

Không ghi dữ liệu vào project hoặc database.

Không tạo tất cả mock data cùng lúc khi người dùng chưa yêu cầu.

## 7. MULTIPLE RESULT SET

Cho phép tạo 5 result set độc lập.

Mỗi result set phải có:

- Metadata riêng.
- Column definitions riêng.
- Dữ liệu riêng.
- Trạng thái khởi tạo riêng.

Kiểm thử hai chế độ:

A. Eager initialization:
Khởi tạo tất cả grid.

B. Lazy initialization:
Chỉ khởi tạo grid khi người dùng mở result set tương ứng.

Không tạo nhiều grid instance cho cùng một result set.

Không thay đổi dữ liệu của result set khác khi chuyển đổi.

Giữ trạng thái cuộn nếu có thể.

Khi xóa dữ liệu hoặc reset prototype, giải phóng instance theo đúng API của phiên bản AG Grid đã chọn.

Không giả định chỉ ẩn DOM là đã giải phóng toàn bộ tài nguyên.

## 8. BATCH UPDATE

Tạo nút Append 1,000 Rows.

Khi người dùng bấm:

- Tạo thêm 1.000 dòng.
- Cập nhật đúng result set hiện tại.
- Không khởi tạo lại grid.
- Không thay toàn bộ dữ liệu nếu không cần thiết.
- Không reset scroll ngoài ý muốn.
- Không thay đổi trạng thái filter hoặc sort ngoài ý muốn.

Đo thời gian cập nhật dữ liệu.

Tách thời gian tạo dữ liệu khỏi thời gian cập nhật grid.

## 9. RESIZE BENCHMARK

Tạo khu vực grid có thể thay đổi chiều cao.

Cho phép người dùng kéo splitter.

Ghi nhận:

- Số lần resize event.
- Số lần grid resize.
- Thời gian xử lý resize.
- Thời gian cập nhật layout.
- Thời gian cập nhật dữ liệu nếu có.
- Các lỗi console liên quan đến resize.

Không gọi lại hàm nạp toàn bộ dữ liệu khi resize.

Không gọi sizeColumnsToFit liên tục trong quá trình kéo nếu không cần thiết.

Không tạo vòng lặp ResizeObserver.

Không dùng một ResizeObserver riêng cho từng thao tác resize nếu không cần thiết.

Dùng cơ chế quản lý layout phù hợp với API chính thức của phiên bản AG Grid đã chọn.

## 10. PERFORMANCE BENCHMARK

Tạo benchmark.js.

Sử dụng performance.now() để đo:

1. Data generation time.
2. Grid initialization time.
3. Data update time.
4. Batch append time.
5. Resize handling time.
6. Time until grid becomes visually updated, với phương pháp đo phù hợp.
7. Số lượng DOM node trong khu vực grid.
8. Số lượng grid instance đang hoạt động.

Phân biệt:

- Thời gian JavaScript gọi API.
- Thời gian cập nhật model.
- Thời gian trình duyệt cập nhật giao diện.

Không coi thời gian trả về của một API đồng nghĩa với thời gian render hoàn tất.

Nếu dùng requestAnimationFrame để xác định thời điểm cập nhật giao diện, ghi rõ đây là phép đo gần đúng, không phải bằng chứng tuyệt đối rằng mọi pixel đã được vẽ xong.

Không ghi log toàn bộ dataset.

Không sử dụng số liệu ước lượng để tuyên bố AG Grid nhanh hơn grid hiện tại.

## 11. PYWEBVIEW INTEGRATION

Trong giai đoạn đầu:

- Prototype phải chạy độc lập bằng mock data.
- Không gọi MainApi.execute_query().
- Không sử dụng SQL Server.
- Không sử dụng PostgreSQL.
- Không sửa backend.

Nếu cần chạy trong PyWebView, sử dụng cơ chế mở trang prototype theo cách phù hợp với cấu trúc hiện tại.

Không sửa luồng khởi động chính của ứng dụng.

Không tự động mở prototype mỗi khi khởi động IDE.

Ưu tiên truy cập prototype thông qua một URL hoặc đường dẫn riêng.

Nếu cần thay đổi menu hoặc thêm nút trong IDE để mở prototype, hãy đề xuất riêng trước khi thực hiện.

## 12. KIỂM THỬ

Kiểm thử:

- 100 rows × 10 columns.
- 2,000 rows × 20 columns.
- 20,000 rows × 20 columns.
- 10,000 rows × 100 columns.
- 5 result set × 10,000 rows × 20 columns.

Với mỗi cấu hình:

- Xác nhận dữ liệu hiển thị đúng.
- Xác nhận sort và filter.
- Xác nhận resize.
- Xác nhận cuộn dọc và ngang.
- Xác nhận chuyển result set.
- Xác nhận không khởi tạo grid trùng lặp.
- Xác nhận xóa dữ liệu hoạt động đúng.

Không bắt buộc chạy tất cả cấu hình lớn tự động trong mỗi lần khởi động.

Không chạy benchmark gây ảnh hưởng đến môi trường production.

## 13. README

README phải hướng dẫn:

- Cách mở prototype.
- Cách tạo dữ liệu.
- Cách chọn số dòng và số cột.
- Cách tạo nhiều result set.
- Cách chạy benchmark.
- Cách đọc các chỉ số.
- Cách kiểm tra console.
- Cách phân biệt lỗi grid và lỗi dữ liệu giả lập.

Ghi rõ phiên bản AG Grid và phương thức quản lý dependency.

## 14. TIÊU CHÍ HOÀN THÀNH

1. Prototype chạy độc lập.
2. Grid hiện tại không bị thay đổi.
3. Không cần database.
4. Không cần kết nối SQL Server hoặc PostgreSQL.
5. Có thể kiểm thử nhiều result set.
6. Có thể đo thời gian khởi tạo và cập nhật dữ liệu.
7. Có thể đo hiệu năng resize.
8. Có thể kiểm thử bảng nhiều cột.
9. Có thể chạy offline sau khi dependency được chuẩn bị đầy đủ.
10. Không có lỗi JavaScript hoặc tài nguyên bị thiếu.

## 15. BÁO CÁO KẾT QUẢ

Báo cáo:

- Danh sách file đã tạo.
- Phiên bản AG Grid.
- Cách chạy prototype.
- Các chức năng đã hoàn thành.
- Các bài test đã thực hiện.
- Kết quả benchmark.
- Các giới hạn đã biết.
- Các bước tiếp theo để so sánh với grid hiện tại.

Không sửa grid hiện tại trong nhiệm vụ này.

Bắt đầu bằng khảo sát cấu trúc project, sau đó triển khai prototype độc lập.
