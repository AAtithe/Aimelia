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

settings = Settings()