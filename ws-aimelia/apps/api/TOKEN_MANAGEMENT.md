# Microsoft Graph Token Management

This system provides secure, encrypted storage and automatic refresh of Microsoft Graph tokens using Fernet encryption and PostgreSQL.

## Features

- 🔐 **Fernet Encryption**: All tokens are encrypted at rest using a configurable key
- 🔄 **Auto-Refresh**: Tokens are automatically refreshed when expired using refresh tokens
- 🗄️ **PostgreSQL Storage**: Secure storage in the database with proper indexing
- 👤 **Single User**: Currently configured for user "tom" (easily extensible)
- 🛡️ **Security**: No plaintext tokens stored anywhere

## Setup

### 1. Generate Encryption Key

```bash
cd ws-aimelia/apps/api
python generate_key.py
```

Copy the output and add it to your `.env` file:

```bash
echo 'ENCRYPTION_KEY=your_generated_key_here' >> .env
```

### 2. Environment Variables

Add these to your `.env` file:

```env
# Existing variables...
ENCRYPTION_KEY=your_generated_key_here

# Microsoft Graph (existing)
TENANT_ID=your_tenant_id
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
GRAPH_REDIRECT_URI=your_redirect_uri
```

### 3. Database Migration

Run the migration to create the UserToken table:

```bash
cd ws-aimelia/apps/api
python migrate.py
```

## Usage

### Authentication Flow

1. **Login**: `GET /auth/login` - Redirects to Microsoft OAuth
2. **Callback**: `GET /auth/callback?code=...` - Handles OAuth callback and stores encrypted tokens
3. **Get Token**: `GET /auth/token` - Returns current token status
4. **Revoke**: `POST /auth/revoke` - Revokes and deletes stored tokens

### Using Tokens in Your Code

```python
from app.token_manager import token_manager
from app.db import get_db

# Get a valid access token (auto-refreshes if needed)
async def my_function(db: Session = Depends(get_db)):
    access_token = await token_manager.get_valid_access_token(db, "tom")
    if not access_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    # Use the token for Microsoft Graph API calls
    # ... your code here
```

### Direct Token Manager Usage

```python
from app.token_manager import token_manager
from app.db import get_db

# Store tokens after OAuth
tokens = {"access_token": "...", "refresh_token": "...", "expires_in": 3600}
success = await token_manager.store_tokens(db, "tom", tokens)

# Get valid token (auto-refreshes if needed)
access_token = await token_manager.get_valid_access_token(db, "tom")

# Revoke tokens
success = await token_manager.revoke_tokens(db, "tom")
```

## API Endpoints

### Authentication

- `GET /auth/login` - Start OAuth flow
- `GET /auth/callback` - OAuth callback handler
- `GET /auth/token` - Check token status
- `POST /auth/revoke` - Revoke stored tokens

### Email Operations

- `POST /emails/triage/run` - Run email triage (uses authenticated token)
- `POST /emails/drafts/create` - Create email draft (uses authenticated token)

### Calendar Operations

- `GET /calendar/next24` - Get next 24 hours of events (uses authenticated token)

## Security Features

1. **Encryption**: All tokens encrypted with Fernet before storage
2. **Key Management**: Encryption key stored in environment variables
3. **Automatic Refresh**: Tokens refreshed before expiration (5-minute buffer)
4. **Error Handling**: Graceful handling of refresh failures
5. **Logging**: Comprehensive logging for debugging and monitoring

## Database Schema

```sql
CREATE TABLE user_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR UNIQUE NOT NULL,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Error Handling

The system handles various error scenarios:

- **No tokens found**: Returns 401 with clear message
- **Token refresh failed**: Logs error and returns 401
- **Encryption/decryption errors**: Logs error and returns 500
- **Database errors**: Proper rollback and error logging

## Monitoring

Check logs for:
- Token storage success/failure
- Token refresh attempts
- Authentication errors
- Encryption/decryption issues

## Extending for Multiple Users

To support multiple users, simply:

1. Pass different `user_id` values to token manager methods
2. Update the hardcoded "tom" references in endpoints
3. Add user authentication/authorization as needed

The database schema already supports multiple users via the `user_id` field.
