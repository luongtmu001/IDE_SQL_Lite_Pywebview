-- Multiple batches separated by GO
PRINT 'Batch 1 Starting';
CREATE TABLE #TempItems (
    ItemId INT,
    ItemName NVARCHAR(100)
);
INSERT INTO #TempItems VALUES (1, 'Widget A'), (2, 'Widget B');
GO

PRINT 'Batch 2 Starting';
SELECT ItemId, ItemName FROM #TempItems;
DROP TABLE #TempItems;
GO
