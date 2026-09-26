'use client'

import { useAuth } from './providers'
import { useState } from 'react'
import Dashboard from './dashboard/page'

export default function Home() {
  const { isAuthenticated, needsKey, loading } = useAuth()

  if (loading) {
    return <LoadingScreen />
  }

  if (needsKey) {
    return <KeyPage />
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

function KeyPage() {
  const { saveKey } = useAuth()
  const [key, setValue] = useState('')
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr('')
    if (!(await saveKey(key))) setErr('That key is not the one set on the server (AIMELIA_ACCESS_KEY).')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Aimelia access key</h1>
        <p className="text-gray-600 mb-6 text-sm">Enter the access key once. This browser will remember it. It is the same key as Agent Tasks.</p>
        <input type="password" autoFocus className="w-full border border-gray-300 rounded-lg p-2 mb-3" value={key}
          onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && key && submit()} aria-label="Access key" />
        {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
        <button onClick={submit} disabled={!key}
          className="w-full bg-blue-700 text-white py-3 rounded-xl font-semibold disabled:opacity-40">Continue</button>
      </div>
    </div>
  )
}

function LoginPage() {
  const { login, authError } = useAuth()

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

        {authError && <p className="text-sm text-red-600 mb-4">{authError}</p>}
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
