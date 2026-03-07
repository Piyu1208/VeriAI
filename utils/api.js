// ─── utils/api.js ─────────────────────────────────────────────────────────────
//
// CLEAR SEPARATION OF RESPONSIBILITIES:
//
//   callClaude(text, apiKey)
//     → ONLY extracts factual claims from the AI response text
//     → Returns a plain list of claim strings, nothing else
//     → No scoring, no confidence, no judgement — just extraction
//
//   callTavily(claim, apiKey)
//     → Searches the live web for ONE claim
//     → Called for EVERY claim (not just flagged ones)
//     → Returns raw search results — scorer.js decides what they mean
//
// background.js imports both and calls them in sequence.
//
// FIXES APPLIED:
//   1. Corrected OpenRouter model name: 'meta-llama/llama-3.1-8b-instant'
//   2. Added required OpenRouter headers: HTTP-Referer and X-Title
//   3. Wrapped all async logic in try/catch — errors are logged AND re-thrown
//   4. Added JSON.parse safety wrapper with descriptive error on bad model output
//   5. Added optional chaining on data.choices[0] to prevent crashes
//   6. Empty/null response from model now throws a clear error
//   7. callTavily also wrapped in try/catch — returns null gracefully on failure
// ──────────────────────────────────────────────────────────────────────────────


// ── STEP 1: LLAMA 3.1 via OpenRouter — CLAIM EXTRACTION ONLY ─────────────────

/**
 * Sends AI-generated text to Llama 3.1 (via OpenRouter).
 * Model extracts every verifiable factual claim.
 *
 * @param {string} text    - The full AI response text to scan
 * @param {string} apiKey  - OpenRouter API key
 * @returns {Promise<string[]>} Plain array of claim strings
 * @throws {Error} If the API call fails, returns bad JSON, or returns no content
 */
export async function callClaude(text, apiKey) {

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
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        // FIX 1: OpenRouter requires these two headers — requests are rejected (403) without them
        'HTTP-Referer': 'https://verai.extension',
        'X-Title': 'VeriAI'
      },
      body: JSON.stringify({
        // FIX 2: Corrected model name for OpenRouter's format (was 'llama-3.1-8b-instant')
        model: 'meta-llama/llama-3.1-8b-instruct',
        temperature: 0,
        max_tokens: 1500,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Extract all verifiable factual claims from this text:\n\n${text}`
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        `Llama API error ${response.status}: ${err?.error?.message || response.statusText}`
      );
    }

    const data = await response.json();

    // FIX 3: Optional chaining prevents crash if choices array is empty or malformed
    const rawText = data?.choices?.[0]?.message?.content?.trim();

    // FIX 4: Explicit check for empty/null model response
    if (!rawText) {
      throw new Error('Empty or null response received from model');
    }

    // Strip possible markdown code fences the model may wrap output in
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // FIX 5: JSON.parse is now wrapped — a non-JSON model response no longer crashes silently
    let claims;
    try {
      claims = JSON.parse(cleaned);
    } catch {
      throw new Error(
        `Model returned invalid JSON. Raw output: "${cleaned.slice(0, 120)}..."`
      );
    }

    if (!Array.isArray(claims)) {
      throw new Error('Model returned unexpected format — expected a JSON array of strings');
    }

    return claims.filter(c => typeof c === 'string' && c.trim().length > 0);

  } catch (err) {
    // FIX 6: Log with a clear prefix so it's easy to find in the service worker console
    console.error('[VeriAI] callClaude failed:', err.message);
    // Re-throw so background.js knows the extraction step failed and can update the UI
    throw err;
  }
}


// ── STEP 2: TAVILY — WEB VERIFICATION FOR EVERY CLAIM ────────────────────────

/**
 * Searches the live web for a single claim string.
 * Called for EVERY claim extracted — no filtering, no skipping.
 * Web search is the source of truth. Llama's extraction was just the first step.
 *
 * Tavily is purpose-built for LLM fact-checking pipelines.
 * It returns a synthesized answer + ranked source snippets.
 *
 * @param {string} claim   - One claim string to verify
 * @param {string} apiKey  - Tavily API key (from chrome.storage.local)
 * @returns {Promise<Object|null>}
 *   On success: { answer, results: [{ title, url, content, score }] }
 *   On failure: null (non-fatal — scorer.js handles missing results gracefully)
 */
export async function callTavily(claim, apiKey) {

  // FIX 7: Wrap in try/catch — network errors now return null instead of crashing
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: claim,               // The claim itself is the search query
        search_depth: 'basic',      // 'basic' = fast (< 1s); 'advanced' = deeper
        max_results: 3,             // 3 sources is enough for contradiction detection
        include_answer: true,       // Tavily's own synthesized answer — used by scorer.js
        include_raw_content: false  // Snippets only — we don't need full page HTML
      })
    });

    // Tavily failure is NON-FATAL.
    // If search fails, scorer.js assigns a neutral "unverified" score.
    // The extension keeps working — Tavily outages don't break audits.
    if (!response.ok) {
      console.warn(
        `[VeriAI] Tavily failed for: "${claim.slice(0, 60)}..." (HTTP ${response.status})`
      );
      return null;
    }

    const data = await response.json();

    // FIX 8: Guard against missing/malformed data.results
    if (!data || typeof data !== 'object') {
      console.warn('[VeriAI] Tavily returned unexpected response shape');
      return null;
    }

    return {
      answer: data.answer || null,            // Short synthesized answer from Tavily
      results: (data.results || []).map(r => ({
        title: r.title   || '',
        url:   r.url     || '',
        content: r.content || '',  // Page snippet — scorer.js scans this for signals
        score: r.score   ?? 0      // Tavily relevance score: 0.0 (low) → 1.0 (high)
      }))
    };

  } catch (err) {
    // Network-level errors (offline, DNS failure, etc.) are also non-fatal
    console.warn(`[VeriAI] Tavily threw for: "${claim.slice(0, 60)}..." — ${err.message}`);
    return null;
  }
}