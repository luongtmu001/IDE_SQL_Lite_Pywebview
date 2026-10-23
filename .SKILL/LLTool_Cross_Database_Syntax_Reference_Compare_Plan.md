# KẾ HOẠCH KỸ THUẬT: CROSS-DATABASE SYNTAX REFERENCE & COMPARE CHO LLTOOL

**Phiên bản:** 1.0  
**Phạm vi DB ban đầu:** PostgreSQL và Microsoft SQL Server  
**Mục tiêu:** Xây dựng kho kiến thức cú pháp có nguồn kiểm chứng, chức năng tra cứu và so sánh cú pháp giữa hai hệ quản trị; thiết kế sẵn khả năng mở rộng sang chuyển đổi SQL ở giai đoạn sau.  
**Nguyên tắc bắt buộc:** Giữ nguyên công nghệ và kiến trúc sẵn có của LLTool. Không thay thế framework, editor, cơ chế backend, thư viện giao diện hoặc kiến trúc ứng dụng hiện tại.

---

## 1. Mục tiêu và phạm vi

### 1.1. Mục tiêu giai đoạn đầu

1. Tra cứu cú pháp, toán tử và cách viết đặc thù của PostgreSQL.
2. Tra cứu cú pháp, toán tử và cách viết đặc thù của SQL Server.
3. Tìm kiếm các cách viết khác nhau trong cùng một hệ quản trị, ví dụ PostgreSQL `LIKE` và toán tử `~~`.
4. So sánh cách triển khai một khái niệm giữa PostgreSQL và SQL Server.
5. Cho phép người dùng:
   - Mở màn hình Compare và nhập/viết SQL trực tiếp.
   - Bôi đen đoạn SQL trong SQL Editor hiện tại rồi mở Compare với nội dung đã chọn.
   - Chọn hệ quản trị nguồn và đích.
   - Xem các cú pháp liên quan, ví dụ, điều kiện tương đương, giới hạn và nguồn tham khảo.
6. Xây dựng kho dữ liệu có cấu trúc, có phiên bản và có nguồn tài liệu chính thức.
7. Thiết kế sẵn quy trình cập nhật kho dữ liệu từ tài liệu chính thức trong tương lai, nhưng không bắt buộc triển khai đồng bộ tự động ở MVP.
8. Giữ ranh giới rõ ràng để sau này bổ sung chức năng chuyển đổi SQL mà không phải thiết kế lại toàn bộ kho kiến thức.

### 1.2. Ngoài phạm vi giai đoạn đầu

- Không tự động chuyển đổi SQL.
- Không dùng AI để tạo hoặc xác minh mapping trong giai đoạn đầu.
- Không tự động thực thi SQL trên database để xác nhận tính đúng đắn.
- Không thay thế Monaco Editor hoặc editor đang có.
- Không thay đổi IntelliSense, syntax highlighting, parser hay logic thực thi SQL hiện tại.
- Không thay đổi cấu hình kết nối hoặc hệ thống quản lý connection.
- Không triển khai hỗ trợ MySQL, Oracle hay hệ quản trị khác ở giai đoạn đầu.
- Không tự cập nhật dữ liệu nền một cách âm thầm; việc cập nhật tương lai phải có màn hình xem trước và xác nhận của người dùng.

---

## 2. Nguyên tắc kiến trúc

1. **Tích hợp, không tái xây dựng:** dùng lại framework, pywebview, Python backend, HTML/CSS/JavaScript, Bootstrap, Monaco Editor và cơ chế mở cửa sổ/tab đang có trong LLTool nếu chúng đáp ứng yêu cầu.
2. **Module độc lập:** nghiệp vụ Cross-Database nằm trong module riêng; không nhồi logic vào `main.py`.
3. **CSS/JavaScript riêng:** không nhúng CSS hoặc JavaScript mới trực tiếp trong HTML nếu cấu trúc hiện tại của LLTool đang tách file.
4. **Dữ liệu tách khỏi giao diện:** nội dung catalog không hard-code trong JavaScript.
5. **Nguồn có thể truy vết:** mỗi mục kiến thức và mỗi mapping phải có nguồn, phiên bản tài liệu và trạng thái xác minh.
6. **Không đồng nhất “cùng mục đích” với “tương đương”:** mapping phải thể hiện điều kiện và giới hạn.
7. **An toàn mặc định:** Compare chỉ phân tích/đối chiếu và hiển thị; không tự thực thi SQL, không ghi dữ liệu database.
8. **Tương thích ngược:** module mới không làm thay đổi hành vi của SQL Editor, tab, keybinding, connection tree hoặc các module hiện có.
9. **Thiết kế cho cập nhật dữ liệu:** tách bản dữ liệu đang hoạt động khỏi dữ liệu tải về/chưa xác minh; cập nhật phải có kiểm tra, preview, xác nhận và khả năng rollback.
10. **Chỉ sử dụng công nghệ sẵn có:** mọi thư viện mới (nếu thật sự cần) phải được đề xuất riêng, nêu lý do và được duyệt trước; mặc định ưu tiên thư viện đã có trong dự án.

---

## 3. Trải nghiệm người dùng

### 3.1. Điểm truy cập

- Thêm nút `?` hoặc mục Reference phù hợp vào khu vực công cụ SQL Editor (đầu menu danh sách tab).
- Chỉ hiển thị hoặc kích hoạt cho connection/engine PostgreSQL và SQL Server.
- Không nhận diện DB bằng tên connection; phải sử dụng metadata loại database từ connection hiện tại.
- Tích hợp menu chuột phải `Compare Across Databases` khi người dùng đã bôi đen SQL.
- Có thể bổ sung lệnh trong command palette/menu hiện có nếu LLTool đã có cơ chế tương ứng.
- Không bắt phím `?` trần trong editor vì `?` là toán tử hợp lệ của PostgreSQL, ví dụ `jsonb_column ? 'key'`. Nếu bổ sung phím tắt, phải dùng keybinding không xung đột và tuân theo cơ chế keybinding hiện có.

### 3.2. Reference Panel

Các khu vực:

1. Ô tìm kiếm.
2. Bộ lọc database: PostgreSQL / SQL Server / Cả hai.
3. Bộ lọc nhóm: String, JSON/JSONB, Array, Comparison, Query, DML, DDL, Date/Time, Window Functions, Data Types và các nhóm cần thiết khác.
4. Danh sách kết quả.
5. Chi tiết mục được chọn.
6. Các cách viết liên quan trong cùng DB và mapping sang DB còn lại.
7. Ví dụ SQL.
8. Mức quan hệ: `Equivalent`, `Conditional`, `Rewrite Required`, `No Direct Equivalent`, hoặc `Related`.
9. Nguồn chính thức, phiên bản tài liệu và ngày xác minh.
10. Nút Copy Example và, nếu phù hợp, Insert into Editor.

Chức năng Insert chỉ chèn khi người dùng chủ động chọn; không sửa nội dung hiện có ngoài vùng chèn được xác định.

### 3.3. Compare Screen

Bố cục đề xuất:

- Chọn `Source DB` và `Target DB`.
- Hai vùng SQL Editor đặt cạnh nhau; ưu tiên tái sử dụng Monaco Editor đã có.
- Các nút Compare, Clear, Copy và mở Reference.
- Khu vực kết quả bên dưới hoặc panel bên cạnh.

Hai chế độ đầu vào:

**A. Viết trực tiếp:** người dùng nhập SQL ở một hoặc cả hai bên rồi chọn Compare.

**B. Compare đoạn đã bôi đen:** menu chuột phải truyền đoạn SQL được chọn và loại DB hiện tại vào màn hình Compare. Không sửa/xóa SQL gốc.

### 3.4. Hành vi Compare ở MVP

MVP không tuyên bố phân tích ngữ nghĩa hoàn chỉnh cho mọi câu SQL. Hệ thống có thể:

- Tìm cú pháp/toán tử đã biết trong catalog.
- Hiển thị các concept và mapping có liên quan.
- Hiển thị điều kiện, giới hạn và ví dụ được xác minh.
- Cho người dùng chọn mapping để xem chi tiết.
- Báo rõ `Chưa có mapping đã xác minh` nếu không tìm được.

Không được tự kết luận rằng hai câu SQL tương đương chỉ vì chúng có một từ khóa hoặc toán tử trùng khớp. Nếu không có parser phù hợp sẵn trong IDE, giai đoạn đầu chỉ thực hiện tra cứu dựa trên catalog và phân tích hỗ trợ ở mức giới hạn; không tự xây một parser SQL mới như một phần của MVP.

---

## 4. Công nghệ và phương án triển khai

### 4.1. Công nghệ

Bắt buộc giữ nguyên công nghệ sẵn có của LLTool:

- **Desktop shell:** pywebview/WebView2 theo cấu trúc hiện tại.
- **Backend:** Python hiện tại.
- **Frontend:** HTML, CSS, JavaScript và Bootstrap đang dùng.
- **SQL Editor:** Monaco Editor đang dùng trong LLTool.
- **Giao tiếp frontend/backend:** dùng cơ chế API/bridge đang có trong dự án.
- **Kho dữ liệu MVP:** JSON theo schema có version; đọc qua repository/service.
- **Kiểm thử:** dùng framework kiểm thử đã có trong dự án; nếu chưa có, đề xuất công cụ tối thiểu riêng trước khi cài thêm.
- **Không thêm framework frontend mới**, không thay Monaco bằng editor khác, không chuyển backend sang công nghệ khác.

### 4.2. Quy trình trước khi code

Trước khi tạo/sửa file, bắt buộc kiểm tra repository thực tế để xác định:

- Cấu trúc module, template, CSS, JS và static/data.
- Cách mở modal, panel, tab hoặc cửa sổ.
- Cách đăng ký menu chuột phải và keybinding.
- Cách xác định loại connection.
- Cơ chế giao tiếp JavaScript–Python.
- Quy ước đặt tên API, logging, error handling và tests.
- Các tiện ích tìm kiếm, dialog, toast, editor hoặc state management đang có.

Sau audit, lập bảng `File/Module hiện có → Vai trò → Điểm tích hợp → File cần thêm/sửa`. Không được giả định đường dẫn hoặc tạo cấu trúc song song nếu dự án đã có cơ chế tương ứng.

---

## 5. Mô hình dữ liệu

### 5.1. Tách dữ liệu thành các thực thể

Đề xuất logic gồm bốn thực thể. Giai đoạn đầu có thể lưu thành các JSON riêng hoặc một JSON có version; chọn cách phù hợp với chuẩn hiện có của LLTool.

#### A. Concepts

Đại diện cho khái niệm hoặc mục đích chung, không gắn với một cú pháp duy nhất.

Trường đề xuất:

- `id`: định danh ổn định.
- `name`: tên khái niệm.
- `category`: nhóm.
- `description`: mô tả.
- `search_terms`: từ khóa, cách gọi khác.
- `status`: trạng thái xuất bản.
- `updated_at`: ngày cập nhật bản ghi.

#### B. Syntax Entries

Đại diện cho cú pháp/toán tử cụ thể của một DB.

Trường đề xuất:

- `id`
- `database`: `postgresql` hoặc `sqlserver`
- `syntax`
- `display_name`
- `category`
- `description`
- `data_types` hoặc `context`
- `version_min` / `version_max` nếu xác minh được
- `example_ids`
- `source_ids`
- `status`

Ví dụ: PostgreSQL `LIKE`, `~~`, `ILIKE`, `~~*`, `LEFT JOIN LATERAL`; SQL Server `OUTER APPLY`, `CROSS APPLY`, `TOP`, `OUTPUT`.

#### C. Mappings

Liên kết một hoặc nhiều cú pháp với concept/mapping ở DB khác.

Trường đề xuất:

- `id`
- `concept_id`
- `source_syntax_ids`
- `target_syntax_ids`
- `equivalence_level`: `equivalent`, `conditional`, `rewrite_required`, `no_direct_equivalent`, `related`
- `conditions`
- `limitations`
- `notes`
- `verification_status`
- `verified_by` (có thể là nhóm/người biên tập, không bắt buộc thông tin cá nhân)
- `verified_at`
- `source_ids`
- `examples`

Không giả định mapping luôn là quan hệ một-một. Một cú pháp có thể có nhiều cách thể hiện ở DB đích, hoặc cần kết hợp nhiều cấu trúc để biểu diễn cùng mục đích.

#### D. Sources

Lưu nguồn và thông tin truy vết:

- `id`
- `database`
- `title`
- `url`
- `documentation_version`
- `product_version` nếu liên quan
- `section`
- `retrieved_at`
- `last_checked_at`
- `content_hash` nếu có tải/lưu bản nội dung để so sánh thay đổi
- `source_type`: tài liệu cú pháp, tài liệu toán tử, tài liệu phiên bản, ghi chú xác minh
- `status`

Không sao chép toàn bộ tài liệu có bản quyền vào catalog. Lưu metadata, liên kết, trích dẫn ngắn cần thiết và nội dung do nhóm dự án tự biên soạn.

### 5.2. Trạng thái dữ liệu

Dùng các trạng thái rõ ràng:

- `draft`: đang biên soạn.
- `verified`: đã kiểm tra nguồn và nội dung.
- `deprecated`: không còn khuyến nghị hoặc đã lỗi thời.
- `needs_review`: nguồn thay đổi hoặc phát hiện thông tin cần xác minh lại.

Chỉ bản ghi `verified` mới được dùng để hiển thị như mapping đã được kiểm chứng. Bản ghi `draft`/`needs_review` phải được đánh dấu rõ và không được dùng để đưa ra kết luận chắc chắn.

### 5.3. Ví dụ mapping

Concept: truy vấn con trong `FROM` có thể tham chiếu các nguồn đứng trước.

- PostgreSQL: `LEFT JOIN LATERAL (...) alias ON TRUE`.
- SQL Server: `OUTER APPLY (...) alias`.
- Mức: `conditional`.
- Ghi chú: phải xét điều kiện `ON`, bộ lọc, xử lý dòng không khớp, `NULL`, `ORDER BY` và giới hạn số dòng. Đây không phải quy tắc thay thế văn bản đơn giản.
- Nguồn: liên kết tới tài liệu chính thức của PostgreSQL về `LATERAL` và Microsoft Learn về `APPLY`.

Ví dụ này minh họa schema, không thay thế bước xác minh chính thức cho từng mapping.

---

## 6. Thu thập và xác minh kiến thức

### 6.1. Nguồn chính thức

Ưu tiên tài liệu của nhà phát hành:

**PostgreSQL**

- SQL Syntax.
- SQL Commands.
- Functions and Operators.
- Data Types.
- Queries / `SELECT`, `FROM`, `LATERAL`, `LIMIT`.
- Các trang theo phiên bản khi cần phân biệt khả năng hỗ trợ.

**SQL Server**

- Microsoft Learn về T-SQL.
- `FROM` / `JOIN` / `APPLY`.
- `SELECT`, `TOP`, `ORDER BY`, `OFFSET ... FETCH`.
- `OUTPUT`.
- Data Types, Operators, Functions và các trang theo phiên bản.

Mỗi mục catalog phải trỏ đến trang/section cụ thể nếu có thể, không chỉ lưu URL trang chủ.

### 6.2. Quy trình xác minh

1. Thu thập tên cú pháp và mô tả từ tài liệu chính thức.
2. Chuẩn hóa thuật ngữ, loại DB, category và phiên bản.
3. Tạo mục `Syntax Entry`.
4. Nếu có quan hệ liên hệ thống, tạo mapping riêng.
5. Ghi rõ mức tương đương, điều kiện, giới hạn và trường hợp không áp dụng.
6. Kiểm tra ví dụ bằng cách đọc tài liệu và/hoặc kiểm thử trong môi trường phát triển phù hợp; không chạy SQL tùy ý trên connection người dùng.
7. Đánh dấu `verified` sau khi hoàn thành checklist.
8. Lưu ngày xác minh và nguồn.

### 6.3. Nguyên tắc nội dung

- Không suy ra tương đương chỉ từ tên hoặc hình thức cú pháp.
- Không khẳng định `LEFT JOIN LATERAL` luôn có thể thay trực tiếp bằng `OUTER APPLY` trong mọi truy vấn.
- Không coi `LIKE` và `ILIKE` là tương đương hoàn toàn.
- Phân biệt cú pháp chuẩn SQL, cú pháp riêng của nhà cung cấp và toán tử nội bộ/alias.
- Xác minh hỗ trợ theo phiên bản khi có khác biệt phiên bản.
- Khi chưa đủ chứng cứ, đặt `needs_review` hoặc `draft`, không đưa vào nhóm mapping đã xác minh.
- Ví dụ phải ngắn, có thể hiểu độc lập và không chứa thông tin nhạy cảm.

---

## 7. Kế hoạch cập nhật kho dữ liệu từ tài liệu chính thức trong tương lai

**Yêu cầu kiến trúc:** thiết kế schema và repository ngay từ đầu để hỗ trợ cập nhật; tính năng giao diện cập nhật và quy trình đồng bộ đầy đủ có thể triển khai ở giai đoạn sau.

### 7.1. Mô hình cập nhật đề xuất

Không ghi đè trực tiếp dữ liệu đang hoạt động khi vừa tải được nội dung mới.

Quy trình tương lai:

1. Người dùng mở `Manage Catalog` hoặc `Update Documentation`.
2. Chọn PostgreSQL, SQL Server hoặc cả hai.
3. Chọn nguồn/phiên bản tài liệu trong danh sách nguồn được hỗ trợ.
4. Hệ thống truy xuất metadata và nội dung được phép xử lý từ nguồn chính thức.
5. Chuẩn hóa nội dung vào khu vực staging.
6. So sánh với catalog hiện tại.
7. Hiển thị báo cáo thay đổi:
   - Mục mới.
   - Mục bị thay đổi.
   - Mục không còn thấy trong tài liệu mới.
   - Mục có thể thay đổi phiên bản hỗ trợ.
   - Mapping bị ảnh hưởng và cần xem xét lại.
8. Người dùng xem diff và xác nhận.
9. Chỉ dữ liệu đã qua kiểm tra schema mới được đưa vào bản catalog mới.
10. Kích hoạt bản catalog mới theo cách nguyên tử hoặc cơ chế an toàn tương đương.
11. Ghi log phiên bản, thời điểm, nguồn và kết quả.
12. Hỗ trợ rollback về bản catalog trước đó.

### 7.2. Không tự động cập nhật mapping chỉ vì tài liệu đổi

Tài liệu chính thức có thể cập nhật cách diễn đạt, nhưng điều đó không tự động chứng minh một mapping giữa hai DB vẫn đúng hoặc đã thay đổi.

Vì vậy:

- Nội dung syntax có thể được đánh dấu cần cập nhật.
- Mapping liên quan cần chuyển sang `needs_review` khi nguồn thay đổi có ảnh hưởng.
- Mapping phải được xác minh riêng trước khi tiếp tục hiển thị là `verified`.
- Không dùng AI ở giai đoạn catalog ban đầu để tự kết luận mapping.
- Giai đoạn tương lai có thể bổ sung AI như công cụ gợi ý, nhưng kết quả AI phải được phân biệt với dữ liệu đã xác minh và không tự động được xuất bản.

### 7.3. Cách lấy dữ liệu

Ưu tiên theo thứ tự:

1. API/feed hoặc định dạng tài liệu chính thức ổn định do nhà phát hành cung cấp, nếu có.
2. Trang tài liệu HTML chính thức với quy trình tải có kiểm soát.
3. Tệp tài liệu chính thức có thể tải xuống, nếu giấy phép và điều khoản cho phép.

Không phụ thuộc vào scraping mong manh nếu có nguồn có cấu trúc tốt hơn. Không vượt qua cơ chế truy cập, không tải dồn dập và phải tôn trọng điều khoản sử dụng/robots policy phù hợp.

### 7.4. Phân biệt hai loại cập nhật

- **Update documentation metadata/content:** kiểm tra tài liệu có thay đổi và cập nhật metadata/nội dung catalog được phép.
- **Update verified knowledge:** quy trình biên tập/xác minh riêng để phê duyệt các thay đổi về ý nghĩa, phiên bản và mapping.

Không gộp hai thao tác thành một nút cập nhật ghi đè không kiểm soát.

---

## 8. Thiết kế dịch vụ/API nội bộ

Tên endpoint dưới đây chỉ là tên logic minh họa. Khi triển khai, phải tuân theo cơ chế bridge/API hiện có của LLTool, không tạo thêm server hoặc framework mới nếu không cần.

Các thao tác cần có:

- `search_catalog(query, database, category)`
- `get_syntax_entry(syntax_id)`
- `get_concept(concept_id)`
- `get_mappings(concept_id, source_db, target_db)`
- `get_sources(source_ids)`
- `get_catalog_version()`
- `compare_selection(sql_text, source_db, target_db)` — chỉ tra cứu/đối chiếu ở mức MVP, không thực thi SQL và không tuyên bố semantic equivalence tổng quát.

Chuẩn bị cho giai đoạn cập nhật sau:

- `check_documentation_updates(source_ids)`
- `stage_catalog_update(source_ids)`
- `preview_catalog_diff(staging_id)`
- `validate_staged_catalog(staging_id)`
- `publish_catalog_update(staging_id, confirmation)`
- `rollback_catalog_version(version_id)`

Các thao tác cập nhật không cần xuất hiện trên UI ở MVP nếu chưa triển khai; việc liệt kê ở đây nhằm định hướng ranh giới dịch vụ. Không cần triển khai API giả hoặc chức năng rỗng chỉ để giữ tên gọi.

### Quy tắc xử lý lỗi

- Không có kết quả: thông báo chưa có mục phù hợp.
- Mapping chưa xác minh: hiển thị rõ trạng thái, không khẳng định tương đương.
- Nguồn không truy cập được trong tương lai: giữ nguyên catalog đang hoạt động.
- Dữ liệu mới không hợp lệ: không xuất bản.
- Lỗi khi xuất bản: giữ hoặc phục hồi bản catalog trước đó.
- Không ghi SQL hoặc dữ liệu kết nối nhạy cảm vào log.

---

## 9. Tìm kiếm và logic so sánh

### 9.1. Tìm kiếm

MVP hỗ trợ:

- Tìm chính xác theo toán tử/cú pháp.
- Tìm theo tên concept.
- Tìm theo alias.
- Tìm theo mô tả và search terms.
- Lọc theo DB, category và trạng thái xác minh.

Chuẩn hóa tìm kiếm nhưng giữ nguyên cú pháp hiển thị, ví dụ `~~*`, `ILIKE`, `OUTER APPLY`.

### 9.2. Compare theo catalog

Luồng xử lý:

1. Nhận SQL và lựa chọn source/target DB.
2. Giữ nguyên nội dung người dùng.
3. Tìm các mục đã biết theo catalog.
4. Liệt kê concept/mapping liên quan.
5. Hiển thị mức tương đương, điều kiện, giới hạn và nguồn.
6. Nếu không đủ dữ liệu, hiển thị `Chưa có mapping đã xác minh`.
7. Không sinh SQL đích tự động trong giai đoạn này.

Nếu muốn nhận diện cấu trúc SQL chính xác hơn trong tương lai, hãy đánh giá parser tương thích với công nghệ và giấy phép dự án tại thời điểm đó. Không đưa parser mới vào MVP nếu chỉ cần tra cứu catalog.

---

## 10. Tích hợp với LLTool

Trước khi chỉnh sửa, thực hiện audit và lập danh sách file thực tế. Sau đó tích hợp theo thứ tự:

1. Tìm cơ chế xác định database provider/connection type.
2. Tìm cơ chế mở modal/panel/tab và quản lý vòng đời.
3. Tìm cơ chế context menu của SQL Editor.
4. Tìm cách lấy selection và editor model từ Monaco.
5. Tìm cơ chế giao tiếp frontend/backend đang có.
6. Tạo module service/repository theo chuẩn dự án.
7. Thêm data catalog và validation.
8. Thêm Reference UI.
9. Thêm Compare UI, dùng lại Monaco nếu phù hợp.
10. Thêm lệnh context menu cho selection.
11. Chỉ đăng ký nút/phím tắt theo hệ thống hiện có.
12. Chạy kiểm thử hồi quy.

Không sửa `main.py` ngoài phần đăng ký/khởi tạo tối thiểu nếu kiến trúc hiện tại bắt buộc; ưu tiên dùng registry/plugin/module loader đang có. Không tạo một cơ chế mở cửa sổ, state manager hoặc menu thứ hai.

---

## 11. Kiểm thử và tiêu chí nghiệm thu

### 11.1. Kiểm thử dữ liệu

- Tất cả bản ghi có ID duy nhất.
- Mọi syntax entry có database/category/name.
- Mọi mapping có mức quan hệ hợp lệ.
- Mapping `verified` phải có nguồn và ngày xác minh.
- Source URL có định dạng hợp lệ.
- Không có alias trùng gây nhập nhằng mà không được phân biệt ngữ cảnh.
- JSON lỗi cấu trúc phải bị từ chối trước khi tải vào UI.

### 11.2. Kiểm thử chức năng

- Tìm `~~` trả về mục PostgreSQL `LIKE`.
- Tìm `ILIKE` không được gắn nhãn tương đương hoàn toàn với `LIKE`.
- Tìm `LATERAL` hiển thị mapping `APPLY` ở trạng thái và mức phù hợp đã xác minh.
- Có thể tìm theo concept, cú pháp, alias và mô tả.
- Chuyển bộ lọc PostgreSQL/SQL Server hoạt động đúng.
- Compare mở được với SQL nhập trực tiếp.
- Bôi đen SQL rồi chọn Compare đưa đúng selection sang màn hình mới.
- Không sửa nội dung SQL gốc.
- Không thực thi SQL khi Compare.
- Mapping không xác minh phải được đánh dấu rõ.
- Không có mapping phù hợp thì hiển thị trạng thái trống rõ ràng.

### 11.3. Kiểm thử hồi quy

- SQL Server Editor hiện tại hoạt động như trước.
- PostgreSQL Editor hiện tại hoạt động như trước.
- Monaco Editor và IntelliSense không bị thay đổi hành vi.
- Menu chuột phải hiện có không bị mất hoặc ghi đè.
- Keybinding hiện có không bị xung đột.
- Tab/window lifecycle, theme và layout tiếp tục hoạt động.
- Các chức năng chạy SQL, grid kết quả và kết nối không bị ảnh hưởng.
- Khi catalog lỗi hoặc thiếu file, IDE vẫn mở được và báo lỗi module phù hợp.

### 11.4. Tiêu chí hiệu năng

- Catalog được nạp một lần hoặc theo cơ chế cache hiện có.
- Tìm kiếm cục bộ không gọi database.
- Mở Reference/Compare không làm treo SQL Editor.
- Không tạo Monaco editor hoặc listener lặp không được giải phóng khi đóng/mở cửa sổ nhiều lần.
- Chỉ đo và tối ưu theo công cụ đo sẵn có; không thêm framework hiệu năng mới nếu chưa cần.

---

## 12. Thứ tự triển khai đề xuất

### Phase 0 — Audit hiện trạng

- Đọc cấu trúc repository.
- Xác định module, UI patterns, API bridge, connection type, Monaco integration và tests.
- Lập danh sách file thêm/sửa.
- Ghi rõ phạm vi ảnh hưởng.

**Đầu ra:** báo cáo audit và sơ đồ tích hợp; chưa sửa code.

### Phase 1 — Schema và catalog nền

- Chốt schema Concepts, Syntax Entries, Mappings, Sources.
- Chọn cách đóng gói JSON phù hợp cấu trúc hiện tại.
- Viết validator.
- Thu thập các nhóm đầu tiên từ tài liệu chính thức.
- Xác minh thủ công mapping ban đầu.

**Đầu ra:** catalog mẫu có version, validator và nguồn kiểm chứng.

### Phase 2 — Reference Panel

- Tích hợp nút `?`.
- Tìm kiếm, lọc và hiển thị chi tiết.
- Hiển thị mapping, trạng thái và nguồn.
- Copy/Insert theo hành động chủ động của người dùng.

**Đầu ra:** tra cứu PostgreSQL/SQL Server dùng được.

### Phase 3 — Compare Screen

- Hai vùng editor, source/target DB selector.
- Nhập SQL trực tiếp.
- Đối chiếu catalog và hiển thị kết quả.
- Trạng thái chưa có mapping và mức tương đương.

**Đầu ra:** màn hình Compare không thực thi hoặc tự chuyển đổi SQL.

### Phase 4 — Tích hợp selection

- Thêm context menu.
- Truyền selection và DB provider hiện tại.
- Giữ nguyên nội dung editor gốc.
- Xử lý trường hợp không có selection hoặc selection rỗng.

**Đầu ra:** bôi đen SQL rồi mở Compare.

### Phase 5 — Hardening và nghiệm thu

- Kiểm thử schema, chức năng, hồi quy và lỗi.
- Kiểm tra tương thích theme/layout.
- Kiểm tra mở/đóng nhiều lần và giải phóng tài nguyên.
- Cập nhật tài liệu kỹ thuật và hướng dẫn sử dụng.

**Đầu ra:** module ổn định, không ảnh hưởng module ngoài phạm vi.

### Phase tương lai — Catalog Update

- Màn hình quản lý nguồn tài liệu.
- Kiểm tra cập nhật từ nguồn chính thức.
- Staging và diff.
- Validation.
- Preview và xác nhận.
- Publish có version và rollback.
- Đánh dấu mapping cần xem xét khi tài liệu thay đổi.

### Phase tương lai — SQL Translation

- Đánh giá parser và mô hình biểu diễn SQL.
- Thiết kế pipeline chuyển đổi theo AST, không chỉ thay chuỗi.
- Kết hợp catalog, quy tắc có kiểm chứng và AI hỗ trợ.
- Hiển thị thay đổi, cảnh báo và trường hợp chưa hỗ trợ.
- Yêu cầu người dùng xem xét trước khi áp dụng SQL đã chuyển đổi.
- Kiểm thử theo bộ truy vấn đại diện cho từng DB.

---

## 13. Rủi ro và cách giảm thiểu

| Rủi ro | Giảm thiểu |
| --- | --- |
| Mapping sai do hai cú pháp chỉ gần giống nhau | Có mức tương đương, điều kiện, giới hạn và nguồn |
| Tài liệu chính thức thay đổi | Lưu phiên bản, ngày kiểm tra và quy trình review |
| URL/tài liệu thay đổi cấu trúc | Tách adapter lấy dữ liệu khỏi catalog; hỗ trợ nguồn chính thức ổn định |
| Cập nhật làm hỏng catalog hiện tại | Staging, validation, publish an toàn và rollback |
| Compare bị hiểu nhầm là kiểm chứng kết quả SQL | Hiển thị rõ phạm vi Compare và giới hạn |
| Xung đột phím `?` với toán tử JSONB | Dùng nút UI; chỉ thêm phím tắt không xung đột |
| Ảnh hưởng editor hiện có | Tái sử dụng cơ chế tích hợp hiện tại, không thay editor |
| Tạo thêm kiến trúc trùng lặp | Audit trước khi code; dùng lại registry/service/UI patterns |
| Catalog lớn làm tìm kiếm chậm | Tìm kiếm cục bộ, cache và đo hiệu năng trước khi tối ưu |
| Nội dung nguồn không còn hỗ trợ phiên bản cũ | Theo dõi version support và trạng thái deprecated/needs_review |

---

## 14. Quy tắc bắt buộc cho người triển khai

1. Audit code hiện tại trước khi tạo/sửa file.
2. Không đổi công nghệ hiện có của LLTool.
3. Không thay Monaco Editor hoặc framework frontend/backend.
4. Không nhồi nghiệp vụ vào `main.py`.
5. Không inline CSS/JS nếu dự án đang tách file.
6. Không sửa IntelliSense, parser, execution pipeline hoặc module không thuộc phạm vi.
7. Không triển khai tự động chuyển đổi SQL trong giai đoạn đầu.
8. Không dùng AI để xác nhận mapping ở giai đoạn đầu.
9. Mọi mapping `verified` phải có nguồn chính thức và ghi rõ điều kiện.
10. Không coi cùng tên hoặc cùng mục đích là bằng chứng tương đương ngữ nghĩa.
11. Không thực thi SQL từ chức năng Compare.
12. Thiết kế catalog để cập nhật được, nhưng không ghi đè trực tiếp dữ liệu đang hoạt động.
13. Khi triển khai chức năng cập nhật, phải có staging, diff, validation, xác nhận, version và rollback.
14. Nếu cần thêm dependency, phải nêu lý do, tác động, giấy phép và phương án không thêm dependency; chỉ cài sau khi được duyệt.
15. Trước mọi chỉnh sửa ngoài phạm vi, phải báo rõ tác động và chờ phê duyệt.
16. Sau mỗi phase, báo cáo file thay đổi, lý do, kiểm thử đã chạy, kết quả và vấn đề còn tồn tại.

---

## 15. Định nghĩa hoàn thành giai đoạn đầu

Giai đoạn đầu được nghiệm thu khi:

- Reference hỗ trợ PostgreSQL và SQL Server.
- Catalog có schema ổn định, version và nguồn chính thức.
- Các mapping đã xác minh được phân biệt với mục chưa xác minh.
- Người dùng có thể tra cứu theo cú pháp, alias, concept và mô tả.
- Người dùng có thể nhập SQL trong Compare.
- Người dùng có thể bôi đen SQL trong Editor và mở Compare.
- Kết quả Compare hiển thị thông tin liên quan, mức tương đương, điều kiện, giới hạn và nguồn.
- Không tự thực thi hoặc chuyển đổi SQL.
- Không thay đổi công nghệ và hành vi của các module hiện có.
- Có kiểm thử và tài liệu về các file/module được thêm hoặc sửa.
- Schema hỗ trợ quy trình cập nhật tài liệu chính thức trong tương lai, nhưng chức năng cập nhật chưa bắt buộc xuất hiện ở MVP.

**Kết luận:** Triển khai theo hướng *catalog có kiểm chứng → Reference → Compare → tích hợp selection → kiểm thử hồi quy*. Chuẩn bị schema và ranh giới dịch vụ cho *Catalog Update* và *SQL Translation* ngay từ đầu, nhưng không đưa việc tải/cập nhật tự động hoặc AI chuyển đổi vào MVP. Cách này giúp LLTool có chức năng sử dụng thực tế sớm, giữ nguyên công nghệ hiện có và hạn chế chi phí thiết kế lại khi mở rộng.

---

## 16. Báo cáo nghiệm thu & Hoàn thành triển khai (Phases 0 — 5)

| Phase | Trạng thái | Hạng mục chính đã hoàn thành | Kiểm thử |
|---|---|---|---|
| **Phase 0 — Audit** | **ĐÃ HOÀN THÀNH** | Audit toàn bộ cấu trúc dự án, UI patterns, API bridge, tabs, editor, styles và tests; lập sơ đồ tích hợp không trùng lặp | Đối chiếu file thực tế |
| **Phase 1 — Schema & Catalog** | **ĐÃ HOÀN THÀNH** | Xây dựng schema JSON chuẩn (Manifest, Concepts, Syntax Entries, Mappings, Sources); xây dựng `CatalogValidator` và `SyntaxCatalogService` nạp cache có kiểm soát | 4 tests schema & validator |
| **Phase 2 — Reference Panel** | **ĐÃ HOÀN THÀNH** | Nút `?` ở đầu dải tab editor; mở desktop subwindow độc lập chuẩn DWM; tìm kiếm full-text, alias (`~~`), filter DB & Category; chi tiết cú pháp & mapping | 6 tests IPC & bridge |
| **Phase 3 — Compare Screen** | **ĐÃ HOÀN THÀNH** | Giao diện 2 editor song song (Monaco + fallback); bộ chọn dialect & nút Swap; 5 Presets mẫu; nhận diện regex pattern & đối chiếu 2 chiều (PG $\leftrightarrow$ MS); bảng kết quả badge, gotchas, conditions, limitations, copy & chèn editor | 5 tests Compare 2 chiều |
| **Phase 4 — Tích hợp Selection** | **ĐÃ HOÀN THÀNH** | Context menu Monaco `Ctrl+Alt+C` & `Ctrl+Alt+S`; context menu tab editor; tự động nhận diện DB provider hiện tại; trích xuất selection an toàn (read-only, bảo toàn editor gốc); xử lý mượt mà selection rỗng | 3 tests Selection & bridge |
| **Phase 5 — Hardening & Nghiệm thu**| **ĐÃ HOÀN THÀNH** | Sửa triệt để reentrant lock deadlock (`RLock`); mutation observer theme Monaco; dọn dẹp tài nguyên khi đóng subwindow; kiểm thử fallback khi thiếu catalog; kiểm thử hồi quy 100% pass | 21 tests catalog + 25 tests hồi quy |

### Tổng hợp tiêu chí kỹ thuật:
- **Zero Inline CSS:** 100% tuân thủ, không sử dụng thuộc tính `style=""` trong HTML.
- **Bảo toàn môi trường đóng gói:** Không thay đổi các thư mục `dist/`, `build/` hoặc gói phát hành.
- **An toàn truy vấn:** Màn hình Compare chỉ tra cứu từ điển cú pháp, tuyệt đối không tự ý thực thi SQL lên database của người dùng.
