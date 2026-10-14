-- Common Table Expressions & Window Functions
WITH RankedSales AS (
    SELECT 
        SalesPersonId,
        SalesAmount,
        ROW_NUMBER() OVER (PARTITION BY Region ORDER BY SalesAmount DESC) AS SalesRank,
        DENSE_RANK() OVER (PARTITION BY Region ORDER BY SalesAmount DESC) AS DenseRank
    FROM Sales.Orders
    WHERE Status = 'Completed'
),
TopSales AS (
    SELECT SalesPersonId, SalesAmount
    FROM RankedSales
    WHERE SalesRank <= 3
)
SELECT t.SalesPersonId, t.SalesAmount, p.FullName
FROM TopSales t
JOIN HumanResources.Employee p ON t.SalesPersonId = p.EmployeeId;
