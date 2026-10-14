# Database IDE (SQL Server & PostgreSQL Desktop Client)

Ứng dụng Desktop quản lý cơ sở dữ liệu chuyên dụng cho **Microsoft SQL Server** và **PostgreSQL**, được xây dựng trên nền tảng **pywebview** (zero-network local desktop IPC), tích hợp trình soạn thảo Monaco Editor và kết xuất dữ liệu hiệu năng cao.

> **Môi trường Build chuẩn**: Python 3.14 (`cp314-win_amd64`).

---

## 1. Kiến trúc hệ thống (True Architecture)

Ứng dụng vận hành theo mô hình Desktop Native kết hợp giao diện Web hiện đại:

```text
[Frontend: Monaco Editor, AG Grid, Vanilla JS/CSS]
                     │
                     ▼ (pywebview IPC Bridge: window.pywebview.api)
              [MainApi / BravoApi (main.py)]
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
[app/services/*]          [Desktop Utilities]
  - QueryService            - Window Manager
  - ConnectionManager       - DWM Titlebar / Themes
  - TableDataEditorService  - Native Clipboard
  - TableDesignerService    - Excel/CSV Exporters
  - HistoryStorage
        │
        ▼
[app/database/* Adapters]
  - SQLServerAdapter (pyodbc)
  - PostgreSQLAdapter (psycopg v3 / psycopg2)
```

> **Lưu ý về Flask Routes (`app/routes/`)**: Các endpoint Flask là kênh phụ (secondary/fallback channel) được cấu hình cho tương thích web; luồng chạy chính của ứng dụng desktop sử dụng trực tiếp cầu nối IPC native của `pywebview`.

---

## 2. Cài đặt và Chạy thử (Development Setup)

### Yêu cầu tiên quyết
- Hệ điều hành: Windows 10/11
- Python 3.14 (khuyến nghị `cp314-win_amd64`)
- ODBC Driver for SQL Server (nếu kết nối MSSQL)

### Cài đặt môi trường
```powershell
# Tạo và kích hoạt môi trường ảo
python -m venv venv
.\venv\Scripts\Activate.ps1

# Cài đặt thư viện runtime
pip install -r requirements.txt

# Khởi chạy ứng dụng desktop
python run.py
```

---

## 3. Kiểm thử (Testing)

Cài đặt các gói công cụ phát triển và chạy test suite:

```powershell
# Cài đặt dev dependencies (bao gồm pytest)
pip install -r requirements-dev.txt

# Chạy toàn bộ test suite (bỏ qua scratch)
pytest tests/ --ignore=scratch

# Chạy bài kiểm thử lưới an toàn API snapshot
pytest tests/test_api_surface_snapshot.py
```

---

## 4. Đóng gói phân phối (Build & Packaging)

Đóng gói ứng dụng thành file thực thi độc lập (standalone executable) bằng PyInstaller:

```powershell
pyinstaller run.spec
```

Thành phẩm sẽ nằm trong thư mục `dist/`.

---

## 5. Cấu trúc thư mục chính

```text
IDE-SQL-Lite_New_Pyweb_Claude/
├── main.py                     # Entry point pywebview & MainApi/BravoApi
├── run.py                      # Trình khởi chạy desktop wrapper
├── run.spec                    # Cấu hình đóng gói PyInstaller
├── requirements.txt            # Thư viện runtime
├── requirements-dev.txt        # Thư viện kiểm thử và đóng gói
├── app/
│   ├── database/               # Database adapters (sqlserver, postgresql)
│   ├── services/               # Nghiệp vụ: query, metadata, editor, profiler, history
│   ├── models/                 # Mô hình dữ liệu phiên làm việc
│   ├── routes/                 # Tuyến Flask phụ (secondary HTTP)
│   └── utils/                  # Tiện ích mã hóa mật khẩu, an toàn SQL, DWM
├── data/                       # Dữ liệu cục bộ (cấu hình, snippets, lịch sử)
├── docs/                       # Tài liệu kiến trúc và kế hoạch refactor
│   ├── refactor/               # Báo cáo baseline và snapshot test
│   └── archive/                # Tài liệu lịch sử, mockup và bugs archive
├── static/                     # Tài nguyên frontend (CSS, JS, vendor)
├── templates/                  # Template HTML (cửa sổ chính và cửa sổ phụ)
├── tests/                      # Bộ kiểm thử tự động (pytest)
│   └── snapshots/              # Snapshot API surface làm lưới an toàn
└── .SKILL/                     # Tài liệu quy chuẩn agent và specs nghiệp vụ
```
