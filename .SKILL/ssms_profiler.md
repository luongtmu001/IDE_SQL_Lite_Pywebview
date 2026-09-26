# Hướng Dẫn Kỹ Thuật: Xây Dựng SQL Server Trace Profiler Với Python & pywebview

Tài liệu này đóng vai trò là bản đặc tả kỹ thuật (Technical Specification & Implementation Guide) để Agent hoặc kỹ sư phần mềm triển khai công cụ giám sát SQL Server theo thời gian thực, mô phỏng SQL Server Management Studio (SSMS) Profiler.

---

## 1. Kiến Trúc Hệ Thống

Ứng dụng được thiết kế theo mô hình **4-Tier Pipeline** nhằm đảm bảo không thất thoát sự kiện (zero event loss) và duy trì hiệu năng 60 FPS:
[SQL Server] (Extended Events Session: Ring Buffer / TDS Stream)
│
▼
[Python Collector Thread] (pyodbc / pythonnet XELite)
│ (Đẩy dữ liệu qua thread-safe Queue)
▼
[Python Dispatcher Thread] (Gom cụm batch 50 items hoặc 100ms)
│ (evaluate_js với mảng JSON)
▼
[pywebview IPC Bridge]
│
▼
[Frontend UI (Tabulator)] (Virtual DOM + Client Filter Engine + Detail Pane)

# 2. Yêu Cầu Môi Trường & Thư Viện

### Python Runtime

* Python 3.10 trở lên.
* Các thư viện cần cài đặt:

  ```bash
  pip install pywebview pyodbc

Hệ quản trị: SQL Server 2012 trở lên với ODBC Driver (khuyến nghị ODBC Driver 17 hoặc 18 for SQL Server).

Quyền hạn tài khoản SQL: Cần tối thiểu quyền ALTER ANY EVENT SESSION và VIEW SERVER STATE.

1. Quy Trình Triển Khai Backend (app.py)
Agent triển khai file app.py với các module chức năng sau:

Module 1: Quản lý Vòng đời Extended Events Session
Khi khởi động ứng dụng: Tạo và kích hoạt Session với target package0.ring_buffer. Bắt buộc cấu hình mệnh đề WHERE để loại trừ chính ứng dụng (client_app_name <> 'PyWebViewProfiler').

Khi đóng ứng dụng (webview.start kết thúc hoặc trigger sự kiện closing): Dừng và drop session trên SQL Server để giải phóng RAM của server.

Module 2: Thu thập Dữ liệu (Collector Thread)
Chạy vòng lặp nền (daemon thread) đọc XML từ sys.dm_xe_session_targets.

Tối ưu hóa: Giữ một set seen_event_ids (kết hợp timestamp + session_id + event_name) để chống parse trùng lặp các event còn tồn lưu trong Ring Buffer.

Đẩy các dictionary sự kiện chuẩn hóa vào queue.Queue(maxsize=50000).

Module 3: Bộ Gom Cụm (Dispatcher Thread)
Lấy các phần tử từ event_queue.

Nếu số lượng gom đạt 50 items hoặc vượt quá 100ms từ lần gửi trước, tuần tự hóa (serialize) thành chuỗi JSON bằng json.dumps().

Gọi window.evaluate_js(f"window.ingestTraceBatch({json_str});").

1. Đặc Tả Tương Tác Frontend & IPC Contract
Frontend cần nhận mảng đối tượng JSON có cấu trúc sau:

TypeScript
interface TraceEvent {
  id: number;          // Định danh tăng dần
  time: string;        // Định dạng HH:mm:ss hoặc ISO
  event: string;       // sql_statement_completed | rpc_completed
  spid: number;        // Session ID
  db: string;          // Database name
  app: string;         // Client application name
  duration: number;    // Thời gian thực thi tính bằng ms
  sql: string;         // Nội dung truy vấn SQL đầy đủ
}
Yêu cầu hiển thị Frontend:
Virtual DOM: Bắt buộc sử dụng Tabulator chế độ renderVertical: "virtual" để chỉ dựng 30-40 node DOM hiển thị trên màn hình.

Bảng Điều Khiển Bộ Lọc (Filter Panel): Cho phép người dùng thêm các luật lọc (Column, Operator, Value) linh hoạt như SSMS Profiler (ví dụ: duration >= 100, db = 'ERP', sql not like '%sys%').

Auto-Scroll: Tự động cuộn xuống cuối khi có event mới, có công tắc bật/tắt (Toggle) để người dùng dừng lại kiểm tra query mà không bị giật trang.

Detail Split-Pane: Khi click vào dòng bất kỳ trên bảng, hiển thị toàn bộ câu lệnh SQL ở khung bên dưới với định dạng monospace.

1. Checklist Kiểm Thử (Verification)
[ ] Chống lặp vòng (Loopback Trace): Câu lệnh của chính ứng dụng lấy Ring Buffer không được xuất hiện trên bảng trace.

[ ] Chịu tải cao (Stress Test): Chạy vòng lặp phát sinh 500 query/giây trên SQL Server; giao diện vẫn cuộn mượt mà ở 60 FPS, không bị đơ chuột.

[ ] Bộ nhớ ổn định: Chạy liên tục trong 30 phút, RAM của WebView2 không vượt quá 300MB nhờ cơ chế cắt tỉa dữ liệu cũ (MAX_ROWS = 15000).

[ ] Dọn dẹp tài nguyên: Tắt cửa sổ ứng dụng đột ngột, kiểm tra SELECT * FROM sys.server_event_sessions đảm bảo session đã được DROP hoàn toàn.

## 3: Giao diện

thư mục _concept_ có 1 file html ssms_profiler.html
