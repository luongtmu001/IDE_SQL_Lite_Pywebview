-- PostgreSQL query with LIMIT, OFFSET, and JSON operators
SELECT 
    id,
    data->>'name' AS item_name,
    created_at
FROM public.events
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY id DESC
LIMIT 50 OFFSET 10;
