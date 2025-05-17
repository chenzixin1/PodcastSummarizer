import { NextRequest, NextResponse } from 'next/server';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, CoreMessage, StreamingTextResponse } from 'ai';
import { prompts } from '@/lib/prompts'; // Assuming @ is mapped to root

export const runtime = 'edge';

// Initialize the OpenAI client for OpenRouter
const openrouter = createOpenAI({
  apiKey: process..OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

// You can change this to your preferred model on OpenRouter
const OPENROUTER_MODEL_ID = 'mistralai/mistral-7b-instruct-v0.2'; // Use the model ID string

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
        blobUrl, 
        mode, 
        targetLanguage = 'Chinese', // Default target language for translation
        srtContent // Optional: if client sends SRT content directly
    } = body as {
        blobUrl?: string;
        mode: 'summary' | 'translate' | 'highlight';
        targetLanguage?: string;
        srtContent?: string;
    };

    if (!mode || !prompts[mode]) {
      return NextResponse.json({ error: 'Invalid processing mode' }, { status: 400 });
    }

    let transcriptContent = srtContent;

    if (!transcriptContent) {
        if (!blobUrl) {
            return NextResponse.json({ error: 'blobUrl or srtContent is required' }, { status: 400 });
        }
        // Fetch SRT content from Vercel Blob
        try {
            const response = await fetch(blobUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch SRT file from blob: ${response.statusText} (URL: ${blobUrl})`);
            }
            transcriptContent = await response.text();
        } catch (fetchError) {
            console.error('Error fetching SRT from blob:', fetchError);
            return NextResponse.json({ error: 'Failed to retrieve SRT file.', details: fetchError instanceof Error ? fetchError.message : String(fetchError) }, { status: 500 });
        }
    }

    if (!transcriptContent) {
        return NextResponse.json({ error: 'Failed to load transcript content.' }, { status: 500 });
    }

    let systemPromptContent = prompts[mode];
    if (mode === 'translate') {
      systemPromptContent = systemPromptContent.replace('<<TARGET_LANGUAGE>>', targetLanguage);
    }

    const messages: CoreMessage[] = [
      { role: 'system', content: systemPromptContent },
      { role: 'user', content: `Here is the SRT transcript:\n\n${transcriptContent}` },
    ];

    const result = await streamText({
      model: openrouter(OPENROUTER_MODEL_ID),
      messages: messages,
    });
    
    // Changed to toDataStreamResponse as per TS suggestion
    return result.toDataStreamResponse();

  } catch (error) {
    console.error('[Process API Error]:', error);
    let errorMessage = 'An unexpected error occurred.';
    let errorDetails: any = {};

    if (error instanceof Error) {
        errorMessage = error.message;
        // Attempt to parse more detailed error if it's a structured error from the SDK or HTTP client
        if ('cause' in error && error.cause) errorDetails.cause = String(error.cause);
        // if (error.name) errorDetails.name = error.name; // Usually not needed for client
    }
    // Check if it's an API response error from the AI SDK (they often have a 'data' or 'error' property)
    // This part is speculative as error structure can vary.
    // const anyError = error as any;
    // if (anyError.response && anyError.response.data && anyError.response.data.error) {
    //   errorMessage = anyError.response.data.error.message || errorMessage;
    //   errorDetails = { ...errorDetails, ...anyError.response.data.error };
    // }

    return NextResponse.json({ 
        error: 'Failed to process transcript.', 
        message: errorMessage,
        details: Object.keys(errorDetails).length > 0 ? errorDetails : undefined
    }, { status: 500 });
  }
} 