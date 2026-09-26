from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    OPENAI_API_KEY: str | None = None
    DATABASE_URL: str
    TENANT_ID: str
    CLIENT_ID: str
    CLIENT_SECRET: str
    GRAPH_REDIRECT_URI: str
    APP_BASE_URL: str
    TIMEZONE: str = "Europe/London"
    ENCRYPTION_KEY: str | None = None  # Fernet encryption key for token storage

    # Agentic task list
    ANTHROPIC_API_KEY: str | None = None
    AIMELIA_ACCESS_KEY: str | None = None  # required header X-Aimelia-Key for /todo endpoints
    AGENT_LOOP_IN_API: bool = True  # run the background agent loop inside the API process
    AIMELIA_APP_URL: str = "https://aimelia.vercel.app/tasks"  # linked from pushes and calendar blocks
    AIMELIA_FRONTEND_URL: str = "https://aimelia.vercel.app"  # where Microsoft sign-in returns the browser
    AIMELIA_OWNER_EMAIL: str | None = None  # the only account(s) allowed to connect Microsoft 365, comma-separated

    # Morning push (never email)
    TEAMS_WEBHOOK_URL: str | None = None  # Teams Workflows webhook for the channel or chat
    NTFY_URL: str | None = None  # ntfy topic URL for phone push
    NTFY_TOKEN: str | None = None

    # Read-only lookups for the agents (a dedicated read-only user in each app)
    WSCIP_BASE_URL: str | None = "https://operations.williamsstanley.co"
    WSCIP_EMAIL: str | None = None
    WSCIP_PASSWORD: str | None = None
    WSCIP_TOKEN: str | None = None  # alternative to email/password
    PCC_BASE_URL: str | None = "https://payrollcc.vercel.app"
    PCC_EMAIL: str | None = None
    PCC_PASSWORD: str | None = None
    PCC_TOKEN: str | None = None

settings = Settings()
