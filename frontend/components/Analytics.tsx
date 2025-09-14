'use client'

import { useState, useEffect } from 'react'
import { useApi } from '@/app/providers'
import { 
  BarChart3, 
  Mail, 
  Calendar, 
  FileText, 
  TrendingUp, 
  Clock,
  Brain,
  Filter
} from 'lucide-react'
import toast from 'react-hot-toast'

interface AnalyticsProps {
  stats: {
    totalEmails: number
    urgentEmails: number
    upcomingMeetings: number
    briefsGenerated: number
  }
}

export function Analytics({ stats }: AnalyticsProps) {
  const { makeRequest } = useApi()
  const [analytics, setAnalytics] = useState({
    emailCategories: [] as Array<{ category: string; count: number }>,
    urgencyDistribution: [] as Array<{ level: string; count: number }>,
    aiAccuracy: 0,
    timeSaved: 0,
    recentActivity: [] as Array<{ type: string; description: string; timestamp: string }>
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadAnalytics()
  }, [])

  const loadAnalytics = async () => {
    setLoading(true)
    try {
      // This would typically come from a dedicated analytics endpoint
      // For now, we'll simulate some data
      const mockAnalytics = {
        emailCategories: [
          { category: 'Urgent', count: stats.urgentEmails },
          { category: 'Important', count: Math.floor(stats.totalEmails * 0.3) },
          { category: 'General', count: Math.floor(stats.totalEmails * 0.4) },
          { category: 'Automated', count: Math.floor(stats.totalEmails * 0.2) },
          { category: 'Payroll', count: Math.floor(stats.totalEmails * 0.1) }
        ],
        urgencyDistribution: [
          { level: 'Critical (5)', count: Math.floor(stats.urgentEmails * 0.2) },
          { level: 'High (4)', count: Math.floor(stats.urgentEmails * 0.3) },
          { level: 'Medium (3)', count: Math.floor(stats.totalEmails * 0.4) },
          { level: 'Low (2)', count: Math.floor(stats.totalEmails * 0.3) },
          { level: 'Very Low (1)', count: Math.floor(stats.totalEmails * 0.1) }
        ],
        aiAccuracy: 94.5,
        timeSaved: 127, // minutes
        recentActivity: [
          { type: 'email', description: 'Processed 15 emails with AI triage', timestamp: '2 minutes ago' },
          { type: 'brief', description: 'Generated meeting brief for Q4 Review', timestamp: '1 hour ago' },
          { type: 'email', description: 'Classified urgent budget request', timestamp: '2 hours ago' },
          { type: 'brief', description: 'Updated team standup brief', timestamp: '3 hours ago' },
          { type: 'email', description: 'Processed 23 emails with AI triage', timestamp: '4 hours ago' }
        ]
      }
      setAnalytics(mockAnalytics)
    } catch (error) {
      console.error('Failed to load analytics:', error)
      toast.error('Failed to load analytics data')
    } finally {
      setLoading(false)
    }
  }

  const StatCard = ({ title, value, icon: Icon, color, subtitle }: {
    title: string
    value: string | number
    icon: any
    color: string
    subtitle?: string
  }) => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
          <p className="text-gray-600">AI performance and productivity insights</p>
        </div>
        <button
          onClick={loadAnalytics}
          disabled={loading}
          className="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
        >
          <BarChart3 className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Loading...' : 'Refresh Data'}</span>
        </button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Emails Processed"
          value={stats.totalEmails}
          icon={Mail}
          color="bg-blue-500"
          subtitle="Last 24 hours"
        />
        <StatCard
          title="AI Accuracy"
          value={`${analytics.aiAccuracy}%`}
          icon={Brain}
          color="bg-purple-500"
          subtitle="Classification accuracy"
        />
        <StatCard
          title="Time Saved"
          value={`${analytics.timeSaved}m`}
          icon={Clock}
          color="bg-green-500"
          subtitle="Estimated time saved"
        />
        <StatCard
          title="Briefs Generated"
          value={stats.briefsGenerated}
          icon={FileText}
          color="bg-orange-500"
          subtitle="Meeting briefs"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Email Categories */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Categories</h3>
          <div className="space-y-3">
            {analytics.emailCategories.map((item, index) => (
              <div key={item.category} className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    ['bg-red-500', 'bg-orange-500', 'bg-blue-500', 'bg-yellow-500', 'bg-green-500'][index % 5]
                  }`}></div>
                  <span className="text-sm font-medium text-gray-700">{item.category}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-24 bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full" 
                      style={{ width: `${(item.count / Math.max(...analytics.emailCategories.map(c => c.count))) * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-8 text-right">{item.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Urgency Distribution */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Urgency Distribution</h3>
          <div className="space-y-3">
            {analytics.urgencyDistribution.map((item, index) => (
              <div key={item.level} className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-blue-500', 'bg-green-500'][index]
                  }`}></div>
                  <span className="text-sm font-medium text-gray-700">{item.level}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-24 bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-purple-500 h-2 rounded-full" 
                      style={{ width: `${(item.count / Math.max(...analytics.urgencyDistribution.map(u => u.count))) * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-8 text-right">{item.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
        <div className="space-y-4">
          {analytics.recentActivity.map((activity, index) => (
            <div key={index} className="flex items-start space-x-3">
              <div className={`w-2 h-2 rounded-full mt-2 ${
                activity.type === 'email' ? 'bg-blue-500' : 'bg-purple-500'
              }`}></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">{activity.description}</p>
                <p className="text-xs text-gray-500">{activity.timestamp}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Performance */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6 border border-purple-200">
        <div className="flex items-center space-x-3 mb-4">
          <Brain className="w-6 h-6 text-purple-600" />
          <h3 className="text-lg font-semibold text-gray-900">AI Performance</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">{analytics.aiAccuracy}%</div>
            <div className="text-sm text-gray-600">Classification Accuracy</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">2.3s</div>
            <div className="text-sm text-gray-600">Avg Processing Time</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">99.8%</div>
            <div className="text-sm text-gray-600">Uptime</div>
          </div>
        </div>
      </div>
    </div>
  )
}
