# Design Table

## 1. Goal

Add a new **Design Table** action to the **Object Explore** context menu when the selected object is a table.

The action opens a table-design workspace where users can inspect and modify the structure of the selected table. The design experience must be database-aware and must support **SQL Server** and **PostgreSQL** as the initial database engines.

The implementation must follow the existing product UI conventions, component conventions, interaction patterns, and screen references defined by the project.

---

## 2. Entry Point

### Object Explore context menu

When the user opens the context menu for a **Table** object in Object Explore:

- Add a menu item named **Design Table**.
- The action is available only for table objects.
- Selecting **Design Table** opens the table-design workspace for the selected table.
- The selected database connection, database/schema, and table identity must be preserved in the opened workspace.

Do not change the behavior of existing context-menu actions.

---

## 3. Design Table Workspace

The workspace is organized into tabs. Each tab represents one part of the table definition.

### Tab order

The tabs must appear in this order:

1. **Fields**
2. **Indexes**
3. **Foreign Keys**
4. **Uniques**
5. **Checks**
6. **Trigger**
7. **SQL Preview**

The following tabs/features are explicitly out of scope for this implementation:

- Options — temporary skip
- Storage — temporary skip
- Comment — do not implement

Do not invent additional tabs unless required by the existing product framework.

---

## 4. Screen References

The screen designs are stored under:

`_concept/Context_menu`

The filename suffix identifies the target screen/state.

Examples:

- `*_field.png` → Fields screen
- `*_index.png` → Indexes screen
- `*_foreignkeys.png` → Foreign Keys screen
- `*_uniquekey.png` → Uniques screen
- `*_check.png` → Checks screen
- `*_trigger.png` → Trigger screen

Use the corresponding reference image as the visual source of truth for the target screen layout, controls, spacing, hierarchy, and interaction intent.

The implementation must preserve the existing application's visual language rather than introducing a new design system.

---

## 5. Database Support

The feature must be database-aware.

Initial database targets:

- **SQL Server**
- **PostgreSQL**

The structure, metadata, validation rules, editable properties, generated SQL, and supported data types must be determined from the selected database engine.

### Reference documentation

For column metadata, data types, and database-specific table structure, the implementation must consult:

`.skill/general.md`

Specifically use:

`# 37. Reference documentation`

Do not duplicate the reference documentation into this skill. Treat `general.md` as the authoritative project reference for supported SQL Server and PostgreSQL types/structure.

Do not assume that a SQL Server feature has an equivalent PostgreSQL representation, or vice versa. Where behavior differs, the UI and generated SQL must follow the target database engine.

---

## 6. Fields Tab

### Purpose

Display and edit the columns of the selected table.

### Required information

Each field/column should expose, as applicable to the database engine:

- Column name
- Data type
- Size/length/precision/scale where applicable
- Description
- Nullability
- Default value
- Identity/auto-increment behavior where applicable
- Primary-key participation where supported by the current design model
- Other database-specific column properties defined by the project's reference documentation

At minimum, the visible table must support the user requirement:

- Column list
- Data type
- Size
- Description

### Behavior

Users must be able to:

- Add a column
- Edit a column
- Delete a column
- Reorder columns when supported by the existing UI/model
- Cancel an edit before saving

The toolbar for the Fields tab must follow the provided `*_field.png` reference and may differ from other tabs.

Validation must be database-specific.

Examples of validation concerns:

- Valid identifier/name
- Required properties for the selected data type
- Valid size/precision/scale
- Valid default expression/value
- Nullable constraints
- Database-specific identity/auto-increment rules

Do not hard-code one database's type list for all databases.

---

## 7. Indexes Tab

### Purpose

Display and manage indexes belonging to the table.

### Required information

The UI should support the metadata appropriate to the selected database, including where applicable:

- Index name
- Indexed columns and order
- Ascending/descending order
- Uniqueness
- Included columns where supported
- Filter/predicate where supported
- Other database-specific index options defined in the reference documentation

### Behavior

Users must be able to:

- Add an index
- Edit an index
- Delete an index
- Configure index columns/order
- Configure database-specific index properties

The toolbar and actions must follow the `*_index.png` reference.

The UI must not display options that are unsupported by the current database engine.

---

## 8. Foreign Keys Tab

### Purpose

Display and manage foreign-key constraints for the selected table.

### Required information

Where applicable, expose:

- Constraint name
- Local column(s)
- Referenced schema/table
- Referenced column(s)
- On Delete behavior
- On Update behavior
- Database-specific options

### Behavior

Users must be able to:

- Add a foreign key
- Edit a foreign key
- Delete a foreign key
- Select the referenced table and columns
- Configure supported referential actions

The toolbar and interaction model must follow the `*_foreignkeys.png` reference.

Validation must ensure that local and referenced column mappings are valid for the selected database.

---

## 9. Uniques Tab

### Purpose

Display and manage unique constraints/unique keys for the selected table.

### Required information

Where applicable, expose:

- Constraint/key name
- Columns
- Column order where supported
- Database-specific properties

### Behavior

Users must be able to:

- Add a unique constraint/key
- Edit it
- Delete it
- Select one or more columns

The implementation must distinguish unique constraints from ordinary indexes according to the target database model.

Use the `*_uniquekey.png` reference for the screen and toolbar behavior.

---

## 10. Checks Tab

### Purpose

Display and manage CHECK constraints for the selected table.

### Required information

Where applicable, expose:

- Constraint name
- Check expression/condition
- Description or related metadata if defined by the project UI

### Behavior

Users must be able to:

- Add a check constraint
- Edit a check constraint
- Delete a check constraint
- Edit the SQL/check expression directly where appropriate

Use the `*_check.png` reference for layout, toolbar, and actions.

Validation should identify obvious invalid or empty expressions before save where possible, but must not rewrite valid database-specific expressions merely to fit a generic SQL grammar.

---

## 11. Trigger Tab

### Purpose

Display and manage triggers associated with the selected table.

### Required information

Where applicable, expose:

- Trigger name
- Enabled/disabled state where supported
- Timing/event information
- Trigger type/category
- Other database-specific trigger metadata

### Definition sub-tab

The Trigger area must include a **Definition** tab/panel that displays the SQL definition of the selected trigger.

The Definition view must:

- Display the trigger SQL clearly
- Preserve database-specific SQL syntax
- Use the application's existing SQL/editor component where available
- Support editing when the project design/reference allows trigger definition editing
- Clearly distinguish trigger metadata from trigger SQL definition

Use the `*_trigger.png` reference as the primary screen reference.

The trigger implementation must account for differences between SQL Server and PostgreSQL trigger architecture and syntax.

---

## 12. SQL Preview Tab

### Purpose

Show the SQL script that creates/recreates the table based on the current design state.

The SQL Preview must be generated for the selected database engine.

### Requirements

The preview should include, as applicable:

- CREATE TABLE statement
- Column definitions
- Primary key definitions
- Unique constraints
- Foreign keys
- Check constraints
- Relevant indexes when they are represented as separate CREATE statements
- Relevant triggers when part of the table-design output
- Database-specific supporting statements required to represent the designed structure

The generated SQL must use the target engine's valid syntax.

The preview is read-only unless the existing application convention explicitly provides another behavior.

Use the existing SQL editor/viewer component when available.

---

## 13. Toolbar Rules

The top toolbar is **tab-specific**.

Do not create one universal toolbar containing every action.

Each tab must expose only actions relevant to that tab.

Examples of possible action categories:

- Add
- Edit
- Delete
- Move up/down or reorder where supported
- Refresh/reload
- Enable/disable where applicable
- Generate/preview SQL where applicable

The exact control set, labels, iconography, placement, and grouping must follow the corresponding reference image and existing application conventions.

Toolbar actions must operate on the current selection/state and must not silently persist destructive changes.

---

## 14. Change Tracking

The Design Table workspace must track unsaved changes.

Any mutation to the table design creates a dirty/modified state.

Tracked changes include, at minimum:

- Added/edited/deleted columns
- Column order changes
- Added/edited/deleted indexes
- Added/edited/deleted foreign keys
- Added/edited/deleted unique constraints
- Added/edited/deleted check constraints
- Added/edited/deleted triggers
- Trigger definition changes
- Other supported database-specific table properties

The UI must make it clear when there are pending changes.

Do not execute DDL against the database immediately after an individual field edit unless the existing product architecture explicitly requires immediate persistence.

---

## 15. Save Flow and Confirmation

Changes must use an explicit confirmation flow before being persisted to the database.

### Required flow

1. User modifies the table design.
2. The workspace becomes dirty.
3. User chooses the save/apply action.
4. The system computes the required database changes.
5. A confirmation popup is shown.
6. The popup provides a **Compare Script** view before persistence.
7. User reviews the generated change script.
8. User confirms or cancels.
9. Only after confirmation are the changes executed against the database.

### Confirmation popup

The popup must make the following clear:

- Which table will be changed
- Which database/engine is targeted
- That the changes will modify the database schema
- What SQL/DDL will be executed
- Whether any destructive operation is included

### Compare Script

The user must be able to compare:

- Current database definition / current script
- New desired definition / generated script
- The SQL statements required to transform the current state into the new state

The comparison should highlight additions, removals, and modifications using the application's existing diff/editor conventions.

The generated change script must be the actual script that would be executed, not a conceptual summary.

### Confirmation actions

Use clear actions such as:

- **Apply Changes** / equivalent existing product wording
- **Cancel**

Never apply schema changes merely because the user opened the preview or changed tabs.

---

## 16. Destructive Changes

Destructive operations require special care.

Examples include:

- Dropping a column
- Dropping an index
- Dropping a foreign key
- Dropping a unique constraint
- Dropping a check constraint
- Dropping a trigger
- Changing a definition in a way that causes data loss or incompatible schema changes

When a generated migration contains destructive statements, the confirmation UI must make them clearly visible in the Compare Script.

Do not silently convert a destructive change into a non-destructive one.

Do not silently drop and recreate objects when a direct ALTER operation is available unless required by the database engine.

---

## 17. Refresh and Concurrency

The implementation should account for the possibility that the database schema changed outside the current Design Table session.

Before applying changes, validate that the current database object still exists and, where supported by the application architecture, verify that the source definition used to build the pending diff has not become stale.

If the database has changed in a way that makes the pending migration unsafe:

- Do not blindly execute the old script.
- Show an appropriate error/conflict message.
- Allow the user to refresh/reload the current database definition.

---

## 18. Database-Specific SQL Generation

All SQL generation must be delegated through a database-aware schema/DDL generation layer rather than assembling engine-specific SQL directly in UI components.

The architecture should conceptually separate:

- Table metadata model
- Database-specific capabilities
- Schema introspection/loading
- User edits
- Change/diff calculation
- DDL generation
- UI presentation

The UI should consume a normalized design model while preserving engine-specific properties needed to round-trip the schema accurately.

Do not assume identical syntax for SQL Server and PostgreSQL.

Examples of areas requiring engine-specific handling include:

- Identifier quoting
- Data types
- Auto-generated identity/sequence behavior
- Default expressions
- Index definitions
- Filter/partial indexes
- Foreign-key actions
- Constraint syntax
- Trigger syntax and trigger function relationships
- ALTER TABLE capabilities
- Object qualification/schema naming

The exact supported feature set must follow `.skill/general.md`, section 37, and the actual capabilities of the selected database engine.

---

## 19. UX and State Management

The Design Table workspace should support:

- Loading state while introspecting the table
- Empty states for object types with no entries
- Error state when schema metadata cannot be loaded
- Validation state for invalid edits
- Dirty state for unsaved changes
- Saving/applying state
- Success state after successful schema update
- Failure state when DDL execution fails

When a save operation fails, do not discard the user's pending design changes automatically.

The user should be able to inspect the error and retry or revise the design.

---

## 20. Navigation and Unsaved Changes

If the user attempts to close the Design Table workspace or navigate away while there are unsaved changes:

- Warn the user that changes have not been saved.
- Provide a way to continue without saving or return to the editor.
- Do not silently discard pending changes.

Follow existing application conventions for unsaved-change dialogs.

---

## 21. Reload Behavior

Provide a reload/refresh behavior where appropriate according to the reference screens.

Reloading the database definition while unsaved changes exist must not silently overwrite the local design state.

The user must explicitly choose how to handle pending changes before a destructive reload/reset.

---

## 22. Accessibility and Usability

Follow the existing application's accessibility conventions.

Controls must:

- Have meaningful labels/tooltips
- Be keyboard accessible where the application framework supports it
- Clearly show selection and focus
- Clearly distinguish enabled/disabled actions
- Provide understandable validation/error messages

Table editors should support efficient keyboard interaction when consistent with the application's existing data-grid patterns.

---

## 23. Performance

Schema introspection and SQL generation should not block the UI unnecessarily.

For larger tables:

- Load metadata efficiently
- Avoid repeated database requests for every row edit
- Batch or cache metadata where appropriate
- Generate preview/diff from the in-memory design model when possible

The UI must remain responsive while generating scripts or calculating changes.

---

## 24. Error Handling

Handle at least these cases:

- Table cannot be found
- Database connection unavailable
- Permission denied for schema inspection
- Unsupported database engine
- Unsupported schema object feature
- Invalid user input
- Generated SQL cannot be produced
- Generated SQL fails during execution
- Concurrent schema modification

Errors should identify the affected operation and, where practical, provide the database error message without exposing implementation details that are not useful to the user.

---

## 25. Acceptance Criteria

The feature is complete when all of the following are true:

1. **Design Table** appears in the Object Explore context menu for tables.
2. Opening it loads the selected table's current schema.
3. The workspace contains the required tabs in the specified order.
4. Options, Storage, and Comment are not implemented.
5. Each implemented tab uses its corresponding `_concept/Context_menu` design reference.
6. Each tab has its own relevant toolbar/actions.
7. Fields support column metadata including name, type, size, and description.
8. Indexes can be viewed and managed according to database capabilities.
9. Foreign keys can be viewed and managed according to database capabilities.
10. Unique constraints/keys can be viewed and managed.
11. Check constraints can be viewed and managed.
12. Triggers can be viewed and managed, including trigger **Definition** SQL.
13. SQL Preview shows database-specific table creation SQL.
14. SQL Server and PostgreSQL are handled as distinct database engines.
15. Database-specific types and structure follow `.skill/general.md` → `# 37. Reference documentation`.
16. Changes remain local until the user explicitly applies them.
17. Applying changes always opens a confirmation popup.
18. The confirmation flow includes a **Compare Script** view.
19. The compare script represents the actual DDL/migration script that will be executed.
20. Destructive changes are clearly visible before execution.
21. Canceling the confirmation leaves the user's pending design intact.
22. Failed database updates do not silently discard pending changes.
23. Unsaved changes are protected when leaving the workspace.
24. Existing product UI conventions are reused instead of introducing unrelated patterns.

---

## 26. Implementation Guidance for Antigravity

When implementing this skill:

1. Inspect the existing Object Explore context-menu implementation and follow its existing extension pattern.
2. Inspect `_concept/Context_menu` and map each relevant filename suffix to the correct screen/state.
3. Inspect `.skill/general.md`, especially **# 37. Reference documentation**, before implementing data-type selectors or database-specific schema behavior.
4. Reuse existing components for tabs, toolbars, data grids, SQL editors, dialogs, confirmation dialogs, and diff viewers where available.
5. Reuse existing database introspection and connection services rather than introducing a second metadata pipeline.
6. Reuse existing schema/DDL generation infrastructure where available; otherwise create a dedicated database-aware service instead of putting SQL generation inside UI components.
7. Keep SQL Server and PostgreSQL behavior explicit and testable.
8. Implement the complete edit → diff → confirmation → apply lifecycle.
9. Verify that the Compare Script is generated from the actual pending schema changes.
10. Add/update tests for UI state, change tracking, SQL generation, and database-specific behavior.

Do not implement Options, Storage, or Comment in this iteration.
