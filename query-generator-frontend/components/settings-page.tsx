"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCcw,
  Save,
  Settings as SettingsIcon,
  Sliders,
  Cpu,
  Wand2,
  Layers,
  RotateCcw,
} from "lucide-react"
import type {
  QueryGeneratorAPI,
} from "@/lib/api"
import type { SettingItem } from "@/lib/api-client"

interface SettingsPageProps {
  api: QueryGeneratorAPI
}

const CATEGORY_META: Record<string, { label: string; icon: any; description: string }> = {
  generation: {
    label: "Generation",
    icon: Cpu,
    description: "OpenAI chat model, max tokens, temperature.",
  },
  retrieval: {
    label: "Retrieval",
    icon: Layers,
    description: "Per-kind chunk budgets and context size.",
  },
  embeddings: {
    label: "Embeddings",
    icon: Sliders,
    description: "Batch size and embed model (model change is reference-only for now).",
  },
  prompt: {
    label: "Prompt",
    icon: Wand2,
    description: "System prompt template. Supports {dialect} and {catalog_name} placeholders.",
  },
}

// `value` we hold locally for each setting — string or number for scalars,
// object for kind_budget, etc. The backend validates on PUT, we just keep
// what the user typed in the form.
type Draft = Record<string, any>

export function SettingsPage({ api }: SettingsPageProps) {
  const [items, setItems] = useState<SettingItem[]>([])
  const [draft, setDraft] = useState<Draft>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listSettings()
      setItems(data)
      const initial: Draft = {}
      for (const item of data) initial[item.key] = item.value
      setDraft(initial)
    } catch (e: any) {
      setError(e?.message || "Failed to load settings")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const isDirty = (item: SettingItem) =>
    JSON.stringify(draft[item.key]) !== JSON.stringify(item.value)

  const save = async (item: SettingItem) => {
    setSavingKey(item.key)
    setError(null)
    setSavedFlash(null)
    try {
      const updated = await api.updateSetting(item.key, draft[item.key])
      setItems((prev) => prev.map((s) => (s.key === item.key ? updated : s)))
      setDraft((prev) => ({ ...prev, [item.key]: updated.value }))
      setSavedFlash(item.key)
      window.setTimeout(() => setSavedFlash(null), 1500)
    } catch (e: any) {
      setError(
        e?.message ||
          `Failed to save ${item.key}. Check the value matches the expected type/range.`,
      )
    } finally {
      setSavingKey(null)
    }
  }

  const reset = async (item: SettingItem) => {
    setResetKey(item.key)
    setError(null)
    try {
      const updated = await api.resetSetting(item.key)
      setItems((prev) => prev.map((s) => (s.key === item.key ? updated : s)))
      setDraft((prev) => ({ ...prev, [item.key]: updated.value }))
    } catch (e: any) {
      setError(e?.message || `Failed to reset ${item.key}`)
    } finally {
      setResetKey(null)
    }
  }

  const byCategory = useMemo(() => {
    const out: Record<string, SettingItem[]> = {}
    for (const item of items) {
      ;(out[item.category] ||= []).push(item)
    }
    // Keep stable key order within a category for less UI churn on reload.
    Object.values(out).forEach((arr) =>
      arr.sort((a, b) => a.key.localeCompare(b.key)),
    )
    return out
  }, [items])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SettingsIcon className="w-6 h-6" /> Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Runtime configuration for the query generator. Changes take effect
            immediately — no redeploy required.
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

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && items.length === 0 && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Loading settings…
        </div>
      )}

      {Object.entries(byCategory).map(([category, group]) => {
        const meta = CATEGORY_META[category] || {
          label: category,
          icon: SettingsIcon,
          description: "",
        }
        const Icon = meta.icon
        return (
          <Card key={category}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Icon className="w-5 h-5" />
                {meta.label}
              </CardTitle>
              {meta.description && (
                <CardDescription>{meta.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              {group.map((item) => (
                <SettingRow
                  key={item.key}
                  item={item}
                  draftValue={draft[item.key]}
                  onChange={(v) =>
                    setDraft((prev) => ({ ...prev, [item.key]: v }))
                  }
                  onSave={() => save(item)}
                  onReset={() => reset(item)}
                  isDirty={isDirty(item)}
                  isSaving={savingKey === item.key}
                  isResetting={resetKey === item.key}
                  justSaved={savedFlash === item.key}
                />
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

interface SettingRowProps {
  item: SettingItem
  draftValue: any
  onChange: (value: any) => void
  onSave: () => void
  onReset: () => void
  isDirty: boolean
  isSaving: boolean
  isResetting: boolean
  justSaved: boolean
}

function SettingRow({
  item,
  draftValue,
  onChange,
  onSave,
  onReset,
  isDirty,
  isSaving,
  isResetting,
  justSaved,
}: SettingRowProps) {
  return (
    <div className="border rounded-md p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="font-mono text-sm">{item.key}</Label>
            {item.is_default && (
              <Badge variant="outline" className="text-[10px]">
                default
              </Badge>
            )}
            {justSaved && (
              <Badge variant="secondary" className="text-[10px]">
                <CheckCircle2 className="w-3 h-3 mr-1" /> saved
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{item.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!item.is_default && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onReset}
              disabled={isResetting || isSaving}
              title="Reset to default"
            >
              {isResetting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
            </Button>
          )}
          <Button
            size="sm"
            onClick={onSave}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" /> Save
              </>
            )}
          </Button>
        </div>
      </div>

      <ValueEditor item={item} value={draftValue} onChange={onChange} />
    </div>
  )
}

function ValueEditor({
  item,
  value,
  onChange,
}: {
  item: SettingItem
  value: any
  onChange: (v: any) => void
}) {
  switch (item.ui_type) {
    case "select":
      return (
        <Select value={value ?? ""} onValueChange={onChange}>
          <SelectTrigger className="max-w-md">
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
          className="max-w-xs"
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
          className="max-w-xs"
        />
      )

    case "textarea":
      return (
        <Textarea
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={16}
          className="font-mono text-xs"
        />
      )

    case "kind_budget":
      return <KindBudgetEditor value={value || {}} onChange={onChange} />

    default:
      // Fallback for plain string-shaped settings
      return (
        <Input
          value={typeof value === "string" ? value : JSON.stringify(value)}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-md"
        />
      )
  }
}

function KindBudgetEditor({
  value,
  onChange,
}: {
  value: Record<string, number>
  onChange: (v: Record<string, number>) => void
}) {
  const KINDS: Array<{ key: string; label: string; hint: string }> = [
    { key: "correction", label: "Correction", hint: "User feedback corrections" },
    { key: "example", label: "Example", hint: "Approved query patterns" },
    { key: "metric", label: "Metric", hint: "Canonical metric definitions" },
    { key: "note", label: "Note", hint: "Catalog-scoped guidelines" },
    { key: "object", label: "Object", hint: "Schema tables/columns" },
  ]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 max-w-3xl">
      {KINDS.map((k) => (
        <div key={k.key} className="space-y-1">
          <Label className="text-xs font-mono">{k.label}</Label>
          <Input
            type="number"
            min={0}
            max={50}
            value={value[k.key] ?? 0}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              onChange({ ...value, [k.key]: Number.isNaN(n) ? 0 : n })
            }}
          />
          <p className="text-[10px] text-muted-foreground">{k.hint}</p>
        </div>
      ))}
    </div>
  )
}
