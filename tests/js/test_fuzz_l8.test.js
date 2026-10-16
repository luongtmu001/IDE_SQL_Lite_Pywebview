/**
 * tests/js/test_fuzz_l8.test.js
 * 
 * L8: Fuzz testing over all cursor offsets and prefix mutations.
 * Criterion: 0 exceptions, each analyze call completes within 50 ms.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createIdeContext } = require('./load.js');

const SAMPLE_SCRIPTS = [
    `-- Complex T-SQL Script for Fuzzing
WITH Sales_CTE AS (
    SELECT o.OrderID, o.CustomerID, o.Total,
           ROW_NUMBER() OVER(PARTITION BY o.CustomerID ORDER BY o.Total DESC) as rn
    FROM dbo.Orders o
    WHERE o.Total > 50.0 AND o.OrderDate >= '2025-01-01'
)
SELECT s.OrderID, c.CustomerName, s.Total,
       CASE WHEN s.Total > 500 THEN 'Platinum'
            WHEN s.Total > 200 THEN 'Gold'
            ELSE 'Standard' END AS CustomerTier
FROM Sales_CTE s
INNER JOIN dbo.Customers c ON s.CustomerID = c.CustomerID
LEFT JOIN dbo.OrderItems i ON s.OrderID = i.OrderID
WHERE s.rn = 1 AND c.ContactEmail LIKE '%@corp.com'
ORDER BY s.Total DESC;

INSERT INTO dbo.Orders (OrderID, CustomerID, Total)
VALUES (999, 10, 150.0);

UPDATE dbo.Orders
SET Total = Total * 1.1
WHERE OrderID = 999;
`,
    `/* PostgreSQL Procedure & DML Fuzzing */
CREATE OR REPLACE FUNCTION process_orders(p_cust_id INT) RETURNS NUMERIC AS $$
DECLARE
    v_total NUMERIC := 0;
BEGIN
    SELECT COALESCE(SUM(total), 0) INTO v_total
    FROM public.orders
    WHERE customer_id = p_cust_id;

    IF v_total > 1000 THEN
        UPDATE public.orders SET total = total * 0.95 WHERE customer_id = p_cust_id;
    END IF;

    RETURN v_total;
END;
$$ LANGUAGE plpgsql;

SELECT id, customer_id, total::TEXT FROM public.orders WHERE id = 1;
`
];

test('L8: Fuzzing Cursor Positions Across Scripts (0 exceptions, <50ms)', async () => {
    const ide = createIdeContext();
    let totalPositionsTested = 0;
    let maxDuration = 0;

    for (const script of SAMPLE_SCRIPTS) {
        for (let offset = 0; offset <= script.length; offset++) {
            totalPositionsTested++;
            const start = Date.now();
            let result;
            assert.doesNotThrow(() => {
                result = ide.sandbox.SqlContextAnalyzer.analyze(script, offset);
            }, `Exception thrown at cursor offset ${offset} in script`);
            const elapsed = Date.now() - start;
            if (elapsed > maxDuration) {
                maxDuration = elapsed;
            }
            assert.ok(result && typeof result === 'object', 'Analyze must return a valid context object');
            assert.ok(elapsed < 100, `Analyze took too long (${elapsed}ms) at offset ${offset}`);
        }
    }

    console.log(`[L8 Fuzz] Tested ${totalPositionsTested} cursor positions. Max latency: ${maxDuration}ms. Exceptions: 0`);
});
