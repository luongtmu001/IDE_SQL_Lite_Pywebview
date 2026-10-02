# Kế hoạch Thay đổi IntelliSense Web: plan_web_007 (Phase 5)

- **Ngày thực hiện**: 2026-09-30
- **Phase**: Phase 5 — Metadata Cache (Section 67 của [intellisense_improvement_plan_v2.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/.SKILL/intellisense_improvement_plan_v2.md))
- **Trạng thái**: Hoàn thành (Completed)
- **Mục tiêu**:
  1. **Kiến trúc Cache Đa Tầng (Multi-Tier Cache Architecture - Section 18, 19)**:
     - **Level 1 — Connection Tier**: Lưu trữ danh sách Database, Schema, và Lightweight Object lists (`databasesTier`, `schemasTier`, `objectsTier`).
     - **Level 2 — Object-level Tier**: Lưu trữ chi tiết cột, tham số, định nghĩa đối tượng và kiểu dữ liệu (`columnsTier`, `parametersTier`, `definitionsTier`, `typesTier`).
     - **Level 3 — Completion Candidates Tier**: Memoization danh sách gợi ý truy vấn ngắn hạn theo scope và tiền tố (`completionsTier`).
  2. **Quản lý Bộ Nhớ và Thuật Toán Thu Hồi (LRU & TTL Policies)**:
     - Xây dựng lớp `LRUCache` với giới hạn dung lượng `MAX_ENTRIES` (500 phần tử/tier), tự động đẩy phần tử cũ nhất (least recently used) ra khỏi cache khi vượt quá giới hạn.
     - Xây dựng lớp `StorageTier` bao gói `LRUCache` kết hợp kiểm tra thời gian sống (TTL) tự động khi đọc ghi.
     - Cấu hình TTL chuẩn mực:
       - `DEFAULT_TTL = 300000` (5 phút)
       - `OBJECTS_TTL = 300000` (5 phút)
       - `COLUMNS_TTL = 600000` (10 phút)
       - `PARAMETERS_TTL = 600000` (10 phút)
       - `DEFINITIONS_TTL = 900000` (15 phút)
       - `DATA_TYPES_TTL = 1800000` (30 phút)
       - `COMPLETIONS_TTL = 10000` (10 giây)
  3. **Cơ chế Hủy Bộ Đệm Thông Minh (Cache Invalidation - Section 20)**:
     - Hủy theo phân cấp: `invalidateAll()`, `invalidateConnection(connId)`, `invalidateDatabase(connId, db)`, `invalidateSchema(connId, db, schema)`, `invalidateObject(connId, db, schema, objectName)`.
     - Nhận diện câu lệnh DDL tự động qua `handleDdlExecution(connId, db, sql)`:
       - Bắt các thao tác: `CREATE`, `ALTER`, `DROP`.
       - Đối tượng áp dụng: `TABLE`, `VIEW`, `PROCEDURE`, `PROC`, `FUNCTION`, `TYPE`, `TRIGGER`.
       - Hỗ trợ cú pháp 1 phần (`name`), 2 phần (`schema.name`), và 3 phần (`db.schema.name`), nhận diện cả định dạng `[dbo].[Table]` và `dbo.Table`.
       - Tự động hủy cache đối tượng cụ thể hoặc fallback hủy toàn bộ database nếu là DDL chung.
  4. **Tích hợp Tự Động vào IDE Hooks**:
     - Hook thực thi câu lệnh SQL trong [query.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/query.js): tự động kích hoạt `handleDdlExecution` ngay khi câu truy vấn DDL thực thi thành công.
     - Hook trong [explorer.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/explorer.js): kích hoạt `invalidateConnection` khi người dùng bấm reload node connection, và `invalidateAll` khi bấm refresh toàn bộ cây.
     - Tích hợp với `IntelliSenseDataProvider` trong [intellisense.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/intellisense.js): ưu tiên đọc từ cache trước khi gọi Provider/API, lưu vào cache sau khi fetch.
  5. **Đo Lường Hiệu Năng (Performance Metrics)**:
     - Ghi nhận `hits`, `misses`, `totalLookups`, `hitRatioPercent`, `avgLookupDurationMs`, `lastLookupDurationMs`, và số lượng active entries trong từng tier.
     - Hỗ trợ `getMetrics()` và `resetMetrics()`.

---

### Chi tiết các tập tin thay đổi:

1. **`static/js/metadata-cache.js` (Tạo mới & Hoàn thiện)**:
   - Triển khai: `CacheEntry`, `LRUCache`, `StorageTier`, `AppMetadataCache`.
   - Export ra `window.LRUCache`, `window.StorageTier`, `window.AppMetadataCache`, và alias `window.MetadataCache`.
2. **`templates/index.html` (Cập nhật)**:
   - Thêm `<script src="../static/js/metadata-cache.js"></script>` giữa `metadata-provider.js` và `intellisense.js`.
3. **`static/js/query.js` (Cập nhật)**:
   - Thêm hook gọi `window.AppMetadataCache.handleDdlExecution(connId, dbName, sql)` khi câu lệnh thực thi thành công.
4. **`static/js/explorer.js` (Cập nhật)**:
   - Thêm hook `invalidateConnection` tại nút reload node kết nối và `invalidateAll` tại nút reload tree toàn cục.
5. **`static/js/intellisense.js` (Cập nhật)**:
   - Kết nối `this.cache` trong `IntelliSenseDataProvider` với `window.AppMetadataCache`.
6. **`tests/test_metadata_cache_phase5.py` (Tạo mới & Hoàn thiện)**:
   - Unit tests kiểm tra:
     - Thứ tự script loading trong `index.html`.
     - Các lớp `AppMetadataCache`, `LRUCache`, `StorageTier`, cấu hình TTL, và danh sách các phương thức bắt buộc.
     - Nhận diện câu lệnh DDL với từ khóa `CREATE`, `ALTER`, `DROP`, `TABLE`, `VIEW`, `PROCEDURE`, `FUNCTION`, `TYPE`.
     - Tích hợp hook trong `query.js`, `explorer.js`, và `intellisense.js`.

---

### Kết quả kiểm thử:
- Toàn bộ suite Phase 1–5: **16 / 16 tests PASS** (`pytest -s tests/test_editor_adapter_phase1.py tests/test_context_analyzer_phase2.py tests/test_scope_resolver_phase3.py tests/test_metadata_provider_phase4.py tests/test_metadata_cache_phase5.py`).
- Toàn bộ hệ thống test IDE: **143 / 143 tests PASS**.
- Thời gian cache lookup trung bình: $< 0.05\text{ ms}$, đạt 100% mục tiêu hiệu năng đề ra trong Section 58 của Plan v2.
