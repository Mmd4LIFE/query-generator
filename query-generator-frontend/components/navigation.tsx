"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Database, Zap, Shield, Users, Menu } from "lucide-react"
import { cn, getUserPermissions } from "@/lib/utils"

interface NavigationProps {
  currentPage: string
  onPageChange: (page: "generate" | "catalogs" | "security" | "users") => void
  permissions: ReturnType<typeof getUserPermissions>
}

export function Navigation({ currentPage, onPageChange, permissions }: NavigationProps) {
  const [isOpen, setIsOpen] = useState(false)

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

  const handlePageChange = (page: "generate" | "catalogs" | "security" | "users") => {
    onPageChange(page)
    setIsOpen(false) // Close mobile menu after selection
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

      {/* Mobile Navigation */}
      <div className="lg:hidden">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="fixed top-16 left-4 z-50 lg:hidden shadow-lg">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-4">
            <div className="mt-8">
              <NavContent />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
