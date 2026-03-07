console.log('[VeriAI] content.js injected ✅');

// ─── content.js ───────────────────────────────────────────────────────────────

// ── BOOT ──────────────────────────────────────────────────────────────────────

<<<<<<< HEAD
=======

>>>>>>> 0900c80ff4e96b9fced51dabe7c3184180d6f632
chrome.storage.local.get('enabled', ({ enabled }) => {
  if (enabled === false) return;
  init();
});

function init() {
  watchForResponses();
  listenForResults();
}

// ── WATCH FOR RESPONSES ───────────────────────────────────────────────────────

<<<<<<< HEAD
=======
// ── STEP 1: WATCH FOR CHATGPT RESPONSES ──────────────────────────────────────


>>>>>>> 0900c80ff4e96b9fced51dabe7c3184180d6f632
function watchForResponses() {
  let debounceTimer   = null;
  let lastAuditedNode = null;

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {

      const node = getLatestAssistantNode();

<<<<<<< HEAD
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
=======

      if (!node) return;


      if (node === lastAuditedNode) return;


      if (node.dataset.haProcessed) return;


      const text = node.innerText.trim();

      if (text.length < 80) return;


      node.dataset.haProcessed = 'true';
      lastAuditedNode = node;


      const responseId = generateId();
      node.dataset.haResponseId = responseId;


      chrome.runtime.sendMessage({
        type: 'AUDIT_TEXT',
        text,
        responseId
      });

    }, 800);

  });


  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
>>>>>>> 0900c80ff4e96b9fced51dabe7c3184180d6f632
}

// ── GET LATEST ASSISTANT NODE ─────────────────────────────────────────────────

<<<<<<< HEAD
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
=======
// ── STEP 2: GET THE LATEST ASSISTANT MESSAGE NODE ─────────────────────────────


function getLatestAssistantNode() {

  // OLD ChatGPT selector
  let nodes = document.querySelectorAll(
    '[data-message-author-role="assistant"] .markdown'
  );

  if (nodes.length > 0) {
    return nodes[nodes.length - 1];
  }

  // NEW ChatGPT selector (2024+ UI)
  const turns = document.querySelectorAll(
    'article[data-testid="conversation-turn"]'
  );

  if (turns.length === 0) return null;

  const lastTurn = turns[turns.length - 1];

  const markdown = lastTurn.querySelector('.markdown');

  if (markdown) return markdown;

  // fallback — entire article text
  return lastTurn;
>>>>>>> 0900c80ff4e96b9fced51dabe7c3184180d6f632
}

// ── LISTEN FOR RESULTS ────────────────────────────────────────────────────────

<<<<<<< HEAD
=======
// ── STEP 3: LISTEN FOR AUDIT RESULTS FROM BACKGROUND.JS ──────────────────────


>>>>>>> 0900c80ff4e96b9fced51dabe7c3184180d6f632
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

<<<<<<< HEAD
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
=======
// ── STEP 4: INJECT BADGES INTO THE DOM ───────────────────────────────────────


function injectBadges({ responseId, claims, overall }) {


  const node = document.querySelector(`[data-ha-response-id="${responseId}"]`);
  if (!node) return;


  renderScoreChip(node, overall, claims.length);

  
  claims.forEach(claim => {
    highlightClaim(node, claim);
  });

}


// ── STEP 5: HIGHLIGHT A SINGLE CLAIM IN THE DOM ───────────────────────────────


function highlightClaim(container, claim) {

  const { text: claimText, color, score, verdict, sourceUrl } = claim;


  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  );

  let textNode;

  while (textNode = walker.nextNode()) {

    const nodeValue = textNode.nodeValue;
    const matchIndex = nodeValue.indexOf(claimText);


    if (matchIndex === -1) continue;

    const before = document.createTextNode(
      nodeValue.slice(0, matchIndex)
    );

    const after = document.createTextNode(
      nodeValue.slice(matchIndex + claimText.length)
    );

    const mark = document.createElement('mark');

    mark.className = `ha-claim ha-${color}`;
    mark.textContent = claimText;

    mark.dataset.haScore = score;
    mark.dataset.haVerdict = verdict;
    mark.dataset.haSource = sourceUrl || '';


    
    const parent = textNode.parentNode;

    parent.insertBefore(before, textNode);
    parent.insertBefore(mark, textNode);
    parent.insertBefore(after, textNode);
    parent.removeChild(textNode);


    attachTooltip(mark);

    
    break;
  }

}


// ── STEP 6: FLOATING OVERALL SCORE CHIP ──────────────────────────────────────


function renderScoreChip(node, overall, claimCount) {

  const colorClass =
    overall >= 75 ? 'green' :
    overall >= 40 ? 'yellow' :
    'red';

  const label =
    overall >= 75 ? 'Verified' :
    overall >= 40 ? 'Uncertain' :
    'Disputed';

  const chip = document.createElement('div');

  chip.className = `ha-score-chip ha-chip-${colorClass}`;

  chip.innerHTML = `
    <span class="ha-chip-icon">🛡️</span>
    <span class="ha-chip-score">${overall}%</span>
    <span class="ha-chip-label">${label}</span>
    <span class="ha-chip-count">· ${claimCount} claim${claimCount !== 1 ? 's' : ''} checked</span>
  `;


  node.parentElement.insertBefore(chip, node);

}


// ── STEP 7: HOVER TOOLTIP ─────────────────────────────────────────────────────


function attachTooltip(mark) {

  let tooltip = null;

  mark.addEventListener('mouseenter', () => {

    const score = mark.dataset.haScore;
    const verdict = mark.dataset.haVerdict;
    const source = mark.dataset.haSource;

    tooltip = document.createElement('div');

    tooltip.className = 'ha-tooltip';

    tooltip.innerHTML = `
      <div class="ha-tooltip-score">${score}% Confidence</div>
      <div class="ha-tooltip-verdict">${verdict}</div>
      ${
        source
          ? `<a class="ha-tooltip-link" href="${source}" target="_blank" rel="noopener">View Source →</a>`
          : `<span class="ha-tooltip-no-source">No source available</span>`
      }
    `;

    document.body.appendChild(tooltip);

    const rect = mark.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();

    let top = rect.top + window.scrollY - tipRect.height - 10;
    let left = rect.left + window.scrollX;


    if (top < window.scrollY + 8) {
      top = rect.bottom + window.scrollY + 8;
    }


    if (left + tipRect.width > window.innerWidth - 12) {
      left = window.innerWidth - tipRect.width - 12;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

  });

  mark.addEventListener('mouseleave', () => {
    tooltip?.remove();
    tooltip = null;
  });

}
>>>>>>> 0900c80ff4e96b9fced51dabe7c3184180d6f632

  console.log('[VeriAI] Audit card injected:', overall + '%', label);
}

// ── ERROR CHIP ────────────────────────────────────────────────────────────────

<<<<<<< HEAD
=======

>>>>>>> 0900c80ff4e96b9fced51dabe7c3184180d6f632
function showErrorChip(responseId, message) {

  const node = document.querySelector(
    `[data-ha-response-id="${responseId}"]`
  );

  if (!node) return;

<<<<<<< HEAD
  const chip     = document.createElement('div');
  chip.className = 'ha-audit-card ha-card-error';
  chip.innerHTML = `<div class="ha-card-header"><span>⚠️ ${escapeHtml(message)}</span></div>`;

  const parent = node.parentElement;
  if (parent) parent.insertBefore(chip, node);
  else node.insertBefore(chip, node.firstChild);
=======
  const chip = document.createElement('div');

  chip.className = 'ha-score-chip ha-chip-error';

  chip.innerHTML = `<span>⚠️</span> <span>${message}</span>`;

  node.parentElement.insertBefore(chip, node);

>>>>>>> 0900c80ff4e96b9fced51dabe7c3184180d6f632
}

// ── UTILITY ───────────────────────────────────────────────────────────────────

<<<<<<< HEAD
function generateId() {
  return 'ha-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
=======

function generateId() {
  return 'ha-' + Date.now() + '-' +
    Math.random().toString(36).slice(2, 7);
>>>>>>> 0900c80ff4e96b9fced51dabe7c3184180d6f632
}