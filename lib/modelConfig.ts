// Model and API configuration
export const modelConfig = {
  // API version for tracking
  API_VERSION: '1.0.1',
  
  // OpenAI/OpenRouter model configuration
  MODEL: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
  
  // Content processing limits 
  MAX_CONTENT_LENGTH: parseInt(process.env.MAX_CONTENT_LENGTH || '300000', 10),
  SUMMARY_CHUNK_LENGTH: parseInt(process.env.SUMMARY_CHUNK_LENGTH || '80000', 10),
  TRANSLATION_CHUNK_BLOCKS: parseInt(process.env.TRANSLATION_CHUNK_BLOCKS || '180', 10),
  HIGHLIGHTS_CHUNK_BLOCKS: parseInt(process.env.HIGHLIGHTS_CHUNK_BLOCKS || '180', 10),
  MAX_TRANSLATION_CHUNKS: parseInt(process.env.MAX_TRANSLATION_CHUNKS || '24', 10),
  MAX_HIGHLIGHTS_CHUNKS: parseInt(process.env.MAX_HIGHLIGHTS_CHUNKS || '24', 10),
  TRANSLATION_CHUNK_CONCURRENCY: parseInt(process.env.TRANSLATION_CHUNK_CONCURRENCY || '3', 10),
  HIGHLIGHTS_CHUNK_CONCURRENCY: parseInt(process.env.HIGHLIGHTS_CHUNK_CONCURRENCY || '2', 10),
  ENABLE_PARALLEL_TASKS: process.env.ENABLE_PARALLEL_TASKS !== 'false',
  MAX_TOKENS: {
    summary: parseInt(process.env.MAX_SUMMARY_TOKENS || '8000', 10),
    translation: parseInt(process.env.MAX_TRANSLATION_TOKENS || '16000', 10),
    highlights: parseInt(process.env.MAX_HIGHLIGHTS_TOKENS || '12000', 10)
  },
  
  // API retry configuration
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '2', 10),
  RETRY_DELAY: parseInt(process.env.RETRY_DELAY || '1000', 10),
  API_TIMEOUT_MS: parseInt(process.env.API_TIMEOUT_MS || '120000', 10),
  STATUS_HEARTBEAT_MS: parseInt(process.env.STATUS_HEARTBEAT_MS || '8000', 10)
}; 
