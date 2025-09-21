"use client"

import { useState, useEffect } from "react"
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Users, Plus, Edit, Trash2, AlertCircle, UserCheck, UserX } from "lucide-react"
import type { QueryGeneratorAPI } from "@/lib/api"

interface UserSettingsPageProps {
  api: QueryGeneratorAPI
}

export function UserSettingsPage({ api }: UserSettingsPageProps) {
  const [users, setUsers] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Helper function to get user's primary role (highest priority)
  const getUserRole = (user: any): string => {
    try {
      if (user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
        // Extract role names from objects
        const roleNames = user.roles.map((role: any) => 
          typeof role === 'string' ? role : role.role_name || String(role)
        )
        
        // Define role priority (highest to lowest)
        const rolePriority: Record<string, number> = {
          admin: 100,
          administrator: 95,
          super_admin: 95,
          data_guy: 50,
          data_analyst: 45,
          catalog_manager: 40,
          user: 10,
          viewer: 5
        }
        
        // Return highest priority role
        const sortedRoles = roleNames.sort((a: string, b: string) => {
          const priorityA = rolePriority[a.toLowerCase()] || 0
          const priorityB = rolePriority[b.toLowerCase()] || 0
          return priorityB - priorityA
        })
        
        return sortedRoles[0]
      }
      return user.role || 'user' // Fallback to single role or default
    } catch (error) {
      console.error('Error getting user role:', error, 'for user:', user)
      return 'user'
    }
  }
  const [formData, setFormData] = useState({
    username: "",
    full_name: "",
    email: "",
    role: "user",
    is_active: true,
    password: "",
  })

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    setIsLoading(true)
    setError("")
    try {
      const usersData = await api.getUsers()
      console.log('Raw API response:', JSON.stringify(usersData, null, 2))
      
      // Transform the data if needed
      const transformedUsers = Array.isArray(usersData) ? usersData.map((user: any) => {
        const transformedUser = {
          ...user,
          // Ensure roles is always an array of strings, not objects
          roles: user.roles ? user.roles.map((role: any) => {
            if (typeof role === 'string') {
              return role
            } else if (role && typeof role === 'object') {
              return role.role_name || role.name || 'unknown'
            } else {
              return String(role)
            }
          }) : []
        }
        console.log('Transformed user:', user.username, 'from roles:', user.roles, 'to roles:', transformedUser.roles)
        return transformedUser
      }) : []
      
      console.log('Transformed users:', transformedUsers)
      setUsers(transformedUsers)
    } catch (err: any) {
      console.error('Failed to load users:', err)
      
      // Parse different types of API errors
      let errorMessage = "Failed to load users"
      if (err.response && err.response.data && err.response.data.detail) {
        if (typeof err.response.data.detail === 'string') {
          errorMessage = err.response.data.detail
        } else if (Array.isArray(err.response.data.detail)) {
          errorMessage = err.response.data.detail.map((item: any) => 
            item.msg || item.message || JSON.stringify(item)
          ).join(', ')
        }
      } else if (err.message && typeof err.message === 'string') {
        errorMessage = err.message
      }
      
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError("")
    try {
      if (editingUser) {
        // Update existing user (excluding role)
        const { role, ...userUpdateData } = formData
        await api.updateUser(editingUser.id, userUpdateData)
        console.log("Updated user:", userUpdateData)
        
        // Handle role assignment separately if role changed
        const currentRole = getUserRole(editingUser)
        if (role && role !== currentRole) {
          console.log("Role changed from", currentRole, "to", role)
          
          // Backend now handles single role assignment automatically
          // Just assign the new role - backend will soft-delete old ones
          await api.assignUserRole(editingUser.id, role)
          console.log("Successfully assigned new role:", role)
        }
      } else {
        // Create new user (excluding role from user data)
        const { role, ...userCreateData } = formData
        const newUser = await api.createUser(userCreateData)
        console.log("Created user:", newUser)
        
        // Assign role if specified (backend handles single role automatically)
        if (role) {
          const userId = newUser.id || (newUser as any).user_id || newUser.username
          console.log("Assigning role", role, "to user ID:", userId)
          await api.assignUserRole(userId, role)
          console.log("Assigned role to new user:", role)
        }
      }
      setIsDialogOpen(false)
      resetForm()
      await loadUsers()
    } catch (err: any) {
      console.error('Failed to save user:', err)
      
      // Parse different types of API errors
      let errorMessage = "Failed to save user"
      
      if (err.response && err.response.data) {
        // Axios error with response data
        const responseData = err.response.data
        if (typeof responseData === 'string') {
          errorMessage = responseData
        } else if (responseData.detail) {
          if (Array.isArray(responseData.detail)) {
            // Validation errors array
            errorMessage = responseData.detail.map((item: any) => 
              item.msg || item.message || JSON.stringify(item)
            ).join(', ')
          } else if (typeof responseData.detail === 'string') {
            errorMessage = responseData.detail
          } else {
            errorMessage = JSON.stringify(responseData.detail)
          }
        } else if (responseData.message) {
          errorMessage = responseData.message
        }
      } else if (err.message && typeof err.message === 'string') {
        errorMessage = err.message
      } else if (typeof err === 'string') {
        errorMessage = err
      }
      
      setError(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setFormData({
      username: "",
      full_name: "",
      email: "",
      role: "user",
      is_active: true,
      password: "",
    })
    setEditingUser(null)
  }

  const handleEdit = (user: any) => {
    setEditingUser(user)
    setFormData({
      username: user.username,
      full_name: user.full_name || "",
      email: user.email,
      role: getUserRole(user),
      is_active: user.is_active,
      password: "",
    })
    setIsDialogOpen(true)
  }

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    try {
      await api.toggleUserStatus(userId, isActive)
      console.log("Toggled user active status:", userId, isActive)
      await loadUsers()
    } catch (err: any) {
      console.error('Failed to update user status:', err)
      
      let errorMessage = "Failed to update user status"
      if (err.response && err.response.data && err.response.data.detail) {
        if (typeof err.response.data.detail === 'string') {
          errorMessage = err.response.data.detail
        } else if (Array.isArray(err.response.data.detail)) {
          errorMessage = err.response.data.detail.map((item: any) => 
            item.msg || item.message || JSON.stringify(item)
          ).join(', ')
        }
      } else if (err.message && typeof err.message === 'string') {
        errorMessage = err.message
      }
      
      setError(errorMessage)
    }
  }

  const handleDelete = async (userId: string) => {
    if (confirm("Are you sure you want to delete this user? This action cannot be undone.")) {
      try {
        await api.deleteUser(userId)
        console.log("Deleted user:", userId)
        await loadUsers()
      } catch (err: any) {
        console.error('Failed to delete user:', err)
        
        let errorMessage = "Failed to delete user"
        if (err.response && err.response.data && err.response.data.detail) {
          if (typeof err.response.data.detail === 'string') {
            errorMessage = err.response.data.detail
          } else if (Array.isArray(err.response.data.detail)) {
            errorMessage = err.response.data.detail.map((item: any) => 
              item.msg || item.message || JSON.stringify(item)
            ).join(', ')
          }
        } else if (err.message && typeof err.message === 'string') {
          errorMessage = err.message
        }
        
        setError(errorMessage)
      }
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">User Management</h1>
            <p className="text-muted-foreground">Manage user accounts and access permissions</p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={resetForm}>
                <Plus className="mr-2 h-4 w-4" />
                Add User
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{editingUser ? "Edit User" : "Add New User"}</DialogTitle>
                <DialogDescription>Configure user account and permissions</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    placeholder="Enter username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="full_name">Full Name</Label>
                  <Input
                    id="full_name"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    placeholder="Enter full name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="user@company.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="data_guy">Data Analyst</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {!editingUser && (
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="Enter password"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Active Account</Label>
                    <p className="text-sm text-muted-foreground">User can log in and access the system</p>
                  </div>
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={isSubmitting}>
                    {isSubmitting ? "Processing..." : editingUser ? "Update User" : "Create User"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Users className="w-5 h-5" />
              <span>System Users</span>
            </CardTitle>
            <CardDescription>Manage user accounts and permissions</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">Loading users...</div>
            ) : users.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No users found.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Full Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => {
                    try {
                      return (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">{user.username || 'N/A'}</TableCell>
                          <TableCell>{user.full_name || 'N/A'}</TableCell>
                          <TableCell>{user.email || 'N/A'}</TableCell>
                          <TableCell>
                            <Badge variant={getUserRole(user) === "admin" ? "default" : "secondary"}>
                              {getUserRole(user)}
                            </Badge>
                          </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          {user.is_active ? (
                            <>
                              <UserCheck className="w-4 h-4 text-green-500" />
                              <span className="text-sm">Active</span>
                            </>
                          ) : (
                            <>
                              <UserX className="w-4 h-4 text-red-500" />
                              <span className="text-sm">Inactive</span>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(user.last_login)}</TableCell>
                      <TableCell>{formatDate(user.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleEdit(user)}
                            title="Edit user details"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleActive(user.id, !user.is_active)}
                            title={user.is_active ? "Deactivate user" : "Activate user"}
                          >
                            {user.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleDelete(user.id)}
                            title="Delete user"
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                          </TableCell>
                        </TableRow>
                      )
                    } catch (error) {
                      console.error('Error rendering user row:', error, 'for user:', user)
                      return (
                        <TableRow key={user.id || Math.random()}>
                          <TableCell colSpan={8} className="text-center text-red-500">
                            Error displaying user: {user.username || 'Unknown'}
                          </TableCell>
                        </TableRow>
                      )
                    }
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
