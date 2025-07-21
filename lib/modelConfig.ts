// Model and API configuration
export const modelConfig = {
  // API version for tracking
  API_VERSION: '1.0.1',
  
  // OpenAI/OpenRouter model configuration
  MODEL: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-pro',
  
  // Content processing limits 
  MAX_CONTENT_LENGTH: parseInt(process.env.MAX_CONTENT_LENGTH || '300000', 10),
  MAX_TOKENS: {
    summary: parseInt(process.env.MAX_SUMMARY_TOKENS || '8000', 10),
    translation: parseInt(process.env.MAX_TRANSLATION_TOKENS || '16000', 10),
    highlights: parseInt(process.env.MAX_HIGHLIGHTS_TOKENS || '12000', 10)
  },
  
  // API retry configuration
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '2', 10),
  RETRY_DELAY: parseInt(process.env.RETRY_DELAY || '1000', 10)
}; 