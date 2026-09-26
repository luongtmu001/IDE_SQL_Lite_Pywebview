Mục tiêu: Khắc phục triệt để hiện tượng giật/chớp khung trắng (white flash / flicker) khi khởi động ứng dụng pywebview. Đảm bảo cửa sổ chỉ xuất hiện khi giao diện HTML/CSS đã render hoàn chỉnh.

1. Chỉnh sửa file khởi tạo Python (Backend):

Tìm hàm webview.create_window(...).

Bổ sung tham số hidden=True để giữ cửa sổ ở trạng thái ẩn trong quá trình webview engine nạp tài nguyên.

Bổ sung tham số background_color khớp chính xác với mã màu chủ đạo của thanh tiêu đề/nền ứng dụng (ví dụ: #005fb8 cho màu xanh hoặc #1e1e1e cho dark mode).

(Tùy chọn tối ưu hóa): Nếu app dùng js_api, bổ sung hàm ready() vào class API để phía frontend có thể chủ động kích hoạt window.show().

1. Tối ưu hóa file HTML/CSS (Frontend):

Đặt màu nền background-color cho thẻ html và body trực tiếp bên trong thẻ <style> của <head> (Critical CSS), không để trong file CSS ngoài nhằm tránh render trễ.

Kiểm tra và xác minh:

Khởi chạy lại ứng dụng bằng lệnh chạy chính (python main.py hoặc tương đương).

Tiêu chí thành công: Cửa sổ xuất hiện tức thì với đầy đủ thanh menu và màu nền đồng bộ, hoàn toàn không xuất hiện khung trắng tạm thời hay hiện tượng tải giật cục.
