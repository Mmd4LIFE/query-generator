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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Shield, Plus, X, Save, Loader2, AlertTriangle, CheckCircle2, Lock, Database } from "lucide-react"
import type { QueryGeneratorAPI, SecurityPolicy, UpdatePolicyRequest } from "@/lib/api"

interface PolicyDialogProps {
  api: QueryGeneratorAPI
  catalogId: string
  catalogName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PolicyDialog({ api, catalogId, catalogName, open, onOpenChange }: PolicyDialogProps) {
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  
  // Form state
  const [allowWrite, setAllowWrite] = useState(false)
  const [defaultLimit, setDefaultLimit] = useState<number>(1000)
  const [maxRowsReturned, setMaxRowsReturned] = useState<number | null>(null)
  const [piiMaskingEnabled, setPiiMaskingEnabled] = useState(false)
  const [bannedTables, setBannedTables] = useState<string[]>([])
  const [bannedColumns, setBannedColumns] = useState<string[]>([])
  const [bannedSchemas, setBannedSchemas] = useState<string[]>([])
  const [piiTags, setPiiTags] = useState<string[]>([])
  const [allowedFunctions, setAllowedFunctions] = useState<string[]>([])
  const [blockedFunctions, setBlockedFunctions] = useState<string[]>([])
  
  // Input state for adding items
  const [newBannedTable, setNewBannedTable] = useState("")
  const [newBannedColumn, setNewBannedColumn] = useState("")
  const [newBannedSchema, setNewBannedSchema] = useState("")
  const [newPiiTag, setNewPiiTag] = useState("")
  const [newAllowedFunction, setNewAllowedFunction] = useState("")
  const [newBlockedFunction, setNewBlockedFunction] = useState("")

  useEffect(() => {
    if (open) {
      loadPolicy()
    }
  }, [open, catalogId])

  const loadPolicy = async () => {
    setIsLoading(true)
    setError("")
    setSuccess(false)
    
    try {
      const policyData = await api.getPolicy(catalogId)
      setPolicy(policyData)
      
      // Populate form fields
      setAllowWrite(policyData.allow_write)
      setDefaultLimit(policyData.default_limit || 1000)
      setMaxRowsReturned(policyData.max_rows_returned)
      setPiiMaskingEnabled(policyData.pii_masking_enabled)
      setBannedTables(policyData.banned_tables || [])
      setBannedColumns(policyData.banned_columns || [])
      setBannedSchemas(policyData.banned_schemas || [])
      setPiiTags(policyData.pii_tags || [])
      setAllowedFunctions(policyData.allowed_functions || [])
      setBlockedFunctions(policyData.blocked_functions || [])
    } catch (err: any) {
      // If policy doesn't exist (404), use defaults
      if (err.status === 404) {
        console.log("No policy found, using defaults")
        setAllowWrite(false)
        setDefaultLimit(1000)
        setMaxRowsReturned(null)
        setPiiMaskingEnabled(false)
        setBannedTables([])
        setBannedColumns([])
        setBannedSchemas([])
        setPiiTags([])
        setAllowedFunctions([])
        setBlockedFunctions([])
      } else {
        setError(err.message || "Failed to load policy")
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError("")
    setSuccess(false)
    
    try {
      const updateData: UpdatePolicyRequest = {
        allow_write: allowWrite,
        default_limit: defaultLimit,
        max_rows_returned: maxRowsReturned,
        pii_masking_enabled: piiMaskingEnabled,
        banned_tables: bannedTables,
        banned_columns: bannedColumns,
        banned_schemas: bannedSchemas,
        pii_tags: piiTags,
        allowed_functions: allowedFunctions.length > 0 ? allowedFunctions : null,
        blocked_functions: blockedFunctions.length > 0 ? blockedFunctions : null,
      }
      
      const updatedPolicy = await api.updatePolicy(catalogId, updateData)
      setPolicy(updatedPolicy)
      setSuccess(true)
      
      setTimeout(() => {
        setSuccess(false)
      }, 3000)
    } catch (err: any) {
      setError(err.message || "Failed to save policy")
    } finally {
      setIsSaving(false)
    }
  }

  const addItem = (
    value: string,
    setState: React.Dispatch<React.SetStateAction<string[]>>,
    clearInput: () => void
  ) => {
    const trimmed = value.trim()
    if (trimmed) {
      setState(prev => {
        if (!prev.includes(trimmed)) {
          return [...prev, trimmed]
        }
        return prev
      })
      clearInput()
    }
  }

  const removeItem = (
    value: string,
    setState: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setState(prev => prev.filter(item => item !== value))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <span>Security Policy: {catalogName}</span>
          </DialogTitle>
          <DialogDescription>
            Configure security rules and access controls for this catalog. 
            Policies are enforced during query generation to ensure safe SQL execution.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-8">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
              <p className="text-muted-foreground">Loading policy...</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-2">
            <Tabs defaultValue="basic" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="basic">Basic Settings</TabsTrigger>
                <TabsTrigger value="restrictions">Restrictions</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-4 mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center space-x-2">
                      <Lock className="w-4 h-4" />
                      <span>Query Safety</span>
                    </CardTitle>
                    <CardDescription>
                      Core security settings that apply to all generated queries
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border">
                      <div className="space-y-1">
                        <Label className="text-base font-semibold">Allow Write Operations</Label>
                        <p className="text-sm text-muted-foreground">
                          Enable INSERT, UPDATE, DELETE, and other write commands
                        </p>
                        {!allowWrite && (
                          <Badge variant="secondary" className="mt-2">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Read-only mode (Recommended)
                          </Badge>
                        )}
                      </div>
                      <Switch
                        checked={allowWrite}
                        onCheckedChange={setAllowWrite}
                      />
                    </div>

                    <div className="space-y-3">
                      <Label htmlFor="default-limit" className="text-base font-semibold">
                        Default Row Limit
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically add LIMIT clause to SELECT queries without one
                      </p>
                      <Input
                        id="default-limit"
                        type="number"
                        min="0"
                        value={defaultLimit}
                        onChange={(e) => setDefaultLimit(Math.max(0, parseInt(e.target.value) || 0))}
                        className="max-w-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        Recommended: 1000 rows. Set to 0 to disable automatic LIMIT.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <Label htmlFor="max-rows" className="text-base font-semibold">
                        Maximum Rows Returned
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Hard limit on query results (optional)
                      </p>
                      <Input
                        id="max-rows"
                        type="number"
                        min="0"
                        placeholder="No limit"
                        value={maxRowsReturned || ""}
                        onChange={(e) => {
                          const val = e.target.value
                          setMaxRowsReturned(val ? Math.max(0, parseInt(val) || 0) : null)
                        }}
                        className="max-w-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave empty for no maximum. This overrides user-specified LIMIT if exceeded.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="restrictions" className="space-y-4 mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Banned Items</CardTitle>
                    <CardDescription>
                      Prevent access to specific database objects
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Banned Tables */}
                    <div className="space-y-3">
                      <Label className="text-base font-semibold">Banned Tables</Label>
                      <p className="text-sm text-muted-foreground">
                        Tables that cannot be accessed in any query
                      </p>
                      <div className="flex space-x-2">
                        <Input
                          placeholder="e.g., user_passwords"
                          value={newBannedTable}
                          onChange={(e) => setNewBannedTable(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === "Enter") {
                              addItem(newBannedTable, setBannedTables, () => setNewBannedTable(""))
                            }
                          }}
                        />
                        <Button
                          onClick={() => addItem(newBannedTable, setBannedTables, () => setNewBannedTable(""))}
                          size="sm"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                      {bannedTables.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {bannedTables.map((table) => (
                            <Badge key={table} variant="destructive" className="flex items-center space-x-1">
                              <span>{table}</span>
                              <button
                                onClick={() => removeItem(table, setBannedTables)}
                                className="ml-1 hover:bg-red-700 rounded-full"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Banned Columns */}
                    <div className="space-y-3">
                      <Label className="text-base font-semibold">Banned Columns</Label>
                      <p className="text-sm text-muted-foreground">
                        Column names that cannot be accessed in any query
                      </p>
                      <div className="flex space-x-2">
                        <Input
                          placeholder="e.g., password, ssn"
                          value={newBannedColumn}
                          onChange={(e) => setNewBannedColumn(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === "Enter") {
                              addItem(newBannedColumn, setBannedColumns, () => setNewBannedColumn(""))
                            }
                          }}
                        />
                        <Button
                          onClick={() => addItem(newBannedColumn, setBannedColumns, () => setNewBannedColumn(""))}
                          size="sm"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                      {bannedColumns.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {bannedColumns.map((column) => (
                            <Badge key={column} variant="destructive" className="flex items-center space-x-1">
                              <span>{column}</span>
                              <button
                                onClick={() => removeItem(column, setBannedColumns)}
                                className="ml-1 hover:bg-red-700 rounded-full"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Banned Schemas */}
                    <div className="space-y-3">
                      <Label className="text-base font-semibold">Banned Schemas</Label>
                      <p className="text-sm text-muted-foreground">
                        Database schemas that cannot be accessed
                      </p>
                      <div className="flex space-x-2">
                        <Input
                          placeholder="e.g., internal, admin"
                          value={newBannedSchema}
                          onChange={(e) => setNewBannedSchema(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === "Enter") {
                              addItem(newBannedSchema, setBannedSchemas, () => setNewBannedSchema(""))
                            }
                          }}
                        />
                        <Button
                          onClick={() => addItem(newBannedSchema, setBannedSchemas, () => setNewBannedSchema(""))}
                          size="sm"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                      {bannedSchemas.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {bannedSchemas.map((schema) => (
                            <Badge key={schema} variant="destructive" className="flex items-center space-x-1">
                              <span>{schema}</span>
                              <button
                                onClick={() => removeItem(schema, setBannedSchemas)}
                                className="ml-1 hover:bg-red-700 rounded-full"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="advanced" className="space-y-4 mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">PII Protection</CardTitle>
                    <CardDescription>
                      Protect personally identifiable information
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border">
                      <div className="space-y-1">
                        <Label className="text-base font-semibold">Enable PII Masking</Label>
                        <p className="text-sm text-muted-foreground">
                          Automatically mask sensitive columns in results
                        </p>
                      </div>
                      <Switch
                        checked={piiMaskingEnabled}
                        onCheckedChange={setPiiMaskingEnabled}
                      />
                    </div>

                    <div className="space-y-3">
                      <Label className="text-base font-semibold">PII Column Tags</Label>
                      <p className="text-sm text-muted-foreground">
                        Column names that contain PII and should be masked
                      </p>
                      <div className="flex space-x-2">
                        <Input
                          placeholder="e.g., email, phone, address"
                          value={newPiiTag}
                          onChange={(e) => setNewPiiTag(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === "Enter") {
                              addItem(newPiiTag, setPiiTags, () => setNewPiiTag(""))
                            }
                          }}
                        />
                        <Button
                          onClick={() => addItem(newPiiTag, setPiiTags, () => setNewPiiTag(""))}
                          size="sm"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                      {piiTags.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {piiTags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="flex items-center space-x-1">
                              <span>{tag}</span>
                              <button
                                onClick={() => removeItem(tag, setPiiTags)}
                                className="ml-1 hover:bg-slate-400 rounded-full"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Function Restrictions</CardTitle>
                    <CardDescription>
                      Control which SQL functions can be used (optional)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Blocked Functions */}
                    <div className="space-y-3">
                      <Label className="text-base font-semibold">Blocked Functions</Label>
                      <p className="text-sm text-muted-foreground">
                        SQL functions that cannot be used
                      </p>
                      <div className="flex space-x-2">
                        <Input
                          placeholder="e.g., EXEC, xp_cmdshell"
                          value={newBlockedFunction}
                          onChange={(e) => setNewBlockedFunction(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === "Enter") {
                              addItem(newBlockedFunction, setBlockedFunctions, () => setNewBlockedFunction(""))
                            }
                          }}
                        />
                        <Button
                          onClick={() => addItem(newBlockedFunction, setBlockedFunctions, () => setNewBlockedFunction(""))}
                          size="sm"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                      {blockedFunctions.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {blockedFunctions.map((func) => (
                            <Badge key={func} variant="destructive" className="flex items-center space-x-1">
                              <span>{func}</span>
                              <button
                                onClick={() => removeItem(func, setBlockedFunctions)}
                                className="ml-1 hover:bg-red-700 rounded-full"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Allowed Functions */}
                    <div className="space-y-3">
                      <Label className="text-base font-semibold">Allowed Functions (Whitelist)</Label>
                      <p className="text-sm text-muted-foreground">
                        If set, only these functions are allowed. Leave empty to allow all (except blocked).
                      </p>
                      <div className="flex space-x-2">
                        <Input
                          placeholder="e.g., COUNT, SUM, AVG"
                          value={newAllowedFunction}
                          onChange={(e) => setNewAllowedFunction(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === "Enter") {
                              addItem(newAllowedFunction, setAllowedFunctions, () => setNewAllowedFunction(""))
                            }
                          }}
                        />
                        <Button
                          onClick={() => addItem(newAllowedFunction, setAllowedFunctions, () => setNewAllowedFunction(""))}
                          size="sm"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                      {allowedFunctions.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {allowedFunctions.map((func) => (
                            <Badge key={func} variant="outline" className="flex items-center space-x-1">
                              <span>{func}</span>
                              <button
                                onClick={() => removeItem(func, setAllowedFunctions)}
                                className="ml-1 hover:bg-slate-200 rounded-full"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Status Messages */}
            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert className="mt-4 border-green-500 bg-green-50 dark:bg-green-950">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800 dark:text-green-200">
                  Policy updated successfully! Changes will be applied to all new queries.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex-shrink-0 flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {policy ? (
              <span>Current policy created by {policy.created_by}</span>
            ) : (
              <span>No policy exists - will create with defaults</span>
            )}
          </div>
          <div className="flex space-x-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Close
            </Button>
            <Button onClick={handleSave} disabled={isSaving || isLoading}>
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Policy
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

