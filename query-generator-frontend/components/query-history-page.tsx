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
import { History, Copy, CheckCircle, AlertCircle, Loader2, MessageSquare, Star, ThumbsUp, ThumbsDown } from "lucide-react"
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
  const [copied, setCopied] = useState<string | null>(null)
  const [feedbackDialog, setFeedbackDialog] = useState<string | null>(null)
  const [feedbackComment, setFeedbackComment] = useState("")
  const [feedbackRating, setFeedbackRating] = useState<number>(3) // Default to 3 (neutral)
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false)

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

  const copyToClipboard = async (sql: string, id: string) => {
    await navigator.clipboard.writeText(sql)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
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
              <div className="space-y-4">
                {history.map((item) => (
                  <Card key={item.id} className="w-full">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-base mb-2">{item.question}</CardTitle>
                          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                            <Badge variant="outline" className="text-xs">
                              {item.catalog_name}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {item.engine}
                            </Badge>
                            <span>•</span>
                            <span>{formatDate(item.created_at)}</span>
                            <span>•</span>
                            <span>by {item.username}</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyToClipboard(item.generated_sql || '', item.id)}
                            className="h-8"
                          >
                            {copied === item.id ? (
                              <CheckCircle className="w-4 h-4" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </Button>
                          {permissions.isAdmin && (
                            <Dialog open={feedbackDialog === item.id} onOpenChange={(open) => {
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
                                  onClick={() => setFeedbackDialog(item.id)}
                                  className="h-8"
                                >
                                  <MessageSquare className="w-4 h-4" />
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
                                      onClick={() => submitFeedback(item.id)}
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
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Tabs defaultValue="sql" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 h-10 min-h-[44px]">
                          <TabsTrigger value="sql" className="text-xs sm:text-sm px-2">SQL Query</TabsTrigger>
                          <TabsTrigger value="explanation" className="text-xs sm:text-sm px-2">Explanation</TabsTrigger>
                        </TabsList>

                        <TabsContent value="sql" className="space-y-4 mt-4">
                          <div className="bg-muted p-3 sm:p-4 rounded-lg overflow-x-auto">
                            <pre className="text-xs sm:text-sm font-mono whitespace-pre-wrap text-foreground">{item.generated_sql || 'No SQL generated'}</pre>
                          </div>
                        </TabsContent>

                        <TabsContent value="explanation" className="space-y-4 mt-4">
                          <p className="text-sm text-muted-foreground leading-relaxed">{item.explanation}</p>
                        </TabsContent>
                      </Tabs>

                      {item.feedback && (
                        <div className="mt-4 pt-4 border-t">
                          <div className="flex items-start space-x-2">
                            {getRatingIcon(item.feedback.rating)}
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-1">
                                <Badge className={`text-xs ${getRatingColor(item.feedback.rating)}`}>
                                  {item.feedback.rating}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  by {item.feedback.admin_username} • {formatDate(item.feedback.created_at)}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground">{item.feedback.comment}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
