
import { createClient } from '@/lib/supabase/server';
import EventsListClient from './EventsListClient';


export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Browse Events - EventX',
  description: 'Find and register for the latest hackathons, workshops, and club events.',
};

export default async function EventsPage({ searchParams }) {
  const supabase = createClient();
  const search = searchParams?.search || '';
  const filter = searchParams?.filter || 'all';
  const clubFilter = searchParams?.club || '';

  let events = [];
  let clubNames = [];

  try {
    // 1. Fetch Clubs (for the filter dropdown) - Cached/Fast RPC
    const clubsPromise = supabase.rpc('get_public_clubs');

    // 2. Fetch Events using the new Optimized RPC
    // This pushes all filtering logic to the database
    const eventsPromise = supabase.rpc('search_events', {
        search_term: search,
        filter_status: filter,
        club_name_filter: clubFilter,
        limit_count: 50, // Reasonable pagination limit
        offset_count: 0
    });

    const [clubsResult, eventsResult] = await Promise.all([clubsPromise, eventsPromise]);

    if (clubsResult.error) {
        console.error("Error fetching clubs:", clubsResult.error);
    }
    
    if (eventsResult.error) {
        console.error("Error fetching events:", eventsResult.error);
    }

    const clubsData = clubsResult.data || [];
    const rawEvents = eventsResult.data || [];

    // 3. Map Events to Client Structure
    // The RPC returns flat structure, client expects nested 'club' object
    events = rawEvents.map(event => ({
        ...event,
        club: {
            club_name: event.club_name,
            club_logo_url: event.club_logo_url
        }
    }));

    // Unique clubs list for the dropdown
    // We can just usage the fetched clubsData which is the source of truth for all available clubs
    clubNames = clubsData.map(c => c.club_name).sort();

  } catch (err) {
      console.error("Unexpected error in EventsPage:", err);
      // We could add a redirect or show an error state here, but for now we'll just render empty/partial
  }

  return (
    <EventsListClient 
      initialEvents={events}
      clubs={clubNames}
    />
  );
}