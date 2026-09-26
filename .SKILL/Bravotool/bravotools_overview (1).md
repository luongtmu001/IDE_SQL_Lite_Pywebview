# SKILL SPECIFICATION: BRAVO ADDON OVERVIEW
# FILE: bravotools_overview.md

---

## 1. TERMINOLOGY & SYSTEM CONTEXT / THUẬT NGỮ & BỐI CẢNH HỆ THỐNG

* **IDE sql**: The host database management environment and query editor.
  * *Môi trường phát triển và quản trị cơ sở dữ liệu nền tảng (ứng dụng máy chủ).*
* **BRAVO**: The specialized extension module/addon integrated into `IDE sql`.
  * *Phân hệ Addon tiện ích tích hợp chạy trên nền tảng của `IDE sql`.*
* **Scope**: This document defines the architectural baseline, window lifecycle, connection session rules, UI framework, and extension contracts. Specific business functions must be implemented in standalone feature files referencing this specification.
  * *Phạm vi: Tài liệu này quy định nền tảng kiến trúc, vòng đời cửa sổ, quy tắc session kết nối, khung giao diện và chuẩn module hóa. Các chức năng nghiệp vụ cụ thể sẽ được đặc tả tại các file riêng biệt dựa trên chuẩn này.*

---

## 2. ACTIVATION & SETTINGS MANAGEMENT / KÍCH HOẠT & CẤU HÌNH

### 2.1 Settings Schema / Cấu hình ứng dụng
The application's global configuration file must include a flag to determine BRAVO availability:
File cấu hình tập trung của ứng dụng phải chứa cờ thiết lập để kiểm soát trạng thái của BRAVO:

```json
{
  "addons": {
    "bravo_tool": {
      "enabled": true
    }
  }
}
```

### 2.2 Integration Rules / Quy tắc tích hợp
* **Enabled (`true`)**: Mount the menu item `"BRAVO tool"` onto the main taskbar/menubar of `IDE sql`.
  * *Nếu kích hoạt (`true`): Gắn menu `"BRAVO tool"` lên thanh menu/taskbar chính của `IDE sql`.*
* **Disabled (`false`)**: Suppress all UI entry points and background services associated with BRAVO.
  * *Nếu tắt (`false`): Ẩn toàn bộ giao diện và không khởi tạo dịch vụ chạy ngầm của BRAVO.*

---

## 3. WINDOW MANAGEMENT & LIFECYCLE / QUẢN LÝ CỬA SỔ & VÒNG ĐỜI

### 3.1 Multi-Window & Context Isolation / Đa cửa sổ & Độc lập ngữ cảnh
* **Independent Windows**: Launching BRAVO opens a separate, non-modal window. Users can minimize, restore, and run multiple BRAVO windows concurrently without blocking the host `IDE sql`.
  * *Cửa sổ độc lập: Khởi chạy BRAVO sẽ mở một cửa sổ riêng biệt (non-modal). Người dùng có thể thu nhỏ, mở lại và thao tác trên nhiều cửa sổ BRAVO cùng lúc mà không khóa luồng giao diện của `IDE sql`.*
* **Strict Window Isolation**: Each BRAVO window operates within its own execution context. Changing the active database, schema, or selected feature in Window A has zero side-effects on Window B.
  * *Độc lập ngữ cảnh: Mỗi cửa sổ BRAVO duy trì ngữ cảnh thực thi riêng biệt. Việc thay đổi database, schema hoặc chức năng ở Cửa sổ A hoàn toàn không ảnh hưởng tới Cửa sổ B.*

### 3.2 Workspace Persistence / Lưu trữ trạng thái làm việc
* Store window dimensions (`Width`, `Height`), screen coordinates (`X`, `Y`), and the last accessed feature ID in local cache.
  * *Tự động lưu kích thước cửa sổ (`Width`, `Height`), tọa độ (`X`, `Y`) và ID chức năng được chọn gần nhất vào bộ nhớ đệm.*
* On re-opening, the BRAVO window restores its previous geometry and active navigation item.
  * *Khi mở lại, cửa sổ BRAVO tự động phục hồi đúng kích thước, vị trí và chức năng đang làm việc trước đó.*

---

## 4. UI ARCHITECTURE & DESIGN SYSTEM / CẤU TRÚC GIAO DIỆN & HỆ THỐNG HIỂN THỊ

### 4.1 Master-Detail Layout / Bố cục tổng thể
```text
+---------------------------------------------------------------------------------------------------+
| [DB Type: Dropdown] | [Connection: Dropdow] | [DB: Active Name - Dropdow] | [Schema: Name - Dropdow] | [Env: Badge]  |
+----------------------+----------------------------------------------------------------------------+
| Feature Navigation   | Workspace / Dynamic Content Area                                           |
| - Feature 1          |                                                                            |
| - Feature 2          | Displays view corresponding to selected feature                            |
| - Feature ...        | Vùng hiển thị động theo chức năng được chọn                                |
|                      |                                                                            |
|                      |                                                                            |
+----------------------+----------------------------------------------------------------------------+
| Status: Ready        | Target: [Conn_Name] -> [DB_Name]             | Time: 00ms | [Cancel Button] |
+---------------------------------------------------------------------------------------------------+
```

### 4.2 Top Control Bar / Thanh điều khiển trên cùng
* **Database Type Selector**: Dropdown to select database engine (SQL Server, PostgreSQL, MySQL, etc.).
  * *Dropdown chọn loại cơ sở dữ liệu.*
* **Connection Profile Selector**: Dropdown listing saved connection profiles.
  * *Dropdown danh sách các profile kết nối đã lưu.*
* **Context Information**: Clear labels displaying active Database Name and active Schema.
  * *Nhãn hiển thị trực quan Tên database và Schema đang thao tác.Cho phép chọn database và schema theo connection*
* **Environment Tagging (Safety)**: Visual indicators for environments (e.g., Red/Orange badge for Production, Green badge for Dev/Test).
  * *Badge cảnh báo môi trường (Đỏ/Cam cho Production, Xanh lá cho Test/Dev).*

### 4.3 Left Navigation Panel / Menu chức năng bên trái
* Dynamically loaded list of registered BRAVO features.
  * *Danh sách các chức năng nghiệp vụ được nạp động từ các module đăng ký.*

### 4.4 Right Content Area / Vùng làm việc chính
* Modular container hosting the active feature’s UI and interaction workflows.
  * *Khung chứa linh hoạt nạp giao diện và luồng xử lý của tính năng được chọn.*

### 4.5 Bottom Status Bar / Thanh trạng thái đáy
* **Execution State**: Loading indicators, execution runtime (ms/s), and rows affected.
  * *Trạng thái thực thi: Loading indicator, thời gian xử lý và số dòng dữ liệu tác động.*
* **Explicit Execution Target**: Always display `Target: [Connection Name] -> [Database Name]` before running queries or mutations.
  * *Xác thực mục tiêu: Luôn hiển thị cụ thể chuỗi đích `Target: [Tên Connection] -> [Tên Database]` sẽ thực thi câu lệnh.*
* **Query Cancellation**: An interactive `Cancel` button bound to an active cancellation token.
  * *Nút `Cancel` hỗ trợ hủy khẩn cấp truy vấn đang chạy.*

### 4.6 Theming / Chủ đề giao diện
* Strictly sync with the active theme of `IDE sql` (Dark, Light, High Contrast).
  * *Kế thừa đồng bộ theo chủ đề (Theme) của `IDE sql`.*
* Reuse design tokens, controls, font families, and element spacing from `IDE sql`.
  * *Kế thừa hoàn toàn các design token, control, font chữ và quy chuẩn hiển thị của `IDE sql`.*

---

## 5. DATABASE CONNECTION & SESSION ISOLATION / QUẢN LÝ KẾT NỐI & PHÂN TÁCH SESSION

### 5.1 Independent Session Lifecycle / Phân tách phiên kết nối
* **Profile Sharing Only**: BRAVO inherits authentication and configuration profiles from `IDE sql`, but must NEVER share the raw physical `DbConnection` instance with active query editor tabs.
  * *Chỉ dùng chung Profile cấu hình: BRAVO kế thừa thông tin cấu hình từ `IDE sql`, tuyệt đối không dùng chung instance kết nối vật lý với các tab query của IDE sql để tránh xung đột khóa luồng.*
* **Isolated Client Session**: Each BRAVO window acquires an independent connection instance from the pool.
  * *Mỗi cửa sổ BRAVO khởi tạo và quản lý một instance kết nối độc lập từ connection pool.*
* **No Backward Auto-Switch**: If the user switches database/connection inside `IDE sql`, active BRAVO windows DO NOT auto-switch. BRAVO retains its own connection context.
  * *Không tự đổi theo IDE: Khi người dùng chuyển đổi connection/database trên giao diện chính của `IDE sql`, các cửa sổ BRAVO giữ nguyên trạng thái làm việc riêng, không tự động đổi theo.*

### 5.2 Form Initialization / Khởi tạo khi mở form
* On opening, BRAVO inherits the current active connection profile of `IDE sql` by default and connects immediately.
  * *Khi mở form, BRAVO ưu tiên kế thừa profile kết nối đang active tại `IDE sql` và thiết lập kết nối ngay.*

### 5.3 Fallback Workflows (No Active Connection) / Xử lý khi chưa có kết nối sẵn
If no active connection exists when opening BRAVO:
Nếu chưa có kết nối active tại thời điểm mở BRAVO:

* **Case 1: Select Existing Saved Connection / Chọn kết nối đã lưu**:
  * User selects a profile from the saved connection dropdown in BRAVO.
  * BRAVO connects to that profile AND updates the active connection state in the host `IDE sql` to match.
  * *Người dùng chọn connection đã lưu trong danh sách: BRAVO kết nối, đồng thời kích hoạt trạng thái active của connection đó trên `IDE sql`.*
* **Case 2: Create New Connection / Thêm mới kết nối**:
  * User triggers "Add Connection" from BRAVO.
  * BRAVO invokes the native "New Connection" dialog of `IDE sql`.
  * Upon successful creation and test, set this new connection as active in both BRAVO and `IDE sql`.
  * *Người dùng chọn thêm mới: Gọi form tạo connection chuẩn của `IDE sql`. Sau khi lưu thành công, tự động kích hoạt connection mới trên cả BRAVO và `IDE sql`.*

---

## 6. EXECUTION ENGINE & DATA SAFETY / CƠ CHẾ THỰC THI & AN TOÀN DỮ LIỆU

### 6.1 Asynchronous Execution / Xử lý bất đồng bộ
* All database interactions (queries, schema inspection, script execution) must run asynchronously via non-blocking tasks (`async`/`await`).
  * *Mọi thao tác database phải chạy bất đồng bộ (`async`/`await`), không gây đơ hoặc giật lag giao diện.*
* Every execution pipeline must be linked to a cancellable token (`CancellationToken`).
  * *Tất cả các luồng thực thi đều phải gắn với `CancellationToken` để có thể hủy bỏ khi người dùng yêu cầu.*

### 6.2 Mutation Safety / An toàn dữ liệu khi cập nhật
* **Target Confirmation**: Clear visual confirmation of the target connection and database before executing any Data Manipulation (DML) or Data Definition (DDL) operations.
  * *Hiển thị rõ ràng connection và database đích trước khi thực thi các lệnh DML/DDL.*
* **Safe Mode & Preview**: When generating schema changes or data modifications, provide a preview/diff view before applying commits to the database.
  * *Cung cấp chế độ xem trước thay đổi (Preview/Diff) trước khi chính thức áp dụng cập nhật vào database.*

---

## 7. MODULAR FEATURE ARCHITECTURE / KIẾN TRÚC MODULE MỞ RỘNG

To ensure loose coupling, sub-features must be registered dynamically via a standard contract:
Các chức năng con của BRAVO phải tuân thủ chuẩn đăng ký độc lập (Plug-and-Play), không sửa đổi cấu trúc khung:

### 7.1 Feature Registration Interface / Giao thức đăng ký tính năng
```typescript
interface IBravoFeatureModule {
  id: string;                      // Unique feature identifier / Định danh duy nhất
  displayName: string;             // Menu title / Tên hiển thị trên menu
  icon?: string;                   // Menu icon token / Icon hiển thị
  order: number;                   // Display sequence index / Thứ tự sắp xếp
  viewComponent: any;              // View/Component to mount in Right Panel / Component hiển thị bên phải
  onInitialize(context: any): void;// Startup logic / Khởi tạo dữ liệu
  onDestroy(): void;               // Teardown & cleanup / Hủy và giải phóng tài nguyên
}
```

### 7.2 Dynamic Discovery / Nạp module tự động
* The Left Navigation Panel scans the module registry and renders menu items dynamically based on the `order` property.
  * *Thanh menu trái tự động quét danh sách các module đã đăng ký và hiển thị giao diện theo thứ tự `order`.*
* New features are introduced by creating independent modules conforming to `IBravoFeatureModule` without altering the host frame logic.
  * *Chức năng mới được bổ sung bằng cách tạo module tuân thủ interface `IBravoFeatureModule` mà không cần can thiệp vào mã nguồn khung của BRAVO.*

---

## 8. AGENT IMPLEMENTATION DIRECTIVES / CHỈ DẪN CHO AI AGENT

When generating code or scaffolding features for BRAVO:
Khi sinh mã nguồn hoặc thiết kế các phân hệ cho BRAVO:

1. **Strict Context Boundaries**: Never share live `DbConnection` objects between editor tabs and BRAVO windows. Use connection factory/pooling mechanisms.
   * *Tuyệt đối không chia sẻ trực tiếp đối tượng `DbConnection` giữa tab editor và cửa sổ BRAVO. Sử dụng connection pooling.*
2. **State Isolation**: Never introduce global states that bleed between multiple BRAVO windows.
   * *Không dùng biến tĩnh (static/global) gây xung đột trạng thái giữa các cửa sổ BRAVO mở đồng thời.*
3. **Safety First**: Verify that every mutation feature explicitly displays the target connection and database before execution.
   * *Mọi tính năng có thao tác ghi/sửa dữ liệu phải hiển thị rõ ràng thông tin connection và database đích.*
4. **Feature Modularity**: Write sub-features as isolated components pluggable into `Workspace`, maintaining strict separation from core layout code.
   * *Mọi tính năng con phải được viết thành các component độc lập nạp vào vùng `Workspace` theo chuẩn interface đã định nghĩa.*
