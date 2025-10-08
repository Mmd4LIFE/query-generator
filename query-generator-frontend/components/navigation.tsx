"use client"

import { Button } from "@/components/ui/button"
import { Database, Zap, Users, History } from "lucide-react"
import { cn, getUserPermissions } from "@/lib/utils"

interface NavigationProps {
  currentPage: string
  onPageChange: (page: "generate" | "catalogs" | "users" | "history") => void
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
      id: "history" as const,
      label: "Query History",
      icon: History,
      requiresPermission: () => permissions.canGenerateQueries,
    },
    {
      id: "catalogs" as const,
      label: "Manage Catalogs",
      icon: Database,
      requiresPermission: () => permissions.canManageCatalogs,
    },
    {
      id: "users" as const,
      label: "User Management",
      icon: Users,
      requiresPermission: () => permissions.canManageUsers,
    },
  ]

  const handlePageChange = (page: "generate" | "catalogs" | "users" | "history") => {
    onPageChange(page)
  }

  const NavContent = () => (
    <div className="space-y-2">
      {navItems.map((item) => {
        if (!item.requiresPermission()) return null

        const Icon = item.icon
        return (
          <Button
            key={item.id}
            variant={currentPage === item.id ? "default" : "ghost"}
            className={cn("w-full justify-start", currentPage === item.id ? "" : "bg-transparent")}
            onClick={() => handlePageChange(item.id)}
          >
            <Icon className="mr-2 h-4 w-4" />
            {item.label}
          </Button>
        )
      })}
    </div>
  )

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden lg:block w-64 border-r bg-card p-4">
        <NavContent />
      </nav>

      {/* Mobile Navigation - Icon Only */}
      <nav className="lg:hidden fixed left-0 top-16 bottom-0 w-16 bg-card border-r z-40">
        <div className="flex flex-col items-center py-4 space-y-2">
          {navItems.map((item) => {
            if (!item.requiresPermission()) return null

            const Icon = item.icon
            return (
              <Button
                key={item.id}
                variant={currentPage === item.id ? "default" : "ghost"}
                size="sm"
                className={cn(
                  "w-10 h-10 p-0 rounded-lg",
                  currentPage === item.id ? "" : "bg-transparent hover:bg-muted"
                )}
                onClick={() => handlePageChange(item.id)}
                title={item.label}
              >
                <Icon className="h-5 w-5" />
              </Button>
            )
          })}
        </div>
      </nav>
    </>
  )
}
