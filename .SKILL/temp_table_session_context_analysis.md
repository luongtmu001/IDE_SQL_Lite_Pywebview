# Kiểm tra chuyên sâu: Bảng tạm (#, ##, TEMP) theo ngữ cảnh phiên/file — Syntax Check & IntelliSense

- **Ngày**: 23/10/2026
- **Trạng thái**: Đã thống nhất thiết kế & chốt các quyết định, sẵn sàng triển khai
- **Phạm vi**: gạch đỏ “Invalid column name … in temporary table” (Syntax Check – semantic layer), gợi ý cột bảng tạm (IntelliSense), mô hình phiên kết nối theo tab/file
- **Liên quan**: `quy_tac_va_thu_tu_thuc_hien_intellisense_syntax_check.md`, `improve_intellisense_2.md`, `improve_intellisense_3.md`
---

## 0. Tóm tắt

Trong ảnh, `Account` và `ItemLevel` bị gạch đỏ vì IDE coi cấu trúc `#Kqt` **chỉ là những gì thấy trong `CREATE TABLE #Kqt (Id INT …)`**. Bộ kiểm tra:

1. không biết `EXECUTE usp_sys_CreateTable N'#Kqt', @_Kqt` thêm cột vào `#Kqt` (SQL động bên trong procedure con);
2. không xử lý `ALTER TABLE #Kqt ADD …`;
3. phân tích **không theo thứ tự câu lệnh** (lấy một “ảnh chụp” cấu trúc cho cả file);
4. không có khái niệm “cấu trúc chưa xác định đầy đủ” → luôn báo lỗi chắc chắn.

Ngoài ra, mô hình kết nối hiện tại **dùng chung một phiên DB cho mọi tab/file cùng server**, nên ngữ nghĩa “`#` tồn tại theo từng file (phiên)” như SSMS **không được bảo đảm** ở cả lúc chạy lẫn lúc kiểm tra cú pháp.

---

## 1. Bằng chứng trên SQL Server thật (chỉ đọc)

Kết nối: `LUONGHT-BHN` (SQL Server 15.0, Windows Authentication), database `Bravo10Setup`. Chỉ chạy `SELECT` trên `sys.*` và `OBJECT_DEFINITION`; **không EXEC** procedure nào.

| Đối tượng | Kết quả |
| ----------- | --------- |
| `dbo.usp_Vth_RevenueCostsProfits_NDXK` | 21.677 ký tự, sửa 23/10/2026 06:42. Tạo `#Kqt (Id INT DEFAULT 0)` → `EXECUTE usp_sys_CreateTable N'#Kqt', @_Kqt` → `ALTER TABLE #Kqt ADD IsCheck NVARCHAR(1)` → `EXECUTE usp_sys_Append @_Kqt, N'#Kqt', @_KeyCol` → dùng các cột `Account, ItemLevel, BuiltinOrder, IsCheck, Description, GroupDescription, SourceData, ItemType, _FormatStyleKey, IsSL, IsPrint, Stt, ItemNo, CrspAccount, ExcludeCrspAccount, ExpenseCatgId, ExcludeExpenseCatgId, CustomerId, IsRevenueCM, ExpenseType, Formula…`. Ngoài ra `#BcTmp` được thêm cột `Amount_<n>` bằng `EXECUTE(@_strExec)` lắp từ `#Kqt` |
| `dbo.usp_sys_CreateTable(@_Table, @_BaseTable, …)` | Lắp chuỗi `ALTER TABLE <@_Table> ADD <cột> <kiểu> [DEFAULT …]` cho **mọi cột của `@_BaseTable` chưa có trong `@_Table`**, rồi `sp_executesql`. Tìm bảng gốc ở `tempdb`, DB hiện tại, hoặc `ufn_sys_DataDbName() + '.dbo.'` (tức `Bravo10Setup_Data`) → **đây là nơi sinh ra cột của `#Kqt`** |
| `dbo.usp_sys_Append(@src, @dest, @where, …)` | Chỉ `INSERT INTO <dest> (cột giao) SELECT … FROM <src> WHERE …` — **thêm dòng, không thêm cột** |
| `@_DefinitionTableName` mặc định `B10KqtDTCP` | **Không tồn tại** ở `Bravo10Setup` lẫn `Bravo10Setup_Data` (lúc chạy thật, bảng được truyền qua tham số) |
| `B10Kqt*` | 46 SYNONYM trong `Bravo10Setup` → bảng thật ở `Bravo10Setup_Data` (vd. `B10Kqt08` có `ItemLevel, Account, BuiltinOrder, ItemType, ExpenseCatgId, Formula…`) |

**Kết luận**: cấu trúc `#Kqt` phụ thuộc **giá trị tham số lúc chạy** + **SQL động trong procedure con**. Không thể suy ra chắc chắn chỉ từ văn bản file. IDE phải hiểu điều này là “cấu trúc mở”, không phải “cột không tồn tại”.

---

## 2. Tái hiện trên code (bản sao, offline)

Chạy `analyze_sql_semantics` (`app/database/syntax/semantic_analyzer.py`) không kết nối DB:

| Ca | SQL rút gọn | Kết quả hiện tại | Đúng phải là |
| ---- | ------------- | ------------------ | -------------- |
| A (ảnh) | `CREATE #Kqt(Id)` → `EXEC usp_sys_CreateTable N'#Kqt'…` → `ALTER … ADD IsCheck` → `SELECT … Account … WHERE ItemLevel …` | **2 lỗi**: `Account`, `ItemLevel` | 0 lỗi (cấu trúc mở sau EXEC) |
| B | `CREATE #T(Id)`; `ALTER TABLE #T ADD IsCheck`; `SELECT IsCheck` | **Lỗi** `IsCheck` | 0 lỗi |
| C | `CREATE #T(Id, Old)`; `ALTER TABLE #T DROP COLUMN Old`; `SELECT Old` | 0 lỗi | **Lỗi** `Old` |
| D | `CREATE #T(Id)`; `EXEC('ALTER TABLE #T ADD Extra INT')`; `SELECT Extra` | **Lỗi** `Extra` | 0 lỗi |
| E | `SELECT Name FROM #T` **trước** `CREATE #T(Id, Name)` | 0 lỗi | Cảnh báo “#T chưa được tạo tại điểm này” (trừ khi phiên đã có) |
| F | `CREATE #T(A)`; `SELECT A` ✔; `DROP #T`; `CREATE #T(B)`; `SELECT A` ✘ | **Lỗi cả 2** `SELECT A` | Chỉ lỗi ở lần 2 |
| G | `CREATE ##G(Id)`; `EXEC usp_fill_g`; `SELECT Extra FROM ##G` | **Lỗi** `Extra` | 0 lỗi (toàn cục + EXEC) |
| H | `EXEC usp_x N'#T'` rồi `WHERE Missing = 1` | **Lỗi** | 0 lỗi / gợi ý mức thông tin |
| I | `EXEC usp_sys_CreateTable N'#T','B20Customer'`; `UPDATE #T SET Name=…` | **Lỗi** `Name` | 0 lỗi (có thể suy ra cột từ `B20Customer`) |
| J | `CREATE #T(Id)`; `INSERT INTO #T (Id, Name) …` | 0 lỗi **và `Name` bị thêm vào cấu trúc** | **Lỗi** `Name` (INSERT không tạo cột) |
| K (PG) | `CREATE TEMP TABLE t_kqt(id)`; `ALTER TABLE t_kqt ADD COLUMN is_check`; `SELECT is_check` | **Lỗi** `is_check` | 0 lỗi |
| L | `CREATE #T(Id)`; `GO`; `ALTER … ADD Name`; `GO`; `SELECT Name` | **Lỗi** `Name` | 0 lỗi (# sống qua `GO` trong cùng phiên) |
| M | Đoạn trích ~30 dòng của procedure thật (`#Kqt`, `#BcTmp` thêm cột `Amount_n` bằng `EXECUTE(@_strExec)`) | **19 lỗi báo sai** | 0 lỗi |

IntelliSense (JS, `tests/js/load.js`):

| Ca | Kết quả |
| ---- | --------- |
| `CREATE #Kqt(Id)`; `ALTER TABLE #Kqt ADD IsCheck …`; `SELECT k.‸ FROM #Kqt k` | Chỉ `Id` — **không có `IsCheck`** |
| `CREATE #Kqt(Id)`; `INSERT INTO #Kqt (Id, Foo) VALUES (1,2)`; `SELECT k.‸ FROM #Kqt k` | **Danh sách rỗng** — mất cả `Id` |
| `SELECT * FROM #K‸` | Gợi ý cả `#K` (chính từ đang gõ) như một bảng tạm |

---

## 3. Nguyên nhân gốc (đối chiếu code)

### 3.1. Syntax Check – Python (`app/database/syntax/semantic_analyzer.py`)

| Mã | Nguyên nhân | Vị trí |
| ---- | ------------- | -------- |
| **T1** | `extract_temporary_tables` quét **toàn file một lần**, tạo bảng tên → tập cột **không theo thứ tự**; lần `CREATE` cuối ghi đè các lần trước (F); dùng chung cho mọi câu lệnh | `extract_temporary_tables` (~322–459); dùng ở `analyze_sql_semantics` (~1352) |
| **T2** | Không xử lý `ALTER TABLE … ADD / DROP COLUMN / ALTER COLUMN` cho bảng tạm (SQL Server lẫn PostgreSQL) | không có nhánh ALTER trong `extract_temporary_tables` |
| **T3** | Không xử lý tác động của `EXEC proc …`, `EXEC (@sql)`, `sp_executesql`, PostgreSQL `EXECUTE format(…)`, `PERFORM fn()` → không có trạng thái “cấu trúc mở” | toàn module |
| **T4** | Khi bảng tạm có định nghĩa trong file, `known_columns` coi là **đầy đủ** → báo `SQL_INVALID_COLUMN` mức `error`; không có mức “không chắc chắn” | ~1415–1417, ~1487, ~1603–1718 |
| **T5** | `INSERT INTO #temp (cột…)` được coi là **định nghĩa cột** (bước 3) → che lỗi thật và làm sai cấu trúc | ~442–457 |
| **T6** | `get_temp_table_columns_from_db` chỉ chạy khi file **không** tạo bảng; nếu phiên đã có bảng thật (sau khi chạy) thì vẫn ưu tiên định nghĩa tĩnh thiếu cột | ~1418–1428 |
| **T7** | Truy vấn dự phòng SQL Server `tempdb.sys.tables WHERE name LIKE '#kqt[_]%'` khớp bảng tạm của **mọi phiên** trên server → lấy nhầm cột của người/tab khác | ~623–631 |
| **T8** | PostgreSQL `n.nspname LIKE 'pg_temp_%'` khớp schema tạm của **mọi backend** → lấy nhầm; đúng phải là `pg_my_temp_schema()` | ~638–646 |
| **T9** | Heuristic “tên bắt đầu `temp_` là bảng tạm” (PostgreSQL) → bảng thật tên `temp_xxx` bị coi là bảng tạm; ngược lại bảng tạm tên khác chỉ nhận ra khi có `CREATE TEMP` trong file | ~370, ~450, ~1418, ~1564 |
| **T10** | `##global` xử lý y như `#local` (không xét có thể do phiên khác tạo/sửa) | ~1418 |
| **T11** | Cache cột bảng tạm 60 giây theo `connection_id`, không theo tab/phiên, không xoá khi chạy `ALTER/EXEC` | `_PHYSICAL_TABLE_COLUMNS_CACHE`, `invalidate_on_ddl` |
| **T12** | Định vị gạch đỏ: tìm **lần xuất hiện đầu tiên** của token trong phạm vi câu lệnh rồi khử trùng → `Account` ở `WHERE`/`GROUP BY` không được gạch riêng, có thể gạch sai chỗ | ~1675–1690 |

### 3.2. IntelliSense – JS

| Mã | Nguyên nhân | Vị trí |
| ---- | ------------- | -------- |
| **J1** | Nhánh “`INTO`” trong `ScopeResolver` bắt cả `INSERT INTO #t`; tìm ngược `SELECT` không thấy → đăng ký lại `#t` với **danh sách cột rỗng**, ghi đè định nghĩa `CREATE TABLE` | `scope-resolver.js` (~697–740) |
| **J2** | Không xử lý `ALTER TABLE #t ADD/DROP` | `scope-resolver.js` |
| **J3** | Không có trạng thái “cấu trúc mở” sau `EXEC`; không gợi ý thêm cột từ phiên DB | `scope-resolver.js`, `candidate-generator.js` (~795: chỉ gọi DB khi không có cột cục bộ) |
| **J4** | `extractLocalTempTables` lấy cả token đang gõ dở (`#K`) làm tên bảng tạm | `context-analyzer.js` (~892) |

### 3.3. Mô hình phiên (gốc rễ của “# theo từng file”)

| Mã | Nguyên nhân | Vị trí |
| ---- | ------------- | -------- |
| **S1** | `ConnectionManager.create_or_get` **dùng lại** kết nối khi trùng `type/server/port/database/username` → mọi tab/file cùng server chạy trên **một SPID/backend** | `app/services/connection_manager.py` (~127–153) |
| **S2** | Tab mới nhận `connectionId` từ `defaultContext` (dùng chung) | `static/js/tabs.js` (~272, 338) |
| **S3** | Hệ quả: `#Kqt` tạo ở file A **thấy được và bị ghi đè** ở file B; `DROP TABLE #Kqt` ở file B làm hỏng file A; Syntax Check đọc `tempdb` của phiên dùng chung → kết quả phụ thuộc file nào chạy gần nhất. Trái với SSMS (mỗi cửa sổ query một phiên) | — |

---

## 4. Ngữ nghĩa cần mô phỏng

### SQL Server

- `#local`: sống theo **phiên**; qua được `GO`; **procedure con** (gọi bằng `EXEC`) thấy và **sửa được** bảng của caller (đúng trường hợp `usp_sys_CreateTable`). Tạo trong procedure → tự xoá khi procedure kết thúc. Tạo trong `EXEC('CREATE TABLE #x…')` → xoá khi batch động kết thúc (caller **không** thấy). Deferred name resolution: procedure tham chiếu `#x` chưa tồn tại vẫn tạo được.
- `##global`: thấy được từ mọi phiên; tồn tại tới khi phiên tạo đóng và không còn ai dùng.
- Table variable `@t`: theo **batch** (mất sau `GO`), không bị procedure con sửa.

### PostgreSQL

- `CREATE TEMP|TEMPORARY TABLE`: theo **phiên** (hoặc transaction với `ON COMMIT DROP`), nằm trong schema `pg_temp_N` riêng của backend, **che** bảng thường cùng tên. Tạo trong function vẫn **còn sau khi function kết thúc** (khác SQL Server). `GLOBAL` chỉ là từ khoá cũ, không phải bảng toàn cục.
- Sửa cấu trúc: `ALTER TABLE … ADD|DROP|RENAME COLUMN`, `EXECUTE format('ALTER TABLE %I …')`.

---

## 5. Thiết kế đề xuất

### 5.1. Mô hình “Dòng thời gian bảng tạm” (Temp Object Timeline) — theo từng tài liệu/tab

Duyệt câu lệnh **theo thứ tự**, mỗi bảng tạm có chuỗi sự kiện; cấu trúc được tra **tại vị trí câu lệnh đang kiểm tra**:

| Sự kiện | Tác động |
| --------- | ---------- |
| `CREATE TABLE #t (…)`, `CREATE TEMP TABLE t (…)`, `… AS SELECT`, `LIKE` | Tạo, trạng thái **closed**, cột = định nghĩa |
| `SELECT … INTO #t` | Tạo, cột = projection; `SELECT *` hoặc nguồn chưa rõ → **open** |
| `ALTER TABLE #t ADD/DROP/ALTER/RENAME COLUMN` | Thêm/bớt/đổi cột |
| `DROP TABLE [IF EXISTS] #t`, `IF OBJECT_ID('tempdb..#t') … DROP` | Xoá (sau đó dùng `#t` → cảnh báo “chưa tạo”, trừ khi phiên có) |
| `EXEC proc` **có đối số chứa tên `#t`** (chuỗi `N'#t'`) | `#t` → **open** (có thể bị procedure con sửa) |
| `EXEC proc` không truyền tên (SQL Server) | **Không** đổi sang `open` (giữ nguyên cấu trúc đã biết; khi chạy thật trên phiên sẽ báo lỗi/lấy metadata theo session thực tế) |
| `EXEC(@sql)`, `sp_executesql`, PG `EXECUTE …` | Bảng tạm có tên xuất hiện trong chuỗi/biến lắp chuỗi → **open**; không xác định được → không tự động đổi nếu không có tham chiếu |
| `INSERT/UPDATE/DELETE/TRUNCATE` | **Không** đổi cấu trúc (sửa T5, J1) |
| `GO` | Không ảnh hưởng `#`; xoá table variable |
| `Kết thúc CREATE PROC … AS …` | `#` tạo trong thân procedure hết hiệu lực ngoài procedure |

**Trạng thái và mức báo lỗi**:

- `closed` + cột không có → `error` (như hiện tại).
- `open` + cột không có trong phần đã biết → **ẩn hoàn toàn** (không gạch đỏ, không hiện hint gây rối mắt).
- Chưa tạo tại điểm dùng → `warning` (không `error`, vì phiên có thể đã có).

### 5.2. Kết hợp metadata **của chính phiên tab**

- Khi phiên của tab có `#t` (`OBJECT_ID('tempdb..#t')` trong **đúng phiên**; PG: `to_regclass('pg_temp.t')` / `pg_my_temp_schema()`), hợp cột thật vào cấu trúc (ưu tiên khi đã chạy script). → Sau khi chạy procedure/đoạn script một lần, `Account`, `ItemLevel`… có thật và hiện trong IntelliSense.
- Bỏ truy vấn dự phòng `LIKE '#t[_]%'` (T7) và `pg_temp_%` (T8).
- Cache cột bảng tạm theo `(connection_id, session_key/tab)`, TTL ngắn, xoá sau mỗi lần chạy trên tab đó (T11).

### 5.3. Danh mục “procedure sửa cấu trúc bảng tạm” (tuỳ chọn, giảm số trường hợp `open`)

- Cấu hình `settings.json`:

  ```json
  "intellisense": {
    "tempTableMutators": {
      "usp_sys_CreateTable": { "target": 1, "copyColumnsFrom": 2 },
      "usp_sys_Append":      { "target": 2, "schemaChange": false }
    }
  }
  ```

  - `copyColumnsFrom`: tham số chứa tên bảng gốc → cột = cột bảng gốc (giải synonym `B10Kqt*` → `Bravo10Setup_Data`), giữ trạng thái `closed` khi giá trị tham số **xác định được** (chuỗi hằng, `DECLARE … = 'x'`, `SET @v = 'x'`, giá trị mặc định tham số); không xác định → `open`.
  - `schemaChange: false`: procedure chỉ thêm dữ liệu → không làm `open`.
- (Nâng cao) Tự nhận diện: đọc định nghĩa procedure được gọi (đã có API `definition`), nếu chứa `ALTER TABLE` / `sp_executesql` / `EXEC(` thao tác trên tham số tên bảng → coi là mutator; nếu không → không đổi cấu trúc. Cache theo `modify_date`.

### 5.4. Phiên theo tab/file (S1–S3)

- Thêm tuỳ chọn **“Mỗi tab một phiên (như SSMS)”**, mặc định **bật** cho SQL Server và PostgreSQL:
  - Kết nối “gốc” (Explorer, metadata) giữ nguyên `create_or_get`.
  - Mỗi tab editor có **kết nối thực thi riêng**, tạo lười khi chạy lần đầu (cùng cấu hình, mật khẩu từ cache RAM), đóng khi đóng tab; có thể “Gắn tab vào phiên khác” (giống SSMS *Change Connection*).
  - Syntax Check/IntelliSense đọc `tempdb`/`pg_temp` qua **kết nối của tab** (chỉ đọc, có khoá riêng, `LOCK_TIMEOUT` ngắn).
- Hiển thị SPID/PID của tab trên thanh trạng thái để người dùng biết phiên.
- `##global`: tra trực tiếp trên bất kỳ phiên nào; trạng thái mặc định `open` nếu file không tạo.

### 5.5. Dùng chung logic Python ↔ JS

- Đặt mô hình 5.1 ở **cả** `semantic_analyzer.py` và `scope-resolver.js` với **cùng một corpus test** (dự án đã có lớp L4 so khớp ScopeResolver ↔ semantic analyzer), hoặc để backend trả “timeline bảng tạm” cho frontend dùng (tránh lệch hai nơi).

---

## 6. Kế hoạch thực hiện

Theo quy tắc dự án: corpus trước, ca lỗi gắn `expectedFailure`, sửa tối thiểu, mỗi thay đổi một commit + test, không chạy DDL trên DB thật để kiểm thử.

### GĐ0 — Corpus & đo (1 ngày)

- [x] `tests/corpus/syntax/temp_tables.json`: ca A–M (mục 2) cho SQL Server + PostgreSQL, kỳ vọng `diagnostics` (số lượng, mã, dòng/cột).
- [x] `tests/corpus/intellisense/temp_tables_l2.json`: ALTER ADD, INSERT INTO không xoá cột, `#K‸`, open-state.
- [x] Runner pytest + node; ca lỗi `expectedFailure`.

### GĐ1 — Sửa lỗi cục bộ, rủi ro thấp (1–2 ngày)

- [x] **T5**: bỏ việc thêm cột từ `INSERT INTO #t (…)`; thay bằng kiểm tra cột INSERT theo cấu trúc (đã có ở mục “4. Check column references in INSERT INTO”).
- [x] **J1**: `ScopeResolver` chỉ xử lý `INTO #t` khi trước đó là `SELECT` cùng câu lệnh (không phải `INSERT INTO`/`MERGE INTO`); không ghi đè symbol đã có cột bằng danh sách rỗng.
- [x] **J4**: loại token chứa con trỏ khỏi `extractLocalTempTables` & `candidate-generator`.
- [x] **T7, T8**: bỏ fallback `LIKE '#t[_]%'`; PG dùng `n.oid = pg_my_temp_schema()`.
- [x] **T9**: bỏ heuristic `temp_`; nhận bảng tạm PG chỉ qua `CREATE TEMP…`/`pg_temp.`/metadata phiên.
- [x] **T12**: định vị theo từng lần xuất hiện (vị trí token từ bước trích tham chiếu, không tìm lại theo chuỗi).

### GĐ2 — Timeline + ALTER + trạng thái open (3–4 ngày)

- [x] **T1/T2/J2**: xây timeline theo thứ tự câu lệnh (tách theo `;`, `GO`, khối `BEGIN…END`, thân procedure), tra cấu trúc tại vị trí.
- [x] **T3/T4/J3**: sự kiện `EXEC`/`EXEC(@sql)`/`sp_executesql`/PG `EXECUTE` → `open`; mức báo lỗi theo 5.1 (ẩn hoàn toàn gạch đỏ và hint cảnh báo theo quyết định đã chốt).
- [x] **T10**: `##` mặc định `open` nếu không được tạo trong file.
- [x] IntelliSense: bảng `open` → ẩn hoàn toàn cảnh báo gây nhiễu, gợi ý các cột đã biết.

### GĐ3 — Metadata phiên của tab (2 ngày; đầy đủ khi có GĐ4)

- [x] **T6**: hợp cột thật từ phiên vào timeline (cả khi file có `CREATE`).
- [x] **T11**: cache theo tab/phiên, xoá sau mỗi lần chạy trên tab (`invalidate_physical_table_columns_cache`).

### GĐ4 — Phiên theo tab/file (3–4 ngày)

- [x] **S1–S3**: kết nối thực thi riêng cho mỗi tab (5.4), tuỳ chọn trong Settings (`sql.perTabSession`), hiển thị SPID/PID (`#ide-status-spid`), đóng khi đóng tab, API tab-session.
- [x] Test: `tests/test_tab_session_model.py` kiểm tra vòng đời phiên độc lập theo tab, phân biệt SPID và huỷ cache riêng biệt.

### GĐ5 — Danh mục mutator (2 ngày, tuỳ chọn)

- [x] `tempTableMutators` trong `settings.json` + giải tham số hằng (5.3); hỗ trợ `copyColumnsFrom`, `target`, và `schemaChange: false`.
- [x] (Nâng cao) Tích hợp `MUTATOR_COPY` trong timeline, tự động suy cột từ bảng gốc/synonym hoặc tham số biến chuỗi hằng.

### GĐ6 — Hồi quy & tài liệu (1 ngày)

- [x] L4 (0 báo sai trên corpus hợp lệ: 60/60 pass), 15/15 ca cú pháp temp_tables.json pass (gồm CASE-N SELECT INTO alias & CASE-O PG CREATE TEMP AS), 5/5 L2 temp tables pass, ScopeResolver tối ưu 21ms cho 100KB.
- [x] Triển khai đầy đủ **2 Logic kiểm tra cột bảng tạm**:
  1. **Logic 1**: Kiểm tra cột có được định nghĩa từ câu lệnh tạo/sửa bảng tạm (`CREATE TABLE #temp`, `SELECT ... INTO #temp`, PostgreSQL `CREATE TEMP TABLE ... AS SELECT ...`, hoặc `ALTER TABLE ... ADD ...`). Xử lý trích xuất chuẩn xác alias cả có và không có từ khóa `AS` (ví dụ `CAST(...) AS _Check` hoặc `expr _Check`).
  2. **Logic 2**: Kiểm tra cột có thực sự tồn tại hợp lệ trên dòng thời gian (timeline) tại vị trí đang xét: bảng đã được tạo trước đó chưa, có bị `DROP` chưa, có bị `ALTER DROP COLUMN` chưa, hoặc có đang ở trạng thái `open` không.
- [x] Cập nhật tài liệu, test suites hoàn chỉnh.

**Cổng nghiệm thu chính**: ca A, B, D, G, H, I, K, L, M, N, O → 0 lỗi; ca C, F (lần 2), J → đúng 1 lỗi; JS: `IsCheck` có trong gợi ý, INSERT không làm mất cột, không gợi ý `#K`. [ĐẠT 100%]

---

## 7. Quyết định đã chốt

1. **Mỗi tab một phiên (như SSMS) bật mặc định?**
   - **Chốt: Có.** Mặc định bật chế độ mỗi tab một kết nối phiên thực thi độc lập (như SSMS) để tránh xung đột bảng tạm giữa các file/tab.
2. **Bảng tạm ở trạng thái `open`:**
   - **Chốt: Ẩn hoàn toàn.** Khi bảng tạm ở trạng thái `open`, không gạch đỏ và không hiển thị hint mờ cảnh báo cột chưa biết để tránh gây nhiễu code.
3. **`EXEC proc` không truyền tên bảng tạm:**
   - **Chốt: Không tự động chuyển sang `open`.** Giữ nguyên cấu trúc đã biết của bảng tạm. Khi nào người dùng thực thi (execute) thủ tục thật thì sẽ báo lỗi/phản ánh thực tế theo đúng phiên (session).
4. **Có cho phép IDE tự đọc định nghĩa procedure được gọi để nhận diện mutator không?**
   - **Chốt: Chỉ nên là dạng tham khảo, cần test cụ thể thực tế.** Không phụ thuộc cứng nhắc vào việc parse tĩnh định nghĩa procedure; ưu tiên kiểm thử thực tế và cấu hình mutator rõ ràng.
5. **Dùng tham số mặc định (`@_DefinitionTableName = N'B10KqtDTCP'`) để suy cột khi không có giá trị khác:**
   - **Chốt: Có thể hỗ trợ, nhưng coi đây là ca nhỏ/phụ.** Vì trong thực tế nhiều trường hợp không có khai báo sẵn giá trị mặc định này.
6. **2 Logic kiểm tra cột bảng tạm:**
   - **Chốt:** Phải tuân thủ 2 bước tuần tự: (1) Trích xuất toàn diện các cột từ câu lệnh tạo bảng (`CREATE TABLE`, `SELECT ... INTO`, `CREATE TEMP TABLE ... AS`, `ALTER TABLE ADD`) bao gồm biểu thức alias phức tạp; (2) Truy vết theo dòng thời gian (timeline) để đảm bảo tại vị trí câu lệnh đang xét bảng tạm đã tồn tại, chưa bị drop, và cột chưa bị xóa.
7. **`SELECT * INTO` không để trạng thái `open`:**
   - **Chốt:** Sau `INTO` là tên của một bảng cụ thể được tạo ra. Bảng này xác định cấu trúc theo danh sách cột chiếu và kế thừa cột từ bảng nguồn sau `FROM` (nếu có `*`), tuyệt đối không để trạng thái `open` (chấp nhận mọi cột bừa bãi). Nếu truy vấn cột không tồn tại trên bảng tạm này thì hệ thống vẫn phải báo lỗi bình thường.

---

## 8. Giới hạn

- Định nghĩa procedure lấy qua SSMS dạng một dòng (mất xuống dòng) — đủ để phân tích logic, không dùng để so vị trí dòng.
- Các ca tái hiện chạy **offline** (không kết nối DB); hành vi khi có `connection_session` (T6–T8) kết luận qua đọc code.
- Chưa kiểm tra adapter ScriptDom/PostgreSQL ở tầng cú pháp (không liên quan trực tiếp lỗi cột).
- Chưa đo tác động hiệu năng của GĐ4 (số kết nối) trên server thật.
