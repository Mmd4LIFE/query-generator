"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Zap, Copy, CheckCircle, AlertCircle, Loader2 } from "lucide-react"
import type { QueryGeneratorAPI, QueryResult } from "@/lib/api"

interface GenerateQueryPageProps {
  api: QueryGeneratorAPI
}

export function GenerateQueryPage({ api }: GenerateQueryPageProps) {
  const [question, setQuestion] = useState("")
  const [selectedCatalog, setSelectedCatalog] = useState("")
  const [catalogs, setCatalogs] = useState<any[]>([])
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  // Get the engine of the selected catalog
  const getSelectedCatalogEngine = (): string => {
    const catalog = catalogs.find(c => c.id === selectedCatalog)
    return catalog?.engine || 'postgresql'
  }

  useEffect(() => {
    loadCatalogs()
  }, [])

  const loadCatalogs = async () => {
    try {
      const catalogsData = await api.getCatalogs()
      setCatalogs(catalogsData)
      setError("") // Clear any previous errors
    } catch (err: any) {
      console.error("Failed to load catalogs:", err)
      
      // Handle permission errors specifically
      if (err.message && err.message.includes("roles")) {
        setError("Access denied: You need 'admin' or 'data_guy' role to access catalogs. Please contact an administrator to assign you the appropriate role.")
      } else if (err.status === 403) {
        setError("Access denied: Insufficient permissions to view catalogs.")
      } else {
        setError("Failed to load catalogs. Please try again or contact support.")
      }
    }
  }

  const handleGenerateQuery = async () => {
    if (!question.trim()) {
      setError("Please enter a question.")
      return
    }
    if (!selectedCatalog) {
      setError("Please select a catalog.")
      return
    }

    setIsLoading(true)
    setError("")

    try {
      const selectedEngine = getSelectedCatalogEngine()
      console.log('Generating query for catalog:', selectedCatalog, 'engine:', selectedEngine)
      
      const result = await api.generateQuery({
        catalog_id: selectedCatalog,
        engine: selectedEngine,
        question: question.trim(),
      })
      setQueryResult(result)
    } catch (err) {
      setError("Failed to generate query. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = async () => {
    if (queryResult?.sql) {
      await navigator.clipboard.writeText(queryResult.sql)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Query Input Section */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Zap className="w-5 h-5 text-primary" />
                <span>Generate SQL Query</span>
              </CardTitle>
              <CardDescription>Describe what you want to query in natural language</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="catalog">Database Catalog</Label>
                  {selectedCatalog && (
                    <Badge variant="secondary" className="text-xs">
                      Engine: {getSelectedCatalogEngine()}
                    </Badge>
                  )}
                </div>
                <Select value={selectedCatalog} onValueChange={setSelectedCatalog}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a catalog" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogs.map((catalog) => (
                      <SelectItem key={catalog.id} value={catalog.id}>
                        <div className="flex items-center justify-between w-full">
                          <span>{catalog.catalog_name} - {catalog.description}</span>
                          <Badge variant="outline" className="ml-2 text-xs">
                            {catalog.engine}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="question">Your Question</Label>
                <Textarea
                  id="question"
                  placeholder="e.g., Show me the top 10 customers by total order amount"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button onClick={handleGenerateQuery} className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating Query...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Generate SQL Query
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Query Results */}
          {queryResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Generated Query</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyToClipboard}
                    className="flex items-center space-x-1 bg-transparent"
                  >
                    {copied ? (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="sql" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="sql">SQL Query</TabsTrigger>
                    <TabsTrigger value="explanation">Explanation</TabsTrigger>
                    <TabsTrigger value="validation">Validation</TabsTrigger>
                  </TabsList>

                  <TabsContent value="sql" className="space-y-4">
                    <div className="bg-muted p-4 rounded-lg">
                      <pre className="text-sm font-mono whitespace-pre-wrap text-foreground">{queryResult.sql}</pre>
                    </div>
                  </TabsContent>

                  <TabsContent value="explanation" className="space-y-4">
                    <p className="text-sm text-muted-foreground leading-relaxed">{queryResult.explanation}</p>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="font-medium">Tables Used:</h4>
                      <div className="flex flex-wrap gap-2">
                        {queryResult.validation.parsed_tables.map((table) => (
                          <Badge key={table} variant="outline">
                            {table}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h4 className="font-medium">Columns Used:</h4>
                      <div className="flex flex-wrap gap-2">
                        {queryResult.validation.parsed_columns.map((column) => (
                          <Badge key={column} variant="secondary">
                            {column}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="validation" className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        {queryResult.validation.syntax_valid ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-red-500" />
                        )}
                        <span className="text-sm font-medium">
                          Syntax {queryResult.validation.syntax_valid ? "Valid" : "Invalid"}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium">
                          Write Access: {queryResult.policy.allow_write ? "Allowed" : "Denied"}
                        </span>
                      </div>

                      {queryResult.policy.default_limit_applied && (
                        <div className="text-sm text-muted-foreground">• Default row limit applied for safety</div>
                      )}

                      {queryResult.validation.warnings.length > 0 && (
                        <div className="space-y-1">
                          <h5 className="text-sm font-medium text-yellow-600">Warnings:</h5>
                          {queryResult.validation.warnings.map((warning, i) => (
                            <div key={i} className="text-sm text-yellow-600">
                              • {warning}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Example Queries</CardTitle>
              <CardDescription>Try these sample questions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Button
                  variant="ghost"
                  className="w-full text-left h-auto p-3 text-wrap"
                  onClick={() => setQuestion("Show me the top 10 customers by total order amount")}
                >
                  <div className="text-sm">"Show me the top 10 customers by total order amount"</div>
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-left h-auto p-3 text-wrap"
                  onClick={() => setQuestion("What was the monthly revenue trend for the last 6 months?")}
                >
                  <div className="text-sm">"What was the monthly revenue trend for the last 6 months?"</div>
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-left h-auto p-3 text-wrap"
                  onClick={() => setQuestion("Find customers who haven't placed an order in the last 30 days")}
                >
                  <div className="text-sm">"Find customers who haven't placed an order in the last 30 days"</div>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
