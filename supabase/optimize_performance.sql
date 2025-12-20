-- ====================================================================
-- PERFORMANCE OPTIMIZATION MIGRATION
-- ====================================================================

-- 1. Create Indices for Date-Based Filtering
-- These indices specifically target the columns used in the homepage "upcoming events" filter.
CREATE INDEX IF NOT EXISTS idx_events_dates_filtering 
ON events(is_active, registration_open, event_end_date, registration_start);

-- 2. Create RPC Function for Server-Side Filtering
-- This moves the heavy lifting from the Next.js server (fetching all rows) to Postgres (optimized filtering)

CREATE OR REPLACE FUNCTION get_upcoming_events(limit_count INTEGER DEFAULT 3)
RETURNS TABLE (
    id UUID,
    title TEXT,
    description TEXT,
    banner_url TEXT,
    event_date TIMESTAMP WITH TIME ZONE,
    event_end_date TIMESTAMP WITH TIME ZONE,
    event_type TEXT,
    registration_open BOOLEAN,
    is_active BOOLEAN,
    created_by UUID,
    club_name TEXT,     -- Joined from admin_users (if needed directly) or we join in JS
    club_logo_url TEXT  -- Joined from admin_users
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.title,
        e.description,
        e.banner_url,
        e.event_date,
        e.event_end_date,
        e.event_type,
        e.registration_open,
        e.is_active,
        e.created_by,
        au.club_name,
        au.club_logo_url
    FROM events e
    LEFT JOIN admin_users au ON e.created_by = au.user_id
    WHERE 
        e.is_active = true 
        AND e.registration_open = true
        AND (e.event_end_date IS NULL OR e.event_end_date > NOW())
        AND (e.registration_start IS NULL OR e.registration_start <= NOW())
    ORDER BY e.created_at DESC
    LIMIT limit_count;
END;
$$;
