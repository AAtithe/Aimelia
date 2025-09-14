'use client'

import { RefreshCw, LogOut, Bell, User } from 'lucide-react'
import { format } from 'date-fns'

interface HeaderProps {
  stats: {
    totalEmails: number
    urgentEmails: number
    upcomingMeetings: number
    briefsGenerated: number
  }
  loading: boolean
  onRefresh: () => void
  onLogout: () => void
}

export function Header({ stats, loading, onRefresh, onLogout }: HeaderProps) {
  return (
    <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Left side - Stats */}
        <div className="flex items-center space-x-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
            <p className="text-sm text-gray-500">
              {format(new Date(), 'EEEE, MMMM do, yyyy')}
            </p>
          </div>
          
          <div className="hidden md:flex items-center space-x-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.totalEmails}</div>
              <div className="text-xs text-gray-500">Total Emails</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{stats.urgentEmails}</div>
              <div className="text-xs text-gray-500">Urgent</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{stats.upcomingMeetings}</div>
              <div className="text-xs text-gray-500">Meetings</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{stats.briefsGenerated}</div>
              <div className="text-xs text-gray-500">Briefs</div>
            </div>
          </div>
        </div>

        {/* Right side - Actions */}
        <div className="flex items-center space-x-4">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center space-x-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors duration-200 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors duration-200">
            <Bell className="w-5 h-5" />
          </button>

          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-white" />
            </div>
            <button
              onClick={onLogout}
              className="flex items-center space-x-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors duration-200"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
