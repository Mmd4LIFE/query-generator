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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  DollarSign,
  BarChart2,
  UserPlus,
} from "lucide-react"
import type { QueryGeneratorAPI, Sector, CostSummary } from "@/lib/api"
import { isGeneral as checkIsGeneral } from "@/lib/utils"

interface UserSettingsPageProps {
  api: QueryGeneratorAPI
  userProfile?: any
  activeSectorId?: string | null
}

type SectorRoleName = "colonel" | "captain" | "soldier"

interface BackendRole {
  id?: string
  role_name: "general" | SectorRoleName | string
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

interface SectorMember {
  user_id: string
  username: string
  email: string
  full_name?: string | null
  role: SectorRoleName
}

const ROLE_LABEL: Record<string, string> = {
  general: "General",
  colonel: "Colonel",
  captain: "Captain",
  soldier: "Soldier",
}

// ---------------------------------------------------------------------------
// Dispatcher — routes to the right view based on active-sector role.
// A user who is Colonel in Sector X and Captain in Sector Y gets the Colonel
// view when Sector X is active and no user-management access when Sector Y is
// active (nav item is hidden by canManageUsers in utils.ts).
// ---------------------------------------------------------------------------

export function UserSettingsPage({ api, userProfile, activeSectorId }: UserSettingsPageProps) {
  const callerIsGeneral = checkIsGeneral(userProfile)

  // Determine the caller's role in the currently-active sector.
  const activeSectorRole: string | null = callerIsGeneral
    ? "general"
    : activeSectorId
    ? (userProfile?.sectors?.find((s: any) => s.sector_id === activeSectorId)?.role ?? null)
    : null

  if (activeSectorRole === "general") {
    return <GeneralUserView api={api} />
  }
  if (activeSectorRole === "colonel" && activeSectorId) {
    return <ColonelUserView api={api} activeSectorId={activeSectorId} />
  }
  // Captain / Soldier should never reach here (nav item is hidden for them).
  return null
}

// ---------------------------------------------------------------------------
// Colonel view — sector-scoped user management + sector status panel
// ---------------------------------------------------------------------------

function ColonelUserView({
  api,
  activeSectorId,
}: {
  api: QueryGeneratorAPI
  activeSectorId: string
}) {
  const [members, setMembers] = useState<SectorMember[]>([])
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState("")

  // Create user dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState({
    username: "",
    full_name: "",
    email: "",
    password: "",
    role: "soldier" as "captain" | "soldier",
  })
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState("")

  // Add existing user to sector
  const [allUsers, setAllUsers] = useState<{ id: string; username: string }[]>([])
  const [addUserId, setAddUserId] = useState("")
  const [addRole, setAddRole] = useState<"captain" | "soldier">("soldier")
  const [addSaving, setAddSaving] = useState(false)

  const loadData = async () => {
    setIsLoading(true)
    setError("")
    try {
      const [memberList, summary, userList] = await Promise.allSettled([
        api.listSectorMembers(activeSectorId),
        api.getSectorCostSummary({ groupBy: "user" }),
        api.getUsers(),
      ])

      if (memberList.status === "fulfilled") setMembers(memberList.value as SectorMember[])
      if (summary.status === "fulfilled") setCostSummary(summary.value)
      if (userList.status === "fulfilled" && Array.isArray(userList.value)) {
        setAllUsers(userList.value.map((u: any) => ({ id: u.id, username: u.username })))
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load data")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [activeSectorId])

  const changeRole = async (memberId: string, newRole: SectorRoleName) => {
    setSaving(memberId)
    setError("")
    try {
      await api.assignUserRole(memberId, newRole, activeSectorId)
      await loadData()
    } catch (e: any) {
      setError(e?.message ?? "Failed to change role")
    } finally {
      setSaving("")
    }
  }

  const removeMember = async (memberId: string) => {
    setSaving(`rm-${memberId}`)
    setError("")
    try {
      await api.removeUserRole(memberId, activeSectorId)
      await loadData()
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove member")
    } finally {
      setSaving("")
    }
  }

  const submitCreate = async () => {
    if (!createDraft.username || !createDraft.email || !createDraft.password) return
    setCreateSaving(true)
    setCreateError("")
    try {
      // 1. Create the bare account.
      const newUser = await api.createUser({
        username: createDraft.username,
        email: createDraft.email,
        password: createDraft.password,
        full_name: createDraft.full_name || undefined,
        is_active: true,
      })
      // 2. Assign them to this sector with the chosen role.
      await api.assignUserRole(newUser.id, createDraft.role, activeSectorId)
      setCreateOpen(false)
      setCreateDraft({ username: "", full_name: "", email: "", password: "", role: "soldier" })
      await loadData()
    } catch (e: any) {
      setCreateError(e?.message ?? "Failed to create user")
    } finally {
      setCreateSaving(false)
    }
  }

  const addExistingMember = async () => {
    if (!addUserId) return
    setAddSaving(true)
    setError("")
    try {
      await api.assignUserRole(addUserId, addRole, activeSectorId)
      setAddUserId("")
      setAddRole("soldier")
      await loadData()
    } catch (e: any) {
      setError(e?.message ?? "Failed to add member")
    } finally {
      setAddSaving(false)
    }
  }

  const memberIds = new Set(members.map((m) => m.user_id))
  const availableToAdd = allUsers.filter((u) => !memberIds.has(u.id))

  // Cost stats derived from the summary (group_by=user totals).
  const totalCost = costSummary?.total?.cost_usd ?? 0
  const totalQueries = costSummary?.total?.requests ?? 0
  const totalTokens = costSummary?.total?.total_tokens ?? 0

  return (
    <div className="p-6 space-y-6 overflow-auto max-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" />
            Sector User Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Create and manage Captain / Soldier accounts for this sector.
            Contact a General to promote someone to Colonel.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          Create User
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Sector status cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{members.length}</p>
                <p className="text-xs text-muted-foreground">Members</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <BarChart2 className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{totalQueries.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total queries</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">${totalCost.toFixed(4)}</p>
                <p className="text-xs text-muted-foreground">
                  Total cost · {(totalTokens / 1000).toFixed(1)}k tok
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-user cost breakdown */}
      {costSummary && costSummary.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4" /> Cost by user
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Queries</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costSummary.rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">{row.label ?? row.key}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.requests.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.total_tokens.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">${row.cost_usd.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Members table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" /> Members ({members.length})
          </CardTitle>
          <CardDescription>
            Colonels cannot be changed here — contact a General.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No members yet. Create or add users above.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const isColonel = m.role === "colonel"
                  const busy = saving === m.user_id || saving === `rm-${m.user_id}`
                  return (
                    <TableRow key={m.user_id}>
                      <TableCell className="font-medium">
                        {m.full_name || m.username}
                        <div className="text-xs text-muted-foreground">@{m.username}</div>
                      </TableCell>
                      <TableCell className="text-sm">{m.email}</TableCell>
                      <TableCell>
                        {isColonel ? (
                          <Badge className="gap-1">
                            <ShieldCheck className="h-3 w-3" /> Colonel
                          </Badge>
                        ) : (
                          <Select
                            value={m.role}
                            disabled={busy}
                            onValueChange={(v) => changeRole(m.user_id, v as SectorRoleName)}
                          >
                            <SelectTrigger className="h-8 w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="captain">Captain</SelectItem>
                              <SelectItem value="soldier">Soldier</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        {!isColonel && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => removeMember(m.user_id)}
                            className="text-red-600 hover:text-red-800"
                          >
                            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}

          {/* Add an existing (already-created) user to this sector */}
          {availableToAdd.length > 0 && (
            <div className="mt-4 rounded border border-dashed p-3 space-y-2">
              <p className="text-xs text-muted-foreground font-medium">
                Add existing user to this sector:
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Select value={addUserId} onValueChange={setAddUserId}>
                  <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                  <SelectContent>
                    {availableToAdd.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={addRole} onValueChange={(v) => setAddRole(v as "captain" | "soldier")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="captain">Captain</SelectItem>
                    <SelectItem value="soldier">Soldier</SelectItem>
                  </SelectContent>
                </Select>
                <Button disabled={!addUserId || addSaving} onClick={addExistingMember}>
                  {addSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Add
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
            <DialogDescription>
              Creates a new account and immediately assigns the user to this
              sector as Captain or Soldier.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {createError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1">
              <Label htmlFor="cc-username">Username</Label>
              <Input id="cc-username" value={createDraft.username}
                onChange={(e) => setCreateDraft({ ...createDraft, username: e.target.value })}
                placeholder="jdoe" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-fullname">Full name</Label>
              <Input id="cc-fullname" value={createDraft.full_name}
                onChange={(e) => setCreateDraft({ ...createDraft, full_name: e.target.value })}
                placeholder="Jane Doe" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-email">Email</Label>
              <Input id="cc-email" type="email" value={createDraft.email}
                onChange={(e) => setCreateDraft({ ...createDraft, email: e.target.value })}
                placeholder="jane@company.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-password">Password</Label>
              <Input id="cc-password" type="password" value={createDraft.password}
                onChange={(e) => setCreateDraft({ ...createDraft, password: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-role">Role in this sector</Label>
              <Select value={createDraft.role} onValueChange={(v) => setCreateDraft({ ...createDraft, role: v as "captain" | "soldier" })}>
                <SelectTrigger id="cc-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="captain">Captain — knowledge author</SelectItem>
                  <SelectItem value="soldier">Soldier — generate only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setCreateOpen(false); setCreateError("") }}>Cancel</Button>
            <Button onClick={submitCreate}
              disabled={createSaving || !createDraft.username || !createDraft.email || !createDraft.password}>
              {createSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Create &amp; assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// General view — full system user management
// ---------------------------------------------------------------------------

function GeneralUserView({ api }: { api: QueryGeneratorAPI }) {
  const [users, setUsers] = useState<UserRow[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [costByUser, setCostByUser] = useState<Record<string, CostStat>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>("")

  type CreateRole = "none" | "general" | "colonel" | "captain" | "soldier"
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<{
    username: string; full_name: string; email: string; password: string
    is_active: boolean; role: CreateRole; sector_id: string
  }>({ username: "", full_name: "", email: "", password: "", is_active: true, role: "none", sector_id: "" })
  const [createSaving, setCreateSaving] = useState(false)

  // Combined edit+roles dialog
  const [editTarget, setEditTarget] = useState<UserRow | null>(null)
  const [editDraft, setEditDraft] = useState({ full_name: "", email: "", password: "", is_active: true })
  const [editSaving, setEditSaving] = useState(false)
  const [rolesSaving, setRolesSaving] = useState("")
  const [rolesError, setRolesError] = useState("")
  const [assignSectorId, setAssignSectorId] = useState("")
  const [assignRole, setAssignRole] = useState<SectorRoleName>("soldier")

  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)

  // ---- Loaders ----------------------------------------------------------

  const parseUserList = (list: any[]): UserRow[] =>
    list.map((u: any) => ({
      id: u.id, username: u.username, email: u.email, full_name: u.full_name,
      is_active: u.is_active, created_at: u.created_at, last_login: u.last_login,
      roles: Array.isArray(u.roles)
        ? u.roles.map((r: any) => ({
            id: r.id,
            role_name: typeof r === "string" ? r : r.role_name,
            sector_id: typeof r === "string" ? null : (r.sector_id ?? null),
          }))
        : [],
    }))

  const loadUsers = async () => {
    const list = await api.getUsers()
    setUsers(parseUserList(Array.isArray(list) ? list : []))
  }

  const loadSectors = async () => {
    try { setSectors(await api.listSectors()) } catch {}
  }

  const loadCosts = async () => {
    try {
      const rows = await api.getUsersCostSummary()
      const map: Record<string, CostStat> = {}
      for (const r of rows) map[r.user_id] = { total_cost_usd: r.total_cost_usd, total_queries: r.total_queries, total_tokens: r.total_tokens }
      setCostByUser(map)
    } catch {}
  }

  useEffect(() => {
    ;(async () => {
      setIsLoading(true)
      try { await Promise.all([loadUsers(), loadSectors(), loadCosts()]) }
      catch (e: any) { setError(e?.message ?? "Failed to load users") }
      finally { setIsLoading(false) }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sectorById = useMemo(() => {
    const m: Record<string, Sector> = {}
    for (const s of sectors) m[s.id] = s
    return m
  }, [sectors])

  const isGeneralUser = (u: UserRow) => u.roles.some((r) => r.role_name === "general")
  const sectorRoles = (u: UserRow) =>
    u.roles.filter((r) => r.role_name !== "general" && r.sector_id)
      .map((r) => ({ sector_id: r.sector_id as string, role: r.role_name as SectorRoleName }))

  const syncEditTarget = async (userId: string, current: UserRow) => {
    try {
      const fresh = (await api.getUsers()).find((x: any) => x.id === userId)
      if (fresh) {
        setEditTarget({ ...current, roles: parseUserList([fresh])[0].roles })
        await loadUsers()
      }
    } catch {}
  }

  // ---- Mutations --------------------------------------------------------

  const submitCreate = async () => {
    setCreateSaving(true); setError("")
    try {
      const { role, sector_id, ...accountData } = createDraft
      const newUser = await api.createUser(accountData)
      try {
        if (role === "general") await api.promoteToGeneral(newUser.id)
        else if (role !== "none" && sector_id) await api.assignUserRole(newUser.id, role, sector_id)
      } catch (e: any) {
        setError(`User created, but role assignment failed: ${e?.message ?? "unknown"}. Use Edit → Roles to assign.`)
      }
      setCreateOpen(false)
      setCreateDraft({ username: "", full_name: "", email: "", password: "", is_active: true, role: "none", sector_id: "" })
      await loadUsers()
    } catch (e: any) { setError(e?.message ?? "Failed to create user") }
    finally { setCreateSaving(false) }
  }

  const submitEdit = async () => {
    if (!editTarget) return
    setEditSaving(true); setError("")
    try {
      const patch: any = { full_name: editDraft.full_name, email: editDraft.email, is_active: editDraft.is_active }
      if (editDraft.password.trim()) patch.password = editDraft.password
      await api.updateUser(editTarget.id, patch)
      setEditTarget(null)
      await loadUsers()
    } catch (e: any) { setError(e?.message ?? "Failed to update user") }
    finally { setEditSaving(false) }
  }

  const submitDelete = async () => {
    if (!deleteTarget) return
    try { await api.deleteUser(deleteTarget.id); setDeleteTarget(null); await loadUsers() }
    catch (e: any) { setError(e?.message ?? "Failed to delete user") }
  }

  const submitToggleActive = async (u: UserRow) => {
    try { await api.toggleUserStatus(u.id, !u.is_active); await loadUsers() }
    catch (e: any) { setError(e?.message ?? "Failed to update status") }
  }

  const toggleGeneral = async (u: UserRow, makeGeneral: boolean) => {
    setRolesSaving("general"); setRolesError("")
    try {
      if (makeGeneral) await api.promoteToGeneral(u.id)
      else await api.revokeGeneral(u.id)
      await syncEditTarget(u.id, u)
    } catch (e: any) { setRolesError(e?.message ?? "Failed to update General status") }
    finally { setRolesSaving("") }
  }

  const assignSectorRole = async (u: UserRow, sectorId: string, role: SectorRoleName) => {
    setRolesSaving(sectorId); setRolesError("")
    try {
      await api.assignUserRole(u.id, role, sectorId)
      setAssignSectorId(""); setAssignRole("soldier")
      await syncEditTarget(u.id, u)
    } catch (e: any) { setRolesError(e?.message ?? "Failed to assign role") }
    finally { setRolesSaving("") }
  }

  const removeSectorRole = async (u: UserRow, sectorId: string) => {
    setRolesSaving(sectorId); setRolesError("")
    try { await api.removeUserRole(u.id, sectorId); await syncEditTarget(u.id, u) }
    catch (e: any) { setRolesError(e?.message ?? "Failed to remove role") }
    finally { setRolesSaving("") }
  }

  const openEdit = (u: UserRow) => {
    setEditTarget(u)
    setEditDraft({ full_name: u.full_name ?? "", email: u.email, password: "", is_active: u.is_active })
    setRolesError(""); setAssignSectorId(""); setAssignRole("soldier")
  }

  const formatDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : "—")

  return (
    <div className="p-6 space-y-6 overflow-auto max-h-[calc(100vh-4rem)]">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" /> User Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Create accounts, manage General status, and assign sector roles.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add User
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
            <Users className="w-4 h-4" /> System Users ({users.length})
          </CardTitle>
          <CardDescription>
            Each user holds at most one role per Sector. Click Edit to manage details and roles together.
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
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const general = isGeneralUser(u)
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
                          {general && <Badge className="gap-1"><ShieldCheck className="h-3 w-3" />General</Badge>}
                          {sRoles.length === 0 && !general && <span className="text-xs text-muted-foreground">No role</span>}
                          {sRoles.map((r) => {
                            const sector = sectorById[r.sector_id]
                            return (
                              <Badge key={r.sector_id} variant="outline" className="gap-1">
                                <Shield className="h-3 w-3" />
                                {ROLE_LABEL[r.role] ?? r.role}
                                <span className="text-muted-foreground">@ {sector?.code ?? r.sector_id.slice(0, 6)}</span>
                              </Badge>
                            )
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.is_active
                          ? <span className="inline-flex items-center gap-1 text-sm"><UserCheck className="w-3.5 h-3.5 text-green-500" />Active</span>
                          : <span className="inline-flex items-center gap-1 text-sm"><UserX className="w-3.5 h-3.5 text-red-500" />Inactive</span>}
                      </TableCell>
                      <TableCell>{formatDate(u.last_login)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cost
                          ? <span title={`${cost.total_queries.toLocaleString()} queries`}>${cost.total_cost_usd.toFixed(4)}</span>
                          : <span className="text-muted-foreground">$0.0000</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(u)} title="Edit user & roles">
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => submitToggleActive(u)}
                            title={u.is_active ? "Deactivate" : "Activate"}>
                            {u.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(u)}
                            title="Delete" className="text-red-600 hover:text-red-800">
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
            <DialogDescription>Create an account and optionally assign an initial role.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="c-username">Username</Label>
              <Input id="c-username" value={createDraft.username}
                onChange={(e) => setCreateDraft({ ...createDraft, username: e.target.value })} placeholder="jdoe" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-fullname">Full name</Label>
              <Input id="c-fullname" value={createDraft.full_name}
                onChange={(e) => setCreateDraft({ ...createDraft, full_name: e.target.value })} placeholder="Jane Doe" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" value={createDraft.email}
                onChange={(e) => setCreateDraft({ ...createDraft, email: e.target.value })} placeholder="jane@company.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-password">Password</Label>
              <Input id="c-password" type="password" value={createDraft.password}
                onChange={(e) => setCreateDraft({ ...createDraft, password: e.target.value })} />
            </div>
            <div className="rounded border p-3 space-y-3 bg-muted/20">
              <div>
                <Label className="text-sm">Initial role (optional)</Label>
                <p className="text-xs text-muted-foreground">
                  <strong>General</strong> is cross-Sector; others need a Sector.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Role</Label>
                  <Select value={createDraft.role}
                    onValueChange={(v) => setCreateDraft({ ...createDraft, role: v as CreateRole, sector_id: v === "general" || v === "none" ? "" : createDraft.sector_id })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="colonel">Colonel</SelectItem>
                      <SelectItem value="captain">Captain</SelectItem>
                      <SelectItem value="soldier">Soldier</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(createDraft.role === "colonel" || createDraft.role === "captain" || createDraft.role === "soldier") && (
                  <div className="space-y-1">
                    <Label className="text-xs">Sector</Label>
                    <Select value={createDraft.sector_id || undefined}
                      onValueChange={(v) => setCreateDraft({ ...createDraft, sector_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Pick a Sector" /></SelectTrigger>
                      <SelectContent>
                        {sectors.filter((s) => s.is_active).map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name} <span className="text-muted-foreground text-xs">({s.code})</span></SelectItem>
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
                <p className="text-xs text-muted-foreground">Inactive users cannot log in.</p>
              </div>
              <Switch id="c-active" checked={createDraft.is_active}
                onCheckedChange={(c) => setCreateDraft({ ...createDraft, is_active: c })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreate}
              disabled={createSaving || !createDraft.username || !createDraft.email || !createDraft.password ||
                ((createDraft.role === "colonel" || createDraft.role === "captain" || createDraft.role === "soldier") && !createDraft.sector_id)}>
              {createSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Combined Edit + Roles dialog ---- */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>
              Edit User
              {editTarget && <span className="text-muted-foreground text-sm font-normal ml-2">· {editTarget.full_name || editTarget.username}</span>}
            </DialogTitle>
            <DialogDescription>Update account details and manage sector roles in one place.</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <Tabs defaultValue="details" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="roles">
                  Roles
                  {sectorRoles(editTarget).length > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs px-1">{sectorRoles(editTarget).length}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-3 mt-4">
                <div className="space-y-1">
                  <Label>Username</Label>
                  <Input value={editTarget.username} disabled />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="e-fullname">Full name</Label>
                  <Input id="e-fullname" value={editDraft.full_name}
                    onChange={(e) => setEditDraft({ ...editDraft, full_name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="e-email">Email</Label>
                  <Input id="e-email" type="email" value={editDraft.email}
                    onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="e-password">Reset password (optional)</Label>
                  <Input id="e-password" type="password" placeholder="Leave blank to keep current"
                    value={editDraft.password}
                    onChange={(e) => setEditDraft({ ...editDraft, password: e.target.value })} />
                </div>
                <div className="flex items-center justify-between rounded border p-3">
                  <div>
                    <Label htmlFor="e-active">Active</Label>
                    <p className="text-xs text-muted-foreground">Inactive users cannot log in.</p>
                  </div>
                  <Switch id="e-active" checked={editDraft.is_active}
                    onCheckedChange={(c) => setEditDraft({ ...editDraft, is_active: c })} />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
                  <Button onClick={submitEdit} disabled={editSaving}>
                    {editSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Save details
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="roles" className="space-y-5 mt-4">
                <div className="flex items-start justify-between rounded border p-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4" />
                      <Label className="text-sm">General (cross-Sector admin)</Label>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-md">Full access to every Sector. Can create / archive Sectors.</p>
                  </div>
                  <Switch checked={isGeneralUser(editTarget)} disabled={rolesSaving === "general"}
                    onCheckedChange={(c) => toggleGeneral(editTarget, c)} />
                </div>

                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2"><Shield className="h-4 w-4" /> Sector roles</h4>
                  {sectorRoles(editTarget).length === 0
                    ? <p className="text-sm text-muted-foreground py-2">Not a member of any Sector yet.</p>
                    : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Sector</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead className="w-[80px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sectorRoles(editTarget).map((r) => {
                            const s = sectorById[r.sector_id]
                            const busy = rolesSaving === r.sector_id
                            return (
                              <TableRow key={r.sector_id}>
                                <TableCell>
                                  {s?.name ?? "—"}
                                  <span className="text-muted-foreground text-xs ml-1">({s?.code ?? r.sector_id.slice(0, 6)})</span>
                                </TableCell>
                                <TableCell>
                                  <Select value={r.role} disabled={busy}
                                    onValueChange={(v) => assignSectorRole(editTarget, r.sector_id, v as SectorRoleName)}>
                                    <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="colonel">Colonel</SelectItem>
                                      <SelectItem value="captain">Captain</SelectItem>
                                      <SelectItem value="soldier">Soldier</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <Button variant="ghost" size="sm" disabled={busy}
                                    onClick={() => removeSectorRole(editTarget, r.sector_id)}>
                                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    )}

                  {(() => {
                    const taken = new Set(sectorRoles(editTarget).map((r) => r.sector_id))
                    const available = sectors.filter((s) => s.is_active && !taken.has(s.id))
                    if (!available.length) return null
                    return (
                      <div className="mt-3 rounded border border-dashed p-3 space-y-2">
                        <p className="text-xs text-muted-foreground">Assign to another Sector:</p>
                        <div className="grid grid-cols-3 gap-2">
                          <Select value={assignSectorId} onValueChange={setAssignSectorId}>
                            <SelectTrigger><SelectValue placeholder="Sector" /></SelectTrigger>
                            <SelectContent>
                              {available.map((s) => (
                                <SelectItem key={s.id} value={s.id}>{s.name} <span className="text-muted-foreground text-xs">({s.code})</span></SelectItem>
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
                          <Button disabled={!assignSectorId || rolesSaving === assignSectorId}
                            onClick={() => { if (assignSectorId) assignSectorRole(editTarget, assignSectorId, assignRole) }}>
                            {rolesSaving === assignSectorId ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                            Assign
                          </Button>
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {rolesError && <Alert variant="destructive"><AlertDescription>{rolesError}</AlertDescription></Alert>}
                <div className="flex justify-end pt-2">
                  <Button variant="outline" onClick={() => setEditTarget(null)}>Done</Button>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* ---- Delete confirm ---- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.username}</strong> will be removed permanently.
              Query history stays as an audit trail.
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
