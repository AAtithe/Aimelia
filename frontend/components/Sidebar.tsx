'use client'

import { 
  Mail, 
  Calendar, 
  FileText, 
  BarChart3, 
  Settings,
  Bot,
  Brain,
  PenTool,
  Star,
  Zap
} from 'lucide-react'

type TabType = 'emails' | 'calendar' | 'briefs' | 'analytics' | 'ai' | 'drafting' | 'prep' | 'automation'

interface SidebarProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const menuItems = [
    { id: 'emails', label: 'Email Triage', icon: Mail, color: 'text-blue-600' },
    { id: 'calendar', label: 'Calendar', icon: Calendar, color: 'text-green-600' },
    { id: 'briefs', label: 'Meeting Briefs', icon: FileText, color: 'text-purple-600' },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, color: 'text-orange-600' },
    { id: 'ai', label: 'Enhanced AI', icon: Brain, color: 'text-indigo-600' },
    { id: 'drafting', label: 'Smart Drafting', icon: PenTool, color: 'text-emerald-600' },
    { id: 'prep', label: 'Meeting Prep', icon: Star, color: 'text-yellow-600' },
    { id: 'automation', label: 'Automation', icon: Zap, color: 'text-purple-600' },
  ]

  return (
    <div className="w-64 bg-white shadow-lg h-screen flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Aimelia</h1>
            <p className="text-sm text-gray-500">AI Assistant</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id as TabType)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                isActive
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : item.color}`} />
              <span className="font-medium">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Settings */}
      <div className="p-4 border-t border-gray-200">
        <button className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all duration-200">
          <Settings className="w-5 h-5" />
          <span className="font-medium">Settings</span>
        </button>
      </div>
    </div>
  )
}
