"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { History, Copy, CheckCircle, AlertCircle, Loader2, MessageSquare, Star, ThumbsUp, ThumbsDown, Eye, Calendar, User, Database } from "lucide-react"
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
  const [feedbackRating, setFeedbackRating] = useState<number>(3) // Default to 3 (neutral)
  const [feedbackCorrectness, setFeedbackCorrectness] = useState<number>(3)
  const [feedbackCompleteness, setFeedbackCompleteness] = useState<number>(3)
  const [feedbackEfficiency, setFeedbackEfficiency] = useState<number>(3)
  const [feedbackSuggestedSql, setFeedbackSuggestedSql] = useState("")
  const [feedbackImprovementNotes, setFeedbackImprovementNotes] = useState("")
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false)
  const [selectedQuery, setSelectedQuery] = useState<QueryHistoryItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [queryFeedback, setQueryFeedback] = useState<QueryFeedback[]>([])
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false)

  const permissions = getUserPermissions(userProfile)

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    setIsLoading(true)
    setError("")
    
    try {
      // This would be an API call to get query history
      // For now, we'll simulate with empty data
      const historyData = await api.getQueryHistory()
      setHistory(historyData)
    } catch (err: any) {
      console.error("Failed to load query history:", err)
      setError("Failed to load query history. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = async (sql: string) => {
    try {
      await navigator.clipboard.writeText(sql)
      toast.success("SQL copied to clipboard!", {
        description: "The query has been copied to your clipboard.",
        duration: 2000,
      })
    } catch (error) {
      toast.error("Failed to copy SQL", {
        description: "Please try copying manually.",
        duration: 3000,
      })
    }
  }

  const openQueryDetails = async (query: QueryHistoryItem) => {
    setSelectedQuery(query)
    setDrawerOpen(true)
    // Don't load feedback immediately - wait for user to click Feedback tab
    setQueryFeedback([])
  }

  const loadQueryFeedback = async (historyId: string) => {
    console.log('🔄 Loading feedback for history ID:', historyId)
    setIsLoadingFeedback(true)
    try {
      const feedback = await api.getQueryFeedback(historyId)
      console.log('✅ Feedback loaded:', feedback)
      setQueryFeedback(feedback)
    } catch (err: any) {
      console.error("❌ Failed to load feedback:", err)
      setQueryFeedback([])
    } finally {
      setIsLoadingFeedback(false)
    }
  }

  const submitFeedback = async (queryId: string) => {
    if (!feedbackComment.trim()) {
      setError("Please enter a feedback comment.")
      return
    }

    setIsSubmittingFeedback(true)
    setError("")

    try {
      await api.submitQueryFeedback({
        query_id: queryId,
        rating: feedbackRating,
        comment: feedbackComment.trim(),
        correctness: feedbackCorrectness,
        completeness: feedbackCompleteness,
        efficiency: feedbackEfficiency,
        suggested_sql: feedbackSuggestedSql.trim() || undefined,
        improvement_notes: feedbackImprovementNotes.trim() || undefined
      })
      
      setFeedbackDialog(null)
      setFeedbackComment("")
      setFeedbackRating(3)
      setFeedbackCorrectness(3)
      setFeedbackCompleteness(3)
      setFeedbackEfficiency(3)
      setFeedbackSuggestedSql("")
      setFeedbackImprovementNotes("")
      await loadQueryFeedback(queryId) // Reload feedback for this query
    } catch (err: any) {
      console.error("Failed to submit feedback:", err)
      setError("Failed to submit feedback. Please try again.")
    } finally {
      setIsSubmittingFeedback(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  const getRatingIcon = (rating?: number) => {
    if (!rating) return <MessageSquare className="w-4 h-4 text-gray-500" />
    if (rating >= 4) return <ThumbsUp className="w-4 h-4 text-green-500" />
    if (rating <= 2) return <ThumbsDown className="w-4 h-4 text-red-500" />
    return <MessageSquare className="w-4 h-4 text-yellow-500" />
  }

  const getRatingColor = (rating?: number) => {
    if (!rating) return 'bg-gray-100 text-gray-800 border-gray-200'
    if (rating >= 4) return 'bg-green-100 text-green-800 border-green-200'
    if (rating <= 2) return 'bg-red-100 text-red-800 border-red-200'
    return 'bg-yellow-100 text-yellow-800 border-yellow-200'
  }

  const getRatingText = (rating?: number) => {
    if (!rating) return 'No Rating'
    if (rating >= 4) return 'Positive'
    if (rating <= 2) return 'Negative'
    return 'Neutral'
  }

  return (
    <div className="h-full w-full">
      <div className="h-full w-full space-y-4 sm:space-y-6 p-4">
        <Card className="w-full" style={{maxWidth: 'none', width: '100%'}}>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center space-x-2 text-lg sm:text-xl">
              <History className="w-5 h-5 text-primary" />
              <span>Query History</span>
            </CardTitle>
            <CardDescription className="text-sm">
              View your generated queries and feedback from administrators
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </Alert>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="ml-2">Loading query history...</span>
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-8">
                <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No queries generated yet.</p>
                <p className="text-sm text-muted-foreground">Start by generating your first query!</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:gap-4">
                {history.map((item) => (
                  <HoverCard key={item.id}>
                    <HoverCardTrigger asChild>
                      <Card className="cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/20 group">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium text-sm sm:text-base line-clamp-2 group-hover:text-primary transition-colors">
                                {item.question}
                              </h3>
                              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Database className="w-3 h-3" />
                                  <span>{item.catalog_name}</span>
                                </div>
                                <span>•</span>
                                <div className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  <span>{formatDate(item.created_at)}</span>
                                </div>
                                <span>•</span>
                                <div className="flex items-center gap-1">
                                  <User className="w-3 h-3" />
                                  <span>{item.username}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mt-2">
                                <Badge variant="outline" className="text-xs">
                                  {item.engine}
                                </Badge>
                                {item.feedback && item.feedback.length > 0 && (
                                  <Badge className={`text-xs ${getRatingColor(item.feedback[0]?.rating)}`}>
                                    {getRatingIcon(item.feedback[0]?.rating)}
                                    <span className="ml-1">{item.feedback.length} Feedback{item.feedback.length > 1 ? 's' : ''}</span>
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  copyToClipboard(item.generated_sql || '')
                                }}
                                className="h-8 w-8 p-0"
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openQueryDetails(item)
                                }}
                                className="h-8 w-8 p-0"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-80" side="right">
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-medium text-sm">Question</h4>
                          <p className="text-sm text-muted-foreground mt-1">{item.question}</p>
                        </div>
                        <div>
                          <h4 className="font-medium text-sm">Generated SQL</h4>
                          <div className="bg-muted p-2 rounded text-xs font-mono max-h-32 overflow-y-auto mt-1">
                            <pre className="whitespace-pre-wrap">{item.generated_sql || 'No SQL generated'}</pre>
                          </div>
                        </div>
                        {item.feedback && item.feedback.length > 0 && (
                          <div>
                            <h4 className="font-medium text-sm">Feedback ({item.feedback.length})</h4>
                            <div className="space-y-2 mt-1">
                              {item.feedback.slice(0, 2).map((feedback) => (
                                <div key={feedback.id} className="flex items-start gap-2">
                                  {getRatingIcon(feedback.rating)}
                                  <div className="flex-1">
                                    <p className="text-xs text-muted-foreground">{feedback.comment}</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                      by {feedback.username} • {formatDate(feedback.created_at)}
                                    </p>
                                  </div>
                                </div>
                              ))}
                              {item.feedback.length > 2 && (
                                <p className="text-xs text-muted-foreground">
                                  +{item.feedback.length - 2} more feedback entries
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Query Details Drawer */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="border-b">
            <DrawerTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Query Details
            </DrawerTitle>
          </DrawerHeader>
          
          {selectedQuery && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto space-y-6">
                {/* Query Header */}
                <div className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold mb-2">{selectedQuery.question}</h2>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Database className="w-4 h-4" />
                        <span>{selectedQuery.catalog_name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>{formatDate(selectedQuery.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <User className="w-4 h-4" />
                        <span>{selectedQuery.username}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{selectedQuery.engine}</Badge>
                    {queryFeedback.length > 0 && (
                      <Badge className={getRatingColor(queryFeedback[0]?.rating)}>
                        {getRatingIcon(queryFeedback[0]?.rating)}
                        <span className="ml-1">{queryFeedback.length} Feedback{queryFeedback.length > 1 ? 's' : ''}</span>
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Tabs */}
                <Tabs 
                  defaultValue="sql" 
                  className="w-full"
                  onValueChange={(value) => {
                    console.log('🔄 Tab value changed to:', value)
                    if (value === "feedback" && selectedQuery && queryFeedback.length === 0 && !isLoadingFeedback) {
                      console.log('🔄 Tab changed to feedback, loading feedback for:', selectedQuery.id)
                      loadQueryFeedback(selectedQuery.id)
                    }
                  }}
                >
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="sql">SQL Query</TabsTrigger>
                    <TabsTrigger value="explanation">Explanation</TabsTrigger>
                    <TabsTrigger 
                      value="feedback"
                      onClick={(e) => {
                        console.log('🔄 Feedback tab clicked directly', e)
                        console.log('🔄 selectedQuery:', selectedQuery)
                        console.log('🔄 queryFeedback.length:', queryFeedback.length)
                        console.log('🔄 isLoadingFeedback:', isLoadingFeedback)
                        if (selectedQuery && queryFeedback.length === 0 && !isLoadingFeedback) {
                          console.log('🔄 Loading feedback for:', selectedQuery.id)
                          loadQueryFeedback(selectedQuery.id)
                        } else {
                          console.log('🔄 Not loading feedback - conditions not met')
                        }
                      }}
                    >
                      Feedback
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="sql" className="space-y-4 mt-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-medium">Generated SQL</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(selectedQuery.generated_sql || '')}
                        className="gap-2"
                      >
                        <Copy className="w-4 h-4" />
                        Copy SQL
                      </Button>
                    </div>
                    <div className="bg-muted p-4 rounded-lg overflow-x-auto">
                      <pre className="text-sm font-mono whitespace-pre-wrap text-foreground">
                        {selectedQuery.generated_sql || 'No SQL generated'}
                      </pre>
                    </div>
                  </TabsContent>

                  <TabsContent value="explanation" className="space-y-4 mt-6">
                    <h3 className="text-lg font-medium">Explanation</h3>
                    <div className="prose prose-sm max-w-none">
                      <p className="text-muted-foreground leading-relaxed">
                        {selectedQuery.explanation || 'No explanation available.'}
                      </p>
                    </div>
                  </TabsContent>

                  <TabsContent value="feedback" className="space-y-4 mt-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-medium">Feedback</h3>
                      {permissions.isAdmin && (
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
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setFeedbackDialog(selectedQuery.id)}
                              className="gap-2"
                            >
                              <MessageSquare className="w-4 h-4" />
                              Add Feedback
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                              <DialogTitle>Provide Feedback</DialogTitle>
                              <DialogDescription>
                                Rate and comment on this generated query.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div>
                                <label className="text-sm font-medium">Overall Rating (1-5)</label>
                                <div className="flex space-x-2 mt-2">
                                  {[1, 2, 3, 4, 5].map((rating) => (
                                    <Button
                                      key={rating}
                                      variant={feedbackRating === rating ? 'default' : 'outline'}
                                      size="sm"
                                      onClick={() => setFeedbackRating(rating)}
                                      className="w-10 h-10 p-0"
                                    >
                                      {rating}
                                    </Button>
                                  ))}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {feedbackRating === 1 && 'Poor'}
                                  {feedbackRating === 2 && 'Below Average'}
                                  {feedbackRating === 3 && 'Average'}
                                  {feedbackRating === 4 && 'Good'}
                                  {feedbackRating === 5 && 'Excellent'}
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-4">
                                <div>
                                  <label className="text-sm font-medium">Correctness (1-5)</label>
                                  <div className="flex space-x-1 mt-2">
                                    {[1, 2, 3, 4, 5].map((rating) => (
                                      <Button
                                        key={rating}
                                        variant={feedbackCorrectness === rating ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setFeedbackCorrectness(rating)}
                                        className="w-8 h-8 p-0 text-xs"
                                      >
                                        {rating}
                                      </Button>
                                    ))}
                                  </div>
                                </div>
                                
                                <div>
                                  <label className="text-sm font-medium">Completeness (1-5)</label>
                                  <div className="flex space-x-1 mt-2">
                                    {[1, 2, 3, 4, 5].map((rating) => (
                                      <Button
                                        key={rating}
                                        variant={feedbackCompleteness === rating ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setFeedbackCompleteness(rating)}
                                        className="w-8 h-8 p-0 text-xs"
                                      >
                                        {rating}
                                      </Button>
                                    ))}
                                  </div>
                                </div>
                                
                                <div>
                                  <label className="text-sm font-medium">Efficiency (1-5)</label>
                                  <div className="flex space-x-1 mt-2">
                                    {[1, 2, 3, 4, 5].map((rating) => (
                                      <Button
                                        key={rating}
                                        variant={feedbackEfficiency === rating ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setFeedbackEfficiency(rating)}
                                        className="w-8 h-8 p-0 text-xs"
                                      >
                                        {rating}
                                      </Button>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div>
                                <label className="text-sm font-medium">Comment</label>
                                <Textarea
                                  placeholder="Enter your feedback comment..."
                                  value={feedbackComment}
                                  onChange={(e) => setFeedbackComment(e.target.value)}
                                  rows={3}
                                  className="mt-2"
                                />
                              </div>

                              <div>
                                <label className="text-sm font-medium">Suggested SQL (Optional)</label>
                                <Textarea
                                  placeholder="Enter improved SQL if you have suggestions..."
                                  value={feedbackSuggestedSql}
                                  onChange={(e) => setFeedbackSuggestedSql(e.target.value)}
                                  rows={4}
                                  className="mt-2 font-mono text-sm"
                                />
                              </div>

                              <div>
                                <label className="text-sm font-medium">Improvement Notes (Optional)</label>
                                <Textarea
                                  placeholder="Additional notes for improvement..."
                                  value={feedbackImprovementNotes}
                                  onChange={(e) => setFeedbackImprovementNotes(e.target.value)}
                                  rows={3}
                                  className="mt-2"
                                />
                              </div>
                              <div className="flex justify-end space-x-2">
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
                                  disabled={isSubmittingFeedback}
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
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Badge className={getRatingColor(feedback.rating)}>
                                      {feedback.rating ? `${feedback.rating}/5` : 'No Rating'}
                                    </Badge>
                                    <span className="text-sm text-muted-foreground">
                                      by {feedback.username || 'Unknown User'}
                                    </span>
                                    <span className="text-sm text-muted-foreground">
                                      • {formatDate(feedback.created_at)}
                                    </span>
                                  </div>
                                  
                                  {feedback.comment && (
                                    <p className="text-sm leading-relaxed mb-3">
                                      {feedback.comment}
                                    </p>
                                  )}

                                  {/* Additional feedback details */}
                                  <div className="grid grid-cols-3 gap-4 text-xs">
                                    {feedback.correctness && (
                                      <div>
                                        <span className="font-medium">Correctness:</span>
                                        <div className="flex items-center gap-1 mt-1">
                                          {Array.from({ length: 5 }, (_, i) => (
                                            <Star
                                              key={i}
                                              className={`w-3 h-3 ${
                                                i < feedback.correctness! 
                                                  ? 'text-yellow-400 fill-current' 
                                                  : 'text-gray-300'
                                              }`}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    
                                    {feedback.completeness && (
                                      <div>
                                        <span className="font-medium">Completeness:</span>
                                        <div className="flex items-center gap-1 mt-1">
                                          {Array.from({ length: 5 }, (_, i) => (
                                            <Star
                                              key={i}
                                              className={`w-3 h-3 ${
                                                i < feedback.completeness! 
                                                  ? 'text-yellow-400 fill-current' 
                                                  : 'text-gray-300'
                                              }`}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    
                                    {feedback.efficiency && (
                                      <div>
                                        <span className="font-medium">Efficiency:</span>
                                        <div className="flex items-center gap-1 mt-1">
                                          {Array.from({ length: 5 }, (_, i) => (
                                            <Star
                                              key={i}
                                              className={`w-3 h-3 ${
                                                i < feedback.efficiency! 
                                                  ? 'text-yellow-400 fill-current' 
                                                  : 'text-gray-300'
                                              }`}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {feedback.suggested_sql && (
                                    <div className="mt-3">
                                      <span className="text-xs font-medium text-muted-foreground">Suggested SQL:</span>
                                      <div className="bg-muted p-2 rounded text-xs font-mono mt-1">
                                        <pre className="whitespace-pre-wrap">{feedback.suggested_sql}</pre>
                                      </div>
                                    </div>
                                  )}

                                  {feedback.improvement_notes && (
                                    <div className="mt-3">
                                      <span className="text-xs font-medium text-muted-foreground">Improvement Notes:</span>
                                      <p className="text-xs text-muted-foreground mt-1">
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
                        <p className="text-muted-foreground">No feedback provided yet.</p>
                        {permissions.isAdmin && (
                          <p className="text-sm text-muted-foreground mt-1">
                            Click "Add Feedback" to provide your review.
                          </p>
                        )}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  )
}
