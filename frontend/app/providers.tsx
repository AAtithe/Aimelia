'use client'

import { createContext, useContext, useState, useEffect } from 'react'

// Auth context
interface AuthContextType {
  isAuthenticated: boolean
  user: any
  login: () => void
  logout: () => void
  loading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// API context
interface ApiContextType {
  apiBaseUrl: string
  makeRequest: (endpoint: string, options?: RequestInit) => Promise<any>
}

const ApiContext = createContext<ApiContextType | undefined>(undefined)

export function useApi() {
  const context = useContext(ApiContext)
  if (context === undefined) {
    throw new Error('useApi must be used within an ApiProvider')
  }
  return context
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [accessToken, setAccessToken] = useState<string | null>(null)

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://aimelia-api.onrender.com'

  // Check authentication status on mount
  useEffect(() => {
    checkAuthStatus()
  }, [])

  const checkAuthStatus = async () => {
    try {
      console.log('Checking authentication status...')
      const response = await fetch(`${apiBaseUrl}/auth/token`)
      console.log('Auth response status:', response.status)
      
      if (response.ok) {
        const data = await response.json()
        console.log('Auth response data:', data)
        
        if (data.status === 'ok' && data.has_token) {
          console.log('User is authenticated!')
          setIsAuthenticated(true)
          if (data.access_token) {
            setAccessToken(data.access_token)
            console.log('Access token set')
          }
        } else {
          console.log('User not authenticated:', data.message)
        }
      } else {
        console.log('Auth check failed with status:', response.status)
      }
    } catch (error) {
      console.log('Auth check error:', error)
    } finally {
      setLoading(false)
    }
  }

  const getAccessToken = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/auth/token`)
      if (response.ok) {
        const data = await response.json()
        if (data.access_token) {
          setAccessToken(data.access_token)
        }
      }
    } catch (error) {
      console.error('Failed to get access token:', error)
    }
  }

  const login = () => {
    // Simple redirect approach - let the callback handle the redirect
    window.location.href = `${apiBaseUrl}/auth/login`
  }

  const logout = async () => {
    try {
      await fetch(`${apiBaseUrl}/auth/revoke`, { method: 'POST' })
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      setIsAuthenticated(false)
      setUser(null)
    }
  }

  const makeRequest = async (endpoint: string, options: RequestInit = {}) => {
    const url = `${apiBaseUrl}${endpoint}`
    
    // Get fresh access token if we don't have one
    if (!accessToken && isAuthenticated) {
      await getAccessToken()
    }
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`)
    }

    return response.json()
  }

  const authValue = {
    isAuthenticated,
    user,
    login,
    logout,
    loading,
  }

  const apiValue = {
    apiBaseUrl,
    makeRequest,
  }

  return (
    <AuthContext.Provider value={authValue}>
      <ApiContext.Provider value={apiValue}>
        {children}
      </ApiContext.Provider>
    </AuthContext.Provider>
  )
}
