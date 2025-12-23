import { createClient, supabaseAdmin } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import QuizAttemptsClient from './QuizAttemptsClient'

export async function generateMetadata({ params }) {
  const supabase = supabaseAdmin || createClient()
  
  const { data: event } = await supabase
    .from('events')
    .select('title')
    .eq('id', params.id)
    .single()

  return {
    title: event ? `Quiz Submissions - ${event.title} | EventX` : 'Quiz Submissions | EventX',
    description: event ? `View quiz submissions and leaderboard for ${event.title}` : 'View quiz submissions'
  }
}

export const revalidate = 0 // Always fresh data

export default async function QuizAttemptsPage({ params, searchParams }) {
  const supabase = createClient()
  const eventId = params.id
  const page = parseInt(searchParams?.page || '1')
  const pageSize = 50
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  // 1. Verify User Authentication
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth')
  }

  // 2. Check Admin Status
  const { data: adminData } = await supabaseAdmin
    .from('admin_users')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  const isSuperAdmin = adminData?.role === 'super_admin'

  // 3. Fetch Event Data (Lightweight check)
  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id, title, created_by')
    .eq('id', eventId)
    .single()

  if (eventError || !event) {
    redirect('/admin/events')
  }

  // 4. Verify Permission
  const canManage = isSuperAdmin || event.created_by === user.id
  if (!canManage) {
    redirect('/admin/events')
  }

  // 5. Fetch Quiz Questions (Needed for "Total Questions" and reviewing answers)
  // We need ALL questions to map answers correctly, fetching them is usually cheap (quiz size is small)
  const { data: questions } = await supabaseAdmin
    .from('quiz_questions')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true })

  // 6. Fetch Global Stats (Total Submissions count & Average Score)
  // We fetch only the 'score' column for all attempts to calculate average efficiently without loading full jsonb
  const { data: allScores, count: totalSubmissions } = await supabaseAdmin
    .from('quiz_attempts')
    .select('score', { count: 'exact' })
    .eq('event_id', eventId)
    .not('completed_at', 'is', null)

  const totalScore = allScores?.reduce((sum, a) => sum + (a.score || 0), 0) || 0
  const averageScore = totalSubmissions > 0 ? totalScore / totalSubmissions : 0

  // 7. Fetch Paginated Attempts
  const { data: paginatedAttempts } = await supabaseAdmin
    .from('quiz_attempts')
    .select('*')
    .eq('event_id', eventId)
    .not('completed_at', 'is', null)
    .order('score', { ascending: false })
    .range(from, to)

  // 8. Enrich paginated attempts with user emails
  // Only fetching profiles for the displayed rows (max 50)
  const attemptsWithEmails = await Promise.all(
    (paginatedAttempts || []).map(async (attempt) => {
      // Use admin API to get user email by ID
      const { data: { user: attemptUser } } = await supabaseAdmin.auth.admin.getUserById(attempt.user_id)
      return {
        ...attempt,
        email: attemptUser?.email || 'Unknown User'
      }
    })
  )

  const stats = {
    total: totalSubmissions || 0,
    averageScore: averageScore,
    totalQuestions: questions?.length || 0 // Correctly derived from fetched questions
  }

  return (
    <QuizAttemptsClient 
      event={event} 
      attempts={attemptsWithEmails}
      questions={questions || []}
      stats={stats}
      currentPage={page}
      totalPages={Math.ceil((totalSubmissions || 0) / pageSize)}
    />
  )
}
