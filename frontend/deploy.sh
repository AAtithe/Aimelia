#!/bin/bash

# Aimelia Frontend Deployment Script
echo "🚀 Deploying Aimelia Frontend to Vercel..."

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Installing..."
    npm install -g vercel
fi

# Check if we're logged in to Vercel
if ! vercel whoami &> /dev/null; then
    echo "🔐 Please log in to Vercel:"
    vercel login
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building project..."
npm run build

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
vercel --prod

echo "✅ Deployment complete!"
echo "🌐 Your frontend is now live on Vercel"
echo "📝 Don't forget to set environment variables in Vercel dashboard:"
echo "   - NEXT_PUBLIC_API_BASE_URL"
echo "   - NEXT_PUBLIC_CLIENT_ID" 
echo "   - NEXT_PUBLIC_TENANT_ID"
