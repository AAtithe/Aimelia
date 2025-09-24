# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Aimelia is an AI-powered personal assistant system designed for Williams, Stanley & Co, featuring intelligent email triage, calendar management, meeting brief generation, and Microsoft Graph integration. The system uses a dual architecture with a Python FastAPI backend and Next.js frontend.

## Commands for Development

### Backend (Python FastAPI)

```bash
# Setup and run backend locally
cd ws-aimelia/apps/api
python -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload

# Test specific endpoints
python test_ai.py                    # Test AI service integration
python migrate.py                    # Run database migrations
python generate_encryption_key.py   # Generate encryption key for tokens

# Run background scheduler
python -m app.scheduler

# Check environment setup
python -c "from app.settings import settings; print(settings.TENANT_ID)"
```

### Frontend (Next.js)

```bash
# Setup and run frontend locally
cd frontend
npm install
cp env.example .env.local
npm run dev

# Build and deploy
npm run build
npm start
npm run lint
```

### Testing and Debugging

```bash
# Test authentication flow
python test_auth.py                 # Test Microsoft Graph auth
python test_auth_flow.py            # Extended auth testing
./test_auth_simple.sh              # Shell script auth test

# Test specific features
python test_callback.py            # Test OAuth callback
./test_callback_simple.sh          # Shell callback test
```

## Architecture Overview

### Core Components

The system is architected as a microservices-style application with distinct responsibilities:

**Backend (`ws-aimelia/apps/api/app/`)**
- `main.py`: FastAPI application with route registration and CORS configuration
- `graph_auth.py`: Microsoft Graph OAuth 2.0 authentication flow
- `outlook.py`: Email operations (fetch, send, manage)
- `calendar.py`: Calendar integration and meeting management
- `triage.py`: Hybrid rule-based + AI email classification system
- `ai_service.py`: OpenAI integration for intelligent responses
- `token_manager.py`: Encrypted token storage with Fernet encryption
- `scheduler.py`: Background job processing with APScheduler
- `knowledge_base.py`: RAG (Retrieval-Augmented Generation) system
- `models.py`: SQLAlchemy models for clients, emails, meetings, tokens
- `db.py`: PostgreSQL database connection and session management

**Frontend (`frontend/`)**
- Next.js 14 with App Router architecture
- `app/providers.tsx`: Context providers for authentication and API state
- `components/`: React components for email triage, calendar, meeting briefs
- Microsoft Graph Toolkit integration for authentication
- Tailwind CSS for styling with responsive design

### Data Flow Architecture

1. **Authentication**: Microsoft Graph OAuth flow stores encrypted tokens in PostgreSQL
2. **Email Processing**: Hybrid triage system (rules + AI) classifies incoming emails
3. **AI Integration**: Context-aware responses using knowledge base and few-shot learning
4. **Background Jobs**: Scheduler handles automated tasks (email sync, meeting prep)
5. **Real-time Updates**: WebSocket-style updates through API polling

### Key Integrations

- **Microsoft Graph API**: Full read/write access to emails, calendars, and user data
- **OpenAI GPT**: Intelligent classification, meeting brief generation, draft responses
- **PostgreSQL**: Relational data storage with UUID primary keys and JSON columns
- **Vercel/Render**: Dual deployment strategy for frontend and backend services

## Environment Configuration

### Required Environment Variables

**Backend**:
- `DATABASE_URL`: PostgreSQL connection string
- `TENANT_ID`: Microsoft tenant ID (0cf82021-6ddc-4fae-987a-d29ef04d571a)
- `CLIENT_ID`: Azure AD application ID (880818f6-a9af-43ea-9c12-1813bcecce89)
- `CLIENT_SECRET`: Azure AD client secret (sensitive)
- `GRAPH_REDIRECT_URI`: OAuth callback URL
- `APP_BASE_URL`: Base URL for the API service
- `OPENAI_API_KEY`: OpenAI API key for AI features
- `ENCRYPTION_KEY`: Fernet encryption key for token storage
- `TIMEZONE`: Timezone setting (Europe/London)

**Frontend**:
- `NEXT_PUBLIC_API_BASE_URL`: Backend API base URL
- `NEXT_PUBLIC_CLIENT_ID`: Microsoft client ID for frontend auth
- `NEXT_PUBLIC_TENANT_ID`: Microsoft tenant ID
- `NEXT_PUBLIC_GRAPH_REDIRECT_URI`: OAuth redirect URI

## Database Schema

The PostgreSQL schema includes these key tables:
- `clients`: Company/client information with domains and KPIs
- `contacts`: Individual contacts linked to clients
- `emails`: Email records with triage classifications and AI analysis
- `meetings`: Calendar events with preparation status
- `user_tokens`: Encrypted OAuth tokens for Microsoft Graph
- `kb_chunks`: Knowledge base chunks for RAG system
- `notes`: Meeting notes and action items

## Deployment Architecture

### Production Deployment
- **Backend**: Render.com with PostgreSQL database and background worker
- **Frontend**: Vercel with automatic builds from Git
- **Configuration**: Uses `render.yaml` and `vercel.json` for infrastructure-as-code

### Local Development
- Backend runs on `http://localhost:8000`
- Frontend runs on `http://localhost:3000`
- PostgreSQL database (local or remote)
- Microsoft Graph app configured with localhost redirect URIs

## Deployment Commands

### Render Deployment (Backend API + Database)

**Option 1: Blueprint Deployment (Recommended)**
```bash
# 1. Push to GitHub
git add . && git commit -m "Deploy to Render" && git push

# 2. Go to render.com, connect GitHub repo
# 3. Select "New Blueprint" and deploy using render.yaml
# 4. Render will create web service, worker, and PostgreSQL automatically
```

**Option 2: Manual Service Creation**
```bash
# 1. Connect GitHub repository at render.com
# 2. Create Web Service:
#    - Name: aimelia-api
#    - Root Directory: ws-aimelia/apps/api
#    - Build Command: pip install -e .
#    - Start Command: uvicorn app.main:app --host 0.0.0.0 --port $PORT

# 3. Create PostgreSQL Database:
#    - Name: aimelia-db
#    - Plan: Starter (free tier)

# 4. Create Background Worker (optional):
#    - Name: aimelia-jobs
#    - Root Directory: ws-aimelia/apps/api
#    - Build Command: pip install -e .
#    - Start Command: python -m app.scheduler
```

**Set Render Environment Variables:**
- `DATABASE_URL` (auto-connected from PostgreSQL)
- `TENANT_ID=0cf82021-6ddc-4fae-987a-d29ef04d571a`
- `CLIENT_ID=880818f6-a9af-43ea-9c12-1813bcecce89`
- `CLIENT_SECRET` (sensitive - add manually)
- `GRAPH_REDIRECT_URI=https://aimelia-api.onrender.com/auth/callback`
- `APP_BASE_URL=https://aimelia-api.onrender.com`
- `TIMEZONE=Europe/London`
- `OPENAI_API_KEY` (optional - add manually)
- `ENCRYPTION_KEY` (generate with `python generate_encryption_key.py`)

### Vercel Deployment (Frontend)

**Install Vercel CLI and Deploy:**
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy from project root (uses vercel.json config)
vercel --prod

# Or deploy frontend specifically
cd frontend
vercel --prod
```

**Set Vercel Environment Variables:**
```bash
# Add environment variables via CLI
vercel env add NEXT_PUBLIC_API_BASE_URL
vercel env add NEXT_PUBLIC_CLIENT_ID  
vercel env add NEXT_PUBLIC_TENANT_ID
vercel env add NEXT_PUBLIC_GRAPH_REDIRECT_URI

# Or set in Vercel dashboard:
# NEXT_PUBLIC_API_BASE_URL=https://aimelia-api.onrender.com
# NEXT_PUBLIC_CLIENT_ID=880818f6-a9af-43ea-9c12-1813bcecce89
# NEXT_PUBLIC_TENANT_ID=0cf82021-6ddc-4fae-987a-d29ef04d571a
# NEXT_PUBLIC_GRAPH_REDIRECT_URI=https://aimelia-api.onrender.com/auth/callback
```

### Post-Deployment Steps

```bash
# Test deployment endpoints
curl https://aimelia-api.onrender.com/health
curl https://aimelia.vercel.app

# Test authentication flow
curl https://aimelia-api.onrender.com/auth/login

# Monitor logs
# Render: Dashboard → Service → Logs
# Vercel: Dashboard → Functions → View logs
```

### Azure AD Configuration Update
After deployment, update Azure AD app redirect URIs:
- `https://aimelia-api.onrender.com/auth/callback`
- `https://aimelia.vercel.app/auth/callback` (if frontend handles auth)

### Deployment Architecture Recommendations

**For Production:**
- **Backend**: Render (with database and background worker)
- **Frontend**: Vercel (automatic builds from Git)
- **Database**: Render PostgreSQL with automated backups
- **Monitoring**: Render logs + external monitoring tools

**For Development:**
- **Local**: Use localhost with local PostgreSQL or remote dev database
- **Staging**: Render free tier with separate database
- **Production**: Render paid plans with enhanced resources

## AI and Intelligence Features

### Email Triage System
The triage system uses a hybrid approach:
1. **Rule-based classification**: Fast pattern matching for obvious categories
2. **AI classification**: OpenAI GPT for complex categorization
3. **Context awareness**: Uses historical data and client information
4. **Confidence scoring**: Provides reliability metrics for classifications

### Knowledge Base (RAG)
The system includes a vector-based knowledge base for:
- Email history and patterns
- Client-specific information and preferences
- Meeting context and follow-ups
- Policy documents and standard responses

### Few-Shot Learning
AI responses use few-shot prompting with:
- Example email classifications
- Standard response templates
- Client-specific communication styles
- Domain-specific knowledge

## Key Development Notes

- All database models use UUID primary keys for better scalability
- Token storage uses Fernet encryption for security compliance
- Email classification uses both rule-based and AI approaches for reliability
- Background jobs handle automated email processing and meeting preparation
- The system supports multi-tenant architecture with client-specific configurations
- Microsoft Graph integration requires careful token refresh management
- AI features are optional and fail gracefully when unavailable

## Testing Strategy

- `test_auth*.py` files verify Microsoft Graph authentication
- `test_callback*.py` files test OAuth callback handling
- API endpoints include health checks at `/health` and `/ai/health/enhanced`
- Frontend components can be tested independently with mock API responses
- Database migrations should be tested in staging environments before production

## Deployment Troubleshooting

### Common Render Issues
```bash
# Build failures - check dependencies
cd ws-aimelia/apps/api
pip install -e .  # Test local build

# Database connection issues
echo $DATABASE_URL  # Verify connection string

# Worker not starting
python -m app.scheduler  # Test scheduler locally

# Environment variable issues
python -c "from app.settings import settings; print(settings.TENANT_ID)"
```

### Common Vercel Issues
```bash
# Module import errors
# Check vercel.json configuration and frontend build
cd frontend
npm run build  # Test build locally

# Environment variable issues
vercel env ls  # List current environment variables
vercel env pull .env.local  # Pull from Vercel to local

# Deployment timeout
vercel --debug --prod  # Deploy with debug output
```

### Authentication Flow Testing
```bash
# Test complete auth flow after deployment
curl -L https://aimelia-api.onrender.com/auth/login
# Follow redirect and complete Microsoft login

# Test token endpoint
curl https://aimelia-api.onrender.com/auth/token

# Test API health checks
curl https://aimelia-api.onrender.com/health
curl https://aimelia-api.onrender.com/ai/health/enhanced
```

## Security Considerations

- All sensitive tokens are encrypted at rest using Fernet encryption
- Microsoft Graph scopes are limited to necessary permissions only
- CORS is configured for specific allowed origins
- Environment variables handle all sensitive configuration
- Database connections use connection pooling for security and performance
- Never commit sensitive values to Git - use environment variables
- Regularly rotate Azure AD client secrets
- Monitor authentication logs for suspicious activity
