# Kế hoạch chi tiết: Cải thiện IntelliSense gợi ý Cross-Database trên cùng Server (SQL Server)

> **Phạm vi khảo sát & áp dụng**: Chỉ SQL Server (`sqlserver`, `mssql`, `tsql`). Không ảnh hưởng đến PostgreSQL hay SQLite.
> **Quyết định đã thống nhất**:
> 1. **Gợi ý database ngay lập tức** trong mệnh đề `FROM`, `JOIN`, `UPDATE`, `INSERT INTO`, `EXEC`, `USE` (không cần đợi gõ qualifier).
> 2. **Không ẩn các database hệ thống** (`master`, `model`, `msdb`, `tempdb`), nhưng gán mức độ ưu tiên thấp hơn các bảng thông thường và User Database.
> 3. **Không gợi ý bảng của database khác khi chưa gõ qualifier** (giữ cơ chế lazy qualifier-driven: gõ `DbName.` mới nạp và gợi ý schema/object của DB đó để tối ưu hiệu năng và tránh rác danh sách).

---

## 1. Tổng quan & Các điểm nghẽn hiện tại (Root Causes)

Hiện tại, IntelliSense chỉ gợi ý **Linked Server** khi gõ nhiều phần (`Server.Db.Schema.Table`) mà bỏ quên trường hợp **Cross-Database nội bộ trên cùng Server** (`Db.Schema.Table` hoặc `Db..Table`):

| # | Điểm nghẽn | Vị trí mã nguồn | Hậu quả |
|---|---|---|---|
| **G1** | `qParts.length === 1`: Chỉ kiểm tra `_getLinkedServers()` | [candidate-generator.js:L1155-L1175](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/candidate-generator.js#L1155-L1175) | Gõ `OtherDb.` không nhận diện được database local, không ra danh sách Schema của `OtherDb`. |
| **G2** | `qParts.length === 2`: Mặc định hiểu là `[LinkedServer].[Db]` | [candidate-generator.js:L1135-L1154](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/candidate-generator.js#L1135-L1154) | Gõ `OtherDb.dbo.` bị đẩy vào API Linked Server `linked_server/schemas` với `server=OtherDb` $\rightarrow$ kết quả rỗng. |
| **G3** | `qParts.length === 3`: Mặc định hiểu là `[LinkedServer].[Db].[Schema]` | [candidate-generator.js:L1112-L1134](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/candidate-generator.js#L1112-L1134) | Gõ `OtherDb.dbo.TableName.` bị đẩy vào `linked_server/objects` thay vì lấy danh sách Cột của bảng `TableName`. |
| **G4** | Chưa gợi ý Database trong danh sách Unqualified | [candidate-generator.js:L1369-L1458](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/candidate-generator.js#L1369-L1458) | Khi ở `FROM `, `JOIN `, chỉ gợi ý Linked Server + Schema hiện tại, người dùng không thấy danh sách database cùng server để chọn. |
| **G5** | Lấy cột của bảng local bị hardcode `tabCtx.database` | [candidate-generator.js:L259-264, L751, L825, L981-986, L2042-2053](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/candidate-generator.js#L981-L986) | Khi viết `FROM OtherDb.dbo.Employee e WHERE e.`, bảng đã nhận diện đúng `database = 'OtherDb'`, nhưng khi fetch cột lại truyền `tabCtx.database` (database đang active) $\rightarrow$ `e.` không ra cột hoặc ra sai. |
| **G6** | **Bug Contract API Frontend - Backend** | [metadata-provider.js:L119-L142](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/metadata-provider.js#L119-L142) vs [routes/metadata.py:L12-L50](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/app/routes/metadata.py#L12-L50) | Backend trả về `data.items`, nhưng `ProjectMetadataAdapter.getDatabases/getSchemas` lại đọc `data.databases` / `data.schemas` $\rightarrow$ luôn trả về mảng rỗng `[]`. |
| **G7** | `IntelliSenseDataProvider` thiếu method getDatabases/getSchemas | [intellisense.js:L70-L415](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/intellisense.js#L70-L415) | Engine gọi qua `this.dataProvider`, nhưng dataProvider không ủy quyền `getDatabases`/`getSchemas` sang provider/cache. |
| **G8** | `list_databases` không lọc database Offline / Không có quyền | [sqlserver.py:L501-L511](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/app/database/sqlserver.py#L501-L511) | Truy vấn `sys.databases` lấy tất cả DB, khi user gõ trúng DB offline hoặc không có quyền truy cập (`HAS_DBACCESS = 0`) sẽ gây exception khi truy vấn metadata. |
| **G9** | Tooltip / Definition panel không nhận diện database khác | [intellisense.js:L843, L872, L1021](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/intellisense.js#L843) | Khi hover/preview object thuộc database khác, detail fetch bằng `tabCtx.database` làm mất thông tin cột/parameters. |
| **G10** | Xử lý cú pháp hai dấu chấm liên tiếp `Db..Table` | [context-analyzer.js:L2565-L2595](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/context-analyzer.js#L2565-L2595) | TSQL hỗ trợ default schema `dbo` qua cú pháp `OtherDb..Table`. Cần đảm bảo `schema` rỗng tự động fallback về `dbo`. |

---

## 2. Thiết kế giải pháp kỹ thuật

### 2.1 Ma trận phân giải Qualifier (Multi-part Resolution Matrix)

Quy tắc phân giải theo số lượng phân đoạn trước dấu chấm (`qualifierParts`):

```
Người dùng gõ         qParts              Phân giải (Theo thứ tự ưu tiên SQL Server)
-----------------   -----------------   --------------------------------------------------------------
[A].                ['A']               1. A là Alias/Bảng trong truy vấn -> Cột của A
                                        2. A là Schema trong DB hiện tại -> Objects thuộc Schema A
                                        3. A là Database cùng Server -> Schemas thuộc Database A
                                        4. A là Linked Server -> Remote Databases của A

[A].[B].            ['A', 'B']          1. A là Schema, B là Bảng -> Cột của [A].[B]
                                        2. A là Database local:
                                           - B có giá trị -> Objects trong Database A, Schema B
                                           - B rỗng (A..) -> Objects trong Database A, Schema 'dbo'
                                        3. A là Linked Server -> Remote Schemas của [A].[B]

[A].[B].[C].        ['A', 'B', 'C']     1. A là Database local:
                                           - Bảng C trong Schema B (hoặc 'dbo' nếu B rỗng), Database A -> Cột của C
                                        2. A là Linked Server -> Remote Objects của [A].[B].[C]

[A].[B].[C].[D].    ['A', 'B', 'C', 'D'] 1. A là Linked Server -> Remote Columns của [A].[B].[C].[D]
```

### 2.2 Phân loại & Mức độ ưu tiên (Ranking & Priority Levels)

Theo yêu cầu thống nhất:
1. **User Databases**: Hiển thị ngay trong mệnh đề `FROM`, `JOIN`, `UPDATE`, `INSERT INTO`, `EXEC`, `USE`.
   - `level: 2.0` (sau bảng active DB `1.0` và schema active DB `1.5`, nhưng đứng trước Linked Server `2.2`).
   - `displayType: 'Database'`
   - `icon: 'fa-database text-primary'`
   - `insertText`: `[DbName].` (đóng ngoặc vuông chuẩn identifier).
   - Nếu là database hiện tại (`tabCtx.database`), gắn thêm detail `(current)`.
2. **System Databases** (`master`, `model`, `msdb`, `tempdb`):
   - Không bị ẩn.
   - `level: 2.8` (đứng sau bảng, schema, user databases, linked servers).
   - `displayType: 'System Database'`
   - `icon: 'fa-database text-muted'`
   - Ranker gắn điểm phạt nhẹ để không lấn át các bảng làm việc chính.

---

## 3. Lộ trình thực hiện chi tiết (Phases)

### Phase 1: Sửa lỗi Contract & Hoàn thiện Data Pipeline (Backend + Provider) - [COMPLETED]
- **Tập tin**:
  - [app/routes/metadata.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/app/routes/metadata.py)
  - [app/database/sqlserver.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/app/database/sqlserver.py)
  - [static/js/metadata-provider.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/metadata-provider.js)
  - [static/js/intellisense.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/intellisense.js)
- **Công việc**:
  1. **Fix G6**: Cập nhật `ProjectMetadataAdapter.getDatabases` và `getSchemas` trong `metadata-provider.js`:
     ```javascript
     const items = data.items || data.databases || [];
     ```
  2. **Cập nhật SQL Server list_databases (G8)**:
     - Thêm cờ `accessible_only=True` khi gọi từ IntelliSense:
     ```sql
     SELECT name, state_desc,
            CASE WHEN name IN ('master', 'model', 'msdb', 'tempdb') THEN 1 ELSE 0 END AS is_system
     FROM sys.databases
     WHERE state = 0 AND HAS_DBACCESS(name) = 1
     ORDER BY is_system ASC, name ASC
     ```
  3. **Bổ sung API methods vào `IntelliSenseDataProvider` (G7)**:
     - Thêm `getDatabases(connId, dbType)` và `getSchemas(connId, database, dbType)` hỗ trợ cache qua `AppMetadataCache`.
     - Lưu trữ flag `is_system` cho từng database để phục vụ ranking.

### Phase 2: Nâng cấp Candidate Generator (Cross-Database Resolution) - [COMPLETED]
- **Tập tin**:
  - [static/js/candidate-generator.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/candidate-generator.js)
- **Công việc**:
  1. **Hàm trợ năng `_getServerDatabases(connId, dbType)`**:
     - Lấy danh sách database từ `metadataCache.getDatabases(connId)` hoặc `dataProvider.getDatabases(connId)`.
  2. **Gợi ý Unqualified Database (G4 - Quyết định 1 & 2)**:
     - Trong `_generateUnqualifiedObjectCandidates`:
     - Nếu là `isSqlServer` và ở các ngữ cảnh `FROM`, `JOIN`, `INSERT INTO`, `UPDATE`, `DELETE`, `MERGE`, `EXEC`, hoặc `USE`:
     - Lấy danh sách local databases. Tạo candidates với:
       - User DB: `level: 2.0`, `displayType: 'Database'`
       - System DB: `level: 2.8`, `displayType: 'System Database'`
       - `insertText`: `formatInsertText(db.name, 'database') + '.'` (riêng `USE` thì insertText chỉ là `formatInsertText(db.name, 'database')`).
  3. **Phân nhánh Qualifier 1-part, 2-part, 3-part (G1, G2, G3, G10)**:
     - Trong `_generateQualifierCandidates`:
     - **1-part (`OtherDb.`)**:
       - So khớp `OtherDb` với danh sách Server Databases. Nếu khớp $\rightarrow$ nạp Schemas của `OtherDb` (`dataProvider.getSchemas(connId, 'OtherDb')`), tạo candidates schema với insertText `[Schema].`.
     - **2-part (`OtherDb.dbo.` hoặc `OtherDb..`)**:
       - Nếu Part 0 là Server Database $\rightarrow$ nạp Objects của database `Part 0`, schema `Part 1 || 'dbo'`. Lọc đúng ngữ cảnh (nếu `EXEC` chỉ nạp procedure; nếu `FROM/JOIN` nạp table/view/function).
     - **3-part (`OtherDb.dbo.TableName.` hoặc `OtherDb..TableName.`)**:
       - Nếu Part 0 là Server Database $\rightarrow$ nạp Columns của table `Part 2` trong database `Part 0`, schema `Part 1 || 'dbo'`.

### Phase 3: Sửa lỗi truyền Database cho Columns & Alias Map (G5, G9) - [COMPLETED]
- **Tập tin**:
  - [static/js/candidate-generator.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/candidate-generator.js)
  - [static/js/context-analyzer.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/context-analyzer.js)
  - [static/js/intellisense.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/intellisense.js)
- **Công việc**:
  1. **Sửa toàn bộ điểm hardcode `tabCtx.database` khi lấy cột**:
     - `context-analyzer.js`: Lưu trữ `server` và `database` trong `extractAliases` (FROM, JOIN, INSERT, UPDATE) và `extractAllTablesInQuery`. Hỗ trợ cú pháp 2 dấu chấm `Db..Table`.
     - Thay thế `tabCtx.database` bằng `targetDatabase = (resolvedObject && resolvedObject.database) || tbl.database || tabCtx.database` tại các vị trí:
       - Star expansion (`expandStarColumns`)
       - Subquery underlying tables
       - Table hints / column fetch
       - Local symbols / CTE
       - Section A Qualified columns (`e.Column`)
       - Foreign Key / JOIN ON condition matching (`rightTable.database`, `pt.database`, `lt.database`)
  2. **Chi tiết đối tượng trong Detail Panel (G9)**:
     - Truyền `item.database || tabCtx.database` vào các hàm `fetchColumns`, `fetchParameters`, `fetchDefinition`.

### Phase 4: Ranking & Giao diện (Completion Ranker & UI) - [COMPLETED]
- **Tập tin**:
  - [static/js/completion-ranker.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/completion-ranker.js)
  - [static/js/intellisense.js](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/static/js/intellisense.js)
- **Công việc**:
  1. Trong `completion-ranker.js`:
     - Giữ `database` có boost nhẹ khi ở vị trí đầu table source trong FROM, JOIN, INSERT INTO, UPDATE (+65 điểm).
     - System DB (`master`, `model`, `msdb`, `tempdb`) bị phạt 30 điểm (+35 điểm so với +65 của User DB).
     - Mệnh đề `USE`: Gán ưu tiên tối đa cho `database` (+120 điểm User DB, +85 điểm System DB).
     - Mệnh đề `EXEC`: Gán ưu tiên cho `database` (+70 điểm User DB, +40 điểm System DB).
  2. Trong `intellisense.js`:
     - Biểu tượng `type === 'database'` $\rightarrow$ `fa-database text-primary` (User DB) hoặc `fa-database text-secondary` (System DB).
     - Đăng ký `database` và `schema` trong `ICON_MAP` và `formatDisplayType`.
     - Preview script template cho Database:
       ```sql
       -- Database: [DbName]
       USE [DbName];
       GO
       
       -- Or cross-database query:
       SELECT * FROM [DbName].[dbo].[table_name];
       ```

### Phase 5: Kiểm thử tự động & Kịch bản nghiệm thu - [COMPLETED]
- **Tập tin**:
  - [tests/test_cross_database_intellisense.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/tests/test_cross_database_intellisense.py) (đã tạo mới, 4/4 tests passed)
  - [tests/test_linked_server_intellisense.py](file:///d:/Luong/NB_Personal/Python/IDE-SQL-Lite_New_Pyweb_Claude/tests/test_linked_server_intellisense.py) (kiểm tra hồi quy, 9/9 tests passed)
- **Kết quả nghiệm thu**:
  - Toàn bộ 13/13 test cases đều PASSED (2.45s).
  - Không gây hồi quy hay ảnh hưởng đến tính năng Linked Server đã có trước đó.
  - Mã nguồn bảo toàn toàn bộ logic của PostgreSQL và SQLite.
