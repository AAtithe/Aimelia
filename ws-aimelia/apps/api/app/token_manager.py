"""
Secure Microsoft Graph token management with Fernet encryption.
Handles token storage, retrieval, and automatic refresh.
"""
import httpx
from datetime import datetime, timedelta
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
        self.fernet = Fernet(settings.ENCRYPTION_KEY.encode())
        self.tenant_id = settings.TENANT_ID
        self.client_id = settings.CLIENT_ID
        self.client_secret = settings.CLIENT_SECRET
        self.redirect_uri = settings.GRAPH_REDIRECT_URI
        self.token_url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
    
    def _encrypt_token(self, token: str) -> str:
        """Encrypt a token using Fernet."""
        return self.fernet.encrypt(token.encode()).decode()
    
    def _decrypt_token(self, encrypted_token: str) -> str:
        """Decrypt a token using Fernet."""
        return self.fernet.decrypt(encrypted_token.encode()).decode()
    
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
            refresh_token = tokens["refresh_token"]
            expires_in = tokens.get("expires_in", 3600)  # Default to 1 hour
            
            # Calculate expiration time
            expires_at = datetime.utcnow() + timedelta(seconds=expires_in - 300)  # 5 min buffer
            
            # Encrypt tokens
            encrypted_access = self._encrypt_token(access_token)
            encrypted_refresh = self._encrypt_token(refresh_token)
            
            # Check if user already has tokens
            existing_token = db.query(UserToken).filter(UserToken.user_id == user_id).first()
            
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
            
            # Check if token is still valid (with 5 minute buffer)
            if token_record.expires_at > datetime.utcnow():
                # Token is still valid, decrypt and return
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
