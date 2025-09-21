"use client"

import { Button } from "@/components/ui/button"
import { Database, Zap, Shield, Users } from "lucide-react"
import { cn, getUserPermissions } from "@/lib/utils"

interface NavigationProps {
  currentPage: string
  onPageChange: (page: "generate" | "catalogs" | "security" | "users") => void
  permissions: ReturnType<typeof getUserPermissions>
}

export function Navigation({ currentPage, onPageChange, permissions }: NavigationProps) {
  const navItems = [
    {
      id: "generate" as const,
      label: "Generate Query",
      icon: Zap,
      requiresPermission: () => permissions.canGenerateQueries,
    },
    {
      id: "catalogs" as const,
      label: "Manage Catalogs",
      icon: Database,
      requiresPermission: () => permissions.canManageCatalogs,
    },
    {
      id: "security" as const,
      label: "Security Policies",
      icon: Shield,
      requiresPermission: () => permissions.canManageSecurityPolicies,
    },
    {
      id: "users" as const,
      label: "User Management",
      icon: Users,
      requiresPermission: () => permissions.canManageUsers,
    },
  ]

  return (
    <nav className="w-64 border-r bg-card p-4">
      <div className="space-y-2">
        {navItems.map((item) => {
          if (!item.requiresPermission()) return null

          const Icon = item.icon
          return (
            <Button
              key={item.id}
              variant={currentPage === item.id ? "default" : "ghost"}
              className={cn("w-full justify-start", currentPage === item.id ? "" : "bg-transparent")}
              onClick={() => onPageChange(item.id)}
            >
              <Icon className="mr-2 h-4 w-4" />
              {item.label}
            </Button>
          )
        })}
      </div>
    </nav>
  )
}
