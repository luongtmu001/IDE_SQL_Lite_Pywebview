# PLAN: CHUYỂN ĐỔI SQL SYNTAX CHECK SANG PARSER EXTENSION

## 1. Mục tiêu

Chuyển đổi cơ chế kiểm tra cú pháp SQL hiện tại sang sử dụng các thư viện parser chuyên dụng, phù hợp với Monaco Editor và kiến trúc IDE hiện tại.

Ứng dụng hỗ trợ hai hệ quản trị cơ sở dữ liệu:

- SQL Server: ưu tiên Microsoft ScriptDOM để phân tích cú pháp T-SQL.
- PostgreSQL: đánh giá và tích hợp `monaco-sql-languages` cùng parser `dt-sql-parser` theo khả năng hỗ trợ thực tế.

Trong quá trình chuyển đổi, hệ thống cần đáp ứng các nguyên tắc:

1. Kiểm tra toàn bộ cơ chế Syntax Check hiện tại trước khi thay đổi.
2. Không xóa bất kỳ file nào thuộc hệ thống Syntax Check tự xây dựng.
3. Kiểm tra phạm vi hỗ trợ thực tế của từng extension trước khi quyết định tích hợp.
4. So sánh khả năng của extension với các tính năng đang có trong hệ thống cũ.
5. Chỉ bổ sung những phần extension còn thiếu, dựa trên code và quy tắc hiện có.
6. Không triển khai lại những tính năng extension đã đáp ứng đầy đủ.
7. Không làm thay đổi giao diện Monaco Editor, IntelliSense, cách quản lý tab hoặc các chức năng SQL hiện tại ngoài phạm vi được phê duyệt.

**Nguyên tắc quan trọng:** Đây là quá trình chuyển đổi có kiểm soát, không phải thay thế toàn bộ code cũ bằng thư viện mới một cách máy móc.

---

## 2. Phạm vi tác động

### 2.1. Các khu vực được phép thay đổi

- Module Syntax Check hiện tại.
- Các file JavaScript/TypeScript liên quan trực tiếp đến kiểm tra cú pháp.
- Cấu hình Monaco Editor phục vụ Syntax Check.
- Backend Python hoặc adapter mới phục vụ tích hợp parser.
- Cơ chế chuẩn hóa lỗi cú pháp.
- Cơ chế hiển thị lỗi thông qua Monaco Markers.
- Cấu hình dependency và đóng gói ứng dụng nếu cần.
- Bộ kiểm thử Syntax Check.

### 2.2. Các khu vực không được tự ý thay đổi

- IntelliSense hiện tại.
- Cơ chế kết nối SQL Server và PostgreSQL.
- Connection Manager.
- Object Explorer.
- Query Execution.
- Result Grid.
- Quản lý tab và editor model.
- Cơ chế lưu file SQL.
- Các tính năng formatter.
- Giao diện tổng thể của IDE.
- Những chức năng khác không liên quan trực tiếp đến Syntax Check.

Nếu quá trình phân tích phát hiện một khu vực ngoài phạm vi cần thay đổi, phải mô tả nguyên nhân, ảnh hưởng và phương án trước khi thực hiện.

Không tự ý refactor các module liên quan chỉ vì thấy có thể cải thiện.

---

# 3. GIAI ĐOẠN 1 — KHẢO SÁT HỆ THỐNG SYNTAX CHECK HIỆN TẠI

## 3.1. Xác định toàn bộ file liên quan

Trước khi chỉnh sửa code, hãy rà soát dự án để tìm tất cả thành phần liên quan đến Syntax Check.

Bao gồm nhưng không giới hạn:

- File khai báo hoặc đăng ký SQL language.
- File cấu hình Monaco Editor.
- File cung cấp parser hoặc bộ kiểm tra cú pháp tự xây dựng.
- File chứa regex kiểm tra cú pháp.
- File chứa quy tắc nhận diện lỗi.
- File quản lý Monaco Markers.
- File debounce hoặc quản lý thời điểm kiểm tra.
- File xử lý diagnostics.
- API backend liên quan đến Syntax Check.
- Các file cấu hình dependency.
- Các file test.
- Những module gọi trực tiếp hoặc gián tiếp đến Syntax Check.

Không được chỉ tìm file có tên chứa `syntax`. Cần lần theo luồng gọi hàm từ lúc người dùng nhập SQL cho đến lúc lỗi được hiển thị.

## 3.2. Phân tích luồng hoạt động hiện tại

Xây dựng sơ đồ luồng thực tế:

```text
Người dùng nhập SQL
        |
        v
Monaco Editor
        |
        v
Cơ chế kích hoạt Syntax Check
        |
        v
Parser / Rules tự xây dựng
        |
        v
Phân tích lỗi
        |
        v
Chuẩn hóa Diagnostics
        |
        v
Monaco Markers
        |
        v
Hiển thị lỗi trên Editor
```

Nếu kiến trúc thực tế khác sơ đồ trên, phải mô tả theo code hiện có, không tự suy đoán.

Xác định rõ:

- Hàm nào kích hoạt kiểm tra.
- Hàm nào phân tích SQL.
- Hàm nào phát hiện lỗi.
- Hàm nào chuyển đổi vị trí lỗi.
- Hàm nào cập nhật Monaco Markers.
- Cơ chế nhận diện SQL Server và PostgreSQL.
- Những module nào đang phụ thuộc vào kết quả Syntax Check.
- Có bao nhiêu cơ chế kiểm tra cú pháp đang hoạt động đồng thời.

## 3.3. Lập danh mục tính năng cũ

Phân loại những quy tắc đang có thành các nhóm:

| Nhóm | Nội dung cần khảo sát |
|---|---|
| Cấu trúc SQL cơ bản | SELECT, INSERT, UPDATE, DELETE |
| Biểu thức | WHERE, AND, OR, CASE, toán tử |
| JOIN | INNER JOIN, LEFT JOIN, APPLY |
| Khai báo biến | DECLARE, SET, biến và kiểu dữ liệu |
| Cấu trúc điều khiển | IF, ELSE, BEGIN, END, LOOP |
| Hàm và thủ tục | CREATE/ALTER PROCEDURE, FUNCTION |
| Xử lý lỗi | TRY/CATCH, EXCEPTION |
| CTE | WITH, WITH RECURSIVE |
| Truy vấn lồng nhau | Subquery, UNION, UNION ALL |
| DDL | CREATE, ALTER, DROP |
| Cú pháp đặc thù | T-SQL và PL/pgSQL |
| Chuỗi và comment | String literal, quoted identifier, comment nhiều dòng |
| Vị trí lỗi | Dòng, cột, phạm vi lỗi |
| Monaco Markers | Tạo, cập nhật và xóa lỗi |
| Hiệu năng | Debounce, hủy tác vụ cũ, chống kết quả lỗi thời |

Bảng trên chỉ là danh sách khảo sát ban đầu. Phải bổ sung các nhóm thực tế tìm thấy trong code hiện tại.

Đối với từng tính năng, ghi rõ:

- Đang được xử lý ở file nào.
- Hàm hoặc quy tắc nào thực hiện.
- Có test hay không.
- Đang hỗ trợ SQL Server, PostgreSQL hay cả hai.
- Có giới hạn đã biết hay không.

## 3.4. Bảo toàn code cũ

Trong giai đoạn này:

- Không xóa file.
- Không xóa hàm.
- Không xóa quy tắc syntax.
- Không thay đổi hành vi hiện tại.
- Không đổi tên file hoặc chuyển vị trí file nếu chưa thực sự cần thiết.

Kết quả đầu ra là tài liệu khảo sát, danh sách file và sơ đồ luồng hoạt động.

---

# 4. GIAI ĐOẠN 2 — KIỂM TRA KHẢ NĂNG CỦA EXTENSION

Không tích hợp extension chỉ dựa trên mô tả trong README. Cần kiểm tra thư viện, phiên bản, API và kết quả thực tế.

## 4.1. SQL Server: Microsoft ScriptDOM

Repository:

https://github.com/microsoft/SqlScriptDOM

Kiểm tra:

1. Khả năng cài đặt và chạy trong môi trường hiện tại.
2. Phiên bản T-SQL được hỗ trợ.
3. Khả năng phân tích các câu lệnh SQL Server.
4. Khả năng phân tích stored procedure và function.
5. Khả năng nhận diện lỗi cú pháp.
6. Khả năng trả về vị trí lỗi.
7. Khả năng xử lý script chứa nhiều câu lệnh.
8. Khả năng xử lý comment, chuỗi, quoted identifier và các cấu trúc lồng nhau.
9. Khả năng phân tích các cú pháp T-SQL thường dùng trong dự án.
10. Khả năng hoạt động khi tích hợp với backend Python/PyWebView.

Các trường hợp cần kiểm tra riêng:

- DECLARE và SET.
- IF...ELSE.
- BEGIN...END.
- TRY...CATCH.
- CREATE/ALTER PROCEDURE.
- CREATE/ALTER FUNCTION.
- CTE và recursive CTE.
- UNION và UNION ALL.
- CROSS APPLY và OUTER APPLY.
- Temporary table.
- Dynamic SQL.
- SQL nhiều batch có sử dụng GO.
- Các cú pháp phụ thuộc phiên bản SQL Server.

ScriptDOM là thư viện .NET. Không được giả định rằng có thể gọi trực tiếp thư viện từ JavaScript hoặc Python mà không cần lớp tích hợp.

Nếu phải sử dụng adapter .NET, hãy đánh giá phương án giao tiếp phù hợp với kiến trúc hiện tại. Ưu tiên phương án đơn giản, dễ đóng gói và dễ bảo trì.

Không yêu cầu ứng dụng phải kết nối database chỉ để thực hiện phân tích cú pháp tĩnh.

## 4.2. PostgreSQL: monaco-sql-languages và dt-sql-parser

Repository:

https://github.com/DTStack/monaco-sql-languages

Repository parser:

https://github.com/DTStack/dt-sql-parser

Kiểm tra:

1. Phiên bản Monaco tương thích.
2. Phiên bản parser tương thích.
3. Khả năng đăng ký ngôn ngữ với Monaco hiện tại.
4. Khả năng kiểm tra cú pháp.
5. Khả năng cung cấp vị trí lỗi.
6. Khả năng xử lý truy vấn nhiều dòng.
7. Khả năng xử lý comment và chuỗi.
8. Khả năng xử lý truy vấn lồng nhau.
9. Khả năng hỗ trợ PostgreSQL dialect.
10. Khả năng hoạt động với các cú pháp PL/pgSQL.

Các trường hợp cần kiểm tra riêng:

- SELECT, INSERT, UPDATE, DELETE.
- JOIN và subquery.
- CTE và WITH RECURSIVE.
- CREATE VIEW.
- CREATE FUNCTION.
- DO $$ ... $$.
- DECLARE và BEGIN...END.
- IF...THEN...ELSE.
- LOOP và các cấu trúc điều khiển.
- EXCEPTION.
- RETURN QUERY.
- EXECUTE dynamic SQL.
- Function có nhiều câu lệnh.
- Dollar-quoted string.
- Các cú pháp đặc thù khác đang xuất hiện trong code cũ.

Phải phân biệt SQL PostgreSQL thông thường với PL/pgSQL.

Nếu extension chỉ hỗ trợ SQL nhưng không phân tích đầy đủ phần thân PL/pgSQL, phải ghi nhận đây là một khoảng trống cần xử lý riêng.

Không đánh dấu hỗ trợ đầy đủ PL/pgSQL chỉ vì extension nhận diện được từ khóa hoặc tô màu đúng.

## 4.3. Kiểm tra khả năng tích hợp Monaco

Xác định:

- Monaco Editor đang sử dụng phiên bản nào.
- Cơ chế tạo editor instance.
- Cơ chế quản lý model.
- Cơ chế đăng ký language provider.
- Cơ chế cập nhật markers.
- Code Syntax Check hiện tại có dùng chung model với IntelliSense hay không.
- Có nhiều editor instance hoặc nhiều tab hoạt động đồng thời hay không.

Không thay đổi hoặc đăng ký lại toàn bộ language provider nếu việc đó làm ảnh hưởng IntelliSense.

Nếu extension tự đăng ký completion provider, cần xác định liệu có xung đột với IntelliSense hiện tại không.

Chỉ tích hợp những thành phần thực sự cần cho Syntax Check.

---

# 5. GIAI ĐOẠN 3 — XÂY DỰNG MA TRẬN ĐÁNH GIÁ COVERAGE

Sau khi khảo sát code cũ và thử nghiệm extension, tạo ma trận so sánh.

Không được kết luận một tính năng đã được hỗ trợ chỉ vì README đề cập đến nó. Phải có kết quả kiểm thử thực tế.

## 5.1. Ma trận đánh giá

| Tính năng | Code cũ | Extension SQL Server | Extension PostgreSQL | Kết luận |
|---|---|---|---|---|
| SELECT cơ bản | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Chờ kiểm thử |
| JOIN | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Chờ kiểm thử |
| CTE | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Chờ kiểm thử |
| UNION ALL | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Chờ kiểm thử |
| Stored procedure | Chưa đánh giá | Chưa đánh giá | Không áp dụng tương đương | Chờ kiểm thử |
| PostgreSQL function | Chưa đánh giá | Không áp dụng tương đương | Chưa đánh giá | Chờ kiểm thử |
| PL/pgSQL | Chưa đánh giá | Không áp dụng | Chưa đánh giá | Chờ kiểm thử |
| TRY...CATCH | Chưa đánh giá | Chưa đánh giá | Không áp dụng | Chờ kiểm thử |
| EXCEPTION | Chưa đánh giá | Không áp dụng | Chưa đánh giá | Chờ kiểm thử |
| Vị trí lỗi | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Chờ kiểm thử |
| Comment và chuỗi | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Chờ kiểm thử |
| Monaco Markers | Chưa đánh giá | Cần tích hợp | Cần tích hợp | Chờ kiểm thử |

Đây là ma trận khởi tạo. Agent phải cập nhật bằng kết quả khảo sát và kiểm thử thực tế.

## 5.2. Quy ước trạng thái

Mỗi tính năng phải được phân loại theo một trong các trạng thái:

- `FULL`: Đã kiểm thử và đáp ứng yêu cầu.
- `PARTIAL`: Có hỗ trợ nhưng còn thiếu một số trường hợp.
- `MISSING`: Chưa hỗ trợ hoặc chưa có cơ chế xử lý.
- `UNVERIFIED`: Chưa đủ bằng chứng để kết luận.
- `NOT_APPLICABLE`: Không áp dụng cho dialect tương ứng.

Không sử dụng trạng thái `FULL` nếu chỉ kiểm thử một ví dụ đơn giản trong khi tính năng có nhiều cấu trúc khác nhau.

## 5.3. Đánh giá mức độ ưu tiên

Sau khi có ma trận, phân loại khoảng trống thành:

- **P0:** Lỗi ảnh hưởng đến tính đúng đắn cơ bản, khiến SQL hợp lệ bị báo lỗi hoặc SQL sai cú pháp không được phát hiện trong phạm vi đã cam kết.
- **P1:** Thiếu hỗ trợ các cú pháp thường dùng trong dự án.
- **P2:** Thiếu hỗ trợ các cú pháp nâng cao hoặc ít sử dụng.
- **P3:** Cải tiến hiệu năng, thông báo lỗi hoặc trải nghiệm người dùng.

Không tự động bổ sung tất cả cú pháp nâng cao nếu chưa xác định nhu cầu thực tế.

---

# 6. GIAI ĐOẠN 4 — THIẾT KẾ KIẾN TRÚC SAU CHUYỂN ĐỔI

## 6.1. Kiến trúc mục tiêu

```text
                  Monaco Editor
                        |
                        v
                Syntax Check Service
                        |
                        v
                Database Dialect Resolver
                        |
              +---------+---------+
              |                   |
              v                   v
       SQL Server Adapter   PostgreSQL Adapter
              |                   |
              v                   v
          ScriptDOM          SQL Parser
              |                   |
              v                   v
        Native Diagnostics   Native Diagnostics
              |                   |
              +---------+---------+
                        |
                        v
                 Diagnostics Mapper
                        |
                        v
                 Monaco Markers
```

Các tên module trên là tên kiến trúc đề xuất. Agent phải đối chiếu cấu trúc hiện tại và chọn vị trí triển khai phù hợp, không tạo thêm module trùng chức năng.

## 6.2. Trách nhiệm của từng lớp

### Syntax Check Service

- Nhận nội dung SQL từ editor.
- Nhận diện dialect từ kết nối hiện tại.
- Chọn adapter tương ứng.
- Quản lý trạng thái kiểm tra.
- Trả về diagnostics chuẩn hóa.
- Không trực tiếp thực hiện truy vấn nghiệp vụ.

### Database Dialect Resolver

Ưu tiên lấy dialect từ Connection Manager.

Quy tắc:

- Kết nối SQL Server → sử dụng adapter SQL Server.
- Kết nối PostgreSQL → sử dụng adapter PostgreSQL.
- Chưa có kết nối → sử dụng chế độ kiểm tra phù hợp với ngữ cảnh đã chọn hoặc thông báo chưa xác định dialect.
- Đổi kết nối → các lần kiểm tra mới phải sử dụng dialect mới.
- Không suy đoán loại database chỉ từ tên bảng hoặc từ khóa trong câu SQL.

### Adapter

Mỗi adapter chịu trách nhiệm:

- Nhận nội dung SQL.
- Gọi parser phù hợp.
- Chuyển lỗi parser thành định dạng chung.
- Chuẩn hóa dòng, cột và phạm vi lỗi.
- Phân loại lỗi cú pháp và lỗi nội bộ của parser.
- Trả về kết quả theo hợp đồng chung.

### Diagnostics Mapper

Chuyển kết quả về định dạng Monaco:

- `startLineNumber`
- `startColumn`
- `endLineNumber`
- `endColumn`
- `message`
- `severity`
- `source`

Phải kiểm tra kỹ quy ước đánh số dòng và cột của từng parser để tránh đánh dấu sai vị trí.

---

# 7. GIAI ĐOẠN 5 — BỔ SUNG CÁC PHẦN EXTENSION CÒN THIẾU

Đây là giai đoạn quan trọng nhất.

Không xây dựng lại toàn bộ bộ quy tắc cũ. Chỉ bổ sung các phần đã được xác nhận là còn thiếu.

## 7.1. Nguyên tắc kế thừa code cũ

Đối với từng quy tắc hiện có, xác định:

1. Quy tắc đó đang giải quyết vấn đề gì?
2. Extension đã xử lý trường hợp đó chưa?
3. Extension có xử lý đầy đủ các biến thể thực tế không?
4. Quy tắc cũ có gây false positive hoặc false negative không?
5. Có thể giữ lại quy tắc cũ như một lớp kiểm tra bổ sung không?
6. Nếu giữ lại, có nguy cơ trùng lặp hoặc xung đột với parser mới không?

Chỉ giữ lại các quy tắc thực sự có giá trị.

Nếu quy tắc cũ trùng với parser mới, hãy ngừng sử dụng nó trong luồng kiểm tra chính nhưng giữ nguyên file và code.

Nếu quy tắc cũ bổ sung được khả năng còn thiếu, hãy tích hợp thông qua một lớp bổ sung riêng.

## 7.2. Phân loại phần cần bổ sung

### Nhóm A — Parser chưa hỗ trợ cú pháp

Nếu parser không nhận diện được một cú pháp hợp lệ:

- Kiểm tra giới hạn thực tế của parser.
- Xác định đây là lỗi thiếu grammar, thiếu dialect hay giới hạn của thư viện.
- Tìm giải pháp tương thích trước khi tự xây dựng parser.
- Chỉ viết bộ xử lý bổ sung khi có test tái hiện rõ ràng.

Không dùng regex đơn giản để thay thế parser trong việc phân tích cấu trúc SQL lồng nhau.

### Nhóm B — Parser phân tích đúng nhưng thông báo lỗi chưa tốt

Có thể bổ sung lớp cải thiện diagnostics:

- Điều chỉnh thông báo.
- Chuẩn hóa vị trí.
- Phân loại severity.
- Loại bỏ thông báo trùng lặp.
- Đánh dấu chính xác phạm vi lỗi nếu thông tin đầu vào cho phép.

Không tự sửa nội dung SQL chỉ để loại bỏ lỗi hiển thị.

### Nhóm C — Thiếu khả năng kiểm tra bổ sung

Nếu code cũ có những quy tắc hữu ích mà parser không cung cấp, có thể giữ lại thành một lớp kiểm tra độc lập.

Ví dụ:

- Quy tắc kiểm tra theo convention của dự án.
- Cảnh báo về cấu trúc SQL đáng ngờ.
- Kiểm tra theo ngữ cảnh mà parser không thể biết.
- Những quy tắc chuyên biệt được xác nhận là cần thiết.

Các quy tắc bổ sung phải phân biệt rõ:

- Lỗi cú pháp.
- Cảnh báo.
- Quy tắc convention.
- Lỗi ngữ nghĩa.

Không hiển thị cảnh báo convention như lỗi cú pháp chắc chắn.

## 7.3. Tách biệt parser và custom rules

Luồng mục tiêu:

```text
SQL Source
    |
    v
Dialect Adapter
    |
    v
Parser Diagnostics
    |
    v
Custom Validation Rules
    |
    v
Diagnostics Deduplication
    |
    v
Monaco Markers
```

Custom rules chỉ được chạy sau khi đã xác định phạm vi xử lý thích hợp.

Không chạy lại các quy tắc cũ một cách mù quáng trên toàn bộ SQL nếu chúng có thể tạo lỗi giả do không hiểu cấu trúc câu lệnh.

---

# 8. GIAI ĐOẠN 6 — TÍCH HỢP VÀ QUẢN LÝ VÒNG ĐỜI

## 8.1. Tích hợp với Monaco Editor

Sử dụng cơ chế diagnostics hiện có nếu phù hợp.

Nếu cần tạo cơ chế mới, phải bảo đảm:

- Mỗi editor model có trạng thái kiểm tra riêng.
- Marker của Syntax Check không xóa marker thuộc tính năng khác.
- Không tạo marker trùng lặp.
- Không ghi đè IntelliSense.
- Không thay đổi ngôn ngữ của editor nếu không cần thiết.
- Không tạo nhiều parser instance không cần thiết.

Nếu Monaco hiện tại đã có một marker owner riêng cho Syntax Check, ưu tiên giữ nguyên hoặc chuyển đổi có kiểm soát.

## 8.2. Debounce và xử lý kết quả lỗi thời

Áp dụng debounce phù hợp, ban đầu có thể thử khoảng 500–800 ms.

Nếu người dùng tiếp tục nhập trong thời gian chờ, chỉ xử lý nội dung mới nhất.

Với parser chạy bất đồng bộ hoặc ở backend:

- Gắn mã phiên bản cho nội dung editor.
- Khi nhận kết quả, đối chiếu với phiên bản hiện tại.
- Bỏ qua kết quả của nội dung cũ.
- Không để kết quả cũ ghi đè diagnostics mới.

Nếu parser chạy đồng bộ trong JavaScript và gây giật, hãy đo thời gian thực tế trước khi quyết định chuyển sang Worker hoặc tiến trình khác.

Không thêm Worker hoặc cơ chế đa tiến trình nếu chưa chứng minh được nhu cầu.

## 8.3. Quản lý nhiều tab

Mỗi tab cần được xử lý độc lập.

Khi chuyển tab:

- Không hiển thị lỗi của tab khác.
- Không gắn diagnostics vào sai model.
- Không sử dụng nội dung SQL từ tab đã đóng.
- Không để kết quả kiểm tra bất đồng bộ ghi đè tab khác.

Khi đóng tab, giải phóng những tài nguyên riêng do Syntax Check tạo ra nếu có.

## 8.4. Quản lý khi đổi kết nối

Khi kết nối thay đổi từ SQL Server sang PostgreSQL hoặc ngược lại:

- Xác định dialect mới.
- Hủy hoặc bỏ qua tác vụ kiểm tra cũ.
- Thực hiện kiểm tra lại khi thích hợp.
- Không sử dụng kết quả parser của dialect cũ làm kết quả cuối cùng cho nội dung đang mở.

Nếu tab SQL được mở khi chưa có kết nối, cần xác định rõ chính sách xử lý và thể hiện trạng thái đó trong UI hiện có.

Không tự động kết nối database chỉ để kiểm tra cú pháp tĩnh.

---

# 9. GIAI ĐOẠN 7 — KIỂM THỬ VÀ ĐỐI CHIẾU

## 9.1. Xây dựng bộ test từ code cũ

Không chỉ viết test mới theo ví dụ của extension.

Phải trích xuất những trường hợp mà hệ thống cũ đã xử lý, bao gồm:

- Các cú pháp hợp lệ.
- Các cú pháp không hợp lệ.
- Những trường hợp đặc biệt mà code cũ được xây dựng để xử lý.
- Những lỗi đã từng gặp trong thực tế.
- Các tình huống dễ tạo false positive.

Mỗi test cần lưu:

- Database dialect.
- SQL đầu vào.
- Kết quả mong đợi.
- Loại diagnostics.
- Vị trí lỗi dự kiến nếu có.
- Nguồn quy tắc hoặc lý do kiểm thử.

Không đưa thông tin kết nối hoặc dữ liệu nhạy cảm vào bộ test.

## 9.2. Nhóm kiểm thử SQL hợp lệ

SQL Server:

- SELECT nhiều bảng.
- JOIN và APPLY.
- CTE.
- UNION ALL.
- DECLARE và IF...ELSE.
- Stored procedure.
- Function.
- TRY...CATCH.
- SQL nhiều batch.
- Các trường hợp đặc thù đã xác định trong dự án.

PostgreSQL:

- SELECT và JOIN.
- CTE và WITH RECURSIVE.
- CREATE VIEW.
- CREATE FUNCTION.
- DO $$.
- DECLARE và BEGIN...END.
- IF...THEN.
- LOOP.
- EXCEPTION.
- RETURN QUERY.
- Dollar-quoted string.
- Các trường hợp đặc thù đã xác định trong dự án.

SQL hợp lệ trong phạm vi hỗ trợ đã cam kết không được bị báo lỗi cú pháp chỉ vì parser chưa nhận diện đúng cấu trúc.

## 9.3. Nhóm kiểm thử SQL không hợp lệ

Kiểm tra các trường hợp:

- Thiếu từ khóa bắt buộc.
- Thiếu biểu thức sau WHERE.
- Ngoặc không cân bằng.
- Cấu trúc CASE không hoàn chỉnh.
- Câu lệnh kết thúc sai vị trí.
- Thiếu thành phần bắt buộc trong DDL.
- Sai cấu trúc khối lệnh.
- Sai cú pháp trong các cấu trúc đặc thù.

Đối chiếu kết quả thực tế của parser với kết quả mong đợi.

Không chỉ kiểm tra việc có marker hay không; phải kiểm tra marker có đúng loại và vị trí đủ chính xác hay không.

## 9.4. Kiểm thử hồi quy

Chạy cùng bộ test trên:

1. Hệ thống Syntax Check cũ.
2. Parser mới.
3. Parser mới kết hợp custom rules.

So sánh kết quả để phát hiện:

- Lỗi cũ đã được khắc phục.
- Lỗi mới xuất hiện.
- Cú pháp hợp lệ bị báo sai.
- Cú pháp sai bị bỏ sót.
- Thông báo lỗi trùng lặp.
- Marker sai vị trí.
- Những quy tắc bổ sung gây xung đột.

Lưu lại kết quả trước và sau chuyển đổi để có thể đánh giá khách quan.

---

# 10. GIAI ĐOẠN 8 — CHUYỂN ĐỔI THEO TỪNG BƯỚC

Không thay toàn bộ cơ chế kiểm tra hiện tại trong một lần.

## Bước 1: Khởi tạo adapter

Tích hợp parser và chạy kiểm thử độc lập.

Chưa thay đổi luồng Syntax Check đang hoạt động.

## Bước 2: Tích hợp vào luồng thử nghiệm

Cho phép chạy parser mới trên bộ test hoặc một chế độ phát triển riêng.

So sánh kết quả với hệ thống cũ.

## Bước 3: Bổ sung các phần còn thiếu

Dựa trên ma trận coverage để bổ sung:

- Cú pháp chưa hỗ trợ.
- Diagnostics cần chuẩn hóa.
- Quy tắc bổ sung thực sự cần thiết.

Không phát triển những tính năng đã được xác nhận là đầy đủ.

## Bước 4: Chuyển luồng Syntax Check chính

Sau khi các kiểm thử đạt yêu cầu:

- Sử dụng adapter theo dialect.
- Giữ nguyên giao diện Monaco.
- Giữ nguyên hợp đồng diagnostics nếu có thể.
- Giữ lại các custom rules được phê duyệt.
- Ngừng gọi những quy tắc cũ đã được thay thế.

## Bước 5: Theo dõi và xử lý lỗi

Kiểm tra các tình huống thực tế:

- Chuyển đổi kết nối.
- Mở nhiều tab.
- Nhập SQL liên tục.
- Đóng tab trong lúc kiểm tra.
- Câu lệnh lớn.
- Script nhiều batch.
- Parser trả về lỗi.
- Backend không phản hồi.

Nếu xuất hiện lỗi nghiêm trọng, phải có phương án quay lại luồng Syntax Check trước đó.

---

# 11. QUY TẮC BẢO TOÀN FILE CŨ

Đây là yêu cầu bắt buộc trong toàn bộ quá trình.

## 11.1. Không xóa file

Không được xóa các file Syntax Check tự xây dựng, kể cả khi đã xác nhận không còn sử dụng.

Không xóa:

- File parser cũ.
- File chứa custom rules.
- File helper.
- File cấu hình.
- File test.
- File chứa các quy tắc đã được thay thế.

Không xóa file chỉ vì cho rằng extension đã có chức năng tương đương.

## 11.2. Không ghi đè hoặc tái sử dụng sai mục đích

Không ghi đè code cũ bằng code mới theo cách làm mất logic ban đầu.

Không đổi nội dung của file cũ thành module rỗng chỉ để tránh được gọi.

Nếu cần thay đổi file cũ để tương thích, phải bảo toàn nội dung và chức năng không liên quan trực tiếp đến việc chuyển đổi.

## 11.3. Ngừng sử dụng có kiểm soát

Khi một module cũ không còn được sử dụng:

- Giữ nguyên file.
- Ngừng gọi module đó trong luồng chính.
- Ghi nhận lý do ngừng sử dụng.
- Ghi rõ module hoặc adapter thay thế.
- Đảm bảo không còn dependency nào yêu cầu module đó phải chạy.

Có thể ghi nhận trạng thái `deprecated` trong tài liệu kiến trúc.

Không bắt buộc phải sửa trực tiếp nội dung file cũ để thêm trạng thái này.

## 11.4. Quản lý thay đổi bằng Git

Trước khi chỉnh sửa:

- Kiểm tra trạng thái Git.
- Xác định những thay đổi có sẵn của người dùng.
- Không ghi đè các thay đổi chưa được commit.
- Không tự động reset, checkout hoặc xóa file.
- Không tự ý tạo commit nếu chưa được yêu cầu.

Sau mỗi giai đoạn, tổng hợp danh sách file được thêm, sửa và giữ nguyên.

---

# 12. QUẢN LÝ DEPENDENCY VÀ ĐÓNG GÓI

Do ứng dụng sử dụng PyWebView, cần kiểm tra khả năng đóng gói của từng dependency.

Đối với parser PostgreSQL:

- Kiểm tra dependency JavaScript.
- Kiểm tra phiên bản Monaco tương thích.
- Kiểm tra kích thước bundle.
- Kiểm tra khả năng hoạt động trong WebView2.
- Không tải thư viện từ CDN khi chạy thực tế nếu kiến trúc hiện tại yêu cầu đóng gói offline.

Đối với ScriptDOM:

- Xác định runtime .NET cần thiết.
- Xác định cách giao tiếp với Python.
- Xác định thư viện và runtime nào phải được phân phối.
- Kiểm tra quyền chạy tiến trình nếu dùng adapter riêng.
- Kiểm tra khả năng hoạt động trên máy không cài môi trường phát triển.
- Kiểm tra lỗi khởi tạo và xử lý khi adapter không khả dụng.

Ưu tiên giải pháp không yêu cầu người dùng cài đặt thủ công nhiều dependency.

Không tự ý thay đổi cơ chế build PyInstaller hiện tại ngoài những điều chỉnh cần thiết cho parser.

Không được coi việc chạy thành công trong môi trường phát triển là bằng chứng ứng dụng đã đóng gói hoạt động đúng.

---

# 13. TIÊU CHÍ NGHIỆM THU

Chỉ hoàn thành chuyển đổi khi đáp ứng các tiêu chí sau.

## 13.1. Về kiến trúc

- Có cơ chế lựa chọn parser theo database dialect.
- SQL Server sử dụng adapter phù hợp với T-SQL.
- PostgreSQL sử dụng parser phù hợp với phạm vi hỗ trợ đã xác minh.
- Kết quả diagnostics được chuẩn hóa.
- Monaco vẫn là nơi hiển thị lỗi.
- Không tạo ra các hệ thống Syntax Check trùng lặp trong luồng chính.

## 13.2. Về khả năng hỗ trợ

- Có ma trận coverage dựa trên kiểm thử thực tế.
- Những cú pháp hợp lệ thuộc phạm vi hỗ trợ không bị báo lỗi sai.
- Những lỗi cú pháp trong bộ test được phát hiện theo kết quả mong đợi.
- Các khoảng trống chưa giải quyết được phải được ghi nhận.
- Không tuyên bố hỗ trợ đầy đủ SQL Server hoặc PL/pgSQL nếu chưa có bằng chứng.

## 13.3. Về tương thích

- IntelliSense hiện tại vẫn hoạt động.
- Formatter không bị ảnh hưởng.
- Quản lý tab không bị ảnh hưởng.
- Chuyển đổi kết nối không làm dùng sai parser.
- Không hiển thị diagnostics của tab khác.
- Không để kết quả cũ ghi đè kết quả mới.
- Không phát sinh lỗi nghiêm trọng trên WebView2.

## 13.4. Về bảo toàn code

- Không file Syntax Check cũ nào bị xóa.
- Các file cũ không bị ghi đè làm mất logic.
- Những module không còn được gọi đã được ghi nhận.
- Có danh sách thay đổi file rõ ràng.
- Có thể quay lại luồng kiểm tra trước chuyển đổi.

## 13.5. Về hiệu năng

Đo thời gian kiểm tra trên những script đại diện cho dự án thực tế.

Ghi nhận:

- Thời gian khởi tạo parser.
- Thời gian phân tích cú pháp.
- Thời gian cập nhật diagnostics.
- Khả năng xử lý script lớn.
- Tình trạng giật hoặc treo giao diện.

Không đặt ra ngưỡng hiệu năng tùy ý khi chưa đo baseline. Nếu cần đặt ngưỡng, phải xác định dựa trên số liệu thực tế và yêu cầu sử dụng.

---

# 14. TÀI LIỆU BẮT BUỘC SAU KHẢO SÁT

Agent cần tạo báo cáo Markdown gồm các nội dung sau.

## 14.1. syntax_check_current_architecture.md

Mô tả:

- Kiến trúc Syntax Check hiện tại.
- Luồng xử lý.
- Danh sách file liên quan.
- Danh sách custom rules.
- Các module phụ thuộc.
- Những giới hạn đã biết.

## 14.2. syntax_check_extension_coverage.md

Mô tả:

- Extension được đánh giá.
- Phiên bản đã kiểm tra.
- Khả năng hỗ trợ thực tế.
- Ma trận coverage SQL Server.
- Ma trận coverage PostgreSQL.
- Các test đã chạy.
- Những khoảng trống cần bổ sung.

## 14.3. syntax_check_migration_plan.md

Mô tả:

- Kiến trúc đích.
- Các module cần thêm hoặc sửa.
- Các file cũ được giữ lại.
- Các custom rules sẽ tiếp tục sử dụng.
- Các custom rules sẽ ngừng gọi.
- Các khoảng trống cần bổ sung.
- Thứ tự triển khai.
- Phương án rollback.
- Tiêu chí nghiệm thu.

## 14.4. syntax_check_migration_test_report.md

Mô tả:

- Bộ test sử dụng.
- Kết quả trước chuyển đổi.
- Kết quả sau chuyển đổi.
- Lỗi phát sinh.
- Những trường hợp chưa hỗ trợ.
- Kết quả kiểm thử hồi quy.
- Kết quả kiểm thử đóng gói.

Đặt các báo cáo trong thư mục tài liệu phù hợp với cấu trúc dự án hiện tại, tránh tạo thêm thư mục nếu đã có vị trí tương đương.

---

# 15. THỨ TỰ THỰC HIỆN BẮT BUỘC

Thực hiện theo thứ tự:

1. Khảo sát kiến trúc Syntax Check hiện tại.
2. Lập danh sách toàn bộ file và custom rules.
3. Đọc code cũ và xây dựng bộ test baseline.
4. Kiểm tra phiên bản Monaco và dependency.
5. Thử nghiệm ScriptDOM cho SQL Server.
6. Thử nghiệm monaco-sql-languages/dt-sql-parser cho PostgreSQL.
7. Xây dựng ma trận coverage thực tế.
8. Xác định các khoảng trống.
9. Thiết kế adapter và diagnostics chuẩn hóa.
10. Bổ sung những phần extension còn thiếu dựa trên code cũ.
11. Tích hợp vào Monaco theo từng giai đoạn.
12. Chạy kiểm thử hồi quy.
13. Kiểm tra tương thích với các tính năng IDE hiện tại.
14. Kiểm tra đóng gói PyWebView.
15. Hoàn thiện báo cáo và tiêu chí nghiệm thu.

**Không bỏ qua bước khảo sát để bắt đầu sửa code ngay.**

---

# 16. YÊU CẦU BÁO CÁO TRƯỚC KHI TRIỂN KHAI

Trước khi thay đổi luồng Syntax Check chính, hãy báo cáo:

1. Những file hiện đang tham gia vào Syntax Check.
2. Kiến trúc thực tế và luồng gọi hàm.
3. Những khả năng extension đã đáp ứng đầy đủ.
4. Những khả năng extension mới đáp ứng một phần.
5. Những khả năng extension chưa đáp ứng.
6. Những custom rules cần giữ lại.
7. Những custom rules có thể ngừng gọi.
8. Phương án tích hợp parser cho từng database.
9. Danh sách file dự kiến thêm hoặc sửa.
10. Các rủi ro về Monaco, PyWebView và đóng gói.
11. Phương án rollback.

Nếu một khả năng chưa được xác minh, ghi rõ `UNVERIFIED`, không tự kết luận là đã hỗ trợ.

Không xóa file cũ trong bất kỳ giai đoạn nào.

Chỉ sau khi hoàn tất báo cáo coverage mới bắt đầu chuyển đổi luồng chính. Mọi thay đổi ngoài phạm vi Syntax Check phải được nêu rõ và chờ phê duyệt.

## Kết quả cuối cùng mong muốn

IDE sử dụng parser chuyên dụng theo từng hệ quản trị, hiển thị lỗi trên Monaco Editor, giữ lại các custom rules thực sự có giá trị và bảo toàn toàn bộ code Syntax Check cũ.

Hệ thống phải có bộ test và ma trận coverage để chứng minh mức độ hỗ trợ, thay vì chỉ dựa vào việc extension đã được cài đặt thành công.