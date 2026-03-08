// ─── utils/api.js ─────────────────────────────────────────────────────────────
//
// All external calls now go through YOUR backend on Render.
// API keys never touch the extension — they live in backend .env only.
//
// Replace BACKEND_URL with your actual Render URL after deploying.
// e.g. 'https://verai-backend.onrender.com'
// ──────────────────────────────────────────────────────────────────────────────

const BACKEND_URL = 'https://veriai-isml.onrender.com'; // ← update after deploy


// ── STEP 1: EXTRACT CLAIMS ────────────────────────────────────────────────────

/**
 * Sends AI response text to your backend, which calls OpenRouter/Llama.
 * No API key needed here — backend handles it.
 *
 * @param {string} text - Full AI response text to scan
 * @returns {Promise<string[]>} Array of claim strings
 */
export async function callClaude(text) {
  try {
    const response = await fetch(`${BACKEND_URL}/extract-claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Backend error ${response.status}: ${err?.error || response.statusText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data.claims)) {
      throw new Error('Backend returned unexpected format — expected { claims: [] }');
    }

    return data.claims;

  } catch (err) {
    console.error('[VeriAI] callClaude failed:', err.message);
    throw err;
  }
}


// ── STEP 2: VERIFY CLAIM ──────────────────────────────────────────────────────

/**
 * Sends one claim to your backend, which calls Tavily.
 * No API key needed here — backend handles it.
 *
 * @param {string} claim - One claim string to verify
 * @returns {Promise<Object|null>} { answer, results } or null on failure
 */
export async function callTavily(claim) {
  try {
    const response = await fetch(`${BACKEND_URL}/verify-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim })
    });

    if (!response.ok) {
      console.warn(`[VeriAI] Backend Tavily call failed for: "${claim.slice(0, 50)}"`);
      return null;
    }

    const data = await response.json();

    // Empty results = unverifiable, not an error
    if (!data.results || data.results.length === 0) {
      return null;
    }

    return {
      answer:  data.answer || null,
      results: data.results
    };

  } catch (err) {
    console.warn(`[VeriAI] callTavily threw: ${err.message}`);
    return null;
  }
}