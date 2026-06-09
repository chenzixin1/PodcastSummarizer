# NextAuth Environment Variables Setup Guide

## Required Environment Variables

Set these values as Cloudflare Worker secrets or local development environment variables.

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

## How to Set in Cloudflare

Use Wrangler against the production Worker config:

```bash
printf '%s' "$NEXTAUTH_SECRET" | npx wrangler secret put NEXTAUTH_SECRET -c output/cutover/wrangler.production.jsonc
printf '%s' "$GOOGLE_CLIENT_ID" | npx wrangler secret put GOOGLE_CLIENT_ID -c output/cutover/wrangler.production.jsonc
printf '%s' "$GOOGLE_CLIENT_SECRET" | npx wrangler secret put GOOGLE_CLIENT_SECRET -c output/cutover/wrangler.production.jsonc
```

`NEXTAUTH_URL=https://podsum.cc` is configured in the production Wrangler config.

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

1. Deploy the Cloudflare Worker
2. Test authentication at: https://podsum.cc/auth/signin
3. Verify no more configuration errors

## Current Status Check

You can check which variables are set using:
```bash
curl -s "https://podsum.cc/api/debug/env" | jq .
```

This will show you which environment variables are configured. 
