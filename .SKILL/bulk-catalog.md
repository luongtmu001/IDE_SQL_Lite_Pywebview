## Quy tắc sử dụng Bulk Catalog Query

1. **Tính chính xác của metadata:** Không được mặc định rằng metadata không xuất hiện trong kết quả truy vấn đồng nghĩa với việc object không tồn tại. Cần phân biệt rõ object không tồn tại, object không đủ quyền truy cập và metadata không thể thu thập.

2. **Tính nhất quán dữ liệu:** Metadata được thu thập phải phản ánh trạng thái database một cách nhất quán nhất có thể. Cần lưu ý khả năng cấu trúc database thay đổi trong quá trình thu thập, đặc biệt khi thực hiện Compare Database trên môi trường có nhiều người dùng đồng thời.

3. **Tối ưu số lượng truy vấn:** Ưu tiên truy vấn metadata theo nhóm đối tượng để giảm số lần giao tiếp với database. Tuy nhiên, không gộp toàn bộ metadata vào một truy vấn quá phức tạp nếu điều đó làm tăng chi phí xử lý, gây khó khăn trong kiểm soát lỗi hoặc làm giảm khả năng bảo trì.

4. **Không truy vấn metadata không cần thiết:** Chỉ thu thập các nhóm metadata phù hợp với mục đích sử dụng. Không nên tải toàn bộ định nghĩa SQL và thông tin chi tiết của tất cả object khi chỉ cần kiểm tra một thuộc tính cụ thể.

5. **Phân biệt hệ quản trị database:** Không giả định catalog, thuộc tính metadata và quy tắc dependency giữa SQL Server và PostgreSQL là tương đương. Mỗi hệ quản trị có đặc điểm riêng; mọi thông tin được chuẩn hóa phải giữ được những thuộc tính quan trọng và không làm mất dữ liệu đặc thù.

6. **Định danh object chính xác:** Không xác định object chỉ bằng tên. Cần xem xét schema, loại object và các thuộc tính định danh phù hợp với từng hệ quản trị. Phải xử lý chính xác các trường hợp trùng tên giữa schema, khác chữ hoa/chữ thường hoặc khác cách biểu diễn tên.

7. **So sánh theo thuộc tính có ý nghĩa:** Không chỉ so sánh tên object hoặc nội dung DDL dạng chuỗi. Cần phân biệt các thuộc tính cấu trúc thực sự khác nhau với khác biệt về định dạng, khoảng trắng, cách viết hoặc thứ tự biểu diễn không làm thay đổi ý nghĩa.

8. **Kiểm soát quyền truy cập:** Chỉ thu thập metadata trong phạm vi quyền được cấp. Không yêu cầu hoặc sử dụng quyền quản trị quá mức cần thiết. Nếu quyền truy cập không đủ để đưa ra kết luận đáng tin cậy, phải thể hiện trạng thái chưa xác định thay vì kết luận object bị thiếu.

9. **Quản lý cache và snapshot:** Metadata được lưu đệm hoặc lưu thành snapshot phải gắn với đúng kết nối, database, schema/phạm vi thu thập và thời điểm lấy dữ liệu. Không sử dụng dữ liệu cũ như thể đó là trạng thái hiện tại; phải có cơ chế nhận biết dữ liệu lỗi thời và làm mới khi cần.

10. **Khả năng mở rộng và hiệu năng:** Phải tính đến database có số lượng lớn object, định nghĩa SQL dài và nhiều dependency. Không để việc thu thập metadata gây tiêu thụ quá nhiều bộ nhớ, làm treo giao diện hoặc ảnh hưởng đáng kể đến hoạt động của database.

11. **Xử lý lỗi độc lập:** Lỗi khi thu thập một nhóm metadata hoặc một object không được mặc nhiên làm mất toàn bộ kết quả đã thu thập. Tuy nhiên, kết quả phải thể hiện rõ phạm vi thành công, phạm vi thất bại và những phần chưa thể kết luận; không được coi dữ liệu thu thập thiếu là một snapshot hoàn chỉnh.

12. **Phân biệt khác biệt với rủi ro thay đổi:** Kết quả phát hiện khác biệt không đồng nghĩa với việc có thể tự động áp dụng thay đổi an toàn. Các thao tác như DROP, ALTER COLUMN, thay đổi constraint hoặc sửa dependency phải được đánh giá riêng về tác động và nguy cơ mất dữ liệu.

13. **Không tự động ghi dữ liệu ngoài phạm vi:** Bulk Catalog Query phục vụ việc đọc và phân tích metadata, không được tự ý thay đổi cấu trúc hoặc dữ liệu nghiệp vụ của database. Mọi thao tác ghi, cập nhật hoặc thực thi migration phải thuộc quy trình riêng, có kiểm soát quyền và xác nhận phù hợp.

14. **Khả năng kiểm tra và truy vết:** Cần có khả năng xác định thời điểm thu thập, database nguồn, phạm vi metadata, trạng thái hoàn thành và lỗi phát sinh. Điều này đặc biệt quan trọng khi kết quả được sử dụng để so sánh database hoặc sinh migration script.

15. **Không đánh đồng thiếu dependency với không có dependency:** Catalog dependency có thể không phản ánh đầy đủ mọi quan hệ được hình thành qua SQL động, tên object được tạo từ chuỗi hoặc các cơ chế đặc thù của hệ quản trị. Không được khẳng định một object không có dependency chỉ dựa trên kết quả catalog khi phạm vi phát hiện chưa đầy đủ.

16. **Tính an toàn và bảo mật metadata:** Định nghĩa view, procedure, function và các thông tin cấu trúc có thể chứa dữ liệu nhạy cảm về nghiệp vụ hoặc kiến trúc hệ thống. Không ghi log toàn bộ metadata một cách tùy tiện, không làm lộ thông tin qua giao diện hoặc cache dùng chung giữa các kết nối.

17. **Tính xác định của kết quả:** Với cùng một trạng thái database và cùng phạm vi thu thập, kết quả chuẩn hóa và so sánh phải nhất quán. Không để thứ tự trả về không xác định, khác biệt về định dạng hoặc trạng thái cache tạo ra các thay đổi giả.

18. **Không đánh đổi tính đúng đắn để lấy tốc độ:** Mọi tối ưu về truy vấn, cache, xử lý song song hoặc giảm phạm vi metadata đều phải bảo đảm không làm sai kết quả so sánh. Nếu không đủ dữ liệu để đưa ra kết luận chính xác, hệ thống phải thông báo rõ thay vì đưa ra kết quả có vẻ hoàn chỉnh.
