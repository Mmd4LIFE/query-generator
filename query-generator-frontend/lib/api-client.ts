import { config, healthCheck } from './config'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

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

// ----- Auth -----

export interface LoginRequest {
  username: string
  password: string
}

export type Role = 'general' | 'colonel' | 'captain' | 'soldier'

export interface SectorMembership {
  sector_id: string
  sector_code: string
  sector_name?: string
  role: Role
}

export interface LoginResponse {
  access_token: string
  token_type: string
  expires_in?: number
  is_general?: boolean
  sectors?: SectorMembership[]
}

export interface UserProfile {
  id: string
  username: string
  email: string
  full_name?: string
  is_active: boolean
  created_at: string
  last_login?: string
  is_general?: boolean
  sectors?: SectorMembership[]
  // Legacy fields kept so older deployments don't crash the UI.
  role?: string
  roles?: any[]
}

// Per-user cost row (legacy /auth/users/cost-summary).
export interface UserCostRow {
  user_id: string
  username?: string
  total_cost_usd: number
  total_queries: number
  total_tokens: number
}

// Phase-6 cost-summary endpoints.
export interface CostRow {
  key: string
  label?: string | null
  requests: number
  successes: number
  errors: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number
}
export interface CostSummary {
  group_by: 'day' | 'user' | 'model' | 'sector'
  from_date?: string | null
  to_date?: string | null
  rows: CostRow[]
  total: CostRow
}

// ----- Sectors -----

export interface Sector {
  id: string
  code: string
  name: string
  description?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// ----- Catalogs -----

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

export interface CatalogSummary {
  id: string
  catalog_name: string
  engine: string
  description?: string
  version?: string
  is_active: boolean
  created_at: string
  updated_at: string
  object_counts?: Record<string, number>
}

export interface CreateCatalogRequest {
  engine: string
  catalog_name: string
  version: string
  description?: string
  is_active?: boolean
  raw_json: any
}

// ----- Generation -----

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
    model?: string
  }
  model_used?: string | null
  cost_usd?: number | null
}

// ----- History + feedback + corrections -----

export interface QueryHistoryItem {
  id: string
  sector_id?: string
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
  cost_usd?: number | null
  model_used?: string | null
  catalog_name?: string
  username?: string
  user_id?: string
  feedback?: QueryFeedback[]
}

export interface QueryFeedback {
  id: string
  history_id: string
  rating?: number
  comment?: string
  correctness?: number
  completeness?: number
  efficiency?: number
  suggested_sql?: string
  improvement_notes?: string
  correction_status?: 'pending' | 'approved' | 'rejected' | null
  created_at: string
  username?: string
}

export interface SubmitFeedbackRequest {
  query_id: string
  rating?: number
  comment?: string
  correctness?: number
  completeness?: number
  efficiency?: number
  suggested_sql?: string
  improvement_notes?: string
}

export interface Correction {
  id: string
  sector_id: string
  catalog_id: string
  history_id: string
  question: string
  correct_sql: string
  notes?: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_by: string
  created_by_username?: string | null
  approved_by?: string | null
  approved_by_username?: string | null
  created_at: string
  updated_at: string
}

// ----- Settings -----

export interface SettingItem {
  key: string
  category: string
  description: string
  ui_type: string
  choices?: Array<{ value: string; label: string; description?: string }> | null
  default: any
  value: any
  source?: 'sector' | 'global' | 'default'
  is_default: boolean
  updated_at?: string | null
  updated_by?: string | null
  sector_overridable?: boolean
}

export interface GenModelInfo {
  name: string
  label: string
  input_per_token: number
  output_per_token: number
  context_window: number
  description: string
}

export interface EmbedModelInfo {
  name: string
  label: string
  per_token: number
  dimension: number
}

export interface ModelRegistryResponse {
  gen_models: GenModelInfo[]
  embed_models: EmbedModelInfo[]
}

// ----- Policy + knowledge -----

export interface SecurityPolicy {
  catalog_id: string
  sector_id?: string
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

export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  catalog_id?: string
  status: 'pending' | 'approved' | 'rejected'
  created_by: string
  created_at: string
  updated_at: string
  approved_by?: string
}
export interface CreateNoteRequest {
  title: string
  content: string
  tags: string[]
  catalog_id?: string | null
}

export interface Metric {
  id: string
  name: string
  description: string
  expression: string
  engine?: string
  tags: string[]
  catalog_id?: string
  status: 'pending' | 'approved' | 'rejected'
  created_by: string
  created_at: string
  updated_at: string
  approved_by?: string
}
export interface CreateMetricRequest {
  name: string
  description: string
  expression: string
  engine?: string
  tags: string[]
  catalog_id?: string | null
}

export interface Example {
  id: string
  title: string
  description: string
  sql_snippet: string
  engine: string
  tags: string[]
  catalog_id?: string
  status: 'pending' | 'approved' | 'rejected'
  created_by: string
  created_at: string
  updated_at: string
  approved_by?: string
}
export interface CreateExampleRequest {
  title: string
  description: string
  sql_snippet: string
  engine: string
  tags: string[]
  catalog_id?: string | null
}

export interface ApprovalRequest {
  action: 'approve' | 'reject'
  reason?: string
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(public status: number, public message: string, public details?: any) {
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

export class SectorRequiredError extends Error {
  constructor() {
    super('No current sector selected. Call setCurrentSector() before this request.')
    this.name = 'SectorRequiredError'
  }
}


// ---------------------------------------------------------------------------
// Decode the JWT payload (no signature check — purely for is_general /
// sectors hints. Authoritative checks always re-read /auth/me on the server).
// ---------------------------------------------------------------------------

function decodeJwtPayload(token: string): any | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const padded = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = typeof atob !== 'undefined' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json)
  } catch {
    return null
  }
}


// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export class QueryGeneratorAPIClient {
  private token: string | null = null
  private baseUrl: string
  private demoMode = false
  private currentSectorId: string | null = null
  private cachedSectors: SectorMembership[] = []
  private cachedIsGeneral = false

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || config.api.baseUrl
  }

  // ---- Configuration ----

  setBaseUrl(url: string) { this.baseUrl = url }
  getBaseUrl(): string { return this.baseUrl }
  isAuthenticated(): boolean { return !!this.token }

  setDemoMode(enabled: boolean) {
    this.demoMode = enabled
    if (enabled) {
      this.token = 'demo-token'
      this.cachedIsGeneral = true
      this.cachedSectors = [{
        sector_id: 'demo-sector',
        sector_code: 'sector_zero',
        sector_name: 'Demo Sector',
        role: 'general',
      }]
      this.currentSectorId = 'demo-sector'
    }
  }

  isDemoMode(): boolean { return this.demoMode }

  setToken(token: string): void {
    this.token = token
    const payload = decodeJwtPayload(token)
    if (payload) {
      this.cachedIsGeneral = !!payload.is_general
      this.cachedSectors = Array.isArray(payload.sectors) ? payload.sectors : []
      // Auto-pick a current sector if we have exactly one membership
      // and the caller hasn't already set one.
      if (!this.currentSectorId && this.cachedSectors.length === 1) {
        this.currentSectorId = this.cachedSectors[0].sector_id
      }
    }
  }

  clearToken(): void {
    this.token = null
    this.currentSectorId = null
    this.cachedSectors = []
    this.cachedIsGeneral = false
  }

  // ---- Sector context ----

  setCurrentSector(sectorId: string | null): void { this.currentSectorId = sectorId }
  getCurrentSector(): string | null { return this.currentSectorId }
  getCachedSectors(): SectorMembership[] { return this.cachedSectors }
  getCachedIsGeneral(): boolean { return this.cachedIsGeneral }

  private sectorPath(): string {
    if (!this.currentSectorId) throw new SectorRequiredError()
    return `/v1/sectors/${this.currentSectorId}`
  }

  // ---- Health ----

  async healthCheck(): Promise<boolean> { return healthCheck(this.baseUrl) }

  // ---- HTTP plumbing ----

  private async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (options.headers) Object.assign(headers, options.headers)
    if (this.token && !this.demoMode) headers['Authorization'] = `Bearer ${this.token}`

    const requestOptions: RequestInit = {
      ...options,
      headers,
      signal: AbortSignal.timeout(config.api.timeout),
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt < config.api.retryAttempts; attempt++) {
      try {
        const response = await fetch(url, requestOptions)
        if (!response.ok) {
          if (response.status === 401) {
            this.clearToken()
            throw new AuthenticationError()
          }
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`
          let errorData: any = null
          try {
            errorData = await response.json()
            if (errorData?.detail) {
              if (Array.isArray(errorData.detail)) {
                errorMessage = errorData.detail
                  .map((item: any) => (typeof item === 'string' ? item : item.msg ?? JSON.stringify(item)))
                  .join(', ')
              } else if (typeof errorData.detail === 'string') {
                errorMessage = errorData.detail
              } else {
                errorMessage = JSON.stringify(errorData.detail)
              }
            }
          } catch {
            /* response body wasn't JSON */
          }
          const apiError = new ApiError(response.status, errorMessage, errorData)
          if (errorData?.correlation_id) {
            console.error('🔗 correlation_id:', errorData.correlation_id)
          }
          throw apiError
        }

        const contentType = response.headers.get('content-type')
        if (response.status === 204) return undefined as unknown as T
        if (contentType?.includes('application/json')) return await response.json()
        return (await response.text()) as unknown as T
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (error instanceof ApiError || error instanceof AuthenticationError) throw error
        if (attempt < config.api.retryAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, config.api.retryDelay * (attempt + 1)))
          continue
        }
      }
    }
    throw new NetworkError(`Network request failed after ${config.api.retryAttempts} attempts`, lastError || undefined)
  }

  // ---- Auth ----

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    if (this.demoMode || credentials.username === 'demo') {
      this.setDemoMode(true)
      return {
        access_token: 'demo-token',
        token_type: 'bearer',
        expires_in: 86400,
        is_general: true,
        sectors: this.cachedSectors,
      }
    }

    const response = await this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    })
    this.setToken(response.access_token)
    if (response.is_general !== undefined) this.cachedIsGeneral = response.is_general
    if (Array.isArray(response.sectors)) {
      this.cachedSectors = response.sectors
      if (!this.currentSectorId && response.sectors.length === 1) {
        this.currentSectorId = response.sectors[0].sector_id
      }
    }
    return response
  }

  async getUserProfile(): Promise<UserProfile> {
    if (this.demoMode) {
      return {
        id: 'demo-user',
        username: 'demo',
        email: 'demo@example.com',
        full_name: 'Demo User',
        is_general: true,
        sectors: this.cachedSectors,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        last_login: new Date().toISOString(),
      }
    }
    const profile = await this.request<UserProfile>('/auth/me')
    if (profile.is_general !== undefined) this.cachedIsGeneral = !!profile.is_general
    if (Array.isArray(profile.sectors)) {
      this.cachedSectors = profile.sectors
      if (!this.currentSectorId && profile.sectors.length === 1) {
        this.currentSectorId = profile.sectors[0].sector_id
      }
    }
    return profile
  }

  async logout(): Promise<void> { this.clearToken(); this.demoMode = false }

  // ---- Sectors ----

  async listSectors(): Promise<Sector[]> {
    if (this.demoMode) {
      return [{
        id: 'demo-sector', code: 'sector_zero', name: 'Demo Sector',
        is_active: true, created_at: '', updated_at: '',
      }]
    }
    return this.request<Sector[]>('/v1/sectors')
  }

  // ---- Catalogs (sector-scoped) ----

  async getCatalogs(): Promise<CatalogSummary[]> {
    if (this.demoMode) return []
    return this.request<CatalogSummary[]>(`${this.sectorPath()}/catalogs`)
  }

  async getCatalog(catalogId: string): Promise<Catalog> {
    return this.request<Catalog>(`${this.sectorPath()}/catalogs/${catalogId}`)
  }

  async createCatalog(body: CreateCatalogRequest): Promise<Catalog> {
    return this.request<Catalog>(`${this.sectorPath()}/catalogs`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async updateCatalog(catalogId: string, body: Partial<CreateCatalogRequest>): Promise<Catalog> {
    return this.request<Catalog>(`${this.sectorPath()}/catalogs/${catalogId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }

  async reindexCatalog(catalogId: string, force = false): Promise<any> {
    return this.request(`${this.sectorPath()}/catalogs/${catalogId}/reindex`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    })
  }

  // ---- Generation (still under /v1/generate; backend resolves sector from catalog) ----

  async generateQuery(request: GenerateQueryRequest): Promise<QueryResult> {
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

  // ---- Policy (sector-scoped, nested under catalog) ----

  async getPolicy(catalogId: string): Promise<SecurityPolicy> {
    return this.request<SecurityPolicy>(`${this.sectorPath()}/catalogs/${catalogId}/policy`)
  }

  async updatePolicy(catalogId: string, body: UpdatePolicyRequest): Promise<SecurityPolicy> {
    return this.request<SecurityPolicy>(`${this.sectorPath()}/catalogs/${catalogId}/policy`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }

  // ---- Users (global, General-only) ----

  async getUsers(): Promise<UserProfile[]> {
    if (this.demoMode) return []
    return this.request<UserProfile[]>('/auth/users')
  }

  async getUsersCostSummary(): Promise<UserCostRow[]> {
    return this.request<UserCostRow[]>('/auth/users/cost-summary')
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
    await this.request(`/auth/users/${userId}`, { method: 'DELETE' })
  }

  async toggleUserStatus(userId: string, isActive: boolean): Promise<void> {
    await this.request(`/auth/users/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: isActive }),
    })
  }

  async getAvailableRoles(): Promise<any[]> {
    return this.request<any[]>('/auth/roles')
  }

  /**
   * Assign a role to a user. Sector-scoped roles (colonel/captain/soldier)
   * go through the Sector's members endpoint. Passing the cross-Sector
   * `general` role routes to the dedicated promote endpoint instead.
   *
   * Legacy role names (`admin`, `data_guy`, `user`) are silently mapped
   * onto the new vocabulary so old UI code keeps working.
   */
  async assignUserRole(
    userId: string,
    roleName: string,
    sectorId?: string,
  ): Promise<any> {
    const legacyMap: Record<string, string> = {
      admin: 'general',
      data_guy: 'captain',
      data_analyst: 'captain',
      catalog_manager: 'captain',
      user: 'soldier',
      viewer: 'soldier',
    }
    const role = (legacyMap[roleName.toLowerCase()] ?? roleName.toLowerCase())

    if (role === 'general') {
      return this.promoteToGeneral(userId)
    }
    if (!['colonel', 'captain', 'soldier'].includes(role)) {
      throw new Error(`Unknown role: ${roleName}`)
    }

    const sid = sectorId ?? this.currentSectorId
    if (!sid) throw new SectorRequiredError()
    return this.request<any>(`/v1/sectors/${sid}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, role }),
    })
  }

  /** Remove a sector role from a user. */
  async removeUserRole(userId: string, sectorId?: string): Promise<void> {
    const sid = sectorId ?? this.currentSectorId
    if (!sid) throw new SectorRequiredError()
    await this.request(`/v1/sectors/${sid}/members/${userId}`, { method: 'DELETE' })
  }

  /** Promote a user to General (General-only). */
  async promoteToGeneral(userId: string): Promise<any> {
    return this.request<any>(`/auth/users/${userId}/promote-to-general`, { method: 'POST' })
  }

  /** Revoke the General role from a user (General-only). */
  async revokeGeneral(userId: string): Promise<void> {
    await this.request(`/auth/users/${userId}/general`, { method: 'DELETE' })
  }

  // ---- Knowledge (sector-scoped) ----

  async getNotes(catalogId?: string, status?: string, limit?: number): Promise<Note[]> {
    const params = new URLSearchParams()
    if (catalogId) params.append('catalog_id', catalogId)
    if (status) params.append('status', status)
    if (limit) params.append('limit', String(limit))
    return this.request<Note[]>(`${this.sectorPath()}/knowledge/notes?${params.toString()}`)
  }

  async createNote(body: CreateNoteRequest): Promise<Note> {
    return this.request<Note>(`${this.sectorPath()}/knowledge/notes`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async approveNote(noteId: string, approval: ApprovalRequest): Promise<Note> {
    return this.request<Note>(`${this.sectorPath()}/knowledge/notes/${noteId}/approve`, {
      method: 'POST',
      body: JSON.stringify(approval),
    })
  }

  async getMetrics(catalogId?: string, status?: string): Promise<Metric[]> {
    const params = new URLSearchParams()
    if (catalogId) params.append('catalog_id', catalogId)
    if (status) params.append('status', status)
    return this.request<Metric[]>(`${this.sectorPath()}/knowledge/metrics?${params.toString()}`)
  }

  async createMetric(body: CreateMetricRequest): Promise<Metric> {
    return this.request<Metric>(`${this.sectorPath()}/knowledge/metrics`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async approveMetric(metricId: string, approval: ApprovalRequest): Promise<Metric> {
    return this.request<Metric>(`${this.sectorPath()}/knowledge/metrics/${metricId}/approve`, {
      method: 'POST',
      body: JSON.stringify(approval),
    })
  }

  async getExamples(catalogId?: string, status?: string, engine?: string): Promise<Example[]> {
    const params = new URLSearchParams()
    if (catalogId) params.append('catalog_id', catalogId)
    if (status) params.append('status', status)
    if (engine) params.append('engine', engine)
    return this.request<Example[]>(`${this.sectorPath()}/knowledge/examples?${params.toString()}`)
  }

  async createExample(body: CreateExampleRequest): Promise<Example> {
    return this.request<Example>(`${this.sectorPath()}/knowledge/examples`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async approveExample(exampleId: string, approval: ApprovalRequest): Promise<Example> {
    return this.request<Example>(`${this.sectorPath()}/knowledge/examples/${exampleId}/approve`, {
      method: 'POST',
      body: JSON.stringify(approval),
    })
  }

  // ---- History + feedback (sector-scoped) ----

  async getQueryHistory(opts?: {
    catalogId?: string
    status?: string
    scope?: 'auto' | 'own' | 'sector'
    limit?: number
    offset?: number
  }): Promise<QueryHistoryItem[]> {
    const params = new URLSearchParams()
    if (opts?.catalogId) params.append('catalog_id', opts.catalogId)
    if (opts?.status) params.append('status', opts.status)
    if (opts?.scope) params.append('scope', opts.scope)
    if (opts?.limit) params.append('limit', String(opts.limit))
    if (opts?.offset) params.append('offset', String(opts.offset))
    const result = await this.request<{ items: QueryHistoryItem[]; total: number; limit: number; offset: number }>(
      `${this.sectorPath()}/history?${params.toString()}`,
    )
    return result.items
  }

  async getQueryFeedback(historyId: string): Promise<QueryFeedback[]> {
    try {
      return await this.request<QueryFeedback[]>(`${this.sectorPath()}/history/${historyId}/feedback/all`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return []
      throw error
    }
  }

  async submitQueryFeedback(feedback: SubmitFeedbackRequest): Promise<void> {
    await this.request<void>(`${this.sectorPath()}/history/${feedback.query_id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({
        rating: feedback.rating,
        comment: feedback.comment,
        correctness: feedback.correctness,
        completeness: feedback.completeness,
        efficiency: feedback.efficiency,
        suggested_sql: feedback.suggested_sql,
        improvement_notes: feedback.improvement_notes,
      }),
    })
  }

  // ---- Corrections (Phase-5 review queue) ----

  async listCorrections(opts?: {
    status?: string
    catalogId?: string
    limit?: number
    offset?: number
  }): Promise<{ items: Correction[]; total: number }> {
    const params = new URLSearchParams()
    if (opts?.status) params.append('status', opts.status)
    if (opts?.catalogId) params.append('catalog_id', opts.catalogId)
    if (opts?.limit) params.append('limit', String(opts.limit))
    if (opts?.offset) params.append('offset', String(opts.offset))
    return this.request(`${this.sectorPath()}/corrections?${params.toString()}`)
  }

  async approveCorrection(correctionId: string): Promise<Correction> {
    return this.request<Correction>(`${this.sectorPath()}/corrections/${correctionId}/approve`, { method: 'POST' })
  }

  async rejectCorrection(correctionId: string, notes?: string): Promise<Correction> {
    return this.request<Correction>(`${this.sectorPath()}/corrections/${correctionId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    })
  }

  // ---- Cost summary ----

  async getSectorCostSummary(opts?: {
    from?: string
    to?: string
    groupBy?: 'day' | 'user' | 'model'
    limit?: number
  }): Promise<CostSummary> {
    const params = new URLSearchParams()
    if (opts?.from) params.append('from', opts.from)
    if (opts?.to) params.append('to', opts.to)
    if (opts?.groupBy) params.append('group_by', opts.groupBy)
    if (opts?.limit) params.append('limit', String(opts.limit))
    return this.request<CostSummary>(`${this.sectorPath()}/cost-summary?${params.toString()}`)
  }

  async getGlobalCostSummary(opts?: {
    from?: string
    to?: string
    groupBy?: 'day' | 'user' | 'model' | 'sector'
    sectorId?: string
    limit?: number
  }): Promise<CostSummary> {
    const params = new URLSearchParams()
    if (opts?.from) params.append('from', opts.from)
    if (opts?.to) params.append('to', opts.to)
    if (opts?.groupBy) params.append('group_by', opts.groupBy)
    if (opts?.sectorId) params.append('sector_id', opts.sectorId)
    if (opts?.limit) params.append('limit', String(opts.limit))
    return this.request<CostSummary>(`/v1/cost-summary?${params.toString()}`)
  }

  // ---- Settings (global = General-only) ----

  async listSettings(): Promise<SettingItem[]> { return this.request<SettingItem[]>('/v1/settings') }
  async getSetting(key: string): Promise<SettingItem> {
    return this.request<SettingItem>(`/v1/settings/${encodeURIComponent(key)}`)
  }
  async updateSetting(key: string, value: any): Promise<SettingItem> {
    return this.request<SettingItem>(`/v1/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    })
  }
  async resetSetting(key: string): Promise<SettingItem> {
    return this.request<SettingItem>(`/v1/settings/${encodeURIComponent(key)}/reset`, { method: 'POST' })
  }
  async listModels(): Promise<ModelRegistryResponse> {
    return this.request<ModelRegistryResponse>('/v1/settings/models')
  }

  // ---- Sector settings (Colonel+ for current Sector) ----

  async listSectorSettings(): Promise<SettingItem[]> {
    return this.request<SettingItem[]>(`${this.sectorPath()}/settings`)
  }
  async getSectorSetting(key: string): Promise<SettingItem> {
    return this.request<SettingItem>(`${this.sectorPath()}/settings/${encodeURIComponent(key)}`)
  }
  async updateSectorSetting(key: string, value: any): Promise<SettingItem> {
    return this.request<SettingItem>(`${this.sectorPath()}/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    })
  }
  async resetSectorSetting(key: string): Promise<SettingItem> {
    return this.request<SettingItem>(`${this.sectorPath()}/settings/${encodeURIComponent(key)}/reset`, { method: 'POST' })
  }
}
