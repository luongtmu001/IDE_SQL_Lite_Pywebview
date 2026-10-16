# Quy tắc an toàn khi đồng bộ thay đổi giữa hai database

## 1. Xác định chính xác nguồn và đích

* Phải xác định rõ database nguồn (Source) và database đích (Target) trước khi thực hiện đồng bộ.
* Hiển thị đầy đủ thông tin kết nối, server, database và schema để người dùng xác nhận.
* Không cho phép nguồn và đích bị đảo ngược ngoài ý muốn.
* Cảnh báo nếu hai kết nối trỏ đến cùng một database hoặc database đích không đúng môi trường dự kiến.
* Không tự động chuyển hướng thao tác sang database khác khi kết nối ban đầu thất bại.

## 2. Không tự động thực thi tất cả thay đổi

* Sau khi compare, chỉ tạo danh sách các thay đổi được đề xuất; không tự động thực thi.
* Người dùng phải có quyền chọn từng object hoặc từng nhóm thay đổi cần đồng bộ.
* Các thao tác có nguy cơ mất dữ liệu như DROP TABLE, DROP COLUMN, thay đổi kiểu dữ liệu gây mất dữ liệu hoặc xóa constraint phải được cảnh báo rõ ràng.
* Không mặc định xóa object ở đích chỉ vì object đó không tồn tại ở nguồn.
* Mọi thao tác phá hủy dữ liệu phải yêu cầu xác nhận riêng, không gộp chung vào một xác nhận đồng bộ thông thường.

## 3. Phân loại và đánh giá mức độ rủi ro

Mỗi thay đổi phải được phân loại rõ ràng:

* **CREATE:** Tạo object mới.
* **ALTER:** Thay đổi cấu trúc object hiện có.
* **DROP:** Xóa object.
* **REPLACE DEFINITION:** Thay thế định nghĩa view, function, procedure hoặc trigger.
* **DATA CHANGE:** Thay đổi dữ liệu, nếu hệ thống hỗ trợ đồng bộ dữ liệu.
* **DEPENDENCY CHANGE:** Thay đổi các quan hệ phụ thuộc.

Mỗi thay đổi phải có trạng thái rủi ro phù hợp, chẳng hạn:

* An toàn tương đối.
* Có thể gây gián đoạn.
* Có nguy cơ mất dữ liệu.
* Chưa đủ thông tin để xác định mức độ an toàn.

Không được coi việc tạo script thành công là bằng chứng cho thấy script an toàn.

## 4. Đảm bảo thứ tự thực thi theo dependency

* Phải xét quan hệ phụ thuộc giữa các object trước khi thực thi.
* Tạo object được tham chiếu trước object phụ thuộc vào nó, khi loại object và hệ quản trị yêu cầu.
* Khi xóa object, phải xử lý các object phụ thuộc theo thứ tự phù hợp.
* Phát hiện dependency vòng và các trường hợp không thể xác định thứ tự thực thi hợp lệ.
* Không tự động sử dụng CASCADE hoặc xóa các object phụ thuộc chỉ để script chạy thành công.
* Với dependency không thể xác định đầy đủ, phải cảnh báo rằng kế hoạch thực thi có thể chưa hoàn chỉnh.

## 5. Kiểm tra trạng thái database đích trước khi thực thi

* Metadata dùng để compare có thể đã lỗi thời tại thời điểm người dùng thực thi.
* Phải kiểm tra lại những điều kiện quan trọng trên database đích trước khi áp dụng thay đổi.
* Nếu object đã bị người khác thay đổi kể từ thời điểm compare, phải phát hiện xung đột và yêu cầu đánh giá lại.
* Không được mặc định thực thi một script đã sinh từ snapshot cũ mà không kiểm tra tính phù hợp.
* Nếu trạng thái thực tế không còn khớp với kế hoạch, phải dừng các thay đổi liên quan thay vì tiếp tục một cách mù quáng.

## 6. Kiểm tra trước khi áp dụng thay đổi cấu trúc

* Đánh giá tính hợp lệ của kiểu dữ liệu, độ dài, precision, scale, nullability, default, identity và các thuộc tính liên quan.
* Kiểm tra tác động khi thay đổi hoặc xóa cột đang được sử dụng.
* Kiểm tra constraint, index, khóa ngoại và các object phụ thuộc.
* Với thay đổi có thể gây mất dữ liệu, phải thông báo rõ hậu quả và không được âm thầm chuyển đổi dữ liệu.
* Không mặc định rằng mọi thay đổi đều có thể chuyển đổi trực tiếp bằng một câu ALTER.
* Phân biệt thao tác có thể đảo ngược về cấu trúc với thao tác không thể khôi phục dữ liệu đã mất.

## 7. Quản lý transaction và tính nguyên tử

* Ưu tiên transaction khi hệ quản trị và loại thao tác hỗ trợ.
* Xác định rõ phạm vi transaction: toàn bộ đợt đồng bộ, từng nhóm object hoặc từng bước.
* Không giả định mọi DDL đều có thể rollback như nhau trên SQL Server và PostgreSQL.
* Nếu một bước thất bại, phải xác định rõ các bước trước đó đã commit hay chưa.
* Không thông báo đồng bộ thất bại toàn bộ nếu một phần đã được áp dụng thành công; phải thể hiện trạng thái thực tế.
* Với thao tác không thể nằm trong transaction hoặc có cơ chế thực thi đặc biệt, phải thông báo trước và có chính sách xử lý riêng.

## 8. Kiểm soát đồng thời

* Phải tính đến trường hợp người dùng hoặc ứng dụng khác thay đổi database đích trong lúc đồng bộ.
* Không cho rằng việc kiểm tra trước thực thi sẽ loại bỏ hoàn toàn nguy cơ xung đột.
* Khi có thay đổi ngoài dự kiến, phải dừng hoặc đánh giá lại các bước bị ảnh hưởng.
* Tránh để hai phiên đồng bộ cùng sửa một object theo các kế hoạch khác nhau mà không có cơ chế kiểm soát.

## 9. Sao lưu và khả năng phục hồi

* Với thay đổi có nguy cơ mất dữ liệu, phải khuyến nghị sao lưu phù hợp trước khi thực thi.
* Không coi migration script hoặc câu lệnh rollback là phương án thay thế đầy đủ cho backup dữ liệu.
* Nếu cung cấp chức năng rollback, phải phân biệt rollback transaction với script phục hồi sau khi đã commit.
* Không tự động khẳng định có thể phục hồi hoàn toàn nếu chưa lưu lại dữ liệu hoặc trạng thái cần thiết.
* Phải có phương án xử lý khi đồng bộ dừng giữa chừng.

## 10. Kiểm tra và xem trước script

* Hiển thị script thực tế sẽ được thực thi trước khi người dùng xác nhận.
* Script hiển thị phải tương ứng với đúng danh sách thay đổi đã chọn.
* Không được âm thầm bổ sung DROP, CASCADE, ghi đè định nghĩa hoặc thay đổi ngoài phạm vi người dùng chọn.
* Hỗ trợ phân biệt script dự kiến, script đã thực thi và kết quả thực tế.
* Khi script được sửa thủ công, phải bảo đảm nội dung thực thi là nội dung cuối cùng đã được người dùng xem xét.

## 11. Giới hạn phạm vi thay đổi

* Chỉ tác động đến các object và thuộc tính nằm trong phạm vi được người dùng lựa chọn.
* Không tự động xóa object không thuộc phạm vi đồng bộ.
* Không tự ý thay đổi quyền, user, role, dữ liệu nghiệp vụ hoặc cấu hình database nếu người dùng không yêu cầu.
* Phải có cơ chế xử lý schema, object đặc thù và các thành phần không được hỗ trợ.
* Những thay đổi không thể biểu diễn chính xác phải được đánh dấu chưa hỗ trợ thay vì tạo script phỏng đoán.

## 12. Nhật ký và khả năng truy vết

* Ghi nhận database nguồn, database đích, thời điểm thực thi, người thực hiện nếu có thông tin xác thực phù hợp và danh sách thay đổi.
* Lưu trạng thái từng bước: Pending, Running, Succeeded, Failed, Skipped hoặc trạng thái tương đương.
* Ghi nhận lỗi thực thi và kết quả xác minh sau đồng bộ.
* Không ghi thông tin xác thực hoặc dữ liệu nhạy cảm vào log.
* Cho phép xác định những thay đổi đã hoàn thành và những thay đổi chưa được áp dụng khi quá trình bị gián đoạn.

## 13. Xác minh sau đồng bộ

* Sau khi thực thi, phải đối chiếu trạng thái thực tế của database đích với trạng thái mong muốn.
* Xác minh riêng các object đã thay đổi và các dependency quan trọng.
* Không chỉ dựa vào việc câu lệnh trả về thành công để kết luận toàn bộ đợt đồng bộ thành công.
* Phân biệt kết quả thực thi thành công với kết quả đồng bộ đã được xác minh.
* Nếu phát hiện sai lệch, phải hiển thị rõ object bị ảnh hưởng và trạng thái hiện tại; không tự động chạy lại toàn bộ script khi chưa đánh giá tác động.

## 14. Phân biệt đồng bộ cấu trúc và đồng bộ dữ liệu

* Compare cấu trúc và đồng bộ dữ liệu phải là hai phạm vi riêng biệt.
* Không mặc định rằng thay đổi cấu trúc đồng nghĩa với việc phải sao chép hoặc cập nhật dữ liệu.
* Nếu hỗ trợ đồng bộ dữ liệu, cần có quy tắc riêng cho INSERT, UPDATE, DELETE, khóa định danh, xung đột dữ liệu và tính toàn vẹn tham chiếu.
* Mọi thao tác xóa hoặc ghi đè dữ liệu phải được xác định rõ phạm vi và mức độ ảnh hưởng.
* Không dùng cơ chế đồng bộ cấu trúc để âm thầm thay đổi dữ liệu nghiệp vụ.

## 15. Nguyên tắc an toàn mặc định

* Ưu tiên giữ nguyên dữ liệu hiện có ở database đích.
* Mặc định không thực hiện DROP hoặc thay đổi có nguy cơ mất dữ liệu nếu người dùng chưa chủ động lựa chọn.
* Nếu thiếu metadata, thiếu quyền, có xung đột hoặc không xác định được dependency, phải dừng các thay đổi bị ảnh hưởng.
* Không tiếp tục thực thi các bước phụ thuộc vào một bước thất bại nếu trạng thái database không còn đáp ứng điều kiện tiên quyết.
* Mọi hành động có thể gây hậu quả lớn phải được hiển thị rõ ràng, có thể xem trước và cần sự xác nhận phù hợp.
