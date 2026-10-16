# Kế hoạch kiểm tra và nâng cấp – IntelliSense và Check Syntax

Đây là **bản thực thi** của «Kế hoạch tổng thể – Tối ưu IntelliSense và Kiểm tra cú pháp»: Phần A là kế hoạch kiểm tra (dựng trước, chạy lại sau mỗi lần sửa), Phần B là danh sách việc nâng cấp theo giai đoạn có ô tick, Phần C để theo dõi tiến độ. Áp dụng cho SQL Server và PostgreSQL. Nguyên tắc: **sửa tại chỗ, không đập đi xây mới; phần đã tốt giữ nguyên; thay đổi công nghệ chỉ gồm Node (dev/CI), Docker (test tích hợp) và đổi cách kiểm tra PostgreSQL** (chi tiết ở kế hoạch tổng thể, mục 6).

## A. Kế hoạch kiểm tra

### A1. Phạm vi

- **IntelliSense**: `SqlContextAnalyzer.analyze`, `CompletionEngine.getCompletions`, signature help.
- **Check syntax**: `validator.validate_sql` (SQL Server, PostgreSQL), `semantic_analyzer`, kiểm tra cấu trúc PostgreSQL offline, tách batch `GO`, `position-mapper.js`, `syntax-check-service.js`.
- Không nằm trong phạm vi: giao diện hiển thị (popup, màu), Table Designer, bảo mật dữ liệu.

### A2. Môi trường

| Thành phần | Yêu cầu | Dùng cho |
| --- | --- | --- |
| Node 20+ | `node --test`, bộ nạp `vm` | Test JS (L1–L3, L7–L9) |
| Python 3.12 + pytest | Hàm thuần Python | Test semantic, tách batch, PG offline (L4–L6) |
| Docker | PostgreSQL 16, SQL Server 2022 | Test tích hợp (L10–L11) |
| Provider metadata giả | `fetchObjects`, `fetchColumns`, `fetchParameters`, `fetchForeignKeys`, `fetchDataTypes` | Test gợi ý |
| Schema mẫu | SQL Server: `dbo.Orders`, `Customers`, `OrderItems`, `Order Details`, `vOrders`, `usp_GetOrders`, `fn_Total`, `sales.Region`, `hr.Employees`; PostgreSQL: `public.orders`, `"Customers"`, `order_items`, `v_orders`, `sales.region` | Mọi lớp |

### A3. Các lớp test

| Lớp | Kiểm tra gì | Công cụ | Chạy khi nào | Số ca ban đầu |
| --- | --- | --- | --- | --- |
| L1 | Ngữ cảnh của `analyze` (mệnh đề, qualifier, alias, vùng cấm) | Node | Mỗi commit | 40 |
| L2 | Nội dung gợi ý của `getCompletions` (SQL Server, PostgreSQL) | Node | Mỗi commit | 50, thêm 19 ca kiểu dữ liệu/INSERT/EXEC, 3 ca JOIN/FK |
| L3 | Signature help (chỉ số tham số) | Node | Mỗi commit | 7 |
| L4 | Semantic: SQL hợp lệ phải 0 chẩn đoán, SQL lỗi phải bị báo đúng token | Python | Mỗi commit | 40 hợp lệ, 20 lỗi |
| L5 | Tách batch `GO` | Python | Mỗi commit | 12 |
| L6 | Cấu trúc PostgreSQL offline (dollar-quote, BEGIN/END) | Python | Mỗi commit | 16 |
| L7 | Vị trí gạch chân (CRLF, tiếng Việt, emoji) | Node | Mỗi commit | 8 |
| L8 | Fuzz theo mọi vị trí con trỏ, mọi tiền tố, và đột biến ký tự | Node và Python | Mỗi commit | 2.239 vị trí mỗi bộ |
| L9 | Hiệu năng: tài liệu 10/54/218 KB, 20.000 object, bảng 600 cột | Node | Mỗi commit (so với baseline) | 5 phép đo |
| L10 | **Bất biến phiên (S1)**: kiểm tra cú pháp không đổi trạng thái kết nối | pytest + Docker | Trước merge | 5 SQL nguy hiểm × 2 DB + ca transaction đang mở |
| L11 | **Xác định (S2)**: cùng đầu vào, cùng chẩn đoán | pytest + Docker | Trước merge | 20 lần chạy |
| L12 | Chế độ bóng: so pipeline mới với bản cũ trên corpus hợp lệ | Log | Giai đoạn 5 | toàn bộ corpus |
| L13 | Kiểm tra thủ công trên giao diện | Checklist A8 | Cuối giai đoạn | 12 mục |

### A4. Định dạng một ca

Ca nằm trong file JSON (không viết cứng trong code test). `‸` đánh dấu con trỏ.

```json
{ "id": "I-TYPE-001", "dialect": "mssql", "group": "datatype",
  "sql": "SELECT CAST(OrderID AS ‸) FROM dbo.Orders",
  "expect": { "contextType": "data_type", "first": ["int", "varchar"], "not": ["OrderID"] },
  "status": "expectedFailure", "issue": "I3" }
```

### A5. Các ca đỏ ban đầu (phải chuyển xanh sau nâng cấp)

Đây là các ca đã chạy thật và hiện đang lỗi; mỗi ca gắn mã vấn đề trong kế hoạch tổng thể.

| Ca | SQL hoặc tình huống | Kỳ vọng | Mã |
| --- | --- | --- | --- |
| INS-1 | `INSERT INTO dbo.Orders (‸)` | Có cột `OrderID`, `Total`; chọn không ghi đè `(` | I2 |
| INS-2 | `SELECT CONVERT(‸, OrderID) FROM dbo.Orders` | Kiểu dữ liệu đứng đầu | I2, I3 |
| CAST-1 | `SELECT CAST(OrderID AS ‸) FROM dbo.Orders` | Kiểu dữ liệu đứng đầu | I3 |
| DECL-1 | `DECLARE @x ‸` | Kiểu dữ liệu đứng đầu | I3 |
| PG-CAST | `SELECT id::‸ FROM public.orders` | Kiểu dữ liệu PostgreSQL | I3 |
| RET-1 | `INSERT INTO t (a) VALUES (1) RETURNING ‸` | clause `RETURNING`, cột của `t` | I4 |
| MRG-1 | `MERGE INTO dbo.T AS tgt USING dbo.S AS src ON tgt.id = src.‸` | Cột của `S` | I4 |
| SCH-1 | `SELECT * FROM ‸` | Có `dbo`, `sales`, `hr` | I5 |
| ON-1 | `… ON i.OrderID = ‸` | Chỉ cột bảng còn lại, không điều kiện đầy đủ | I6 |
| EXEC-1 | `EXEC dbo.‸` | Chỉ procedure | I7 |
| WIDE-1 | `SELECT t.‸ FROM dbo.Tbl1 t` (600 cột) | Đủ cột hoặc có cờ `truncated` | I8 |
| ALIAS-1 | Hoán đổi alias trong cùng tập bảng, gõ `b.‸` | Cột của bảng `b` mới | I9 |
| PERF-1 | `analyze` trên 218 KB | Dưới 150 ms (hiện 733 ms) | I1 |
| SEM-FP | 6 SQL hợp lệ: `EXISTS`/`NOT EXISTS` tương quan, `WITHIN GROUP`, `AS o WITH (NOLOCK)`, subquery vô hướng trong `SELECT`, `SELECT Label FROM hr.Region` | 0 chẩn đoán | S4, S6 |
| SEM-FN | 7 SQL lỗi: `SELECT x.Foo FROM (SELECT OrderID FROM dbo.Orders) x`, `ORDER BY Zzz`, `SELECT zz.OrderID FROM dbo.Orders o`, `UPDATE dbo.Orders SET Foo = 1`, `INSERT INTO dbo.Orders (Foo)`, `GROUP BY Qqq`, `SELECT RegionName FROM hr.Region` | Báo đúng token | S5, S6 |
| PGO-1 | `DO $$ BEGIN IF true THEN PERFORM 1; END IF; $$;` (thiếu `END`) và hai ca tương tự với `END LOOP`, `CASE … END` | Báo thiếu `END` | S7 |
| PGO-2 | `SELECT '$$ không phải quote' AS x;` và `-- giá $$ 5` | Không báo | S7 |
| PGO-3 | Hàm lồng `$outer$ … $inner$x$inner$ … $outer$` | Không báo | S7 |
| PGO-4 | `SELECT $a$ text $b$;` | Báo lệch tag | S7 |
| POS-1 | `SELECT Khách_hàng FROM t` | Gạch chân cả từ | S8 |
| POS-2 | `SELECT 😀 AS x, y FROM t` | Cột Python và JS trùng nhau (UTF-16) | S8 |
| SAFE-1…5 | SQL có `nextval`, `pg_advisory_lock`, `UPDATE` không `WHERE`, `ALTER TABLE`, `CREATE INDEX CONCURRENTLY` (PostgreSQL); mở sẵn transaction | Trạng thái kết nối trước và sau giống hệt | S1 |

### A6. Tiêu chí đạt

| Lớp | Đạt khi |
| --- | --- |
| L1–L3 | 100% ca xanh; ca `expectedFailure` chỉ được gỡ khi đã sửa và xanh |
| L4 | 0/40 báo sai; từ 18/20 phát hiện |
| L5, L6 | 12/12 và 16/16 |
| L7 | 8/8 |
| L8 | 0 exception; không ca nào quá 50 ms |
| L9 | `analyze` dưới 50 ms (100 KB) và dưới 150 ms (218 KB); `getCompletions` dưới 150 ms với 20.000 object; không chậm hơn baseline quá 20% ở các phép đo khác |
| L10, L11 | Không đổi autocommit, trạng thái transaction, database hiện tại, `search_path`, khóa, sequence; 20/20 lần cùng kết quả |
| L12 | 0 chênh lệch trên corpus hợp lệ |
| Chung | Snapshot các ca «đã làm tốt» không đổi; mọi lỗi mới được thêm một ca trước khi sửa |

Test hiệu năng chạy trên cùng một máy cho trước và sau, so theo tỷ lệ với baseline thay vì con số tuyệt đối.

### A7. Quy trình

1. Ghi baseline: chạy toàn bộ lớp, lưu kết quả và số đo (10/54/218 KB hiện là 90/208/733 ms).
2. Ca đang lỗi gắn `expectedFailure` kèm mã vấn đề; không để test đỏ trôi trong nhánh chính.
3. Mỗi thay đổi hành vi: thêm ca (đỏ) → sửa → xanh → chạy toàn bộ lớp → commit.
4. Lỗi người dùng báo: thêm ca vào corpus trước, rồi mới sửa.
5. Báo cáo lỗi theo mẫu: SQL, vị trí con trỏ (offset), dialect, kỳ vọng, thực tế, lớp test, mã vấn đề.

### A8. Kiểm tra thủ công trên giao diện (L13)

- [ ] Gõ `INSERT INTO dbo.Orders (` → popup cột; chọn một cột không ghi đè dấu `(`.
- [ ] Gõ ` CAST(OrderID AS  ` và ` DECLARE @x  ` → kiểu dữ liệu đứng đầu danh sách.
- [ ] Gõ ` SELECT * FROM  ` → thấy tên schema.
- [ ] Gõ trong chuỗi `'...'` và trong comment → không hiện popup.
- [ ] Mở script khoảng 5.000 dòng, gõ liên tục ở cuối → không giật.
- [ ] Lỗi cú pháp gạch chân đúng token với dòng có emoji, tiếng Việt, CRLF.
- [ ] PostgreSQL: gõ dở `DELETE FROM t`, dừng 1 giây → `pg_locks` không có khóa mới và bảng không đổi.
- [ ] Sau khi kiểm tra cú pháp, chạy `SHOW search_path` (PostgreSQL) và `SELECT DB_NAME()` (SQL Server) → giá trị không đổi.
- [ ] Đang mở transaction thủ công, gõ tiếp → transaction không bị hủy.
- [ ] Chạy `ALTER TABLE … ADD col`, gõ lại tên cột mới → có gợi ý, không bị báo sai.
- [ ] Đổi database của tab → gợi ý theo database mới.
- [ ] Ngắt kết nối giữa chừng → có thông báo, không treo giao diện.

## B. Kế hoạch nâng cấp (danh sách việc)

Mỗi giai đoạn: một nhánh git; mỗi thay đổi hành vi một commit kèm ca test; không đổi tên hàm xuất ra (`window.SqlContextAnalyzer`, `window.CompletionEngine`, `validate_sql`); tính năng mới nằm sau cờ (`intellisense.v2.*`, `syntax.pipeline`). Số dòng chỉ để định vị, phải tìm lại bằng grep.

### Giai đoạn 0 – Hạ tầng đo (3–4 ngày)

- [ ] Tạo nhánh `ide-quality`, gắn tag baseline, sao lưu `data/`.
- [ ] `tests/js/load.js`: bộ nạp `vm` theo thứ tự `templates/index.html`, giả `window`, `document`, `performance`, `localStorage`.
- [ ] Provider metadata giả và schema mẫu (A2).
- [ ] Chuyển các ca đã khảo sát sang `tests/corpus/*.json` (A3).
- [ ] Runner `node --test` và wrapper `pytest` gọi runner.
- [ ] Fuzz (L8) và đo hiệu năng (L9); lưu số đo baseline.
- [ ] Snapshot các ca «đã làm tốt»; gắn `expectedFailure` cho ca đỏ ở A5.
- [ ] CI Windows chạy `node --test` và `pytest -m "not integration"`.

**Cổng**: toàn bộ test xanh với mã chưa sửa.

### Giai đoạn 1 – An toàn của kiểm tra cú pháp (3–4 ngày)

- [ ] Dựng Docker PostgreSQL và SQL Server; viết test L10 (đỏ) và L11.
- [ ] **\[QUYẾT ĐỊNH\]** thêm `pglast` hay chỉ dùng `PREPARE`/`EXPLAIN` cộng bộ tách từ.
- [ ] S1: `validate_postgresql` bỏ `BEGIN; <SQL>; ROLLBACK;`; dùng parse offline và/hoặc `PREPARE`/`EXPLAIN` không `ANALYZE` trên kết nối riêng, `READ ONLY`, có `statement_timeout` và `lock_timeout`; DDL không gửi lên DB.
- [ ] S2: `validate_sql_server` không đổi database trên kết nối dùng chung; bỏ fallback `sqlglot` khi khóa bận; gắn nhãn `source` cho mỗi chẩn đoán.
- [ ] Bỏ các nhánh regex `Invalid column/object name` dưới `PARSEONLY`.

**Cổng**: L10 và L11 xanh trên cả hai DB.

### Giai đoạn 2 – Độ đúng của kiểm tra cú pháp (5–6 ngày)

- [ ] S4: sửa 6 ca báo sai (subquery tương quan, table hint sau alias, `WITHIN GROUP`, subquery vô hướng, khớp bảng theo schema và tên).
- [ ] S6: cache cột có `connection_id`, có TTL, xóa khi chạy DDL.
- [ ] S5: thêm kiểm tra bảng dẫn xuất, `ORDER BY`/`GROUP BY`, alias không tồn tại, `UPDATE SET`, `INSERT` cột (mỗi dạng một commit; khi không chắc thì không báo).
- [ ] S7: bộ tách từ cho PostgreSQL offline (chuỗi, `E'…'`, comment, `"…"`, dollar-quote đúng tag và lồng, không đếm `END IF`/`END LOOP`/`END CASE`/`CASE … END`).
- [ ] S8: vị trí theo UTF-16; `expandTokenRange` nhận chữ Unicode.
- [ ] Chạy cùng corpus qua `semantic_analyzer` (Python) và `ScopeResolver` (JS), ghi các điểm lệch.

**Cổng**: L4 (0/40 báo sai, từ 18/20 phát hiện), L6 16/16, L7 8/8.

### Giai đoạn 3 – IntelliSense: hiệu năng và lỗi cục bộ (5–6 ngày)

- [ ] I1: token hóa một lần trong `analyze`, truyền `tokens` tùy chọn xuống các hàm con; nhớ kết quả theo chuỗi gần nhất; kết quả `analyze` phải giống hệt trên corpus.
- [ ] I2: `currentWord` rỗng khi token cuối là dấu câu hoặc toán tử.
- [ ] I4a: `isValues` chỉ khi con trỏ trong `VALUES (…)`; ưu tiên `RETURNING`/`OUTPUT` khi ngoài ngoặc.
- [ ] I6: điều kiện JOIN đầy đủ chỉ khi token liền trước không phải toán tử.
- [ ] I7: bộ lọc `procedure` cho nhánh qualifier là schema trong ngữ cảnh `EXEC`.
- [ ] I9: khóa cache thêm băm văn bản câu lệnh và chữ ký `aliasMap`; `replacementRange` gắn theo từng lần gọi.

**Cổng**: INS-1, RET-1, ON-1, EXEC-1, ALIAS-1, PERF-1 xanh; snapshot «đã làm tốt» không đổi; L8 vẫn 0 exception.

### Giai đoạn 4 – IntelliSense: ngữ cảnh mới (6–8 ngày)

- [ ] I3: `DATA_TYPE` và `isDataTypePosition`; generator chỉ trả kiểu ở vị trí này; bỏ việc thêm kiểu ở mọi vị trí chung; ranker cộng điểm `data_type`.
- [ ] I5: ứng viên `schema` từ `MetadataProvider.getSchemas`; tùy chọn `intellisense.crossSchema` (mặc định tắt).
- [ ] I8: nâng trần cho danh sách cột của một đối tượng (\~500), gắn `meta.truncated`.
- [ ] I12: `meta.errors`; không cache kết quả rỗng do lỗi; hiện trạng thái «Không tải được metadata».

**Cổng**: CAST-1, DECL-1, INS-2, PG-CAST, SCH-1, WIDE-1 xanh; L13 các mục liên quan.

### Giai đoạn 5 – Câu lệnh nâng cao, dialect, nối pipeline (6–7 ngày)

- [ ] MERGE (`USING … AS alias`, `WHEN MATCHED/NOT MATCHED`), PostgreSQL `ON CONFLICT` và `EXCLUDED` (chạm `scope-resolver.js`).
- [ ] Tham số dialect tùy chọn cho `analyze`; `intellisense.js` truyền `tabCtx.dbType`.
- [ ] `MainApi.syntax_check` gọi `validate_sql_pipeline` ở chế độ bóng, ghi chênh lệch ra log; sau thời gian quan sát mới bật cờ `syntax.pipeline`.
- [ ] **\[QUYẾT ĐỊNH\]** bundle ScriptDom DLL hay giữ tìm trong SSMS/Azure Data Studio; thiếu DLL phải báo rõ nguồn đang dùng.
- [ ] `transform_pg_temp_tables` xử lý dollar-quote, `"…"`, `E'…'`.

**Cổng**: MRG-1 xanh; L12 0 chênh lệch trên corpus hợp lệ.

### Giai đoạn 6 – Cấu trúc và bảo trì (4–5 ngày, sau khi 0–5 xanh)

- [ ] Tách `generate` (dòng 1400–2358) thành các nguồn gợi ý nhỏ; snapshot phải khớp từng ca.
- [ ] `ScopeResolver` là nguồn phạm vi duy nhất; regex cũ chỉ dự phòng sau cờ `intellisense.v2.legacyScope`.
- [ ] Chia `completion-engine.js` theo class bằng thẻ `<script>` riêng, giữ nguyên tên export; không dùng bundler.
- [ ] Chia `validator.py` theo dialect, giữ `validate_sql` làm mặt tiền.

**Cổng**: toàn bộ lớp xanh, snapshot không đổi, không còn `expectedFailure` thuộc các mã đã xử lý.

**Báo cáo cuối mỗi giai đoạn**: file đã sửa, ca đã thêm, kết quả trước và sau của từng lớp, số đo hiệu năng, rủi ro còn lại, mục \[QUYẾT ĐỊNH\] đang chờ.

## C. Theo dõi tiến độ

| Giai đoạn | Ước lượng | Cổng test phải xanh | Trạng thái |
| --- | --- | --- | --- |
| 0 – Hạ tầng đo | 3–4 ngày | Toàn bộ test với mã chưa sửa | Chưa bắt đầu |
| 1 – An toàn cú pháp | 3–4 ngày | L10, L11 | Chưa bắt đầu |
| 2 – Độ đúng cú pháp | 5–6 ngày | L4, L6, L7 | Chưa bắt đầu |
| 3 – IntelliSense hiệu năng, lỗi cục bộ | 5–6 ngày | L1, L2, L9 | Chưa bắt đầu |
| 4 – IntelliSense ngữ cảnh mới | 6–8 ngày | L2, L13 | Chưa bắt đầu |
| 5 – Nâng cao và nối pipeline | 6–7 ngày | L1, L2, L12 | Chưa bắt đầu |
| 6 – Cấu trúc | 4–5 ngày | Toàn bộ lớp, snapshot | Chưa bắt đầu |

Tổng giai đoạn 0–6 khoảng 32–40 ngày công của một người.

## D. Điểm cần bạn quyết định

1. Có thêm `pglast` để parse cú pháp PostgreSQL offline hay chỉ dùng `PREPARE`/`EXPLAIN` cộng bộ tách từ.
2. Bundle ScriptDom DLL hay tiếp tục tìm trong SSMS/Azure Data Studio.
3. Giữ hay bỏ route Flask kiểm tra cú pháp sau giai đoạn 5 (app desktop dùng `MainApi`).
4. Có hiển thị object của schema khác ngay ở `FROM ‸` hay không (mặc định tắt).
5. Kiểm tra PostgreSQL có gửi `SELECT/INSERT/UPDATE/DELETE` lên DB bằng `PREPARE`, hay chỉ parse offline.
6. Thời gian quan sát ở chế độ bóng trước khi bật `syntax.pipeline` mặc định.

## E. Giới hạn

- Các kết luận về đường online (`PARSEONLY`, rollback PostgreSQL, ScriptDom) dựa trên đọc code; L10 và L11 trên DB thật là bước xác nhận.
- Số đo hiệu năng lấy từ Node với provider giả; con số tuyệt đối trên máy bạn sẽ khác, nên so theo tỷ lệ với baseline.
- Chưa đọc từng dòng `extractAliases`, `extractDmlContext`, `SqlHoverResolver`; khi đụng tới, đọc trước và bổ sung ca test.
