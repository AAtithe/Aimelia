#!/bin/bash

# Aimelia Deployment Script
echo "🚀 Aimelia AI PA Deployment Script"
echo "=================================="

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📦 Initializing Git repository..."
    git init
    git add .
    git commit -m "Initial commit: Aimelia AI PA setup"
    echo "✅ Git repository initialized"
fi

echo ""
echo "Choose deployment option:"
echo "1) Render (Recommended - Full Stack with Database)"
echo "2) Vercel (Serverless API)"
echo "3) Both"
read -p "Enter your choice (1-3): " choice

case $choice in
    1)
        echo "🎯 Deploying to Render..."
        echo "1. Push to GitHub first:"
        echo "   git remote add origin <your-github-repo-url>"
        echo "   git push -u origin main"
        echo ""
        echo "2. Go to https://render.com and:"
        echo "   - Connect your GitHub repository"
        echo "   - Use 'Blueprint' deployment"
        echo "   - Select the infra/render.yaml file"
        echo ""
        echo "3. Update Azure AD redirect URI to:"
        echo "   https://aimelia-api.onrender.com/auth/callback"
        ;;
    2)
        echo "🎯 Deploying to Vercel..."
        if ! command -v vercel &> /dev/null; then
            echo "Installing Vercel CLI..."
            npm install -g vercel
        fi
        
        echo "Setting up environment variables..."
        echo "You'll need to set these in Vercel dashboard:"
        echo "- TENANT_ID: 0cf82021-6ddc-4fae-987a-d29ef04d571a"
        echo "- CLIENT_ID: 880818f6-a9af-43ea-9c12-1813bcecce89"
        echo "- CLIENT_SECRET: -cm8Q~MhnYA601zflBkoSm-c0WJPMvx_FBlijaCv"
        echo "- GRAPH_REDIRECT_URI: https://your-project.vercel.app/auth/callback"
        echo "- APP_BASE_URL: https://your-project.vercel.app"
        echo ""
        echo "Run: vercel --prod"
        ;;
    3)
        echo "🎯 Deploying to both platforms..."
        echo "Follow steps for both Render and Vercel above"
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "📋 Post-deployment checklist:"
echo "✅ Update Azure AD redirect URI"
echo "✅ Test authentication flow"
echo "✅ Verify environment variables"
echo "✅ Check application logs"
echo "✅ Test API endpoints"

echo ""
echo "🎉 Deployment setup complete!"
echo "📖 See DEPLOYMENT.md for detailed instructions"