-- PostgreSQL temp tables and dollar quotes
CREATE TEMP TABLE tmp_summary (
    category_id INT,
    item_count INT
);

INSERT INTO tmp_summary (category_id, item_count)
SELECT category_id, COUNT(*)
FROM public.products
GROUP BY category_id;

SELECT * FROM tmp_summary WHERE item_count > 0;
