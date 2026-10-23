# Kế hoạch kỹ thuật: Database Users Explorer cho LLTool / IDE SQL Lite

- **Phiên bản:** 1.0
- **Ngày:** 2026-10-21
- **Phạm vi DBMS:** Microsoft SQL Server và PostgreSQL
- **Mục tiêu:** Bổ sung danh sách user/role theo connection, context menu sinh script CREATE/DROP và màn hình tra cứu quyền.
- **Nguyên tắc:** Mở rộng kiến trúc hiện có; không viết lại Object Explorer, Connection Manager, Tab Manager hoặc SQL execution pipeline.

---

## 1. Mục tiêu và phạm vi

### 1.1. Chức năng cần có

1. Hiển thị user/role phù hợp với DBMS và phạm vi đang chọn.
2. Refresh danh sách.
3. Context menu cho user/role:
   - Script as CREATE.
   - Script as DROP.
   - View Permissions.
   - Copy Name.
   - Properties (nếu mô hình metadata hiện có hỗ trợ).
4. Mở script trong tab Monaco Editor hiện tại.
5. Hiển thị quyền trong tab riêng, tận dụng Result Grid và cơ chế tab hiện có.
6. Hỗ trợ SQL Server và PostgreSQL qua provider riêng.
7. Hiển thị lỗi quyền metadata một cách có kiểm soát.
8. Không thực thi CREATE/DROP tự động.

### 1.2. Phạm vi MVP

- Explorer node.
- Danh sách user/role.
- CREATE/DROP script cơ bản.
- Overview, Role Membership, Database Permissions và Object Permissions.
- Quyền trực tiếp được truy vấn phải phân biệt với quyền qua role/membership.
- Refresh và xử lý lỗi.
- Kiểm thử trên database thử nghiệm.

### 1.3. Ngoài phạm vi MVP

- Thực thi DROP trực tiếp từ context menu.
- Tự động tạo lại mọi dependency/ownership của một principal.
- Khôi phục mật khẩu hoặc xuất mật khẩu plaintext.
- Cam kết tính toán chính xác mọi effective permission trong mọi phiên bản và mọi cấu hình.
- Quản lý đầy đủ server login/role và mọi thuộc tính bảo mật nâng cao nếu chưa có UI/phạm vi riêng.
- Thay đổi Connection Manager hoặc SQL execution pipeline hiện tại.

---

## 2. Quyết định kiến trúc

### 2.1. Cách hiển thị theo DBMS

**SQL Server**
- Node `Users` nằm dưới từng database.
- User thuộc database được lấy theo database context đang chọn.
- Server `Logins` là phạm vi riêng; không gộp Login với Database User.
- Trong MVP, chỉ đọc Login mapping để hỗ trợ thông tin/script; không cần xây dựng toàn bộ Login Explorer nếu chưa được duyệt.

**PostgreSQL**
- Role thuộc phạm vi cluster, không thuộc riêng một database.
- Hiển thị node `Roles` ở cấp connection.
- Khi chọn role và mở Permissions, cho phép xem quyền trên database hiện tại; nếu có lựa chọn database trong UI hiện tại thì giữ nguyên cơ chế lựa chọn đó.
- Phân biệt role có `LOGIN` và role `NOLOGIN`; không gọi mọi role là user đăng nhập.

### 2.2. Lựa chọn mặc định

| Hạng mục | Quyết định |
|---|---|
| Vị trí Explorer | SQL Server Users theo database; PostgreSQL Roles theo connection |
| CREATE script | Có chế độ Basic và Full/Selected Permissions nếu dữ liệu hỗ trợ |
| Permission viewer | Direct permissions + role membership + quyền hiệu lực có giới hạn/ghi rõ nguồn |
| DROP | Chỉ sinh script trong MVP, không tự thực thi |
| UI | Tận dụng tab, Monaco, grid và context menu hiện tại |
| Tổ chức code | Tách provider/service/generator; không dồn vào `main.py` |
| CSS/JS | File riêng theo quy ước dự án, không inline mới vào HTML |

### 2.3. Nguyên tắc về quyền hiệu lực

Không suy luận rằng principal không có quyền chỉ vì không có GRANT trực tiếp trong catalog. Quyền có thể đến từ role membership, ownership, quyền công khai, quyền hệ thống hoặc quy tắc riêng của engine. UI phải phân biệt:
- `Direct`: quyền gán trực tiếp cho principal.
- `Inherited / Via Role`: quyền đến qua role/membership, nếu provider có thể xác định.
- `Effective`: chỉ hiển thị khi có cách kiểm tra phù hợp và nêu rõ phạm vi kiểm tra.
- `Unknown / Not visible`: metadata không đủ để kết luận.

---

## 3. Kiến trúc đề xuất

Tên file dưới đây là **đề xuất**, phải đối chiếu với cấu trúc repo trước khi tạo mới. Ưu tiên tái sử dụng module tương đương đã tồn tại.

```text
LLTool/
├── main.py                         # Không thêm business logic mới vào đây
├── [backend hiện có]/
│   ├── database_users/             # Tên thư mục đề xuất; điều chỉnh theo kiến trúc thực
│   │   ├── __init__.py
│   │   ├── models.py               # DTO/kiểu dữ liệu chuẩn hóa
│   │   ├── service.py              # Điều phối provider theo DBMS
│   │   ├── sqlserver_provider.py   # Metadata SQL Server
│   │   ├── postgres_provider.py    # Metadata PostgreSQL
│   │   ├── permissions.py          # Chuẩn hóa kết quả permission
│   │   ├── script_generator.py    # Điều phối sinh script
│   │   ├── sqlserver_scripts.py    # CREATE/DROP cho SQL Server
│   │   └── postgres_scripts.py     # CREATE/DROP cho PostgreSQL
│   └── [API/router hiện có]/
│       └── database_users_routes.py # Chỉ tạo nếu dự án có cấu trúc route tương ứng
├── static/
│   ├── js/
│   │   └── [module Object Explorer hiện có]
│   └── css/
│       └── [stylesheet module hiện có]
└── tests/
    └── database_users/
        ├── test_models.py
        ├── test_sqlserver_scripts.py
        ├── test_postgres_scripts.py
        ├── test_permissions.py
        └── test_api.py
```

Không tạo các thư mục/file này một cách máy móc. Trước khi triển khai:
1. Xác định backend framework/router hiện tại.
2. Tìm nơi đăng ký API và cách gọi API từ JavaScript.
3. Tìm implementation Object Explorer, context menu, tab manager và mở Monaco tab.
4. Tìm cơ chế phân biệt SQL Server/PostgreSQL trong connection object.
5. Tái sử dụng chuẩn log, error handling, naming và test hiện tại.

### 3.1. Luồng dữ liệu

```text
Object Explorer
  -> chọn connection/database + node Users/Roles
  -> API hiện có
  -> DatabaseUsersService
  -> SqlServerProvider hoặc PostgreSqlProvider
  -> metadata DTO chuẩn hóa
  -> UI tree/grid

Context menu CREATE/DROP
  -> yêu cầu script
  -> Script Generator theo DBMS
  -> mở tab Monaco (không execute)

Context menu View Permissions
  -> Permission Service/Provider
  -> trả về các nhóm quyền + nguồn quyền + metadata visibility
  -> mở tab Permissions hiện có
  -> hiển thị bằng grid/tabs
```

### 3.2. DTO chuẩn hóa đề xuất

**PrincipalSummary**
- `engine`: `sqlserver` hoặc `postgresql`
- `scope_type`: `database` hoặc `cluster`
- `scope_name`
- `name`
- `principal_type`
- `can_login` (nullable nếu không áp dụng/không biết)
- `authentication_type` (nullable)
- `login_name` (nullable)
- `default_schema` (nullable)
- `is_system` (boolean)
- `metadata_visibility`: `complete`, `partial`, `unknown`
- `capabilities`: danh sách tính năng có thể truy vấn

**PermissionEntry**
- `principal_name`
- `scope_type`
- `scope_name`
- `object_type` (nullable)
- `schema_name` (nullable)
- `object_name` (nullable)
- `permission_name`
- `state`: `GRANT`, `DENY`, `GRANT_WITH_OPTION`, `OTHER`
- `source`: `DIRECT`, `ROLE`, `OWNERSHIP`, `EFFECTIVE`, `UNKNOWN`
- `grantor` (nullable)
- `is_complete` (boolean)
- `warning` (nullable)

Không dùng một DTO chuẩn hóa để xóa khác biệt ngữ nghĩa giữa hai engine. Giữ trường gốc/metadata khi cần thiết.

---

## 4. Giao diện và hành vi

### 4.1. Object Explorer

**SQL Server**
```text
Connection
└── Databases
    └── <Database>
        └── Security
            └── Users
                ├── <database user>
                └── ...
```

Nếu cấu trúc Explorer hiện tại không có `Security`, có thể đặt `Users` dưới database theo quy ước node hiện có. Không tái cấu trúc các node khác trong phạm vi tính năng này.

**PostgreSQL**
```text
Connection
└── Roles
    ├── <role có LOGIN>
    ├── <role NOLOGIN>
    └── ...
```

Có thể phân nhóm role có `LOGIN` và `NOLOGIN` nếu cây hiện tại hỗ trợ nhóm node; MVP không bắt buộc.

### 4.2. Context menu

```text
Refresh
----------------------------
Script User/Role As >
  CREATE
  DROP
----------------------------
View Permissions
Properties
Copy Name
```

Các action mở rộng có thể thêm sau:
- Generate GRANT Script.
- Generate REVOKE Script.
- Generate Full Script.

Chỉ hiển thị action phù hợp với DBMS và loại principal. Ví dụ, không sinh cú pháp `CREATE USER ... FOR LOGIN` cho SQL Server user không ánh xạ login.

### 4.3. Permissions tab

Các tab:
1. **Overview** — loại principal, scope, login mapping/default schema/role attributes.
2. **Role Membership** — role membership và thuộc tính membership có thể đọc được.
3. **Database Permissions** — quyền ở phạm vi database.
4. **Object Permissions** — quyền theo schema/object.
5. **Effective Permissions** — giai đoạn sau hoặc chỉ hiển thị khi có cơ chế kiểm tra đáng tin cậy.

Yêu cầu UX:
- Có loading, empty state và error state.
- Cho biết database/scope đang xem.
- Phân biệt không có quyền với không đủ quyền đọc metadata.
- Không hiển thị dữ liệu minh họa trong môi trường thật.
- Dùng grid/tabs hiện có; không tạo grid framework mới nếu không cần.

---

## 5. Thiết kế provider SQL Server

### 5.1. Danh sách database user

Có thể bắt đầu từ `sys.database_principals`, nhưng phải xác định bộ lọc loại principal theo yêu cầu và phiên bản SQL Server. Không hard-code một bộ lọc mà vô tình loại bỏ loại user cần hiển thị.

Các trường nên cân nhắc:
- `name`
- `type_desc`
- `authentication_type_desc`
- `default_schema_name`
- `create_date`
- `modify_date`
- `principal_id`
- login mapping nếu tra cứu được từ catalog phù hợp

Ví dụ truy vấn tham khảo, cần được kiểm chứng trên phiên bản hỗ trợ:

```sql
SELECT
    dp.principal_id,
    dp.name AS UserName,
    dp.type_desc AS UserType,
    dp.authentication_type_desc AS AuthenticationType,
    dp.default_schema_name AS DefaultSchema,
    dp.create_date AS CreateDate,
    dp.modify_date AS ModifyDate
FROM sys.database_principals AS dp
WHERE dp.principal_id > 4
ORDER BY dp.name;
```

Đây là truy vấn nền để thử nghiệm, **không mặc định là truy vấn production cuối cùng**. Bộ lọc system principal và loại principal cần chốt sau khi xác định phạm vi hỗ trợ.

### 5.2. Role membership

Dùng `sys.database_role_members` kết hợp `sys.database_principals` để lấy role và thành viên. Không chỉ hiển thị fixed database roles; phải hỗ trợ database role do người dùng tạo.

### 5.3. Permissions

Dùng `sys.database_permissions` kết hợp catalog principal và object/schema tương ứng. Cần:
- Biểu diễn `GRANT`, `DENY`, `GRANT_WITH_GRANT_OPTION`.
- Giữ nguyên class/scope của permission.
- Phân biệt permission ở database, schema, object và các securable class khác.
- Không bỏ qua quyền qua role membership.
- Cân nhắc `public`, ownership và quyền hệ thống khi mô tả effective permission.

### 5.4. CREATE script

Script generator phải xử lý tối thiểu:
- User ánh xạ login.
- Contained database user.
- User không ánh xạ login hoặc loại principal đặc biệt.
- Default schema.
- Membership và quyền khi chọn chế độ Full/Selected.
- Các loại principal chưa hỗ trợ phải báo rõ, không sinh script giả định.

Không mặc định mọi database user đều có một server login tương ứng.

### 5.5. DROP script

Sinh `DROP USER` trong database context đúng. Có thể thêm `USE [database]` và `GO` theo quy ước script hiện tại của IDE.

Không tự động xóa schema/object do user sở hữu. Nếu phát hiện ownership/dependency có thể khiến DROP thất bại, hiển thị cảnh báo và/hoặc cung cấp thông tin dependency nếu provider có thể truy vấn.

---

## 6. Thiết kế provider PostgreSQL

### 6.1. Danh sách roles

Dùng `pg_roles` hoặc catalog phù hợp với phiên bản. Các trường thường cần:
- `rolname`
- `rolsuper`
- `rolinherit`
- `rolcreaterole`
- `rolcreatedb`
- `rolcanlogin`
- `rolreplication`
- `rolconnlimit`
- `rolbypassrls`

Ví dụ truy vấn tham khảo:

```sql
SELECT
    rolname AS RoleName,
    rolsuper AS IsSuperuser,
    rolinherit AS InheritPrivileges,
    rolcreaterole AS CanCreateRole,
    rolcreatedb AS CanCreateDatabase,
    rolcanlogin AS CanLogin,
    rolreplication AS CanReplicate,
    rolconnlimit AS ConnectionLimit,
    rolbypassrls AS BypassRLS
FROM pg_roles
ORDER BY rolname;
```

Phải kiểm tra phiên bản server trước khi dùng các cột có thể không tồn tại ở phiên bản cũ.

### 6.2. Role membership

Dùng `pg_auth_members` và catalog liên quan. Kiểm tra sự khác nhau giữa các phiên bản PostgreSQL về thuộc tính membership, bao gồm các tùy chọn như inherit/set/admin option nếu phiên bản hỗ trợ.

### 6.3. Permissions

Kết hợp catalog/hàm phù hợp, có thể bao gồm:
- `pg_database`
- `pg_namespace`
- `pg_class`
- `pg_auth_members`
- ACL catalog và hàm kiểm tra quyền
- `information_schema` khi thích hợp

Phải kiểm tra các phạm vi:
- Database CONNECT/TEMPORARY/CREATE.
- Schema USAGE/CREATE.
- Table/view/sequence privileges.
- Function/procedure privileges.
- Role membership và thuộc tính kế thừa.
- Ownership và default privileges nếu đưa vào phạm vi.

Không dùng riêng `information_schema` để kết luận toàn bộ quyền. Phải lưu ý ACL có thể có quyền mặc định, quyền thông qua role và khác biệt cách hiển thị giữa catalog.

### 6.4. CREATE ROLE script

Sinh các thuộc tính có thể đọc được:
- `LOGIN`/`NOLOGIN`
- `SUPERUSER`/`NOSUPERUSER`
- `CREATEDB`/`NOCREATEDB`
- `CREATEROLE`/`NOCREATEROLE`
- `INHERIT`/`NOINHERIT` theo phiên bản/ngữ nghĩa
- `REPLICATION`/`NOREPLICATION`
- `BYPASSRLS`/`NOBYPASSRLS`
- `CONNECTION LIMIT`
- Membership và quyền khi người dùng chọn script đầy đủ

Không xuất mật khẩu plaintext hoặc giả định có thể khôi phục mật khẩu. Nếu cần mật khẩu cho role mới, để người vận hành cấu hình riêng theo chính sách bảo mật.

### 6.5. DROP ROLE script

Sinh `DROP ROLE` và cảnh báo nếu role còn sở hữu object hoặc có dependency. Không tự động chạy `DROP OWNED`, `REASSIGN OWNED` hay lệnh cleanup khác. Những lệnh này có thể thay đổi quyền hoặc quyền sở hữu trên diện rộng và phải được xem xét riêng.

---

## 7. API backend đề xuất

Tên endpoint chỉ là ví dụ; phải theo quy ước router hiện có.

| Endpoint mẫu | Mục đích |
|---|---|
| `GET /api/database-users/list` | Lấy danh sách user/role |
| `GET /api/database-users/permissions` | Lấy permission theo principal và scope |
| `GET /api/database-users/memberships` | Lấy role membership |
| `POST /api/database-users/script` | Sinh CREATE/DROP script |
| `GET /api/database-users/properties` | Lấy metadata chi tiết |

### 7.1. Quy tắc API

- Không nhận connection string tùy ý từ UI nếu ứng dụng đã quản lý connection theo ID.
- Dùng connection ID và database/scope ID theo mô hình hiện có.
- Kiểm tra engine và scope ở backend; không tin hoàn toàn dữ liệu engine do client gửi.
- Dùng parameterized query cho giá trị dữ liệu.
- Identifier cần được quote theo DBMS; không ghép tên user chưa xử lý vào SQL.
- Trả lỗi có cấu trúc: mã lỗi, thông điệp an toàn, scope và khả năng retry.
- Không trả mật khẩu, token hoặc secret.
- Không ghi thông tin nhạy cảm vào log.
- Kiểm tra timeout/cancel nếu các API truy vấn metadata hiện tại hỗ trợ.

Ví dụ response lỗi:

```json
{
  "ok": false,
  "error_code": "METADATA_PERMISSION_DENIED",
  "message": "Không đủ quyền để đọc một phần metadata của principal.",
  "metadata_visibility": "partial"
}
```

---

## 8. Quy tắc sinh script

### 8.1. Hai chế độ

**Basic**
- Tạo principal và các thuộc tính cơ bản có thể tái tạo.
- Không tuyên bố script khôi phục toàn bộ quyền/ownership.

**Full/Selected**
- Có thể chọn role membership, database permissions và object permissions.
- Hiển thị các phần không thể tái tạo hoặc metadata không đủ.
- Không đưa secret vào script.
- Thứ tự script phải theo dependency, ví dụ tạo principal trước khi gán membership/quyền.

### 8.2. Identifier và quoting

- SQL Server: dùng cơ chế quote identifier phù hợp với SQL Server, chẳng hạn `QUOTENAME` ở phía truy vấn hoặc hàm quote tương đương trong generator.
- PostgreSQL: quote identifier theo quy tắc PostgreSQL, giữ đúng chữ hoa/chữ thường và ký tự đặc biệt.
- Không dùng cùng một hàm quote cho cả hai engine.
- Không nhầm identifier với literal string; literal phải được escape theo đúng ngữ cảnh.
- Test các tên có dấu cách, dấu ngoặc vuông, dấu nháy kép, Unicode và ký tự đặc biệt.

### 8.3. Header script

Theo quy ước hiện tại của LLTool nếu có:
- Engine.
- Connection/display name (không có secret).
- Database/scope.
- Principal name.
- Loại script.
- Thời điểm sinh script nếu chuẩn dự án có dùng.

---

## 9. An toàn và quyền hạn

1. MVP chỉ sinh script; không tự động thực thi CREATE/DROP.
2. Nếu sau này thêm Execute, phải có xác nhận riêng và hiển thị connection/database đích.
3. Không tự động cleanup ownership/dependency.
4. Không xuất mật khẩu hoặc secret.
5. Chỉ hiển thị metadata mà connection hiện tại có quyền quan sát.
6. Phân biệt “không có quyền” với “không đọc được metadata”.
7. Không cache permission vô thời hạn; Refresh phải lấy dữ liệu mới hoặc làm mất hiệu lực cache theo quy tắc hiện tại.
8. Tránh log đầy đủ SQL chứa dữ liệu nhạy cảm; script principal thông thường không nên chứa secret.
9. Không thay đổi connection đang hoạt động ngầm để truy vấn database khác mà không thông báo.
10. Mọi thao tác đều phải tôn trọng connection context và quyền DB hiện tại.

---

## 10. Tương thích và giới hạn

- Kiểm tra phiên bản SQL Server và PostgreSQL đang được LLTool hỗ trợ.
- Kiểm tra driver và cách lấy engine/connection context hiện tại.
- Không giả định mọi catalog/cột có mặt trên mọi phiên bản.
- Nếu provider không hỗ trợ một loại principal hoặc permission class, trả capability/warning thay vì lỗi chung hoặc dữ liệu sai.
- Không gọi “Effective Permissions” là đầy đủ nếu chỉ mới tổng hợp direct grants và role memberships.
- Tài khoản thiếu quyền có thể nhìn thấy ít metadata hơn; UI cần phản ánh tính không đầy đủ.

---

## 11. Kế hoạch triển khai theo thứ tự

### Phase 0 — Khảo sát code hiện tại

1. Xác định Object Explorer tree và cách đăng ký node.
2. Xác định context menu hiện tại.
3. Xác định backend API/router và chuẩn lỗi.
4. Xác định cách nhận biết SQL Server/PostgreSQL.
5. Xác định cách mở tab Monaco và render grid.
6. Tìm các helper quote identifier, query metadata, logging và cancellation.
7. Ghi lại file sẽ sửa và file sẽ tạo; nêu rõ impact scope trước khi chỉnh sửa.
8. Không sửa các module ngoài phạm vi khi chưa được duyệt.

**Deliverable:** Bản đồ file thực tế + danh sách thay đổi dự kiến.

### Phase 1 — DTO và provider danh sách

1. Tạo model/DTO chuẩn hóa.
2. Tạo service điều phối theo engine.
3. Tạo provider SQL Server.
4. Tạo provider PostgreSQL.
5. Xử lý system principals, `LOGIN`/`NOLOGIN`, scope và metadata visibility.
6. Viết unit test cho mapping DTO.

**Deliverable:** API/backend trả danh sách user/role đáng tin cậy.

### Phase 2 — Object Explorer và Refresh

1. Thêm node SQL Server Users dưới database theo quy ước cây hiện tại.
2. Thêm node PostgreSQL Roles ở cấp connection.
3. Thêm loading/empty/error state.
4. Thêm Refresh.
5. Đảm bảo refresh không nhân đôi node và không làm stale selection.
6. Kiểm thử đổi connection/database.

**Deliverable:** Danh sách hiển thị ổn định trong Explorer.

### Phase 3 — CREATE/DROP generator

1. Tạo generator riêng cho SQL Server.
2. Tạo generator riêng cho PostgreSQL.
3. Hỗ trợ Basic script trước.
4. Xử lý loại principal khác nhau.
5. Quote identifier đúng engine.
6. Thêm cảnh báo dependency/ownership khi có thể.
7. Mở script trong Monaco tab; không execute.
8. Viết test snapshot/expected output.

**Deliverable:** CREATE/DROP script đúng cú pháp trong phạm vi hỗ trợ.

### Phase 4 — Permission Viewer

1. Xây dựng role membership provider.
2. Xây dựng database permission provider.
3. Xây dựng object permission provider.
4. Chuẩn hóa state và source của permission.
5. Thêm tab Overview, Role Membership, Database Permissions, Object Permissions.
6. Ghi rõ metadata thiếu hoặc phạm vi chưa hỗ trợ.
7. Chỉ bổ sung Effective Permissions khi có cơ chế xác định đáng tin cậy.

**Deliverable:** Tra cứu quyền có nguồn gốc và cảnh báo rõ ràng.

### Phase 5 — Tích hợp context menu

1. Đăng ký action CREATE/DROP/View Permissions/Copy Name/Properties.
2. Chỉ hiển thị action hợp lệ theo engine và loại principal.
3. Giữ menu và style hiện có.
4. Kiểm tra thao tác với nhiều tab và nhiều connection.
5. Không làm thay đổi context menu của Tables/Views/Procedures.

**Deliverable:** Luồng sử dụng hoàn chỉnh từ Explorer.

### Phase 6 — Kiểm thử hồi quy và nghiệm thu

1. Chạy unit tests.
2. Chạy integration tests trên SQL Server test DB.
3. Chạy integration tests trên PostgreSQL test DB.
4. Kiểm thử connection thiếu quyền metadata.
5. Kiểm thử identifier đặc biệt.
6. Kiểm thử role membership nhiều cấp.
7. Kiểm thử principal sở hữu object/schema.
8. Kiểm thử refresh sau khi thay đổi user/role bên ngoài IDE.
9. Kiểm thử đổi database và đổi connection.
10. Xác nhận các module Explorer hiện tại vẫn hoạt động.
11. Kiểm tra log không chứa secret.
12. Cập nhật tài liệu và ghi rõ giới hạn đã biết.

---

## 12. Ma trận kiểm thử bắt buộc

| ID | Engine | Tình huống | Kết quả mong đợi |
|---|---|---|---|
| U-001 | SQL Server | Liệt kê user database | Danh sách đúng scope |
| U-002 | SQL Server | Login không có database user | Không tự tạo mapping giả |
| U-003 | SQL Server | Contained user | Sinh script theo loại xác thực |
| U-004 | SQL Server | Database role tự tạo | Membership được hiển thị |
| U-005 | SQL Server | Có GRANT và DENY | State được giữ nguyên |
| U-006 | PostgreSQL | Role có LOGIN | Được nhận diện đúng |
| U-007 | PostgreSQL | Role NOLOGIN | Không bị coi là user đăng nhập |
| U-008 | PostgreSQL | Membership có tùy chọn nâng cao | Hiển thị theo khả năng phiên bản |
| U-009 | PostgreSQL | Role còn sở hữu object | DROP chỉ sinh script và cảnh báo |
| U-010 | Cả hai | Thiếu quyền metadata | Thông báo partial/denied rõ ràng |
| U-011 | Cả hai | Identifier có ký tự đặc biệt | Script quote đúng |
| U-012 | Cả hai | Refresh sau thay đổi ngoài IDE | Dữ liệu được cập nhật |
| U-013 | Cả hai | Chuyển connection | Không hiển thị dữ liệu từ connection cũ |
| U-014 | Cả hai | View permissions | Phân biệt direct/via role khi xác định được |
| U-015 | Cả hai | CREATE/DROP menu | Chỉ mở editor, không tự thực thi |
| U-016 | Cả hai | Metadata không đủ | Không khẳng định permission đầy đủ |
| U-017 | Cả hai | Principal sở hữu dependency | Không tự động xóa dependency |
| U-018 | Cả hai | Regression Explorer | Node hiện tại khác không bị ảnh hưởng |

---

## 13. Tiêu chí nghiệm thu

Chỉ coi là hoàn thành khi:

- [ ] SQL Server có node Users đúng database scope.
- [ ] PostgreSQL có node Roles đúng cluster scope.
- [ ] Có Refresh và xử lý lỗi có kiểm soát.
- [ ] Context menu có CREATE, DROP, View Permissions, Copy Name.
- [ ] CREATE/DROP mở trong Monaco và không tự chạy.
- [ ] Script quote identifier đúng engine.
- [ ] Permission Viewer có Overview, Membership, Database và Object permissions.
- [ ] Phân biệt quyền trực tiếp với quyền qua role khi dữ liệu cho phép.
- [ ] Không khẳng định quyền hiệu lực đầy đủ khi metadata chưa đủ.
- [ ] Không xuất password/secret.
- [ ] Có cảnh báo dependency/ownership trước khi người dùng dùng DROP script.
- [ ] Có test cho cả SQL Server và PostgreSQL.
- [ ] Các chức năng Explorer hiện tại không bị hồi quy.
- [ ] Các file thay đổi và giới hạn đã biết được ghi lại.

---

## 14. Những rủi ro cần tránh

1. **Gộp Login và User của SQL Server:** dẫn tới CREATE script sai hoặc hiểu sai phạm vi quyền.
2. **Coi PostgreSQL role là database user:** dẫn tới mô hình Explorer sai và lặp role ở mỗi database.
3. **Chỉ đọc GRANT trực tiếp:** có thể kết luận sai về quyền thông qua membership/ownership.
4. **Sinh script CREATE quá đơn giản:** principal được tạo nhưng thiếu membership, quyền hoặc thuộc tính.
5. **DROP không kiểm tra ownership:** script có thể thất bại hoặc dẫn tới thao tác cleanup nguy hiểm nếu mở rộng không kiểm soát.
6. **Ẩn lỗi metadata:** làm người dùng tưởng danh sách/quyền là đầy đủ.
7. **Dồn logic vào `main.py`:** tăng coupling và rủi ro ảnh hưởng module khác.
8. **Thay đổi UI ngoài phạm vi:** vi phạm yêu cầu giữ nguyên cấu trúc LLTool hiện có.
9. **Giả định cùng phiên bản DBMS:** catalog và thuộc tính có thể khác nhau theo phiên bản.
10. **Tự động thực thi script:** tăng rủi ro vận hành không cần thiết cho chức năng ban đầu.

---

## 15. Chỉ dẫn cho người triển khai / AI coding agent

Trước khi sửa code, bắt buộc:

1. Đọc cấu trúc repo và tìm implementation tương ứng; không đoán tên file thực tế.
2. Xuất danh sách file sẽ tạo/sửa và giải thích tác động của từng file.
3. Tìm cách hiện tại mở Monaco tab, thêm node Explorer, đăng ký context menu và gọi backend.
4. Dùng lại helper/kiến trúc sẵn có nếu phù hợp.
5. Không sửa `main.py` ngoài phần đăng ký cần thiết, và không đưa business logic vào đó.
6. Không xóa file syntax/extension hoặc module không liên quan.
7. Không đổi framework, grid hoặc tab architecture trong phạm vi này.
8. Mỗi phase phải có kiểm thử trước khi chuyển phase tiếp theo.
9. Nếu phát hiện cần thay đổi ngoài phạm vi, dừng và báo impact + lý do để được duyệt.
10. Báo cáo cuối gồm: file tạo/sửa, API thêm, test đã chạy, kết quả trên từng DBMS, hạn chế còn lại.

## 16. Kết luận

Triển khai theo thứ tự **khảo sát code → provider/DTO → Explorer → CREATE/DROP → Permission Viewer → context menu → regression test**. Giữ provider riêng cho SQL Server và PostgreSQL, còn UI dùng DTO chung có trường thể hiện scope, nguồn quyền và mức độ đầy đủ của metadata. Cách này giảm coupling, tránh nhầm lẫn giữa SQL Server Login/User và PostgreSQL Role, đồng thời cho phép mở rộng GRANT/REVOKE và script đầy đủ sau MVP.
