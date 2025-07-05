#!/bin/bash

echo "🔧 NextAuth Environment Variables Setup"
echo "======================================="
echo ""

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI is not installed. Please install it first:"
    echo "   npm i -g vercel"
    exit 1
fi

echo "📋 Setting up required NextAuth environment variables..."
echo ""

# Set NEXTAUTH_SECRET
echo "Setting NEXTAUTH_SECRET..."
vercel env add NEXTAUTH_SECRET production --value="QBAFl4qdCGr3n3LvQzf99PHY7ynAk6BEQU/ZgXGsIyo="

# Set NEXTAUTH_URL
echo "Setting NEXTAUTH_URL..."
vercel env add NEXTAUTH_URL production --value="https://podsum.cc"

echo ""
echo "✅ NextAuth environment variables have been set!"
echo ""
echo "📝 Next steps:"
echo "1. Redeploy your application: vercel --prod"
echo "2. Or wait for automatic deployment"
echo "3. Test authentication at: https://podsum.cc/auth/signin"
echo ""
echo "🔍 Check variables status:"
echo "   curl -s \"https://podsum.cc/api/debug/env\" | jq ."
echo ""
echo "For Google OAuth setup, see GOOGLE_OAUTH_SETUP.md" 