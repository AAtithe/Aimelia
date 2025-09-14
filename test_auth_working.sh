#!/bin/bash

# Working authentication test
echo "🔍 Testing Aimelia Authentication Flow"
echo "======================================"

BASE_URL="https://aimelia-api.onrender.com"

echo ""
echo "1. Testing API Health..."
curl -s "$BASE_URL/" | jq '.' 2>/dev/null || curl -s "$BASE_URL/"

echo ""
echo ""
echo "2. Getting Login URL..."
LOGIN_URL=$(curl -s -I "$BASE_URL/auth/login" | grep -i "location:" | cut -d' ' -f2- | tr -d '\r\n')

if [ ! -z "$LOGIN_URL" ]; then
    echo "✅ Login URL found!"
    echo "URL: $LOGIN_URL"
    
    echo ""
    echo "3. Parsing OAuth parameters..."
    echo "$LOGIN_URL" | sed 's/.*?//' | tr '&' '\n' | while IFS='=' read -r key value; do
        echo "   $key: $value"
    done
    
    echo ""
    echo "4. Opening login URL in browser..."
    echo "📝 Instructions:"
    echo "1. Complete Microsoft login in your browser"
    echo "2. You'll be redirected to: https://aimelia-api.onrender.com/auth/callback?code=..."
    echo "3. Copy the 'code' parameter from the URL"
    echo "4. Run: ./test_callback_working.sh <your_code>"
    
    # Try to open in browser
    if command -v open &> /dev/null; then
        open "$LOGIN_URL"
        echo "✅ Browser opened"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$LOGIN_URL"
        echo "✅ Browser opened"
    else
        echo "Please manually open: $LOGIN_URL"
    fi
else
    echo "❌ Could not extract login URL"
    echo "Trying alternative method..."
    
    # Alternative method
    LOGIN_RESPONSE=$(curl -s -D - "$BASE_URL/auth/login")
    echo "Full response:"
    echo "$LOGIN_RESPONSE"
fi
