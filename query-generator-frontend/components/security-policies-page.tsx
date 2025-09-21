"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Shield, Plus, Edit, Trash2, AlertTriangle, CheckCircle, Save } from "lucide-react"
import type { QueryGeneratorAPI } from "@/lib/api"

interface SecurityPoliciesPageProps {
  api: QueryGeneratorAPI
}

export function SecurityPoliciesPage({ api }: SecurityPoliciesPageProps) {
  const [policies, setPolicies] = useState<any[]>([])
  const [globalSettings, setGlobalSettings] = useState({
    allow_write_operations: false,
    default_row_limit: 1000,
    enable_pii_masking: true,
    require_approval_for_sensitive: true,
  })
  const [bannedItems, setBannedItems] = useState<string[]>([])
  const [newBannedItem, setNewBannedItem] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    loadPolicies()
  }, [])

  const loadPolicies = async () => {
    setIsLoading(true)
    try {
      // Mock data - replace with actual API calls
      setPolicies([
        {
          id: "1",
          name: "Production Safety",
          description: "Strict policies for production database access",
          allow_write: false,
          max_rows: 500,
          banned_tables: ["user_passwords", "payment_info"],
          active: true,
        },
        {
          id: "2",
          name: "Development Access",
          description: "Relaxed policies for development environment",
          allow_write: true,
          max_rows: 10000,
          banned_tables: [],
          active: true,
        },
      ])
      setBannedItems(["DROP", "DELETE", "TRUNCATE", "ALTER"])
    } catch (err) {
      setError("Failed to load security policies")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveGlobalSettings = async () => {
    try {
      // This would call the API to save global settings
      console.log("Saving global settings:", globalSettings)
      // Show success message
    } catch (err) {
      setError("Failed to save global settings")
    }
  }

  const handleAddBannedItem = () => {
    if (newBannedItem.trim() && !bannedItems.includes(newBannedItem.trim().toUpperCase())) {
      setBannedItems([...bannedItems, newBannedItem.trim().toUpperCase()])
      setNewBannedItem("")
    }
  }

  const handleRemoveBannedItem = (item: string) => {
    setBannedItems(bannedItems.filter((i) => i !== item))
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Security Policies</h1>
            <p className="text-muted-foreground">Configure security rules and access controls</p>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="global" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="global">Global Settings</TabsTrigger>
            <TabsTrigger value="policies">Access Policies</TabsTrigger>
            <TabsTrigger value="banned">Banned Items</TabsTrigger>
          </TabsList>

          <TabsContent value="global" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Shield className="w-5 h-5" />
                  <span>Global Security Settings</span>
                </CardTitle>
                <CardDescription>System-wide security configurations</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Allow Write Operations</Label>
                    <p className="text-sm text-muted-foreground">Enable INSERT, UPDATE, DELETE operations</p>
                  </div>
                  <Switch
                    checked={globalSettings.allow_write_operations}
                    onCheckedChange={(checked) =>
                      setGlobalSettings({ ...globalSettings, allow_write_operations: checked })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="row-limit">Default Row Limit</Label>
                  <Input
                    id="row-limit"
                    type="number"
                    value={globalSettings.default_row_limit}
                    onChange={(e) =>
                      setGlobalSettings({ ...globalSettings, default_row_limit: Number.parseInt(e.target.value) })
                    }
                  />
                  <p className="text-sm text-muted-foreground">Maximum rows returned by default (0 = unlimited)</p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable PII Masking</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically mask personally identifiable information
                    </p>
                  </div>
                  <Switch
                    checked={globalSettings.enable_pii_masking}
                    onCheckedChange={(checked) => setGlobalSettings({ ...globalSettings, enable_pii_masking: checked })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Require Approval for Sensitive Queries</Label>
                    <p className="text-sm text-muted-foreground">
                      Sensitive queries need admin approval before execution
                    </p>
                  </div>
                  <Switch
                    checked={globalSettings.require_approval_for_sensitive}
                    onCheckedChange={(checked) =>
                      setGlobalSettings({ ...globalSettings, require_approval_for_sensitive: checked })
                    }
                  />
                </div>

                <Button onClick={handleSaveGlobalSettings} className="w-full">
                  <Save className="mr-2 h-4 w-4" />
                  Save Global Settings
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="policies" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Access Policies</CardTitle>
                <CardDescription>Manage catalog-specific security policies</CardDescription>
              </CardHeader>
              <CardContent>
                {policies.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No policies configured.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Policy Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Write Access</TableHead>
                        <TableHead>Row Limit</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {policies.map((policy) => (
                        <TableRow key={policy.id}>
                          <TableCell className="font-medium">{policy.name}</TableCell>
                          <TableCell>{policy.description}</TableCell>
                          <TableCell>
                            <Badge variant={policy.allow_write ? "destructive" : "secondary"}>
                              {policy.allow_write ? "Allowed" : "Denied"}
                            </Badge>
                          </TableCell>
                          <TableCell>{policy.max_rows.toLocaleString()}</TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-1">
                              <CheckCircle className="w-4 h-4 text-green-500" />
                              <span className="text-sm">Active</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              <Button variant="ghost" size="sm">
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="sm">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="banned" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Banned Keywords & Tables</CardTitle>
                <CardDescription>Manage prohibited SQL keywords and table names</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex space-x-2">
                  <Input
                    placeholder="Add banned keyword or table name"
                    value={newBannedItem}
                    onChange={(e) => setNewBannedItem(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleAddBannedItem()}
                  />
                  <Button onClick={handleAddBannedItem}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>Currently Banned Items:</Label>
                  <div className="flex flex-wrap gap-2">
                    {bannedItems.map((item) => (
                      <Badge key={item} variant="destructive" className="flex items-center space-x-1">
                        <span>{item}</span>
                        <button
                          onClick={() => handleRemoveBannedItem(item)}
                          className="ml-1 hover:bg-red-600 rounded-full p-0.5"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
