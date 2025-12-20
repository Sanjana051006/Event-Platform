
import { createClient, supabaseAdmin } from '@/lib/supabase/server';
import HomeClient from './HomeClient';
import { parseISO } from 'date-fns';

export const metadata = {
  title: 'EventX - Campus Event Hub',
  description: 'Discover and manage hackathons, workshops, and tech events from all clubs on campus.',
};

// [OPTIMIZED] Enable ISR (Incremental Static Regeneration)
// Revalidate this page every 60 seconds. This prevents hitting the DB on every request.
export const revalidate = 60;

export default async function Home() {
  // Use supabaseAdmin to bypass RLS for fetching public club data
  // Fallback to createClient() if admin key not configured (though it should be)
  const supabase = supabaseAdmin || createClient();

  // 1. Parallel Fetching for Performance
  // [OPTIMIZED] Use RPC 'get_upcoming_events' to filter data on the database side
  // This drastically reduces data transfer and avoids "N+1" style client-side filtering
  const eventsPromise = supabase.rpc('get_upcoming_events', { limit_count: 3 });

  // Use RPC to bypass RLS for fetching public club data
  const clubsPromise = supabase.rpc('get_public_clubs');

  const [eventsResult, clubsResult] = await Promise.all([eventsPromise, clubsPromise]);

  const rawEvents = eventsResult.data || [];
  const clubsData = clubsResult.data || [];

  // 2. Map Events to Structure Expected by Client
  // The RPC returns flat club data, but EventCard expects a nested 'club' object
  const upcomingEvents = rawEvents.map(event => ({
    ...event,
    club: {
      club_name: event.club_name,
      club_logo_url: event.club_logo_url
    }
  }));

  // 3. Uniquify Clubs for the "Browse by Club" section
  // Filter out duplicates based on club_name
  const uniqueClubs = [
      ...new Map(clubsData.map((club) => [club.club_name, club])).values()
  ].sort((a, b) => a.club_name.localeCompare(b.club_name));

  return <HomeClient upcomingEvents={upcomingEvents} clubs={uniqueClubs} />;
}