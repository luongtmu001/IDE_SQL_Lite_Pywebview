# KẾ HOẠCH TRIỂN KHAI XML LAYOUT COMPARE & UPDATE

# XML Layout Comparison & Update Implementation Plan

**Dự án / Project:** LLTool IDE  
**Database:** SQL Server và PostgreSQL  
**Editor:** Monaco Editor / Monaco Diff Editor  
**Phạm vi / Scope:** Tích hợp vào chức năng Compare hiện tại, không thiết kế lại giao diện. / Integrate into the existing Compare feature without redesigning the UI.

---

# PHẦN I. QUY TẮC NGHIỆP VỤ VÀ KỸ THUẬT

# PART I. BUSINESS AND TECHNICAL RULES

## 1. Mục tiêu / Objectives

### Tiếng Việt

Xây dựng chức năng so sánh và cập nhật dữ liệu XML của Bravo Layout trong LLTool IDE.

Chức năng phải đáp ứng:

1. Kiểm tra IDE có được đánh dấu là **Bravo Extension** hay không.
2. Nếu có, bổ sung hai tùy chọn Layout vào danh sách loại so sánh hiện tại.
3. Đọc dữ liệu từ `B00Layout` và `B00LayoutData`.
4. Giải mã payload ZIP thành XML bằng phương thức hiện có trong IDE nếu tương thích.
5. Nhóm danh sách theo `FormName`, hiển thị từng `LayoutName`.
6. So sánh XML bằng Monaco Diff Editor.
7. Hỗ trợ so sánh dữ liệu giữa các phiên bản trong database và XML từ file bên ngoài.
8. Sinh script cập nhật theo quy tắc của script mẫu đã được cung cấp.
9. Bổ sung transaction và cơ chế kiểm soát lỗi cho script cập nhật.
10. Lưu từng Layout một, không triển khai cập nhật hàng loạt trong phiên bản đầu tiên.

### English

Implement a Bravo Layout XML comparison and update feature in LLTool IDE.

The feature must:

1. Detect whether the IDE is flagged as a **Bravo Extension**.
2. If enabled, add two Layout options to the existing comparison-type selector.
3. Retrieve data from `B00Layout` and `B00LayoutData`.
4. Decode ZIP payloads into XML by reusing existing IDE functionality whenever compatible.
5. Group layouts by `FormName` and display individual `LayoutName` entries.
6. Compare XML using Monaco Diff Editor.
7. Support comparisons between database versions and external XML files.
8. Generate update scripts following the previously supplied working script's rules.
9. Add transaction management and error handling to the update script.
10. Update one Layout at a time. Batch updates are outside the initial scope.

---

## 2. Quy tắc kiểm tra Bravo Extension

## Bravo Extension Detection Rules

### 2.1. Tiếng Việt

Trước khi chỉnh sửa giao diện, Agent phải khảo sát cơ chế nhận diện và quản lý extension hiện tại.

Các công việc bắt buộc:

- Tìm nơi lưu trạng thái hoặc cờ Bravo Extension.
- Xác định trạng thái được đọc từ đâu: cấu hình, license, metadata hoặc cơ chế khác đang tồn tại.
- Xác định thời điểm trạng thái được khởi tạo và cập nhật.
- Tìm cách các tính năng khác đang kiểm tra cờ extension.
- Tái sử dụng cơ chế hiện có, không tạo một cờ độc lập nếu không cần thiết.

**Quy tắc hiển thị:**

| Trạng thái | Hành vi |
| --- | --- |
| Bravo Extension được bật | Hiển thị thêm hai tùy chọn Layout |
| Bravo Extension không được bật | Không hiển thị hai tùy chọn Layout |
| Không xác định được trạng thái | Xử lý theo cơ chế an toàn hiện có; không tự mặc định extension đã bật |

Hai tùy chọn mới phải được tích hợp vào danh sách loại so sánh của giao diện Compare hiện tại.

Agent cần xác định cách đặt tên và phân loại chúng dựa trên cấu trúc hiện có, đồng thời ghi rõ tên chính thức của cả hai tùy chọn trong báo cáo triển khai.

Không được thay đổi các tùy chọn Schema Compare hiện có.

### 2.1. English

Before modifying the UI, inspect the existing extension detection and management mechanisms.

Required tasks:

- Locate the Bravo Extension flag or status.
- Determine its source, such as configuration, licensing, metadata, or another existing mechanism.
- Identify when the status is initialized and updated.
- Inspect how other features check extension availability.
- Reuse the existing mechanism instead of introducing a duplicate flag.

**Visibility rules:**

| Status | Behavior |
| --- | --- |
| Bravo Extension enabled | Display two additional Layout options |
| Bravo Extension disabled | Hide both Layout options |
| Status cannot be determined | Follow the existing safe behavior; do not assume the extension is enabled |

Integrate both options into the existing Compare type selector.

Determine their official labels and categorization based on the existing architecture, and document both labels in the implementation report.

Do not modify existing Schema Compare options.

---

## 3. Hai tùy chọn Layout

## The Two Layout Options

### Tiếng Việt

Agent phải khảo sát cách tổ chức các loại so sánh hiện tại để xác định cách tích hợp hai tùy chọn Layout.

Yêu cầu:

- Tuân thủ quy ước đặt tên hiện có.
- Không tạo màn hình Compare mới.
- Không sao chép toàn bộ module Schema Compare để tạo một module Layout Compare độc lập nếu có thể tái sử dụng kiến trúc hiện tại.
- Tái sử dụng cơ chế quản lý kết nối, danh sách đối tượng, trạng thái so sánh, editor và thông báo kết quả.
- Tách riêng phần truy vấn, giải mã payload và cập nhật dữ liệu Layout để tránh ảnh hưởng đến chức năng so sánh Schema.

Agent phải xác định rõ phạm vi của từng tùy chọn, tránh việc hai tùy chọn cùng thực hiện một chức năng.

### English

Inspect the existing comparison types before integrating the two Layout options.

Requirements:

- Follow existing naming conventions.
- Do not create a new Compare screen.
- Do not duplicate the entire Schema Compare module if its architecture can be reused.
- Reuse connection management, object lists, comparison state, editors, and result notifications.
- Keep Layout-specific querying, payload decoding, and database updates separate from Schema Compare logic.

Document the responsibility of each option and ensure that they do not duplicate functionality.

---

# PHẦN II. KHẢO SÁT VÀ TÁI SỬ DỤNG CODE

# PART II. CODE AUDIT AND REUSE

## 4. Kiểm tra phương thức giải mã ZIP/XML

## Inspect Existing ZIP/XML Decoding

### Tiếng Việt

Đây là bước bắt buộc trước khi triển khai chức năng.

Payload trong database có dạng HEX, bắt đầu bằng:

```text
0x504B0304...
```

Đây là dấu hiệu nhận diện header của ZIP. Tuy nhiên, Agent vẫn phải kiểm tra cấu trúc payload thực tế và xác minh quy trình giải mã của Bravo.

Tìm kiếm trong toàn bộ project các thành phần liên quan đến:

- Chuyển HEX thành bytes.
- Đọc binary payload từ SQL Server và PostgreSQL.
- Giải nén ZIP.
- Đọc file XML trong ZIP.
- Giải mã nội dung XML.
- Format XML.
- Validate XML.
- Encode XML trở lại payload ZIP.
- Các tiện ích XML được dùng bởi chức năng khác.

Với mỗi phương thức tìm thấy, xác định:

1. File và tên hàm.
2. Định dạng đầu vào và đầu ra.
3. Cách xử lý payload ZIP.
4. Cách xác định XML entry.
5. Encoding được sử dụng.
6. Khả năng encode ngược.
7. Khả năng tái sử dụng.
8. Các giới hạn và trường hợp lỗi.

**Không tạo decoder mới nếu phương thức hiện tại đã xử lý đúng payload Bravo.**

Nếu phương thức hiện tại chỉ hỗ trợ giải nén ZIP thông thường, Agent phải kiểm tra xem có cần xử lý thêm lớp dữ liệu nào không.

### English

This audit is mandatory before implementation.

Database payloads are represented as hexadecimal values beginning with:

```text
0x504B0304...
```

This is a recognizable ZIP header signature. However, the actual payload structure and Bravo decoding workflow must still be verified.

Search the entire project for:

- HEX-to-bytes conversion.
- Binary payload handling for SQL Server and PostgreSQL.
- ZIP extraction.
- XML entry extraction.
- XML content decoding.
- XML formatting.
- XML validation.
- XML-to-ZIP encoding.
- XML utilities used by other features.

For each existing implementation, document:

1. File path and function name.
2. Input and output formats.
3. ZIP processing behavior.
4. XML entry selection.
5. Character encoding.
6. Reverse-encoding capability.
7. Reusability.
8. Limitations and error cases.

**Do not create a new decoder if the existing implementation already supports the actual Bravo payload.**

If the current implementation only supports generic ZIP extraction, verify whether additional decoding steps are required.

---

## 5. Kiểm tra script UPDATE đã được cung cấp

## Inspect the Previously Supplied UPDATE Script

### Tiếng Việt

Script UPDATE đã chạy ổn định là **nguồn tham chiếu bắt buộc** cho việc sinh script cập nhật Layout.

Agent phải tìm lại script mẫu trong các file, nội dung đã cung cấp hoặc trong project hiện tại.

Các nguyên tắc:

- Giữ nguyên quy tắc xác định bản ghi cần cập nhật.
- Giữ nguyên cách biểu diễn và truyền payload.
- Giữ nguyên các quy tắc nghiệp vụ đã được xác nhận.
- Không tự viết lại logic UPDATE chỉ vì muốn thay đổi cấu trúc script.
- Chỉ bổ sung transaction, kiểm tra lỗi và các biện pháp an toàn cần thiết.
- Nếu script mẫu không thể truy xuất, phải báo cáo trước khi tự suy diễn các chi tiết chưa biết.

Phân biệt rõ hai phần:

1. **Logic UPDATE đã được kiểm chứng:** phải được giữ lại.
2. **Cơ chế transaction mới:** được bổ sung để bảo đảm cập nhật an toàn.

Không được tự tuyên bố script mới tương đương với script mẫu nếu chưa đối chiếu logic và kiểm thử.

### English

The previously supplied, stable UPDATE script is the **mandatory reference** for Layout update script generation.

Locate the original script in the supplied files, conversation materials, or current project.

Rules:

- Preserve the established target-record identification logic.
- Preserve the existing payload representation and parameter handling rules.
- Preserve confirmed business behavior.
- Do not rewrite the UPDATE logic merely to change the script structure.
- Add transaction management, error handling, and necessary safety checks.
- If the reference script cannot be retrieved, report this before inferring undocumented behavior.

Clearly separate:

1. **Verified UPDATE logic:** must be preserved.
2. **New transaction handling:** must be added to improve update safety.

Do not claim equivalence with the original script without comparing the implementations and testing the result.

---

# PHẦN III. TRUY VẤN DATABASE

# PART III. DATABASE QUERIES

## 6. SQL Server

```sql
SELECT
    a.Id,
    a.FormName,
    a.LayoutName,
    b.LayoutData,
    b.LastLayoutData
FROM B00Layout AS a
INNER JOIN B00LayoutData AS b
    ON a.Id = b.Id
ORDER BY
    a.FormName,
    a.LayoutName;
```

### English

Use the existing SQL Server database adapter and connection session.

The query retrieves the layout identity, grouping information, official payload, and latest draft payload.

Do not create a separate connection-management mechanism for this feature.

## 7. PostgreSQL

```sql
SELECT
    a.id,
    a.formname,
    a.layoutname,
    b.layoutdata,
    b.lastlayoutdata
FROM b00layout AS a
INNER JOIN b00layoutdata AS b
    ON a.id = b.id
ORDER BY
    a.formname,
    a.layoutname;
```

### Tiếng Việt

Agent phải kiểm tra schema và kiểu dữ liệu thực tế trước khi triển khai.

Không giả định rằng mọi database PostgreSQL đều sử dụng tên bảng và cột chữ thường mà không có dấu ngoặc kép.

Phải sử dụng đúng cơ chế đọc dữ liệu binary của driver PostgreSQL hiện tại.

### English

Verify the actual PostgreSQL schema and data types before implementation.

Do not assume that all PostgreSQL databases use lowercase identifiers without quoted names.

Use the existing PostgreSQL driver's correct binary-data handling mechanism.

---

# PHẦN IV. QUY TẮC SO SÁNH XML

# PART IV. XML COMPARISON RULES

## 8. Nhóm theo FormName

## Group by FormName

### Tiếng Việt

Danh sách Layout được tổ chức theo cấu trúc:

```text
FormName
├── LayoutName 1
├── LayoutName 2
└── LayoutName 3
```

Yêu cầu:

- `FormName` là nhóm cha.
- `LayoutName` là đối tượng con.
- Sử dụng `Id` để định danh bản ghi cần cập nhật.
- Không dùng riêng `FormName` làm khóa cập nhật vì một command có thể có nhiều Layout.
- Tách dữ liệu payload gốc khỏi XML đã giải mã.
- Có trạng thái giải mã và trạng thái so sánh cho từng Layout.

### English

Organize Layouts as follows:

```text
FormName
├── LayoutName 1
├── LayoutName 2
└── LayoutName 3
```

Requirements:

- `FormName` is the parent group.
- `LayoutName` is the child item.
- Use `Id` to identify the database record for updates.
- Do not use `FormName` alone as an update key because a command can contain multiple Layouts.
- Keep original payloads separate from decoded XML.
- Maintain decoding and comparison status for each Layout.

## 9. Các chế độ so sánh

## Comparison Modes

### Chế độ A — Database Compare

**Tiếng Việt**

So sánh:

- `LayoutData`: payload chính thức.
- `LastLayoutData`: payload bản nháp.

Quy tắc:

- Giải mã hai payload.
- Hiển thị XML trong Monaco Diff Editor.
- Không cập nhật database khi chỉ thực hiện so sánh.
- Nếu `LastLayoutData IS NULL`, hiển thị trạng thái không có bản nháp.
- Nếu payload lỗi, hiển thị lỗi cho Layout tương ứng mà không làm hỏng toàn bộ danh sách.

**English**

Compare:

- `LayoutData`: official payload.
- `LastLayoutData`: draft payload.

Rules:

- Decode both payloads.
- Display their XML in Monaco Diff Editor.
- Do not update the database during comparison.
- If `LastLayoutData IS NULL`, display a no-draft status.
- If a payload is invalid, report the error for that Layout without breaking the entire list.

### Chế độ B — External XML Compare

**Tiếng Việt**

Cho phép người dùng chọn file XML từ bên ngoài để so sánh với dữ liệu trong database.

Quy trình:

```text
Database Payload
       |
       v
Decode to XML
       |
       v
Monaco Diff Editor
       ^
       |
External XML File
```

Yêu cầu:

- Tái sử dụng cơ chế mở file hiện có.
- Validate XML trước khi cho phép cập nhật.
- Giữ nguyên nội dung file nguồn.
- Không ghi dữ liệu vào database chỉ vì file đã được mở.
- Khi người dùng xác nhận cập nhật, sinh script theo quy tắc đã quy định.

**English**

Allow users to select an external XML file and compare it against database content.

Workflow:

```text
Database Payload
       |
       v
Decode to XML
       |
       v
Monaco Diff Editor
       ^
       |
External XML File
```

Requirements:

- Reuse the existing file-opening mechanism.
- Validate XML before allowing updates.
- Preserve the original external file.
- Do not write to the database merely because a file was opened.
- Generate the update script according to the established rules after explicit confirmation.

---

# PHẦN V. QUY TẮC CẬP NHẬT

# PART V. UPDATE RULES

## 10. Nguyên tắc cập nhật cả hai cột

## Update Both Columns

### Tiếng Việt

Khác với phương án ban đầu, chức năng Compare & Update phải xử lý **cả `LayoutData` và `LastLayoutData` trong một lần cập nhật Layout**.

Không phân biệt việc cột `LastLayoutData` đang có dữ liệu hay đang là `NULL` để quyết định bỏ qua cập nhật.

Quy tắc:

1. Xác định `Id` của Layout.
2. Lấy nội dung XML đã được xác nhận cập nhật.
3. Validate XML.
4. Encode XML thành payload ZIP đúng định dạng Bravo.
5. Sinh script UPDATE theo logic của script mẫu.
6. Cập nhật cả hai cột trong cùng một transaction.
7. Kiểm tra số bản ghi bị ảnh hưởng.
8. Commit khi thành công; rollback khi có lỗi.

**Lưu ý:** Cập nhật cả hai cột không có nghĩa là đặt hai cột bằng cùng một payload. Agent phải giữ đúng logic ánh xạ dữ liệu của script UPDATE mẫu. Nếu script mẫu xác định giá trị khác nhau cho từng cột, phải bảo toàn logic đó.

Nếu chưa xác minh được cách script mẫu ánh xạ dữ liệu vào hai cột, không được tự suy diễn.

### English

Unlike the initial proposal, the Compare & Update feature must process **both `LayoutData` and `LastLayoutData` in a single Layout update operation**.

Do not skip an update merely because `LastLayoutData` is currently populated or `NULL`.

Rules:

1. Identify the Layout by `Id`.
2. Obtain the XML content confirmed by the user.
3. Validate the XML.
4. Encode the XML into the correct Bravo ZIP payload format.
5. Generate the UPDATE script using the reference script's logic.
6. Update both columns within the same transaction.
7. Verify the affected-row count.
8. Commit on success and roll back on failure.

**Important:** Updating both columns does not necessarily mean assigning the same payload to both. Preserve the reference script's mapping logic. If the original script assigns different values to the two columns, that behavior must remain unchanged.

If the original column-mapping behavior cannot be verified, do not invent it.

## 11. Transaction cho script UPDATE

## Transaction Management for UPDATE Scripts

### Tiếng Việt

Transaction là phần cải tiến so với script đang chạy ổn định.

Agent phải giữ nguyên logic UPDATE hiện có và bổ sung cơ chế transaction tương thích với từng database.

Quy trình tổng quát:

```text
Validate XML
     |
     v
Encode ZIP Payload
     |
     v
Generate UPDATE Script
     |
     v
BEGIN TRANSACTION
     |
     v
Verify Target Record
     |
     v
Check Concurrent Changes
     |
     v
UPDATE LayoutData
UPDATE LastLayoutData
     |
     v
Verify Affected Rows
     |
     +------ Failure ------> ROLLBACK
     |
     v
COMMIT
     |
     v
Reload Layout
```

Các yêu cầu bắt buộc:

- Hai cột phải được cập nhật trong cùng transaction.
- Không để xảy ra trạng thái chỉ một cột được cập nhật.
- Dùng parameterized query cho payload nhị phân khi thực thi trực tiếp qua driver.
- Nếu sinh script SQL để người dùng xem hoặc chạy thủ công, script phải biểu diễn payload và kiểu dữ liệu đúng với database đích.
- Xử lý lỗi bằng cơ chế tương ứng của SQL Server và PostgreSQL.
- Rollback khi phát sinh lỗi.
- Bảo toàn nội dung XML đang chỉnh sửa khi cập nhật thất bại.
- Không thực thi script UPDATE chỉ vì người dùng vừa xem Diff.

### English

Transaction handling is the enhancement to the existing stable UPDATE script.

Preserve the original UPDATE logic and add transaction handling compatible with each database engine.

General workflow:

```text
Validate XML
     |
     v
Encode ZIP Payload
     |
     v
Generate UPDATE Script
     |
     v
BEGIN TRANSACTION
     |
     v
Verify Target Record
     |
     v
Check Concurrent Changes
     |
     v
UPDATE LayoutData
UPDATE LastLayoutData
     |
     v
Verify Affected Rows
     |
     +------ Failure ------> ROLLBACK
     |
     v
COMMIT
     |
     v
Reload Layout
```

Mandatory requirements:

- Both columns must be updated within the same transaction.
- The update must not leave only one column modified.
- Use parameterized queries for binary payloads when executing through a database driver.
- If generating SQL for manual review or execution, represent the payload and data types correctly for the target database.
- Handle errors using the appropriate SQL Server or PostgreSQL mechanisms.
- Roll back on failure.
- Preserve the edited XML when an update fails.
- Never execute an UPDATE merely because the user has viewed the Diff.

## 12. Phân biệt sinh script và thực thi script

## Separate Script Generation from Script Execution

### Tiếng Việt

Agent phải duy trì cơ chế sinh script hiện có, nhưng bổ sung transaction cho script được sinh ra.

Cần phân biệt:

**A. Sinh script**

- Tạo script từ XML đã xác nhận.
- Hiển thị nội dung script.
- Cho phép người dùng xem lại trước khi thực thi.

**B. Thực thi cập nhật**

- Yêu cầu xác nhận rõ ràng.
- Kiểm tra kết nối và database đích.
- Thực hiện transaction.
- Hiển thị kết quả thành công hoặc lỗi.

Không tự động thực thi SQL khi người dùng chỉ yêu cầu tạo script.

Nếu IDE đã có chức năng xem hoặc mở script trong editor, hãy tái sử dụng chức năng đó.

### English

Preserve the existing script-generation mechanism while adding transaction handling to the generated script.

Separate:

**A. Script generation**

- Generate a script from the confirmed XML.
- Display the generated script.
- Allow the user to review it before execution.

**B. Update execution**

- Require explicit confirmation.
- Verify the connection and target database.
- Execute the update transactionally.
- Report success or failure.

Do not automatically execute SQL when the user only requests script generation.

Reuse existing script-preview and editor functionality wherever possible.

---

# PHẦN VI. LƯU TỪNG LAYOUT

# PART VI. PER-LAYOUT UPDATES

## 13. Quy tắc lưu

## Save Rules

### Tiếng Việt

Phiên bản đầu tiên chỉ cập nhật từng Layout.

Mỗi thao tác cập nhật phải:

1. Xác định duy nhất một Layout bằng `Id`.
2. Kiểm tra XML.
3. Encode payload.
4. Sinh script.
5. Xác nhận cập nhật.
6. Cập nhật hai cột trong cùng transaction.
7. Tải lại dữ liệu của Layout đó.
8. Cập nhật trạng thái khác biệt trên giao diện.

Không triển khai:

- Cập nhật hàng loạt nhiều Layout.
- Chạy nhiều transaction cho một Layout.
- Tự động cập nhật tất cả Layout cùng `FormName`.
- Tự động thực thi script khi chuyển sang Layout khác.

Nếu cập nhật thất bại, giữ nguyên nội dung đang chỉnh sửa để người dùng có thể sửa hoặc thử lại.

### English

The initial release must update one Layout at a time.

Each update must:

1. Identify exactly one Layout by `Id`.
2. Validate the XML.
3. Encode the payload.
4. Generate the update script.
5. Require confirmation.
6. Update both columns within the same transaction.
7. Reload the updated Layout.
8. Refresh its comparison state in the UI.

Do not implement:

- Batch updates across multiple Layouts.
- Multiple independent transactions for one Layout update.
- Automatic updates of every Layout under the same `FormName`.
- Automatic script execution when switching between Layouts.

If an update fails, preserve the edited content so the user can correct it or retry.

---

# PHẦN VII. AN TOÀN DỮ LIỆU

# PART VII. DATA SAFETY

## 14. Kiểm soát cập nhật đồng thời

## Concurrency Control

### Tiếng Việt

Agent phải kiểm tra xem IDE hoặc database adapter đã có cơ chế kiểm soát cập nhật đồng thời hay chưa.

Nếu đã có, tái sử dụng.

Nếu chưa có, triển khai cơ chế phù hợp cho từng database để tránh ghi đè dữ liệu đã thay đổi kể từ khi người dùng tải Layout.

Quy trình:

1. Ghi nhận trạng thái dữ liệu khi tải Layout.
2. Khi người dùng xác nhận cập nhật, kiểm tra dữ liệu hiện tại.
3. Nếu dữ liệu đã thay đổi, từ chối cập nhật.
4. Yêu cầu người dùng tải lại và so sánh.
5. Không tự động ghi đè dữ liệu mới hơn.

Cơ chế kiểm tra phải xét đến cả hai cột được cập nhật.

### English

Inspect whether the IDE or database adapters already implement concurrency control.

Reuse existing mechanisms where available.

Otherwise, implement a database-appropriate strategy to prevent overwriting changes made after the Layout was loaded.

Workflow:

1. Record the data state when loading the Layout.
2. Check the current database state when the user confirms an update.
3. Reject the update if the data has changed.
4. Ask the user to reload and compare again.
5. Never silently overwrite newer data.

The concurrency check must account for both columns being updated.

## 15. Xử lý lỗi

## Error Handling

| Tình huống / Scenario | Hành vi / Expected behavior |
| --- | --- |
| ZIP không hợp lệ / Invalid ZIP | Từ chối cập nhật / Reject update |
| XML không hợp lệ / Invalid XML | Từ chối cập nhật / Reject update |
| Encode thất bại / Encoding failure | Không ghi database / Do not write |
| Không tìm thấy `Id` / Target not found | Rollback và thông báo / Roll back and notify |
| Dữ liệu thay đổi đồng thời / Concurrent modification | Từ chối ghi đè / Reject overwrite |
| UPDATE thất bại / UPDATE failure | Rollback / Roll back |
| Chỉ cập nhật được một cột / Partial column update | Rollback toàn transaction / Roll back entire transaction |
| Không có quyền ghi / Insufficient permissions | Thông báo lỗi / Report the error |
| Thành công / Success | Commit và tải lại / Commit and reload |

---

# PHẦN VIII. THỨ TỰ TRIỂN KHAI

# PART VIII. IMPLEMENTATION ORDER

## Giai đoạn 1 — Audit / Phase 1 — Audit

**Tiếng Việt**

- Kiểm tra cờ Bravo Extension.
- Tìm cơ chế giải mã ZIP/XML.
- Tìm script UPDATE mẫu.
- Kiểm tra kiến trúc Compare.
- Kiểm tra database adapter và transaction.
- Lập danh sách file dự kiến thay đổi.

Chưa sửa code chức năng trong giai đoạn này.

**English**

- Inspect the Bravo Extension flag.
- Locate existing ZIP/XML decoding functionality.
- Locate the reference UPDATE script.
- Inspect the Compare architecture.
- Inspect database adapters and transaction handling.
- List the files expected to change.

Do not modify feature code during this phase.

## Giai đoạn 2 — Extension và hai tùy chọn Layout / Phase 2 — Extension and Layout Options

**Tiếng Việt**

- Tích hợp điều kiện kiểm tra Bravo Extension.
- Bổ sung hai tùy chọn Layout.
- Giữ nguyên UI và chức năng Schema Compare.
- Kiểm thử khi extension bật và tắt.

**English**

- Integrate Bravo Extension detection.
- Add the two Layout options.
- Preserve the existing UI and Schema Compare behavior.
- Test both enabled and disabled extension states.

## Giai đoạn 3 — Đọc và giải mã / Phase 3 — Data Loading and Decoding

**Tiếng Việt**

- Truy vấn hai bảng.
- Nhóm theo `FormName`.
- Hiển thị `LayoutName`.
- Tái sử dụng decoder.
- Kiểm thử payload mẫu.
- Kiểm tra encode ngược.

**English**

- Query both tables.
- Group by `FormName`.
- Display `LayoutName`.
- Reuse the existing decoder.
- Test representative payloads.
- Verify reverse encoding.

## Giai đoạn 4 — Compare / Phase 4 — Comparison

**Tiếng Việt**

- Tích hợp Monaco Diff Editor.
- Hỗ trợ database compare.
- Hỗ trợ external XML compare.
- Xử lý trạng thái `LastLayoutData = NULL`.
- Bảo đảm không ảnh hưởng Schema Compare.

**English**

- Integrate Monaco Diff Editor.
- Support database comparison.
- Support external XML comparison.
- Handle `LastLayoutData = NULL`.
- Ensure Schema Compare remains unaffected.

## Giai đoạn 5 — Update và transaction / Phase 5 — Update and Transactions

**Tiếng Việt**

- Đối chiếu logic script UPDATE mẫu.
- Bảo toàn quy tắc ánh xạ dữ liệu.
- Bổ sung transaction.
- Cập nhật cả hai cột theo đúng logic mẫu.
- Bổ sung kiểm tra concurrency.
- Xử lý rollback và thông báo lỗi.

**English**

- Compare the implementation against the reference UPDATE script.
- Preserve the original data-mapping rules.
- Add transaction management.
- Update both columns according to the reference logic.
- Implement concurrency checks.
- Handle rollback and error reporting.

## Giai đoạn 6 — Kiểm thử / Phase 6 — Testing

**Tiếng Việt**

Kiểm thử trên SQL Server và PostgreSQL, sử dụng database thử nghiệm.

Không chạy thử các thao tác ghi trên production.

**English**

Test on both SQL Server and PostgreSQL using a test database.

Do not run experimental write operations against production.

---

# PHẦN IX. TIÊU CHÍ NGHIỆM THU

# PART IX. ACCEPTANCE CRITERIA

| # | Tiếng Việt | English |
| --- | --- | --- |
| 1 | Xác định đúng cờ Bravo Extension | Correctly detect the Bravo Extension flag |
| 2 | Chỉ hiển thị hai tùy chọn Layout khi extension được bật | Show both Layout options only when the extension is enabled |
| 3 | Không làm thay đổi Schema Compare | Preserve Schema Compare behavior |
| 4 | Tái sử dụng decoder hiện có nếu phù hợp | Reuse the existing decoder when compatible |
| 5 | Giải mã đúng payload ZIP mẫu | Correctly decode representative ZIP payloads |
| 6 | Nhóm dữ liệu theo `FormName` | Group data by `FormName` |
| 7 | So sánh bằng Monaco Diff Editor | Compare using Monaco Diff Editor |
| 8 | Hỗ trợ XML từ file ngoài | Support external XML files |
| 9 | Sinh script theo logic UPDATE mẫu | Generate scripts following the reference UPDATE logic |
| 10 | Cập nhật cả hai cột theo đúng quy tắc mẫu | Update both columns according to the reference rules |
| 11 | Hai cột được cập nhật trong cùng transaction | Update both columns in the same transaction |
| 12 | Rollback khi có lỗi | Roll back on failure |
| 13 | Ngăn ghi đè thay đổi đồng thời | Prevent overwriting concurrent changes |
| 14 | Chỉ cập nhật từng Layout | Update one Layout at a time |
| 15 | Không tự động thực thi script khi chỉ xem | Do not execute scripts merely for preview |
| 16 | Không làm mất XML đang chỉnh sửa khi lỗi | Preserve edited XML after failure |
| 17 | Kiểm thử thành công trên cả hai database | Pass tests on both database engines |

---

# PHẦN X. PROMPT GIAO AGENT

# PART X. IMPLEMENTATION PROMPT

Bạn có thể sao chép nguyên phần dưới đây để giao Agent.

```text
TASK: Implement Bravo Layout XML Compare & Update in LLTool IDE

LANGUAGE:
- Vietnamese and English documentation are acceptable.
- Keep code comments consistent with existing project conventions.

==================================================
1. OBJECTIVE
==================================================

Implement a Layout XML comparison and update feature in the existing
LLTool IDE.

Support:
- SQL Server
- PostgreSQL
- Existing Monaco Editor / Monaco Diff Editor
- Existing Compare interface

Do not redesign the UI.

==================================================
2. BRAVO EXTENSION FLAG
==================================================

Inspect the existing Bravo Extension detection mechanism before
modifying the UI.

Identify:
- The flag or status source.
- Initialization and update behavior.
- Existing extension checks used by other features.

Reuse the existing mechanism.

When Bravo Extension is enabled:
- Display two additional Layout options in the existing Compare
  type selector.

When disabled:
- Do not display these options.

Determine the official labels and responsibilities of both options
from the existing architecture and document them.

Do not modify existing Schema Compare options or behavior.

==================================================
3. MANDATORY CODE AUDIT
==================================================

Before implementing the feature, inspect:

- Existing ZIP/XML decoding utilities.
- Existing XML encoding utilities.
- Binary payload handling.
- SQL Server and PostgreSQL adapters.
- Existing transaction handling.
- Existing Compare components.
- Monaco Diff Editor integration.
- The previously supplied stable UPDATE script.

Reuse existing code whenever compatible.

Do not create duplicate utilities without justification.

The payload is ZIP-based and may be represented as a hexadecimal
database value.

Verify the actual payload structure and encoding behavior.

If the reference UPDATE script cannot be retrieved, report that
limitation before inventing undocumented update logic.

Do not implement database writes until the payload format and
reference update behavior have been verified.

==================================================
4. DATA MODEL
==================================================

Tables:
- B00Layout
- B00LayoutData

Join:
- B00Layout.Id = B00LayoutData.Id

Fields:
- Id
- FormName
- LayoutName
- LayoutData
- LastLayoutData

LayoutData represents the official payload.

LastLayoutData represents the latest draft payload.

Group layouts by FormName and display LayoutName.

Use Id as the record identifier for updates.

Preserve original database payloads separately from decoded XML.

Verify actual schema and data types for both supported databases.

==================================================
5. COMPARISON
==================================================

Support database comparison:
- LayoutData versus LastLayoutData.

Support external XML comparison:
- Database XML versus a user-selected external XML file.

Reuse the existing Monaco Diff Editor and file-opening mechanisms.

If LastLayoutData is NULL:
- Display a no-draft state.
- Do not fabricate an empty XML document.

Comparison must not modify database data.

Validate XML before allowing updates.

==================================================
6. PAYLOAD PROCESSING
==================================================

Inspect and reuse existing ZIP/XML processing methods.

Verify:
- HEX-to-bytes conversion.
- ZIP extraction.
- XML entry selection.
- Character encoding.
- XML validation.
- Reverse encoding.

Do not assume that generic ZIP extraction is sufficient.

Test round-trip behavior:

Original payload
-> Decode
-> XML
-> Encode
-> Decode
-> Verify XML content

Do not enable database writes until reverse encoding has been
verified against representative Bravo payloads.

==================================================
7. UPDATE BOTH COLUMNS
==================================================

The Compare & Update operation must process both:

- LayoutData
- LastLayoutData

Do not skip either column merely because LastLayoutData is NULL
or contains a value.

The previously supplied stable UPDATE script is the authoritative
reference for update semantics.

Preserve its:
- Record identification logic.
- Payload representation.
- Column mapping.
- Business rules.

Do not assume that both columns must receive identical payloads.
Follow the verified reference script's mapping rules.

If the reference script's behavior cannot be established, stop
before implementing writes and report the missing information.

==================================================
8. TRANSACTION
==================================================

Enhance the reference UPDATE script with transaction management.

Required workflow:

1. Validate the edited XML.
2. Encode the XML into the verified Bravo payload format.
3. Generate the update script.
4. Show a preview.
5. Require explicit confirmation.
6. Begin a transaction.
7. Verify the target record.
8. Check for concurrent modifications.
9. Update both columns according to the reference script.
10. Verify the affected-row count.
11. Commit on success.
12. Roll back on failure.
13. Reload the Layout after a successful update.

Both column updates must be atomic.

Use the existing database adapters.

Use database-specific transaction handling for SQL Server and
PostgreSQL.

Use parameterized queries for binary payloads when executing
through database drivers.

Do not execute SQL merely because the user viewed the Diff or
requested script generation.

Preserve the user's edited XML if an update fails.

==================================================
9. CONCURRENCY
==================================================

Inspect existing optimistic concurrency mechanisms.

Reuse them when available.

Otherwise, implement an appropriate check for each database.

Reject the update if the relevant data has changed since loading.

The check must cover both columns.

Do not silently overwrite concurrent modifications.

==================================================
10. PER-LAYOUT UPDATE
==================================================

The initial implementation must update one Layout at a time.

Do not implement batch updates.

Do not automatically update every Layout sharing the same FormName.

After success:
- Reload the updated record.
- Refresh its comparison state.
- Update its status in the UI.

After failure:
- Roll back.
- Preserve the user's edited XML.
- Show a useful error message.

==================================================
11. IMPLEMENTATION RULES
==================================================

Before each phase, report:
- Files to change.
- Existing methods to reuse.
- New methods required.
- Impact scope.
- Regression risks.
- Tests to run.

Avoid unrelated refactoring.

Do not delete existing utilities.

Do not modify user connection settings or unrelated configuration.

Do not redesign the existing UI.

Do not change Schema Compare behavior.

Do not run write tests against production.

==================================================
12. TESTING
==================================================

Test:
- Bravo Extension enabled and disabled.
- Visibility of both Layout options.
- SQL Server queries.
- PostgreSQL queries.
- ZIP decoding.
- XML validation.
- Reverse encoding.
- Database comparison.
- External XML comparison.
- LastLayoutData = NULL.
- Both columns updated atomically.
- Transaction rollback.
- Concurrent modification.
- Failed database writes.
- Monaco model lifecycle.
- Regression of existing Schema Compare.

==================================================
13. DELIVERABLES
==================================================

Provide:

1. Code audit report.
2. Bravo Extension detection findings.
3. Official names and responsibilities of both Layout options.
4. Existing ZIP/XML decoder and encoder findings.
5. Reference UPDATE script comparison.
6. List of modified and added files.
7. Transaction and concurrency implementation details.
8. Test results for both databases.
9. Known limitations.

Do not claim successful payload compatibility or safe updates
without evidence from implementation and testing.
```

---

## Lưu ý kỹ thuật cuối cùng / Final Technical Note

**Tiếng Việt:** Có một điểm cần Agent đặc biệt chú ý: yêu cầu cập nhật cả hai cột phải được thực hiện theo logic của script UPDATE đã chạy ổn định, không phải bằng cách gán cùng một giá trị cho cả hai cột theo suy đoán. Transaction chỉ bảo đảm tính nguyên tử của thao tác; nó không tự bảo đảm dữ liệu được ghi đúng nghiệp vụ.

Ngoài ra, việc kiểm tra cờ Bravo Extension phải dựa trên cơ chế thực tế của IDE, không dựa trên tên ứng dụng hoặc việc người dùng đang kết nối tới một database Bravo.

**English:** One critical distinction: updating both columns must follow the verified logic of the existing stable UPDATE script. It must not mean assigning the same value to both columns based on an assumption. A transaction guarantees atomicity, but it does not guarantee that the correct business values are written.

Likewise, Bravo Extension detection must rely on the IDE's actual extension flag, not the application name or the fact that the user is connected to a Bravo database.
