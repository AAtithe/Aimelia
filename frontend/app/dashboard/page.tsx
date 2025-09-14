'use client'

import { useState, useEffect } from 'react'
import { useAuth, useApi } from '../providers'
import { Sidebar } from '@/components/Sidebar'
import { Header } from '@/components/Header'
import { EmailTriage } from '@/components/EmailTriage'
import { CalendarView } from '@/components/CalendarView'
import { MeetingBriefs } from '@/components/MeetingBriefs'
import { Analytics } from '@/components/Analytics'
import { EnhancedAI } from '@/components/EnhancedAI'
import { SmartDrafting } from '@/components/SmartDrafting'
import { MeetingPrep } from '@/components/MeetingPrep'
import { SchedulerControl } from '@/components/SchedulerControl'
import toast from 'react-hot-toast'

type TabType = 'emails' | 'calendar' | 'briefs' | 'analytics' | 'ai' | 'drafting' | 'prep' | 'automation'

export default function Dashboard() {
  const { isAuthenticated, logout } = useAuth()
  const { makeRequest } = useApi()
  const [activeTab, setActiveTab] = useState<TabType>('emails')
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState({
    totalEmails: 0,
    urgentEmails: 0,
    upcomingMeetings: 0,
    briefsGenerated: 0
  })
  const [showEnhancedAI, setShowEnhancedAI] = useState(false)
  const [showSmartDrafting, setShowSmartDrafting] = useState(false)
  const [showMeetingPrep, setShowMeetingPrep] = useState(false)
  const [showSchedulerControl, setShowSchedulerControl] = useState(false)

  useEffect(() => {
    if (isAuthenticated) {
      loadDashboardData()
    }
  }, [isAuthenticated])

  // Show login prompt if not authenticated
  if (!isAuthenticated && !loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mx-auto mb-6 flex items-center justify-center">
            <span className="text-white text-2xl">🤖</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Welcome to Aimelia</h1>
          <p className="text-gray-600 mb-8">
            Your AI-powered personal assistant for Williams, Stanley & Co
          </p>
          <button
            onClick={() => window.location.href = 'https://aimelia-api.onrender.com/auth/login'}
            className="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-8 rounded-xl font-semibold hover:from-blue-700 hover:to-purple-700 transition-all duration-200 transform hover:scale-105"
          >
            Sign in with Microsoft 365
          </button>
        </div>
      </div>
    )
  }

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading Aimelia...</p>
        </div>
      </div>
    )
  }

  const loadDashboardData = async () => {
    setLoading(true)
    try {
      // Load email triage data
      const triageResponse = await makeRequest('/emails/triage/run', { method: 'POST' })
      
      // Load calendar data
      const calendarResponse = await makeRequest('/calendar/next24')
      
      setStats({
        totalEmails: triageResponse.message_count || 0,
        urgentEmails: triageResponse.summary?.urgent || 0,
        upcomingMeetings: calendarResponse.value?.length || 0,
        briefsGenerated: 0 // This would be tracked separately
      })
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
      toast.error('Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'emails':
        return <EmailTriage onRefresh={loadDashboardData} />
      case 'calendar':
        return <CalendarView onRefresh={loadDashboardData} />
      case 'briefs':
        return <MeetingBriefs onRefresh={loadDashboardData} />
      case 'analytics':
        return <Analytics stats={stats} />
      case 'ai':
        return (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <div className="text-6xl mb-4">🧠</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Enhanced AI Features</h2>
              <p className="text-gray-600 mb-6">
                Access context-aware AI features including intelligent email triage, 
                persona-driven drafts, and knowledge base search.
              </p>
              <button
                onClick={() => setShowEnhancedAI(true)}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Open Enhanced AI
              </button>
            </div>
          </div>
        )
      case 'drafting':
        return (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <div className="text-6xl mb-4">✍️</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Smart Email Drafting</h2>
              <p className="text-gray-600 mb-6">
                Automatically draft Outlook replies in Tom Stanley's tone. 
                UK English, decisive, hospitality-savvy, 120-180 words.
              </p>
              <button
                onClick={() => setShowSmartDrafting(true)}
                className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors"
              >
                Open Smart Drafting
              </button>
            </div>
          </div>
        )
      case 'prep':
        return (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <div className="text-6xl mb-4">🌟</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Meeting Preparation</h2>
              <p className="text-gray-600 mb-6">
                Get star-level preparation for your meetings. Comprehensive briefs with 
                talking points, risks, and next steps.
              </p>
              <button
                onClick={() => setShowMeetingPrep(true)}
                className="bg-yellow-600 text-white px-6 py-3 rounded-lg hover:bg-yellow-700 transition-colors"
              >
                Prep Me Like a Star
              </button>
            </div>
          </div>
        )
      case 'automation':
        return (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <div className="text-6xl mb-4">🤖</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Background Automation</h2>
              <p className="text-gray-600 mb-6">
                Control Aimelia's background automation. Make her feel alive with 
                hourly email triage, meeting briefs, and daily digests.
              </p>
              <button
                onClick={() => setShowSchedulerControl(true)}
                className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors"
              >
                Control Automation
              </button>
            </div>
          </div>
        )
      default:
        return <EmailTriage onRefresh={loadDashboardData} />
    }
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
        
        <div className="flex-1 flex flex-col">
          <Header 
            stats={stats} 
            loading={loading}
            onRefresh={loadDashboardData}
            onLogout={logout}
          />
          
          <main className="flex-1 p-6">
            {renderContent()}
          </main>
        </div>
      </div>

      {showEnhancedAI && (
        <EnhancedAI onClose={() => setShowEnhancedAI(false)} />
      )}

      {showSmartDrafting && (
        <SmartDrafting onClose={() => setShowSmartDrafting(false)} />
      )}

      {showMeetingPrep && (
        <MeetingPrep onClose={() => setShowMeetingPrep(false)} />
      )}

      {showSchedulerControl && (
        <SchedulerControl onClose={() => setShowSchedulerControl(false)} />
      )}
    </div>
  )
}
