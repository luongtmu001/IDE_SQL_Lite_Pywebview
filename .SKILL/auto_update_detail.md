# LLTool – Kế hoạch Check for Update + License Management

## 1. Mục tiêu

Xây dựng hệ thống gồm hai chức năng độc lập nhưng cùng nằm trong lifecycle của LLTool:

1. **License Management**

   * User không có tài khoản.
   * Khi mở LLTool lần đầu, bắt buộc kích hoạt license.
   * User gửi thông tin cho developer.
   * Developer tạo License Key bằng Developer Tool.
   * Developer gửi License Key cho user.
   * User nhập key vào LLTool.
   * LLTool gọi License Server để xác thực.
   * Sau khi hợp lệ, lưu License Token cục bộ.
   * Những lần mở sau không yêu cầu nhập lại key nếu license vẫn hợp lệ.

2. **Check for Update**

   * LLTool kiểm tra phiên bản mới từ GitHub Releases.
   * So sánh version hiện tại với version mới nhất.
   * Hiển thị release notes cho user.
   * Cho phép user tải/cài bản cập nhật.
   * Không để logic update phụ thuộc vào license logic.

Hai hệ thống phải độc lập:

```text
LLTool
│
├── LicenseManager
│
├── UpdateManager
│
├── TelemetryManager
│
├── DataManager
│
└── AppVersion
```

---

# 2. Nguyên tắc kiến trúc

## 2.1. Không xây dựng Account System

LLTool không có:

* username
* password
* register
* login account
* profile online
* user account database

License không đại diện cho một tài khoản.

License chỉ đại diện cho quyền sử dụng LLTool.

---

# 3. Luồng License

## 3.1. Lần chạy đầu tiên

```text
LLTool.exe
    │
    ▼
Application Startup
    │
    ▼
LicenseManager
    │
    ├── Có license local?
    │       │
    │       ├── Không
    │       │    ↓
    │       │  License Screen
    │       │    ↓
    │       │  User nhập License Key
    │       │    ↓
    │       │  License Server
    │       │    ↓
    │       │  Valid?
    │       │   ├── No  → báo lỗi
    │       │   └── Yes
    │       │        ↓
    │       │    lưu License Token
    │       │        ↓
    │       │      mở IDE
    │       │
    │       └── Có
    │            ↓
    │        kiểm tra local license
    │            ↓
    │        còn hiệu lực?
    │          ├── Có → mở IDE
    │          └── Không → yêu cầu xử lý license
```

---

# 4. License Key

License Key được developer tạo thủ công bằng Developer Tool.

Ví dụ:

```text
LLT-2026-A7K9-XP2M-Q81F
```

License Key phải đủ ngẫu nhiên để không thể đoán bằng cách thử tuần tự.

Không sử dụng:

```text
LLT-001
LLT-002
LLT-003
```

---

# 5. Developer Tool

Developer Tool cần có module:

```text
Developer Tools
└── License Manager
```

Chức năng tối thiểu:

```text
Generate License
List Licenses
Disable License
Extend License
Reset Activation
Copy License Key
```

## 5.1. Generate License

UI đề xuất:

```text
┌──────────────────────────────────────┐
│ Generate License                     │
├──────────────────────────────────────┤
│ Expiration:   [ 30/09/2027 ]        │
│ Activations:  [ 1 ]                  │
│                                      │
│              [ Generate ]            │
└──────────────────────────────────────┘
```

Sau khi tạo:

```text
License Key:

LLT-X8F2-91KA-PQ73-MZ4C
```

Developer copy key và gửi cho user.

---

# 6. License Server

Không cần xây dựng hệ thống account.

Server chỉ cần quản lý license.

Ví dụ database:

```text
licenses
--------------------------------
id
license_key
status
created_at
expires_at
activation_limit
created_by
```

Có thể bổ sung:

```text
last_activated_at
last_seen_at
```

Nếu cần quản lý activation:

```text
license_activations
--------------------------------
id
license_id
installation_id
activated_at
last_seen_at
status
```

---

# 7. Installation ID

Mỗi installation của LLTool có một UUID riêng.

Ví dụ:

```text
550e8400-e29b-41d4-a716-446655440000
```

Installation ID:

* không phải username
* không phải Windows username
* không phải computer name
* không phải email
* không phải tài khoản người dùng

Mục đích duy nhất là nhận diện một installation để quản lý activation.

Ví dụ:

```text
License:
LLT-X8F2-91KA-PQ73-MZ4C

Activation:
Installation A
```

Nếu license chỉ cho phép một installation:

```text
activation_limit = 1
```

---

# 8. API License

## 8.1. Activate

Endpoint:

```text
POST /api/v1/license/activate
```

Request:

```json
{
    "license_key": "LLT-X8F2-91KA-PQ73-MZ4C",
    "installation_id": "550e8400-e29b-41d4-a716-446655440000",
    "app_version": "1.2.0"
}
```

Response thành công:

```json
{
    "success": true,
    "license_token": "...",
    "license_id": "...",
    "expires_at": "2027-09-30T23:59:59"
}
```

Response thất bại:

```json
{
    "success": false,
    "error_code": "INVALID_LICENSE",
    "message": "License key is invalid."
}
```

Các error code nên chuẩn hóa:

```text
INVALID_LICENSE
LICENSE_DISABLED
LICENSE_EXPIRED
ACTIVATION_LIMIT_REACHED
SERVER_ERROR
NETWORK_ERROR
```

---

# 9. Local License Storage

License local thuộc **User Data**, không thuộc System Data.

Đề xuất:

```text
data/
└── license.json
```

Ví dụ:

```json
{
    "license_token": "...",
    "license_id": "...",
    "installation_id": "550e8400-e29b-41d4-a716-446655440000",
    "activated_at": "2026-09-30T20:15:00",
    "expires_at": "2027-09-30T23:59:59"
}
```

Không nên lưu License Key plaintext nếu không cần.

---

# 10. License Token

Server nên trả về token đã được ký.

LLTool dùng token để xác nhận license.

Không nên chỉ lưu:

```json
{
    "licensed": true
}
```

vì user có thể dễ dàng sửa thành:

```json
{
    "licensed": true
}
```

Local license phải được bảo vệ bằng chữ ký/token có thể xác thực.

---

# 11. License Verification

Không nên phụ thuộc hoàn toàn vào local JSON.

Có hai lớp:

```text
Local Verification
        +
Server Verification
```

## Local Verification

Kiểm tra:

* token tồn tại
* token hợp lệ
* chữ ký hợp lệ
* expiration
* installation ID

## Server Verification

Định kỳ kiểm tra:

* license còn active?
* license có bị disable?
* license có bị thu hồi?
* activation còn hợp lệ?

---

# 12. Offline / Network Error

Không nên yêu cầu Internet mỗi lần mở IDE.

Không nên thiết kế:

```text
Mỗi lần mở LLTool
        ↓
Internet
        ↓
License Server
        ↓
OK mới chạy
```

Thay vào đó:

```text
First Launch
    ↓
Online Activation
    ↓
Local License Token
    ↓
LLTool hoạt động bình thường
```

Sau đó có thể kiểm tra server định kỳ.

Ví dụ:

```text
License check interval:
7 ngày
```

Nếu server không truy cập được:

```text
Server unavailable
       ↓
License local vẫn hợp lệ?
       ↓
Có
       ↓
Cho phép sử dụng
```

Có thể sử dụng grace period.

Ví dụ:

```text
Last successful check:
01/09/2026

Grace period:
14 days

Current:
05/09/2026

→ Cho phép sử dụng
```

Không được biến lỗi mạng thành lỗi license ngay lập tức.

---

# 13. License Expired

Nếu license hết hạn:

```text
┌────────────────────────────────────────┐
│ License Expired                        │
├────────────────────────────────────────┤
│ Your LLTool license has expired.       │
│                                        │
│ Please contact the developer to       │
│ renew your license.                    │
│                                        │
│              [ Close ]                 │
└────────────────────────────────────────┘
```

Không cần account login.

---

# 14. Activation UI

Màn hình đầu tiên:

```text
┌────────────────────────────────────────┐
│              LLTool                    │
│                                        │
│          License Activation             │
│                                        │
│ License Key                            │
│ ┌────────────────────────────────────┐ │
│ │ LLT-____-____-____-____             │ │
│ └────────────────────────────────────┘ │
│                                        │
│              [ Activate ]              │
│                                        │
│ Don't have a license?                  │
│ Contact the developer.                 │
└────────────────────────────────────────┘
```

Sau khi activation thành công:

```text
License activated successfully.
```

Sau đó chuyển sang IDE.

---

# 15. Application Startup

License phải được kiểm tra trước khi khởi tạo các thành phần nặng của IDE nếu có thể.

Ưu tiên:

```text
Application Start
      ↓
Load minimal configuration
      ↓
LicenseManager
      ↓
License OK
      ↓
Initialize IDE
      ↓
Main Window
```

Không nên:

```text
Application Start
      ↓
Initialize toàn bộ IDE
      ↓
Load editors
      ↓
Connect services
      ↓
Render UI
      ↓
Check License
```

Điều này vừa tốn thời gian vừa cho phép application chạy trước khi license được xác nhận.

---

# 16. Check for Update

License và Update phải là hai module độc lập.

```text
LicenseManager
    │
    └── License lifecycle

UpdateManager
    │
    └── Application update lifecycle
```

Không làm:

```text
UpdateManager.check()
    └── check license
```

và cũng không làm:

```text
LicenseManager.activate()
    └── check update
```

---

# 17. Version Management

Chỉ có một nguồn version duy nhất.

Ví dụ:

```text
app/version.py
```

```python
APP_VERSION = "1.2.0"
```

Các thành phần khác đọc version từ đây.

Không hard-code:

```text
1.2.0
```

ở nhiều file.

Version được sử dụng bởi:

```text
About
Check for Update
Telemetry
License Activation
Migration
Build
GitHub Release
```

---

# 18. Semantic Versioning

Sử dụng:

```text
MAJOR.MINOR.PATCH
```

Ví dụ:

```text
1.0.0
1.1.0
1.1.1
2.0.0
```

Quy ước:

### PATCH

Bug fix:

```text
1.1.0 → 1.1.1
```

### MINOR

Feature mới nhưng không phá compatibility:

```text
1.1.0 → 1.2.0
```

### MAJOR

Thay đổi lớn/breaking change:

```text
1.2.0 → 2.0.0
```

---

# 19. GitHub Releases

GitHub Releases là nguồn chính cho update.

Mỗi release:

```text
v1.2.0
```

Release body:

```markdown
## New

- Added PostgreSQL IntelliSense improvements.
- Added XML editor improvements.

## Fixed

- Fixed result grid rendering issue.
- Fixed connection persistence issue.

## Performance

- Improved result grid rendering for large datasets.

## Internal

- Refactored IntelliSense architecture.

## Migration

- No migration required.
```

---

# 20. CHANGELOG.md

Repository vẫn có:

```text
CHANGELOG.md
```

Mục đích:

* developer
* agent
* documentation
* lịch sử development

GitHub Release dùng cho:

* end user
* Check for Update
* release notes

Không cần duplicate logic giữa hai hệ thống.

---

# 21. Update API / GitHub

UpdateManager lấy release mới nhất từ GitHub.

Flow:

```text
Current Version
      ↓
GitHub Latest Release
      ↓
Parse Version
      ↓
Compare
      ↓
New version?
 ├── No → Up to date
 └── Yes
       ↓
Display Release Notes
       ↓
User chooses update
```

Ví dụ:

```text
Current version: 1.2.0
Latest version:  1.3.0
```

UI:

```text
┌────────────────────────────────────────┐
│ Update Available                       │
├────────────────────────────────────────┤
│ Current: 1.2.0                         │
│ Latest:  1.3.0                         │
│                                        │
│ What's new                             │
│                                        │
│ • Improved IntelliSense                │
│ • Faster result grid                   │
│ • Fixed connection issues              │
│                                        │
│       [Update]       [Later]           │
└────────────────────────────────────────┘
```

---

# 22. Update không được xóa User Data

Đây là yêu cầu bắt buộc.

Ví dụ:

```text
LLTool/
├── LLTool.exe
├── _internal/
├── static/
└── data/
    ├── settings.json
    ├── programlist.json
    ├── snippets.json
    └── license.json
```

Update được phép thay:

```text
LLTool.exe
_internal/
static/
```

Nhưng phải giữ:

```text
data/
```

Đặc biệt:

```text
data/license.json
```

không được xóa trong quá trình update.

---

# 23. Developer Release Workflow

Mỗi release thực hiện:

```text
1. Update APP_VERSION
        ↓
2. Update CHANGELOG.md
        ↓
3. Test
        ↓
4. Build PyInstaller
        ↓
5. Test executable
        ↓
6. Test License
        ↓
7. Test Update
        ↓
8. Create GitHub Release
        ↓
9. Upload installer/build
```

Ví dụ:

```text
APP_VERSION = "1.3.0"

GitHub Release:
v1.3.0
```

Phải luôn đồng nhất.

---

# 24. License + Update Lifecycle

Toàn bộ lifecycle:

```text
                 LLTool
                    │
                    ▼
              Startup Check
                    │
            ┌───────┴────────┐
            │                │
            ▼                ▼
      LicenseManager    Basic Startup
            │
       License valid?
        ┌───┴───┐
        │       │
       No      Yes
        │       │
        ▼       ▼
   Activation  Initialize IDE
        │       │
        │       ▼
        │   UpdateManager
        │       │
        │   Check GitHub
        │       │
        │   New version?
        │       │
        │      Yes
        │       │
        │       ▼
        │   Show Update
        │
        ▼
   License Server
```

---

# 25. Telemetry

Telemetry là module riêng.

Không sử dụng telemetry để xác thực license.

Không sử dụng license system để thu thập dữ liệu sử dụng.

Nếu cần anonymous telemetry:

```json
{
    "installation_id": "...",
    "app_version": "1.3.0",
    "event": "startup",
    "os": "Windows",
    "arch": "x64"
}
```

Không gửi:

```text
SQL query
Database password
Database name
Database host
Connection string
File content
Snippet content
Windows username
Personal files
```

---

# 26. Privacy Setting

Nên có:

```text
Settings
└── Privacy
      └── Anonymous usage statistics
```

Ví dụ:

```text
[ ] Send anonymous usage statistics
```

License activation và anonymous telemetry phải là hai setting khác nhau.

---

# 27. Data Path

Theo kiến trúc System Data / User Data hiện tại:

```text
static/data/
    └── system data

data/
    ├── settings.json
    ├── programlist.json
    ├── snippets.json
    └── license.json
```

`license.json` là User Data.

Không đưa license vào:

```text
static/data/
```

Không package license của developer vào release.

---

# 28. Data Path Manager

Không hard-code đường dẫn license trong nhiều nơi.

Có API tập trung:

```python
get_user_data_dir()
get_license_path()
get_settings_path()
get_programlist_path()
get_user_snippets_path()
```

Ví dụ:

```python
license_path = data_manager.get_license_path()
```

Không:

```python
open("data/license.json")
```

ở nhiều module.

---

# 29. Module Structure đề xuất

Có thể tổ chức:

```text
app/
├── version.py
├── license/
│   ├── license_manager.py
│   ├── license_client.py
│   ├── license_storage.py
│   └── license_models.py
│
├── update/
│   ├── update_manager.py
│   ├── update_client.py
│   ├── version_compare.py
│   └── update_models.py
│
└── telemetry/
    ├── telemetry_manager.py
    └── telemetry_client.py
```

Tên thư mục có thể điều chỉnh theo cấu trúc hiện tại của project.

**Không được tạo lại kiến trúc project lớn nếu project hiện tại đã có module tương đương.**

Ưu tiên:

> Reuse → Refactor → Add missing module → Avoid duplication.

---

# 30. Developer License Tool

Developer Tool có thể là một module riêng:

```text
developer/
└── license/
    ├── license_generator.py
    ├── license_manager.py
    └── license_api.py
```

Developer Tool không được đưa secret/private signing key vào bản LLTool phát cho user.

Đây là yêu cầu bảo mật quan trọng.

---

# 31. Signing Key

Nếu sử dụng signed license token:

```text
Developer
   │
   ├── Private Key
   │
   └── License Generator
```

User LLTool chỉ chứa:

```text
Public Key
```

Không bao giờ đóng gói:

```text
Private Key
```

vào:

```text
LLTool.exe
```

Nếu private key bị đưa vào client thì user có thể trích xuất nó và tự tạo license.

---

# 32. Không tin tưởng Local Clock tuyệt đối

License có expiration date.

Không nên chỉ kiểm tra:

```python
datetime.now() < expires_at
```

vì user có thể chỉnh Windows clock.

Server verification nên được sử dụng để giảm vấn đề này.

Có thể lưu:

```text
last_server_check
last_server_time
```

và phát hiện clock rollback bất thường.

Không cần triển khai quá phức tạp ở phiên bản đầu tiên.

---

# 33. Phases triển khai

## Phase 1 – Version Manager

* Tạo single source of truth.
* Chuẩn hóa `APP_VERSION`.
* Thay các hard-code version hiện tại.
* Kiểm tra version trong About/build/update.

**Không sửa UI không liên quan.**

---

## Phase 2 – Update Manager

* Tạo UpdateManager.
* Đọc GitHub Releases.
* Parse version.
* Compare version.
* Lấy release notes.
* Hiển thị update.
* Không tự động cài nếu user chưa chọn.

---

## Phase 3 – License Data Model

Xây dựng model:

```text
LicenseInfo
```

Bao gồm tối thiểu:

```text
license_id
installation_id
activated_at
expires_at
license_token
```

---

## Phase 4 – Installation ID

* Generate UUID lần đầu.
* Lưu trong User Data.
* Không regenerate mỗi lần chạy.
* Không dùng thông tin cá nhân để tạo ID.

---

## Phase 5 – License Storage

Tạo:

```text
data/license.json
```

Có:

* read
* write
* clear
* validate local token

Sử dụng atomic write.

---

## Phase 6 – License Client

Implement:

```text
activate()
verify()
```

Có timeout.

Có xử lý:

```text
network error
server error
invalid key
expired
disabled
activation limit
```

---

## Phase 7 – First Launch License Gate

Startup:

```text
License Check
      ↓
Valid → IDE
Invalid/Missing → Activation Screen
```

Không khởi tạo toàn bộ IDE trước khi license được xử lý nếu có thể.

---

## Phase 8 – Developer License Generator

Implement:

```text
Generate
List
Disable
Extend
Reset Activation
```

Nếu developer tool chưa cần đầy đủ UI thì có thể bắt đầu bằng CLI/internal tool.

---

## Phase 9 – License Server

Implement:

```text
POST /api/v1/license/activate
```

Sau đó:

```text
POST /api/v1/license/verify
```

Server phải validate:

* key
* status
* expiration
* activation limit
* installation

---

## Phase 10 – Offline Grace Period

Implement:

```text
last_successful_verification
```

Cho phép chạy trong grace period nếu server tạm thời không khả dụng.

---

## Phase 11 – Telemetry

Chỉ triển khai sau khi License + Update hoạt động ổn định.

Telemetry độc lập với license.

---

## Phase 12 – Update Integration

Kiểm tra:

```text
License
↓
IDE
↓
Update Check
```

Không để update phá license data.

---

## Phase 13 – PyInstaller

Test:

```text
python run.py
```

và:

```text
LLTool.exe
```

Kiểm tra:

* license path
* installation ID
* update
* user data
* system data
* executable restart

---

## Phase 14 – Update Simulation

Test:

### Version 1

```text
LLTool 1.0.0
license.json
settings.json
```

Update:

```text
1.0.0 → 1.1.0
```

Sau update phải còn:

```text
license.json
settings.json
```

---

# 34. Test Cases bắt buộc

## License

* [ ] First launch không có license.
* [ ] Nhập key hợp lệ.
* [ ] Nhập key sai.
* [ ] Key hết hạn.
* [ ] Key bị disable.
* [ ] Activation limit reached.
* [ ] Network timeout.
* [ ] Server unavailable.
* [ ] Restart application.
* [ ] License vẫn hoạt động.
* [ ] Xóa license local.
* [ ] Activate lại.

## Update

* [ ] Không có version mới.
* [ ] Có PATCH mới.
* [ ] Có MINOR mới.
* [ ] Có MAJOR mới.
* [ ] GitHub unavailable.
* [ ] Invalid release response.
* [ ] User chọn Later.
* [ ] User chọn Update.

## Update + User Data

* [ ] `settings.json` không mất.
* [ ] `programlist.json` không mất.
* [ ] `snippets.json` không mất.
* [ ] `license.json` không mất.
* [ ] System data được cập nhật.

---

# 35. Các lỗi cần tránh

## Không làm

```text
License = Account
```

## Không làm

```text
Mỗi startup bắt buộc gọi server
```

## Không làm

```text
Private signing key nằm trong LLTool.exe
```

## Không làm

```text
Update xóa toàn bộ data/
```

## Không làm

```text
License key hard-code trong source
```

## Không làm

```text
Version được khai báo ở 5-10 file khác nhau
```

## Không làm

```text
Telemetry dùng để quyết định license
```

## Không làm

```text
License system phụ thuộc GitHub
```

---

# 36. Mục tiêu kiến trúc cuối cùng

```text
                         LLTool
                           │
             ┌─────────────┼─────────────┐
             │             │             │
             ▼             ▼             ▼
       LicenseManager  UpdateManager  Telemetry
             │             │             │
             ▼             ▼             ▼
       License Server   GitHub        Telemetry API
             │
             ▼
       License Database
```

Local:

```text
LLTool/
├── LLTool.exe
├── _internal/
├── static/
│   └── data/
│       └── system data
│
└── data/
    ├── settings.json
    ├── programlist.json
    ├── snippets.json
    └── license.json
```

---

# 37. Thứ tự ưu tiên triển khai

Agent phải thực hiện theo thứ tự:

```text
1. Audit existing version/update code
2. Version Manager
3. Update Manager
4. License data model
5. Installation ID
6. License storage
7. License Client
8. First Launch License Gate
9. License Server
10. Developer License Generator
11. Local/Server verification
12. Offline grace period
13. Telemetry
14. PyInstaller integration
15. Update simulation
16. Regression test
```

Sau mỗi phase phải:

1. Kiểm tra code hiện tại.
2. Xác định file cần sửa.
3. Chỉ sửa phần cần thiết.
4. Không thay đổi UI không liên quan.
5. Chạy test.
6. Xác nhận phase hoàn thành.
7. Sau đó mới chuyển phase tiếp theo.

---

# 38. Definition of Done

Hệ thống được coi là hoàn thành khi:

* [ ] User mở LLTool lần đầu phải activate license.
* [ ] Không có account/password.
* [ ] Developer có thể tạo license key.
* [ ] User có thể nhập key.
* [ ] Server xác thực key.
* [ ] License token được lưu local.
* [ ] Restart không yêu cầu nhập lại key.
* [ ] License hết hạn được xử lý.
* [ ] License
