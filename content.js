console.log('[VeriAI] content.js injected ✅');

// ─── content.js ───────────────────────────────────────────────────────────────
//
// Auto-detects the assistant message node for ANY LLM site using:
//   1. Known data attributes (ChatGPT, etc.)
//   2. aria-label heuristics (Gemini, Copilot, etc.)
//   3. Class name pattern matching (DeepSeek, Claude, etc.)
//   4. Caches the working selector in chrome.storage.local so it
//      reuses it on next load and self-heals if it stops working.
// ──────────────────────────────────────────────────────────────────────────────

// ── BOOT ──────────────────────────────────────────────────────────────────────

chrome.storage.local.get('enabled', ({ enabled }) => {
  if (enabled === false) return;
  init();
});

function init() {
  watchForResponses();
  listenForResults();
}

// ── SELECTOR CACHE ────────────────────────────────────────────────────────────

// In-memory cache for this session — avoids repeated storage reads
let cachedWrapperSelector = null;
let cachedContentSelector = null;

// Load cached selectors from storage on boot
chrome.storage.local.get(['ha_wrapper_sel', 'ha_content_sel'], (result) => {
  if (result.ha_wrapper_sel) {
    cachedWrapperSelector = result.ha_wrapper_sel;
    console.log('[VeriAI] Loaded cached wrapper selector:', cachedWrapperSelector);
  }
  if (result.ha_content_sel) {
    cachedContentSelector = result.ha_content_sel;
    console.log('[VeriAI] Loaded cached content selector:', cachedContentSelector);
  }
});

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


// ── AUTO-DETECT: GET LATEST ASSISTANT NODE ────────────────────────────────────

/**
 * Tries to find the latest assistant message node on ANY LLM site.
 *
 * Detection order:
 *   1. Use cached selector from a previous successful detection
 *   2. Known data attributes  → works for ChatGPT
 *   3. aria-label heuristics  → works for Gemini, Copilot
 *   4. Class name patterns    → works for DeepSeek, Claude, others
 *   5. Text content heuristic → last resort, finds largest text block
 *
 * When a new selector is found, it's saved to chrome.storage.local
 * so next page load reuses it without re-detecting.
 */
function getLatestAssistantNode() {

  // ── Strategy 0: Use cached selector if we have one ────────────────────────
  if (cachedWrapperSelector) {
    const nodes = document.querySelectorAll(cachedWrapperSelector);
    if (nodes.length > 0) {
      const wrapper = nodes[nodes.length - 1];
      const content = findContentNode(wrapper, cachedContentSelector);
      if (content && content.innerText.trim().length > 20) {
        return content;
      }
      // Cached selector no longer works — clear it and re-detect
      console.warn('[VeriAI] Cached selector stopped working, re-detecting...');
      cachedWrapperSelector = null;
      cachedContentSelector = null;
      chrome.storage.local.remove(['ha_wrapper_sel', 'ha_content_sel']);
    }
  }

  // ── Strategy 1: data attributes ───────────────────────────────────────────
  // Works for: ChatGPT, many custom LLM UIs
  const dataSelectors = [
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '[data-sender="assistant"]',
    '[data-actor="assistant"]',
    '[data-message-role="assistant"]',
    '[data-type="assistant"]',
    '[data-author="assistant"]',
  ];

  for (const sel of dataSelectors) {
    const nodes = document.querySelectorAll(sel);
    if (nodes.length > 0) {
      const wrapper = nodes[nodes.length - 1];
      const content = findContentNode(wrapper, null);
      if (content) {
        saveSelector(sel, getContentSelector(wrapper, content));
        return content;
      }
    }
  }

  // ── Strategy 2: aria-label heuristics ─────────────────────────────────────
  // Works for: Gemini (aria-label="Gemini"), Copilot, Perplexity
  const ariaNodes = [...document.querySelectorAll('[aria-label]')]
    .filter(el => /assistant|bot|ai response|model|gemini|claude|deepseek|copilot|perplexity/i
      .test(el.getAttribute('aria-label') || ''));

  if (ariaNodes.length > 0) {
    const wrapper  = ariaNodes[ariaNodes.length - 1];
    const sel      = buildAriaSelector(wrapper);
    const content  = findContentNode(wrapper, null);
    if (content) {
      saveSelector(sel, getContentSelector(wrapper, content));
      return content;
    }
  }

  // ── Strategy 3: class name pattern matching ────────────────────────────────
  // Works for: DeepSeek (.ds-message--assistant), Claude (.font-claude-message),
  //            Mistral, Llama.cpp UIs, open-source chat UIs
  const classPatterns = [
    /assistant/i, /bot[-_]?message/i, /ai[-_]?message/i,
    /model[-_]?response/i, /llm[-_]?response/i, /response[-_]?bubble/i,
    /chat[-_]?response/i, /claude[-_]?message/i, /ds[-_]?message.*assistant/i,
  ];

  const allDivs = [...document.querySelectorAll('div, section, article')];

  for (const pattern of classPatterns) {
    const matches = allDivs.filter(el => pattern.test(el.className || ''));
    if (matches.length > 0) {
      const wrapper = matches[matches.length - 1];
      const content = findContentNode(wrapper, null);
      if (content && content.innerText.trim().length > 20) {
        const sel = buildClassSelector(wrapper, pattern);
        saveSelector(sel, getContentSelector(wrapper, content));
        return content;
      }
    }
  }

  // ── Strategy 4: role="presentation" or role="log" children ────────────────
  // Works for: some custom UIs that use ARIA roles on chat containers
  const chatLogs = document.querySelectorAll('[role="log"], [role="feed"]');
  for (const log of chatLogs) {
    const children = [...log.children];
    // Assume even children = user, odd = assistant (common pattern)
    const lastOdd = children.filter((_, i) => i % 2 !== 0).pop();
    if (lastOdd) {
      const content = findContentNode(lastOdd, null);
      if (content && content.innerText.trim().length > 20) {
        console.log('[VeriAI] Detected via role=log child heuristic');
        return content;
      }
    }
  }

  // ── Strategy 5: largest text block heuristic (last resort) ────────────────
  // Finds the most recently added large block of text — very broad but
  // works as a last resort for unknown UIs
  const textBlocks = allDivs
    .filter(el => {
      const text = el.innerText?.trim() || '';
      const kids = el.children.length;
      // Look for leaf-ish nodes with substantial text
      return text.length > 150 && kids < 10;
    })
    .sort((a, b) => (b.innerText?.length || 0) - (a.innerText?.length || 0));

  if (textBlocks.length > 0) {
    console.warn('[VeriAI] Using last-resort text block heuristic — may be inaccurate');
    return textBlocks[0];
  }

  console.warn('[VeriAI] Could not detect assistant node on this page');
  return null;
}


// ── FIND CONTENT NODE INSIDE WRAPPER ─────────────────────────────────────────

/**
 * Given a wrapper element, finds the actual readable content node inside it.
 * If a previously cached content selector is provided, tries that first.
 *
 * @param {Element}     wrapper         - The assistant message wrapper
 * @param {string|null} cachedSelector  - Previously cached content selector
 * @returns {Element}
 */
function findContentNode(wrapper, cachedSelector) {

  // Try cached content selector first
  if (cachedSelector) {
    const node = wrapper.querySelector(cachedSelector);
    if (node && node.innerText.trim().length > 10) return node;
  }

  // Known content node selectors — ordered by specificity
  const contentSelectors = [
    '.markdown', '.prose',
    '[class*="markdown"]', '[class*="prose"]',
    '[class*="message-content"]', '[class*="response-content"]',
    '[class*="msg-content"]', '[class*="chat-content"]',
    '[class*="reply-content"]', '[class*="answer-content"]',
    '[class*="output"]', '[class*="text-content"]',
    'p', // last resort — just grab the first paragraph
  ];

  for (const sel of contentSelectors) {
    const node = wrapper.querySelector(sel);
    if (node && node.innerText.trim().length > 10) return node;
  }

  // Nothing found inside — return the wrapper itself
  return wrapper;
}


// ── SELECTOR BUILDING HELPERS ─────────────────────────────────────────────────

/**
 * Builds a precise CSS selector string for a wrapper element found via aria-label.
 */
function buildAriaSelector(el) {
  const label = el.getAttribute('aria-label') || '';
  const tag   = el.tagName.toLowerCase();
  return `${tag}[aria-label="${label}"]`;
}

/**
 * Builds a CSS selector from the first matching class on the wrapper element.
 */
function buildClassSelector(el, pattern) {
  const classes    = [...el.classList];
  const matchClass = classes.find(c => pattern.test(c));
  return matchClass ? `.${matchClass}` : el.tagName.toLowerCase();
}

/**
 * Gets a relative selector for the content node within its wrapper.
 */
function getContentSelector(wrapper, content) {
  if (content === wrapper) return null;
  // Try to build a selector from content's classes
  if (content.className) {
    const firstClass = content.className.trim().split(/\s+/)[0];
    if (firstClass) return `.${firstClass}`;
  }
  return null;
}

/**
 * Saves a working selector pair to memory cache and chrome.storage.local.
 */
function saveSelector(wrapperSel, contentSel) {
  if (cachedWrapperSelector === wrapperSel) return; // already cached

  cachedWrapperSelector = wrapperSel;
  cachedContentSelector = contentSel;

  chrome.storage.local.set({
    ha_wrapper_sel: wrapperSel,
    ha_content_sel: contentSel || ''
  });

  console.log('[VeriAI] ✅ Auto-detected and cached selector:', wrapperSel, '→', contentSel);
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
  card.className      = `ha-audit-card ha-card-${colorClass}`;
  card.dataset.haCard = responseId;
  card.innerHTML = `
    <div class="ha-card-header">
      <span class="ha-card-icon">${icon}</span>
      <span class="ha-card-score">${overall}%</span>
      <span class="ha-card-label">${label}</span>
      <span class="ha-card-count">· ${claims.length} claim${claims.length !== 1 ? 's' : ''} checked</span>
      <button class="ha-toggle-btn" aria-expanded="false">Show claims ▾</button>
    </div>
    <div class="ha-claims-panel" style="display:none">
      ${claimRowsHTML}
    </div>
  `;

  const btn   = card.querySelector('.ha-toggle-btn');
  const panel = card.querySelector('.ha-claims-panel');
  btn.addEventListener('click', () => {
    const open          = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'flex';
    btn.textContent     = open ? 'Show claims ▾' : 'Hide claims ▴';
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