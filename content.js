console.log('[VeriAI] content.js injected ✅');

// ─── content.js ───────────────────────────────────────────────────────────────
//
// Auto-detects the assistant message node for ANY LLM site.
// Supports: ChatGPT, DeepSeek, Claude, Gemini, Copilot, Perplexity
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

let cachedWrapperSelector = null;
let cachedContentSelector = null;

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


// ── GET LATEST ASSISTANT NODE ─────────────────────────────────────────────────

function getLatestAssistantNode() {

  // ── Strategy 0: Use cached selector ───────────────────────────────────────
  if (cachedWrapperSelector) {
    const nodes = document.querySelectorAll(cachedWrapperSelector);
    if (nodes.length > 0) {
      const wrapper = nodes[nodes.length - 1];
      const content = findContentNode(wrapper, cachedContentSelector);
      if (content && content.innerText.trim().length > 20) return content;

      console.warn('[VeriAI] Cached selector stopped working, re-detecting...');
      cachedWrapperSelector = null;
      cachedContentSelector = null;
      chrome.storage.local.remove(['ha_wrapper_sel', 'ha_content_sel']);
    }
  }

  // ── Strategy 1: Explicit known selectors per site ─────────────────────────
  //
  // Format: [wrapperSelector, contentSelector | null, siteName]
  // contentSelector null = use the wrapper itself as the content node.
  // To add a new LLM: just add one line here.
  //
  const knownSelectors = [

    // ChatGPT
    ['[data-message-author-role="assistant"]', '.markdown',             'ChatGPT'],
    ['[data-message-author-role="assistant"]', '.prose',                'ChatGPT (prose)'],

    // DeepSeek — ds-markdown is the container, ds-markdown-paragraph is each paragraph
    ['.ds-markdown',                            null,                    'DeepSeek'],

    // Claude
    ['[data-is-streaming="false"]',             '.font-claude-message', 'Claude'],
    ['.font-claude-message',                    null,                    'Claude (fallback)'],

    // Gemini 
    ['model-response',        '.markdown', 'Gemini (fallback)'],

    // Generic data attributes — many custom/open-source LLM UIs use these
    ['[data-role="assistant"]',                 null,                    'Generic data-role'],
    ['[data-sender="assistant"]',               null,                    'Generic data-sender'],
    ['[data-actor="assistant"]',                null,                    'Generic data-actor'],
    ['[data-message-role="assistant"]',         null,                    'Generic data-message-role'],
  ];

  for (const [wrapperSel, contentSel, siteName] of knownSelectors) {
    const nodes = document.querySelectorAll(wrapperSel);
    if (nodes.length === 0) continue;

    const wrapper = nodes[nodes.length - 1];
    const content = contentSel ? (wrapper.querySelector(contentSel) || wrapper) : wrapper;

    if (content && content.innerText.trim().length > 20) {
      saveSelector(wrapperSel, contentSel);
      console.log(`[VeriAI] ✅ Detected: ${siteName} | wrapper: ${wrapperSel} | content: ${contentSel || 'self'}`);
      return content;
    }
  }

  // ── Strategy 2: aria-label heuristics ─────────────────────────────────────
  const ariaNodes = [...document.querySelectorAll('[aria-label]')]
    .filter(el => /assistant|bot|ai response|model|gemini|claude|deepseek|copilot|perplexity/i
      .test(el.getAttribute('aria-label') || ''));

  if (ariaNodes.length > 0) {
    const wrapper = ariaNodes[ariaNodes.length - 1];
    const sel     = `${wrapper.tagName.toLowerCase()}[aria-label="${wrapper.getAttribute('aria-label')}"]`;
    const content = findContentNode(wrapper, null);
    if (content) {
      saveSelector(sel, getContentSelector(wrapper, content));
      console.log('[VeriAI] ✅ Detected via aria-label:', sel);
      return content;
    }
  }

  // ── Strategy 3: class name pattern matching ────────────────────────────────
  const classPatterns = [
    // DeepSeek specific
    [/^ds-markdown$/,           'DeepSeek (ds-markdown)'],
    [/^ds-markdown-paragraph$/, 'DeepSeek (ds-markdown-paragraph)'],
    [/ds[-_]?message/i,         'DeepSeek (ds-message)'],
    // Generic
    [/assistant/i,              'Generic (assistant)'],
    [/bot[-_]?message/i,        'Generic (bot-message)'],
    [/ai[-_]?message/i,         'Generic (ai-message)'],
    [/model[-_]?response/i,     'Generic (model-response)'],
    [/llm[-_]?response/i,       'Generic (llm-response)'],
    [/claude[-_]?message/i,     'Claude (class)'],
    [/response[-_]?bubble/i,    'Generic (response-bubble)'],
    [/chat[-_]?response/i,      'Generic (chat-response)'],
  ];

  const allDivs = [...document.querySelectorAll('div, section, article')];

  for (const [pattern, label] of classPatterns) {
    const matches = allDivs.filter(el => pattern.test(el.className || ''));
    if (matches.length === 0) continue;

    const wrapper = matches[matches.length - 1];
    const content = findContentNode(wrapper, null);

    if (content && content.innerText.trim().length > 20) {
      const matchClass = [...wrapper.classList].find(c => pattern.test(c));
      const sel        = matchClass ? `.${matchClass}` : wrapper.tagName.toLowerCase();
      saveSelector(sel, getContentSelector(wrapper, content));
      console.log(`[VeriAI] ✅ Detected via class: ${label} → .${matchClass}`);
      return content;
    }
  }

  // ── Strategy 4: role=log children heuristic ───────────────────────────────
  const chatLogs = document.querySelectorAll('[role="log"], [role="feed"]');
  for (const log of chatLogs) {
    const children = [...log.children];
    const lastOdd  = children.filter((_, i) => i % 2 !== 0).pop();
    if (lastOdd) {
      const content = findContentNode(lastOdd, null);
      if (content && content.innerText.trim().length > 20) {
        console.log('[VeriAI] ✅ Detected via role=log heuristic');
        return content;
      }
    }
  }

  // ── Strategy 5: largest text block (last resort) ──────────────────────────
  const textBlocks = allDivs
    .filter(el => (el.innerText?.trim().length || 0) > 150 && el.children.length < 10)
    .sort((a, b) => (b.innerText?.length || 0) - (a.innerText?.length || 0));

  if (textBlocks.length > 0) {
    console.warn('[VeriAI] Using last-resort heuristic — may be inaccurate');
    return textBlocks[0];
  }

  console.warn('[VeriAI] Could not detect assistant node — site may not be supported');
  return null;
}


// ── HELPERS ───────────────────────────────────────────────────────────────────

function findContentNode(wrapper, cachedSelector) {
  if (cachedSelector) {
    const node = wrapper.querySelector(cachedSelector);
    if (node && node.innerText.trim().length > 10) return node;
  }

  const contentSelectors = [
    '.markdown', '.prose',
    '[class*="markdown"]', '[class*="prose"]',
    '[class*="message-content"]', '[class*="response-content"]',
    '[class*="msg-content"]', '[class*="chat-content"]',
    '[class*="output"]', '[class*="text-content"]',
  ];

  for (const sel of contentSelectors) {
    const node = wrapper.querySelector(sel);
    if (node && node.innerText.trim().length > 10) return node;
  }

  return wrapper;
}

function getContentSelector(wrapper, content) {
  if (content === wrapper) return null;
  if (content.className) {
    const firstClass = content.className.trim().split(/\s+/)[0];
    if (firstClass) return `.${firstClass}`;
  }
  return null;
}

function saveSelector(wrapperSel, contentSel) {
  if (cachedWrapperSelector === wrapperSel) return;
  cachedWrapperSelector = wrapperSel;
  cachedContentSelector = contentSel;
  chrome.storage.local.set({
    ha_wrapper_sel: wrapperSel,
    ha_content_sel: contentSel || ''
  });
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