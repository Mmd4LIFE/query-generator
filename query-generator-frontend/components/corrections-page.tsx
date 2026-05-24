"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ClipboardCheck,
  Copy,
  Check,
  MessageSquare,
  Clock,
  ChevronRight,
} from "lucide-react"
import { cn, roleInSector } from "@/lib/utils"
import type { QueryGeneratorAPI, Correction } from "@/lib/api"

interface CorrectionsPageProps {
  api: QueryGeneratorAPI
  userProfile: any
  activeSectorId: string | null
}

type StatusFilter = "all" | "pending" | "approved" | "rejected"

const STATUS_STYLE: Record<string, string> = {
  pending:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700",
  approved:
    "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700",
  rejected:
    "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize",
        STATUS_STYLE[status] ?? "bg-muted text-muted-foreground border-border"
      )}
    >
      {status}
    </span>
  )
}

function formatDate(dateString: string) {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMin < 1) return "Just now"
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function CorrectionsPage({ api, userProfile, activeSectorId }: CorrectionsPageProps) {
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [counts, setCounts] = useState({ all: 0, pending: 0, approved: 0, rejected: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState<StatusFilter>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Detail panel actions
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNotes, setRejectNotes] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Role — Colonel/General can approve or reject
  const currentRole = roleInSector(userProfile, activeSectorId)
  const canReview =
    userProfile?.is_general === true ||
    currentRole === "colonel" ||
    currentRole === "general"

  const loadAll = useCallback(async () => {
    if (!activeSectorId) return
    setIsLoading(true)
    setError("")
    try {
      const [all, pending, approved, rejected] = await Promise.all([
        api.listCorrections({ limit: 200 }),
        api.listCorrections({ status: "pending", limit: 1 }),
        api.listCorrections({ status: "approved", limit: 1 }),
        api.listCorrections({ status: "rejected", limit: 1 }),
      ])
      setCorrections(all.items)
      setCounts({
        all: all.total,
        pending: pending.total,
        approved: approved.total,
        rejected: rejected.total,
      })
    } catch (e: any) {
      if (e?.name === "SectorRequiredError") return
      setError(e?.message ?? "Failed to load corrections")
    } finally {
      setIsLoading(false)
    }
  }, [api, activeSectorId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const filtered = useMemo(() => {
    if (activeTab === "all") return corrections
    return corrections.filter((c) => c.status === activeTab)
  }, [corrections, activeTab])

  const selected = useMemo(
    () => corrections.find((c) => c.id === selectedId) ?? filtered[0] ?? null,
    [corrections, selectedId, filtered]
  )

  // Auto-select first item when tab changes
  useEffect(() => {
    setSelectedId(null)
    setRejectOpen(false)
    setRejectNotes("")
  }, [activeTab, activeSectorId])

  const handleApprove = async (id: string) => {
    setActionLoading(id)
    setError("")
    try {
      await api.approveCorrection(id)
      await loadAll()
      setSelectedId(null)
    } catch (e: any) {
      setError(e?.message ?? "Failed to approve")
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (id: string) => {
    setActionLoading(id)
    setError("")
    try {
      await api.rejectCorrection(id, rejectNotes.trim() || undefined)
      setRejectOpen(false)
      setRejectNotes("")
      await loadAll()
      setSelectedId(null)
    } catch (e: any) {
      setError(e?.message ?? "Failed to reject")
    } finally {
      setActionLoading(null)
    }
  }

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  if (!activeSectorId) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <div className="text-center space-y-2">
          <ClipboardCheck className="h-12 w-12 text-muted-foreground/40 mx-auto" />
          <p className="font-medium text-muted-foreground">Select a sector to view corrections</p>
        </div>
      </div>
    )
  }

  const TABS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ]

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* ---- Top bar ---- */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b bg-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Corrections</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              SQL corrections submitted by sector members for review.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={loadAll} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                activeTab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {t.label}
              {counts[t.key] > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                    activeTab === t.key
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : t.key === "pending"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {counts[t.key]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Body: two-pane inbox ---- */}
      <div className="flex flex-1 min-h-0">
        {/* Left pane — list */}
        <div className="w-80 shrink-0 border-r overflow-y-auto bg-muted/20">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground px-4 text-center">
              <ClipboardCheck className="h-10 w-10 opacity-25" />
              <p className="text-sm font-medium">No corrections</p>
              <p className="text-xs">
                {activeTab === "pending"
                  ? "Nothing waiting for review."
                  : activeTab === "approved"
                  ? "None approved yet."
                  : activeTab === "rejected"
                  ? "None rejected."
                  : "No corrections submitted yet."}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((c) => {
                const isActive = (selected?.id ?? null) === c.id ||
                  (!selectedId && filtered[0]?.id === c.id)
                return (
                  <li
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      "px-4 py-3.5 cursor-pointer hover:bg-muted/60 transition-colors",
                      isActive && "bg-muted border-l-2 border-l-primary"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={cn(
                          "text-sm leading-snug line-clamp-2 flex-1",
                          isActive ? "font-semibold" : "font-medium"
                        )}
                      >
                        {c.question}
                      </p>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <StatusBadge status={c.status} />
                      <span className="text-[11px] text-muted-foreground">
                        {c.created_by_username ?? "Unknown"}
                      </span>
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        {formatDate(c.created_at)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Right pane — detail */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center space-y-2">
                <ClipboardCheck className="h-12 w-12 opacity-20 mx-auto" />
                <p className="text-sm">Select a correction to review</p>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6 max-w-2xl">
              {/* Header row */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg leading-snug">{selected.question}</h3>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <StatusBadge status={selected.status} />
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(selected.created_at)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      by{" "}
                      <span className="font-medium text-foreground">
                        {selected.created_by_username ?? selected.created_by}
                      </span>
                    </span>
                    {selected.approved_by_username && (
                      <span className="text-xs text-muted-foreground">
                        · {selected.status === "approved" ? "approved" : "reviewed"} by{" "}
                        <span className="font-medium text-foreground">
                          {selected.approved_by_username}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Correct SQL */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Correct SQL
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1.5"
                    onClick={() => handleCopy(selected.correct_sql, selected.id)}
                  >
                    {copiedId === selected.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="text-emerald-600">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                <div className="rounded-lg border bg-muted/50 px-4 py-3 overflow-x-auto">
                  <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
                    {selected.correct_sql}
                  </pre>
                </div>
              </div>

              {/* Notes */}
              {selected.notes && (
                <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-4 py-3">
                  <MessageSquare className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground leading-relaxed">{selected.notes}</p>
                </div>
              )}

              {/* Actions — only for Colonel/General on pending corrections */}
              {canReview && selected.status === "pending" && (
                <div className="space-y-3 pt-2 border-t">
                  {!rejectOpen ? (
                    <div className="flex items-center gap-3">
                      <Button
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => handleApprove(selected.id)}
                        disabled={actionLoading !== null}
                      >
                        {actionLoading === selected.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        Approve & Embed
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2 text-red-600 border-red-300 hover:bg-red-50"
                        onClick={() => setRejectOpen(true)}
                        disabled={actionLoading !== null}
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50/30 dark:bg-red-950/20 p-4">
                      <p className="text-sm font-medium text-red-700 dark:text-red-400">
                        Rejection notes <span className="font-normal text-muted-foreground">(optional)</span>
                      </p>
                      <Textarea
                        placeholder="Explain why this correction is being rejected…"
                        value={rejectNotes}
                        onChange={(e) => setRejectNotes(e.target.value)}
                        rows={3}
                        className="text-sm resize-none"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="gap-1.5"
                          disabled={actionLoading !== null}
                          onClick={() => handleReject(selected.id)}
                        >
                          {actionLoading === selected.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5" />
                          )}
                          Confirm Reject
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setRejectOpen(false); setRejectNotes("") }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
