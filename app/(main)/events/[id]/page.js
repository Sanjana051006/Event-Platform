
import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import EventClient from './EventClient';

export const revalidate = 60; // [OPTIMIZED] Cache this page for 60 seconds

export default async function EventPage({ params }) {
  const supabase = createClient();
  
  // Fetch data directly on the server
  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', params.id)
    .single();

  if (error || !event) return notFound();

  return <EventClient initialEvent={event} />;
}