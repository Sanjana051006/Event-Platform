-- ====================================================================
-- MANUAL PAYMENT VERIFICATION FUNCTION
-- ====================================================================
-- Usage:
-- Copy and run this ENTIRE block in your Supabase SQL Editor to create the function.
--
-- Then, to verify a user, wait for the success message and run:
-- SELECT manual_verify_payment_by_email('user@example.com', 'event-uuid', 'pay_id', 'order_id');

CREATE OR REPLACE FUNCTION manual_verify_payment_by_email(
    p_email TEXT,
    p_event_id UUID,
    p_payment_id TEXT,
    p_order_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Essential to access auth.users
SET search_path = public -- Safety: Force public schema
AS $$
DECLARE
    target_user_id UUID;
    result JSONB;
BEGIN
    -- 1. Find User ID by Email (Case Insensitive)
    SELECT id INTO target_user_id
    FROM auth.users
    WHERE email ILIKE p_email
    LIMIT 1;

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'User with email % not found', p_email;
    END IF;

    -- 2. Upsert Participant Record
    -- This will insert a new record if they haven't registered, 
    -- or update their existing record if they have.
    INSERT INTO participants (
        event_id,
        user_id,
        status,
        payment_status,
        payment_id,
        order_id,
        responses, -- Default empty if new
        updated_at
    )
    VALUES (
        p_event_id,
        target_user_id,
        'approved',
        'paid',
        p_payment_id,
        p_order_id,
        '{}'::jsonb, -- Empty responses if they haven't filled anything yet
        NOW()
    )
    ON CONFLICT (event_id, user_id)
    DO UPDATE SET
        status = 'approved',
        payment_status = 'paid',
        payment_id = EXCLUDED.payment_id,
        order_id = EXCLUDED.order_id,
        updated_at = NOW();

    -- 3. Return Success
    result := jsonb_build_object(
        'success', true,
        'message', 'Participant verified successfully',
        'user_id', target_user_id,
        'email', p_email
    );

    RETURN result;
END;
$$;
