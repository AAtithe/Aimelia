'use client'

import { useState, useEffect } from 'react'
import { useAuth, useApi } from '../providers'
import { Sidebar } from '@/components/Sidebar'
import { Header } from '@/components/Header'
import { EmailTriage } from '@/components/EmailTriage'
import { CalendarView } from '@/components/CalendarView'
import { MeetingBriefs } from '@/components/MeetingBriefs'
import { Analytics } from '@/components/Analytics'
import toast from 'react-hot-toast'

type TabType = 'emails' | 'calendar' | 'briefs' | 'analytics'

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

  useEffect(() => {
    if (isAuthenticated) {
      loadDashboardData()
    }
  }, [isAuthenticated])

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
    </div>
  )
}
