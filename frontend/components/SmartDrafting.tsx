'use client'

import { useState } from 'react'
import { useApi } from '../app/providers'

interface SmartDraftingProps {
  onClose: () => void
}

export function SmartDrafting({ onClose }: SmartDraftingProps) {
  const { makeRequest } = useApi()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Form states
  const [draftData, setDraftData] = useState({
    email_id: '',
    subject: '',
    thread_summary: '',
    sender: '',
    body: ''
  })

  const [testData, setTestData] = useState({
    subject: '',
    sender: '',
    body: '',
    thread_summary: ''
  })

  const handleSmartDraft = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest('/draft/smart-reply', {
        method: 'POST',
        body: JSON.stringify(draftData)
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smart drafting failed')
    } finally {
      setLoading(false)
    }
  }

  const handleTestDraft = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest('/draft/test', {
        method: 'POST',
        body: JSON.stringify(testData)
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test drafting failed')
    } finally {
      setLoading(false)
    }
  }

  const handleAutoProcess = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest('/draft/auto-process', {
        method: 'POST',
        body: JSON.stringify({ email_id: draftData.email_id })
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto processing failed')
    } finally {
      setLoading(false)
    }
  }

  const renderSmartDraftForm = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Smart Email Drafting</h3>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email ID</label>
        <input
          type="text"
          value={draftData.email_id}
          onChange={(e) => setDraftData({...draftData, email_id: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter Microsoft Graph email ID..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
        <input
          type="text"
          value={draftData.subject}
          onChange={(e) => setDraftData({...draftData, subject: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter email subject..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Thread Summary</label>
        <textarea
          value={draftData.thread_summary}
          onChange={(e) => setDraftData({...draftData, thread_summary: e.target.value})}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Brief summary of the email thread..."
        />
      </div>

      <div className="flex space-x-2">
        <button
          onClick={handleSmartDraft}
          disabled={loading || !draftData.email_id}
          className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Drafting...' : 'Draft Smart Reply'}
        </button>
        
        <button
          onClick={handleAutoProcess}
          disabled={loading || !draftData.email_id}
          className="flex-1 bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Auto Process'}
        </button>
      </div>
    </div>
  )

  const renderTestForm = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Test Draft Generation</h3>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
        <input
          type="text"
          value={testData.subject}
          onChange={(e) => setTestData({...testData, subject: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Test email subject..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Sender</label>
        <input
          type="email"
          value={testData.sender}
          onChange={(e) => setTestData({...testData, sender: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="sender@example.com"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email Body</label>
        <textarea
          value={testData.body}
          onChange={(e) => setTestData({...testData, body: e.target.value})}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Original email content..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Thread Summary</label>
        <textarea
          value={testData.thread_summary}
          onChange={(e) => setTestData({...testData, thread_summary: e.target.value})}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Thread context..."
        />
      </div>

      <button
        onClick={handleTestDraft}
        disabled={loading}
        className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 disabled:opacity-50"
      >
        {loading ? 'Generating...' : 'Generate Test Draft'}
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-2xl font-bold text-gray-900">Smart Email Drafting</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex h-[calc(90vh-120px)]">
          {/* Sidebar */}
          <div className="w-64 bg-gray-50 border-r p-4">
            <nav className="space-y-2">
              <button className="w-full text-left px-3 py-2 rounded-md text-sm font-medium bg-blue-100 text-blue-700">
                📧 Smart Drafting
              </button>
              <button className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100">
                🧪 Test Generation
              </button>
            </nav>
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-2xl">
              {renderSmartDraftForm()}

              <div className="mt-8 pt-6 border-t">
                {renderTestForm()}
              </div>

              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-red-600">{error}</p>
                </div>
              )}

              {result && (
                <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-md">
                  <h4 className="text-lg font-medium text-gray-900 mb-2">Result</h4>
                  
                  {result.success && result.draft_content && (
                    <div className="mb-4">
                      <h5 className="font-medium text-gray-700 mb-2">Generated Draft:</h5>
                      <div className="bg-white p-3 rounded border text-sm whitespace-pre-wrap">
                        {result.draft_content}
                      </div>
                      <div className="mt-2 text-sm text-gray-600">
                        Word count: {result.word_count} | 
                        Meets requirements: {result.meets_requirements ? '✅' : '❌'}
                      </div>
                    </div>
                  )}

                  {result.sensitive_topics && result.sensitive_topics.length > 0 && (
                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <h5 className="font-medium text-yellow-800 mb-1">⚠️ Sensitive Topics Detected:</h5>
                      <p className="text-yellow-700 text-sm">
                        {result.sensitive_topics.join(', ')}
                      </p>
                    </div>
                  )}

                  <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
