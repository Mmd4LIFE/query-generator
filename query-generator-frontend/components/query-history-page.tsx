"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { History, Copy, CheckCircle, AlertCircle, Loader2, MessageSquare, Star, ThumbsUp, ThumbsDown, Eye, Calendar, User, Database, Search, Filter, Archive, Trash2, Inbox, Send, FileText, ChevronRight, MoreHorizontal } from "lucide-react"
import { toast } from "sonner"
import type { QueryGeneratorAPI, QueryHistoryItem, QueryFeedback } from "@/lib/api"
import { getUserPermissions } from "@/lib/utils"

interface QueryHistoryPageProps {
  api: QueryGeneratorAPI
  userProfile: any
}

export function QueryHistoryPage({ api, userProfile }: QueryHistoryPageProps) {
  const [history, setHistory] = useState<QueryHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [feedbackDialog, setFeedbackDialog] = useState<string | null>(null)
  const [feedbackComment, setFeedbackComment] = useState("")
  const [feedbackRating, setFeedbackRating] = useState<number>(3)
  const [feedbackCorrectness, setFeedbackCorrectness] = useState<number>(3)
  const [feedbackCompleteness, setFeedbackCompleteness] = useState<number>(3)
  const [feedbackEfficiency, setFeedbackEfficiency] = useState<number>(3)
  const [feedbackSuggestedSql, setFeedbackSuggestedSql] = useState("")
  const [feedbackImprovementNotes, setFeedbackImprovementNotes] = useState("")
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false)
  const [queryFeedback, setQueryFeedback] = useState<QueryFeedback[]>([])
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false)
  
  // Email-style layout state
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedFilter, setSelectedFilter] = useState<"all" | "recent">("all")
  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(null)

  const permissions = getUserPermissions(userProfile)

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    console.log('🔄 Loading query history...')
    setIsLoading(true)
    setError("")
    
    try {
      const result = await api.getQueryHistory()
      console.log('✅ Query history loaded:', result)
      setHistory(result || [])
    } catch (err) {
      console.error('❌ Failed to load query history:', err)
      setError('Failed to load query history. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const loadQueryFeedback = async (historyId: string) => {
    console.log('🔄 Loading feedback for history ID:', historyId)
    setIsLoadingFeedback(true)
    setQueryFeedback([])
    
    try {
      const feedback = await api.getQueryFeedback(historyId)
      console.log('✅ Feedback loaded:', feedback)
      setQueryFeedback(feedback)
    } catch (err) {
      console.error('❌ Failed to load feedback:', err)
      toast.error('Failed to load feedback')
    } finally {
      setIsLoadingFeedback(false)
    }
  }

  const submitFeedback = async (historyId: string) => {
    setIsSubmittingFeedback(true)
    
    try {
      await api.submitQueryFeedback({
        query_id: historyId,
        rating: feedbackRating,
        comment: feedbackComment,
        correctness: feedbackCorrectness,
        completeness: feedbackCompleteness,
        efficiency: feedbackEfficiency,
        suggested_sql: feedbackSuggestedSql,
        improvement_notes: feedbackImprovementNotes
      })
      
      toast.success('Feedback submitted successfully!')
      setFeedbackDialog(null)
      setFeedbackComment("")
      setFeedbackRating(3)
      setFeedbackCorrectness(3)
      setFeedbackCompleteness(3)
      setFeedbackEfficiency(3)
      setFeedbackSuggestedSql("")
      setFeedbackImprovementNotes("")
      
      // Reload feedback
      if (selectedQueryId === historyId) {
        await loadQueryFeedback(historyId)
      }
    } catch (err) {
      console.error('Failed to submit feedback:', err)
      toast.error('Failed to submit feedback. Please try again.')
    } finally {
      setIsSubmittingFeedback(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('SQL copied to clipboard!')
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
      toast.error('Failed to copy to clipboard')
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    
    if (diffHours < 1) return 'Just now'
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const getRatingIcon = (rating?: number) => {
    if (!rating) return <Star className="w-4 h-4 text-muted-foreground" />
    if (rating >= 4) return <ThumbsUp className="w-4 h-4 text-green-500" />
    if (rating <= 2) return <ThumbsDown className="w-4 h-4 text-red-500" />
    return <Star className="w-4 h-4 text-yellow-500" />
  }

  const getRatingColor = (rating?: number) => {
    if (!rating) return 'bg-muted'
    if (rating >= 4) return 'bg-green-100 text-green-800'
    if (rating <= 2) return 'bg-red-100 text-red-800'
    return 'bg-yellow-100 text-yellow-800'
  }

  const getRatingText = (rating?: number) => {
    if (!rating) return 'No Rating'
    if (rating >= 4) return 'Positive'
    if (rating <= 2) return 'Negative'
    return 'Neutral'
  }

  // Filter and search logic
  const filteredHistory = history.filter((item) => {
    const matchesSearch = item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (item.catalog_name || '').toLowerCase().includes(searchQuery.toLowerCase())
    
    if (selectedFilter === "recent") {
      const date = new Date(item.created_at)
      const now = new Date()
      const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)
      return matchesSearch && diffHours < 24
    }
    
    return matchesSearch
  })

  const selectedQuery = history.find(item => item.id === selectedQueryId) || null

  return (
    <div className="h-full w-full bg-background">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* Query List Panel */}
        <ResizablePanel defaultSize={40} minSize={30} maxSize={70}>
          <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b bg-background">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Query History</h2>
          </div>
          
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search queries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          {/* Filter Tabs */}
          <div className="flex space-x-1 mt-3">
            <Button
              variant={selectedFilter === "all" ? "default" : "ghost"}
              size="sm"
              onClick={() => setSelectedFilter("all")}
            >
              All queries
            </Button>
            <Button
              variant={selectedFilter === "recent" ? "default" : "ghost"}
              size="sm"
              onClick={() => setSelectedFilter("recent")}
            >
              Recent
            </Button>
          </div>
        </div>

        {/* Query List */}
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="ml-2">Loading queries...</span>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-center py-8">
              <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No queries found</p>
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "Try adjusting your search" : "Start by generating your first query!"}
              </p>
            </div>
          ) : (
            <div className="space-y-2 p-2">
              {filteredHistory.map((item) => (
                <div
                  key={item.id}
                  className={`group relative cursor-pointer transition-all duration-200 border rounded-lg ${
                    selectedQueryId === item.id 
                      ? 'bg-primary/10 border-primary/30 shadow-sm' 
                      : 'border-border hover:border-primary/20 hover:bg-muted/30'
                  }`}
                  onClick={() => {
                    setSelectedQueryId(item.id)
                    setQueryFeedback([]) // Clear previous feedback
                  }}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-2">
                          <h3 className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                            {item.question}
                          </h3>
                          {item.feedback && item.feedback.length > 0 && (
                            <Badge variant="secondary" className="text-xs px-2 py-0.5">
                              {item.feedback.length}
                            </Badge>
                          )}
                        </div>
                        
                        <p className="text-xs text-muted-foreground mb-3 line-clamp-2 leading-relaxed">
                          {item.explanation || 'No explanation available'}
                        </p>
                        
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3 text-xs text-muted-foreground">
                            <div className="flex items-center space-x-1">
                              <Database className="w-3 h-3" />
                              <span>{item.catalog_name}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Calendar className="w-3 h-3" />
                              <span>{formatDate(item.created_at)}</span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge variant="outline" className="text-xs">
                              {item.engine}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {item.catalog_name}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right Panel - Query Details */}
        <ResizablePanel defaultSize={60} minSize={30} maxSize={70}>
          <div className="flex flex-col h-full">
        {selectedQuery ? (
          <>
            {/* Query Details Header */}
            <div className="p-4 border-b bg-background">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg truncate">
                    {selectedQuery.question}
                  </h3>
                  <div className="flex items-center space-x-2 mt-1 text-sm text-muted-foreground">
                    <span>{formatDate(selectedQuery.created_at)}</span>
                    <span>•</span>
                    <span>{selectedQuery.engine}</span>
                    <span>•</span>
                    <span>{selectedQuery.catalog_name}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      copyToClipboard(selectedQuery.generated_sql || '')
                      toast.success('SQL copied to clipboard!')
                    }}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy SQL
                  </Button>
                </div>
              </div>
            </div>

            {/* Query Details Content */}
            <ScrollArea className="flex-1 p-4">
              <Tabs 
                defaultValue="sql" 
                className="w-full"
                onValueChange={(value) => {
                  if (value === "feedback" && selectedQuery && queryFeedback.length === 0 && !isLoadingFeedback) {
                    loadQueryFeedback(selectedQuery.id)
                  }
                }}
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="sql">SQL Query</TabsTrigger>
                  <TabsTrigger value="explanation">Explanation</TabsTrigger>
                  <TabsTrigger 
                    value="feedback"
                    onClick={() => {
                      if (selectedQuery && queryFeedback.length === 0 && !isLoadingFeedback) {
                        loadQueryFeedback(selectedQuery.id)
                      }
                    }}
                  >
                    Feedback
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="sql" className="space-y-4 mt-6">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Generated SQL</h4>
                    <div className="bg-muted p-4 rounded-lg">
                      <pre className="text-sm font-mono whitespace-pre-wrap overflow-x-auto">
                        {selectedQuery.generated_sql || 'No SQL generated'}
                      </pre>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="explanation" className="space-y-4 mt-6">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Explanation</h4>
                    <div className="bg-muted p-4 rounded-lg">
                      <p className="text-sm">
                        {selectedQuery.explanation || 'No explanation available'}
                      </p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="feedback" className="space-y-4 mt-6">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Feedback</h4>
                    {permissions.isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setFeedbackDialog(selectedQuery.id)}
                        className="gap-2"
                      >
                        <MessageSquare className="w-4 h-4" />
                        Add Feedback
                      </Button>
                    )}
                  </div>

                  {isLoadingFeedback ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <span className="ml-2">Loading feedback...</span>
                    </div>
                  ) : queryFeedback.length > 0 ? (
                    <div className="space-y-4">
                      {queryFeedback.map((feedback) => (
                        <Card key={feedback.id}>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              {getRatingIcon(feedback.rating)}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">
                                      {getRatingText(feedback.rating)}
                                    </span>
                                    <Badge variant="outline" className="text-xs">
                                      {feedback.rating}/5
                                    </Badge>
                                  </div>
                                  <span className="text-xs text-muted-foreground">
                                    by {feedback.username || 'Unknown User'} • {formatDate(feedback.created_at)}
                                  </span>
                                </div>
                                
                                {feedback.comment && (
                                  <p className="text-sm text-muted-foreground mb-3">
                                    {feedback.comment}
                                  </p>
                                )}

                                {/* Detailed Ratings */}
                                <div className="grid grid-cols-3 gap-4 mb-3">
                                  <div className="text-center">
                                    <div className="text-xs text-muted-foreground">Correctness</div>
                                    <div className="flex items-center justify-center gap-1 mt-1">
                                      {[1, 2, 3, 4, 5].map((rating) => (
                                        <Star
                                          key={rating}
                                          className={`w-3 h-3 ${
                                            rating <= (feedback.correctness || 0)
                                              ? 'text-yellow-400 fill-current'
                                              : 'text-muted-foreground'
                                          }`}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                  
                                  <div className="text-center">
                                    <div className="text-xs text-muted-foreground">Completeness</div>
                                    <div className="flex items-center justify-center gap-1 mt-1">
                                      {[1, 2, 3, 4, 5].map((rating) => (
                                        <Star
                                          key={rating}
                                          className={`w-3 h-3 ${
                                            rating <= (feedback.completeness || 0)
                                              ? 'text-yellow-400 fill-current'
                                              : 'text-muted-foreground'
                                          }`}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                  
                                  <div className="text-center">
                                    <div className="text-xs text-muted-foreground">Efficiency</div>
                                    <div className="flex items-center justify-center gap-1 mt-1">
                                      {[1, 2, 3, 4, 5].map((rating) => (
                                        <Star
                                          key={rating}
                                          className={`w-3 h-3 ${
                                            rating <= (feedback.efficiency || 0)
                                              ? 'text-yellow-400 fill-current'
                                              : 'text-muted-foreground'
                                          }`}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                </div>

                                {feedback.suggested_sql && (
                                  <div className="mb-3">
                                    <div className="text-xs text-muted-foreground mb-1">Suggested SQL:</div>
                                    <div className="bg-muted p-2 rounded text-xs font-mono">
                                      {feedback.suggested_sql}
                                    </div>
                                  </div>
                                )}

                                {feedback.improvement_notes && (
                                  <div>
                                    <div className="text-xs text-muted-foreground mb-1">Improvement Notes:</div>
                                    <p className="text-xs text-muted-foreground">
                                      {feedback.improvement_notes}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">No feedback provided yet</p>
                      <p className="text-sm text-muted-foreground">
                        {permissions.isAdmin ? "Click 'Add Feedback' to provide your review" : "Feedback will appear here when provided by administrators"}
                      </p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </ScrollArea>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Select a query to view details</p>
            </div>
          </div>
        )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Feedback Dialog */}
      {permissions.isAdmin && selectedQuery && (
        <Dialog open={feedbackDialog === selectedQuery.id} onOpenChange={(open) => {
          if (!open) {
            setFeedbackDialog(null)
            setFeedbackComment("")
            setFeedbackRating(3)
            setFeedbackCorrectness(3)
            setFeedbackCompleteness(3)
            setFeedbackEfficiency(3)
            setFeedbackSuggestedSql("")
            setFeedbackImprovementNotes("")
          }
        }}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Provide Feedback
              </DialogTitle>
              <DialogDescription>
                Help improve query generation by providing detailed feedback on this query.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              {/* Overall Rating Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold">Overall Rating</label>
                  <span className="text-xs text-muted-foreground">Required</span>
                </div>
                <div className="flex items-center space-x-2">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      onClick={() => setFeedbackRating(rating)}
                      className={`w-12 h-12 rounded-full border-2 transition-all duration-200 flex items-center justify-center text-sm font-medium ${
                        feedbackRating === rating
                          ? 'border-primary bg-primary text-primary-foreground shadow-md'
                          : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5'
                      }`}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
                <div className="text-sm text-muted-foreground">
                  {feedbackRating === 1 && '❌ Poor - Query is incorrect or unusable'}
                  {feedbackRating === 2 && '⚠️ Below Average - Query has significant issues'}
                  {feedbackRating === 3 && '⚖️ Average - Query works but could be improved'}
                  {feedbackRating === 4 && '✅ Good - Query is well-structured and functional'}
                  {feedbackRating === 5 && '🌟 Excellent - Query is optimal and efficient'}
                </div>
              </div>

              <Separator />

              {/* Detailed Ratings Section */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-muted-foreground">Detailed Assessment</h4>
                
                <div className="grid gap-4">
                  {/* Correctness */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Correctness</label>
                      <span className="text-xs text-muted-foreground">Is the SQL syntactically and logically correct?</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                          key={rating}
                          onClick={() => setFeedbackCorrectness(rating)}
                          className={`w-8 h-8 rounded-full border transition-all duration-200 flex items-center justify-center text-xs ${
                            feedbackCorrectness === rating
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground/30 hover:border-primary/50'
                          }`}
                        >
                          {rating}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Completeness */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Completeness</label>
                      <span className="text-xs text-muted-foreground">Does it fully address the question?</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                          key={rating}
                          onClick={() => setFeedbackCompleteness(rating)}
                          className={`w-8 h-8 rounded-full border transition-all duration-200 flex items-center justify-center text-xs ${
                            feedbackCompleteness === rating
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground/30 hover:border-primary/50'
                          }`}
                        >
                          {rating}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Efficiency */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Efficiency</label>
                      <span className="text-xs text-muted-foreground">Is the query optimized for performance?</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                          key={rating}
                          onClick={() => setFeedbackEfficiency(rating)}
                          className={`w-8 h-8 rounded-full border transition-all duration-200 flex items-center justify-center text-xs ${
                            feedbackEfficiency === rating
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground/30 hover:border-primary/50'
                          }`}
                        >
                          {rating}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Comment Section */}
              <div className="space-y-2">
                <label className="text-sm font-semibold">Feedback Comment</label>
                <Textarea
                  placeholder="Provide specific feedback about what works well and what could be improved..."
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  rows={4}
                  className="resize-none"
                />
              </div>

              {/* Suggested SQL Section */}
              <div className="space-y-2">
                <label className="text-sm font-semibold">Suggested SQL (Optional)</label>
                <Textarea
                  placeholder="If you have a better version of the SQL, paste it here..."
                  value={feedbackSuggestedSql}
                  onChange={(e) => setFeedbackSuggestedSql(e.target.value)}
                  rows={6}
                  className="font-mono text-sm resize-none"
                />
              </div>

              {/* Improvement Notes Section */}
              <div className="space-y-2">
                <label className="text-sm font-semibold">Improvement Notes (Optional)</label>
                <Textarea
                  placeholder="Additional suggestions for improving query generation..."
                  value={feedbackImprovementNotes}
                  onChange={(e) => setFeedbackImprovementNotes(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>
            </div>
            <div className="flex justify-between items-center pt-4 border-t">
              <div className="text-xs text-muted-foreground">
                All ratings are required. Comment is optional but recommended.
              </div>
              <div className="flex space-x-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFeedbackDialog(null)
                    setFeedbackComment("")
                    setFeedbackRating(3)
                    setFeedbackCorrectness(3)
                    setFeedbackCompleteness(3)
                    setFeedbackEfficiency(3)
                    setFeedbackSuggestedSql("")
                    setFeedbackImprovementNotes("")
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => submitFeedback(selectedQuery.id)}
                  disabled={isSubmittingFeedback || !feedbackRating || !feedbackCorrectness || !feedbackCompleteness || !feedbackEfficiency}
                  className="min-w-[120px]"
                >
                  {isSubmittingFeedback ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Submit Feedback'
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
