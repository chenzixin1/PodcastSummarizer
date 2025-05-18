/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Disable ESLint during builds, we're adding inline disable comments instead
    ignoreDuringBuilds: true,
  },
  env: {
    // LLM Model Configuration
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-preview',
    
    // Processing Limits
    MAX_CONTENT_LENGTH: process.env.MAX_CONTENT_LENGTH || '300000',
    MAX_SUMMARY_TOKENS: process.env.MAX_SUMMARY_TOKENS || '8000',
    MAX_TRANSLATION_TOKENS: process.env.MAX_TRANSLATION_TOKENS || '16000',
    MAX_HIGHLIGHTS_TOKENS: process.env.MAX_HIGHLIGHTS_TOKENS || '12000',
    
    // Retry Configuration
    MAX_RETRIES: process.env.MAX_RETRIES || '2',
    RETRY_DELAY: process.env.RETRY_DELAY || '1000',
  },
}

module.exports = nextConfig 