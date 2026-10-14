# TERMINAL / POWERSHELL OPERATION RULES

## 1. Phạm vi thao tác

Agent được phép chủ động sử dụng:

* Terminal
* PowerShell
* Command Prompt
* Các command/script khác được thực thi từ terminal

nhưng **chỉ trong phạm vi dự án hiện tại**.

Agent không được tự ý thao tác ra ngoài thư mục/project hiện tại nếu thao tác đó không cần thiết cho nhiệm vụ.

### Được phép

Các thao tác phục vụ việc:

* Đọc cấu trúc project.
* Đọc file.
* Tìm kiếm source code.
* Kiểm tra dependency.
* Kiểm tra version.
* Build project.
* Run/test project.
* Chạy lint/formatter.
* Cài dependency cần thiết cho project.
* Tạo/sửa/xóa file thuộc project theo yêu cầu.
* Chạy script phục vụ development.
* Kiểm tra log.
* Kiểm tra process/service phục vụ trực tiếp cho project.
* Git command trong repository hiện tại.
* Các thao tác filesystem cần thiết trong project.

Ví dụ:

```powershell
dir
Get-ChildItem
Get-Content
Select-String
git status
git diff
git log
python ...
npm ...
pip ...
npm install
npm run build
npm test
```

---

# 2. DATABASE SAFETY RULE

Agent **KHÔNG ĐƯỢC tự ý thực hiện bất kỳ command nào có khả năng trực tiếp thay đổi database hoặc dữ liệu SQL**.

Các thao tác sau phải được coi là **Database Modification Operation**:

```text
INSERT
UPDATE
DELETE
MERGE
TRUNCATE
DROP
ALTER
CREATE
EXEC
CALL
GRANT
REVOKE
```

và các thao tác tương đương thông qua:

* SQL script.
* Stored Procedure.
* Function.
* Migration.
* ORM.
* CLI tool.
* Python script.
* Node.js script.
* PowerShell script.
* Application API.
* Database management tool.
* Migration framework.

Không được giả định rằng một command là an toàn chỉ vì nó không chứa trực tiếp câu SQL.

---

# 3. DATABASE READ-ONLY

Agent có thể thực hiện các thao tác **read-only** để phục vụ việc phân tích/debug nếu cần thiết.

Ví dụ:

```sql
SELECT ...
```

hoặc các thao tác tương đương chỉ đọc metadata/schema.

Tuy nhiên, nếu command có khả năng gây side effect hoặc không chắc chắn là read-only thì **không được tự ý thực hiện**.

Khi không chắc chắn:

```text
STOP
↓
Ask user for confirmation
```

---

# 4. REQUIRED CONFIRMATION

Nếu nhiệm vụ yêu cầu agent thực hiện bất kỳ thao tác nào có khả năng:

* Thay đổi dữ liệu.
* Thay đổi schema.
* Tạo/sửa/xóa database object.
* Chạy migration.
* Execute procedure/function có thể gây side effect.
* Seed dữ liệu.
* Reset database.
* Xóa dữ liệu.
* Restore database.
* Backup/restore có khả năng ảnh hưởng môi trường.
* Thay đổi cấu hình database.
* Kill/terminate database session có thể ảnh hưởng user/process khác.

Agent **PHẢI DỪNG và hỏi user trước khi thực hiện**.

Không được tự suy luận rằng user đã cho phép chỉ vì thao tác đó cần thiết để hoàn thành task.

Format:

```text
Thao tác này cần thực hiện trực tiếp trên database và có thể làm thay đổi dữ liệu/schema.

Command dự kiến:
<command>

Mục đích:
<purpose>

Bạn có muốn tôi thực hiện không?
```

Chỉ tiếp tục sau khi user xác nhận rõ ràng.

---

# 5. KHÔNG ĐƯỢC LÁCH QUY TẮC

Agent không được chuyển một database modification operation sang một hình thức khác để tránh yêu cầu xác nhận.

Ví dụ không được:

```text
SQL trực tiếp
→ Python script
→ API call
→ PowerShell
→ ORM
→ application command
```

nếu kết quả cuối cùng vẫn là thay đổi database.

Agent phải đánh giá **side effect cuối cùng**, không chỉ kiểm tra syntax của command.

---

# 6. FILE SQL TRONG PROJECT

Agent được phép:

* Đọc SQL file.
* Phân tích SQL.
* Sửa SQL file.
* Tạo SQL migration/script.
* Viết procedure/function/view script vào source code.

miễn là chỉ thao tác trên **file trong project**.

Tuy nhiên:

> Việc tạo hoặc chỉnh sửa file SQL không đồng nghĩa với quyền execute file đó trên database.

Ví dụ được phép:

```text
Create:
scripts/update_customer.sql
```

Nhưng nếu muốn chạy:

```powershell
sqlcmd ... -i scripts/update_customer.sql
```

thì phải kiểm tra nội dung và yêu cầu user xác nhận nếu script có khả năng thay đổi database.

---

# 7. TERMINAL SCOPE

Agent phải ưu tiên đặt working directory tại **project root hiện tại**.

Không tự ý:

* Xóa thư mục ngoài project.
* Di chuyển file ngoài project.
* Sửa registry.
* Sửa system configuration.
* Cài phần mềm hệ thống.
* Thay đổi environment của toàn máy.
* Thay đổi service không thuộc project.
* Thao tác trên project khác.

Nếu nhiệm vụ bắt buộc phải thao tác ngoài project:

```text
STOP → Explain why → Ask user for confirmation
```

---

# 8. DESTRUCTIVE FILE OPERATIONS

Các thao tác filesystem destructive cũng phải được xem xét cẩn thận.

Đặc biệt:

```text
rm -rf
Remove-Item -Recurse -Force
del
rmdir
git reset --hard
git clean
```

Không được sử dụng nếu có nguy cơ làm mất source code hoặc dữ liệu người dùng mà chưa xác định rõ phạm vi.

Nếu command có khả năng làm mất dữ liệu ngoài phạm vi thay đổi cần thiết:

```text
STOP → Ask user
```

---

# 9. DEVELOPMENT COMMANDS

Agent được phép tự động chạy các command development thông thường trong project, ví dụ:

```text
install dependencies
build
compile
lint
format
unit test
integration test
start development server
stop development server
inspect logs
run local tooling
```

miễn là các command này không trực tiếp gây database modification hoặc destructive operation ngoài phạm vi project.

Nếu một development command có side effect tới database, áp dụng DATABASE SAFETY RULE.

---

# 10. COMMAND REVIEW

Trước khi thực thi một command, agent phải xác định:

```text
Command
  ↓
Target
  ↓
Side effect
  ↓
Database impact?
  ↓
Filesystem impact?
  ↓
Outside project?
```

Nếu:

```text
Database modification = YES
```

hoặc:

```text
Database impact = UNKNOWN
```

→ **Không tự thực thi. Hỏi user.**

Nếu:

```text
Database modification = NO
Project scope = YES
Side effect = Safe
```

→ Có thể tự thực thi.

---

# 11. PRIORITY

Các rule này có độ ưu tiên cao hơn việc cố gắng hoàn thành task bằng mọi giá.

Nếu không chắc chắn command có an toàn hay không:

> **Không đoán. Không thử. Không bypass. Hỏi user.**

Mục tiêu là:

```text
Agent có thể tự chủ động thao tác development
        +
Không tự ý thay đổi database
        +
Không thao tác ngoài project
        +
Không thực hiện destructive operation khi chưa được phép
```
