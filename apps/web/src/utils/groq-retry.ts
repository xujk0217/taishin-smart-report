/**
 * LLM API wrapper with multi-provider fallback, retry, and caching.
 *
 * Priority:
 *   1. OpenCode.ai (deepseek-v4-flash-free) — free, no rate limit
 *   2. Groq (llama-3.1-8b-instant) — free but 6000 tokens/min limit
 *
 * Both use the OpenAI-compatible /v1/chat/completions format.
 */

// ─── Provider config ─────────────────────────────────────────

interface Provider {
  name: string;
  url: string;
  model: string;
  apiKey: () => string;
}

const OPENCODE_KEY = import.meta.env.VITE_OPENCODE_KEY || '';
const GROQ_KEY_ENV = import.meta.env.VITE_GROQ_KEY || '';

const PROVIDERS: Provider[] = [
  {
    name: 'OpenCode',
    url: '/api/ai',  // Vercel serverless proxy (bypasses CORS)
    model: 'deepseek-v4-flash-free',
    apiKey: () => OPENCODE_KEY || 'proxy',  // Key is on server side; 'proxy' ensures provider isn't skipped
  },
];

// ─── Cache ───────────────────────────────────────────────────

const responseCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Public interface ────────────────────────────────────────

export interface LLMCallOptions {
  model?: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
}

/**
 * Call the best available LLM provider. Falls through the priority list
 * on failure. Explicit apiKey param overrides the env-based key for the
 * first provider that accepts it (backwards compat with existing callers
 * that pass the Groq key).
 */
export async function callGroqWithRetry(
  apiKey: string,
  options: LLMCallOptions,
): Promise<any> {
  const cacheKey = JSON.stringify(options.messages.map(m => m.content).join('|')).slice(0, 200);

  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('[LLM] Using cached response');
    return cached.data;
  }

  // Build provider list: skip providers without a key.
  // Each provider uses its OWN key — the apiKey param is ignored
  // (kept for backward compat but not used for routing).
  const activeProviders = PROVIDERS
    .map(p => ({ ...p, resolvedKey: p.apiKey() }))
    .filter(p => p.resolvedKey.length > 0);

  if (activeProviders.length === 0) {
    throw new Error('No LLM API key configured (set VITE_OPENCODE_KEY or VITE_GROQ_KEY)');
  }

  let lastError: Error | null = null;

  for (const provider of activeProviders) {
    try {
      const data = await callProvider(provider, options);
      responseCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (err: any) {
      console.warn(`[LLM] ${provider.name} failed:`, err?.message ?? err);
      lastError = err;
      // Continue to next provider
    }
  }

  throw lastError || new Error('All LLM providers failed');
}

/**
 * Pings the AI endpoint to confirm it's reachable before running a long
 * pipeline. Returns a human-readable problem description, or null if fine.
 */
export async function checkAIEndpoint(): Promise<string | null> {
  const provider = PROVIDERS[0];
  const key = provider.apiKey();
  if (!key) return '未設定 AI 金鑰';

  try {
    const res = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      }),
    });
    if (res.status === 404) {
      return `AI 代理端點不存在（${provider.url} 回傳 404）。部署可能缺少 serverless function。`;
    }
    if (!res.ok && res.status !== 200) {
      const text = await res.text().catch(() => '');
      return `AI 端點回應 ${res.status}${text ? `：${text.slice(0, 80)}` : ''}`;
    }
    return null;
  } catch (err: any) {
    return `無法連線至 AI 端點（${err?.message ?? err}）。若剛更新過版本，請按 Cmd+Shift+R 強制重新載入。`;
  }
}

/**
 * Extract content text from a chat completion response.
 * Supports reasoning models that may put text in reasoning_content.
 */
export function extractContent(response: any): string {
  const msg = response?.choices?.[0]?.message;
  if (!msg) return '';
  // Prefer content; fall back to reasoning_content for reasoning models.
  return msg.content || msg.reasoning_content || '';
}

// ─── Internal ────────────────────────────────────────────────

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;
/** Give up before the serverless gateway's own limit so retries stay useful. */
const REQUEST_TIMEOUT_MS = 600_000;

async function callProvider(
  provider: Provider & { resolvedKey: string },
  options: LLMCallOptions,
): Promise<any> {
  const body = {
    model: options.model || provider.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.max_tokens ?? 8000,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[LLM:${provider.name}] Retry ${attempt}/${MAX_RETRIES}...`);
      await sleep(RETRY_DELAY_MS * attempt);
    }

    try {
      // Abort before the serverless gateway does, so the retry path stays in
      // our control instead of surfacing an opaque 504.
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(provider.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.resolvedKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(abortTimer);
      }

      if (response.status === 504 || response.status === 502) {
        console.warn(`[LLM:${provider.name}] Gateway timeout (${response.status}). Retrying...`);
        lastError = new Error(`Gateway timeout ${response.status}`);
        continue;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_DELAY_MS * (attempt + 1);
        console.warn(`[LLM:${provider.name}] Rate limited (429). Waiting ${waitMs}ms...`);
        lastError = new Error(`Rate limited (attempt ${attempt + 1})`);
        await sleep(waitMs);
        continue;
      }

      if (response.status === 500 || response.status === 503) {
        console.warn(`[LLM:${provider.name}] Server error (${response.status}). Retrying...`);
        lastError = new Error(`Server error ${response.status}`);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${provider.name} ${response.status}: ${errText.slice(0, 120)}`);
      }

      const data = await response.json();

      // Validate we got a real response
      const content = data?.choices?.[0]?.message?.content;
      if (!content && !data?.choices?.[0]?.message) {
        throw new Error(`${provider.name} returned empty response`);
      }

      console.log(`[LLM] ✓ ${provider.name} (${provider.model}) responded`);
      return data;
    } catch (err: any) {
      lastError = err;
      // Surface the real cause so we can diagnose in production.
      if (err?.name === 'TypeError' || err?.message?.includes('fetch')) {
        console.error(
          `[LLM:${provider.name}] Network/CORS failure calling ${provider.url}`,
          `\n  error: ${err?.message}`,
          `\n  hint: if URL is absolute and cross-origin, CORS is blocking.`,
          `\n  hint: if URL is /api/ai, the serverless function may be missing.`,
        );
        lastError = new Error(
          `無法連線至 ${provider.url}（${err?.message}）。請重新整理頁面（Cmd+Shift+R）清除快取後重試。`,
        );
        break;
      }
    }
  }

  throw lastError || new Error(`${provider.name} failed after retries`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
