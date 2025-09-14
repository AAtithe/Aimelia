#!/usr/bin/env python3
"""
Test the OAuth callback with an authorization code.
Usage: python3 test_callback.py <authorization_code>
"""
import requests
import sys

def test_callback(auth_code):
    """Test the OAuth callback with authorization code."""
    base_url = "https://aimelia-api.onrender.com"
    
    print("🔍 Testing OAuth Callback")
    print("=" * 30)
    print(f"Authorization Code: {auth_code[:10]}...")
    
    # Test the callback endpoint
    callback_url = f"{base_url}/auth/callback"
    params = {"code": auth_code}
    
    print(f"\n1. Calling callback endpoint...")
    print(f"   URL: {callback_url}")
    print(f"   Code: {auth_code}")
    
    try:
        response = requests.get(callback_url, params=params, timeout=30)
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")
        
        if response.status_code == 200:
            print("   ✅ Callback successful!")
            data = response.json()
            if data.get("tokens_saved"):
                print("   ✅ Tokens stored successfully!")
            else:
                print("   ⚠️  Tokens not stored")
        else:
            print("   ❌ Callback failed")
            
    except Exception as e:
        print(f"   ❌ Callback error: {e}")
    
    # Test token retrieval
    print(f"\n2. Testing token retrieval...")
    try:
        response = requests.get(f"{base_url}/auth/token", timeout=10)
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")
        
        if response.status_code == 200:
            print("   ✅ Token retrieval successful!")
        else:
            print("   ⚠️  No valid token available")
            
    except Exception as e:
        print(f"   ❌ Token retrieval error: {e}")

def main():
    """Main function."""
    if len(sys.argv) != 2:
        print("Usage: python3 test_callback.py <authorization_code>")
        print("\nTo get the authorization code:")
        print("1. Run: python3 test_auth_flow.py")
        print("2. Complete Microsoft login in browser")
        print("3. Copy the 'code' parameter from the callback URL")
        print("4. Run this script with the code")
        sys.exit(1)
    
    auth_code = sys.argv[1]
    test_callback(auth_code)

if __name__ == "__main__":
    main()
