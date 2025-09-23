"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { 
  Database, 
  Copy, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  Sparkles
} from "lucide-react"
import type { QueryGeneratorAPI, QueryResult } from "@/lib/api"

interface QueryGeneratorProps {
  api: QueryGeneratorAPI
}

export function QueryGenerator({ api }: QueryGeneratorProps) {
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
      setError("")
    } catch (err: any) {
      console.error("Failed to load catalogs:", err)
      
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
    <div className="max-w-2xl mx-auto bg-background px-4 sm:px-0">
      {/* Query Input */}
      <Card className="border-0 shadow-none bg-transparent">
        <CardContent className="p-0">
          <div className="flex space-x-3 p-4 sm:p-6">
            {/* Profile Avatar */}
            <div className="flex-shrink-0">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center">
                    <Database className="w-5 h-5 sm:w-6 sm:h-6 text-primary-foreground" />
                  </div>
            </div>
            
            {/* Main Content */}
            <div className="flex-1 min-w-0">
              {/* Catalog Selector */}
              <div className="mb-3">
                <Select value={selectedCatalog} onValueChange={setSelectedCatalog}>
                  <SelectTrigger className="w-auto h-auto p-0 border-0 bg-transparent text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <SelectValue placeholder="Select Database" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogs.map((catalog) => (
                      <SelectItem key={catalog.id} value={catalog.id}>
                        <div className="flex items-center justify-between w-full">
                          <span className="truncate">{catalog.catalog_name}</span>
                          <Badge variant="outline" className="ml-2 text-xs flex-shrink-0">
                            {catalog.engine}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Question Input */}
              <div className="mb-4">
                <Textarea
                  placeholder="What's your data question?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  className="min-h-[100px] sm:min-h-[140px] resize-none border-0 bg-transparent text-lg sm:text-xl placeholder:text-muted-foreground focus-visible:ring-0 p-0 font-normal"
                  rows={3}
                />
              </div>


              {/* Generate Button */}
              <div className="flex justify-end">
                    <Button 
                      onClick={handleGenerateQuery} 
                      disabled={isLoading || !question.trim() || !selectedCatalog}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 sm:px-6 py-2 rounded-full font-semibold disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                    >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      <span className="hidden sm:inline">Generating...</span>
                      <span className="sm:hidden">...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate
                    </>
                  )}
                </Button>
              </div>

              {/* Error Display */}
              {error && (
                <Alert variant="destructive" className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">{error}</AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Query Results */}
      {queryResult && (
        <Card className="mt-4 sm:mt-6 border-0 shadow-none bg-transparent">
          <CardContent className="p-0">
            <div className="flex space-x-3 p-4 sm:p-6">
              {/* Result Avatar */}
              <div className="flex-shrink-0">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-secondary to-accent rounded-full flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-secondary-foreground" />
                  </div>
              </div>
              
              {/* Result Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="font-semibold text-sm">Query Generator</span>
                  <Badge variant="secondary" className="text-xs">
                    {getSelectedCatalogEngine()}
                  </Badge>
                </div>

                <div className="mb-3">
                  <p className="text-xs sm:text-sm text-muted-foreground mb-3">
                    Generated SQL query for: <span className="text-foreground font-medium">"{question}"</span> on <span className="text-foreground font-medium">{catalogs.find(c => c.id === selectedCatalog)?.catalog_name || 'selected'}</span> <Badge variant="outline" className="text-xs ml-1">{getSelectedCatalogEngine()}</Badge> database
                  </p>
                </div>

                <Tabs defaultValue="sql" className="w-full">
                  <TabsList className="grid w-full grid-cols-3 h-7 sm:h-8 mb-4">
                    <TabsTrigger value="sql" className="text-xs px-2">SQL</TabsTrigger>
                    <TabsTrigger value="explanation" className="text-xs px-2">Explanation</TabsTrigger>
                    <TabsTrigger value="validation" className="text-xs px-2">Validation</TabsTrigger>
                  </TabsList>

                  <TabsContent value="sql" className="space-y-3">
                    <div className="bg-muted/50 p-3 sm:p-4 rounded-lg overflow-x-auto border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground">SQL Query</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={copyToClipboard}
                          className="h-6 px-2 text-xs"
                        >
                          {copied ? (
                            <>
                              <CheckCircle className="w-3 h-3 mr-1" />
                              <span className="hidden sm:inline">Copied!</span>
                              <span className="sm:hidden">✓</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 mr-1" />
                              <span className="hidden sm:inline">Copy</span>
                              <span className="sm:hidden">Copy</span>
                            </>
                          )}
                        </Button>
                      </div>
                      <pre className="text-xs font-mono whitespace-pre-wrap text-foreground leading-relaxed overflow-x-auto">
                        {queryResult.sql}
                      </pre>
                    </div>
                  </TabsContent>

                  <TabsContent value="explanation" className="space-y-3">
                    <div className="bg-muted/50 p-3 sm:p-4 rounded-lg border">
                      <p className="text-xs sm:text-sm text-foreground leading-relaxed mb-4">{queryResult.explanation}</p>
                      <Separator className="my-3" />
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-medium text-xs sm:text-sm mb-2">Tables Used:</h4>
                          <div className="flex flex-wrap gap-1">
                            {queryResult.validation.parsed_tables.map((table) => (
                              <Badge key={table} variant="outline" className="text-xs">
                                {table}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h4 className="font-medium text-xs sm:text-sm mb-2">Columns Used:</h4>
                          <div className="flex flex-wrap gap-1">
                            {queryResult.validation.parsed_columns.map((column) => (
                              <Badge key={column} variant="secondary" className="text-xs">
                                {column}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="validation" className="space-y-3">
                    <div className="bg-muted/50 p-3 sm:p-4 rounded-lg border">
                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          {queryResult.validation.syntax_valid ? (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-red-500" />
                          )}
                          <span className="text-xs sm:text-sm font-medium">
                            Syntax {queryResult.validation.syntax_valid ? "Valid" : "Invalid"}
                          </span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <span className="text-xs sm:text-sm font-medium">
                            Write Access: {queryResult.policy.allow_write ? "Allowed" : "Denied"}
                          </span>
                        </div>

                        {queryResult.policy.default_limit_applied && (
                          <div className="text-xs sm:text-sm text-muted-foreground">• Default row limit applied for safety</div>
                        )}

                        {queryResult.validation.warnings.length > 0 && (
                          <div className="space-y-1">
                            <h5 className="text-xs sm:text-sm font-medium text-yellow-600">Warnings:</h5>
                            {queryResult.validation.warnings.map((warning, i) => (
                              <div key={i} className="text-xs sm:text-sm text-yellow-600">
                                • {warning}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>

              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
