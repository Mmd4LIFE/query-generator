// Re-export everything from the professional API client
export { 
  QueryGeneratorAPIClient as QueryGeneratorAPI,
  ApiError,
  NetworkError,
  AuthenticationError
} from './api-client'

export type {
  LoginRequest,
  LoginResponse,
  GenerateQueryRequest,
  QueryResult,
  UserProfile,
  Catalog,
  SecurityPolicy,
  CreateCatalogRequest,
  ApiResponse,
  PaginatedResponse,
  QueryHistoryItem,
  SubmitFeedbackRequest
} from './api-client'
