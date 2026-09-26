# KỊCH BẢN HƯỚNG DẪN AGENT: TÍCH HỢP CUSTOM TITLEBAR/NAVBAR CHO PYWEBVIEW

Tài liệu này cung cấp chỉ dẫn kỹ thuật từng bước dành cho AI Coding Agent để tự động chuyển đổi cửa sổ ứng dụng desktop `pywebview` sang chế độ không viền (`frameless`), ẩn thanh tiêu đề mặc định của Windows và sử dụng thanh navbar của ứng dụng làm thanh điều khiển cửa sổ tiêu chuẩn.

---

## 1. Mục tiêu & Nguyên tắc Cốt lõi

1. **Khử viền mặc định**: Thiết lập `frameless=True` nhưng vẫn đảm bảo cửa sổ kéo giãn kích thước được (`resizable=True`).
2. **Không đè Taskbar Windows khi Maximize**: Khắc phục lỗi mặc định của `pywebview` khi phóng to bị phủ kín màn hình (fullscreen) che mất thanh taskbar của hệ điều hành.
3. **Trải nghiệm mượt mà (Zero-latency & No-flash)**:
   - Khử hiện tượng chớp trắng lúc khởi động thông qua `background_color`.
   - Phản hồi thay đổi biểu tượng (icon) phóng to/thu nhỏ tức thì ở frontend (Optimistic UI).
4. **Cách ly vùng tương tác chuột**:
   - Vùng navbar cho phép kéo cửa sổ (`-webkit-app-region: drag`).
   - Các nút bấm, menu, thanh tìm kiếm bắt buộc phải cách ly (`-webkit-app-region: no-drag !important`) để không bị nuốt sự kiện click.

---

## 2. Quy tắc Nhận diện & Tiêm Mã của Agent (DOM Heuristics)

Khi Agent phân tích mã nguồn giao diện HTML/CSS/JS của người dùng, thực hiện các bước sau:

### Bước 2.1: Quét phần tử đóng vai trò Navbar
Tìm phần tử ứng viên đầu tiên thỏa mãn một trong các selector sau:
- `[id*="navbar" i]`, `[class*="navbar" i]`
- `[id*="titlebar" i]`, `[class*="titlebar" i]`
- Thẻ `<header>` nằm trực tiếp dưới thẻ `<body>`

### Bước 2.2: Tiêm Thuộc Tính CSS
- **Tại phần tử Navbar tìm được**:
  - Gán class `pywebview-drag-region` hoặc CSS `-webkit-app-region: drag;`
  - Thêm `user-select: none;` để tránh bôi đen text khi người dùng kéo chuột.
- **Tại các phần tử con bên trong Navbar** (nút bấm, menu dropdown, thanh tìm kiếm, input):
  - Thêm class `.no-drag` hoặc CSS `-webkit-app-region: no-drag !important;`

### Bước 2.3: Tích hợp Web Component hoặc Script Điều Khiển
Nếu dự án chưa có thành phần titlebar riêng, Agent tự động nhúng Web Component `<app-titlebar>` vào đầu thẻ `<body>`.

---

## 3. Kiến trúc Mã nguồn Mẫu Chuẩn Hóa

### 3.1. Phía Python: `window_bridge.py`
Xử lý giao tiếp Win32 API qua `ctypes` để lấy chính xác diện tích làm việc khả dụng (`SPI_GETWORKAREA`), bảo toàn Taskbar Windows:

```python
import ctypes
from ctypes import wintypes
import sys
import webview

class FramelessWindowBridge:
    """Cầu nối điều khiển cửa sổ không viền pywebview chuẩn native Windows."""

    def __init__(self):
        self.window = None
        self.is_maximized = False
        self._prev_bounds = None  # (x, y, width, height)

    def set_window(self, window):
        self.window = window

    def minimize(self):
        if self.window:
            self.window.minimize()

    def toggle_maximize(self):
        """Phóng to cửa sổ nhưng không che lấp Taskbar của Windows."""
        if not self.window:
            return False

        if self.is_maximized:
            # Khôi phục vị trí và kích thước trước khi phóng to
            if self._prev_bounds:
                x, y, w, h = self._prev_bounds
                self.window.resize(w, h)
                self.window.move(x, y)
            else:
                self.window.restore()
            self.is_maximized = False
        else:
            # Lưu kích thước hiện tại
            self._prev_bounds = (
                self.window.x,
                self.window.y,
                self.window.width,
                self.window.height
            )

            # Lấy vùng làm việc (đã trừ thanh Taskbar Windows)
            rect = wintypes.RECT()
            # SPI_GETWORKAREA = 0x0030
            ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0)
            
            work_x = rect.left
            work_y = rect.top
            work_w = rect.right - rect.left
            work_h = rect.bottom - rect.top

            self.window.move(work_x, work_y)
            self.window.resize(work_w, work_h)
            self.is_maximized = True

        return self.is_maximized

    def close(self):
        """Đóng cửa sổ và giải phóng toàn bộ tiến trình/cache."""
        if self.window:
            self.window.destroy()
        sys.exit(0)


def create_app_window(title: str, target: str, js_api=None, width=1080, height=680):
    """Hàm khởi tạo cửa sổ chuẩn hóa khử chớp trắng và hỗ trợ resize."""
    bridge = FramelessWindowBridge()
    api_instance = bridge if js_api is None else js_api

    is_file_or_url = target.endswith(('.html', '/', '.htm')) or target.startswith(('http://', 'https://'))

    window = webview.create_window(
        title=title,
        url=target if is_file_or_url else None,
        html=target if not is_file_or_url else None,
        js_api=api_instance,
        frameless=True,          # Ẩn taskbar/titlebar mặc định
        easy_drag=False,         # Chỉ cho phép kéo ở navbar được chỉ định
        resizable=True,          # Cho phép resize 4 cạnh và 4 góc
        width=width,
        height=height,
        background_color="#1e1e1e"  # Đồng bộ màu tối để khử vệt chớp trắng
    )
    bridge.set_window(window)
    return window
```

---

### 3.2. Phía Frontend: `titlebar.js` (Web Component Độc Lập)
Tự động dựng Shadow DOM, tích hợp menu IDE (File, Edit, View, Help), hỗ trợ phím tắt, vạch ngăn và xử lý sự kiện:

```javascript
class AppTitlebar extends HTMLElement {
  constructor() {
    super();
    this.isMenuOpen = false;
    this.activeMenuIndex = -1;
    this.menus = [];
  }

  connectedCallback() {
    const title = this.getAttribute('title') || document.title || 'IDE Application';
    const icon = this.getAttribute('icon') || '';

    const defaultMenus = [
      {
        label: 'File',
        items: [
          { label: 'New File', shortcut: 'Ctrl+N', action: 'file:new' },
          { label: 'Open File...', shortcut: 'Ctrl+O', action: 'file:open' },
          { type: 'separator' },
          { label: 'Save', shortcut: 'Ctrl+S', action: 'file:save' },
          { type: 'separator' },
          { label: 'Exit', shortcut: 'Alt+F4', action: 'app:exit' }
        ]
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', shortcut: 'Ctrl+Z', action: 'edit:undo' },
          { label: 'Redo', shortcut: 'Ctrl+Y', action: 'edit:redo' },
          { type: 'separator' },
          { label: 'Cut', shortcut: 'Ctrl+X', action: 'edit:cut' },
          { label: 'Copy', shortcut: 'Ctrl+C', action: 'edit:copy' },
          { label: 'Paste', shortcut: 'Ctrl+V', action: 'edit:paste' }
        ]
      },
      {
        label: 'View',
        items: [
          { label: 'Explorer', shortcut: 'Ctrl+Shift+E', action: 'view:explorer' },
          { label: 'Terminal', shortcut: 'Ctrl+`', action: 'view:terminal' }
        ]
      },
      {
        label: 'Help',
        items: [
          { label: 'Documentation', action: 'help:docs' },
          { label: 'About', action: 'help:about' }
        ]
      }
    ];

    if (this.hasAttribute('menu-data')) {
      try {
        this.menus = JSON.parse(this.getAttribute('menu-data'));
      } catch (e) {
        this.menus = defaultMenus;
      }
    } else {
      this.menus = defaultMenus;
    }

    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          height: 35px;
          background: #1f1f1f;
          color: #cccccc;
          user-select: none;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
          font-size: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          box-sizing: border-box;
          z-index: 99999;
        }

        .titlebar {
          display: flex;
          height: 100%;
          justify-content: space-between;
          align-items: center;
          -webkit-app-region: drag;
        }

        .left-section {
          display: flex;
          align-items: center;
          padding-left: 10px;
          height: 100%;
          -webkit-app-region: no-drag !important;
        }

        .app-icon {
          width: 16px;
          height: 16px;
          margin-right: 6px;
        }

        .menu-bar {
          display: flex;
          height: 100%;
          align-items: center;
        }

        .menu-top-item {
          position: relative;
          height: 100%;
          display: flex;
          align-items: center;
        }

        .menu-trigger {
          padding: 3px 8px;
          border-radius: 4px;
          cursor: pointer;
          color: #cccccc;
        }

        .menu-top-item:hover .menu-trigger,
        .menu-top-item.open .menu-trigger {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        .dropdown-menu {
          display: none;
          position: absolute;
          top: 100%;
          left: 0;
          min-width: 200px;
          background: #252526;
          border: 1px solid #454545;
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
          padding: 4px 0;
          border-radius: 4px;
          z-index: 100000;
        }

        .menu-top-item.open .dropdown-menu {
          display: block;
        }

        .dropdown-item {
          display: flex;
          justify-content: space-between;
          padding: 6px 14px;
          cursor: pointer;
        }

        .dropdown-item:hover {
          background: #0078d4;
          color: #ffffff;
        }

        .dropdown-shortcut {
          color: #858585;
          font-size: 11px;
          margin-left: 20px;
        }

        .separator {
          height: 1px;
          background: #3c3c3c;
          margin: 4px 0;
        }

        .center-section {
          flex: 1;
          display: flex;
          justify-content: center;
          color: #858585;
          pointer-events: none;
        }

        .controls {
          display: flex;
          height: 100%;
          -webkit-app-region: no-drag !important;
        }

        .btn {
          width: 46px;
          height: 100%;
          background: transparent;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #cccccc;
          cursor: pointer;
          transition: background-color 0.1s ease;
        }

        .btn:hover { background: rgba(255, 255, 255, 0.08); }
        .btn-close:hover { background: #e81123 !important; color: #ffffff !important; }
        svg { width: 10px; height: 10px; fill: currentColor; }
      </style>

      <div class="titlebar pywebview-drag-region" id="drag-zone">
        <div class="left-section">
          ${icon ? `<img src="${icon}" class="app-icon"/>` : ''}
          <div class="menu-bar" id="menu-bar">${this._renderMenus()}</div>
        </div>

        <div class="center-section">
          <span>${title}</span>
        </div>

        <div class="controls">
          <button class="btn" id="btn-min" title="Minimize">
            <svg viewBox="0 0 10 1"><rect width="10" height="1"></rect></svg>
          </button>
          <button class="btn" id="btn-max" title="Maximize / Restore">
            <svg id="icon-max" viewBox="0 0 10 10"><path d="M0,0v10h10V0H0z M9,9H1V1h8V9z"></path></svg>
          </button>
          <button class="btn btn-close" id="btn-close" title="Close">
            <svg viewBox="0 0 10 10"><polygon points="10,0.7 9.3,0 5,4.3 0.7,0 0,0.7 4.3,5 0,9.3 0.7,10 5,5.7 9.3,10 10,9.3 5.7,5"></polygon></svg>
          </button>
        </div>
      </div>
    `;

    this._bindEvents();
  }

  _renderMenus() {
    return this.menus.map((menu, idx) => `
      <div class="menu-top-item" data-index="${idx}">
        <span class="menu-trigger">${menu.label}</span>
        <div class="dropdown-menu">
          ${(menu.items || []).map(item => {
            if (item.type === 'separator') return `<div class="separator"></div>`;
            return `
              <div class="dropdown-item" data-action="${item.action || ''}">
                <span>${item.label}</span>
                ${item.shortcut ? `<span class="dropdown-shortcut">${item.shortcut}</span>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `).join('');
  }

  _bindEvents() {
    const root = this.shadowRoot;
    const btnMin = root.getElementById('btn-min');
    const btnMax = root.getElementById('btn-max');
    const btnClose = root.getElementById('btn-close');
    const dragZone = root.getElementById('drag-zone');
    const iconMax = root.getElementById('icon-max');
    const topItems = root.querySelectorAll('.menu-top-item');

    let isMaximized = false;

    const closeAll = () => {
      this.isMenuOpen = false;
      this.activeMenuIndex = -1;
      topItems.forEach(el => el.classList.remove('open'));
    };

    const openMenu = (idx) => {
      this.isMenuOpen = true;
      this.activeMenuIndex = idx;
      topItems.forEach((el, i) => el.classList.toggle('open', i === idx));
    };

    topItems.forEach((itemEl, idx) => {
      const trigger = itemEl.querySelector('.menu-trigger');
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isMenuOpen && this.activeMenuIndex === idx) closeAll();
        else openMenu(idx);
      });

      itemEl.addEventListener('mouseenter', () => {
        if (this.isMenuOpen && this.activeMenuIndex !== idx) openMenu(idx);
      });
    });

    root.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.getAttribute('data-action');
        closeAll();
        if (action === 'app:exit') {
          callApi('close');
          return;
        }
        this.dispatchEvent(new CustomEvent('menu-action', {
          detail: { action },
          bubbles: true,
          composed: true
        }));
      });
    });

    window.addEventListener('click', closeAll);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAll();
    });

    const setMaxIcon = (max) => {
      iconMax.innerHTML = max
        ? '<path d="M2,0v2H0v8h8V8h2V0H2z M7,9H1V3h6V9z M9,7H8V2H3V1h6V7z"></path>'
        : '<path d="M0,0v10h10V0H0z M9,9H1V1h8V9z"></path>';
    };

    const callApi = (method) => {
      if (window.pywebview && window.pywebview.api && window.pywebview.api[method]) {
        return window.pywebview.api[method]();
      }
    };

    btnMin.addEventListener('click', () => callApi('minimize'));

    btnMax.addEventListener('click', async () => {
      // Đổi icon trước tức thì (0ms latency)
      isMaximized = !isMaximized;
      setMaxIcon(isMaximized);
      const real = await callApi('toggle_maximize');
      if (typeof real === 'boolean' && real !== isMaximized) {
        isMaximized = real;
        setMaxIcon(isMaximized);
      }
    });

    btnClose.addEventListener('click', () => callApi('close'));

    dragZone.addEventListener('dblclick', (e) => {
      if (!e.target.closest('.controls') && !e.target.closest('.left-section')) {
        btnMax.click();
      }
    });
  }
}

customElements.define('app-titlebar', AppTitlebar);
```

---

## 4. Bảng Kiểm Tra Chất Lượng (QA Verification Checklist)

Trước khi hoàn tất task, Agent cần xác minh qua các tiêu chí sau:

| STT | Hành động kiểm tra | Kết quả kỳ vọng | Ghi chú kỹ thuật |
| :--- | :--- | :--- | :--- |
| 1 | Mở ứng dụng | Không có vệt chớp trắng xuất hiện | Đã gán `background_color="#1e1e1e"` |
| 2 | Kéo thả trên nền navbar | Cửa sổ di chuyển mượt mà theo trỏ chuột | `-webkit-app-region: drag` |
| 3 | Click vào menu & nút điều khiển | Click nhận lệnh ngay, không bị kẹt kéo cửa sổ | `-webkit-app-region: no-drag !important` |
| 4 | Double-click trên navbar | Cửa sổ phóng to / khôi phục | Bắt sự kiện `dblclick` trên drag-zone |
| 5 | Phóng to (Maximize) | Thanh Taskbar mặc định của Windows **vẫn nhìn thấy rõ** | Đã áp dụng `SPI_GETWORKAREA` Win32 |
| 6 | Đóng ứng dụng (Nút X) | Tiến trình `python.exe` tắt hoàn toàn trong Task Manager | Gọi `window.destroy()` kèm `sys.exit(0)` |