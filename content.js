console.log('[VeriAI] content.js injected ✅');

// ─── content.js ───────────────────────────────────────────────────────────────

// ── BOOT ──────────────────────────────────────────────────────────────────────

chrome.storage.local.get('enabled', ({ enabled }) => {
  if (enabled === false) return;
  init();
});

function init() {
  watchForResponses();
  listenForResults();
}

// ── WATCH FOR RESPONSES ───────────────────────────────────────────────────────

function watchForResponses() {
  let debounceTimer   = null;
  let lastAuditedNode = null;

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const node = getLatestAssistantNode();

      if (!node)                    return;
      if (node === lastAuditedNode) return;
      if (node.dataset.haProcessed) return;

      const text = node.innerText.trim();
      if (text.length < 80)         return;

      node.dataset.haProcessed  = 'true';
      lastAuditedNode            = node;

      const responseId          = generateId();
      node.dataset.haResponseId = responseId;

      console.log('[VeriAI] Sending audit, responseId:', responseId);

      chrome.runtime.sendMessage({ type: 'AUDIT_TEXT', text, responseId });
    }, 800);
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// ── GET LATEST ASSISTANT NODE ─────────────────────────────────────────────────

function getLatestAssistantNode() {
  const selectors = [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"] .prose',
    '[data-message-author-role="assistant"] [class*="markdown"]',
    '[data-message-author-role="assistant"] [class*="prose"]',
    '[data-message-author-role="assistant"]'
  ];
  for (const sel of selectors) {
    const nodes = document.querySelectorAll(sel);
    if (nodes.length > 0) return nodes[nodes.length - 1];
  }
  return null;
}

// ── LISTEN FOR RESULTS ────────────────────────────────────────────────────────

function listenForResults() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'AUDIT_RESULT') {
      console.log('[VeriAI] AUDIT_RESULT received, overall:', message.result.overall);
      injectAuditCard(message.result);
    }
    if (message.type === 'AUDIT_ERROR') {
      console.error('[VeriAI] AUDIT_ERROR:', message.message);
      showErrorChip(message.responseId, message.message);
    }
  });
}

// ── INJECT AUDIT CARD ─────────────────────────────────────────────────────────

function injectAuditCard({ responseId, claims, overall }) {
  const node = document.querySelector(`[data-ha-response-id="${responseId}"]`);
  if (!node) {
    console.warn('[VeriAI] Node not found for responseId:', responseId);
    return;
  }

  const colorClass = overall >= 75 ? 'green' : overall >= 40 ? 'yellow' : 'red';
  const label      = overall >= 75 ? 'Verified' : overall >= 40 ? 'Uncertain' : 'Disputed';
  const icon       = overall >= 75 ? '🛡️' : overall >= 40 ? '⚠️' : '🚨';

  // Build claim rows — each row gets its own color class
  const claimRowsHTML = claims.map(c => {
    const dot    = c.color === 'green' ? '🟢' : c.color === 'red' ? '🔴' : '🟡';
    const source = c.sourceUrl
      ? `<a class="ha-claim-source" href="${c.sourceUrl}" target="_blank" rel="noopener">View source →</a>`
      : '';
    return `
      <div class="ha-claim-row ha-row-${c.color}">
        <span class="ha-claim-dot">${dot}</span>
        <div class="ha-claim-body">
          <div class="ha-claim-text">${escapeHtml(c.text)}</div>
          <div class="ha-claim-meta">
            <span class="ha-claim-score">${c.score}%</span>
            <span class="ha-claim-verdict">${escapeHtml(c.verdict)}</span>
            ${source}
          </div>
        </div>
      </div>
    `;
  }).join('');

  const card = document.createElement('div');
  card.className = `ha-audit-card ha-card-${colorClass}`;
  card.dataset.haCard = responseId;
  card.innerHTML = `
    <div class="ha-card-header">
      <span class="ha-card-icon">${icon}</span>
      <span class="ha-card-score">${overall}%</span>
      <span class="ha-card-label">${label}</span>
      <span class="ha-card-count">· ${claims.length} claim${claims.length !== 1 ? 's' : ''} checked</span>
      <button class="ha-toggle-btn" aria-expanded="false">
        Show claims ▾
      </button>
    </div>
    <div class="ha-claims-panel" style="display:none">
      ${claimRowsHTML}
    </div>
  `;

  // Toggle expand/collapse
  const btn   = card.querySelector('.ha-toggle-btn');
  const panel = card.querySelector('.ha-claims-panel');
  btn.addEventListener('click', () => {
    const open           = panel.style.display !== 'none';
    panel.style.display  = open ? 'none' : 'flex';
    btn.textContent      = open ? 'Show claims ▾' : 'Hide claims ▴';
    btn.setAttribute('aria-expanded', String(!open));
  });

  const parent = node.parentElement;
  if (parent) parent.insertBefore(card, node);
  else node.insertBefore(card, node.firstChild);

  console.log('[VeriAI] Audit card injected:', overall + '%', label);
}

// ── ERROR CHIP ────────────────────────────────────────────────────────────────

function showErrorChip(responseId, message) {
  const node = document.querySelector(`[data-ha-response-id="${responseId}"]`);
  if (!node) return;

  const chip     = document.createElement('div');
  chip.className = 'ha-audit-card ha-card-error';
  chip.innerHTML = `<div class="ha-card-header"><span>⚠️ ${escapeHtml(message)}</span></div>`;

  const parent = node.parentElement;
  if (parent) parent.insertBefore(chip, node);
  else node.insertBefore(chip, node.firstChild);
}

// ── UTILITY ───────────────────────────────────────────────────────────────────

function generateId() {
  return 'ha-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}