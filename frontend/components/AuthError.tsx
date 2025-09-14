'use client'

import { useRouter } from 'next/navigation'

interface AuthErrorProps {
  error: string
  message: string
  details?: string
  onRetry: () => void
}

export function AuthError({ error, message, details, onRetry }: AuthErrorProps) {
  const router = useRouter()

  const getErrorIcon = (errorType: string) => {
    switch (errorType) {
      case 'unauthorized':
        return '🔐'
      case 'access_denied':
        return '🚫'
      case 'invalid_client':
        return '⚙️'
      case 'server_error':
        return '🔧'
      default:
        return '❌'
    }
  }

  const getErrorTitle = (errorType: string) => {
    switch (errorType) {
      case 'unauthorized':
        return 'Authentication Failed'
      case 'access_denied':
        return 'Access Denied'
      case 'invalid_client':
        return 'Configuration Error'
      case 'server_error':
        return 'Server Error'
      default:
        return 'Something Went Wrong'
    }
  }

  const getErrorDescription = (errorType: string) => {
    switch (errorType) {
      case 'unauthorized':
        return 'There was an issue with your Microsoft 365 credentials. This might be due to an expired session or configuration problem.'
      case 'access_denied':
        return 'You declined to grant Aimelia the necessary permissions. Please try again and accept all required permissions.'
      case 'invalid_client':
        return 'There\'s a configuration issue with Aimelia\'s Microsoft 365 integration. Our team has been notified.'
      case 'server_error':
        return 'Aimelia encountered a temporary issue. Please try again in a few moments.'
      default:
        return 'An unexpected error occurred while trying to sign you in.'
    }
  }

  const getActionSteps = (errorType: string) => {
    switch (errorType) {
      case 'unauthorized':
        return [
          'Check if you\'re signed in to the correct Microsoft 365 account',
          'Try signing out and signing back in',
          'Contact your IT administrator if the issue persists'
        ]
      case 'access_denied':
        return [
          'Click "Try Again" and accept all permissions when prompted',
          'Make sure you\'re using your work Microsoft 365 account',
          'Contact your IT administrator if you need help with permissions'
        ]
      case 'invalid_client':
        return [
          'This is a configuration issue on our end',
          'Our technical team has been automatically notified',
          'Please try again in a few minutes'
        ]
      case 'server_error':
        return [
          'Wait a moment and try again',
          'Check your internet connection',
          'Contact support if the problem continues'
        ]
      default:
        return [
          'Try refreshing the page',
          'Clear your browser cache',
          'Contact support if the issue persists'
        ]
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        {/* Logo */}
        <div className="mb-8">
          <div className="w-20 h-20 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl mx-auto mb-4 flex items-center justify-center">
            <span className="text-3xl font-bold text-white">A</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Aimelia</h1>
          <p className="text-gray-600">Your AI-powered personal assistant</p>
        </div>

        {/* Error Icon and Title */}
        <div className="mb-6">
          <div className="text-6xl mb-4">{getErrorIcon(error)}</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {getErrorTitle(error)}
          </h2>
          <p className="text-gray-600 text-lg">
            {getErrorDescription(error)}
          </p>
        </div>

        {/* Error Details */}
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-left">
          <h3 className="font-semibold text-red-900 mb-2">Error Details:</h3>
          <p className="text-red-800 text-sm mb-2">
            <strong>Error:</strong> {error}
          </p>
          <p className="text-red-800 text-sm mb-2">
            <strong>Message:</strong> {message}
          </p>
          {details && (
            <p className="text-red-800 text-sm">
              <strong>Details:</strong> {details}
            </p>
          )}
        </div>

        {/* Action Steps */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-left">
          <h3 className="font-semibold text-blue-900 mb-3">What you can do:</h3>
          <ul className="text-blue-800 text-sm space-y-2">
            {getActionSteps(error).map((step, index) => (
              <li key={index} className="flex items-start">
                <span className="text-blue-600 mr-2">•</span>
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={onRetry}
            className="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-8 rounded-xl font-semibold hover:from-blue-700 hover:to-purple-700 transition-all duration-200 transform hover:scale-105"
          >
            Try Again
          </button>
          <button
            onClick={() => router.push('/')}
            className="bg-gray-100 text-gray-700 py-3 px-8 rounded-xl font-semibold hover:bg-gray-200 transition-all duration-200"
          >
            Go Home
          </button>
        </div>

        {/* Support Information */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-500 mb-2">
            Need help? Contact your IT administrator or
          </p>
          <p className="text-sm text-gray-500">
            Williams, Stanley & Co Technical Support
          </p>
        </div>
      </div>
    </div>
  )
}
