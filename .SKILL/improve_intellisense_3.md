# Kế hoạch cải thiện IntelliSense (3) – Ngữ cảnh và Thứ tự ưu tiên gợi ý

- **Ngày**: 23/10/2026
- **Trạng thái**: Phân tích xong, CHƯA sửa code
- **Kế thừa**: `improve_intellisense_2.md` (Giai đoạn 0–6 đã đạt), `quy_tac_va_thu_tu_thuc_hien_intellisense_syntax_check.md` (quy tắc bắt buộc)
- **Phạm vi**: chỉ IntelliSense Completion — phân tích ngữ cảnh, sinh ứng viên, lọc, xếp hạng, điều kiện bật popup. Không đụng Syntax Check, Highlighting, giao diện popup, Table Designer.

---

## 0. Phương pháp và bằng chứng

1. Đọc code thực tế của pipeline: `context-analyzer.js`, `scope-resolver.js`, `candidate-generator.js`, `candidate-filter.js`, `completion-ranker.js`, `completion-engine.js`, `trigger-controller.js`, `intellisense.js`, `metadata-provider.js`; backend `app/database/sqlserver.py`, `postgresql.py`, `app/services/metadata_service.py`.
2. Chạy bộ test JS hiện có trên bản sao code (không chạm DB, không sửa file dự án):
   - `node --test tests/js/*.test.js` → **163/163 pass** (baseline).
   - `tests/snapshots/perf_baseline.json`: analyze 10/54/218 KB = 10,2/16,5/107,7 ms; completions 600 cột = 13,2 ms; 20.000 object = 62,9 ms.
3. Viết công cụ dò (probe) dùng đúng `tests/js/load.js` (provider giả + schema mẫu A2) để chạy **74 tình huống gõ thật** (SQL Server + PostgreSQL) và in top gợi ý kèm loại, kiểu khớp, điểm `_finalScore`. Danh sách tình huống ở Phụ lục A.

**Giới hạn**: dữ liệu metadata là schema mẫu trong `load.js`; logic ngữ cảnh/xếp hạng giống app thật vì popup (`intellisense.js: collectAndShowCandidates`) hiển thị nguyên thứ tự `CompletionEngine.getCompletions` trả về. Chưa kiểm tra thủ công trên giao diện (L13).

---

## 1. Hiện trạng pipeline (đã xác minh)

```
Monaco change → TriggerController.decideChange (bật/không bật popup)
  → SqlContextAnalyzer.analyze(sql, cursor, dialect)      // clause, contextType, previousToken, followUp, scope…
  → CompletionEngine.getCompletions
      → CandidateGenerator.generate                       // nguồn ứng viên
      → CandidateFilter.filter(word)                      // exact/prefix/subword/substring/fuzzy + _matchScore
      → CompletionRanker.rank(context, word)              // _finalScore, sort, cắt 150 (1000 khi qualifier 1 object)
  → IntelliSensePopupUI.render(ranked)                    // hiển thị nguyên thứ tự
```

**Công thức điểm** (`completion-ranker.js:283`):

`_finalScore = _matchScore × 2 + contextScore + levelScore`

| Thành phần | Giá trị hiện tại |
|-----------|------------------|
| `_matchScore` (`candidate-filter.js`) | exact 100 · prefix `80 + round(len(query)/len(name) × 15)` · subword 72–79 · substring 50–70 · fuzzy 10–**80** · từ rỗng 50 |
| `contextScore` | WHERE/ON/HAVING: cột +70, PK +75, biến +80, hàm +45, **keyword 0**; SELECT: cột +70, hàm +30, **keyword 0**; FROM/JOIN: bảng/view +80, schema +75, 6 keyword (`JOIN, LEFT, RIGHT, INNER, ON, WHERE`) +30; join_condition +280; snippet +50…+270; data type +200 khi `isDataTypePosition` |
| `levelScore` | `max(0, 30 − level × 10)` |
| Cắt danh sách | 150 mục sau khi sort (tie-break A–Z) |

**Điều kiện bật popup khi gõ dấu cách** (`trigger-controller.js: isPostKeywordObjectTrigger`): có follow-up; `ALTER/DROP <loại>`; `EXEC`; từ trước là `FROM/JOIN/INTO/UPDATE/TABLE`; từ trước là `ON` **hoặc clause là ON**.

---

## 2. Kết quả đo (trích từ probe)

Ký hiệu: `#n` = vị trí trong danh sách; “—” = không có trong danh sách (kể cả sau cắt 150).

### 2.1. Từ khoá đúng ngữ cảnh bị đẩy xuống / mất

| ID | SQL (`‸` = con trỏ) | Hiện tại (top) | Kỳ vọng |
|----|---------------------|----------------|---------|
| K-OR | `… WHERE OrderID = 1 OR‸` | OrderID, OrderDate, ORIGINAL_LOGIN, **OR #4** (khớp chính xác) | `OR` #1 |
| PG-OR | `… WHERE id = 1 OR‸` | order_date, **OR #2** | `OR` #1 |
| AND-A | `… WHERE Total > 0 A‸` | ABS, AVG, ACOS… **AND #12** | `AND` #1 |
| WHERE-OPERAND-I | `… WHERE OrderID I‸` | IIF, ISDATE, ISNULL… **IN #9, IS #10** | `IN`, `IS` đầu |
| WHERE-OPERAND | `… WHERE OrderID ‸` (Ctrl+Space) | cột, hàm A–Z; **IN/IS/BETWEEN/LIKE/NOT: —** | toán tử/predicate đầu |
| IS-EMPTY | `… WHERE OrderDate IS ‸` | cột, hàm; **NULL/NOT: —** | `NULL`, `NOT` |
| IS-N | `… IS N‸` | NCHAR, NEWID, NTILE… **NOT #6, NULL #7** | `NULL`, `NOT` đầu |
| ORDER-DIR | `… ORDER BY OrderDate ‸` | cột, hàm; **ASC/DESC: —** | `ASC`, `DESC` |
| ORDER-DIR-D | `… ORDER BY OrderDate D‸` | DAY, DB_ID, DATEADD… **DESC #19** | `DESC` #1 |
| K-ORDER | `… FROM dbo.Orders o ORDER‸` | chỉ OrderItems, Order Details, Orders, vOrders; **ORDER: —** | `ORDER` #1 |
| GROUP-BY-KW | `… FROM dbo.Orders GROUP ‸` | 10 bảng/schema; **BY #11** (điểm 80) | `BY` #1 (duy nhất) |
| JOIN-AFTER-O | `… JOIN dbo.Customers c O‸` | alias `o` (exact), OrderItems, Order Details, **ON #4** | `ON` #1, không có bảng |
| SRC-EMPTY | `… FROM dbo.Orders o ‸` (Ctrl+Space) | 8 bảng/schema; **INNER #11, JOIN #12, WHERE #16** | `WHERE`, họ `JOIN` đầu |
| PG-ONCONF | `… VALUES (1) ON ‸` | keyword A–Z; **CONFLICT #32** | `CONFLICT` #1 |
| HINT | `… FROM dbo.Orders WITH (‸` | keyword A–Z; **NOLOCK #108** | `NOLOCK` và các hint đầu |

### 2.2. Đầu câu lệnh

| ID | SQL | Hiện tại | Kỳ vọng |
|----|-----|----------|---------|
| START-EMPTY | `‸` (Ctrl+Space) | ADD, ALL, ALTER, AND… (A–Z); **SELECT: —, UPDATE: —** (bị cắt ở 150) | SELECT, INSERT, UPDATE, DELETE, WITH, DECLARE… |
| START-S | `S‸` | SET, SAVE, **SIN, STR, SUM** (hàm), SOME, SCHEMA, **SELECT #8** | `SELECT` #1; không có hàm |
| START-U | `U‸` | USE, USER, UNION, UNIQUE, **UPDATE #5** | `UPDATE` #1 |
| NEWSTMT | `SELECT … FROM dbo.Orders⏎S‸` | như START-S | như START-S |
| TRY | `BEGIN TRY ‸` | keyword A–Z; **SELECT: —**, INSERT #92, THROW: — | lệnh mở đầu |

### 2.3. Vị trí giá trị / kiểu dữ liệu / đối số

| ID | SQL | Hiện tại | Kỳ vọng |
|----|-----|----------|---------|
| UPD-SET-VAL | `UPDATE dbo.Orders SET Total = ‸` | keyword A–Z (ADD, ALL…); **cột, GETDATE: —**, NULL #112 | cột, biến, hàm, `NULL`, `DEFAULT` |
| INS-VALUES | `INSERT INTO dbo.Orders (OrderID) VALUES (‸` | keyword A–Z; DEFAULT #47, NULL #112, **GETDATE: —** | biến, hàm, `NULL`, `DEFAULT` |
| CREATE-COLTYPE | `CREATE TABLE dbo.X (Id ‸` | `* (Expand columns)`, keyword A–Z; **không có kiểu dữ liệu** | kiểu dữ liệu |
| COUNT-ARG | `SELECT COUNT(‸) FROM dbo.Orders` | **`* (Expand columns)` #1** | `*`, `DISTINCT`, cột |
| ALIAS-POS | `SELECT OrderID AS ‸` (Ctrl+Space) | `*`, cột, hàm | không gợi ý |
| EXEC-PARAMS | `EXEC dbo.usp_GetOrders ‸` | **usp_GetOrders #1** (307), @CustomerID #2 (120) | tham số đầu, không lặp tên procedure |

### 2.4. Thứ tự sai do công thức khớp

| ID | SQL | Hiện tại | Nguyên nhân |
|----|-----|----------|-------------|
| SEL-C | `SELECT C‸ FROM dbo.Orders` | **`* (Expand columns)` #1**, CustomerID #2 | `'columns'.startsWith('c')` → star expansion khớp prefix 88 |
| SEL-CO | `SELECT co‸ …` | `*` #1, COS, COT, **COUNT #4**, COALESCE #6 | như trên + thưởng tên ngắn |
| START-S | `S‸` | SET trước SELECT | thưởng tên ngắn `len(q)/len(name)` |
| FROM-CUS | `SELECT * FROM Cus‸` | Customers, rồi **CURRENT_USER, CUME_DIST, CURSOR…** | keyword/hàm vẫn được sinh ở vị trí tên bảng, fuzzy mở |
| FROM-ORD | `SELECT * FROM Ord‸` | Orders…, **ORDER (keyword)** #5 | như trên |
| SRC-L | `… FROM dbo.Orders o L‸` | LEFT, LAG, LEN, LOG… và **LEFT (hàm) trùng tên** | hàm được sinh sau tên bảng |

### 2.5. Các ca đang tốt (giữ nguyên — snapshot)

L2-FROM-001/002, SEL-T (`Total` #1), WHERE-EMPTY (cột đầu), VAR-AT/VAR-NOAT (`@Id` #1), QUAL, CORREL, CTE-FROM (`c` #1), ON-FK (điều kiện JOIN #1), FN-GETD, FN-DATEA, SUB-CID (subword), PG-LIM, PG-NOW, PG-TOCH, PG-GETD (không có GETDATE), MS-LIMIT (không có LIMIT), ALTER-PROC, DROP-TABLE, EXEC, INS-INTO, DEL-FROM, UPD-SET, GROUPBY.

---

## 3. Nguyên nhân gốc

| Mã | Nguyên nhân | Vị trí | Ca bị ảnh hưởng |
|----|-------------|--------|-----------------|
| **RC1** | Generator nạp **toàn bộ** keyword (225 MSSQL / 228 PG) và hàm (151 / 112) cho mọi vị trí không qualifier, không phân biệt vị trí cú pháp | `candidate-generator.js: generate()` → `_loadStandardKeywordsAndSnippets` (~1592, 1624) | 2.1, 2.2, 2.3, FROM-CUS, SRC-L |
| **RC2** | Ranker không có khái niệm “keyword được mong đợi”: keyword = 0 điểm ngữ cảnh (trừ 6 từ ở FROM), trong khi cột +70, hàm +30/+45 | `completion-ranker.js: rank()` mục 2–3 | K-OR, AND-A, IS-N, ORDER-DIR-D, WHERE-OPERAND-I |
| **RC3** | Thưởng tỷ lệ độ dài trong prefix (`80 + len(q)/len(name) × 15`) → tên ngắn luôn thắng; không có trọng số phổ biến | `candidate-filter.js:279` | START-S/U, SEL-CO |
| **RC4** | Cắt 150 sau khi sort với tie-break A–Z → keyword cần thiết ở cuối bảng chữ cái bị loại | `completion-ranker.js:312` | START-EMPTY, TRY, ORDER-DIR, WHERE-OPERAND, IS-EMPTY |
| **RC5** | Khi đã gõ đủ một từ có follow-up, chính từ đang gõ bị tính là `previousToken` → `hasFollowUp = true` → nhánh follow-up **thay thế** keyword chuẩn | `context-analyzer.js` (tính `previousToken`); `candidate-generator.js:1559` | K-ORDER (cũng xảy ra với GROUP, LEFT, INNER, CREATE, ALTER, INSERT, DELETE…) |
| **RC6** | Follow-up keyword không được cộng điểm; clause vẫn là FROM nên bảng +80 lấn át | `completion-ranker.js` | GROUP-BY-KW (`ORDER ␣`, `LEFT ␣` sau FROM tương tự) |
| **RC7** | Analyzer thiếu các vị trí: sau toán hạng, sau `IS`/`IS NOT`, sau nguồn dữ liệu (alias slot), vị trí giá trị (`SET x =`, `VALUES (`), định nghĩa cột trong `CREATE TABLE`, table hint `WITH (`, hướng sắp xếp sau `ORDER BY col`, đối số hàm gộp `COUNT(`, tên alias sau `AS` | `context-analyzer.js` | 2.1, 2.3 |
| **RC8** | Star expansion khớp khi từ gõ là tiền tố của `expand/columns/all/star` → chiếm #1 với mọi từ bắt đầu bằng `a, c, co, col, e, s, st…`; còn xuất hiện trong `COUNT(` | `candidate-filter.js:253`, generator | SEL-C, SEL-CO, COUNT-ARG |
| **RC9** | Ngay sau tên procedure + dấu cách, `execContext.isParameterPosition = false` → procedure +95, tham số 0 | `context-analyzer.js` (execContext) | EXEC-PARAMS |
| **RC10** | Fuzzy tối đa 80 > dải subword 72–79; fuzzy/keyword/hàm vẫn sinh ở vị trí tên bảng | `candidate-filter.js: matchFuzzy` | FROM-CUS, FROM-ORD |
| **RC11** | Ở vị trí sau nguồn, alias khớp chính xác (`o`) và bảng vẫn được sinh, đứng trên `ON` | generator + ranker | JOIN-AFTER-O |
| **RC12** | Hạ tầng test: corpus L2 hầu như chỉ kiểm “contains”, rất ít kiểm thứ tự; provider giả trả FK dạng `foreignTable/column` trong khi backend thật trả `from_table/to_table/from_columns/to_columns` → nhánh “bảng liên quan FK khi JOIN” (`_generateJoinTargetCandidates`) **chưa từng được test** | `tests/js/load.js`, `tests/corpus/intellisense/completions_l2.json` | JOIN-TBL |
| **RC13** | `completion-engine.js` chứa bản sao **cũ** của `CandidateFilter`, `CompletionRanker` (khác bản đang chạy), `CandidateGenerator` (khác) và ghi đè `window.*` ở dòng ~4240 — **sau** khi `defaultEngine` (dòng 4212) đã được tạo bằng bản trong file riêng. Engine đang chạy dùng bản đúng, nhưng mọi chỗ đọc `window.CompletionRanker`/`new CompletionEngine()` về sau sẽ lấy bản cũ | `completion-engine.js:4212, 4240–4244` | Rủi ro bảo trì: sửa `completion-ranker.js` nhưng test/khởi tạo mới dùng bản khác |
| **RC14** | Popup tự bật với **mọi dấu cách trong mệnh đề ON** (`context.clause === 'ON'`), không chỉ ngay sau `ON` | `trigger-controller.js:155` | Cần kiểm tra trên UI (L13) |
| **RC15** | Không có ưu tiên theo lịch sử sử dụng (MRU) | — | — |

---

## 4. Kế hoạch kiểm tra (làm trước khi sửa)

### 4.1. Corpus mới `tests/corpus/intellisense/ranking_l2r.json`

- Chuyển toàn bộ ca ở mục 2 (và Phụ lục A) thành ca có kiểm tra thứ tự.
- Mở rộng runner (`tests/js/test_completions_l2.test.js` hoặc file mới `test_ranking_l2r.test.js`) hỗ trợ:
  - `first: [...]` — một trong các tên là #1 (đã có)
  - `top: {n: 3, contains: [...]}` — các tên nằm trong top n
  - `before: [["DESC","DAY"], …]` — A đứng trước B
  - `absent: [...]` — không có trong danh sách
  - `maxCount: n`
- Ca đang lỗi gắn `"status": "expectedFailure", "issue": "RCx"` (theo A7 của plan 2).

### 4.2. Sửa provider giả (chỉ test)

- `tests/js/load.js`: `foreignKeys` trả **đúng dạng backend** `{constraint_name, from_schema, from_table, from_columns:[…], to_schema, to_table, to_columns:[…]}`; giữ dạng cũ chỉ nếu `_generateJoinOnCandidates` còn dùng (kiểm tra lại khi sửa).
- Thêm ca `JOIN-FK-TARGET`: `SELECT * FROM dbo.Orders o JOIN ‸` → `Customers` (FK) và snippet `Customers c ON c.CustomerID = o.CustomerID` trong top 3.
- Bổ sung vào schema mẫu vài cột gây xung đột tên với keyword để kiểm tra RC2: `dbo.Orders.IsActive (bit)`, `dbo.Orders.Notes (nvarchar)`, `public.orders.is_deleted (boolean)`.

### 4.3. Công cụ dò `tests/js/tools/probe_ranking.js`

- Chạy danh sách tình huống, in top N kèm `type / _matchType / _finalScore` (dùng để báo cáo trước/sau mỗi giai đoạn).

### 4.4. Snapshot thứ tự

- `tests/snapshots/ranking_top10.json`: top 10 của mọi ca corpus L2 + L2R (tên + loại). Test so sánh và in khác biệt; thay đổi snapshot phải được duyệt có chủ đích (tránh đổi thứ tự ngoài phạm vi — quy tắc 2.2).

**Cổng GĐ0**: toàn bộ test xanh với code chưa sửa (ca lỗi ở trạng thái `expectedFailure`).

---

## 5. Kế hoạch nâng cấp (danh sách việc)

Quy ước: mỗi giai đoạn một nhánh; mỗi thay đổi hành vi một commit kèm ca test; không đổi tên export (`window.SqlContextAnalyzer`, `window.CompletionEngine`, `window.CompletionRanker`…); hành vi xếp hạng mới đặt sau cờ `intellisense.v2.ranking` (localStorage + `settings.json`), bật mặc định khi qua cổng. Số dòng chỉ để định vị, phải grep lại.

### GĐ0 – Hạ tầng đo (1–2 ngày)

- [ ] Corpus `ranking_l2r.json` + runner mở rộng (4.1)
- [ ] Sửa dạng FK trong provider giả + cột xung đột (4.2)
- [ ] `tests/js/tools/probe_ranking.js` (4.3)
- [ ] Snapshot top 10 (4.4)
- [ ] Ghi lại baseline hiệu năng

**Cổng**: 163 test cũ + test mới xanh; ca lỗi ở `expectedFailure`.

### GĐ1 – Lỗi ngữ cảnh cục bộ (1–2 ngày)

- [ ] **RC5**: `previousToken`/`previousTokens` loại token chứa con trỏ khi `currentWord` không rỗng; follow-up chỉ xét từ **trước** từ đang gõ. Generator: khi có follow-up **và** đã gõ ký tự, vẫn nạp keyword phù hợp vị trí (không thay thế hoàn toàn).
- [ ] **RC9**: `execContext.isParameterPosition = true` khi con trỏ sau tên procedure (có khoảng trắng, sau `,`, hoặc sau `@p =` giá trị); procedure đã chọn không lặp lại trong danh sách.
- [ ] **RC8**: star expansion chỉ khớp khi từ gõ là `*`, hoặc là tiền tố **≥ 3 ký tự** của `expand`/`star`; không sinh trong đối số hàm (`COUNT(`, `SUM(`…).
- [ ] **RC14**: `on_space` chỉ khi token trước là `ON`, `AND`, `OR` trong mệnh đề ON (không bật sau toán hạng/điều kiện hoàn chỉnh). Kiểm tra trên UI.

**Cổng**: K-ORDER, EXEC-PARAMS, SEL-C, SEL-CO, COUNT-ARG xanh; snapshot không đổi ngoài các ca này.

### GĐ2 – Vị trí cú pháp mới trong analyzer (3–4 ngày)

Thêm trường **`position`** vào kết quả `analyze` (bổ sung, không thay `clause`/`contextType`). Mỗi giá trị một commit + ca test L1:

| `position` | Nhận diện | Ca |
|-----------|-----------|----|
| `statement_start` | Không có token nào trước con trỏ trong câu lệnh; sau `BEGIN`, `BEGIN TRY/CATCH`, `ELSE`, `AS` (thân routine), `THEN` (IF), `;` | START-*, NEWSTMT, TRY |
| `after_source` (+ `aliasSlot`) | Clause FROM/JOIN/UPDATE target, token trước là phần cuối của một nguồn (tên bảng hoặc alias) | SRC-*, JOIN-AFTER*, K-ORDER |
| `after_operand` | WHERE/ON/HAVING/CASE WHEN, token trước là cột/hằng/biến/`)` và không phải toán tử | WHERE-OPERAND*, AND-A, K-OR |
| `is_predicate` | Sau `IS` / `IS NOT` | IS-EMPTY, IS-N |
| `order_direction` | Sau biểu thức trong `ORDER BY` | ORDER-DIR* |
| `value_expression` | Vế phải `SET col =`, trong `VALUES (`, vế phải toán tử so sánh | UPD-SET-VAL, INS-VALUES |
| `column_definition_type` | Sau tên cột trong `CREATE TABLE … (`, `DECLARE @t TABLE (`, `ALTER TABLE … ADD col` → đặt `isDataTypePosition = true` | CREATE-COLTYPE |
| `table_hint` | Trong `WITH (` sau nguồn (SQL Server) | HINT |
| `aggregate_arg` | Đối số đầu của `COUNT/SUM/AVG/MIN/MAX/STRING_AGG(` | COUNT-ARG |
| `alias_name` | Sau `AS` trong select list / sau nguồn | ALIAS-POS → không gợi ý |
| `on_conflict` (PG) | Sau `ON` trong `INSERT … VALUES (…)` | PG-ONCONF |

**Cổng**: ca L1 cho từng `position`; L1 cũ không đổi; L8 (fuzz) 0 exception; `analyze` 218 KB không chậm hơn baseline quá 20%.

### GĐ3 – Sinh ứng viên theo vị trí (3–4 ngày)

- [ ] Bảng **từ khoá mong đợi** theo `position` × dialect, đặt trong `sql-dialects.js` (cạnh danh sách keyword hiện có, không tạo registry mới):
  - `statement_start`: `SELECT, INSERT, UPDATE, DELETE, WITH, DECLARE, SET, EXEC, IF, BEGIN, CREATE, ALTER, DROP, TRUNCATE, MERGE, PRINT, RETURN, THROW` (MSSQL); `SELECT, INSERT, UPDATE, DELETE, WITH, CREATE, ALTER, DROP, TRUNCATE, DO, CALL, PERFORM, RAISE, RETURN` (PG — phần PL/pgSQL chỉ khi trong thân routine)
  - `after_source`: `WHERE, JOIN, INNER, LEFT, RIGHT, FULL, CROSS, OUTER, ON` (sau JOIN), `GROUP, ORDER, HAVING, UNION, EXCEPT, INTERSECT, WITH` (hint, MSSQL), `AS`, `APPLY` (MSSQL), `LIMIT, OFFSET, RETURNING` (PG)
  - `after_operand`: `=, <>, AND, OR, NOT, IN, IS, LIKE, BETWEEN, EXISTS` (+ `ILIKE`, `SIMILAR` PG; `ESCAPE`)
  - `is_predicate`: `NULL, NOT`; `order_direction`: `ASC, DESC, NULLS` (PG), `,`; `table_hint`: `NOLOCK, READUNCOMMITTED, UPDLOCK, ROWLOCK, HOLDLOCK, TABLOCK, READPAST, INDEX, FORCESEEK`; `on_conflict`: `CONFLICT`
- [ ] Ứng viên keyword mong đợi gắn `isExpected: true`. Keyword không mong đợi chỉ nạp khi đã gõ ≥ 2 ký tự và không ở vị trí loại trừ.
- [ ] Không sinh **hàm** ở `statement_start`, `after_source`, `table_name` (FROM/JOIN/INTO/UPDATE); không sinh keyword ngoài danh sách mong đợi ở `table_name` (sửa FROM-CUS, FROM-ORD, SRC-L).
- [ ] `after_source`: không sinh bảng/schema; alias đã khai báo không được gợi ý (RC11).
- [ ] `value_expression`: cột của bảng đích + nguồn, biến, tham số, hàm, `NULL`, `DEFAULT` (VALUES), `CASE`, `CAST`.
- [ ] `column_definition_type`: dùng `_generateDataTypeCandidates` hiện có.
- [ ] `alias_name`: trả danh sách rỗng.

**Cổng**: các ca 2.1–2.3 xanh ở mức “có trong top 10”; số lượng ứng viên trung bình không tăng; `getCompletions` 20.000 object không chậm hơn baseline quá 20%.

### GĐ4 – Ranker v2 (2–3 ngày, sau cờ `intellisense.v2.ranking`)

- [ ] **Khớp chính xác**: ứng viên khớp chính xác (không phân biệt hoa thường) và **không bị loại theo vị trí** đứng #1. Riêng keyword mong đợi khớp chính xác luôn #1 (K-OR, PG-OR).
- [ ] **Keyword mong đợi**: `+90` khi `isExpected` (đủ vượt cột +70 ở `after_operand`, `is_predicate`, `order_direction`, `after_source`); follow-up `+120` (RC6).
- [ ] **Bỏ thưởng tỷ lệ độ dài** (RC3): prefix = `85 + min(3, 15 × len(q)/len(name))`; thêm **trọng số phổ biến** 0–12 cho keyword/hàm (bảng `KEYWORD_POPULARITY`, `FUNCTION_POPULARITY` theo dialect trong `sql-dialects.js`: vd. `SELECT 12, INSERT 10, UPDATE 10, DELETE 9, WHERE 12, JOIN 10, COUNT 12, SUM 10, ISNULL/COALESCE 10, CAST 9, CONVERT 9, GETDATE/NOW 9, MAX/MIN 8 …`).
- [ ] **Fuzzy** tối đa 70 (< subword 72) (RC10).
- [ ] **Cắt danh sách theo hạn mức nhóm** (RC4): keyword mong đợi luôn giữ; keyword khác ≤ 30; hàm ≤ 40; object ≤ 100; cột không giới hạn khi qualifier 1 object (giữ quy tắc 1000 của I8); tổng ≤ 150.
- [ ] Tie-break: điểm → phổ biến → khớp chính xác → độ dài → A–Z.
- [ ] Cờ tắt → dùng nguyên công thức cũ (so sánh song song trong test).

**Cổng**: toàn bộ ca `expectedFailure` thuộc RC2, RC3, RC4, RC6, RC10, RC11 chuyển xanh; snapshot các ca “đang tốt” (2.5) không đổi; khác biệt snapshot còn lại được liệt kê và duyệt.

### GĐ5 – Ưu tiên theo lịch sử dùng (MRU) (1–2 ngày, cờ `intellisense.v2.mru`)

- [ ] Ghi nhận item được chấp nhận (`intellisense.js: chooseItem`): khoá `dbType::connection::type::nameLower`, lưu `localStorage` (bọc try/catch), tối đa 500 mục, giảm dần theo thời gian.
- [ ] Ranker cộng tối đa `+15` **trong cùng nhóm** (không vượt qua keyword mong đợi/khớp chính xác).
- [ ] Settings: bật/tắt, “Xoá lịch sử gợi ý”.

**Cổng**: test đơn vị cho MRU; không đổi kết quả khi cờ tắt.

### GĐ6 – Vệ sinh mã (1 ngày)

- [ ] **RC13**: xoá bản sao `CandidateFilter`, `CompletionRanker`, `CandidateGenerator` trong `completion-engine.js`, **hoặc** chỉ gán `window.X` khi chưa có (`if (!window.CompletionRanker) …`). Thêm test: `DefaultCompletionEngine.ranker instanceof window.CompletionRanker` và `new window.CompletionEngine().ranker.constructor === DefaultCompletionEngine.ranker.constructor`.
- [ ] Cập nhật `tests/snapshots/api_surface.txt` nếu bề mặt API đổi.

**Cổng**: toàn bộ lớp test xanh; L13.

### GĐ7 – Hồi quy, hiệu năng, tài liệu (1–2 ngày)

- [ ] L1, L2, L2R, L3, L8, L9 xanh; perf không chậm hơn baseline quá 20%.
- [ ] L13 (thủ công) bổ sung: gõ `S` ở dòng trống → `SELECT` #1; `WHERE x = 1 OR` + Enter → giữ `OR`; `ORDER BY col D` → `DESC`; `GROUP ␣` → chỉ `BY`; `EXEC proc ␣` → tham số; `CREATE TABLE t (Id ␣` → kiểu dữ liệu; `ON a.x = b.y ␣` không tự bật popup.
- [ ] Cập nhật `quy_tac_va_thu_tu_thuc_hien_intellisense_syntax_check.md` (mục 2.2) và CHANGELOG.

---

## 6. Theo dõi tiến độ

| Giai đoạn | Ước lượng | Cổng | Trạng thái |
|-----------|-----------|------|-----------|
| 0 – Hạ tầng đo | 1–2 ngày | Test cũ + mới xanh (có expectedFailure) | Chưa bắt đầu |
| 1 – Lỗi ngữ cảnh cục bộ | 1–2 ngày | K-ORDER, EXEC-PARAMS, SEL-C/CO, COUNT-ARG | Chưa bắt đầu |
| 2 – `position` trong analyzer | 3–4 ngày | L1 mới, L8, L9 | Chưa bắt đầu |
| 3 – Generator theo vị trí | 3–4 ngày | 2.1–2.3 trong top 10, L9 | Chưa bắt đầu |
| 4 – Ranker v2 | 2–3 ngày | Toàn bộ ca RC2–RC11, snapshot | Chưa bắt đầu |
| 5 – MRU | 1–2 ngày | Test MRU | Chưa bắt đầu |
| 6 – Vệ sinh mã | 1 ngày | Toàn bộ lớp, API surface | Chưa bắt đầu |
| 7 – Hồi quy & tài liệu | 1–2 ngày | L1–L9, L13 | Chưa bắt đầu |

Tổng khoảng 13–20 ngày công.

---

## 7. Điểm cần quyết định

1. **Từ khoá khớp chính xác** (OR/AND/IN/IS/ASC/DESC…) luôn #1 trong biểu thức, kể cả khi có cột cùng tiền tố? (đề xuất: Có)
2. **Thứ tự lệnh đầu câu** theo danh sách cố định ở GĐ3, hay học từ MRU? (đề xuất: danh sách cố định + MRU cộng thêm)
3. **Bảng phổ biến keyword/hàm**: dùng danh sách soạn sẵn theo dialect (đề xuất) hay chỉ dựa MRU?
4. **MRU** bật mặc định sau khi qua cổng hay để người dùng tự bật?
5. **RC13**: xoá hẳn bản sao trong `completion-engine.js` (sạch hơn, đụng file 4.250 dòng) hay chỉ chặn ghi đè `window.*` (an toàn hơn)?
6. **Ctrl+Space ở dòng trống**: chỉ hiện lệnh mở đầu + snippet, hay giữ toàn bộ keyword (đã xếp lại)?

---

## 8. Giới hạn

- Kết quả đo dùng provider giả và schema mẫu trong `tests/js/load.js`; tên object thật của bạn khác, nhưng logic ngữ cảnh/xếp hạng là cùng một code.
- Hành vi popup (bật/tắt khi gõ, phím Enter/Tab) mới kiểm qua đọc code `trigger-controller.js` và `intellisense.js`; cần L13 trên giao diện.
- Chưa đọc từng dòng `scope-resolver.js` (91 KB) và phần lớn `context-analyzer.js` (130 KB); các sửa ở GĐ1–2 phải đọc kỹ hàm liên quan và thêm ca L1 trước.
- Không chạy test Python (pytest) trong lần phân tích này; GĐ0 cần chạy lại toàn bộ để có baseline đầy đủ.

---

## Phụ lục A – Danh sách tình huống probe

`K-OR, K-O, K-ORDER, SRC-EMPTY, SRC-W, SRC-I, SRC-L, JOIN-TBL, JOIN-AFTER, JOIN-AFTER-O, SEL-T, SEL-EMPTY, WHERE-EMPTY, WHERE-OPERAND, WHERE-OPERAND-I, IS-EMPTY, IS-N, START-EMPTY, START-S, START-U, NEWSTMT, UPD-SET, UPD-SET-VAL, INS-INTO, INS-VALUES, DEL-FROM, EXEC, EXEC-PARAMS, VAR-AT, VAR-NOAT, COUNT-ARG, GROUPBY, GROUP-BY-KW, ALTER-PROC, DROP-TABLE, SUB-CID, SUB-ORDT, FUZZ-TTL, QUAL, FROM-CUS, FROM-ORD, ON-FK, HAVING, ORDER-DIR, ORDER-DIR-D, ALIAS-POS, CORREL, CTE-FROM, AND-EMPTY, AND-A, IN-PAREN, TRY, FN-GETD, FN-DATEA, CREATE-COLTYPE, HINT, SEL-C, SEL-CO, WHERE-N, SEL-COMMA, SEL-NOFROM, SEL-NOFROM-C, PG-OR, PG-SRC, PG-LIM, PG-IS, PG-ONCONF, PG-TOCH, PG-FROM, PG-QUOTED, PG-NOW, PG-UPD-WHERE, PG-GETD, MS-LIMIT`

SQL cụ thể của các ca xuất hiện trong bảng mục 2; các ca còn lại dùng schema mẫu A2 (`dbo.Orders`, `dbo.Customers`, `dbo.OrderItems`, `public.orders`, …). Công cụ và danh sách đầy đủ sẽ được đưa vào `tests/js/tools/` ở GĐ0.
