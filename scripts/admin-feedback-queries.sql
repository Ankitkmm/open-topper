-- Admin Feedback Triage Queries
-- Run these against the Supabase SQL editor or psql
-- Replace $1, $2, etc. with actual values

-- 1. Summary by category (last 7 days)
SELECT category, count(*)
FROM public.feedback
WHERE created_at > now() - interval '7 days'
GROUP BY category
ORDER BY count(*) DESC;

-- 2. Recent feedback (newest first)
SELECT id, page_path, category, message, created_at
FROM public.feedback
ORDER BY created_at DESC
LIMIT 100;

-- 3. Filter by category
-- Usage: replace 'bug' with desired category
SELECT id, page_path, message, created_at
FROM public.feedback
WHERE category = 'bug'
ORDER BY created_at DESC
LIMIT 100;

-- 4. Filter by page path (LIKE match)
-- Usage: replace '%/gs1%' with desired path pattern
SELECT id, page_path, category, message, created_at
FROM public.feedback
WHERE page_path LIKE '%/gs1%'
ORDER BY created_at DESC
LIMIT 100;

-- 5. Filter by date range
-- Usage: replace dates with desired range
SELECT id, page_path, category, message, created_at
FROM public.feedback
WHERE created_at BETWEEN '2026-06-01'::timestamptz AND '2026-06-30'::timestamptz
ORDER BY created_at DESC
LIMIT 100;

-- 6. Combined filter (category + page_path + date range)
-- Usage: replace all parameters
SELECT id, page_path, category, message, created_at
FROM public.feedback
WHERE category = 'bug'
  AND page_path LIKE '%/optional%'
  AND created_at > now() - interval '30 days'
ORDER BY created_at DESC
LIMIT 100;

-- 7. Top reported pages
SELECT page_path, count(*) as report_count
FROM public.feedback
WHERE created_at > now() - interval '30 days'
GROUP BY page_path
ORDER BY report_count DESC
LIMIT 20;
