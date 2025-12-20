import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendContactEmailToAdmin } from "@/lib/email";
import { jwtVerify } from "jose"; // [FIX] Efficient Auth

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// [FIX] JWT Secret for local verification
const JWT_SECRET = new TextEncoder().encode(
  process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET
);

// Helper function to extract path segments
function getPathSegments(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace("/api/", "");
  const segments = pathname.split("/").filter(Boolean);
  return segments;
}

// Helper function to get query params
function getQueryParams(request) {
  const url = new URL(request.url);
  return Object.fromEntries(url.searchParams.entries());
}

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// [FIX] New Optimized Auth Verification
// Verifies token locally without making a DB call
async function verifyAuth(request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { user: null, error: "Missing token" };
  }

  const token = authHeader.split(" ")[1];
  
  // 1. Try Local Verification (Fast)
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const user = {
      id: payload.sub,
      email: payload.email,
      app_metadata: payload.app_metadata || {},
      user_metadata: payload.user_metadata || {},
    };
    return { user, error: null };
  } catch (err) {
    // 2. Fallback to Supabase API (Slower but works if secret is missing/rotated)
    // console.warn("[Auth] Local verification failed, using Supabase API:", err.message);
    
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !user) {
      console.error("[Auth] Token verification failed:", error?.message || "User not found");
      return { user: null, error: "Invalid token" };
    }
    
    return { user, error: null };
  }
}

// Helper to get admin user (Optimized to verify token locally first)
async function getAdminUser(request) {
  const { user, error } = await verifyAuth(request);

  if (error || !user) {
    return { user: null, role: null, error: new Error(error || "Unauthorized") };
  }

  // Use the Admin client to check the role in the database
  const { data: adminData, error: roleError } = await supabaseAdmin
    .from("admin_users")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError) {
    return { user, role: null, error: roleError };
  }

  if (!adminData) {
    return { user, role: null, error: new Error("User is not an admin.") };
  }

  return { user, role: adminData.role, error: null };
}

// =================================================================================
// GET HANDLER
// =================================================================================
export async function GET(request) {
  try {
    const segments = getPathSegments(request);
    const params = getQueryParams(request);

    // [FIX] NEW ROUTE: Manual Cleanup or CRON target
    // Moved out of GET /events to prevent DB Hammering
    if (segments[0] === "cron" && segments[1] === "cleanup") {
      const now = new Date().toISOString();
      const { data: completedEventIds } = await supabaseAdmin
          .from("events")
          .select("id")
          .lt("event_end_date", now);

      if (completedEventIds && completedEventIds.length > 0) {
          await supabaseAdmin
            .from("participants")
            .delete()
            .eq("status", "pending")
            .in("event_id", completedEventIds.map((e) => e.id));
          
          return NextResponse.json({ success: true, cleaned: completedEventIds.length }, { headers: corsHeaders });
      }
      return NextResponse.json({ success: true, cleaned: 0 }, { headers: corsHeaders });
    }

    // [NEW] ROUTE: Update expired events - automatically close registrations and deactivate events
    // This uses the update_all_expired_events RPC function for realtime-compatible updates
    if (segments[0] === "cron" && segments[1] === "update-events") {
      try {
        // Call the RPC function to update all expired events
        const { data: updatedEvents, error: rpcError } = await supabaseAdmin
          .rpc('update_all_expired_events');
        
        if (rpcError) {
          // If RPC doesn't exist, fall back to direct update
          console.log("[CRON] RPC not found, using direct update:", rpcError.message);
          
          const now = new Date().toISOString();
          
          // Update registration_open for events where registration_end has passed
          const { data: regClosed, error: regError } = await supabaseAdmin
            .from("events")
            .update({ registration_open: false, updated_at: now })
            .lt("registration_end", now)
            .eq("registration_open", true)
            .select("id, title");
          
          // Update is_active for events where event_end_date has passed
          const { data: eventsDeactivated, error: activeError } = await supabaseAdmin
            .from("events")
            .update({ is_active: false, updated_at: now })
            .lt("event_end_date", now)
            .eq("is_active", true)
            .select("id, title");
          
          return NextResponse.json({ 
            success: true, 
            method: "direct_update",
            registrations_closed: regClosed?.length || 0,
            events_deactivated: eventsDeactivated?.length || 0,
            details: {
              registration_closed: regClosed || [],
              events_deactivated: eventsDeactivated || []
            }
          }, { headers: corsHeaders });
        }
        
        return NextResponse.json({ 
          success: true, 
          method: "rpc",
          updated_events: updatedEvents?.length || 0,
          details: updatedEvents || []
        }, { headers: corsHeaders });
      } catch (err) {
        console.error("[CRON] Update events error:", err);
        return NextResponse.json({ 
          success: false, 
          error: err.message 
        }, { status: 500, headers: corsHeaders });
      }
    }

    // GET /api/clubs
    if (segments[0] === "clubs" && !segments[1]) {
      const { data, error } = await supabaseAdmin
        .from("admin_users")
        .select("club_name, club_logo_url")
        .not("club_name", "is", null)
        .not("club_name", "eq", "")
        .not("club_logo_url", "is", null)
        .not("club_logo_url", "eq", "");

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }

      const uniqueClubs = data.reduce((acc, club) => {
        if (!acc.find((item) => item.club_name === club.club_name)) {
          acc.push(club);
        }
        return acc;
      }, []);

      return NextResponse.json(
        { success: true, clubs: uniqueClubs },
        { headers: corsHeaders },
      );
    }

    // GET /api/events - [FIXED & OPTIMIZED]
    if (segments[0] === "events" && !segments[1]) {
      // 1. Fetch Events (Select specific fields to reduce bandwidth)
      let query = supabaseAdmin
        .from("events")
        .select(
          `
          id, title, description, event_date, event_end_date, banner_url,
          is_active, registration_open, is_paid, registration_fee, event_type,
          registration_start, registration_end,
          created_by,
          club:created_by(club_name, club_logo_url)
        `
        )
        .order("created_at", { ascending: false });

      if (params.active === "true") {
        query = query.eq("is_active", true);
      }

      if (params.limit) {
        query = query.limit(parseInt(params.limit));
      }

      const { data: events, error } = await query;

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }

      // 2. Fetch Counts using FAST RPC (Replaces slow loop)
      if (events && events.length > 0) {
        const eventIds = events.map((e) => e.id);
        
        // Use the new SQL function
        const { data: counts, error: countError } = await supabaseAdmin
          .rpc('get_event_participant_counts', { event_ids: eventIds });

        const countMap = {};
        if (counts) {
            counts.forEach(c => { countMap[c.event_id] = c.approved_count; });
        }

        events.forEach((e) => {
          e.approved_count = countMap[e.id] || 0;
        });
      }

      // [FIX] Add Caching Headers
      const cacheHeaders = {
          ...corsHeaders,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      };

      return NextResponse.json(
        { success: true, events: events },
        { headers: cacheHeaders },
      );
    }

    // GET /api/events/:id
    if (segments[0] === "events" && segments[1]) {
      const { data, error } = await supabaseAdmin
        .from("events")
        .select(
          `
          *,
          created_by,
          club:created_by(club_name, club_logo_url)
        `,
        )
        .eq("id", segments[1])
        .single();

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 404, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        { success: true, event: data },
        { headers: corsHeaders },
      );
    }

    // GET /api/profile
    if (segments[0] === "profile") {
      const { user, error: authError } = await verifyAuth(request);

      if (!user) {
        return NextResponse.json(
          { success: false, error: authError || "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("name, phone_number, created_at, updated_at")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        { success: true, profile: { ...(data || {}), email: user.email } },
        { headers: corsHeaders },
      );
    }

    // GET /api/participants/count
    if (segments[0] === "participants" && segments[1] === "count") {
      const { count, error } = await supabaseAdmin
        .from("participants")
        .select("*", { count: "exact", head: true });

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        { success: true, count },
        { headers: corsHeaders },
      );
    }

    // GET /api/events/:eventId/scope-status
    if (segments[0] === "events" && segments[1] && segments[2] === "scope-status") {
      const eventId = segments[1];
      const { user, error: authError } = await verifyAuth(request);

      if (authError || !user) {
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      // Get event details
      const { data: event } = await supabaseAdmin
        .from("events")
        .select("event_date, problem_selection_start, problem_selection_end, ppt_release_time, submission_start, submission_end, ppt_template_url")
        .eq("id", eventId)
        .single();

      if (!event) {
        return NextResponse.json(
          { success: false, error: "Event not found" },
          { status: 404, headers: corsHeaders },
        );
      }

      // Get participant record
      const { data: participant } = await supabaseAdmin
        .from("participants")
        .select("selected_problem_id, submission_data, submitted_at, status")
        .eq("event_id", eventId)
        .eq("user_id", user.id)
        .eq("status", "approved")
        .maybeSingle();

      if (!participant) {
        return NextResponse.json(
          { success: false, error: "Not registered or not approved", isApproved: false },
          { status: 403, headers: corsHeaders },
        );
      }

      const now = new Date();
      const phases = {
        problem_selection: false,
        ppt_available: false,
        submission_open: false,
      };

      const selectionStart = event.problem_selection_start || event.event_date;
      if (selectionStart) {
        const start = new Date(selectionStart);
        const end = event.problem_selection_end ? new Date(event.problem_selection_end) : null;
        phases.problem_selection = now >= start && (!end || now <= end);
      }

      const pptStart = event.ppt_release_time || event.event_date;
      if (pptStart) {
        phases.ppt_available = now >= new Date(pptStart);
      }

      const subStart = event.submission_start || event.event_date;
      if (subStart) {
        const start = new Date(subStart);
        const end = event.submission_end ? new Date(event.submission_end) : null;
        phases.submission_open = now >= start && (!end || now <= end);
      }
      
      const noCacheHeaders = {
        ...corsHeaders,
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
      };
      
      return NextResponse.json(
        {
          success: true,
          isApproved: true,
          phases,
          participant: {
            selected_problem_id: participant.selected_problem_id,
            has_submitted: !!participant.submitted_at,
          },
          event: { ppt_template_url: event.ppt_template_url },
        },
        { headers: noCacheHeaders },
      );
    }

    // GET /api/participants/:eventId
    if (segments[0] === "participants" && segments[1]) {
      const eventId = segments[1];

      // User checking their own registration
      if (params.userId) {
        const { user, error: authError } = await verifyAuth(request);

        if (authError || !user || user.id !== params.userId) {
          return NextResponse.json(
            { success: false, error: "Forbidden" },
            { status: 403, headers: corsHeaders },
          );
        }

        const { data, error } = await supabaseAdmin
          .from("participants")
          .select("*")
          .eq("event_id", eventId)
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });

        if (error) {
          return NextResponse.json(
            { success: false, error: error.message },
            { status: 500, headers: corsHeaders },
          );
        }
        return NextResponse.json(
          { success: true, participants: data },
          { headers: corsHeaders },
        );
      } else {
        // ADMIN request
        const { user, role, error: adminError } = await getAdminUser(request);
        if (adminError || !user) {
          return NextResponse.json(
            { success: false, error: adminError?.message || "Unauthorized" },
            { status: 401, headers: corsHeaders },
          );
        }

        const { data: eventData, error: eventError } = await supabaseAdmin
          .from("events")
          .select("created_by")
          .eq("id", eventId)
          .single();

        if (eventError) {
          return NextResponse.json(
            { success: false, error: "Event not found" },
            { status: 404, headers: corsHeaders },
          );
        }

        const canManage = role === "super_admin" || eventData.created_by === user.id;

        if (!canManage) {
          return NextResponse.json(
            { success: false, error: "Forbidden: You do not own this event" },
            { status: 403, headers: corsHeaders },
          );
        }

        const { data, error } = await supabaseAdmin
          .from("participants")
          .select("*")
          .eq("event_id", eventId)
          .order("created_at", { ascending: false });

        if (error) {
          return NextResponse.json(
            { success: false, error: error.message },
            { status: 500, headers: corsHeaders },
          );
        }

        // Enrich with profile data and auth email
        const userIds = data.map(p => p.user_id).filter(Boolean);
        if (userIds.length > 0) {
            // 1. Fetch Profiles
            const { data: profiles } = await supabaseAdmin
                .from("profiles")
                .select("id, name")
                .in("id", userIds);
            
            const profileMap = {};
            if (profiles) {
                profiles.forEach(p => { profileMap[p.id] = p; });
            }

            // 2. Fetch Auth Users (Emails) - Limit 1000 for now
            const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
                page: 1,
                perPage: 1000
            });

            const emailMap = {};
            if (users) {
                users.forEach(u => { emailMap[u.id] = u.email; });
            }

            data.forEach(p => {
                const profile = profileMap[p.user_id];
                p.profile = profile;
                p.participant_name = profile?.name || p.responses?.['Name'] || p.responses?.['name'] || 'N/A';
                // Prefer auth email, fallback to response email
                p.participant_email = emailMap[p.user_id] || p.responses?.['Email'] || p.responses?.['email'] || 'N/A';
            });
        }

        return NextResponse.json(
          { success: true, participants: data },
          { headers: corsHeaders },
        );
      }
    }

    // GET /api/participants/pending - [NEW] Admin view pending registrations
    if (segments[0] === "participants" && segments[1] === "pending") {
      const { user, role, error: adminError } = await getAdminUser(request);
      if (adminError || !user) {
        return NextResponse.json(
          { success: false, error: adminError?.message || "Unauthorized" },
          { status: 401, headers: corsHeaders }
        );
      }

      // [OPTIMIZED] Single query with JOIN to fetch event details
      let query = supabaseAdmin
        .from("participants")
        .select(`
          *,
          event:events!inner(
            id,
            title,
            created_by,
            form_fields
          )
        `)
        .order("created_at", { ascending: false });

      // Filter based on role
      if (role !== "super_admin") {
        // Regular admins only see registrations for their events
        query = query.eq("event.created_by", user.id);
      }

      const { data, error } = await query;

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders }
        );
      }

      return NextResponse.json(
        { success: true, participants: data },
        { headers: corsHeaders }
      );
    }

    if (segments.length === 0) {
      return NextResponse.json(
        { message: "IEEE Club API - OK" },
        { headers: corsHeaders },
      );
    }

    return NextResponse.json(
      { success: false, error: "Route not found" },
      { status: 404, headers: corsHeaders },
    );
  } catch (error) {
    console.error("GET Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders },
    );
  }
}

// =================================================================================
// POST HANDLER
// =================================================================================
export async function POST(request) {
  try {
    const segments = getPathSegments(request);
    const body = await request.json();

    // POST /api/admin/users/:action
    if (segments[0] === "admin" && segments[1] === "users") {
      const { user, role, error: adminError } = await getAdminUser(request);
      if (adminError || !user) {
        return NextResponse.json(
          { success: false, error: adminError?.message || "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      if (role !== "super_admin") {
        return NextResponse.json(
          { success: false, error: "Requires Super Admin privileges" },
          { status: 403, headers: corsHeaders },
        );
      }

      const action = segments[2];

      if (action === "invite") {
        const { email } = body;
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
        if (error) throw error;
        return NextResponse.json({ success: true, user: data.user }, { headers: corsHeaders });
      }

      if (action === "confirm") {
        const { user_id } = body;
        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(user_id, { email_confirm: true });
        if (error) throw error;
        return NextResponse.json({ success: true, user: data.user }, { headers: corsHeaders });
      }

      if (action === "generate_link") {
        const { type, email } = body;
        const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type, email });
        if (error) throw error;
        return NextResponse.json({ success: true, link: data.properties, url: data.properties.action_link }, { headers: corsHeaders });
      }

      if (action === "update_password") {
        const { user_id, password } = body;
        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(user_id, { password });
        if (error) throw error;
        return NextResponse.json({ success: true, user: data.user }, { headers: corsHeaders });
      }

      return NextResponse.json({ success: false, error: "Unknown admin action" }, { status: 404, headers: corsHeaders });
    }

    // POST /api/events
    if (segments[0] === "events" && !segments[1]) {
      const { user, role, error: adminError } = await getAdminUser(request);
      if (adminError || !user) {
        return NextResponse.json(
          { success: false, error: adminError?.message || "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      const eventData = {
        title: body.title,
        description: body.description,
        banner_url: body.banner_url,
        event_date: body.event_date || null,
        event_end_date: body.event_end_date || null,
        is_active: body.is_active !== undefined ? body.is_active : false,
        registration_open: body.registration_open !== undefined ? body.registration_open : true,
        registration_start: body.registration_start || null,
        registration_end: body.registration_end || null,
        is_paid: body.is_paid !== undefined ? body.is_paid : false,
        registration_fee: body.registration_fee !== undefined ? body.registration_fee : 0,
        event_type: body.event_type || "other",
        problem_selection_start: body.problem_selection_start || null,
        problem_selection_end: body.problem_selection_end || null,
        ppt_template_url: body.ppt_template_url || null,
        ppt_release_time: body.ppt_release_time || null,
        submission_start: body.submission_start || null,
        submission_end: body.submission_end || null,
        submission_form_fields: body.submission_form_fields || [],
        form_fields: body.form_fields || [],
        created_by: user.id,
      };

      const { data, error } = await supabaseAdmin
        .from("events")
        .insert([eventData])
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        { success: true, event: data },
        { headers: corsHeaders },
      );
    }

    // POST /api/participants
    if (segments[0] === "participants" && !segments[1]) {
      console.log("[Participants API] Received registration request", body);

      let participantUserId = body.user_id;

      // Try verifying via token if body.user_id not trusted (or logic requires it)
      // Here we trust the token first
      const { user, error: authError } = await verifyAuth(request);
      if (!authError && user) {
          participantUserId = user.id;
      }

      if (!participantUserId) {
        return NextResponse.json(
          { success: false, error: "Unauthorized: Missing user ID" },
          { status: 401, headers: corsHeaders },
        );
      }

      const { data: existingReg } = await supabaseAdmin
        .from("participants")
        .select("id, status")
        .eq("event_id", body.event_id)
        .eq("user_id", participantUserId)
        .in("status", ["pending", "approved"])
        .maybeSingle();

      if (existingReg) {
        return NextResponse.json(
          {
            success: false,
            error: `You already have a ${existingReg.status} registration for this event.`,
          },
          { status: 409, headers: corsHeaders },
        );
      }

      const participantData = {
        event_id: body.event_id,
        user_id: participantUserId,
        responses: body.responses,
        status: "approved",
        email: user.email, // [NEW] Store User Email
      };

      console.log(`[Participans API] Attempting registration for Event: ${body.event_id}, Key User: ${participantUserId}`);

      const { data, error } = await supabaseAdmin
        .from("participants")
        .insert([participantData])
        .select()
        .single();

      if (error) {
        console.error(`[Participants API] DB Insert Error: ${error.message}`);
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }
      
      console.log(`[Participants API] Registration successful. ID: ${data?.id}`);




      return NextResponse.json(
        { success: true, participant: data },
        { headers: corsHeaders },
      );
    }

    // POST /api/events/:eventId/select-problem
    if (segments[0] === "events" && segments[1] && segments[2] === "select-problem") {
      const eventId = segments[1];
      const { user, error: authError } = await verifyAuth(request);

      if (authError || !user) {
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      const { problem_id } = body;

      const { data, error } = await supabaseAdmin.rpc(
        "check_and_select_problem",
        {
          p_user_id: user.id,
          p_event_id: eventId,
          p_problem_id: problem_id,
        },
      );

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 400, headers: corsHeaders },
        );
      }

      if (!data) {
        return NextResponse.json(
          { success: false, error: "Problem statement is full or already selected" },
          { status: 409, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        { success: true, message: "Problem selected successfully" },
        { headers: corsHeaders },
      );
    }

    // POST /api/events/:eventId/submit-project
    if (segments[0] === "events" && segments[1] && segments[2] === "submit-project") {
      const eventId = segments[1];
      const { user, error: authError } = await verifyAuth(request);

      if (authError || !user) {
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      const { submission_data } = body;

      const { data, error } = await supabaseAdmin
        .from("participants")
        .update({
          submission_data: submission_data,
          submitted_at: new Date().toISOString(),
        })
        .eq("event_id", eventId)
        .eq("user_id", user.id)
        .eq("status", "approved")
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        { success: true, submission: data },
        { headers: corsHeaders },
      );
    }

    // POST /api/contact
    if (segments[0] === "contact") {
      const contactData = { name: body.name, email: body.email, message: body.message };

      const { data, error } = await supabaseAdmin
        .from("contact_submissions")
        .insert([contactData])
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }

      // Async email
      sendContactEmailToAdmin({ fromName: contactData.name, fromEmail: contactData.email, message: contactData.message }).catch(console.error);

      return NextResponse.json(
        { success: true, submission: data },
        { headers: corsHeaders },
      );
    }

    return NextResponse.json(
      { success: false, error: "Route not found" },
      { status: 404, headers: corsHeaders },
    );
  } catch (error) {
    console.error("POST Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders },
    );
  }
}

// =================================================================================
// PUT HANDLER
// =================================================================================
export async function PUT(request) {
  try {
    const segments = getPathSegments(request);

    // PUT /api/profile
    if (segments[0] === "profile") {
      const body = await request.json();
      const { user, error: authError } = await verifyAuth(request);

      if (authError || !user) {
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      const updateData = {
        id: user.id,
        name: body.name,
        phone_number: body.phone_number,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin
        .from("profiles")
        .upsert(updateData)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        { success: true, profile: data },
        { headers: corsHeaders },
      );
    }

    // PUT /api/admin/club-profile - [NEW]
    if (segments[0] === "admin" && segments[1] === "club-profile") {
      const body = await request.json();
      // Use getAdminUser to verify admin status
      const { user, error: adminError } = await getAdminUser(request);
      
      if (adminError || !user) {
        return NextResponse.json(
          { success: false, error: adminError?.message || "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      const updates = {
        club_name: body.club_name,
        club_logo_url: body.club_logo_url,
        razorpay_key_id: body.razorpay_key_id,
        updated_at: new Date().toISOString(),
      };

      // Only update secret if provided
      if (body.razorpay_key_secret) {
        updates.razorpay_key_secret = body.razorpay_key_secret;
      }

      const { data, error } = await supabaseAdmin
        .from("admin_users")
        .update(updates)
        .eq("user_id", user.id)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        { success: true, profile: data },
        { headers: corsHeaders },
      );
    }

    // PUT /api/events/:id
    if (segments[0] === "events" && segments[1]) {
      const body = await request.json();
      const eventId = segments[1];

      const { user, role, error: adminError } = await getAdminUser(request);
      if (adminError || !user) {
        return NextResponse.json(
          { success: false, error: adminError?.message || "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      const { data: eventData, error: eventError } = await supabaseAdmin
        .from("events")
        .select("created_by")
        .eq("id", eventId)
        .single();

      if (eventError) {
        return NextResponse.json(
          { success: false, error: "Event not found" },
          { status: 404, headers: corsHeaders },
        );
      }

      const canManage = role === "super_admin" || eventData.created_by === user.id;

      if (!canManage) {
        return NextResponse.json(
          { success: false, error: "Forbidden: You do not own this event" },
          { status: 403, headers: corsHeaders },
        );
      }

      const updateData = { ...body, updated_at: new Date().toISOString() };
      // Prevent id overwrite
      delete updateData.id;
      delete updateData.created_by;
      
      const { data, error } = await supabaseAdmin
        .from("events")
        .update(updateData)
        .eq("id", eventId)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        { success: true, event: data },
        { headers: corsHeaders },
      );
    }

    return NextResponse.json(
      { success: false, error: "Route not found" },
      { status: 404, headers: corsHeaders },
    );
  } catch (error) {
    console.error("PUT Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders },
    );
  }
}

// =================================================================================
// DELETE HANDLER
// =================================================================================
export async function DELETE(request) {
  try {
    const segments = getPathSegments(request);

    // DELETE /api/admin/users/delete
    if (segments[0] === "admin" && segments[1] === "users" && segments[2] === "delete") {
      const body = await request.json();
      const { role, error } = await getAdminUser(request);
      if (error || role !== "super_admin") {
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 403, headers: corsHeaders },
        );
      }

      const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(body.user_id);
      if (delError) {
        return NextResponse.json(
          { success: false, error: delError.message },
          { status: 500, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        { success: true, message: "User deleted" },
        { headers: corsHeaders },
      );
    }

    // DELETE /api/events/:id/problems/:problemId - [NEW] Delete Problem
    if (segments[0] === "events" && segments[1] && segments[2] === "problems" && segments[3]) {
        const problemId = segments[3];
        
        const { user, error: adminError } = await getAdminUser(request);
        if (adminError || !user) {
            return NextResponse.json(
              { success: false, error: adminError?.message || "Unauthorized" },
              { status: 401, headers: corsHeaders },
            );
        }

        const { error } = await supabaseAdmin
            .from('problem_statements')
            .delete()
            .eq('id', problemId);

        if (error) {
            return NextResponse.json(
              { success: false, error: error.message },
              { status: 500, headers: corsHeaders },
            );
        }

        return NextResponse.json(
          { success: true, message: "Problem deleted successfully" },
          { headers: corsHeaders },
        );
    }

    // POST /api/events/:id/quiz - [NEW] Manage Quiz (Fetch, Create, Update, Delete)
    if (segments[0] === "events" && segments[1] && segments[2] === "quiz" && request.method === "POST") {
        const eventId = segments[1];
        
        // This endpoint logic is a bit unusual in the frontend: 
        // fetchQuestions uses GET (but here we check for POST?). 
        // Wait, the frontend uses POST for save/delete but what about fetch?
        // Let's check frontend again.
        // Frontend: `fetchQuestions` does `fetch(/api/events/${eventId}/quiz` (default method GET).
        // Frontend: `handleSave` uses POST with action: 'create'/'update'.
        // Frontend: `handleDelete` uses POST with action: 'delete'.
        
        // So we need to handle both GET and POST. 
        // But this block is inside a monolithic route.js, so request.method check matters.
    }
    
    // GET /api/events/:id/quiz - [NEW] Fetch Questions
    if (segments[0] === "events" && segments[1] && segments[2] === "quiz" && request.method === "GET") {
        const eventId = segments[1];
        const { user, error: adminError } = await getAdminUser(request);
         if (adminError || !user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const { data, error } = await supabaseAdmin
            .from('quiz_questions')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: true });

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }
        return NextResponse.json({ success: true, questions: data });
    }

    // POST /api/events/:id/quiz - [NEW] Manage Questions (Create/Update/Delete)
    if (segments[0] === "events" && segments[1] && segments[2] === "quiz" && request.method === "POST") {
        const eventId = segments[1];
        const body = await request.json();
        const { action, question } = body;
        
        const { user, error: adminError } = await getAdminUser(request);
        if (adminError || !user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        let result;
        let error;

        if (action === 'create') {
            const { data, error: insertError } = await supabaseAdmin
                .from('quiz_questions')
                .insert({
                    event_id: eventId,
                    question_text: question.question_text,
                    options: question.options,
                    correct_option_index: question.correct_option_index,
                    points: question.points
                })
                .select()
                .single();
            result = data;
            error = insertError;
        } else if (action === 'update') {
             const { data, error: updateError } = await supabaseAdmin
                .from('quiz_questions')
                .update({
                    question_text: question.question_text,
                    options: question.options,
                    correct_option_index: question.correct_option_index,
                    points: question.points
                })
                .eq('id', question.id)
                .select()
                .single();
            result = data;
            error = updateError;
        } else if (action === 'delete') {
             const { error: deleteError } = await supabaseAdmin
                .from('quiz_questions')
                .delete()
                .eq('id', question.id);
             error = deleteError;
             result = { success: true };
        }

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }
        return NextResponse.json({ success: true, question: result });
    }

    // DELETE /api/events/:id
    if (segments[0] === "events" && segments[1]) {
      const eventId = segments[1];
      const { user, role, error: adminError } = await getAdminUser(request);
      if (adminError || !user) {
        return NextResponse.json(
          { success: false, error: adminError?.message || "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      const { data: eventData, error: eventError } = await supabaseAdmin
        .from("events")
        .select("created_by")
        .eq("id", eventId)
        .single();

      if (eventError) {
        return NextResponse.json(
          { success: false, error: "Event not found" },
          { status: 404, headers: corsHeaders },
        );
      }

      const canManage = role === "super_admin" || eventData.created_by === user.id;

      if (!canManage) {
        return NextResponse.json(
          { success: false, error: "Forbidden: You do not own this event" },
          { status: 403, headers: corsHeaders },
        );
      }

      const { error } = await supabaseAdmin.from("events").delete().eq("id", eventId);

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        { success: true, message: "Event deleted successfully" },
        { headers: corsHeaders },
      );
    }

    return NextResponse.json(
      { success: false, error: "Route not found" },
      { status: 404, headers: corsHeaders },
    );
  } catch (error) {
    console.error("DELETE Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: corsHeaders },
    );
  }
}