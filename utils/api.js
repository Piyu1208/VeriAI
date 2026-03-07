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
// ──────────────────────────────────────────────────────────────────────────────


// ── STEP 1: LLAMA 3.1 — CLAIM EXTRACTION ONLY ───────────────────────────────

/**
 * Sends AI-generated text to Llama 3.1 (Groq).
 * Model extracts every verifiable factual claim.
 *
 * @param {string} text    - The full AI response text to scan
 * @param {string} apiKey  - Groq API key
 * @returns {Promise<string[]>} Plain array of claim strings
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

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
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
    const rawText = data.choices[0].message.content.trim();

    // Remove possible markdown code blocks
    const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    const claims = JSON.parse(cleaned);

    if (!Array.isArray(claims)) {
        throw new Error('Model returned unexpected format — expected JSON array of strings');
    }

    return claims.filter(c => typeof c === 'string' && c.trim().length > 0);
    }


// ── STEP 2: TAVILY — WEB VERIFICATION FOR EVERY CLAIM ────────────────────────

/**
 * Searches the live web for a single claim string.
 * Called for EVERY claim extracted by Claude — no filtering, no skipping.
 * Web search is the source of truth. Claude's extraction was just the first step.
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

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      api_key: apiKey,
      query: claim,               // The claim itself is the search query
      search_depth: 'basic',     // 'basic' = fast (< 1s); 'advanced' = deeper
      max_results: 3,             // 3 sources is enough for contradiction detection
      include_answer: true,       // Tavily's own synthesized answer — used by scorer.js
      include_raw_content: false  // Snippets only — we don't need full page HTML
    })
  });

  // Tavily failure is NON-FATAL.
  // If search fails, scorer.js assigns a neutral "unverified" score.
  // The extension keeps working — Tavily outages don't break audits.
  if (!response.ok) {
    console.warn(`[Auditor] Tavily failed for: "${claim.slice(0, 60)}..." (HTTP ${response.status})`);
    return null;
  }

  const data = await response.json();

  return {
    answer: data.answer || null,          // Short synthesized answer from Tavily
    results: (data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      content: r.content,    // Page snippet — scorer.js scans this for signals
      score: r.score          // Tavily relevance score: 0.0 (low) → 1.0 (high)
    }))
  };
}