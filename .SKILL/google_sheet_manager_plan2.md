# KẾ HOẠCH TÍCH HỢP CHỈNH SỬA GOOGLE SHEETS TRỰC TIẾP TRONG LLTOOL IDE

## 1. Mục tiêu

Hiện tại, LLTool IDE sử dụng URL `/htmlembed` để hiển thị nội dung Google Sheets trong Pane 3 của Workspace.

Cách triển khai hiện tại cho phép người dùng xem nội dung bảng tính nhưng không cung cấp đầy đủ giao diện chỉnh sửa của Google Sheets. Khi cần chỉnh sửa, người dùng phải mở một cửa sổ WebView2 riêng sử dụng URL `/edit`.

Mục tiêu của kế hoạch này là thay đổi cơ chế hiển thị để người dùng có thể **chỉnh sửa Google Sheets trực tiếp ngay trong Pane 3 của LLTool IDE**, không cần mở cửa sổ ứng dụng độc lập.

### 1.1. Kết quả mong muốn

* Hiển thị giao diện chỉnh sửa chính thức của Google Sheets trong Pane 3.
* Cho phép người dùng chỉnh sửa ô, công thức và định dạng theo quyền Google được cấp.
* Lưu thay đổi trực tiếp lên Google Sheets thông qua cơ chế lưu của Google.
* Tận dụng phiên đăng nhập Google hiện có nếu cấu hình WebView2 hỗ trợ.
* Đồng bộ kích thước WebView2 với Pane 3.
* Không làm ảnh hưởng đến các chức năng SQL, Workspace và những cửa sổ hiện có của LLTool IDE.
* Giữ lại cơ chế mở cửa sổ riêng hiện tại làm phương án dự phòng trong giai đoạn đầu.

## 2. Hiện trạng kỹ thuật

### 2.1. Cơ chế preview hiện tại

URL được tạo trong `view.js`, khoảng dòng 738:

```javascript
https://docs.google.com/spreadsheets/d/{spreadsheetId}/htmlembed?widget=true&headers=true&gid={gid}
```

URL này được hiển thị trong iframe thuộc:

`google_sheets_window.html`, khoảng dòng 190.

Luồng hiện tại:

```text
LLTool IDE
    |
    v
Workspace - Pane 3
    |
    v
google_sheets_window.html
    |
    v
iframe
    |
    v
Google Sheets /htmlembed
```

Cơ chế này phù hợp với việc nhúng nội dung bảng tính để xem, nhưng không cung cấp đầy đủ trải nghiệm chỉnh sửa của giao diện Google Sheets chính thức.

### 2.2. Cơ chế chỉnh sửa hiện tại

Khi người dùng mở cửa sổ độc lập, Python sử dụng `pywebview` để tạo cửa sổ WebView2 và tải URL `/edit`.

Luồng hiện tại:

```text
Python Backend
    |
    v
webview.create_window()
    |
    v
WebView2 Window
    |
    v
Google Sheets /edit
    |
    v
Giao diện chỉnh sửa chính thức
```

Cửa sổ này có thể chỉnh sửa tài liệu nếu tài khoản đã đăng nhập và có quyền chỉnh sửa.

### 2.3. Kiến trúc ứng dụng

Ứng dụng đang sử dụng:

* Python làm backend.
* `pywebview` làm lớp tích hợp giao diện desktop.
* WebView2 trên Windows.
* Backend GUI `edgechromium`.
* WinForms Message Loop chạy trên STA Thread.
* `storage_path` được truyền vào `webview.start()`.

Cần kiểm tra cấu hình thực tế để xác nhận các WebView2 có sử dụng chung profile và phiên đăng nhập Google hay không.

Không được mặc định rằng việc dùng chung `storage_path` luôn bảo đảm mọi cửa sổ có cùng trạng thái xác thực.

## 3. Giải pháp mục tiêu

### 3.1. Nguyên tắc

Thay vì cố gắng biến `/htmlembed` thành giao diện chỉnh sửa, cần sử dụng giao diện Google Sheets chính thức thông qua URL `/edit`.

Tuy nhiên, không được chỉ thay URL trong iframe hiện tại, vì Google có thể chặn việc nhúng giao diện chỉnh sửa bằng iframe thông qua `X-Frame-Options` hoặc các chính sách bảo mật liên quan.

Giải pháp cần nghiên cứu là tạo một WebView2 control có khả năng hiển thị giao diện `/edit` trực tiếp trong vùng Pane 3.

### 3.2. Kiến trúc mục tiêu

```text
LLTool IDE
    |
    v
Main Workspace
    |
    +--------------------------------+
    |                                |
    |  Pane 3                        |
    |                                |
    |  Google Sheets Host            |
    |       |                        |
    |       v                        |
    |  WebView2 Control              |
    |       |                        |
    |       v                        |
    |  Google Sheets /edit           |
    |       |                        |
    |       +-- Chỉnh sửa ô          |
    |       +-- Chỉnh sửa công thức  |
    |       +-- Định dạng dữ liệu     |
    |       +-- Thêm/xóa hàng, cột   |
    |       +-- Lưu lên Google       |
    |                                |
    +--------------------------------+
```

Google Sheets Host là thành phần chịu trách nhiệm quản lý WebView2 phục vụ việc chỉnh sửa bảng tính.

Thành phần này cần được tách biệt khỏi logic khởi tạo chính của ứng dụng.

### 3.3. Yêu cầu đối với Google Sheets Host

Google Sheets Host cần hỗ trợ:

1. Khởi tạo WebView2.
2. Tải URL Google Sheets `/edit`.
3. Hiển thị giao diện trong đúng vùng Pane 3.
4. Đồng bộ kích thước với vùng chứa.
5. Quản lý vòng đời WebView2.
6. Xử lý trạng thái tải trang và lỗi điều hướng.
7. Giữ nguyên cơ chế chỉnh sửa, xác thực và lưu dữ liệu của Google Sheets.
8. Cho phép giải phóng tài nguyên khi vùng hiển thị không còn được sử dụng.
9. Không ảnh hưởng đến các WebView2 đang phục vụ những chức năng khác.

Không tự xây dựng lại giao diện bảng tính bằng HTML hoặc JavaScript. Việc chỉnh sửa phải do giao diện Google Sheets chính thức đảm nhiệm.

## 4. Giai đoạn 1 — Audit kiến trúc hiện tại

Trước khi lập trình, cần kiểm tra mã nguồn để xác định phương án tích hợp phù hợp.

### 4.1. Các thành phần cần kiểm tra

| Thành phần                  | Nội dung kiểm tra                                                |
| --------------------------- | ---------------------------------------------------------------- |
| `main.py`                   | Cách khởi tạo ứng dụng, `webview.start()` và vòng đời cửa sổ     |
| `view.js`                   | Cách tạo URL `/htmlembed` và quản lý vùng preview                |
| `google_sheets_window.html` | Cấu trúc iframe và cách bố trí nội dung trong Pane 3             |
| `window_manager.py`         | Cách tạo cửa sổ Google Sheets bằng `webview.create_window()`     |
| Cấu hình WebView2           | Phiên bản pywebview, backend GUI và cách cấu hình `storage_path` |
| Workspace/Panes             | Cách tính kích thước, resize và quản lý vòng đời vùng hiển thị   |

Tên file và vị trí code trên là thông tin ban đầu cần đối chiếu với mã nguồn thực tế.

### 4.2. Các câu hỏi bắt buộc phải trả lời

1. Phiên bản `pywebview` đang sử dụng là phiên bản nào?
2. `pywebview` có cung cấp API công khai phù hợp để tích hợp WebView2 native vào vùng giao diện hiện tại không?
3. Có thể mở rộng hoặc tích hợp với Form/Control nội bộ mà không phụ thuộc quá nhiều vào implementation riêng của thư viện không?
4. Có thể tạo WebView2 trong STA Thread hiện tại mà không gây xung đột với WinForms Message Loop không?
5. WebView2 có thể được bố trí trực tiếp trong Pane 3 và cập nhật kích thước theo Pane không?
6. Cơ chế `storage_path` hiện tại có cho phép sử dụng lại phiên đăng nhập Google không?
7. Cần thay đổi những file nào để triển khai mà không ảnh hưởng các chức năng hiện có?

### 4.3. Đầu ra

Tạo báo cáo:

`google_sheets_edit_host_audit.md`

Báo cáo cần có:

* Kiến trúc hiện tại.
* Cách quản lý Form và WebView2.
* Khả năng tích hợp WebView2 native.
* Rủi ro tương thích với pywebview.
* Cách duy trì phiên đăng nhập.
* Danh sách file có khả năng bị ảnh hưởng.
* Đề xuất phương án triển khai.

Không triển khai tích hợp chính thức trước khi hoàn thành bước này.

## 5. Giai đoạn 2 — Xây dựng prototype WebView2 Editor Host

### 5.1. Mục tiêu

Chứng minh có thể hiển thị giao diện Google Sheets `/edit` bên trong một vùng giao diện của ứng dụng desktop, thay vì chỉ mở một cửa sổ độc lập.

Prototype cần được xây dựng tách biệt để không ảnh hưởng đến chức năng đang hoạt động.

### 5.2. Phương án kỹ thuật cần ưu tiên nghiên cứu

Ưu tiên nghiên cứu khả năng tạo hoặc tích hợp một control:

`Microsoft.Web.WebView2.WinForms.WebView2`

vào vùng chứa native phù hợp với Pane 3.

Cần xác minh cách tích hợp với kiến trúc `pywebview` hiện tại trước khi lựa chọn phương án cuối cùng.

Không mặc định rằng `webview.create_window()` có thể tự nhúng một cửa sổ mới vào phần tử HTML.

Nếu không có API công khai đáp ứng yêu cầu, cần đánh giá riêng phương án tích hợp native Windows và chi phí bảo trì của phương án đó.

### 5.3. Các bài kiểm tra prototype

| Mã  | Kiểm tra             | Tiêu chí đạt                                      |
| --- | -------------------- | ------------------------------------------------- |
| P01 | Khởi tạo WebView2    | Không gây lỗi vòng đời hoặc Message Loop          |
| P02 | Tải URL `/edit`      | Hiển thị giao diện Google Sheets chính thức       |
| P03 | Đăng nhập Google     | Đăng nhập thành công trong môi trường được hỗ trợ |
| P04 | Quyền chỉnh sửa      | Tài khoản có quyền chỉnh sửa có thể thao tác      |
| P05 | Chỉnh sửa dữ liệu    | Sửa được ô thử nghiệm                             |
| P06 | Lưu dữ liệu          | Thay đổi được Google Sheets lưu thành công        |
| P07 | Tải lại              | Thay đổi vẫn tồn tại sau khi tải lại tài liệu     |
| P08 | Đóng và khởi tạo lại | Không rò rỉ tài nguyên hoặc làm hỏng ứng dụng     |
| P09 | Đồng bộ kích thước   | WebView2 vừa khít vùng chứa                       |
| P10 | Chạy cùng Main IDE   | Các chức năng hiện tại vẫn hoạt động              |

Chỉ chuyển sang giai đoạn tích hợp khi các bài kiểm tra quan trọng đạt yêu cầu.

### 5.4. Tiêu chí loại bỏ phương án

Không tiếp tục với phương án tích hợp hiện tại nếu:

* Phải sửa sâu mã nguồn nội bộ của pywebview mà không có ranh giới bảo trì rõ ràng.
* Không thể quản lý ổn định vòng đời WebView2.
* Không thể đặt control vào đúng vùng hiển thị.
* Gây lỗi hoặc treo WinForms Message Loop.
* Không thể xác thực và chỉnh sửa Google Sheets trong môi trường mục tiêu.

Nếu gặp các trường hợp trên, cần đánh giá phương án native host khác trước khi tiếp tục.

### 5.5. Đầu ra

Tạo báo cáo:

`google_sheets_edit_host_prototype.md`

Báo cáo phải ghi rõ:

* Phương án đã thử.
* Các file thử nghiệm.
* Kết quả thực tế.
* Khả năng đăng nhập và chỉnh sửa.
* Hiệu quả resize.
* Vấn đề phát sinh.
* Phương án cuối cùng được lựa chọn.

## 6. Giai đoạn 3 — Tích hợp vào Pane 3

Chỉ triển khai sau khi prototype đạt yêu cầu.

### 6.1. Thay đổi giao diện hiển thị

Chuyển cơ chế hiển thị Google Sheets trong Pane 3 từ iframe `/htmlembed` sang Google Sheets Host đã được kiểm chứng.

Yêu cầu:

* Không sử dụng iframe để nhúng trực tiếp trang `/edit`.
* Không làm thay đổi bố cục tổng thể của Workspace.
* Không thay đổi các vùng giao diện ngoài phạm vi Google Sheets nếu không cần thiết.
* Không viết JavaScript hoặc CSS trực tiếp trong HTML.
* Tách riêng module giao diện và module backend.
* Giữ cơ chế preview hiện tại nếu cần dùng làm phương án dự phòng.

### 6.2. Quy tắc quản lý URL

URL tải giao diện chỉnh sửa sử dụng định dạng:

```text
https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit
```

Nếu cần mở một trang tính cụ thể, có thể giữ thông tin `gid`:

```text
https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit#gid={gid}
```

Cần kiểm tra và chuẩn hóa URL đầu vào trước khi điều hướng.

Không giả định rằng URL hợp lệ đồng nghĩa với việc người dùng có quyền truy cập hoặc chỉnh sửa tài liệu.

Không sử dụng URL chỉnh sửa để vượt qua cơ chế phân quyền của Google.

### 6.3. Quản lý trạng thái

Google Sheets Host cần quản lý tối thiểu các trạng thái:

* Khởi tạo.
* Đang tải tài liệu.
* Tải thành công.
* Yêu cầu đăng nhập.
* Không có quyền chỉnh sửa.
* Không thể truy cập tài liệu.
* Lỗi mạng hoặc điều hướng.
* Đang đóng.
* Đã giải phóng tài nguyên.

Các trạng thái này phải được hiển thị phù hợp với quy tắc giao diện hiện có của LLTool IDE.

Không tự động chuyển sang cửa sổ riêng mà không thông báo cho người dùng khi gặp lỗi.

## 7. Giai đoạn 4 — Xác thực và phiên đăng nhập

### 7.1. Mục tiêu

Tận dụng cơ chế lưu phiên của WebView2 khi được hỗ trợ, tránh yêu cầu đăng nhập lại không cần thiết.

### 7.2. Nội dung kiểm tra

1. Đăng nhập Google trên WebView2 hiện có.
2. Khởi tạo Editor Host.
3. Mở tài liệu `/edit`.
4. Kiểm tra trạng thái đăng nhập.
5. Đóng và mở lại Editor Host.
6. Kiểm tra trạng thái đăng nhập sau khi khởi động lại ứng dụng.
7. Kiểm tra hành vi khi phiên hết hạn.
8. Kiểm tra trường hợp tài khoản chỉ có quyền xem.
9. Kiểm tra trường hợp tài khoản không có quyền truy cập.

Không cam kết duy trì phiên đăng nhập nếu Google hoặc WebView2 yêu cầu xác thực lại.

### 7.3. Quy tắc bảo mật

* Không lưu mật khẩu Google trong cấu hình LLTool.
* Không tự trích xuất hoặc sao chép cookie, access token hay refresh token để giả lập đăng nhập.
* Không vô hiệu hóa các chính sách bảo mật của Google.
* Không cấp Python bridge của LLTool cho nội dung Google bên ngoài nếu không có yêu cầu đã được đánh giá bảo mật.
* Không ghi thông tin xác thực vào log.
* Tôn trọng quyền Viewer, Commenter và Editor do Google quản lý.

## 8. Giai đoạn 5 — Quản lý vòng đời và hiệu năng

### 8.1. Resize

WebView2 phải đồng bộ với kích thước thực tế của Pane 3.

Kiểm tra:

* Thay đổi kích thước cửa sổ chính.
* Kéo thay đổi kích thước các Pane.
* Ẩn hoặc hiện vùng chứa.
* Chuyển Workspace.
* Khôi phục cửa sổ sau khi thu nhỏ.

Không để WebView2 che lên các vùng giao diện khác hoặc tiếp tục giữ kích thước cũ.

### 8.2. Quản lý tài nguyên

Cần xác định rõ:

* Thời điểm khởi tạo WebView2.
* Thời điểm giải phóng WebView2.
* Cách xử lý khi Pane 3 bị đóng hoặc tái tạo.
* Cách xử lý khi ứng dụng thoát.
* Cách xử lý khi Google Sheets đang tải mà người dùng đóng vùng hiển thị.

Không tạo thêm WebView2 hoặc Form không cần thiết mỗi lần cập nhật giao diện.

### 8.3. Điều hướng và popup

Kiểm tra cách Google Sheets xử lý:

* Popup đăng nhập.
* Mở liên kết ngoài.
* Yêu cầu xác thực bổ sung.
* Điều hướng đến tài liệu khác.
* Tải trang lỗi.
* Thay đổi URL trong quá trình sử dụng.

Cần xác định rõ trường hợp nào được xử lý bên trong Host và trường hợp nào phải chuyển sang trình duyệt ngoài.

## 9. Giai đoạn 6 — Kiểm thử hồi quy

Việc tích hợp không được làm ảnh hưởng các chức năng hiện có của LLTool IDE.

### 9.1. Phạm vi kiểm thử

* Khởi động và đóng ứng dụng.
* Workspace và quản lý Pane.
* SQL Editor và Monaco Editor.
* Kết nối SQL Server.
* Kết nối PostgreSQL.
* Result Grid.
* Object Explorer.
* Các cửa sổ Settings và Schema Compare.
* Google Sheets preview hiện tại.
* Cơ chế mở Google Sheets bằng cửa sổ độc lập.
* Các chức năng khác sử dụng pywebview.

### 9.2. Tiêu chí đạt

* Không phát sinh lỗi khởi động.
* Không treo giao diện.
* Không gây lỗi WinForms Message Loop.
* Không làm mất cấu hình người dùng.
* Không thay đổi cơ chế kết nối database.
* Không làm hỏng các chức năng SQL hiện có.
* Không tạo cửa sổ hoặc WebView2 ngoài dự kiến.
* Có thể chỉnh sửa và lưu Google Sheets ngay trong Pane 3.
* Có phương án dự phòng nếu tích hợp trực tiếp không khả dụng.

## 10. Quy tắc phạm vi thay đổi mã nguồn

### 10.1. Nguyên tắc bắt buộc

1. Không đưa toàn bộ logic mới vào `main.py`.
2. Không nhúng CSS hoặc JavaScript trực tiếp trong HTML.
3. Tách logic Python, JavaScript và CSS thành các file độc lập.
4. Tuân thủ quy tắc cấu trúc và thiết kế giao diện hiện có của dự án.
5. Không thay đổi những module không liên quan.
6. Không xóa cơ chế mở cửa sổ Google Sheets hiện tại trước khi phương án mới hoạt động ổn định.
7. Không thay đổi dữ liệu cấu hình hoặc dữ liệu người dùng hiện có.
8. Không thực hiện thao tác database không liên quan đến tính năng này.

### 10.2. Cấu trúc module đề xuất

Đây là cấu trúc tham khảo, cần điều chỉnh sau khi audit:

```text
backend/
└── google_sheets/
    ├── manager.py
    ├── webview_host.py
    ├── url_parser.py
    └── registry.py

static/
├── js/
│   └── google-sheets/
│       ├── view.js
│       └── host.js
└── css/
    └── google-sheets/
        └── google-sheets.css

templates/
└── google-sheets.html
```

Nếu kiến trúc nhúng yêu cầu tích hợp một native control trực tiếp vào WinForms, không nên ép toàn bộ logic đó vào HTML hoặc JavaScript. Cần phân chia rõ phần native host, backend Python và frontend.

Không tạo file mới chỉ để tuân thủ máy móc cấu trúc tham khảo. Trước hết phải xác định ranh giới trách nhiệm và cách tích hợp với mã nguồn hiện tại.

## 11. Tiêu chí nghiệm thu cuối cùng

Tính năng được coi là hoàn thành khi đáp ứng các điều kiện sau:

* [ ] Google Sheets hiển thị giao diện chỉnh sửa chính thức trong Pane 3.
* [ ] Không cần mở cửa sổ ứng dụng độc lập để chỉnh sửa trong luồng sử dụng thông thường.
* [ ] Có thể sửa ô và công thức bằng giao diện Google Sheets.
* [ ] Có thể chỉnh sửa định dạng theo quyền được cấp.
* [ ] Dữ liệu được lưu trực tiếp lên Google Sheets.
* [ ] Thay đổi vẫn tồn tại sau khi tải lại tài liệu.
* [ ] Tôn trọng quyền truy cập do Google quản lý.
* [ ] Phiên đăng nhập được xử lý an toàn.
* [ ] WebView2 đồng bộ kích thước với Pane 3.
* [ ] Không gây lỗi vòng đời hoặc treo ứng dụng.
* [ ] Không làm ảnh hưởng các chức năng SQL và Workspace hiện có.
* [ ] Cơ chế mở cửa sổ riêng vẫn có thể được sử dụng làm phương án dự phòng.
* [ ] Không lưu mật khẩu hoặc tự trích xuất token đăng nhập.
* [ ] Không có thay đổi ngoài phạm vi chưa được phê duyệt.

## 12. Thứ tự thực hiện bắt buộc

Thực hiện theo đúng trình tự:

1. Audit kiến trúc pywebview, WinForms và WebView2.
2. Xác định khả năng tích hợp WebView2 native vào Pane 3.
3. Xây dựng prototype độc lập.
4. Kiểm chứng đăng nhập, quyền chỉnh sửa và lưu dữ liệu.
5. Kiểm chứng resize, vòng đời và khả năng tương thích với ứng dụng.
6. Chốt phương án kỹ thuật dựa trên kết quả prototype.
7. Tích hợp Google Sheets Host vào Pane 3.
8. Kiểm thử hồi quy các chức năng hiện có.
9. Hoàn thiện báo cáo và danh sách file đã thay đổi.

**Không được bỏ qua bước prototype để sửa trực tiếp cơ chế preview hiện tại.**

Nếu prototype cho thấy không thể tích hợp an toàn với kiến trúc pywebview hiện tại, phải báo cáo rõ nguyên nhân, các lựa chọn thay thế và tác động của từng phương án trước khi tiếp tục.

## 13. Báo cáo cần bàn giao

Sau khi hoàn thành, cần có các tài liệu:

* `google_sheets_edit_host_audit.md` — Báo cáo kiểm tra kiến trúc.
* `google_sheets_edit_host_prototype.md` — Kết quả thử nghiệm WebView2.
* `google_sheets_edit_host_implementation.md` — Mô tả triển khai thực tế.
* `google_sheets_edit_host_test_report.md` — Kết quả kiểm thử và hồi quy.

Báo cáo cuối cùng phải ghi rõ:

* Các file đã tạo.
* Các file đã sửa.
* Lý do sửa từng file.
* Cơ chế tích hợp WebView2 được lựa chọn.
* Kết quả kiểm thử chỉnh sửa và lưu.
* Các giới hạn còn tồn tại.
* Những thay đổi ngoài phạm vi ban đầu, nếu có, cùng lý do và tác động.
