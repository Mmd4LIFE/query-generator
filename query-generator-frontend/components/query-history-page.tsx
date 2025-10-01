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
import type { QueryGeneratorAPI, QueryHistoryItem } from "@/lib/api"
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
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false)
  const [selectedQuery, setSelectedQuery] = useState<QueryHistoryItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

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

  const openQueryDetails = (query: QueryHistoryItem) => {
    setSelectedQuery(query)
    setDrawerOpen(true)
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
        comment: feedbackComment.trim()
      })
      
      setFeedbackDialog(null)
      setFeedbackComment("")
      setFeedbackRating(3)
      await loadHistory() // Reload to show updated feedback
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

  const getRatingIcon = (rating: string) => {
    switch (rating) {
      case 'positive':
        return <ThumbsUp className="w-4 h-4 text-green-500" />
      case 'negative':
        return <ThumbsDown className="w-4 h-4 text-red-500" />
      default:
        return <MessageSquare className="w-4 h-4 text-gray-500" />
    }
  }

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case 'positive':
        return 'bg-green-100 text-green-800 border-green-200'
      case 'negative':
        return 'bg-red-100 text-red-800 border-red-200'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
    }
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
                                {item.feedback && (
                                  <Badge className={`text-xs ${getRatingColor(item.feedback.rating)}`}>
                                    {getRatingIcon(item.feedback.rating)}
                                    <span className="ml-1">Feedback</span>
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
                        {item.feedback && (
                          <div>
                            <h4 className="font-medium text-sm">Feedback</h4>
                            <div className="flex items-start gap-2 mt-1">
                              {getRatingIcon(item.feedback.rating)}
                              <div className="flex-1">
                                <p className="text-xs text-muted-foreground">{item.feedback.comment}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  by {item.feedback.admin_username}
                                </p>
                              </div>
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
                    {selectedQuery.feedback && (
                      <Badge className={getRatingColor(selectedQuery.feedback.rating)}>
                        {getRatingIcon(selectedQuery.feedback.rating)}
                        <span className="ml-1">Has Feedback</span>
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Tabs */}
                <Tabs defaultValue="sql" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="sql">SQL Query</TabsTrigger>
                    <TabsTrigger value="explanation">Explanation</TabsTrigger>
                    <TabsTrigger value="feedback">Feedback</TabsTrigger>
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
                                <label className="text-sm font-medium">Rating (1-5)</label>
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
                              <div>
                                <label className="text-sm font-medium">Comment</label>
                                <Textarea
                                  placeholder="Enter your feedback..."
                                  value={feedbackComment}
                                  onChange={(e) => setFeedbackComment(e.target.value)}
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

                    {selectedQuery.feedback ? (
                      <div className="space-y-4">
                        <Card>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              {getRatingIcon(selectedQuery.feedback.rating)}
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge className={getRatingColor(selectedQuery.feedback.rating)}>
                                    {selectedQuery.feedback.rating}
                                  </Badge>
                                  <span className="text-sm text-muted-foreground">
                                    by {selectedQuery.feedback.admin_username}
                                  </span>
                                  <span className="text-sm text-muted-foreground">
                                    • {formatDate(selectedQuery.feedback.created_at)}
                                  </span>
                                </div>
                                <p className="text-sm leading-relaxed">
                                  {selectedQuery.feedback.comment}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
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
