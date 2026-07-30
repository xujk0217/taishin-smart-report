/**
 * Vercel Serverless Function — proxies requests to OpenCode.ai
 * to bypass CORS restrictions in the browser.
 *
 * POST /api/ai — forwards body to OpenCode chat completions endpoint.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const OPENCODE_KEY = process.env.VITE_OPENCODE_KEY || process.env.OPENCODE_KEY || '';
  // Fallback: if server env not set, accept key from client Authorization header
  const clientKey = (req.headers.authorization || '').replace('Bearer ', '');
  const apiKey = OPENCODE_KEY || clientKey;

  if (!apiKey) {
    return res.status(500).json({ error: 'No API key available' });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 280000); // 280s timeout for upstream

    const upstream = await fetch('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const data = await upstream.json();

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Upstream failed', message: err.message });
  }
}
