const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  env: {
    // LLM Model Configuration
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
    
    // Processing Limits
    MAX_CONTENT_LENGTH: process.env.MAX_CONTENT_LENGTH || '300000',
    SUMMARY_CHUNK_LENGTH: process.env.SUMMARY_CHUNK_LENGTH || '80000',
    TRANSLATION_CHUNK_BLOCKS: process.env.TRANSLATION_CHUNK_BLOCKS || '120',
    HIGHLIGHTS_CHUNK_BLOCKS: process.env.HIGHLIGHTS_CHUNK_BLOCKS || '120',
    MAX_SUMMARY_TOKENS: process.env.MAX_SUMMARY_TOKENS || '8000',
    MAX_TRANSLATION_TOKENS: process.env.MAX_TRANSLATION_TOKENS || '16000',
    MAX_HIGHLIGHTS_TOKENS: process.env.MAX_HIGHLIGHTS_TOKENS || '12000',
    
    // Retry Configuration
    MAX_RETRIES: process.env.MAX_RETRIES || '2',
    RETRY_DELAY: process.env.RETRY_DELAY || '1000',
  },
}

module.exports = nextConfig 
