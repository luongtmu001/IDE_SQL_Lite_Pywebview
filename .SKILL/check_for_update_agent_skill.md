# Skill: Implement Check for Update & Release Packaging

## 1. Mục tiêu

Xây dựng chức năng **Check for Update** cho IDE hiện tại, sử dụng
**GitHub làm kênh phân phối phiên bản**.

Agent phải thiết kế hệ thống theo nguyên tắc:

``` text
Source Project
      │
      ├── Development files
      │       └── KHÔNG đưa vào bản phát hành
      │
      └── Release Package
              │
              ├── Build
              ├── Package
              ├── Verify
              └── GitHub Release
                         │
                         ▼
                    IDE Update Manager
```

**Không được coi toàn bộ thư mục project hiện tại là nội dung cần
update.**

Project có nhiều file/thư mục chỉ phục vụ development, debug, AI skill,
backup, virtual environment, test hoặc artifact build. Bản update phải
được tạo từ một **release staging directory** có danh sách file rõ ràng.

------------------------------------------------------------------------

# 2. Cấu trúc project hiện tại

Project hiện có các thành phần chính tương tự:

``` text
project/
├── .backup_fixes/
├── .example/
├── .git/
├── .pytest_cache/
├── .SKILL/
├── __pycache__/
├── _concept/
├── app/
├── build/
├── data/
├── dist/
├── frontend/
├── OUTPUT/
├── scratch/
├── settings/
├── static/
├── templates/
├── tests/
├── venv/
│
├── .env
├── .env.example
├── .gitignore
├── config.py
├── dump.json
├── IDE-SQL-Lite_New.code-workspace
├── logo.ico
├── main.py
├── README.md
├── requirements.txt
├── run.py
├── run.spec
├── scratch_format.txt
└── version.json
```

Đây chỉ là **source/development tree**.

Agent MUST NOT package toàn bộ tree này.

------------------------------------------------------------------------

# 3. Nguyên tắc phân loại file

Trước khi implement update, agent phải tạo một bảng phân loại file.

Mỗi file/thư mục phải thuộc một trong các nhóm:

``` text
SOURCE
RUNTIME
RELEASE
DEVELOPMENT_ONLY
GENERATED
USER_DATA
SECRET
OPTIONAL
UNKNOWN
```

Nếu chưa xác định được một thư mục có phải runtime hay development hay
không:

> KHÔNG tự động đưa vào release.

Phải kiểm tra import/reference/runtime usage trước.

------------------------------------------------------------------------

# 4. Phân loại ban đầu

Đây là phân loại định hướng. Agent phải kiểm tra code thực tế trước khi
chốt.

## 4.1. Development-only

Các thư mục sau mặc định KHÔNG được đưa vào release:

``` text
.git/
.backup_fixes/
.pytest_cache/
__pycache__/
.SKILL/
_concept/
scratch/
venv/
tests/
build/
OUTPUT/
```

Lý do:

-   Git metadata
-   backup/debug
-   pytest cache
-   Python bytecode cache
-   AI skill/specification
-   concept/design
-   scratch files
-   development virtual environment
-   test source
-   build artifact/intermediate files
-   output/debug artifact

Không được copy các thư mục này vào update package trừ khi có yêu cầu
release cụ thể.

------------------------------------------------------------------------

# 5. Các thư mục cần kiểm tra trước khi package

## app/

Có khả năng là source code runtime chính.

Agent phải kiểm tra:

-   main imports
-   package imports
-   runtime dependencies
-   file path references
-   dynamic imports
-   plugin loading

Nếu `app/` là runtime source thì đưa vào release.

------------------------------------------------------------------------

## frontend/

Có khả năng là source frontend/build source.

Agent phải kiểm tra xem application runtime có đọc trực tiếp thư mục này
hay không.

Có hai trường hợp:

``` text
frontend/
   │
   ├── chỉ dùng để build
   │       └── DEVELOPMENT_ONLY
   │
   └── runtime đọc trực tiếp
           └── RUNTIME
```

Không được giả định.

------------------------------------------------------------------------

## static/

Nếu backend/webview runtime đọc trực tiếp:

``` text
static/
```

thì đây là runtime asset và phải được đưa vào release.

Ví dụ:

``` text
static/
├── css/
├── js/
├── assets/
└── ...
```

------------------------------------------------------------------------

## templates/

Nếu Flask/web backend/runtime sử dụng trực tiếp thì phải package.

------------------------------------------------------------------------

## settings/

Phải kiểm tra mục đích.

Nếu chứa:

``` text
default settings
UI configuration
runtime configuration schema
```

thì có thể là RUNTIME.

Nếu chứa:

``` text
development configuration
design concepts
AI instructions
```

thì không package.

Đặc biệt phải phân biệt:

``` text
application default settings
```

với:

``` text
user settings
```

User settings KHÔNG được ghi đè trong quá trình update.

------------------------------------------------------------------------

## data/

Đây là thư mục cần đặc biệt cẩn thận.

Không được mặc định overwrite toàn bộ `data/`.

Phân loại:

``` text
data/
├── application default data
├── bundled static data
├── cache
├── database
├── user data
└── generated data
```

Nguyên tắc:

``` text
Bundled static data
    → có thể update

User data
    → KHÔNG overwrite

Database
    → phải có migration

Cache
    → không package / có thể rebuild

Generated data
    → không package
```

Nếu `data/` chứa database của người dùng, update tuyệt đối không được
replace database chỉ vì update application.

------------------------------------------------------------------------

# 6. File root

Agent phải kiểm tra từng file.

## .env

``` text
KHÔNG PACKAGE
```

Đây có thể chứa:

-   password
-   token
-   API key
-   local path
-   machine-specific configuration

Không được đưa `.env` vào GitHub Release.

------------------------------------------------------------------------

## .env.example

Có thể package hoặc để trong source repository.

Nếu release cần cấu hình mẫu:

``` text
.env.example
```

có thể được đưa vào package.

Nhưng phải đảm bảo:

-   không có secret thật
-   không có token
-   không có password
-   không có private endpoint không cần thiết

------------------------------------------------------------------------

## config.py

Nếu là runtime source thì package.

Nhưng agent phải kiểm tra:

-   có hard-code secret không
-   có developer-only path không
-   có machine-specific path không

Không package nếu file này chứa secret hoặc development-only
configuration.

------------------------------------------------------------------------

## dump.json

Mặc định:

``` text
DEVELOPMENT_ONLY
```

Chỉ package nếu chứng minh đây là runtime data bắt buộc.

------------------------------------------------------------------------

## IDE-SQL-Lite_New.code-workspace

``` text
DEVELOPMENT_ONLY
```

Không package.

------------------------------------------------------------------------

## logo.ico

Nếu executable/runtime cần logo:

``` text
RELEASE
```

Nếu chỉ phục vụ development:

``` text
DEVELOPMENT_ONLY
```

------------------------------------------------------------------------

## main.py

Nếu đây là entry point runtime:

``` text
RELEASE
```

------------------------------------------------------------------------

## run.py

Nếu là runtime launcher:

``` text
RELEASE
```

Nếu chỉ dùng để chạy development server:

``` text
DEVELOPMENT_ONLY
```

Agent phải kiểm tra cách build executable trước khi quyết định.

------------------------------------------------------------------------

## README.md

Thông thường không cần thiết cho runtime.

Có thể:

``` text
SOURCE_ONLY
```

hoặc đưa vào release nếu muốn user có documentation.

------------------------------------------------------------------------

## requirements.txt

Không nhất thiết phải đưa vào runtime package nếu application đã được
đóng gói thành executable.

Nếu release sử dụng Python environment trực tiếp thì có thể cần.

Agent phải xác định deployment model trước:

``` text
Python source deployment
```

hay:

``` text
PyInstaller/executable deployment
```

Không được tự động package `venv/`.

------------------------------------------------------------------------

## run.spec

Nếu dùng PyInstaller để build:

``` text
DEVELOPMENT / BUILD CONFIG
```

Không nhất thiết package cho user.

------------------------------------------------------------------------

## version.json

Nên giữ lại và chuẩn hóa.

Đây có thể là nguồn version của application:

``` json
{
  "version": "1.0.0",
  "channel": "stable"
}
```

Không được có nhiều nguồn version mâu thuẫn.

------------------------------------------------------------------------

# 7. Tuyệt đối không package

Release package không được chứa:

``` text
.git/
.backup_fixes/
.pytest_cache/
__pycache__/
.SKILL/
_concept/
scratch/
venv/
tests/
.env
```

Ngoài ra phải kiểm tra:

``` text
*.log
*.tmp
*.bak
*.pyc
*.pyo
*.coverage
```

và các file chứa:

``` text
password
token
secret
API key
private key
certificate private key
machine-specific credentials
```

------------------------------------------------------------------------

# 8. Release Staging Directory

Không build release trực tiếp từ root project.

Tạo staging:

``` text
release/
└── staging/
    └── IDE/
```

Ví dụ:

``` text
release/
├── staging/
│   └── IDE/
├── packages/
├── manifests/
└── checksums/
```

Flow:

``` text
Project
   │
   ▼
Release Builder
   │
   ▼
release/staging/IDE
   │
   ▼
Validation
   │
   ▼
ZIP / Installer
```

------------------------------------------------------------------------

# 9. Release manifest

Tạo manifest cho update.

Ví dụ:

``` json
{
  "version": "1.2.0",
  "channel": "stable",
  "release_date": "2026-09-29",
  "minimum_version": "1.0.0",
  "mandatory": false,
  "package": {
    "name": "IDE-SQL-Lite-1.2.0.zip",
    "size": 52428800,
    "sha256": "..."
  },
  "release_notes": "https://github.com/OWNER/REPOSITORY/releases/tag/v1.2.0"
}
```

Không hard-code GitHub URL rải rác trong frontend.

URL phải được cấu hình tập trung.

------------------------------------------------------------------------

# 10. Version comparison

Không được so sánh version bằng string đơn giản.

Sai:

``` python
"1.10.0" > "1.9.0"
```

Phải parse:

``` text
MAJOR.MINOR.PATCH
```

Ví dụ:

``` text
1.9.0
1.10.0
```

kết quả phải đúng theo semantic version.

------------------------------------------------------------------------

# 11. Update Manager

Tạo module độc lập.

Đề xuất:

``` text
app/
└── update/
    ├── __init__.py
    ├── manager.py
    ├── checker.py
    ├── manifest.py
    ├── downloader.py
    ├── verifier.py
    └── state.py
```

Nếu project hiện tại có architecture khác, giữ architecture hiện tại và
chỉ bổ sung module tương đương.

Không refactor lớn chỉ để phục vụ update.

------------------------------------------------------------------------

# 12. Update flow

Flow chuẩn:

``` text
User
 │
 ▼
Check for Updates
 │
 ▼
Update Manager
 │
 ▼
Fetch manifest from GitHub
 │
 ▼
Validate manifest
 │
 ▼
Compare versions
 │
 ├── Up-to-date
 │
 └── New version
          │
          ▼
     Show release info
          │
          ▼
        Download
          │
          ▼
      SHA-256 verify
          │
          ▼
       Start updater
          │
          ▼
      Close application
          │
          ▼
       Backup current
          │
          ▼
       Install update
          │
          ▼
       Start application
```

------------------------------------------------------------------------

# 13. Không để IDE tự ghi đè chính nó

Nếu IDE đang chạy từ:

``` text
MyIDE.exe
```

không nên để chính process này overwrite file executable đang chạy.

Nên có:

``` text
MyIDE.exe
MyIDEUpdater.exe
```

Flow:

``` text
MyIDE.exe
    │
    ▼
MyIDEUpdater.exe
    │
    ▼
MyIDE.exe closes
    │
    ▼
Updater installs
    │
    ▼
MyIDE.exe starts again
```

Updater phải nhỏ, độc lập và có khả năng hoạt động khi IDE đã đóng.

------------------------------------------------------------------------

# 14. Backup trước update

Trước khi overwrite runtime:

``` text
backup/
└── 1.1.0/
```

Chỉ backup các file runtime cần thiết.

Không backup:

``` text
.git
venv
tests
.SKILL
_concept
scratch
```

Nếu update thất bại:

``` text
restore backup
```

------------------------------------------------------------------------

# 15. User data phải được bảo vệ

Update application và update user data là hai nghiệp vụ khác nhau.

Không được làm:

``` text
Update
  ↓
delete application folder
  ↓
copy new folder
```

nếu application folder có chứa:

``` text
database
user settings
workspace
connection profiles
saved queries
logs
user-created files
```

Phải phân tách:

``` text
Application Files
+
User Data
```

Ví dụ:

``` text
Application/
    IDE.exe
    app/
    static/
    templates/

UserData/
    settings/
    workspace/
    database/
```

Nếu hiện tại project chưa phân tách được, agent phải xác định chính xác
file nào là user data trước khi triển khai installer/update.

------------------------------------------------------------------------

# 16. GitHub Release

GitHub nên chứa:

``` text
Release v1.2.0
│
├── IDE-SQL-Lite-1.2.0.zip
├── IDE-SQL-Lite-1.2.0.sha256
└── release notes
```

Manifest có thể nằm tại:

``` text
update/stable.json
```

hoặc được publish cùng release.

Khuyến nghị giữ một URL manifest ổn định:

``` text
.../update/stable.json
```

IDE không nên phải biết trước từng version.

------------------------------------------------------------------------

# 17. GitHub Actions

Sau khi update system hoạt động, xây dựng pipeline:

``` text
git tag v1.2.0
       │
       ▼
GitHub Actions
       │
       ├── install dependencies
       ├── run tests
       ├── build application
       ├── create release staging
       ├── validate package
       ├── create ZIP/installer
       ├── calculate SHA-256
       ├── create GitHub Release
       └── publish/update manifest
```

Không được để package release phụ thuộc vào máy developer cụ thể nếu có
thể tránh.

------------------------------------------------------------------------

# 18. Release Package Validation

Trước khi upload GitHub, script phải kiểm tra:

``` text
[ ] Application starts
[ ] Main executable exists
[ ] Required Python/runtime files exist
[ ] static exists if required
[ ] templates exists if required
[ ] required assets exist
[ ] version is correct
[ ] no .env
[ ] no .git
[ ] no venv
[ ] no __pycache__
[ ] no .pyc
[ ] no secrets
[ ] no development-only folders
[ ] SHA-256 generated
```

Có thể tạo:

``` text
scripts/
└── validate_release.py
```

------------------------------------------------------------------------

# 19. Auto Check

Không được request GitHub mỗi lần application startup.

Đề xuất:

``` text
Settings:
☑ Automatically check for updates
```

Có cache:

``` json
{
  "last_check": "...",
  "last_known_version": "1.2.0"
}
```

Ví dụ policy:

``` text
Startup
  │
  ├── last check < 6h
  │       └── skip
  │
  └── >= 6h
          └── check GitHub
```

Nếu GitHub không truy cập được:

``` text
Application vẫn phải chạy bình thường.
```

Update check không được trở thành single point of failure của IDE.

------------------------------------------------------------------------

# 20. UI

Trong Settings thêm:

``` text
Updates

Current version
1.2.0

Channel
[ Stable ]

[ Check for Updates ]

☑ Automatically check for updates

Last checked
29/09/2026 20:30
```

Khi có update:

``` text
Update Available

Current version: 1.1.0
New version:     1.2.0

Release notes:
...

Size:
52 MB

[ Later ] [ Update Now ]
```

UI chỉ gọi backend/update manager.

Không để JavaScript trực tiếp thực hiện:

``` text
GitHub API
download
SHA-256
file replacement
```

------------------------------------------------------------------------

# 21. Stable / Beta Channel

Thiết kế từ đầu để có:

``` text
stable
beta
```

Ví dụ:

``` text
update/
├── stable.json
└── beta.json
```

User settings:

``` text
Update Channel
[ Stable ▼ ]
```

Không cần implement Beta ngay nếu chưa cần, nhưng architecture không
được khóa cứng vào Stable.

------------------------------------------------------------------------

# 22. Mandatory Update

Manifest hỗ trợ:

``` json
{
  "version": "2.0.0",
  "mandatory": true,
  "minimum_version": "1.5.0"
}
```

Nếu:

``` text
current < minimum_version
```

thì UI có thể yêu cầu update trước khi tiếp tục.

Tuy nhiên phải phân biệt:

``` text
new version available
```

và:

``` text
current version no longer supported
```

Không dùng `mandatory` chỉ vì có bản mới.

------------------------------------------------------------------------

# 23. Security

Tối thiểu:

``` text
HTTPS
+
SHA-256
```

Tốt hơn:

``` text
HTTPS
+
SHA-256
+
Digital Signature
```

Agent phải thiết kế verifier độc lập để sau này có thể chuyển từ:

``` text
SHA-256
```

sang:

``` text
Digital Signature
```

mà không thay đổi Update Manager quá nhiều.

------------------------------------------------------------------------

# 24. Những điều KHÔNG được làm

Agent không được:

1.  Package toàn bộ project.
2.  Copy `venv/` vào release.
3.  Copy `.git/`.
4.  Copy `.env`.
5.  Copy `.SKILL/`.
6.  Copy `_concept/`.
7.  Copy backup/debug files.
8.  Overwrite user database.
9.  Overwrite user settings.
10. Tự động xóa toàn bộ application directory trước update.
11. Để frontend tự xử lý GitHub download.
12. So sánh version bằng string.
13. Cho GitHub downtime làm IDE không khởi động.
14. Hard-code từng version vào source code.
15. Xác định file release chỉ dựa vào tên thư mục.
16. Tự ý refactor architecture lớn ngoài phạm vi update system.

------------------------------------------------------------------------

# 25. Thứ tự triển khai

Agent phải triển khai theo thứ tự:

## Step 1 --- Audit

Phân tích project:

``` text
imports
runtime paths
entry point
build system
PyInstaller spec
user data
settings
database
assets
```

Output:

``` text
release file classification
```

------------------------------------------------------------------------

## Step 2 --- Define release boundary

Tạo danh sách:

``` text
RELEASE_INCLUDE
RELEASE_EXCLUDE
USER_DATA
DEVELOPMENT_ONLY
```

Không được tiếp tục package trước khi boundary rõ ràng.

------------------------------------------------------------------------

## Step 3 --- Version system

Chuẩn hóa:

``` text
version.json
```

và đảm bảo application đọc version từ một nguồn duy nhất.

------------------------------------------------------------------------

## Step 4 --- Manifest

Implement:

``` text
stable.json
```

------------------------------------------------------------------------

## Step 5 --- Check for Update

Implement:

``` text
check
compare
display
```

Chưa cần auto-install ngay.

------------------------------------------------------------------------

## Step 6 --- Download

Implement:

``` text
download
progress
cancel
retry
```

------------------------------------------------------------------------

## Step 7 --- Verify

Implement:

``` text
SHA-256
```

------------------------------------------------------------------------

## Step 8 --- Updater

Implement:

``` text
MyIDEUpdater.exe
```

hoặc updater tương đương với deployment model hiện tại.

------------------------------------------------------------------------

## Step 9 --- Backup / Rollback

Implement:

``` text
backup
install
rollback
```

------------------------------------------------------------------------

## Step 10 --- Release Builder

Tạo staging và package release:

``` text
project
   ↓
release staging
   ↓
validate
   ↓
package
   ↓
checksum
```

------------------------------------------------------------------------

## Step 11 --- GitHub Actions

Tự động hóa build/release.

------------------------------------------------------------------------

## Step 12 --- End-to-end test

Test ít nhất:

``` text
1. Current version = latest
2. New version available
3. GitHub unavailable
4. Manifest invalid
5. Download interrupted
6. SHA-256 mismatch
7. Update succeeds
8. Update fails
9. Rollback succeeds
10. User data remains intact
11. Application restarts successfully
```

------------------------------------------------------------------------

# 26. Deliverables

Sau khi hoàn thành phải có:

``` text
Update Manager
Release Manifest
Release Builder
Release Validator
Updater
Backup/Rollback
GitHub Release workflow
Settings UI
Check for Update UI
Documentation
```

Và tối thiểu có:

``` text
docs/
└── update_system.md
```

mô tả:

-   release architecture
-   versioning
-   package boundary
-   GitHub manifest
-   update flow
-   rollback
-   user data policy
-   troubleshooting

------------------------------------------------------------------------

# 27. Tiêu chí hoàn thành

Chức năng chỉ được xem là hoàn thành khi:

``` text
[✓] IDE biết version hiện tại
[✓] Check GitHub manifest
[✓] Detect version mới
[✓] Hiển thị release notes
[✓] Download package
[✓] Verify checksum
[✓] Không package development files
[✓] Không overwrite user data
[✓] Có updater độc lập
[✓] Có backup
[✓] Có rollback
[✓] GitHub Release hoạt động
[✓] IDE vẫn chạy khi GitHub unavailable
[✓] Release package được build reproducibly
[✓] Không chứa secret
```

------------------------------------------------------------------------

# 28. Quy tắc quan trọng nhất cho Agent

**Không được bắt đầu bằng việc viết code Update Manager.**

Trước tiên phải:

``` text
AUDIT PROJECT
      ↓
IDENTIFY RUNTIME FILES
      ↓
IDENTIFY USER DATA
      ↓
IDENTIFY DEVELOPMENT FILES
      ↓
DEFINE RELEASE BOUNDARY
      ↓
THEN IMPLEMENT UPDATE
```

Nếu chưa xác định được một file/thư mục thuộc runtime hay development:

``` text
STOP
→ inspect references/imports/build configuration
→ xác định mục đích
→ sau đó mới đưa ra quyết định package
```

Mục tiêu cuối cùng không phải là:

``` text
"copy project → zip → upload GitHub"
```

mà là:

``` text
SOURCE PROJECT
      ↓
CONTROLLED RELEASE BUILD
      ↓
VALIDATED PACKAGE
      ↓
SIGNED / VERIFIED PACKAGE
      ↓
GITHUB RELEASE
      ↓
SAFE UPDATE
      ↓
ROLLBACK IF FAILED
```
