// ─── server.js ────────────────────────────────────────────────────────────────
//
// VeriAI Backend — Node.js + Express
// Hosted on Render (free tier)
//
// Two endpoints:
//   POST /extract-claims  → calls OpenRouter (Llama 3.1) to extract claims
//   POST /verify-claim    → calls Tavily to web-verify one claim
//
// API keys live in environment variables — NEVER sent to the extension.
// ──────────────────────────────────────────────────────────────────────────────

import express  from 'express';
import cors     from 'cors';
import dotenv   from 'dotenv';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Allow requests from Chrome extensions and any origin
// (Chrome extensions don't have a predictable origin)
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET'],
}));

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
// Render pings this to keep the service alive
app.get('/', (req, res) => {
  res.json({ status: 'VeriAI backend running ✅' });
});


// ── POST /extract-claims ──────────────────────────────────────────────────────
//
// Receives: { text: string }
// Returns:  { claims: string[] }
//
app.post('/extract-claims', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Missing or empty text field' });
  }

  const systemPrompt = `You are a claim extraction engine for a fact-checking system.

Your ONLY job is to read AI-generated text and extract every verifiable factual claim.

Rules:
- Extract claims that are specific and checkable against real-world sources
- Quote each claim EXACTLY as it appears in the text — do not rephrase
- Include: statistics, dates, names, events, measurements, historical facts,
  scientific claims, geographic facts, records, rankings, and attributions
- Exclude: opinions, predictions, hypotheticals, and vague generalities
- If there are no verifiable claims, return an empty array: []

Return ONLY a valid JSON array of strings. No explanation. No keys. No markdown.

Example output:
["The Eiffel Tower stands 330 metres tall", "Python was created by Guido van Rossum in 1991"]`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'HTTP-Referer':  'https://verai.app',
        'X-Title':       'VeriAI'
      },
      body: JSON.stringify({
        model:       'meta-llama/llama-3.1-8b-instruct',
        temperature: 0,
        max_tokens:  1500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: `Extract all verifiable factual claims from this text:\n\n${text}` }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`OpenRouter error ${response.status}: ${err?.error?.message || response.statusText}`);
    }

    const data    = await response.json();
    const rawText = data?.choices?.[0]?.message?.content?.trim();

    if (!rawText) throw new Error('Empty response from model');

    // Strip markdown fences if model wraps output
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i,     '')
      .replace(/\s*```$/i,     '')
      .trim();

    let claims;
    try {
      claims = JSON.parse(cleaned);
    } catch {
      throw new Error(`Model returned invalid JSON: ${cleaned.slice(0, 120)}`);
    }

    if (!Array.isArray(claims)) {
      throw new Error('Model returned unexpected format — expected JSON array');
    }

    const filtered = claims.filter(c => typeof c === 'string' && c.trim().length > 0);
    console.log(`[VeriAI] Extracted ${filtered.length} claims`);

    return res.json({ claims: filtered });

  } catch (err) {
    console.error('[VeriAI] /extract-claims error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});


// ── POST /verify-claim ────────────────────────────────────────────────────────
//
// Receives: { claim: string }
// Returns:  { answer: string|null, results: [{title, url, content, score}] }
//           or { error: string } on failure
//
app.post('/verify-claim', async (req, res) => {
  const { claim } = req.body;

  if (!claim || typeof claim !== 'string' || claim.trim().length === 0) {
    return res.status(400).json({ error: 'Missing or empty claim field' });
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:              process.env.TAVILY_KEY,
        query:                claim,
        search_depth:         'basic',
        max_results:          3,
        include_answer:       true,
        include_raw_content:  false
      })
    });

    if (!response.ok) {
      console.warn(`[VeriAI] Tavily failed for "${claim.slice(0, 50)}" — HTTP ${response.status}`);
      // Non-fatal — return null so scorer marks as unverified
      return res.json({ answer: null, results: [] });
    }

    const data = await response.json();

    return res.json({
      answer:  data.answer || null,
      results: (data.results || []).map(r => ({
        title:   r.title   || '',
        url:     r.url     || '',
        content: r.content || '',
        score:   r.score   ?? 0
      }))
    });

  } catch (err) {
    console.error('[VeriAI] /verify-claim error:', err.message);
    // Non-fatal — scorer handles missing results gracefully
    return res.json({ answer: null, results: [] });
  }
});


// ── START ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[VeriAI] Backend running on port ${PORT}`);
});