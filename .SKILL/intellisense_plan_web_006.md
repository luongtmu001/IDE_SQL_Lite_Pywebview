# Kế hoạch Thay đổi IntelliSense Web: plan_web_006 (Phase 4)

- **Ngày thực hiện**: 2026-09-30
- **Phase**: Phase 4 — Metadata Adapter (Section 66 của [intellisense_improvement_plan_v2.md](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/.SKILL/intellisense_improvement_plan_v2.md))
- **Trạng thái**: Hoàn thành (Completed)
- **Mục tiêu**:
  1. **Chuẩn hóa MetadataProvider Interface ([metadata-provider.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/metadata-provider.js))**:
     - Định nghĩa lớp cơ sở `MetadataProvider` theo Section 15 của Plan v2 với đầy đủ tham số `connectionId`.
     - Cung cấp các phương thức hợp đồng chuẩn:
       - `getDatabases(connectionId)`
       - `getSchemas(connectionId, database)`
       - `getTables(connectionId, database, schema)`
       - `getViews(connectionId, database, schema)`
       - `getColumns(connectionId, database, schema, table)`
       - `getProcedures(connectionId, database, schema)`
       - `getFunctions(connectionId, database, schema)`
       - `getSynonyms(connectionId, database, schema)`
       - `getParameters(connectionId, database, schema, name)`
       - `getDefinition(connectionId, database, schema, name, type)`
       - `getSupportedTypes(connectionId, database)`
  2. **Concrete Adapter & Dialect Providers (Section 16, 17 & 66)**:
     - `ProjectMetadataAdapter`: Tận dụng trực tiếp các API backend sẵn có của dự án (`/api/metadata/...`), không duplicate code query backend.
     - `SqlServerMetadataProvider`: Chuyên biệt cho SQL Server, xử lý quoting dạng `[identifier]`, system catalog compatibility.
     - `PostgresMetadataProvider`: Chuyên biệt cho PostgreSQL, xử lý quoting dạng `"identifier"`, schema mặc định `public`.
     - `MetadataProviderFactory`: Quản lý đăng ký kết nối (`registerConnection`), nhận diện dialect (`getDbTypeForConnection`), và cung cấp instance provider tương ứng (`getProviderForConnection`).
  3. **Tích hợp liền mạch với IntelliSense Controller**:
     - `IntelliSenseDataProvider` trong [intellisense.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/static/js/intellisense.js) kết nối trực tiếp với `MetadataProviderFactory` để fetch dữ liệu thay vì gọi API ad-hoc.
  4. **Kiểm thử tự động**:
     - Tạo [test_metadata_provider_phase4.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb/tests/test_metadata_provider_phase4.py) kiểm tra cấu trúc class, chữ ký phương thức, thứ tự script trong `templates/index.html`, và dialect identifier quoting.

---

### Chi tiết các tập tin thay đổi:

1. **`static/js/metadata-provider.js` (Tạo mới)**:
   - Triển khai `MetadataProvider`, `ProjectMetadataAdapter`, `SqlServerMetadataProvider`, `PostgresMetadataProvider`, `MetadataProviderFactory`.
2. **`templates/index.html` (Cập nhật)**:
   - Thêm `<script src="../static/js/metadata-provider.js"></script>` vào đúng thứ tự nạp trước `intellisense.js`.
3. **`static/js/intellisense.js` (Cập nhật)**:
   - Kết nối `IntelliSenseDataProvider` với `MetadataProviderFactory.getProviderForConnection(connectionId)`.
4. **`tests/test_metadata_provider_phase4.py` (Tạo mới)**:
   - Kiểm tra interface contracts, connectionId signatures, dialect quoting, và thứ tự load script.

---

### Kết quả kiểm thử:
- `pytest -s tests/test_metadata_provider_phase4.py`: **3 / 3 tests PASS**.
