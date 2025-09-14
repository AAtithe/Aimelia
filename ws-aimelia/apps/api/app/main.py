from fastapi import FastAPI
from .graph_auth import router as auth_router
from .outlook import router as email_router
from .calendar import router as cal_router
from .simple_enhanced import router as enhanced_router
from .smart_drafting_endpoints import router as drafting_router
from .meeting_prep_endpoints import router as prep_router
from .scheduler_endpoints import router as scheduler_router

app = FastAPI(
    title="Aimelia API",
    description="AI-powered personal assistant for Williams, Stanley & Co",
    version="2.0.0"
)

# Include all routers
app.include_router(auth_router, tags=["Authentication"])
app.include_router(email_router, tags=["Email Management"])
app.include_router(cal_router, tags=["Calendar Management"])
app.include_router(enhanced_router, prefix="/ai", tags=["Enhanced AI Features"])
app.include_router(drafting_router, prefix="/draft", tags=["Smart Drafting"])
app.include_router(prep_router, prefix="/prep", tags=["Meeting Preparation"])
app.include_router(scheduler_router, prefix="/scheduler", tags=["Background Automation"])

@app.get("/")
def root():
    return {
        "aimelia": "ok",
        "version": "2.0.0",
        "features": [
            "Microsoft Graph Integration",
            "AI-Powered Email Triage",
            "Context-Aware Meeting Briefs",
            "Knowledge Base (RAG)",
            "Persona-Driven Responses",
            "Few-Shot Learning",
            "Smart Email Drafting",
            "Automatic Reply Generation",
            "Meeting Preparation",
            "Star-Level Meeting Briefs",
            "Background Automation",
            "Proactive AI Assistant"
        ]
    }

@app.get("/health")
async def health_check():
    """Enhanced health check endpoint."""
    from .simple_enhanced import enhanced_health_check
    from .db import get_db
    from fastapi import Depends
    
    db = next(get_db())
    return await enhanced_health_check(db)