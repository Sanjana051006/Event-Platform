'use client'

import { useState, useEffect, Suspense, useTransition } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import EventCard from '@/components/EventCard'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import LastWordGradientText from '@/components/LastWordGradientText'
import { motion, AnimatePresence } from 'framer-motion'
import { useDebounce } from 'use-debounce'

function EventsPageContent({ initialEvents, clubs }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Get initial state from URL
  // We use local state for inputs so they are responsive, 
  // but the source of truth for the LIST is the URL/server prop.
  const initialSearch = searchParams.get('search') || ''
  const initialFilter = searchParams.get('filter') || 'all'
  const initialClub = searchParams.get('club') || 'all_clubs' // specialized value for select

  const [searchTerm, setSearchTerm] = useState(initialSearch)
  // Debounce search term to update URL
  const [debouncedSearch] = useDebounce(searchTerm, 500)
  
  // Sync URL when debounced search string changes
  useEffect(() => {
    handleSearch(debouncedSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const updateUrl = (key, value) => {
    const params = new URLSearchParams(searchParams)
    
    if (value && value !== 'all' && value !== 'all_clubs') {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    
    // Reset page index if we had one (optional, but good practice)
    // params.delete('page') 

    startTransition(() => {
      // scroll: false keeps the user's scroll position, which feels nicer for filtering
      router.push(`/events?${params.toString()}`, { scroll: false })
    })
  }

  const handleSearch = (term) => {
    // Only update if it's different (though URLSearchParams handles this well, avoiding dup pushes is good)
    const currentSearch = searchParams.get('search') || ''
    if (term !== currentSearch) {
        updateUrl('search', term)
    }
  }

  const handleFilterChange = (val) => {
    updateUrl('filter', val)
  }

  const handleClubChange = (val) => {
    updateUrl('club', val)
  }

  const clearClubFilter = () => {
    updateUrl('club', null)
  }

  // Animation variants
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  }

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  }

  return (
    <div className="container mx-auto px-4 py-12 min-h-screen">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">
          <LastWordGradientText>All Events</LastWordGradientText>
        </h1>
        <p className="text-gray-400">Browse and register for our hackathons and tech events</p>
      </div>

      {/* Filters Bar */}
      <div className="mb-6 flex flex-col items-center justify-between gap-4 md:flex-row bg-card/50 p-4 rounded-xl border border-border/50 backdrop-blur-sm sticky top-20 z-10 shadow-sm">
        
        {/* Search Input */}
        <div className="relative w-full md:w-1/3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <Input
            placeholder="Search events..."
            className="pl-10 bg-background/50 border-gray-700/50 focus:border-brand-primary"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Dropdowns */}
        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row">
            {/* Club Filter */}
            {clubs && clubs.length > 0 && (
                 <Select 
                    value={searchParams.get('club') || "all_clubs"} 
                    onValueChange={handleClubChange}
                 >
                 <SelectTrigger className="w-full md:w-[180px] bg-background/50 border-gray-700/50">
                    <SelectValue placeholder="Filter by Club" />
                 </SelectTrigger>
                 <SelectContent>
                    <SelectItem value="all_clubs">All Clubs</SelectItem>
                    {clubs.map(club => (
                        <SelectItem key={club} value={club}>{club}</SelectItem>
                    ))}
                 </SelectContent>
                 </Select>
            )}

            {/* Status Filter */}
            <Select 
                value={searchParams.get('filter') || "all"} 
                onValueChange={handleFilterChange}
            >
            <SelectTrigger className="w-full md:w-[180px] bg-background/50 border-gray-700/50">
                <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                <SelectItem value="active">Active Only</SelectItem>
                <SelectItem value="open">Registration Open</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
            </Select>
        </div>
      </div>

      {/* Active Filters Display */}
      <AnimatePresence>
        {(searchParams.get('club') || searchParams.get('filter') !== 'all' && searchParams.get('filter') !== null) && (
            <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-6 flex gap-2 flex-wrap"
            >
                {/* We could add chips here if we wanted specific remove-filter buttons */}
            </motion.div>
        )}
      </AnimatePresence>



        {/* Events Grid */}
        <div className="relative min-h-[400px]">
        {/* Loading Overlay */}
        {isPending && (
            <div className="absolute inset-0 bg-background/50 backdrop-blur-[1px] z-50 flex items-start justify-center pt-20 transition-all duration-300">
                <div className="flex items-center gap-2 px-4 py-2 bg-card rounded-full shadow-lg border border-border">
                    <Loader2 className="animate-spin text-brand-primary" size={20} />
                    <span className="text-sm font-medium">Updating...</span>
                </div>
            </div>
        )}

        {initialEvents.length > 0 ? (
            <motion.div 
                variants={container}
                initial="show"
                animate="show"
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                key={JSON.stringify(initialEvents.map(e => e.id))} // Re-trigger staggering on data change
            >
            {initialEvents.map((event) => (
                <motion.div key={event.id} variants={item}>
                    <EventCard event={event} />
                </motion.div>
            ))}
            </motion.div>
        ) : (
            <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full"
            >
                <Card className="bg-transparent border-dashed border-2 border-gray-700">
                <CardContent className="py-20 text-center text-gray-400">
                    <div className="mb-4 flex justifying-center">
                        <Search className="mx-auto h-12 w-12 opacity-20" />
                    </div>
                    <h3 className="text-lg font-semibold mb-1">No events found</h3>
                    <p className="max-w-xs mx-auto text-sm opacity-70">
                    We couldn't find any events matching your current filters. Try adjusting your search or categories.
                    </p>
                    <Button 
                        variant="link" 
                        onClick={() => updateUrl(null, null, true)} // Custom clear all logic needed? Or just reset individual inputs?
                        className="mt-4 text-brand-primary"
                    >
                        Clear all filters
                    </Button>
                </CardContent>
                </Card>
            </motion.div>
        )}
      </div>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex h-[50vh] w-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
    </div>
  );
}

// Wrap the main component in Suspense for useSearchParams
export default function EventsListClient({ initialEvents, clubs }) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <EventsPageContent initialEvents={initialEvents} clubs={clubs} />
    </Suspense>
  )
}
