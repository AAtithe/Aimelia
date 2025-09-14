#!/bin/bash

# Test OAuth callback with authorization code
if [ $# -ne 1 ]; then
    echo "Usage: ./test_callback_simple.sh <authorization_code>"
    echo ""
    echo "To get the authorization code:"
    echo "1. Run: ./test_auth_simple.sh"
    echo "2. Complete Microsoft login in browser"
    echo "3. Copy the 'code' parameter from the callback URL"
    echo "4. Run this script with the code"
    exit 1
fi

AUTH_CODE="$1"
BASE_URL="https://aimelia-api.onrender.com"

echo "🔍 Testing OAuth Callback"
echo "========================="
echo "Authorization Code: ${AUTH_CODE:0:10}..."

echo ""
echo "1. Calling callback endpoint..."
CALLBACK_URL="$BASE_URL/auth/callback?code=$AUTH_CODE"
echo "URL: $CALLBACK_URL"

echo ""
echo "Response:"
curl -s "$CALLBACK_URL" | jq '.' 2>/dev/null || curl -s "$CALLBACK_URL"

echo ""
echo ""
echo "2. Testing token retrieval..."
echo "Response:"
curl -s "$BASE_URL/auth/token" | jq '.' 2>/dev/null || curl -s "$BASE_URL/auth/token"

echo ""
echo ""
echo "3. Testing email triage (if authenticated)..."
curl -s -X POST "$BASE_URL/emails/triage/run" | jq '.' 2>/dev/null || curl -s -X POST "$BASE_URL/emails/triage/run"
