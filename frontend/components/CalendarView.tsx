'use client'

import { useState, useEffect } from 'react'
import { useApi } from '@/app/providers'
import { Calendar, Clock, Users, MapPin, Video } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'

interface Event {
  id: string
  subject: string
  start: { dateTime: string }
  end: { dateTime: string }
  location?: { displayName: string }
  attendees?: Array<{ emailAddress: { address: string } }>
  isOnlineMeeting?: boolean
  onlineMeeting?: { joinUrl: string }
}

interface CalendarViewProps {
  onRefresh: () => void
}

export function CalendarView({ onRefresh }: CalendarViewProps) {
  const { makeRequest } = useApi()
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadEvents()
  }, [])

  const loadEvents = async () => {
    setLoading(true)
    try {
      const response = await makeRequest('/calendar/next24')
      setEvents(response.value || [])
      toast.success(`Loaded ${response.value?.length || 0} upcoming events`)
    } catch (error) {
      console.error('Failed to load events:', error)
      toast.error('Failed to load calendar events')
    } finally {
      setLoading(false)
    }
  }

  const getTimeUntilEvent = (startTime: string) => {
    const now = new Date()
    const eventTime = parseISO(startTime)
    const diffMs = eventTime.getTime() - now.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    
    if (diffHours > 0) {
      return `${diffHours}h ${diffMinutes}m`
    } else if (diffMinutes > 0) {
      return `${diffMinutes}m`
    } else {
      return 'Now'
    }
  }

  const isEventStartingSoon = (startTime: string) => {
    const now = new Date()
    const eventTime = parseISO(startTime)
    const diffMs = eventTime.getTime() - now.getTime()
    return diffMs > 0 && diffMs < 30 * 60 * 1000 // 30 minutes
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Calendar</h2>
          <p className="text-gray-600">Your upcoming meetings and events</p>
        </div>
        <button
          onClick={loadEvents}
          disabled={loading}
          className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          <Calendar className="w-4 h-4" />
          <span>{loading ? 'Loading...' : 'Refresh Calendar'}</span>
        </button>
      </div>

      {/* Events List */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading calendar events...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500">No upcoming events in the next 24 hours</p>
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-all duration-200 hover:shadow-md ${
                isEventStartingSoon(event.start.dateTime) ? 'ring-2 ring-orange-200 bg-orange-50' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-3 mb-3">
                    <h3 className="text-xl font-semibold text-gray-900 truncate">
                      {event.subject}
                    </h3>
                    {isEventStartingSoon(event.start.dateTime) && (
                      <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded-full">
                        Starting Soon
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center space-x-3 text-gray-600">
                      <Clock className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium">
                          {format(parseISO(event.start.dateTime), 'h:mm a')} - {format(parseISO(event.end.dateTime), 'h:mm a')}
                        </p>
                        <p className="text-xs text-gray-500">
                          {getTimeUntilEvent(event.start.dateTime)} until start
                        </p>
                      </div>
                    </div>

                    {event.location?.displayName && (
                      <div className="flex items-center space-x-3 text-gray-600">
                        <MapPin className="w-5 h-5 text-gray-400" />
                        <p className="text-sm">{event.location.displayName}</p>
                      </div>
                    )}

                    {event.isOnlineMeeting && event.onlineMeeting?.joinUrl && (
                      <div className="flex items-center space-x-3 text-gray-600">
                        <Video className="w-5 h-5 text-gray-400" />
                        <a
                          href={event.onlineMeeting.joinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:text-blue-800 underline"
                        >
                          Join Meeting
                        </a>
                      </div>
                    )}

                    {event.attendees && event.attendees.length > 0 && (
                      <div className="flex items-center space-x-3 text-gray-600">
                        <Users className="w-5 h-5 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium">
                            {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}
                          </p>
                          <p className="text-xs text-gray-500">
                            {event.attendees.slice(0, 3).map(a => a.emailAddress.address).join(', ')}
                            {event.attendees.length > 3 && ` +${event.attendees.length - 3} more`}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="ml-4 flex flex-col items-end space-y-2">
                  <span className="text-sm text-gray-500">
                    {format(parseISO(event.start.dateTime), 'MMM d')}
                  </span>
                  <button className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full hover:bg-blue-200 transition-colors">
                    Generate Brief
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
