# KẾ HOẠCH AUDIT CHUYÊN SÂU INTELLISENSE VÀ SYNTAX CHECK

## 1. Mục tiêu

Thực hiện audit toàn diện chức năng IntelliSense và Syntax Check hiện có trong IDE SQL, tập trung vào hai hệ quản trị:

* Microsoft SQL Server — T-SQL.
* PostgreSQL — SQL và PL/pgSQL.

Mục tiêu không phải sửa code ngay lập tức mà phải xác định chính xác hiện trạng hệ thống, mức độ hỗ trợ thực tế, các lỗi đang tồn tại, những từ khóa và cấu trúc cú pháp còn thiếu, nguyên nhân thiếu sót và mức độ ảnh hưởng.

AI Agent phải khảo sát code thực tế trong project, chạy các bài kiểm tra phù hợp và đưa ra báo cáo có bằng chứng. Không được chỉ đọc tên file, suy đoán từ cấu trúc code hoặc khẳng định chức năng hoạt động tốt chỉ vì đã có cơ chế syntax highlighting.

### Nguyên tắc bắt buộc

1. Audit trước, không tự ý sửa code trong giai đoạn này.
2. Không xóa, ghi đè hoặc vô hiệu hóa các file syntax, keyword, completion provider và parser hiện có.
3. Không thay đổi giao diện hoặc hành vi hiện tại của IDE.
4. Phân biệt rõ chức năng đã được triển khai, chức năng được triển khai một phần và chức năng chưa được triển khai.
5. Mọi kết luận quan trọng phải có bằng chứng từ code hoặc kết quả kiểm thử.
6. Phải liệt kê cụ thể từng từ khóa, cú pháp và tính năng còn thiếu; không chỉ báo cáo tỷ lệ tổng quát.
7. Kiểm tra riêng SQL Server và PostgreSQL, không suy rộng kết quả từ hệ quản trị này sang hệ quản trị còn lại.
8. Kết thúc audit bằng báo cáo hiện trạng và backlog cải tiến có thứ tự ưu tiên. Chưa thực hiện các cải tiến trong giai đoạn này.

---

# 2. Phạm vi audit

## 2.1. IntelliSense

Kiểm tra các chức năng:

* Nhận diện từ khóa SQL.
* Gợi ý từ khóa khi người dùng nhập.
* Gợi ý tên database, schema, table, view và column.
* Gợi ý stored procedure, function và trigger khi phù hợp.
* Gợi ý biến, tham số và alias.
* Nhận diện ngữ cảnh câu lệnh.
* Phân biệt ngữ cảnh SQL Server và PostgreSQL.
* Nhận diện ngữ cảnh bên trong function, procedure và trigger.
* Gợi ý các thành phần cú pháp phù hợp với vị trí con trỏ.
* Hỗ trợ dấu ngoặc, CTE, truy vấn lồng nhau và các block lồng nhau.
* Khả năng gợi ý sau dấu chấm, sau FROM, JOIN, WHERE, SET, EXEC/CALL và các vị trí đặc thù.
* Khả năng xử lý chữ hoa, chữ thường, identifier có dấu ngoặc hoặc dấu nháy.
* Khả năng xử lý khi người dùng nhập SQL chưa hoàn chỉnh.
* Khả năng nhận diện đối tượng database theo kết nối hiện tại.
* Kiểm tra tính chính xác của danh sách gợi ý, không chỉ việc popup có xuất hiện.

Phải phân biệt keyword completion với database-object completion. Đây là hai nhóm có nguồn dữ liệu và điều kiện đánh giá khác nhau.

## 2.2. Syntax Check

Kiểm tra:

* Phát hiện lỗi cú pháp.
* Xác định vị trí lỗi.
* Hiển thị thông báo lỗi.
* Phát hiện cú pháp thiếu hoặc không hợp lệ.
* Xử lý câu SQL chưa hoàn chỉnh trong quá trình nhập.
* Xử lý nhiều câu lệnh trong cùng một editor.
* Xử lý dấu chấm phẩy và các dấu phân cách batch nếu hệ quản trị hỗ trợ.
* Xử lý comment một dòng và nhiều dòng.
* Xử lý chuỗi ký tự, quoted identifier và escaped character.
* Phân biệt lỗi cú pháp với cảnh báo hoặc lỗi ngữ nghĩa.
* Phân biệt lỗi cú pháp thực sự với cú pháp hợp lệ nhưng chưa được parser hỗ trợ.
* Kiểm tra khả năng hiển thị nhiều lỗi trong cùng một tài liệu.
* Kiểm tra việc xóa hoặc cập nhật diagnostic sau khi người dùng sửa SQL.

Không được đánh đồng việc tô màu từ khóa với việc kiểm tra cú pháp. Một editor có syntax highlighting tốt vẫn có thể không phát hiện được lỗi cú pháp.

## 2.3. Phạm vi bên trong SQL module

Đây là nhóm kiểm tra trọng tâm.

Phải kiểm tra đầy đủ các cấu trúc bên trong:

### SQL Server

* Stored procedure.
* Scalar function.
* Inline table-valued function.
* Multi-statement table-valued function.
* DML trigger.
* DDL trigger nếu IDE hỗ trợ loại object này.
* Các block BEGIN...END.
* IF...ELSE.
* WHILE.
* TRY...CATCH.
* DECLARE và SET.
* SELECT gán biến.
* INSERT, UPDATE, DELETE và MERGE.
* EXEC và dynamic SQL.
* Cursor.
* CTE và truy vấn lồng nhau.
* Transaction và xử lý lỗi.
* Các câu lệnh đặc thù của T-SQL trong module.

### PostgreSQL

* Function sử dụng SQL.
* Function sử dụng PL/pgSQL.
* Procedure.
* Trigger function.
* Các block DECLARE...BEGIN...END.
* IF...THEN...ELSIF...ELSE.
* CASE.
* LOOP, WHILE, FOR và FOREACH.
* RETURN và RETURN QUERY.
* RAISE.
* EXECUTE và dynamic SQL.
* SELECT INTO.
* PERFORM.
* Cursor và refcursor.
* Exception handling.
* CTE và truy vấn lồng nhau.
* Các câu lệnh SQL nhúng trong PL/pgSQL.
* Các đặc điểm riêng của function và procedure.

Phải xác định chính xác cấu trúc nào được hỗ trợ trong từng loại module. Không mặc định rằng hỗ trợ câu SQL độc lập đồng nghĩa với hỗ trợ SQL bên trong function, procedure hoặc trigger.

---

# 3. Giai đoạn 1 — Khảo sát kiến trúc hiện tại

## 3.1. Kiểm tra toàn bộ thành phần liên quan

AI Agent phải xác định các file và module thực tế đang tham gia vào:

* Khởi tạo Monaco Editor.
* Khai báo ngôn ngữ SQL.
* Đăng ký syntax highlighting.
* Đăng ký completion provider.
* Xây dựng danh sách keyword.
* Lấy metadata database phục vụ IntelliSense.
* Phân tích cú pháp.
* Kiểm tra cú pháp theo thời gian thực hoặc theo lệnh.
* Hiển thị diagnostic.
* Xử lý SQL Server.
* Xử lý PostgreSQL.
* Xử lý nội dung trong function, procedure và trigger.
* Cấu hình parser hoặc extension bên ngoài, nếu có.

Phải xác định cả những thành phần đang hoạt động và những thành phần tồn tại nhưng chưa được sử dụng.

Nếu project có nhiều bộ xử lý SQL cùng tồn tại, phải xác định rõ bộ nào thực sự được gọi tại thời điểm người dùng nhập SQL và bộ nào chỉ còn trong code.

## 3.2. Xác định luồng xử lý thực tế

Lập sơ đồ cho từng hệ quản trị:

Editor
→ Language Configuration
→ Syntax Highlighting
→ Completion Provider
→ Syntax Check Engine
→ Diagnostic Provider
→ UI Display.

Nếu một bước không tồn tại, phải ghi rõ.

Đối với IntelliSense dựa trên metadata:

Editor
→ Context Detection
→ Database Metadata
→ Candidate Generation
→ Filtering và Ranking
→ Completion Popup.

Đối với Syntax Check:

Editor
→ Source Text
→ Parser hoặc Validator
→ Error Collection
→ Position Mapping
→ Monaco Diagnostics.

Không được giả định kiến trúc thực tế giống sơ đồ trên. Đây là danh sách thành phần cần xác minh.

## 3.3. Kiểm tra cơ chế nhận diện ngữ cảnh

Xác định cách hệ thống biết con trỏ đang nằm trong:

* Câu lệnh SQL độc lập.
* Thân procedure.
* Thân function.
* Thân trigger.
* Block điều kiện.
* Truy vấn con.
* Comment.
* String literal.
* Dynamic SQL.
* Nội dung chưa hoàn chỉnh.

Phải kiểm tra xem hệ thống thực sự phân tích cấu trúc cú pháp hay chỉ sử dụng Regex, vị trí từ khóa và heuristic.

Nếu dùng Regex hoặc heuristic, phải liệt kê các trường hợp dễ nhận diện sai và đánh giá bằng kiểm thử thực tế.

### Đầu ra giai đoạn 1

Bảng inventory:

| Thành phần          | File/module       | Đang được sử dụng | Hệ quản trị           | Vai trò           | Hạn chế đã xác minh |
| ------------------- | ----------------- | ----------------- | --------------------- | ----------------- | ------------------- |
| Syntax Highlighting | Đường dẫn thực tế | Có/Không          | SQL Server/PostgreSQL | Tô màu            | Bằng chứng          |
| Completion Provider | Đường dẫn thực tế | Có/Không          | SQL Server/PostgreSQL | Gợi ý             | Bằng chứng          |
| Keyword Registry    | Đường dẫn thực tế | Có/Không          | SQL Server/PostgreSQL | Danh sách keyword | Bằng chứng          |
| Syntax Parser       | Đường dẫn thực tế | Có/Không          | SQL Server/PostgreSQL | Kiểm tra cú pháp  | Bằng chứng          |
| Diagnostic Handler  | Đường dẫn thực tế | Có/Không          | SQL Server/PostgreSQL | Hiển thị lỗi      | Bằng chứng          |

Không được điền kết quả bằng suy đoán khi chưa khảo sát project.

---

# 4. Giai đoạn 2 — Audit danh sách từ khóa SQL Server và PostgreSQL

## 4.1. Mục tiêu

Xác định danh sách từ khóa hiện có trong project, so sánh với nguồn tham chiếu phù hợp và kiểm tra khả năng nhận diện thực tế.

Không được chỉ kiểm tra một danh sách keyword rồi kết luận hệ thống hỗ trợ đầy đủ.

Một từ khóa có thể:

* Có trong danh sách nhưng không được tô màu.
* Được tô màu nhưng không được IntelliSense gợi ý.
* Được gợi ý nhưng không hợp lệ trong ngữ cảnh hiện tại.
* Là từ khóa hợp lệ nhưng chưa được hỗ trợ bởi parser.
* Là từ khóa phụ thuộc phiên bản database.
* Là identifier hợp lệ trong một số ngữ cảnh.

## 4.2. SQL Server

Kiểm tra tối thiểu các nhóm:

1. DDL: CREATE, ALTER, DROP và các biến thể.
2. DML: SELECT, INSERT, UPDATE, DELETE, MERGE.
3. DCL: GRANT, DENY, REVOKE.
4. TCL: BEGIN TRANSACTION, COMMIT, ROLLBACK và các biến thể.
5. Điều khiển luồng: IF, ELSE, BEGIN, END, WHILE, BREAK, CONTINUE, RETURN.
6. Khai báo và xử lý biến: DECLARE, SET, OUTPUT.
7. Xử lý lỗi: TRY, CATCH, THROW, RAISERROR.
8. CTE: WITH, RECURSIVE-equivalent patterns where applicable, và cú pháp liên quan đến CTE của T-SQL.
9. JOIN và các dạng kết hợp dữ liệu.
10. Window functions và các thành phần OVER, PARTITION BY, ROWS, RANGE.
11. Các từ khóa liên quan đến JSON, XML, temporal tables và các tính năng SQL Server được hỗ trợ.
12. Cú pháp đặc thù trong stored procedure, function và trigger.
13. Các từ khóa hoặc cú pháp mới theo phiên bản SQL Server mục tiêu.

Phải đối chiếu với phiên bản SQL Server mục tiêu của IDE. Không được yêu cầu mọi keyword chỉ có ở phiên bản mới phải hợp lệ với mọi phiên bản SQL Server.

Nguồn tham chiếu cần được ghi rõ phiên bản và thời điểm đối chiếu.

## 4.3. PostgreSQL

Kiểm tra tối thiểu các nhóm:

1. DDL.
2. DML.
3. DCL và quyền truy cập.
4. Transaction control.
5. JOIN, CTE và truy vấn lồng nhau.
6. Window functions.
7. JSON và JSONB.
8. Array và các toán tử liên quan.
9. RETURNING.
10. UPSERT: ON CONFLICT.
11. Các từ khóa và cấu trúc liên quan đến schema, role và sequence.
12. PL/pgSQL declaration và block structure.
13. IF, CASE, LOOP, WHILE, FOR, FOREACH.
14. RETURN, RETURN NEXT, RETURN QUERY, PERFORM, RAISE.
15. EXECUTE, USING và dynamic SQL.
16. EXCEPTION handling.
17. Function, procedure và trigger-related syntax.
18. Các từ khóa hoặc cú pháp mới theo phiên bản PostgreSQL mục tiêu.

Phải phân biệt keyword SQL, keyword PL/pgSQL, built-in function, built-in type, operator và database object. Không được gộp tất cả vào một danh sách rồi báo cáo như thể chúng có cùng vai trò.

## 4.4. Đối chiếu với nguồn tham chiếu

Đối với SQL Server:

* Đối chiếu keyword và cú pháp với tài liệu Microsoft.
* Nếu có sử dụng ScriptDom, xác định chính xác phiên bản parser và các cú pháp được hỗ trợ.
* Phân biệt cú pháp được ScriptDom hỗ trợ với cú pháp được completion provider nhận diện.

Đối với PostgreSQL:

* Đối chiếu với tài liệu PostgreSQL chính thức theo phiên bản mục tiêu.
* Phân biệt cú pháp SQL với PL/pgSQL.
* Không coi danh sách keyword của một phiên bản PostgreSQL là chuẩn tuyệt đối cho mọi phiên bản.

Nguồn tham chiếu:

* Microsoft T-SQL IntelliSense: <https://learn.microsoft.com/en-us/ssms/scripting/transact-sql-syntax-supported-by-intellisense>
* Microsoft ScriptDOM: <https://github.com/microsoft/SqlScriptDOM>
* PostgreSQL Documentation: <https://www.postgresql.org/docs/>

## 4.5. Phải tạo danh sách keyword thiếu

Đây là đầu ra bắt buộc, không được bỏ qua.

Tạo bảng riêng cho SQL Server và PostgreSQL:

| Keyword/Cú pháp | Hệ quản trị | Phiên bản          | Có trong project | Được tô màu   | Được gợi ý    | Parser hỗ trợ | Kết quả  |
| --------------- | ----------- | ------------------ | ---------------- | ------------- | ------------- | ------------- | -------- |
| Tên thực tế     | SQL Server  | Phiên bản mục tiêu | Có/Không         | Đạt/Không đạt | Đạt/Không đạt | Đạt/Không đạt | Kết luận |
| Tên thực tế     | PostgreSQL  | Phiên bản mục tiêu | Có/Không         | Đạt/Không đạt | Đạt/Không đạt | Đạt/Không đạt | Kết luận |

Danh sách cuối cùng phải tách riêng:

* Keyword hoàn toàn thiếu.
* Keyword có nhưng không được nhận diện.
* Keyword được nhận diện sai.
* Keyword được nhận diện trong câu lệnh độc lập nhưng lỗi trong module.
* Keyword chỉ được hỗ trợ ở một phiên bản nhất định.
* Keyword bị đánh dấu sai vì không phân biệt được keyword với identifier.
* Keyword chưa thể kết luận vì thiếu nguồn kiểm chứng.

Không được tự tạo danh sách thiếu dựa trên kiến thức chung. Mỗi mục phải được xác minh với code hoặc test.

---

# 5. Giai đoạn 3 — Audit IntelliSense trong function, procedure và trigger

## 5.1. Mục tiêu

Xác định IntelliSense có hoạt động đúng khi con trỏ nằm trong thân các module hay không.

Không chỉ kiểm tra việc popup xuất hiện. Phải kiểm tra nội dung gợi ý có chính xác, đầy đủ và phù hợp với ngữ cảnh hay không.

## 5.2. Bộ ngữ cảnh kiểm thử

Đối với mỗi hệ quản trị, kiểm tra các tình huống:

### A. Từ khóa

* Nhập từ khóa đầu câu lệnh.
* Nhập từ khóa sau SELECT, FROM, WHERE, JOIN, SET.
* Nhập từ khóa bên trong block điều khiển.
* Nhập từ khóa trong truy vấn lồng nhau.
* Nhập từ khóa trong function hoặc trigger.
* Nhập từ khóa khi câu lệnh còn thiếu thành phần.

### B. Database objects

* Gợi ý bảng sau FROM.
* Gợi ý bảng sau JOIN.
* Gợi ý cột sau SELECT.
* Gợi ý cột sau alias.
* Gợi ý cột sau dấu chấm.
* Gợi ý schema-qualified object.
* Gợi ý procedure/function khi gọi.
* Gợi ý object trong CTE hoặc subquery.
* Kiểm tra alias và phạm vi của alias.
* Kiểm tra cột cùng tên thuộc nhiều bảng.
* Kiểm tra object không tồn tại.

### C. Biến và tham số

SQL Server:

* Biến cục bộ `@variable`.
* Tham số procedure.
* Tham số function.
* Biến bảng và table-valued parameter nếu IDE hỗ trợ.
* Pseudo-tables `inserted` và `deleted` trong trigger.
* Phân biệt biến với cột cùng tên.

PostgreSQL:

* Tham số function và procedure.
* Biến khai báo trong DECLARE.
* Biến record và row type.
* NEW và OLD trong trigger function.
* Biến vòng lặp.
* Tham số của dynamic SQL.
* Phân biệt biến PL/pgSQL với cột cùng tên.

### D. Ngữ cảnh lồng nhau

* IF/ELSE.
* CASE.
* WHILE hoặc LOOP.
* BEGIN/END.
* CTE.
* Subquery.
* EXISTS.
* Correlated subquery.
* Dynamic SQL.
* Block xử lý lỗi.

### E. Ngữ cảnh đặc thù

SQL Server:

* `INSERTED` và `DELETED`.
* `EXEC` hoặc `EXECUTE`.
* `TRY...CATCH`.
* `THROW`.
* `OUTPUT`.
* `MERGE`.
* `CROSS APPLY` và `OUTER APPLY`.

PostgreSQL:

* `PERFORM`.
* `RETURN QUERY`.
* `RETURN NEXT`.
* `RAISE`.
* `EXECUTE ... USING`.
* `SELECT INTO`.
* `FOR ... IN`.
* `EXCEPTION`.
* `TG_OP`, `TG_TABLE_NAME` và các biến trigger liên quan.

Đây là các nhóm kiểm thử, không phải khẳng định rằng tất cả đã được hỗ trợ hoặc phải có cùng hành vi giữa hai hệ quản trị.

## 5.3. Tiêu chí đánh giá IntelliSense

Mỗi test case phải ghi nhận:

* Gợi ý có xuất hiện đúng thời điểm không.
* Danh sách có chứa mục mong đợi không.
* Có mục không hợp lệ hoặc không liên quan không.
* Thứ tự gợi ý có hợp lý không.
* Chọn một gợi ý có chèn đúng nội dung không.
* Có giữ đúng vị trí con trỏ không.
* Có xử lý đúng dấu chấm, dấu ngoặc và dấu nháy không.
* Có hoạt động khi câu lệnh chưa hoàn chỉnh không.
* Có nhầm identifier thành keyword không.
* Có phân biệt đúng SQL Server và PostgreSQL không.

Nếu không thể tự động kiểm thử popup, phải ghi rõ phần nào được kiểm thử thủ công và cung cấp bằng chứng.

---

# 6. Giai đoạn 4 — Audit Syntax Check trong function, procedure và trigger

## 6.1. Mục tiêu

Xác định Syntax Check có thể phân tích chính xác toàn bộ module hay chỉ hoạt động tốt với câu lệnh SQL độc lập.

Đặc biệt cần kiểm tra trường hợp cú pháp bên trong module khác với cú pháp SQL thông thường hoặc phụ thuộc phiên bản.

## 6.2. Bộ kiểm thử dương tính

Tạo các script hợp lệ cho từng loại module.

Mỗi script cần bao gồm:

* Cấu trúc tối thiểu hợp lệ.
* Cấu trúc lồng nhau.
* Nhiều câu lệnh.
* Biến và tham số.
* CTE và truy vấn con.
* Xử lý lỗi.
* Dynamic SQL.
* Các cú pháp đặc thù của module.
* Cú pháp đặc thù của phiên bản database.

Mục tiêu là kiểm tra các script hợp lệ có bị báo lỗi giả hay không.

## 6.3. Bộ kiểm thử âm tính

Tạo các script có lỗi được kiểm soát, chẳng hạn:

* Thiếu dấu ngoặc.
* Thiếu END.
* Thiếu thành phần bắt buộc.
* Sai thứ tự thành phần cú pháp.
* Sai cấu trúc IF/ELSE.
* Sai cấu trúc block.
* Sai cú pháp khai báo.
* Sai cú pháp RETURN.
* Sai cú pháp trigger.
* Sai cú pháp đặc thù của hệ quản trị.
* Cú pháp chỉ hợp lệ trên phiên bản mới nhưng được kiểm tra bằng parser cũ.

Mục tiêu là xác định Syntax Check có phát hiện lỗi thật hay bỏ sót.

## 6.4. Kiểm tra vị trí lỗi

Với mỗi lỗi được phát hiện, kiểm tra:

* Dòng.
* Cột.
* Vị trí bắt đầu và kết thúc nếu có.
* Thông báo lỗi.
* Khả năng điều hướng đến lỗi trong Monaco.
* Khả năng cập nhật lỗi sau khi sửa.
* Khả năng xử lý nhiều lỗi.
* Khả năng không đánh dấu nhầm dòng do comment, chuỗi nhiều dòng hoặc nội dung module bao ngoài.

Phải phân biệt lỗi từ parser với lỗi do mapping vị trí giữa backend và Monaco.

## 6.5. Kiểm tra khả năng phân tích module

Xác định Syntax Check có sử dụng:

* Parser T-SQL.
* Parser PostgreSQL/PL/pgSQL.
* Bộ grammar tự xây dựng.
* Regex hoặc heuristic.
* Kết hợp nhiều cơ chế.

Nếu sử dụng ScriptDom cho SQL Server, phải kiểm tra parser version, cú pháp được hỗ trợ và giới hạn khi phân tích script module.

Không được suy luận rằng ScriptDom đã kiểm tra ngữ nghĩa database chỉ vì nó phân tích được cú pháp.

Đối với PostgreSQL, phải xác định parser có hiểu được PL/pgSQL hay chỉ hiểu SQL thông thường.

---

# 7. Giai đoạn 5 — Đánh giá độ bao phủ cú pháp và keyword

## 7.1. Xây dựng ma trận bao phủ

Mỗi hệ quản trị cần có ma trận riêng.

| Nhóm             | Highlight | Completion | Syntax Check | Trong module | Kết quả kiểm thử |
| ---------------- | --------- | ---------- | ------------ | ------------ | ---------------- |
| DDL              | Đạt/Thiếu | Đạt/Thiếu  | Đạt/Thiếu    | Đạt/Thiếu    | Bằng chứng       |
| DML              | Đạt/Thiếu | Đạt/Thiếu  | Đạt/Thiếu    | Đạt/Thiếu    | Bằng chứng       |
| Control Flow     | Đạt/Thiếu | Đạt/Thiếu  | Đạt/Thiếu    | Đạt/Thiếu    | Bằng chứng       |
| Variables        | Đạt/Thiếu | Đạt/Thiếu  | Đạt/Thiếu    | Đạt/Thiếu    | Bằng chứng       |
| Functions        | Đạt/Thiếu | Đạt/Thiếu  | Đạt/Thiếu    | Đạt/Thiếu    | Bằng chứng       |
| Triggers         | Đạt/Thiếu | Đạt/Thiếu  | Đạt/Thiếu    | Đạt/Thiếu    | Bằng chứng       |
| CTE/Subquery     | Đạt/Thiếu | Đạt/Thiếu  | Đạt/Thiếu    | Đạt/Thiếu    | Bằng chứng       |
| Dynamic SQL      | Đạt/Thiếu | Đạt/Thiếu  | Đạt/Thiếu    | Đạt/Thiếu    | Bằng chứng       |
| Version-specific | Đạt/Thiếu | Đạt/Thiếu  | Đạt/Thiếu    | Đạt/Thiếu    | Bằng chứng       |

Ma trận này phải được điền bằng kết quả thực tế, không để các giá trị giả định.

## 7.2. Phân loại mức độ hỗ trợ

Sử dụng các trạng thái:

* `PASS`: Đã kiểm thử và đạt.
* `PARTIAL`: Chỉ hỗ trợ một phần.
* `FAIL`: Đã kiểm thử và thất bại.
* `NOT_IMPLEMENTED`: Xác minh chưa có chức năng tương ứng.
* `NOT_TESTED`: Chưa có bằng chứng kiểm thử.
* `NOT_APPLICABLE`: Không áp dụng cho hệ quản trị hoặc phiên bản đó.

Không dùng `PASS` chỉ vì tìm thấy một hàm hoặc file có tên tương ứng.

## 7.3. Tính toán tỷ lệ bao phủ

Nếu báo cáo tỷ lệ bao phủ, phải công bố rõ:

* Tổng số mục trong danh sách tham chiếu.
* Tổng số mục đã kiểm thử.
* Số mục đạt.
* Số mục đạt một phần.
* Số mục thất bại.
* Số mục chưa kiểm thử.
* Số mục không áp dụng.

Không tính các mục chưa kiểm thử là đã đạt.

Không dùng một tỷ lệ chung duy nhất để kết luận IntelliSense và Syntax Check hoạt động tốt. Hai chức năng phải có số liệu riêng.

---

# 8. Giai đoạn 6 — Phân tích nguyên nhân thiếu sót

Với mỗi lỗi hoặc thiếu sót, AI Agent phải xác định nguyên nhân ở mức có thể chứng minh.

Các nhóm nguyên nhân cần xem xét:

1. Thiếu keyword trong danh sách.
2. Keyword có trong danh sách nhưng không được đăng ký với Monaco.
3. Sai cấu hình ngôn ngữ.
4. Completion provider không nhận diện đúng ngữ cảnh.
5. Không phân tích được cấu trúc function/procedure/trigger.
6. Parser không hỗ trợ cú pháp.
7. Parser sử dụng sai phiên bản.
8. Grammar chỉ hỗ trợ SQL độc lập, chưa hỗ trợ procedural language.
9. Thiếu metadata database.
10. Không xử lý đúng alias, biến hoặc phạm vi tên.
11. Sai mapping vị trí lỗi.
12. Regex hoặc heuristic nhận diện sai.
13. Lỗi tích hợp giữa frontend và backend.
14. Lỗi cache hoặc trạng thái kết nối.
15. Chưa đủ bằng chứng để kết luận.

Không được quy tất cả lỗi về việc thiếu keyword. Có những trường hợp keyword đã đầy đủ nhưng parser không hiểu cú pháp hoặc completion provider không hiểu ngữ cảnh.

---

# 9. Giai đoạn 7 — Tổng hợp báo cáo hiện trạng

AI Agent phải tạo báo cáo cuối cùng theo cấu trúc dưới đây.

## Phần A — Executive Summary

Tóm tắt:

* Hiện trạng IntelliSense của SQL Server.
* Hiện trạng Syntax Check của SQL Server.
* Hiện trạng IntelliSense của PostgreSQL.
* Hiện trạng Syntax Check của PostgreSQL.
* Mức độ hỗ trợ bên trong function, procedure và trigger.
* Những hạn chế nghiêm trọng nhất.
* Các khu vực chưa đủ bằng chứng để kết luận.

## Phần B — Kiến trúc hiện tại

Liệt kê các file, module, thư viện và luồng xử lý thực tế.

Phải nêu rõ thành phần nào đang hoạt động, thành phần nào không được sử dụng và thành phần nào chưa xác minh được.

## Phần C — Ma trận hiện trạng

Tạo ma trận riêng cho:

* SQL Server.
* PostgreSQL.
* IntelliSense.
* Syntax Check.
* Function.
* Procedure.
* Trigger.

Mỗi kết luận phải có bằng chứng hoặc mã test liên quan.

## Phần D — Danh sách keyword và cú pháp thiếu

Đây là phần bắt buộc và phải chi tiết.

Mỗi mục cần có:

* Tên keyword hoặc cú pháp.
* Hệ quản trị.
* Phiên bản liên quan.
* Nhóm chức năng.
* Trạng thái hiện tại.
* Kết quả kiểm thử.
* File hoặc module liên quan.
* Nguyên nhân đã xác minh.
* Mức độ ảnh hưởng.
* Đề xuất xử lý.

Phải tách danh sách thiếu keyword khỏi danh sách thiếu cú pháp.

## Phần E — Danh sách lỗi thực tế

Mỗi lỗi cần có:

* ID.
* Hệ quản trị.
* Chức năng bị ảnh hưởng.
* Script tái hiện.
* Kết quả mong đợi.
* Kết quả thực tế.
* Bằng chứng.
* Nguyên nhân hoặc trạng thái điều tra.
* Mức độ nghiêm trọng.

## Phần F — Danh sách false positive và false negative

False positive: SQL hợp lệ nhưng IDE báo lỗi.

False negative: SQL không hợp lệ nhưng IDE không phát hiện lỗi.

Đối với IntelliSense, bổ sung:

* Gợi ý không phù hợp.
* Gợi ý thiếu.
* Gợi ý sai đối tượng.
* Gợi ý không đúng phạm vi biến hoặc alias.

## Phần G — Backlog cải tiến

Phân loại:

* `P0`: Sai lệch có thể khiến người dùng hiểu sai kết quả kiểm tra hoặc gây ảnh hưởng lớn đến công việc.
* `P1`: Thiếu chức năng cốt lõi hoặc lỗi thường gặp.
* `P2`: Cải thiện độ bao phủ và trải nghiệm.
* `P3`: Tối ưu hoặc hỗ trợ trường hợp hiếm.

Mỗi task phải có phạm vi, nguyên nhân, file liên quan, tiêu chí nghiệm thu và phụ thuộc.

## Phần H — Kết luận

Trả lời rõ:

1. Hiện tại có thể tin cậy IntelliSense đến mức nào?
2. Hiện tại có thể tin cậy Syntax Check đến mức nào?
3. Những loại module nào đang được hỗ trợ tốt?
4. Những loại module nào có lỗi hoặc chưa đủ bằng chứng?
5. Danh sách keyword nào còn thiếu?
6. Danh sách cú pháp nào chưa được hỗ trợ?
7. Cần xử lý những vấn đề nào trước tiên?
8. Những giới hạn nào không thể khắc phục chỉ bằng việc bổ sung keyword?

---

# 10. Yêu cầu về bằng chứng

Mọi kết luận phải tuân theo nguyên tắc:

* Kết luận từ code: dẫn đường dẫn file, tên hàm hoặc module và vị trí liên quan.
* Kết luận từ test: dẫn tên test, script đầu vào và kết quả.
* Kết luận từ tài liệu: ghi nguồn và phiên bản.
* Kết luận chưa xác minh: đánh dấu `NOT_TESTED` hoặc `UNKNOWN`.

Không được:

* Khẳng định hỗ trợ đầy đủ chỉ vì tìm thấy keyword trong file.
* Khẳng định parser hoạt động đúng chỉ vì có thư viện parser trong dependency.
* Khẳng định mọi keyword đã đầy đủ chỉ vì một số test thành công.
* Tự tạo danh sách keyword thiếu khi chưa đối chiếu.
* Tự sửa code rồi chỉ báo cáo trạng thái sau sửa.
* Bỏ qua các test thất bại hoặc chỉ báo cáo test thành công.
* Dùng kết quả SQL Server để suy ra kết quả PostgreSQL.

---

# 11. Điều kiện hoàn thành audit

Audit chỉ được xem là hoàn thành khi:

1. Đã xác định được kiến trúc IntelliSense và Syntax Check thực tế.
2. Đã xác định được các thành phần đang hoạt động và các thành phần không hoạt động.
3. Đã kiểm tra riêng SQL Server và PostgreSQL.
4. Đã kiểm tra function, procedure và trigger.
5. Đã kiểm tra keyword completion và database-object completion.
6. Đã kiểm tra cú pháp hợp lệ và không hợp lệ.
7. Đã đánh giá khả năng phát hiện lỗi và vị trí lỗi.
8. Đã lập ma trận bao phủ có số liệu và trạng thái rõ ràng.
9. Đã liệt kê cụ thể keyword và cú pháp thiếu đã được xác minh.
10. Đã lập danh sách lỗi thực tế và nguyên nhân.
11. Đã lập backlog cải tiến theo mức độ ưu tiên.
12. Chưa có thay đổi ngoài ý muốn đối với code hoặc giao diện trong giai đoạn audit.

Nếu chưa đáp ứng một điều kiện, phải ghi rõ phần chưa hoàn thành và lý do. Không được đánh dấu audit hoàn tất chỉ dựa trên việc đã đọc code.
