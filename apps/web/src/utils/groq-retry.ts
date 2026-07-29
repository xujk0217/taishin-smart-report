/**
 * Groq API wrapper with retry, rate limit handling, and response caching.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

// Simple in-memory cache (survives within session)
const responseCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface GroqCallOptions {
  model?: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
}

/**
 * Call Groq API with automatic retry on 429/503, and response caching.
 */
export async function callGroqWithRetry(
  apiKey: string,
  options: GroqCallOptions,
): Promise<any> {
  const cacheKey = JSON.stringify(options.messages.map(m => m.content).join('|')).slice(0, 200);

  // Check cache first
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('[Groq] Using cached response');
    return cached.data;
  }

  const body = {
    model: options.model || 'llama-3.1-8b-instant',
    messages: options.messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.max_tokens ?? 1500,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Groq] Retry attempt ${attempt}/${MAX_RETRIES}...`);
        await sleep(RETRY_DELAY_MS * attempt); // Exponential backoff
      }

      const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (response.status === 429) {
        // Rate limited - wait and retry
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_DELAY_MS * (attempt + 1);
        console.warn(`[Groq] Rate limited (429). Waiting ${waitMs}ms...`);
        lastError = new Error(`Rate limited (attempt ${attempt + 1})`);
        await sleep(waitMs);
        continue;
      }

      if (response.status === 503) {
        console.warn('[Groq] Service unavailable (503). Retrying...');
        lastError = new Error('Service unavailable');
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API ${response.status}: ${errText.slice(0, 100)}`);
      }

      const data = await response.json();

      // Cache successful response
      responseCache.set(cacheKey, { data, timestamp: Date.now() });

      return data;
    } catch (err: any) {
      lastError = err;
      if (err.message?.includes('Groq API') && !err.message.includes('429') && !err.message.includes('503')) {
        // Non-retryable error
        throw err;
      }
    }
  }

  throw lastError || new Error('Groq API call failed after retries');
}

/**
 * Extract content text from Groq response.
 */
export function extractContent(response: any): string {
  return response?.choices?.[0]?.message?.content || '';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
