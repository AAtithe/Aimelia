'use client'

import { useState, useEffect } from 'react'
import { useApi } from '../app/providers'

interface SchedulerControlProps {
  onClose: () => void
}

export function SchedulerControl({ onClose }: SchedulerControlProps) {
  const { makeRequest } = useApi()
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<any[]>([])

  useEffect(() => {
    loadStatus()
    loadLogs()
  }, [])

  const loadStatus = async () => {
    try {
      const response = await makeRequest('/scheduler/scheduler/status')
      setStatus(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status')
    }
  }

  const loadLogs = async () => {
    try {
      const response = await makeRequest('/scheduler/scheduler/logs')
      setLogs(response.logs || [])
    } catch (err) {
      // Ignore logs error for now
    }
  }

  const startScheduler = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest('/scheduler/scheduler/start', {
        method: 'POST'
      })
      setStatus(response)
      await loadLogs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scheduler')
    } finally {
      setLoading(false)
    }
  }

  const stopScheduler = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest('/scheduler/scheduler/stop', {
        method: 'POST'
      })
      setStatus(response)
      await loadLogs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop scheduler')
    } finally {
      setLoading(false)
    }
  }

  const runTaskNow = async (taskName: string) => {
    setLoading(true)
    setError(null)
    try {
      const response = await makeRequest(`/scheduler/scheduler/run-now/${taskName}`, {
        method: 'POST'
      })
      await loadLogs()
      // Show success message
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to run ${taskName}`)
    } finally {
      setLoading(false)
    }
  }

  const renderSchedulerStatus = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Scheduler Status</h3>
        <div className="flex space-x-2">
          <button
            onClick={startScheduler}
            disabled={loading || status?.scheduler?.running}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Starting...' : 'Start Scheduler'}
          </button>
          <button
            onClick={stopScheduler}
            disabled={loading || !status?.scheduler?.running}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? 'Stopping...' : 'Stop Scheduler'}
          </button>
        </div>
      </div>

      <div className="bg-gray-50 p-4 rounded-lg">
        <div className="flex items-center space-x-2 mb-2">
          <div className={`w-3 h-3 rounded-full ${status?.scheduler?.running ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="font-medium">
            {status?.scheduler?.running ? 'Running' : 'Stopped'}
          </span>
        </div>
        <p className="text-sm text-gray-600">
          {status?.scheduler?.running 
            ? 'Aimelia is alive and working in the background! 🤖'
            : 'Aimelia is sleeping. Start the scheduler to make her active.'
          }
        </p>
      </div>
    </div>
  )

  const renderScheduledTasks = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Scheduled Tasks</h3>
      
      <div className="space-y-3">
        {status?.scheduler?.jobs?.map((job: any) => (
          <div key={job.id} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-gray-900">{job.name}</h4>
                <p className="text-sm text-gray-600">Next run: {job.next_run || 'Not scheduled'}</p>
                <p className="text-xs text-gray-500">Trigger: {job.trigger}</p>
              </div>
              <button
                onClick={() => runTaskNow(job.id)}
                disabled={loading}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Run Now
              </button>
            </div>
          </div>
        )) || []}
      </div>
    </div>
  )

  const renderAutomationGuide = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Automation Guide</h3>
      
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 mb-2">🤖 How Aimelia Stays Alive</h4>
        <div className="space-y-2 text-sm text-blue-800">
          <div className="flex items-center space-x-2">
            <span className="font-medium">📧 Every Hour:</span>
            <span>Email triage, reply drafting, smart filing</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-medium">🌅 06:00 & 18:00:</span>
            <span>Meeting brief generation for next 24h</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-medium">📱 08:00:</span>
            <span>Daily Teams digest posting</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-medium">💚 Every 30min:</span>
            <span>Health checks and system monitoring</span>
          </div>
        </div>
      </div>

      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <h4 className="font-medium text-green-900 mb-2">✨ Benefits</h4>
        <ul className="text-sm text-green-800 space-y-1">
          <li>• Never miss important emails</li>
          <li>• Always prepared for meetings</li>
          <li>• Inbox stays organized automatically</li>
          <li>• Daily insights into your productivity</li>
          <li>• More time for strategic work</li>
        </ul>
      </div>
    </div>
  )

  const renderLogs = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
      
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-64 overflow-y-auto">
        {logs.length > 0 ? (
          <div className="space-y-2">
            {logs.map((log, index) => (
              <div key={index} className="text-sm">
                <span className="text-gray-500">{log.timestamp}</span>
                <span className={`ml-2 px-2 py-1 rounded text-xs ${
                  log.level === 'INFO' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'
                }`}>
                  {log.level}
                </span>
                <span className="ml-2">{log.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No recent activity logs</p>
        )}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-2xl font-bold text-gray-900">🤖 Aimelia Automation Control</h2>
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
                🎛️ Control Panel
              </button>
              <button className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100">
                📋 Scheduled Tasks
              </button>
              <button className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100">
                📖 Guide
              </button>
              <button className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100">
                📝 Activity Logs
              </button>
            </nav>
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-2xl space-y-6">
              {renderSchedulerStatus()}
              {renderScheduledTasks()}
              {renderAutomationGuide()}
              {renderLogs()}

              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-red-600">{error}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
