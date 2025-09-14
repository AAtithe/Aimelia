'use client'

import { useState, useEffect } from 'react'
import { useApi } from '@/app/providers'
import { Mail, Clock, AlertTriangle, CheckCircle, Brain, Filter } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

interface Email {
  id: string
  subject: string
  from: string
  received: string
  triage: {
    category: string
    urgency: number
    confidence: number
    method: string
    reasoning: string
  }
}

interface EmailTriageProps {
  onRefresh: () => void
}

export function EmailTriage({ onRefresh }: EmailTriageProps) {
  const { makeRequest } = useApi()
  const [emails, setEmails] = useState<Email[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null)

  useEffect(() => {
    loadEmails()
  }, [])

  const loadEmails = async () => {
    setLoading(true)
    try {
      const response = await makeRequest('/emails/triage/run', { method: 'POST' })
      setEmails(response.triaged_emails || [])
      toast.success(`Processed ${response.message_count} emails`)
    } catch (error) {
      console.error('Failed to load emails:', error)
      toast.error('Failed to load emails')
    } finally {
      setLoading(false)
    }
  }

  const getUrgencyColor = (urgency: number) => {
    if (urgency >= 5) return 'text-red-600 bg-red-50 border-red-200'
    if (urgency >= 4) return 'text-orange-600 bg-orange-50 border-orange-200'
    if (urgency >= 3) return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    return 'text-green-600 bg-green-50 border-green-200'
  }

  const getUrgencyIcon = (urgency: number) => {
    if (urgency >= 5) return <AlertTriangle className="w-4 h-4" />
    if (urgency >= 4) return <Clock className="w-4 h-4" />
    return <CheckCircle className="w-4 h-4" />
  }

  const getCategoryColor = (category: string) => {
    const colors: { [key: string]: string } = {
      'Urgent': 'bg-red-100 text-red-800',
      'Important': 'bg-orange-100 text-orange-800',
      'Payroll': 'bg-blue-100 text-blue-800',
      'Tax': 'bg-green-100 text-green-800',
      'Scheduling': 'bg-purple-100 text-purple-800',
      'General': 'bg-gray-100 text-gray-800',
      'Automated': 'bg-yellow-100 text-yellow-800',
    }
    return colors[category] || 'bg-gray-100 text-gray-800'
  }

  const filteredEmails = emails.filter(email => {
    if (filter === 'all') return true
    if (filter === 'urgent') return email.triage.urgency >= 4
    if (filter === 'ai') return email.triage.method === 'ai'
    if (filter === 'rules') return email.triage.method === 'rules'
    return email.triage.category.toLowerCase() === filter.toLowerCase()
  })

  const analyzeEmail = async (emailId: string) => {
    try {
      const response = await makeRequest(`/emails/analyze/${emailId}`, { method: 'POST' })
      toast.success('Email analysis completed')
      // You could show a modal with detailed analysis here
    } catch (error) {
      console.error('Failed to analyze email:', error)
      toast.error('Failed to analyze email')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Email Triage</h2>
          <p className="text-gray-600">AI-powered email classification and prioritization</p>
        </div>
        <button
          onClick={loadEmails}
          disabled={loading}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Mail className="w-4 h-4" />
          <span>{loading ? 'Processing...' : 'Refresh Emails'}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-4">
        <Filter className="w-5 h-5 text-gray-500" />
        <div className="flex space-x-2">
          {['all', 'urgent', 'ai', 'rules'].map((filterType) => (
            <button
              key={filterType}
              onClick={() => setFilter(filterType)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                filter === filterType
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {filterType.charAt(0).toUpperCase() + filterType.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Email List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Processing emails with AI...</p>
          </div>
        ) : filteredEmails.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Mail className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No emails found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredEmails.map((email) => (
              <div
                key={email.id}
                className="p-6 hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => setSelectedEmail(email)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">
                        {email.subject}
                      </h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(email.triage.category)}`}>
                        {email.triage.category}
                      </span>
                    </div>
                    
                    <div className="flex items-center space-x-4 text-sm text-gray-600 mb-3">
                      <span className="font-medium">{email.from}</span>
                      <span>•</span>
                      <span>{format(new Date(email.received), 'MMM d, h:mm a')}</span>
                    </div>

                    <div className="flex items-center space-x-4">
                      <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${getUrgencyColor(email.triage.urgency)}`}>
                        {getUrgencyIcon(email.triage.urgency)}
                        <span>Urgency {email.triage.urgency}/5</span>
                      </div>
                      
                      <div className="flex items-center space-x-1 text-xs text-gray-500">
                        <Brain className="w-3 h-3" />
                        <span>{email.triage.method === 'ai' ? 'AI' : 'Rules'}</span>
                        <span>({Math.round(email.triage.confidence * 100)}%)</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        analyzeEmail(email.id)
                      }}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Brain className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Email Detail Modal */}
      {selectedEmail && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Email Analysis</h3>
                <button
                  onClick={() => setSelectedEmail(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Subject</h4>
                <p className="text-gray-700">{selectedEmail.subject}</p>
              </div>
              
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">From</h4>
                <p className="text-gray-700">{selectedEmail.from}</p>
              </div>
              
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">AI Analysis</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Category</p>
                    <p className="font-medium">{selectedEmail.triage.category}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Urgency</p>
                    <p className="font-medium">{selectedEmail.triage.urgency}/5</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Confidence</p>
                    <p className="font-medium">{Math.round(selectedEmail.triage.confidence * 100)}%</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Method</p>
                    <p className="font-medium">{selectedEmail.triage.method}</p>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Reasoning</h4>
                <p className="text-gray-700 text-sm">{selectedEmail.triage.reasoning}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
