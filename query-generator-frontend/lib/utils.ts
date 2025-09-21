import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// User role and permission utilities
export interface UserProfile {
  id: string
  username: string
  email: string
  full_name?: string
  role?: string // Optional for backward compatibility
  roles?: string[] // New format from backend
  is_active: boolean
  created_at: string
  last_login?: string
}

/**
 * Role priority for displaying the most important role
 */
const ROLE_PRIORITY: Record<string, number> = {
  admin: 100,
  administrator: 95,
  super_admin: 95,
  data_guy: 50,
  data_analyst: 45,
  catalog_manager: 40,
  user: 10,
  viewer: 5
}

/**
 * Get user roles as an array (handles both role and roles formats)
 */
function getUserRoles(userProfile: UserProfile): string[] {
  const roles: string[] = []
  
  // Handle new format with roles array (extract role_name from objects)
  if (userProfile.roles && Array.isArray(userProfile.roles)) {
    for (const role of userProfile.roles) {
      if (typeof role === 'string') {
        roles.push(role)
      } else if (role && typeof role === 'object' && (role as any).role_name) {
        roles.push((role as any).role_name)
      }
    }
  }
  
  // Handle legacy format with single role
  if (userProfile.role) {
    roles.push(userProfile.role)
  }
  
  return roles
}

/**
 * Get user's highest priority role for display
 */
function getUserPrimaryRole(userProfile: UserProfile): string {
  const roles = getUserRoles(userProfile)
  if (roles.length === 0) return 'user'
  
  // Sort roles by priority (highest first)
  const sortedRoles = roles.sort((a, b) => {
    const priorityA = ROLE_PRIORITY[a.toLowerCase()] || 0
    const priorityB = ROLE_PRIORITY[b.toLowerCase()] || 0
    return priorityB - priorityA
  })
  
  return sortedRoles[0]
}

/**
 * Check if a user has admin privileges
 * Based on the Query Generator API specification:
 * - Admin users can create users, assign roles, update policies
 * - Admin role names can be: "admin", "administrator", or specific admin usernames
 */
export function isAdmin(userProfile: UserProfile | null): boolean {
  if (!userProfile) return false
  
  const { username } = userProfile
  const roles = getUserRoles(userProfile)
  
  // Check role-based admin permissions
  const adminRoles = ['admin', 'administrator', 'super_admin', 'superuser']
  for (const role of roles) {
    if (adminRoles.includes(role.toLowerCase())) {
      return true
    }
  }
  
  // Check username-based admin permissions (for specific admin accounts)
  if (username) {
    const adminUsernames = ['mmdsvm', 'admin', 'administrator']
    if (adminUsernames.includes(username.toLowerCase())) {
      return true
    }
  }
  
  return false
}

/**
 * Check if a user can manage catalogs
 * Based on the Query Generator API specification:
 * - Admin users can manage catalogs
 * - Data guys can upload and manage catalogs
 */
export function canManageCatalogs(userProfile: UserProfile | null): boolean {
  if (!userProfile) return false
  
  // Admin users can always manage catalogs
  if (isAdmin(userProfile)) return true
  
  // Data guys can manage catalogs
  const roles = getUserRoles(userProfile)
  const catalogRoles = ['data_guy', 'data_analyst', 'catalog_manager']
  
  for (const role of roles) {
    if (catalogRoles.includes(role.toLowerCase())) {
      return true
    }
  }
  
  return false
}

/**
 * Check if a user can manage security policies
 * Based on the Query Generator API specification:
 * - Only admin users can update security policies
 */
export function canManageSecurityPolicies(userProfile: UserProfile | null): boolean {
  return isAdmin(userProfile)
}

/**
 * Check if a user can manage other users
 * Based on the Query Generator API specification:
 * - Only admin users can create users and assign roles
 */
export function canManageUsers(userProfile: UserProfile | null): boolean {
  return isAdmin(userProfile)
}

/**
 * Check if a user can generate queries
 * Based on the Query Generator API specification:
 * - Admin, data_guy, and user roles can generate queries
 */
export function canGenerateQueries(userProfile: UserProfile | null): boolean {
  if (!userProfile?.is_active) return false
  
  const roles = getUserRoles(userProfile)
  const allowedRoles = ['admin', 'data_guy', 'user']
  
  // If user has any allowed role, they can generate queries
  for (const role of roles) {
    if (allowedRoles.includes(role.toLowerCase())) {
      return true
    }
  }
  
  // Also allow users with no roles (for backward compatibility)
  return roles.length === 0
}

/**
 * Get user role display name
 */
export function getRoleDisplayName(userProfile: UserProfile | null): string {
  if (!userProfile) return 'Guest'
  
  const roles = getUserRoles(userProfile)
  if (roles.length === 0) return 'Unknown'
  
  const roleMap: Record<string, string> = {
    admin: 'Administrator',
    administrator: 'Administrator',
    super_admin: 'Super Admin',
    data_guy: 'Data Analyst',
    data_analyst: 'Data Analyst',
    catalog_manager: 'Catalog Manager',
    user: 'User',
    viewer: 'Viewer',
  }
  
  // Return the display name for the first (primary) role
  const primaryRole = roles[0].toLowerCase()
  return roleMap[primaryRole] || roles[0]
}

/**
 * Get user permissions summary
 */
export function getUserPermissions(userProfile: UserProfile | null) {
  return {
    isAdmin: isAdmin(userProfile),
    canManageCatalogs: canManageCatalogs(userProfile),
    canManageSecurityPolicies: canManageSecurityPolicies(userProfile),
    canManageUsers: canManageUsers(userProfile),
    canGenerateQueries: canGenerateQueries(userProfile),
    roleDisplayName: getRoleDisplayName(userProfile),
  }
}
