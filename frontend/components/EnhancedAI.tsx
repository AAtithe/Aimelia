'use client'

import { useState } from 'react'
import { useApi } from '../app/providers'

interface EnhancedAIProps {
  onClose: () => void
}

export function EnhancedAI({ onClose }: EnhancedAIProps) {
  const { makeRequest } = useApi()
  const [activeTab, setActiveTab] = useState<'triage' | 'draft' | 'brief' | 'knowledge'>('triage')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Form states
  const [emailData, setEmailData] = useState({
    subject: '',
    sender: '',
    body: '',
    client_context: {}
  })
  
  const [draftData, setDraftData] = useState({
    original_email: {
      subject: '',
      from: { emailAddress: { address: '' } },
      bodyPreview: ''
    },
    context: ''
  })

  const [briefData, setBriefData] = useState({
    event: {
      subject: '',
      attendees: [],
      start: { dateTime: '' }
    },
    recent_emails: []
  })

  const [knowledgeQuery, setKnowledgeQuery] = useState('')

  const handleEnhancedTriage = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest('/ai/emails/triage/enhanced', {
        method: 'POST',
        body: JSON.stringify(emailData)
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Triage failed')
    } finally {
      setLoading(false)
    }
  }

  const handleEnhancedDraft = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest('/ai/emails/drafts/enhanced', {
        method: 'POST',
        body: JSON.stringify(draftData)
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Draft generation failed')
    } finally {
      setLoading(false)
    }
  }

  const handleEnhancedBrief = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest('/ai/calendar/briefs/enhanced', {
        method: 'POST',
        body: JSON.stringify(briefData)
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Brief generation failed')
    } finally {
      setLoading(false)
    }
  }

  const handleKnowledgeSearch = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest(`/ai/knowledge/search?query=${encodeURIComponent(knowledgeQuery)}&top_k=5`)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Knowledge search failed')
    } finally {
      setLoading(false)
    }
  }

  const renderTriageForm = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email Subject</label>
        <input
          type="text"
          value={emailData.subject}
          onChange={(e) => setEmailData({...emailData, subject: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter email subject..."
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Sender</label>
        <input
          type="email"
          value={emailData.sender}
          onChange={(e) => setEmailData({...emailData, sender: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="sender@example.com"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email Body</label>
        <textarea
          value={emailData.body}
          onChange={(e) => setEmailData({...emailData, body: e.target.value})}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter email content..."
        />
      </div>
      <button
        onClick={handleEnhancedTriage}
        disabled={loading}
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Analyzing...' : 'Analyze with Context'}
      </button>
    </div>
  )

  const renderDraftForm = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Original Subject</label>
        <input
          type="text"
          value={draftData.original_email.subject}
          onChange={(e) => setDraftData({
            ...draftData,
            original_email: {...draftData.original_email, subject: e.target.value}
          })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter original email subject..."
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
        <input
          type="email"
          value={draftData.original_email.from.emailAddress.address}
          onChange={(e) => setDraftData({
            ...draftData,
            original_email: {
              ...draftData.original_email,
              from: { emailAddress: { address: e.target.value } }
            }
          })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="sender@example.com"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Original Body</label>
        <textarea
          value={draftData.original_email.bodyPreview}
          onChange={(e) => setDraftData({
            ...draftData,
            original_email: {...draftData.original_email, bodyPreview: e.target.value}
          })}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter original email content..."
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Additional Context</label>
        <textarea
          value={draftData.context}
          onChange={(e) => setDraftData({...draftData, context: e.target.value})}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Any additional context for the response..."
        />
      </div>
      <button
        onClick={handleEnhancedDraft}
        disabled={loading}
        className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? 'Generating...' : 'Generate Context-Aware Draft'}
      </button>
    </div>
  )

  const renderBriefForm = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Meeting Title</label>
        <input
          type="text"
          value={briefData.event.subject}
          onChange={(e) => setBriefData({
            ...briefData,
            event: {...briefData.event, subject: e.target.value}
          })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter meeting title..."
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Attendees (comma-separated)</label>
        <input
          type="text"
          value={briefData.event.attendees.join(', ')}
          onChange={(e) => setBriefData({
            ...briefData,
            event: {
              ...briefData.event,
              attendees: e.target.value.split(',').map(email => ({ emailAddress: { address: email.trim() } }))
            }
          })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="ceo@client.com, cfo@client.com"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
        <input
          type="datetime-local"
          value={briefData.event.start.dateTime}
          onChange={(e) => setBriefData({
            ...briefData,
            event: {
              ...briefData.event,
              start: { dateTime: e.target.value }
            }
          })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <button
        onClick={handleEnhancedBrief}
        disabled={loading}
        className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 disabled:opacity-50"
      >
        {loading ? 'Generating...' : 'Generate Context-Aware Brief'}
      </button>
    </div>
  )

  const renderKnowledgeForm = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Search Query</label>
        <input
          type="text"
          value={knowledgeQuery}
          onChange={(e) => setKnowledgeQuery(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search knowledge base..."
        />
      </div>
      <button
        onClick={handleKnowledgeSearch}
        disabled={loading || !knowledgeQuery.trim()}
        className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? 'Searching...' : 'Search Knowledge Base'}
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-2xl font-bold text-gray-900">Enhanced AI Features</h2>
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
              {[
                { id: 'triage', label: 'Enhanced Triage', icon: '📧' },
                { id: 'draft', label: 'Smart Drafts', icon: '✍️' },
                { id: 'brief', label: 'Meeting Briefs', icon: '📅' },
                { id: 'knowledge', label: 'Knowledge Search', icon: '🧠' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium ${
                    activeTab === tab.id
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className="mr-2">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-2xl">
              {activeTab === 'triage' && renderTriageForm()}
              {activeTab === 'draft' && renderDraftForm()}
              {activeTab === 'brief' && renderBriefForm()}
              {activeTab === 'knowledge' && renderKnowledgeForm()}

              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-red-600">{error}</p>
                </div>
              )}

              {result && (
                <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-md">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Result</h3>
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
