-- ====================================================================
-- PHASE 2 OPTIMIZATION: EVENTS PAGE & SEARCH (FIXED V2)
-- ====================================================================

-- 1. Create RPC Function for Advanced Event Search & Filtering
-- [FIX V3] 'All' filter now includes Completed events (even if is_active=false)

CREATE OR REPLACE FUNCTION search_events(
    search_term TEXT DEFAULT '',
    filter_status TEXT DEFAULT 'all',  -- 'all', 'open', 'active', 'completed'
    club_name_filter TEXT DEFAULT '',
    limit_count INTEGER DEFAULT 50,
    offset_count INTEGER DEFAULT 0
)
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
    registration_start TIMESTAMP WITH TIME ZONE,
    registration_end TIMESTAMP WITH TIME ZONE,
    created_by UUID,
    club_name TEXT,     
    club_logo_url TEXT  
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        e.registration_start,
        e.registration_end,
        e.created_by,
        au.club_name,
        au.club_logo_url
    FROM events e
    LEFT JOIN admin_users au ON e.created_by = au.user_id
    WHERE 
        -- 1. Search Term (Title or Description)
        (search_term IS NULL OR length(search_term) = 0 OR 
         e.title ILIKE '%' || search_term || '%' OR 
         e.description ILIKE '%' || search_term || '%')
         
        AND
        
        -- 2. Club Filter (Partial Match on Club Name)
        (club_name_filter IS NULL OR length(club_name_filter) = 0 OR
         au.club_name ILIKE '%' || club_name_filter || '%')
         
        AND
        
        -- 3. Status Filter
        (
            CASE 
                WHEN filter_status = 'all' THEN 
                    -- Show Active OR Completed (Completed events are auto-set to is_active=false)
                    (e.is_active = true) OR (e.event_end_date IS NOT NULL AND e.event_end_date < NOW())
                    
                WHEN filter_status = 'active' THEN 
                    e.is_active = true AND (e.event_end_date IS NULL OR e.event_end_date >= NOW())
                    
                WHEN filter_status = 'open' THEN 
                    e.is_active = true AND 
                    e.registration_open = true AND
                    (e.registration_start IS NULL OR e.registration_start <= NOW()) AND
                    (e.registration_end IS NULL OR e.registration_end > NOW())
                    
                WHEN filter_status = 'completed' THEN 
                    (e.event_end_date IS NOT NULL AND e.event_end_date < NOW())
                    
                ELSE 
                    true -- Fallback
            END
        )
        
    ORDER BY 
        CASE 
            WHEN (e.event_end_date IS NOT NULL AND e.event_end_date < NOW()) THEN 1 -- Completed last
            ELSE 0 -- Active/Upcoming first
        END ASC,
        e.created_at DESC
        
    LIMIT limit_count
    OFFSET offset_count;
END;
$$;
