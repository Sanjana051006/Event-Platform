-- ====================================================================
-- EVENT PLATFORM - COMPLETE DATABASE SETUP
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ====================================================================
-- 2. CORE TABLES
-- ====================================================================

-- A. Events Table
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    banner_url TEXT,
    event_date TIMESTAMP WITH TIME ZONE,
    event_end_date TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    event_type TEXT DEFAULT 'other',
    registration_open BOOLEAN DEFAULT true,
    registration_start TIMESTAMP WITH TIME ZONE,
    registration_end TIMESTAMP WITH TIME ZONE,
    form_fields JSONB DEFAULT '[]'::jsonb,
    is_paid BOOLEAN DEFAULT FALSE,
    registration_fee NUMERIC DEFAULT 0,
    problem_selection_start TIMESTAMP WITH TIME ZONE,
    problem_selection_end TIMESTAMP WITH TIME ZONE,
    ppt_template_url TEXT,
    ppt_release_time TIMESTAMP WITH TIME ZONE,
    submission_start TIMESTAMP WITH TIME ZONE,
    submission_end TIMESTAMP WITH TIME ZONE,
    submission_form_fields JSONB DEFAULT '[]'::jsonb,
    gallery_images TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON COLUMN events.gallery_images IS 'Array of public image URLs for the event gallery';

-- B. Problem Statements Table
CREATE TABLE IF NOT EXISTS problem_statements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    max_selections INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- C. Participants Table
CREATE TABLE IF NOT EXISTS participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    responses JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    selected_problem_id UUID REFERENCES problem_statements(id),
    submission_data JSONB,
    submitted_at TIMESTAMP WITH TIME ZONE,
    payment_id TEXT,
    order_id TEXT,
    payment_status TEXT DEFAULT 'pending',
    reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT participant_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- D. Contact Submissions Table
CREATE TABLE IF NOT EXISTS contact_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- E. Admin Users Table
CREATE TABLE IF NOT EXISTS admin_users (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'admin',
    club_name TEXT,
    club_logo_url TEXT,
    razorpay_key_id TEXT,
    razorpay_key_secret TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT admin_role_check CHECK (role IN ('admin', 'super_admin'))
);

-- F. Profiles Table
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT,
    phone_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- G. Quiz Questions Table
CREATE TABLE IF NOT EXISTS quiz_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    options JSONB NOT NULL, -- Array of strings or objects
    correct_option_index INTEGER NOT NULL,
    points INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- H. Quiz Attempts Table
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    score INTEGER, -- Nullable for in-progress
    answers JSONB NOT NULL, -- Map of question_id -> selected_option_index
    status TEXT DEFAULT 'in_progress',
    marked_for_review JSONB DEFAULT '[]'::jsonb,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE -- Nullable, no default
);

-- ====================================================================
-- 3. HELPER FUNCTIONS
-- ====================================================================

-- Function to get the current authenticated user's admin role
CREATE OR REPLACE FUNCTION public.get_admin_role()
RETURNS TEXT AS $$
DECLARE
  admin_role TEXT;
BEGIN
  SELECT role INTO admin_role
  FROM public.admin_users
  WHERE user_id = auth.uid();
  RETURN admin_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check and Select Problem (Concurrency Safe)
CREATE OR REPLACE FUNCTION check_and_select_problem(p_user_id UUID, p_event_id UUID, p_problem_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    current_count INTEGER;
    max_limit INTEGER;
    existing_selection UUID;
BEGIN
    SELECT selected_problem_id INTO existing_selection
    FROM participants
    WHERE user_id = p_user_id AND event_id = p_event_id;

    IF existing_selection IS NOT NULL THEN
        RAISE EXCEPTION 'You have already selected a problem statement.';
    END IF;

    SELECT count(*) INTO current_count
    FROM participants
    WHERE selected_problem_id = p_problem_id;

    SELECT max_selections INTO max_limit
    FROM problem_statements
    WHERE id = p_problem_id;

    IF current_count >= max_limit THEN
        RETURN FALSE;
    END IF;

    UPDATE participants
    SET selected_problem_id = p_problem_id
    WHERE user_id = p_user_id AND event_id = p_event_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper Function for RLS to prevent recursion
CREATE OR REPLACE FUNCTION public.is_event_participant(_event_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM participants
    WHERE event_id = _event_id
    AND user_id = auth.uid()
  );
END;
$$;

-- [NEW] PERFORMANCE FIX: Fast Participant Counting
-- This replaces the slow JavaScript loop in your API
CREATE OR REPLACE FUNCTION get_event_participant_counts(event_ids uuid[])
RETURNS TABLE (event_id uuid, approved_count bigint)
LANGUAGE sql
AS $$
  SELECT event_id, count(*) as approved_count
  FROM participants
  WHERE status = 'approved'
  AND event_id = ANY(event_ids)
  GROUP BY event_id;
$$;

-- [NEW] Function to safely fetch public club details (bypassing RLS)
CREATE OR REPLACE FUNCTION get_public_clubs()
RETURNS TABLE (
  user_id UUID,
  club_name TEXT,
  club_logo_url TEXT
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    au.user_id, 
    au.club_name, 
    au.club_logo_url
  FROM admin_users au
  WHERE au.club_name IS NOT NULL;
END;
$$;

-- [NEW] Advanced Event Search & Filtering
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

-- [NEW] Get Upcoming Events (Optimized)
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
    club_name TEXT,
    club_logo_url TEXT
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

-- ====================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE problem_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Events are viewable by everyone" ON events;
DROP POLICY IF EXISTS "Admins can create events" ON events;
DROP POLICY IF EXISTS "Event owners or super admins can update events" ON events;
DROP POLICY IF EXISTS "Event owners or super admins can delete events" ON events;
DROP POLICY IF EXISTS "Public read problem statements" ON problem_statements;
DROP POLICY IF EXISTS "Admins manage problem statements" ON problem_statements;
DROP POLICY IF EXISTS "Participants can be created by authenticated users" ON participants;
DROP POLICY IF EXISTS "Admins can view participants for events they own" ON participants;
DROP POLICY IF EXISTS "Users can view their own participant records" ON participants;
DROP POLICY IF EXISTS "Participants can view event peers" ON participants;
DROP POLICY IF EXISTS "Admins can update participants for events they own" ON participants;
DROP POLICY IF EXISTS "Participants can update their own record" ON participants;
DROP POLICY IF EXISTS "Contact submissions can be created by anyone" ON contact_submissions;
DROP POLICY IF EXISTS "Contact submissions are viewable by admins" ON contact_submissions;
DROP POLICY IF EXISTS "Authenticated users can read their own admin status" ON admin_users;
DROP POLICY IF EXISTS "Admins can update their own profile" ON admin_users;
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can create and update their own profile" ON profiles;

-- Events Policies
CREATE POLICY "Events are viewable by everyone" ON events FOR SELECT USING (true);
CREATE POLICY "Admins can create events" ON events FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.get_admin_role() IS NOT NULL);
CREATE POLICY "Event owners or super admins can update events" ON events FOR UPDATE USING (public.get_admin_role() = 'super_admin' OR created_by = auth.uid());
CREATE POLICY "Event owners or super admins can delete events" ON events FOR DELETE USING (public.get_admin_role() = 'super_admin' OR created_by = auth.uid());

-- Problem Statements Policies
CREATE POLICY "Public read problem statements" ON problem_statements FOR SELECT USING (true);
CREATE POLICY "Admins manage problem statements" ON problem_statements FOR ALL USING (public.get_admin_role() IS NOT NULL);

-- Participants Policies
CREATE POLICY "Participants can be created by authenticated users" ON participants FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Participants can view event peers" ON participants FOR SELECT USING (
    (public.get_admin_role() IS NOT NULL) OR
    (user_id = auth.uid()) OR
    (public.is_event_participant(event_id))
);
CREATE POLICY "Admins can update participants for events they own" ON participants FOR UPDATE USING (
    (public.get_admin_role() = 'super_admin') OR
    (EXISTS (SELECT 1 FROM events WHERE events.id = participants.event_id AND events.created_by = auth.uid()))
);
CREATE POLICY "Participants can update their own record" ON participants FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Contact & Admin Policies
CREATE POLICY "Contact submissions can be created by anyone" ON contact_submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Contact submissions are viewable by admins" ON contact_submissions FOR SELECT USING (public.get_admin_role() IS NOT NULL);
CREATE POLICY "Authenticated users can read their own admin status" ON admin_users FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can update their own profile" ON admin_users FOR UPDATE USING (public.get_admin_role() = 'super_admin' OR auth.uid() = user_id) WITH CHECK (public.get_admin_role() = 'super_admin' OR auth.uid() = user_id);
CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can create and update their own profile" ON profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Quiz Policies
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;

-- Quiz Questions: Public read (or auth read), Admin write
CREATE POLICY "Everyone can read quiz questions" ON quiz_questions FOR SELECT USING (true);
CREATE POLICY "Admins can manage quiz questions" ON quiz_questions FOR ALL USING (public.get_admin_role() IS NOT NULL);

-- Quiz Attempts: Users read/write own, Admins read all
CREATE POLICY "Users can view their own attempts" ON quiz_attempts FOR SELECT USING (auth.uid() = user_id);
-- [UPDATE] Allow users to update their own in-progress attempts (e.g. saving answers constantly)
CREATE POLICY "Users can update their own attempts" ON quiz_attempts FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can create their own attempts" ON quiz_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all attempts" ON quiz_attempts FOR SELECT USING (public.get_admin_role() IS NOT NULL);

-- ====================================================================
-- 5. REALTIME & STORAGE
-- ====================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_rel WHERE prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime') AND prrelid = 'participants'::regclass) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE participants;
    END IF;
    -- [NEW] Add events table to realtime for live status updates
    IF NOT EXISTS (SELECT 1 FROM pg_publication_rel WHERE prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime') AND prrelid = 'events'::regclass) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE events;
    END IF;
END $$;

INSERT INTO storage.buckets (id, name, public) VALUES ('event-banners', 'event-banners', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('club-logos', 'club-logos', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('ppt-templates', 'ppt-templates', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('submissions', 'submissions', false) ON CONFLICT (id) DO NOTHING;

-- Storage Policies
DROP POLICY IF EXISTS "Public Access Banners" ON storage.objects;
DROP POLICY IF EXISTS "Public Access Logos" ON storage.objects;
DROP POLICY IF EXISTS "Public Access PPT" ON storage.objects;
DROP POLICY IF EXISTS "Participants can upload submissions" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view submissions" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own submissions" ON storage.objects;
DROP POLICY IF EXISTS "Admin Upload Objects" ON storage.objects;
DROP POLICY IF EXISTS "Admin Update Objects" ON storage.objects;
DROP POLICY IF EXISTS "Admin Delete Objects" ON storage.objects;

CREATE POLICY "Public Access Banners" ON storage.objects FOR SELECT USING (bucket_id = 'event-banners');
CREATE POLICY "Public Access Logos" ON storage.objects FOR SELECT USING (bucket_id = 'club-logos');
CREATE POLICY "Public Access PPT" ON storage.objects FOR SELECT USING (bucket_id = 'ppt-templates');
CREATE POLICY "Participants can upload submissions" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'submissions' AND auth.uid() = owner);
CREATE POLICY "Admins can view submissions" ON storage.objects FOR SELECT USING (bucket_id = 'submissions' AND public.get_admin_role() IS NOT NULL);
CREATE POLICY "Users can view own submissions" ON storage.objects FOR SELECT USING (bucket_id = 'submissions' AND auth.uid() = owner);
CREATE POLICY "Admin Upload Objects" ON storage.objects FOR INSERT WITH CHECK (public.get_admin_role() IS NOT NULL);
CREATE POLICY "Admin Update Objects" ON storage.objects FOR UPDATE USING (public.get_admin_role() IS NOT NULL);
CREATE POLICY "Admin Delete Objects" ON storage.objects FOR DELETE USING (public.get_admin_role() IS NOT NULL);

-- ====================================================================
-- 7. INDEXES & TRIGGERS
-- ====================================================================
-- Single Column Indexes
CREATE INDEX IF NOT EXISTS idx_events_is_active ON events(is_active);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_participants_event_id ON participants(event_id);
CREATE INDEX IF NOT EXISTS idx_participants_user_id ON participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_status ON participants(status);
-- [NEW] Index for homepage filtering
CREATE INDEX IF NOT EXISTS idx_events_dates_filtering ON events(is_active, registration_open, event_end_date, registration_start);

-- [NEW] Composite Indexes for Query Optimization
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_event_user ON participants(event_id, user_id);
CREATE INDEX IF NOT EXISTS idx_participants_status_event ON participants(status, event_id);
CREATE INDEX IF NOT EXISTS idx_events_active_created ON events(is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON admin_users(user_id);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, phone_number)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', null);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ====================================================================
-- 8. AUTOMATIC STATUS UPDATES (CRON & TRIGGERS)
-- ====================================================================

-- Function: Trigger to update status on row change
CREATE OR REPLACE FUNCTION public.update_event_status_on_change()
RETURNS TRIGGER AS $$
DECLARE
    now_ts TIMESTAMP WITH TIME ZONE := NOW();
    new_registration_open BOOLEAN;
    new_is_active BOOLEAN;
BEGIN
    -- Determine new registration_open status
    IF NEW.registration_end IS NOT NULL AND NEW.registration_end < now_ts THEN
        new_registration_open := false;
    ELSE
        new_registration_open := NEW.registration_open;
    END IF;
    
    -- Determine new is_active status
    IF NEW.event_end_date IS NOT NULL AND NEW.event_end_date < now_ts THEN
        new_is_active := false;
    ELSE
        new_is_active := NEW.is_active;
    END IF;
    
    -- Only update if values actually changed
    IF new_registration_open != NEW.registration_open OR new_is_active != NEW.is_active THEN
        NEW.registration_open := new_registration_open;
        NEW.is_active := new_is_active;
        NEW.updated_at := now_ts;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger definition
DROP TRIGGER IF EXISTS trigger_update_event_status ON events;
CREATE TRIGGER trigger_update_event_status
    BEFORE INSERT OR UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION public.update_event_status_on_change();

-- Function: Batch update all expired events (for Cron/RPC)
CREATE OR REPLACE FUNCTION public.update_all_expired_events()
RETURNS TABLE (
    event_id UUID,
    title TEXT,
    registration_closed BOOLEAN,
    event_deactivated BOOLEAN
) AS $$
DECLARE
    now_ts TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
    RETURN QUERY
    WITH updated_events AS (
        UPDATE events
        SET 
            registration_open = CASE 
                WHEN registration_end IS NOT NULL AND registration_end < now_ts THEN false 
                ELSE registration_open 
            END,
            is_active = CASE 
                WHEN event_end_date IS NOT NULL AND event_end_date < now_ts THEN false 
                ELSE is_active 
            END,
            updated_at = CASE 
                WHEN (registration_end IS NOT NULL AND registration_end < now_ts AND registration_open = true)
                   OR (event_end_date IS NOT NULL AND event_end_date < now_ts AND is_active = true)
                THEN now_ts
                ELSE updated_at
            END
        WHERE 
            (registration_end IS NOT NULL AND registration_end < now_ts AND registration_open = true)
            OR (event_end_date IS NOT NULL AND event_end_date < now_ts AND is_active = true)
        RETURNING 
            id,
            events.title,
            (registration_end IS NOT NULL AND registration_end < now_ts) as registration_was_closed,
            (event_end_date IS NOT NULL AND event_end_date < now_ts) as event_was_deactivated
    )
    SELECT 
        updated_events.id,
        updated_events.title,
        updated_events.registration_was_closed,
        updated_events.event_was_deactivated
    FROM updated_events;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.update_all_expired_events() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_all_expired_events() TO service_role;