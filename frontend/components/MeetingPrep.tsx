'use client'

import { useState } from 'react'
import { useApi } from '../app/providers'

interface MeetingPrepProps {
  onClose: () => void
}

export function MeetingPrep({ onClose }: MeetingPrepProps) {
  const { makeRequest } = useApi()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Form states
  const [testData, setTestData] = useState({
    subject: '',
    start_time: '',
    attendees: '',
    location: ''
  })

  const handlePrepNext24h = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest('/prep/prep/next24h', {
        method: 'POST'
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Meeting prep failed')
    } finally {
      setLoading(false)
    }
  }

  const handleTestPrep = async () => {
    setLoading(true)
    setError(null)
    try {
      const attendees = testData.attendees.split(',').map(email => email.trim()).filter(Boolean)
      const response = await makeRequest('/prep/prep/test', {
        method: 'POST',
        body: JSON.stringify({
          ...testData,
          attendees
        })
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test prep failed')
    } finally {
      setLoading(false)
    }
  }

  const handleGetGuidelines = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest('/prep/prep/guidelines')
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get guidelines')
    } finally {
      setLoading(false)
    }
  }

  const renderMainPrep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-6xl mb-4">🌟</div>
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Prep Me Like a Star</h3>
        <p className="text-gray-600 mb-6">
          Automatically generate comprehensive meeting briefs for your next 24 hours of meetings.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 mb-2">What You'll Get:</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• <strong>Snapshot:</strong> Time, attendees, location</li>
          <li>• <strong>Recent Comms:</strong> Key background communications</li>
          <li>• <strong>Open Actions:</strong> Outstanding items to address</li>
          <li>• <strong>5 Talking Points:</strong> Critical discussion topics</li>
          <li>• <strong>Risks:</strong> Potential challenges and sensitive topics</li>
          <li>• <strong>Next Steps:</strong> Clear action items and follow-ups</li>
        </ul>
      </div>

      <div className="flex space-x-4">
        <button
          onClick={handlePrepNext24h}
          disabled={loading}
          className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {loading ? 'Preparing...' : 'Prep Next 24h Meetings'}
        </button>
        
        <button
          onClick={handleGetGuidelines}
          disabled={loading}
          className="flex-1 bg-gray-600 text-white py-3 px-6 rounded-lg hover:bg-gray-700 disabled:opacity-50 font-medium"
        >
          View Guidelines
        </button>
      </div>
    </div>
  )

  const renderTestForm = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Test Meeting Preparation</h3>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Meeting Subject</label>
        <input
          type="text"
          value={testData.subject}
          onChange={(e) => setTestData({...testData, subject: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Q3 Board Review - Public House Group"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
        <input
          type="datetime-local"
          value={testData.start_time}
          onChange={(e) => setTestData({...testData, start_time: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Attendees (comma-separated emails)</label>
        <input
          type="text"
          value={testData.attendees}
          onChange={(e) => setTestData({...testData, attendees: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="ceo@client.com, cfo@client.com, tom@williamsstanley.co"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
        <input
          type="text"
          value={testData.location}
          onChange={(e) => setTestData({...testData, location: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Conference Room A / Microsoft Teams"
        />
      </div>

      <button
        onClick={handleTestPrep}
        disabled={loading || !testData.subject}
        className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? 'Generating...' : 'Generate Test Brief'}
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-2xl font-bold text-gray-900">Meeting Preparation</h2>
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
                🌟 Prep Next 24h
              </button>
              <button className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100">
                🧪 Test Prep
              </button>
            </nav>
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-2xl">
              {renderMainPrep()}

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
                  
                  {result.success && result.brief_content && (
                    <div className="mb-4">
                      <h5 className="font-medium text-gray-700 mb-2">Generated Brief:</h5>
                      <div className="bg-white p-4 rounded border text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
                        {result.brief_content}
                      </div>
                      <div className="mt-2 text-sm text-gray-600">
                        Word count: {result.word_count} | 
                        Meets requirements: {result.meets_requirements ? '✅' : '❌'}
                      </div>
                    </div>
                  )}

                  {result.meetings_prepared !== undefined && (
                    <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
                      <h5 className="font-medium text-green-800 mb-1">✅ Preparation Complete</h5>
                      <p className="text-green-700 text-sm">
                        Prepared {result.meetings_prepared} out of {result.total_meetings} meetings
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
