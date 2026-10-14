# KẾ HOẠCH TRIỂN KHAI DESIGN VIEW — IDE SQL LITE

## 1. MỤC TIÊU

Xây dựng chức năng Design View cho IDE SQL Lite, cho phép người dùng thiết kế và chỉnh sửa truy vấn SQL bằng giao diện trực quan.

Sử dụng D3.js để biểu diễn các bảng và quan hệ giữa chúng. Người dùng có thể kéo thả bảng, cột, tạo JOIN, chỉnh sửa điều kiện và sinh SQL tương ứng.

Chức năng phải hỗ trợ ba chế độ:

* **Code View:** Chỉ hiển thị SQL Editor.
* **Design View:** Chỉ hiển thị giao diện thiết kế.
* **Split View:** Hiển thị đồng thời SQL Editor và giao diện thiết kế.

Phạm vi hỗ trợ hai hệ quản trị:

* Microsoft SQL Server.
* PostgreSQL.

### Nguyên tắc quan trọng

1. Tích hợp vào kiến trúc IDE hiện tại, không xây dựng một IDE độc lập.
2. Tái sử dụng SQL Editor, Connection Manager, Object Explorer và cơ chế quản lý tab.
3. Không tự động thực thi SQL khi chỉnh sửa thiết kế.
4. Không tự động lưu hoặc thay đổi View trong database.
5. Không làm mất nội dung SQL gốc khi parser gặp cú pháp không hỗ trợ.
6. Mọi thay đổi thiết kế phải được phản ánh vào Query Model trước khi sinh SQL.
7. Chỉ cho phép chỉnh sửa trực quan đầy đủ đối với các cấu trúc SQL đã được xác định là hỗ trợ.
8. Không sử dụng regex làm phương pháp chính để phân tích SQL phức tạp.

---

# 2. PHẠM VI ẢNH HƯỞNG

Trước khi sửa code, Agent phải khảo sát kiến trúc hiện tại và xác định chính xác các module cần tích hợp.

Các khu vực dự kiến chịu ảnh hưởng:

* SQL Editor và thanh công cụ.
* Tab management.
* Object Explorer.
* Metadata Service.
* SQL Parser.
* SQL Generator.
* Cơ chế đồng bộ trạng thái editor.
* CSS và JavaScript frontend.
* Backend Python giao tiếp với database.

Không tự ý thay đổi các module sau nếu không thực sự cần thiết:

* Result Grid.
* IntelliSense.
* Syntax Highlighting.
* Connection Manager.
* Cơ chế thực thi SQL.
* Cơ chế quản lý cấu hình và dữ liệu người dùng.
* Hệ thống quản lý tab hiện có.

Nếu cần thay đổi kiến trúc hoặc sửa module ngoài phạm vi trên, Agent phải mô tả lý do, phạm vi ảnh hưởng và phương án thay thế trước khi thực hiện.

---

# 3. KIẾN TRÚC TỔNG THỂ

## 3.1. Luồng xử lý

```text
                    SQL EDITOR
                        |
                        v
                  SQL PARSER
                        |
                        v
                    QUERY MODEL
                    /         \
                   /           \
                  v             v
          DESIGN CONTROLLER   SQL GENERATOR
                  |             |
                  v             v
              D3.JS VIEW     SQL EDITOR
                  |
                  v
             USER ACTIONS
                  |
                  v
              QUERY MODEL
```

Các thành phần phải được tách biệt.

### SQL Editor Adapter

Đảm nhiệm:

* Đọc SQL từ editor hiện tại.
* Cập nhật nội dung SQL.
* Lấy vùng SQL đang chọn nếu cần.
* Theo dõi trạng thái thay đổi.
* Giữ nguyên editor instance và trạng thái tab.

Không tạo thêm SQL Editor mới cho Design View.

### SQL Parser Service

Đảm nhiệm:

* Phân tích SQL thành cấu trúc có thể xử lý.
* Xác định bảng, alias, cột, JOIN và các điều kiện truy vấn.
* Phát hiện cú pháp chưa được hỗ trợ.
* Giữ lại các thành phần SQL chưa được chuyển đổi trực quan.

### Query Model

Đóng vai trò là mô hình dữ liệu trung gian giữa SQL và giao diện thiết kế.

Mọi thao tác trên canvas phải cập nhật Query Model trước khi sinh SQL.

### SQL Generator

Đảm nhiệm:

* Sinh SQL theo dialect hiện tại.
* Quản lý cách trích dẫn tên bảng, schema, alias và cột.
* Sinh JOIN và điều kiện ON.
* Sinh các phần SELECT, WHERE, GROUP BY, HAVING và ORDER BY trong phạm vi hỗ trợ.

### D3 Renderer

Đảm nhiệm:

* Hiển thị bảng và cột.
* Hiển thị quan hệ JOIN.
* Xử lý kéo thả node.
* Zoom, pan và lựa chọn đối tượng.
* Cập nhật sơ đồ khi Query Model thay đổi.

D3.js không được trực tiếp phân tích SQL hoặc tự sinh câu SQL.

---

# 4. THIẾT KẾ GIAO DIỆN

## 4.1. Thanh công cụ

Bổ sung các nút:

* Code.
* Design.
* Split.
* Refresh Design.
* Generate SQL.
* Validate.
* Undo.
* Redo.

Tận dụng thanh công cụ hiện có nếu phù hợp.

Không tạo thanh công cụ mới làm thay đổi bố cục tổng thể của IDE khi không cần thiết.

## 4.2. Code View

Chỉ hiển thị SQL Editor hiện có.

Các chức năng SQL hiện tại phải tiếp tục hoạt động bình thường.

## 4.3. Design View

Chia thành hai khu vực chính:

### Khu vực trung tâm

Hiển thị canvas thiết kế bằng SVG và D3.js.

Các thành phần:

* Table Node.
* Column Node hoặc danh sách cột trong Table Node.
* Join Edge.
* Vùng chọn cột SELECT.
* Khu vực cấu hình điều kiện truy vấn.

### Panel bên phải

Hiển thị danh sách đối tượng theo database/schema đang kết nối.

Cấu trúc đề xuất:

```text
Database Objects
├── Search
├── Tables
│   ├── B20Customer
│   │   ├── Id
│   │   ├── Name
│   │   └── CustomerCode
│   └── B30SalesOrder
│       ├── Id
│       ├── CustomerId
│       └── OrderDate
└── Views
    └── ...
```

Hỗ trợ:

* Tìm kiếm bảng và cột.
* Mở rộng/thu gọn bảng.
* Kéo bảng vào canvas.
* Kéo cột vào vùng SELECT.
* Kéo cột này sang cột khác để tạo quan hệ JOIN.
* Hiển thị thông tin PK/FK khi metadata có sẵn.

## 4.4. Split View

Hiển thị đồng thời:

* SQL Editor.
* Design Canvas.
* Panel danh sách đối tượng bên phải.

Cho phép thay đổi tỷ lệ giữa SQL Editor và canvas.

Khi chuyển đổi chế độ, phải giữ lại:

* Nội dung SQL.
* Kết nối hiện tại.
* Database/schema.
* Trạng thái tab.
* Query Model.
* Vị trí các bảng trên canvas nếu mô hình chưa thay đổi.

Không tự động chạy SQL khi chuyển chế độ.

---

# 5. QUERY MODEL

Thiết kế một mô hình truy vấn độc lập với giao diện.

## 5.1. Table Node

Mỗi bảng có các thuộc tính:

* id.
* database.
* schema.
* tableName.
* alias.
* sourceType.
* columns.
* selectedColumns.
* x.
* y.
* isExpanded.

`id` phải là định danh duy nhất trong mô hình, không sử dụng tên bảng làm định danh duy nhất.

Lý do: một bảng có thể xuất hiện nhiều lần trong truy vấn với các alias khác nhau.

Ví dụ:

```sql
SELECT
    e.Name,
    m.Name AS ManagerName
FROM dbo.Employee AS e
LEFT JOIN dbo.Employee AS m
    ON e.ManagerId = m.Id;
```

Ở ví dụ này, hai Table Node phải được phân biệt theo alias `e` và `m`.

## 5.2. Join Edge

Các thuộc tính:

* id.
* sourceTableId.
* targetTableId.
* joinType.
* conditions.
* isInferred.

`joinType` hỗ trợ:

* INNER.
* LEFT.
* RIGHT.
* FULL.
* CROSS.

`conditions` phải hỗ trợ nhiều điều kiện ON.

Không mặc định quan hệ khóa ngoại trong database luôn tương đương với JOIN đang có trong SQL.

## 5.3. Query Model

Các thuộc tính:

* dialect.
* originalSql.
* selectItems.
* fromSources.
* joins.
* whereConditions.
* groupByItems.
* havingConditions.
* orderByItems.
* distinct.
* limitConfiguration.
* ctes.
* subqueries.
* unsupportedFragments.
* parseStatus.
* syncStatus.

Các thành phần chưa được hỗ trợ trực quan phải được giữ nguyên hoặc được đánh dấu rõ ràng để ngăn việc sinh lại SQL gây mất ngữ nghĩa.

## 5.4. Quy tắc cập nhật

Mọi thao tác thiết kế phải tuân theo:

```text
User Action
    |
    v
Update Query Model
    |
    v
Validate Model
    |
    v
Generate SQL
    |
    v
Update SQL Editor
    |
    v
Update Sync Status
```

Nếu bước kiểm tra hoặc sinh SQL thất bại, không ghi đè SQL hiện tại bằng nội dung không hoàn chỉnh.

---

# 6. D3.JS — TABLE RELATIONSHIP DESIGNER

## 6.1. Công nghệ

Sử dụng:

* D3.js Selection.
* D3.js Drag.
* D3.js Zoom.
* D3.js Force Simulation nếu cần auto-layout.
* SVG để vẽ bảng và đường JOIN.

Agent phải kiểm tra thư viện hiện có trước khi bổ sung phiên bản mới.

Ưu tiên lưu thư viện frontend cần thiết trong thư mục static/vendor để phù hợp với ứng dụng PyWebView và môi trường mạng nội bộ.

## 6.2. Table Node

Mỗi bảng hiển thị:

* Tên bảng.
* Alias.
* Danh sách cột.
* Kiểu dữ liệu nếu có.
* Biểu tượng PK/FK.
* Checkbox chọn cột.
* Nút mở rộng/thu gọn.

Các cột đang được sử dụng trong SELECT phải có trạng thái trực quan khác với các cột chưa được chọn.

## 6.3. Relationship Edge

Đường JOIN cần hiển thị được:

* Bảng nguồn.
* Bảng đích.
* Cột tham gia JOIN.
* Loại JOIN.
* Trạng thái quan hệ.

Khi người dùng chọn đường nối, hiển thị panel thuộc tính JOIN.

Không bắt buộc hiển thị toàn bộ biểu thức ON trực tiếp trên canvas. Có thể hiển thị thông tin rút gọn và mở panel chi tiết khi được chọn.

## 6.4. Tương tác

Hỗ trợ:

* Kéo node.
* Zoom.
* Pan.
* Chọn node.
* Chọn cột.
* Kéo cột sang cột khác.
* Tạo JOIN.
* Xóa JOIN.
* Chỉnh sửa JOIN.
* Thu gọn/mở rộng bảng.
* Auto-layout.
* Undo/Redo.

Xóa JOIN không đồng nghĩa với xóa bảng khỏi Query Model.

Xóa bảng phải xử lý các JOIN, SELECT item và điều kiện tham chiếu đến bảng đó.

Nếu thao tác có thể làm mất nhiều dữ liệu truy vấn, cần xác nhận hoặc cung cấp Undo.

---

# 7. KÉO THẢ BẢNG VÀ CỘT

## 7.1. Kéo bảng từ panel bên phải

Khi bảng được kéo vào canvas:

1. Nhận định danh database/schema/table.
2. Lấy metadata cột.
3. Tạo Table Node.
4. Hiển thị bảng trên canvas.
5. Cập nhật Query Model.
6. Sinh SQL nếu mô hình hợp lệ.

Nếu chưa có bảng nguồn, bảng mới có thể trở thành nguồn FROM đầu tiên.

Nếu truy vấn đã có bảng nguồn, không tự tạo JOIN chỉ dựa trên vị trí của bảng.

Nếu có metadata khóa ngoại, có thể gợi ý quan hệ JOIN để người dùng xác nhận.

## 7.2. Kéo cột vào SELECT

Khi người dùng kéo cột vào vùng SELECT:

1. Xác định bảng nguồn và alias.
2. Kiểm tra bảng có tồn tại trong truy vấn.
3. Nếu chưa có, yêu cầu thêm bảng hoặc xác nhận thao tác.
4. Thêm cột vào selectItems.
5. Sinh SQL.
6. Cập nhật editor.

Phải hỗ trợ chọn nhiều cột và thay đổi thứ tự cột.

## 7.3. Kéo cột để tạo JOIN

Khi kéo cột từ bảng A sang cột bảng B:

1. Xác định hai Table Node.
2. Tạo Join Edge ở trạng thái chưa xác nhận.
3. Đề xuất điều kiện ON.
4. Mặc định đề xuất INNER JOIN.
5. Hiển thị hộp thoại hoặc panel chỉnh sửa.
6. Xác nhận trước khi cập nhật Query Model.
7. Sinh SQL sau khi kiểm tra hợp lệ.

Không tự tạo JOIN dựa trên tên cột giống nhau.

---

# 8. SQL PARSER VÀ SQL GENERATOR

## 8.1. Parser

Agent phải đánh giá parser phù hợp với hai dialect:

* T-SQL.
* PostgreSQL.

Có thể xem xét SQLGlot hoặc parser chuyên biệt, nhưng phải kiểm tra khả năng xử lý cú pháp thực tế trước khi quyết định.

Các trường hợp bắt buộc kiểm thử:

* SELECT.
* FROM.
* Table alias.
* INNER JOIN.
* LEFT JOIN.
* Nhiều điều kiện ON.
* WHERE.
* GROUP BY.
* HAVING.
* ORDER BY.
* CASE.
* Aggregate functions.
* CTE.
* Subquery.

Không tuyên bố hỗ trợ đầy đủ một cấu trúc SQL nếu chưa có kiểm thử.

## 8.2. SQL Generator

SQL Generator phải sinh SQL theo dialect của kết nối hiện tại.

Ví dụ:

```sql
SELECT
    c.Id,
    c.Name,
    o.OrderDate
FROM dbo.B20Customer AS c
LEFT JOIN dbo.B30SalesOrder AS o
    ON c.Id = o.CustomerId
WHERE c.IsActive = 1;
```

Các yêu cầu:

* Giữ alias.
* Giữ thứ tự cột SELECT.
* Giữ thứ tự JOIN.
* Hỗ trợ nhiều điều kiện ON.
* Trích dẫn định danh theo dialect.
* Không tự thêm điều kiện JOIN ngoài Query Model.
* Không tự thay đổi logic WHERE.
* Không tự chuyển đổi các biểu thức không được hỗ trợ.
* Không sinh SQL bằng cách ghép chuỗi tùy tiện từ nội dung người dùng.

SQL Generator phải được kiểm thử độc lập với D3.js.

---

# 9. CƠ CHẾ ĐỒNG BỘ CODE VÀ DESIGN

## 9.1. SQL → Design

Khi mở View hoặc chuyển sang Design:

1. Đọc SQL hiện tại.
2. Parse SQL.
3. Tạo Query Model.
4. Lấy metadata nếu cần.
5. Render sơ đồ.
6. Hiển thị các phần chưa được hỗ trợ.

Nếu parse thất bại:

* Giữ nguyên SQL.
* Không xóa Query Model hiện tại một cách âm thầm.
* Hiển thị thông báo lỗi.
* Không tự động chuyển đổi SQL thành truy vấn khác.

## 9.2. Design → SQL

Khi thiết kế thay đổi:

1. Cập nhật Query Model.
2. Validate.
3. Generate SQL.
4. Cập nhật editor.
5. Đánh dấu tab đã thay đổi.
6. Không tự động lưu vào database.

## 9.3. Split View

Sử dụng cơ chế đồng bộ theo nguồn thay đổi.

Các trạng thái:

* `synced`.
* `code_modified`.
* `design_modified`.
* `parse_error`.
* `unsupported_sql`.

Không parse lại toàn bộ SQL sau mỗi phím bấm.

Có thể sử dụng debounce để giảm số lần xử lý, nhưng phải có cơ chế đồng bộ ngay khi người dùng chuyển sang Design hoặc yêu cầu Refresh Design.

Khi SQL đang có thay đổi chưa đồng bộ và người dùng tiếp tục chỉnh sửa canvas, cần xác định rõ trạng thái nào đang được ưu tiên. Không âm thầm ghi đè thay đổi của người dùng.

## 9.4. Refresh Design

Khi người dùng nhấn Refresh Design:

* Parse lại nội dung SQL hiện tại.
* Tạo mô hình thiết kế mới nếu parse thành công.
* Cập nhật canvas.
* Cảnh báo nếu thao tác làm mất trạng thái thiết kế chưa đồng bộ.
* Không thay đổi nội dung SQL gốc.

---

# 10. OBJECT METADATA SERVICE

Tận dụng kết nối database hiện có.

## SQL Server

Lấy thông tin:

* Schema.
* Table.
* View.
* Column.
* Data type.
* Primary key.
* Foreign key.

Ưu tiên các catalog view phù hợp với quyền truy cập hiện tại, chẳng hạn `sys.tables`, `sys.views`, `sys.columns`, `sys.schemas`, `sys.foreign_keys` và `sys.foreign_key_columns`.

## PostgreSQL

Lấy thông tin:

* Schema.
* Table.
* View.
* Column.
* Data type.
* Primary key.
* Foreign key.

Sử dụng metadata từ catalog PostgreSQL hoặc `information_schema` tùy loại thông tin và yêu cầu quyền truy cập.

## Cache

Cache metadata theo:

* Connection.
* Database.
* Schema.
* Object.

Khi đổi kết nối hoặc database, không sử dụng nhầm metadata từ phiên trước.

Nếu người dùng không có quyền đọc một số metadata, hiển thị dữ liệu khả dụng và thông báo phù hợp.

---

# 11. QUẢN LÝ TRẠNG THÁI VÀ LỊCH SỬ

## 11.1. Undo/Redo

Undo/Redo áp dụng cho các thao tác thiết kế:

* Thêm bảng.
* Xóa bảng.
* Thêm cột SELECT.
* Xóa cột SELECT.
* Thay đổi alias.
* Tạo JOIN.
* Sửa JOIN.
* Xóa JOIN.
* Thay đổi điều kiện.
* Thay đổi vị trí node.

Nên quản lý lịch sử dựa trên các thay đổi của Query Model, không phụ thuộc vào trạng thái SVG.

## 11.2. Trạng thái chưa lưu

Khi thiết kế thay đổi:

* Cập nhật SQL Editor.
* Đánh dấu tab đã chỉnh sửa theo cơ chế hiện tại.
* Không tự lưu vào database.
* Khi đóng tab, sử dụng cơ chế xác nhận thay đổi chưa lưu hiện có.

## 11.3. Chuyển kết nối

Khi đổi connection/database/schema:

* Không tự chuyển Query Model sang metadata của kết nối mới.
* Xác định rõ truy vấn hiện tại có còn hợp lệ hay không.
* Không tự chạy SQL.
* Không ghi đè SQL chưa lưu.

---

# 12. KẾ HOẠCH TRIỂN KHAI

## Phase 0 — Khảo sát

Công việc:

* Kiểm tra cấu trúc frontend/backend.
* Xác định editor hiện có.
* Xác định cách quản lý tab.
* Xác định cách lấy metadata.
* Xác định parser và formatter đang sử dụng.
* Xác định cơ chế lưu View.
* Xác định cách giao tiếp giữa JavaScript và Python.

Đầu ra:

* Báo cáo kiến trúc hiện tại.
* Danh sách file cần thêm/sửa.
* Sơ đồ tích hợp.
* Các rủi ro và giới hạn.
* Kế hoạch kiểm thử.

Không sửa code trước khi hoàn tất khảo sát.

## Phase 1 — UI Prototype

Công việc:

* Thêm Code/Design/Split.
* Tạo canvas D3.js.
* Tạo Table Node giả lập.
* Tạo đường JOIN giả lập.
* Xây dựng panel bảng/cột.
* Hỗ trợ kéo node, zoom, pan.
* Hoàn thiện bố cục trên PyWebView.

Điều kiện hoàn thành:

Có thể thao tác trên sơ đồ giả lập mà không cần database.

## Phase 2 — Metadata Integration

Công việc:

* Kết nối Metadata Service.
* Lấy bảng và cột.
* Hiển thị PK/FK.
* Tìm kiếm đối tượng.
* Hỗ trợ kéo bảng/cột từ database vào canvas.
* Cache metadata.
* Xử lý lỗi kết nối và quyền truy cập.

Điều kiện hoàn thành:

Design View hiển thị đúng đối tượng từ database hiện tại.

## Phase 3 — Query Model

Công việc:

* Xây dựng Query Model.
* Tạo/xóa bảng.
* Chọn cột SELECT.
* Quản lý alias.
* Tạo/sửa/xóa JOIN.
* Xây dựng cơ chế Undo/Redo.
* Validate mô hình.

Điều kiện hoàn thành:

Toàn bộ thao tác thiết kế cơ bản được lưu trong Query Model.

## Phase 4 — Design → SQL

Công việc:

* Xây dựng SQL Generator.
* Hỗ trợ SELECT/FROM/JOIN/ON.
* Hỗ trợ WHERE cơ bản.
* Hỗ trợ SQL Server và PostgreSQL.
* Cập nhật SQL Editor.
* Kiểm thử SQL Generator độc lập.

Điều kiện hoàn thành:

Thao tác trên canvas sinh ra SQL đúng trong phạm vi cú pháp được hỗ trợ.

## Phase 5 — SQL → Design

Công việc:

* Tích hợp SQL Parser.
* Parse SELECT/FROM/JOIN.
* Parse alias và điều kiện ON.
* Parse SELECT items.
* Parse WHERE.
* Hiển thị sơ đồ từ SQL có sẵn.
* Phát hiện cú pháp chưa được hỗ trợ.

Điều kiện hoàn thành:

SQL nằm trong tập cú pháp được hỗ trợ có thể chuyển thành mô hình thiết kế.

## Phase 6 — Split View và đồng bộ

Công việc:

* Đồng bộ SQL Editor và Query Model.
* Đồng bộ Query Model và D3 Renderer.
* Thêm trạng thái đồng bộ.
* Ngăn vòng lặp cập nhật.
* Xử lý parse error.
* Giữ vị trí node khi có thể.
* Tích hợp Undo/Redo.
* Tích hợp trạng thái tab chưa lưu.

Điều kiện hoàn thành:

Người dùng chỉnh sửa SQL hoặc Design mà không làm mất dữ liệu chưa lưu.

## Phase 7 — Mở rộng và tối ưu

Công việc:

* GROUP BY.
* HAVING.
* ORDER BY.
* DISTINCT.
* TOP/LIMIT.
* CASE và biểu thức.
* Aggregate functions.
* CTE.
* Subquery.
* UNION/UNION ALL.
* Tối ưu canvas với nhiều bảng.
* Hoàn thiện kiểm thử hồi quy.

Chỉ mở rộng sau khi MVP ổn định.

---

# 13. BỘ TEST BẮT BUỘC

## Test 1 — Một bảng

```sql
SELECT
    Id,
    Name
FROM dbo.B20Customer;
```

Kỳ vọng:

* Một Table Node.
* Hai cột được chọn.
* Không có JOIN.
* Sinh lại SQL đúng về ngữ nghĩa.

## Test 2 — Hai bảng INNER JOIN

```sql
SELECT
    c.Id,
    c.Name,
    o.OrderDate
FROM dbo.B20Customer AS c
INNER JOIN dbo.B30SalesOrder AS o
    ON c.Id = o.CustomerId;
```

Kỳ vọng:

* Hai Table Node.
* Alias chính xác.
* Một Join Edge.
* Điều kiện ON chính xác.

## Test 3 — LEFT JOIN và WHERE

```sql
SELECT
    c.Id,
    o.OrderDate
FROM dbo.B20Customer AS c
LEFT JOIN dbo.B30SalesOrder AS o
    ON c.Id = o.CustomerId
WHERE c.IsActive = 1;
```

Kỳ vọng:

* Giữ nguyên loại JOIN.
* Giữ nguyên điều kiện ON.
* Giữ nguyên WHERE.
* Không chuyển điều kiện giữa ON và WHERE.

## Test 4 — Một bảng được sử dụng nhiều lần

```sql
SELECT
    e.Name,
    m.Name AS ManagerName
FROM dbo.Employee AS e
LEFT JOIN dbo.Employee AS m
    ON e.ManagerId = m.Id;
```

Kỳ vọng:

* Hai node khác nhau.
* Alias `e` và `m` không bị mất.
* Đường JOIN nối đúng hai node.

## Test 5 — Nhiều điều kiện ON

```sql
SELECT
    a.Id,
    b.Description
FROM dbo.TableA AS a
INNER JOIN dbo.TableB AS b
    ON a.Id = b.Id
    AND a.BranchCode = b.BranchCode;
```

Kỳ vọng:

* Hai điều kiện ON được giữ nguyên.
* Không chỉ sinh lại điều kiện đầu tiên.

## Test 6 — SQL không được hỗ trợ

Sử dụng truy vấn có CTE hoặc cấu trúc phức tạp chưa được triển khai.

Kỳ vọng:

* Không mất SQL gốc.
* Có thông báo giới hạn hỗ trợ.
* Không âm thầm sinh ra truy vấn khác.
* Cho phép quay lại Code View.

## Test 7 — Kiểm tra hồi quy

* Chạy SQL và hiển thị Result Grid.
* Đổi tab.
* Đổi kết nối.
* Đóng tab chưa lưu.
* Sử dụng IntelliSense.
* Thực hiện các thao tác editor hiện có.

Kỳ vọng:

Không có lỗi hồi quy do tích hợp Design View.

---

# 14. TIÊU CHÍ NGHIỆM THU

Chỉ nghiệm thu khi:

* [ ] Có Code/Design/Split.
* [ ] D3.js hiển thị bảng và JOIN.
* [ ] Panel bên phải hiển thị bảng và cột từ database.
* [ ] Có kéo thả bảng.
* [ ] Có kéo thả cột vào SELECT.
* [ ] Có tạo và chỉnh sửa JOIN.
* [ ] Design → SQL hoạt động.
* [ ] SQL → Design hoạt động trong phạm vi hỗ trợ.
* [ ] Split View đồng bộ đúng.
* [ ] Alias được giữ chính xác.
* [ ] Nhiều điều kiện ON được giữ chính xác.
* [ ] SQL không hỗ trợ không bị mất.
* [ ] Có trạng thái thay đổi chưa lưu.
* [ ] Có Undo/Redo.
* [ ] Không tự động thực thi SQL.
* [ ] Không tự động thay đổi View trong database.
* [ ] Không làm hỏng các chức năng IDE hiện có.
* [ ] Có kiểm thử cho SQL Server và PostgreSQL.

---

# 15. YÊU CẦU AGENT BÁO CÁO

Sau mỗi phase, Agent phải báo cáo:

1. Các file đã tạo.
2. Các file đã sửa.
3. Chức năng đã hoàn thành.
4. Các chức năng chưa hoàn thành.
5. Kết quả kiểm thử.
6. Những giới hạn còn tồn tại.
7. Các thay đổi ảnh hưởng đến module khác.
8. Cách chạy và kiểm thử thủ công.
9. Những vấn đề cần xác nhận trước phase tiếp theo.

Không đánh dấu hoàn thành chỉ vì giao diện đã hiển thị.

Phải chứng minh bằng kiểm thử rằng dữ liệu từ Query Model được chuyển thành SQL chính xác trong phạm vi hỗ trợ.

---

# 16. THỨ TỰ ƯU TIÊN

Thứ tự thực hiện đề xuất:

1. Khảo sát kiến trúc hiện tại.
2. Dựng UI Prototype.
3. Tích hợp metadata.
4. Xây dựng Query Model.
5. Sinh SQL từ Design.
6. Parse SQL thành Design.
7. Hoàn thiện Split View.
8. Undo/Redo và trạng thái chưa lưu.
9. Mở rộng cú pháp.
10. Tối ưu hiệu năng và kiểm thử hồi quy.

Không triển khai tất cả tính năng trong một lần.

Ưu tiên một MVP hoạt động ổn định với SELECT, FROM, JOIN, ON và WHERE trước khi mở rộng sang các cấu trúc SQL phức tạp.

**Yêu cầu cuối cùng:** Agent phải khảo sát codebase thực tế trước khi triển khai, tận dụng module sẵn có, tránh tạo các service trùng chức năng và không thay đổi ngoài phạm vi đã thống nhất.
