// ─── utils/scorer.js ──────────────────────────────────────────────────────────
//
// Pure scoring logic. No API calls. No DOM. No storage. No side effects.
//
// FIXES APPLIED:
//   1. Contradiction signals now require PHRASE matching, not single words.
//      Single words like "false", "wrong", "myth" caused false positives on
//      perfectly valid Wikipedia/BBC snippets.
//   2. Green path is now evaluated BEFORE contradiction — high-confidence
//      corroboration overrides weak contradiction signals.
//   3. Relevance threshold lowered to 0.4 (Tavily factual scores are 0.3–0.5).
//   4. Added keyword overlap fallback for format mismatches (date formats, etc).
//   5. Corroboration now needs OR not AND with highRelevance.
// ──────────────────────────────────────────────────────────────────────────────


// ── SIGNAL PHRASES ────────────────────────────────────────────────────────────
// IMPORTANT: Use PHRASES not single words.
// Single words like "false", "wrong", "myth" appear constantly in neutral
// Wikipedia/news text and cause false positive contradiction detection.

const CONTRADICTION_PHRASES = [
  'this is false', 'this is incorrect', 'this is inaccurate', 'this is wrong',
  'is not true', 'is untrue', 'has been debunked', 'is a myth',
  'no evidence for', 'no evidence that', 'not true that',
  'has been disputed', 'has been disproven', 'was fabricated',
  'is misinformation', 'is misleading', 'never happened',
  'did not happen', 'is factually incorrect', 'is factually wrong'
];

const CORROBORATION_SIGNALS = [
  // Verification phrases
  'confirmed', 'correct', 'accurate', 'verified', 'is true',
  'according to', 'research shows', 'studies show', 'evidence shows',
  'is indeed', 'has been established', 'documented', 'officially',
  'on record', 'historically',
  // Factual statement patterns (very common in encyclopedia snippets)
  'born on', 'born in', 'was born', 'is a', 'is an', 'is the',
  'known as', 'referred to as', 'listed as', 'took place', 'occurred',
  'won', 'achieved', 'led', 'captained', 'founded', 'created',
  'died on', 'died in', 'established in', 'introduced in',
  'assumed office', 'took office', 'served as', 'became the',
  'passed away', 'gained independence', 'independence on',
  'first prime minister', 'first president', 'first minister'
];


// ── KEYWORD EXTRACTION ────────────────────────────────────────────────────────

function extractKeywords(claim) {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
    'for', 'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were',
    'he', 'she', 'it', 'they', 'his', 'her', 'its', 'as', 'that',
    'this', 'be', 'been', 'have', 'has', 'had', 'one', 'into', 'also'
  ]);
  return claim
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

function keywordOverlap(claim, combinedText) {
  const keywords = extractKeywords(claim);
  if (keywords.length === 0) return 0;
  const matches = keywords.filter(kw => combinedText.includes(kw));
  return matches.length / keywords.length;
}


// ── CORE SCORING FUNCTION ─────────────────────────────────────────────────────

/**
 * Scores a single claim based on its Tavily web search result.
 *
 * @param {string}      claim
 * @param {Object|null} tavilyResult
 * @returns {Object} { score, color, verdict, sourceUrl }
 */
export function scoreClaim(claim, tavilyResult) {

  // ── Case 1: Tavily call failed entirely
  if (tavilyResult === null) {
    return {
      score: 50,
      color: 'yellow',
      verdict: 'Could not verify — search unavailable',
      sourceUrl: null
    };
  }

  const { answer, results } = tavilyResult;

  // ── Case 2: Search returned zero results
  if (!results || results.length === 0) {
    return {
      score: 40,
      color: 'yellow',
      verdict: 'No web sources found for this claim',
      sourceUrl: null
    };
  }

  // Best source = highest Tavily relevance score
  const topResult = results.reduce((best, r) =>
    (r.score || 0) > (best.score || 0) ? r : best, results[0]
  );
  const sourceUrl = topResult.url || null;

  // Build combined text for signal scanning
  const answerText   = (answer || '').toLowerCase();
  const snippetText  = results.map(r => (r.content || '').toLowerCase()).join(' ');
  const combinedText = answerText + ' ' + snippetText;

  // FIX 1: Phrase-based contradiction — no more single word false positives
  const hasContradiction   = CONTRADICTION_PHRASES.some(p => combinedText.includes(p));
  const hasCorroboration   = CORROBORATION_SIGNALS.some(w => combinedText.includes(w));

  // Relevance metrics
  const avgRelevance        = results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length;
  const highRelevance       = avgRelevance >= 0.4;
  const multipleGoodSources = results.filter(r => (r.score || 0) >= 0.35).length >= 2;
  const topSourceStrong     = (topResult.score || 0) >= 0.7;

  // Keyword overlap — handles name/date format mismatches
  const overlap            = keywordOverlap(claim, combinedText);
  const strongKeywordMatch = overlap >= 0.5;

  // FIX 2: Evaluate GREEN paths FIRST — strong evidence overrides weak contradiction signals

  // ── Case 3: Top source very strong (≥ 0.7) + corroboration → definitely green
  if (topSourceStrong && hasCorroboration) {
    return {
      score: multipleGoodSources ? 95 : 88,
      color: 'green',
      verdict: multipleGoodSources
        ? 'Verified by multiple strong sources'
        : 'Verified by strong source',
      sourceUrl
    };
  }

  // ── Case 4: Strong keyword match + any relevance → green
  if (strongKeywordMatch && highRelevance) {
    return {
      score: multipleGoodSources ? 92 : 83,
      color: 'green',
      verdict: multipleGoodSources
        ? 'Verified by multiple sources'
        : 'Verified by web source',
      sourceUrl
    };
  }

  // ── Case 5: Corroboration signals OR high relevance → green
  if (hasCorroboration || highRelevance) {
    return {
      score: multipleGoodSources ? 87 : 78,
      color: 'green',
      verdict: multipleGoodSources
        ? 'Supported by multiple sources'
        : 'Supported by web source',
      sourceUrl
    };
  }

  // ── Case 6: Only now check contradiction — evidence is already weak if we're here
  if (hasContradiction) {
    return {
      score: Math.round(10 + (avgRelevance * 15)), // 10–25
      color: 'red',
      verdict: 'Web sources contradict this claim',
      sourceUrl
    };
  }

  // ── Case 7: Decent keyword overlap but no strong signals
  if (strongKeywordMatch) {
    return {
      score: 65,
      color: 'yellow',
      verdict: 'Partially supported — related sources found',
      sourceUrl
    };
  }

  // ── Case 8: Weak match overall
  return {
    score: 45,
    color: 'yellow',
    verdict: 'Weak match — sources may not be relevant',
    sourceUrl
  };
}


// ── COLOR THRESHOLD HELPER ────────────────────────────────────────────────────

export function getColor(score) {
  if (score >= 75) return 'green';
  if (score >= 40) return 'yellow';
  return 'red';
}


// ── OVERALL RESPONSE SCORE ────────────────────────────────────────────────────

/**
 * Weighted average — red claims drag the overall score down harder.
 *
 * @param {Array} scoredClaims
 * @returns {number} Integer 0–100
 */
export function calculateOverall(scoredClaims) {
  if (!scoredClaims || scoredClaims.length === 0) return 100;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const claim of scoredClaims) {
    const weight = claim.score < 40 ? 2.0 : claim.score < 75 ? 1.5 : 1.0;
    weightedSum += claim.score * weight;
    totalWeight += weight;
  }

  return Math.round(weightedSum / totalWeight);
}


// ── MASTER PROCESS FUNCTION ───────────────────────────────────────────────────

/**
 * Takes raw claims + tavilyMap, returns complete scored audit result.
 * This is the only function background.js needs to call from this file.
 *
 * @param {string[]} claims
 * @param {Object}   tavilyMap - { [claimString]: tavilyResult | null }
 * @returns {Object} { claims: [{ text, score, color, verdict, sourceUrl }], overall }
 */
export function processClaims(claims, tavilyMap) {
  const scoredClaims = claims.map(claimText => {
    const tavilyResult = tavilyMap[claimText] ?? null;
    const { score, color, verdict, sourceUrl } = scoreClaim(claimText, tavilyResult);
    return { text: claimText, score, color, verdict, sourceUrl };
  });

  return {
    claims: scoredClaims,
    overall: calculateOverall(scoredClaims)
  };
}