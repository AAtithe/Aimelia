#!/usr/bin/env python3
"""
Quick test script to verify Microsoft Graph authentication setup.
"""
import requests
import json

def test_auth_endpoints():
    """Test the authentication endpoints."""
    base_url = "https://aimelia-api.onrender.com"
    
    print("🔍 Testing Aimelia API Authentication...")
    print(f"API Base URL: {base_url}")
    
    # Test 1: Check if API is running
    try:
        response = requests.get(f"{base_url}/", timeout=10)
        print(f"✅ API Status: {response.status_code}")
        print(f"   Response: {response.json()}")
    except Exception as e:
        print(f"❌ API not accessible: {e}")
        return
    
    # Test 2: Check auth endpoints
    try:
        response = requests.get(f"{base_url}/auth/login", timeout=10, allow_redirects=False)
        print(f"✅ Login endpoint: {response.status_code}")
        if response.status_code == 302:
            print(f"   Redirect URL: {response.headers.get('Location', 'No location header')}")
    except Exception as e:
        print(f"❌ Login endpoint error: {e}")
    
    # Test 3: Check token endpoint
    try:
        response = requests.get(f"{base_url}/auth/token", timeout=10)
        print(f"✅ Token endpoint: {response.status_code}")
        if response.status_code == 200:
            print(f"   Response: {response.json()}")
    except Exception as e:
        print(f"❌ Token endpoint error: {e}")

def print_azure_config():
    """Print the Azure AD configuration needed."""
    print("\n🔧 Azure AD Configuration Required:")
    print("=" * 50)
    print("1. Go to: https://portal.azure.com")
    print("2. Navigate to: Azure Active Directory → App registrations")
    print("3. Find app: 'Aimelia' (Client ID: 880818f6-a9af-43ea-9c12-1813bcecce89)")
    print("4. Go to: Authentication → Redirect URIs")
    print("5. Add these redirect URIs:")
    print("   - https://aimelia-api.onrender.com/auth/callback")
    print("   - https://aimelia-oof8nipex-williams-stanley.vercel.app/auth/callback")
    print("   - http://localhost:8000/auth/callback")
    print("\n6. Save the configuration")
    print("7. Wait 5-10 minutes for changes to propagate")

if __name__ == "__main__":
    test_auth_endpoints()
    print_azure_config()
