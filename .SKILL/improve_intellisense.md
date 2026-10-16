# Kế hoạch tổng thể – Tối ưu IntelliSense và Kiểm tra cú pháp

Kế hoạch này gộp bộ quy tắc kiểm thử, kế hoạch cải tiến `context-analyzer.js` / `completion-engine.js` và các phát hiện về validator thành **một lộ trình duy nhất chỉ cho IntelliSense và Syntax Check** (SQL Server, PostgreSQL). Nguyên tắc: **sửa tại chỗ, không đập đi xây mới; phần đã tốt giữ nguyên; thay đổi công nghệ nêu riêng ở mục 6.** Ước lượng giai đoạn 0–6: khoảng 32–40 ngày công của một người.

## 1. Phạm vi

| Trong phạm vi | Ngoài phạm vi (không nằm trong kế hoạch này) |
| --- | --- |
| Frontend: `context-analyzer.js`, `completion-engine.js`, và một phần nhỏ `scope-resolver.js`, `intellisense.js`, `metadata-cache.js`, `metadata-provider.js`, `syntax-check/*` (service, position-mapper) | Bảo mật dữ liệu và `run_program`, Table Designer, tách `main.py` |
| Backend: `app/database/syntax/*` (`validator.py`, coordinator, adapter, `semantic_analyzer.py`), `MainApi.syntax_check` | Tính năng mới (so sánh schema, trợ lý AI, ...), ký số, cập nhật, tách Bravo |

Chi tiết từng mục nằm ở hai tài liệu: «Bộ quy tắc kiểm thử IntelliSense và Syntax Check» và «Kế hoạch cải tiến context-analyzer.js và completion-engine.js». Phần ngoài phạm vi vẫn còn trong «Kế hoạch chỉnh sửa theo phase».

## 2. Hiện trạng

**Hai luồng**

- **IntelliSense**: gõ → `intellisense.js` (popup) → `SqlContextAnalyzer.analyze` (tokenizer + `ScopeResolver`) → `CompletionEngine.getCompletions` (Generator → Filter → Ranker, cache mức 3) → áp dụng gợi ý bằng `replacementRange` của context.
- **Syntax check**: gõ → `syntax-check-service.js` (debounce 500 ms, `AbortController`, request id) → `MainApi.syntax_check` → `validator.validate_sql` (bản cũ: `sqlglot` + SQL Server `PARSEONLY` / PostgreSQL `BEGIN … ROLLBACK`) → `position-mapper.js` vẽ gạch chân. Pipeline mới (coordinator → ScriptDom / adapter PG / `semantic_analyzer`) **chỉ route Flask gọi**, app desktop chưa dùng.

**Đã làm tốt, giữ nguyên**

- Phân tích theo token, tách comment/chuỗi, qualifier nhiều phần, định danh có quote, tách câu lệnh T-SQL không dấu chấm phẩy, `GO`, `DO $$`. Fuzz 2.239 vị trí con trỏ: 0 exception, tối đa 24,6 ms.
- `CandidateFilter` (chính xác → tiền tố → sub-word → chuỗi con → mờ, Unicode NFC), `CompletionRanker`, quote định danh theo dialect, gợi ý JOIN/ON theo foreign key, mở rộng `*`, signature help, cache metadata nhiều tầng có xóa theo DDL.
- Tách `GO` đúng ở các ca chính (12/12); bộ tách và kiểm tra của SQL Server dùng `PARSEONLY` (không thực thi).

**Vấn đề cần cải tiến** (mã cũ trong ngoặc; bảng đối chiếu ở mục 9)

| Mã | Vấn đề | Bằng chứng | Mức |
| --- | --- | --- | --- |
| S1 (F1) | Kiểm tra cú pháp online của PostgreSQL **thực thi SQL đang gõ** | `validate_postgresql` chạy `BEGIN; <SQL>; ROLLBACK;` mỗi lần ngừng gõ 500 ms trên kết nối của người dùng; `nextval`, advisory lock, `dblink` không rollback; DDL giữ khóa mạnh; `ROLLBACK` có thể hủy transaction người dùng đang mở; `SET search_path` bị để lại | Nghiêm trọng |
| S2 (F7) | Kiểm tra SQL Server có tác dụng phụ và không xác định | `USE [db]` không khôi phục, lỗi bị nuốt; khóa bận quá 0,8 s thì chuyển sang `sqlglot` (cùng SQL có thể ra kết quả khác nhau); nhánh regex `Invalid column/object name` không bao giờ khớp dưới `PARSEONLY` | Cao |
| S3 (F2) | Pipeline mới chưa nối vào app desktop | `main.py:3557` vẫn gọi `validate_sql`; coordinator nuốt lỗi semantic ở mức debug | Cao |
| S4 (F3) | Semantic báo sai 6/40 SQL hợp lệ | `EXISTS`/`NOT EXISTS` tương quan, `WITHIN GROUP`, `WITH (NOLOCK)` sau `AS alias`, subquery vô hướng, hai schema trùng tên bảng | Cao |
| S5 (F5) | Semantic bỏ sót 7/20 lỗi | Bảng dẫn xuất, `ORDER BY`/`GROUP BY`, alias không tồn tại, `UPDATE SET`, `INSERT` cột sai | Cao |
| S6 (F4) | Cache cột sai phạm vi | Khớp bảng theo tên cuối (bỏ qua schema); cache tiến trình không có connection id và không bao giờ xóa → cột mới thêm bằng `ALTER TABLE` bị báo sai đến khi khởi động lại | Cao |
| S7 (F6) | Kiểm tra cấu trúc PG offline sai 7/16 | `$$` trong chuỗi/comment bị báo lỗi; hàm lồng hai tag bị báo sai; `BEGIN` thiếu `END` bị che bởi `END IF`/`END LOOP`/`CASE … END` | Cao |
| S8 (F13) | Vị trí gạch chân | Python đếm code point, JS/Monaco đếm UTF-16 (lệch 1 cột mỗi emoji); `expandTokenRange` chỉ nhận ASCII nên `Khách_hàng` chỉ gạch 2 ký tự khi không có `token` | Trung bình |
| I1 (G1) | `analyze` token hóa **toàn bộ tài liệu 7 lần** mỗi lần gọi | 10 KB = 90 ms, 54 KB = 208 ms, 218 KB = 733 ms; tokenizer chiếm khoảng 84% | Cao |
| I2 (G2) | Dấu câu bị coi là từ hiện tại | `analyze` dòng 1810–1830; `INSERT INTO t (‸)`, `CONVERT(‸`, `id::‸` ra 0 gợi ý | Cao |
| I3 (G3) | Không có ngữ cảnh kiểu dữ liệu | `CAST(x AS ‸)`, `DECLARE @x ‸`, `x::‸` không ra kiểu trong 150 gợi ý đầu; kiểu bị thêm ở mọi vị trí chung với mức 1,8 | Cao |
| I4 (G4) | Ưu tiên sai và thiếu câu lệnh | Dòng 2032 xét `isValues` trước dòng 2043 (`RETURNING`); `ON CONFLICT` rơi về clause `INSERT INTO`; alias `src` của `MERGE … USING dbo.S AS src` không resolve | Trung bình |
| I5 (G5) | Không gợi ý schema | `FROM ‸` chỉ lấy object của schema đang dùng (dòng 2293); không có `hr.Employees`, `sales.Region` | Trung bình |
| I6 (G6) | Điều kiện ON gợi ý sau toán tử | `… ON i.OrderID = ‸` đứng đầu là `o.OrderID = i.OrderID` | Thấp |
| I7 (G7) | `EXEC dbo.‸` liệt kê cả bảng, view, function | Nhánh qualifier schema không áp bộ lọc `procedure` (dòng \~2218) | Thấp |
| I8 (G8) | Cắt cứng 150 gợi ý | `unique.slice(0, 150)` (dòng 974); bảng 600 cột chỉ thấy 150 cột đầu | Trung bình |
| I9 (G9) | Khóa cache thiếu ánh xạ alias | Hoán đổi alias trong cùng tập bảng và vị trí trả về cột của bảng sai | Thấp |
| I10 (G10) | Hàm `generate` dài khoảng 960 dòng | Khó sửa, khó test từng nguồn gợi ý | Trung bình |
| I11 (G11) | Hai nguồn sự thật về phạm vi | `ScopeResolver` mới và khoảng 760 dòng regex cũ vẫn được gọi ở cả hai file | Trung bình |
| I12 (G12) | Lỗi tải metadata im lặng | Provider trả `[]` và chỉ ghi log; mảng rỗng được cache | Trung bình |
| I13 (G13) | `analyze` không nhận dialect | Quy tắc `::`, `RETURNING`, `APPLY`, `LATERAL`, `TOP` chạy chung cho cả hai dialect | Thấp |
| X1 (F14) | Test chủ yếu đọc chuỗi nguồn | Không chạy JS, không có corpus SQL, nên các lỗi trên không bị bắt | Cao |

## 3. Mục tiêu đo được

| Chỉ số | Hiện tại | Đích |
| --- | --- | --- |
| Kiểm tra cú pháp thực thi SQL của người dùng | PostgreSQL có | Không; test bất biến phiên (S1) xanh |
| Semantic báo sai trên 40 mẫu hợp lệ | 6 | 0 |
| Semantic phát hiện trên 20 ca lỗi | 13 (65%) | từ 18 (90%) |
| Kiểm tra cấu trúc PG offline | 9/16 | 16/16 |
| Vị trí (emoji, tiếng Việt) | 6/8 | 8/8 |
| `analyze` trên 218 KB (100 KB) | 733 ms | dưới 150 ms (dưới 50 ms) |
| Gợi ý kiểu dữ liệu | 0/6 | 6/6 |
| `INSERT INTO t (‸)`, `CONVERT(‸`, `x::‸` | 0 gợi ý | có gợi ý đúng |
| `FROM ‸` có tên schema | không | có |
| Fuzz theo vị trí: số exception | 0 | giữ 0 |
| Test hành vi (corpus) trong CI | chưa có | có |

## 4. Lộ trình hợp nhất

Mỗi giai đoạn một nhánh git; mỗi thay đổi hành vi một commit kèm một ca test (đỏ rồi xanh). Không đổi tên hàm xuất ra (`window.SqlContextAnalyzer`, `window.CompletionEngine`, `validate_sql`). Tính năng mới nằm sau cờ trong settings (`intellisense.v2.*`, `syntax.pipeline`).

### Giai đoạn 0 – Hạ tầng đo và khóa hành vi (3–4 ngày)

**Công nghệ**: thêm Node (chỉ dev/CI) và Docker (chỉ test tích hợp); mã sản phẩm không đổi.

1. `tests/js/`: bộ nạp dùng `vm`, nạp file đúng thứ tự trong `templates/index.html` (`sql-dialects`, `sql-context-engine`, `sql-tokenizer`, `scope-resolver`, `context-analyzer`, `metadata-provider`, `metadata-cache`, `completion-engine`), giả `window`, `document`, `performance`, `localStorage`, cùng provider metadata giả (`fetchObjects`, `fetchColumns`, `fetchParameters`, `fetchForeignKeys`, `fetchDataTypes`). Chạy bằng `node --test`.
2. Corpus JSON (`tests/corpus/intellisense/*.json`, `tests/corpus/syntax/{valid,invalid}.json`): chuyển các ca đã dùng khi khảo sát (40 ca ngữ cảnh, 50 ca gợi ý, JOIN/FK, signature help, 40 SQL hợp lệ, 20 SQL lỗi, 16 ca PG offline, 12 ca `GO`, 8 ca vị trí).
3. Fuzz theo mọi vị trí con trỏ và mọi tiền tố, cùng bộ đo hiệu năng trên tài liệu 10, 54, 218 KB.
4. Snapshot (golden) cho các ca thuộc phần «đã làm tốt». Ca đang lỗi gắn `expectedFailure` kèm mã vấn đề.
5. CI Windows chạy `node --test` và `pytest -m "not integration"`; Docker PostgreSQL và SQL Server cho test S1 ở giai đoạn 1.

**Hoàn thành khi**: toàn bộ test xanh với mã chưa sửa.

### Giai đoạn 1 – An toàn của kiểm tra cú pháp (3–4 ngày)

**Phạm vi**: `app/database/syntax/validator.py` (`validate_postgresql`, `validate_sql_server`), `MainApi.syntax_check`. Xử lý S1, S2.

1. Viết test S1 trước (đỏ): chụp trạng thái trước và sau mỗi lần kiểm tra gồm `autocommit`, `@@TRANCOUNT` (SQL Server) hoặc trạng thái transaction và `txid_current_if_assigned()` (PostgreSQL), database hiện tại, `search_path`, số khóa đang giữ, giá trị sequence. Ca bắt buộc: SQL có `nextval`, `pg_advisory_lock`, `UPDATE` không `WHERE`, `ALTER TABLE`, `CREATE INDEX CONCURRENTLY`, và ca người dùng đang mở transaction.
2. PostgreSQL: **bỏ `BEGIN; <SQL>; ROLLBACK;`**. Thay bằng (a) parse cú pháp offline (xem quyết định `pglast`), (b) khi cần xác nhận tên bảng/cột thì dùng `PREPARE` hoặc `EXPLAIN` không `ANALYZE` trên **kết nối riêng**, trong transaction `READ ONLY` với `SET LOCAL statement_timeout` và `lock_timeout`. DDL **không gửi** lên DB để kiểm tra.
3. SQL Server: giữ `PARSEONLY`; không đổi database trên kết nối dùng chung (dùng kết nối riêng hoặc khôi phục sau khi kiểm tra); bỏ fallback `sqlglot` khi khóa bận, thay bằng hủy kết quả cũ; gắn nhãn `source` cho mỗi chẩn đoán.
4. Bỏ các nhánh regex `Invalid column/object name` dưới `PARSEONLY` (không bao giờ khớp); việc kiểm tra tên chuyển sang giai đoạn 2.

**Kiểm chứng**: S1 xanh trên cả hai DB; chạy cùng SQL 20 lần cho cùng kết quả (S2). **Rủi ro**: kết nối riêng làm tăng số kết nối. Giảm bằng một kết nối phụ cho mỗi kết nối chính, đóng khi nhàn rỗi.

### Giai đoạn 2 – Độ đúng của kiểm tra cú pháp (5–6 ngày)

**Phạm vi**: `semantic_analyzer.py`, `adapters/postgresql_adapter.py` (`check_offline_postgres_structural_blocks`), `validator.py` (`get_physical_table_columns`), `position-mapper.js`, `syntax-check-service.js`. Xử lý S4–S8.

1. **Báo sai (S4)**, mỗi dạng một commit: subquery tương quan thấy alias của truy vấn ngoài; bỏ qua table hint sau `[AS] alias`; bỏ qua `WITHIN GROUP`; subquery vô hướng trong `SELECT` có phạm vi riêng; khớp bảng theo (schema, tên), bỏ `k_last == clean_tbl`.
2. **Cache cột (S6)**: khóa có `connection_id`, có TTL, xóa khi chạy DDL (nối vào nơi `handleDdlExecution` đã chạy ở `query.js`).
3. **Bỏ sót (S5)**: thêm lần lượt bảng dẫn xuất, `ORDER BY`/`GROUP BY`, alias không tồn tại, `UPDATE SET`, `INSERT` cột. Khi không chắc thì **không báo** (ưu tiên 0 báo sai).
4. **PG offline (S7)**: viết bộ tách từ nhỏ, bỏ qua chuỗi `'…'`, `E'…'`, comment, định danh `"…"`; ghép dollar-quote đúng tag và cho phép lồng; chỉ đếm `BEGIN … END` của khối, không đếm `END IF`, `END LOOP`, `END CASE`, `CASE … END`.
5. **Vị trí (S8)**: Python trả vị trí theo UTF-16 (hoặc trả offset ký tự để JS đổi); `expandTokenRange` dùng lớp ký tự Unicode (`\p{L}\p{N}_@#$`).
6. **Hai bộ phân tích song song**: chạy **cùng corpus SQL** qua `semantic_analyzer` (Python) và `ScopeResolver` (JS) để hai bên thống nhất về alias và phạm vi (CTE, bảng dẫn xuất, `EXISTS`).

**Kiểm chứng**: 0/40 báo sai, từ 18/20 phát hiện, PG offline 16/16, ca emoji và tiếng Việt đúng. **Rủi ro**: sửa semantic dễ tạo báo sai mới. Chạy corpus hợp lệ sau mỗi commit.

### Giai đoạn 3 – IntelliSense: hiệu năng và lỗi cục bộ (5–6 ngày)

**Phạm vi**: `context-analyzer.js`, `completion-engine.js`. Xử lý I1, I2, I4 (phần `RETURNING`), I6, I7, I9.

1. **I1 – token hóa một lần**: trong `analyze`, tạo `fullTokens` một lần (dòng \~1757) và truyền xuống bằng tham số tùy chọn `tokens` cho `detectStatementBoundary` (\~192), phần văn bản trước con trỏ (\~1793, lọc `t.end <= cursor`), `extractLocalTempTables`, `extractLocalTableVars`, `extractSelectAliases`. Mặc định hàm vẫn tự token hóa nên API cũ không đổi. Nhớ kết quả theo chuỗi gần nhất (tokens và ranh giới câu lệnh). Đo lại 10/54/218 KB; kết quả `analyze` phải **giống hệt** trên toàn corpus.
2. **I2**: `currentWord = ''` khi token cuối là dấu câu hoặc toán tử (dòng \~1810–1830). Xác nhận trên giao diện rằng chọn gợi ý không ghi đè dấu câu.
3. **I4a**: chỉ coi `isValues` khi con trỏ nằm **trong** `VALUES (…)`; ngoài ngoặc thì ưu tiên `RETURNING`/`OUTPUT` (đảo thứ tự kiểm tra ở dòng \~2032 và \~2043).
4. **I6**: chỉ sinh điều kiện JOIN đầy đủ khi token liền trước không phải toán tử; sau `=` chỉ gợi ý cột của bảng còn lại, ưu tiên cột khớp foreign key.
5. **I7**: áp bộ lọc `procedure` cho nhánh qualifier là schema trong ngữ cảnh `EXEC`.
6. **I9**: khóa cache thêm băm của văn bản câu lệnh và chữ ký `aliasMap`; gắn `replacementRange` theo từng lần gọi, không lấy từ cache.

**Kiểm chứng**: các ca đỏ tương ứng xanh; snapshot «đã làm tốt» không đổi; fuzz vẫn 0 exception; `analyze` dưới 50 ms với 100 KB.

### Giai đoạn 4 – IntelliSense: ngữ cảnh mới (6–8 ngày)

**Phạm vi**: `context-analyzer.js`, `completion-engine.js`, `intellisense.js` (phần hiển thị trạng thái). Xử lý I3, I5, I8, I12.

1. **I3 – kiểu dữ liệu**: thêm `IntelliSenseContextType.DATA_TYPE` và cờ `isDataTypePosition`, xác định bằng luật trên token: sau `::`; sau `AS` trong `CAST(`/`TRY_CAST(`; đối số đầu của `CONVERT(`/`TRY_CONVERT(`; sau `DECLARE @x [AS]`; định nghĩa cột trong `CREATE/ALTER TABLE (…)` và `@t TABLE (…)`; sau `RETURNS`; danh sách tham số `CREATE PROC/FUNCTION (@p ‸`. Generator ở vị trí này chỉ trả kiểu (kèm kiểu người dùng, PostgreSQL theo schema), mức 0; **bỏ** việc thêm kiểu ở mọi vị trí chung (dòng \~1805–1821). Ranker cộng điểm `data_type` đúng ngữ cảnh.
2. **I5 – schema**: ở `FROM`, `JOIN`, `INSERT INTO`, `UPDATE`, `EXEC` và ngữ cảnh ALTER, thêm ứng viên `schema` (mức \~1,5) lấy từ `MetadataProvider.getSchemas` (đã có), chọn xong chèn `.`. Object của schema khác chỉ hiện khi bật `intellisense.crossSchema` (mặc định tắt), nạp khi gõ từ 2 ký tự, qua API tìm object có giới hạn số lượng.
3. **I8 – cắt danh sách**: bỏ trần 150 khi qualifier resolve đúng một đối tượng (nâng trần lên \~500), giữ 150 cho danh sách chung. Khi bị cắt gắn `meta.truncated`, giao diện hiện dòng «còn nhiều mục, gõ tiếp để lọc».
4. **I12 – lỗi metadata**: generator gắn `meta.errors`, **không cache** kết quả rỗng do lỗi; giao diện hiện «Không tải được metadata» kèm nút thử lại.

**Kiểm chứng**: 6/6 ca kiểu dữ liệu; `FROM ‸` có `dbo`, `sales`, `hr`; bảng 600 cột đủ cột; provider lỗi hiện ra cho người dùng.

### Giai đoạn 5 – Câu lệnh nâng cao, dialect và nối pipeline cú pháp (6–7 ngày)

**Phạm vi**: `scope-resolver.js`, `context-analyzer.js`, `intellisense.js` (truyền dialect), `MainApi.syntax_check`, `coordinator.py`, adapter ScriptDom. Xử lý I4 (phần còn lại), I13, S3.

1. **MERGE**: nhận `USING <nguồn> [AS] alias`, `WHEN MATCHED / NOT MATCHED THEN UPDATE SET / INSERT`, resolve alias đích và nguồn. **PostgreSQL**: `INSERT … ON CONFLICT (‸)` và `DO UPDATE SET ‸` với bảng ảo `EXCLUDED`.
2. **Dialect (I13)**: thêm tham số tùy chọn thứ ba cho `analyze`; bật/tắt luật đặc thù (`::`, `RETURNING`, `APPLY`, `LATERAL`, `TOP`, `$1`); `intellisense.js` truyền `tabCtx.dbType`. Mặc định giữ hành vi hiện tại.
3. **Nối pipeline (S3)**: `MainApi.syntax_check` gọi `validate_sql_pipeline` ở **chế độ bóng** (chạy song song bản cũ, ghi chênh lệch ra log, vẫn trả kết quả bản cũ). Khi corpus và log cho thấy tương đương hoặc tốt hơn thì bật cờ `syntax.pipeline`; gỡ bản cũ sau một giai đoạn quan sát. Thiếu ScriptDom DLL phải báo rõ nguồn đang dùng, không fallback im lặng. **\[QUYẾT ĐỊNH\]** bundle DLL hay giữ tìm trong SSMS/Azure Data Studio.
4. `transform_pg_temp_tables`: xử lý dollar-quote, định danh `"…"`, `E'…'`.

**Kiểm chứng**: ca MERGE và ON CONFLICT xanh; không gợi ý `APPLY` trong PostgreSQL; log bóng 0 chênh lệch trên corpus hợp lệ.

### Giai đoạn 6 – Cấu trúc và bảo trì (4–5 ngày, sau khi giai đoạn 0–5 xanh)

Xử lý I10, I11. Đây là **refactor thuần**: snapshot phải khớp từng ca.

1. Tách `generate` (dòng 1400–2358) thành các nguồn gợi ý nhỏ theo đúng các mức đã đánh dấu trong code: tham số EXEC, đối tượng cục bộ, cột bảng trong câu lệnh, kiểu dữ liệu, thành viên theo qualifier, đối tượng không qualifier, từ khóa và snippet.
2. `ScopeResolver` là nguồn phạm vi duy nhất; các hàm regex cũ (`extractAliases`, `extractAllTablesInQuery`, `extractSelectAliases`, `extractDmlContext`) chỉ còn dự phòng sau cờ `intellisense.v2.legacyScope` và gỡ dần khi corpus không còn ca nào cần chúng. `_generateJoinTargetCandidates`/`_generateJoinOnCandidates` không gọi `extractAllTablesInQuery` trên văn bản thô.
3. Chia `completion-engine.js` theo class (Filter, Ranker, Generator, SignatureHelp, Hover) bằng thẻ `<script>` riêng, giữ nguyên tên export trên `window`. Không dùng bundler.
4. Chia `validator.py` (dài hơn 900 dòng) theo dialect (`validator_mssql.py`, `validator_pg.py`), giữ `validate_sql` làm mặt tiền.

### Giai đoạn 7 – Dài hạn, tùy chọn

Hai bộ phân tích song song (JS `ScopeResolver` và Python `semantic_analyzer`) dễ lệch nhau. Khuyến nghị giữ cả hai và dùng corpus chung làm kiểm tra đồng thuận (giai đoạn 2, mục 6). Chuyển sang AST dùng chung là thay đổi công nghệ lớn (xem mục 6) và chưa khuyến nghị.

## 5. Quy tắc kiểm thử gắn với giai đoạn

Mã quy tắc theo tài liệu «Bộ quy tắc kiểm thử». Mỗi nhóm trở thành cổng chặn (test đỏ thì không merge) từ giai đoạn tương ứng.

| Giai đoạn | Quy tắc bắt đầu chặn |
| --- | --- |
| 0 | G (corpus tách khỏi code, hai chiều hợp lệ/lỗi, cả hai dialect, mỗi lỗi một ca); P2 (fuzz vị trí); I4 (quote) giữ snapshot |
| 1 | S1 (không tác dụng phụ); S2 (xác định) |
| 2 | S3 (vị trí UTF-16); S4 (tách `GO`); S5 (dollar-quote, BEGIN/END); S6, S7 (semantic); S8 (schema, cache) |
| 3 | I1 (mệnh đề); I2 (qualifier, alias); I5 (biên token); I6 (vùng cấm); I7 (cô lập câu lệnh); I12 (`EXEC`); P1, P3, P4 (hiệu năng, đột biến, tài liệu lớn) |
| 4 | I8 (kiểu dữ liệu); I9 (xếp hạng, cắt danh sách); I10 (lỗi metadata) |
| 5 | I3 (phạm vi: MERGE, `UPDATE … FROM`); I11 (đặc thù dialect); S9–S12 (ưu tiên chẩn đoán, hủy, suy giảm, debug); P5 (đồng thời) |

## 6. Thay đổi công nghệ

Phần lớn kế hoạch **không đổi công nghệ**: vẫn JS thuần, tokenizer hiện có, trình soạn thảo và `editor-adapter`, `sqlglot` (giữ làm dự phòng), SQL Server `PARSEONLY`. Các thay đổi dưới đây là công nghệ mới hoặc đổi cách làm:

| Mã | Thay đổi | Giai đoạn | Mức |
| --- | --- | --- | --- |
| T1 | Node (dev/CI) và `node --test` cho test JS; không vào bản phát hành, không thêm thư viện test | 0 | Nên làm |
| T2 | Docker PostgreSQL và SQL Server cho test tích hợp (`@pytest.mark.integration`) | 0–1 | Nên làm |
| T3 | PostgreSQL: `PREPARE`/`EXPLAIN` (không `ANALYZE`) trên kết nối riêng, `READ ONLY`, có timeout, thay cho `BEGIN … ROLLBACK` | 1 | **Bắt buộc đổi cách làm** |
| T4 | `pglast` (libpg\_query) để parse cú pháp PostgreSQL offline | 1–2 | **\[QUYẾT ĐỊNH\]** dependency mới; nếu không dùng thì dùng bộ tách từ nhỏ ở giai đoạn 2 (kém chính xác hơn) |
| T5 | Bundle ScriptDom DLL | 5 | **\[QUYẾT ĐỊNH\]**, cần kiểm tra giấy phép phân phối của Microsoft |
| T6 | CI Windows (GitHub Actions) | 0 | Nên làm |

**Không khuyến nghị**: Web Worker cho phân tích (chỉ xem lại sau giai đoạn 3 nếu 224 KB vẫn chậm; phải bỏ giả định `window` và truyền dữ liệu qua `postMessage`); thay bộ phân tích IntelliSense bằng parser thật (parser thật hay từ chối câu lệnh dở dang, ScriptDom không có bản WASM, chạy ở Python thì mỗi lần gõ đi qua cầu pywebview); chạy IntelliSense ở backend; bundler hoặc ES modules; thư viện fuzzy ngoài (bộ lọc hiện tại đã nhiều tầng và hỗ trợ Unicode). Parser thật chỉ dùng làm **chuẩn đối chiếu trong test** và cho kiểm tra cú pháp.

## 7. Các điểm cần bạn quyết định

1. Có thêm `pglast` (T4) hay chỉ dùng `PREPARE`/`EXPLAIN` cộng bộ tách từ.
2. Bundle ScriptDom DLL hay giữ tìm trong SSMS/Azure Data Studio (T5).
3. Số phận Flask route kiểm tra cú pháp: giữ chỉ để so sánh pipeline, hoặc bỏ sau giai đoạn 5 (app desktop dùng `MainApi`).
4. Có hiển thị object của schema khác ngay ở `FROM ‸` hay không (mặc định tắt, bật bằng `intellisense.crossSchema`).
5. Kiểm tra PostgreSQL có gửi câu `SELECT/INSERT/UPDATE/DELETE` lên DB bằng `PREPARE` hay chỉ parse offline (không chạm DB).
6. Thời gian quan sát ở chế độ bóng trước khi bật `syntax.pipeline` mặc định.

## 8. Quy tắc làm việc cho agent

1. Đọc phần giai đoạn, tạo nhánh, chạy toàn bộ test và lưu kết quả trước khi sửa.
2. Làm theo thứ tự đã đánh số; mỗi thay đổi một commit kèm ca test; test đỏ không được chuyển sang commit sau.
3. Chỉ sửa file thuộc phạm vi giai đoạn; cần sửa file ngoài danh sách (ví dụ `scope-resolver.js`, `intellisense.js`) thì ghi rõ lý do trong báo cáo.
4. Không đổi tên hàm xuất ra, không đổi định dạng dữ liệu, không bỏ phần đã tốt (snapshot phải khớp).
5. Gặp mục **\[QUYẾT ĐỊNH\]** thì dừng và hỏi. Không thêm thư viện ngoài danh sách ở mục 6.
6. Số dòng nêu trong tài liệu chỉ để định vị, phải tìm lại bằng grep trước khi sửa.
7. Cuối giai đoạn báo cáo: file đã sửa, test đã thêm, kết quả trước và sau, số đo hiệu năng, rủi ro còn lại.

## 9. Đối chiếu mã vấn đề cũ và mới

| Mã mới | Mã cũ | Giai đoạn |
| --- | --- | --- |
| S1 | F1 | 1 |
| S2 | F7 | 1 |
| S3 | F2 | 5 |
| S4, S5 | F3, F5 | 2 |
| S6 | F4 | 2 |
| S7 | F6 | 2 |
| S8 | F13 | 2 |
| I1 | G1 | 3 |
| I2 | G2 (và F8) | 3 |
| I3 | G3 (và F9) | 4 |
| I4 | G4 (và F10) | 3 (`RETURNING`), 5 (`MERGE`, `ON CONFLICT`) |
| I5 | G5 | 4 |
| I6, I7, I9 | G6, G7, G9 | 3 |
| I8 | G8 | 4 |
| I10, I11 | G10, G11 | 6 |
| I12 | G12 (và F12) | 4 |
| I13 | G13 | 5 |
| X1 | F14 | 0 |

## 10. Rủi ro và giới hạn

- Kết luận về các đường online (`PARSEONLY`, rollback PostgreSQL, ScriptDom) dựa trên đọc code, cần xác nhận bằng test S1 trên DB thật; sandbox khảo sát không có DB và driver.
- Số đo hiệu năng lấy từ Node với provider giả; tỷ lệ (7 lần token hóa toàn tài liệu) có giá trị, con số tuyệt đối trên máy bạn sẽ khác. Cách chọn gợi ý phụ thuộc giao diện thật nên mục I2 cần xác nhận trên UI.
- Chưa đọc từng dòng `extractAliases`, `extractDmlContext`, `SqlHoverResolver` và phần thân `SqlSignatureHelpResolver`; khi đụng tới, đọc trước và bổ sung vào kế hoạch.
- Giai đoạn 5 và 6 chạm `scope-resolver.js` và `intellisense.js` (ngoài hai file chính) nên cần snapshot đầy đủ từ giai đoạn 0.
