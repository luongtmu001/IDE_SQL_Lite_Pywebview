# TÀI LIỆU KỸ THUẬT: THIẾT KẾ VÀ XỬ LÝ GRID KẾT QUẢ TRUY VẤN SQL

Tài liệu này hướng dẫn chi tiết quy chuẩn thiết kế, luồng nghiệp vụ và thuật toán xử lý dữ liệu cho lưới hiển thị kết quả (Data Grid) từ các câu lệnh truy vấn SQL (tương tự như SSMS, DBeaver, DataGrip, Navicat).

Giao diện phải tuân thủ theo project. Thay đổi theme context-menu cũng phải thay đổi

---

## 1. MÔ HÌNH DỮ LIỆU & QUẢN LÝ SELECTION

Lưới dữ liệu (Grid) cần hỗ trợ mô hình chọn theo ô (Cell-based selection) thay vì chỉ chọn theo dòng (Row-based selection).
user cũng có thể click vào đầu dòng để chọn cả dòng

### 1.1. Cấu trúc Vùng Chọn (Selection Model)

Mỗi vùng chọn cần được xác định bởi:

- `AnchorCell`: Ô bắt đầu tương tác chuột/phím `(RowIndex, ColIndex)`.
- `LeadCell`: Ô kết thúc tương tác `(RowIndex, ColIndex)`.
- `BoundingBox`: Tọa độ chữ nhật bao quanh:
  $$\text{MinRow} = \min(\text{Anchor.Row}, \text{Lead.Row}), \quad \text{MaxRow} = \max(\text{Anchor.Row}, \text{Lead.Row})$$
  $$\text{MinCol} = \min(\text{Anchor.Col}, \text{Lead.Col}), \quad \text{MaxCol} = \max(\text{Anchor.Col}, \text{Lead.Col})$$

---

## 2. CHI TIẾT CÁC CHỨC NĂNG NGHIỆP VỤ

### Chức năng 1: Copy (Giá trị đơn hoặc Range)

- **Phím tắt:** `Ctrl + C`

- **Mục tiêu:** Sao chép nội dung các ô được chọn vào System Clipboard theo chuẩn bảng dữ liệu.

#### Luồng xử lý

1. Xác định danh sách các ô thuộc vùng chọn `BoundingBox`.
2. Định dạng dữ liệu theo chuẩn TSV (Tab-Separated Values):
   - Phân cách giữa các cột bằng ký tự Tab (`\t`).
   - Phân cách giữa các dòng bằng ký tự xuống dòng (`\r\n` cho Windows hoặc `\n` cho Linux/macOS).
3. **Quy tắc trích xuất giá trị:**
   - Giá trị `NULL` hiển thị trên UI có thể là chữ `[NULL]` hoặc tô xám, nhưng khi copy giá trị đơn/range thuần túy, quy ước chuẩn là chuỗi rỗng `""`.
   - Nếu ô chứa ký tự xuống dòng (`\n`) hoặc ký tự Tab (`\t`), giá trị phải được bọc trong cặp ngoặc kép `""` và nhân đôi dấu ngoặc kép nội tại (chuẩn RFC 4180).
4. Đẩy chuỗi kết quả vào Clipboard (`text/plain` và `text/html` nếu cần giữ style).

---

### Chức năng 2: Copy with Header (Giá trị đơn hoặc Range)

- **Phím tắt:** `Ctrl + Shift + C`

- **Mục tiêu:** Sao chép kết quả đã chọn kèm theo dòng tiêu đề (Column Header) tương ứng của các cột đó.

#### Luồng xử lý

1. Lấy danh sách chỉ số cột tham gia vào vùng chọn: `[MinCol, MinCol + 1, ..., MaxCol]`.
2. Tạo dòng đầu tiên (Header Row):

   ```text
   ColumnName[MinCol] + '\t' + ColumnName[MinCol + 1] + ... + '\r\n'
   ```

3. Ghép các dòng dữ liệu bên dưới tương tự như **Chức năng 1**.
4. Lưu toàn bộ chuỗi đã format vào Clipboard.

---

### Chức năng 3: Select All

- **Phím tắt:** `Ctrl + A` (hoặc click vào ô góc trên bên trái - Top-Left Header Cell)

- **Mục tiêu:** Đưa toàn bộ Grid vào trạng thái được chọn.

#### Luồng xử lý

1. Bắt sự kiện `KeyDown` (`Key == 'A' && CtrlModifier == true`).
2. Cập nhật trạng thái Selection:
   - `AnchorCell = (0, 0)`
   - `LeadCell = (TotalRows - 1, TotalColumns - 1)`
3. Đánh dấu cờ `IsSelectAll = true`.
4. Render lại trạng thái visual của Grid (highlight toàn bộ cell và header).
5. **Tối ưu hiệu năng:** Tránh duyệt từng ô để thay đổi trạng thái nếu tập dữ liệu lớn; chỉ cập nhật cờ và sử dụng cơ chế Virtual Scrolling để render vùng hiển thị.

---

### Chức năng 4: Script as INSERT

- **ContextMenu / Phím tắt:** Chuột phải $\rightarrow$ `Script as INSERT`

- **Mục tiêu:** Tạo câu lệnh SQL `INSERT INTO #tabletmp(...) VALUES (...)` từ vùng chọn và ghi vào Clipboard.

#### Yêu cầu xử lý kiểu dữ liệu, NULL và Khoảng trắng

Trước khi tạo vào chèn vào trước câu lênh insert câu lệnh tạo bảng tạm #tabletmp với cột theo khoảng chọn và data đã khai báo của bảng
Tuyệt đối tuân thủ phân biệt giữa:

- **`NULL` thực sự:** Không được bọc dấu nháy đơn, xuất ra từ khóa `NULL`.
- **Chuỗi rỗng (`""`):** Xuất ra `''`.
- **Khoảng trắng (`" "` hoặc `"   "`):** Phải giữ nguyên độ dài khoảng trắng, xuất ra `' '` hoặc `'   '`. **Cấm sử dụng `.Trim()` tự động**.
- **Ký tự đặc biệt trong chuỗi:** Dấu nháy đơn `'` phải được escape thành `''`.

#### Bảng quy tắc định dạng theo hệ CSDL

| Loại giá trị | SQL Server (T-SQL) | PostgreSQL | Oracle | MySQL |
| :--- | :--- | :--- | :--- | :--- |
| **`NULL`** | `NULL` | `NULL` | `NULL` | `NULL` |
| **Chuỗi rỗng** | `''` | `''` | `NULL` *(Lưu ý: Oracle coi `''` là `NULL`)* | `''` |
| **Khoảng trắng** (`"   "`) | `'   '` | `'   '` | `'   '` | `'   '` |
| **Unicode String** | `N'Gia_Tri'` | `'Gia_Tri'` | `'Gia_Tri'` | `'Gia_Tri'` |
| **Boolean** | `1` / `0` | `TRUE` / `FALSE` | `1` / `0` | `1` / `0` (hoặc `TRUE`/`FALSE`) |
| **DateTime** | `'YYYY-MM-DDTHH:mm:ss.fff'` | `'YYYY-MM-DD HH:mm:ss'` | `TO_DATE('...', '...')` | `'YYYY-MM-DD HH:mm:ss'` |
| **Number** | `1234.56` (Dùng dấu chấm `.` Invariant) | `1234.56` | `1234.56` | `1234.56` |

#### Thuật toán tạo câu lệnh SQL (Mẫu T-SQL)

```csharp
// Giả mã thuật toán Script as INSERT
StringBuilder sqlBuilder = new StringBuilder();
var selectedCols = GetSelectedColumns(); // Danh sách tên cột được chọn
var selectedRows = GetSelectedRowsData();

string columnList = string.Join(", ", selectedCols.Select(c => $"[{c.Name}]"));
sqlBuilder.AppendLine($"INSERT INTO #tabletmp ({columnList}) VALUES");

List<string> rowValuesList = new List<string>();

foreach (var row in selectedRows)
{
    List<string> cellValues = new List<string>();
    foreach (var col in selectedCols)
    {
        object val = row[col];
        cellValues.Add(FormatSqlValue(val, col.DataType, targetDbType));
    }
    rowValuesList.Add($"    ({string.Join(", ", cellValues)})");
}

// Ghép các dòng (xử lý giới hạn batch nếu số dòng > 1000 đối với SQL Server)
sqlBuilder.Append(string.Join(",\r\n", rowValuesList));
sqlBuilder.Append(";");

Clipboard.SetText(sqlBuilder.ToString());
```

---

### Chức năng 5: Open in Excel

- **Mục tiêu:** Xuất nhanh vùng chọn (hoặc toàn bộ grid nếu chưa chọn vùng) ra file tạm và kích hoạt Excel mở file.

- **Quy chuẩn file tạm:** Khi người dùng xem, nếu có nhu cầu chỉnh sửa và lưu lại, ứng dụng phải bắt buộc người dùng thực hiện thao tác **Save As** sang file mới để tránh mất dữ liệu khi file tạm bị xóa.

#### Giải pháp kỹ thuật

1. **Tạo đường dẫn file tạm:**

   ```csharp
   string tempDir = Path.Combine(Path.GetTempPath(), "SqlGridExports");
   Directory.CreateDirectory(tempDir);
   string fileName = $"Export_{DateTime.Now:yyyyMMdd_HHmmss}_{Guid.NewGuid().ToString("N").Substring(0, 6)}.xlsx";
   string filePath = Path.Combine(tempDir, fileName);
   ```

2. **Ghi dữ liệu ra định dạng `.xlsx`:**
   - Dùng các thư viện như `OpenXML`, `EPPlus`, hoặc `ClosedXML`.
   - Giữ nguyên định dạng số, ngày tháng, văn bản (Text format cho các trường mã có số `0` ở đầu).
3. **Khóa thuộc tính Read-Only trên file:**
   - Đặt thuộc tính tập tin thành `ReadOnly`:

     ```csharp
     File.SetAttributes(filePath, FileAttributes.ReadOnly);
     ```

   - *Cơ chế hoạt động của Excel:* Khi mở một file có thuộc tính `ReadOnly`, Excel sẽ hiển thị thông báo `[Read-Only]` trên thanh tiêu đề. Nếu người dùng nhấn `Ctrl + S`, Excel sẽ từ chối ghi đè và tự động bật hộp thoại **Save As** để yêu cầu chọn nơi lưu mới.
4. **Hiển thị thông báo UI Toast (User Experience):**
   - Bật thông báo góc màn hình: *"Đang mở dữ liệu trong Excel ở chế độ Tạm (Read-Only). Vui lòng chọn 'Save As' nếu bạn muốn lưu lại các chỉnh sửa."*
5. **Kích hoạt ứng dụng Excel:**

   ```csharp
   Process.Start(new ProcessStartInfo(filePath) { UseShellExecute = true });
   ```

---

### Chức năng 6: Save Result As

- **Phím tắt:** `Ctrl + Shift + S`

- **Mục tiêu:** Mở hộp thoại `SaveFileDialog` chuẩn hệ thống, cho phép người dùng chọn định dạng xuất và vị trí lưu trên máy tính.

#### 1. Cấu hình Filter cho File Dialog

```text
Excel Workbook (*.xlsx)|*.xlsx|CSV (Comma delimited) (*.csv)|*.csv|TSV (Tab delimited) (*.txt)|*.txt|JSON (*.json)|*.json
```

#### 2. Xử lý xuất file CSV/TSV chuẩn

- **Encoding:** Bắt buộc sử dụng **UTF-8 with BOM** (`Encoding.UTF8` trong .NET có BOM `EF BB BF`). Nếu không có BOM, khi người dùng mở CSV bằng Excel trên Windows sẽ bị lỗi hiển thị tiếng Việt và ký tự Unicode.
- **Escape rules (RFC 4180):**
  - Nếu ô chứa dấu phẩy `,`, dấu ngoặc kép `"`, hoặc ký tự xuống dòng `\r`, `\n`: Bọc toàn bộ giá trị trong `""`.
  - Thay thế mọi dấu `"` bên trong ô bằng `""`.

#### 3. Xử lý xuất file Excel (.xlsx)

- Sử dụng cơ chế Streaming (ví dụ `OpenXmlWriter` hoặc thư viện hỗ trợ Streaming Export) để tránh tràn bộ nhớ RAM (OutOfMemoryException) khi số lượng dòng vượt quá hàng trăm nghìn dòng.
- Tạo tự động AutoFilter và Freeze top row (Header) để người dùng dễ tra cứu.

---

## 3. KIỂM THỬ VÀ VALIDATION (TEST CASES)

| ID | Chức năng | Dữ liệu đầu vào | Kết quả mong đợi |
| :--- | :--- | :--- | :--- |
| **TC01** | Copy with Header | Chọn cột `FullName`, `Age` từ dòng 2 đến 5 | Clipboard chứa dòng đầu là `FullName\tAge`, các dòng sau là giá trị tương ứng. |
| **TC02** | Script INSERT | Cột `Code` có giá trị chuỗi rỗng `""` | Xuất hiện cú pháp `''`, không xuất hiện `NULL`. |
| **TC03** | Script INSERT | Cột `Notes` có 3 khoảng trắng `"   "` | Xuất hiện `'   '` (giữ nguyên khoảng trắng). |
| **TC04** | Script INSERT | Cột `Address` có giá trị `NULL` | Xuất hiện từ khóa `NULL` (không có dấu nháy). |
| **TC05** | Open in Excel | Nhấn Open in Excel, sửa 1 ô và bấm `Ctrl + S` | Excel hiển thị hộp thoại `Save As`, không cho phép ghi đè lên file tạm. |
| **TC06** | Save As CSV | Cột `Name` có dấu tiếng Việt `Nguyễn Văn A` | Mở lại file CSV trong Excel hiển thị đúng tiếng Việt không bị lỗi font (nhờ UTF-8 BOM). |
