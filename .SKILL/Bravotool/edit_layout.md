# SKILL SPECIFICATION: BRAVO LAYOUT XML EDITOR

# FILE: edit_layout.md

# PARENT MODULE: BRAVO tool (bravotools_overview.md)

---

## 1. CONTEXT & ARCHITECTURAL INTENT / BỐI CẢNH & MỤC TIÊU KIẾN TRÚC

* **Module Name**: Layout Editor / Soạn thảo Layout XML.
* **Scope**: Module con thuộc tiện ích BRAVO tool, kế thừa phiên kết nối độc lập từ `bravotools_overview.md`.
* **Purpose**: Trích xuất, phân tích, tìm kiếm, biên tập và cập nhật hàng loạt mã nguồn giao diện XML của hệ thống ERP BRAVO (Windows và Mobile) trực tiếp từ cơ sở dữ liệu.
* **Target Audience**: AI Agent Antigravity tuân thủ nghiêm ngặt các quy chuẩn truy vấn, phân tách metadata/payload, giải mã bộ nhớ đệm và giao dịch an toàn.

---

## 2. PLATFORM & VERSION MATRIX / MA TRẬN NỀN TẢNG & PHIÊN BẢN

| Nền tảng (Platform) | Phiên bản (Version) | Định dạng lưu trữ (Storage Format) | Hỗ trợ bản nháp (Draft Support) | Bảng dữ liệu chính |
| :--- | :--- | :--- | :--- | :--- |
| **Win App** | Bravo 7 | Plain-text XML (UTF-8) | Không (`LastLayoutData` = N/A) | `B00Layout`, `B00LayoutData`, `B00Command` |
| **Win App** | Bravo 8 | Plain-text XML (UTF-8) | Có (`LastLayoutData`) | `B00Layout`, `B00LayoutData`, `B00Command` |
| **Win App** | Bravo 10 | **Base64 String** (UTF-8) | Có (`LastLayoutData`) | `B00Layout`, `B00LayoutData`, `B00Command` |
| **Mobile App** | Bravo 8 | Plain-text XML (UTF-8) | Không | `B00StoryBoard` |
| **Mobile App** | Bravo 10 | **Base64 String** (UTF-8) | Có (`LastLayoutData`) | `B09Layout`, `B09LayoutData`, `B09Command` |

* **Selection Constraint**:
  * Khi người dùng chọn `Loại layout = Mobile`, dropdown `Phiên bản` chỉ hiển thị: **Bravo 8**, **Bravo 10**.
  * Khi người dùng chọn `Loại layout = Win`, dropdown `Phiên bản` hiển thị: **Bravo 7**, **Bravo 8**, **Bravo 10**.

---

## 3. SQL QUERY ENGINE & METADATA DECOUPLING / KIẾN TRÚC PHÂN TÁCH TRUY VẤN

Để tối ưu hóa RAM và băng thông mạng, tuyệt đối **không** dùng `SELECT *` chứa cột XML dung lượng lớn khi tải danh sách. Hệ thống phân tách thành 2 tầng truy vấn:

### 3.1 Metadata Query (Master Grid / Lưới danh sách)

Chỉ tải thông tin mô tả, trạng thái nháp và người dùng:

* **Win - Bravo 7**:

  ```sql
  SELECT l.Id, l.FormName, l.IsTemplate, l.CreatedBy, l.ModifiedAt, u.UserName AS ModifiedBy, 0 AS HasDraft
  FROM B00Layout AS l
  INNER JOIN B00LayoutData AS ld ON ld.Id = l.Id
  LEFT OUTER JOIN B00Command AS c ON c.CtorArg2 = l.FormName
  LEFT OUTER JOIN B00UserList AS u ON u.Id = l.ModifiedBy
