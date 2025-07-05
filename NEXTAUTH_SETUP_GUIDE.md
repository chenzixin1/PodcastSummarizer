# NextAuth Environment Variables Setup Guide

## Required Environment Variables

To fix the NextAuth configuration error, you need to set these environment variables in your Vercel deployment:

### 1. NEXTAUTH_SECRET
A random secret used to encrypt JWT tokens. Generate a secure random string:

```bash
# Generate a random secret (run this command)
openssl rand -base64 32
```

**Example value:** `your-generated-secret-here`

### 2. NEXTAUTH_URL
The canonical URL of your site:

```bash
NEXTAUTH_URL=https://podsum.cc
```

### 3. Google OAuth (Optional)
If you want to enable Google login:

```bash
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

## How to Set in Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project (PodcastSummarizer)
3. Go to Settings > Environment Variables
4. Add each variable:
   - **Name**: `NEXTAUTH_SECRET`
   - **Value**: Your generated secret
   - **Environment**: Production, Preview, Development

5. Repeat for `NEXTAUTH_URL`

## Minimal Setup (Authentication will work)

If you just want to fix the error and get basic authentication working:

```bash
NEXTAUTH_SECRET=your-random-secret-here
NEXTAUTH_URL=https://podsum.cc
```

## Full Setup (With Google OAuth)

For complete functionality including Google login:

```bash
NEXTAUTH_SECRET=your-random-secret-here
NEXTAUTH_URL=https://podsum.cc
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

## After Setting Variables

1. Redeploy your application or wait for automatic deployment
2. Test authentication at: https://podsum.cc/auth/signin
3. Verify no more configuration errors

## Current Status Check

You can check which variables are set using:
```bash
curl -s "https://podsum.cc/api/debug/env" | jq .
```

This will show you which environment variables are configured. 