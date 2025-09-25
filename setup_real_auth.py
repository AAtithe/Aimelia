#!/usr/bin/env python3
"""
Setup script to configure Aimelia with real authentication.
This script will:
1. Generate an encryption key for token storage
2. Verify database connection
3. Test environment variables
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'ws-aimelia', 'apps', 'api'))

from cryptography.fernet import Fernet
import asyncio
import httpx

def generate_encryption_key():
    """Generate a Fernet encryption key."""
    key = Fernet.generate_key()
    key_str = key.decode()
    print("🔐 Generated Fernet encryption key:")
    print(f"ENCRYPTION_KEY={key_str}")
    print("\n⚠️  IMPORTANT: Add this to your Render environment variables!")
    print("   Go to render.com → your service → Environment → Add Environment Variable")
    print("   Name: ENCRYPTION_KEY")
    print(f"   Value: {key_str}")
    return key_str

async def test_render_health():
    """Test if Render service is healthy."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("https://aimelia-api.onrender.com/health", timeout=10)
            if response.status_code == 200:
                data = response.json()
                print("✅ Render service is healthy")
                print(f"   Version: {data.get('version')}")
                print(f"   Status: {data.get('status')}")
                return True
            else:
                print(f"❌ Render service returned status {response.status_code}")
                return False
    except Exception as e:
        print(f"❌ Failed to connect to Render service: {e}")
        return False

async def test_auth_endpoint():
    """Test authentication endpoint."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("https://aimelia-api.onrender.com/auth/token", timeout=10)
            data = response.json()
            print("🔓 Auth endpoint status:")
            print(f"   Status: {data.get('status')}")
            print(f"   Has Token: {data.get('has_token')}")
            print(f"   Message: {data.get('message', 'No message')}")
            
            # If no token, that's expected before authentication
            if data.get('status') == 'error' and 'No valid token' in data.get('message', ''):
                print("✅ Auth system is working (no token expected until user logs in)")
                return True
            elif data.get('has_token'):
                print("✅ User already has valid token")
                return True
            else:
                print("⚠️  Unexpected auth response")
                return False
    except Exception as e:
        print(f"❌ Auth endpoint test failed: {e}")
        return False

def show_next_steps():
    """Show next steps for user."""
    print("\n" + "="*60)
    print("🚀 NEXT STEPS TO GET YOUR EMAILS:")
    print("="*60)
    print("1. Add the ENCRYPTION_KEY to your Render environment:")
    print("   → Go to render.com")
    print("   → Find your 'aimelia-api' service")
    print("   → Environment tab → Add environment variable")
    print("   → Name: ENCRYPTION_KEY, Value: [the key above]")
    print()
    print("2. Redeploy your Render service:")
    print("   → Manual Deploy → Deploy latest commit")
    print("   → Wait for deployment to complete")
    print()
    print("3. Test real authentication:")
    print("   → Go to https://aimelia.vercel.app")
    print("   → Click 'Sign in with Microsoft'")
    print("   → Complete authentication")
    print("   → Your real emails should now appear!")
    print()
    print("4. Check that emails are loading:")
    print("   → After authentication, dashboard should show real email counts")
    print("   → Email triage should show your actual emails")
    print("   → No more 'demo mode' messages")
    print()
    print("🎯 The goal: Get your actual Outlook emails showing in Aimelia")
    print("    with AI-powered triage and intelligent categorization!")

async def main():
    print("🎯 Setting up Aimelia for REAL email access...")
    print("="*50)
    
    # Generate encryption key
    encryption_key = generate_encryption_key()
    print()
    
    # Test Render service
    print("Testing Render deployment...")
    render_ok = await test_render_health()
    print()
    
    # Test auth endpoint
    print("Testing authentication system...")
    auth_ok = await test_auth_endpoint()
    print()
    
    # Show next steps
    show_next_steps()
    
    # Final status
    print("\n" + "="*60)
    if render_ok and auth_ok:
        print("✅ READY: Add the encryption key to Render and redeploy!")
        print("   After that, you'll have real email access in Aimelia.")
    else:
        print("⚠️  ISSUES: Fix the problems above before proceeding")
    print("="*60)

if __name__ == "__main__":
    asyncio.run(main())