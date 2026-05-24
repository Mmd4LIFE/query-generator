"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  TrendingUp,
  DollarSign,
  Zap,
  BarChart2,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { QueryGeneratorAPI, CostRow, CostSummary } from "@/lib/api"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SectorGroupBy = "user" | "day" | "model"
type GlobalGroupBy = "user" | "day" | "model" | "sector"

interface CostDashboardPageProps {
  api: QueryGeneratorAPI
  userProfile: any
  activeSectorId: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function errorRate(row: CostRow): string {
  if (row.requests === 0) return "0.00%"
  return `${((row.errors / row.requests) * 100).toFixed(2)}%`
}

function groupByLabel(groupBy: GlobalGroupBy): string {
  switch (groupBy) {
    case "user":
      return "User"
    case "day":
      return "Date"
    case "model":
      return "Model"
    case "sector":
      return "Sector"
  }
}

function rowDisplayName(row: CostRow): string {
  return row.label ?? row.key
}

function sortedRows(rows: CostRow[]): CostRow[] {
  return [...rows].sort((a, b) => b.cost_usd - a.cost_usd)
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string
  className?: string
}

function StatCard({ icon, label, value, className }: StatCardProps) {
  return (
    <Card className={cn("flex-1 min-w-[140px]", className)}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="shrink-0 text-muted-foreground">{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground leading-tight">{label}</p>
          <p className="text-xl font-bold tracking-tight truncate">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

interface CostTableProps {
  summary: CostSummary
  groupBy: GlobalGroupBy
}

function CostTable({ summary, groupBy }: CostTableProps) {
  const nameHeader = groupByLabel(groupBy)
  const rows = sortedRows(summary.rows)

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <BarChart2 className="h-10 w-10" />
        <p>No cost data available for this period.</p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{nameHeader}</TableHead>
          <TableHead className="text-right">Requests</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="font-medium">{rowDisplayName(row)}</TableCell>
            <TableCell className="text-right text-sm">
              <span className="mr-1">{formatNumber(row.requests)}</span>
              {row.errors > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1 py-0">
                  {row.errors} err
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-right text-sm">
              {formatNumber(row.total_tokens)}
            </TableCell>
            <TableCell className="text-right text-sm font-mono">
              {formatCost(row.cost_usd)}
            </TableCell>
          </TableRow>
        ))}
        {/* Total row */}
        <TableRow className="border-t-2 font-bold bg-muted/40">
          <TableCell>Total</TableCell>
          <TableCell className="text-right">{formatNumber(summary.total.requests)}</TableCell>
          <TableCell className="text-right">{formatNumber(summary.total.total_tokens)}</TableCell>
          <TableCell className="text-right font-mono">
            {formatCost(summary.total.cost_usd)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

// ---------------------------------------------------------------------------
// Date range filter bar
// ---------------------------------------------------------------------------

interface DateRangeFilterProps {
  fromDate: string
  toDate: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  onReload: () => void
  isLoading: boolean
}

function DateRangeFilter({
  fromDate,
  toDate,
  onFromChange,
  onToChange,
  onReload,
  isLoading,
}: DateRangeFilterProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="from-date" className="text-xs">
          From
        </Label>
        <Input
          id="from-date"
          type="date"
          value={fromDate}
          onChange={(e) => onFromChange(e.target.value)}
          className="h-8 w-36 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="to-date" className="text-xs">
          To
        </Label>
        <Input
          id="to-date"
          type="date"
          value={toDate}
          onChange={(e) => onToChange(e.target.value)}
          className="h-8 w-36 text-sm"
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onReload}
        disabled={isLoading}
        className="h-8 gap-1"
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        Refresh
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CostDashboardPage({
  api,
  userProfile,
  activeSectorId,
}: CostDashboardPageProps) {
  const isGeneral = userProfile?.is_general === true

  // Sector cost state
  const [sectorSummary, setSectorSummary] = useState<CostSummary | null>(null)
  const [sectorGroupBy, setSectorGroupBy] = useState<SectorGroupBy>("user")
  const [sectorLoading, setSectorLoading] = useState(false)
  const [sectorError, setSectorError] = useState("")

  // Global cost state (General only)
  const [globalSummary, setGlobalSummary] = useState<CostSummary | null>(null)
  const [globalGroupBy, setGlobalGroupBy] = useState<GlobalGroupBy>("sector")
  const [globalLoading, setGlobalLoading] = useState(false)
  const [globalError, setGlobalError] = useState("")

  // Shared date range
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadSectorCost = useCallback(async () => {
    if (!activeSectorId) return
    setSectorLoading(true)
    setSectorError("")
    try {
      const result = await api.getSectorCostSummary({
        groupBy: sectorGroupBy,
        from: fromDate || undefined,
        to: toDate || undefined,
      })
      setSectorSummary(result)
    } catch (err: any) {
      setSectorError(err?.message ?? "Failed to load sector cost data.")
    } finally {
      setSectorLoading(false)
    }
  }, [api, activeSectorId, sectorGroupBy, fromDate, toDate])

  const loadGlobalCost = useCallback(async () => {
    if (!isGeneral) return
    setGlobalLoading(true)
    setGlobalError("")
    try {
      const result = await api.getGlobalCostSummary({
        groupBy: globalGroupBy,
        from: fromDate || undefined,
        to: toDate || undefined,
      })
      setGlobalSummary(result)
    } catch (err: any) {
      setGlobalError(err?.message ?? "Failed to load global cost data.")
    } finally {
      setGlobalLoading(false)
    }
  }, [api, isGeneral, globalGroupBy, fromDate, toDate])

  // Reload whenever activeSectorId changes or groupBy changes
  useEffect(() => {
    loadSectorCost()
  }, [loadSectorCost])

  useEffect(() => {
    loadGlobalCost()
  }, [loadGlobalCost])

  const handleReload = () => {
    loadSectorCost()
    loadGlobalCost()
  }

  // -------------------------------------------------------------------------
  // Guard: no sector selected
  // -------------------------------------------------------------------------

  if (!activeSectorId) {
    return (
      <div className="p-6 flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6" />
            Cost Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor API usage and spending across queries and models.
          </p>
        </div>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Select a sector to view cost data.</AlertDescription>
        </Alert>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Summary stat cards — derived from sector summary (or global if none yet)
  // -------------------------------------------------------------------------

  const statSource = sectorSummary?.total ?? null

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6" />
            Cost Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor API usage and spending across queries and models.
          </p>
        </div>
        {isGeneral && (
          <Badge variant="outline" className="self-start mt-1">
            General — global view enabled
          </Badge>
        )}
      </div>

      {/* Date Range Filter */}
      <DateRangeFilter
        fromDate={fromDate}
        toDate={toDate}
        onFromChange={setFromDate}
        onToChange={setToDate}
        onReload={handleReload}
        isLoading={sectorLoading || globalLoading}
      />

      {/* Stat Cards */}
      <div className="flex flex-wrap gap-3">
        <StatCard
          icon={<DollarSign className="h-5 w-5" />}
          label="Total Spend"
          value={statSource ? formatCost(statSource.cost_usd) : "—"}
        />
        <StatCard
          icon={<BarChart2 className="h-5 w-5" />}
          label="Total Queries"
          value={statSource ? formatNumber(statSource.requests) : "—"}
        />
        <StatCard
          icon={<Zap className="h-5 w-5" />}
          label="Total Tokens"
          value={statSource ? formatNumber(statSource.total_tokens) : "—"}
        />
        <StatCard
          icon={<AlertCircle className="h-5 w-5" />}
          label="Error Rate"
          value={statSource ? errorRate(statSource) : "—"}
        />
      </div>

      {/* Error alerts */}
      {sectorError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{sectorError}</AlertDescription>
        </Alert>
      )}
      {globalError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{globalError}</AlertDescription>
        </Alert>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* General layout: two sections                                       */}
      {/* ----------------------------------------------------------------- */}
      {isGeneral ? (
        <div className="flex flex-col gap-6">
          {/* --- This Sector --- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart2 className="h-4 w-4" />
                This Sector
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Tabs
                value={sectorGroupBy}
                onValueChange={(v) => setSectorGroupBy(v as SectorGroupBy)}
              >
                <TabsList className="mb-4">
                  <TabsTrigger value="user">By User</TabsTrigger>
                  <TabsTrigger value="day">By Day</TabsTrigger>
                  <TabsTrigger value="model">By Model</TabsTrigger>
                </TabsList>

                {(["user", "day", "model"] as SectorGroupBy[]).map((gb) => (
                  <TabsContent key={gb} value={gb}>
                    {sectorLoading ? (
                      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span>Loading cost data...</span>
                      </div>
                    ) : sectorSummary ? (
                      <CostTable summary={sectorSummary} groupBy={gb} />
                    ) : null}
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          {/* --- All Sectors --- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                All Sectors
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Tabs
                value={globalGroupBy}
                onValueChange={(v) => setGlobalGroupBy(v as GlobalGroupBy)}
              >
                <TabsList className="mb-4">
                  <TabsTrigger value="sector">By Sector</TabsTrigger>
                  <TabsTrigger value="user">By User</TabsTrigger>
                  <TabsTrigger value="day">By Day</TabsTrigger>
                  <TabsTrigger value="model">By Model</TabsTrigger>
                </TabsList>

                {(["sector", "user", "day", "model"] as GlobalGroupBy[]).map((gb) => (
                  <TabsContent key={gb} value={gb}>
                    {globalLoading ? (
                      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span>Loading global cost data...</span>
                      </div>
                    ) : globalSummary ? (
                      <CostTable summary={globalSummary} groupBy={gb} />
                    ) : null}
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>
        </div>
      ) : (
        /* --------------------------------------------------------------- */
        /* Colonel layout: single section                                    */
        /* --------------------------------------------------------------- */
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart2 className="h-4 w-4" />
              Sector Cost Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Tabs
              value={sectorGroupBy}
              onValueChange={(v) => setSectorGroupBy(v as SectorGroupBy)}
            >
              <TabsList className="mb-4">
                <TabsTrigger value="user">By User</TabsTrigger>
                <TabsTrigger value="day">By Day</TabsTrigger>
                <TabsTrigger value="model">By Model</TabsTrigger>
              </TabsList>

              {(["user", "day", "model"] as SectorGroupBy[]).map((gb) => (
                <TabsContent key={gb} value={gb}>
                  {sectorLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span>Loading cost data...</span>
                    </div>
                  ) : sectorSummary ? (
                    <CostTable summary={sectorSummary} groupBy={gb} />
                  ) : null}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
