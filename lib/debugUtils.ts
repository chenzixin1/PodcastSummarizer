/**
 * Debugging utilities for the Podcast Summarizer
 * 
 * These utilities help with tracking and debugging issues, especially in production environments.
 */

// Add NetworkInformation interface
interface NetworkInformation {
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
}

// Extend Navigator type to include connection property
declare global {
  interface Navigator {
    connection?: NetworkInformation;
  }
}

// Configuration
const DEBUG_VERSION = '1.0.1';
const IS_PRODUCTION = typeof window !== 'undefined' && window.location.hostname !== 'localhost';
const DEBUG_ENABLED = true; // Set to false to disable all debug logging
const SEND_TO_SERVER = IS_PRODUCTION; // Whether to send logs to server in production

// Track client-side errors
const clientErrors: Array<{
  message: string;
  source?: string;
  timestamp: string;
  details?: any;
}> = [];

// Initialize debugging
console.log(`[DEBUG-CLIENT] Podcast Summarizer Debug Utils v${DEBUG_VERSION} initializing...`);
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    logError('Unhandled error', event.error);
  });
  
  window.addEventListener('unhandledrejection', (event) => {
    logError('Unhandled promise rejection', event.reason);
  });
}

/**
 * Log a debug message
 */
export function logDebug(message: string, details?: any): void {
  if (!DEBUG_ENABLED) return;
  
  const logEntry = {
    message,
    details,
    timestamp: new Date().toISOString()
  };
  
  console.log(`[DEBUG-CLIENT] ${message}`, details || '');
  
  if (SEND_TO_SERVER) {
    sendToServer('debug', logEntry);
  }
}

/**
 * Log an error with details
 */
export function logError(message: string, error?: any): void {
  const errorDetails = error instanceof Error 
    ? { name: error.name, message: error.message, stack: error.stack }
    : error;
  
  const logEntry = {
    message,
    error: errorDetails,
    timestamp: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.href : undefined
  };
  
  clientErrors.push(logEntry);
  console.error(`[ERROR-CLIENT] ${message}`, errorDetails || '');
  
  if (SEND_TO_SERVER) {
    sendToServer('error', logEntry);
  }
}

/**
 * Log performance information
 */
export function logPerformance(operation: string, durationMs: number, metadata?: any): void {
  if (!DEBUG_ENABLED) return;
  
  const logEntry = {
    operation,
    durationMs,
    metadata,
    timestamp: new Date().toISOString()
  };
  
  console.log(`[PERF-CLIENT] ${operation}: ${durationMs}ms`, metadata || '');
  
  if (SEND_TO_SERVER) {
    sendToServer('performance', logEntry);
  }
}

/**
 * Track user interactions for debugging
 */
export function logUserAction(action: string, details?: any): void {
  if (!DEBUG_ENABLED) return;
  
  const logEntry = {
    action,
    details,
    timestamp: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.href : undefined
  };
  
  console.log(`[USER-CLIENT] ${action}`, details || '');
  
  if (SEND_TO_SERVER) {
    sendToServer('user-action', logEntry);
  }
}

/**
 * Get browser and system information for debugging
 */
export function getBrowserInfo(): Record<string, any> {
  if (typeof window === 'undefined') {
    return { environment: 'server' };
  }
  
  // Safely check for navigator.connection
  const hasConnection = typeof navigator !== 'undefined' && 
                        'connection' in navigator && 
                        navigator.connection !== null;
  
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screenSize: `${window.screen.width}x${window.screen.height}`,
    viewportSize: `${window.innerWidth}x${window.innerHeight}`,
    connection: hasConnection 
      ? {
          type: navigator.connection?.effectiveType, 
          downlink: navigator.connection?.downlink,
          rtt: navigator.connection?.rtt,
          saveData: navigator.connection?.saveData,
        } 
      : undefined,
    timestamp: new Date().toISOString()
  };
}

/**
 * Get all accumulated client errors
 */
export function getClientErrors(): Array<any> {
  return [...clientErrors];
}

/**
 * Send log to the server debug endpoint
 */
async function sendToServer(type: string, data: any): Promise<void> {
  try {
    // Only send logs every 5 seconds to avoid overwhelming the server
    if (type !== 'error' && type !== 'user-action') {
      const lastSend = localStorage.getItem('lastDebugSend');
      const now = Date.now();
      if (lastSend && now - parseInt(lastSend) < 5000) {
        return;
      }
      localStorage.setItem('lastDebugSend', now.toString());
    }
    
    const payload = {
      type,
      data,
      client: getBrowserInfo(),
      version: DEBUG_VERSION
    };
    
    // Don't await this to avoid blocking
    fetch('/api/debug', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      // Use keepalive to ensure the request completes even if page navigates away
      keepalive: true
    }).catch(err => console.error('Failed to send debug data:', err));
  } catch (error) {
    console.error('Error sending debug data:', error);
  }
} 