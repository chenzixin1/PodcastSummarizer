This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Environment Variables

The application uses several environment variables to configure the LLM model and processing settings:

### Required Environment Variables

- `OPENROUTER_API_KEY`: Your API key for OpenRouter

### Optional Environment Variables (with defaults)

- `OPENROUTER_MODEL`: LLM model to use (default: "google/gemini-2.5-flash-preview")
- `MAX_CONTENT_LENGTH`: Maximum content length for processing (default: 300000)
- `MAX_SUMMARY_TOKENS`: Maximum tokens for summary generation (default: 8000)
- `MAX_TRANSLATION_TOKENS`: Maximum tokens for translation (default: 16000)
- `MAX_HIGHLIGHTS_TOKENS`: Maximum tokens for highlights (default: 12000)
- `MAX_RETRIES`: Maximum API call retry attempts (default: 2)
- `RETRY_DELAY`: Delay between retries in milliseconds (default: 1000)

You can set these environment variables:
1. Through your hosting platform (e.g., Vercel)
2. In a local `.env.local` file for development
3. They can also be overridden in `next.config.js`

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
