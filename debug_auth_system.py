#!/usr/bin/env python3
"""
Debug the authentication system to identify the login loop issue.
"""
import asyncio
import httpx

async def debug_auth_flow():
    """Test the complete authentication flow with detailed logging."""
    print("🔍 DEBUGGING AIMELIA AUTHENTICATION SYSTEM")
    print("=" * 50)
    
    base_url = "https://aimelia-api.onrender.com"
    
    # Test 1: Health check
    print("\n1. Testing API Health...")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{base_url}/health", timeout=10)
            print(f"   ✅ Health Status: {response.status_code}")
            print(f"   Response: {response.json()}")
    except Exception as e:
        print(f"   ❌ Health check failed: {e}")
    
    # Test 2: Token endpoint (should fail with no auth)
    print("\n2. Testing Token Endpoint...")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{base_url}/auth/token", timeout=10)
            data = response.json()
            print(f"   Status Code: {response.status_code}")
            print(f"   Response: {data}")
    except Exception as e:
        print(f"   ❌ Token test failed: {e}")
    
    # Test 3: Login redirect
    print("\n3. Testing Login Redirect...")
    try:
        async with httpx.AsyncClient(follow_redirects=False) as client:
            response = await client.get(f"{base_url}/auth/login", timeout=10)
            print(f"   Status Code: {response.status_code}")
            if response.status_code == 302:
                redirect_url = response.headers.get('Location')
                print(f"   Redirect URL: {redirect_url}")
                if 'login.microsoftonline.com' in redirect_url:
                    print("   ✅ Microsoft redirect looks correct")
                else:
                    print("   ❌ Unexpected redirect URL")
            else:
                print(f"   ❌ Expected 302 redirect, got {response.status_code}")
                print(f"   Response: {response.text}")
    except Exception as e:
        print(f"   ❌ Login redirect test failed: {e}")
    
    # Test 4: Callback endpoint
    print("\n4. Testing Callback Endpoint...")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{base_url}/auth/callback", timeout=10)
            print(f"   Status Code: {response.status_code}")
            data = response.json()
            print(f"   Response: {data}")
    except Exception as e:
        print(f"   ❌ Callback test failed: {e}")
    
    # Test 5: Email triage (should fail without auth)
    print("\n5. Testing Email Triage (should fail)...")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{base_url}/emails/triage/run", timeout=10)
            print(f"   Status Code: {response.status_code}")
            data = response.json()
            print(f"   Response: {data}")
    except Exception as e:
        print(f"   ❌ Email triage test failed: {e}")
    
    print("\n" + "=" * 50)
    print("🎯 DEBUGGING COMPLETE")
    print("=" * 50)

if __name__ == "__main__":
    asyncio.run(debug_auth_flow())