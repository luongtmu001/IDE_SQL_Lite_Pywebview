# Phương Án Triển Khai Auto-Update Cho Ứng Dụng Pywebview Bằng GitHub Releases

Tài liệu này cung cấp kiến trúc, quy trình chi tiết và toàn bộ mã nguồn mẫu để xây dựng hệ thống tự động kiểm tra, tải về và cập nhật phiên bản mới cho ứng dụng máy tính viết bằng **Python (pywebview)** sử dụng hạ tầng lưu trữ **GitHub Releases**.

---

## 1. Tổng Quan Kiến Trúc & Luồng Hoạt Động

### 1.1. Luồng xử lý (Workflow)

```
+-------------------------------------------------------------------+
|                        1. Ứng dụng pywebview                      |
|                                                                   |
|   +-------------------+    Gọi kiểm tra     +-----------------+   |
|   |  Giao diện Web    | ------------------> | UpdateManager   |   |
|   |  (HTML/CSS/JS)    | <------------------ | (Python Bridge) |   |
|   +-------------------+  Báo có bản mới     +--------+--------+   |
|             |                                        |            |
|             | Nhấn "Cập nhật"                        |            |
|             +----------------------------------------+            |
|                                                      |            |
|                                 Tải file .exe        v            |
|                                                  GitHub API       |
|                                                  (Releases)       |
+------------------------------------------------------+------------+
                                                       |
                                                       v
                                            Lưu vào thư mục tạm (%TEMP%)
                                                       |
                                                       v
+------------------------------------------------------+------------+
| 2. Kích hoạt Updater Script (apply_update.bat)                    |
|    - App pywebview tự đóng tiến trình (sys.exit)                   |
|    - Script chờ tiến trình cũ giải phóng File Lock                |
|    - Script ghi đè file .exe mới vào vị trí cũ                    |
|    - Khởi động lại ứng dụng mới                                   |
|    - Tự xóa file script tạm                                       |
+-------------------------------------------------------------------+
```

### 1.2. Thách thức cốt lõi: Windows File Locking
Trên hệ điều hành Windows, một file thực thi (`.exe`) đang chạy sẽ bị khóa hoàn toàn quyền ghi (`Write-lock`). Ứng dụng không thể tự ghi đè lên chính nó. 

**Giải pháp:** 
Sử dụng một tiến trình trung gian chạy nền độc lập (Batch script hoặc process phụ) chờ ứng dụng chính thoát hoàn toàn, sau đó thực hiện lệnh di chuyển (`move /y`) và khởi động lại.

---

## 2. Cấu Trúc Thư Mục Dự Án

```text
my-pywebview-app/
├── .github/
│   └── workflows/
│       └── release.yml        # CI/CD tự động build và upload release
├── app/
│   ├── static/
│   │   ├── index.html         # Giao diện ứng dụng
│   │   ├── style.css
│   │   └── app.js
│   ├── __init__.py
│   ├── updater.py             # Module quản lý tải & cập nhật
│   └── api.py                 # JS-API bridge cho pywebview
├── main.py                    # Entry point khởi chạy pywebview
├── requirements.txt           # Danh sách thư viện phụ thuộc
└── README.md
```

---

## 3. Triển Khai Mã Nguồn Chi Tiết

### 3.1. Cài đặt các thư viện cần thiết

Tạo file `requirements.txt`:
```text
pywebview>=5.0.0
requests>=2.31.0
packaging>=24.0
pyinstaller>=6.0.0
```

Cài đặt bằng lệnh:
```bash
pip install -r requirements.txt
```

---

### 3.2. Module xử lý cập nhật: `app/updater.py`

Module này chịu trách nhiệm:
1. Gửi request đến GitHub Releases API để lấy metadata phiên bản mới nhất.
2. So sánh phiên bản bằng chuẩn SemVer (`packaging.version`).
3. Tải file nhị phân theo từng chunk kèm callback tiến độ (%).
4. Sinh file batch script chuyển tiếp để vượt qua khóa file trên Windows.

```python
import os
import sys
import tempfile
import subprocess
import requests
from packaging import version

CURRENT_VERSION = "1.0.0"
GITHUB_REPO = "your-username/your-repo-name"  # Đổi thành repo của bạn


class UpdateManager:
    def __init__(self, current_version=CURRENT_VERSION, repo=GITHUB_REPO):
        self.current_version = current_version
        self.repo = repo
        self.api_url = f"https://api.github.com/repos/{repo}/releases/latest"

    def check_for_update(self):
        """
        Kiểm tra bản cập nhật mới nhất từ GitHub Releases API.
        Trả về dictionary chứa thông tin cập nhật hoặc thông báo lỗi.
        """
        try:
            headers = {"User-Agent": "PyWebview-UpdateManager"}
            response = requests.get(self.api_url, headers=headers, timeout=10)

            if response.status_code == 404:
                return {"has_update": False, "message": "Chưa có bản Release nào được tạo."}
            if response.status_code != 200:
                return {"has_update": False, "error": f"GitHub API trả về lỗi HTTP {response.status_code}"}

            data = response.json()
            tag_name = data.get("tag_name", "").lstrip("v")
            release_notes = data.get("body", "Không có ghi chú phiên bản.")

            # Tìm file binary phù hợp trong danh sách Assets
            download_url = None
            asset_name = None
            for asset in data.get("assets", []):
                # Nhận diện file thực thi cho Windows
                if asset["name"].endswith(".exe"):
                    download_url = asset["browser_download_url"]
                    asset_name = asset["name"]
                    break

            if not download_url:
                return {
                    "has_update": False,
                    "message": "Không tìm thấy file cài đặt (.exe) trong bản phát hành mới nhất."
                }

            # So sánh semantic version
            if version.parse(tag_name) > version.parse(self.current_version):
                return {
                    "has_update": True,
                    "latest_version": tag_name,
                    "current_version": self.current_version,
                    "notes": release_notes,
                    "download_url": download_url,
                    "asset_name": asset_name
                }

            return {"has_update": False, "message": "Ứng dụng đang ở phiên bản mới nhất."}

        except Exception as e:
            return {"has_update": False, "error": f"Lỗi kết nối: {str(e)}"}

    def download_and_install(self, download_url, progress_callback=None):
        """
        Tải file cập nhật về %TEMP% và chạy script hoán đổi file.
        """
        temp_dir = tempfile.gettempdir()
        temp_exe_path = os.path.join(temp_dir, "app_new_version.exe")

        try:
            # Tải file theo chunk để hiển thị progress
            res = requests.get(download_url, stream=True, timeout=30)
            res.raise_for_status()
            total_size = int(res.headers.get("content-length", 0))
            downloaded = 0

            with open(temp_exe_path, "wb") as f:
                for chunk in res.iter_content(chunk_size=65536):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if progress_callback and total_size > 0:
                            percent = int((downloaded / total_size) * 100)
                            progress_callback(percent)

            # Nếu chạy trong môi trường dev (chưa compile PyInstaller)
            if not getattr(sys, "frozen", False):
                print(f"[Dev-Mode] File đã được tải về tại: {temp_exe_path}")
                print("[Dev-Mode] Bỏ qua bước ghi đè do đang chạy trực tiếp từ mã nguồn .py.")
                return True

            # Kích hoạt script thay thế trên Windows
            current_exe = os.path.abspath(sys.executable)
            self._apply_update_windows(current_exe, temp_exe_path)
            return True

        except Exception as e:
            if progress_callback:
                progress_callback(-1, str(e))
            return False

    def _apply_update_windows(self, current_exe, new_exe):
        """
        Sinh file .bat thực thi ngoài luồng để đợi app đóng, ghi đè file và khởi động lại.
        """
        current_pid = os.getpid()
        bat_file = os.path.join(tempfile.gettempdir(), "perform_pywebview_update.bat")

        # Nội dung script batch
        bat_content = f"""@echo off
setlocal
echo Dang doi ung dung pywebview thoat hoan toan...

:wait_loop
tasklist /fi "PID eq {current_pid}" | find "{current_pid}" > nul
if %ERRORLEVEL%==0 (
    timeout /t 1 /nobreak > nul
    goto wait_loop
)

echo Ghi de phien ban moi...
move /y "{new_exe}" "{current_exe}"

echo Khoi dong ung dung moi...
start "" "{current_exe}"

echo Don dep tep tam...
del "%~f0"
"""

        with open(bat_file, "w", encoding="utf-8") as f:
            f.write(bat_content)

        # Chạy batch script ở tiến trình detached không hiển thị cửa sổ CMD
        subprocess.Popen(
            ["cmd.exe", "/c", bat_file],
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS,
            close_fds=True
        )

        # Thoát ứng dụng lập tức để giải phóng khóa file
        sys.exit(0)
```

---

### 3.3. Cầu nối API Python - Javascript: `app/api.py`

```python
import threading
from app.updater import UpdateManager, CURRENT_VERSION


class AppBridgeAPI:
    def __init__(self):
        self.updater = UpdateManager()
        self.window = None

    def set_window(self, window):
        self.window = window

    def get_version(self):
        """Trả về phiên bản hiện tại cho UI."""
        return CURRENT_VERSION

    def check_update(self):
        """Kiểm tra có bản cập nhật mới từ remote không."""
        return self.updater.check_for_update()

    def start_update(self, download_url):
        """Bắt đầu tải trong một luồng riêng để tránh khóa giao diện UI."""
        def progress_tracker(percent, err=None):
            if err:
                self.window.evaluate_js(f"window.onUpdateError('{err}')")
            else:
                self.window.evaluate_js(f"window.onUpdateProgress({percent})")

        thread = threading.Thread(
            target=self.updater.download_and_install,
            args=(download_url, progress_tracker),
            daemon=True
        )
        thread.start()
        return {"status": "started"}
```

---

### 3.4. Điểm khởi chạy ứng dụng: `main.py`

```python
import os
import sys
import webview
from app.api import AppBridgeAPI


def get_asset_path(relative_path):
    """
    Hỗ trợ lấy đường dẫn tài nguyên tĩnh khi ứng dụng chạy ở chế độ dev
    hoặc khi đã được đóng gói bằng PyInstaller (--onefile).
    """
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)


def main():
    api = AppBridgeAPI()
    html_file = get_asset_path("app/static/index.html")

    window = webview.create_window(
        title="Pywebview Auto Update Demo",
        url=f"file://{html_file}",
        js_api=api,
        width=700,
        height=500,
        resizable=False
    )

    api.set_window(window)
    webview.start(debug=True)


if __name__ == "__main__":
    main()
```

---

### 3.5. Giao diện người dùng: `app/static/index.html`

```html
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Auto Update Client</title>
    <style>
        :root {
            --primary: #2563eb;
            --primary-hover: #1d4ed8;
            --bg: #f8fafc;
            --surface: #ffffff;
            --text: #0f172a;
            --border: #e2e8f0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 24px;
            box-sizing: border-box;
        }

        .container {
            max-width: 580px;
            margin: 0 auto;
            background: var(--surface);
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
            border: 1px solid var(--border);
        }

        h2 { margin-top: 0; }
        
        .badge {
            display: inline-block;
            padding: 4px 8px;
            background: #e0e7ff;
            color: #3730a3;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
        }

        button {
            background: var(--primary);
            color: white;
            border: none;
            padding: 10px 18px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s;
        }

        button:hover { background: var(--primary-hover); }
        button:disabled { background: #94a3b8; cursor: not-allowed; }

        .modal-box {
            display: none;
            margin-top: 20px;
            padding: 16px;
            background: #f1f5f9;
            border-radius: 8px;
        }

        .notes-content {
            white-space: pre-wrap;
            font-size: 13px;
            background: #ffffff;
            padding: 10px;
            border-radius: 4px;
            border: 1px solid var(--border);
            max-height: 120px;
            overflow-y: auto;
        }

        .progress-section {
            display: none;
            margin-top: 16px;
        }

        progress {
            width: 100%;
            height: 16px;
            border-radius: 8px;
            overflow: hidden;
        }

        .status-msg {
            margin-top: 10px;
            font-size: 13px;
            color: #64748b;
        }
    </style>
</head>
<body>
    <div class="container">
        <h2>Demo Tự Động Cập Nhật</h2>
        <p>Phiên bản ứng dụng: <span class="badge" id="lbl-version">Đang tải...</span></p>

        <button id="btn-check" onclick="onCheckUpdate()">Kiểm tra bản cập nhật</button>
        <p class="status-msg" id="lbl-status"></p>

        <!-- Khung thông báo cập nhật -->
        <div id="update-modal" class="modal-box">
            <h3 style="margin-top:0">🎉 Có bản cập nhật mới! (<span id="lbl-new-ver"></span>)</h3>
            <p><strong>Nội dung thay đổi:</strong></p>
            <div class="notes-content" id="lbl-release-notes"></div>
            <div style="margin-top: 14px;">
                <button id="btn-update-now" onclick="onStartDownload()">Tải & Cài Đặt Ngay</button>
            </div>
        </div>

        <!-- Khung tiến trình tải -->
        <div id="progress-wrapper" class="progress-section">
            <p>Đang tải bản cập nhật: <span id="lbl-progress-num">0%</span></p>
            <progress id="download-progress" value="0" max="100"></progress>
            <p class="status-msg" id="lbl-download-status">Vui lòng không tắt ứng dụng...</p>
        </div>
    </div>

    <script>
        let currentDownloadUrl = "";

        // Sự kiện khi API pywebview sẵn sàng
        window.addEventListener('pywebviewready', async () => {
            const ver = await window.pywebview.api.get_version();
            document.getElementById('lbl-version').innerText = `v${ver}`;
        });

        async function onCheckUpdate() {
            const btn = document.getElementById('btn-check');
            const status = document.getElementById('lbl-status');
            btn.disabled = true;
            status.innerText = "Đang kiểm tra máy chủ GitHub...";

            try {
                const res = await window.pywebview.api.check_update();
                if (res.has_update) {
                    status.innerText = "";
                    currentDownloadUrl = res.download_url;
                    document.getElementById('lbl-new-ver').innerText = `v${res.latest_version}`;
                    document.getElementById('lbl-release-notes').innerText = res.notes;
                    document.getElementById('update-modal').style.display = 'block';
                } else {
                    status.innerText = res.message || res.error || "Bạn đang sử dụng bản mới nhất.";
                }
            } catch (err) {
                status.innerText = "Lỗi: " + err;
            } finally {
                btn.disabled = false;
            }
        }

        async function onStartDownload() {
            document.getElementById('update-modal').style.display = 'none';
            document.getElementById('progress-wrapper').style.display = 'block';
            await window.pywebview.api.start_update(currentDownloadUrl);
        }

        // Các hàm callback được Python gọi qua evaluate_js
        window.onUpdateProgress = function(percent) {
            const progress = document.getElementById('download-progress');
            const label = document.getElementById('lbl-progress-num');
            const status = document.getElementById('lbl-download-status');

            progress.value = percent;
            label.innerText = percent + "%";

            if (percent >= 100) {
                status.innerText = "Tải xong. Đang tiến hành cài đặt và khởi động lại...";
            }
        };

        window.onUpdateError = function(errMsg) {
            alert("Quá trình cập nhật thất bại: " + errMsg);
            document.getElementById('progress-wrapper').style.display = 'none';
        };
    </script>
</body>
</html>
```

---

## 4. Đóng Gói Ứng Dụng Với PyInstaller

Để chương trình chạy như một ứng dụng độc lập trên máy người dùng, sử dụng lệnh `pyinstaller`:

```bash
pyinstaller --noconsole \
            --onefile \
            --add-data "app/static;app/static" \
            --name "MyPywebviewApp" \
            main.py
```

* `--noconsole`: Không hiện cửa sổ đen dòng lệnh (terminal).
* `--onefile`: Đóng gói thành đúng một file thực thi duy nhất (`MyPywebviewApp.exe`).
* `--add-data`: Nhúng toàn bộ thư mục web static vào bên trong file nhị phân. Trên Linux/macOS cú pháp dấu phân tách sẽ là `:` thay vì `;`.

---

## 5. Thiết Lập CI/CD Tự Động Hóa Với GitHub Actions

Tạo file `.github/workflows/release.yml` để mỗi khi bạn gắn thẻ tag mới (`v1.0.1`, `v1.0.2`), GitHub sẽ tự động build file `.exe` và tạo bản Release:

```yaml
name: Build and Publish Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write

jobs:
  build-windows:
    runs-on: windows-latest

    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'

      - name: Install Dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt

      - name: Build Executable with PyInstaller
        run: |
          pyinstaller --noconsole --onefile --add-data "app/static;app/static" --name "MyPywebviewApp" main.py

      - name: Create GitHub Release and Upload Binary
        uses: softprops/action-gh-release@v2
        with:
          files: dist/MyPywebviewApp.exe
          draft: false
          prerelease: false
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 6. Xử Lý Các Trường Hợp Ngoại Lệ & Best Practices

| Vấn đề | Nguyên nhân | Hướng giải quyết |
| :--- | :--- | :--- |
| **Quyền Admin (UAC)** | Ứng dụng đặt trong `C:\Program Files` sẽ bị từ chối quyền ghi khi batch script chạy lệnh `move`. | Khuyến cáo phân phối portable app chạy trong thư mục người dùng (`%LOCALAPPDATA%`), hoặc tạo file cài đặt NSIS/Inno Setup và chạy ở chế độ `/SILENT` kèm quyền nâng cao. |
| **Rate Limit của GitHub** | GitHub giới hạn 60 requests/giờ cho IP không xác thực đối với public API. | Lưu cache kết quả kiểm tra version (ví dụ: chỉ check 1 lần mỗi ngày hoặc khi người dùng chủ động nhấn nút). |
| **Bảo mật file tải về** | File có thể bị lỗi do gián đoạn đường truyền mạng. | Tạo thêm mã hash (SHA-256) đính kèm trong Release Notes hoặc file `checksums.txt` riêng để đối chiếu trước khi ghi đè. |
| **Antivirus cảnh báo** | File `.bat` sinh ra trong thư mục tạm có thể bị một số phần mềm bảo vệ nhận nhầm là hành vi độc hại. | Ký số (Code Signing) cho file `.exe`, hoặc chuyển sang dùng công cụ updater chuyên nghiệp như **Velopack**. |