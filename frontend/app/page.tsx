'use client'

import { useAuth } from './providers'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Dashboard from './dashboard/page'

export default function Home() {
  const { isAuthenticated, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      // Show login page
    }
  }, [isAuthenticated, loading])

  if (loading) {
    return <LoadingScreen />
  }

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return <Dashboard />
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-gray-700">Loading Aimelia...</h2>
        <p className="text-gray-500 mt-2">Setting up your AI assistant</p>
      </div>
    </div>
  )
}

function LoginPage() {
  const { login } = useAuth()

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="mb-8">
          <div className="w-16 h-16 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl mx-auto mb-4 flex items-center justify-center">
            <span className="text-2xl font-bold text-white">A</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome to Aimelia</h1>
          <p className="text-gray-600">Your AI-powered personal assistant for Microsoft 365</p>
        </div>

        <div className="space-y-4 mb-8">
          <div className="flex items-center space-x-3 text-left">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-green-600 text-sm">✓</span>
            </div>
            <span className="text-gray-700">Intelligent email triage</span>
          </div>
          <div className="flex items-center space-x-3 text-left">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-green-600 text-sm">✓</span>
            </div>
            <span className="text-gray-700">AI-powered meeting briefs</span>
          </div>
          <div className="flex items-center space-x-3 text-left">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-green-600 text-sm">✓</span>
            </div>
            <span className="text-gray-700">Smart calendar management</span>
          </div>
        </div>

        <button
          onClick={login}
          className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-6 rounded-xl font-semibold hover:from-blue-700 hover:to-purple-700 transition-all duration-200 transform hover:scale-105"
        >
          Sign in with Microsoft
        </button>

        <p className="text-xs text-gray-500 mt-4">
          By signing in, you agree to our terms of service and privacy policy
        </p>
      </div>
    </div>
  )
}
