'use client'

import { useState, useEffect } from 'react'
import { useApi } from '@/app/providers'
import { FileText, Calendar, Users, Brain, Download, RefreshCw } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'

interface Brief {
  event_id: string
  subject: string
  start_time: string
  attendees: string[]
  brief_html: string
  metadata: {
    subject: string
    start_time: string
    end_time: string
    location: string
    attendees: string[]
    organizer: string
    body: string
    is_online: boolean
    meeting_url: string
  }
}

interface MeetingBriefsProps {
  onRefresh: () => void
}

export function MeetingBriefs({ onRefresh }: MeetingBriefsProps) {
  const { makeRequest } = useApi()
  const [briefs, setBriefs] = useState<Brief[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState<string | null>(null)

  useEffect(() => {
    loadBriefs()
  }, [])

  const loadBriefs = async () => {
    setLoading(true)
    try {
      const response = await makeRequest('/calendar/briefs/upcoming')
      setBriefs(response.briefs || [])
      toast.success(`Generated ${response.briefs_count} meeting briefs`)
    } catch (error) {
      console.error('Failed to load briefs:', error)
      toast.error('Failed to load meeting briefs')
    } finally {
      setLoading(false)
    }
  }

  const generateBrief = async (eventId: string) => {
    setGenerating(eventId)
    try {
      const response = await makeRequest(`/calendar/brief/${eventId}`, { method: 'POST' })
      toast.success('Meeting brief generated successfully')
      // Refresh the briefs list
      loadBriefs()
    } catch (error) {
      console.error('Failed to generate brief:', error)
      toast.error('Failed to generate meeting brief')
    } finally {
      setGenerating(null)
    }
  }

  const downloadBrief = (brief: Brief) => {
    const element = document.createElement('a')
    const file = new Blob([brief.brief_html], { type: 'text/html' })
    element.href = URL.createObjectURL(file)
    element.download = `${brief.subject.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_brief.html`
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Meeting Briefs</h2>
          <p className="text-gray-600">AI-generated meeting preparation and insights</p>
        </div>
        <button
          onClick={loadBriefs}
          disabled={loading}
          className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Loading...' : 'Refresh Briefs'}</span>
        </button>
      </div>

      {/* Briefs List */}
      <div className="space-y-6">
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Generating meeting briefs with AI...</p>
          </div>
        ) : briefs.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500 mb-4">No meeting briefs available</p>
            <button
              onClick={loadBriefs}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
            >
              Generate Briefs
            </button>
          </div>
        ) : (
          briefs.map((brief) => (
            <div key={brief.event_id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Brief Header */}
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">
                      {brief.subject}
                    </h3>
                    
                    <div className="flex items-center space-x-6 text-sm text-gray-600">
                      <div className="flex items-center space-x-2">
                        <Calendar className="w-4 h-4" />
                        <span>{format(parseISO(brief.start_time), 'MMM d, h:mm a')}</span>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <Users className="w-4 h-4" />
                        <span>{brief.attendees.length} attendee{brief.attendees.length !== 1 ? 's' : ''}</span>
                      </div>
                      
                      {brief.metadata.is_online && (
                        <div className="flex items-center space-x-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                          <span>Online Meeting</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={() => downloadBrief(brief)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Download Brief"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    
                    <button
                      onClick={() => generateBrief(brief.event_id)}
                      disabled={generating === brief.event_id}
                      className="flex items-center space-x-2 px-3 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 disabled:opacity-50"
                    >
                      <Brain className={`w-4 h-4 ${generating === brief.event_id ? 'animate-spin' : ''}`} />
                      <span className="text-sm">
                        {generating === brief.event_id ? 'Generating...' : 'Regenerate'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Brief Content */}
              <div className="p-6">
                <div 
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: brief.brief_html }}
                />
              </div>

              {/* Brief Metadata */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="font-medium text-gray-900 mb-1">Attendees</p>
                    <p className="text-gray-600">
                      {brief.attendees.slice(0, 3).join(', ')}
                      {brief.attendees.length > 3 && ` +${brief.attendees.length - 3} more`}
                    </p>
                  </div>
                  
                  {brief.metadata.location && (
                    <div>
                      <p className="font-medium text-gray-900 mb-1">Location</p>
                      <p className="text-gray-600">{brief.metadata.location}</p>
                    </div>
                  )}
                  
                  {brief.metadata.meeting_url && (
                    <div>
                      <p className="font-medium text-gray-900 mb-1">Meeting Link</p>
                      <a
                        href={brief.metadata.meeting_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 underline"
                      >
                        Join Meeting
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
