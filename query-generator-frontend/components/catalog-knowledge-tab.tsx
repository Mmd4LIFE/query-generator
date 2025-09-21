"use client"

import { useState, useEffect } from "react"
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
  BookOpen, 
  BarChart3, 
  Code, 
  Plus, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Loader2,
  Eye,
  Copy,
  Trash2,
  Edit,
  Filter,
  Search,
  Tag,
  User,
  Calendar
} from "lucide-react"
import { 
  QueryGeneratorAPIClient,
  type Note,
  type Metric,
  type Example,
  type CreateNoteRequest,
  type CreateMetricRequest,
  type CreateExampleRequest,
  type ApprovalRequest
} from "@/lib/api-client"

interface CatalogKnowledgeTabProps {
  catalogId: string
  catalogName: string
  catalogEngine: string
  api: QueryGeneratorAPIClient
  userPermissions: {
    canCreateKnowledge: boolean
    canApproveKnowledge: boolean
  }
}

export function CatalogKnowledgeTab({ 
  catalogId, 
  catalogName, 
  catalogEngine,
  api, 
  userPermissions 
}: CatalogKnowledgeTabProps) {
  // State for all knowledge types
  const [notes, setNotes] = useState<Note[]>([])
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [examples, setExamples] = useState<Example[]>([])
  
  // Loading states
  const [isLoadingNotes, setIsLoadingNotes] = useState(false)
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false)
  const [isLoadingExamples, setIsLoadingExamples] = useState(false)
  
  // Dialog states
  const [isNoteDialogOpen, setIsNoteDialogOpen] = useState(false)
  const [isMetricDialogOpen, setIsMetricDialogOpen] = useState(false)
  const [isExampleDialogOpen, setIsExampleDialogOpen] = useState(false)
  
  // Form states for creating new items
  const [newNote, setNewNote] = useState<Omit<CreateNoteRequest, 'catalog_id'>>({
    title: '',
    content: '',
    tags: []
  })
  const [newMetric, setNewMetric] = useState<Omit<CreateMetricRequest, 'catalog_id'>>({
    name: '',
    description: '',
    expression: '',
    tags: []
  })
  const [newExample, setNewExample] = useState<Omit<CreateExampleRequest, 'catalog_id'>>({
    title: '',
    description: '',
    sql_snippet: '',
    engine: catalogEngine,
    tags: []
  })
  
  // Filter states
  const [noteStatusFilter, setNoteStatusFilter] = useState<string>('all')
  const [metricStatusFilter, setMetricStatusFilter] = useState<string>('all')
  const [exampleStatusFilter, setExampleStatusFilter] = useState<string>('all')
  
  // Error states
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    loadAllKnowledge()
  }, [catalogId])

  const loadAllKnowledge = async () => {
    await Promise.all([
      loadNotes(),
      loadMetrics(),
      loadExamples()
    ])
  }

  const loadNotes = async () => {
    setIsLoadingNotes(true)
    try {
      console.log('📝 Loading notes for catalog:', catalogId)
      const notesData = await api.getNotes(catalogId)
      console.log('📝 Notes loaded:', notesData)
      setNotes(notesData)
    } catch (err: any) {
      console.error('❌ Failed to load notes:', err)
    } finally {
      setIsLoadingNotes(false)
    }
  }

  const loadMetrics = async () => {
    setIsLoadingMetrics(true)
    try {
      console.log('📊 Loading metrics for catalog:', catalogId)
      const metricsData = await api.getMetrics(catalogId)
      console.log('📊 Metrics loaded:', metricsData)
      setMetrics(metricsData)
    } catch (err: any) {
      console.error('❌ Failed to load metrics:', err)
    } finally {
      setIsLoadingMetrics(false)
    }
  }

  const loadExamples = async () => {
    setIsLoadingExamples(true)
    try {
      console.log('💡 Loading examples for catalog:', catalogId)
      const examplesData = await api.getExamples(catalogId)
      console.log('💡 Examples loaded:', examplesData)
      setExamples(examplesData)
    } catch (err: any) {
      console.error('❌ Failed to load examples:', err)
    } finally {
      setIsLoadingExamples(false)
    }
  }

  // Helper functions
  const parseTagsInput = (input: string): string[] => {
    return input.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
  }

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString()
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'approved': return 'default'
      case 'pending': return 'secondary'
      case 'rejected': return 'destructive'
      default: return 'outline'
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }

  // Create handlers
  const handleCreateNote = async () => {
    if (!newNote.title.trim() || !newNote.content.trim()) {
      setError("Please fill in all required fields")
      return
    }

    setIsSubmitting(true)
    setError("")

    try {
      await api.createNote({
        ...newNote,
        catalog_id: catalogId
      })
      
      setNewNote({ title: '', content: '', tags: [] })
      setIsNoteDialogOpen(false)
      await loadNotes()
    } catch (err: any) {
      setError(err.message || "Failed to create note")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreateMetric = async () => {
    if (!newMetric.name.trim() || !newMetric.description.trim() || !newMetric.expression.trim()) {
      setError("Please fill in all required fields")
      return
    }

    setIsSubmitting(true)
    setError("")

    try {
      await api.createMetric({
        ...newMetric,
        catalog_id: catalogId
      })
      
      setNewMetric({ name: '', description: '', expression: '', tags: [] })
      setIsMetricDialogOpen(false)
      await loadMetrics()
    } catch (err: any) {
      setError(err.message || "Failed to create metric")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreateExample = async () => {
    if (!newExample.title.trim() || !newExample.description.trim() || !newExample.sql_snippet.trim()) {
      setError("Please fill in all required fields")
      return
    }

    setIsSubmitting(true)
    setError("")

    try {
      await api.createExample({
        ...newExample,
        catalog_id: catalogId
      })
      
      setNewExample({ 
        title: '', 
        description: '', 
        sql_snippet: '', 
        engine: catalogEngine, 
        tags: [] 
      })
      setIsExampleDialogOpen(false)
      await loadExamples()
    } catch (err: any) {
      setError(err.message || "Failed to create example")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Approval handlers
  const handleApproveNote = async (noteId: string, action: 'approve' | 'reject') => {
    try {
      await api.approveNote(noteId, { action })
      await loadNotes()
    } catch (err: any) {
      setError(err.message || `Failed to ${action} note`)
    }
  }

  const handleApproveMetric = async (metricId: string, action: 'approve' | 'reject') => {
    try {
      await api.approveMetric(metricId, { action })
      await loadMetrics()
    } catch (err: any) {
      setError(err.message || `Failed to ${action} metric`)
    }
  }

  const handleApproveExample = async (exampleId: string, action: 'approve' | 'reject') => {
    try {
      await api.approveExample(exampleId, { action })
      await loadExamples()
    } catch (err: any) {
      setError(err.message || `Failed to ${action} example`)
    }
  }

  // Filter functions
  const filteredNotes = noteStatusFilter === 'all' ? notes : notes.filter(note => note.status === noteStatusFilter)
  const filteredMetrics = metricStatusFilter === 'all' ? metrics : metrics.filter(metric => metric.status === metricStatusFilter)
  const filteredExamples = exampleStatusFilter === 'all' ? examples : examples.filter(example => example.status === exampleStatusFilter)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Knowledge Base</h2>
          <p className="text-muted-foreground">
            Manage domain knowledge for {catalogName} catalog
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="text-sm">
            {catalogEngine}
          </Badge>
          <Badge variant="secondary" className="text-sm">
            {notes.length + metrics.length + examples.length} items
          </Badge>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Knowledge Tabs */}
      <Tabs defaultValue="notes" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="notes" className="flex items-center space-x-2">
            <BookOpen className="w-4 h-4" />
            <span>Notes ({notes.length})</span>
          </TabsTrigger>
          <TabsTrigger value="metrics" className="flex items-center space-x-2">
            <BarChart3 className="w-4 h-4" />
            <span>Metrics ({metrics.length})</span>
          </TabsTrigger>
          <TabsTrigger value="examples" className="flex items-center space-x-2">
            <Code className="w-4 h-4" />
            <span>Examples ({examples.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* Notes Tab */}
        <TabsContent value="notes" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Select value={noteStatusFilter} onValueChange={setNoteStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {userPermissions.canCreateKnowledge && (
              <Dialog open={isNoteDialogOpen} onOpenChange={setIsNoteDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Note
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Create New Note</DialogTitle>
                    <DialogDescription>
                      Add guidelines, best practices, or documentation for this catalog
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="note-title">Title *</Label>
                      <Input
                        id="note-title"
                        value={newNote.title}
                        onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
                        placeholder="e.g., Customer Analysis Guidelines"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="note-content">Content *</Label>
                      <Textarea
                        id="note-content"
                        value={newNote.content}
                        onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                        placeholder="Describe the guidelines, best practices, or important information..."
                        rows={6}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="note-tags">Tags (comma-separated)</Label>
                      <Input
                        id="note-tags"
                        value={newNote.tags.join(', ')}
                        onChange={(e) => setNewNote({ ...newNote, tags: parseTagsInput(e.target.value) })}
                        placeholder="e.g., customers, guidelines, best-practices"
                      />
                    </div>
                    
                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" onClick={() => setIsNoteDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleCreateNote} disabled={isSubmitting}>
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <BookOpen className="w-4 h-4 mr-2" />
                            Create Note
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {isLoadingNotes ? (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
              <p>Loading notes...</p>
            </div>
          ) : filteredNotes.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-muted-foreground">No notes found for this catalog</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredNotes.map((note) => (
                <Card key={note.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{note.title}</CardTitle>
                      <div className="flex items-center space-x-2">
                        <Badge variant={getStatusBadgeVariant(note.status)}>
                          {note.status}
                        </Badge>
                        {userPermissions.canApproveKnowledge && note.status === 'pending' && (
                          <div className="flex space-x-1">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleApproveNote(note.id, 'approve')}
                            >
                              <CheckCircle className="w-4 h-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleApproveNote(note.id, 'reject')}
                            >
                              <AlertCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    <CardDescription>
                      <div className="flex items-center space-x-4 text-sm">
                        <div className="flex items-center space-x-1">
                          <User className="w-3 h-3" />
                          <span>{note.created_by}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDate(note.created_at)}</span>
                        </div>
                      </div>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm mb-3 whitespace-pre-wrap">{note.content}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {note.tags.map((tag, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            <Tag className="w-3 h-3 mr-1" />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(note.content)}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Metrics Tab */}
        <TabsContent value="metrics" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Select value={metricStatusFilter} onValueChange={setMetricStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {userPermissions.canCreateKnowledge && (
              <Dialog open={isMetricDialogOpen} onOpenChange={setIsMetricDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Metric
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Create New Metric</DialogTitle>
                    <DialogDescription>
                      Define a business metric or KPI for this catalog
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="metric-name">Name *</Label>
                      <Input
                        id="metric-name"
                        value={newMetric.name}
                        onChange={(e) => setNewMetric({ ...newMetric, name: e.target.value })}
                        placeholder="e.g., Monthly Active Users"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="metric-description">Description *</Label>
                      <Textarea
                        id="metric-description"
                        value={newMetric.description}
                        onChange={(e) => setNewMetric({ ...newMetric, description: e.target.value })}
                        placeholder="Describe what this metric measures..."
                        rows={3}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="metric-expression">SQL Expression *</Label>
                      <Textarea
                        id="metric-expression"
                        value={newMetric.expression}
                        onChange={(e) => setNewMetric({ ...newMetric, expression: e.target.value })}
                        placeholder="e.g., COUNT(DISTINCT user_id) FROM users WHERE last_login >= NOW() - INTERVAL '30 days'"
                        rows={4}
                        className="font-mono text-sm"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="metric-tags">Tags (comma-separated)</Label>
                      <Input
                        id="metric-tags"
                        value={newMetric.tags.join(', ')}
                        onChange={(e) => setNewMetric({ ...newMetric, tags: parseTagsInput(e.target.value) })}
                        placeholder="e.g., users, kpi, monthly"
                      />
                    </div>
                    
                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" onClick={() => setIsMetricDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleCreateMetric} disabled={isSubmitting}>
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <BarChart3 className="w-4 h-4 mr-2" />
                            Create Metric
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {isLoadingMetrics ? (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
              <p>Loading metrics...</p>
            </div>
          ) : filteredMetrics.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-muted-foreground">No metrics found for this catalog</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredMetrics.map((metric) => (
                <Card key={metric.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{metric.name}</CardTitle>
                      <div className="flex items-center space-x-2">
                        <Badge variant={getStatusBadgeVariant(metric.status)}>
                          {metric.status}
                        </Badge>
                        {userPermissions.canApproveKnowledge && metric.status === 'pending' && (
                          <div className="flex space-x-1">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleApproveMetric(metric.id, 'approve')}
                            >
                              <CheckCircle className="w-4 h-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleApproveMetric(metric.id, 'reject')}
                            >
                              <AlertCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    <CardDescription>
                      <div className="flex items-center space-x-4 text-sm">
                        <div className="flex items-center space-x-1">
                          <User className="w-3 h-3" />
                          <span>{metric.created_by}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDate(metric.created_at)}</span>
                        </div>
                      </div>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm mb-3">{metric.description}</p>
                    <div className="bg-gray-50 p-3 rounded-md mb-3">
                      <pre className="text-sm font-mono whitespace-pre-wrap">{metric.expression}</pre>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {metric.tags.map((tag, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            <Tag className="w-3 h-3 mr-1" />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(metric.expression)}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Examples Tab */}
        <TabsContent value="examples" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Select value={exampleStatusFilter} onValueChange={setExampleStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {userPermissions.canCreateKnowledge && (
              <Dialog open={isExampleDialogOpen} onOpenChange={setIsExampleDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Example
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Create New Example</DialogTitle>
                    <DialogDescription>
                      Add a query example with description for this catalog
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="example-title">Title *</Label>
                      <Input
                        id="example-title"
                        value={newExample.title}
                        onChange={(e) => setNewExample({ ...newExample, title: e.target.value })}
                        placeholder="e.g., Top Customers by Revenue"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="example-description">Description *</Label>
                      <Textarea
                        id="example-description"
                        value={newExample.description}
                        onChange={(e) => setNewExample({ ...newExample, description: e.target.value })}
                        placeholder="Describe what this query does and when to use it..."
                        rows={3}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="example-sql">SQL Query *</Label>
                      <Textarea
                        id="example-sql"
                        value={newExample.sql_snippet}
                        onChange={(e) => setNewExample({ ...newExample, sql_snippet: e.target.value })}
                        placeholder="SELECT * FROM table_name WHERE condition..."
                        rows={8}
                        className="font-mono text-sm"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="example-engine">Database Engine</Label>
                        <Select 
                          value={newExample.engine} 
                          onValueChange={(value) => setNewExample({ ...newExample, engine: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="postgresql">PostgreSQL</SelectItem>
                            <SelectItem value="mysql">MySQL</SelectItem>
                            <SelectItem value="sqlite">SQLite</SelectItem>
                            <SelectItem value="mssql">SQL Server</SelectItem>
                            <SelectItem value="oracle">Oracle</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="example-tags">Tags (comma-separated)</Label>
                        <Input
                          id="example-tags"
                          value={newExample.tags.join(', ')}
                          onChange={(e) => setNewExample({ ...newExample, tags: parseTagsInput(e.target.value) })}
                          placeholder="e.g., customers, revenue, top-performers"
                        />
                      </div>
                    </div>
                    
                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" onClick={() => setIsExampleDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleCreateExample} disabled={isSubmitting}>
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <Code className="w-4 h-4 mr-2" />
                            Create Example
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {isLoadingExamples ? (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
              <p>Loading examples...</p>
            </div>
          ) : filteredExamples.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <Code className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-muted-foreground">No examples found for this catalog</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredExamples.map((example) => (
                <Card key={example.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{example.title}</CardTitle>
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline">{example.engine}</Badge>
                        <Badge variant={getStatusBadgeVariant(example.status)}>
                          {example.status}
                        </Badge>
                        {userPermissions.canApproveKnowledge && example.status === 'pending' && (
                          <div className="flex space-x-1">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleApproveExample(example.id, 'approve')}
                            >
                              <CheckCircle className="w-4 h-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleApproveExample(example.id, 'reject')}
                            >
                              <AlertCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    <CardDescription>
                      <div className="flex items-center space-x-4 text-sm">
                        <div className="flex items-center space-x-1">
                          <User className="w-3 h-3" />
                          <span>{example.created_by}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDate(example.created_at)}</span>
                        </div>
                      </div>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm mb-3">{example.description}</p>
                    <div className="bg-gray-50 p-3 rounded-md mb-3">
                      <pre className="text-sm font-mono whitespace-pre-wrap overflow-x-auto">{example.sql_snippet}</pre>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {example.tags.map((tag, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            <Tag className="w-3 h-3 mr-1" />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(example.sql_snippet)}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
