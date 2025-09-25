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
    // Check if we just returned from authentication
    const urlParams = new URLSearchParams(window.location.search)
    const authStatus = urlParams.get('auth')
    const authReason = urlParams.get('reason')
    const authDetails = urlParams.get('details')
    
    // Handle authentication result messages
    if (authStatus === 'success') {
      console.log('🎉 Authentication successful!')
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname)
    } else if (authStatus === 'error') {
      console.error('❌ Authentication failed:', authReason, authDetails)
      alert(`Authentication failed: ${authReason}\n${authDetails || 'Please try again'}`)
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    
    const fromAuth = urlParams.has('code') || urlParams.has('auth') || document.referrer.includes('login.microsoftonline.com')
    
    // If we just returned from auth, check immediately, otherwise add small delay
    const timer = setTimeout(() => {
      checkAuthStatus()
    }, fromAuth ? 100 : 1000)
    
    return () => clearTimeout(timer)
  }, [])

  const checkAuthStatus = async (retryCount = 0) => {
    try {
      console.log(`Checking authentication status... (attempt ${retryCount + 1})`)
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
          setIsAuthenticated(false)
          // Retry once more after a delay if this is the first attempt
          if (retryCount === 0) {
            console.log('Retrying authentication check in 2 seconds...')
            setTimeout(() => checkAuthStatus(1), 2000)
            return
          }
        }
      } else {
        console.log('Auth check failed with status:', response.status)
        setIsAuthenticated(false)
      }
    } catch (error) {
      console.log('Auth check error:', error)
      setIsAuthenticated(false)
    } finally {
      // Always set loading to false after the check completes
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
