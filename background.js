// ─── background.js ────────────────────────────────────────────────────────────
//
// The service worker — runs in the background, completely isolated from the page.
// This is the ONLY file that holds API keys and makes external calls.
//
// Responsibilities:
//   1. Listen for AUDIT_TEXT messages from content.js
//   2. Read API keys securely from chrome.storage.local
//   3. Call Claude to extract claims (via utils/api.js)
//   4. Call Tavily to verify EVERY claim in parallel (via utils/api.js)
//   5. Score all claims from web results (via utils/scorer.js)
//   6. Save the audit to IndexedDB (via utils/db.js)
//   7. Send the scored result back to content.js for badge injection
//
// Message protocol:
//   RECEIVES: { type: "AUDIT_TEXT",   text, responseId }        ← from content.js
//   SENDS:    { type: "AUDIT_RESULT", result }                  → to content.js
//   SENDS:    { type: "AUDIT_ERROR",  responseId, message }     → to content.js
// ──────────────────────────────────────────────────────────────────────────────

import { callClaude, callTavily } from './utils/api.js';
import { processClaims }          from './utils/scorer.js';
import { saveAudit }              from './utils/db.js';


// ── MESSAGE LISTENER ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender) => {

  if (message.type === 'AUDIT_TEXT') {
    // Kick off the async pipeline — must NOT await here directly.
    // Returning true keeps the message channel open for the async response.
    runAuditPipeline(message.text, message.responseId, sender.tab.id);
    return true;
  }

});


// ── FULL AUDIT PIPELINE ───────────────────────────────────────────────────────

/**
 * Runs the complete fact-checking pipeline for one AI response.
 *
 * Step 1: Get API keys from secure local storage
 * Step 2: Claude extracts all factual claims as plain strings
 * Step 3: Tavily searches the web for EVERY claim — all run in parallel
 * Step 4: scorer.js scores every claim from web results
 * Step 5: Save audit record to IndexedDB
 * Step 6: Send scored result back to content.js
 *
 * @param {string} text       - Full AI response text to audit
 * @param {string} responseId - Unique ID tying this audit to a DOM node
 * @param {number} tabId      - Chrome tab ID to send the result back to
 */
async function runAuditPipeline(text, responseId, tabId) {

  try {

    // ── Step 1: Read API keys ────────────────────────────────────────────────
    const { claudeKey, tavilyKey } = await getApiKeys();

    // Claude key is required — without it we can't extract claims at all
    if (!claudeKey) {
      sendError(tabId, responseId, 'Claude API key not set. Click the extension icon to add it.');
      return;
    }

    // Tavily key is required — web verification is the core of this extension
    if (!tavilyKey) {
      sendError(tabId, responseId, 'Tavily API key not set. Click the extension icon to add it.');
      return;
    }


    // ── Step 2: Extract claims with Claude ───────────────────────────────────
    // Claude returns a plain array of claim strings — no scores, just text.
    // e.g. ["The Eiffel Tower is 330m tall", "Python was created in 1991"]
    const claims = await callClaude(text, claudeKey);

    // No verifiable claims found in the response — nothing to badge
    if (!claims || claims.length === 0) {
      sendResult(tabId, { responseId, claims: [], overall: 100 });
      return;
    }


    // ── Step 3: Verify EVERY claim with Tavily — all in parallel ────────────
    // Promise.all runs all searches at the same time instead of sequentially.
    // If a response has 6 claims, all 6 Tavily searches fire simultaneously.
    // This cuts total wait time from ~6s sequential to ~1s parallel.
    //
    // Result: tavilyMap = { "claim text": tavilyResult | null, ... }
    const tavilyMap = {};

    await Promise.all(
      claims.map(async (claimText) => {
        const result = await callTavily(claimText, tavilyKey);
        tavilyMap[claimText] = result; // null if Tavily failed for this claim
      })
    );


    // ── Step 4: Score every claim from web results ───────────────────────────
    // processClaims() reads tavilyMap and produces final scores + colors.
    // Returns: { claims: [{ text, score, color, verdict, sourceUrl }], overall }
    const auditResult = processClaims(claims, tavilyMap);
    auditResult.responseId = responseId;


    // ── Step 5: Persist to IndexedDB ─────────────────────────────────────────
    // Non-blocking save — we don't await this before sending the result.
    // User sees badges immediately; DB write happens in the background.
    saveAudit(auditResult).catch(err =>
      console.warn('[Auditor] Failed to save audit to DB:', err)
    );


    // ── Step 6: Send result back to content.js ───────────────────────────────
    sendResult(tabId, auditResult);


  } catch (err) {
    console.error('[Auditor] Pipeline failed:', err);
    sendError(tabId, responseId, err.message || 'Audit failed — check the console for details.');
  }

}


// ── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Reads Claude and Tavily API keys from chrome.storage.local.
 * Keys are stored by popup.js when the user saves them.
 * They never touch the page context — only background.js reads them.
 *
 * @returns {Promise<{ claudeKey: string|null, tavilyKey: string|null }>}
 */
function getApiKeys() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['claudeKey', 'tavilyKey'], (result) => {
      resolve({
        claudeKey: result.claudeKey || null,
        tavilyKey: result.tavilyKey || null
      });
    });
  });
}

/**
 * Sends a successful audit result to content.js in the specified tab.
 *
 * @param {number} tabId
 * @param {Object} result - { responseId, claims, overall }
 */
function sendResult(tabId, result) {
  chrome.tabs.sendMessage(tabId, {
    type: 'AUDIT_RESULT',
    result
  }).catch(err =>
    // Tab may have closed or navigated away — this is fine
    console.warn('[Auditor] Could not send result to tab:', err.message)
  );
}

/**
 * Sends an error message to content.js so it can surface it gracefully.
 *
 * @param {number} tabId
 * @param {string} responseId
 * @param {string} message - Human-readable error description
 */
function sendError(tabId, responseId, message) {
  chrome.tabs.sendMessage(tabId, {
    type: 'AUDIT_ERROR',
    responseId,
    message
  }).catch(() => {}); // Silently ignore if tab is gone
}