# KỊCH BẢN HƯỚNG DẪN AGENT: ĐỒNG BỘ MÀU SẮC TITLEBAR WINDOWS GỐC BẰNG DWM API

Tài liệu này cung cấp chỉ dẫn kỹ thuật chi tiết cho AI Coding Agent để thiết lập ứng dụng `pywebview` giữ nguyên thanh tiêu đề mặc định của Windows (`frameless=False`), nhưng có thể thay đổi màu nền, màu chữ và màu nút điều khiển theo chủ đề giao diện (Theme) thông qua Windows Desktop Window Manager (DWM) API.

---

## 1. Mục tiêu & Nguyên tắc Thiết kế

1. **Bảo tồn tính năng gốc (Native Capabilities)**:
   - Giữ nguyên cơ chế kéo thả, thay đổi kích thước (Resize), hiệu ứng bóng đổ (Drop Shadow) và menu chuột phải hệ thống (`Alt + Space`).
   - Tự động tương thích với tính năng **Snap Layouts của Windows 11** khi rê chuột vào nút phóng to mà không cần viết thêm mã giả lập.
   - Khi bấm Maximize, cửa sổ tự căn chỉnh với thanh Taskbar của Windows (không bị đè che mất Taskbar như khi dùng `frameless=True`).

2. **Cập nhật màu thời gian thực (Zero-latency)**:
   - Giao diện Web có thể kích hoạt đổi màu thanh tiêu đề bất cứ lúc nào (khi đổi theme hoặc chọn color picker).
   - Dùng lệnh `SetWindowPos` với cờ `SWP_FRAMECHANGED` để ép DWM vẽ lại khung ngay lập tức, không để lại độ trễ thị giác.

3. **Tương thích màu nút bấm (Contrast Adaptive)**:
   - Tự động phát hiện màu nền thanh tiêu đề là sáng hay tối để đảo màu 3 nút điều khiển (Thu nhỏ, Phóng to, Đóng) từ trắng sang đen hoặc ngược lại, đảm bảo độ tương phản thị giác.

---

## 2. Thông số Win32 & DWM API Cần Nạp

| Tên hằng số / API | Giá trị Hex / Thư viện | Mục đích |
| :--- | :--- | :--- |
| `DWMWA_USE_IMMERSIVE_DARK_MODE` | `20` (`dwmapi.dll`) | `1`: Nút hệ thống màu trắng (Dark), `0`: Nút hệ thống màu đen (Light) |
| `DWMWA_BORDER_COLOR` | `34` (`dwmapi.dll`) | Đổi màu viền cửa sổ (Windows 11) |
| `DWMWA_CAPTION_COLOR` | `35` (`dwmapi.dll`) | Đổi màu nền thanh tiêu đề (Windows 11) |
| `DWMWA_TEXT_COLOR` | `36` (`dwmapi.dll`) | Đổi màu chữ tên ứng dụng trên thanh tiêu đề (Windows 11) |
| `SWP_FRAMECHANGED` | `0x0020` (`user32.dll`) | Ép cửa sổ vẽ lại toàn bộ Non-Client Area (Titlebar) ngay lập tức |
| `SWP_NOSIZE \| SWP_NOMOVE \| SWP_NOZORDER` | `0x0001 \| 0x0002 \| 0x0004` | Giữ nguyên vị trí và kích thước cửa sổ khi ép vẽ lại |

> **Lưu ý quan trọng về mã màu**: Windows API không dùng chuẩn mã màu web RGB (`0xRRGGBB`) mà sử dụng cấu trúc `COLORREF` theo thứ tự ngược `0x00BBGGRR` (Blue - Green - Red).

---

## 3. Kiến trúc Triển khai Mã nguồn

### 3.1. Module Backend Python: `titlebar_theme_bridge.py`

Agent tạo module này để làm cầu nối giữa WebView2 và hệ điều hành:

```python
import ctypes
from ctypes import wintypes
import sys
import winreg
import webview

# Win32 Constants
DWMWA_USE_IMMERSIVE_DARK_MODE = 20
DWMWA_BORDER_COLOR = 34
DWMWA_CAPTION_COLOR = 35
DWMWA_TEXT_COLOR = 36

SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_FRAMECHANGED = 0x0020


def hex_to_colorref(hex_str: str) -> int:
    """Chuyển đổi chuỗi Hex '#RRGGBB' sang định dạng Win32 COLORREF (0x00BBGGRR)."""
    clean_hex = hex_str.lstrip('#')
    r = int(clean_hex[0:2], 16)
    g = int(clean_hex[2:4], 16)
    b = int(clean_hex[4:6], 16)
    return (b << 16) | (g << 8) | r


def get_windows_system_theme() -> bool:
    """Đọc Windows Registry để kiểm tra xem Windows đang bật Dark Mode hay Light Mode."""
    try:
        registry_path = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, registry_path) as key:
            value, _ = winreg.QueryValueEx(key, "AppsUseLightTheme")
            return value == 0  # 0 nghĩa là Dark Mode, 1 là Light Mode
    except Exception:
        return True  # Mặc định tối nếu không đọc được


class NativeTitlebarAPI:
    """Lớp API phơi ra cho frontend gọi để điều khiển màu sắc cửa sổ."""
    def __init__(self, title: str):
        self.title = title
        self._hwnd = None

    def _get_hwnd(self):
        if not self._hwnd:
            self._hwnd = ctypes.windll.user32.FindWindowW(None, self.title)
        return self._hwnd

    def apply_theme(self, bg_hex: str, text_hex: str, is_dark: bool = True):
        """Áp dụng màu sắc cho thanh tiêu đề Windows theo thời gian thực."""
        hwnd = self._get_hwnd()
        if not hwnd:
            return False

        dwmapi = ctypes.windll.dwmapi
        user32 = ctypes.windll.user32

        # 1. Đổi chế độ icon hệ thống (Thu nhỏ/Phóng to/Đóng)
        dark_flag = ctypes.c_int(1 if is_dark else 0)
        dwmapi.DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            ctypes.byref(dark_flag),
            ctypes.sizeof(dark_flag)
        )

        # 2. Đổi màu nền thanh tiêu đề
        caption_color = ctypes.c_int(hex_to_colorref(bg_hex))
        dwmapi.DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            ctypes.byref(caption_color),
            ctypes.sizeof(caption_color)
        )

        # 3. Đổi màu chữ tiêu đề
        text_color = ctypes.c_int(hex_to_colorref(text_hex))
        dwmapi.DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR,
            ctypes.byref(text_color),
            ctypes.sizeof(text_color)
        )

        # 4. Ép vẽ lại toàn bộ thanh tiêu đề ngay lập tức
        user32.SetWindowPos(
            hwnd, 0, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED
        )
        return True

    def get_system_mode(self) -> dict:
        """Cho phép frontend lấy trạng thái theme hiện tại của Windows khi khởi động."""
        is_dark = get_windows_system_theme()
        return {"is_dark": is_dark}
```

---

### 3.2. Cấu hình Khởi tạo Cửa sổ trong `main.py`

Agent cần lưu ý cấu hình các cờ của `webview.create_window`:
- `frameless=False` (Không tắt thanh tiêu đề).
- `easy_drag=False`.
- `background_color` phải khớp với màu nền mặc định ban đầu để loại bỏ hiện tượng chớp trắng lúc tạo khung cửa sổ.

```python
import webview
from titlebar_theme_bridge import NativeTitlebarAPI

APP_TITLE = "Themed Native Studio"
DEFAULT_BG = "#1e1e1e"
DEFAULT_TEXT = "#ffffff"

if __name__ == "__main__":
    api = NativeTitlebarAPI(title=APP_TITLE)

    window = webview.create_window(
        title=APP_TITLE,
        url="index.html",
        js_api=api,
        frameless=False,            # DÙNG TITLEBAR GỐC
        resizable=True,
        width=1000,
        height=620,
        background_color=DEFAULT_BG # Tránh chớp trắng
    )

    # Đặt màu ban đầu ngay khi window sẵn sàng
    def on_loaded():
        api.apply_theme(DEFAULT_BG, DEFAULT_TEXT, is_dark=True)

    webview.start(on_loaded, debug=False)
```

---

### 3.3. Tích hợp Phía Frontend: Quản lý Theme & Tự Động Tính Độ Tương Phản

Tạo file `theme-manager.js` để tự động hóa việc tính toán độ sáng (Luminance) và gửi tín hiệu xuống Python:

```javascript
/**
 * Module quản lý theme đồng bộ giao diện Web với Titlebar Windows
 */
const TitlebarTheme = {
  // Công thức đo độ sáng cảm nhận (Relative Luminance)
  isDarkColor(hex) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substr(0, 2), 16);
    const g = parseInt(clean.substr(2, 2), 16);
    const b = parseInt(clean.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  },

  // Áp dụng màu cho cả Web CSS và Native Titlebar
  setTheme(bgHex, textHex = null) {
    const isDark = this.isDarkColor(bgHex);
    const finalTextColor = textHex || (isDark ? '#ffffff' : '#111111');

    // 1. Cập nhật biến CSS toàn cục
    document.documentElement.style.setProperty('--app-bg', bgHex);
    document.documentElement.style.setProperty('--app-text', finalTextColor);
    document.documentElement.style.setProperty('--app-card', isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)');

    // 2. Gửi tín hiệu xuống Python qua pywebview bridge
    if (window.pywebview && window.pywebview.api && window.pywebview.api.apply_theme) {
      window.pywebview.api.apply_theme(bgHex, finalTextColor, isDark);
    }
  },

  // Tự động khởi tạo và đồng bộ với cài đặt Windows
  async init(defaultDark = '#1e1e1e', defaultLight = '#f3f3f3') {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.get_system_mode) {
      const sys = await window.pywebview.api.get_system_mode();
      if (sys && sys.is_dark) {
        this.setTheme(defaultDark, '#ffffff');
      } else {
        this.setTheme(defaultLight, '#1c1c1c');
      }
    } else {
      this.setTheme(defaultDark, '#ffffff');
    }
  }
};

window.addEventListener('pywebviewready', () => {
  TitlebarTheme.init();
});
```

---

## 4. Bảng Kịch bản Thực thi Cho Agent (Agent Execution Steps)

Khi nhận yêu cầu: *"Đổi màu thanh tiêu đề mặc định của Windows theo theme ứng dụng"* từ người dùng, Agent làm theo trình tự sau:

1. **Kiểm tra file cấu hình khởi tạo Python:**
   - Đảm bảo tham số `frameless` đang là `False`. Nếu đang là `True`, chuyển về `False` và loại bỏ các viền ảo/resizer không cần thiết.
2. **Tiêm mã Win32 Bridge:**
   - Tạo hoặc đưa class `NativeTitlebarAPI` vào file khởi chạy của Python.
   - Truyền instance này vào tham số `js_api` của `webview.create_window`.
3. **Tiêm Script Quản Lý Theme ở Frontend:**
   - Nhúng `theme-manager.js` vào file HTML chính.
   - Bổ sung lời gọi `TitlebarTheme.setTheme(newBgColor)` vào các sự kiện click nút chuyển theme / color picker sẵn có trên giao diện.
4. **Kiểm tra tiêu đề cửa sổ (Window Title):**
   - Đảm bảo tham số `title` truyền vào `webview.create_window` trùng khớp chính xác với `self.title` trong `NativeTitlebarAPI` để hàm `FindWindowW` định vị đúng cửa sổ Win32.

---

## 5. Bảng Kiểm Tra Đảm Bảo Chất Lượng (QA Checklist)

| STT | Tình huống kiểm thử | Kết quả mong đợi | Biện pháp xử lý nếu lỗi |
| :--- | :--- | :--- | :--- |
| 1 | Khởi động ứng dụng | Thanh tiêu đề hiển thị đúng màu ban đầu, không bị chớp trắng | Cấu hình `background_color` trong Python |
| 2 | Rê chuột vào nút phóng to | Hiện menu bố cục **Snap Layouts** (Windows 11) | `frameless=False` được đảm bảo |
| 3 | Chọn theme Sáng (Light) | Nền titlebar chuyển sang màu sáng, 3 icon hệ thống đổi sang màu đen | Kiểm tra cờ `DWMWA_USE_IMMERSIVE_DARK_MODE = 0` |
| 4 | Chọn theme Tối (Dark) | Nền titlebar chuyển sang màu tối, 3 icon hệ thống đổi sang màu trắng | Kiểm tra cờ `DWMWA_USE_IMMERSIVE_DARK_MODE = 1` |
| 5 | Tốc độ chuyển màu | Màu đổi ngay tức thì, không cần click hay rê chuột | Kiểm tra cờ `SWP_FRAMECHANGED` trong `SetWindowPos` |
| 6 | Phóng to (Maximize) | Cửa sổ khít màn hình và **không che mất Taskbar Windows** | Cơ chế quản lý cửa sổ mặc định của Windows tự xử lý |