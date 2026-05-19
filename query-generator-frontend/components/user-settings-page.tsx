"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Users,
  Plus,
  Edit,
  Trash2,
  AlertCircle,
  UserCheck,
  UserX,
  Shield,
  ShieldCheck,
  Loader2,
} from "lucide-react"
import type { QueryGeneratorAPI, Sector } from "@/lib/api"

interface UserSettingsPageProps {
  api: QueryGeneratorAPI
}

// ---------------------------------------------------------------------------
// Types — narrower than UserProfile because we know the backend shape.
// ---------------------------------------------------------------------------

type SectorRoleName = "colonel" | "captain" | "soldier"

interface BackendRole {
  /** UserRole row id (used for deletes when applicable). */
  id?: string
  role_name: "general" | SectorRoleName | string
  /** NULL for General; required otherwise. */
  sector_id: string | null
}

interface UserRow {
  id: string
  username: string
  email: string
  full_name?: string | null
  is_active: boolean
  created_at: string
  last_login?: string | null
  roles: BackendRole[]
}

interface CostStat {
  total_cost_usd: number
  total_queries: number
  total_tokens: number
}

const ROLE_LABEL: Record<string, string> = {
  general: "General",
  colonel: "Colonel",
  captain: "Captain",
  soldier: "Soldier",
}

// ---------------------------------------------------------------------------

export function UserSettingsPage({ api }: UserSettingsPageProps) {
  const [users, setUsers] = useState<UserRow[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [costByUser, setCostByUser] = useState<Record<string, CostStat>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>("")

  // Create dialog. Role assignment is optional at create-time — pick "none"
  // to make the bare account and assign roles later via the shield icon.
  // 'general' is cross-Sector (no sector_id); the other three need one.
  type CreateRole = "none" | "general" | "colonel" | "captain" | "soldier"
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<{
    username: string
    full_name: string
    email: string
    password: string
    is_active: boolean
    role: CreateRole
    sector_id: string
  }>({
    username: "",
    full_name: "",
    email: "",
    password: "",
    is_active: true,
    role: "none",
    sector_id: "",
  })
  const [createSaving, setCreateSaving] = useState(false)

  // Edit details dialog
  const [editTarget, setEditTarget] = useState<UserRow | null>(null)
  const [editDraft, setEditDraft] = useState({
    full_name: "",
    email: "",
    password: "",
    is_active: true,
  })
  const [editSaving, setEditSaving] = useState(false)

  // Manage roles dialog
  const [rolesTarget, setRolesTarget] = useState<UserRow | null>(null)
  const [rolesSaving, setRolesSaving] = useState<string>("")  // sectorId or 'general'
  const [rolesError, setRolesError] = useState<string>("")
  // Inline assign-to-new-sector form state.
  const [assignSectorId, setAssignSectorId] = useState<string>("")
  const [assignRole, setAssignRole] = useState<SectorRoleName>("soldier")

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)

  // ---- Loaders ----------------------------------------------------------

  const loadUsers = async () => {
    const list = await api.getUsers()
    setUsers(
      (Array.isArray(list) ? list : []).map((u: any) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        full_name: u.full_name,
        is_active: u.is_active,
        created_at: u.created_at,
        last_login: u.last_login,
        roles: Array.isArray(u.roles)
          ? u.roles.map((r: any) => ({
              id: r.id,
              role_name: typeof r === "string" ? r : r.role_name,
              sector_id: typeof r === "string" ? null : (r.sector_id ?? null),
            }))
          : [],
      })),
    )
  }

  const loadSectors = async () => {
    try {
      const list = await api.listSectors()
      setSectors(list)
    } catch (e) {
      console.error("Failed to load sectors", e)
    }
  }

  const loadCosts = async () => {
    try {
      const rows = await api.getUsersCostSummary()
      const map: Record<string, CostStat> = {}
      for (const r of rows) {
        map[r.user_id] = {
          total_cost_usd: r.total_cost_usd,
          total_queries: r.total_queries,
          total_tokens: r.total_tokens,
        }
      }
      setCostByUser(map)
    } catch (e) {
      // Informational — never block the page.
      console.error("Failed to load user cost summary:", e)
    }
  }

  useEffect(() => {
    ;(async () => {
      setIsLoading(true)
      try {
        await Promise.all([loadUsers(), loadSectors(), loadCosts()])
      } catch (e: any) {
        setError(e?.message ?? "Failed to load users")
      } finally {
        setIsLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Derived ----------------------------------------------------------

  const sectorById = useMemo(() => {
    const m: Record<string, Sector> = {}
    for (const s of sectors) m[s.id] = s
    return m
  }, [sectors])

  const isGeneral = (u: UserRow) => u.roles.some((r) => r.role_name === "general")

  const sectorRoles = (u: UserRow): Array<{ sector_id: string; role: SectorRoleName }> =>
    u.roles
      .filter((r) => r.role_name !== "general" && r.sector_id)
      .map((r) => ({
        sector_id: r.sector_id as string,
        role: r.role_name as SectorRoleName,
      }))

  // ---- Mutations: details -----------------------------------------------

  const submitCreate = async () => {
    setCreateSaving(true)
    setError("")
    try {
      // 1. Create the account itself.
      const { role, sector_id, ...accountData } = createDraft
      const newUser = await api.createUser(accountData)

      // 2. Optional role assignment in the same submit. If anything below
      //    fails we surface the partial-success state: the user exists, but
      //    has no role yet — admin can finish via the shield icon.
      try {
        if (role === "general") {
          await api.promoteToGeneral(newUser.id)
        } else if (role !== "none" && sector_id) {
          await api.assignUserRole(newUser.id, role, sector_id)
        }
      } catch (e: any) {
        setError(
          `User created, but role assignment failed: ${e?.message ?? "unknown error"}. ` +
            `Use the shield icon to assign a role.`,
        )
      }

      setCreateOpen(false)
      setCreateDraft({
        username: "",
        full_name: "",
        email: "",
        password: "",
        is_active: true,
        role: "none",
        sector_id: "",
      })
      await loadUsers()
    } catch (e: any) {
      setError(e?.message ?? "Failed to create user")
    } finally {
      setCreateSaving(false)
    }
  }

  const submitEdit = async () => {
    if (!editTarget) return
    setEditSaving(true)
    setError("")
    try {
      // Only send the changed fields. Empty password = "keep current".
      const patch: any = {
        full_name: editDraft.full_name,
        email: editDraft.email,
        is_active: editDraft.is_active,
      }
      if (editDraft.password.trim()) patch.password = editDraft.password
      await api.updateUser(editTarget.id, patch)
      setEditTarget(null)
      await loadUsers()
    } catch (e: any) {
      setError(e?.message ?? "Failed to update user")
    } finally {
      setEditSaving(false)
    }
  }

  const submitDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteUser(deleteTarget.id)
      setDeleteTarget(null)
      await loadUsers()
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete user")
    }
  }

  const submitToggleActive = async (u: UserRow) => {
    try {
      await api.toggleUserStatus(u.id, !u.is_active)
      await loadUsers()
    } catch (e: any) {
      setError(e?.message ?? "Failed to update status")
    }
  }

  // ---- Mutations: roles -------------------------------------------------

  const toggleGeneral = async (u: UserRow, makeGeneral: boolean) => {
    setRolesSaving("general")
    setRolesError("")
    try {
      if (makeGeneral) {
        await api.promoteToGeneral(u.id)
      } else {
        await api.revokeGeneral(u.id)
      }
      // Reload both the user list and the dialog target.
      await loadUsers()
      // Sync rolesTarget with the new data.
      const fresh = (await api.getUsers()).find((x: any) => x.id === u.id)
      if (fresh) {
        setRolesTarget({
          ...u,
          roles: Array.isArray(fresh.roles)
            ? fresh.roles.map((r: any) => ({
                id: r.id,
                role_name: typeof r === "string" ? r : r.role_name,
                sector_id: typeof r === "string" ? null : (r.sector_id ?? null),
              }))
            : [],
        })
      }
    } catch (e: any) {
      setRolesError(e?.message ?? "Failed to update General status")
    } finally {
      setRolesSaving("")
    }
  }

  const assignSectorRole = async (
    u: UserRow,
    sectorId: string,
    role: SectorRoleName,
  ) => {
    setRolesSaving(sectorId)
    setRolesError("")
    try {
      await api.assignUserRole(u.id, role, sectorId)
      await loadUsers()
      const fresh = (await api.getUsers()).find((x: any) => x.id === u.id)
      if (fresh) {
        setRolesTarget({
          ...u,
          roles: Array.isArray(fresh.roles)
            ? fresh.roles.map((r: any) => ({
                id: r.id,
                role_name: typeof r === "string" ? r : r.role_name,
                sector_id: typeof r === "string" ? null : (r.sector_id ?? null),
              }))
            : [],
        })
      }
      // Reset inline assign form if it was used.
      setAssignSectorId("")
      setAssignRole("soldier")
    } catch (e: any) {
      setRolesError(e?.message ?? "Failed to assign role")
    } finally {
      setRolesSaving("")
    }
  }

  const removeSectorRole = async (u: UserRow, sectorId: string) => {
    setRolesSaving(sectorId)
    setRolesError("")
    try {
      await api.removeUserRole(u.id, sectorId)
      await loadUsers()
      const fresh = (await api.getUsers()).find((x: any) => x.id === u.id)
      if (fresh) {
        setRolesTarget({
          ...u,
          roles: Array.isArray(fresh.roles)
            ? fresh.roles.map((r: any) => ({
                id: r.id,
                role_name: typeof r === "string" ? r : r.role_name,
                sector_id: typeof r === "string" ? null : (r.sector_id ?? null),
              }))
            : [],
        })
      }
    } catch (e: any) {
      setRolesError(e?.message ?? "Failed to remove role")
    } finally {
      setRolesSaving("")
    }
  }

  // ---- Helpers ----------------------------------------------------------

  const formatDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : "—")

  // ---- Render -----------------------------------------------------------

  return (
    <div className="p-6 space-y-6 overflow-auto max-h-[calc(100vh-4rem)]">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" />
            User Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Create accounts, manage cross-Sector General status, and assign
            Colonel / Captain / Soldier roles per Sector.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="w-4 h-4" />
            System Users ({users.length})
          </CardTitle>
          <CardDescription>
            Each user holds at most one role per Sector. Generals carry the
            cross-Sector role and have no Sector-scoped row.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No users found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead className="text-right">Cost (USD)</TableHead>
                  <TableHead className="w-[180px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const general = isGeneral(u)
                  const sRoles = sectorRoles(u)
                  const cost = costByUser[u.id]
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.full_name || u.username}
                        <div className="text-xs text-muted-foreground">@{u.username}</div>
                      </TableCell>
                      <TableCell className="text-sm">{u.email}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {general && (
                            <Badge className="gap-1">
                              <ShieldCheck className="h-3 w-3" />
                              General
                            </Badge>
                          )}
                          {sRoles.length === 0 && !general && (
                            <span className="text-xs text-muted-foreground">No role</span>
                          )}
                          {sRoles.map((r) => {
                            const sector = sectorById[r.sector_id]
                            return (
                              <Badge
                                key={r.sector_id}
                                variant="outline"
                                className="gap-1"
                              >
                                <Shield className="h-3 w-3" />
                                {ROLE_LABEL[r.role] ?? r.role}
                                <span className="text-muted-foreground">
                                  @ {sector?.code ?? r.sector_id.slice(0, 6)}
                                </span>
                              </Badge>
                            )
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.is_active ? (
                          <span className="inline-flex items-center gap-1 text-sm">
                            <UserCheck className="w-3.5 h-3.5 text-green-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm">
                            <UserX className="w-3.5 h-3.5 text-red-500" />
                            Inactive
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{formatDate(u.last_login)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cost ? (
                          <span
                            title={`${cost.total_queries.toLocaleString()} queries · ${cost.total_tokens.toLocaleString()} tokens`}
                          >
                            ${cost.total_cost_usd.toFixed(4)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">$0.0000</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setRolesTarget(u)
                              setRolesError("")
                              setAssignSectorId("")
                              setAssignRole("soldier")
                            }}
                            title="Manage roles"
                          >
                            <Shield className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditTarget(u)
                              setEditDraft({
                                full_name: u.full_name ?? "",
                                email: u.email,
                                password: "",
                                is_active: u.is_active,
                              })
                            }}
                            title="Edit details"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => submitToggleActive(u)}
                            title={u.is_active ? "Deactivate" : "Activate"}
                          >
                            {u.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(u)}
                            title="Delete user"
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---- Create user ---- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>
              Create an account first; assign roles separately via the shield
              icon in the user row.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="c-username">Username</Label>
              <Input
                id="c-username"
                value={createDraft.username}
                onChange={(e) => setCreateDraft({ ...createDraft, username: e.target.value })}
                placeholder="jdoe"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-fullname">Full name</Label>
              <Input
                id="c-fullname"
                value={createDraft.full_name}
                onChange={(e) => setCreateDraft({ ...createDraft, full_name: e.target.value })}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-email">Email</Label>
              <Input
                id="c-email"
                type="email"
                value={createDraft.email}
                onChange={(e) => setCreateDraft({ ...createDraft, email: e.target.value })}
                placeholder="jane@company.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-password">Password</Label>
              <Input
                id="c-password"
                type="password"
                value={createDraft.password}
                onChange={(e) => setCreateDraft({ ...createDraft, password: e.target.value })}
              />
            </div>

            {/* Optional initial role. Defaults to None — the General can
                always assign roles later via the shield icon. */}
            <div className="rounded border p-3 space-y-3 bg-muted/20">
              <div>
                <Label className="text-sm">Initial role (optional)</Label>
                <p className="text-xs text-muted-foreground">
                  Skip and assign later, or grant a role right now.
                  &nbsp;<strong>General</strong> is cross-Sector;
                  Colonel / Captain / Soldier need a target Sector.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="c-role" className="text-xs">Role</Label>
                  <Select
                    value={createDraft.role}
                    onValueChange={(v) =>
                      setCreateDraft({
                        ...createDraft,
                        role: v as CreateRole,
                        // Clear sector when switching to a role that doesn't need one.
                        sector_id: v === "general" || v === "none" ? "" : createDraft.sector_id,
                      })
                    }
                  >
                    <SelectTrigger id="c-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="general">General · cross-Sector</SelectItem>
                      <SelectItem value="colonel">Colonel · sector admin</SelectItem>
                      <SelectItem value="captain">Captain · knowledge author</SelectItem>
                      <SelectItem value="soldier">Soldier · generate-only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(createDraft.role === "colonel" ||
                  createDraft.role === "captain" ||
                  createDraft.role === "soldier") && (
                  <div className="space-y-1">
                    <Label htmlFor="c-sector" className="text-xs">Sector</Label>
                    <Select
                      value={createDraft.sector_id || undefined}
                      onValueChange={(v) =>
                        setCreateDraft({ ...createDraft, sector_id: v })
                      }
                    >
                      <SelectTrigger id="c-sector">
                        <SelectValue placeholder="Pick a Sector" />
                      </SelectTrigger>
                      <SelectContent>
                        {sectors
                          .filter((s) => s.is_active)
                          .map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}{" "}
                              <span className="text-muted-foreground text-xs">({s.code})</span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <Label htmlFor="c-active">Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive users cannot log in.
                </p>
              </div>
              <Switch
                id="c-active"
                checked={createDraft.is_active}
                onCheckedChange={(c) => setCreateDraft({ ...createDraft, is_active: c })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={submitCreate}
              disabled={
                createSaving ||
                !createDraft.username ||
                !createDraft.email ||
                !createDraft.password ||
                // A sector-scoped role requires a Sector pick.
                ((createDraft.role === "colonel" ||
                  createDraft.role === "captain" ||
                  createDraft.role === "soldier") &&
                  !createDraft.sector_id)
              }
            >
              {createSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Edit user details ---- */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>
              Username is immutable. To change roles, close this and click the
              shield icon.
            </DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Username</Label>
                <Input value={editTarget.username} disabled />
              </div>
              <div className="space-y-1">
                <Label htmlFor="e-fullname">Full name</Label>
                <Input
                  id="e-fullname"
                  value={editDraft.full_name}
                  onChange={(e) => setEditDraft({ ...editDraft, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="e-email">Email</Label>
                <Input
                  id="e-email"
                  type="email"
                  value={editDraft.email}
                  onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="e-password">Reset password (optional)</Label>
                <Input
                  id="e-password"
                  type="password"
                  placeholder="Leave blank to keep current"
                  value={editDraft.password}
                  onChange={(e) => setEditDraft({ ...editDraft, password: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded border p-3">
                <div>
                  <Label htmlFor="e-active">Active</Label>
                  <p className="text-xs text-muted-foreground">
                    Inactive users cannot log in or hit any API.
                  </p>
                </div>
                <Switch
                  id="e-active"
                  checked={editDraft.is_active}
                  onCheckedChange={(c) => setEditDraft({ ...editDraft, is_active: c })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={submitEdit} disabled={editSaving}>
              {editSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Manage roles ---- */}
      <Dialog open={!!rolesTarget} onOpenChange={(open) => !open && setRolesTarget(null)}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>
              Manage roles
              {rolesTarget && (
                <span className="text-muted-foreground text-sm font-normal ml-2">
                  · {rolesTarget.full_name || rolesTarget.username}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              A user holds at most one role per Sector. The General role is
              cross-Sector and has no Sector membership row.
            </DialogDescription>
          </DialogHeader>
          {rolesTarget && (
            <div className="space-y-5">
              {/* General toggle */}
              <div className="flex items-start justify-between rounded border p-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    <Label className="text-sm">General (cross-Sector admin)</Label>
                  </div>
                  <p className="text-xs text-muted-foreground max-w-md">
                    Grants full access to every Sector and the ability to
                    create / archive Sectors. Use sparingly.
                  </p>
                </div>
                <Switch
                  checked={isGeneral(rolesTarget)}
                  disabled={rolesSaving === "general"}
                  onCheckedChange={(c) => toggleGeneral(rolesTarget, c)}
                />
              </div>

              {/* Per-sector roles */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Sector roles
                </h4>
                {sectorRoles(rolesTarget).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    Not a member of any Sector yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sector</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="w-[80px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sectorRoles(rolesTarget).map((r) => {
                        const s = sectorById[r.sector_id]
                        const busy = rolesSaving === r.sector_id
                        return (
                          <TableRow key={r.sector_id}>
                            <TableCell>
                              {s?.name ?? "—"}
                              <span className="text-muted-foreground text-xs ml-1">
                                ({s?.code ?? r.sector_id.slice(0, 6)})
                              </span>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={r.role}
                                disabled={busy}
                                onValueChange={(v) =>
                                  assignSectorRole(
                                    rolesTarget,
                                    r.sector_id,
                                    v as SectorRoleName,
                                  )
                                }
                              >
                                <SelectTrigger className="h-8 w-[140px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="colonel">Colonel</SelectItem>
                                  <SelectItem value="captain">Captain</SelectItem>
                                  <SelectItem value="soldier">Soldier</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => removeSectorRole(rolesTarget, r.sector_id)}
                              >
                                {busy ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}

                {/* Add to another sector */}
                {(() => {
                  const taken = new Set(sectorRoles(rolesTarget).map((r) => r.sector_id))
                  const available = sectors.filter((s) => s.is_active && !taken.has(s.id))
                  if (available.length === 0) return null
                  return (
                    <div className="mt-3 rounded border border-dashed p-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Assign to another Sector:
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        <Select value={assignSectorId} onValueChange={setAssignSectorId}>
                          <SelectTrigger><SelectValue placeholder="Sector" /></SelectTrigger>
                          <SelectContent>
                            {available.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}{" "}
                                <span className="text-muted-foreground text-xs">({s.code})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={assignRole} onValueChange={(v) => setAssignRole(v as SectorRoleName)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="colonel">Colonel</SelectItem>
                            <SelectItem value="captain">Captain</SelectItem>
                            <SelectItem value="soldier">Soldier</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          disabled={!assignSectorId || rolesSaving === assignSectorId}
                          onClick={() => {
                            if (!assignSectorId) return
                            assignSectorRole(rolesTarget, assignSectorId, assignRole)
                          }}
                        >
                          {rolesSaving === assignSectorId ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : null}
                          Assign
                        </Button>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {rolesError && (
                <Alert variant="destructive">
                  <AlertDescription>{rolesError}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRolesTarget(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete confirm ---- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.username}</strong> will be removed
              permanently. Their query history and feedback rows stay (audit
              trail) but they will no longer be able to log in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={submitDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
