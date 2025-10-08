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
  UpdatePolicyRequest,
  CreateCatalogRequest,
  ApiResponse,
  PaginatedResponse,
  QueryHistoryItem,
  QueryFeedback,
  SubmitFeedbackRequest
} from './api-client'
