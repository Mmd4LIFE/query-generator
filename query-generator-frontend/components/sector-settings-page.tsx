"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Settings2,
  Lock,
  RotateCcw,
  Pencil,
  Check,
  X,
  Loader2,
  AlertCircle,
  RefreshCcw,
} from "lucide-react"
import type { QueryGeneratorAPI } from "@/lib/api"
import type { SettingItem } from "@/lib/api-client"
import { SectorRequiredError } from "@/lib/api"
import { cn } from "@/lib/utils"

interface SectorSettingsPageProps {
  api: QueryGeneratorAPI
}

// Format a dotted key like "retrieval.max_chunks" → "Retrieval Max Chunks"
function formatKey(key: string): string {
  return key
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// ------------------------------------------------------------------ //
// Source badge
// ------------------------------------------------------------------ //

function SourceBadge({ source }: { source?: string }) {
  if (source === "sector") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-400"
      >
        sector override
      </Badge>
    )
  }
  if (source === "global") {
    return (
      <Badge variant="secondary" className="text-[10px]">
        global default
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted">
      default
    </Badge>
  )
}

// ------------------------------------------------------------------ //
// Inline value editor (text, number, select, boolean)
// ------------------------------------------------------------------ //

interface ValueEditorProps {
  item: SettingItem
  value: any
  onChange: (v: any) => void
}

function ValueEditor({ item, value, onChange }: ValueEditorProps) {
  switch (item.ui_type) {
    case "select":
      return (
        <Select value={value ?? ""} onValueChange={onChange}>
          <SelectTrigger className="max-w-xs h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(item.choices || []).map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                <div className="flex flex-col">
                  <span>{choice.label}</span>
                  {choice.description && (
                    <span className="text-xs text-muted-foreground">
                      {choice.description}
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )

    case "boolean":
      return (
        <Select
          value={value === true || value === "true" ? "true" : "false"}
          onValueChange={(v) => onChange(v === "true")}
        >
          <SelectTrigger className="max-w-[120px] h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">True</SelectItem>
            <SelectItem value="false">False</SelectItem>
          </SelectContent>
        </Select>
      )

    case "number":
    case "int":
      return (
        <Input
          type="number"
          value={value ?? ""}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === "") return onChange(null)
            const n = Number.parseInt(raw, 10)
            if (!Number.isNaN(n)) onChange(n)
          }}
          className="max-w-[180px] h-8 text-sm"
        />
      )

    case "float":
      return (
        <Input
          type="number"
          step="0.05"
          value={value ?? ""}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === "") return onChange(null)
            const n = Number.parseFloat(raw)
            if (!Number.isNaN(n)) onChange(n)
          }}
          className="max-w-[180px] h-8 text-sm"
        />
      )

    default:
      return (
        <Input
          value={typeof value === "string" ? value : JSON.stringify(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
      )
  }
}

// ------------------------------------------------------------------ //
// Single setting row
// ------------------------------------------------------------------ //

interface SettingRowProps {
  item: SettingItem
  onSaved: (updated: SettingItem) => void
  onReset: (updated: SettingItem) => void
  onError: (msg: string) => void
  api: QueryGeneratorAPI
}

function SettingRow({ item, onSaved, onReset, onError, api }: SettingRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<any>(item.value)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  const isReadOnly = item.sector_overridable === false

  const openEdit = () => {
    setDraft(item.value)
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft(item.value)
  }

  const save = async () => {
    setSaving(true)
    try {
      const updated = await api.updateSectorSetting(item.key, draft)
      setEditing(false)
      onSaved(updated)
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 1500)
    } catch (e: any) {
      onError(e?.message || `Failed to save ${item.key}`)
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    setResetting(true)
    try {
      const updated = await api.resetSectorSetting(item.key)
      onReset(updated)
    } catch (e: any) {
      onError(e?.message || `Failed to reset ${item.key}`)
    } finally {
      setResetting(false)
    }
  }

  const displayValue =
    item.value === null || item.value === undefined
      ? <span className="text-muted-foreground italic text-xs">null</span>
      : typeof item.value === "boolean"
      ? <span className="font-mono text-xs">{item.value.toString()}</span>
      : <span className="font-mono text-xs">{JSON.stringify(item.value)}</span>

  return (
    <div
      className={cn(
        "border rounded-md p-4 space-y-3 transition-colors",
        isReadOnly && "opacity-60 bg-muted/20",
      )}
    >
      {/* Top row: name + badges + actions */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isReadOnly && (
              <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="font-medium text-sm">{formatKey(item.key)}</span>
            <span className="text-xs text-muted-foreground font-mono hidden sm:inline">
              {item.key}
            </span>
            <SourceBadge source={item.source} />
            {savedFlash && (
              <Badge variant="secondary" className="text-[10px]">
                <Check className="w-3 h-3 mr-1" /> saved
              </Badge>
            )}
          </div>
          {item.description && (
            <p className="text-xs text-muted-foreground">{item.description}</p>
          )}
        </div>

        {/* Action buttons — hidden for read-only settings */}
        {!isReadOnly && (
          <div className="flex items-center gap-1.5 shrink-0">
            {item.source === "sector" && !editing && (
              <Button
                size="sm"
                variant="ghost"
                onClick={reset}
                disabled={resetting || saving}
                title="Reset to global/default"
                className="h-7 w-7 p-0"
              >
                {resetting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
              </Button>
            )}
            {!editing && (
              <Button
                size="sm"
                variant="outline"
                onClick={openEdit}
                className="h-7 px-2 text-xs"
              >
                <Pencil className="w-3 h-3 mr-1" />
                Edit
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Current value display (shown when not editing) */}
      {!editing && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Current:</span>
          {displayValue}
        </div>
      )}

      {/* Inline edit form */}
      {editing && (
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">New value</span>
            <ValueEditor item={item} value={draft} onChange={setDraft} />
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={save}
              disabled={saving}
              className="h-8 px-3 text-xs"
            >
              {saving ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Check className="w-3 h-3 mr-1" />
              )}
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelEdit}
              disabled={saving}
              className="h-8 px-3 text-xs"
            >
              <X className="w-3 h-3 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ //
// Main page
// ------------------------------------------------------------------ //

export function SectorSettingsPage({ api }: SectorSettingsPageProps) {
  const [items, setItems] = useState<SettingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noSector, setNoSector] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    setNoSector(false)
    try {
      const data = await api.listSectorSettings()
      setItems(data)
    } catch (e: any) {
      if (e instanceof SectorRequiredError) {
        setNoSector(true)
      } else {
        setError(e?.message || "Failed to load sector settings")
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSaved = (updated: SettingItem) => {
    setItems((prev) => prev.map((s) => (s.key === updated.key ? updated : s)))
  }

  const handleReset = (updated: SettingItem) => {
    setItems((prev) => prev.map((s) => (s.key === updated.key ? updated : s)))
  }

  const handleError = (msg: string) => {
    setError(msg)
  }

  // Group by category, sort keys within each group
  const byCategory = useMemo(() => {
    const out: Record<string, SettingItem[]> = {}
    for (const item of items) {
      ;(out[item.category] ||= []).push(item)
    }
    Object.values(out).forEach((arr) =>
      arr.sort((a, b) => a.key.localeCompare(b.key)),
    )
    return out
  }, [items])

  // ---- Render ----

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings2 className="w-6 h-6" />
            Sector Settings
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Override global defaults for this sector. Changes take effect
            immediately for all members.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCcw className="w-4 h-4 mr-2" />
          )}
          Reload
        </Button>
      </div>

      {/* No-sector notice */}
      {noSector && (
        <Alert>
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>
            Select a sector to manage its settings.
          </AlertDescription>
        </Alert>
      )}

      {/* Generic error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading spinner */}
      {loading && items.length === 0 && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Loading settings…
        </div>
      )}

      {/* Empty state (loaded, no error, no items) */}
      {!loading && !error && !noSector && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Settings2 className="w-8 h-8 opacity-40" />
          <p className="text-sm">No settings available for this sector.</p>
        </div>
      )}

      {/* Category sections */}
      {Object.entries(byCategory).map(([category, group]) => (
        <Card key={category}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base capitalize flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              {category}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {group.map((item) => (
              <SettingRow
                key={item.key}
                item={item}
                api={api}
                onSaved={handleSaved}
                onReset={handleReset}
                onError={handleError}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
