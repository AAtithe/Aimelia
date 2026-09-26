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

settings = Settings()
