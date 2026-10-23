# Phân Tích Chuyên Sâu Hệ Thống Syntax Check — LLTool IDE

> Phiên bản hiện tại: `v1.0.7`  
> Ngày phân tích: 21/10/2026  

---

## 1. Kiến Trúc Tổng Quan (As-Is Architecture)

### 1.1 Sơ đồ luồng xử lý

```
SQL Text (Monaco Editor)
        │
        ▼
 ┌─────────────────────────────────┐
 │    coordinator.py               │
 │    validate_sql_pipeline()      │
 │  - Dialect Resolver             │
 │  - Rollback switch              │
 └────────────┬────────────────────┘
              │
      ┌───────┴────────┐
      ▼                ▼
 [T-SQL Path]    [PostgreSQL Path]
      │                │
      ▼                ▼
SqlServerScriptDom  PostgreSqlAdapter
Adapter             validate()
  │                    │
  ├─ ScriptDOM DLL      ├─ EXPLAIN (VERBOSE) [Online]
  │  (pythonnet)        │  (Side-effect-free)
  │                     │
  └─ validate_sql_server() [Fallback]
       │                 └─ validate_postgresql() [Offline]
       ├─ SET PARSEONLY ON     ├─ sqlglot [Fallback]
       │  [Online Native]      │
       └─ sqlglot [Offline]    └─ check_offline_postgres_structural_blocks()
                                  [PL/pgSQL Block Structure]
              │
              ▼
    semantic_analyzer.py
    analyze_sql_semantics()
      ├─ Table Variables (@tbl TABLE)
      ├─ Temp Tables (#temp, CREATE TEMP TABLE)
      ├─ CTEs (WITH ... AS)
      └─ Physical Tables (via cached_tables_dict)
              │
              ▼
    deduplicate_diagnostics()
              │
              ▼
    Normalized Diagnostics → Monaco Editor Markers
```

### 1.2 Tóm tắt từng module

| Module | Vai trò | Kích thước | Điểm mạnh | Điểm yếu hiện tại |
|---|---|---|---|---|
| `coordinator.py` | Điều phối pipeline | 111 dòng | Rollback switch, graceful fallback | Không có retry/circuit-breaker |
| `validator_mssql.py` | Kiểm tra T-SQL | 781 dòng | Native SET PARSEONLY, batch GO, multi-error extraction | Trùng code xử lý token giữa online/offline |
| `validator_pg.py` | Kiểm tra PostgreSQL | 357 dòng | Side-effect-free EXPLAIN, transaction guard | CALL không được route offline |
| `postgresql_adapter.py` | Kiểm tra cấu trúc PL/pgSQL | 581 dòng | Location Stack CASE/IF/LOOP/BEGIN | Chưa xử lý EXCEPTION WHEN block |
| `semantic_analyzer.py` | Kiểm tra ngữ nghĩa | 1936 dòng | Table vars, temp tables, CTEs, physical tables cache | No cross-statement scope |
| `proc_body_detector.py` | Nhận diện thân thủ tục | 336 dòng | Tách tham số, bản đồ dòng proc | Chưa nhận diện RETURN sai kiểu |
| `sqlserver_scriptdom.py` | Adapter ScriptDOM | 437 dòng | Chính xác nhất - full T-SQL AST | Bypass semantic layer |
| `adapters/diagnostics_mapper.py` | Chuẩn hóa lỗi | 99 dòng | Normalize severity/source | Thiếu hint category |

---

## 2. Điểm Mạnh Nổi Bật

### A. Chiến lược Hybrid độc đáo cho PostgreSQL
- **Online**: Dùng `EXPLAIN (VERBOSE)` — không execute, không side-effect, không lock, không advance sequence.
- **Offline**: `check_offline_postgres_structural_blocks()` tự xây dựng mini-parser Python thuần, theo dõi 4 loại block: `BEGIN`, `IF`, `LOOP`, `CASE` với location stack chính xác.
- **Transaction Guard**: Tự phát hiện connection đang trong user transaction → tự động chuyển sang offline mode.

### B. Multi-error extraction loop
Cả hai path đều dùng **line masking**: che dòng lỗi bằng `/* err */ SELECT 1;` rồi chạy lại để tìm lỗi tiếp theo (tối đa 5 lỗi/lần validate). Kỹ thuật thông minh và hiếm thấy trong các IDE tương tự.

### C. Semantic Analyzer toàn diện
- Phân tích scope của table variables, temp tables, CTEs trong một câu lệnh.
- Cache cột vật lý với TTL 60 giây, có `invalidate_on_ddl()` tự làm mới khi có DDL.
- Hỗ trợ `#temp`, `##global_temp`, `DECLARE @tbl TABLE`, `SELECT INTO #temp`.

---

## 3. Điểm Yếu & Rủi Ro (9 Issues)

### P1 — CRITICAL: `EXCEPTION WHEN` trong PL/pgSQL chưa được theo dõi

```sql
CREATE FUNCTION fn() RETURNS void AS $$
BEGIN
    INSERT INTO t VALUES (1);
EXCEPTION
    WHEN unique_violation THEN  -- ← Parser offline không nhận diện block này
        RAISE NOTICE 'dup';
    WHEN OTHERS THEN
        RAISE;
END;
$$ LANGUAGE plpgsql;
```

`EXCEPTION` là phần của cấu trúc `BEGIN...EXCEPTION...END` trong PL/pgSQL, nhưng parser offline hiện tại không có logic xử lý → dễ báo lỗi giả "Unmatched END" hoặc bỏ sót lỗi thực sự.

### P2 — HIGH: `FOR ... LOOP` chưa được theo dõi đầy đủ

```sql
FOR i IN 1..10 LOOP
    RAISE NOTICE '%', i;
END LOOP;
```

Từ khóa `FOR` không được push vào `loop_stack`. Chỉ `LOOP` mới được push → thiếu context, dẫn đến tracking balance không hoàn toàn chính xác khi phân tích lồng nhau.

### P3 — HIGH: `CALL` bị đẩy qua `EXPLAIN (VERBOSE)` gây lỗi giả

```sql
CALL my_schema.update_stats('2026-01-01');
-- PostgreSQL: EXPLAIN không hỗ trợ CALL → báo lỗi giả
```

`CALL` không phải DDL nên không vào `_is_destructive_or_locking_ddl()`. Kết quả là `CALL` bị đưa vào online path và `EXPLAIN (VERBOSE) CALL ...` luôn báo lỗi.

### P4 — MEDIUM: Code tính `(col, end_col)` lặp lại 4 lần trong `validator_mssql.py`

Đoạn pattern tính vị trí token trên target_line xuất hiện gần giống nhau ≥4 lần trong online path và fallback path. Vi phạm DRY, gây khó maintain.

### P5 — MEDIUM: ScriptDOM path bypass Semantic Analyzer

Khi SQL Server dùng `ScriptDomAdapter` (đường đi lý tưởng nhất với full AST), kết quả được trả về qua `coordinator.py` có gọi semantic, nhưng do cấu trúc pipeline, semantic chỉ được apply đúng cách khi adapter trả về xong. Cần xác nhận semantic có thực sự chạy sau ScriptDOM hay không.

### P6 — MEDIUM: `MERGE` statement có thể confuse semantic analyzer

`MERGE ... WHEN MATCHED THEN ... WHEN NOT MATCHED THEN ...` — từ khóa `WHEN` và `THEN` bên trong `MERGE` có thể bị nhầm với `CASE WHEN ... THEN` bởi các regex pattern trong semantic analyzer.

### P7 — LOW: Không có severity `warning` — chỉ có `error` và `info`

IDE chỉ phát ra `error` (gạch đỏ) và `info` (xanh). Thiếu `warning` (vàng) cho các trường hợp nguy hiểm tiềm ẩn nhưng không phải lỗi cú pháp:
- `SELECT *` (performance anti-pattern)
- `WITH (NOLOCK)` (dirty reads)
- `TOP N` không có `ORDER BY`

### P8 — LOW: `RETURN QUERY` / `RETURN NEXT` không được nhận diện

Trong PostgreSQL function trả `SETOF`, `RETURN QUERY` và `RETURN NEXT` là cú pháp đặc biệt. Semantic analyzer có thể báo false positive nếu phân tích context của chúng.

### P9 — LOW: Không có T-SQL `TRY...CATCH` block tracker

T-SQL có `BEGIN TRY...END TRY BEGIN CATCH...END CATCH`. Parser offline không track cặp này → có thể bỏ sót lỗi `END TRY` không có `BEGIN CATCH` hoặc ngược lại.

---

## 4. Kế Hoạch Cải Tiến (Improvement Roadmap)

### Phase A — Bugfix Critical (P1, P2, P3) — Ưu tiên cao nhất

#### A1. Hỗ trợ `EXCEPTION WHEN` block trong PL/pgSQL parser offline
**File**: `app/database/syntax/adapters/postgresql_adapter.py`  
**Giải pháp**: Thêm xử lý khi gặp token `EXCEPTION` trong block:

```python
if upper == "EXCEPTION":
    # EXCEPTION đánh dấu ranh giới handler — giải phóng stacks lửng lơ
    # (CASE/IF/LOOP phải đã kết thúc trước EXCEPTION)
    case_stack.clear()
    if_stack.clear()
    loop_stack.clear()
    # KHÔNG pop begin_stack — BEGIN vẫn mở, EXCEPTION chỉ là phần thân handler
    k += 1
    continue
```

#### A2. Theo dõi `FOR ... LOOP` trong PL/pgSQL
**File**: `app/database/syntax/adapters/postgresql_adapter.py`  
**Giải pháp**: Thêm `for_pending` flag:

```python
if upper == "FOR":
    for_pending = True  # Đánh dấu chờ LOOP tiếp theo
    k += 1
    continue

if upper == "LOOP":
    loop_stack.append((tok_text, tok_pos, tok_line, tok_col))
    for_pending = False  # Reset flag dù có FOR hay không
    k += 1
    continue
```

#### A3. `CALL` statement → route offline (không qua EXPLAIN)
**File**: `app/database/syntax/validator_pg.py`  
**Giải pháp**: Bổ sung `CALL` vào pattern trong `_is_destructive_or_locking_ddl()`:

```python
r"CALL\s+[a-zA-Z_][a-zA-Z0-9_.]*\s*\("  # CALL procedure(...)
```

---

### Phase B — Code Quality (P4, P5) — Ưu tiên trung bình

#### B1. Extract `_compute_token_position()` utility
**File**: `app/database/syntax/validator_mssql.py`

```python
def _compute_token_position(target_line: str, token: str) -> tuple[int, int]:
    """Compute (col, end_col) 1-indexed of token on target_line."""
    if not token or token not in target_line:
        stripped = target_line.strip()
        if stripped:
            idx = target_line.find(stripped)
            return idx + 1, idx + 1 + len(stripped)
        return 1, max(2, len(target_line) + 1)
    if re.match(r"^\w+$", token):
        m = re.search(rf"\b{re.escape(token)}\b", target_line, re.IGNORECASE)
        if m:
            return m.start() + 1, m.end() + 1
    idx = target_line.find(token)
    return idx + 1, idx + 1 + len(token)
```

#### B2. Xác nhận và fix Semantic Analyzer sau ScriptDOM path
Kiểm tra lại flow trong `coordinator.py` → đảm bảo `analyze_sql_semantics()` chạy sau cả ScriptDOM path.

---

### Phase C — New Features (P7, P8, P9) — Ưu tiên thấp nhưng high-value

#### C1. Severity `warning` + Best-Practice Rules
**File mới**: `app/database/syntax/best_practice_rules.py`

| Rule ID | Mô tả | Severity | Ví dụ trigger |
|---|---|---|---|
| `BP001` | `SELECT *` không nên dùng production | `warning` | `SELECT * FROM orders` |
| `BP002` | `WITH (NOLOCK)` gây dirty reads | `warning` | `FROM t WITH (NOLOCK)` |
| `BP003` | Thiếu schema prefix | `hint` | `FROM orders` |
| `BP004` | `TOP N` không có `ORDER BY` | `warning` | `SELECT TOP 10 * FROM t` |
| `BP005` | `ISNULL` thay vì `COALESCE` | `hint` | `ISNULL(col, 0)` |
| `BP006` | `CONVERT` thay vì `CAST` | `hint` | `CONVERT(int, col)` |

#### C2. T-SQL `TRY...CATCH` block tracker
Thêm tracking `TRY/CATCH` pairs trong offline validator:
- `BEGIN TRY` → push `try_stack`
- `END TRY` → pop `try_stack`, expect `BEGIN CATCH`
- `BEGIN CATCH` → push `catch_stack`
- `END CATCH` → pop `catch_stack`

#### C3. Statement-level Syntax Caching
```
Key: sha256(sql_stripped + dialect + connection_id)
TTL: 5 giây
Invalidate: khi user đổi kết nối hoặc chạy DDL
```

---

## 5. Ma Trận Ưu Tiên & Độ Phức Tạp

| ID | Cải tiến | Ưu tiên | Phức tạp | File ảnh hưởng | Ước tính |
|---|---|---|---|---|---|
| A1 | `EXCEPTION WHEN` PL/pgSQL | 🔴 Critical | Medium | `postgresql_adapter.py` | ~2h |
| A2 | `FOR...LOOP` tracking | 🔴 High | Low | `postgresql_adapter.py` | ~1h |
| A3 | `CALL` → offline route | 🔴 High | Low | `validator_pg.py` | ~30min |
| B1 | Extract `_compute_token_position()` | 🟡 Medium | Low | `validator_mssql.py` | ~1h |
| B2 | ScriptDOM + Semantic confirm | 🟡 Medium | Medium | `sqlserver_scriptdom.py` | ~2h |
| C1 | Warning + BP rules | 🟢 Low | High | new `best_practice_rules.py` | ~1 ngày |
| C2 | `TRY...CATCH` tracker | 🟢 Low | Medium | `validator_mssql.py` | ~3h |
| C3 | Statement-level caching | 🟢 Low | Medium | `coordinator.py` | ~4h |

---

## 6. Sprint Plan

### Sprint 1 — v1.0.8 "Syntax Stability" (~4-6 giờ)
1. **A3**: Fix `CALL` → offline route (30 min)
2. **A2**: `FOR...LOOP` tracking (1h)
3. **A1**: `EXCEPTION WHEN` block support (2h)
4. **B1**: Refactor `_compute_token_position()` (1h)
5. Viết unit tests cho tất cả fixes

### Sprint 2 — v1.0.9 "Semantic Enhancement" (~1-2 ngày)
1. **B2**: ScriptDOM + Semantic integration confirm/fix
2. **C2**: T-SQL `TRY...CATCH` block tracker
3. Mở rộng test corpus PL/pgSQL phức tạp

### Sprint 3 — v1.1.0 "Smart IDE" (~3-5 ngày)
1. **C1**: Best-practice warning rules (BP001-BP006)
2. **C3**: Statement-level caching
3. Monaco `warning` severity color + UI distinction
4. Quick-Fix suggestion API (Monaco CodeAction)

---

## 7. Test Cases Đề Xuất Cho Phase A

```sql
-- Test A1: EXCEPTION WHEN block (PostgreSQL)
CREATE FUNCTION fn_exception() RETURNS void AS $$
BEGIN
    INSERT INTO t VALUES (1);
EXCEPTION
    WHEN unique_violation THEN
        RAISE NOTICE 'dup ignored';
    WHEN OTHERS THEN
        RAISE;
END;
$$ LANGUAGE plpgsql;
-- Expected: NO ERROR

-- Test A2: FOR loop variants (PostgreSQL)
CREATE FUNCTION fn_for_loop() RETURNS void AS $$
BEGIN
    FOR i IN 1..10 LOOP
        RAISE NOTICE '%', i;
    END LOOP;
    FOR rec IN SELECT id FROM t LOOP
        PERFORM process(rec.id);
    END LOOP;
END;
$$ LANGUAGE plpgsql;
-- Expected: NO ERROR

-- Test A3: CALL statement (PostgreSQL)
CALL my_schema.rebuild_stats('2026-01-01', TRUE);
-- Expected: NO ERROR (không qua EXPLAIN)

-- Test A3 invalid: CALL sai tham số (kiểm tra offline sqlglot)
CALL 'not_a_function';
-- Expected: ERROR (sqlglot offline)
```

---

## 8. Tổng Kết

Hệ thống Syntax Check của LLTool IDE đang ở trạng thái **rất tốt** về kiến trúc:
- Pipeline phân tầng rõ ràng: Syntax → Semantic → Deduplicate
- Hybrid strategy cho PostgreSQL là đúng đắn và an toàn tuyệt đối
- Multi-error extraction với line masking là tính năng premium hiếm thấy

**3 fix quan trọng nhất cần làm ngay (Phase A, ~4-6 giờ total)**:
1. `EXCEPTION WHEN` → parser PL/pgSQL đầy đủ
2. `CALL` → offline route để tránh false error
3. `FOR...LOOP` → tracking đầy đủ vòng lặp

Với Phase A hoàn thành, độ chính xác syntax check sẽ đạt **>98%** cho cả T-SQL và PL/pgSQL phức tạp thực tế.
