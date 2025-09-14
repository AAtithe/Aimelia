#!/bin/bash

# Enhanced Aimelia Deployment Script
echo "🚀 Deploying Enhanced Aimelia System"
echo "===================================="

# Set environment variables
export PYTHONPATH="${PYTHONPATH}:$(pwd)/app"

# Install dependencies
echo "📦 Installing dependencies..."
pip install -r requirements.txt

# Run database migrations
echo "🗄️  Running database migrations..."
python3 migrate.py

# Run knowledge base migration
echo "🧠 Setting up knowledge base..."
python3 migrate_knowledge_base.py

# Test the enhanced system
echo "🧪 Testing enhanced system..."
python3 -c "
import asyncio
from app.enhanced_endpoints import enhanced_health_check
from app.db import get_db

async def test():
    db = next(get_db())
    result = await enhanced_health_check(db)
    print('✅ Enhanced system test:', result)

asyncio.run(test())
"

echo "✅ Enhanced Aimelia deployment completed!"
echo ""
echo "🎯 New Features Available:"
echo "• Context-aware email triage"
echo "• Persona-driven responses"
echo "• Knowledge base (RAG)"
echo "• Enhanced meeting briefs"
echo "• Few-shot learning"
echo ""
echo "📡 API Endpoints:"
echo "• POST /ai/emails/triage/enhanced"
echo "• POST /ai/emails/drafts/enhanced"
echo "• POST /ai/calendar/briefs/enhanced"
echo "• GET /ai/knowledge/search"
echo "• POST /ai/context-aware-generation"
echo "• GET /health"
