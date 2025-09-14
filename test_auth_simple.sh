#!/bin/bash

# Simple authentication test using curl
echo "🔍 Testing Aimelia Authentication Flow"
echo "======================================"

BASE_URL="https://aimelia-api.onrender.com"

echo ""
echo "1. Testing API Health..."
curl -s "$BASE_URL/" | jq '.' 2>/dev/null || curl -s "$BASE_URL/"

echo ""
echo ""
echo "2. Getting Login URL..."
LOGIN_RESPONSE=$(curl -s -I "$BASE_URL/auth/login")
echo "Response headers:"
echo "$LOGIN_RESPONSE"

echo ""
echo "3. Extracting redirect URL..."
LOGIN_URL=$(echo "$LOGIN_RESPONSE" | grep -i "location:" | cut -d' ' -f2- | tr -d '\r\n')
echo "Login URL: $LOGIN_URL"

if [ ! -z "$LOGIN_URL" ]; then
    echo ""
    echo "4. Opening login URL in browser..."
    echo "URL: $LOGIN_URL"
    echo ""
    echo "📝 Instructions:"
    echo "1. Open the URL above in your browser"
    echo "2. Complete Microsoft login"
    echo "3. You'll be redirected to a callback URL with a 'code' parameter"
    echo "4. Copy the 'code' value from the URL"
    echo "5. Run: ./test_callback_simple.sh <your_code>"
    
    # Try to open in browser
    if command -v open &> /dev/null; then
        open "$LOGIN_URL"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$LOGIN_URL"
    else
        echo "Please manually open: $LOGIN_URL"
    fi
else
    echo "❌ Could not extract login URL"
fi
