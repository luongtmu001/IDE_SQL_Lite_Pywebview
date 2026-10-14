/**
 * sql-style-metadata.js - Metadata & Schema Definitions for SQL Formatter Styles
 * ─────────────────────────────────────────────────────────────────────────────
 * Complies with Section 6, 7, 8, 9, 10 of .SKILL/format-code_general.md:
 * - Declarative Category hierarchy (GLOBAL, STATEMENTS, CLAUSES, EXPRESSIONS)
 * - Rich option metadata (boolean, select, number, text, radio)
 * - Declarative dependencies (disables dependent inputs dynamically)
 * - Realistic SQL Samples for interactive real-time preview
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (global) {
    'use strict';

    const CATEGORIES = [
        // ── 1. GLOBAL ─────────────────────────────────────────────────────────
        {
            id: 'whitespace',
            name: 'Khoảng trắng (Whitespace)',
            group: 'GLOBAL',
            groupLabel: 'Cấu hình chung (Global)',
            icon: 'fa-solid fa-indent',
            order: 1
        },
        {
            id: 'lists',
            name: 'Danh sách & Dấu phẩy (Lists)',
            group: 'GLOBAL',
            groupLabel: 'Cấu hình chung (Global)',
            icon: 'fa-solid fa-list-ol',
            order: 2
        },
        {
            id: 'parentheses',
            name: 'Dấu ngoặc đơn (Parentheses)',
            group: 'GLOBAL',
            groupLabel: 'Cấu hình chung (Global)',
            icon: 'fa-solid fa-brackets-round',
            order: 3
        },
        {
            id: 'casing',
            name: 'Quy tắc chữ hoa / thường (Casing)',
            group: 'GLOBAL',
            groupLabel: 'Cấu hình chung (Global)',
            icon: 'fa-solid fa-font',
            order: 4
        },

        // ── 2. STATEMENTS ─────────────────────────────────────────────────────
        {
            id: 'data_dml',
            name: 'Truy vấn dữ liệu (Data DML)',
            group: 'STATEMENTS',
            groupLabel: 'Câu lệnh (Statements)',
            icon: 'fa-solid fa-database',
            order: 5
        },
        {
            id: 'schema_ddl',
            name: 'Định nghĩa cấu trúc (Schema DDL)',
            group: 'STATEMENTS',
            groupLabel: 'Câu lệnh (Statements)',
            icon: 'fa-solid fa-table',
            order: 6
        },
        {
            id: 'control_flow',
            name: 'Điều khiển luồng (Control Flow)',
            group: 'STATEMENTS',
            groupLabel: 'Câu lệnh (Statements)',
            icon: 'fa-solid fa-code-branch',
            order: 7
        },
        {
            id: 'cte',
            name: 'Biểu thức CTE (Common Table Expressions)',
            group: 'STATEMENTS',
            groupLabel: 'Câu lệnh (Statements)',
            icon: 'fa-solid fa-layer-group',
            order: 8
        },
        {
            id: 'variables',
            name: 'Khai báo biến (Variables)',
            group: 'STATEMENTS',
            groupLabel: 'Câu lệnh (Statements)',
            icon: 'fa-solid fa-tag',
            order: 9
        },

        // ── 3. CLAUSES ────────────────────────────────────────────────────────
        {
            id: 'join',
            name: 'Mệnh đề kết nối (JOIN)',
            group: 'CLAUSES',
            groupLabel: 'Mệnh đề (Clauses)',
            icon: 'fa-solid fa-link',
            order: 10
        },
        {
            id: 'insert',
            name: 'Mệnh đề chèn dữ liệu (INSERT)',
            group: 'CLAUSES',
            groupLabel: 'Mệnh đề (Clauses)',
            icon: 'fa-solid fa-arrow-down-to-bracket',
            order: 11
        },

        // ── 4. EXPRESSIONS ────────────────────────────────────────────────────
        {
            id: 'function_calls',
            name: 'Lời gọi hàm (Functions)',
            group: 'EXPRESSIONS',
            groupLabel: 'Biểu thức (Expressions)',
            icon: 'fa-solid fa-cube',
            order: 12
        },
        {
            id: 'case_expr',
            name: 'Biểu thức điều kiện (CASE WHEN)',
            group: 'EXPRESSIONS',
            groupLabel: 'Biểu thức (Expressions)',
            icon: 'fa-solid fa-sitemap',
            order: 13
        },
        {
            id: 'in_expr',
            name: 'Mệnh đề tập hợp (IN)',
            group: 'EXPRESSIONS',
            groupLabel: 'Biểu thức (Expressions)',
            icon: 'fa-solid fa-ellipsis',
            order: 14
        },
        {
            id: 'operators',
            name: 'Toán tử logic & so sánh (Operators)',
            group: 'EXPRESSIONS',
            groupLabel: 'Biểu thức (Expressions)',
            icon: 'fa-solid fa-equals',
            order: 15
        }
    ];

    const OPTIONS = [
        // ── GLOBAL.whitespace ─────────────────────────────────────────────────
        {
            id: 'whitespace.indentSize',
            category: 'whitespace',
            label: 'Số khoảng trắng thụt lề (Indent size)',
            desc: 'Số lượng dấu cách tương ứng với một cấp thụt lề cú pháp.',
            type: 'number',
            min: 2,
            max: 8,
            step: 1,
            default: 4,
            dependencies: [
                { optionId: 'whitespace.useTabs', equals: false }
            ]
        },
        {
            id: 'whitespace.useTabs',
            category: 'whitespace',
            label: 'Sử dụng phím Tab thay cho khoảng trắng',
            desc: 'Chèn ký tự tab (\t) thay vì nhiều dấu space khi thụt dòng.',
            type: 'boolean',
            default: false
        },
        {
            id: 'whitespace.maxEmptyLines',
            category: 'whitespace',
            label: 'Số dòng trống tối đa liên tiếp (Max empty lines)',
            desc: 'Tự động gộp các dòng trống liên tiếp vượt quá giới hạn này.',
            type: 'number',
            min: 0,
            max: 3,
            step: 1,
            default: 1
        },
        {
            id: 'whitespace.trimTrailingWhitespace',
            category: 'whitespace',
            label: 'Xóa khoảng trắng thừa cuối dòng (Trim trailing whitespace)',
            desc: 'Tự động dọn dẹp các dấu cách/tab dư thừa ở đuôi mỗi dòng lệnh.',
            type: 'boolean',
            default: true
        },

        // ── GLOBAL.lists ──────────────────────────────────────────────────────
        {
            id: 'lists.commaPosition',
            category: 'lists',
            label: 'Vị trí đặt dấu phẩy (Comma position)',
            desc: 'Quy định dấu phẩy nằm ở cuối dòng trước (After) hay ở đầu dòng sau (Before).',
            type: 'select',
            default: 'after',
            options: [
                { value: 'after', label: 'Ở cuối dòng (After: column1,)' },
                { value: 'before', label: 'Ở đầu dòng mới (Before: , column2)' }
            ]
        },
        {
            id: 'lists.itemsOnNewLine',
            category: 'lists',
            label: 'Mỗi phần tử danh sách trên một dòng mới',
            desc: 'Xuống dòng cho từng cột được chọn trong SELECT hoặc danh sách bảng/tham số.',
            type: 'boolean',
            default: true
        },

        // ── GLOBAL.parentheses ────────────────────────────────────────────────
        {
            id: 'parentheses.spacesInside',
            category: 'parentheses',
            label: 'Thêm khoảng trắng bên trong dấu ngoặc (Spaces inside)',
            desc: 'Ví dụ: ( col1, col2 ) thay vì (col1, col2).',
            type: 'boolean',
            default: false
        },
        {
            id: 'parentheses.multiLineBlockNewLine',
            category: 'parentheses',
            label: 'Xuống dòng cho khối ngoặc đa dòng (Multiline block)',
            desc: 'Mở ngoặc xuống dòng cho danh sách dài như CREATE TABLE, INSERT INTO hoặc IN (...).',
            type: 'boolean',
            default: true
        },

        // ── GLOBAL.casing ─────────────────────────────────────────────────────
        {
            id: 'casing.keywords',
            category: 'casing',
            label: 'Định dạng từ khóa SQL (Keywords case)',
            desc: 'Quy định chữ hoa/thường cho các từ khóa SQL (SELECT, FROM, WHERE, JOIN...).',
            type: 'select',
            default: 'upper',
            options: [
                { value: 'upper', label: 'VIẾT HOA (UPPERCASE)' },
                { value: 'lower', label: 'viết thường (lowercase)' },
                { value: 'preserve', label: 'Giữ nguyên (Preserve original)' }
            ]
        },
        {
            id: 'casing.functions',
            category: 'casing',
            label: 'Định dạng hàm tích hợp sẵn (Built-in Functions case)',
            desc: 'Quy định chữ hoa/thường cho các hàm chuẩn (COUNT, SUM, GETDATE, COALESCE...).',
            type: 'select',
            default: 'upper',
            options: [
                { value: 'upper', label: 'VIẾT HOA (UPPERCASE)' },
                { value: 'lower', label: 'viết thường (lowercase)' },
                { value: 'preserve', label: 'Giữ nguyên (Preserve original)' }
            ]
        },
        {
            id: 'casing.datatypes',
            category: 'casing',
            label: 'Định dạng kiểu dữ liệu (Data types case)',
            desc: 'Quy định chữ hoa/thường cho các kiểu dữ liệu (INT, VARCHAR, DATETIME...).',
            type: 'select',
            default: 'upper',
            options: [
                { value: 'upper', label: 'VIẾT HOA (UPPERCASE)' },
                { value: 'lower', label: 'viết thường (lowercase)' },
                { value: 'preserve', label: 'Giữ nguyên (Preserve original)' }
            ]
        },

        // ── STATEMENTS.data_dml ───────────────────────────────────────────────
        {
            id: 'statements.majorClausesNewLine',
            category: 'data_dml',
            label: 'Xuống dòng cho các mệnh đề chính (Major clauses on new line)',
            desc: 'Tự động xuống dòng trước SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY...',
            type: 'boolean',
            default: true
        },
        {
            id: 'statements.indentClauseBody',
            category: 'data_dml',
            label: 'Thụt lề nội dung mệnh đề (Indent clause body)',
            desc: 'Thụt lề danh sách các cột dưới SELECT và điều kiện dưới WHERE.',
            type: 'boolean',
            default: true
        },

        // ── STATEMENTS.schema_ddl ─────────────────────────────────────────────
        {
            id: 'statements.ddlColumnsNewLine',
            category: 'schema_ddl',
            label: 'Mỗi cột trong CREATE TABLE trên một dòng riêng',
            desc: 'Định dạng danh sách cột và kiểu dữ liệu thụt dòng rõ ràng trong câu lệnh DDL.',
            type: 'boolean',
            default: true
        },

        // ── STATEMENTS.control_flow ───────────────────────────────────────────
        {
            id: 'statements.controlFlowIndent',
            category: 'control_flow',
            label: 'Thụt lề các khối lệnh BEGIN ... END / IF ... ELSE',
            desc: 'Căn lề rõ ràng cấu trúc phân nhánh và khối xử lý giao dịch.',
            type: 'boolean',
            default: true
        },

        // ── STATEMENTS.cte ────────────────────────────────────────────────────
        {
            id: 'statements.cteIndentQuery',
            category: 'cte',
            label: 'Thụt lề câu truy vấn bên trong CTE (WITH ... AS)',
            desc: 'Thụt lề khối SELECT nằm trong ngoặc tròn của biểu thức bảng chung CTE.',
            type: 'boolean',
            default: true
        },

        // ── STATEMENTS.variables ──────────────────────────────────────────────
        {
            id: 'statements.declareNewLine',
            category: 'variables',
            label: 'Mỗi biến trong DECLARE trên một dòng riêng',
            desc: 'Xuống dòng cho từng biến khi khai báo nhiều biến cùng lúc.',
            type: 'boolean',
            default: true
        },

        // ── CLAUSES.join ──────────────────────────────────────────────────────
        {
            id: 'clauses.joinOnNewLine',
            category: 'join',
            label: 'Xuống dòng cho mỗi mệnh đề JOIN',
            desc: 'Tách từng bảng kết nối (INNER JOIN, LEFT JOIN, CROSS APPLY...) trên một dòng riêng.',
            type: 'boolean',
            default: true
        },
        {
            id: 'clauses.indentJoinOn',
            category: 'join',
            label: 'Xuống dòng và thụt lề điều kiện ON của JOIN',
            desc: 'Đặt điều kiện ON trên dòng mới và thụt vào so với từ khóa JOIN.',
            type: 'boolean',
            default: true,
            dependencies: [
                { optionId: 'clauses.joinOnNewLine', equals: true }
            ]
        },

        // ── CLAUSES.insert ────────────────────────────────────────────────────
        {
            id: 'clauses.insertColumnsNewLine',
            category: 'insert',
            label: 'Xuống dòng cho danh sách cột và VALUES',
            desc: 'Đặt khối (Column1, Column2) và VALUES (...) trên các dòng riêng biệt.',
            type: 'boolean',
            default: true
        },

        // ── EXPRESSIONS.function_calls ────────────────────────────────────────
        {
            id: 'expressions.functionSpaceBeforeArgs',
            category: 'function_calls',
            label: 'Khoảng trắng trước danh sách tham số hàm',
            desc: 'Ví dụ: DATEADD (month, 1, date) thay vì DATEADD(month, 1, date).',
            type: 'boolean',
            default: false
        },

        // ── EXPRESSIONS.case_expr ─────────────────────────────────────────────
        {
            id: 'caseExpression.whenOnNewLine',
            category: 'case_expr',
            label: 'Xuống dòng cho mỗi nhánh WHEN',
            desc: 'Đặt từng biểu thức WHEN ... THEN trên một dòng riêng.',
            type: 'boolean',
            default: true
        },
        {
            id: 'caseExpression.indentWhen',
            category: 'case_expr',
            label: 'Thụt lề các nhánh WHEN bên trong CASE',
            desc: 'Thụt dòng nội dung nhánh so với từ khóa CASE và END.',
            type: 'boolean',
            default: true,
            dependencies: [
                { optionId: 'caseExpression.whenOnNewLine', equals: true }
            ]
        },
        {
            id: 'caseExpression.thenOnSameLine',
            category: 'case_expr',
            label: 'Đặt từ khóa THEN trên cùng dòng với WHEN',
            desc: 'Ví dụ: WHEN x = 1 THEN y thay vì xuống dòng trước THEN.',
            type: 'boolean',
            default: true
        },

        // ── EXPRESSIONS.in_expr ───────────────────────────────────────────────
        {
            id: 'expressions.inMultiLineWhenLong',
            category: 'in_expr',
            label: 'Xuống dòng danh sách IN (...) khi có nhiều hơn 3 phần tử',
            desc: 'Tự động chia dòng và căn lề danh sách giá trị dài trong mệnh đề IN.',
            type: 'boolean',
            default: false
        },

        // ── EXPRESSIONS.operators ─────────────────────────────────────────────
        {
            id: 'operators.andOrPlaceOnNewLine',
            category: 'operators',
            label: 'Vị trí từ khóa AND / OR (Place on new line)',
            desc: 'Quy tắc ngắt dòng cho các liên từ logic trong điều kiện WHERE hoặc ON.',
            type: 'select',
            default: 'always',
            options: [
                { value: 'always', label: 'Luôn luôn xuống dòng (Always)' },
                { value: 'when_multiple', label: 'Khi có từ 2 điều kiện trở lên (When multiple)' },
                { value: 'never', label: 'Không xuống dòng (Never)' }
            ]
        },
        {
            id: 'operators.andOrAlignment',
            category: 'operators',
            label: 'Căn lề từ khóa AND / OR (Alignment)',
            desc: 'Cách căn lề từ khóa AND/OR so với mệnh đề WHERE / ON phía trên.',
            type: 'select',
            default: 'rightToStatement',
            options: [
                { value: 'rightToStatement', label: 'Căn phải thẳng hàng mệnh đề (Right aligned to statement)' },
                { value: 'indented', label: 'Thụt lề vào trong (Indented)' },
                { value: 'left', label: 'Căn trái thẳng lề (Left aligned)' }
            ],
            dependencies: [
                { optionId: 'operators.andOrPlaceOnNewLine', notEquals: 'never' }
            ]
        },
        {
            id: 'operators.andOrKeywordBeforeCondition',
            category: 'operators',
            label: 'Đặt AND / OR ở trước biểu thức điều kiện',
            desc: 'Ví dụ: AND City = \'Bothell\' (từ khóa nằm đầu dòng điều kiện).',
            type: 'boolean',
            default: true
        },
        {
            id: 'operators.betweenPlaceOnNewLine',
            category: 'operators',
            label: 'Xuống dòng cho mệnh đề BETWEEN',
            desc: 'Đặt toán tử BETWEEN và giá trị trên dòng riêng.',
            type: 'boolean',
            default: false
        },
        {
            id: 'operators.spacesAroundOperators',
            category: 'operators',
            label: 'Thêm khoảng trắng quanh toán tử so sánh & số học',
            desc: 'Tự động chuẩn hóa a=b thành a = b, a+b thành a + b.',
            type: 'boolean',
            default: true
        },
        {
            id: 'operators.alignComparisonOperators',
            category: 'operators',
            label: 'Căn thẳng hàng các dấu so sánh (Align comparison operators)',
            desc: 'Căn thẳng hàng dọc các dấu = trong các điều kiện liên tiếp.',
            type: 'boolean',
            default: false
        }
    ];

    const SAMPLE_SQLS = {
        default: `SELECT AddressID, AddressLine1, City, StateProvinceID, PostalCode, ModifiedDate
FROM Person.Address
WHERE ModifiedDate BETWEEN DATEADD(MONTH, -6, GETDATE()) AND GETDATE()
AND City = 'Bothell'
OR LEFT(PostalCode, 2) = 'CB'
ORDER BY City ASC, ModifiedDate DESC;`,

        whitespace: `SELECT e.EmployeeID, e.FirstName, e.LastName, d.DepartmentName
FROM HumanResources.Employee AS e
INNER JOIN HumanResources.Department AS d ON e.DepartmentID = d.DepartmentID
WHERE e.Active = 1
ORDER BY e.LastName;`,

        lists: `SELECT CustomerID, CustomerName, ContactName, Address, City, PostalCode, Country
FROM Customers
WHERE Country IN ('Germany', 'France', 'UK');`,

        parentheses: `SELECT ProductID, ProductName, UnitPrice, (UnitsInStock * UnitPrice) AS TotalValue
FROM Products
WHERE (CategoryID = 1 OR CategoryID = 2) AND (UnitPrice > 20);`,

        casing: `select employee_id, first_name, count(*) as total_orders
from hr.employees
where hire_date > '2023-01-01' and status = 'active'
group by employee_id, first_name
having count(*) >= 5;`,

        data_dml: `SELECT p.ProductID, p.ProductName, p.UnitPrice, s.SupplierName
FROM Production.Product AS p
LEFT OUTER JOIN Purchasing.Supplier AS s ON p.SupplierID = s.SupplierID
WHERE p.Discontinued = 0
  AND p.UnitsInStock > 0
GROUP BY p.ProductID, p.ProductName, p.UnitPrice, s.SupplierName
ORDER BY p.UnitPrice DESC;`,

        schema_ddl: `CREATE TABLE Sales.CustomerOrders (
    OrderID INT IDENTITY(1, 1) NOT NULL,
    CustomerID NVARCHAR(10) NOT NULL,
    OrderDate DATETIME2 NOT NULL,
    TotalAmount DECIMAL(18, 2) NOT NULL,
    CONSTRAINT PK_CustomerOrders PRIMARY KEY (OrderID)
);`,

        control_flow: `IF @TotalOrders > 100
BEGIN
    UPDATE Sales.CustomerStats
    SET LoyaltyTier = 'Gold', LastUpdated = GETDATE()
    WHERE CustomerID = @CustomerID;
END
ELSE
BEGIN
    UPDATE Sales.CustomerStats
    SET LoyaltyTier = 'Standard'
    WHERE CustomerID = @CustomerID;
END`,

        cte: `WITH RegionalSales AS (
    SELECT TerritoryID, SUM(TotalDue) AS SubTotal
    FROM Sales.SalesOrderHeader
    WHERE OrderDate >= '2025-01-01'
    GROUP BY TerritoryID
)
SELECT t.Name, rs.SubTotal
FROM RegionalSales AS rs
JOIN Sales.SalesTerritory AS t ON rs.TerritoryID = t.TerritoryID;`,

        variables: `DECLARE @StartDate DATETIME = '2026-01-01',
    @EndDate DATETIME = GETDATE(),
    @TargetRegion NVARCHAR(50) = 'North America';`,

        join: `SELECT c.CustomerName, o.OrderID, o.OrderDate, od.Quantity, p.ProductName
FROM Sales.Customer AS c
INNER JOIN Sales.Orders AS o ON c.CustomerID = o.CustomerID
LEFT JOIN Sales.OrderDetails AS od ON o.OrderID = od.OrderID
LEFT JOIN Production.Product AS p ON od.ProductID = p.ProductID
WHERE c.Country = 'USA';`,

        insert: `INSERT INTO Sales.OrderAudit (OrderID, ChangedBy, ChangeDate, OldStatus, NewStatus)
VALUES (10248, 'admin_user', GETDATE(), 'Pending', 'Processing');`,

        function_calls: `SELECT DATEADD(DAY, 7, OrderDate) AS EstimatedShipDate,
       DATEDIFF(DAY, OrderDate, ShippedDate) AS ProcessingDays,
       COALESCE(ShipRegion, 'N/A') AS SafeRegion
FROM Sales.Orders;`,

        case_expr: `SELECT OrderID, TotalDue,
    CASE
        WHEN TotalDue > 10000 THEN 'VIP Order'
        WHEN TotalDue > 2000 THEN 'Priority Order'
        ELSE 'Regular Order'
    END AS OrderCategory
FROM Sales.SalesOrderHeader;`,

        in_expr: `SELECT ProductID, ProductName, UnitPrice
FROM Production.Product
WHERE CategoryID IN (1, 2, 5, 8, 12, 15);`,

        operators: `SELECT AddressID, AddressLine1, City, PostalCode
FROM Person.Address
WHERE ModifiedDate BETWEEN DATEADD(MONTH, -6, GETDATE()) AND GETDATE()
  AND City = 'Bothell'
   OR LEFT(PostalCode, 2) = 'CB'
  AND PostalCode = @prefix + @suffix;`
    };

    global.SqlStyleMetadata = {
        CATEGORIES,
        OPTIONS,
        SAMPLE_SQLS
    };

})(typeof window !== 'undefined' ? window : globalThis);
