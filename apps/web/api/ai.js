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

  const OPENCODE_KEY = process.env.VITE_OPENCODE_KEY || '';
  if (!OPENCODE_KEY) {
    return res.status(500).json({ error: 'VITE_OPENCODE_KEY not configured' });
  }

  try {
    const upstream = await fetch('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCODE_KEY}`,
      },
      body: JSON.stringify(req.body),
    });

    const data = await upstream.json();

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Upstream failed', message: err.message });
  }
}
