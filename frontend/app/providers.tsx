'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getKey, setKey } from '@/lib/todoApi'

// The browser never holds a Microsoft token. It holds only the Aimelia access
// key (the same one Agent Tasks uses), sends it on every call, and asks the
// API whether Aimelia is connected to Microsoft 365.

interface AuthContextType {
  isAuthenticated: boolean
  needsKey: boolean
  authError: string | null
  user: any
  login: () => void
  logout: () => void
  saveKey: (key: string) => Promise<boolean>
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

const AUTH_ERRORS: Record<string, string> = {
  wrong_account: 'That Microsoft account is not the one allowed to connect Aimelia. Sign in with your own account.',
  invalid_state: 'That sign-in link had expired or did not start here. Start the sign-in again from this page.',
  owner_not_configured: 'AIMELIA_OWNER_EMAIL is not set on the server, so no account can connect yet.',
  token_storage_failed: 'Signed in, but the server could not store the connection safely. Check ENCRYPTION_KEY on Render.',
  access_denied: 'The permissions were declined. Sign in again and accept them.',
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [needsKey, setNeedsKey] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://aimelia-api.onrender.com'

  const checkAuthStatus = useCallback(async () => {
    if (!getKey()) {
      setNeedsKey(true)
      setIsAuthenticated(false)
      setLoading(false)
      return
    }
    try {
      const response = await fetch(`${apiBaseUrl}/auth/token`, { headers: { 'X-Aimelia-Key': getKey() } })
      if (response.status === 401) {
        setKey('')
        setNeedsKey(true)
        setIsAuthenticated(false)
      } else if (response.ok) {
        const data = await response.json()
        setNeedsKey(false)
        setIsAuthenticated(data.status === 'ok' && data.has_token)
      } else {
        setIsAuthenticated(false)
      }
    } catch {
      setIsAuthenticated(false)
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'error') {
      const reason = params.get('reason') || ''
      setAuthError(AUTH_ERRORS[reason] || `Sign-in failed (${reason || 'unknown reason'}). Try again.`)
    }
    if (params.has('auth')) window.history.replaceState({}, document.title, window.location.pathname)
    checkAuthStatus()
  }, [checkAuthStatus])

  const saveKey = async (key: string) => {
    setKey(key.trim())
    const response = await fetch(`${apiBaseUrl}/auth/token`, { headers: { 'X-Aimelia-Key': key.trim() } }).catch(() => null)
    if (!response || response.status === 401) {
      setKey('')
      return false
    }
    await checkAuthStatus()
    return true
  }

  const login = () => {
    window.location.href = `${apiBaseUrl}/auth/login`
  }

  const logout = async () => {
    try {
      await fetch(`${apiBaseUrl}/auth/revoke`, { method: 'POST', headers: { 'X-Aimelia-Key': getKey() } })
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      setIsAuthenticated(false)
      setUser(null)
    }
  }

  const makeRequest = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetch(`${apiBaseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Aimelia-Key': getKey(),
        ...options.headers,
      },
    })
    if (response.status === 401) {
      setKey('')
      setNeedsKey(true)
    }
    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`)
    }
    return response.json()
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, needsKey, authError, user, login, logout, saveKey, loading }}>
      <ApiContext.Provider value={{ apiBaseUrl, makeRequest }}>
        {children}
      </ApiContext.Provider>
    </AuthContext.Provider>
  )
}
