// ─── background.js ────────────────────────────────────────────────────────────
//
// No API keys here anymore — they live on the backend server.
// background.js just orchestrates the pipeline.
// ──────────────────────────────────────────────────────────────────────────────

import { callClaude, callTavily } from './utils/api.js';
import { processClaims }          from './utils/scorer.js';
import { saveAudit }              from './utils/db.js';


// ── MESSAGE LISTENER ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'AUDIT_TEXT') {
    runAuditPipeline(message.text, message.responseId, sender.tab.id);
    return true;
  }
});


// ── FULL AUDIT PIPELINE ───────────────────────────────────────────────────────

async function runAuditPipeline(text, responseId, tabId) {
  try {

    // ── Step 1: Extract claims via backend → OpenRouter/Llama ────────────────
    // No API key argument needed anymore
    const claims = await callClaude(text);

    if (!claims || claims.length === 0) {
      sendResult(tabId, { responseId, claims: [], overall: 100 });
      return;
    }

    // ── Step 2: Verify every claim via backend → Tavily — all in parallel ────
    const tavilyMap = {};
    await Promise.all(
      claims.map(async (claimText) => {
        const result = await callTavily(claimText);  // No API key argument
        tavilyMap[claimText] = result;
      })
    );

    // ── Step 3: Score claims ──────────────────────────────────────────────────
    const auditResult    = processClaims(claims, tavilyMap);
    auditResult.responseId = responseId;

    // ── Step 4: Save to IndexedDB (non-blocking) ──────────────────────────────
    saveAudit(auditResult).catch(err =>
      console.warn('[VeriAI] Failed to save audit:', err)
    );

    // ── Step 5: Send result to content.js ────────────────────────────────────
    sendResult(tabId, auditResult);

  } catch (err) {
    console.error('[VeriAI] Pipeline failed:', err);
    sendError(tabId, responseId, err.message || 'Audit failed — check the console.');
  }
}


// ── HELPERS ───────────────────────────────────────────────────────────────────

function sendResult(tabId, result) {
  chrome.tabs.sendMessage(tabId, { type: 'AUDIT_RESULT', result })
    .catch(err => console.warn('[VeriAI] Could not send result:', err.message));
}

function sendError(tabId, responseId, message) {
  chrome.tabs.sendMessage(tabId, { type: 'AUDIT_ERROR', responseId, message })
    .catch(() => {});
}