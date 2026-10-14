# PLAN: QUERY FLOW VISUALIZATION — NÂNG CẤP DESIGN VIEW

## 1. MỤC TIÊU

Nâng cấp chức năng Design View hiện tại của IDE SQL Lite để trực quan hóa được các View phức tạp, không chỉ giới hạn ở những truy vấn SELECT/JOIN đơn giản.

Các cấu trúc cần hỗ trợ:

* SELECT.
* INNER JOIN, LEFT JOIN, RIGHT JOIN, FULL JOIN.
* UNION và UNION ALL.
* CTE (`WITH ... AS`).
* Nhiều CTE phụ thuộc lẫn nhau.
* Subquery trong FROM.
* Subquery lồng nhau.
* Derived Table.
* EXISTS và NOT EXISTS.
* Scalar Subquery.
* Các nhánh truy vấn kết hợp nhiều cấp.
* Các biểu thức tổng hợp và GROUP BY.
* Các truy vấn kết hợp nhiều cấu trúc nói trên.

Ngoài việc hiển thị các bảng và quan hệ JOIN, hệ thống cần thể hiện thứ tự xử lý logic của câu query bằng cách đánh số từng node.

### Kết quả mong muốn

Khi mở một View phức tạp, người dùng có thể nhanh chóng xác định:

1. Query được chia thành những thành phần nào.
2. CTE nào được khai báo trước và CTE nào phụ thuộc vào CTE khác.
3. Bảng nào tham gia vào từng nhánh truy vấn.
4. Những bảng nào được JOIN với nhau.
5. Các nhánh UNION ALL được kết hợp ở đâu.
6. Truy vấn con nào tạo dữ liệu đầu vào cho truy vấn bên ngoài.
7. Thứ tự phụ thuộc logic giữa các thành phần.
8. Kết quả cuối cùng được tạo ra từ những nhánh nào.
9. SQL tương ứng với từng node.
10. Những thành phần chưa được parser hỗ trợ đầy đủ.

Không được làm mất hoặc tự ý thay đổi SQL gốc khi chuyển sang Design View.

---

# 2. NGUYÊN TẮC THIẾT KẾ

## 2.1. Phân biệt ba loại thứ tự

Hệ thống phải phân biệt rõ ba khái niệm.

### A. Source Order

Thứ tự các thành phần xuất hiện trong SQL gốc.

Ví dụ:

```sql
WITH CTE_A AS (...),
     CTE_B AS (...)
SELECT ...
```

CTE_A xuất hiện trước CTE_B trong văn bản.

Source Order phục vụ việc điều hướng về SQL gốc, không đại diện cho thứ tự database xử lý.

### B. Logical Processing / Dependency Order

Thứ tự phụ thuộc logic giữa các thành phần của truy vấn.

Ví dụ:

```sql
WITH CTE_A AS (
    SELECT Id, Name
    FROM dbo.Customer
),
CTE_B AS (
    SELECT CustomerId, Amount
    FROM dbo.Sales
)
SELECT
    a.Name,
    b.Amount
FROM CTE_A AS a
INNER JOIN CTE_B AS b
    ON a.Id = b.CustomerId;
```

Mô hình phụ thuộc:

```text
dbo.Customer ──> CTE_A ──┐
                         ├──> Final SELECT
dbo.Sales ─────> CTE_B ──┘
```

Các node có thể được đánh số theo thứ tự phụ thuộc logic để người dùng dễ theo dõi.

### C. Physical Execution Order

Thứ tự thực thi vật lý do database optimizer lựa chọn.

Ví dụ, một câu SQL viết A JOIN B JOIN C không đảm bảo database sẽ đọc và JOIN theo đúng thứ tự văn bản.

Thứ tự vật lý cần lấy từ:

* SQL Server Actual Execution Plan hoặc Estimated Execution Plan.
* PostgreSQL EXPLAIN hoặc EXPLAIN ANALYZE.

Không được dùng thứ tự node trên canvas để tuyên bố đó là thứ tự thực thi vật lý thực tế.

## 2.2. Hai chế độ đánh số

Bổ sung hai chế độ trong giao diện.

**Logical Flow**

* Đánh số các bước theo thứ tự phụ thuộc logic.
* Dựa trên cấu trúc SQL đã phân tích.
* Không yêu cầu thực thi truy vấn.

**Physical Plan**

* Hiển thị execution plan do database cung cấp.
* Đánh số operator theo cấu trúc plan.
* Chỉ bật khi có execution plan hợp lệ.

Nếu chưa có execution plan, giao diện phải ghi rõ đang hiển thị Logical Flow.

---

# 3. KIẾN TRÚC TỔNG THỂ

Mở rộng kiến trúc Design View hiện tại, không xây dựng lại toàn bộ từ đầu.

```text
SQL Editor
    |
    v
SQL Parser
    |
    v
Query AST
    |
    v
Query Flow Analyzer
    |
    v
Query Flow Graph
    |
    +---------------------+
    |                     |
    v                     v
D3.js Graph Renderer   SQL Source Mapping
    |
    v
User Interaction
    |
    +--> Select Node
    +--> View SQL Fragment
    +--> Expand / Collapse
    +--> Navigate to SQL
    +--> Change Visualization Mode
```

### Thành phần mới

#### SQL Parser

Phân tích câu SQL thành AST.

#### Query Flow Analyzer

Phân tích AST để xác định:

* CTE.
* Subquery.
* UNION/UNION ALL.
* Table Source.
* JOIN.
* Aggregate.
* Filter.
* Final SELECT.
* Các mối quan hệ phụ thuộc giữa thành phần truy vấn.

#### Query Flow Graph

Chuyển AST thành mô hình graph trung gian.

#### D3.js Graph Renderer

Hiển thị graph thành các node và edge.

#### SQL Source Mapping

Lưu vị trí tương ứng của từng node trong SQL Editor để có thể điều hướng hai chiều.

---

# 4. XÂY DỰNG QUERY FLOW GRAPH

Không nên tiếp tục mở rộng mô hình chỉ có Table Node và Join Edge để biểu diễn mọi loại truy vấn.

Cần bổ sung mô hình graph tổng quát.

## 4.1. Query Node

Mỗi thành phần truy vấn có các thuộc tính:

* `id`: ID duy nhất.
* `nodeType`: loại node.
* `label`: tên hiển thị.
* `sourceRange`: vị trí bắt đầu/kết thúc trong SQL.
* `sourceOrder`: thứ tự trong văn bản SQL.
* `logicalStep`: số thứ tự hiển thị trong Logical Flow.
* `children`: các node con nếu sử dụng cấu trúc phân cấp.
* `metadata`: thông tin bổ sung.
* `sqlFragment`: đoạn SQL tương ứng.
* `status`: trạng thái phân tích.
* `isExpandable`: có thể mở rộng hay không.

Các loại node tối thiểu:

| Node Type    | Ý nghĩa                                      |
| ------------ | -------------------------------------------- |
| Table        | Bảng vật lý                                  |
| View         | View được tham chiếu                         |
| CTE          | Common Table Expression                      |
| Subquery     | Truy vấn con                                 |
| DerivedTable | Nguồn dữ liệu được tạo bởi SELECT trong FROM |
| Select       | Phép chiếu cột                               |
| Join         | Phép JOIN                                    |
| Filter       | Điều kiện lọc                                |
| Aggregate    | GROUP BY và phép tổng hợp                    |
| Union        | UNION hoặc UNION ALL                         |
| Sort         | ORDER BY                                     |
| Distinct     | Loại bỏ dòng trùng lặp                       |
| FinalResult  | Kết quả cuối                                 |
| Unknown      | Thành phần chưa được hỗ trợ                  |

Có thể gộp một số node ở phiên bản đầu, nhưng không được gộp theo cách làm mất quan hệ phụ thuộc giữa các thành phần.

## 4.2. Query Edge

Mỗi edge có các thuộc tính:

* `id`.
* `sourceNodeId`.
* `targetNodeId`.
* `edgeType`.
* `label`.
* `metadata`.

Các loại edge:

* `data_flow`: truyền dữ liệu giữa các bước.
* `dependency`: thể hiện phụ thuộc.
* `union_branch`: nhánh đầu vào của UNION.
* `cte_reference`: truy vấn tham chiếu đến CTE.
* `subquery_input`: dữ liệu đầu vào từ subquery.
* `join_input`: đầu vào của JOIN.

Cần xác định một quy ước duy nhất về hướng edge.

Đề xuất:

**Edge đi từ nguồn dữ liệu hoặc bước xử lý trước sang bước tiêu thụ dữ liệu tiếp theo.**

Ví dụ:

```text
Table A ──> Filter ──> Join ──> Final SELECT
Table B ─────────────────> Join
```

Quy ước này phải nhất quán trên toàn bộ graph.

---

# 5. HỖ TRỢ CTE

## 5.1. Mục tiêu

Cho phép hiển thị các CTE thành những node riêng biệt, không cố gắng chuyển toàn bộ truy vấn thành một sơ đồ JOIN phẳng.

Ví dụ:

```sql
WITH CustomerCTE AS (
    SELECT Id, Name
    FROM dbo.Customer
),
SalesCTE AS (
    SELECT CustomerId, SUM(Amount) AS TotalAmount
    FROM dbo.Sales
    GROUP BY CustomerId
)
SELECT
    c.Name,
    s.TotalAmount
FROM CustomerCTE AS c
LEFT JOIN SalesCTE AS s
    ON c.Id = s.CustomerId;
```

Graph mong muốn:

```text
[1] dbo.Customer
        |
        v
[2] CustomerCTE

[3] dbo.Sales
        |
        v
[4] GROUP BY / SUM
        |
        v
[5] SalesCTE

[6] JOIN CustomerCTE + SalesCTE
        |
        v
[7] Final SELECT
```

Đây là sơ đồ minh họa thứ tự phụ thuộc logic, không phải execution plan vật lý.

## 5.2. Yêu cầu xử lý

Parser phải xác định:

* Tên CTE.
* Phần SQL định nghĩa CTE.
* Các bảng hoặc CTE được sử dụng bên trong.
* Các cột đầu ra.
* Các CTE được tham chiếu ở phần truy vấn bên ngoài.
* Quan hệ phụ thuộc giữa các CTE.

## 5.3. CTE phụ thuộc lẫn nhau

Ví dụ:

```sql
WITH CTE_A AS (...),
     CTE_B AS (
         SELECT *
         FROM CTE_A
     )
SELECT *
FROM CTE_B;
```

Graph:

```text
[1] Source Tables
       |
       v
[2] CTE_A
       |
       v
[3] CTE_B
       |
       v
[4] Final SELECT
```

Không được đánh số CTE chỉ dựa trên vị trí khai báo nếu cách đó làm sai thứ tự phụ thuộc.

Đối với recursive CTE:

* Nhận diện `WITH RECURSIVE` của PostgreSQL hoặc cú pháp recursive CTE tương ứng của SQL Server.
* Hiển thị node vòng lặp/đệ quy riêng.
* Không cố mở rộng vòng lặp thành vô hạn node.
* Đánh dấu đây là luồng phụ thuộc đệ quy.
* Giữ nguyên anchor member và recursive member.

---

# 6. HỖ TRỢ UNION VÀ UNION ALL

## 6.1. Mục tiêu

Biểu diễn mỗi nhánh SELECT thành một nhánh riêng, sau đó nối vào node UNION.

Ví dụ:

```sql
SELECT Id, Name
FROM dbo.Customer

UNION ALL

SELECT Id, Name
FROM dbo.Supplier;
```

Graph:

```text
[1] dbo.Customer
       |
       v
[2] SELECT Branch 1
       |
       +-------------------+
                           |
                           v
                    [5] UNION ALL
                           |
                           v
                    [6] Final Result
                           ^
                           |
       +-------------------+
       |
[3] dbo.Supplier
       |
       v
[4] SELECT Branch 2
```

Thứ tự node cần được xác định bằng thuật toán layout và quy tắc đánh số nhất quán, không phụ thuộc vào vị trí tọa độ do D3.js tự sắp xếp.

## 6.2. Phân biệt UNION và UNION ALL

Node phải hiển thị chính xác loại phép kết hợp:

* `UNION`: kết hợp kết quả và loại bỏ dòng trùng lặp theo ngữ nghĩa SQL.
* `UNION ALL`: kết hợp kết quả mà không loại bỏ dòng trùng lặp.

Không biểu diễn cả hai bằng một loại node không có thuộc tính phân biệt.

## 6.3. Nhiều nhánh UNION

Hỗ trợ:

```sql
SELECT ...
UNION ALL
SELECT ...
UNION
SELECT ...;
```

Parser phải giữ được thứ tự các nhánh và cấu trúc kết hợp theo AST.

Không tự ý biến chuỗi UNION thành một graph khác làm mất thông tin về toán tử giữa từng nhánh.

## 6.4. UNION kết hợp CTE

Phải hỗ trợ các truy vấn có nhiều lớp:

```sql
WITH BaseData AS (
    SELECT ...
    FROM dbo.TableA
)
SELECT ...
FROM BaseData

UNION ALL

SELECT ...
FROM dbo.TableB;
```

Graph phải thể hiện được:

* Node định nghĩa BaseData.
* Nhánh sử dụng BaseData.
* Nhánh truy vấn độc lập.
* Node UNION ALL.
* Kết quả cuối.

---

# 7. HỖ TRỢ SUBQUERY VÀ DERIVED TABLE

## 7.1. Subquery trong FROM

Ví dụ:

```sql
SELECT x.CustomerId, x.TotalAmount
FROM (
    SELECT
        CustomerId,
        SUM(Amount) AS TotalAmount
    FROM dbo.Sales
    GROUP BY CustomerId
) AS x;
```

Graph:

```text
[1] dbo.Sales
       |
       v
[2] Aggregate
       |
       v
[3] Derived Table: x
       |
       v
[4] Final SELECT
```

Subquery trong FROM phải được biểu diễn như một thành phần dữ liệu trung gian.

## 7.2. Subquery lồng nhau

Nếu subquery chứa một subquery khác:

* Mỗi cấp có node riêng.
* Hiển thị quan hệ cha/con.
* Cho phép thu gọn/mở rộng.
* Không gộp các cấp thành một node duy nhất nếu làm mất thông tin cấu trúc.

## 7.3. EXISTS và NOT EXISTS

Hiển thị node biểu thức phụ thuộc hoặc node Semi Join/Anti Join khi parser có thể xác định ngữ nghĩa tương ứng.

Tuy nhiên, không tự chuyển EXISTS thành JOIN thông thường vì điều đó có thể làm thay đổi số dòng kết quả.

Ở phiên bản đầu, có thể hiển thị:

* Main Query.
* Subquery.
* Correlation Condition.
* EXISTS/NOT EXISTS operator.

## 7.4. Scalar Subquery

Biểu diễn scalar subquery như một nguồn biểu thức phụ thuộc vào truy vấn con.

Không mặc định scalar subquery chỉ trả về một dòng nếu chưa có điều kiện hoặc ngữ cảnh đảm bảo.

---

# 8. THỨ TỰ ĐÁNH SỐ NODE

## 8.1. Mục tiêu

Người dùng cần nhìn vào sơ đồ và hiểu được thứ tự phụ thuộc logic của truy vấn.

Mỗi node có thể hiển thị badge:

```text
[1] Table: Customer
[2] Filter
[3] Table: Sales
[4] Aggregate
[5] CTE: SalesCTE
[6] LEFT JOIN
[7] Final SELECT
```

Đây là ví dụ minh họa. Thứ tự thật phải được tính từ Query Flow Graph.

## 8.2. Thuật toán đánh số

Đề xuất:

1. Xây dựng graph từ AST.
2. Xác định các quan hệ phụ thuộc.
3. Tính thứ tự topo trên các thành phần không có chu trình.
4. Đánh số node theo thứ tự topo với quy tắc phá hòa ổn định.
5. Giữ thứ tự nhánh UNION theo cấu trúc AST.
6. Đối với recursive CTE, đánh dấu nhóm đệ quy thay vì cố tạo thứ tự topo tuyến tính.
7. Đối với node phụ thuộc vào nhiều nhánh, chỉ đánh số sau khi các node đầu vào cần thiết đã được đánh số.

Quy tắc phá hòa nên dựa trên:

1. Quan hệ phụ thuộc.
2. Thứ tự nhánh trong AST.
3. Vị trí xuất hiện trong SQL.
4. ID ổn định của node.

Không dùng vị trí x/y trên canvas để quyết định số thứ tự.

## 8.3. Hiển thị số thứ tự

Số thứ tự cần xuất hiện:

* Trên góc trái node.
* Trong danh sách Query Flow.
* Trong panel chi tiết node.
* Khi điều hướng từ node về SQL Editor.

Cho phép bật/tắt số thứ tự bằng nút `Show Step Numbers`.

Khi chọn node, highlight các node đầu vào và đầu ra trực tiếp của nó.

## 8.4. Không đánh đồng thứ tự logic với thứ tự thực thi

Trong Logical Flow, số thứ tự biểu thị thứ tự phụ thuộc được suy ra từ cấu trúc SQL.

Trong Physical Plan, số thứ tự được gắn với operator của execution plan.

Hai chế độ phải có nhãn và quy ước riêng, không sử dụng chung một số thứ tự gây hiểu nhầm.

---

# 9. THIẾT KẾ LAYOUT BẰNG D3.JS

## 9.1. Đề xuất bố cục

Sử dụng layout theo hướng trái sang phải:

```text
SOURCE
  |
  v
TRANSFORM
  |
  v
COMBINE
  |
  v
FINAL RESULT
```

Ví dụ:

```text
Customer Table ──> Filter ──┐
                            ├──> LEFT JOIN ──> Final SELECT
Sales Table ──> Aggregate ──┘
```

Đối với UNION, sử dụng nhiều nhánh hội tụ tại node UNION.

Đối với CTE, có thể hiển thị node định nghĩa và node tham chiếu, nhưng phải phân biệt hai khái niệm:

* Vị trí khai báo CTE.
* Vị trí sử dụng CTE.

Không được nhân bản nội dung CTE thành nhiều node độc lập mà không có liên kết đến node định nghĩa.

## 9.2. D3.js chịu trách nhiệm

* SVG rendering.
* Node positioning.
* Edge routing.
* Zoom/pan.
* Drag node.
* Expand/collapse.
* Highlight dependency.
* Highlight selected node.
* Show step number.
* Auto-layout.

D3.js không chịu trách nhiệm:

* Parse SQL.
* Suy luận thứ tự xử lý logic.
* Suy luận execution plan vật lý.
* Tự tạo JOIN từ metadata.
* Thay đổi SQL.

## 9.3. Auto-layout

Ưu tiên bố cục có hướng dựa trên graph dependency.

Có thể sử dụng:

* D3.js để render và tương tác.
* Thuật toán topological layering để xác định tầng.
* Thuật toán giảm giao cắt edge để cải thiện hiển thị.
* Force simulation chỉ khi thực sự cần.

Không dùng force simulation thuần làm nguồn quyết định thứ tự logic vì vị trí node có thể thay đổi không ổn định.

## 9.4. Thu gọn node

Với CTE hoặc subquery phức tạp:

* Hiển thị node tổng quan.
* Có nút Expand.
* Khi mở rộng, hiển thị các node bên trong.
* Khi thu gọn, giữ nguyên quan hệ đầu vào/đầu ra ở cấp cha.

Không xóa các node con khỏi Query Model chỉ vì người dùng thu gọn giao diện.

---

# 10. SQL SOURCE MAPPING

Mỗi node phải lưu vị trí tương ứng trong SQL Editor.

Thông tin:

* `startOffset`.
* `endOffset`.
* `startLine`.
* `startColumn`.
* `endLine`.
* `endColumn`.

Nếu parser cung cấp source span, sử dụng source span gốc.

Nếu một node được tổng hợp từ nhiều đoạn SQL, lưu nhiều source range hoặc tham chiếu đến node AST liên quan.

### Khi click node

* Chọn node.
* Highlight SQL tương ứng trong editor.
* Cuộn đến vị trí bắt đầu.
* Hiển thị SQL fragment trong panel chi tiết.

### Khi chọn SQL trong editor

Nếu vùng SQL tương ứng với một node đã biết:

* Highlight node.
* Hiển thị node trên canvas.
* Nếu node nằm trong CTE/subquery đã thu gọn, có thể gợi ý mở rộng.

Không tự động sửa SQL chỉ vì người dùng chọn node.

---

# 11. HỖ TRỢ EXECUTION PLAN VẬT LÝ

Đây là phase riêng, không trộn lẫn với Query Flow Analyzer.

## 11.1. SQL Server

Bổ sung khả năng lấy execution plan bằng cơ chế phù hợp với kết nối SQL Server hiện có.

Phân biệt:

* Estimated Execution Plan.
* Actual Execution Plan.

Actual Execution Plan yêu cầu thực thi truy vấn để lấy thông tin runtime.

Phải có cảnh báo trước khi thực thi nếu thao tác có thể chạy một truy vấn tốn tài nguyên hoặc gây tác động ngoài dự kiến.

Không tự động chạy các View hoặc truy vấn chỉ để vẽ Logical Flow.

## 11.2. PostgreSQL

Hỗ trợ:

* `EXPLAIN`.
* `EXPLAIN (ANALYZE, BUFFERS)` trong chế độ phù hợp.

`EXPLAIN ANALYZE` thực thi truy vấn. Vì vậy, không được tự động chạy mà không có thao tác xác nhận của người dùng.

Không dùng cùng một schema node cho Logical Flow và Physical Plan nếu hai loại dữ liệu có ngữ nghĩa khác nhau.

## 11.3. Hiển thị Physical Plan

Node có thể thể hiện:

* Operator.
* Object/Relation.
* Estimated cost.
* Estimated rows.
* Actual rows nếu có.
* Actual time nếu có.
* Số lần lặp nếu có.
* Các metric mà database thực sự cung cấp.

Chỉ hiển thị thông tin tồn tại trong plan; không tự suy đoán giá trị thiếu.

---

# 12. CHIẾN LƯỢC PARSER

Trước khi viết thêm logic xử lý CTE/UNION bằng regex, Agent phải kiểm tra parser đang được sử dụng trong dự án.

Yêu cầu parser:

* Có AST.
* Có source location.
* Phân biệt dialect.
* Hỗ trợ CTE.
* Hỗ trợ UNION/UNION ALL.
* Hỗ trợ subquery.
* Có khả năng giữ cấu trúc SQL chưa được hỗ trợ.

Nếu parser hiện tại không đủ khả năng, đánh giá việc sử dụng parser mới.

Không bắt buộc sử dụng một thư viện cụ thể nếu thư viện đó không đáp ứng đầy đủ cú pháp thực tế của SQL Server và PostgreSQL.

Mỗi dialect phải có bộ kiểm thử riêng.

---

# 13. KẾ HOẠCH TRIỂN KHAI

## Phase 0 — Khảo sát hiện trạng

Công việc:

1. Kiểm tra Design View hiện tại.
2. Xác định mô hình Table Node và Join Edge.
3. Xác định SQL Parser hiện có.
4. Kiểm tra cách xử lý SELECT/JOIN.
5. Xác định cách lưu SQL fragment và source range.
6. Xác định khả năng mở rộng Query Model.
7. Liệt kê các truy vấn phức tạp hiện đang thất bại.
8. Xác định các module cần sửa.

Đầu ra:

* Báo cáo kiến trúc hiện tại.
* Danh sách lỗi và giới hạn.
* Đề xuất Query Flow Graph.
* Danh sách file cần sửa.
* Bộ SQL mẫu dùng để kiểm thử.

Không thay đổi code trước khi hoàn thành khảo sát.

## Phase 1 — Query Flow Graph

Công việc:

1. Xây dựng mô hình Query Node và Query Edge.
2. Xác định các loại node.
3. Xác định quy ước hướng edge.
4. Xây dựng cơ chế source mapping.
5. Xây dựng thuật toán đánh số logic.
6. Xử lý node có nhiều đầu vào.
7. Xử lý recursive dependency.

Tiêu chí hoàn thành:

Có thể tạo Query Flow Graph từ dữ liệu AST thử nghiệm mà không phụ thuộc vào D3.js.

## Phase 2 — Cải thiện Parser

Công việc:

1. Hỗ trợ CTE.
2. Hỗ trợ UNION/UNION ALL.
3. Hỗ trợ subquery.
4. Hỗ trợ derived table.
5. Hỗ trợ EXISTS/NOT EXISTS.
6. Hỗ trợ aggregate.
7. Xử lý nhiều cấp truy vấn.
8. Phân loại cú pháp chưa hỗ trợ.

Tiêu chí hoàn thành:

Parser tạo được cấu trúc AST chính xác cho bộ truy vấn mẫu.

## Phase 3 — Query Flow Analyzer

Công việc:

1. Xây dựng node từ AST.
2. Xây dựng edge dependency.
3. Phân tích quan hệ giữa các CTE.
4. Phân tích các nhánh UNION.
5. Phân tích nguồn dữ liệu của subquery.
6. Xác định node kết quả cuối.
7. Đánh số theo thứ tự phụ thuộc logic.
8. Phát hiện chu trình và đệ quy.

Tiêu chí hoàn thành:

Graph biểu diễn được cấu trúc và quan hệ phụ thuộc mà không cần UI.

## Phase 4 — D3.js Visualization

Công việc:

1. Bổ sung các loại node mới.
2. Bổ sung edge cho CTE và UNION.
3. Bổ sung layout nhiều nhánh.
4. Bổ sung số thứ tự trên node.
5. Bổ sung chế độ expand/collapse.
6. Bổ sung highlight dependency.
7. Bổ sung auto-layout.
8. Bổ sung legend cho các loại node.

Tiêu chí hoàn thành:

Có thể trực quan hóa truy vấn nhiều nhánh và nhiều cấp mà không cần chuyển thành sơ đồ JOIN phẳng.

## Phase 5 — Điều hướng SQL

Công việc:

1. Click node để highlight SQL fragment.
2. Click SQL fragment để highlight node.
3. Hỗ trợ source mapping cho CTE.
4. Hỗ trợ source mapping cho từng nhánh UNION.
5. Điều hướng trong các node đang thu gọn.
6. Hiển thị SQL fragment trong panel chi tiết.

Tiêu chí hoàn thành:

Người dùng có thể truy cập nhanh đoạn SQL tương ứng với từng thành phần trên graph.

## Phase 6 — Tích hợp Execution Plan

Công việc:

1. Xây dựng chế độ Physical Plan.
2. Lấy plan từ SQL Server.
3. Lấy plan từ PostgreSQL.
4. Chuẩn hóa operator metadata.
5. Hiển thị các operator.
6. Đánh số operator.
7. Hiển thị cost/rows/time khi có dữ liệu.
8. Thêm xác nhận khi thao tác có thể thực thi truy vấn.

Tiêu chí hoàn thành:

Logical Flow và Physical Plan được phân biệt rõ ràng và hoạt động độc lập.

## Phase 7 — Tối ưu và kiểm thử

Công việc:

* Kiểm thử truy vấn phức tạp.
* Kiểm thử graph có nhiều node.
* Kiểm thử nhiều nhánh UNION.
* Kiểm thử CTE lồng nhau.
* Kiểm thử recursive CTE.
* Kiểm thử alias trùng tên bảng.
* Kiểm thử source mapping.
* Kiểm thử đổi database.
* Kiểm thử khi parser thất bại.
* Kiểm thử hiệu năng trong PyWebView.

Không mở rộng thêm tính năng trước khi các lỗi nghiêm trọng về mất SQL, sai quan hệ hoặc sai thứ tự phụ thuộc được xử lý.

---

# 14. BỘ TEST BẮT BUỘC

## Test A — CTE đơn giản

```sql
WITH CustomerCTE AS (
    SELECT Id, Name
    FROM dbo.Customer
)
SELECT *
FROM CustomerCTE;
```

Kỳ vọng:

* Có node bảng nguồn.
* Có node CTE.
* Có node truy vấn cuối.
* Edge thể hiện đúng quan hệ phụ thuộc.
* Có source mapping cho từng thành phần.

## Test B — Nhiều CTE

```sql
WITH CustomerCTE AS (
    SELECT Id, Name
    FROM dbo.Customer
),
SalesCTE AS (
    SELECT CustomerId, SUM(Amount) AS TotalAmount
    FROM dbo.Sales
    GROUP BY CustomerId
)
SELECT
    c.Name,
    s.TotalAmount
FROM CustomerCTE AS c
LEFT JOIN SalesCTE AS s
    ON c.Id = s.CustomerId;
```

Kỳ vọng:

* Hai CTE riêng biệt.
* Có node Aggregate.
* Có node JOIN.
* Có node kết quả cuối.
* Số thứ tự thể hiện đúng phụ thuộc.

## Test C — UNION ALL

```sql
SELECT Id, Name
FROM dbo.Customer

UNION ALL

SELECT Id, Name
FROM dbo.Supplier;
```

Kỳ vọng:

* Hai nhánh SELECT.
* Một node UNION ALL.
* Hai nhánh nối vào đúng node UNION ALL.
* Không biến thành JOIN.

## Test D — UNION kết hợp CTE

```sql
WITH BaseData AS (
    SELECT Id, Name
    FROM dbo.Customer
)
SELECT Id, Name
FROM BaseData

UNION ALL

SELECT Id, Name
FROM dbo.Supplier;
```

Kỳ vọng:

* CTE được thể hiện riêng.
* Nhánh thứ nhất sử dụng CTE.
* Nhánh thứ hai sử dụng bảng Supplier.
* UNION ALL kết hợp hai nhánh.
* Final Result được xác định chính xác.

## Test E — Derived Table

```sql
SELECT x.CustomerId, x.TotalAmount
FROM (
    SELECT
        CustomerId,
        SUM(Amount) AS TotalAmount
    FROM dbo.Sales
    GROUP BY CustomerId
) AS x;
```

Kỳ vọng:

* Có node bảng nguồn.
* Có node Aggregate.
* Có node Derived Table.
* Có node Final SELECT.

## Test F — Recursive CTE

Sử dụng một truy vấn recursive CTE phù hợp với dialect hiện tại.

Kỳ vọng:

* Nhận diện cấu trúc đệ quy.
* Không sinh vô hạn node.
* Có thể thu gọn/mở rộng phần recursive.
* Không tuyên bố tồn tại thứ tự topo tuyến tính đầy đủ cho chu trình.

## Test G — CTE không được tham chiếu

Sử dụng truy vấn có CTE khai báo nhưng không được truy vấn cuối tham chiếu, trong phạm vi dialect cho phép.

Kỳ vọng:

* Phân biệt node khai báo và node được sử dụng.
* Không tự nối CTE không liên quan vào luồng dữ liệu kết quả.
* Hiển thị cảnh báo nếu cần.

---

# 15. TIÊU CHÍ NGHIỆM THU

* [x] Hỗ trợ CTE.
* [x] Hỗ trợ nhiều CTE phụ thuộc lẫn nhau.
* [x] Hỗ trợ UNION.
* [x] Hỗ trợ UNION ALL.
* [x] Hỗ trợ subquery trong FROM.
* [x] Hỗ trợ derived table.
* [x] Hỗ trợ các nhánh truy vấn kết hợp.
* [x] Có Query Flow Graph độc lập với D3.js.
* [x] Có số thứ tự logic trên từng node.
* [x] Có quy tắc đánh số ổn định.
* [x] Có source mapping đến SQL gốc.
* [x] Có điều hướng từ node đến SQL.
* [x] Có điều hướng từ SQL đến node.
* [x] Có expand/collapse.
* [x] Có phân biệt Logical Flow và Physical Plan.
* [x] Không đánh đồng thứ tự logic với thứ tự thực thi vật lý.
* [x] Không làm mất SQL gốc.
* [x] Không tự động thực thi truy vấn.
* [x] Không làm hỏng chức năng Design View JOIN hiện có.
* [x] Có kiểm thử cho SQL Server.
* [x] Có kiểm thử cho PostgreSQL.

---

# 16. YÊU CẦU AGENT THỰC HIỆN

Trước khi sửa code, Agent phải:

1. Khảo sát implementation Design View hiện tại.
2. Tìm nguyên nhân cụ thể khiến UNION ALL, CTE và subquery chưa được trực quan hóa.
3. Xác định có thể mở rộng parser hiện tại hay cần thay thế.
4. Xác định các file cần sửa và phạm vi ảnh hưởng.
5. Đưa ra kế hoạch chuyển đổi từ mô hình Table/Join sang Query Flow Graph.
6. Giữ nguyên chức năng JOIN hiện có.
7. Triển khai từng phase và kiểm thử sau mỗi phase.

Không xây dựng một hệ thống Design View mới hoàn toàn nếu mô hình hiện tại có thể được mở rộng an toàn.

Không sử dụng regex làm giải pháp chính cho parser.

Không tự viết lại SQL gốc để phù hợp với giao diện.

Không đánh số node dựa trên vị trí đồ họa.

Không hiển thị số thứ tự logic dưới nhãn “Execution Order” nếu chưa có execution plan vật lý.

Sau mỗi phase, báo cáo:

* Các file đã tạo/sửa.
* Chức năng đã hoàn thành.
* Các bài kiểm thử đã chạy.
* Kết quả kiểm thử.
* Giới hạn còn tồn tại.
* Ảnh hưởng đến module khác.

Ưu tiên hoàn thành Query Flow Graph và Logical Flow trước khi triển khai Physical Execution Plan.
