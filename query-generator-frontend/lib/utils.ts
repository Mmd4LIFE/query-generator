import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---------------------------------------------------------------------------
// Role vocabulary — General / Colonel / Captain / Soldier
//
// The backend's JWT (and `/auth/me`) returns:
//   {
//     is_general: boolean,
//     sectors: [{ sector_id, sector_code, role: 'colonel'|'captain'|'soldier' }, ...]
//   }
// `role` here is **per-Sector**. Generals carry no Sector membership rows;
// the `is_general` flag is authoritative for them.
//
// Legacy role names (`admin`, `data_guy`, `user`) are still tolerated by the
// helpers below so a stale token doesn't crash the UI — they map to
// general / captain / soldier respectively.
// ---------------------------------------------------------------------------

export type Role = "general" | "colonel" | "captain" | "soldier"

export interface SectorMembership {
  sector_id: string
  sector_code: string
  sector_name?: string
  role: Role
}

export interface UserProfile {
  id: string
  username: string
  email: string
  full_name?: string
  is_active: boolean
  created_at: string
  last_login?: string
  /** True iff the caller holds the cross-Sector General role. */
  is_general?: boolean
  /** Per-Sector memberships. Empty for Generals. */
  sectors?: SectorMembership[]

  // ----- legacy fields (still emitted by older deployments) -----
  role?: string
  roles?: Array<string | { role_name: string; sector_id?: string }>
}

const ROLE_PRIORITY: Record<string, number> = {
  general: 100,
  // legacy aliases
  admin: 100,
  administrator: 95,
  super_admin: 95,

  colonel: 70,

  captain: 40,
  data_guy: 40,
  data_analyst: 35,
  catalog_manager: 30,

  soldier: 10,
  user: 10,
  viewer: 5,
}


function legacyRoles(userProfile: UserProfile): string[] {
  const out: string[] = []
  if (userProfile.roles && Array.isArray(userProfile.roles)) {
    for (const r of userProfile.roles) {
      if (typeof r === "string") out.push(r)
      else if (r && typeof r === "object" && r.role_name) out.push(r.role_name)
    }
  }
  if (userProfile.role) out.push(userProfile.role)
  return out
}


export function isGeneral(userProfile: UserProfile | null): boolean {
  if (!userProfile) return false
  if (userProfile.is_general === true) return true
  // Legacy fallback: an old "admin"-only payload (no is_general flag).
  return legacyRoles(userProfile).some(
    (r) => ["general", "admin", "administrator", "super_admin", "superuser"].includes(r.toLowerCase())
  )
}


/** Highest-priority role the user holds in `sectorId`. Generals always pass. */
export function roleInSector(
  userProfile: UserProfile | null,
  sectorId: string | null,
): Role | null {
  if (!userProfile) return null
  if (isGeneral(userProfile)) return "general"
  if (!sectorId) return null
  const m = userProfile.sectors?.find((s) => s.sector_id === sectorId)
  return m?.role ?? null
}


function meetsTier(have: Role | null, need: Role): boolean {
  if (!have) return false
  return (ROLE_PRIORITY[have] ?? 0) >= (ROLE_PRIORITY[need] ?? 0)
}


/** Cross-Sector check: does the user hold `role` in ANY Sector (or is General)? */
function hasRoleAnywhere(userProfile: UserProfile | null, need: Role): boolean {
  if (!userProfile) return false
  if (isGeneral(userProfile)) return true
  const sectorRoles = userProfile.sectors?.map((s) => s.role) ?? []
  if (sectorRoles.some((r) => meetsTier(r, need))) return true
  // Legacy fallback so an old token (with role/roles[] only) keeps working
  // until the user re-logs and gets a sectors[]-bearing token.
  return legacyRoles(userProfile).some((r) => meetsTier(r.toLowerCase() as Role, need))
}


// ---------------------------------------------------------------------------
// Public permission helpers (preserve the API the UI was already using)
// ---------------------------------------------------------------------------

export function isAdmin(userProfile: UserProfile | null): boolean {
  // Kept for compatibility with existing imports. "Admin" now means General.
  return isGeneral(userProfile)
}


/** Captain+ in at least one Sector (or General). */
export function canManageCatalogs(userProfile: UserProfile | null): boolean {
  return hasRoleAnywhere(userProfile, "captain")
}


/** Colonel+ in at least one Sector (or General). */
export function canManageSecurityPolicies(userProfile: UserProfile | null): boolean {
  return hasRoleAnywhere(userProfile, "colonel")
}


/** Only Generals can create cross-Sector users; Colonels manage members
 *  inside their own Sector via the Sector members API. */
export function canManageUsers(userProfile: UserProfile | null): boolean {
  return isGeneral(userProfile)
}


/** Soldier+ in at least one Sector (or General). */
export function canGenerateQueries(userProfile: UserProfile | null): boolean {
  if (!userProfile?.is_active) return false
  return hasRoleAnywhere(userProfile, "soldier")
}


/** Colonel+ in at least one Sector (or General). */
export function canApproveKnowledge(userProfile: UserProfile | null): boolean {
  return hasRoleAnywhere(userProfile, "colonel")
}


export function getRoleDisplayName(userProfile: UserProfile | null): string {
  if (!userProfile) return "Guest"
  if (isGeneral(userProfile)) return "General"
  const sector = userProfile.sectors?.[0]
  if (sector) {
    const map: Record<Role, string> = {
      general: "General",
      colonel: "Colonel",
      captain: "Captain",
      soldier: "Soldier",
    }
    return map[sector.role] ?? sector.role
  }
  // Legacy fallback for old tokens.
  const legacy = legacyRoles(userProfile)
  if (!legacy.length) return "Soldier"
  const primary = legacy[0].toLowerCase()
  const legacyMap: Record<string, string> = {
    admin: "General",
    data_guy: "Captain",
    data_analyst: "Captain",
    catalog_manager: "Captain",
    user: "Soldier",
    viewer: "Soldier",
  }
  return legacyMap[primary] ?? legacy[0]
}


export function getUserPermissions(userProfile: UserProfile | null) {
  return {
    isAdmin: isGeneral(userProfile),
    isGeneral: isGeneral(userProfile),
    canManageCatalogs: canManageCatalogs(userProfile),
    canManageSecurityPolicies: canManageSecurityPolicies(userProfile),
    canManageUsers: canManageUsers(userProfile),
    canGenerateQueries: canGenerateQueries(userProfile),
    canApproveKnowledge: canApproveKnowledge(userProfile),
    roleDisplayName: getRoleDisplayName(userProfile),
  }
}
