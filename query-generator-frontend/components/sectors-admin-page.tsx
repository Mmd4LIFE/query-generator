"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Plus,
  Edit,
  Archive,
  Users,
  UserPlus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Shield,
  LayoutGrid,
  FolderArchive,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { QueryGeneratorAPI, Sector, UserProfile } from "@/lib/api"

interface Props {
  api: QueryGeneratorAPI
  onSectorsChanged?: () => void
}

interface Member {
  user_id: string
  username: string
  email: string
  full_name?: string | null
  role: "colonel" | "captain" | "soldier"
}

type DraftSector = { code: string; name: string; description: string }

const ROLE_STYLE: Record<string, string> = {
  colonel:
    "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700",
  captain:
    "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700",
  soldier:
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700",
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .map((n) => n[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize",
        ROLE_STYLE[role] ?? "bg-muted text-muted-foreground border-border"
      )}
    >
      {role}
    </span>
  )
}

function StatCard({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={cn("text-4xl font-bold mt-2 tracking-tight", muted && "text-muted-foreground")}>
        {value}
      </p>
    </div>
  )
}

export function SectorsAdminPage({ api, onSectorsChanged }: Props) {
  const [sectors, setSectors] = useState<Sector[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>("")

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [membersBySector, setMembersBySector] = useState<Record<string, Member[]>>({})
  const [membersLoading, setMembersLoading] = useState<Record<string, boolean>>({})

  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<DraftSector>({ code: "", name: "", description: "" })
  const [createSaving, setCreateSaving] = useState(false)

  const [editTarget, setEditTarget] = useState<Sector | null>(null)
  const [editDraft, setEditDraft] = useState<DraftSector & { is_active: boolean }>({
    code: "", name: "", description: "", is_active: true,
  })
  const [editSaving, setEditSaving] = useState(false)

  const [archiveTarget, setArchiveTarget] = useState<Sector | null>(null)

  const [assignOpenFor, setAssignOpenFor] = useState<string | null>(null)
  const [assignUserId, setAssignUserId] = useState<string>("")
  const [assignRole, setAssignRole] = useState<"colonel" | "captain" | "soldier">("soldier")
  const [assignSaving, setAssignSaving] = useState(false)
  const [assignError, setAssignError] = useState<string>("")

  // ---- Loaders -----------------------------------------------------------

  const loadSectors = async () => {
    try {
      const list = await api.listSectors()
      setSectors(list)
    } catch (e: any) {
      setError(e?.message ?? "Failed to load Sectors")
    }
  }

  const loadUsers = async () => {
    try {
      const list = await api.getUsers()
      setUsers(list)
    } catch (e: any) {
      console.error("Failed to load users", e)
    }
  }

  const loadMembers = async (sectorId: string) => {
    setMembersLoading((m) => ({ ...m, [sectorId]: true }))
    try {
      const list = await api.listSectorMembers(sectorId)
      setMembersBySector((m) => ({ ...m, [sectorId]: list }))
    } catch (e: any) {
      setMembersBySector((m) => ({ ...m, [sectorId]: [] }))
      console.error("Failed to load members", e)
    } finally {
      setMembersLoading((m) => ({ ...m, [sectorId]: false }))
    }
  }

  useEffect(() => {
    ;(async () => {
      setIsLoading(true)
      await Promise.all([loadSectors(), loadUsers()])
      setIsLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Mutations ---------------------------------------------------------

  const handleCreate = async () => {
    setCreateSaving(true)
    setError("")
    try {
      await api.createSector({
        code: createDraft.code.trim(),
        name: createDraft.name.trim(),
        description: createDraft.description.trim() || undefined,
      })
      setCreateOpen(false)
      setCreateDraft({ code: "", name: "", description: "" })
      await loadSectors()
      onSectorsChanged?.()
    } catch (e: any) {
      setError(e?.message ?? "Failed to create Sector")
    } finally {
      setCreateSaving(false)
    }
  }

  const handleEdit = async () => {
    if (!editTarget) return
    setEditSaving(true)
    setError("")
    try {
      await api.updateSector(editTarget.id, {
        name: editDraft.name.trim() || undefined,
        description: editDraft.description.trim() || undefined,
        is_active: editDraft.is_active,
      })
      setEditTarget(null)
      await loadSectors()
      onSectorsChanged?.()
    } catch (e: any) {
      setError(e?.message ?? "Failed to update Sector")
    } finally {
      setEditSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!archiveTarget) return
    setError("")
    try {
      await api.deleteSector(archiveTarget.id)
      setArchiveTarget(null)
      await loadSectors()
      onSectorsChanged?.()
    } catch (e: any) {
      setError(e?.message ?? "Failed to archive Sector")
    }
  }

  const handleAssign = async (sectorId: string) => {
    if (!assignUserId) {
      setAssignError("Pick a user")
      return
    }
    setAssignSaving(true)
    setAssignError("")
    try {
      await api.assignUserRole(assignUserId, assignRole, sectorId)
      setAssignOpenFor(null)
      setAssignUserId("")
      setAssignRole("soldier")
      await loadMembers(sectorId)
    } catch (e: any) {
      setAssignError(e?.message ?? "Failed to assign role")
    } finally {
      setAssignSaving(false)
    }
  }

  const handleRemove = async (sectorId: string, userId: string) => {
    try {
      await api.removeUserRole(userId, sectorId)
      await loadMembers(sectorId)
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove member")
    }
  }

  const toggleExpand = (sectorId: string) => {
    setExpanded((m) => ({ ...m, [sectorId]: !m[sectorId] }))
    if (!membersBySector[sectorId]) {
      loadMembers(sectorId)
    }
  }

  // ---- Derived -----------------------------------------------------------

  const eligibleAssignees = (sectorId: string) => {
    const members = membersBySector[sectorId] ?? []
    const taken = new Set(members.map((m) => m.user_id))
    return users.filter((u) => u.is_active && !taken.has(u.id) && !(u as any).is_general)
  }

  const activeSectors = sectors.filter((s) => s.is_active)
  const archivedSectors = sectors.filter((s) => !s.is_active)

  // ---- Render ------------------------------------------------------------

  return (
    <div className="p-6 space-y-6 overflow-auto max-h-[calc(100vh-4rem)]">

      {/* ---- Page header ---- */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Sectors</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage isolated operational environments — each with its own catalogs, knowledge, and access rules.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          New Sector
        </Button>
      </div>

      {/* ---- Stats strip ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Active" value={activeSectors.length} />
        <StatCard label="Archived" value={archivedSectors.length} muted />
        <div className="rounded-xl border bg-card p-5 col-span-2 sm:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Total</p>
          <p className="text-4xl font-bold mt-2 tracking-tight">{sectors.length}</p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ---- Sector list ---- */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sectors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
            <LayoutGrid className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="font-medium">No Sectors yet</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Create your first Sector to start organising catalogs and team access.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sectors.map((sector) => {
            const isOpen = !!expanded[sector.id]
            const members = membersBySector[sector.id] ?? []
            const loadingMembers = !!membersLoading[sector.id]
            const assignees = eligibleAssignees(sector.id)
            const knownCount = membersBySector[sector.id]

            return (
              <div
                key={sector.id}
                className={cn(
                  "rounded-xl border bg-card overflow-hidden shadow-sm transition-opacity",
                  !sector.is_active && "opacity-60"
                )}
              >
                {/* ---- Sector row ---- */}
                <div className="flex items-center gap-4 px-5 py-4">
                  {/* Icon */}
                  <div
                    className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                      sector.is_active ? "bg-primary/10" : "bg-muted"
                    )}
                  >
                    <Shield
                      className={cn(
                        "w-5 h-5",
                        sector.is_active ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                  </div>

                  {/* Name + code + description */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-base leading-tight">{sector.name}</span>
                      <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                        {sector.code}
                      </code>
                      {!sector.is_active && (
                        <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          <FolderArchive className="h-3 w-3" />
                          Archived
                        </span>
                      )}
                    </div>
                    {sector.description && (
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
                        {sector.description}
                      </p>
                    )}
                  </div>

                  {/* Right actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {knownCount && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 mr-2">
                        <Users className="w-3.5 h-3.5" />
                        {knownCount.length}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setEditTarget(sector)
                        setEditDraft({
                          code: sector.code,
                          name: sector.name,
                          description: sector.description ?? "",
                          is_active: sector.is_active,
                        })
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    {sector.is_active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => setArchiveTarget(sector)}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-3 text-muted-foreground hover:text-foreground gap-1.5 ml-1"
                      onClick={() => toggleExpand(sector.id)}
                    >
                      <Users className="h-4 w-4" />
                      <span className="text-sm hidden sm:inline">Members</span>
                      {isOpen
                        ? <ChevronDown className="h-3.5 w-3.5" />
                        : <ChevronRight className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

                {/* ---- Members panel ---- */}
                {isOpen && (
                  <div className="border-t bg-muted/20 px-5 py-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-muted-foreground">
                        {loadingMembers
                          ? "Loading members…"
                          : `${members.length} member${members.length !== 1 ? "s" : ""}`}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setAssignOpenFor(sector.id)
                          setAssignUserId("")
                          setAssignRole("soldier")
                          setAssignError("")
                        }}
                        disabled={assignees.length === 0}
                        title={
                          assignees.length === 0
                            ? "All active users already have a role here"
                            : ""
                        }
                      >
                        <UserPlus className="mr-1 h-3 w-3" />
                        Add member
                      </Button>
                    </div>

                    {loadingMembers ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : members.length === 0 ? (
                      <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
                        <Users className="h-8 w-8 opacity-25" />
                        <p className="text-sm">No members yet. Add a Colonel to get this Sector running.</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {members.map((m) => {
                          const displayName = m.full_name || m.username
                          return (
                            <div
                              key={m.user_id}
                              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors"
                            >
                              {/* Avatar */}
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                                {getInitials(displayName)}
                              </div>

                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium leading-tight">{displayName}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {m.full_name ? `@${m.username} · ` : ""}
                                  {m.email}
                                </p>
                              </div>

                              <RoleBadge role={m.role} />

                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                                onClick={() => handleRemove(sector.id, m.user_id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* ---- Inline assign form ---- */}
                    {assignOpenFor === sector.id && (
                      <div className="rounded-lg border border-dashed bg-card px-4 py-4 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Assign member
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">User</Label>
                            <Select value={assignUserId} onValueChange={setAssignUserId}>
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder="Select user" />
                              </SelectTrigger>
                              <SelectContent>
                                {assignees.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>
                                    {(u as any).full_name || u.username}
                                    <span className="text-muted-foreground ml-1 text-xs">
                                      @{u.username}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Role</Label>
                            <Select
                              value={assignRole}
                              onValueChange={(v) => setAssignRole(v as any)}
                            >
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="colonel">Colonel — sector admin</SelectItem>
                                <SelectItem value="captain">Captain — knowledge author</SelectItem>
                                <SelectItem value="soldier">Soldier — generate-only</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-end gap-2">
                            <Button
                              size="sm"
                              className="flex-1 h-8"
                              onClick={() => handleAssign(sector.id)}
                              disabled={assignSaving || !assignUserId}
                            >
                              {assignSaving
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : "Assign"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() => setAssignOpenFor(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                        {assignError && (
                          <p className="text-xs text-destructive">{assignError}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ---- Create dialog ---- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Sector</DialogTitle>
            <DialogDescription>
              A Sector owns its own catalogs, knowledge, policies, and history.
              Pick a short code (lowercase, no spaces) and a human-readable name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-sector-code">Code</Label>
              <Input
                id="new-sector-code"
                placeholder="ops"
                value={createDraft.code}
                onChange={(e) =>
                  setCreateDraft({ ...createDraft, code: e.target.value.toLowerCase().replace(/\s+/g, "_") })
                }
              />
              <p className="text-xs text-muted-foreground">Lowercase, no spaces. Used in URLs and logs.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-sector-name">Name</Label>
              <Input
                id="new-sector-name"
                placeholder="Operations"
                value={createDraft.name}
                onChange={(e) => setCreateDraft({ ...createDraft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-sector-description">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                id="new-sector-description"
                placeholder="What does this Sector cover?"
                value={createDraft.description}
                onChange={(e) => setCreateDraft({ ...createDraft, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={createSaving || !createDraft.code || !createDraft.name}
            >
              {createSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Create Sector
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Edit dialog ---- */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Sector</DialogTitle>
            <DialogDescription>The code is immutable. Rename or archive any time.</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Code</Label>
                <Input value={editDraft.code} disabled className="font-mono text-muted-foreground" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-sector-name">Name</Label>
                <Input
                  id="edit-sector-name"
                  value={editDraft.name}
                  onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-sector-description">Description</Label>
                <Textarea
                  id="edit-sector-description"
                  value={editDraft.description}
                  onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                <div>
                  <Label htmlFor="edit-active" className="font-medium">Active</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Inactive Sectors are read-only until reactivated.
                  </p>
                </div>
                <Switch
                  id="edit-active"
                  checked={editDraft.is_active}
                  onCheckedChange={(c) => setEditDraft({ ...editDraft, is_active: c })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={editSaving}>
              {editSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Archive confirm ---- */}
      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this Sector?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <strong className="text-foreground">{archiveTarget?.name}</strong>{" "}
                  <code className="rounded bg-muted px-1 text-xs">{archiveTarget?.code}</code>{" "}
                  will be soft-deleted. Catalogs, knowledge and history are preserved, but no member
                  of this Sector can act until it's restored.
                </p>
                <p>You can restore it by editing and toggling "Active" back on.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
