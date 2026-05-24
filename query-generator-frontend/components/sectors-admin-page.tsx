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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Plus,
  Edit,
  Archive,
  Users,
  ShieldCheck,
  UserPlus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Shield,
} from "lucide-react"
import type { QueryGeneratorAPI, Sector, UserProfile } from "@/lib/api"

interface Props {
  api: QueryGeneratorAPI
  /** Called after a sector mutation so the parent can refresh the switcher. */
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

export function SectorsAdminPage({ api, onSectorsChanged }: Props) {
  const [sectors, setSectors] = useState<Sector[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>("")

  // Per-sector expansion state.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [membersBySector, setMembersBySector] = useState<Record<string, Member[]>>({})
  const [membersLoading, setMembersLoading] = useState<Record<string, boolean>>({})

  // Create dialog.
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<DraftSector>({ code: "", name: "", description: "" })
  const [createSaving, setCreateSaving] = useState(false)

  // Edit dialog.
  const [editTarget, setEditTarget] = useState<Sector | null>(null)
  const [editDraft, setEditDraft] = useState<DraftSector & { is_active: boolean }>({
    code: "", name: "", description: "", is_active: true,
  })
  const [editSaving, setEditSaving] = useState(false)

  // Archive confirm.
  const [archiveTarget, setArchiveTarget] = useState<Sector | null>(null)

  // Assign-member dialog (inline below each Sector).
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
      // Non-fatal — Sector mgmt still works; assignment dropdown will be empty.
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

  const userById = useMemo(() => {
    const map: Record<string, UserProfile> = {}
    for (const u of users) map[u.id] = u
    return map
  }, [users])

  const eligibleAssignees = (sectorId: string) => {
    const members = membersBySector[sectorId] ?? []
    const taken = new Set(members.map((m) => m.user_id))
    return users.filter((u) => u.is_active && !taken.has(u.id))
  }

  // ---- Render ------------------------------------------------------------

  return (
    <div className="p-6 space-y-6 overflow-auto max-h-[calc(100vh-4rem)]">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" />
            Sectors
          </h2>
          <p className="text-sm text-muted-foreground">
            Create, archive, and staff the environments your organisation operates.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Sector
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sectors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No Sectors yet. Create one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sectors.map((sector) => {
            const isOpen = !!expanded[sector.id]
            const members = membersBySector[sector.id] ?? []
            const loadingMembers = !!membersLoading[sector.id]
            const assignees = eligibleAssignees(sector.id)
            return (
              <Card key={sector.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 mt-0.5"
                        onClick={() => toggleExpand(sector.id)}
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          {sector.name}
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                            {sector.code}
                          </code>
                          {!sector.is_active && (
                            <Badge variant="secondary" className="text-xs">archived</Badge>
                          )}
                        </CardTitle>
                        {sector.description && (
                          <CardDescription className="mt-1">{sector.description}</CardDescription>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
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
                        <Edit className="mr-1 h-3 w-3" />
                        Edit
                      </Button>
                      {sector.is_active && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setArchiveTarget(sector)}
                        >
                          <Archive className="mr-1 h-3 w-3" />
                          Archive
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {isOpen && (
                  <CardContent className="pt-0">
                    <div className="border-t pt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          Members ({members.length})
                        </h4>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setAssignOpenFor(sector.id)
                            setAssignUserId("")
                            setAssignRole("soldier")
                            setAssignError("")
                          }}
                          disabled={assignees.length === 0}
                          title={
                            assignees.length === 0
                              ? "Every active user already has a role here"
                              : ""
                          }
                        >
                          <UserPlus className="mr-1 h-3 w-3" />
                          Add member
                        </Button>
                      </div>

                      {loadingMembers ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : members.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">
                          No members yet. Add a Colonel to get this Sector running.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>User</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead className="w-[80px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {members.map((m) => (
                              <TableRow key={m.user_id}>
                                <TableCell className="font-medium">
                                  {m.full_name || m.username}
                                  <div className="text-xs text-muted-foreground">@{m.username}</div>
                                </TableCell>
                                <TableCell className="text-sm">{m.email}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={m.role === "colonel" ? "default" : "outline"}
                                    className="capitalize"
                                  >
                                    {m.role}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemove(sector.id, m.user_id)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}

                      {/* Inline assign form */}
                      {assignOpenFor === sector.id && (
                        <Card className="border-dashed">
                          <CardContent className="pt-4 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">User</Label>
                                <Select value={assignUserId} onValueChange={setAssignUserId}>
                                  <SelectTrigger><SelectValue placeholder="Pick a user" /></SelectTrigger>
                                  <SelectContent>
                                    {assignees.map((u) => (
                                      <SelectItem key={u.id} value={u.id}>
                                        {u.full_name || u.username}
                                        <span className="text-muted-foreground ml-1 text-xs">
                                          @{u.username}
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Role</Label>
                                <Select
                                  value={assignRole}
                                  onValueChange={(v) => setAssignRole(v as any)}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="colonel">Colonel — sector admin</SelectItem>
                                    <SelectItem value="captain">Captain — knowledge author</SelectItem>
                                    <SelectItem value="soldier">Soldier — generate-only</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-end gap-2">
                                <Button
                                  onClick={() => handleAssign(sector.id)}
                                  disabled={assignSaving}
                                  className="flex-1"
                                >
                                  {assignSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                  Assign
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => setAssignOpenFor(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                            {assignError && (
                              <Alert variant="destructive">
                                <AlertDescription>{assignError}</AlertDescription>
                              </Alert>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
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
            <div className="space-y-1">
              <Label htmlFor="new-sector-code">Code</Label>
              <Input
                id="new-sector-code"
                placeholder="ops"
                value={createDraft.code}
                onChange={(e) =>
                  setCreateDraft({ ...createDraft, code: e.target.value.toLowerCase().replace(/\s+/g, "_") })
                }
              />
              <p className="text-xs text-muted-foreground">
                Lowercase, no spaces. Used in URLs and logs.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-sector-name">Name</Label>
              <Input
                id="new-sector-name"
                placeholder="Operations"
                value={createDraft.name}
                onChange={(e) => setCreateDraft({ ...createDraft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-sector-description">Description (optional)</Label>
              <Textarea
                id="new-sector-description"
                placeholder="What does this Sector cover?"
                value={createDraft.description}
                onChange={(e) =>
                  setCreateDraft({ ...createDraft, description: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={createSaving || !createDraft.code || !createDraft.name}
            >
              {createSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Edit dialog ---- */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Sector</DialogTitle>
            <DialogDescription>
              The code is immutable. Rename or archive any time.
            </DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Code</Label>
                <Input value={editDraft.code} disabled />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-sector-name">Name</Label>
                <Input
                  id="edit-sector-name"
                  value={editDraft.name}
                  onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-sector-description">Description</Label>
                <Textarea
                  id="edit-sector-description"
                  value={editDraft.description}
                  onChange={(e) =>
                    setEditDraft({ ...editDraft, description: e.target.value })
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded border p-3">
                <div>
                  <Label htmlFor="edit-active">Active</Label>
                  <p className="text-xs text-muted-foreground">
                    Inactive Sectors are read-only. Soldiers stay locked out
                    until reactivated.
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
              {editSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Save
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
            <AlertDialogDescription>
              <span className="block mb-2">
                <strong>{archiveTarget?.name}</strong> ({archiveTarget?.code}) will
                be soft-deleted. Catalogs, knowledge and history are preserved but
                no member of this Sector can act until it's restored.
              </span>
              <span className="block text-sm text-muted-foreground">
                You can restore it by editing and toggling "Active" back on later.
              </span>
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
