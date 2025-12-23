import crypto from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase Admin Client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      eventId,
      userId,
      responses,
      userDetails,
    } = await request.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ success: false, message: "Missing payment details" }, { status: 400 });
    }

    // 1. Fetch Event Creator to get the Secret Key
    // Optimization: We could cache this, but for security, a DB call is safer.
    const { data: eventData, error: eventError } = await supabase
      .from("events")
      .select("created_by")
      .eq("id", eventId)
      .single();

    if (eventError || !eventData) throw new Error("Event not found");

    const { data: adminData, error: adminError } = await supabase
      .from("admin_users")
      .select("razorpay_key_secret")
      .eq("user_id", eventData.created_by)
      .single();

    if (adminError || !adminData?.razorpay_key_secret) {
      throw new Error("Payment configuration missing");
    }

    // 2. Verify Signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", adminData.razorpay_key_secret)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json(
        { success: false, message: "Invalid Payment Signature" },
        { status: 400 }
      );
    }

    // 3. Register/Update Participant (Robust UPSERT)
    // If the user tried before (pending) or is new, this handles it.
    // 'onConflict' ensures we don't get duplicate key errors if they are already in DB.
    
    const { error: dbError } = await supabase
      .from("participants")
      .upsert(
        {
          event_id: eventId,
          user_id: userId,
          responses: responses || {},
          status: "approved", // Auto-approved via payment
          
          // Payment Records
          payment_id: razorpay_payment_id,
          order_id: razorpay_order_id,
          payment_status: "paid",
          updated_at: new Date().toISOString(), // Track when they paid
          
          // [NEW] Store User Email
          email: userDetails?.email, 
        },
        { onConflict: "event_id, user_id" } // Update if exists, Insert if new
      );

    if (dbError) {
      console.error("DB Registration Error:", dbError);
      // Payment succeeded but DB failed. 
      // In a real app, you might log this to a 'failed_registrations' table or alert admin.
      return NextResponse.json(
        { success: false, message: "Payment verified but registration update failed. Please contact support." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Registration successful!",
    });

  } catch (error) {
    console.error("Verification Error:", error);
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}