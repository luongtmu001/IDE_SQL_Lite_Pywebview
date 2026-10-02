# SQL IntelliSense (SQL Server + PostgreSQL) — Đặc tả chi tiết cho Agent

> **Đối tượng đọc:** một AI coding agent (hoặc developer) sẽ thiết kế và cài đặt tính năng IntelliSense cho SQL Server (T-SQL) và PostgreSQL.
> **Mục tiêu tài liệu:** cung cấp đủ ngữ cảnh, quy tắc, cấu trúc dữ liệu, thuật toán, ca kiểm thử và tiêu chí nghiệm thu để agent có thể tự triển khai mà không phải đoán.
> **Ngôn ngữ mã ví dụ:** pseudo-TypeScript (trung lập). Nếu repo đã có sẵn ngôn ngữ/framework, **hãy dùng ngôn ngữ đó** và giữ nguyên convention của repo.

---

## 0. Cách sử dụng tài liệu này (dành cho Agent)

### 0.1. Quy trình làm việc bắt buộc

1. **Khảo sát repo trước khi viết code:** xác định ngôn ngữ, build system, test framework, editor host (VS Code extension / LSP server / Monaco / desktop app), cách kết nối DB hiện có. Ghi lại kết quả trong `docs/intellisense/DECISIONS.md`.
2. **Làm theo milestone** ở Mục 15, theo thứ tự. Không nhảy cóc. Mỗi milestone phải có test xanh trước khi sang milestone kế.
3. **Viết test trước hoặc cùng lúc** với code (Mục 14). Mọi hành vi mô tả trong tài liệu này phải có ít nhất một test tương ứng.
4. **Không đoán metadata/hành vi dialect.** Nếu không chắc một quy tắc của T-SQL hoặc PostgreSQL, ghi vào `docs/intellisense/OPEN_QUESTIONS.md` và chọn hành vi an toàn nhất (trả về ít gợi ý hơn nhưng đúng, thay vì nhiều gợi ý nhưng sai).
5. **Không bao giờ throw ra ngoài** từ đường xử lý completion. Mọi lỗi phải bị bắt, log, và trả về danh sách rỗng hoặc gợi ý suy giảm (degraded).

### 0.2. Nguyên tắc ưu tiên khi có xung đột

1. **Đúng** > **đầy đủ** > **nhanh** > **đẹp**. Một gợi ý sai (ví dụ cột không tồn tại trong scope) tệ hơn thiếu một gợi ý.
2. **Chịu lỗi (tolerant)**: SQL người dùng đang gõ gần như luôn không hợp lệ. Hệ thống phải hoạt động tốt trên SQL **chưa hoàn chỉnh**.
3. **Tách dialect** vào một lớp riêng. Không rải `if (dialect === 'pg')` khắp nơi.
4. **Độ trễ**: phản hồi completion phải cảm giác tức thì (mục tiêu ở Mục 13).

### 0.3. Thuật ngữ

| Thuật ngữ | Ý nghĩa |
|---|---|
| **Cursor context** | Loại vị trí con trỏ đang đứng (sau `SELECT`, sau `FROM`, sau `alias.`, ...) |
| **Scope** | Tập các quan hệ (bảng, view, CTE, subquery...) và cột nhìn thấy được tại một điểm trong câu lệnh |
| **Binding** | Gắn một tên (alias/bảng) trong câu SQL với đối tượng thật trong catalog hoặc với một scope con |
| **Catalog / Metadata** | Thông tin schema lấy từ DB: bảng, cột, kiểu, khóa, hàm, thủ tục |
| **Prefix** | Phần chữ người dùng đã gõ dở tại con trỏ (ví dụ `Us` trong `SELECT Us|`) |
| **Qualifier** | Phần trước dấu chấm (ví dụ `u` trong `u.na|`) |
| **Replacement range** | Đoạn văn bản sẽ bị thay khi người dùng chọn một gợi ý |

---

## 1. Mục tiêu và phạm vi

### 1.1. Chức năng cần có (theo mức ưu tiên)

**P0 – Bắt buộc**
- Completion: từ khóa, schema, bảng, view, cột, alias, CTE, hàm, thủ tục, kiểu dữ liệu.
- Nhận biết đúng scope: alias, CTE, derived table, subquery, JOIN, DML target.
- Qualified completion: `alias.`, `schema.`, `db.schema.` (T-SQL), `schema.`(PG).
- Xử lý SQL chưa hoàn chỉnh.
- Quoting đúng dialect khi chèn (`[x]` / `"x"`).
- Hỗ trợ hai dialect: SQL Server, PostgreSQL.

**P1 – Nên có**
- Gợi ý JOIN/ON dựa trên foreign key.
- Signature help (tham số hàm/thủ tục).
- Hover (kiểu cột, nullable, PK/FK, định nghĩa ngắn).
- Ranking thông minh (ngữ cảnh, tần suất dùng, tương thích kiểu).
- Temp table, table variable, biến `@var`, `SELECT ... INTO #t`.
- Snippet cho pattern phổ biến (`SELECT ... FROM`, `JOIN ... ON`).

**P2 – Mở rộng**
- Diagnostics nhẹ (tên chưa resolve, cột mơ hồ).
- Go-to-definition, find references trong file.
- Cross-database (T-SQL), cross-schema (PG), linked server.
- Injection ngôn ngữ trong thân hàm PG (`$$ ... $$`), thân stored procedure.
- Gợi ý theo kiểu (type-aware) trong biểu thức, toán tử JSON PG.

### 1.2. Ngoài phạm vi (không làm trừ khi được yêu cầu)
- Thực thi câu lệnh, format code, refactor.
- Hỗ trợ dialect khác (MySQL, Oracle...) — nhưng **thiết kế phải cho phép thêm dialect mới** chỉ bằng cách thêm một module dialect.

---

## 2. Nguyên tắc thiết kế cốt lõi

1. **Scope analysis là trái tim.** Độ "chi tiết" của IntelliSense đến từ việc biết chính xác cột/bảng nào nhìn thấy được tại con trỏ, không phải từ parser hoàn hảo.
2. **Parser chỉ cần "đủ dùng"**: không cần parse mọi cú pháp; cần trích ra cấu trúc quan trọng cho scope (clause, FROM-list, JOIN, CTE, subquery, DML target) và **không được sụp đổ** khi gặp phần không hiểu — hãy bỏ qua (skip) và đồng bộ lại (re-sync) ở token neo (clause keyword, dấu ngoặc, dấu `;`).
3. **Pipeline thuần (pure) và có thể test**: từ `(text, offset, dialect, catalogSnapshot)` → `CompletionResult`. Không I/O trong phân tích; I/O chỉ nằm ở lớp metadata và được inject qua interface.
4. **Bất biến dữ liệu**: token, AST/scope là immutable, dễ cache theo phiên bản văn bản.
5. **Dialect là dữ liệu + chiến lược**: từ khóa, quy tắc quote, hàm built-in, quy tắc scope đặc thù nằm trong `DialectProfile`.
6. **Degrade gracefully**: nếu binder thất bại, vẫn trả về gợi ý theo cursor context; nếu context cũng thất bại, trả từ khóa/đối tượng chung.

---

## 3. Kiến trúc tổng thể

### 3.1. Pipeline

```
 text + offset + dialect
        │
        ▼
 ┌───────────────┐
 │ 1. Lexer      │  tokens (kể cả comment, whitespace, token dở dang)
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 2. Statement  │  cắt batch/câu lệnh chứa con trỏ (GO, ;, $$ ...)
 │    isolation  │
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 3. Tolerant   │  cây cấu trúc một phần: clause, FROM, JOIN, CTE, subquery
 │    structure  │
 │    parser     │
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 4. Cursor     │  xác định CursorContext (loại vị trí, prefix, qualifier)
 │    classifier │
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 5. Scope      │  dựng chuỗi Scope, bind tên với catalog
 │    binder     │
 └───────┬───────┘
         ▼
 ┌───────────────┐        ┌────────────────┐
 │ 6. Candidate  │◄──────►│ Metadata store │  (cache, lazy load)
 │    generator  │        └────────────────┘
 └───────┬───────┘
         ▼
 ┌───────────────┐
 │ 7. Ranker &   │  lọc, chấm điểm, sắp xếp, tạo insertText/range
 │    formatter  │
 └───────────────┘
```

### 3.2. Cấu trúc thư mục đề xuất (điều chỉnh theo repo)

```
intellisense/
  core/
    types.ts              // Token, Range, CursorContext, Candidate...
    pipeline.ts           // orchestration
  lexer/
    lexer.ts              // khung chung
    tsql.lexer.ts         // quy tắc riêng T-SQL
    pg.lexer.ts           // quy tắc riêng PG
  statement/
    isolate.ts
  parser/
    structure-parser.ts   // tolerant parser
    clauses.ts
  context/
    classify.ts           // CursorContext
  scope/
    scope.ts              // Scope, RelationBinding
    binder.ts
    star-expansion.ts
    column-inference.ts   // suy ra cột output của subquery/CTE
  metadata/
    catalog.ts            // interface
    catalog-cache.ts
    mssql.provider.ts
    pg.provider.ts
    queries/
  completion/
    generators/           // mỗi context một generator
    ranker.ts
    quoting.ts
    snippets.ts
  dialect/
    profile.ts            // interface DialectProfile
    tsql.profile.ts
    pg.profile.ts
    keywords.ts
    builtin-functions.ts
  features/
    signature-help.ts
    hover.ts
    diagnostics.ts
  testing/
    cursor-marker.ts      // parse "SELECT | FROM t"
    fixtures/
      catalogs/           // catalog giả cho test
      cases/              // test case golden
```

### 3.3. Interface chính (bắt buộc giữ ổn định)

```ts
type Dialect = 'tsql' | 'pg';

interface CompletionRequest {
  text: string;
  offset: number;              // 0-based, UTF-16 code unit index (thống nhất với editor host!)
  dialect: Dialect;
  connection?: ConnectionInfo; // database hiện tại, search_path/default schema...
  options?: { maxItems?: number; triggerChar?: string; cancel?: CancelToken };
}

interface CompletionResult {
  items: CompletionItem[];
  isIncomplete: boolean;      // true nếu bị cắt/đang load metadata
  context: CursorContext;     // để debug/test
  diagnostics?: string[];     // thông tin degrade, chỉ dùng nội bộ/log
}

interface CompletionItem {
  label: string;              // hiển thị
  kind: 'keyword'|'schema'|'table'|'view'|'matview'|'cte'|'column'|'function'|
        'procedure'|'type'|'alias'|'variable'|'snippet'|'database'|'parameter'|'operator';
  insertText: string;         // đã quote đúng dialect nếu cần
  range: Range;               // replacement range
  detail?: string;            // ví dụ "int NOT NULL, PK"
  documentation?: string;
  sortText: string;           // quyết định thứ tự cuối cùng
  filterText?: string;
  commitCharacters?: string[];
  data?: unknown;             // resolve lazy
}

interface CatalogProvider {                   // inject vào pipeline
  listDatabases(): Promise<DbInfo[]>;
  listSchemas(db?: string): Promise<SchemaInfo[]>;
  listRelations(schema: string, db?: string): Promise<RelationInfo[]>;   // table/view/matview/foreign
  getColumns(rel: RelationRef): Promise<ColumnInfo[]>;
  getRoutines(schema?: string, db?: string): Promise<RoutineInfo[]>;
  getForeignKeys(rel: RelationRef): Promise<ForeignKeyInfo[]>;
  getTypes(schema?: string): Promise<TypeInfo[]>;
  // tất cả phải hỗ trợ CancelToken và trả về từ cache nếu có
}
```

> **Lưu ý về offset:** editor như VS Code/Monaco dùng UTF-16 code unit; một số lexer dùng code point. Chọn **một** quy ước (khuyến nghị UTF-16) và chuyển đổi ở biên. Có test với emoji và ký tự tiếng Việt có dấu trong identifier/chuỗi.

---

## 4. Lexer (dialect-aware, chịu lỗi)

### 4.1. Loại token

```ts
type TokenKind =
  | 'keyword' | 'identifier' | 'quotedIdentifier'
  | 'string' | 'number' | 'operator' | 'punct'    // ( ) , . ; ::
  | 'variable'      // @x (tsql), $1 (pg), :name (tùy host)
  | 'tempName'      // #t, ##t (tsql)
  | 'lineComment' | 'blockComment' | 'whitespace'
  | 'batchSeparator'  // GO (tsql, chỉ khi đứng một mình trên dòng)
  | 'unknown';
interface Token { kind: TokenKind; text: string; start: number; end: number; terminated: boolean; }
```

- Giữ `whitespace` và `comment` trong danh sách token (cần cho vị trí, khôi phục range), nhưng cung cấp view "significant tokens" để parser dùng.
- Trường `terminated` cho string/quoted identifier/block comment: nếu **chưa đóng** (người dùng đang gõ `[Us` hoặc `'abc`), token kéo dài đến hết dòng/hết văn bản và `terminated=false`. Điều này cực kỳ quan trọng để nhận biết "con trỏ đang ở trong identifier dở dang".

### 4.2. Quy tắc T-SQL

| Chủ đề | Quy tắc |
|---|---|
| Identifier quote | `[name]`; `]` được escape bằng `]]`. Dấu `"name"` chỉ là identifier khi `QUOTED_IDENTIFIER ON` (mặc định ON trong hầu hết client hiện đại) — mặc định coi `"..."` là identifier. |
| String | `'...'` với `''` để escape. Tiền tố `N'...'` (Unicode). |
| Comment | `-- ...` đến hết dòng; `/* ... */` **có thể lồng nhau** trong T-SQL. |
| Biến | `@var`, `@@sysvar`. |
| Temp | `#t` (local), `##t` (global). Ký tự `#` hợp lệ đầu identifier. |
| Batch | `GO` (không phải T-SQL, là lệnh client): chỉ nhận là separator khi là **token duy nhất trên dòng** (có thể kèm số lặp `GO 5`) và không nằm trong comment/string. |
| Toán tử | `+=`, `-=`, `!=`, `<>`, `!<`, `!>`, `::` (gọi method kiểu CLR/hierarchyid). |
| Số | `0x1F` (hex), `1e3`, `.5`. |
| Identifier | Có thể chứa `@`, `#`, `$`, `_` và ký tự Unicode. |

### 4.3. Quy tắc PostgreSQL

| Chủ đề | Quy tắc |
|---|---|
| Identifier quote | `"name"`; `"` escape bằng `""`. Identifier không quote **bị gập về chữ thường**. |
| String | `'...'` (`''` escape); `E'...'` (escape kiểu C với `\`); `U&'...'`; **dollar quoting** `$tag$ ... $tag$` (tag có thể rỗng: `$$`). |
| Comment | `-- ...`; `/* ... */` **có thể lồng nhau**. |
| Cast | `::type`. Sau `::` là **ngữ cảnh kiểu dữ liệu**. |
| Tham số | `$1`, `$2` (positional; phân biệt với dollar-quote: `$` + chữ số là tham số). |
| Toán tử | Rất nhiều: `->`, `->>`, `#>`, `#>>`, `@>`, `<@`, `?`, `?|`, `?&`, `||`, `~`, `~*`, `!~`, `::`, `&&`, `<->`,... Lexer dùng longest-match trên tập ký tự toán tử `+-*/<>=~!@#%^&|` `` ` ``?. |
| Meta-command psql | Dòng bắt đầu bằng `\` (nếu host cho phép) → bỏ qua cả dòng, không lỗi. |

### 4.4. Ca biên lexer phải có test

- Dấu `.` giữa số và identifier: `1.5`, `t.col`, `db..table` (T-SQL: schema mặc định bị bỏ trống), `schema.table.*`.
- Chuỗi chưa đóng chứa từ khóa: `WHERE name = 'SEL|`.
- Comment chưa đóng: `/* SELECT | ` → con trỏ trong comment ⇒ **không gợi ý** (hoặc chỉ gợi ý rất tối thiểu tuỳ cấu hình).
- Dollar-quote lồng nhau: `$body$ SELECT $$x$$ $body$`.
- `GO` trong chuỗi/comment không được coi là separator.
- Ký tự Unicode (tiếng Việt) trong identifier: `[Tên khách hàng]`, `"Tên"`.
- CRLF vs LF: offset phải khớp tuyệt đối.

---

## 5. Cô lập câu lệnh (Statement isolation)

Mục đích: chỉ phân tích **câu lệnh chứa con trỏ**, không phải cả file.

### 5.1. Thuật toán

1. Dùng token đã lex. Tách **batch** bằng `batchSeparator` (T-SQL). PG không có `GO`.
2. Trong batch, tách **statement** theo `;` ở **paren-depth = 0** và ngoài dollar-quote/string/comment.
3. **T-SQL đặc biệt:** `;` là tuỳ chọn. Nhiều statement liền nhau không có `;` (ví dụ `SELECT 1 SELECT 2`). Heuristic bổ sung: khi gặp một **keyword bắt đầu statement** (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `WITH`, `DECLARE`, `SET`, `EXEC`, `CREATE`, `ALTER`, `DROP`, `IF`, `WHILE`, `BEGIN`, `RETURN`, `PRINT`...) ở paren-depth 0 **và** ngữ pháp trước đó đã "hoàn chỉnh" ⇒ có thể là statement mới. Cẩn thận các trường hợp không tách:
   - `INSERT INTO t SELECT ...` (SELECT thuộc INSERT).
   - `WITH cte AS (...) SELECT ...` (SELECT thuộc WITH).
   - `UNION/INTERSECT/EXCEPT` rồi `SELECT`.
   - `CREATE VIEW v AS SELECT ...`.
   - `EXISTS (SELECT ...)`, subquery trong ngoặc (depth > 0).
   - `IF ... SELECT` / `ELSE SELECT` (kiểm soát luồng: statement con).
   Khi không chắc, **ưu tiên gộp** (giữ trong cùng statement) thay vì tách sai.
4. **PG:** thân `CREATE FUNCTION ... AS $$ ... $$` là một token chuỗi. Ở P2 có thể "injection" phân tích thân bên trong như một ngữ cảnh riêng (plpgsql/sql) khi con trỏ nằm trong đó.
5. Trả về: `{ statementTokens, statementRange, precedingStatements[] }`. `precedingStatements` cần cho **trạng thái xuyên statement** (temp table, biến, table variable) — xem Mục 8.6.

### 5.2. Khi con trỏ nằm giữa hai statement / ở khoảng trắng

- Nếu con trỏ ngay sau `;` hoặc ở dòng trống ⇒ context `StatementStart` (gợi ý keyword bắt đầu câu lệnh + snippet).
- Nếu con trỏ ở cuối statement chưa có `;` và trước đó là token hoàn chỉnh ⇒ tuỳ ngữ cảnh (có thể vẫn đang tiếp tục statement).

---

## 6. Parser cấu trúc chịu lỗi (Tolerant structure parser)

### 6.1. Chiến lược khuyến nghị: **Hybrid**

Không cần grammar đầy đủ. Kết hợp:

1. **Recursive-descent "lỏng"** chỉ cho các cấu trúc ảnh hưởng scope:
   - `WITH` (CTE list, `RECURSIVE` ở PG), `SELECT` (select-list, `FROM`, `JOIN`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `WINDOW`), set operation, subquery, `VALUES`, table function, `APPLY`/`LATERAL`.
   - DML: `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `OUTPUT`/`RETURNING`, `SELECT INTO`.
   - DDL tối thiểu cho gợi ý: `CREATE TABLE` (cột/kiểu/ràng buộc), `ALTER TABLE`, `CREATE INDEX (cols)`, `CREATE VIEW ... AS`.
2. **Quét token (token-scan)** cho việc phân loại con trỏ: đi ngược từ con trỏ, theo dõi độ sâu ngoặc để tìm **clause keyword gần nhất** cùng cấp.
3. **Placeholder injection** (tuỳ chọn, tăng độ chính xác): chèn một identifier giả (ví dụ `__cursor__`) tại con trỏ và, nếu statement thiếu phần đóng, "vá" bằng cách thêm token ngoặc/`FROM` giả; sau đó parse lại. Dùng để suy ra vị trí của con trỏ trong cây.

### 6.2. Quy tắc chịu lỗi (bắt buộc)

- **Không bao giờ throw** khi gặp token bất ngờ. Ghi một node `Error/Unknown` gồm range, rồi **re-sync** ở token neo tiếp theo.
- **Token neo** để re-sync: clause keyword cùng cấp (`FROM`, `WHERE`, `GROUP`, `HAVING`, `ORDER`, `UNION`, `INTERSECT`, `EXCEPT`, `LIMIT`, `OFFSET`, `FETCH`, `FOR`, `OPTION`, `INTO`, `SET`, `VALUES`, `ON`, `USING`, `RETURNING`, `OUTPUT`), dấu `,` cấp hiện tại, `)` đóng cấp hiện tại, `;`.
- **Ngoặc chưa đóng** là trường hợp thường gặp nhất: coi hết statement là đóng các ngoặc còn mở (auto-close ở cuối).
- **Cấp `FROM` không đầy đủ**: `FROM Users u JOIN |` → JOIN có "vế phải rỗng" ⇒ node `Join{ right: Missing }`.
- Giữ **vị trí** (start/end) cho mọi node để ánh xạ con trỏ → node.

### 6.3. Mô hình dữ liệu cây (rút gọn)

```ts
interface SelectNode {
  kind: 'select';
  range: Range;
  with?: CteNode[];
  distinct?: boolean; top?: unknown;                  // TOP (tsql)
  selectList: SelectItem[];                           // mỗi item: expr + alias? + range
  from?: FromClause;                                  // danh sách table-source cấp trên cùng
  where?: ExprNode; groupBy?: ExprNode[]; having?: ExprNode;
  orderBy?: OrderItem[];
  into?: TableRef;                                    // SELECT ... INTO #t
  setOp?: { op: 'union'|'union all'|'intersect'|'except'; right: SelectNode };
  clauseRanges: Record<ClauseName, Range>;            // để phân loại con trỏ nhanh
}

type TableSource =
  | { kind: 'table'; name: QualifiedName; alias?: string; columnAliases?: string[]; hints?: unknown; only?: boolean }
  | { kind: 'derived'; select: SelectNode; alias?: string; columnAliases?: string[]; lateral?: boolean }
  | { kind: 'function'; name: QualifiedName; args: ExprNode[]; alias?: string; columnAliases?: string[]; lateral?: boolean }
  | { kind: 'values'; rows: ExprNode[][]; alias?: string; columnAliases?: string[] }
  | { kind: 'join'; type: 'inner'|'left'|'right'|'full'|'cross'|'cross apply'|'outer apply'|'natural';
      left: TableSource; right: TableSource | Missing; on?: ExprNode; using?: string[] }
  | { kind: 'openjson'|'pivot'|'unpivot'|'other'; ... };

interface CteNode { name: string; columnList?: string[]; body: SelectNode | DmlNode | Unknown; recursive?: boolean; range: Range; }
```

### 6.4. Phân biệt các cấu trúc dễ nhầm

- `a.b.c` trong FROM là tên bảng 3 phần; trong select-list có thể là `schema.table.col` hoặc `alias.col.field`. Trì hoãn quyết định cho **binder**.
- `FROM t1, t2` (join ngầm bằng dấu phẩy) tương đương `CROSS JOIN` về scope.
- `FROM t AS x (a, b)`: alias kèm danh sách tên cột (ghi đè tên cột gốc theo thứ tự).
- `SELECT a AS x`, `SELECT a x`, `SELECT x = a` (T-SQL, alias đứng trước dấu `=`).
- PG: `SELECT DISTINCT ON (expr) ...`.
- T-SQL `TOP (n) [PERCENT] [WITH TIES]`.
- Function trong FROM vs. bảng: sự hiện diện của `(` ngay sau tên.

---

## 7. Phân loại ngữ cảnh con trỏ (Cursor Context Taxonomy)

### 7.1. Đầu ra của classifier

```ts
interface CursorContext {
  kind: ContextKind;
  prefix: string;                 // chữ đã gõ dở (đã bỏ dấu quote mở)
  prefixRange: Range;             // range sẽ bị thay khi chọn gợi ý
  isQuotedPrefix: boolean;        // người dùng đã mở [ hoặc "
  qualifier?: QualifiedPath;      // ["dbo"], ["u"], ["db","dbo"] ...
  clause: ClauseName;             // select|from|join|on|where|groupBy|having|orderBy|set|values|into|...
  statementKind: 'select'|'insert'|'update'|'delete'|'merge'|'ddl'|'exec'|'other';
  scopeNode?: SelectNode | DmlNode; // node chứa con trỏ (để binder dựng scope)
  expected?: ExpectedType;        // kiểu mong đợi (P2), ví dụ so sánh với cột int
  alreadyListed?: string[];       // cột đã liệt kê (INSERT column list, SET list)
  triggerChar?: string;
  inComment: boolean; inString: boolean;
}
```

### 7.2. Bảng taxonomy (đầy đủ) — mỗi `kind` có một generator riêng

| Context kind | Ví dụ (`|` = con trỏ) | Ứng viên chính | Ghi chú |
|---|---|---|---|
| `StatementStart` | `|` / `...; |` | Keyword mở đầu câu lệnh, snippet | T-SQL thêm `EXEC`, `DECLARE`, `USE`; PG thêm `COPY`, `EXPLAIN`, `\` bỏ qua |
| `SelectList` | `SELECT |`, `SELECT a, |` | Cột **của mọi quan hệ trong scope**, alias, hàm, `*`, keyword (`DISTINCT`, `TOP`, `CASE`), biến | Nếu FROM **đứng sau** con trỏ (người dùng gõ SELECT trước), vẫn phải nhìn **về phía sau** để lấy scope! |
| `SelectListQualified` | `SELECT u.|` | Cột của `u` (+ `*`) | Nếu `u` không phải alias, thử schema/bảng |
| `FromTarget` | `FROM |`, `FROM a, |` | Bảng/view/CTE/hàm bảng, schema, DB | Không gợi ý cột. Ưu tiên CTE đang visible. |
| `FromQualified` | `FROM dbo.|`, `FROM db.dbo.|` | Đối tượng trong schema | `db..` (T-SQL) = schema mặc định |
| `JoinTarget` | `JOIN |` | Như FromTarget **+ gợi ý theo FK** từ các bảng đã có trong scope | Xếp bảng có FK liên quan lên đầu |
| `JoinOn` | `JOIN b ON |` | Cột từ vế trái **và** vế phải; snippet `a.fk = b.pk` từ FK | Chỉ scope tới điểm JOIN này (chưa thấy bảng JOIN sau) |
| `JoinUsing` (PG) | `JOIN b USING (|` | Cột chung tên ở cả hai vế | |
| `Where` / `Having` / `Predicate` | `WHERE |`, `AND |` | Cột, hàm, biến, toán tử, `EXISTS`, `IN` | Không gồm alias select-list (cả hai dialect) |
| `GroupBy` | `GROUP BY |` | Cột; PG: thêm alias select-list và số thứ tự | T-SQL **không** cho alias trong GROUP BY |
| `OrderBy` | `ORDER BY |` | Alias select-list, cột, số thứ tự, `ASC/DESC/NULLS` (PG) | Cho phép alias ở cả hai dialect |
| `WindowClause` | `OVER (PARTITION BY |` | Cột, `ORDER BY` | |
| `ExpressionOperand` | `a.x = |`, `a.x > |` | Cột **tương thích kiểu**, hằng, hàm | P2: type-aware |
| `InsertTarget` | `INSERT INTO |` | Bảng ghi được (không gồm view không updatable nếu biết) | |
| `InsertColumns` | `INSERT INTO t (|`, `(a, |` | Cột của `t` **trừ** cột đã liệt kê; ưu tiên cột không identity/computed | T-SQL: bỏ identity, computed, rowversion. PG: bỏ `GENERATED ALWAYS`. |
| `InsertValues` | `VALUES (|` | Gợi ý hằng/hàm; hint tham số theo cột tương ứng | Tính vị trí cột theo số dấu `,` ở depth hiện tại |
| `UpdateTarget` | `UPDATE |` | Bảng/view | |
| `UpdateSet` | `UPDATE t SET |`, `SET a = 1, |` | Cột của target (trừ đã set) | PG: `SET (a, b) = (...)` |
| `UpdateSetValue` | `SET a = |` | Biểu thức; cột từ FROM của UPDATE | |
| `DeleteTarget` | `DELETE FROM |` / `DELETE |` (T-SQL) | Bảng | T-SQL `DELETE a FROM t a JOIN ...` — target là alias |
| `MergeXxx` | `MERGE INTO t USING s ON |`, `WHEN MATCHED THEN UPDATE SET |` | Target + source; `inserted`... không dùng trong MERGE, dùng `OUTPUT` | T-SQL bắt buộc kết thúc `;` |
| `OutputClause` (T-SQL) | `OUTPUT |` | `inserted.`, `deleted.`, `$action` (MERGE) | |
| `ReturningClause` (PG) | `RETURNING |` | Cột của target, `*` | |
| `OnConflict` (PG) | `ON CONFLICT (|` / `DO UPDATE SET x = EXCLUDED.|` | Cột target / cột `EXCLUDED` | `EXCLUDED` là pseudo-relation |
| `SelectInto` | `SELECT ... INTO |` | Không gợi ý tên bảng tồn tại (đang tạo mới); có thể gợi ý `#` | |
| `CteName` / `CteColumnList` | `WITH |`, `WITH c (|` | (tên tự đặt) / không gợi ý | |
| `TypePosition` | `CAST(x AS |`, `x::|`, `DECLARE @v |`, cột trong `CREATE TABLE` | Kiểu built-in, kiểu user (PG: enum/domain/composite; T-SQL: alias type, table type) | PG sau `::` |
| `CreateTableColumns` | `CREATE TABLE t (id |` | Kiểu, ràng buộc (`PRIMARY KEY`, `NOT NULL`, `REFERENCES`) | |
| `ReferencesTarget` | `REFERENCES |` / `REFERENCES t (|` | Bảng / cột của bảng đó | |
| `CreateIndexColumns` | `CREATE INDEX ix ON t (|` | Cột của `t` | |
| `AlterTable...` | `ALTER TABLE t ADD |`, `DROP COLUMN |` | Cột của `t` / keyword | |
| `ExecTarget` | `EXEC |`, `CALL |`, `SELECT * FROM fn(|` | Thủ tục / hàm | PG `CALL proc(...)` |
| `ExecParams` | `EXEC sp @|`, `sp @a = 1, @|` | Tên tham số chưa dùng | T-SQL; PG dùng `name => value` |
| `FunctionArgs` | `fn(a, |` | Signature help + biểu thức | Chọn overload theo số/kiểu đối số (PG nhiều overload) |
| `VariableRef` (T-SQL) | `@|`, `SET @|` | Biến đã DECLARE trong batch/param | |
| `TableHint` (T-SQL) | `FROM t WITH (|` | `NOLOCK`, `READPAST`, `INDEX(...)`... | |
| `UseDatabase` (T-SQL) | `USE |` | Database | |
| `Comment` / `String` | Trong comment/chuỗi | **Không gợi ý** (trừ khi là ngữ cảnh đặc biệt) | Chuỗi trong `LIKE '...'` không gợi ý |
| `Unknown` | Không phân loại được | Keyword chung + đối tượng phổ biến | Fallback |

### 7.3. Thuật toán phân loại (token-scan có kiểm tra bằng cấu trúc)

1. Tìm token tại/ngay trước con trỏ. Nếu con trỏ nằm **trong** token (`Us|er`), `prefix` = phần từ đầu token tới con trỏ; `prefixRange` = toàn bộ token (để thay cả phần đuôi) hoặc chỉ phần đầu (tuỳ cấu hình host — mặc định thay cả từ).
2. Nếu token trước con trỏ là `.` ⇒ có `qualifier`: đi ngược thu thập chuỗi `ident . ident .`. Xử lý cả dạng quote: `[dbo].[Us|`.
3. Nếu con trỏ trong comment/string ⇒ `Comment`/`String`.
4. Xác định **clause hiện tại** bằng cách đi ngược, **giữ độ sâu ngoặc** (`)` tăng, `(` giảm; dừng ở cấp cùng độ sâu). Bỏ qua nội dung trong ngoặc ở cấp thấp hơn. Với mỗi cấp, ghi nhớ `clause keyword` gần nhất.
5. Dùng **structure parser** để xác định `scopeNode` (SelectNode/DmlNode nhỏ nhất chứa con trỏ).
6. Kiểm tra **token liền trước** (`prevSignificant`) và **hai token trước** để tinh chỉnh (ví dụ sau `ON` ⇒ `JoinOn`; sau `,` trong FROM ⇒ `FromTarget`; sau `AS` trong `CAST(`... ⇒ `TypePosition`; sau `::` ⇒ `TypePosition`).
7. Với `SelectList`, **luôn** cố lấy FROM **nằm sau con trỏ** trong cùng statement (người dùng thường gõ `SELECT |` trước rồi mới `FROM`). Đây là trường hợp then chốt: scope không bị cắt tại con trỏ.
8. Trường hợp mơ hồ (ví dụ `SELECT a |` — alias hay tiếp tục?): trả về tập hợp **gộp** các ứng viên hợp lệ (keyword `AS`, `FROM`, toán tử, ...) thay vì đoán một.

### 7.4. Bảng "keyword kế tiếp hợp lệ" (state machine tối giản)

Xây `nextKeywords[clauseState]` để gợi ý keyword chính xác. Ví dụ:

| Sau | Keyword hợp lệ tiếp theo (rút gọn) |
|---|---|
| `SELECT` | `DISTINCT`, `ALL`, `TOP`(tsql), `*`, `CASE`, `CAST`, ... |
| biểu thức trong select-list hoàn chỉnh | `AS`, `,`, `FROM`, `INTO`(tsql), `UNION`, `WHERE`?(không), ... |
| `FROM t` | `AS`, alias, `JOIN`, `INNER`, `LEFT`, `RIGHT`, `FULL`, `CROSS`, `WHERE`, `GROUP`, `ORDER`, `UNION`, `WITH (`(tsql), `TABLESAMPLE`(pg), `,` |
| `JOIN t` | `AS`, alias, `ON`, `USING`(pg) |
| `WHERE expr` | `AND`, `OR`, `GROUP`, `ORDER`, `HAVING`, `UNION`, `LIMIT`(pg), `OPTION`(tsql) |
| `ORDER BY expr` | `ASC`, `DESC`, `NULLS FIRST/LAST`(pg), `OFFSET`, `FETCH`, `LIMIT`(pg), `,` |

Nguyên tắc: không nhất thiết đầy đủ, nhưng **không được gợi ý keyword sai** (ví dụ `LIMIT` trong T-SQL, `TOP` sau `FROM`).

---

## 8. Phân tích scope và binding (phần quan trọng nhất)

### 8.1. Mô hình Scope

```ts
interface Scope {
  id: number;
  kind: 'query'|'cte'|'derived'|'lateral'|'subquery'|'dmlTarget'|'batch';
  parent?: Scope;                    // scope bên ngoài
  relations: RelationBinding[];      // quan hệ khai báo TẠI cấp này (FROM/JOIN)
  ctes: Map<string, CteBinding>;     // CTE khai báo tại cấp này (WITH)
  outputColumns?: OutputColumn[];    // cột đầu ra của SELECT (dùng cho ORDER BY, derived table, CTE)
  outerVisible: boolean;             // scope cha có nhìn thấy được không (correlated)
  pseudo?: PseudoRelation[];         // inserted/deleted (tsql), EXCLUDED, NEW/OLD (pg trigger) ...
}

interface RelationBinding {
  qualifiers: string[];              // tên có thể dùng để tham chiếu: [alias] hoặc [table] hoặc [schema, table]
  kind: 'table'|'view'|'matview'|'foreign'|'cte'|'derived'|'function'|'values'|
        'tempTable'|'tableVariable'|'pseudo'|'unknown';
  source?: RelationRef;              // đối tượng catalog thật (nếu có)
  columns: () => Promise<ColumnInfo[]>|ColumnInfo[]; // lazy
  hiddenBaseName?: boolean;          // true nếu có alias ⇒ tên gốc KHÔNG dùng được
  joinKind?: JoinType;               // để biết nullable hoá (outer join)
  mergedUsingColumns?: string[];     // PG USING/NATURAL
  origin: Range;                     // vị trí khai báo trong văn bản
}
```

### 8.2. Thuật toán dựng scope tại con trỏ

```
function buildScopeAt(cursorNode):
  chain = []
  node = cursorNode
  while node:
    if node is SelectNode / DmlNode:
      scope = new Scope(kind='query')
      # 1. CTE: khai báo ở WITH của node hoặc của tổ tiên
      scope.ctes = bindCtes(node.with)
      # 2. Quan hệ trong FROM (cả phần NẰM SAU con trỏ cũng phải tính, trừ khi
      #    là JoinOn: chỉ tính các vế đã xuất hiện trước điểm JOIN hiện tại)
      scope.relations = bindFrom(node.from, options)
      # 3. Cột output (cho ORDER BY / derived / CTE)
      scope.outputColumns = inferOutputColumns(node)
      chain.push(scope)
    node = parentQueryNode(node)   # đi lên subquery cha
  link scopes: chain[i].parent = chain[i+1]
  # Correlated subquery: scope cha nhìn thấy được từ scope con
  # (trừ derived table không LATERAL/APPLY ⇒ outerVisible=false)
  return chain[0]
```

**Quy tắc nhìn thấy (visibility) theo vị trí con trỏ:**

| Con trỏ ở | Nhìn thấy |
|---|---|
| Select-list, WHERE, GROUP BY, HAVING | Mọi quan hệ trong FROM của **cùng cấp** + scope cha (nếu correlated) + CTE khả kiến |
| `ON` của JOIN thứ *k* | Các quan hệ từ đầu FROM đến vế phải của JOIN *k* (**không** thấy các JOIN sau) |
| Vế phải của `CROSS APPLY`/`LATERAL` | Các quan hệ **bên trái** trong cùng FROM |
| Derived table thường (không LATERAL) trong FROM | **Không** thấy các quan hệ cùng cấp; chỉ thấy CTE (và scope cha ngoài cùng nếu thuộc correlated subquery) |
| ORDER BY | Quan hệ trong FROM + **alias select-list** + số thứ tự |
| Subquery trong select-list/WHERE | Scope riêng + scope cha (correlated) |
| Thân CTE *n* | CTE khai báo **trước** nó; nếu recursive, chính nó |
| Sau `INSERT ... SELECT` | Scope SELECT độc lập với bảng đích (bảng đích không nhìn thấy trong SELECT) |

### 8.3. Quy tắc tên (name resolution)

1. **Alias che tên gốc:** `FROM Users u` ⇒ chỉ `u.` hợp lệ, `Users.` **không** hợp lệ trong cùng cấp (cả T-SQL và PG). Nếu người dùng gõ `Users.|` với alias `u` đã có ⇒ vẫn có thể gợi ý (để lỗi được sửa) nhưng **hạ ưu tiên** và (nếu có diagnostics) cảnh báo.
2. **Chuỗi qualifier:** giải qua theo thứ tự ưu tiên tại cấp hiện tại rồi ra cấp ngoài:
   - Một phần `x.`: alias/bảng trong scope ⇒ cột của nó; nếu không có ⇒ schema `x` ⇒ đối tượng; nếu không có ⇒ (T-SQL) database `x`.
   - Hai phần `x.y.`: `schema.table` ⇒ cột; hoặc `db.schema` (T-SQL) ⇒ đối tượng; hoặc `alias.column.` (PG: composite/JSON field — P2).
   - Ba phần `x.y.z.`: `db.schema.table` ⇒ cột.
3. **Không phân biệt hoa/thường như nhau giữa dialect:**
   - PG: identifier không quote **gập về chữ thường**. So khớp `Users` (không quote) với bảng tên `users`. Bảng tạo bằng `"Users"` thì phải gõ `"Users"` — gợi ý cần quote.
   - T-SQL: phụ thuộc collation của DB/server (mặc định thường case-insensitive). Mặc định **so khớp không phân biệt hoa/thường**; đọc `collation` từ metadata nếu muốn chính xác.
4. **Schema mặc định / search path:**
   - T-SQL: schema mặc định của user (thường `dbo`); tên một phần `Users` được resolve trong default schema rồi `dbo`. Với thủ tục hệ thống `sp_*` còn tìm ở `master`.
   - PG: `search_path` (đọc từ session: `SHOW search_path` / `current_schemas(true)`); `pg_catalog` luôn ngầm ở đầu; `public` mặc định; schema `pg_temp` cho bảng tạm.
5. **Mơ hồ cột (ambiguity):** cột trùng tên ở nhiều quan hệ ⇒ trong select-list không qualified, hiển thị **mỗi cột kèm nguồn** (`Id — Users`, `Id — Orders`) và khi chèn, **tự động thêm qualifier** (`u.Id`) nếu cấu hình bật (`qualifyAmbiguous=true` mặc định).

### 8.4. Suy ra cột đầu ra (output columns) của SELECT

Dùng cho derived table, CTE, `ORDER BY`, `INSERT ... SELECT`, `CREATE VIEW`, `SELECT INTO`.

Với mỗi select item, tên cột:

1. Có alias (`AS x`, `x`, `x = expr` (T-SQL)) ⇒ `x`.
2. Không alias, biểu thức là tham chiếu cột (`u.Name`, `Name`) ⇒ tên cột cuối (`Name`).
3. `alias.*` / `*` ⇒ **mở rộng sao (star expansion)** theo scope: mỗi quan hệ, theo thứ tự, mỗi cột. Với `USING`/`NATURAL` (PG), cột chung chỉ xuất hiện **một lần**.
4. Biểu thức khác không alias:
   - T-SQL: cột **không có tên** (`(No column name)`) ⇒ không đưa vào gợi ý cột (hoặc gán tên rỗng, đánh dấu unnamed).
   - PG: tên tự sinh (`?column?`, hoặc tên hàm: `count`, `max`, `coalesce`) — dùng quy tắc đặt tên của PG cho hàm/CASE (`case`) nếu muốn chính xác.
5. **Set operation:** tên cột lấy từ **SELECT đầu tiên** (cả hai dialect).
6. **Danh sách cột tường minh** trong CTE (`WITH c (a, b) AS (...)`) hoặc alias bảng (`AS t (a, b)`) ⇒ **ghi đè** tên theo thứ tự vị trí.
7. **Kiểu** của cột suy ra: cột gốc ⇒ kiểu catalog; hàm ⇒ kiểu trả về; literal ⇒ kiểu mặc định; không suy ra được ⇒ `unknown` (vẫn hiển thị tên).

### 8.5. Các cấu trúc scope đặc thù

**Chung**
- **CTE:** khả kiến cho các CTE sau và main query. Recursive: PG cần `WITH RECURSIVE` (trong PG, cột của phần đệ quy lấy từ phần anchor); T-SQL tự động cho phép đệ quy (không có từ khoá `RECURSIVE`), cột lấy từ anchor.
- **Derived table / subquery in FROM:** bắt buộc alias (T-SQL bắt buộc; PG ≥ 16 không bắt buộc). Cột = output columns của subquery.
- **`VALUES`:** `FROM (VALUES (1,'a'),(2,'b')) AS v(id, name)`: cột do alias-list quyết định; nếu không có alias-list: T-SQL không có tên (bắt buộc alias-list); PG `column1, column2, ...`.
- **Correlated subquery:** subquery trong `WHERE`/select-list nhìn thấy quan hệ cấp cha.
- **Set-returning function trong FROM:** cột lấy từ định nghĩa hàm (kiểu trả về bảng/`RETURNS TABLE`/`OUT` params) hoặc alias-list.

**T-SQL**
- **`CROSS APPLY` / `OUTER APPLY`:** vế phải thấy các quan hệ trái.
- **`OPENJSON(...) WITH (col type '$.path')`:** cột từ mệnh đề `WITH`; mặc định `key`, `value`, `type`.
- **`STRING_SPLIT`** ⇒ `value` (và `ordinal` với tham số thứ 3 ở phiên bản hỗ trợ).
- **`PIVOT` / `UNPIVOT`:** cột output khác cột nguồn — suy ra từ danh sách cột trong `PIVOT`.
- **`DELETE a FROM t a JOIN ...`:** target là **alias** `a` trỏ vào bảng trong FROM.
- **`UPDATE a SET ... FROM t a JOIN ...`:** như trên.
- **`OUTPUT inserted.*, deleted.*`:** pseudo-tables `inserted`/`deleted` có cột của bảng đích (`deleted` không có với INSERT; `inserted` không có với DELETE; MERGE có cả hai và `$action`).
- **Trigger body:** `inserted`/`deleted` là pseudo-table của bảng gắn trigger (P2).
- **Temp/table variable:** xem 8.6.

**PostgreSQL**
- **`LATERAL`:** vế phải (subquery/hàm) thấy quan hệ trái. Hàm trong FROM sau bảng: **ngầm là LATERAL**.
- **`USING (a)` và `NATURAL JOIN`:** cột `a` hợp nhất — có thể tham chiếu không qualified và không mơ hồ; vẫn dùng `t1.a`/`t2.a`.
- **`FROM ONLY t`** (không kế thừa/partition con); **`TABLESAMPLE`**.
- **`ROWS FROM (...)`, `unnest(...) WITH ORDINALITY AS t(x, ord)`**, **`generate_series`**.
- **`INSERT ... ON CONFLICT (...) DO UPDATE SET ... = EXCLUDED.col`:** `EXCLUDED` là pseudo-relation cùng cột bảng đích.
- **`RETURNING`:** thấy bảng đích (và `FROM`/`USING` của UPDATE/DELETE).
- **`UPDATE t SET ... FROM s WHERE ...`**, **`DELETE FROM t USING s WHERE ...`**: `s` khả kiến trong `WHERE`/`SET` value/`RETURNING`.
- **CTE có thể chứa DML** (`WITH ins AS (INSERT ... RETURNING ...)`): cột output = `RETURNING`.
- **Trigger function:** `NEW`, `OLD` (P2).

### 8.6. Trạng thái xuyên statement (cross-statement state)

Trong cùng batch (T-SQL) / cùng phiên (PG), một số đối tượng tồn tại **sau khi khai báo**:

| Đối tượng | Nguồn khai báo | Cách suy ra cột |
|---|---|---|
| `#temp`, `##temp` (T-SQL) | `CREATE TABLE #t (...)` hoặc `SELECT ... INTO #t` | Từ định nghĩa cột / output columns của SELECT |
| Table variable (T-SQL) | `DECLARE @t TABLE (...)` | Từ định nghĩa cột |
| Biến | `DECLARE @x int`, tham số của proc/function | Tên + kiểu |
| Temp table (PG) | `CREATE TEMP TABLE t (...)`, `CREATE TEMP TABLE t AS SELECT ...` | Như trên |
| Bảng/view mới tạo trong cùng script | `CREATE TABLE`, `CREATE VIEW` ở statement trước | Như trên (chưa có trong catalog!) |
| `USE db` (T-SQL) | Đổi DB hiện tại cho các statement sau trong batch/file | Chuyển provider/catalog |
| `SET search_path` (PG) | Đổi search path | Cập nhật quy tắc resolve |

**Quy tắc:** quét `precedingStatements` theo thứ tự, áp dụng "hiệu ứng" của từng statement lên một `BatchState` (bảng tạm, biến, `USE`, `search_path`), rồi đưa vào `Scope(kind='batch')` làm gốc chuỗi scope. Nếu phân tích statement trước thất bại ⇒ bỏ qua, **không** làm hỏng statement hiện tại. Giới hạn số statement quét ngược (ví dụ 200) và cache kết quả theo phiên bản văn bản.

### 8.7. Ví dụ theo dõi từng bước

```sql
WITH recent AS (
  SELECT o.CustomerId, COUNT(*) AS cnt
  FROM dbo.Orders o
  GROUP BY o.CustomerId
)
SELECT c.|   -- (1)
FROM dbo.Customers c
JOIN recent r ON r.CustomerId = c.Id
WHERE c.Id IN (SELECT x.| FROM dbo.Vip x)  -- (2)
```

- (1) `SelectListQualified`, qualifier `c` ⇒ scope truy `c` (alias của `dbo.Customers`) ⇒ **cột của Customers**. FROM nằm sau con trỏ vẫn được binder xét.
- (2) Con trỏ trong subquery: qualifier `x` ⇒ alias `x` của `dbo.Vip` ⇒ cột của Vip. Scope cha (`c`, `r`) cũng khả kiến cho biểu thức không qualified.
- Ở `SELECT |` của truy vấn ngoài: cột của `c` (bảng Customers) và `r` (`CustomerId`, `cnt`) từ CTE.

---

## 9. Chi tiết khác biệt dialect (đưa vào `DialectProfile`)

```ts
interface DialectProfile {
  id: Dialect;
  quoteIdentifier(name: string): string;      // [x] / "x"
  needsQuoting(name: string): boolean;        // ký tự đặc biệt, từ khoá dành riêng, chữ hoa (pg), khoảng trắng, bắt đầu bằng số
  normalizeIdentifier(raw: string, quoted: boolean): string; // pg: quoted? giữ nguyên : lower
  identifierEquals(a: string, b: string, collation?: string): boolean;
  reservedKeywords: Set<string>;
  keywords: KeywordTable;                     // theo clause
  builtinFunctions: FunctionSig[];            // tên, chữ ký, mô tả, kiểu trả về
  builtinTypes: TypeInfo[];
  defaultSchemaResolution(conn): string[];    // ['dbo'] / search_path
  aliasRules: { selectAliasInGroupBy: boolean; selectAliasInWhere: boolean; selectAliasInOrderBy: boolean; };
  rowLimiting: 'top' | 'limit';
  supportsApply: boolean; supportsLateral: boolean;
  parameterStyle: '@name' | '$n' | 'name =>';
  batchSeparator?: 'GO';
}
```

### 9.1. Bảng so sánh chính

| Chủ đề | T-SQL (SQL Server) | PostgreSQL |
|---|---|---|
| Quote | `[x]`, `"x"` | `"x"` |
| Gập chữ | Không (theo collation) | Không quote ⇒ lowercase; quote ⇒ giữ nguyên |
| Tên bảng | `server.db.schema.obj` (tối đa 4 phần) | `schema.obj` (`db.schema.obj` chỉ trùng DB hiện tại) |
| Schema mặc định | Default schema của user / `dbo` | `search_path` |
| Giới hạn hàng | `TOP n`, `OFFSET ... FETCH` | `LIMIT n OFFSET m`, `FETCH FIRST` |
| Nối chuỗi | `+`, `CONCAT` | `||`, `CONCAT` |
| Cast | `CAST`, `CONVERT(type, x, style)`, `TRY_CAST` | `CAST`, `x::type` |
| Bảng tạm | `#t`, `##t` (trong `tempdb`) | `CREATE TEMP TABLE`, schema `pg_temp` |
| Lateral | `CROSS/OUTER APPLY` | `LATERAL`, hàm trong FROM |
| Trả về từ DML | `OUTPUT inserted/deleted` | `RETURNING` |
| Upsert | `MERGE` | `INSERT ... ON CONFLICT`, `MERGE` (PG ≥ 15) |
| Thủ tục | `EXEC proc @a = 1` | `CALL proc(1)` |
| Overload hàm | Ít (không overload theo kiểu như PG) | Nhiều; resolve theo **kiểu đối số** |
| Kiểu do người dùng | Alias type, table type, CLR | enum, domain, composite, range, array; extension type |
| Truy cập JSON | `JSON_VALUE`, `OPENJSON` | `->`, `->>`, `#>`, `@>`, `jsonb_*` |
| Kết thúc câu lệnh | `;` tuỳ chọn (trừ vài lệnh) | `;` phân tách |
| Alias trong `WHERE`/`HAVING` | Không | Không |
| Alias trong `GROUP BY` | Không | Có |
| Alias trong `ORDER BY` | Có | Có |
| Alias cột phía trái `=` | `SELECT x = expr` | Không có |

### 9.2. Quy tắc quote khi chèn (`insertText`)

- **T-SQL:** dùng `[name]` khi (a) chứa ký tự ngoài `[A-Za-z0-9_@#$]` hoặc Unicode không hợp lệ đầu; (b) bắt đầu bằng số; (c) là từ khoá dành riêng; (d) chứa khoảng trắng. Escape `]` ⇒ `]]`.
- **PG:** dùng `"name"` khi (a) có chữ hoa (vì unquoted bị gập thường); (b) chứa ký tự ngoài `[a-z0-9_$]`; (c) bắt đầu bằng số; (d) là từ khoá dành riêng. Escape `"` ⇒ `""`.
- **Con trỏ trong identifier dở dang có quote** (`[Us|`, `"Us|`): `range` phải **bao gồm dấu mở quote** và `insertText` là bản quote **đầy đủ**; hoặc, nếu host chèn tiếp ký tự đóng tự động (`]`, `"`), xử lý để không trùng dấu đóng. Có test cho từng trường hợp.
- **Qualifier đã quote:** `[dbo].[Us|` ⇒ so khớp với `dbo` (bỏ quote) và trả về tên bảng.
- **Không tự quote** khi người dùng đã bắt đầu gõ không quote nhưng tên cần quote: vẫn trả về gợi ý với `insertText` đã quote, `filterText` là tên thô.

---

## 10. Lớp Metadata (Catalog)

### 10.1. Nguyên tắc

- **Lazy + cache:** tải danh sách bảng/view khi cần; tải cột **theo từng quan hệ** khi con trỏ cần (hoặc prefetch nền cho quan hệ trong FROM của statement hiện tại).
- **Bất đồng bộ + huỷ được:** mọi truy vấn metadata nhận `CancelToken`. Nếu chưa có dữ liệu ⇒ trả `isIncomplete=true` cùng phần đã có (keyword, alias, CTE — những thứ không cần DB).
- **Không chặn UI**: đặt timeout (ví dụ 2s) cho truy vấn metadata; hết giờ ⇒ dùng cache cũ.
- **Cache key**: `(connectionId, database, objectKind, schema)`. Invalidate khi: người dùng chạy DDL (`CREATE/ALTER/DROP`), nhấn "Refresh", hoặc đổi DB/`search_path`; hoặc poll nhẹ theo `modify_date` (T-SQL).
- **Quy mô lớn:** hàng chục nghìn đối tượng — dùng cấu trúc tra cứu theo tiền tố (trie hoặc sorted array + binary search), giới hạn số item trả về (ví dụ 200) và `isIncomplete`.
- **Quyền hạn:** chỉ hiển thị đối tượng người dùng thấy được (`VIEW DEFINITION`/`has_table_privilege`). Thiếu quyền ⇒ bỏ qua thầm lặng, không lỗi.

### 10.2. SQL Server — truy vấn tham khảo

```sql
-- Database
SELECT name FROM sys.databases WHERE state = 0 ORDER BY name;

-- Schema
SELECT s.schema_id, s.name FROM sys.schemas s
WHERE s.name NOT IN ('sys','INFORMATION_SCHEMA') OR @includeSystem = 1;

-- Quan hệ + routine
SELECT o.object_id, s.name AS schema_name, o.name, o.type, o.type_desc, o.modify_date
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE o.type IN ('U','V','P','PC','FN','IF','TF','FS','FT','AF','SN'); -- U bảng, V view, P proc, FN scalar fn, IF inline TVF, TF multi-stmt TVF, SN synonym

-- Cột (cho một object_id)
SELECT c.column_id, c.name, t.name AS type_name, c.max_length, c.precision, c.scale,
       c.is_nullable, c.is_identity, c.is_computed, c.collation_name,
       dc.definition AS default_definition
FROM sys.columns c
JOIN sys.types t ON t.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
WHERE c.object_id = @objectId
ORDER BY c.column_id;

-- PK / unique
SELECT i.name AS index_name, i.is_primary_key, i.is_unique, ic.key_ordinal, col.name AS column_name
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
WHERE i.object_id = @objectId AND (i.is_primary_key = 1 OR i.is_unique = 1)
ORDER BY i.index_id, ic.key_ordinal;

-- Foreign key (cả composite)
SELECT fk.name, fk.parent_object_id, fk.referenced_object_id,
       pc.name AS parent_column, rc.name AS referenced_column, fkc.constraint_column_id
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
WHERE fk.parent_object_id = @objectId OR fk.referenced_object_id = @objectId
ORDER BY fk.object_id, fkc.constraint_column_id;

-- Tham số của proc/function
SELECT p.parameter_id, p.name, t.name AS type_name, p.max_length, p.is_output, p.has_default_value
FROM sys.parameters p JOIN sys.types t ON t.user_type_id = p.user_type_id
WHERE p.object_id = @objectId ORDER BY p.parameter_id;   -- parameter_id = 0 là giá trị trả về

-- Cột kết quả của proc (khi cần)
SELECT * FROM sys.dm_exec_describe_first_result_set_for_object(@objectId, 0);

-- Table type / alias type
SELECT tt.type_table_object_id, s.name, tt.name FROM sys.table_types tt JOIN sys.schemas s ON s.schema_id = tt.schema_id;
```

Lưu ý: `sys.all_objects`/`sys.all_columns` bao gồm đối tượng hệ thống. `INFORMATION_SCHEMA` chỉ dùng khi cần tính di động (thiếu nhiều thông tin so với `sys.*`).

### 10.3. PostgreSQL — truy vấn tham khảo

```sql
-- Schema
SELECT nspname FROM pg_namespace
WHERE nspname NOT LIKE 'pg\_toast%' AND nspname NOT LIKE 'pg\_temp%' ORDER BY 1;

-- Quan hệ: r bảng, p bảng partition cha, v view, m materialized view, f foreign table
SELECT c.oid, n.nspname, c.relname, c.relkind
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p','v','m','f')
  AND has_schema_privilege(n.oid, 'USAGE');

-- Cột
SELECT a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) AS type_name,
       a.attnotnull, a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid) AS default_expr,
       col_description(a.attrelid, a.attnum) AS comment
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

-- Ràng buộc (p=PK, f=FK, u=unique, c=check)
SELECT con.oid, con.conname, con.contype, con.conrelid, con.confrelid, con.conkey, con.confkey,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con WHERE con.conrelid = $1 OR con.confrelid = $1;
-- Ánh xạ conkey/confkey (mảng attnum) sang tên cột bằng pg_attribute (unnest ... WITH ORDINALITY để giữ thứ tự).

-- Hàm / thủ tục (prokind: f hàm, p procedure, a aggregate, w window)
SELECT p.oid, n.nspname, p.proname, p.prokind, p.proretset,
       pg_get_function_arguments(p.oid) AS args,
       pg_get_function_identity_arguments(p.oid) AS identity_args,
       pg_get_function_result(p.oid) AS result,
       p.pronargs, p.pronargdefaults, p.proargnames, p.proargtypes
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace;

-- Kiểu do người dùng: typtype e=enum, d=domain, c=composite, r=range, b=base
SELECT t.oid, n.nspname, t.typname, t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE t.typtype IN ('e','d','c','r') AND t.typrelid = 0 OR t.typtype = 'c';
-- Giá trị enum: SELECT enumlabel FROM pg_enum WHERE enumtypid = $1 ORDER BY enumsortorder;

-- Extension / search_path phiên
SELECT extname FROM pg_extension;
SHOW search_path;   -- hoặc SELECT current_schemas(true);
```

Lưu ý: `information_schema` **không** chứa materialized view; dùng `pg_catalog`. Overload hàm phân biệt bằng `oid`/`proargtypes` — **không** gộp theo tên.

### 10.4. Tình huống catalog cần đặc biệt xử lý

- Bảng có **tên trùng** giữa các schema ⇒ hiển thị kèm schema, ưu tiên schema mặc định/search_path.
- **View lồng view**: cột lấy từ metadata của view (không cần đọc định nghĩa).
- **Synonym** (T-SQL): resolve đến đối tượng đích (`sys.synonyms.base_object_name`).
- **Bảng partition** (PG): hiển thị bảng cha, ẩn partition con theo mặc định (cấu hình).
- **Foreign table** (PG), **linked server** (T-SQL): hiển thị nhưng đánh dấu.
- **Schema đầy đối tượng hệ thống**: ẩn theo mặc định, hiện khi người dùng gõ tiền tố rõ ràng (ví dụ `sys.`, `pg_catalog.`, `information_schema.`).

---

## 11. Sinh ứng viên, lọc và xếp hạng

### 11.1. Mỗi context một generator

```ts
interface CandidateGenerator {
  supports(ctx: CursorContext): boolean;
  generate(ctx: CursorContext, scope: Scope, catalog: CatalogView, dialect: DialectProfile): Promise<Candidate[]>;
}
```

- Generator **thuần** (không side effect), dễ test riêng.
- Nhiều generator có thể cùng chạy cho một context (ví dụ `SelectList`: cột + hàm + keyword + snippet), rồi gộp.

### 11.2. Lọc theo prefix (matching)

Áp dụng theo thứ tự ưu tiên (điểm giảm dần):

1. **Prefix chính xác (case-sensitive)** > prefix không phân biệt hoa/thường.
2. **Prefix theo từ con:** `cid` khớp `CustomerId` (camelCase/PascalCase/`snake_case` — khớp chữ đầu mỗi từ): `co` → `customer_order`, `cO`/`CO` → `CustomerOrder`.
3. **Chứa (substring)** — điểm thấp hơn.
4. **Fuzzy (subsequence)** — thấp nhất, giới hạn độ dài prefix ≥ 2–3 để tránh nhiễu.
- Bỏ qua dấu quote mở ở prefix khi so khớp; so khớp trên tên **thô** (không quote).
- Hỗ trợ tiếng Việt có dấu: chuẩn hoá Unicode (NFC), tuỳ chọn so khớp không dấu.

### 11.3. Các tín hiệu xếp hạng (cộng dồn thành `sortText`)

| Tín hiệu | Ảnh hưởng |
|---|---|
| Khớp prefix (mức 1–4 ở trên) | Nền tảng |
| **Độ phù hợp ngữ cảnh** | Trong `SelectList`: cột của bảng trong FROM ≫ hàm ≫ keyword. Trong `FromTarget`: bảng/view/CTE ≫ hàm bảng ≫ schema |
| **Gần con trỏ** | Alias/CTE khai báo gần hơn ưu tiên hơn nhẹ |
| **Khoá & quan hệ** | PK/FK/cột đã join ưu tiên khi ở `JoinOn`; bảng có FK tới bảng đang có trong scope ưu tiên ở `JoinTarget` |
| **Tương thích kiểu** (P1/P2) | `ExpressionOperand`: cột cùng kiểu/ép kiểu ngầm được lên trước |
| **Tần suất/gần đây** | Đếm chọn theo (connection, object); suy giảm theo thời gian; lưu cục bộ, không gửi đi |
| **Cột đã dùng** | `InsertColumns`, `UpdateSet`: ẩn cột đã liệt kê (không chỉ hạ điểm) |
| **Schema mặc định** | Đối tượng trong default schema/search_path lên trước đối tượng ở schema khác |
| **Hệ thống vs người dùng** | Đối tượng hệ thống xuống cuối/ẩn |
| **Độ dài tên** | Tên ngắn hơn (khi điểm bằng nhau) |

`sortText` phải **ổn định và xác định** (deterministic): cùng đầu vào ⇒ cùng thứ tự (thêm tiebreak theo tên).

### 11.4. Gợi ý JOIN / ON dựa trên FK (tính năng "wow")

**`JoinTarget`:** với mỗi bảng `A` đang trong scope, lấy FK hai chiều (A→B, B→A). Trả ứng viên `B` kèm `detail` "FK: A.col → B.col", xếp trên cùng. Có thể kèm snippet **hoàn chỉnh**:

```
JOIN dbo.Orders o ON o.CustomerId = c.Id
```

- Sinh alias tự động (chữ cái đầu của từng từ trong tên; tránh trùng alias trong scope: `o`, `o2`).
- Composite FK ⇒ nối bằng `AND`.
- Nhiều FK giữa hai bảng ⇒ trả nhiều biến thể, `detail` chỉ rõ constraint/cột.
- Nếu không có FK ⇒ heuristic tên cột (`XxxId` ↔ `Xxx.Id`, `xxx_id` ↔ `xxx.id`) với điểm thấp hơn, đánh dấu "gợi ý theo tên".

**`JoinOn`:** ứng viên `left.col = right.col` từ FK giữa vế phải (bảng vừa JOIN) và các bảng trước đó; nếu không có FK ⇒ cặp cột trùng tên + kiểu tương thích.

### 11.5. Hàm và chữ ký

- Built-in: nạp từ bảng dữ liệu tĩnh (`builtin-functions`) theo dialect **và phiên bản** (SQL Server 2016/2019/2022; PG 12–17) — dùng phiên bản server nếu biết; nếu không, chấp nhận hàm mới và không báo lỗi.
- User-defined: từ catalog. PG overload: hiển thị **mỗi overload** một item (`detail` là danh sách tham số), hoặc gộp và để signature help chọn.
- Insert: `name(` và (tuỳ host) đặt con trỏ trong ngoặc; hàm không tham số: `name()`.
- Aggregate/window: đánh dấu `kind` để có thể ưu tiên trong `GROUP BY`/`OVER`.

### 11.6. Signature help

- Xác định lời gọi hàm bao quanh con trỏ: đi ngược tìm `(` chưa đóng, ngay trước là tên hàm (có thể qualified). Tham số hiện tại = số dấu `,` ở depth đó.
- Resolve overload: lọc theo số đối số; nếu suy ra được kiểu đối số đã gõ ⇒ tiếp tục lọc theo kiểu.
- Trả: danh sách chữ ký, `activeSignature`, `activeParameter`, tài liệu tham số.
- T-SQL `EXEC proc @a = 1, @b = ...`: tham số **đặt tên**; hiển thị tham số chưa dùng. PG: tham số **đặt tên** `name => value` và vị trí; tham số có `DEFAULT` đánh dấu tuỳ chọn.

---

## 12. Tính năng bổ sung (Hover, Diagnostics)

### 12.1. Hover
- Cột: `table.column : type [NOT NULL] [PK] [FK → other.col]`, default, comment/`MS_Description`.
- Bảng/view: số cột (nếu rẻ), PK, vài FK, comment. Có thể lười (resolve khi hover).
- Hàm: chữ ký + mô tả.
- Alias: ánh xạ đến bảng gốc / CTE / subquery.

### 12.2. Diagnostics nhẹ (P2 — bật tuỳ chọn)
- Tên bảng/cột không tồn tại (chỉ khi catalog **đã tải xong** và statement **không** bị lỗi cú pháp nghiêm trọng).
- Cột mơ hồ (`Id` xuất hiện ở nhiều bảng).
- Alias trùng trong cùng cấp.
- **Rất thận trọng** để tránh false positive: chỉ hiển thị khi chắc chắn; không đánh dấu đối tượng có thể do script trước tạo ra (kiểm tra `BatchState`).

---

## 13. Hiệu năng, huỷ và độ bền

### 13.1. Ngân sách thời gian (mục tiêu, đo trên máy dev thông thường)

| Bước | Mục tiêu |
|---|---|
| Lex + isolate + parse + classify | < 10 ms cho statement < 5 KB |
| Scope binding (catalog đã cache) | < 20 ms |
| Sinh + xếp hạng (≤ 10.000 ứng viên) | < 30 ms |
| **Tổng completion (cache nóng)** | **< 80 ms** (P95) |
| Lần đầu tải metadata | Trả tức thì phần không cần DB + `isIncomplete`, cập nhật khi có |

### 13.2. Kỹ thuật
- **Debounce/cancel:** mỗi request mới huỷ request cũ (token huỷ). Kiểm tra `cancel.isCancelled` giữa các bước.
- **Cache theo phiên bản văn bản:** token/cấu trúc của statement không đổi khi chỉ con trỏ dịch chuyển; chỉ tính lại khi văn bản đổi (hash theo `(documentVersion, statementRange)`).
- **Incremental (tuỳ chọn):** chỉ lex/parse lại statement bị ảnh hưởng.
- **Giới hạn kích thước:** file > 1–2 MB hoặc statement > 200 KB ⇒ chỉ phân tích cửa sổ quanh con trỏ (ví dụ ±20 KB) và cảnh báo `degraded`.
- **Chống thoái hoá (pathological):** giới hạn độ sâu lồng (ví dụ 100), số token (ví dụ 200k), thời gian mỗi bước (watchdog). Vượt ⇒ dừng an toàn, fallback.
- **Không rò rỉ:** không giữ tham chiếu tới văn bản cũ trong cache quá hạn; LRU cho cache scope/structure.
- **An toàn dữ liệu:** không ghi chuỗi kết nối/mật khẩu vào log; không gửi nội dung SQL ra ngoài.

### 13.3. Chế độ suy giảm (degradation ladder)

1. Đầy đủ: cursor context + scope + metadata.
2. Metadata chưa sẵn ⇒ keyword + alias + CTE + snippet, `isIncomplete=true`.
3. Parser thất bại ⇒ chỉ dùng token-scan: gợi ý theo clause gần nhất, đối tượng theo catalog, **không** cột theo scope (hoặc cột của mọi bảng trong FROM tìm bằng regex nhẹ nếu an toàn).
4. Mọi thứ thất bại ⇒ keyword chung theo dialect. **Không throw.**

---

## 14. Chiến lược kiểm thử

### 14.1. Định dạng test dùng marker con trỏ

Dùng ký hiệu `|` (hoặc `⟦cursor⟧` nếu SQL có `|` như toán tử `||`/`->`) đánh dấu con trỏ; harness tách ra `(text, offset)`.

```ts
// helper
complete("SELECT | FROM dbo.Users u", { dialect: 'tsql', catalog: 'shop' })
  .expectContext('SelectList')
  .expectItems(['u.Id','u.Name', ...]) // hoặc expectContains/expectNotContains
```

### 14.2. Catalog giả (fixture)

Tạo 2–3 catalog nhỏ, có chủ đích đa dạng, dùng chung cho cả hai dialect (điều chỉnh kiểu):

- `shop`: `Customers(Id PK, Name, Email)`, `Orders(Id PK, CustomerId FK→Customers, Total, CreatedAt)`, `OrderItems(OrderId, LineNo, ProductId, Qty)` (PK composite, FK composite/đơn), `Products(Id PK, Name, CategoryId FK→Categories)`, `Categories(Id, ParentId FK→Categories.Id)` (tự tham chiếu), view `vw_CustomerTotals`, hàm scalar/TVF/proc, schema `dbo` + `sales`.
- `quirky`: tên có khoảng trắng/Unicode/chữ hoa (`"Order Details"`, `[Tên khách]`), từ khoá làm tên (`"user"`, `[order]`), hai schema chứa bảng trùng tên, cột trùng tên giữa các bảng, cột identity/computed/generated.
- `pg_extras`: enum, domain, composite type, materialized view, partitioned table, hàm overload, `search_path` ≠ `public`.

### 14.3. Bộ test theo loại

**A. Golden tests theo context (mỗi dòng ở Mục 7.2 ≥ 3 test).** Ví dụ tối thiểu:

| # | Input | Kỳ vọng |
|---|---|---|
| 1 | `SELECT | FROM dbo.Customers c` | Context `SelectList`; có `c.Id`, `c.Name`, `c.Email`; **không** cột của `Orders` |
| 2 | `SELECT c.| FROM dbo.Customers c` | Context `SelectListQualified`; chỉ cột Customers (+ `*`) |
| 3 | `SELECT * FROM Customers c JOIN Orders o ON |` | Có `c.Id`, `o.CustomerId`; ưu tiên snippet `o.CustomerId = c.Id` |
| 4 | `SELECT * FROM Customers c JOIN |` | Bảng liên quan FK (Orders) đứng đầu, kèm detail FK |
| 5 | `WITH r AS (SELECT Id, Name FROM Customers) SELECT | FROM r` | Có `Id`, `Name` (từ CTE) |
| 6 | `SELECT * FROM (SELECT Id AS cid FROM Customers) d WHERE d.|` | `cid` (không có `Id`) |
| 7 | `INSERT INTO Customers (Id, |` | Có `Name`, `Email`; **không** `Id` (đã liệt kê); T-SQL bỏ cột identity |
| 8 | `UPDATE Customers SET Name = 'x', |` | Không có `Name` |
| 9 | `SELECT * FROM Customers c WHERE EXISTS (SELECT 1 FROM Orders o WHERE o.CustomerId = c.|)` | Cột Customers (correlated) |
| 10 | `SELECT * FROM Customers ORDER BY |` (kèm `SELECT Name AS n`) | Có alias `n` |
| 11 | T-SQL: `SELECT * FROM Customers c CROSS APPLY (SELECT TOP 1 * FROM Orders o WHERE o.CustomerId = c.|) x` | Cột `c` khả kiến trong APPLY |
| 12 | PG: `SELECT * FROM customers c, LATERAL (SELECT * FROM orders o WHERE o.customer_id = c.|) x` | Cột `c` khả kiến |
| 13 | PG: `INSERT INTO customers (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.|` | Cột của `customers` |
| 14 | T-SQL: `DELETE FROM Customers OUTPUT deleted.|` | Cột của Customers |
| 15 | PG: `SELECT '1'::|` | Kiểu dữ liệu (built-in + enum/domain) |
| 16 | T-SQL: `CREATE TABLE #t (a int); SELECT | FROM #t` | `a` (temp table) |
| 17 | `SELECT * FROM dbo.|` | Bảng/view/hàm bảng trong `dbo` |
| 18 | T-SQL: `SELECT * FROM [dbo].[Cus|` | `Customers`, range gồm dấu `[` |
| 19 | PG: `SELECT * FROM "Order Det|` | `"Order Details"` |
| 20 | Comment: `-- SELECT | ` | Không có gợi ý |

**B. Truncation fuzzing (tự sinh test hàng loạt).**
Từ một corpus 50–100 truy vấn **hợp lệ** đa dạng (kể cả cấu trúc phức tạp), tại **mọi ranh giới token** cắt văn bản (hoặc cắt và giữ phần đuôi để mô phỏng "gõ giữa câu"):
- Invariant 1: **không throw**.
- Invariant 2: thời gian < ngưỡng.
- Invariant 3: nếu `context.kind` là cột-bearing và scope suy ra được, mọi ứng viên cột **thuộc** tập cột của các quan hệ trong scope (không "rò rỉ" cột ngoài scope).
- Invariant 4: `range` hợp lệ (nằm trong văn bản, chứa con trỏ hoặc kề con trỏ).
- Invariant 5: kết quả **xác định** (chạy hai lần ra cùng thứ tự).

**C. Property-based/metamorphic tests.**
- Đổi tên alias (`u`→`zz`) ⇒ kết quả tương đương (chỉ qualifier đổi).
- Thêm khoảng trắng/xuống dòng/comment ⇒ kết quả không đổi.
- Đổi hoa/thường keyword ⇒ không đổi.
- Thêm statement **sau** (không liên quan) ⇒ không đổi.
- Hoán đổi thứ tự JOIN độc lập ⇒ tập cột không đổi.

**D. Đối chiếu với thực tế.**
- Chạy truy vấn hợp lệ trên DB thật (Docker: SQL Server, PostgreSQL) để xác nhận quy tắc scope (đặc biệt các ca alias/`USING`/`APPLY`/`LATERAL`/CTE). Nếu quy tắc của bạn khác DB thật ⇒ **DB thật thắng**.
- Kiểm tra `column names` output của SELECT bằng `sys.dm_exec_describe_first_result_set` (T-SQL) và `PREPARE`/`pg_prepared_statements`/`\gdesc`(psql) (PG) để đối chiếu thuật toán suy cột (8.4).

**E. Hiệu năng.** Benchmark trên: statement 5 KB, file 1 MB nhiều statement, catalog 50.000 bảng × 30 cột. Fail CI nếu vượt ngân sách 13.1.

**F. Test dialect.** Mỗi test chạy cho từng dialect khi có ý nghĩa; test **phủ định** (ví dụ `LIMIT` không xuất hiện trong T-SQL; `TOP` không xuất hiện trong PG; `CROSS APPLY` không gợi ý trong PG).

### 14.4. Tiêu chí chất lượng đo được
- Precision của ứng viên cột (không nằm ngoài scope): **≥ 99%** trên corpus fuzz.
- Recall cột trong scope (có mặt khi lẽ ra phải có): **≥ 98%**.
- Không crash trên 100% ca fuzz.
- Top-5 chứa mục người dùng định gõ (mô phỏng bằng cách lấy token kế tiếp thật của truy vấn hợp lệ): **≥ 90%** cho cột/bảng.

---

## 15. Lộ trình triển khai (Milestones + tiêu chí nghiệm thu)

**M0 — Nền tảng (0.5–1 ngày)**
- Khung dự án, interface (Mục 3.3), cursor-marker test harness, catalog giả.
- ✅ Nghiệm thu: chạy được test "hello" với catalog giả; CI xanh.

**M1 — Lexer 2 dialect**
- Token đầy đủ (Mục 4), token dở dang, `GO`, dollar-quote, comment lồng.
- ✅ Nghiệm thu: toàn bộ ca biên 4.4 xanh; round-trip: nối `token.text` = văn bản gốc.

**M2 — Statement isolation + cursor classifier (token-scan)**
- Mục 5 + Mục 7 (chưa cần scope). Phân loại ≥ 90% context P0 trên corpus.
- ✅ Nghiệm thu: bảng test context (14.3.A #17–20 và context-only) xanh; không throw trên fuzz.

**M3 — Structure parser chịu lỗi**
- SELECT/FROM/JOIN/CTE/subquery/DML cơ bản (Mục 6).
- ✅ Nghiệm thu: parse 100% corpus hợp lệ ra cấu trúc đúng (so với snapshot); fuzz cắt không throw.

**M4 — Scope binder + metadata cơ bản (tự chứa)**
- Mục 8 (không có star-expansion nâng cao), catalog provider + cache (Mục 10) với fixture; sau đó nối provider SQL Server/PG thật.
- ✅ Nghiệm thu: test #1–10, #16–19; invariant 3 (không rò cột) đạt.

**M5 — Completion end-to-end + quoting + ranking cơ bản**
- Generators cho toàn bộ context P0, quoting (9.2), ranking (11.2–11.3).
- ✅ Nghiệm thu: mọi test 14.3.A P0 xanh cho cả hai dialect; benchmark đạt ngân sách.

**M6 — Đặc thù dialect nâng cao**
- APPLY/LATERAL, OUTPUT/RETURNING, ON CONFLICT/EXCLUDED, USING/NATURAL, MERGE, temp table/biến, `USE`, `SET search_path`, star-expansion, OPENJSON/unnest/generate_series.
- ✅ Nghiệm thu: test #11–15 + bộ test dialect (14.3.F).

**M7 — JOIN/ON theo FK, signature help, hover**
- Mục 11.4–11.6, 12.1.
- ✅ Nghiệm thu: test #3–4; signature help cho hàm built-in và overload PG.

**M8 — Hoàn thiện chất lượng**
- Type-aware ranking, tần suất/gần đây, diagnostics nhẹ (tuỳ chọn), tối ưu hiệu năng, degrade ladder, tài liệu người dùng.
- ✅ Nghiệm thu: chỉ tiêu chất lượng 14.4; benchmark 14.3.E.

---

## 16. Danh sách bẫy thường gặp (Pitfalls Checklist)

Agent phải rà soát từng mục này trước khi coi là hoàn thành:

- [ ] **Scope bị cắt tại con trỏ:** `SELECT |` khi FROM ở phía sau vẫn phải resolve đúng.
- [ ] **Alias che tên gốc** nhưng vẫn cho phép `alias.`.
- [ ] **ORDER BY** thấy alias select-list; **WHERE/HAVING** thì không; `GROUP BY` chỉ PG.
- [ ] **JOIN ... ON** chỉ thấy các quan hệ đến vế phải hiện tại.
- [ ] **Derived table thường không thấy** quan hệ cùng cấp (trừ `LATERAL`/`APPLY`).
- [ ] **Set operation:** tên cột từ SELECT đầu.
- [ ] **`USING`/`NATURAL` (PG):** cột hợp nhất không mơ hồ; `SELECT *` không lặp cột.
- [ ] **Star expansion** đúng thứ tự cột và đúng với alias-list `t(a,b)`.
- [ ] **Cột computed/identity/generated** bị loại khỏi gợi ý `INSERT` (nhưng có trong `SELECT`).
- [ ] **PG lowercase folding** và quote cho tên có chữ hoa.
- [ ] **T-SQL `GO`** chỉ là separator khi đứng riêng một dòng.
- [ ] **T-SQL không bắt buộc `;`** — không tách statement sai (`INSERT ... SELECT`, `WITH ... SELECT`, `UNION`).
- [ ] **Comment/chuỗi chưa đóng** không làm hỏng phần còn lại; con trỏ trong comment/chuỗi ⇒ không gợi ý.
- [ ] **Dollar-quote PG** không bị lexer cắt sai; `$1` là tham số, không phải dollar-quote.
- [ ] **Range thay thế** đúng với identifier có quote dở dang và với tự động đóng ngoặc/quote của editor.
- [ ] **Offset UTF-16** đúng với emoji/tiếng Việt và CRLF.
- [ ] **Overload PG** không bị gộp sai; signature help chọn theo số/kiểu đối số.
- [ ] **Catalog chưa tải:** phản hồi tức thì, `isIncomplete`, không treo UI.
- [ ] **Huỷ request cũ** khi người dùng gõ tiếp.
- [ ] **Không rò rỉ bí mật** (chuỗi kết nối, dữ liệu) ra log.
- [ ] **Không throw** trong mọi đường xử lý; fuzz 100% xanh.
- [ ] **Kết quả xác định** (cùng đầu vào ⇒ cùng thứ tự).
- [ ] **Tách dialect** trong `DialectProfile`, không rải điều kiện dialect.

---

## 17. Định nghĩa "Hoàn thành" (Definition of Done)

Một milestone/tính năng chỉ được coi là xong khi:

1. Code + test tương ứng đã có và **xanh** (unit, golden, fuzz, benchmark liên quan).
2. Đã chạy **cả hai dialect** (nếu tính năng áp dụng cho cả hai).
3. Không có `TODO` che giấu hành vi sai; các hạn chế đã biết được ghi trong `docs/intellisense/KNOWN_LIMITATIONS.md`.
4. Đã cập nhật `DECISIONS.md` (quyết định thiết kế) và `OPEN_QUESTIONS.md` (điểm chưa chắc).
5. Hiệu năng nằm trong ngân sách (Mục 13.1).
6. Có mô tả ngắn cách chạy test/benchmark trong README.

---

## 18. Phụ lục — Tài nguyên tham khảo để agent đối chiếu hành vi

- **Microsoft SqlToolsService** (mã nguồn mở): IntelliSense T-SQL dựa trên `ScriptDom`; tham khảo cách bind/scope và xử lý lỗi.
- **Postgres Language Server** (Supabase) và **libpg_query** (parser PG thật dưới dạng thư viện): tham khảo cách phân tích PG chính xác.
- **sqlglot** (Python): module `optimizer/scope` là tài liệu tham khảo rất sạch về scope alias/CTE/subquery đa dialect.
- **antlr4-c3** + **grammars-v4** (ANTLR grammar T-SQL/PostgreSQL): tính ứng viên dựa trên ngữ pháp, phù hợp nếu muốn thay structure parser bằng grammar thật.
- **tree-sitter-sql**: parser chịu lỗi, incremental.
- **Tài liệu chính thức:** SQL Server (T-SQL reference, `sys.*` catalog views) và PostgreSQL (SQL commands, `pg_catalog`, lexical structure — mục *Identifiers and Key Words*, *Dollar-Quoted String Constants*).

> **Nguyên tắc cuối cùng cho Agent:** khi tài liệu này, tài liệu chính thức của DB, và hành vi thực tế của DB không khớp nhau — **hành vi thực tế của DB (đã kiểm chứng bằng test trên DB thật) là chuẩn**. Cập nhật tài liệu này và ghi lại quyết định.
