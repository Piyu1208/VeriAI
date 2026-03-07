// ─── utils/scorer.js ──────────────────────────────────────────────────────────
//
// Pure scoring logic. No API calls. No DOM. No storage. No side effects.
// Takes the raw Tavily search results for each claim and produces:
//   - A confidence score (0–100) for each claim
//   - A color label: "green" | "yellow" | "red"
//   - A short human-readable verdict
//   - The best source URL to show in the tooltip
//   - An overall response score (weighted average of all claims)
//
// Input comes from background.js.
// Output goes back to background.js → content.js → badge injection.
//
// Because this file is pure functions, it is trivially unit-testable.
// ──────────────────────────────────────────────────────────────────────────────


// ── CONTRADICTION / CORROBORATION SIGNAL WORDS ───────────────────────────────
// scorer.js scans Tavily's synthesized answer for these keywords.
// These lists are intentionally conservative — false positives are worse
// than false negatives when labelling something as "contradicted".

const CONTRADICTION_SIGNALS = [
  'false', 'incorrect', 'inaccurate', 'wrong', 'untrue',
  'misleading', 'debunked', 'myth', 'no evidence', 'not true',
  'disputed', 'disproven', 'fabricated', 'misinformation'
];

const CORROBORATION_SIGNALS = [
  'confirmed', 'correct', 'accurate', 'true', 'verified',
  'according to', 'research shows', 'studies show', 'evidence shows',
  'is indeed', 'has been established', 'documented'
];


// ── CORE SCORING FUNCTION ─────────────────────────────────────────────────────

/**
 * Scores a single claim based entirely on its Tavily web search result.
 * Web search is the source of truth — Claude extracted the claim, Tavily judges it.
 *
 * Scoring logic:
 *   NULL result (Tavily failed / no results)  → 50  "Unverified"
 *   Empty results (no pages found)            → 40  "No sources found"
 *   Contradiction signals in answer           → 10–25 "Contradicted"
 *   Low relevance results (score < 0.3)       → 45  "Weakly supported"
 *   Corroboration signals in answer           → 85–95 "Verified"
 *   Multiple high-relevance sources           → 80–90 "Well sourced"
 *   Single relevant source, neutral answer    → 65  "Partially supported"
 *
 * @param {string}      claim        - The claim text (used for logging)
 * @param {Object|null} tavilyResult - Result from callTavily(), or null
 * @returns {Object} { score, color, verdict, sourceUrl }
 */
export function scoreClaim(claim, tavilyResult) {

  // ── Case 1: Tavily call failed entirely (network error, rate limit, etc.)
  if (tavilyResult === null) {
    return {
      score: 50,
      color: 'yellow',
      verdict: 'Could not verify — search unavailable',
      sourceUrl: null
    };
  }

  const { answer, results } = tavilyResult;

  // ── Case 2: Search returned zero results — claim may be too obscure or wrong
  if (!results || results.length === 0) {
    return {
      score: 40,
      color: 'yellow',
      verdict: 'No web sources found for this claim',
      sourceUrl: null
    };
  }

  // Best source URL = highest relevance score from Tavily
  const topResult = results.reduce((best, r) =>
    (r.score || 0) > (best.score || 0) ? r : best, results[0]
  );
  const sourceUrl = topResult.url || null;

  // Scan Tavily's synthesized answer for contradiction/corroboration signals
  const answerText = (answer || '').toLowerCase();
  const snippetText = results.map(r => (r.content || '').toLowerCase()).join(' ');
  const combinedText = answerText + ' ' + snippetText;

  const hasContradiction = CONTRADICTION_SIGNALS.some(w => combinedText.includes(w));
  const hasCorroboration = CORROBORATION_SIGNALS.some(w => combinedText.includes(w));

  // Average relevance score across all Tavily results (0.0 – 1.0)
  const avgRelevance = results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length;
  const highRelevance = avgRelevance >= 0.6;
  const multipleGoodSources = results.filter(r => (r.score || 0) >= 0.5).length >= 2;

  // ── Case 3: Web explicitly contradicts the claim
  if (hasContradiction) {
    return {
      score: Math.round(10 + (avgRelevance * 15)), // 10–25 range
      color: 'red',
      verdict: 'Web sources contradict this claim',
      sourceUrl
    };
  }

  // ── Case 4: Strong corroboration — answer confirms + high relevance sources
  if (hasCorroboration && highRelevance) {
    return {
      score: multipleGoodSources ? 93 : 85,
      color: 'green',
      verdict: multipleGoodSources
        ? 'Verified by multiple sources'
        : 'Verified by web source',
      sourceUrl
    };
  }

  // ── Case 5: Multiple high-relevance sources found, neutral answer
  if (multipleGoodSources) {
    return {
      score: 80,
      color: 'green',
      verdict: 'Supported by multiple web sources',
      sourceUrl
    };
  }

  // ── Case 6: One relevant source found, no strong signals either way
  if (highRelevance) {
    return {
      score: 65,
      color: 'yellow',
      verdict: 'Partially supported — one source found',
      sourceUrl
    };
  }

  // ── Case 7: Results found but low relevance — weak match
  return {
    score: 45,
    color: 'yellow',
    verdict: 'Weak match — sources may not be relevant',
    sourceUrl
  };
}


// ── COLOR THRESHOLD HELPER ────────────────────────────────────────────────────

/**
 * Maps a 0–100 score to a CSS color class name.
 * Used as a fallback — scoreClaim() sets color directly in most cases.
 *
 * @param {number} score
 * @returns {"green"|"yellow"|"red"}
 */
export function getColor(score) {
  if (score >= 75) return 'green';
  if (score >= 40) return 'yellow';
  return 'red';
}


// ── OVERALL RESPONSE SCORE ────────────────────────────────────────────────────

/**
 * Calculates the single overall confidence score for the entire AI response.
 * This is the number shown in the floating score chip (e.g. "Overall: 78%").
 *
 * Uses a weighted average — low-scoring claims pull the overall down harder
 * than high-scoring ones pull it up. This is intentional: one badly wrong
 * claim should noticeably hurt the overall score.
 *
 * @param {Array} scoredClaims - Array of { score, color, verdict, sourceUrl }
 * @returns {number} Integer 0–100
 */
export function calculateOverall(scoredClaims) {
  if (!scoredClaims || scoredClaims.length === 0) {
    return 100; // No claims found = nothing to fact-check = no risk flagged
  }

  // Weight each claim by the inverse of its score
  // Low-scoring claims (red) get higher weight → drag overall down more
  let weightedSum = 0;
  let totalWeight = 0;

  for (const claim of scoredClaims) {
    // Weight formula: red claims (score < 40) count 2x, yellow 1.5x, green 1x
    const weight = claim.score < 40 ? 2.0 : claim.score < 75 ? 1.5 : 1.0;
    weightedSum += claim.score * weight;
    totalWeight += weight;
  }

  return Math.round(weightedSum / totalWeight);
}


// ── MASTER PROCESS FUNCTION ───────────────────────────────────────────────────

/**
 * Takes the raw claims array (strings from Claude) and a map of
 * Tavily results (keyed by claim string), and returns the complete
 * scored audit result ready for badge injection.
 *
 * This is the only function background.js needs to call from this file.
 *
 * @param {string[]}     claims     - Plain claim strings from callClaude()
 * @param {Object}       tavilyMap  - { [claimString]: tavilyResult | null }
 * @returns {Object} {
 *   claims: [{ text, score, color, verdict, sourceUrl }, ...],
 *   overall: number
 * }
 */
export function processClaims(claims, tavilyMap) {

  const scoredClaims = claims.map(claimText => {
    const tavilyResult = tavilyMap[claimText] ?? null;
    const { score, color, verdict, sourceUrl } = scoreClaim(claimText, tavilyResult);

    return {
      text: claimText,   // Original claim string — used for badge matching in DOM
      score,             // 0–100 confidence score from web results
      color,             // "green" | "yellow" | "red" — CSS class for badge
      verdict,           // Human-readable one-liner shown in tooltip
      sourceUrl          // Best source link shown in tooltip (can be null)
    };
  });

  return {
    claims: scoredClaims,
    overall: calculateOverall(scoredClaims)
  };
}