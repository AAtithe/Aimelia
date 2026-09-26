"""
Secure Microsoft Graph token management with Fernet encryption.
Handles token storage, retrieval, and automatic refresh.
"""
import httpx
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session
from .models import UserToken
from .settings import settings
import logging

logger = logging.getLogger(__name__)

class TokenManager:
    """Manages Microsoft Graph tokens with encryption and auto-refresh."""
    
    def __init__(self):
        # Initialize Fernet only if encryption key is available
        try:
            if settings.ENCRYPTION_KEY:
                self.fernet = Fernet(settings.ENCRYPTION_KEY.encode())
            else:
                self.fernet = None
                logger.warning("ENCRYPTION_KEY not set. Token encryption disabled.")
        except Exception as e:
            logger.error(f"Failed to initialize encryption: {e}")
            self.fernet = None
        
        self.tenant_id = settings.TENANT_ID
        self.client_id = settings.CLIENT_ID
        self.client_secret = settings.CLIENT_SECRET
        self.redirect_uri = settings.GRAPH_REDIRECT_URI
        self.token_url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
    
    def _encrypt_token(self, token: str) -> str:
        """Encrypt a token using Fernet. Refuses to store anything in plain text."""
        if not self.fernet:
            raise RuntimeError("ENCRYPTION_KEY is not set, so tokens cannot be stored safely.")
        return self.fernet.encrypt(token.encode()).decode()

    def _decrypt_token(self, encrypted_token: str) -> str:
        """Decrypt a token using Fernet. Anything stored before encryption was enforced fails and forces a new sign-in."""
        if not self.fernet:
            raise RuntimeError("ENCRYPTION_KEY is not set, so stored tokens cannot be read.")
        return self.fernet.decrypt(encrypted_token.encode()).decode()

    @staticmethod
    def _utc(value: datetime) -> datetime:
        """Postgres returns timezone-aware times and SQLite naive ones; compare both as UTC."""
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    
    async def store_tokens(self, db: Session, user_id: str, tokens: Dict[str, Any]) -> bool:
        """
        Store encrypted access and refresh tokens for a user.
        
        Args:
            db: Database session
            user_id: User identifier (e.g., "tom")
            tokens: Token response from Microsoft Graph
            
        Returns:
            bool: True if successful
        """
        try:
            access_token = tokens["access_token"]
            existing_token = db.query(UserToken).filter(UserToken.user_id == user_id).first()
            # A refresh response may omit the refresh token; keep the one we have.
            refresh_token = tokens.get("refresh_token") or (
                self._decrypt_token(existing_token.encrypted_refresh_token) if existing_token else None)
            if not refresh_token:
                raise ValueError("No refresh token returned")
            expires_in = int(tokens.get("expires_in", 3600))  # Default to 1 hour
            
            # Calculate expiration time (ensure it's always in the future)
            buffer_seconds = min(300, expires_in // 2)  # Use 5 min buffer or half the token lifetime, whichever is smaller
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in - buffer_seconds)
            
            # Encrypt tokens
            encrypted_access = self._encrypt_token(access_token)
            encrypted_refresh = self._encrypt_token(refresh_token)
            
            if existing_token:
                # Update existing tokens
                existing_token.encrypted_access_token = encrypted_access
                existing_token.encrypted_refresh_token = encrypted_refresh
                existing_token.expires_at = expires_at
            else:
                # Create new token record
                new_token = UserToken(
                    user_id=user_id,
                    encrypted_access_token=encrypted_access,
                    encrypted_refresh_token=encrypted_refresh,
                    expires_at=expires_at
                )
                db.add(new_token)
            
            db.commit()
            logger.info(f"Successfully stored tokens for user {user_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to store tokens for user {user_id}: {e}")
            logger.error(f"Exception type: {type(e).__name__}")
            logger.error(f"Exception details: {str(e)}")
            db.rollback()
            return False
    
    async def get_valid_access_token(self, db: Session, user_id: str) -> Optional[str]:
        """
        Get a valid access token, refreshing if necessary.
        
        Args:
            db: Database session
            user_id: User identifier
            
        Returns:
            str: Valid access token or None if failed
        """
        try:
            # Get stored tokens
            token_record = db.query(UserToken).filter(UserToken.user_id == user_id).first()
            if not token_record:
                logger.warning(f"No tokens found for user {user_id}")
                return None
            
            # The 5 minute safety margin is taken off expires_at when the token is stored.
            # Comparing a naive time with Postgres's timezone-aware one used to raise here,
            # which was swallowed below and read as "not signed in".
            if self._utc(token_record.expires_at) > datetime.now(timezone.utc):
                return self._decrypt_token(token_record.encrypted_access_token)
            
            # Token expired, try to refresh
            logger.info(f"Access token expired for user {user_id}, attempting refresh")
            return await self._refresh_tokens(db, user_id, token_record)
            
        except Exception as e:
            logger.error(f"Failed to get valid access token for user {user_id}: {e}")
            return None
    
    async def _refresh_tokens(self, db: Session, user_id: str, token_record: UserToken) -> Optional[str]:
        """
        Refresh expired tokens using the refresh token.
        
        Args:
            db: Database session
            user_id: User identifier
            token_record: Current token record
            
        Returns:
            str: New access token or None if failed
        """
        try:
            refresh_token = self._decrypt_token(token_record.encrypted_refresh_token)
            
            # Prepare refresh request
            data = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "scope": " ".join([
                    "offline_access",
                    "https://graph.microsoft.com/Mail.ReadWrite",
                    "https://graph.microsoft.com/Mail.Send",
                    "https://graph.microsoft.com/Calendars.ReadWrite",
                    "https://graph.microsoft.com/User.Read",
                ])
            }
            
            # Make refresh request
            async with httpx.AsyncClient() as client:
                response = await client.post(self.token_url, data=data)
                response.raise_for_status()
                new_tokens = response.json()
            
            # Store new tokens
            success = await self.store_tokens(db, user_id, new_tokens)
            if success:
                return new_tokens["access_token"]
            else:
                logger.error(f"Failed to store refreshed tokens for user {user_id}")
                return None
                
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error refreshing tokens for user {user_id}: {e.response.status_code} - {e.response.text}")
            return None
        except Exception as e:
            logger.error(f"Failed to refresh tokens for user {user_id}: {e}")
            return None
    
    async def revoke_tokens(self, db: Session, user_id: str) -> bool:
        """
        Revoke and delete stored tokens for a user.
        
        Args:
            db: Database session
            user_id: User identifier
            
        Returns:
            bool: True if successful
        """
        try:
            token_record = db.query(UserToken).filter(UserToken.user_id == user_id).first()
            if token_record:
                db.delete(token_record)
                db.commit()
                logger.info(f"Successfully revoked tokens for user {user_id}")
                return True
            else:
                logger.warning(f"No tokens found to revoke for user {user_id}")
                return True
                
        except Exception as e:
            logger.error(f"Failed to revoke tokens for user {user_id}: {e}")
            db.rollback()
            return False

# Global instance
token_manager = TokenManager()
