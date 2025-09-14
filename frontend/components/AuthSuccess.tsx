'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface AuthSuccessProps {
  onContinue: () => void
}

export function AuthSuccess({ onContinue }: AuthSuccessProps) {
  const router = useRouter()
  const [countdown, setCountdown] = useState(3)

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          onContinue()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [onContinue])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        {/* Success Animation */}
        <div className="mb-8">
          <div className="w-24 h-24 bg-gradient-to-r from-green-500 to-blue-600 rounded-full mx-auto mb-6 flex items-center justify-center animate-pulse">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Welcome to Aimelia!</h1>
          <p className="text-gray-600 text-lg">
            Your AI-powered personal assistant is now ready
          </p>
        </div>

        {/* Success Message */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mr-4">
              <span className="text-green-600 text-xl">✓</span>
            </div>
            <div className="text-left">
              <h3 className="text-lg font-semibold text-green-900">Authentication Successful</h3>
              <p className="text-green-700">Your Microsoft 365 account is now connected</p>
            </div>
          </div>
        </div>

        {/* Features Preview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-2xl mb-2">📧</div>
            <h4 className="font-semibold text-blue-900 mb-1">Smart Email Triage</h4>
            <p className="text-blue-700 text-sm">AI-powered email processing and reply drafting</p>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="text-2xl mb-2">📅</div>
            <h4 className="font-semibold text-purple-900 mb-1">Meeting Preparation</h4>
            <p className="text-purple-700 text-sm">Star-level briefs for every meeting</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-2xl mb-2">🤖</div>
            <h4 className="font-semibold text-green-900 mb-1">Background Automation</h4>
            <p className="text-green-700 text-sm">Aimelia works around the clock for you</p>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <div className="text-2xl mb-2">🧠</div>
            <h4 className="font-semibold text-orange-900 mb-1">AI Intelligence</h4>
            <p className="text-orange-700 text-sm">Context-aware responses in your voice</p>
          </div>
        </div>

        {/* Countdown and Action */}
        <div className="mb-6">
          <p className="text-gray-600 mb-4">
            Redirecting to your dashboard in <span className="font-bold text-blue-600">{countdown}</span> seconds...
          </p>
          <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
            <div 
              className="bg-gradient-to-r from-blue-600 to-purple-600 h-2 rounded-full transition-all duration-1000"
              style={{ width: `${((3 - countdown) / 3) * 100}%` }}
            ></div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={onContinue}
            className="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-8 rounded-xl font-semibold hover:from-blue-700 hover:to-purple-700 transition-all duration-200 transform hover:scale-105"
          >
            Continue to Dashboard
          </button>
          <button
            onClick={() => router.push('/')}
            className="bg-gray-100 text-gray-700 py-3 px-8 rounded-xl font-semibold hover:bg-gray-200 transition-all duration-200"
          >
            Start Over
          </button>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-500">
            Powered by Williams, Stanley & Co AI Technology
          </p>
        </div>
      </div>
    </div>
  )
}
