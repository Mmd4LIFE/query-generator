"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronDown, ChevronRight, Bug } from "lucide-react"
import { getUserPermissions, type UserProfile } from "@/lib/utils"

interface DebugPanelProps {
  userProfile: UserProfile | null
  isVisible?: boolean
}

export function DebugPanel({ userProfile, isVisible = false }: DebugPanelProps) {
  const [isOpen, setIsOpen] = useState(isVisible)
  const permissions = getUserPermissions(userProfile)

  if (!isOpen) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="bg-yellow-50 border-yellow-200 text-yellow-800 hover:bg-yellow-100"
        >
          <Bug className="w-4 h-4 mr-2" />
          Debug
        </Button>
      </div>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96">
      <Card className="bg-yellow-50 border-yellow-200">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Bug className="w-4 h-4 text-yellow-600" />
              <CardTitle className="text-sm text-yellow-800">Debug Panel</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="h-6 w-6 p-0 text-yellow-600 hover:text-yellow-800"
            >
              ×
            </Button>
          </div>
          <CardDescription className="text-xs text-yellow-700">
            User permissions and profile debugging
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {/* User Profile Section */}
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center space-x-1 text-yellow-800 hover:text-yellow-900">
              <ChevronDown className="w-3 h-3" />
              <span className="font-medium">User Profile</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              {userProfile ? (
                <div className="bg-white rounded p-2 space-y-1">
                  <div><strong>Username:</strong> {userProfile.username || 'undefined'}</div>
                  <div><strong>Email:</strong> {userProfile.email || 'undefined'}</div>
                  <div><strong>Role:</strong> <Badge variant="secondary" className="text-xs">{userProfile.role || 'undefined'}</Badge></div>
                  <div><strong>Roles:</strong> {userProfile.roles ? userProfile.roles.map(role => 
                    <Badge key={role} variant="outline" className="text-xs mr-1">{role}</Badge>
                  ) : 'undefined'}</div>
                  <div><strong>Active:</strong> {userProfile.is_active ? '✅' : '❌'}</div>
                  <div><strong>ID:</strong> {userProfile.id || 'undefined'}</div>
                  <div className="mt-2 p-2 bg-gray-50 rounded text-xs">
                    <strong>Raw JSON:</strong>
                    <pre className="mt-1 whitespace-pre-wrap break-words">
                      {JSON.stringify(userProfile, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="bg-red-50 rounded p-2 text-red-700">
                  No user profile loaded
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* Permissions Section */}
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center space-x-1 text-yellow-800 hover:text-yellow-900">
              <ChevronDown className="w-3 h-3" />
              <span className="font-medium">Permissions</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="bg-white rounded p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span>Is Admin:</span>
                  <Badge variant={permissions.isAdmin ? "default" : "secondary"} className="text-xs">
                    {permissions.isAdmin ? '✅' : '❌'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Manage Catalogs:</span>
                  <Badge variant={permissions.canManageCatalogs ? "default" : "secondary"} className="text-xs">
                    {permissions.canManageCatalogs ? '✅' : '❌'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Manage Policies:</span>
                  <Badge variant={permissions.canManageSecurityPolicies ? "default" : "secondary"} className="text-xs">
                    {permissions.canManageSecurityPolicies ? '✅' : '❌'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Manage Users:</span>
                  <Badge variant={permissions.canManageUsers ? "default" : "secondary"} className="text-xs">
                    {permissions.canManageUsers ? '✅' : '❌'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Generate Queries:</span>
                  <Badge variant={permissions.canGenerateQueries ? "default" : "secondary"} className="text-xs">
                    {permissions.canGenerateQueries ? '✅' : '❌'}
                  </Badge>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* API Connection Status */}
          <Collapsible>
            <CollapsibleTrigger className="flex items-center space-x-1 text-yellow-800 hover:text-yellow-900">
              <ChevronRight className="w-3 h-3" />
              <span className="font-medium">API Status</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="bg-white rounded p-2 space-y-1">
                <div><strong>Base URL:</strong> {process.env.NEXT_PUBLIC_API_BASE_URL || 'http://159.69.6.143:8000'}</div>
                <div><strong>Demo Mode:</strong> {process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ? '✅' : '❌'}</div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Quick Actions */}
          <div className="pt-2 border-t border-yellow-200">
            <div className="text-yellow-700 font-medium mb-2">Quick Actions:</div>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={() => {
                  console.log('User Profile:', userProfile)
                  console.log('Permissions:', permissions)
                }}
              >
                Log to Console
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={async () => {
                  try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                      await navigator.clipboard.writeText(JSON.stringify({ userProfile, permissions }, null, 2))
                      console.log('Copied to clipboard!')
                    } else {
                      // Fallback for browsers without clipboard API
                      console.log('Debug data:', { userProfile, permissions })
                      alert('Clipboard not available. Check browser console for debug data.')
                    }
                  } catch (error) {
                    console.error('Failed to copy:', error)
                    console.log('Debug data:', { userProfile, permissions })
                    alert('Copy failed. Check browser console for debug data.')
                  }
                }}
              >
                Copy JSON
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 