# Aimelia Frontend

A modern, responsive React frontend for the Aimelia AI Personal Assistant system.

## Features

- 🤖 **AI-Powered Email Triage** - Intelligent email classification and prioritization
- 📅 **Smart Calendar Management** - View and manage upcoming meetings
- 📝 **Meeting Brief Generation** - AI-generated meeting preparation and insights
- 📊 **Analytics Dashboard** - Performance metrics and AI accuracy tracking
- 🔐 **Microsoft Graph Integration** - Secure authentication and data access
- 📱 **Responsive Design** - Works on desktop, tablet, and mobile devices

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Authentication**: Microsoft Graph Toolkit
- **State Management**: React Context
- **Notifications**: React Hot Toast
- **Date Handling**: date-fns

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Access to the Aimelia API backend

### Installation

1. **Clone and navigate to frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp env.example .env.local
   ```
   
   Edit `.env.local` with your configuration:
   ```env
   NEXT_PUBLIC_API_BASE_URL=https://aimelia-api.onrender.com
   NEXT_PUBLIC_CLIENT_ID=your-microsoft-client-id
   NEXT_PUBLIC_TENANT_ID=your-microsoft-tenant-id
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```

5. **Open your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Deployment

### Deploy to Vercel

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel --prod
   ```

3. **Set environment variables in Vercel dashboard:**
   - `NEXT_PUBLIC_API_BASE_URL`
   - `NEXT_PUBLIC_CLIENT_ID`
   - `NEXT_PUBLIC_TENANT_ID`

### Deploy to Other Platforms

The app can be deployed to any platform that supports Next.js:
- Netlify
- Railway
- Render
- AWS Amplify

## Project Structure

```
frontend/
├── app/                    # Next.js App Router
│   ├── dashboard/         # Dashboard pages
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   └── providers.tsx      # Context providers
├── components/            # React components
│   ├── Analytics.tsx      # Analytics dashboard
│   ├── CalendarView.tsx   # Calendar interface
│   ├── EmailTriage.tsx    # Email triage interface
│   ├── Header.tsx         # Dashboard header
│   ├── MeetingBriefs.tsx  # Meeting briefs interface
│   └── Sidebar.tsx        # Navigation sidebar
├── public/                # Static assets
├── package.json           # Dependencies
├── tailwind.config.js     # Tailwind configuration
├── tsconfig.json          # TypeScript configuration
└── vercel.json           # Vercel deployment config
```

## Features Overview

### Email Triage
- AI-powered email classification
- Urgency scoring and prioritization
- Rule-based and AI hybrid approach
- Detailed email analysis
- Suggested responses

### Calendar Management
- View upcoming meetings
- Meeting details and attendees
- Online meeting links
- Time until next meeting

### Meeting Briefs
- AI-generated meeting preparation
- Context from recent emails
- Downloadable briefs
- Attendee communication history

### Analytics
- Email processing statistics
- AI accuracy metrics
- Time saved calculations
- Recent activity tracking

## API Integration

The frontend communicates with the Aimelia API backend through:

- **Authentication**: Microsoft Graph OAuth flow
- **Email Operations**: `/emails/*` endpoints
- **Calendar Operations**: `/calendar/*` endpoints
- **AI Features**: Integrated AI services

## Customization

### Styling
- Modify `tailwind.config.js` for theme customization
- Update `app/globals.css` for global styles
- Component-specific styles use Tailwind classes

### Components
- All components are in the `components/` directory
- Use TypeScript for type safety
- Follow React best practices

### API Configuration
- Update API base URL in environment variables
- Modify API calls in `app/providers.tsx`
- Add new endpoints as needed

## Troubleshooting

### Common Issues

1. **Authentication not working:**
   - Check Microsoft Graph configuration
   - Verify client ID and tenant ID
   - Ensure redirect URI is correct

2. **API calls failing:**
   - Verify API base URL
   - Check backend server status
   - Review network requests in browser dev tools

3. **Styling issues:**
   - Ensure Tailwind CSS is properly configured
   - Check for conflicting CSS
   - Verify responsive breakpoints

### Development Tips

- Use browser dev tools for debugging
- Check console for error messages
- Use React DevTools extension
- Monitor network requests

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is part of the Aimelia AI Personal Assistant system.
