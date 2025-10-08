import { config, healthCheck } from './config'

// API Response Types
export interface ApiResponse<T = any> {
  data?: T
  error?: string
  message?: string
  status: number
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  per_page: number
  pages: number
}

// Authentication Types
export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  expires_in?: number
}

export interface UserProfile {
  id: string
  username: string
  email: string
  full_name?: string
  role: string
  is_active: boolean
  created_at: string
  last_login?: string
}

// Catalog Types
export interface Catalog {
  id: string
  catalog_name: string
  engine: string
  description?: string
  version: string
  is_active: boolean
  created_at: string
  updated_at: string
  raw_json: any
}

export interface CreateCatalogRequest {
  engine: string
  catalog_name: string
  version: string
  description?: string
  is_active?: boolean
  raw_json: any
}

// Query Generation Types
export interface GenerateQueryRequest {
  catalog_id: string
  engine: string
  question: string
  constraints?: {
    max_rows?: number
    time_range?: string
    group_by_period?: string
    include_totals?: boolean
    must_include_metrics?: string[]
  }
  include?: {
    schemas?: string[]
    tables?: string[]
    columns?: string[]
  }
}

export interface QueryResult {
  sql: string
  explanation: string
  validation: {
    syntax_valid: boolean
    errors: string[]
    warnings: string[]
    parsed_tables: string[]
    parsed_columns: string[]
  }
  policy: {
    allow_write: boolean
    default_limit_applied: boolean
    banned_items_blocked: string[]
    pii_masking_applied: boolean
    violations: string[]
  }
  context_used: number
  generation_time_ms?: number
  tokens_used?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// Query History Types
export interface QueryHistoryItem {
  id: string
  catalog_id: string
  engine: string
  question: string
  generated_sql?: string
  explanation?: string
  syntax_valid?: boolean
  status: string
  generation_time_ms?: number
  created_at: string
  tokens_used?: number
  // Additional fields for frontend display
  catalog_name?: string
  username?: string
  feedback?: QueryFeedback[]
}

export interface QueryFeedback {
  id: string
  history_id: string
  rating?: number  // 1-5 scale
  comment?: string
  correctness?: number  // 1-5 scale
  completeness?: number  // 1-5 scale
  efficiency?: number  // 1-5 scale
  suggested_sql?: string
  improvement_notes?: string
  created_at: string
  // Additional fields for frontend display
  username?: string
}

export interface SubmitFeedbackRequest {
  query_id: string
  rating?: number  // 1-5 scale
  comment?: string
  correctness?: number  // 1-5 scale
  completeness?: number  // 1-5 scale
  efficiency?: number  // 1-5 scale
  suggested_sql?: string
  improvement_notes?: string
}

// Policy Types
// Uses soft delete pattern:
// - When policy is "updated", old policy is soft-deleted and new policy is created
// - This creates complete audit trail (no updated_by, only created_by and deleted_by)
// - Active policy is where deleted_at IS NULL
export interface SecurityPolicy {
  catalog_id: string
  allow_write: boolean
  default_limit: number | null
  banned_tables: string[]
  banned_columns: string[]
  banned_schemas: string[]
  pii_tags: string[]
  pii_masking_enabled: boolean
  max_rows_returned: number | null
  allowed_functions: string[] | null
  blocked_functions: string[] | null
  settings: Record<string, any>
  created_by: string
}

export interface UpdatePolicyRequest {
  allow_write?: boolean
  default_limit?: number | null
  banned_tables?: string[]
  banned_columns?: string[]
  banned_schemas?: string[]
  pii_tags?: string[]
  pii_masking_enabled?: boolean
  max_rows_returned?: number | null
  allowed_functions?: string[] | null
  blocked_functions?: string[] | null
  settings?: Record<string, any>
}

// Knowledge Management Types
export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  catalog_id: string
  status: 'pending' | 'approved' | 'rejected'
  created_by: string
  created_at: string
  updated_at: string
  approved_by?: string
  approved_at?: string
}

export interface CreateNoteRequest {
  title: string
  content: string
  tags: string[]
  catalog_id: string
}

export interface Metric {
  id: string
  name: string
  description: string
  expression: string
  tags: string[]
  catalog_id: string
  status: 'pending' | 'approved' | 'rejected'
  created_by: string
  created_at: string
  updated_at: string
  approved_by?: string
  approved_at?: string
}

export interface CreateMetricRequest {
  name: string
  description: string
  expression: string
  tags: string[]
  catalog_id: string
}

export interface Example {
  id: string
  title: string
  description: string
  sql_snippet: string
  engine: string
  tags: string[]
  catalog_id: string
  status: 'pending' | 'approved' | 'rejected'
  created_by: string
  created_at: string
  updated_at: string
  approved_by?: string
  approved_at?: string
}

export interface CreateExampleRequest {
  title: string
  description: string
  sql_snippet: string
  engine: string
  tags: string[]
  catalog_id: string
}

export interface ApprovalRequest {
  action: 'approve' | 'reject'
  reason?: string
}

// Custom Error Classes
export class ApiError extends Error {
  constructor(
    public status: number,
    public message: string,
    public details?: any
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class NetworkError extends Error {
  constructor(message: string, public originalError?: Error) {
    super(message)
    this.name = 'NetworkError'
  }
}

export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication failed') {
    super(401, message)
    this.name = 'AuthenticationError'
  }
}

// Professional API Client
export class QueryGeneratorAPIClient {
  private token: string | null = null
  private baseUrl: string
  private demoMode = false

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || config.api.baseUrl
  }

  // Configuration methods
  setBaseUrl(url: string) {
    this.baseUrl = url
  }

  setDemoMode(enabled: boolean) {
    this.demoMode = enabled
    if (enabled) {
      this.token = 'demo-token'
    }
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  isAuthenticated(): boolean {
    return !!this.token
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    return healthCheck(this.baseUrl)
  }

  // HTTP Client with retry logic
  private async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add any additional headers from options
    if (options.headers) {
      Object.assign(headers, options.headers)
    }

    if (this.token && !this.demoMode) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const requestOptions: RequestInit = {
      ...options,
      headers,
      signal: AbortSignal.timeout(config.api.timeout),
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt < config.api.retryAttempts; attempt++) {
      try {
        // Debug logging for login requests
        if (endpoint === '/auth/login') {
          console.log('🌐 Login request:', {
            url,
            method: requestOptions.method,
            headers: requestOptions.headers,
            bodyLength: requestOptions.body?.toString().length || 0
          })
        }
        
        const response = await fetch(url, requestOptions)

        if (!response.ok) {
          if (response.status === 401) {
            this.token = null // Clear invalid token
            
            // Log 401 errors for debugging
            try {
              const errorData = await response.json()
              console.error('🚫 401 Authentication Error:', errorData)
            } catch (e) {
              console.error('🚫 401 Authentication Error (no JSON response)')
            }
            
            throw new AuthenticationError()
          }

          let errorMessage = `HTTP ${response.status}: ${response.statusText}`
          let errorData = null
          
          try {
            errorData = await response.json()
            
            if (errorData.detail) {
              if (Array.isArray(errorData.detail)) {
                // FastAPI validation errors
                errorMessage = errorData.detail.map((item: any) => {
                  if (typeof item === 'string') return item
                  return item.msg || item.message || JSON.stringify(item)
                }).join(', ')
              } else if (typeof errorData.detail === 'string') {
                errorMessage = errorData.detail
              } else {
                errorMessage = JSON.stringify(errorData.detail)
              }
            } else if (errorData.message) {
              errorMessage = errorData.message
            }
          } catch {
            // Ignore JSON parsing errors for error responses
          }

          const apiError = new ApiError(response.status, errorMessage)
          // Attach the original error data for debugging
          if (errorData) {
            (apiError as any).details = errorData
          }
          throw apiError
        }

        // Handle different response types
        const contentType = response.headers.get('content-type')
        if (contentType?.includes('application/json')) {
          return await response.json()
        } else {
          return (await response.text()) as unknown as T
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (error instanceof ApiError || error instanceof AuthenticationError) {
          throw error // Don't retry API errors
        }

        if (attempt < config.api.retryAttempts - 1) {
          await new Promise(resolve => 
            setTimeout(resolve, config.api.retryDelay * (attempt + 1))
          )
          continue
        }
      }
    }

    throw new NetworkError(
      `Network request failed after ${config.api.retryAttempts} attempts`,
      lastError || undefined
    )
  }

  // Token management
  setToken(token: string): void {
    this.token = token
  }

  clearToken(): void {
    this.token = null
  }

  isDemoMode(): boolean {
    return this.demoMode
  }

  // Authentication
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    if (this.demoMode || credentials.username === 'demo') {
      this.token = 'demo-token'
      return {
        access_token: 'demo-token',
        token_type: 'bearer',
        expires_in: 86400,
      }
    }

    console.log('🔐 Login attempt:', {
      username: credentials.username,
      passwordLength: credentials.password?.length || 0,
      baseUrl: this.baseUrl
    })

    const response = await this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    })

    this.token = response.access_token
    return response
  }

  async getUserProfile(): Promise<UserProfile> {
    if (this.demoMode) {
      return {
        id: 'demo-user',
        username: 'demo',
        email: 'demo@example.com',
        full_name: 'Demo User',
        role: 'admin',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        last_login: new Date().toISOString(),
      }
    }

    return this.request<UserProfile>('/auth/me')
  }

  async logout(): Promise<void> {
    this.token = null
    this.demoMode = false
  }

  // Catalog Management
  async getCatalogs(): Promise<Catalog[]> {
    if (this.demoMode) {
      return [
        {
          id: 'demo-catalog-1',
          catalog_name: 'E-commerce Database',
          engine: 'postgresql',
          description: 'Customer orders and product data',
          version: '2024-01-01T00:00:00Z',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          raw_json: {},
        },
        {
          id: 'demo-catalog-2',
          catalog_name: 'Analytics Warehouse',
          engine: 'snowflake',
          description: 'Business intelligence and reporting data',
          version: '2024-02-01T00:00:00Z',
          is_active: true,
          created_at: '2024-02-01T00:00:00Z',
          updated_at: '2024-02-01T00:00:00Z',
          raw_json: {},
        },
      ]
    }

    return this.request<Catalog[]>('/v1/catalogs')
  }

  async getCatalog(catalogId: string): Promise<Catalog> {
    return this.request<Catalog>(`/v1/catalogs/${catalogId}`)
  }

  async createCatalog(catalogData: CreateCatalogRequest): Promise<Catalog> {
    if (this.demoMode) {
      return {
        id: `demo-catalog-${Date.now()}`,
        ...catalogData,
        is_active: catalogData.is_active ?? true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }

    return this.request<Catalog>('/v1/catalogs', {
      method: 'POST',
      body: JSON.stringify(catalogData),
    })
  }

  async updateCatalog(catalogId: string, catalogData: Partial<CreateCatalogRequest>): Promise<Catalog> {
    return this.request<Catalog>(`/v1/catalogs/${catalogId}`, {
      method: 'PUT',
      body: JSON.stringify(catalogData),
    })
  }

  async deleteCatalog(catalogId: string): Promise<void> {
    await this.request(`/v1/catalogs/${catalogId}`, {
      method: 'DELETE',
    })
  }

  async reindexCatalog(catalogId: string, force: boolean = false): Promise<any> {
    return this.request(`/v1/catalogs/${catalogId}/reindex`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    })
  }

  // Query Generation
  async generateQuery(request: GenerateQueryRequest): Promise<QueryResult> {
    if (this.demoMode) {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000))

      return {
        sql: `-- Generated SQL for: "${request.question}"
SELECT 
    c.customer_id,
    c.first_name,
    c.last_name,
    COUNT(o.order_id) as total_orders,
    SUM(o.total_amount) as total_spent,
    AVG(o.total_amount) as avg_order_value
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id
WHERE o.order_date >= CURRENT_DATE - INTERVAL '1 year'
    AND o.status = 'completed'
GROUP BY c.customer_id, c.first_name, c.last_name
ORDER BY total_spent DESC
LIMIT ${request.constraints?.max_rows || 100};`,
        explanation: `This query analyzes customer behavior by joining the customers and orders tables. It calculates key metrics including total orders, total spending, and average order value for each customer. The results are filtered to show only completed orders from the last year and sorted by total spending in descending order.`,
        validation: {
          syntax_valid: true,
          errors: [],
          warnings: ['Consider adding an index on (order_date, status) for better performance'],
          parsed_tables: ['customers', 'orders'],
          parsed_columns: ['customer_id', 'first_name', 'last_name', 'order_id', 'total_amount', 'order_date', 'status'],
        },
        policy: {
          allow_write: false,
          default_limit_applied: true,
          banned_items_blocked: [],
          pii_masking_applied: false,
          violations: [],
        },
        context_used: 1250,
        generation_time_ms: 1500 + Math.random() * 1000,
        tokens_used: {
          prompt_tokens: 450,
          completion_tokens: 120,
          total_tokens: 570,
        },
      }
    }

    return this.request<QueryResult>('/v1/generate', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async validateQuery(sql: string, engine: string, catalogId: string): Promise<any> {
    return this.request('/v1/validate', {
      method: 'POST',
      body: JSON.stringify({ sql, engine, catalog_id: catalogId }),
    })
  }

  // Policy Management
  async getPolicy(catalogId: string): Promise<SecurityPolicy> {
    if (this.demoMode) {
      return {
        catalog_id: catalogId,
        allow_write: false,
        default_limit: 1000,
        banned_tables: ['user_passwords', 'api_keys'],
        banned_columns: ['password', 'ssn', 'credit_card'],
        banned_schemas: ['internal', 'admin'],
        pii_tags: ['email', 'phone', 'address'],
        pii_masking_enabled: true,
        max_rows_returned: 10000,
        allowed_functions: ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'],
        blocked_functions: ['EXEC', 'DROP', 'DELETE', 'UPDATE', 'INSERT'],
        settings: {},
        created_by: 'demo-user',
      }
    }

    return this.request<SecurityPolicy>(`/v1/policies/${catalogId}`)
  }

  async updatePolicy(catalogId: string, policy: UpdatePolicyRequest): Promise<SecurityPolicy> {
    return this.request<SecurityPolicy>(`/v1/policies/${catalogId}`, {
      method: 'PUT',
      body: JSON.stringify(policy),
    })
  }

  // User Management (Admin only)
  async getUsers(): Promise<UserProfile[]> {
    if (this.demoMode) {
      return [
        {
          id: 'user-1',
          username: 'admin',
          email: 'admin@example.com',
          full_name: 'System Administrator',
          role: 'admin',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          last_login: new Date().toISOString(),
        },
        {
          id: 'user-2',
          username: 'analyst',
          email: 'analyst@example.com',
          full_name: 'Data Analyst',
          role: 'data_guy',
          is_active: true,
          created_at: '2024-02-01T00:00:00Z',
          last_login: '2024-12-08T15:30:00Z',
        },
      ]
    }

    return this.request<UserProfile[]>('/auth/users')
  }

  async createUser(userData: Partial<UserProfile> & { password: string }): Promise<UserProfile> {
    return this.request<UserProfile>('/auth/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    })
  }

  async updateUser(userId: string, userData: Partial<UserProfile>): Promise<UserProfile> {
    return this.request<UserProfile>(`/auth/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    })
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request(`/auth/users/${userId}`, {
      method: 'DELETE',
    })
  }

  async toggleUserStatus(userId: string, isActive: boolean): Promise<void> {
    await this.request(`/auth/users/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: isActive }),
    })
  }

  async getUserRoles(userId: string): Promise<any[]> {
    return this.request<any[]>(`/auth/users/${userId}/roles`)
  }

  async removeUserRole(userId: string, roleId: string): Promise<void> {
    await this.request(`/auth/users/${userId}/roles/${roleId}`, {
      method: 'DELETE',
    })
  }

  async getAvailableRoles(): Promise<any[]> {
    return this.request<any[]>('/auth/roles')
  }

  async getUserRoleHistory(userId: string): Promise<any[]> {
    return this.request<any[]>(`/auth/users/${userId}/role-history`)
  }

  async assignUserRole(userId: string, roleName: string): Promise<void> {
    await this.request(`/auth/users/${userId}/roles`, {
      method: 'POST',
      body: JSON.stringify({ role_name: roleName, user_id: userId }),
    })
  }

  // Knowledge Management - Notes
  async getNotes(catalogId?: string, status?: string, limit?: number): Promise<Note[]> {
    console.log('🔍 getNotes called:', { catalogId, status, limit, demoMode: this.demoMode })
    
    if (this.demoMode) {
      console.log('🎮 Using demo mode for notes')
      const demoNotes: Note[] = [
        {
          id: 'note-1',
          title: 'Customer Analysis Guidelines',
          content: 'When analyzing customers: 1) Exclude test accounts (@test.com) 2) Active customers = last login within 90 days 3) Use customer_id for joins, not email',
          tags: ['customers', 'guidelines', 'best-practices'],
          catalog_id: catalogId || 'demo-catalog',
          status: 'approved',
          created_by: 'admin',
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
          approved_by: 'admin',
          approved_at: '2024-01-15T10:30:00Z',
        },
        {
          id: 'note-2',
          title: 'Sales Data Guidelines',
          content: 'For sales analysis: 1) Always filter by sale_date for time-based queries 2) Use product_id for joins between products and sales 3) Consider seasonal trends in retail data',
          tags: ['sales', 'guidelines', 'analysis'],
          catalog_id: catalogId || 'demo-catalog',
          status: 'pending',
          created_by: 'analyst',
          created_at: '2024-01-20T14:30:00Z',
          updated_at: '2024-01-20T14:30:00Z',
        },
      ]
      
      return status ? demoNotes.filter(note => note.status === status) : demoNotes
    }

    const params = new URLSearchParams()
    if (catalogId) params.append('catalog_id', catalogId)
    if (status) params.append('status', status)
    if (limit) params.append('limit', limit.toString())
    
    const url = `/v1/notes?${params.toString()}`
    console.log('🌐 Making API request to:', url)
    
    // Backend returns direct array, not wrapped object
    const result = await this.request<Note[]>(url)
    console.log('📋 API response for notes:', result)
    return result
  }

  async createNote(noteData: CreateNoteRequest): Promise<Note> {
    if (this.demoMode) {
      return {
        id: `note-${Date.now()}`,
        ...noteData,
        status: 'pending',
        created_by: 'current-user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }

    return this.request<Note>('/v1/notes', {
      method: 'POST',
      body: JSON.stringify(noteData),
    })
  }

  async approveNote(noteId: string, approval: ApprovalRequest): Promise<Note> {
    return this.request<Note>(`/v1/notes/${noteId}/approve`, {
      method: 'POST',
      body: JSON.stringify(approval),
    })
  }

  // Knowledge Management - Metrics
  async getMetrics(catalogId?: string, status?: string): Promise<Metric[]> {
    if (this.demoMode) {
      const demoMetrics: Metric[] = [
        {
          id: 'metric-1',
          name: 'Monthly Active Users',
          description: 'Users who logged in within the last 30 days',
          expression: "COUNT(DISTINCT user_id) FROM user_logins WHERE login_date >= NOW() - INTERVAL '30 days'",
          tags: ['users', 'kpi', 'monthly'],
          catalog_id: catalogId || 'demo-catalog',
          status: 'approved',
          created_by: 'admin',
          created_at: '2024-01-10T09:00:00Z',
          updated_at: '2024-01-10T09:00:00Z',
          approved_by: 'admin',
          approved_at: '2024-01-10T09:15:00Z',
        },
        {
          id: 'metric-2',
          name: 'Monthly Revenue',
          description: 'Total revenue for a specific month',
          expression: "SUM(total_amount) FROM orders WHERE EXTRACT(month FROM order_date) = ? AND EXTRACT(year FROM order_date) = ? AND status = 'completed'",
          tags: ['revenue', 'monthly', 'kpi'],
          catalog_id: catalogId || 'demo-catalog',
          status: 'pending',
          created_by: 'analyst',
          created_at: '2024-01-18T11:20:00Z',
          updated_at: '2024-01-18T11:20:00Z',
        },
      ]
      
      return status ? demoMetrics.filter(metric => metric.status === status) : demoMetrics
    }

    const params = new URLSearchParams()
    if (catalogId) params.append('catalog_id', catalogId)
    if (status) params.append('status', status)
    
    const url = `/v1/metrics?${params.toString()}`
    console.log('🌐 Making API request to:', url)
    
    const result = await this.request<Metric[]>(url)
    console.log('📊 API response for metrics:', result)
    return result
  }

  async createMetric(metricData: CreateMetricRequest): Promise<Metric> {
    if (this.demoMode) {
      return {
        id: `metric-${Date.now()}`,
        ...metricData,
        status: 'pending',
        created_by: 'current-user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }

    return this.request<Metric>('/v1/metrics', {
      method: 'POST',
      body: JSON.stringify(metricData),
    })
  }

  async approveMetric(metricId: string, approval: ApprovalRequest): Promise<Metric> {
    return this.request<Metric>(`/v1/metrics/${metricId}/approve`, {
      method: 'POST',
      body: JSON.stringify(approval),
    })
  }

  // Knowledge Management - Examples
  async getExamples(catalogId?: string, status?: string, engine?: string): Promise<Example[]> {
    if (this.demoMode) {
      const demoExamples: Example[] = [
        {
          id: 'example-1',
          title: 'Top Customers by Revenue',
          description: 'Find the highest value customers by total order amount',
          sql_snippet: `SELECT 
    c.customer_id, 
    c.first_name, 
    c.last_name, 
    SUM(o.total_amount) as total_spent 
FROM customers c 
JOIN orders o ON c.customer_id = o.customer_id 
WHERE o.status = 'completed' 
GROUP BY c.customer_id, c.first_name, c.last_name 
ORDER BY total_spent DESC 
LIMIT 10;`,
          engine: 'postgresql',
          tags: ['customers', 'revenue', 'top-performers'],
          catalog_id: catalogId || 'demo-catalog',
          status: 'approved',
          created_by: 'admin',
          created_at: '2024-01-12T16:45:00Z',
          updated_at: '2024-01-12T16:45:00Z',
          approved_by: 'admin',
          approved_at: '2024-01-12T17:00:00Z',
        },
        {
          id: 'example-2',
          title: 'Monthly Sales Trend',
          description: 'Analyze monthly sales trends over the last year',
          sql_snippet: `SELECT 
    DATE_TRUNC('month', order_date) AS month,
    COUNT(*) as order_count,
    SUM(total_amount) as monthly_revenue,
    AVG(total_amount) as avg_order_value
FROM orders 
WHERE order_date >= NOW() - INTERVAL '1 year'
    AND status = 'completed'
GROUP BY month 
ORDER BY month;`,
          engine: 'postgresql',
          tags: ['sales', 'trends', 'monthly', 'analysis'],
          catalog_id: catalogId || 'demo-catalog',
          status: 'pending',
          created_by: 'analyst',
          created_at: '2024-01-22T13:15:00Z',
          updated_at: '2024-01-22T13:15:00Z',
        },
      ]
      
      let filtered = demoExamples
      if (status) filtered = filtered.filter(example => example.status === status)
      if (engine) filtered = filtered.filter(example => example.engine === engine)
      
      return filtered
    }

    const params = new URLSearchParams()
    if (catalogId) params.append('catalog_id', catalogId)
    if (status) params.append('status', status)
    if (engine) params.append('engine', engine)
    
    const url = `/v1/examples?${params.toString()}`
    console.log('🌐 Making API request to:', url)
    
    const result = await this.request<Example[]>(url)
    console.log('💡 API response for examples:', result)
    return result
  }

  async createExample(exampleData: CreateExampleRequest): Promise<Example> {
    if (this.demoMode) {
      return {
        id: `example-${Date.now()}`,
        ...exampleData,
        status: 'pending',
        created_by: 'current-user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }

    return this.request<Example>('/v1/examples', {
      method: 'POST',
      body: JSON.stringify(exampleData),
    })
  }

  async approveExample(exampleId: string, approval: ApprovalRequest): Promise<Example> {
    return this.request<Example>(`/v1/examples/${exampleId}/approve`, {
      method: 'POST',
      body: JSON.stringify(approval),
    })
  }

  // Query History Methods
  async getQueryHistory(): Promise<QueryHistoryItem[]> {
    if (this.demoMode) {
      // Return demo history data
      return [
        {
          id: 'query-1',
          catalog_id: 'catalog-1',
          engine: 'postgresql',
          question: 'Show me the top 10 customers by total order amount',
          generated_sql: 'SELECT c.customer_name, SUM(o.total_amount) as total_spent\nFROM customers c\nJOIN orders o ON c.id = o.customer_id\nGROUP BY c.id, c.customer_name\nORDER BY total_spent DESC\nLIMIT 10;',
          explanation: 'This query joins the customers and orders tables to calculate the total amount spent by each customer, then orders them by total spending in descending order and limits to the top 10.',
          syntax_valid: true,
          status: 'completed',
          generation_time_ms: 1250,
          created_at: '2024-01-22T10:30:00Z',
          tokens_used: 150,
          catalog_name: 'E-commerce Database',
          username: 'john_doe',
          feedback: [
            {
              id: 'feedback-1',
              history_id: 'query-1',
              rating: 4,
              comment: 'Great query! The JOIN is efficient and the LIMIT clause is properly used.',
              correctness: 4,
              completeness: 4,
              efficiency: 4,
              created_at: '2024-01-22T11:00:00Z',
              username: 'admin'
            }
          ]
        },
        {
          id: 'query-2',
          catalog_id: 'catalog-1',
          engine: 'postgresql',
          question: 'Find all products with low inventory',
          generated_sql: 'SELECT product_name, stock_quantity\nFROM products\nWHERE stock_quantity < 10\nORDER BY stock_quantity ASC;',
          explanation: 'This query filters products where the stock quantity is less than 10 and orders them by stock quantity to show the most critical inventory levels first.',
          syntax_valid: true,
          status: 'completed',
          generation_time_ms: 890,
          created_at: '2024-01-22T09:15:00Z',
          tokens_used: 95,
          catalog_name: 'E-commerce Database',
          username: 'john_doe'
        }
      ]
    }

    // Use the correct backend endpoint: /v1/history
    const result = await this.request<{items: QueryHistoryItem[], total: number, limit: number, offset: number}>('/v1/history')
    return result.items
  }

  async getQueryFeedback(historyId: string): Promise<QueryFeedback[]> {
    console.log('🌐 API: Getting feedback for history ID:', historyId)
    
    if (this.demoMode) {
      console.log('🎮 Demo mode: Returning demo feedback')
      // Return demo feedback data
      return [
        {
          id: 'feedback-1',
          history_id: historyId,
          rating: 4,
          comment: 'Good query structure, but could be optimized for better performance.',
          correctness: 4,
          completeness: 3,
          efficiency: 3,
          suggested_sql: 'SELECT * FROM table WHERE condition = ?',
          improvement_notes: 'Consider adding indexes on frequently queried columns.',
          created_at: '2024-01-22T11:00:00Z',
          username: 'admin'
        }
      ]
    }

    try {
      console.log('🌐 API: Making request to:', `/v1/history/${historyId}/feedback/all`)
      // Get all feedback for this history item
      const result = await this.request<QueryFeedback[]>(`/v1/history/${historyId}/feedback/all`)
      console.log('✅ API: Feedback result:', result)
      return result
    } catch (error) {
      console.error('❌ API: Error getting feedback:', error)
      // If no feedback exists, return empty array
      if (error instanceof ApiError && error.status === 404) {
        console.log('📭 API: No feedback found (404), returning empty array')
        return []
      }
      throw error
    }
  }

  async submitQueryFeedback(feedback: SubmitFeedbackRequest): Promise<void> {
    if (this.demoMode) {
      console.log('Demo mode: Feedback submitted:', feedback)
      return
    }

    // Use the correct backend endpoint: /v1/history/{history_id}/feedback
    await this.request<void>(`/v1/history/${feedback.query_id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({
        rating: feedback.rating,
        comment: feedback.comment,
        correctness: feedback.correctness,
        completeness: feedback.completeness,
        efficiency: feedback.efficiency,
        suggested_sql: feedback.suggested_sql,
        improvement_notes: feedback.improvement_notes
      }),
    })
  }
} 