"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Database, User, LogOut, Play } from "lucide-react"
import { QueryGeneratorAPI } from "@/lib/api"
import { Navigation } from "@/components/navigation"
import { GenerateQueryPage } from "@/components/generate-query-page"
import { QueryHistoryPage } from "@/components/query-history-page"
import { ManageCatalogsPage } from "@/components/manage-catalogs-page"
import { SecurityPoliciesPage } from "@/components/security-policies-page"
import { UserSettingsPage } from "@/components/user-settings-page"
import { getUserPermissions } from "@/lib/utils"

type Page = "generate" | "catalogs" | "security" | "users" | "history"

export default function QueryGeneratorApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentPage, setCurrentPage] = useState<Page>("generate")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [userProfile, setUserProfile] = useState<any>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [api] = useState(() => new QueryGeneratorAPI())

  // Get user permissions
  const permissions = getUserPermissions(userProfile)

  // Check for existing authentication on component mount
  useEffect(() => {
    const checkExistingAuth = async () => {
      console.log('🔍 Checking existing authentication...')
      try {
        // Check if there's a stored token or if we're in demo mode
        const storedToken = localStorage.getItem('auth_token')
        console.log('📱 Stored token:', storedToken ? 'Found' : 'None')
        console.log('🎮 Demo mode:', api.isDemoMode())
        
        if (storedToken) {
          console.log('🔑 Setting stored token...')
          api.setToken(storedToken)
          const profile = await api.getUserProfile()
          setUserProfile(profile)
          setIsAuthenticated(true)
          console.log('✅ Restored authentication from stored token')
        } else if (api.isDemoMode()) {
          // Auto-login for demo mode
          console.log('🎮 Auto-logging in for demo mode...')
          setIsAuthenticated(true)
          setUserProfile({
            username: 'demo_user',
            role: 'admin',
            email: 'demo@example.com'
          })
          console.log('✅ Auto-logged in for demo mode')
        } else {
          console.log('❌ No stored token and not in demo mode')
        }
      } catch (error) {
        console.error('❌ Auth check failed:', error)
        // Clear invalid token
        localStorage.removeItem('auth_token')
      } finally {
        setIsInitializing(false)
        console.log('🏁 Initialization complete')
      }
    }

    checkExistingAuth()
  }, [])

  const handleLogin = async () => {
    setIsLoading(true)
    setError("")

    try {
      console.log('🔐 Attempting login...', { username })
      const loginResponse = await api.login({ username, password })
      console.log('🎉 Login successful:', loginResponse)
      
      // Store token for persistence
      if (loginResponse.access_token) {
        localStorage.setItem('auth_token', loginResponse.access_token)
        console.log('💾 Token stored in localStorage')
      }
      const profile = await api.getUserProfile()
      console.log('👤 User profile:', profile)
      setUserProfile(profile)
      setIsAuthenticated(true)
    } catch (err) {
      console.error('❌ Login failed:', err)
      setError("Login failed. Please check your credentials.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleDemoLogin = async () => {
    setIsLoading(true)
    setError("")

    try {
      api.setDemoMode(true)
      await api.login({ username: "demo", password: "demo" })
      const profile = await api.getUserProfile()
      setUserProfile(profile)
      setIsAuthenticated(true)
    } catch (err) {
      setError("Demo login failed.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    api.clearToken()
    setIsAuthenticated(false)
    setUserProfile(null)
    setCurrentPage("generate")
    api.setDemoMode(false)
  }

  // Show loading screen while checking authentication
  if (isInitializing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center p-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 bg-primary rounded-lg flex items-center justify-center">
              <Database className="w-6 h-6 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl font-bold">Query Generator</CardTitle>
            <CardDescription className="text-card-foreground">
              AI-powered SQL query generation from natural language
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleLogin()}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button onClick={handleLogin} className="w-full" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <Button onClick={handleDemoLogin} variant="outline" className="w-full bg-transparent" disabled={isLoading}>
              <Play className="w-4 h-4 mr-2" />
              Try Demo
            </Button>

            <Alert>
              <AlertDescription className="text-sm text-card-foreground">
                Use the demo to explore all features with sample data. No backend connection required.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={`min-h-screen bg-background ${isAuthenticated ? 'authenticated-layout' : ''}`}>
        {/* Header */}
        <header className="border-b bg-card">
        <div className="w-full px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Database className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-xl font-bold text-foreground">Query Generator</h1>
              <p className="text-sm text-muted-foreground">AI-powered SQL generation</p>
            </div>
            <div className="sm:hidden">
              <h1 className="text-lg font-bold text-foreground">QG</h1>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="secondary" className="hidden sm:flex items-center space-x-1">
              <User className="w-3 h-3" />
              <span>{userProfile?.username || username}</span>
            </Badge>
            <Badge variant="secondary" className="sm:hidden">
              <User className="w-3 h-3" />
            </Badge>
            {permissions.isAdmin && (
              <Badge variant="outline" className="text-xs hidden sm:block">
                {permissions.roleDisplayName}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-[256px_1fr] min-h-screen lg:grid-cols-[256px_1fr] grid-cols-1">
        <Navigation 
          currentPage={currentPage} 
          onPageChange={setCurrentPage} 
          permissions={permissions}
        />

        {/* Main Content */}
        <main className="pt-16 lg:pt-0 min-h-screen overflow-hidden">
          {currentPage === "generate" && <GenerateQueryPage api={api} />}
          {currentPage === "history" && <QueryHistoryPage api={api} userProfile={userProfile} />}
          {currentPage === "catalogs" && (
            <ManageCatalogsPage 
              api={api} 
              userPermissions={{
                canCreateKnowledge: permissions.canManageCatalogs,
                canApproveKnowledge: permissions.isAdmin,
              }}
            />
          )}
          {currentPage === "security" && <SecurityPoliciesPage api={api} />}
          {currentPage === "users" && <UserSettingsPage api={api} />}
        </main>
      </div>
      
    </div>
  )
}
