# TASK: NÂNG CẤP HIỆU NĂNG RESULT GRID CHO SQL IDE

## 1. MỤC TIÊU

Nâng cấp hệ thống Result Grid hiện tại nhằm giải quyết:

1. Giao diện bị giật khi resize vùng Results.
2. Nhiều result set làm tăng chi phí khởi tạo và render.
3. ResizeObserver của grid ẩn vẫn hoạt động không cần thiết.
4. Dữ liệu kết quả bị truyền hai lần qua PyWebView.
5. Tối ưu vòng đời dữ liệu và grid khi thực thi truy vấn mới.
6. Giữ nguyên giao diện và các chức năng đang hoạt động.

Đây là nhiệm vụ cải tiến trên kiến trúc hiện có.

Không tự ý thay toàn bộ Grid Result bằng một thư viện khác.

Không triển khai virtualization theo chiều ngang ngay trong giai đoạn đầu.

## 2. KIẾN TRÚC HIỆN TẠI

Project sử dụng:

- Python backend.
- PyWebView.
- WebView2 / EdgeChromium.
- Vanilla JavaScript.
- SQL Server thông qua pyodbc.
- PostgreSQL thông qua psycopg 3.
- Monaco Editor.
- Result Grid sử dụng DOM.

Các module quan trọng theo báo cáo kiến trúc:

- `static/js/query.js`
- `static/js/grid-result.js`
- `static/js/api.js`
- `static/js/app.js`
- `main.py`
- `app/services/query_service.py`
- `app/database/sqlserver.py`
- `app/database/postgresql.py`

Các thành phần Grid hiện có:

- `VirtualGridRenderer`
- `GridResultInstance`
- `GridResultManager`
- `createGridPaneElement()`
- `renderGrid()`
- `window.onQueryProgress()`
- `clearResults()`

Các thông tin trên phải được kiểm tra lại trực tiếp trong source code trước khi sửa.

Không mặc định tên hàm, vị trí dòng hoặc hành vi trong báo cáo vẫn hoàn toàn chính xác.

## 3. QUY TẮC AN TOÀN VÀ PHẠM VI

Được phép sửa code trong phạm vi Result Grid và các thành phần trực tiếp liên quan.

Không được tự ý:

- Thay Monaco hoặc CodeMirror.
- Thay đổi cơ chế IntelliSense.
- Thay đổi SQL Formatter.
- Thay đổi Object Explorer.
- Thay đổi quản lý connection.
- Thay đổi cấu trúc lưu settings hoặc user data.
- Thay đổi hành vi thực thi SQL không liên quan.
- Chạy SQL trên database thực tế.
- Thực hiện thao tác ghi dữ liệu trên database.
- Cài thêm thư viện grid mới.
- Thay đổi cơ chế đóng gói ứng dụng.

Ưu tiên sử dụng JavaScript và CSS hiện có.

Không tạo một hệ thống Grid mới song song với hệ thống cũ.

Trước khi sửa, lập danh sách file sẽ thay đổi và mô tả ảnh hưởng của từng file.

Nếu phát hiện phải thay đổi ngoài phạm vi trên, dừng và báo cáo lý do trước khi thực hiện.

## 4. GIAI ĐOẠN 1: KHẢO SÁT VÀ CHUẨN HÓA RESIZE

### 4.1. Phân tích VirtualGridRenderer

Đọc trực tiếp implementation hiện tại.

Xác định:

- Hàm render.
- Cách tính startIndex và endIndex.
- Cách đo chiều cao dòng.
- Cách cập nhật spacer trên và dưới.
- Cách cập nhật chiều cao vùng bảng.
- Cách đăng ký ResizeObserver.
- Cách xử lý scroll.
- Cách hủy renderer.

Không giả định chiều cao dòng hiện tại đúng bằng 26px nếu chưa xác minh CSS và cấu trúc DOM.

### 4.2. Cố định chiều cao dòng

Nếu giao diện hiện tại sử dụng chiều cao dòng đồng nhất, chuyển sang sử dụng một cấu hình chiều cao dòng thống nhất giữa:

- CSS.
- VirtualGridRenderer.
- Tính toán vị trí dòng.
- Tính toán spacer.

Mục tiêu:

- Không cần đọc offsetHeight của dòng đầu tiên mỗi lần render.
- Không đo lại chiều cao dòng trong vòng lặp render.
- Không để CSS và JavaScript sử dụng hai giá trị chiều cao khác nhau.

Nếu có tính năng khiến chiều cao dòng thay đổi, phải đánh giá ảnh hưởng trước khi cố định.

Không được làm sai vị trí cuộn hoặc số dòng hiển thị.

### 4.3. Loại bỏ Layout Thrashing

Kiểm tra mọi thao tác đọc layout và ghi layout trong VirtualGridRenderer.

Đặc biệt chú ý:

- offsetHeight.
- offsetWidth.
- clientHeight.
- clientWidth.
- getBoundingClientRect().
- style.height.
- style.width.
- Các phép cập nhật DOM trong vòng lặp.

Tách thành các pha:

1. Đọc kích thước cần thiết.
2. Tính toán trong JavaScript.
3. Cập nhật DOM sau khi đã hoàn thành tính toán.

Không xen kẽ đọc layout và ghi layout nhiều lần trong cùng một vòng xử lý nếu có thể tránh.

Không gọi lại toàn bộ logic render dữ liệu chỉ để cập nhật chiều cao viewport.

## 5. GIAI ĐOẠN 2: TỐI ƯU SPLITTER VÀ RESIZE

### 5.1. Gom sự kiện resize theo frame

Kiểm tra handler kéo thanh phân chia:

`.ide-grid-splitter`

Áp dụng requestAnimationFrame để giới hạn cập nhật layout ở mức tối đa một lần mỗi frame.

Yêu cầu:

- Không chạy cập nhật layout cho mọi mousemove riêng biệt.
- Không tạo nhiều requestAnimationFrame trùng lặp.
- Chỉ giữ tối đa một frame callback đang chờ.
- Xử lý đúng khi người dùng kéo liên tục.
- Hủy callback chờ nếu component bị hủy và việc hủy là cần thiết.

Nếu có thể, cập nhật chiều cao panel trong quá trình kéo và thực hiện đồng bộ grid sau đó.

Không dựng lại toàn bộ dữ liệu khi kéo splitter.

### 5.2. Phân biệt hai loại resize

A. Resize Results Panel:

- Thay đổi chiều cao vùng Results.
- Cập nhật viewport của grid.
- Không render lại toàn bộ dữ liệu.
- Không tải lại dữ liệu từ backend.

B. Resize cột:

- Chỉ cập nhật chiều rộng cột tương ứng.
- Đồng bộ header và body.
- Không tính lại toàn bộ dữ liệu.
- Không làm mất trạng thái chọn ô hoặc vị trí cuộn.

Không gộp hai loại resize thành một luồng cập nhật toàn bộ grid.

### 5.3. Tối ưu ResizeObserver

Mỗi renderer phải có vòng đời ResizeObserver rõ ràng.

Yêu cầu:

- Không thực hiện render nặng trong callback.
- Callback chỉ ghi nhận kích thước mới và lên lịch cập nhật.
- Không kích hoạt vòng lặp ResizeObserver do callback liên tục sửa kích thước container.
- Không xử lý grid không hiển thị.
- Không sử dụng kích thước giả định 400px để tiếp tục render grid đang ẩn.
- Không để ResizeObserver của grid đã bị destroy tiếp tục hoạt động.

Khi phần tử không hiển thị hoặc có kích thước bằng 0:

- Bỏ qua render.
- Giữ trạng thái cần thiết.
- Đánh dấu grid cần cập nhật kích thước khi được hiển thị trở lại.

Khi grid hiển thị trở lại:

- Đo lại viewport.
- Cập nhật spacer.
- Render đúng vùng dòng hiện tại.
- Giữ vị trí cuộn hợp lệ.

Không tự động reset scroll về đầu nếu không có yêu cầu.

## 6. GIAI ĐOẠN 3: TỐI ƯU MULTIPLE RESULT SET

### 6.1. Quản lý vòng đời

Mỗi result set cần có trạng thái riêng.

Các trạng thái logic có thể gồm:

- loading
- ready
- error
- cancelled
- destroyed

Không bắt buộc phải tạo một class mới nếu cấu trúc hiện tại đã quản lý được các trạng thái tương đương.

### 6.2. Tách nhận dữ liệu khỏi render

Khi nhận một batch dữ liệu mới:

- Cập nhật đúng data store của result set.
- Không tạo lại grid instance.
- Không dựng lại header nếu metadata không đổi.
- Không dựng lại toàn bộ rowPool nếu chỉ thêm dữ liệu.
- Không reset vị trí cuộn nếu người dùng đang xem dữ liệu đã nhận trước đó.

Chỉ cập nhật vùng đang hiển thị và các trạng thái thực sự thay đổi.

### 6.3. Lazy initialization

Đánh giá khả năng trì hoãn khởi tạo grid cho các result set chưa hiển thị.

Không bắt buộc áp dụng IntersectionObserver nếu cấu trúc pane hiện tại không phù hợp.

Có thể sử dụng một cơ chế đánh dấu grid đã khởi tạo hoặc chưa khởi tạo.

Yêu cầu:

- Không khởi tạo nhiều instance trùng lặp.
- Không mất dữ liệu khi grid chưa được khởi tạo.
- Không tạo nhiều ResizeObserver trước khi grid thực sự cần hiển thị.
- Khi grid được hiển thị, phải render đúng metadata và dữ liệu đã nhận.
- Không làm thay đổi kết quả SQL.

Giữ nguyên cách hiển thị nhiều result set hiện tại trong giai đoạn này.

Không tự ý chuyển giao diện sang tab-based grid.

### 6.4. Tối ưu các grid thuộc tab editor ẩn

Kiểm tra vòng đời grid khi người dùng chuyển tab editor.

Không được tiếp tục render grid ẩn chỉ vì ResizeObserver kích hoạt.

Ưu tiên:

- Tạm dừng render khi tab ẩn.
- Giữ data store và trạng thái grid.
- Cập nhật layout khi tab hiển thị trở lại.
- Destroy hoàn toàn grid khi tab thực sự bị đóng.

Không xóa kết quả chỉ vì tab editor bị ẩn.

## 7. GIAI ĐOẠN 4: LOẠI BỎ TRUYỀN DỮ LIỆU KẾT QUẢ TRÙNG LẶP

Đây là thay đổi có ảnh hưởng liên quan đến backend và frontend.

Phải khảo sát các thành phần sau:

- SqlServerAdapter.execute().
- PostgreSqlAdapter.execute().
- MainApi.execute_query().
- window.onQueryProgress().
- executeQuery().
- tabState.resultData.
- currentStreamingData.
- renderGrid().
- Các chức năng restore tab hoặc sử dụng kết quả truy vấn.

Hiện trạng theo báo cáo:

- Dữ liệu được stream qua evaluate_js().
- Backend đồng thời tích lũy toàn bộ rows.
- Cuối cùng trả về toàn bộ results qua Promise của execute_query.
- Frontend nhận lại dữ liệu đã được gửi qua streaming.

Không được chỉ xóa return payload mà chưa phân tích các nơi đang sử dụng nó.

### Yêu cầu thiết kế

Xác định một nguồn dữ liệu chính thức cho kết quả truy vấn.

Đánh giá hai phương án:

A. Streaming là nguồn dữ liệu chính.

B. Return payload là nguồn dữ liệu chính.

Chọn phương án phù hợp với kiến trúc hiện tại, tránh truyền toàn bộ dữ liệu lần thứ hai.

Nếu chọn streaming làm nguồn dữ liệu chính:

- Bảo đảm tất cả batch đã được xử lý trước khi đánh dấu truy vấn hoàn thành.
- Lưu dữ liệu vào đúng tab state nếu chức năng hiện tại yêu cầu.
- Không phụ thuộc vào return payload để khôi phục dữ liệu đã streaming.
- Return payload cuối cùng chỉ chứa trạng thái, thông báo hoặc metadata thực sự cần thiết.
- Không xóa dữ liệu backend trước khi các thao tác đọc và serialize đã hoàn tất.
- Không làm hỏng Messages, Plan, trạng thái truy vấn hoặc thống kê kết quả.

Nếu cần giữ dữ liệu đầy đủ cho tính năng khác, hãy sử dụng chung nguồn dữ liệu thay vì tạo thêm bản sao không cần thiết.

Không triển khai backend paging trong giai đoạn này.

### Tương thích

Phải giữ nguyên hợp đồng API cần thiết cho các thành phần khác.

Nếu cần thay đổi response schema, phải tìm và cập nhật tất cả nơi sử dụng.

Không làm hỏng:

- SQL Server.
- PostgreSQL.
- Truy vấn đơn.
- Nhiều câu SELECT.
- Procedure trả về nhiều result set.
- Kết quả rỗng.
- Thông báo lỗi.
- Thông báo Messages.
- Trạng thái thực thi.
- Chức năng dừng truy vấn.

## 8. GIAI ĐOẠN 5: QUẢN LÝ VÒNG ĐỜI VÀ HỦY DỮ LIỆU CŨ

Kiểm tra:

- GridResultManager.
- GridResultInstance.destroy().
- VirtualGridRenderer.destroy().
- clearResults().
- cancelQuery().
- Sự kiện đóng tab editor.
- Sự kiện chuyển tab editor.
- window.onQueryProgress().

Yêu cầu:

- Không giữ event listener sau khi grid bị hủy.
- Không giữ ResizeObserver của grid đã destroy.
- Không để callback của truy vấn cũ ghi vào grid của truy vấn mới.
- Không trộn batch của hai query_id khác nhau.
- Không xóa dữ liệu của tab khác.
- Không destroy grid chỉ vì container tạm thời bị ẩn.
- Phân biệt rõ hide, reset result và destroy.

Nếu có query_id, sử dụng query_id để xác định dữ liệu streaming thuộc lần thực thi nào.

Không tự ý thay đổi cơ chế hủy truy vấn phía database nếu không cần thiết cho phạm vi này.

## 9. GIAI ĐOẠN 6: GIỮ NGUYÊN TÍNH NĂNG GRID

Sau nâng cấp, phải giữ nguyên các hành vi đang có:

- Hiển thị header.
- Hiển thị metadata cột.
- Cuộn dọc.
- Cuộn ngang.
- Resize cột.
- Lọc cột.
- Chọn ô.
- Chọn dòng nếu đã có.
- Copy dữ liệu.
- Context menu.
- Tìm kiếm trong kết quả nếu đã có.
- Định dạng NULL và dữ liệu đặc biệt.
- Hiển thị dữ liệu dài.
- Footer số dòng và thời gian.
- Messages.
- Plan.
- Chạy truy vấn mới.
- Dừng truy vấn.
- Chuyển tab editor.
- Đóng tab editor.

Không thay đổi giao diện tổng thể nếu không cần thiết.

Không được bỏ chức năng chỉ để đạt hiệu năng tốt hơn.

## 10. GIAI ĐOẠN 7: KIỂM THỬ

Không kết nối database thật và không chạy SQL trên môi trường thật.

Sử dụng mock data hoặc test harness offline nếu cần.

Kiểm thử tối thiểu:

### Test A: Một result set

- 100 dòng.
- 2.000 dòng.
- 20.000 dòng.

Xác nhận virtual scrolling hoạt động đúng.

### Test B: Nhiều result set

- 2 result set.
- 5 result set.
- 10 result set.

Xác nhận không khởi tạo grid trùng lặp và không render dữ liệu ngoài viewport.

### Test C: Resize

- Kéo splitter liên tục.
- Resize cửa sổ.
- Resize khi có nhiều grid.
- Resize khi đang nhận batch.
- Resize khi tab editor khác đang hiển thị.

Xác nhận không có vòng lặp ResizeObserver và không render grid ẩn.

### Test D: Vòng đời

- Chạy truy vấn mới khi truy vấn cũ đã hoàn tất.
- Chạy truy vấn mới khi truy vấn cũ đang stream.
- Chuyển tab editor.
- Đóng tab editor.
- Hủy truy vấn nếu chức năng hiện tại hỗ trợ.

Xác nhận không trộn dữ liệu hoặc cập nhật DOM đã bị hủy.

### Test E: Tương thích dữ liệu

- NULL.
- Chuỗi rỗng.
- Chuỗi dài.
- Boolean.
- Số.
- Ngày giờ.
- Binary.
- JSON.
- Tên cột trùng nhau nếu hệ thống hiện tại hỗ trợ.
- Result set rỗng.

Không tự ý thay đổi quy tắc serialize dữ liệu hiện tại.

## 11. ĐO HIỆU NĂNG

Nếu có thể, thêm instrumentation nhẹ trong phạm vi sửa đổi để đo:

- Số lần VirtualGridRenderer.render() được gọi.
- Số lần render do resize.
- Số lần ResizeObserver callback.
- Số dòng DOM trong rowPool.
- Số grid instance đang hoạt động.
- Thời gian render.
- Thời gian xử lý batch.
- Số lần truyền payload kết quả qua bridge.
- Kích thước payload cuối cùng.

Không để instrumentation làm thay đổi đáng kể hiệu năng.

Không ghi log toàn bộ dữ liệu truy vấn.

Ưu tiên sử dụng performance.now() cho frontend.

Có thể sử dụng time.perf_counter() cho backend nếu cần.

Nếu chưa có điều kiện đo chính xác, ghi rõ giới hạn.

## 12. TIÊU CHÍ HOÀN THÀNH

Chỉ coi là hoàn thành khi:

1. Resize không kích hoạt render lại toàn bộ dữ liệu.
2. Các grid ẩn không thực hiện render nặng.
3. Không có vòng lặp ResizeObserver.
4. Dữ liệu mới không làm khởi tạo lại grid không cần thiết.
5. Nhiều result set vẫn được hiển thị chính xác.
6. Không truyền toàn bộ payload kết quả trùng lặp nếu không còn cần thiết.
7. Không mất chức năng lưu và khôi phục kết quả hiện có.
8. Không có lỗi JavaScript hoặc Python mới.
9. Không thay đổi hành vi của SQL Server và PostgreSQL ngoài phạm vi yêu cầu.
10. Có báo cáo kiểm thử trước và sau khi nâng cấp.

## 13. BÁO CÁO SAU KHI TRIỂN KHAI

Trả về:

### A. File đã sửa

- Đường dẫn.
- Thay đổi chính.
- Lý do.

### B. Các vấn đề đã giải quyết

- Resize.
- Multiple result sets.
- Hidden grids.
- Duplicate payload.
- Memory lifecycle.

### C. Các vấn đề chưa giải quyết

Nêu rõ những phần còn cần profiling hoặc thay đổi kiến trúc lớn hơn.

### D. Kết quả kiểm thử

Phân biệt:

- Đã kiểm thử.
- Chưa kiểm thử.
- Không thể kiểm thử trong môi trường hiện tại.

### E. Rủi ro tương thích

Đặc biệt với:

- SQL Server.
- PostgreSQL.
- Multi-result sets.
- Tab state.
- Messages.
- Plan.
- Copy và filter.

### F. Thống kê hiệu năng

Báo cáo số liệu trước và sau nếu đã đo được.

Không được tuyên bố hiệu năng đã cải thiện theo một tỷ lệ cụ thể nếu chưa đo.

Bắt đầu bằng việc khảo sát source code thực tế, xác định file và hàm liên quan, sau đó mới sửa.

Không thực hiện thay đổi ngoài phạm vi đã nêu.
