# KẾ HOẠCH PHÁT TRIỂN STRUCTURED DATA VIEWER

## 1. Mục tiêu

Bổ sung chức năng xem các nội dung dữ liệu có cấu trúc như XML, JSON và các định dạng tương tự ngay trên giao diện Result Grid.

Khi câu lệnh SQL trả về một cột hoặc biến chứa dữ liệu XML/JSON, IDE cần nhận diện nội dung phù hợp và cho phép người dùng mở dữ liệu bằng hai phương thức:

1. **Mở trong tab Editor mới:** Click vào nội dung được hiển thị dạng link trong Result Grid. IDE mở một tab mới, sử dụng Monaco Editor để hiển thị dữ liệu theo đúng định dạng.
2. **Xem nhanh tại panel bên phải:** Focus vào ô dữ liệu, nhấn chuột phải và chọn chức năng xem định dạng. IDE mở một panel bên phải Result Grid, có chiều cao tương ứng với vùng Result Grid. Người dùng có thể đóng panel khi không cần sử dụng.

Các mục tiêu bổ sung:

* Không thay đổi cấu trúc dữ liệu trả về từ SQL Server hoặc PostgreSQL.
* Không ảnh hưởng đến chức năng copy, chọn ô, lọc và hiển thị dữ liệu hiện có.
* Hỗ trợ nội dung dài, dữ liệu nhiều dòng và dữ liệu XML/JSON lồng nhau.
* Có khả năng mở rộng để hỗ trợ các định dạng mới trong tương lai.

---

## 2. Phạm vi triển khai

### 2.1. Các định dạng hỗ trợ

| Định dạng  | Nhận diện      | Hiển thị      | Format code   |
| ---------- | -------------- | ------------- | ------------- |
| JSON       | Có             | Monaco Editor | Có            |
| XML        | Có             | Monaco Editor | Có            |
| SQL        | Có thể mở rộng | Monaco Editor | Có            |
| HTML       | Có thể mở rộng | Monaco Editor | Có            |
| YAML       | Có thể mở rộng | Monaco Editor | Có            |
| Plain Text | Dự phòng       | Monaco Editor | Không áp dụng |

**Giai đoạn đầu chỉ bắt buộc triển khai XML và JSON.**

Các định dạng khác chỉ được bổ sung khi có nhu cầu thực tế.

### 2.2. Nguồn dữ liệu

Chức năng cần xử lý dữ liệu từ:

* Cột kết quả của câu lệnh SELECT.
* Biến hoặc biểu thức được trả về trong SELECT.
* Cột chứa dữ liệu XML/JSON từ bảng, view hoặc function.
* Kết quả của các stored procedure/function nếu dữ liệu được trả về trong Result Grid.

Ví dụ SQL Server:

```sql
SELECT
    Id,
    Name,
    JsonData,
    XmlData
FROM dbo.Customer;
```

Ví dụ PostgreSQL:

```sql
SELECT
    id,
    name,
    json_data,
    xml_data
FROM customer;
```

Không yêu cầu người dùng phải truy vấn từ một bảng cụ thể. Chức năng phải hoạt động dựa trên dữ liệu thực tế được trả về Result Grid.

---

## 3. Thiết kế giao diện

### 3.1. Hiển thị XML/JSON dưới dạng link trong Result Grid

Khi một ô chứa nội dung được nhận diện là XML hoặc JSON hợp lệ, hiển thị giá trị dưới dạng link:

* Màu chữ xanh.
* Có gạch chân.
* Có con trỏ dạng pointer khi di chuột.
* Có tooltip cho biết định dạng được nhận diện.
* Click vào link để mở nội dung trong một tab Editor mới.

Ví dụ:

| Id | Name      | JsonData              | XmlData                         |
| -: | --------- | --------------------- | ------------------------------- |
|  1 | Product A | `{"id":1,"name":"A"}` | `<Product><Id>1</Id></Product>` |

Cách hiển thị thực tế:

* Ô `JsonData`: hiển thị link `View JSON`.
* Ô `XmlData`: hiển thị link `View XML`.

Đối với nội dung ngắn, có thể hiển thị một phần nội dung kèm link mở đầy đủ.

Đối với nội dung dài, nên ưu tiên link ngắn `View JSON` hoặc `View XML` để tránh làm tăng chiều rộng cột.

**Quy tắc quan trọng:** Chỉ biến phần nội dung được xác định là XML/JSON thành link. Không biến toàn bộ ô thành link nếu điều đó gây cản trở các thao tác chọn, copy hoặc chỉnh sửa dữ liệu hiện có.

### 3.2. Cơ chế nhận diện định dạng

Không nên chỉ dựa vào tên cột hoặc kiểu dữ liệu để kết luận nội dung là XML/JSON.

Cần kết hợp các thông tin sau:

1. Kiểu dữ liệu do driver hoặc database trả về.
2. Tên cột hoặc alias.
3. Nội dung thực tế.
4. Kết quả kiểm tra cú pháp khi cần thiết.

Ví dụ:

```sql
SELECT
    CAST('{"id":1,"name":"Product A"}' AS NVARCHAR(MAX)) AS Data;
```

Mặc dù tên cột là `Data`, IDE vẫn có thể nhận diện đây là JSON hợp lệ.

Tương tự:

```sql
SELECT
    '<Product><Id>1</Id></Product>' AS Data;
```

IDE có thể nhận diện nội dung XML hợp lệ.

Tuy nhiên, không phải chuỗi nào bắt đầu bằng `{`, `[` hoặc `<` cũng là dữ liệu XML/JSON hợp lệ.

Do đó, cần có bước kiểm tra cú pháp trước khi gắn link, hoặc chỉ kiểm tra khi người dùng yêu cầu mở dữ liệu để giảm chi phí xử lý.

### 3.3. Menu chuột phải trên ô dữ liệu

Khi người dùng focus vào một ô có nội dung XML/JSON và nhấn chuột phải, menu ngữ cảnh bổ sung các mục:

```text
Copy
Copy with Headers
-------------------------
View as JSON
View as XML
Open in New Editor Tab
-------------------------
Các chức năng hiện có...
```

Quy tắc:

* Chỉ hiển thị mục phù hợp với định dạng đã nhận diện.
* Nếu nội dung chưa được nhận diện, có thể hiển thị mục `Detect Format`.
* Nếu dữ liệu là JSON, hiển thị `View as JSON`.
* Nếu dữ liệu là XML, hiển thị `View as XML`.
* `Open in New Editor Tab` mở nội dung trong tab mới.
* Không loại bỏ hoặc ghi đè các mục chuột phải hiện có của Result Grid.

Nếu người dùng chọn `View as XML` đối với nội dung không hợp lệ, IDE phải thông báo lỗi định dạng thay vì hiển thị sai hoặc làm hỏng dữ liệu.

---

## 4. Chức năng 1: Mở XML/JSON trong tab Editor mới

### 4.1. Luồng hoạt động

1. Người dùng chạy câu lệnh SQL.
2. Result Grid hiển thị dữ liệu.
3. IDE nhận diện ô có nội dung XML/JSON.
4. Người dùng click vào link.
5. IDE lấy nội dung gốc của ô dữ liệu.
6. IDE tạo một tab Editor mới.
7. Monaco Editor được khởi tạo với ngôn ngữ tương ứng.
8. Nội dung được hiển thị theo định dạng phù hợp.

Ví dụ:

* Click `View JSON` → mở tab `JSON Viewer - JsonData`.
* Click `View XML` → mở tab `XML Viewer - XmlData`.

Tên tab nên có thể phân biệt giữa nhiều ô dữ liệu khác nhau.

Ví dụ:

```text
JSON - Customer.JsonData - Row 1
XML - Customer.XmlData - Row 2
```

Nếu dữ liệu được lấy từ một biểu thức không có tên bảng rõ ràng, sử dụng tên cột hoặc alias.

### 4.2. Cấu hình Monaco Editor

Tận dụng Monaco Editor hiện có trong IDE, không khởi tạo thêm một hệ thống editor độc lập.

Cấu hình ngôn ngữ:

| Định dạng  | Monaco language |
| ---------- | --------------- |
| JSON       | `json`          |
| XML        | `xml`           |
| SQL        | `sql`           |
| HTML       | `html`          |
| Plain Text | `plaintext`     |

Các chức năng nên có:

* Syntax highlighting.
* Format Document.
* Find.
* Copy.
* Select All.
* Hiển thị số dòng.
* Đóng tab.
* Đánh dấu tab chưa lưu nếu người dùng chỉnh sửa nội dung.

### 4.3. Quy tắc bảo toàn dữ liệu

Nội dung hiển thị ban đầu phải được lấy từ giá trị gốc mà Result Grid nhận được.

Không tự ý:

* Thay đổi encoding.
* Loại bỏ khoảng trắng trong chuỗi.
* Thay đổi giá trị null thành chuỗi rỗng.
* Chuyển đổi số thành chuỗi theo cách làm mất thông tin.
* Escape XML/JSON thêm lần nữa.

Đối với JSON, cần giữ nguyên các giá trị chuỗi và cấu trúc dữ liệu.

Đối với XML, cần giữ nguyên nội dung văn bản và các ký tự có ý nghĩa trong tài liệu.

Nếu người dùng sử dụng Format Document, chỉ thay đổi cách trình bày của nội dung trong Editor; không được tự động ghi ngược vào database.

**Phạm vi ban đầu:** Viewer chỉ đọc dữ liệu nguồn. Việc chỉnh sửa, lưu file và cập nhật trực tiếp dữ liệu trong database không thuộc phạm vi triển khai.

---

## 5. Chức năng 2: Quick Viewer ở bên phải Result Grid

### 5.1. Mục tiêu

Cho phép người dùng xem XML/JSON mà không cần mở tab mới và không phải chuyển khỏi Result Grid.

Khi người dùng chọn:

```text
Right-click → View as JSON
```

IDE mở một panel xem nhanh ở bên phải vùng Result Grid.

### 5.2. Bố cục giao diện

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Query Editor                                                         │
├──────────────────────────────────────────────────────────────────────┤
│ Result 1 | Result 2 | Messages                                       │
├────────────────────────────────────┬─────────────────────────────────┤
│                                    │ JSON Viewer                  [×]│
│             RESULT GRID            ├─────────────────────────────────┤
│                                    │                                 │
│  Id  Name     JsonData             │ {                               │
│  1   Product  View JSON            │   "id": 1,                      │
│  2   Product  View JSON            │   "name": "Product A"            │
│                                    │ }                               │
│                                    │                                 │
│                                    │                                 │
├────────────────────────────────────┴─────────────────────────────────┤
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

Bố cục trên là mô hình logic. Vị trí triển khai thực tế phải dựa trên cấu trúc Result Grid hiện có.

### 5.3. Quy tắc hiển thị

* Panel nằm bên phải Result Grid.
* Chiều cao bằng vùng Result Grid.
* Chiều rộng mặc định khoảng 35% vùng Result Grid.
* Chiều rộng có thể điều chỉnh bằng thao tác kéo đường phân cách.
* Có nút đóng `[×]`.
* Khi mở panel, Result Grid thu hẹp theo chiều ngang.
* Khi đóng panel, Result Grid trở về kích thước trước đó.
* Không làm thay đổi kích thước hoặc vị trí của Query Editor.
* Panel phải tương thích với nhiều tab Result hiện có.

Nếu màn hình quá hẹp, có thể chuyển sang chế độ panel phủ lên Result Grid thay vì ép grid xuống chiều rộng quá nhỏ.

### 5.4. Nội dung panel

Phần đầu panel:

```text
JSON Viewer
Source: JsonData | Row: 1

[Format] [Copy] [Open in Tab] [×]
```

Chức năng:

* `Format`: định dạng lại nội dung theo chuẩn JSON/XML.
* `Copy`: copy toàn bộ nội dung gốc hoặc nội dung đang hiển thị theo quy ước rõ ràng.
* `Open in Tab`: mở cùng nội dung trong một tab Editor mới.
* `×`: đóng panel.

Bên dưới là Monaco Editor với ngôn ngữ phù hợp.

### 5.5. Hành vi khi người dùng chọn ô khác

Nếu Quick Viewer đang mở và người dùng chọn một ô XML/JSON khác, IDE cần cập nhật nội dung xem nhanh theo lựa chọn mới.

Ví dụ:

1. Người dùng mở `JsonData` của dòng 1.
2. Quick Viewer hiển thị JSON dòng 1.
3. Người dùng click phải vào `XmlData` của dòng 2.
4. Chọn `View as XML`.
5. Quick Viewer chuyển sang hiển thị XML dòng 2.

Nếu người dùng chọn ô không có nội dung XML/JSON, không tự động xóa nội dung đang xem. Chỉ thay đổi nội dung khi có thao tác mở rõ ràng, tránh gây mất ngữ cảnh.

### 5.6. Đóng và khôi phục panel

Khi người dùng đóng panel:

* Giải phóng hoặc ngừng sử dụng các tài nguyên không cần thiết.
* Khôi phục chiều rộng Result Grid.
* Không đóng các tab Editor khác.
* Không ảnh hưởng đến kết quả SQL hiện có.

Trong giai đoạn đầu, trạng thái panel chỉ cần tồn tại trong phiên làm việc hiện tại. Có thể bổ sung tùy chọn ghi nhớ trạng thái đóng/mở ở các phiên sau.

---

## 6. Kiến trúc kỹ thuật

### 6.1. Nguyên tắc thiết kế

Tận dụng kiến trúc hiện tại của IDE:

* Python backend.
* PyWebView.
* HTML/CSS/JavaScript frontend.
* Result Grid hiện có.
* Monaco Editor hiện có.
* Hệ thống quản lý tab hiện có.

Không xây dựng lại Result Grid chỉ để bổ sung XML/JSON Viewer.

Không yêu cầu backend truy vấn lại database khi người dùng mở nội dung từ một ô đã có trong kết quả.

### 6.2. Các thành phần cần bổ sung

#### A. `StructuredDataDetector`

Nhiệm vụ:

* Nhận diện XML/JSON.
* Kiểm tra cú pháp khi cần thiết.
* Phân loại định dạng.
* Trả về kết quả nhận diện để Result Grid sử dụng.

Đầu vào logic:

```javascript
{
    value: "<Product><Id>1</Id></Product>",
    columnName: "XmlData",
    databaseType: "sqlserver"
}
```

Kết quả logic:

```javascript
{
    detected: true,
    format: "xml",
    valid: true
}
```

Đây là ví dụ về hợp đồng dữ liệu, không bắt buộc phải dùng nguyên tên class hoặc cấu trúc trên.

#### B. `StructuredDataViewer`

Nhiệm vụ:

* Nhận nội dung từ ô dữ liệu.
* Xác định ngôn ngữ Monaco.
* Quản lý nội dung đang xem.
* Hỗ trợ Format, Copy và Open in Tab.

Viewer phải độc lập với cách dữ liệu được lấy từ SQL Server hoặc PostgreSQL.

#### C. `StructuredDataTabManager`

Nhiệm vụ:

* Tạo tab Editor mới.
* Đặt tên tab.
* Khởi tạo Monaco Editor theo định dạng.
* Quản lý nhiều tab XML/JSON.
* Đóng tab mà không ảnh hưởng đến tab SQL.

Nên tái sử dụng tab manager hiện tại. Chỉ bổ sung metadata để phân biệt tab XML/JSON với tab SQL thông thường.

#### D. `ResultGridContextMenu`

Nhiệm vụ:

* Bổ sung các mục menu ngữ cảnh.
* Nhận biết ô đang được focus.
* Lấy đúng giá trị của ô được chọn.
* Mở Quick Viewer hoặc tab Editor.

Phải tương thích với thư viện grid đang được sử dụng. Không giả định Result Grid đã sử dụng AG Grid nếu chưa được xác nhận.

#### E. `StructuredDataPanel`

Nhiệm vụ:

* Quản lý panel bên phải Result Grid.
* Điều chỉnh chiều rộng.
* Xử lý đóng/mở.
* Đồng bộ nội dung với ô được chọn.
* Quản lý vòng đời Monaco Editor trong panel.

### 6.3. Luồng dữ liệu

```text
SQL Server / PostgreSQL
          |
          v
Existing Query Execution
          |
          v
Existing Result Processing
          |
          v
Existing Result Grid
          |
          v
Structured Data Detection
          |
          +----------------------+
          |                      |
          v                      v
      Click Link             Right-click
          |                      |
          v                      v
    Editor Tab Manager     Quick Viewer Panel
          |                      |
          +-----------+----------+
                      |
                      v
                Monaco Editor
```

**Lưu ý:** Structured Data Detection chỉ xử lý dữ liệu đã được trả về Result Grid. Không tạo thêm truy vấn database chỉ để kiểm tra định dạng.

---

## 7. Quy tắc xử lý dữ liệu và hiệu năng

### 7.1. Không kiểm tra toàn bộ dữ liệu một cách đồng bộ

Result Grid có thể trả về hàng nghìn dòng.

Nếu kiểm tra cú pháp XML/JSON cho từng ô ngay khi tải dữ liệu, giao diện có thể bị chậm.

Do đó, áp dụng chiến lược theo giai đoạn:

**Giai đoạn 1: Nhận diện sơ bộ**

* Kiểm tra giá trị null.
* Kiểm tra kiểu dữ liệu nếu có.
* Kiểm tra tên cột hoặc alias.
* Kiểm tra dấu hiệu ban đầu của XML/JSON.

**Giai đoạn 2: Xác thực khi cần thiết**

* Khi người dùng click link hoặc chọn chức năng xem.
* Kiểm tra cú pháp để xác định nội dung có hợp lệ hay không.
* Trả về lỗi dễ hiểu nếu nội dung không hợp lệ.

Nếu dữ liệu đã được xác thực, có thể lưu kết quả nhận diện trong cache của phiên Result Grid.

### 7.2. Xử lý dữ liệu lớn

Không tạo Monaco Editor cho mọi ô trong grid.

Chỉ khởi tạo Monaco khi:

* Người dùng mở Quick Viewer.
* Người dùng mở tab Editor mới.

Đối với dữ liệu lớn:

* Không format tự động khi mở.
* Hiển thị nội dung nguyên bản trước.
* Chỉ format khi người dùng yêu cầu.
* Có thể giới hạn kích thước nội dung được mở trong Viewer.
* Nếu vượt giới hạn, thông báo rõ và không làm treo giao diện.

Giới hạn kích thước cần cấu hình được thay vì đặt cố định trong mã nguồn.

### 7.3. Bảo toàn giá trị gốc

Không dùng nội dung đã format để ghi đè dữ liệu của Result Grid.

Cần phân biệt:

* `originalValue`: giá trị gốc từ kết quả SQL.
* `displayValue`: nội dung đang hiển thị trong Viewer.
* `formattedValue`: nội dung đã được format, nếu có.

Ba giá trị này không được tự động đồng nhất với nhau.

---

## 8. Tương thích SQL Server và PostgreSQL

### 8.1. SQL Server

Cần xem xét các kiểu dữ liệu:

* `xml`
* `nvarchar(max)`
* `varchar(max)`
* Các kiểu chuỗi có thể chứa JSON.

SQL Server không có kiểu dữ liệu JSON riêng tương đương kiểu `xml`; JSON thường được lưu dưới dạng chuỗi.

Vì vậy, không thể dựa hoàn toàn vào kiểu dữ liệu để nhận diện JSON.

### 8.2. PostgreSQL

Cần xem xét:

* `json`
* `jsonb`
* `xml`
* `text`
* `varchar`
* Các biểu thức trả về chuỗi.

Với `json` và `jsonb`, IDE có thể sử dụng metadata kiểu dữ liệu để nhận diện chính xác hơn.

Với `text` và `varchar`, cần sử dụng cơ chế nhận diện nội dung.

### 8.3. Chuẩn hóa giao diện

Dù kết nối SQL Server hay PostgreSQL, người dùng vẫn sử dụng cùng một giao diện:

```text
Result Grid
    |
    +-- View JSON
    |
    +-- View XML
    |
    +-- Open in New Editor Tab
```

Không để logic nhận diện dữ liệu phụ thuộc trực tiếp vào tên hệ quản trị cơ sở dữ liệu.

Chỉ phần lấy metadata kiểu dữ liệu cần có adapter riêng cho từng database.

---

## 9. Xử lý các trường hợp đặc biệt

| Trường hợp                         | Hành vi mong muốn                                       |
| ---------------------------------- | ------------------------------------------------------- |
| Giá trị NULL                       | Không hiển thị link                                     |
| Chuỗi rỗng                         | Không hiển thị link                                     |
| JSON hợp lệ                        | Cho phép mở JSON Viewer                                 |
| XML hợp lệ                         | Cho phép mở XML Viewer                                  |
| Chuỗi giống JSON nhưng sai cú pháp | Không tự động xác nhận là JSON hợp lệ                   |
| Chuỗi văn bản thông thường         | Hiển thị như hiện tại                                   |
| XML/JSON nhiều dòng                | Hiển thị đầy đủ trong Viewer                            |
| Nội dung quá lớn                   | Thông báo giới hạn phù hợp                              |
| Nội dung chứa Unicode tiếng Việt   | Hiển thị chính xác                                      |
| Nội dung có ký tự đặc biệt         | Không làm hỏng dữ liệu khi hiển thị                     |
| Kết quả có nhiều Result Grid       | Viewer lấy đúng dữ liệu từ grid nguồn                   |
| Người dùng chạy lại SQL            | Không dùng nhầm dữ liệu của kết quả cũ                  |
| Người dùng đóng tab nguồn          | Không để Viewer tham chiếu đến dữ liệu đã bị giải phóng |
| Nội dung không hợp lệ              | Hiển thị thông báo lỗi phù hợp                          |
| Người dùng đóng Quick Viewer       | Khôi phục chiều rộng Result Grid                        |

Đặc biệt, dữ liệu phải được xử lý an toàn khi đưa vào DOM. Không chèn trực tiếp nội dung XML/JSON từ database bằng `innerHTML`; ưu tiên truyền dữ liệu qua API của ứng dụng và sử dụng `textContent` hoặc cơ chế tương đương.

---

## 10. Các giai đoạn triển khai

### Giai đoạn 1: Khảo sát kiến trúc hiện tại

Mục tiêu: Xác định chính xác vị trí tích hợp.

Công việc:

1. Xác định thành phần nhận kết quả từ `/api/query/execute`.
2. Xác định cấu trúc dữ liệu của Result Grid.
3. Xác định cách xử lý click, focus và chuột phải.
4. Xác định cơ chế quản lý tab Editor.
5. Xác định cách khởi tạo và hủy Monaco Editor.
6. Xác định cơ chế bố trí Result Grid và các tab Result.
7. Kiểm tra sự khác nhau giữa kết quả SQL Server và PostgreSQL.

**Điều kiện hoàn thành:** Có sơ đồ luồng dữ liệu và danh sách file cần chỉnh sửa, không thay đổi mã nguồn ngoài phạm vi.

### Giai đoạn 2: Xây dựng cơ chế nhận diện XML/JSON

Công việc:

1. Xây dựng bộ nhận diện định dạng.
2. Hỗ trợ XML và JSON.
3. Xử lý NULL, chuỗi rỗng và nội dung không hợp lệ.
4. Bổ sung metadata kiểu dữ liệu từ database khi có sẵn.
5. Không thực hiện kiểm tra cú pháp nặng trên toàn bộ grid.
6. Kiểm tra với dữ liệu SQL Server và PostgreSQL.

**Điều kiện hoàn thành:** Có thể phân loại đúng các trường hợp kiểm thử và không làm chậm đáng kể việc hiển thị Result Grid.

### Giai đoạn 3: Hiển thị link và mở tab Editor

Công việc:

1. Bổ sung cách hiển thị link trong ô phù hợp.
2. Đảm bảo link không phá vỡ thao tác copy và chọn ô.
3. Tích hợp menu chuột phải.
4. Tạo tab Editor mới.
5. Khởi tạo Monaco theo ngôn ngữ XML/JSON.
6. Bổ sung Format, Find và Copy.
7. Xử lý tên tab trùng nhau.

**Điều kiện hoàn thành:** Người dùng có thể mở dữ liệu XML/JSON từ bất kỳ ô phù hợp nào trong Result Grid.

### Giai đoạn 4: Xây dựng Quick Viewer

Công việc:

1. Tạo panel bên phải Result Grid.
2. Bổ sung nút đóng.
3. Bổ sung cơ chế thay đổi chiều rộng.
4. Tích hợp Monaco Editor.
5. Đồng bộ dữ liệu từ ô được chọn.
6. Bổ sung Format, Copy và Open in Tab.
7. Khôi phục bố cục khi đóng panel.

**Điều kiện hoàn thành:** Quick Viewer hoạt động độc lập với Query Editor và không làm mất kết quả SQL hiện tại.

### Giai đoạn 5: Tối ưu hiệu năng và xử lý lỗi

Công việc:

1. Kiểm tra Result Grid có 1.000 và 10.000 dòng.
2. Kiểm tra dữ liệu XML/JSON có kích thước lớn.
3. Đánh giá chi phí nhận diện định dạng.
4. Bổ sung cache nếu cần thiết.
5. Kiểm tra vòng đời Monaco Editor.
6. Kiểm tra bộ nhớ khi mở và đóng Viewer nhiều lần.
7. Xử lý việc chạy lại SQL và chuyển đổi Result Grid.

**Điều kiện hoàn thành:** Không xuất hiện lỗi giao diện, dữ liệu sai nguồn hoặc rò rỉ tài nguyên trong các kịch bản sử dụng thông thường.

### Giai đoạn 6: Kiểm thử hồi quy và hoàn thiện

Kiểm tra:

* Copy một ô.
* Copy nhiều ô.
* Copy có header.
* Chuyển đổi giữa các Result Grid.
* Đóng/mở tab Editor.
* Chạy lại SQL.
* Kết nối lại database.
* Dữ liệu XML/JSON có Unicode.
* Dữ liệu có kích thước lớn.
* Menu chuột phải hiện có.
* Các thao tác resize và đóng panel.

**Điều kiện hoàn thành:** Chức năng mới không làm suy giảm các chức năng hiện có của IDE.

---

## 11. Tiêu chí nghiệm thu

| Mã   | Tiêu chí                    | Kết quả mong muốn                        |
| ---- | --------------------------- | ---------------------------------------- |
| TC01 | SELECT trả về JSON hợp lệ   | Hiển thị link View JSON                  |
| TC02 | SELECT trả về XML hợp lệ    | Hiển thị link View XML                   |
| TC03 | Click View JSON             | Mở tab Monaco JSON                       |
| TC04 | Click View XML              | Mở tab Monaco XML                        |
| TC05 | Chuột phải trên ô JSON      | Có tùy chọn View as JSON                 |
| TC06 | Chuột phải trên ô XML       | Có tùy chọn View as XML                  |
| TC07 | Chọn View as JSON           | Mở Quick Viewer bên phải                 |
| TC08 | Đóng Quick Viewer           | Result Grid khôi phục kích thước         |
| TC09 | Chọn ô khác và yêu cầu xem  | Viewer hiển thị đúng ô mới               |
| TC10 | Chạy lại SQL                | Không hiển thị nhầm dữ liệu cũ           |
| TC11 | Dữ liệu NULL                | Không có link xem định dạng              |
| TC12 | Nội dung không hợp lệ       | Có thông báo lỗi rõ ràng                 |
| TC13 | Copy dữ liệu                | Không làm thay đổi hành vi copy hiện tại |
| TC14 | Dữ liệu Unicode             | Hiển thị chính xác                       |
| TC15 | Dữ liệu lớn                 | Không làm treo giao diện                 |
| TC16 | PostgreSQL JSON/JSONB       | Nhận diện theo metadata phù hợp          |
| TC17 | SQL Server XML              | Nhận diện theo metadata phù hợp          |
| TC18 | Mở và đóng Viewer nhiều lần | Không phát sinh lỗi vòng đời Monaco      |

---

## 12. Nguyên tắc giới hạn phạm vi thay đổi

Không thực hiện các thay đổi sau trong giai đoạn đầu:

* Không thay thế thư viện Result Grid hiện tại.
* Không thay đổi API thực thi SQL nếu không cần thiết.
* Không sửa cấu trúc dữ liệu kết quả trả về từ backend chỉ để phục vụ Viewer.
* Không khởi tạo Monaco Editor cho mọi ô trong grid.
* Không tự động ghi dữ liệu đã chỉnh sửa trở lại database.
* Không tự động format nội dung ngay khi mở.
* Không thay đổi cơ chế quản lý tab SQL hiện tại.
* Không thay đổi giao diện Query Editor ngoài phần bố trí panel liên quan trực tiếp đến Result Grid.

Mọi thay đổi cần được giới hạn trong các thành phần nhận diện dữ liệu, render ô, menu chuột phải, quản lý tab và bố cục Result Grid.

Nếu cần sửa thành phần dùng chung, phải phân tích tác động trước khi triển khai.

---

## 13. Kết quả kỳ vọng

Sau khi hoàn thành, người dùng có thể:

1. Chạy SELECT trả về dữ liệu XML/JSON.
2. Nhận biết các ô có nội dung XML/JSON qua link màu xanh, gạch chân.
3. Click để mở nội dung trong tab Monaco Editor mới.
4. Nhấn chuột phải để mở nhanh nội dung ở panel bên phải Result Grid.
5. Format, tìm kiếm và copy nội dung.
6. Đóng panel và quay lại toàn bộ vùng Result Grid.
7. Sử dụng cùng một cơ chế với SQL Server và PostgreSQL.
8. Tiếp tục sử dụng các tính năng Result Grid hiện tại mà không bị ảnh hưởng.

**Định hướng kiến trúc:** Structured Data Viewer là một lớp chức năng bổ sung cho Result Grid hiện có, tận dụng Monaco Editor và hệ thống quản lý tab hiện tại. Cách thiết kế này cho phép mở rộng sang HTML, YAML và các định dạng khác mà không phải xây dựng lại kiến trúc Result Grid.
