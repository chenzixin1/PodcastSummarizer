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

## 🧪 Testing

This project includes comprehensive test coverage with Jest and React Testing Library.

### Test Structure

```
__tests__/
├── 📂 lib/         # Database operations (✅ 38/38 passing)
├── 📂 api/         # API endpoints (🟡 7/29 passing)  
└── 📂 dashboard/   # React components (🔧 needs fixes)
```

### Running Tests

```bash
# Run all tests
npm test

# Quick test commands
npm run test:db          # Database tests (100% passing - recommended)
npm run test:api         # API endpoint tests  
npm run test:components  # React component tests
npm run test:working     # Only run passing tests
npm run test:coverage    # Generate coverage report

# Advanced options
npm run test:watch       # Watch mode
npm run test:debug       # Debug mode
npm run test:clear       # Clear Jest cache
```

### Using Test Script

```bash
# Convenient test runner script
./scripts/test.sh status    # Show test status summary
./scripts/test.sh db        # Run database tests (recommended)
./scripts/test.sh working   # Run only passing tests
./scripts/test.sh help      # Show all options
```

### Test Status
- **Database Layer**: ✅ 100% coverage (38/38 tests passing)
- **API Endpoints**: 🟡 Partial coverage (7/29 tests passing)  
- **Components**: 🔧 Needs fixing (ES module issues)

For detailed test documentation, see [__tests__/README.md](__tests__/README.md).

## 🛠️ Scripts & Tools

The project includes various scripts and tools organized in the `scripts/` directory:

### Quick Access
```bash
# Main test runner (recommended)
./scripts/test.sh status    # View test status
./scripts/test.sh working   # Run passing tests only

# Environment verification
node scripts/testing/test-db-connection.mjs     # Check database
node scripts/testing/simple-openrouter-test.mjs # Check API
```

### Available Scripts
- **📂 `scripts/testing/`**: API and database connection tests
- **📂 `scripts/utils/`**: Development and maintenance tools
- **🗃️ Database tools**: `init-db.mjs`, `init-db.ts`
- **📡 HTTP testing**: `test-requests.ts`

For detailed script documentation, see [scripts/README.md](scripts/README.md).

## Environment Variables

The application uses several environment variables to configure the LLM model and processing settings:

### Required Environment Variables

- `OPENROUTER_API_KEY`: Your API key for OpenRouter

### Optional Environment Variables (with defaults)

- `OPENROUTER_MODEL`: LLM model to use (default: "google/gemini-2.5-flash")
- `OPENROUTER_EMBEDDING_MODEL`: Embedding model for QA hybrid retrieval (default: "openai/text-embedding-3-small")
- `MAX_CONTENT_LENGTH`: Maximum content length for processing (default: 300000)
- `SUMMARY_CHUNK_LENGTH`: Summary checkpoint chunk length (default: 80000)
- `TRANSLATION_CHUNK_BLOCKS`: Translation chunk size in SRT blocks (default: 120)
- `HIGHLIGHTS_CHUNK_BLOCKS`: Full-text highlights chunk size in SRT blocks (default: 120)
- `MAX_SUMMARY_TOKENS`: Maximum tokens for summary generation (default: 8000)
- `MAX_TRANSLATION_TOKENS`: Maximum tokens for translation (default: 16000)
- `MAX_HIGHLIGHTS_TOKENS`: Maximum tokens for highlights (default: 12000)
- `MAX_RETRIES`: Maximum API call retry attempts (default: 2)
- `RETRY_DELAY`: Delay between retries in milliseconds (default: 1000)
- `QA_MAX_RETRIEVED_CHUNKS`: Number of chunks used as QA evidence (default: 8)
- `QA_MAX_TOTAL_CHUNKS`: Max indexed chunks per podcast for QA (default: 180)
- `DEFAULT_SRT_CREDITS`: Default signup credits (default: 10)
- `INITIAL_SRT_CREDITS_OVERRIDES`: Optional per-user credits override, format `email:credits,email2:credits2`
- `ADMIN_EMAILS`: Comma-separated admin allowlist for maintenance/debug APIs
- `NEXT_PUBLIC_DEBUG_LOGS`: Set `true` to enable client debug logs in browser
- `NEXT_PUBLIC_SEND_DEBUG_TO_SERVER`: Set `true` to allow client debug uploads to `/api/debug`
- `PROCESS_DEBUG_LOGS`: Set `true` to enable verbose `/api/process` server logs
- `UPLOAD_DEBUG_LOGS`: Set `true` to enable verbose upload pipeline logs
- `ANALYSIS_DEBUG_LOGS`: Set `true` to enable verbose `/api/analysis/:id` logs

### YouTube + Volcano ASR Fallback

When uploading a YouTube URL, the backend now does:
1. Try native/auto YouTube captions with language fallback
2. If captions are unavailable and `GLADIA_FALLBACK_ENABLED=true`, call Gladia pre-recorded API directly with the YouTube URL and request SRT
3. If Gladia is disabled/unavailable/fails, download audio, upload audio to Vercel Blob, then call Volcano Engine ASR and convert result to SRT

Environment variables for this pipeline:

- `BLOB_READ_WRITE_TOKEN`: Required for storing uploaded SRT and fallback audio on Vercel Blob
- `GLADIA_FALLBACK_ENABLED`: Default disabled. Set `true`/`1` to enable Gladia fallback.
- `GLADIA_API_KEY`: Optional paid fallback provider key (required only when `GLADIA_FALLBACK_ENABLED=true`)
- `GLADIA_BASE_URL`: Default `https://api.gladia.io`
- `GLADIA_MAX_RETRIES`: Default `120`
- `GLADIA_RETRY_DELAY_MS`: Default `5000`
- `VOLCANO_ACCESS_KEY`: Volcano/ByteDance ASR key (`x-api-key`)
- `VOLCANO_RESOURCE_ID`: Default `volc.bigasr.auc`
- `VOLCANO_SUBMIT_URL`: Default `https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit`
- `VOLCANO_QUERY_URL`: Default `https://openspeech.bytedance.com/api/v3/auc/bigmodel/query`
- `VOLCANO_ASR_LANG`: Default `zh`
- `VOLCANO_MAX_RETRIES`: Default `60`
- `VOLCANO_RETRY_DELAY_MS`: Default `5000`
- `YOUTUBE_PREFERRED_CAPTION_LANGS`: Comma-separated language preference list (default `zh-Hans,zh-CN,zh,zh-Hant,zh-TW,en,en-US`)
- `YOUTUBE_COOKIES_JSON`: Optional JSON cookie array for ytdl agent (improves restricted-video fallback)
- `YOUTUBE_COOKIES`: Optional raw cookie header as semicolon-separated `name=value` pairs
- `YOUTUBE_YTDL_PLAYER_CLIENTS`: Optional comma-separated player clients for ytdl `getInfo`
- `YOUTUBE_MAX_AUDIO_DURATION_SECONDS`: Max duration allowed for ASR fallback (default `10800`)
- `YOUTUBE_MAX_AUDIO_BYTES`: Max downloadable audio size (default `157286400`)
- `YOUTUBE_MAX_FORMAT_ATTEMPTS`: Max candidate audio formats to retry in ytdl fallback (default `4`)

### Extension Monitor (Path1 + Path2 Observability)

A server-side monitor page is available for extension task debugging:

- Page: `/ops/extension-monitor`
- API: `/api/ops/extension-monitor/tasks` and `/api/ops/extension-monitor/tasks/:id`
- Access: Any logged-in NextAuth user (current temporary policy)

Runtime switches:

- `EXTENSION_MONITOR_ENABLED`: default `false`. Must be `true` to enable monitor APIs/UI and ingestion.
- `EXTENSION_MONITOR_CAPTURE_RAW`: default `false`. Set `true` to persist raw request/response payloads.
- `EXTENSION_MONITOR_RETENTION_DAYS`: default `3`. Automatic cleanup window for monitor tasks/events.

Notes:

- Raw logging now redacts sensitive headers/fields (`Authorization`, `Cookie`, API keys, tokens, passwords).
- Any `password` field is always redacted before persistence.

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
