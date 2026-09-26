# TÀI LIỆU THIẾT KẾ: MODULE CHỈNH SỬA DỮ LIỆU BẢNG (DATA EDITOR)

**Nền tảng:** Python (Pywebview)
**Hệ quản trị CSDL hỗ trợ:** Microsoft SQL Server & PostgreSQL  
**Mục tiêu trọng tâm:** Thao tác Thêm - Sửa - Xóa (CRUD) an toàn, hiệu năng cao và tuân thủ chặt chẽ ràng buộc toàn vẹn dữ liệu.

---

## 1. TỔNG QUAN VÀ NGUYÊN TẮC THIẾT KẾ CỐT LÕI

Giao diện chỉnh sửa dữ liệu trực tiếp trên bảng không chỉ đơn thuần là gửi lệnh `INSERT`/`UPDATE`/`DELETE` xuống database, mà phải đóng vai trò là một lớp đệm an toàn giúp:

1. **Tránh sai sót của người dùng:** Cảnh báo trước khi thực thi lệnh nguy hiểm.
2. **Bảo toàn tính nhất quán (Atomicity):** Nhiều thao tác chỉnh sửa phải được gộp trong một Transaction duy nhất.
3. **Phản hồi trực quan (Visual Feedback):** Tách biệt rõ giữa trạng thái "dữ liệu đang sửa trên bộ nhớ đệm" và "dữ liệu đã lưu xuống đĩa".

---

## 2. BỘ TÍNH NĂNG TỐI ƯU TRẢI NGHIỆM (HỌC HỎI TỪ DATAGRIP, NAVICAT, SSMS)

### 2.1. Cơ chế Staged Changes & Diff Preview (Bộ đệm thay đổi)

* **Trạng thái màu sắc (Visual Color Coding):**
  * *Xanh lá cây (Green):* Dòng mới được thêm vào (`INSERT staged`).
  * *Xanh lam (Blue):* Ô dữ liệu có giá trị vừa bị thay đổi (`UPDATE staged`). Góc ô có thể thêm một tam giác nhỏ đánh dấu.
  * *Đỏ / Gạch ngang (Red / Strikethrough):* Dòng được đánh dấu chuẩn bị xóa (`DELETE staged`).
* **Revert cục bộ (Hoàn tác linh hoạt):**
  * Cho phép chuột phải vào từng ô, dòng hoặc nhóm dòng chọn *Revert Changes* để quay về giá trị ban đầu mà không cần reload lại toàn bộ bảng.
* **Xem trước DML (SQL Script Preview):**
  * Khi người dùng nhấn `Ctrl + S` hoặc nút **Submit Changes**, hệ thống mở popup hiển thị chi tiết kịch bản SQL sắp chạy.
  * Cho phép sao chép kịch bản SQL hoặc nhấn **Execute** để xác nhận commit.

---

### 2.2. Thao tác Thêm mới (Insert)

* **Clone / Duplicate Row:**
  * Nhân bản nhanh một hoặc nhiều dòng được chọn.
  * Tự động phát hiện và làm rỗng các cột tự tăng (`IDENTITY`, `SERIAL`) hoặc sinh mới `UUID` để tránh vi phạm khóa chính.
* **Smart Paste từ Clipboard (Excel, Google Sheets, TSV):**
  * Bắt sự kiện `paste` từ phím tắt `Ctrl + V`.
  * Tự động tách các trường qua ký tự tab (`\t`) và dòng mới (`\n`), map chính xác vào thứ tự cột đang hiển thị và sinh ra các dòng mới.
* **Placeholder cho Default Values:**
  * Cột có giá trị mặc định (`DEFAULT`) hoặc tự sinh (`TIMESTAMP`, `SEQUENCE`) được hiển thị placeholder mờ `[DEFAULT]`.
  * Khi sinh câu lệnh `INSERT`, hệ thống sẽ loại bỏ các cột giữ nguyên placeholder `[DEFAULT]` để Database tự sinh giá trị gốc.

---

### 2.3. Thao tác Chỉnh sửa (Update)

* **Phân biệt rõ `NULL` và Chuỗi rỗng (`""`):**
  * Quy định phím tắt riêng (ví dụ: `Ctrl + Alt + N` hoặc `Alt + Delete`) để gán giá trị `NULL` (hiển thị tag màu xám xỉn `[NULL]`).
  * Xóa trắng text thông thường được hiểu là chuỗi rỗng `""` (nếu cột là kiểu text/varchar) hoặc báo lỗi nếu cột là kiểu số/ngày tháng.
* **Foreign Key (FK) Lookup Selector:**
  * Khi người dùng click đúp vào ô có quan hệ khóa ngoại, mở dropdown hoặc modal tìm kiếm dữ liệu ở bảng cha.
  * Hiển thị cả Khóa chính và Cột mô tả đại diện (ví dụ: hiển thị `ID: 10 - Tên: Công ty ABC` để chọn thay vì bắt nhập số `10`).
* **Value Inspector (Drawer mở rộng bên hông):**
  * Đối với các cột chứa văn bản dài, `JSON`, `XML`, `Binary`: Mở panel bên hông để hiển thị định dạng thụt lề, tô màu cú pháp (Syntax Highlighting) và kiểm tra lỗi cú pháp trước khi chấp nhận ghi nhận thay đổi.
* **Bulk Edit (Sửa đồng loạt):**
  * Cho phép chọn nhiều dòng trên cùng một cột và chỉnh sửa cùng một giá trị cho tất cả các dòng đó trong một thao tác.

---

### 2.4. Thao tác Xóa (Delete)

* **Batch Deletion tối ưu:**
  * Gom các dòng cần xóa vào câu lệnh: `DELETE FROM TableName WHERE PK IN (...)` thay vì gửi từng lệnh đơn lẻ.
* **Cảnh báo Cascade Impact:**
  * Trước khi xóa, kiểm tra metadata xem bảng có đang bị tham chiếu bởi bảng khác qua khóa ngoại không có `ON DELETE CASCADE` hay không để cảnh báo trước nguy cơ lỗi Foreign Key Constraint.

---

## 3. CÁC ĐIỀU CỐT TỬ CẦN LƯU Ý & CẠM BẪY KỸ THUẬT

### 3.1. Bài toán: Bảng KHÔNG CÓ Khóa chính (Heap Tables)

Khi bảng không có Primary Key hoặc Unique Constraint, việc sinh lệnh `UPDATE` hay `DELETE` có nguy cơ sửa/xóa nhầm nhiều dòng có cùng giá trị.

* **Giải pháp 1: Full-Row Matching trong mệnh đề WHERE**
  * Đưa toàn bộ giá trị cũ của tất cả các cột vào điều kiện lọc:

        ```sql
        UPDATE dbo.LogEntries
        SET Level = 'WARN'
        WHERE Col1 = 'A' AND Col2 = 123 AND Col3 IS NULL;
        ```

  * *Lưu ý xử lý NULL:* Giá trị `NULL` trong SQL không bằng `NULL`. Phải dùng cú pháp `Col3 IS NULL` thay vì `Col3 = NULL`.
* **Giải pháp 2: Sử dụng định danh vật lý của dòng (Physical Tuple Identifiers)**
  * **PostgreSQL:** Sử dụng pseudo-column `ctid` (đại diện cho block number và offset).

        ```sql
        UPDATE my_table SET col = 'new' WHERE ctid = '(0, 1)';
        ```

  * **SQL Server:** Sử dụng hàm không tài liệu hóa `%%physloc%%` để lấy địa chỉ file, trang và slot của dòng.
  * *Cảnh báo:* Vị trí vật lý có thể thay đổi sau các thao tác `VACUUM` (Postgres) hoặc `SHRINK / REBUILD INDEX` (MSSQL). Do đó, chỉ lấy giá trị này ngay tại thời điểm load trang dữ liệu.

---

### 3.2. Ngăn chặn xung đột ghi đè (Optimistic Concurrency Control)

Tránh việc người dùng sửa đè lên dữ liệu đã bị người khác thay đổi trước đó mà không hay biết.

* **Kỹ thuật so sánh giá trị cũ:**

    ```sql
    UPDATE Products 
    SET Price = 200 
    WHERE ProductID = 5 AND Price = 180; -- 180 là giá trị cũ lúc load bảng
    ```

  * Sau khi chạy lệnh, kiểm tra số dòng bị ảnh hưởng (`rowcount`). Nếu `rowcount == 0`, chứng tỏ dữ liệu đã bị ai đó sửa trước. Lập tức rollback và thông báo lỗi xung đột cho người dùng.
* **Sử dụng Version Token có sẵn:**
  * **PostgreSQL:** So sánh cột hệ thống `xmin` (Transaction ID tạo ra phiên bản tuple hiện tại).
  * **SQL Server:** Sử dụng cột kiểu `rowversion` (hoặc `timestamp`) nếu bảng có cấu hình cột này.

---

### 3.3. Xử lý cột tự tăng (Identity / Serial / Sequence)

* **SQL Server:**
  * Mặc định không thể chỉ định giá trị cho cột `IDENTITY` trong câu lệnh `INSERT`.
  * Nếu người dùng chủ động điền ID hoặc paste từ ngoài vào, backend phải bọc lệnh:

        ```sql
        SET IDENTITY_INSERT dbo.Customers ON;
        INSERT INTO dbo.Customers (CustomerID, Name) VALUES (999, 'Nguyen Van A');
        SET IDENTITY_INSERT dbo.Customers OFF;
        ```

* **PostgreSQL:**
  * Nếu bảng sử dụng `SERIAL` hoặc `GENERATED BY DEFAULT AS IDENTITY`, khi chèn thủ công một ID lớn hơn sequence hiện tại, sequence nội bộ không tự cập nhật.
  * Hệ thống cần cung cấp tùy chọn tự động đồng bộ lại sequence bằng `setval()`:

        ```sql
        SELECT setval(pg_get_serial_sequence('customers', 'customer_id'), coalesce(max(customer_id), 1)) FROM customers;
        ```

---

### 3.4. Toàn vẹn giao dịch (Transaction Atomicity)

* **Nguyên tắc "Tất cả hoặc không gì cả":** Toàn bộ danh sách thay đổi trong một lần Submit phải được thực thi trong một Transaction duy nhất.
* **Kịch bản xử lý:**

    ```sql
    -- SQL Server:
    BEGIN TRANSACTION;
    BEGIN TRY
        -- Thực thi các câu INSERT/UPDATE/DELETE
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        -- Ném lỗi chi tiết về backend
    END CATCH;
    ```

* Nếu có bất kỳ lỗi vi phạm ràng buộc (Check constraint, Foreign Key, Type mismatch), Transaction bị hủy bỏ hoàn toàn. Bảng trên giao diện giữ nguyên trạng thái Staging kèm thông báo lỗi chi tiết để người dùng chỉnh sửa lại.

---

### 3.5. Ràng buộc dữ liệu & Giới hạn hệ thống

* **Chống SQL Injection & Xử lý kiểu dữ liệu:**
  * **Tuyệt đối không ghép chuỗi SQL thủ công:** Luôn sử dụng Parameterized Query (`?` cho pyodbc/SQL Server, `%s` hoặc `$1` cho psycopg/PostgreSQL).
  * Việc dùng parameters tự động giải quyết các ký tự nguy hiểm như dấu nháy đơn `'`, dấu nháy kép `"`, ký tự xuống dòng.
* **Giới hạn Parameter của SQL Server (Max 2.100 parameters):**
  * SQL Server chỉ cho phép tối đa 2.100 tham số trong một request.
  * Nếu người dùng xóa 3.000 dòng theo điều kiện `WHERE ID IN (...)`, việc truyền 3.000 parameters sẽ làm ứng dụng gặp lỗi crash.
  * *Giải pháp:* Backend phải tự động băm nhỏ (chunking) danh sách ID thành các batch (ví dụ: 1.000 ID mỗi đợt) hoặc đẩy danh sách ID vào Table-Valued Parameter / Temporary Table.
* **Xử lý ngày giờ và Múi giờ (Datetime & Timezones):**
  * Dữ liệu trao đổi qua lại giữa JavaScript (pywebview) và Python phải sử dụng định dạng chuẩn **ISO 8601** (`YYYY-MM-DDTHH:mm:ss.sssZ`).
  * Tránh để JavaScript Date object tự động chuyển đổi múi giờ gây lệch ngày tháng khi lưu xuống database.

---

## 4. THIẾT KẾ CẤU TRÚC PAYLOAD TRAO ĐỔI (STAGED CHANGES SPEC)

Dưới đây là cấu trúc JSON mẫu mà Frontend (AG Grid) gửi về Python Backend qua `window.pywebview.api.submit_changes(payload)`:

```json
{
  "schema": "dbo",
  "table": "Orders",
  "concurrency_mode": "optimistic",
  "changes": {
    "inserts": [
      {
        "temp_id": "row_client_1",
        "data": {
          "OrderDate": "2026-09-23T08:30:00Z",
          "CustomerID": 105,
          "TotalAmount": 250.50,
          "Status": "NEW"
        }
      }
    ],
    "updates": [
      {
        "keys": { "OrderID": 1001 },
        "original_data": { "Status": "PENDING", "TotalAmount": 200.00 },
        "modified_data": { "Status": "PAID" }
      }
    ],
    "deletes": [
      {
        "keys": { "OrderID": 998 },
        "original_data": { "Status": "CANCELLED" }
      }
    ]
  }
}
```

---

## 5. BẢNG TỔNG HỢP KIỂM TRA (CHECKLIST TRIỂN KHAI)

| Hạng mục kiểm tra | Đã xử lý | Mô tả chi tiết |
| :--- | :---: | :--- |
| **Null Safety** | [ ] | Phím tắt riêng cho `NULL`, không nhầm lẫn với chuỗi `""`. |
| **Heap Table Handling** | [ ] | Có cơ chế fallback Full-Row match khi bảng không có PK. |
| **Transaction Boundary** | [ ] | Toàn bộ các thao tác được bọc trong 1 Transaction duy nhất. |
| **Parameter Limit** | [ ] | Batching dữ liệu dưới ngưỡng 2.100 params của MSSQL. |
| **Identity Control** | [ ] | Xử lý `IDENTITY_INSERT` (MSSQL) và đồng bộ Sequence (Postgres). |
| **Optimistic Locking** | [ ] | Kiểm tra giá trị cũ trong mệnh đề `WHERE` để tránh ghi đè dữ liệu. |
| **Value Inspector** | [ ] | Mở drawer định dạng JSON/XML cho các trường dữ liệu lớn. |
