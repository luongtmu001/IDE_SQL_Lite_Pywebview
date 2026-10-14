# KẾ HOẠCH XÂY DỰNG POSTGRESQL DEPENDENCY GRAPH

## 1. Mục tiêu

Xây dựng chức năng trực quan hóa dependency của PostgreSQL dưới dạng **Graph**, cho phép user nhìn thấy quan hệ giữa:

```text
Database
   ↓
Schema
   ↓
Table
   ↓
Column
   ↓
View / Function / Procedure / Trigger / Materialized View / ...
```

Ví dụ khi user chọn:

```text
public.b30_customer.customer_id
```

IDE có thể hiển thị:

```text
                     ┌───────────────┐
                     │ customer_id   │
                     │   COLUMN      │
                     └───────┬───────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
       v_customer       fn_get_customer   trg_customer
          VIEW             FUNCTION          TRIGGER
            │
            ▼
       v_customer_summary
             VIEW
```

Mục tiêu chính:

* Nhìn nhanh Column đang được Object nào sử dụng.
* Nhìn được dependency trực tiếp và gián tiếp.
* Phân biệt dependency chắc chắn và dependency suy đoán.
* Click vào Object để xem Definition.
* Hỗ trợ phân tích impact trước khi sửa Column.
* Là nền tảng để sau này mở rộng thành Dependency Graph cho toàn bộ Database.

---

# 2. Phạm vi thay đổi

## Có thay đổi

```text
PostgreSQL Dependency Service
Dependency Graph Model
Graph Visualization
Dependency Explorer UI
Object Definition Viewer
Graph ↔ Monaco integration
```

## Không thay đổi

```text
Monaco Editor
CodeMirror 6 IntelliSense
SQL execution engine
Existing SQL formatter
Existing SQL syntax check
Existing SQL Server dependency logic
Existing Object Explorer behavior
```

Không được sửa các module trên nếu không liên quan trực tiếp đến việc tích hợp Dependency Graph.

---

# 3. Thư viện / Extension cần sử dụng

## 3.1. D3.js — thư viện chính

Sử dụng:

```text
D3.js
```

Official website:

```text
https://d3js.org/
```

D3 phù hợp vì có sẵn các thành phần cần thiết:

```text
Hierarchy
Tree Layout
Force Simulation
Zoom
Pan
SVG
Node / Link rendering
Expand / Collapse
Interaction
```

D3 cho phép triển khai Graph mà không phụ thuộc vào framework UI.

Đặc biệt phù hợp với project hiện tại vì frontend đang sử dụng:

```text
Bootstrap
Vanilla JavaScript
Monaco
CodeMirror 6
```

Không cần đưa React/Vue vào chỉ để render Dependency Graph.

---

# 4. Không sử dụng Monaco cho Graph

Monaco tiếp tục giữ vai trò:

```text
SQL Editor
Syntax Highlight
IntelliSense
Code Navigation
Format Code
SQL Script Viewer
```

Dependency Graph chỉ tương tác với Monaco khi user:

```text
Click Object
        ↓
Open Definition
        ↓
Monaco Editor
```

Ví dụ:

```text
Graph
  │
  └── v_customer
          │
          ▼
      Click
          │
          ▼
    Open Definition
          │
          ▼
       Monaco
```

---

# 5. Không sử dụng CodeMirror 6 cho Graph

CodeMirror 6 hiện tại chỉ phục vụ:

```text
IntelliSense display
```

Không sử dụng CodeMirror 6 để:

```text
Render Graph
Render Tree
Render Node
Render Dependency Edge
```

Như vậy kiến trúc sẽ rõ ràng:

```text
Monaco
    ↓
SQL Editor

CodeMirror 6
    ↓
IntelliSense UI

D3.js
    ↓
Dependency Graph
```

Ba thành phần không chồng chéo trách nhiệm.

---

# 6. Vì sao chọn D3 thay vì Tree Component thông thường?

Không nên dùng một tree component đơn giản kiểu:

```text
<ul>
  <li>
```

vì dependency thực chất không phải Tree.

Ví dụ:

```text
Column A
   ↓
View A
   ↓
Function A

Column A
   ↓
Function B
```

và:

```text
View A
   ↓
View B
   ↓
View C
```

Một Object có thể có nhiều dependency.

Do đó mô hình dữ liệu thực chất là:

```text
Graph
```

chứ không phải:

```text
Tree
```

---

# 7. Kiến trúc quan trọng: Graph Model trước, Visualization sau

Không xây backend theo kiểu:

```text
PostgreSQL
   ↓
D3 Tree
```

Mà phải xây:

```text
PostgreSQL
      ↓
Dependency Analyzer
      ↓
Dependency Graph Model
      ↓
D3 Visualization
```

Điều này rất quan trọng.

Backend không được biết:

```text
D3
SVG
Tree
Force
```

Backend chỉ trả về Graph Model.

Sau này có thể thay:

```text
D3 Tree
```

bằng:

```text
D3 Force Graph
```

hoặc visualization khác mà không phải viết lại Dependency Engine.

---

# 8. Dependency Graph Model

Backend nên trả dữ liệu dạng:

```json
{
    "root": {
        "id": "column:16452:3",
        "type": "COLUMN",
        "schema": "public",
        "name": "customer_id"
    },
    "nodes": [],
    "edges": []
}
```

---

# 9. Node Model

Mỗi node nên có:

```json
{
    "id": "view:24531",
    "object_type": "VIEW",
    "schema": "public",
    "name": "v_customer",
    "display_name": "public.v_customer",
    "oid": 24531,
    "dependency_type": "DIRECT",
    "confidence": "CONFIRMED",
    "source": "CATALOG",
    "definition_available": true
}
```

Các field chính:

```text
id
oid
object_type
schema
name
display_name
dependency_type
confidence
source
definition_available
```

---

# 10. Object Type

MVP hỗ trợ:

```text
COLUMN
TABLE
VIEW
MATERIALIZED_VIEW
FUNCTION
PROCEDURE
TRIGGER
RULE
CONSTRAINT
SEQUENCE
INDEX
```

Có thể mở rộng sau:

```text
FOREIGN_TABLE
FOREIGN_DATA_WRAPPER
DOMAIN
TYPE
```

Không cần triển khai toàn bộ ngay ở Phase 1.

---

# 11. Edge Model

Quan hệ giữa hai Object:

```json
{
    "source": "column:16452:3",
    "target": "view:24531",
    "relation": "USES_COLUMN",
    "dependency_type": "DIRECT",
    "confidence": "CONFIRMED",
    "source_type": "CATALOG"
}
```

Các relation có thể gồm:

```text
USES_COLUMN
USES_TABLE
REFERENCES_VIEW
CALLS_FUNCTION
USES_SEQUENCE
HAS_TRIGGER
DEPENDS_ON
```

Không hard-code relation vào UI.

---

# 12. Confidence

Graph phải thể hiện mức độ chắc chắn.

Các level:

```text
CONFIRMED
LIKELY
POSSIBLE
UNKNOWN
```

Ví dụ:

```text
CONFIRMED
    PostgreSQL Catalog

LIKELY
    Source Code Analysis

POSSIBLE
    Heuristic Analysis

UNKNOWN
    Dynamic / Runtime dependency
```

---

# 13. Dependency Source

Node/Edge cần có:

```text
CATALOG
SOURCE_ANALYSIS
HEURISTIC
RUNTIME_UNKNOWN
```

Ví dụ:

```text
v_customer
    ✓ CONFIRMED
      PostgreSQL Catalog
```

hoặc:

```text
fn_dynamic_query
    ⚠ POSSIBLE
      Source Code Analysis
```

---

# 14. Graph Root

MVP ưu tiên:

```text
Selected Column
```

Ví dụ:

```text
public.b30_customer.customer_id
```

Graph:

```text
                  customer_id
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
     Views          Functions       Triggers
       │               │
       ▼               ▼
 v_customer       fn_customer
       │
       ▼
v_customer_summary
```

Root luôn nằm ở trung tâm hoặc vị trí bắt đầu của graph.

---

# 15. Hai hướng Dependency

Graph cần hỗ trợ hai hướng:

## 15.1. Dependents

```text
Column
   ↓
Objects using this Column
```

Đây là mode quan trọng nhất cho:

```text
ALTER COLUMN
DROP COLUMN
RENAME COLUMN
```

---

## 15.2. Dependencies

```text
Object
   ↓
Objects that it depends on
```

Ví dụ:

```text
v_customer
    ↓
b30_customer
    ↓
customer_id
```

Sau này có thể thêm toggle:

```text
[ Dependents ] [ Dependencies ]
```

---

# 16. Graph thay vì Tree

UI có thể ban đầu hiển thị giống Tree:

```text
customer_id
 ├── Views
 │    ├── v_customer
 │    └── v_customer_summary
 │
 ├── Functions
 │    └── fn_customer
 │
 └── Triggers
      └── trg_customer
```

Nhưng dữ liệu backend vẫn là:

```text
Graph
```

D3 chỉ tạo một projection:

```text
Graph Model
     ↓
Tree Projection
     ↓
D3
```

Đây là thiết kế quan trọng để tránh phải viết lại backend khi chuyển sang Graph thật.

---

# 17. D3 Visualization

D3 sẽ chịu trách nhiệm:

```text
SVG
Node
Edge
Position
Zoom
Pan
Expand
Collapse
Highlight
Selection
```

Kiến trúc frontend:

```text
DependencyGraphController
          │
          ▼
DependencyGraphModel
          │
          ▼
D3Renderer
          │
          ├── NodeRenderer
          ├── EdgeRenderer
          ├── ZoomController
          └── InteractionController
```

Không để toàn bộ logic vào một file JS.

---

# 18. Node Design

Mỗi node nên có:

```text
[Icon] Object Name
       Object Type
       Schema
```

Ví dụ:

```text
┌──────────────────────────┐
│ ◇ v_customer             │
│   VIEW                   │
│   public                 │
└──────────────────────────┘
```

Column:

```text
┌──────────────────────────┐
│ # customer_id            │
│   COLUMN                 │
│   public.b30_customer    │
└──────────────────────────┘
```

Function:

```text
┌──────────────────────────┐
│ ƒ fn_customer            │
│   FUNCTION               │
│   public                 │
└──────────────────────────┘
```

---

# 19. Node Status

Node cần thể hiện:

```text
DIRECT
INDIRECT
POSSIBLE
```

Ví dụ:

```text
✓ Direct
↳ Indirect
⚠ Possible
```

Không nên chỉ dựa vào màu sắc.

Phải có:

```text
Icon
Label
Tooltip
```

để tránh vấn đề accessibility.

---

# 20. Edge Design

Edge thể hiện:

```text
Column
   │
   │ USES_COLUMN
   ▼
View
```

Edge cần có metadata:

```text
relation
dependency_type
confidence
source
```

Khi user click edge:

```text
Dependency Information
```

hiển thị:

```text
Relation:
USES_COLUMN

Type:
DIRECT

Confidence:
CONFIRMED

Source:
PostgreSQL Catalog
```

---

# 21. Expand / Collapse

Graph ban đầu không nên render toàn bộ database.

Ví dụ:

```text
customer_id
   │
   ├── Views (5)
   ├── Functions (3)
   ├── Triggers (2)
   └── Procedures (1)
```

Click:

```text
Views
```

mới load:

```text
Views
 ├── v_customer
 ├── v_customer_summary
 ├── v_customer_active
 ├── v_customer_report
 └── v_customer_export
```

Điều này giúp graph không bị quá tải.

---

# 22. Lazy Loading

Không nên:

```text
SELECT toàn bộ dependency của database
```

ngay khi mở graph.

MVP:

```text
Root
 ↓
Direct Dependencies
```

Sau khi user mở node:

```text
Node
 ↓
Load next level
```

API có thể:

```text
GET /api/postgresql/dependency/column/{oid}
```

và:

```text
GET /api/postgresql/dependency/object/{oid}/children
```

---

# 23. Zoom / Pan

Graph bắt buộc có:

```text
Zoom In
Zoom Out
Fit to Screen
Reset
Pan
```

Có thể hỗ trợ:

```text
Mouse wheel
Drag canvas
```

D3 đảm nhiệm phần lớn interaction này.

---

# 24. Search trong Graph

Có ô:

```text
Search object...
```

Ví dụ:

```text
customer
```

Graph highlight:

```text
v_customer
v_customer_summary
fn_customer
```

Các node khác giảm emphasis.

Không được xóa node khỏi Graph chỉ vì không match search nếu điều đó làm mất context.

---

# 25. Filter

Cho phép filter:

```text
Object Type

☑ View
☑ Function
☑ Procedure
☑ Trigger
☐ Index
☐ Constraint
```

và:

```text
Dependency

☑ Direct
☑ Indirect
☐ Possible
```

---

# 26. Object Detail Panel

Khi click Object:

```text
Graph
              │
              ▼
       Object Detail
```

Panel hiển thị:

```text
Object:
public.v_customer

Type:
VIEW

Dependency:
Direct

Confidence:
Confirmed

Source:
PostgreSQL Catalog
```

Actions:

```text
Open Definition
Copy Definition
Open in New Tab
```

---

# 27. Open Definition bằng Monaco

Khi user click:

```text
Open Definition
```

Backend gọi:

```text
pg_get_viewdef()
pg_get_functiondef()
pg_get_triggerdef()
pg_get_ruledef()
pg_get_constraintdef()
```

Sau đó:

```text
Definition
    ↓
Monaco
```

Ví dụ:

```sql
CREATE VIEW public.v_customer AS
SELECT
    customer_id,
    customer_name
FROM public.b30_customer;
```

Monaco chỉ dùng để xem/chỉnh sửa SQL.

---

# 28. Read-only mặc định

Dependency Explorer không được tự động execute SQL.

Object Definition mặc định:

```text
Read Only
```

Các action:

```text
Copy SQL
Open in Editor
```

không tự chạy SQL.

---

# 29. Impact Analysis

Graph phải kết hợp với chức năng:

```text
ALTER COLUMN
```

Ví dụ user viết:

```sql
ALTER TABLE public.b30_customer
ALTER COLUMN customer_id TYPE bigint;
```

IDE có thể phát hiện:

```text
Column has dependencies.
```

Sau đó:

```text
[View Impact]
```

mở:

```text
Dependency Graph
```

---

# 30. Suggested Resolution

Graph không tự sửa Database.

Nếu phát hiện:

```text
v_customer
v_customer_summary
fn_customer
```

IDE có thể đưa ra:

```text
Suggested Steps
```

Ví dụ:

```text
1. Review dependent objects.
2. Check whether object definitions require changes.
3. Update incompatible objects if necessary.
4. Validate object definitions.
5. Execute ALTER COLUMN.
6. Revalidate dependencies.
```

SQL chỉ là:

```text
Suggestion
```

Không tự execute.

---

# 31. Dynamic SQL Warning

Nếu source analyzer phát hiện:

```sql
EXECUTE
```

hoặc:

```sql
format(...)
```

Graph có thể hiển thị:

```text
⚠ Runtime dependency may exist
```

Ví dụ:

```text
fn_dynamic_customer
       │
       ⚠
       │
       ▼
customer_id
```

Tooltip:

```text
Possible runtime dependency.

The reference could not be fully resolved
from PostgreSQL dependency metadata.
```

---

# 32. External Dependency Warning

Graph phải có vùng cảnh báo:

```text
External dependencies may not be detected.

Examples:
- Application code
- ETL
- BI tools
- External databases
- Dynamic SQL
```

Không hiển thị:

```text
No dependencies
```

nếu chỉ kiểm tra PostgreSQL Catalog.

Nên hiển thị:

```text
No catalog dependencies found.
```

---

# 33. PostgreSQL Catalog Layer

Backend tiếp tục sử dụng:

```text
pg_depend
pg_rewrite
pg_class
pg_attribute
pg_proc
pg_trigger
pg_constraint
pg_namespace
```

Object definition:

```text
pg_get_viewdef()
pg_get_functiondef()
pg_get_triggerdef()
pg_get_ruledef()
pg_get_constraintdef()
```

Catalog Analyzer là nguồn:

```text
CONFIRMED
```

---

# 34. Source Analyzer

Sau Catalog Analyzer:

```text
Object Definition
       ↓
Source Analyzer
       ↓
Reference Detection
```

Có thể phát hiện:

```text
FROM table
JOIN table
column reference
function call
EXECUTE
dynamic SQL
search_path
```

Kết quả:

```text
LIKELY
POSSIBLE
UNKNOWN
```

Không được biến Source Analyzer thành dependency engine duy nhất.

---

# 35. Kiến trúc tổng thể

```text
                 PostgreSQL
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
   Catalog Analyzer       Definition Loader
          │                       │
          │                       ▼
          │                Source Analyzer
          │                       │
          └───────────┬───────────┘
                      ▼
             Dependency Graph
                   Model
                      │
                      ▼
              Graph Controller
                      │
                      ▼
                  D3.js
                      │
             ┌────────┴────────┐
             │                 │
             ▼                 ▼
        Graph Canvas       Object Panel
                                 │
                                 ▼
                              Monaco
```

---

# 36. Frontend Module Structure

Đề xuất:

```text
static/
└── js/
    └── postgresql/
        └── dependency/
            ├── dependency-api.js
            ├── dependency-model.js
            ├── dependency-graph.js
            ├── dependency-node.js
            ├── dependency-edge.js
            ├── dependency-panel.js
            ├── dependency-filter.js
            └── dependency-controller.js
```

Không nhét code Graph vào:

```text
monaco.js
codemirror.js
editor.js
```

---

# 37. D3 Module

Nếu project có npm/bundler:

```bash
npm install d3
```

Sau đó import các module cần thiết.

Không cần import toàn bộ D3 nếu bundler hỗ trợ tree-shaking.

Ưu tiên:

```text
d3-selection
d3-hierarchy
d3-zoom
d3-shape
d3-scale
```

và các module cần thiết khác.

Nếu project hiện tại chưa sử dụng npm:

> Nên bundle D3 vào project thay vì phụ thuộc CDN runtime.

Đặc biệt với IDE chạy trong:

```text
Internal Network
Offline
Enterprise Environment
PyWebView
```

không nên yêu cầu Internet chỉ để Dependency Graph hoạt động.

---

# 38. Không thêm React chỉ để render Graph

Không cần:

```text
React
React Flow
Vue
Angular
```

cho tính năng này.

Project hiện tại đã có:

```text
Vanilla JS
Bootstrap
```

D3 tích hợp trực tiếp tốt hơn.

---

# 39. Tại sao không chọn React Flow?

React Flow mạnh cho:

```text
Node Editor
Workflow
Interactive Diagram
```

nhưng project hiện tại không sử dụng React.

Nếu đưa React Flow vào chỉ vì Dependency Graph thì sẽ tạo:

```text
New Framework
New Build Pipeline
New State Management
New Component Model
```

không cần thiết.

---

# 40. Tại sao không chọn jsTree?

jsTree phù hợp với:

```text
File Explorer
Object Explorer
Folder Tree
```

nhưng Dependency Explorer có:

```text
Many-to-many relation
Edges
Multiple parents
Dependency direction
Graph traversal
Zoom
Pan
```

Do đó jsTree không phải lựa chọn tốt cho kiến trúc dài hạn.

---

# 41. Tại sao không chọn Mermaid?

Mermaid phù hợp:

```text
Documentation
Markdown
Architecture Diagram
```

nhưng không phù hợp cho:

```text
Interactive Dependency Explorer
Large dynamic graph
Node selection
Lazy loading
Zoom / Pan
Object definition integration
```

Không dùng Mermaid làm renderer chính.

---

# 42. D3 Tree và D3 Force Graph

Nên triển khai theo hai giai đoạn.

## Phase 1 — Tree Projection

Hiển thị:

```text
Column
  ↓
Object Type
  ↓
Object
```

D3:

```text
d3.hierarchy()
d3.tree()
```

Mục tiêu:

```text
Dễ đọc
Dễ triển khai
Dễ kiểm tra dependency
```

---

## Phase 2 — True Graph

Khi dependency có quan hệ phức tạp:

```text
A → B
A → C
B → D
C → D
```

Tree sẽ phải duplicate:

```text
A
├── B
│   └── D
└── C
    └── D
```

Trong trường hợp này chuyển sang:

```text
D3 Force Graph
```

để giữ đúng:

```text
D
```

là một node duy nhất.

---

# 43. Chiến lược chuyển Tree → Graph

Backend không thay đổi:

```text
DependencyGraphModel
```

Chỉ thay renderer:

```text
Phase 1

Graph Model
    ↓
Tree Projection
    ↓
D3 Tree
```

sau này:

```text
Graph Model
    ↓
D3 Force Simulation
    ↓
True Dependency Graph
```

Đây là lý do bắt buộc phải thiết kế Backend theo Graph Model ngay từ đầu.

---

# 44. Performance

Không render:

```text
1000+ nodes
```

ngay lập tức nếu không cần thiết.

Ưu tiên:

```text
Lazy Loading
Expand / Collapse
Depth Limit
Filter
Search
```

MVP sử dụng:

```text
SVG
```

với D3.

Chỉ chuyển sang:

```text
Canvas
WebGL
```

nếu benchmark thực tế chứng minh SVG không đáp ứng.

Không tối ưu quá sớm.

---

# 45. Graph Depth

Cho phép:

```text
Depth: 1
Depth: 2
Depth: 3
All
```

Ví dụ:

```text
Depth 1

customer_id
   ├── v_customer
   ├── fn_customer
   └── trg_customer
```

Depth 2:

```text
customer_id
   ↓
v_customer
   ↓
v_customer_summary
```

Điều này đặc biệt hữu ích với Database lớn.

---

# 46. Toolbar

Dependency Graph toolbar:

```text
[Refresh]

[Zoom +]
[Zoom -]
[Fit]

[Search...]

[Depth ▼]

[Filter ▼]

[Dependents]
[Dependencies]
```

Không đưa quá nhiều action vào toolbar giai đoạn đầu.

---

# 47. Context Menu

Click phải Node:

```text
Open Definition
Open in New Tab
Copy Object Name
Copy SQL
Find Dependencies
Find Dependents
```

Nếu là Column:

```text
Find Dependencies
Find Impact
```

---

# 48. Selection Flow

Flow chuẩn:

```text
Object Explorer
      │
      │ Right Click Column
      ▼
Find Dependencies
      │
      ▼
Dependency Graph
      │
      ▼
Select Object
      │
      ▼
Object Detail
      │
      ▼
Open Definition
      │
      ▼
Monaco
```

---

# 49. Refresh

Graph phải có:

```text
Refresh
```

Khi user:

```text
CREATE VIEW
ALTER VIEW
DROP VIEW
ALTER FUNCTION
```

Graph cũ không được coi là dữ liệu vĩnh viễn.

Refresh sẽ:

```text
Clear Model
      ↓
Query Catalog
      ↓
Rebuild Graph
      ↓
Render
```

---

# 50. Cache

Không nên cache dependency quá lâu.

Có thể cache theo:

```text
Database Connection
Schema
Object OID
Timestamp
```

Nhưng sau các thao tác DDL quan trọng:

```text
CREATE
ALTER
DROP
RENAME
```

phải invalidate cache liên quan.

---

# 51. Error Handling

Nếu PostgreSQL không trả được dependency:

```text
Dependency analysis failed.
```

Không được hiển thị:

```text
No dependency
```

Hai trạng thái phải khác nhau:

```text
No dependency found
```

và:

```text
Unable to analyze dependency
```

---

# 52. Security

Dependency Graph chỉ sử dụng quyền user hiện tại.

Không cố:

```text
Bypass PostgreSQL permission
```

Nếu user không đọc được definition:

```text
Definition unavailable
```

Graph vẫn có thể hiển thị Object nếu Catalog cho phép.

---

# 53. Phase triển khai

## Phase 1 — Graph Model

Xây:

```text
DependencyGraphModel
Node
Edge
Confidence
Source
```

Chưa cần UI phức tạp.

---

## Phase 2 — Catalog Analyzer

Implement:

```text
Column → Direct Dependencies
```

dựa trên PostgreSQL Catalog.

Output:

```text
CONFIRMED
```

---

## Phase 3 — D3 Tree

Thêm:

```text
D3.js
SVG
Node
Edge
Zoom
Pan
Expand
Collapse
```

Root:

```text
Column
```

---

## Phase 4 — Object Detail

Click Node:

```text
Object Detail Panel
```

Thêm:

```text
Open Definition
Copy SQL
```

---

## Phase 5 — Monaco Integration

Open Definition:

```text
Dependency Graph
       ↓
Monaco
```

Không thay đổi Monaco core.

---

## Phase 6 — Source Analysis

Bổ sung:

```text
Function Definition
Procedure Definition
View Definition
Trigger Definition
```

phân tích source.

Thêm:

```text
LIKELY
POSSIBLE
UNKNOWN
```

---

## Phase 7 — Impact Analysis

Tích hợp với:

```text
ALTER COLUMN
DROP COLUMN
RENAME COLUMN
ALTER TYPE
```

Hiển thị:

```text
Impact Graph
```

trước khi user thực thi.

---

## Phase 8 — True Graph

Khi Tree không còn phù hợp:

```text
D3 Tree
    ↓
D3 Force Graph
```

Backend không thay đổi.

---

# 54. Acceptance Criteria

## Graph

* [ ] Có thể mở Dependency Graph từ Column.
* [ ] Hiển thị được Direct Dependency.
* [ ] Hiển thị được Indirect Dependency.
* [ ] Có Node và Edge.
* [ ] Có Zoom.
* [ ] Có Pan.
* [ ] Có Expand / Collapse.
* [ ] Có Fit to Screen.
* [ ] Có Search.
* [ ] Có Filter.

## PostgreSQL

* [ ] Sử dụng PostgreSQL Catalog.
* [ ] Dependency dựa trên Object Identity khi có thể.
* [ ] Có Source Analysis.
* [ ] Có Confidence.
* [ ] Phân biệt Catalog và Source Analysis.
* [ ] Có cảnh báo Dynamic SQL.
* [ ] Có cảnh báo External Dependency.

## Editor

* [ ] Click Object mở Definition.
* [ ] Definition mở bằng Monaco.
* [ ] Không ảnh hưởng CodeMirror 6.
* [ ] Không thay đổi IntelliSense.
* [ ] Không tự execute SQL.

## Safety

* [ ] Không tự `DROP ... CASCADE`.
* [ ] Không tự execute Suggested SQL.
* [ ] Không tự sửa Object.
* [ ] Không tuyên bố "No dependency" khi chỉ kiểm tra Catalog.

---

# 55. Kiến trúc cuối cùng

```text
                         PostgreSQL
                              │
                              ▼
                  ┌──────────────────────┐
                  │ Dependency Analyzer  │
                  └──────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
      Catalog Analyzer              Source Analyzer
              │                             │
              │                             │
              └──────────────┬──────────────┘
                             ▼
                  DependencyGraphModel
                             │
                             ▼
                    Graph Controller
                             │
                             ▼
                          D3.js
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
            Node           Edge        Interaction
              │              │              │
              └──────────────┼──────────────┘
                             ▼
                     Object Detail
                             │
                             ▼
                           Monaco
```

---

# 56. Kết luận về Extension

Extension/thư viện chính cần thêm:

```text
D3.js
```

Không cần thay:

```text
Monaco
CodeMirror 6
Bootstrap
Vanilla JS
```

Vai trò cuối cùng:

```text
┌───────────────────┬───────────────────────────┐
│ Component         │ Responsibility            │
├───────────────────┼───────────────────────────┤
│ Monaco            │ SQL Editor / Definition   │
│ CodeMirror 6      │ IntelliSense              │
│ D3.js             │ Dependency Graph          │
│ Bootstrap         │ UI Layout                 │
│ PostgreSQL Catalog│ Dependency Source         │
└───────────────────┴───────────────────────────┘
```

**Khuyến nghị triển khai:** xây `DependencyGraphModel` ngay từ đầu theo mô hình Graph, nhưng renderer Phase 1 dùng **D3 Tree** để dễ đọc. Khi dependency trở nên nhiều-nhiều, chuyển renderer sang **D3 Force Graph** mà không phải thay đổi backend.

Đây là phương án ít ảnh hưởng nhất tới IDE hiện tại và cũng tránh việc biến Monaco/CodeMirror thành những thành phần phải gánh trách nhiệm ngoài chức năng editor của chúng.
