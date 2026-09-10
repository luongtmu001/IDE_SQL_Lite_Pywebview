---
name: database-ide-ui-deep-dive
description: Deep UI/UX implementation skill for the existing single-page database IDE. Use this skill when refining the IDE interface, theme switching, status/action bar, result/message tabs, resizable Object Explorer, database-object filters, and SSMS-like object context menus. This skill inherits the architecture and constraints defined by general.md and focuses on this work session's specialized UI work.
---

# Database IDE — UI Deep Dive Skill

## 1. Mission

This work session is dedicated to **specialized UI/UX refinement of the existing database IDE**.

The current interface is already structurally correct. **Do not rebuild the SPA shell, connection/session architecture, database adapters, or query engine unless a UI requirement genuinely depends on a missing contract.** The objective is to close the remaining interaction, state-management, and visual gaps so the IDE behaves like a mature desktop database client inspired by SSMS, VS Code, DataGrip, and DbVisualizer.

The target is a **functional IDE UI**, not a static mockup.

### Core rule

> Reuse the existing components, state, APIs, CSS variables, event system, and icon system before creating new ones.

Do not solve a UI problem by duplicating connection state, query state, metadata state, or backend logic.

---

# 2. Relationship with `general.md`

`general.md` remains the architectural source of truth.

This skill is a **specialized work-session skill**. It does not replace the general skill and must not contradict it.

The implementation must preserve existing requirements for:

- SPA behavior
- connection/session isolation
- `connection_id`
- per-tab state
- database adapters
- lazy-loaded metadata
- metadata caching
- SQL dialect awareness
- query safety
- result limits
- virtualized rendering
- testing
- frontend/backend separation
- centralized application state

Important existing principles remain mandatory:

```text
connection_id > database name
per-tab state > implicit global state
metadata cache > repeated metadata calls
existing component > duplicate component
real backend state > fake success state
responsive rendering > excessive DOM
```

---

# 3. Scope of today's work

Today's work is **UI-focused** and must cover these seven areas:

1. Fix light/dark theme switching.
2. Add a compact `ide-action-bar` showing the active connection, database, and schema, and move Run SQL into that bar. Add an Execution Plan action.
3. Improve the Result UI with mock data, explicit result-column metadata, zero-row SELECT headers, and resizable columns.
4. Fix Result/Message tab switching and preserve both states.
5. Make the Object Explorer sidebar horizontally resizable, collapsible at the minimum boundary, and reopenable.
6. Add filter icons to appropriate database-object groups and show a filtering modal on click.
7. Implement SSMS-like custom object context menus based on `_concept/Object_Menu`.

Do not widen this session into unrelated feature development.

---

# 4. Mandatory workflow before coding

Before changing code:

1. Inspect the current project tree.
2. Read `general.md` and the current implementation files that own the affected UI.
3. Identify the existing frontend state/store.
4. Identify existing theme logic.
5. Identify the current editor/result/message components.
6. Identify sidebar layout/resizer logic if it already exists.
7. Identify Object Explorer node rendering.
8. Identify the existing icon/helper system.
9. Inspect `_concept/Object_Menu` and related concept files before implementing context menus.
10. Run the current application and reproduce the existing defects where possible.

### Do not do this

- Do not create a second global store because it is convenient.
- Do not add a second theme system.
- Do not create a second context-menu framework if one already exists.
- Do not duplicate the query execution service.
- Do not move connection logic into UI code.
- Do not rebuild working areas simply to make them visually different.

If an existing implementation is flawed, fix the root cause and keep compatible public behavior.

---

# 5. UI layout target

The layout should converge toward:

```text
+--------------------------------------------------------------------+
| Top toolbar                                                        |
+-----------------------+--------------------------------------------+
|                       | Query tabs                                 |
|   Object Explorer     +--------------------------------------------+
|                       | SQL editor                                  |
|                       |                                            |
|                       +--------------------------------------------+
|                       | ide-action-bar                              |
|                       | Conn | DB | Schema | Run | Execution Plan   |
|                       +--------------------------------------------+
|                       | Result | Message                            |
|                       |                                            |
|                       | Result grid                                 |
+-----------------------+--------------------------------------------+
```

The screenshot supplied with this task is a **visual reference for the compact database context/action/status row**. Reproduce the interaction pattern and hierarchy, not copyrighted source code or an exact pixel clone.

---

# 6. Requirement 1 — Light/Dark Theme Switching

## 6.1 Expected behavior

The theme switch must update the complete application without a page reload.

At minimum it must update:

```text
Application background
Object Explorer
Top toolbar
Query tabs
SQL editor container
SQL editor syntax theme
Result panel
Message panel
ide-action-bar
Context menus
Modals
Inputs/selects
Buttons
Borders/dividers
Empty states
```

Where browser/platform support allows it, scrollbars and native controls should also respect the selected theme.

## 6.2 Use CSS design tokens

All major colors must flow through CSS variables.

Example:

```css
:root {
    --ide-bg: ...;
    --ide-surface: ...;
    --ide-panel: ...;
    --ide-sidebar: ...;
    --ide-editor: ...;
    --ide-border: ...;
    --ide-text: ...;
    --ide-text-muted: ...;
    --ide-hover: ...;
    --ide-active: ...;
    --ide-selection: ...;
    --ide-accent: ...;
    --ide-danger: ...;
}
```

Theme variants should override tokens rather than rewrite component CSS.

```css
html[data-theme="dark"] { ... }
html[data-theme="light"] { ... }
```

Do not scatter hard-coded theme colors through component files.

## 6.3 Centralized theme manager

Reuse the existing application state if available.

Conceptual API:

```javascript
themeManager.setTheme("light");
themeManager.setTheme("dark");
themeManager.toggle();
themeManager.getCurrentTheme();
```

Persist the user's selection using the existing settings mechanism.

Do not create a competing persistence mechanism without a strong reason.

## 6.4 Editor synchronization

If Monaco or CodeMirror is used, the SQL editor theme must change together with the rest of the application.

The intended flow is:

```text
IDE theme
   ↓
CSS/theme state
   ↓
Editor theme
```

Do not leave the editor in dark mode while the application is light, or vice versa.

## 6.5 Theme acceptance criteria

The work passes this area only when:

- Light → Dark works without reload.
- Dark → Light works without reload.
- The selected theme persists after reload.
- The SQL editor follows the selected theme.
- Result and Message remain readable in both themes.
- Context menus follow the selected theme.
- Modal dialogs follow the selected theme.
- Inputs and selectors follow the selected theme.

---

# 7. Requirement 2 — `ide-action-bar`

## 7.1 Purpose

Create a compact status/action row directly below the SQL editor and directly above the Result/Message area.

The root element **must use**:

```html
class="ide-action-bar"
```

Do not rename it.

## 7.2 Visual hierarchy

Target pattern:

```text
[ Connection ]   [ Database ]   [ Schema ]            [ Run ] [ Plan ]
```

Example:

```text
[ Local_PG ]   [ Bravo10Setup ]   [ dbo ]              [▶ Run] [Plan]
```

The values shown must represent the active query tab.

## 7.3 State source

The bar must derive its values from existing tab/session state:

```text
active tab
  ├─ tab_id
  ├─ connection_id
  ├─ database
  └─ schema
```

Do not maintain a second set of connection/database/schema variables only for the action bar.

## 7.4 Required controls

The action bar must contain:

```text
Connection
Database
Schema
Run SQL
Execution Plan
```

The existing Run SQL behavior should be moved here, not duplicated.

## 7.5 Run SQL behavior

Moving the button must not change execution semantics.

The action must still respect the existing modes for:

- selected text
- current statement
- entire script
- cancellation
- correct `tab_id`
- correct `connection_id`
- correct database
- correct schema/dialect

The UI is only moving the entry point; execution remains owned by the existing query execution architecture.

## 7.6 Execution Plan action

Add a dedicated action for Execution Plan.

The action must support UI states such as:

```text
Idle
Loading
Available
Error
Disabled
```

If a real execution-plan backend already exists, call it.

If it does not exist yet, implement the UI/state contract without pretending a real plan was generated. Do not display fake plan data as though it came from the database.

## 7.7 Active-tab isolation

Test explicitly with:

```text
Tab A -> SQL Server / DB_A / dbo
Tab B -> PostgreSQL / DB_B / public
```

After switching tabs, the action bar must always match the active tab.

Executing from Tab B must never accidentally use Tab A's target.

---

# 8. Requirement 3 — Result panel

## 8.1 Result-state model

The result UI must support at least:

```text
No result
Loading
Result with rows
Result with zero rows
Error
Multiple result sets
```

## 8.2 Mock/demo result support

During this UI-focused session, the result component must support deterministic mock data so the interface can be tested without executing a live query.

Example:

```javascript
{
    columns: [
        { name: "CustomerId", type: "int" },
        { name: "CustomerCode", type: "varchar" },
        { name: "CustomerName", type: "nvarchar" },
        { name: "Status", type: "bit" }
    ],
    rows: [
        [1, "CUS001", "Customer 01", true],
        [2, "CUS002", "Customer 02", false],
        [3, "CUS003", "Customer 03", true]
    ],
    rowCount: 3,
    durationMs: 18
}
```

Mock data must remain clearly separated from real query state.

Conceptual API:

```javascript
resultStore.setMockResult(...);
resultStore.setRealResult(...);
```

Do not permanently insert fake rows into production query results.

## 8.3 Zero-row SELECT is a first-class state

Given:

```sql
SELECT
    CustomerId,
    CustomerCode,
    CustomerName
FROM dbo.Customer
WHERE 1 = 0;
```

the grid must render:

```text
CustomerId | CustomerCode | CustomerName
-----------+--------------+-------------
```

with no body rows.

The UI must **not** replace the grid with only a `No data` message.

## 8.4 Never infer columns from the first row

Bad:

```javascript
const columns = Object.keys(rows[0]);
```

This fails when `rows.length === 0`.

Required:

```javascript
const columns = result.columns;
const rows = result.rows;
```

The result contract must separate metadata from data rows.

## 8.5 Result grid architecture

Preferred structure:

```text
result-panel
  ├── result-toolbar
  ├── result-grid
  │    ├── header
  │    └── body
  └── result-footer
```

Use the existing grid library/component if one is already present.

Do not replace a capable grid with an ad-hoc table merely to simplify implementation.

## 8.6 Resizable columns

Every visible result column must support horizontal resizing.

Interaction:

```text
| CustomerName |<-- drag -->|
```

Requirements:

- visible resize target near the header edge;
- `col-resize` cursor;
- minimum width;
- horizontal scrolling remains functional;
- header/body remain aligned;
- resizing one column does not corrupt adjacent columns;
- long content can be visually clipped where appropriate;
- keyboard accessibility should remain intact for the rest of the grid.

Recommended conceptual CSS:

```css
.result-column-resizer {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    width: 5px;
    cursor: col-resize;
}
```

Prefer pointer events:

```javascript
pointerdown
pointermove
pointerup
```

## 8.7 Column-width state

Column widths are UI state and should be scoped correctly.

Recommended conceptual key:

```text
tab_id + result_set_id + column_name
```

Do not make a width selected in one query globally change unrelated results unless that is an explicit product decision.

## 8.8 Large-result protection

Maintain the existing performance rules:

- do not render millions of rows directly into the DOM;
- use virtualization/pagination where required;
- do not block the browser with unnecessary DOM creation.

---

# 9. Requirement 4 — Result / Message switching

## 9.1 State-driven switching

The current defect must be fixed at the state/event level.

Use a real active-view state, for example:

```javascript
resultPanelState.activeView = "result";
```

or the project's equivalent centralized state.

Supported views may be:

```text
result
message
execution-plan
```

## 9.2 Expected UI

```text
[ Result ] [ Message ]
```

The active tab must have a clear visual state in both themes.

## 9.3 Switching rules

Clicking Result:

```text
show result content
```

Clicking Message:

```text
show message content
```

Switching views must not delete the other view's state.

Do not require a second query execution just to switch views.

## 9.4 Execution result model

Keep result and message data together as separate fields where practical:

```javascript
queryExecutionState = {
    resultSets: [...],
    messages: [...],
    errors: [...],
    durationMs: 123
};
```

The visual tab only determines which part is displayed.

## 9.5 Automatic selection

Recommended behavior:

```text
Successful SELECT
    -> Result active

Execution error
    -> Message active

DDL / informational execution
    -> Message active when appropriate

Manual click
    -> Respect the user's current selection
```

Do not repeatedly force the active tab while a component re-renders.

---

# 10. Requirement 5 — Resizable Object Explorer sidebar

## 10.1 Objective

Make the left Object Explorer horizontally resizable.

Conceptual layout:

```text
Object Explorer | Editor
                ^
             drag here
```

## 10.2 Width model

Maintain:

```text
minimum width
current width
default width
maximum width
last expanded width
```

The exact numbers should follow the existing UI dimensions when already established.

A reasonable target range for desktop usage is approximately:

```text
min: 240px
default: 300px
max: 600px
```

but **do not blindly overwrite existing product dimensions**.

## 10.3 Drag behavior

Dragging right:

```text
sidebar wider
```

Dragging left:

```text
sidebar narrower
```

Use a dedicated drag handle:

```html
<div class="ide-sidebar-resizer"></div>
```

Do not use the entire sidebar as the drag target.

## 10.4 Use pointer events

Prefer:

```javascript
pointerdown
pointermove
pointerup
```

rather than a mouse-only implementation.

During dragging:

- avoid text selection;
- avoid accidental tree-node activation;
- update layout state efficiently;
- avoid unnecessary re-rendering.

## 10.5 Collapse at minimum boundary

When the user drags to the defined collapse threshold, the Object Explorer should enter a collapsed state.

Example:

```text
+----+
|  > |
+----+
```

Show a reopen button.

## 10.6 Reopen behavior

When reopened, restore the last useful expanded width.

Example:

```text
lastWidth = 360px

collapse

reopen
    -> 360px
```

Do not return to an arbitrary hard-coded width if the previous width is known.

## 10.7 Editor protection

Sidebar resizing must never reduce the editor below its minimum usable width.

The layout must calculate constraints from the available viewport instead of letting panels overlap or produce a zero-width editor.

## 10.8 Persistence

Persist the user's width/collapse preference using the existing settings mechanism when appropriate.

Do not create a second unrelated storage strategy.

---

# 11. Requirement 6 — Object Explorer filters

## 11.1 Where filters belong

Add filter actions to database object groups where filtering is useful.

Examples:

```text
Tables                  [filter]
Views                   [filter]
Stored Procedures       [filter]
Functions               [filter]
```

Do not add a filter icon to every node by default.

## 11.2 Filter icon behavior

The filter action must:

- be visually secondary to the group label;
- not interfere with expand/collapse;
- not accidentally select the group;
- have tooltip/title;
- have an accessible label;
- follow the current theme.

Use the centralized project icon mapping.

## 11.3 Filter modal

Clicking the filter icon opens a modal dedicated to the selected object group.

Example:

```text
+--------------------------------------+
| Filter Tables                    X   |
+--------------------------------------+
| Name contains                        |
| [______________________________]     |
|                                      |
| Schema                               |
| [______________________________]     |
|                                      |
| Other relevant criteria              |
| [______________________________]     |
|                                      |
|                 [Cancel] [Apply]     |
+--------------------------------------+
```

The exact fields are object-type aware. Do not show irrelevant fields for every object type.

## 11.4 Filter state scope

Filter state must be scoped by database context.

Recommended conceptual model:

```javascript
{
    connectionId: "conn_01",
    database: "Bravo10Setup",
    schema: "dbo",
    objectType: "table",
    search: "customer"
}
```

The exact state shape must fit the existing state store.

A filter in:

```text
Connection A / DB_A / Tables
```

must not affect:

```text
Connection B / DB_B / Tables
```

## 11.5 Apply / Cancel / Reset

The modal must support:

```text
Apply
Cancel
Clear/Reset
```

Apply should:

1. store the filter;
2. update the visible object collection;
3. preserve expansion where possible;
4. visually indicate that filtering is active.

Reset should return to the unfiltered state.

## 11.6 Client vs server filtering

If the relevant object collection is already loaded and small:

```text
local filtering is acceptable
```

If the collection is large or lazy-loaded:

```text
query/filter through the existing metadata API
```

Do not load tens of thousands of database objects solely to filter them in the browser.

Use existing metadata cache and lazy loading.

---

# 12. Requirement 7 — SSMS-like Object Context Menu

## 12.1 Global rule

For relevant Object Explorer nodes, suppress the browser's default context menu and display the IDE's context menu.

Intercept:

```javascript
contextmenu
```

Only in the relevant IDE scope.

## 12.2 Concept source

The visual and interaction reference is:

```text
_concept/Object_Menu
```

Before implementing:

- inspect all relevant files/images there;
- identify menu hierarchy;
- identify separators;
- identify icons;
- identify disabled/available actions;
- identify submenu patterns;
- identify ordering.

Do not replace that visual language with a generic Bootstrap dropdown.

## 12.3 Object-aware menus

Menus must differ by object type.

At minimum distinguish where applicable:

```text
Connection
Server
Database
Schema
Table
View
Stored Procedure
Function
Sequence
Column
Object group
```

Only expose commands that are meaningful and actually supported.

## 12.4 Menu registry

Do not implement the entire menu with a massive nested `if/else` block.

Use the existing command architecture or create a small registry if none exists.

Conceptual model:

```javascript
const objectMenuRegistry = {
    table: [...],
    view: [...],
    procedure: [...],
    function: [...],
    database: [...]
};
```

A menu item can conceptually contain:

```javascript
{
    id,
    label,
    icon,
    shortcut,
    separatorBefore,
    disabled,
    danger,
    visible,
    action
}
```

The exact implementation must follow the current project architecture.

## 12.5 Example table actions

Typical SSMS-like actions may include:

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

The **exact order and wording should follow `_concept/Object_Menu`**.

## 12.6 Example procedure actions

Typical structure:

```text
Execute
Script CREATE
Script ALTER
Modify
View Definition
Dependencies
Refresh
Drop
```

Again, concepts have priority over a generic template.

## 12.7 Database actions

Typical structure:

```text
New Query
Refresh
Properties
...
```

Do not display fake actions merely to make the menu look full.

## 12.8 Visual behavior

Context menus should feel like native IDE menus:

- compact rows;
- icon + label;
- separators;
- hover state;
- disabled state;
- active theme;
- keyboard navigation;
- submenu support where required;
- viewport collision handling;
- predictable focus.

Do not let a menu render underneath the editor, modal, or other blocking layer.

Use a deliberate z-index hierarchy.

## 12.9 Viewport-aware positioning

The menu should initially open near the pointer.

Before final placement, calculate available space.

Conceptual constraint:

```text
x + menuWidth <= viewportWidth
y + menuHeight <= viewportHeight
```

If it would overflow, shift it into the viewport.

## 12.10 Keyboard interaction

Support where practical:

```text
Arrow Up
Arrow Down
Enter
Esc
```

Esc must close the menu.

Focus should move predictably and not leak to unrelated controls.

## 12.11 Destructive actions

Commands such as:

```text
DROP
DELETE
TRUNCATE
```

must require confirmation.

Never put destructive actions as the default/first action.

The context menu is a UI command surface, not a bypass around existing backend safety rules.

---

# 13. Centralized UI state

These UI features must integrate into the existing state architecture.

If no equivalent state exists, a structure conceptually similar to the following is acceptable:

```javascript
const uiState = {
    theme: "dark",

    sidebar: {
        width: 300,
        collapsed: false,
        lastWidth: 300
    },

    resultPanel: {
        activeView: "result",
        columnWidths: {}
    },

    explorer: {
        filters: {}
    },

    contextMenu: {
        visible: false,
        object: null,
        x: 0,
        y: 0
    }
};
```

**Do not introduce this exact object if the application already has a suitable store. Extend the existing store instead.**

UI state must not become a hidden replacement for database/session state.

---

# 14. Component boundaries

Prefer small, composable UI modules.

Reasonable modules may include:

```text
ui/theme.js
ui/action-bar.js
ui/results.js
ui/sidebar.js
ui/explorer-filter.js
ui/context-menu.js
```

These names are examples only. Match the existing project structure.

Do not create one giant `ui.js` that owns all seven features.

Keep responsibilities separated:

```text
Theme           -> appearance state
Action bar      -> active query context/actions
Results         -> result rendering + column sizing
Sidebar         -> layout state/resizing
Explorer filter -> filter UI/state
Context menu    -> command presentation/dispatch
```

---

# 15. CSS architecture

Use existing CSS organization where possible.

If the current project already has component-level CSS, extend it instead of restructuring unrelated code.

Suitable component styles may include:

```text
app.css
themes.css
explorer.css
editor.css
results.css
action-bar.css
context-menu.css
modals.css
```

## Naming

Required class:

```text
ide-action-bar
```

Related names should follow the project's convention. Possible names:

```text
ide-context-group
ide-context-item
ide-action-group
ide-action-btn
ide-sidebar-resizer
ide-sidebar-reopen
ide-object-filter
ide-context-menu
ide-context-menu-item
ide-result-grid
ide-result-column-resizer
```

Avoid collision-prone generic names such as:

```text
.menu
.toolbar
.active
.container
```

when a component-specific class is more appropriate.

---

# 16. Accessibility

Every new interactive control should support:

- keyboard focus;
- visible focus state;
- `aria-label` for icon-only controls;
- tooltip/title where useful;
- Enter/Space activation;
- Esc to dismiss menus/modals;
- keyboard navigation for menus where practical.

Example:

```html
<button
    class="ide-object-filter"
    aria-label="Filter tables"
    title="Filter tables">
</button>
```

The reopen control should also be accessible:

```html
<button
    class="ide-sidebar-reopen"
    aria-label="Open Object Explorer"
    title="Open Object Explorer">
</button>
```

---

# 17. Event handling rules

Use event delegation for dynamic Object Explorer content where appropriate.

Example:

```javascript
explorerRoot.addEventListener("contextmenu", handleExplorerContextMenu);
```

Avoid attaching hundreds of listeners to dynamically generated nodes when delegation is appropriate.

Be careful with event propagation:

```text
filter click
    != object selection

filter click
    != tree expansion

contextmenu
    != browser default menu
```

When preventing default browser behavior, restrict it to the relevant IDE region rather than globally disabling right-click on the entire page unless product requirements explicitly demand it.

---

# 18. Persistence rules

UI preferences should use the existing settings infrastructure.

Candidates for persistence include:

```text
theme
sidebar width
sidebar collapsed state
result column widths (only if product behavior warrants it)
object filters (only if product behavior warrants it)
```

Do not persist transient execution state as a user setting.

Do not put database passwords or secrets in browser storage.

---

# 19. Performance rules

These features must remain responsive when:

- many database connections are open;
- the Object Explorer contains many objects;
- multiple tabs are open;
- result sets are large;
- the user frequently filters or resizes the UI.

Use:

```text
debouncing where text filtering is involved
lazy loading
metadata caching
virtualized result grids where necessary
incremental rendering
request cancellation where supported
```

Avoid:

```text
re-render entire explorer on every keystroke
rebuild result DOM unnecessarily during column dragging
query database on every single filter character without debounce
synchronous blocking work in the browser main thread
```

For column dragging, update layout efficiently and avoid expensive full-grid rerenders on every pointer movement if the grid supports more efficient APIs.

---

# 20. Testing requirements

Every significant UI defect fixed in this session should have a repeatable test or manual QA scenario.

## Theme

- [ ] Dark → Light works.
- [ ] Light → Dark works.
- [ ] Theme persists after reload.
- [ ] Editor theme updates.
- [ ] Result/Message remains readable.
- [ ] Context menu follows theme.
- [ ] Modal follows theme.

## Action bar

- [ ] `.ide-action-bar` exists.
- [ ] Connection shown.
- [ ] Database shown.
- [ ] Schema shown.
- [ ] Run SQL is in the action bar.
- [ ] Execution Plan action exists.
- [ ] Switching tabs updates context values.
- [ ] Run SQL uses the active tab's target.
- [ ] Execution Plan uses the active tab's target.

## Result

- [ ] Mock data renders.
- [ ] Real results render.
- [ ] Zero-row SELECT renders column headers.
- [ ] Column widths can be resized.
- [ ] Header/body stay aligned.
- [ ] Horizontal scroll works.
- [ ] Result state survives switching to Message.

## Result / Message

- [ ] Result tab is clickable.
- [ ] Message tab is clickable.
- [ ] Switching does not clear inactive state.
- [ ] Errors can be inspected in Message.
- [ ] Successful SELECT returns to Result by default when appropriate.

## Sidebar

- [ ] Sidebar is horizontally resizable.
- [ ] Minimum width is enforced.
- [ ] Maximum width is enforced.
- [ ] Editor retains a usable width.
- [ ] Collapse state appears at threshold.
- [ ] Reopen button is visible.
- [ ] Reopen restores previous expanded width.

## Object filters

- [ ] Filter icons appear on intended object groups.
- [ ] Filter modal opens.
- [ ] Apply works.
- [ ] Cancel works.
- [ ] Reset works.
- [ ] Active filter is indicated.
- [ ] Filter scope is isolated by database context.

## Context menus

- [ ] Browser default menu is suppressed in Object Explorer.
- [ ] Correct menu appears for each object type.
- [ ] `_concept/Object_Menu` is followed.
- [ ] Menu is viewport-aware.
- [ ] Icons display correctly.
- [ ] Keyboard navigation works.
- [ ] Esc closes menu.
- [ ] Destructive actions require confirmation.

---

# 21. Manual QA scenarios

## Scenario A — Theme switching

1. Open the IDE.
2. Start in Dark.
3. Switch to Light.
4. Inspect every major panel.
5. Switch back to Dark.
6. Reload the application.
7. Confirm the selected theme persists.

## Scenario B — Action-bar tab isolation

Create:

```text
Tab A -> SQL Server / DB_A / dbo
Tab B -> PostgreSQL / DB_B / public
```

Switch repeatedly between the tabs.

Expected:

```text
Tab A -> action bar shows A
Tab B -> action bar shows B
```

Execute from both tabs and confirm the target remains isolated.

## Scenario C — Zero-row SELECT

Run:

```sql
SELECT
    1 AS Id,
    'ABC' AS Code
WHERE 1 = 0;
```

Expected grid:

```text
Id | Code
---+-----
```

No data rows should appear, but both headers must remain visible.

## Scenario D — Result/Message switching

1. Execute a successful SELECT.
2. Open Message.
3. Return to Result.
4. Trigger a query error.
5. Inspect Message.
6. Return to Result.

Neither view should lose its state unexpectedly.

## Scenario E — Sidebar resizing

1. Drag sidebar wider.
2. Drag sidebar narrower.
3. Reach the collapse threshold.
4. Confirm the reopen button appears.
5. Click reopen.
6. Confirm the previous useful width returns.

## Scenario F — Object filter

1. Expand Tables.
2. Click the filter icon.
3. Enter a filter value.
4. Apply.
5. Confirm matching objects only.
6. Reset.
7. Confirm the full object list returns.

## Scenario G — Object context menus

1. Right-click a table.
2. Verify table-specific commands.
3. Right-click a stored procedure.
4. Verify procedure-specific commands.
5. Right-click a database.
6. Verify database-specific commands.
7. Confirm the browser menu never appears in the relevant Object Explorer area.

---

# 22. Common mistakes to avoid

## Mistake 1 — Only changing `body` for themes

A single background rule is not a theme system.

Fix all component surfaces through theme tokens.

## Mistake 2 — Using the first result row to determine columns

This breaks immediately for zero-row results.

Keep:

```text
columns
rows
```

as separate data structures.

## Mistake 3 — Switching Result/Message only with CSS

Visual hiding without state management often causes stale or inaccessible panels.

Use an explicit active-view state.

## Mistake 4 — Creating a second global connection state for the action bar

The action bar must reflect the active tab's existing state.

## Mistake 5 — Resizing the editor directly

The sidebar owns sidebar width. The layout owns the resulting editor width.

Avoid multiple competing width calculations.

## Mistake 6 — Making filter state global

A filter in one connection/database must not change another connection/database.

## Mistake 7 — Generic context menu for everything

Object commands must depend on object type and concept design.

## Mistake 8 — Browser context menu leaks through

Suppress it in the appropriate Object Explorer scope.

## Mistake 9 — Mock result data is mistaken for real database data

Keep demo data behind an explicit mock/demo path.

## Mistake 10 — UI work quietly breaks session isolation

Every action that executes something must continue to respect:

```text
tab_id -> connection_id -> database/schema
```

---

# 23. Recommended implementation order for today's session

Do not implement all requirements simultaneously.

### Phase 1 — Inspect

- Inspect project structure.
- Inspect `general.md`.
- Inspect existing UI/state modules.
- Inspect current defects.
- Inspect `_concept/Object_Menu`.

### Phase 2 — Theme + action bar

- Repair theme architecture.
- Verify editor synchronization.
- Add `ide-action-bar`.
- Move Run SQL.
- Add Execution Plan control.
- Verify tab isolation.

### Phase 3 — Results

- Define explicit result metadata contract.
- Add deterministic mock result.
- Fix zero-row column rendering.
- Add column resizing.
- Fix Result/Message state switching.

### Phase 4 — Object Explorer layout

- Add sidebar resizer.
- Add minimum/maximum constraints.
- Add collapse state.
- Add reopen control.
- Persist width where appropriate.

### Phase 5 — Object filters

- Add filter actions.
- Add modal.
- Add scoped filter state.
- Add Apply/Reset behavior.
- Verify lazy-loading behavior.

### Phase 6 — Context menus

- Read concept files.
- Build/extend command registry.
- Implement object-specific menus.
- Add keyboard navigation.
- Add viewport-aware placement.
- Add destructive-action confirmation.

### Phase 7 — Regression pass

Run the complete checklist and the existing project tests.

---

# 24. Definition of done

This specialized UI session is complete only when:

1. Light/dark switching works across the entire application.
2. `.ide-action-bar` exists with connection, database, schema, Run SQL, and Execution Plan.
3. The action bar follows active query-tab state.
4. Run SQL remains correctly bound to the active tab/session.
5. Result mock data renders.
6. Zero-row SELECT statements still show their columns.
7. Result columns are horizontally resizable.
8. Result and Message views switch reliably.
9. Sidebar width is resizable.
10. Sidebar can collapse and reopen.
11. Previous sidebar width is restored when reopening.
12. Filter icons appear on intended database object groups.
13. Filter modal Apply/Cancel/Reset works.
14. Filter state is scoped correctly.
15. Object-specific custom context menus work.
16. `_concept/Object_Menu` is respected.
17. Browser default menu is suppressed where required.
18. Dangerous object actions require confirmation.
19. Existing connection/session/tab behavior does not regress.
20. No duplicate global architecture is introduced.
21. UI remains responsive with realistic object/result counts.
22. Relevant automated or repeatable manual tests have been completed.

---

# 25. Engineering mindset

For this session, act as a senior UI engineer working inside an existing database IDE.

Prefer:

```text
Existing architecture > new architecture
Explicit UI state > DOM guessing
CSS variables > scattered hard-coded colors
Per-tab state > global implicit state
Result metadata > first-row inference
Scoped filters > global filters
Reusable command registry > giant if/else
Pointer events > mouse-only resizing
Real backend state > fake success state
Concept consistency > random redesign
Functional UX > screenshot imitation
Root-cause fixes > cosmetic workarounds
```

When a requirement reveals a deeper architectural problem, identify it and correct the underlying issue instead of layering a temporary UI workaround on top.

The goal is to make the IDE **coherent, predictable, performant, and desktop-grade** while preserving the database/session architecture defined by `general.md`.
