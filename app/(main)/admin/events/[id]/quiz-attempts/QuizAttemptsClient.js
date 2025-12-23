'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, FileText, Eye, Users, Trophy, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import LastWordGradientText from '@/components/LastWordGradientText'

// ============================================================================
// Stats Card Component
// ============================================================================
function StatsCard({ icon: Icon, title, value, colorClass }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${colorClass}`}>
              <Icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm text-zinc-400">{title}</p>
              <p className="text-2xl font-bold text-white">{value}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ============================================================================
// Main Quiz Attempts Client Component
// ============================================================================
export default function QuizAttemptsClient({ 
  event, 
  attempts, 
  questions,
  stats,
  currentPage = 1,
  totalPages = 1
}) {
  const router = useRouter()

  // Dialog State
  const [selectedAttempt, setSelectedAttempt] = useState(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)

  const handleViewDetails = (attempt) => {
    setSelectedAttempt(attempt)
    setIsDetailsOpen(true)
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Back Button */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Button
          variant="ghost"
          onClick={() => router.push(`/admin/events/${event.id}/dashboard`)}
          className="mb-4 hover:bg-zinc-800"
        >
          <ArrowLeft size={20} className="mr-2" />
          Back to Dashboard
        </Button>
      </motion.div>

      {/* Header */}
      <motion.div 
        className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-brand-gradient">
            <FileText className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">
              <LastWordGradientText>Quiz Submissions</LastWordGradientText>
            </h1>
            <p className="text-zinc-400 mt-1">{event.title}</p>
          </div>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <motion.div 
        className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <StatsCard 
          icon={Users} 
          title="Total Submissions" 
          value={stats.total} 
          colorClass="bg-blue-500/20 text-blue-400"
        />
        <StatsCard 
          icon={Trophy} 
          title="Average Score" 
          value={stats.averageScore.toFixed(1)} 
          colorClass="bg-green-500/20 text-green-400"
        />
        <StatsCard 
          icon={Clock} 
          title="Total Questions" 
          value={stats.totalQuestions} 
          colorClass="bg-purple-500/20 text-purple-400"
        />
      </motion.div>

      {/* Leaderboard Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
      >
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader className="border-b border-zinc-800">
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              Leaderboard ({attempts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="w-12 text-zinc-400">Rank</TableHead>
                  <TableHead className="text-zinc-400">Participant</TableHead>
                  <TableHead className="text-zinc-400">Score</TableHead>
                  <TableHead className="text-zinc-400">Submitted At</TableHead>
                  <TableHead className="text-right text-zinc-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.length === 0 ? (
                  <TableRow className="border-zinc-800">
                    <TableCell colSpan={5} className="text-center py-12 text-zinc-500">
                      <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No submissions yet.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  attempts.map((attempt, index) => (
                    <TableRow key={attempt.id} className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableCell className="font-medium">
                        {index < 3 ? (
                          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                            index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                            index === 1 ? 'bg-zinc-400/20 text-zinc-300' :
                            'bg-orange-500/20 text-orange-400'
                          }`}>
                            {index + 1}
                          </span>
                        ) : (
                          <span className="text-zinc-500">#{index + 1}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-white">{attempt.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-lg bg-zinc-800 text-white border-zinc-700">
                          {attempt.score}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-zinc-400">
                        {format(new Date(attempt.completed_at), 'MMM dd, HH:mm')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleViewDetails(attempt)}
                          className="border-zinc-700 hover:bg-zinc-800 hover:text-white"
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Answers
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`?page=${currentPage - 1}`)}
              disabled={currentPage <= 1}
              className="border-zinc-800 hover:bg-zinc-800"
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Previous
            </Button>
            <span className="text-sm text-zinc-400 min-w-[100px] text-center">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`?page=${currentPage + 1}`)}
              disabled={currentPage >= totalPages}
              className="border-zinc-800 hover:bg-zinc-800"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        )}
      </motion.div>

      {/* Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto bg-zinc-900 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-white">Submission Details</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Participant: {selectedAttempt?.email} | Score: {selectedAttempt?.score}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 mt-4">
            {selectedAttempt && questions.map((q, idx) => {
              const userAnswerIndex = selectedAttempt.answers?.[q.id];
              const isCorrect = userAnswerIndex === q.correct_option_index;
              
              return (
                <Card 
                  key={q.id} 
                  className={`border ${
                    isCorrect 
                      ? 'border-green-500/30 bg-green-500/10' 
                      : 'border-red-500/30 bg-red-500/10'
                  }`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <h3 className="font-semibold text-white">
                        {idx + 1}. {q.question_text}
                      </h3>
                      {isCorrect ? (
                        <Badge className="bg-green-500 hover:bg-green-600 text-white">
                          Correct (+{q.points})
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Incorrect</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-zinc-400 mb-1">User Answer:</p>
                        <div className={`p-3 rounded-lg border ${
                          isCorrect 
                            ? 'bg-green-500/20 border-green-500/40 text-green-300' 
                            : 'bg-red-500/20 border-red-500/40 text-red-300'
                        }`}>
                          {userAnswerIndex !== undefined ? q.options[userAnswerIndex] : 'Skipped'}
                        </div>
                      </div>
                      {!isCorrect && (
                        <div>
                          <p className="text-zinc-400 mb-1">Correct Answer:</p>
                          <div className="p-3 rounded-lg border bg-green-500/20 border-green-500/40 text-green-300">
                            {q.options[q.correct_option_index]}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
