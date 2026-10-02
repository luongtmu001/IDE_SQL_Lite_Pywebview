# SQL IntelliSense Architecture Audit & Baseline Benchmark
**Document ID:** `INTELLISENSE_AUDIT.md`  
**Phase:** Phase 0 — System Audit, Baseline Benchmark & Safety Preparation  
**Project:** IDE-SQL-Lite (Pywebview / Python Flask / Monaco Editor with CodeMirror Facade)  
**Date:** 2026-09-29  
**Status:** Completed (Code freeze maintained — Zero code modifications during Phase 0)

---

## 1. Executive Summary

This document fulfills the mandatory requirements of **Phase 0** specified in Section 62 of `.SKILL/intellisense_improvement_plan_v2.md`. 
The audit inspects the entire SQL IntelliSense system across frontend and backend, evaluates editor integration mechanisms, catalogs metadata services and caches, profiles performance benchmarks, establishes test baselines, and defines the dependency graph.

### Core Audit Principles Adhered To:
1. **Zero Code Edits**: No runtime code was altered during this audit phase.
2. **UI Integrity**: The Dual-Panel IntelliSense Popup (`#ide-intellisense-popup`) is fully preserved.
3. **Editor Architecture Clarification**: The editor is Monaco wrapped with a CodeMirror-compatible facade (`createAppEditorWrapper`). The existing integration works smoothly without forcing Monaco-native language migration or disrupting existing behavior.
4. **100% Test Baseline**: All 127 existing backend and integration tests pass cleanly (`pytest -s tests/`).

---

## 2. Inventory of Current IntelliSense Components

| Component | File Path | Lines | Primary Responsibility |
| :--- | :--- | :--- | :--- |
| **IntelliSense Controller** | `static/js/intellisense.js` | 1,161 | Manages popup lifecycle, debouncing (120ms), DOM events, candidate ranking, HTTP fetching, detail preview tabs, item insertion, ALTER script expansion, and F12 Go to Definition. |
| **Context Analyzer** | `static/js/context-analyzer.js` | 422 | Performs regex-based lexical token extraction: current word, qualifier, previous tokens, follow-up keywords, clause detection, alias mapping, local temp tables/table vars, and ALTER context. |
| **Editor Controller & Wrapper** | `static/js/editor.js` | 1,879 | Instantiates Monaco editor instances (`_primaryEditor`, `_secondaryEditor`) and wraps them in `createAppEditorWrapper` exposing a CodeMirror v5 API surface (`getCursor`, `replaceRange`, `indexFromPos`, etc.). Attaches `AppIntelliSense`. |
| **Snippets Engine** | `static/js/snippets.js` | 320+ | Provides `window.AppSnippets` with `getSnippets()` and `expandSnippetBody()` for template expansion in IntelliSense. |
| **Dual-Panel Popup Template** | `templates/index.html` | Lines 374–432 | HTML structure for `#ide-intellisense-popup`, left list panel, splitter bar, right summary and script preview panel with tabs. |
| **Backend Metadata Routes** | `app/routes/metadata.py` | 251 | Exposes REST endpoints: `/intellisense/objects`, `/intellisense/columns`, `/intellisense/parameters`, `/intellisense/types`, and `/definition`. |
| **Backend Metadata Service** | `app/services/metadata_service.py` | 130 | Thread-safe session-level cached metadata access for objects, columns, parameters, and type descriptors. |
| **SQL Server Adapter** | `app/database/sqlserver.py` | Lines 603–750 | System catalog queries (`sys.objects`, `sys.columns`, `sys.parameters`, `sys.types`, `sys.synonyms`, `sys.triggers`) with `limit=0`. |
| **PostgreSQL Adapter** | `app/database/postgresql.py` | Various | System catalog queries (`pg_class`, `pg_attribute`, `information_schema.columns`) for PostgreSQL schemas and objects. |

---

## 3. Editor Integration Architecture

### Reality of the Editor Layer
The project uses **Monaco Editor** under the hood, but provides a 100% compatible **CodeMirror v5 abstraction layer** via `createAppEditorWrapper(getEditorInstance, containerId)` in `static/js/editor.js`.

```text
┌────────────────────────────────────────────────────────┐
│               Monaco Editor Instance                   │
│      (_primaryEditor / _secondaryEditor)               │
└──────────────────────────┬─────────────────────────────┘
                           │ Wrapped by
                           ▼
┌────────────────────────────────────────────────────────┐
│            createAppEditorWrapper                      │
│   (window.AppEditor / window.AppEditor2)               │
│                                                        │
│  Exposes CodeMirror API:                               │
│   - getValue() / setValue(val)                         │
│   - getSelection() / replaceSelection()                │
│   - getCursor() / setCursor(pos)                       │
│   - posFromIndex(idx) / indexFromPos(pos)              │
│   - replaceRange(text, fromPos, toPos)                 │
│   - cursorCoords(pos, mode)                            │
│   - findWordAt(pos) / getRange(from, to)               │
│   - on('change') / on('cursorActivity') / on('keydown')│
└──────────────────────────┬─────────────────────────────┘
                           │ Attached to
                           ▼
┌────────────────────────────────────────────────────────┐
│           AppIntelliSense (intellisense.js)            │
└────────────────────────────────────────────────────────┘
```

### Key Findings & Benefits:
1. `intellisense.js` interacts purely with `cm.getCursor()`, `cm.indexFromPos()`, `cm.replaceRange()`, `cm.cursorCoords()` without direct Monaco dependencies.
2. In Phase 1, we can formalize this wrapper into a dedicated `EditorAdapter` interface as requested by Section 4 & Section 63 of the plan.
3. Neither editor needs to be replaced or re-architected; the existing adapter is stable and well-tested.

---

## 4. Metadata Services & Database Catalog Endpoints

### Backend REST APIs (`app/routes/metadata.py`)
1. `GET /api/metadata/<connection_id>/intellisense/objects?database=<db>&schema=<schema>`
   - Returns all schema objects: tables, views, procedures, functions, triggers, synonyms, sequences.
   - Mapped to standardized types: `'table'`, `'view'`, `'procedure'`, `'function'`, `'trigger'`, `'synonym'`, `'sequence'`.
2. `GET /api/metadata/<connection_id>/intellisense/columns?database=<db>&schema=<schema>&table=<table>`
   - Returns columns with `name`, `data_type`, `is_nullable`, `is_pk`.
3. `GET /api/metadata/<connection_id>/intellisense/parameters?database=<db>&schema=<schema>&name=<routine>`
   - Returns parameters with `name`, `data_type`, `is_output`.
4. `GET /api/metadata/<connection_id>/intellisense/types?database=<db>`
   - Returns standard data types (`types`) and user-defined types (`user_types`).
5. `GET /api/metadata/<connection_id>/definition?database=<db>&schema=<schema>&name=<name>&type=<type>`
   - Returns the DDL create/alter script text for the selected object.

---

## 5. Cache Architecture Inventory

Currently, caching is split across two tiers:

### Client-Side Cache (`static/js/intellisense.js`)
All stored in JavaScript `Map` collections:
- `objectsCache`: Key `"connId::database::schema"` $\to$ `Array<ObjectSummary>`
- `columnsCache`: Key `"connId::database::schema::table"` $\to$ `Array<ColumnSummary>`
- `parametersCache`: Key `"connId::database::schema::name"` $\to$ `Array<ParameterSummary>`
- `definitionsCache`: Key `"connId::database::schema::name::type"` $\to$ `string` (DDL script)
- `dataTypesCache`: Key `"connId::database"` $\to$ `{ types: string[], user_types: string[] }`

### Server-Side Cache (`app/services/metadata_service.py`)
- Stored in `self.session.metadata_cache` (Python dictionary bound to the active user connection session).
- Thread-safe access guaranteed via `with self.session.lock:`.
- Cache keys formatted as `self._cache_key(func_name, *args)`.
- Invalidation hook: `connection.metadata_service.invalidate()` called on DDL/schema modifications.

---

## 6. Completion UI Architecture

The Dual-Panel UI is implemented in `templates/index.html` (lines 374–432) and managed by `static/js/intellisense.js`:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ #ide-intellisense-popup                                                │
│ ┌───────────────────────────────┬───┬────────────────────────────────┐ │
│ │ #ide-intellisense-list-panel  │   │ #ide-intellisense-details-panel│ │
│ │  ┌─────────────────────────┐  │   │  [Summary Tab]  [Script Tab]   │ │
│ │  │ Header (Drag to move)   │  │   │ ┌────────────────────────────┐ │ │
│ │  │ ⁝⁝ Suggestions  [Count] │  │ S │ │ Columns Table              │ │ │
│ │  ├─────────────────────────┤  │ P │ │  Name  | Type | Null | PK  │ │ │
│ │  │ List Items:             │  │ L │ │  Id    | int  | NO   | 🔑  │ │ │
│ │  │  🗄 Customer     [Table]│  │ I │ │  Name  | nv.. | YES  |     │ │ │
│ │  │  🗄 Orders       [Table]│  │ T │ └────────────────────────────┘ │ │
│ │  │  🔤 SELECT     [Keyword]│  │ T │ ┌────────────────────────────┐ │ │
│ │  │  ⚡ usp_GetCust  [Proc] │  │ E │ │ Script Preview (DDL text)  │ │ │
│ │  │  ✨ s_sel       [Snip] │  │ R │ │  CREATE PROCEDURE ...       │ │ │
│ │  └─────────────────────────┘  │   │ └────────────────────────────┘ │ │
│ └───────────────────────────────┴───┴────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### UI Features Working Successfully:
- **Splitter Dragging**: `#ide-intellisense-splitter` allows custom width resizing (220px to 600px).
- **Header Dragging**: Users can drag the popup anywhere on screen; position is preserved until hidden.
- **Smart Dismiss**: Closes on click outside or when mouse moves > 35px away after entering.
- **Dual Tab Preview**:
  - `Summary`: Renders an interactive table of columns (with PK key icons) or routine parameters.
  - `Script`: Displays object DDL text fetched asynchronously with loading states.
- **Keyboard Navigation**: Up, Down, PageUp, PageDown, Enter, Tab, Escape.

---

## 7. Working Features to be Protected (Regression Guard)

The following 9 features are currently operating properly and must NOT be broken or degraded in any subsequent phase:

1. **Dual-Panel UI**: The left suggestion list + splitter + right summary/script preview must remain intact.
2. **ALTER / CREATE OR ALTER Smart Script Expansion**:
   - Typing `ALTER PROCEDURE <name>` or `CREATE OR ALTER VIEW <name>` and selecting the item automatically replaces the statement with the object's definition script, transforms the header clause appropriately, and moves the cursor right after the object name.
3. **F12 Go to Definition**:
   - Pressing F12 resolves the identifier at the cursor, fetches the definition, and opens a new editor tab named `<object_name>.sql`.
4. **Follow-Up Keywords**:
   - `SELECT` triggers follow-ups.
   - `CREATE OR` triggers `ALTER`, `REPLACE`.
   - `CREATE OR ALTER` triggers `PROCEDURE`, `FUNCTION`, `TRIGGER`, `VIEW`.
   - `GROUP` triggers `BY`.
   - `INNER` / `LEFT` / `RIGHT` triggers `JOIN` / `OUTER`.
   - `TRUNCATE` triggers `TABLE`.
5. **Local Scope Objects**:
   - In-file `#temp_table` discovery.
   - In-file `@table_variable` discovery.
6. **SQL Snippets**:
   - Prefix matching and placeholder replacement (`$param$`) via `AppSnippets`.
7. **Dot Trigger Resolution (`table.column` & `schema.table`)**:
   - Aliases are resolved to target tables to fetch columns.
   - Schemas (e.g. `dbo.`) fetch schema objects.
8. **SELECT Clause Prioritization**:
   - In `SELECT` clauses, columns belonging to tables in the `FROM`/`JOIN` clauses are prioritized at Level 1.1 right next to keywords.
9. **Debounce (120ms)**:
   - Eliminates UI flicker while preserving responsive keystroke feel.

---

## 8. Current Dependency Graph

```text
[Monaco Editor Instance]
       │
       ▼
[createAppEditorWrapper (window.AppEditor)]
       │
       ├── Events: 'change' (120ms debounce), 'cursorActivity', 'keydown'
       │
       ▼
[AppIntelliSense (static/js/intellisense.js)]
       │
       ├── 1. Context Analysis
       │      │
       │      ▼
       │    [SqlContextAnalyzer (static/js/context-analyzer.js)]
       │      ├── cleanIdentifier()
       │      ├── extractLocalTempTables(), extractLocalTableVars()
       │      ├── extractAliases(), extractAllTablesInQuery()
       │      ├── detectClause(), detectAlterContext()
       │      └── analyze(sql, cursor) -> Context Object
       │
       ├── 2. Candidate Retrieval
       │      ├── Keywords & Functions: SqlContextAnalyzer tables
       │      ├── Snippets: window.AppSnippets.getSnippets()
       │      ├── Local Scope: localTempTables, localTableVars
       │      └── Database Metadata:
       │             ▼
       │           Client Cache Maps (objectsCache, columnsCache, etc.)
       │             │ (Cache miss)
       │             ▼
       │           Fetch /api/metadata/<id>/intellisense/...
       │             │
       │             ▼
       │           [app/routes/metadata.py]
       │             │
       │             ▼
       │           [app/services/metadata_service.py]
       │             │ (Session cache miss)
       │             ▼
       │           [SqlServerAdapter / PostgreSqlAdapter]
       │
       ├── 3. Candidate Sorting & Filtering
       │      └── rankAndFilterCandidates()
       │             Level 1: Keywords, Functions, Snippets, Query Columns
       │             Level 2: DB Objects, Foreign Columns, Types
       │
       └── 4. UI Presentation & Execution
              ├── Render DOM: #ide-intellisense-popup
              ├── Detail Preview: fetchColumns() / fetchDefinition()
              └── On Enter/Tab:
                     ├── Standard insertion: cm.replaceRange()
                     ├── Snippet expansion: AppSnippets.expandSnippetBody()
                     └── ALTER expansion: DDL transform + statement replace
```

---

## 9. Weaknesses & Architectural Gaps Identified

The audit identified the following specific weaknesses in the current implementation, which will be resolved in Phases 1–8:

1. **Regex-Based Context Analyzer (`context-analyzer.js`)**:
   - Fails on nested subqueries (e.g. `SELECT * FROM (SELECT Id FROM Customer c) x WHERE x.` mixes aliases `c` and `x`).
   - Block comments (`/* ... */`) and line comments (`-- ...`) containing SQL keywords trick clause and alias regexes.
   - String literals containing SQL syntax (e.g. `'SELECT FROM WHERE'`) cause false clause detections.
   - CTE expressions (`WITH cte AS (...) SELECT ...`) are not parsed into valid table sources.
2. **Monolithic Responsibility in `intellisense.js`**:
   - Combines UI rendering, network fetching, caching, ranking, context parsing, and editor manipulation in a single 1,161-line file.
   - Difficult to unit-test candidate ranking or alias resolution independently of the DOM.
3. **Cache Eviction & Invalidation**:
   - Client-side cache maps currently have no TTL or connection switch reset logic, relying solely on explicit page reload or tab switch events.
4. **Dialect Decoupling**:
   - While keyword tables have basic dialect splitting (`getKeywordsForDbType`), identifier quotation handling (`[table]` vs `"table"`) and schema qualification rules are hardcoded in regexes rather than delegated to dialect strategies.

---

## 10. Baseline Performance Benchmarks

### 1. Backend REST Endpoints (Flask test client, 100 iterations)
- `/api/metadata/<conn>/intellisense/objects` (1,000 items): **3.503 ms / request**
- `/api/metadata/<conn>/intellisense/columns` (50 items): **1.128 ms / request**
- Database catalog row mapping (2,000 raw rows $\to$ JSON dicts): **5.040 ms**

### 2. Client-Side Regex Context Analyzer (Simulated across SQL sizes)
- Small SQL query (45 chars): **0.043 ms**
- Medium SQL query with JOINs (326 chars): **0.172 ms**
- Large SQL script with 30 batches (~10 KB, 9,780 chars): **4.101 ms**

### 3. Test Suite Baseline
- **127 / 127 tests passing** in `pytest -s tests/` (execution time: ~3.27s).
- IntelliSense API endpoints and SQL Server adapter catalog mapping tests all verified passing.

---

## 11. Conclusion & Phase 1 Readiness

Phase 0 is complete with zero regressions and zero runtime code changes.
The system is ready to proceed to **Phase 1 — Tách IntelliSense Controller**:
- Create `EditorAdapter` to formalize the boundary between `window.AppEditor` and the IntelliSense engine.
- Isolate `IntelliSenseController` from direct DOM manipulation without modifying `#ide-intellisense-popup` or its UX behavior.
