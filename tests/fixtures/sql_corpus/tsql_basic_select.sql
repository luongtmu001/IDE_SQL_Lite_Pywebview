-- Basic SELECT with WHERE, ORDER BY, GROUP BY
SELECT 
    c.CustomerId,
    c.CustomerName,
    COUNT(o.OrderId) AS TotalOrders,
    SUM(o.TotalAmount) AS TotalSpent
FROM dbo.Customers c
INNER JOIN dbo.Orders o ON c.CustomerId = o.CustomerId
WHERE c.IsActive = 1 AND o.OrderDate >= '2025-01-01'
GROUP BY c.CustomerId, c.CustomerName
HAVING COUNT(o.OrderId) > 5
ORDER BY TotalSpent DESC;
