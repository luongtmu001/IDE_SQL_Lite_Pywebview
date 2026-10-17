# QUY TẮC VÀ THỨ TỰ THỰC HIỆN CẢI TIẾN INTELLISENSE & SYNTAX CHECK

**Dự án:** IDE SQL Lite — PyWebView + Monaco Editor + Flask  
**Hệ quản trị:** Microsoft SQL Server (T-SQL) và PostgreSQL (SQL / PL/pgSQL)  
**Mục tiêu:** Cải thiện tính đúng đắn, độ bao phủ và khả năng kiểm chứng của Syntax Highlighting, IntelliSense và Syntax Check mà không làm hỏng chức năng hiện có.

---

## 1. Nguyên tắc bắt buộc

1. Đọc báo cáo audit và kiểm tra code thực tế trước khi sửa. Báo cáo là căn cứ khởi đầu, không thay thế việc xác minh trong mã nguồn.
2. Nếu kết luận trong báo cáo không khớp với code hoặc kết quả test hiện tại, ghi rõ bằng chứng, mức độ ảnh hưởng và phương án đề xuất trước khi sửa phần liên quan.
3. Xử lý nguyên nhân gốc; không thêm điều kiện đặc biệt chỉ để làm một test đơn lẻ vượt qua.
4. Ưu tiên sửa tối thiểu trong kiến trúc hiện có. Không refactor lớn, thay framework, thay parser hoặc thiết kế lại toàn bộ nếu chưa có lý do kỹ thuật và phê duyệt.
5. Không xóa file syntax, keyword registry, parser hoặc module cũ chỉ vì tạm thời không sử dụng.
6. Không thay đổi giao diện, bố cục, màu sắc, thao tác bàn phím hoặc hành vi editor ngoài phạm vi được duyệt.
7. Không sửa các chức năng ngoài phạm vi. Nếu phát hiện vấn đề ngoài phạm vi có ảnh hưởng nghiêm trọng, báo cáo trước khi mở rộng.
8. Không tuyên bố tính năng được hỗ trợ chỉ vì tìm thấy keyword trong code hoặc giao diện đã hiển thị từ khóa.
9. Mọi kết luận PASS/DONE phải có test hoặc bằng chứng cụ thể. Phần chưa kiểm chứng phải ghi rõ.
10. Không thực thi DDL, thay đổi dữ liệu, tạo hoặc sửa routine trên database thật chỉ để kiểm tra cú pháp.

## 2. Phân biệt ba lớp chức năng

### 2.1. Syntax Highlighting
- Xác định tokenizer thực tế được đăng ký với Monaco Editor.
- Kiểm tra từ khóa và thành phần cú pháp được tô màu trong đúng dialect.
- Phân biệt keyword, kiểu dữ liệu, hàm, biến, identifier, chuỗi và comment.
- Kiểm tra quy tắc ghép nhiều từ nếu có yêu cầu, nhưng không làm hỏng tokenization hiện tại.
- Tô màu đúng không đồng nghĩa với IntelliSense hoặc Syntax Check đã hỗ trợ cú pháp đó.

### 2.2. IntelliSense Completion
- Truy vết luồng từ thao tác gõ ký tự đến phân tích ngữ cảnh, sinh ứng viên, lọc, xếp hạng và hiển thị.
- Kiểm tra riêng keyword, table/column, alias, variable, parameter, function và context-aware completion.
- Chỉ gợi ý theo dialect và ngữ cảnh phù hợp.
- Không thêm keyword vào danh sách dùng chung nếu có thể gây gợi ý sai cho hệ quản trị còn lại.
- Không thay đổi thứ tự xếp hạng ngoài phạm vi đã kiểm thử.
- Không bật gợi ý trong mọi string literal chỉ để hỗ trợ Dynamic SQL.
- Khi chưa xác định được schema hoặc bảng liên quan, không tự đoán tên cột.

### 2.3. Syntax Check
- Xác định parser và pipeline thực tế cho từng hệ quản trị, chế độ online/offline và loại câu lệnh.
- Phân biệt kiểm tra cú pháp, kiểm tra ngữ nghĩa và kiểm tra cần metadata/database.
- Không dùng kết quả của parser để khẳng định những loại cú pháp parser không hỗ trợ.
- Không báo PASS nếu phần nội dung cần kiểm tra đã bị bỏ qua.
- Bảo toàn vị trí dòng/cột khi ánh xạ lỗi về Monaco Editor.
- Không dùng việc thực thi DDL trên database người dùng làm phương pháp kiểm tra mặc định.

## 3. Trạng thái kết quả phải trung thực

Kiểm tra mô hình trạng thái hiện có trước khi bổ sung trạng thái mới. Đảm bảo phân biệt được tối thiểu các ý nghĩa sau:

- **PASS:** Đã kiểm tra thành công trong phạm vi hỗ trợ.
- **ERROR:** Đã phát hiện lỗi.
- **PARTIAL / NOT_FULLY_CHECKED:** Chỉ kiểm tra được một phần.
- **UNSUPPORTED:** Parser hoặc chế độ hiện tại không hỗ trợ cấu trúc cần kiểm tra.
- **UNAVAILABLE:** Không thể kiểm tra vì thiếu parser, kết nối hoặc điều kiện cần thiết.

Có thể ánh xạ các trạng thái này vào mô hình diagnostics hiện tại nếu đã có trạng thái tương đương. Không tự tạo API hoặc trạng thái mới nếu chưa kiểm tra cách frontend/backend đang xử lý kết quả. Tuyệt đối không chuyển trường hợp bị bỏ qua hoặc parser không hỗ trợ thành PASS.

---

## 4. Thứ tự thực hiện

Thực hiện theo từng giai đoạn. Kết thúc mỗi giai đoạn phải có báo cáo và tiêu chí nghiệm thu; không tự động chuyển sang giai đoạn tiếp theo nếu giai đoạn trước chưa đạt.

### Giai đoạn 0 — Chốt phạm vi và lập đường cơ sở

**Công việc**
1. Đọc báo cáo audit đầy đủ và đối chiếu các phát hiện quan trọng với code hiện tại.
2. Kiểm tra trạng thái Git/diff trước khi sửa để không ghi đè công việc sẵn có.
3. Lập danh sách module thực sự đang hoạt động cho:
   - Monaco Syntax Highlighting.
   - IntelliSense context analysis, candidate generation, filtering/ranking và UI.
   - SQL Server Syntax Check.
   - PostgreSQL Syntax Check.
4. Ghi lại cấu hình pipeline, parser/dependency/version và đường đi của kết quả từ backend đến diagnostics trên editor.
5. Tạo bảng truy vết lỗi → nguyên nhân → module → test.
6. Chạy test hiện có và lưu kết quả làm baseline.

**Đầu ra bắt buộc**
- Danh sách file dự kiến thay đổi và file phải giữ nguyên.
- Bảng phát hiện đã xác minh / chưa xác minh / không còn đúng.
- Baseline test và các lỗi tái hiện được.
- Danh sách rủi ro và phạm vi ảnh hưởng.

**Điều kiện qua giai đoạn**
- Đã xác định được codepath thực tế.
- Các phát hiện cần xử lý có cách tái hiện hoặc bằng chứng rõ ràng.
- Chưa sửa code trong giai đoạn này.

### Giai đoạn 1 — SQL Server Syntax Check và đánh giá ScriptDom

**Công việc**
1. Kiểm tra phiên bản ScriptDom, phiên bản T-SQL parser, cách gọi, xử lý lỗi và đóng gói ứng dụng.
2. Chạy cùng bộ test trên validator cũ và ScriptDom, bao gồm:
   - SQL hợp lệ và không hợp lệ.
   - Stored Procedure, Function, Trigger.
   - BEGIN/END và cấu trúc TRY/CATCH lồng nhau.
   - CTE, DML, biến, tham số và cú pháp theo phiên bản mục tiêu.
3. Đối chiếu false positive, false negative, vị trí dòng/cột và độ ổn định.
4. Kiểm tra xử lý khi parser không khởi chạy, thiếu dependency hoặc trả kết quả không mong đợi.
5. Chỉ sau khi có đủ bằng chứng mới đề xuất chuyển ScriptDom thành pipeline chính. Chuẩn bị cách quay lại pipeline cũ nếu phát sinh lỗi nghiêm trọng.

**Quy tắc**
- Không bật `syntax.pipeline: true` mặc định chỉ dựa trên một số ca thử nghiệm tốt.
- Không tuyên bố ScriptDom kiểm tra ngữ nghĩa database nếu thực tế chỉ phân tích cú pháp.
- Không xóa validator cũ trong giai đoạn chuyển đổi.

**Điều kiện nghiệm thu**
- Bộ test hồi quy đã chạy và có kết quả.
- Không có lỗi nghiêm trọng chưa được giải thích.
- Đã kiểm tra đóng gói và fallback.
- Quyết định chuyển pipeline được ghi rõ cùng bằng chứng.

### Giai đoạn 2 — PostgreSQL PL/pgSQL Syntax Check offline

**Công việc**
1. Xác minh chính xác giới hạn của validator PostgreSQL hiện tại, nhất là phần thân dollar-quoted của function/procedure.
2. Đánh giá parser/thư viện sẵn có trước khi tự xây parser. Có thể khảo sát `pglast.parse_plpgsql`, nhưng phải xác minh khả năng hỗ trợ, giới hạn biểu diễn và tương thích với phiên bản PostgreSQL mục tiêu trước khi chọn.
3. Xây dựng corpus gồm cú pháp hợp lệ/không hợp lệ: IF/ELSIF, LOOP, FOREACH, CASE, EXCEPTION, DECLARE, RETURN, RAISE, PERFORM, SQL lồng nhau, string, comment và dollar-quote tag.
4. Kiểm tra parser trên corpus, bao gồm vị trí lỗi và khả năng phân biệt cú pháp với chuỗi/comment.
5. Nếu parser không thể phân tích một phần cấu trúc, biểu thị trạng thái chưa kiểm tra đầy đủ; không tự viết bộ đếm keyword/regex rồi xem đó là parser đầy đủ.
6. Tách rõ kiểm tra SQL query, DDL/routine definition, PL/pgSQL body và kiểm tra ngữ nghĩa cần database.
7. Rà soát cơ chế online: không giả định `PREPARE` có thể kiểm tra tổng quát toàn bộ `CREATE FUNCTION` hoặc thân PL/pgSQL. Chỉ dùng cơ chế phù hợp với từng loại câu lệnh và không thực thi DDL trên database thật chỉ để validate.

**Điều kiện nghiệm thu**
- Các cấu trúc trong phạm vi hỗ trợ có test hợp lệ và không hợp lệ.
- Không báo PASS khi thân PL/pgSQL bị bỏ qua.
- Có tài liệu rõ các cấu trúc chưa hỗ trợ hoặc chưa được kiểm chứng.
- Không gây side effect lên database người dùng.

### Giai đoạn 3 — Kiểm kê và đồng bộ keyword PostgreSQL

**Công việc**
1. Đối chiếu danh sách keyword hiện tại với tài liệu PostgreSQL/PL/pgSQL của phiên bản mục tiêu.
2. Không lấy con số “41 từ khóa” trong báo cáo làm danh sách chuẩn cố định; kiểm tra từng mục và tìm các mục còn thiếu.
3. Phân loại thành SQL keyword, PL/pgSQL statement, kiểu dữ liệu, cú pháp khai báo kiểu, option/argument và thành phần của câu lệnh.
4. Chú ý các dạng cú pháp như `%ROWTYPE`: không xử lý `ROWTYPE` như keyword độc lập trong mọi ngữ cảnh.
5. Kiểm tra riêng các lớp:
   - `PostgresDialect` và nguồn keyword cho completion.
   - Monarch tokenizer cho highlighting.
   - Context analyzer và candidate generator cho ngữ cảnh.
6. Tránh tạo danh sách trùng lặp hoặc thay đổi kiến trúc registry rộng hơn mức cần thiết.
7. Bổ sung test theo tiền tố, ngữ cảnh và dialect.

**Điều kiện nghiệm thu**
- Có danh sách keyword đã xác minh, phân loại và trạng thái từng lớp.
- Test chứng minh highlighting và completion độc lập.
- Không có gợi ý PostgreSQL sai trong SQL Server hoặc ngược lại.

### Giai đoạn 4 — Cải thiện IntelliSense theo ngữ cảnh

Thực hiện từng mục riêng, không gộp nhiều thay đổi lớn vào một lần.

**4.1. T-SQL TRY/CATCH**
- Nhận diện chính xác con trỏ nằm trong `BEGIN CATCH ... END CATCH`.
- Ưu tiên `ERROR_MESSAGE()`, `ERROR_NUMBER()`, `ERROR_LINE()`, `ERROR_SEVERITY()`, `ERROR_STATE()`, `ERROR_PROCEDURE()` và `THROW` trong ngữ cảnh phù hợp.
- Không làm thay đổi ranking chung ngoài CATCH.

**4.2. PostgreSQL OLD/NEW**
- Ưu tiên suy luận bảng từ `CREATE TRIGGER ... ON <table>` khi có đủ thông tin.
- Nếu cần, đọc metadata/catalog để xác định trigger và bảng liên kết, theo đúng quyền hiện có.
- Cho phép chỉ định ngữ cảnh khi chưa thể suy luận.
- Không mặc định một trigger function chỉ gắn với một bảng.
- Nếu chưa xác định được bảng, thông báo rõ giới hạn thay vì đoán cột.

**4.3. Dynamic SQL**
- Chỉ hỗ trợ phân tích chuỗi SQL tĩnh khi có thể xác định chắc chắn nội dung và ngữ cảnh.
- Không bật completion hoặc syntax check cho mọi string literal.
- Không khẳng định kiểm tra được SQL được tạo động từ biến hoặc biểu thức chưa biết giá trị.

**Điều kiện nghiệm thu**
- Có test trước/sau cho đúng ngữ cảnh.
- Không làm hỏng completion bình thường hoặc ngữ cảnh khác.
- Khi thiếu thông tin, hệ thống không đưa ra kết luận hoặc gợi ý giả tạo.

### Giai đoạn 5 — Syntax Highlighting cho cú pháp còn thiếu

**Công việc**
1. Bổ sung các token PostgreSQL/PLpgSQL đã xác minh còn thiếu.
2. Xem xét `CROSS APPLY`, `OUTER APPLY`, `WITHIN GROUP` và các cụm nhiều từ khác nếu thực sự cần.
3. Kiểm tra thứ tự rule của Monarch để tránh cụm từ bị tách hoặc nhận diện nhầm.
4. Đảm bảo string, comment, quoted identifier, biến và identifier thông thường không bị tô màu sai.
5. Không thay đổi palette/màu giao diện nếu không thuộc yêu cầu.

**Điều kiện nghiệm thu**
- Có test tokenization cho cú pháp mới và các trường hợp lân cận.
- Không làm hỏng highlighting hiện có của cả hai dialect.

### Giai đoạn 6 — Kiểm thử tích hợp và hồi quy

**Bộ test bắt buộc**
- SQL Server: query, CTE, DML, variable, Stored Procedure, Function, Trigger, TRY/CATCH, cấu trúc lồng nhau.
- PostgreSQL: query, CTE, RETURNING, ON CONFLICT, Function SQL, Function PL/pgSQL, Procedure, Trigger Function.
- Cả hai: chuỗi, comment, quoted identifier, dollar-quote (PostgreSQL), cú pháp hợp lệ và không hợp lệ, completion theo tiền tố, vị trí dòng/cột.
- Trạng thái parser thiếu hoặc không hỗ trợ.
- Chạy online/offline theo phạm vi sản phẩm.
- Kiểm tra regression và hoạt động trong bản đóng gói PyWebView.

**Báo cáo test phải ghi**
- Tổng số test, số PASS/FAIL/NOT RUN.
- False positive và false negative.
- Parser, phiên bản và cấu hình sử dụng.
- Các lỗi chưa giải quyết và lý do.
- Những phần chưa được kiểm thử; không suy rộng kết quả ngoài phạm vi corpus.

### Giai đoạn 7 — Tổng kết và bàn giao

Báo cáo cuối phải có:
1. Nguyên nhân gốc đã xác minh.
2. File thay đổi và lý do thay đổi.
3. Giải pháp được chọn và giải pháp đã cân nhắc nhưng không chọn.
4. Test đã chạy, kết quả thực tế và test chưa chạy.
5. Danh sách keyword/cú pháp được hỗ trợ theo từng lớp.
6. Các giới hạn còn tồn tại.
7. Tác động đến SQL Server, PostgreSQL, frontend, backend và đóng gói.
8. Backlog tiếp theo theo P0–P3.
9. Trạng thái từng hạng mục: DONE, PARTIAL, BLOCKED hoặc NOT STARTED.

Không ghi DONE nếu chỉ mới thêm keyword hoặc chạy một vài mẫu test.

---

## 5. Bảng truy vết bắt buộc cho mỗi lỗi

Trước khi sửa mỗi lỗi, lập một dòng trong bảng:

| Trường | Nội dung |
|---|---|
| Mã lỗi | Ví dụ `PG-FN-MISSING-END` |
| Hiện tượng | Hành vi sai có thể tái hiện |
| Nguyên nhân gốc | Bằng chứng từ code hoặc test |
| Module trực tiếp | Thành phần tạo ra hành vi sai |
| Module liên quan | Các lớp có thể bị tác động |
| Phương án sửa | Giải pháp được đề xuất và lý do |
| Phương án thay thế | Các lựa chọn khác và lý do không chọn |
| Test trước sửa | Bằng chứng tái hiện lỗi |
| Test sau sửa | Bằng chứng lỗi được xử lý |
| Hồi quy | Các chức năng cần kiểm tra lại |
| Trạng thái | NOT STARTED / IN PROGRESS / DONE / PARTIAL / BLOCKED |

Nếu chưa xác định được nguyên nhân gốc, không bắt đầu thay đổi diện rộng.

---

## 6. Quy tắc quản lý phạm vi và file

Trước mỗi đợt sửa, phải ghi rõ:
- File dự kiến sửa.
- File phải giữ nguyên.
- Chức năng có thể bị ảnh hưởng.
- Tác động tiềm ẩn đến dialect còn lại.
- Test cần chạy.

Trong quá trình thực hiện:
- Không xóa file cũ hoặc file tạm thời không sử dụng.
- Không sửa dữ liệu người dùng, cấu hình kết nối hoặc file thiết lập không liên quan.
- Không thay đổi API/contract giữa frontend và backend nếu không cần thiết.
- Nếu buộc phải đổi contract, phải liệt kê toàn bộ nơi gọi và cập nhật test tương ứng.
- Mỗi thay đổi phải có phạm vi nhỏ, dễ review và dễ rollback.
- Không gộp sửa parser, thay đổi kiến trúc keyword và chỉnh UI vào cùng một đợt nếu có thể tách độc lập.

---

## 7. Quy tắc ưu tiên thực hiện

Thứ tự mặc định:

1. **P0 — Đường cơ sở và độ đúng đắn:** xác minh pipeline SQL Server, ScriptDom, trạng thái Syntax Check và khả năng đóng gói.
2. **P1 — PostgreSQL PL/pgSQL Syntax Check:** đánh giá parser và giải quyết tình trạng bỏ qua thân routine.
3. **P1 — Keyword PostgreSQL:** kiểm kê, phân loại và đồng bộ riêng highlighting/completion.
4. **P2 — IntelliSense theo ngữ cảnh:** T-SQL CATCH và PostgreSQL OLD/NEW.
5. **P3 — Dynamic SQL và cú pháp highlighting bổ sung.**
6. **Cuối cùng — Chạy full regression, đóng gói và tổng kết.**

Thứ tự này có thể thay đổi khi audit xác minh được rủi ro nghiêm trọng hơn, nhưng phải nêu lý do và tác động trước khi đổi thứ tự.

## 8. Tiêu chí hoàn thành chung

Chỉ đánh dấu hoàn thành khi:
- Nguyên nhân gốc được xử lý.
- Test mới và test hồi quy quan trọng đạt yêu cầu.
- Không có lỗi nghiêm trọng chưa được giải thích.
- Không phát hiện thay đổi ngoài phạm vi.
- Trạng thái chưa hỗ trợ được biểu diễn trung thực.
- Đã xác minh hoạt động ở cấu hình và bản đóng gói mục tiêu.
- Báo cáo nêu rõ giới hạn và phần chưa được kiểm chứng.

Nếu chưa đủ bằng chứng, ghi PARTIAL hoặc BLOCKED thay vì DONE.
