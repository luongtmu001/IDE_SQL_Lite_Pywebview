-- Stored Procedure, Table Variables, and TRY...CATCH
CREATE PROCEDURE dbo.usp_ProcessBatchOrders
    @BatchId INT,
    @ProcessedCount INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @TempTbl TABLE (
        OrderId INT PRIMARY KEY,
        CustomerId INT NOT NULL,
        SubTotal DECIMAL(18,2)
    );

    BEGIN TRY
        INSERT INTO @TempTbl (OrderId, CustomerId, SubTotal)
        SELECT OrderId, CustomerId, SubTotal
        FROM dbo.StagingOrders
        WHERE BatchId = @BatchId;

        UPDATE dbo.Orders
        SET Status = 'Processed'
        FROM dbo.Orders o
        INNER JOIN @TempTbl t ON o.OrderId = t.OrderId;

        SET @ProcessedCount = @@ROWCOUNT;
    END TRY
    BEGIN CATCH
        SET @ProcessedCount = 0;
        THROW;
    END CATCH
END;
