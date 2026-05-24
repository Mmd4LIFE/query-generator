"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ClipboardCheck,
  Copy,
  Check,
  MessageSquare,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { roleInSector } from "@/lib/utils"
import type { QueryGeneratorAPI, Correction } from "@/lib/api"
import { SectorRequiredError } from "@/lib/api"

interface CorrectionsPageProps {
  api: QueryGeneratorAPI
  userProfile: any
  activeSectorId: string | null
}

type StatusFilter = "all" | "pending" | "approved" | "rejected"

interface CorrectionCounts {
  all: number
  pending: number
  approved: number
  rejected: number
}

export function CorrectionsPage({ api, userProfile, activeSectorId }: CorrectionsPageProps) {
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState<StatusFilter>("all")
  const [counts, setCounts] = useState<CorrectionCounts>({ all: 0, pending: 0, approved: 0, rejected: 0 })

  // Per-card state
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectNotes, setRejectNotes] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Role check — colonel and general may approve/reject
  const currentRole = roleInSector(userProfile, activeSectorId)
  const canReview =
    currentRole === "colonel" ||
    currentRole === "general" ||
    userProfile?.is_general === true

  // Guard: no sector selected
  if (!activeSectorId) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-center space-y-2">
          <ClipboardCheck className="h-12 w-12 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground font-medium">Select a sector first</p>
          <p className="text-sm text-muted-foreground">
            Choose an active sector from the sidebar to view corrections.
          </p>
        </div>
      </div>
    )
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const loadCorrections = useCallback(
    async (statusFilter: StatusFilter) => {
      setIsLoading(true)
      setError("")
      try {
        const params: { status?: string; limit: number; offset: number } = {
          limit: 100,
          offset: 0,
        }
        if (statusFilter !== "all") {
          params.status = statusFilter
        }
        const result = await api.listCorrections(params)
        setCorrections(result.items)
        setTotal(result.total)

        // Refresh badge counts on every load
        const [pendingRes, approvedRes, rejectedRes] = await Promise.all([
          api.listCorrections({ status: "pending", limit: 1, offset: 0 }),
          api.listCorrections({ status: "approved", limit: 1, offset: 0 }),
          api.listCorrections({ status: "rejected", limit: 1, offset: 0 }),
        ])
        const allTotal =
          pendingRes.total + approvedRes.total + rejectedRes.total
        setCounts({
          all: allTotal,
          pending: pendingRes.total,
          approved: approvedRes.total,
          rejected: rejectedRes.total,
        })
      } catch (err: any) {
        if (err instanceof SectorRequiredError || err?.name === "SectorRequiredError") {
          return
        }
        console.error("Failed to load corrections:", err)
        setError("Failed to load corrections. Please try again.")
      } finally {
        setIsLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, activeSectorId]
  )

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    loadCorrections(activeTab)
  }, [activeTab, activeSectorId, loadCorrections])

  const handleTabChange = (value: string) => {
    setActiveTab(value as StatusFilter)
    setRejectingId(null)
    setRejectNotes("")
  }

  const handleApprove = async (correctionId: string) => {
    setActionLoading((prev) => ({ ...prev, [correctionId]: true }))
    try {
      await api.approveCorrection(correctionId)
      await loadCorrections(activeTab)
    } catch (err) {
      console.error("Failed to approve correction:", err)
      setError("Failed to approve correction. Please try again.")
    } finally {
      setActionLoading((prev) => ({ ...prev, [correctionId]: false }))
    }
  }

  const handleRejectSubmit = async (correctionId: string) => {
    setActionLoading((prev) => ({ ...prev, [correctionId]: true }))
    try {
      await api.rejectCorrection(correctionId, rejectNotes.trim() || undefined)
      setRejectingId(null)
      setRejectNotes("")
      await loadCorrections(activeTab)
    } catch (err) {
      console.error("Failed to reject correction:", err)
      setError("Failed to reject correction. Please try again.")
    } finally {
      setActionLoading((prev) => ({ ...prev, [correctionId]: false }))
    }
  }

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // silently fail
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    if (diffHours < 1) return "Just now"
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const statusBadge = (status: Correction["status"]) => {
    if (status === "pending") {
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800">
          Pending
        </Badge>
      )
    }
    if (status === "approved") {
      return (
        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800">
          Approved
        </Badge>
      )
    }
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800">
        Rejected
      </Badge>
    )
  }

  const tabBadge = (count: number) =>
    count > 0 ? (
      <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums">
        {count}
      </span>
    ) : null

  const EmptyState = () => (
    <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
      <ClipboardCheck className="h-14 w-14 text-muted-foreground/50" />
      <p className="font-medium text-muted-foreground">No corrections found</p>
      <p className="text-sm text-muted-foreground max-w-xs">
        {activeTab === "pending"
          ? "No pending corrections awaiting review."
          : activeTab === "approved"
          ? "No corrections have been approved yet."
          : activeTab === "rejected"
          ? "No corrections have been rejected."
          : "No corrections have been submitted yet."}
      </p>
    </div>
  )

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Corrections</h1>
        <p className="text-muted-foreground mt-1">
          SQL corrections submitted by soldiers awaiting review.
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Status Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="all" className="flex items-center">
            All{tabBadge(counts.all)}
          </TabsTrigger>
          <TabsTrigger value="pending" className="flex items-center">
            Pending{tabBadge(counts.pending)}
          </TabsTrigger>
          <TabsTrigger value="approved" className="flex items-center">
            Approved{tabBadge(counts.approved)}
          </TabsTrigger>
          <TabsTrigger value="rejected" className="flex items-center">
            Rejected{tabBadge(counts.rejected)}
          </TabsTrigger>
        </TabsList>

        {(["all", "pending", "approved", "rejected"] as StatusFilter[]).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-3 text-muted-foreground">Loading corrections...</span>
              </div>
            ) : corrections.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-4">
                {corrections.map((correction) => (
                  <Card
                    key={correction.id}
                    className={cn(
                      "border transition-colors",
                      correction.status === "pending" && "border-amber-200/60 dark:border-amber-800/40",
                      correction.status === "approved" && "border-emerald-200/60 dark:border-emerald-800/40",
                      correction.status === "rejected" && "border-red-200/60 dark:border-red-800/40"
                    )}
                  >
                    <CardContent className="p-5 space-y-4">
                      {/* Top row: question + status badge */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm leading-relaxed">
                            {correction.question}
                          </p>
                        </div>
                        <div className="shrink-0">{statusBadge(correction.status)}</div>
                      </div>

                      {/* Correct SQL block */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Correct SQL
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1.5"
                            onClick={() => handleCopy(correction.correct_sql, correction.id)}
                          >
                            {copiedId === correction.id ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                                <span className="text-emerald-500">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                Copy
                              </>
                            )}
                          </Button>
                        </div>
                        <div className="bg-muted rounded-md px-4 py-3 border border-border overflow-x-auto">
                          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                            {correction.correct_sql}
                          </pre>
                        </div>
                      </div>

                      {/* Notes (if any) */}
                      {correction.notes && (
                        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2 border border-border">
                          <MessageSquare className="h-4 w-4 shrink-0 mt-0.5" />
                          <span>{correction.notes}</span>
                        </div>
                      )}

                      {/* Footer: meta + actions */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1 border-t border-border/60">
                        {/* Submitted by + date */}
                        <div className="text-xs text-muted-foreground space-x-2">
                          <span>
                            Submitted by{" "}
                            <span className="font-medium text-foreground">
                              {correction.created_by_username ?? correction.created_by}
                            </span>
                          </span>
                          <span>&middot;</span>
                          <span>{formatDate(correction.created_at)}</span>
                          {correction.approved_by_username && (
                            <>
                              <span>&middot;</span>
                              <span>
                                {correction.status === "approved" ? "Approved" : "Reviewed"} by{" "}
                                <span className="font-medium text-foreground">
                                  {correction.approved_by_username}
                                </span>
                              </span>
                            </>
                          )}
                        </div>

                        {/* Action buttons — pending + colonel/general only */}
                        {canReview && correction.status === "pending" && (
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50 hover:border-emerald-400 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950"
                              disabled={actionLoading[correction.id]}
                              onClick={() => handleApprove(correction.id)}
                            >
                              {actionLoading[correction.id] && rejectingId !== correction.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              Approve
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1.5 text-red-700 border-red-300 hover:bg-red-50 hover:border-red-400 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
                              disabled={actionLoading[correction.id]}
                              onClick={() => {
                                if (rejectingId === correction.id) {
                                  setRejectingId(null)
                                  setRejectNotes("")
                                } else {
                                  setRejectingId(correction.id)
                                  setRejectNotes("")
                                }
                              }}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Inline reject form */}
                      {canReview &&
                        correction.status === "pending" &&
                        rejectingId === correction.id && (
                          <div className="space-y-2 pt-1 border-t border-border/60">
                            <p className="text-xs font-medium text-muted-foreground">
                              Rejection notes{" "}
                              <span className="font-normal">(optional)</span>
                            </p>
                            <Textarea
                              placeholder="Explain why this correction is being rejected..."
                              value={rejectNotes}
                              onChange={(e) => setRejectNotes(e.target.value)}
                              rows={3}
                              className="text-sm resize-none"
                            />
                            <div className="flex items-center gap-2 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8"
                                onClick={() => {
                                  setRejectingId(null)
                                  setRejectNotes("")
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-8 gap-1.5"
                                disabled={actionLoading[correction.id]}
                                onClick={() => handleRejectSubmit(correction.id)}
                              >
                                {actionLoading[correction.id] ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5" />
                                )}
                                Confirm Reject
                              </Button>
                            </div>
                          </div>
                        )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
