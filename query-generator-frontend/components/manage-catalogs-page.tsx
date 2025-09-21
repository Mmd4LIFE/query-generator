"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { 
  Database, 
  Plus, 
  Upload, 
  Download, 
  FileText, 
  CheckCircle, 
  AlertCircle, 
  Loader2,
  Copy,
  Eye,
  RefreshCw,
  ArrowLeft,
  BookOpen
} from "lucide-react"
import { QueryGeneratorAPI } from "@/lib/api"
import { 
  DATABASE_ENGINES, 
  parseColumnsCSV, 
  convertColumnsToCatalogJSON, 
  generateSampleCSV,
  validateColumnsCSV,
  type ColumnInfo,
  type DatabaseEngine
} from "@/lib/catalog-utils"
import { CatalogKnowledgeTab } from "./catalog-knowledge-tab"

interface ManageCatalogsPageProps {
  api: QueryGeneratorAPI
  userPermissions?: {
    canCreateKnowledge: boolean
    canApproveKnowledge: boolean
  }
}

export function ManageCatalogsPage({ api, userPermissions }: ManageCatalogsPageProps) {
  const [catalogs, setCatalogs] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Catalog details view state
  const [selectedCatalog, setSelectedCatalog] = useState<any | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'details'>('list')
  
  // Form state
  const [selectedEngine, setSelectedEngine] = useState<string>('postgresql')
  const [catalogName, setCatalogName] = useState('')
  const [description, setDescription] = useState('')
  const [csvContent, setCsvContent] = useState('')
  const [parsedColumns, setParsedColumns] = useState<ColumnInfo[]>([])
  const [previewJson, setPreviewJson] = useState<any>(null)
  const [reindexingCatalog, setReindexingCatalog] = useState<string | null>(null)
  
  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadCatalogs()
  }, [])

  const loadCatalogs = async () => {
    setIsLoading(true)
    setError("")
    try {
      const catalogsData = await api.getCatalogs()
      console.log('Loaded catalogs:', catalogsData)
      setCatalogs(catalogsData)
    } catch (err: any) {
      console.error('Failed to load catalogs:', err)
      setError(err.message || "Failed to load catalogs")
    } finally {
      setIsLoading(false)
    }
  }

  const handleEngineChange = (engine: string) => {
    setSelectedEngine(engine)
    // Clear CSV when engine changes
    setCsvContent('')
    setParsedColumns([])
    setPreviewJson(null)
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        setCsvContent(content)
        processCsvContent(content)
      }
      reader.readAsText(file)
    }
  }

  const processCsvContent = (content: string) => {
    try {
      console.log('Processing CSV content, length:', content.length)
      console.log('First few lines:', content.split('\n').slice(0, 3))
      
      // Validate CSV format
      const validation = validateColumnsCSV(content)
      console.log('CSV validation result:', validation)
      
      if (!validation.valid) {
        setError(`CSV validation errors: ${validation.errors.join(' | ')}`)
        setParsedColumns([])
        setPreviewJson(null)
        return
      }

      // Parse CSV
      const columns = parseColumnsCSV(content)
      console.log('Parsed columns count:', columns.length)
      console.log('Sample columns:', columns.slice(0, 3))
      setParsedColumns(columns)

      // Generate preview JSON
      if (catalogName && columns.length > 0) {
        const catalogJson = convertColumnsToCatalogJSON(columns, catalogName, selectedEngine, description)
        setPreviewJson(catalogJson)
        console.log('Generated catalog JSON preview')
      }

      setError("")
    } catch (err: any) {
      console.error('CSV processing error:', err)
      setError(`Failed to process CSV: ${err.message}`)
      setParsedColumns([])
      setPreviewJson(null)
    }
  }

  const handleCatalogNameChange = (name: string) => {
    setCatalogName(name)
    if (parsedColumns.length > 0) {
      const catalogJson = convertColumnsToCatalogJSON(parsedColumns, name, selectedEngine, description)
      setPreviewJson(catalogJson)
    }
  }

  const handleDescriptionChange = (desc: string) => {
    setDescription(desc)
    if (parsedColumns.length > 0) {
      const catalogJson = convertColumnsToCatalogJSON(parsedColumns, catalogName, selectedEngine, desc)
      setPreviewJson(catalogJson)
    }
  }

  const downloadSampleCSV = () => {
    const sampleCsv = generateSampleCSV(selectedEngine)
    const blob = new Blob([sampleCsv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sample_${selectedEngine}_columns.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const copyQueryToClipboard = async () => {
    const engine = DATABASE_ENGINES.find(e => e.value === selectedEngine)
    if (engine) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(engine.informationSchemaQuery)
          console.log('Query copied to clipboard!')
        } else {
          // Fallback for browsers without clipboard API
          console.log('Clipboard not available. Query:', engine.informationSchemaQuery)
          alert('Clipboard not available. Check browser console for the query.')
        }
      } catch (error) {
        console.error('Failed to copy query:', error)
        console.log('Query to copy:', engine.informationSchemaQuery)
        alert('Copy failed. Check browser console for the query.')
      }
    }
  }

  const handleSubmit = async () => {
    if (!catalogName.trim()) {
      setError("Please enter a catalog name")
      return
    }

    if (!previewJson) {
      setError("Please upload and process a valid CSV file")
      return
    }

    setIsSubmitting(true)
    setError("")

    try {
      // Step 1: Create catalog
      const createdCatalog = await api.createCatalog(previewJson)
      console.log("Created catalog:", catalogName, "ID:", createdCatalog.id)
      
      // Step 2: Reindex catalog to create embeddings
      console.log("Reindexing catalog for AI embeddings...")
      try {
        await api.reindexCatalog(createdCatalog.id, false)
        console.log("Catalog reindexed successfully")
      } catch (reindexError) {
        console.warn("Catalog created but reindexing failed:", reindexError)
        setError("Catalog created successfully, but reindexing failed. You may need to reindex manually for optimal AI performance.")
      }
      
      // Reset form
      setCatalogName('')
      setDescription('')
      setCsvContent('')
      setParsedColumns([])
      setPreviewJson(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      
      setIsDialogOpen(false)
      await loadCatalogs()
    } catch (err: any) {
      console.error('Failed to create catalog:', err)
      
      let errorMessage = "Failed to create catalog"
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
      setIsSubmitting(false)
    }
  }

  const handleReindex = async (catalogId: string, catalogName: string) => {
    setReindexingCatalog(catalogId)
    setError("")
    
    try {
      await api.reindexCatalog(catalogId, false)
      console.log("Catalog reindexed successfully:", catalogName)
      // You could add a success toast here
    } catch (err: any) {
      console.error('Failed to reindex catalog:', err)
      setError(`Failed to reindex catalog "${catalogName}": ${err.message || 'Unknown error'}`)
    } finally {
      setReindexingCatalog(null)
    }
  }

  const handleViewCatalog = (catalog: any) => {
    console.log('Viewing catalog:', catalog)
    setSelectedCatalog(catalog)
    setViewMode('details')
    console.log('View mode set to details, selected catalog:', catalog.catalog_name)
  }

  const handleBackToList = () => {
    setSelectedCatalog(null)
    setViewMode('list')
  }

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString()
  }

  const selectedEngineData = DATABASE_ENGINES.find(e => e.value === selectedEngine)

  // If viewing catalog details, show the knowledge tab
  console.log('Current viewMode:', viewMode, 'selectedCatalog:', selectedCatalog?.catalog_name)
  
  if (viewMode === 'details' && selectedCatalog) {
    console.log('Rendering catalog details view for:', selectedCatalog.catalog_name)
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="space-y-6">
          {/* Back navigation */}
          <div className="flex items-center space-x-4">
            <Button 
              variant="outline" 
              onClick={handleBackToList}
              className="flex items-center space-x-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Catalogs</span>
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-foreground">{selectedCatalog.catalog_name}</h1>
              <p className="text-muted-foreground">{selectedCatalog.description}</p>
            </div>
          </div>

          {/* Catalog Details Tabs */}
          <Tabs defaultValue="knowledge" className="w-full">
            <TabsList>
              <TabsTrigger value="knowledge" className="flex items-center space-x-2">
                <BookOpen className="w-4 h-4" />
                <span>Knowledge Base</span>
              </TabsTrigger>
              <TabsTrigger value="schema" className="flex items-center space-x-2">
                <Database className="w-4 h-4" />
                <span>Schema</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="knowledge">
              <CatalogKnowledgeTab
                catalogId={selectedCatalog.id}
                catalogName={selectedCatalog.catalog_name}
                catalogEngine={selectedCatalog.engine}
                api={api}
                userPermissions={{
                  canCreateKnowledge: userPermissions?.canCreateKnowledge ?? true,
                  canApproveKnowledge: userPermissions?.canApproveKnowledge ?? false,
                }}
              />
            </TabsContent>

            <TabsContent value="schema">
              <Card>
                <CardHeader>
                  <CardTitle>Schema Information</CardTitle>
                  <CardDescription>Database structure and metadata</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">Engine</Label>
                        <Badge variant="outline" className="mt-1">{selectedCatalog.engine}</Badge>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Status</Label>
                        <Badge 
                          variant={selectedCatalog.is_active ? "default" : "secondary"}
                          className="mt-1"
                        >
                          {selectedCatalog.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                    
                    {selectedCatalog.object_counts && (
                      <div className="grid grid-cols-3 gap-4">
                        <div className="text-center p-4 bg-blue-50 rounded-lg">
                          <div className="text-2xl font-bold text-blue-600">
                            {selectedCatalog.object_counts.schema || 0}
                          </div>
                          <div className="text-sm text-blue-800">Schemas</div>
                        </div>
                        <div className="text-center p-4 bg-green-50 rounded-lg">
                          <div className="text-2xl font-bold text-green-600">
                            {selectedCatalog.object_counts.table || 0}
                          </div>
                          <div className="text-sm text-green-800">Tables</div>
                        </div>
                        <div className="text-center p-4 bg-purple-50 rounded-lg">
                          <div className="text-2xl font-bold text-purple-600">
                            {selectedCatalog.object_counts.column || 0}
                          </div>
                          <div className="text-sm text-purple-800">Columns</div>
                        </div>
                      </div>
                    )}
                    
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Created</Label>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(selectedCatalog.created_at)}
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Last Updated</Label>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(selectedCatalog.updated_at)}
                      </p>
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

  // Default list view
  return (
    <div className="container mx-auto px-6 py-8">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Manage Catalogs</h1>
            <p className="text-muted-foreground">Configure database connections and schemas</p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Catalog
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Catalog</DialogTitle>
                <DialogDescription>
                  Upload your database schema from information_schema.columns CSV export.
                  After creation, the catalog will be automatically indexed for AI query generation.
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-6">
                {/* Step 1: Basic Information */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Step 1: Basic Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="catalog-name">Catalog Name</Label>
                        <Input
                          id="catalog-name"
                          value={catalogName}
                          onChange={(e) => handleCatalogNameChange(e.target.value)}
                          placeholder="e.g., production_ecommerce"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="engine">Database Engine</Label>
                        <Select value={selectedEngine} onValueChange={handleEngineChange}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DATABASE_ENGINES.map((engine) => (
                              <SelectItem key={engine.value} value={engine.value}>
                                {engine.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        value={description}
                        onChange={(e) => handleDescriptionChange(e.target.value)}
                        placeholder="Brief description of this database"
                        rows={2}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Step 2: Schema Export Instructions */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Step 2: Export Database Schema</CardTitle>
                    <CardDescription>
                      Run this query in your {selectedEngineData?.label} database to export column information
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-medium">SQL Query for {selectedEngineData?.label}:</Label>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={copyQueryToClipboard}
                        >
                          <Copy className="w-4 h-4 mr-2" />
                          Copy Query
                        </Button>
                      </div>
                      <pre className="text-sm bg-gray-800 text-green-400 p-3 rounded overflow-x-auto">
                        {selectedEngineData?.informationSchemaQuery}
                      </pre>
                    </div>
                    
                    <div className="flex items-center space-x-4">
                      <Button
                        variant="outline"
                        onClick={downloadSampleCSV}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download Sample CSV
                      </Button>
                      <div className="text-sm text-muted-foreground">
                        Export your query results as CSV and upload below
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Step 3: CSV Upload */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Step 3: Upload Schema CSV</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                      <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          Upload your information_schema.columns CSV export
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          Choose CSV File
                        </Button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </div>
                    </div>

                                         {/* CSV Content Preview */}
                     {csvContent && (
                       <div className="space-y-2">
                         <div className="flex items-center justify-between">
                           <Label>CSV Content Preview (first 5 lines):</Label>
                           <Badge variant="outline">
                             {csvContent.split('\n').length - 1} rows
                           </Badge>
                         </div>
                         <pre className="text-xs bg-gray-50 p-3 rounded max-h-32 overflow-y-auto">
                           {csvContent.split('\n').slice(0, 5).join('\n')}
                         </pre>
                         <div className="text-xs text-muted-foreground">
                           Headers detected: {csvContent.split('\n')[0]?.split(',').length || 0} columns
                         </div>
                       </div>
                     )}
                  </CardContent>
                </Card>

                {/* Step 4: Schema Preview */}
                {parsedColumns.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Step 4: Schema Preview</CardTitle>
                      <CardDescription>
                        Parsed {parsedColumns.length} columns from {new Set(parsedColumns.map(c => `${c.schema_name}.${c.table_name}`)).size} tables
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Tabs defaultValue="summary">
                        <TabsList>
                          <TabsTrigger value="summary">Summary</TabsTrigger>
                          <TabsTrigger value="columns">Columns</TabsTrigger>
                          <TabsTrigger value="json">JSON Preview</TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="summary" className="space-y-4">
                          <div className="grid grid-cols-3 gap-4">
                            <div className="text-center p-4 bg-blue-50 rounded-lg">
                              <div className="text-2xl font-bold text-blue-600">
                                {new Set(parsedColumns.map(c => c.schema_name)).size}
                              </div>
                              <div className="text-sm text-blue-800">Schemas</div>
                            </div>
                            <div className="text-center p-4 bg-green-50 rounded-lg">
                              <div className="text-2xl font-bold text-green-600">
                                {new Set(parsedColumns.map(c => `${c.schema_name}.${c.table_name}`)).size}
                              </div>
                              <div className="text-sm text-green-800">Tables</div>
                            </div>
                            <div className="text-center p-4 bg-purple-50 rounded-lg">
                              <div className="text-2xl font-bold text-purple-600">
                                {parsedColumns.length}
                              </div>
                              <div className="text-sm text-purple-800">Columns</div>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <Label>Tables Found:</Label>
                            <div className="flex flex-wrap gap-2">
                              {Array.from(new Set(parsedColumns.map(c => `${c.schema_name}.${c.table_name}`))).map(table => (
                                <Badge key={table} variant="secondary">
                                  {table}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </TabsContent>
                        
                        <TabsContent value="columns">
                          <div className="max-h-64 overflow-y-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Schema</TableHead>
                                  <TableHead>Table</TableHead>
                                  <TableHead>Column</TableHead>
                                  <TableHead>Type</TableHead>
                                  <TableHead>Nullable</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {parsedColumns.slice(0, 20).map((col, index) => (
                                  <TableRow key={index}>
                                    <TableCell>{col.schema_name}</TableCell>
                                    <TableCell>{col.table_name}</TableCell>
                                    <TableCell className="font-mono">{col.column_name}</TableCell>
                                    <TableCell className="font-mono text-blue-600">{col.data_type}</TableCell>
                                    <TableCell>
                                      <Badge variant={col.is_nullable === 'YES' ? 'secondary' : 'default'}>
                                        {col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            {parsedColumns.length > 20 && (
                              <div className="text-center py-2 text-sm text-muted-foreground">
                                ... and {parsedColumns.length - 20} more columns
                              </div>
                            )}
                          </div>
                        </TabsContent>
                        
                        <TabsContent value="json">
                          <div className="space-y-2">
                            <Label>Generated Catalog JSON:</Label>
                            <pre className="text-xs bg-gray-50 p-3 rounded max-h-64 overflow-y-auto">
                              {previewJson ? JSON.stringify(previewJson, null, 2) : 'Generate preview by entering catalog name'}
                            </pre>
                          </div>
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>
                )}

                {/* Error Display */}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Submit Button */}
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleSubmit} 
                    disabled={!previewJson || isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating & Indexing...
                      </>
                    ) : (
                      <>
                        <Database className="w-4 h-4 mr-2" />
                        Create & Index Catalog
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Error Display */}
        {error && !isDialogOpen && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Catalogs List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Database className="w-5 h-5" />
              <span>Database Catalogs</span>
            </CardTitle>
            <CardDescription>Manage your database connections and schemas</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                <p>Loading catalogs...</p>
              </div>
            ) : catalogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Database className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>No catalogs found. Create your first catalog to get started.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Engine</TableHead>
                    <TableHead>Objects</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalogs.map((catalog) => (
                    <TableRow key={catalog.id}>
                      <TableCell className="font-medium">{catalog.catalog_name}</TableCell>
                      <TableCell>{catalog.description}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{catalog.engine}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {catalog.object_counts ? (
                            <>
                              <div>{catalog.object_counts.table || 0} tables</div>
                              <div className="text-muted-foreground">{catalog.object_counts.column || 0} columns</div>
                            </>
                          ) : (
                            'Unknown'
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={catalog.is_active ? "default" : "secondary"}>
                          {catalog.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(catalog.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            title="View catalog details"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              console.log('Eye button clicked for catalog:', catalog.catalog_name)
                              handleViewCatalog(catalog)
                            }}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleReindex(catalog.id, catalog.catalog_name)}
                            disabled={reindexingCatalog === catalog.id}
                            title="Reindex catalog for AI embeddings"
                          >
                            {reindexingCatalog === catalog.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RefreshCw className="w-4 h-4" />
                            )}
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
      </div>
    </div>
  )
}
