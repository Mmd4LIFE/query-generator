interface ApiConfig {
  baseUrl: string
  timeout: number
  retryAttempts: number
  retryDelay: number
}

interface AppConfig {
  api: ApiConfig
  demo: {
    enabled: boolean
  }
  features: {
    analytics: boolean
    feedback: boolean
  }
}

// Environment-based configuration
const getConfig = (): AppConfig => {
  const isDevelopment = process.env.NODE_ENV === 'development'
  const isProduction = process.env.NODE_ENV === 'production'

  return {
    api: {
      baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || 
               process.env.NEXT_PUBLIC_API_URL || 
               `http://localhost:${process.env.NEXT_PUBLIC_BACKEND_PORT || '8000'}`,
      timeout: parseInt(process.env.NEXT_PUBLIC_API_TIMEOUT || '30000'),
      retryAttempts: parseInt(process.env.NEXT_PUBLIC_API_RETRY_ATTEMPTS || '3'),
      retryDelay: parseInt(process.env.NEXT_PUBLIC_API_RETRY_DELAY || '1000'),
    },
    demo: {
      enabled: process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || isDevelopment,
    },
    features: {
      analytics: process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true' || isProduction,
      feedback: process.env.NEXT_PUBLIC_FEEDBACK_ENABLED !== 'false',
    }
  }
}

export const config = getConfig()

// Health check endpoint
export const healthCheck = async (baseUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    })
    return response.ok
  } catch (error) {
    console.warn(`Health check failed for ${baseUrl}:`, error)
    return false
  }
}

// Auto-discovery for local development
export const discoverBackend = async (): Promise<string | null> => {
  const commonPorts = [8000, 8080, 3000, 5000, 8001]
  const commonHosts = ['localhost', '127.0.0.1']
  
  for (const host of commonHosts) {
    for (const port of commonPorts) {
      const url = `http://${host}:${port}`
      if (await healthCheck(url)) {
        return url
      }
    }
  }
  return null
}

export default config 