#!/usr/bin/env python3
"""
Test Microsoft Graph authentication flow directly through API endpoints.
This tests the backend authentication without needing the frontend.
"""
import requests
import webbrowser
import time
from urllib.parse import urlparse, parse_qs

def test_auth_flow():
    """Test the complete authentication flow."""
    base_url = "https://aimelia-api.onrender.com"
    
    print("🔍 Testing Aimelia Authentication Flow")
    print("=" * 50)
    
    # Step 1: Test API health
    print("\n1. Testing API Health...")
    try:
        response = requests.get(f"{base_url}/", timeout=10)
        print(f"   ✅ API Status: {response.status_code}")
        print(f"   Response: {response.json()}")
    except Exception as e:
        print(f"   ❌ API Error: {e}")
        return
    
    # Step 2: Get login URL
    print("\n2. Getting Login URL...")
    try:
        response = requests.get(f"{base_url}/auth/login", timeout=10, allow_redirects=False)
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 302:
            login_url = response.headers.get('Location')
            print(f"   ✅ Login URL: {login_url}")
            
            # Parse the URL to show parameters
            parsed = urlparse(login_url)
            params = parse_qs(parsed.query)
            print(f"   📋 OAuth Parameters:")
            for key, value in params.items():
                print(f"      {key}: {value[0] if value else 'None'}")
            
            return login_url
        else:
            print(f"   ❌ Expected redirect (302), got {response.status_code}")
            print(f"   Response: {response.text}")
    except Exception as e:
        print(f"   ❌ Login URL Error: {e}")
    
    return None

def test_token_endpoint():
    """Test the token endpoint."""
    base_url = "https://aimelia-api.onrender.com"
    
    print("\n3. Testing Token Endpoint...")
    try:
        response = requests.get(f"{base_url}/auth/token", timeout=10)
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")
        
        if response.status_code == 200:
            print("   ✅ Token endpoint accessible")
        else:
            print("   ⚠️  No valid token (expected if not authenticated)")
    except Exception as e:
        print(f"   ❌ Token endpoint error: {e}")

def open_login_url(login_url):
    """Open the login URL in browser."""
    print(f"\n4. Opening Login URL in Browser...")
    print(f"   URL: {login_url}")
    print(f"   📝 Instructions:")
    print(f"   1. Complete the Microsoft login in your browser")
    print(f"   2. After login, you'll be redirected to the callback URL")
    print(f"   3. Copy the 'code' parameter from the URL")
    print(f"   4. Run: python3 test_callback.py <code>")
    
    try:
        webbrowser.open(login_url)
        print(f"   ✅ Browser opened")
    except Exception as e:
        print(f"   ❌ Could not open browser: {e}")
        print(f"   📋 Manual step: Open this URL in your browser:")
        print(f"   {login_url}")

def main():
    """Main test function."""
    print("🚀 Aimelia Authentication Test")
    print("This will test the backend authentication flow")
    print("Make sure your Azure AD redirect URI is configured!")
    print()
    
    # Test the flow
    login_url = test_auth_flow()
    test_token_endpoint()
    
    if login_url:
        open_login_url(login_url)
    
    print("\n" + "=" * 50)
    print("📋 Next Steps:")
    print("1. Complete Microsoft login in browser")
    print("2. Copy the 'code' from the callback URL")
    print("3. Run: python3 test_callback.py <your_code>")
    print("4. Check if tokens are stored successfully")

if __name__ == "__main__":
    main()
