# 🚀 Deployment Guide - Aimelia AI PA

This guide covers deploying Aimelia to both **Vercel** (serverless) and **Render** (full-stack) platforms.

## 📋 Prerequisites

- GitHub repository with your Aimelia code
- Azure AD app configured (already done)
- OpenAI API key (optional, for LLM features)

---

## 🌐 Vercel Deployment (Serverless)

Vercel is perfect for the API endpoints and serverless functions.

### 1. Install Vercel CLI
```bash
npm i -g vercel
```

### 2. Configure Environment Variables
```bash
# Set your Azure AD credentials
vercel env add TENANT_ID
vercel env add CLIENT_ID  
vercel env add CLIENT_SECRET
vercel env add GRAPH_REDIRECT_URI
vercel env add APP_BASE_URL
vercel env add OPENAI_API_KEY  # optional
```

### 3. Deploy
```bash
cd /path/to/ws-aimelia
vercel --prod
```

### 4. Update Azure AD Redirect URI
After deployment, update your Azure AD app:
- **Redirect URI**: `https://your-project.vercel.app/auth/callback`

### ⚠️ Vercel Limitations
- No persistent database (use external DB like Supabase/PlanetScale)
- No background jobs (scheduler won't work)
- 10-second timeout limit
- Best for API endpoints only

---

## 🖥️ Render Deployment (Full-Stack)

Render supports the complete application with database and background workers.

### 1. Connect GitHub Repository
1. Go to [render.com](https://render.com)
2. Connect your GitHub account
3. Select your `ws-aimelia` repository

### 2. Deploy Web Service
1. Click "New +" → "Web Service"
2. Connect your GitHub repo
3. Configure:
   - **Name**: `aimelia-api`
   - **Root Directory**: `apps/api`
   - **Build Command**: `pip install -e .`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### 3. Set Environment Variables
In Render dashboard, add these environment variables:
```
DATABASE_URL=<will be set automatically>
TENANT_ID=0cf82021-6ddc-4fae-987a-d29ef04d571a
CLIENT_ID=880818f6-a9af-43ea-9c12-1813bcecce89
CLIENT_SECRET=-cm8Q~MhnYA601zflBkoSm-c0WJPMvx_FBlijaCv
GRAPH_REDIRECT_URI=https://aimelia-api.onrender.com/auth/callback
APP_BASE_URL=https://aimelia-api.onrender.com
TIMEZONE=Europe/London
OPENAI_API_KEY=<your-openai-key>
```

### 4. Create PostgreSQL Database
1. Click "New +" → "PostgreSQL"
2. Name: `aimelia-db`
3. Plan: `Starter` (free tier)
4. Connect to your web service

### 5. Deploy Background Worker (Optional)
1. Click "New +" → "Background Worker"
2. Configure:
   - **Name**: `aimelia-jobs`
   - **Root Directory**: `apps/api`
   - **Build Command**: `pip install -e .`
   - **Start Command**: `python -m app.scheduler`
3. Set same environment variables as web service

### 6. Update Azure AD Redirect URI
Update your Azure AD app:
- **Redirect URI**: `https://aimelia-api.onrender.com/auth/callback`

---

## 🔄 Alternative: Using render.yaml (Declarative)

If you prefer declarative deployment, Render supports the `render.yaml` file:

1. Ensure your `infra/render.yaml` is in the repository root
2. In Render dashboard, select "Blueprint" deployment
3. Render will automatically create all services from the YAML

---

## 🧪 Testing Deployment

### Test API Endpoints
```bash
# Test health check
curl https://your-domain.com/

# Test auth flow
curl https://your-domain.com/auth/login

# Test email triage (requires auth)
curl -X POST https://your-domain.com/emails/triage/run
```

### Test Azure AD Integration
1. Visit `https://your-domain.com/auth/login`
2. Complete Microsoft authentication
3. Check callback at `/auth/callback`

---

## 🔧 Post-Deployment Configuration

### 1. Database Migrations
```bash
# Run database migrations (if needed)
# This would typically be done in a deployment script
```

### 2. Monitor Logs
- **Vercel**: Dashboard → Functions → View logs
- **Render**: Dashboard → Service → Logs

### 3. Set up Monitoring
- Add health check endpoints
- Monitor Azure AD token refresh
- Track scheduled job execution

---

## 🚨 Troubleshooting

### Common Issues

**Vercel:**
- `ModuleNotFoundError`: Check Python path in `vercel.json`
- Timeout errors: Optimize database queries
- Missing dependencies: Update `requirements.txt`

**Render:**
- Build failures: Check `pyproject.toml` dependencies
- Database connection: Verify `DATABASE_URL`
- Worker not starting: Check scheduler logs

### Debug Commands
```bash
# Check environment variables
echo $TENANT_ID
echo $CLIENT_ID

# Test local build
cd apps/api
pip install -e .
python -c "from app.settings import settings; print(settings.TENANT_ID)"
```

---

## 📊 Recommended Architecture

### For Production:
- **API**: Render (with database)
- **Frontend**: Vercel (if you build a React/Next.js UI)
- **Database**: Render PostgreSQL
- **Background Jobs**: Render Worker
- **Monitoring**: Render logs + external monitoring

### For Development:
- **Local**: Docker Compose with PostgreSQL
- **Staging**: Render free tier
- **Production**: Render paid plans

---

## 🔐 Security Notes

1. **Never commit secrets** to Git
2. **Use environment variables** for all sensitive data
3. **Rotate Azure AD secrets** regularly
4. **Enable HTTPS** (automatic on both platforms)
5. **Set up CORS** if needed for frontend integration

---

## 📞 Support

- **Vercel**: [Vercel Documentation](https://vercel.com/docs)
- **Render**: [Render Documentation](https://render.com/docs)
- **Azure AD**: [Microsoft Graph Documentation](https://docs.microsoft.com/en-us/graph/)

---

## 🎯 Next Steps

After successful deployment:
1. Set up domain name (custom subdomain)
2. Configure SSL certificates
3. Set up monitoring and alerts
4. Implement proper error handling
5. Add API rate limiting
6. Set up automated backups