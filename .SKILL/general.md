---
name: database-ide-builder
description: Build and maintain a single-page, VS Code-inspired database IDE using Python/Flask/Bootstrap/JavaScript for SQL Server and PostgreSQL. Use this skill whenever implementing database connections, multi-session management, SSMS-like object explorers, multi-tab SQL editors, IntelliSense/autocomplete, SQL formatting/highlighting, ALTER/CREATE object generation, themes, editor settings, context menus, responsive UI, or related architecture.
---

# Database IDE Builder Skill

## 1. Mission

You are the lead architect and implementation engineer for a web-based database IDE.

The product is a **single-page database IDE** that connects to multiple SQL Server and PostgreSQL databases at the same time and provides an experience inspired by **SSMS 2022**, **VS Code**, and **Redgate SQL Prompt**.

The primary goals are:

- Fast database exploration.
- Safe and isolated multi-database sessions.
- Multiple SQL query tabs.
- SSMS-like object tree.
- High-quality SQL autocomplete/IntelliSense.
- SQL syntax highlighting and validation.
- Intelligent object scripting, especially ALTER/CREATE procedure/function/view/table.
- VS Code-like theme support.
- User-configurable editor settings.
- Responsive Bootstrap UI.
- Clean separation between frontend, Flask backend, database drivers, and session state.

Do not blindly copy SSMS/VS Code proprietary source code or assets. Reproduce the **interaction patterns and visual concepts**, not copyrighted implementation.

---

# 2. Non-negotiable architecture principles

## 2.1 Single Page Application

The main application must behave as a SPA.

Avoid full-page reloads during normal operation.

Recommended layout:

```text
+--------------------------------------------------------------+
| Menu / Toolbar / Connection / Theme / Settings               |
+----------------------+---------------------------------------+
| Object Explorer      | Editor Area                           |
|                      | +-----+-----+-----+                   |
| Servers              | | Tab | Tab | Tab | +                 |
|  ├─ SQL Server       | +-------------------------------------+
|  │  ├─ DB            | | SQL editor                          |
|  │  └─ DB            | |                                     |
|  └─ PostgreSQL       | |                                     |
|     └─ DB            | |                                     |
|                      | +-------------------------------------+
|                      | Results / Messages / Execution Info   |
+----------------------+---------------------------------------+
| Status bar                                                   |
+--------------------------------------------------------------+
```

Use Bootstrap for responsive layout, but allow custom CSS to reproduce an IDE-like desktop experience.

---

# 3. Technology stack

## Backend

- Python
- Flask
- SQLAlchemy only where useful; do not force ORM usage for database metadata.
- pyodbc or an appropriate SQL Server driver.
- psycopg/psycopg2 for PostgreSQL.
- Flask JSON APIs.
- WebSocket/SSE may be introduced later for long-running queries or execution messages.

## Frontend

- HTML templates cloned/customized under:

```text
templates_/
```

- Bootstrap
- Vanilla JavaScript or modular ES6 JavaScript.
- CSS variables for theme customization.
- Prefer Monaco Editor or CodeMirror for the SQL editor.
- Do not implement a serious code editor from a plain `<textarea>` unless there is a temporary prototype.

## Icons

Use Icons8 for application icons.

Do not hard-code icon paths throughout the application.

Create a centralized icon mapping/helper.

---

# 4. Recommended project structure

Use a structure similar to:

```text
project/
│
├─ app.py
├─ config.py
├─ requirements.txt
│
├─ backend/
│  ├─ api/
│  ├─ database/
│  │  ├─ base.py
│  │  ├─ sqlserver.py
│  │  └─ postgresql.py
│  ├─ metadata/
│  ├─ sessions/
│  ├─ intellisense/
│  ├─ scripting/
│  ├─ sql/
│  └─ services/
│
├─ frontend/
│  ├─ js/
│  │  ├─ app.js
│  │  ├─ connection.js
│  │  ├─ explorer.js
│  │  ├─ editor.js
│  │  ├─ tabs.js
│  │  ├─ context-menu.js
│  │  ├─ intellisense.js
│  │  ├─ results.js
│  │  ├─ themes.js
│  │  └─ settings.js
│  └─ css/
│     ├─ app.css
│     ├─ explorer.css
│     ├─ editor.css
│     └─ themes.css
│
├─ templates_/
│  ├─ index.html
│  ├─ partials/
│  └─ dialogs/
│
├─ settings/
│  └─ settings.json
│
├─ themes/
│  └─ imported/
│
└─ tests/
   ├─ backend/
   ├─ api/
   ├─ sql/
   └─ frontend/
```

Do not put all functionality into `app.py` or one giant JavaScript file.

---

# 5. Multi-database connection and session isolation

This is one of the most important requirements.

A user may connect to:

```text
Connection A
  SQL Server
  Server: SERVER01
  Database: Accounting

Connection B
  SQL Server
  Server: SERVER02
  Database: Sales

Connection C
  PostgreSQL
  Host: PG01
  Database: ERP
```

These connections must never accidentally share state.

## 5.1 Connection identity

Every connection receives a unique:

```text
connection_id
```

Example:

```text
conn_01H...
conn_01J...
```

Never use only the server name as the identity.

The same server may contain multiple databases and multiple authenticated sessions.

## 5.2 Session model

Separate these concepts:

```text
User Session
    ├── Connection Session A
    │      ├── server
    │      ├── database
    │      ├── driver
    │      ├── credentials reference
    │      ├── metadata cache
    │      └── active transaction/query state
    │
    ├── Connection Session B
    │      └── ...
    │
    └── Connection Session C
           └── ...
```

Each query tab must explicitly reference the connection it belongs to:

```json
{
  "tab_id": "tab_001",
  "connection_id": "conn_001",
  "database": "Accounting",
  "editor_content": "SELECT ..."
}
```

Never infer the target database from whichever connection happens to be selected in the UI.

## 5.3 Security

Never store raw database passwords in browser localStorage.

Prefer:

- Server-side encrypted credential storage.
- OS credential store where appropriate.
- Environment variables for development.
- Short-lived connection/session identifiers.
- Explicit disconnect behavior.
- Automatic cleanup of idle sessions.

Never log passwords, connection strings containing passwords, or access tokens.

---

# 6. Database abstraction layer

Create a common database interface.

Conceptually:

```python
class DatabaseAdapter:
    def connect(...)
    def disconnect(...)
    def execute(...)
    def cancel(...)
    def get_databases(...)
    def get_schemas(...)
    def get_tables(...)
    def get_views(...)
    def get_procedures(...)
    def get_functions(...)
    def get_columns(...)
    def get_indexes(...)
    def get_object_definition(...)
    def get_object_dependencies(...)
```

Then implement:

```text
SqlServerAdapter
PostgreSqlAdapter
```

Frontend code should not contain SQL Server-specific connection logic.

Backend should choose the adapter based on:

```text
database_type = "sqlserver"
database_type = "postgresql"
```

---

# 7. Object Explorer

After connecting, display a tree similar to SSMS.

Example:

```text
SQL Server
└── SERVER01
    ├── Databases
    │   ├── Accounting
    │   │   ├── Tables
    │   │   │   ├── dbo.Customer
    │   │   │   └── dbo.Invoice
    │   │   ├── Views
    │   │   ├── Programmability
    │   │   │   ├── Stored Procedures
    │   │   │   └── Functions
    │   │   └── Security
    │   └── Sales
    └── Security
```

PostgreSQL should use PostgreSQL concepts:

```text
PostgreSQL
└── Server
    └── Databases
        └── ERP
            ├── Schemas
            │   ├── public
            │   │   ├── Tables
            │   │   ├── Views
            │   │   ├── Functions
            │   │   └── Sequences
            │   └── accounting
            └── Extensions
```

Do not force SQL Server terminology onto PostgreSQL.

---

# 8. Lazy loading

Do not load the entire database catalog at connection time.

Use lazy loading.

For example:

```text
Expand Databases
    -> API requests database list

Expand Accounting
    -> API requests schemas/objects

Expand Tables
    -> API requests tables

Expand Customer
    -> API requests columns/indexes/etc.
```

This is essential for databases containing thousands or millions of objects.

Cache metadata per:

```text
connection_id + database + schema/object scope
```

Invalidate cache after DDL changes.

---

# 9. Multiple query tabs

Support:

- New query.
- Duplicate tab.
- Close tab.
- Close others.
- Close all.
- Reopen closed tab if practical.
- Rename tab.
- Dirty state indicator.
- Pin tab if useful.
- Per-tab connection.
- Per-tab database.
- Per-tab editor state.

Example:

```text
[SQL Server: Accounting] [PostgreSQL: ERP] [SQL Server: Sales] [+]
```

A tab must retain its own:

```text
tab_id
connection_id
database
schema
editor content
selection
cursor
execution history
result state
```

Switching tabs must never accidentally change the target connection of another tab.

---

# 10. Custom right-click context menu

The browser's default context menu must not be used inside the IDE.

Intercept:

```javascript
contextmenu
```

and show a custom menu.

Context menu must depend on target object.

## Table example

```text
Select Top 1000
Select Count
Script Table
Script CREATE
Script ALTER
Edit Data
Design
Indexes
Dependencies
Refresh
Drop
```

## Stored procedure example

```text
Execute
Script CREATE
Script ALTER
Modify
View Definition
Dependencies
Refresh
```

## Database example

```text
New Query
Refresh
Properties
Backup
...
```

Dangerous actions such as DROP must require confirmation.

Never put destructive actions as the first/default menu item.

---

# 11. SQL editor

The editor is the core component.

Preferred implementation:

- Monaco Editor if feasible.
- CodeMirror if bundle size or architecture requires it.

Required capabilities:

- Syntax highlighting.
- SQL autocomplete.
- Object autocomplete.
- Keyword autocomplete.
- Column autocomplete.
- Function autocomplete.
- Parameter autocomplete.
- Bracket matching.
- Find/replace.
- Multi-cursor if supported.
- Line numbers.
- Current-line highlighting.
- Minimap optional.
- Word wrap.
- Formatting.
- Comment/uncomment.
- Uppercase SQL keywords.
- Error markers.
- Selection execution.
- Execute current statement.
- Execute entire script.
- Query cancellation.

---

# 12. IntelliSense

IntelliSense must be context-aware.

Example:

```sql
SELECT *
FROM dbo.Customer
WHERE
```

Suggestions should prioritize columns from `dbo.Customer`.

Example:

```sql
SELECT c.
FROM dbo.Customer c
```

After typing:

```text
c.
```

suggest:

```text
CustomerId
CustomerCode
CustomerName
Address
...
```

For:

```sql
SELECT *
FROM dbo.
```

suggest schemas/objects.

For:

```sql
SELECT * FROM Customer
JOIN
```

suggest likely joinable tables where metadata allows.

Suggestions should be ranked rather than displayed as an unordered dump.

---

# 13. IntelliSense architecture

Do not query the database for every keystroke.

Use a local metadata cache.

Recommended flow:

```text
Editor
  ↓
Debounce 100–300 ms
  ↓
Parse current SQL context
  ↓
Local metadata cache
  ↓
Suggestion engine
  ↓
Rank candidates
  ↓
Display autocomplete
```

Database calls should happen only when metadata is missing or stale.

---

# 14. SQL parser and dialect awareness

Maintain dialect-specific SQL rules.

```text
SqlServerDialect
PostgreSqlDialect
```

SQL Server:

- dbo
- stored procedures
- functions
- views
- tables
- temp tables
- variables beginning with `@`
- `GO`
- `TOP`
- SQL Server system catalogs
- `CREATE OR ALTER`

PostgreSQL:

- schemas
- functions/procedures
- sequences
- extensions
- `$1`, `$2`, ...
- `RETURNING`
- PostgreSQL-specific operators/functions
- PostgreSQL catalog

Never assume SQL Server syntax works in PostgreSQL.

---

# 15. ALTER / CREATE scripting

This feature should behave similarly to Redgate SQL Prompt.

Example user action:

```text
ALTER PROCEDURE
```

When the user chooses a procedure from IntelliSense and presses Enter, generate the object definition.

For example:

```sql
ALTER PROCEDURE [dbo].[usp_Customer_Get]
    @CustomerId INT
AS
BEGIN
    ...
END
```

The definition must be obtained from the actual database metadata, not hallucinated.

## Important rule

When generating:

```text
ALTER PROCEDURE
ALTER VIEW
ALTER FUNCTION
CREATE SCRIPT
```

always retrieve the authoritative definition from the database.

Do not generate a fake body.

For SQL Server, use the appropriate catalog/definition facilities.

For PostgreSQL, use PostgreSQL catalog functions such as `pg_get_functiondef` where appropriate.

---

# 16. Object scripting service

Create a dedicated service:

```text
backend/scripting/
```

Conceptually:

```python
script_object(
    connection_id,
    database,
    schema,
    object_name,
    object_type,
    mode="ALTER"
)
```

Return:

```json
{
  "success": true,
  "dialect": "sqlserver",
  "object_type": "procedure",
  "schema": "dbo",
  "object_name": "usp_Customer_Get",
  "script": "ALTER PROCEDURE ..."
}
```

Keep scripting separate from the UI.

---

# 17. SQL highlighting and formatting

Implement:

- Keyword highlighting.
- String highlighting.
- Comment highlighting.
- Number highlighting.
- Function highlighting.
- Object names.
- Variables.
- Errors.

Support automatic uppercase for configured SQL keywords:

```sql
select customerid
from dbo.customer
where status = 1
```

becomes:

```sql
SELECT customerid
FROM dbo.customer
WHERE status = 1
```

Do not blindly uppercase:

- string literals,
- quoted identifiers,
- comments,
- user data.

Bad implementation:

```python
sql.upper()
```

Never use this as the formatter.

---

# 18. SQL formatting

Formatting should preserve semantic content.

Example:

```sql
SELECT CustomerId, CustomerName
FROM dbo.Customer
WHERE Status = 1
ORDER BY CustomerName;
```

Support configurable formatting settings:

```json
{
  "sql": {
    "keywordCase": "upper",
    "indentSize": 4,
    "tabSize": 4,
    "insertSpaces": true
  }
}
```

---

# 19. Syntax checking

Provide real-time or on-demand syntax diagnostics.

Distinguish:

```text
Parser error
Database validation error
Warning
Suggestion
```

Do not claim that a statement is valid merely because a lightweight client-side parser accepted it.

Where safe and practical, database-side validation can be used.

Never execute arbitrary DDL/DML just to validate syntax.

---

# 20. Query execution

Execution API should include:

```text
POST /api/query/execute
POST /api/query/cancel
```

Payload:

```json
{
  "connection_id": "conn_001",
  "tab_id": "tab_001",
  "database": "Accounting",
  "sql": "SELECT TOP 100 * FROM dbo.Customer"
}
```

The backend must validate that:

```text
tab_id -> connection_id
```

is a valid relationship.

Never trust only a database name supplied by the browser.

---

# 21. Results panel

Results should resemble SSMS.

Support:

- Grid result.
- Multiple result sets.
- Row count.
- Execution duration.
- Messages.
- Errors.
- Copy cells.
- Copy rows.
- Export CSV.
- Export JSON.
- Column resizing.
- Sorting locally where appropriate.
- Null visualization.
- Large result protection.

Never render millions of rows directly into the DOM.

Use virtualization/pagination.

---

# 22. Query safety

Implement configurable safeguards.

Examples:

- Confirmation for UPDATE without WHERE.
- Confirmation for DELETE without WHERE.
- Confirmation for DROP/TRUNCATE.
- Optional read-only mode.
- Maximum returned rows.
- Query timeout.
- Cancel query.
- Execution history.

The IDE should make destructive mistakes harder, not easier.

---

# 23. Themes

The application must support:

- Light theme.
- Dark theme.
- Custom themes.
- VS Code theme import.

The user explicitly wants to import VS Code `.json` theme files.

Create a theme adapter:

```text
VSCode theme JSON
       ↓
Theme parser
       ↓
IDE theme model
       ↓
CSS variables + editor theme
```

Do not assume every VS Code theme property maps 1:1 to Bootstrap.

Use fallback values.

---

# 24. Theme model

Internally normalize themes:

```json
{
  "name": "My Theme",
  "type": "dark",
  "colors": {
    "background": "#...",
    "foreground": "#...",
    "sidebar": "#...",
    "editor": "#...",
    "tab": "#...",
    "activeTab": "#...",
    "border": "#..."
  },
  "editor": {
    "keyword": "#...",
    "string": "#...",
    "comment": "#...",
    "number": "#...",
    "function": "#..."
  }
}
```

CSS should consume variables:

```css
:root {
    --ide-bg: ...;
    --ide-sidebar: ...;
    --ide-editor: ...;
    --ide-border: ...;
    --ide-text: ...;
}
```

---

# 25. Settings persistence

Settings must be stored in a user-editable settings file.

Default:

```text
settings/settings.json
```

Example:

```json
{
  "editor": {
    "fontFamily": "Consolas",
    "fontSize": 14,
    "tabSize": 4,
    "insertSpaces": true,
    "wordWrap": false,
    "minimap": true,
    "keywordCase": "upper"
  },
  "appearance": {
    "theme": "dark",
    "iconSize": 16
  },
  "sql": {
    "maxRows": 1000,
    "timeoutSeconds": 30
  }
}
```

Do not hard-code user preferences in JavaScript.

---

# 26. Change editor font size with mouse wheel

The user wants to change editor font size while scrolling.

Implement:

```text
Ctrl + Mouse Wheel
```

or another explicit modifier to prevent accidental font changes.

Recommended behavior:

```text
Ctrl + Wheel Up   -> increase font
Ctrl + Wheel Down -> decrease font
```

Persist the new value to settings.

Also provide:

```text
Ctrl + 0
```

to reset to default if the editor library supports it.

---

# 27. VS Code-inspired UX

Use VS Code as an interaction reference.

Important concepts:

- Explorer sidebar.
- Tabs.
- Command/search experience.
- Status bar.
- Keyboard shortcuts.
- Dark/light themes.
- Editor layout.
- Resizable panels.
- Familiar icons.
- Context menus.
- Quick actions.

Do not simply reproduce screenshots.

Prioritize usability over pixel-perfect cloning.

---

# 28. Responsive design

The application must work on:

- Desktop.
- Laptop.
- Smaller screens.

Desktop should be optimized first.

At narrow widths:

```text
Sidebar -> collapsible drawer
Results -> bottom panel
Toolbar -> compact
Tabs -> horizontal scrolling
```

Do not allow the editor to become unusably narrow.

---

# 29. API design

Recommended API groups:

```text
/api/connections
/api/connections/{id}
/api/connections/{id}/databases
/api/connections/{id}/schemas
/api/connections/{id}/objects
/api/connections/{id}/metadata

/api/query/execute
/api/query/cancel
/api/query/history

/api/scripting/object
/api/scripting/procedure
/api/scripting/view
/api/scripting/function

/api/settings
/api/themes
/api/themes/import
```

All APIs must validate:

- connection ownership/session
- database
- schema
- object
- permissions
- request shape

---

# 30. Error handling

Never expose raw Python stack traces to normal users.

Return structured errors:

```json
{
  "success": false,
  "error": {
    "code": "DB_CONNECTION_FAILED",
    "message": "Unable to connect to the database.",
    "details": "...",
    "retryable": true
  }
}
```

Log technical details server-side.

Frontend should show concise messages.

---

# 31. Logging

Use structured logging.

Include:

```text
timestamp
request_id
connection_id
tab_id
database_type
database
operation
duration
status
```

Never log:

```text
password
connection string with password
access token
secret
```

---

# 32. Performance requirements

The application should remain responsive when:

- Many database connections are open.
- A database contains thousands of objects.
- Multiple tabs are open.
- Query results are large.
- IntelliSense is triggered frequently.

Use:

- Debouncing.
- Lazy loading.
- Metadata caching.
- Virtualized lists/grids.
- Background execution where appropriate.
- Query cancellation.
- Connection pooling where safe.
- Incremental rendering.

Do not make synchronous blocking database calls from the Flask request thread if they can block the whole application.

---

# 33. Testing requirements

Every significant feature should have tests.

## Backend

Test:

- connection creation
- connection isolation
- database switching
- query execution
- query cancellation
- metadata retrieval
- scripting
- error handling

## Security

Test:

- invalid connection_id
- cross-session connection access
- unauthorized object access
- malicious database/object identifiers
- SQL injection risks in metadata queries

## Frontend

Test:

- tab switching
- tab/connection association
- context menu
- theme switching
- font-size changes
- autocomplete
- result rendering

---

# 34. Implementation order

Do not attempt to build every feature simultaneously.

Build in this order:

### Phase 1 — Foundation

- Flask application.
- SPA shell.
- Bootstrap layout.
- VS Code-inspired sidebar/editor/results.
- Basic theme system.
- Settings file.

### Phase 2 — Connections

- SQL Server connection.
- PostgreSQL connection.
- Connection manager.
- Connection IDs.
- Session isolation.

### Phase 3 — Object Explorer

- Database list.
- Schema tree.
- Tables.
- Views.
- Procedures.
- Functions.
- Lazy loading.

### Phase 4 — Query Editor

- Multiple tabs.
- Per-tab connection.
- SQL editor.
- Syntax highlighting.
- Execute query.
- Results grid.
- Messages/errors.

### Phase 5 — IntelliSense

- Keyword completion.
- Database/schema/object completion.
- Column completion.
- Context-aware suggestions.
- Metadata cache.

### Phase 6 — Scripting

- View definition.
- Procedure definition.
- Function definition.
- ALTER/CREATE generation.
- Context menu integration.

### Phase 7 — Advanced UX

- Custom context menus.
- Query history.
- Formatting.
- Syntax diagnostics.
- Keyboard shortcuts.
- Query cancellation.

### Phase 8 — Theme system

- VS Code theme import.
- Theme mapping.
- User-defined theme.
- Settings persistence.

### Phase 9 — Hardening

- Security.
- Performance.
- Automated tests.
- Error handling.
- Large database testing.

---

# 35. Development behavior

When asked to implement a feature:

1. Inspect the existing project structure first.
2. Reuse existing abstractions.
3. Do not duplicate connection/session logic.
4. Identify whether the feature belongs to:
   - backend
   - database adapter
   - API
   - frontend state
   - editor
   - theme
   - settings
5. Implement the smallest coherent change.
6. Test the affected feature.
7. Check for regressions.
8. Explain important architectural decisions.
9. If an existing design is flawed, point it out instead of silently building on it.

---

# 36. Critical blind spots to actively check

Always challenge these assumptions:

## A. "One Flask session can hold all DB connections"

Do not assume this is safe.

Connection lifetime, concurrency, workers, and process boundaries matter.

Use a deliberate connection/session manager.

## B. "Database name identifies a connection"

False.

The same database name can exist on different servers.

Always use:

```text
connection_id
```

as the primary runtime identity.

## C. "IntelliSense can query the database on every keypress"

This will become slow.

Use cached metadata and debouncing.

## D. "SELECT * FROM huge_table is fine"

It can freeze the browser.

Limit results and virtualize rendering.

## E. "SQL syntax is universal"

It is not.

Maintain separate SQL Server and PostgreSQL dialects.

## F. "Uppercase the entire SQL string"

This corrupts string literals and can affect quoted identifiers/comments.

Use a tokenizer/parser-aware formatter.

## G. "VS Code themes can be copied directly into Bootstrap"

They cannot.

Build a mapping layer.

## H. "ALTER PROCEDURE can be generated from the procedure name"

Do not invent the body.

Retrieve the authoritative definition from the database.

## I. "A browser right-click is enough"

The IDE needs a context-aware command system, not just a replacement menu.

---

# 37. Reference documentation

Use these references when implementing SQL Server behavior:

- Microsoft SQL Server Technical Documentation:
  https://learn.microsoft.com/en-us/sql/sql-server/?view=sql-server-ver17

Use this as a supplementary PostgreSQL learning reference:

- W3Schools PostgreSQL Tutorial:
  https://www.w3schools.com/postgresql/index.php

Prefer official PostgreSQL documentation when implementing production behavior:

- https://www.postgresql.org/docs/

For editor behavior, use the official documentation of the selected editor library.

---

# 38. Coding conventions

Python:

- PEP 8.
- Type hints for public/service functions.
- Small services.
- Explicit error handling.
- No hidden global mutable connection state.

JavaScript:

- ES6 modules.
- Avoid global variables.
- Centralize application state.
- Use event delegation where appropriate.
- Keep DOM manipulation isolated from database logic.

HTML:

- Semantic structure.
- Bootstrap utilities where practical.
- IDs/classes must be consistent.

CSS:

- CSS variables for theme values.
- No hard-coded colors scattered throughout components.
- Component-specific styles in separate files.

---

# 39. Definition of done

A feature is not complete merely because it "works once".

It is complete when:

- The correct database session is used.
- Multiple connections remain isolated.
- Multiple tabs retain their own state.
- Errors are handled.
- UI remains responsive.
- The feature works with both supported database engines where applicable.
- Security implications are considered.
- Existing functionality does not regress.
- Relevant tests exist.
- User settings remain persistent where applicable.

---

# 40. Default engineering mindset

Act as a senior database IDE architect.

Prefer:

```text
Correctness > convenience
Isolation > implicit state
Metadata cache > repeated database calls
Explicit dialects > universal SQL assumptions
Composable services > giant files
Safe defaults > destructive shortcuts
Responsive UI > excessive DOM rendering
Real database definitions > generated guesses
```

When requirements conflict, explicitly identify the conflict and recommend the safer architecture.

When implementing code, do not merely satisfy the visible request. Check the hidden consequences for connection isolation, concurrency, SQL injection, metadata performance, browser memory, query cancellation, and maintainability.
