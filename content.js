// ─── content.js ───────────────────────────────────────────────────────────────
//
// Injected automatically into every chat.openai.com tab by Chrome.
// This file has NO access to background.js internals or API keys.
// It only talks to background.js via chrome.runtime.sendMessage.
//
// Responsibilities:
//   1. Check if extension is enabled (respect the popup toggle)
//   2. Watch ChatGPT's DOM for new AI responses finishing
//   3. Extract the response text and send it to background.js
//   4. Receive the scored audit result back from background.js
//   5. Inject colored underline badges onto each claim in the DOM
//   6. Render a floating overall score chip above each response
//   7. Show a tooltip on hover with score, verdict, and source link
//
// All injected CSS classes use the .ha- prefix to avoid
// colliding with ChatGPT's own styles.
// ──────────────────────────────────────────────────────────────────────────────


// ── BOOT ──────────────────────────────────────────────────────────────────────

// Check toggle state before doing anything.
// If the user turned the extension off in the popup, exit immediately.
chrome.storage.local.get('enabled', ({ enabled }) => {
  if (enabled === false) return;
  init();
});


// ── INIT ──────────────────────────────────────────────────────────────────────

function init() {
  watchForResponses();
  listenForResults();
}


// ── STEP 1: WATCH FOR CHATGPT RESPONSES ──────────────────────────────────────

/**
 * Uses a MutationObserver to detect when ChatGPT finishes streaming a response.
 *
 * Why debounce at 800ms?
 * ChatGPT streams tokens one by one — the DOM updates dozens of times per second
 * while streaming. We don't want to fire on every token. Instead we wait for
 * 800ms of silence (no DOM changes) which reliably means streaming has stopped.
 */
function watchForResponses() {
  let debounceTimer = null;
  let lastAuditedNode = null;

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      const node = getLatestAssistantNode();

      // Nothing to audit
      if (!node) return;

      // Already audited this exact node — skip
      if (node === lastAuditedNode) return;

      // Already marked as processed (from a previous audit)
      if (node.dataset.haProcessed) return;

      // Response too short to be meaningful (greetings, single-word replies)
      const text = node.innerText.trim();
      if (text.length < 80) return;

      // Mark immediately to prevent duplicate audits if observer fires again
      node.dataset.haProcessed = 'true';
      lastAuditedNode = node;

      // Assign a unique ID so we can match the result back to this node later
      const responseId = generateId();
      node.dataset.haResponseId = responseId;

      // Send the text to background.js for the full audit pipeline
      chrome.runtime.sendMessage({
        type: 'AUDIT_TEXT',
        text,
        responseId
      });

    }, 800); // 800ms debounce — wait for streaming to fully stop
  });

  // Observe the entire document body — ChatGPT dynamically renders everything
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}


// ── STEP 2: GET THE LATEST ASSISTANT MESSAGE NODE ─────────────────────────────

/**
 * Finds the most recently rendered ChatGPT assistant message node.
 * ChatGPT's DOM structure as of 2025 — may need updating if ChatGPT redesigns.
 *
 * Returns the .markdown div inside the latest assistant turn,
 * which contains the actual rendered response text.
 *
 * @returns {Element|null}
 */
function getLatestAssistantNode() {
  // Primary selector — targets the markdown content div inside assistant messages
  const nodes = document.querySelectorAll(
    '[data-message-author-role="assistant"] .markdown'
  );

  if (nodes.length > 0) return nodes[nodes.length - 1];

  // Fallback selector — in case ChatGPT updates their class names
  const fallback = document.querySelectorAll('[data-message-author-role="assistant"]');
  return fallback.length > 0 ? fallback[fallback.length - 1] : null;
}


// ── STEP 3: LISTEN FOR AUDIT RESULTS FROM BACKGROUND.JS ──────────────────────

/**
 * Listens for messages sent back from background.js after the audit completes.
 * Dispatches to badge injection or error handling based on message type.
 */
function listenForResults() {
  chrome.runtime.onMessage.addListener((message) => {

    if (message.type === 'AUDIT_RESULT') {
      injectBadges(message.result);
    }

    if (message.type === 'AUDIT_ERROR') {
      showErrorChip(message.responseId, message.message);
    }

  });
}


// ── STEP 4: INJECT BADGES INTO THE DOM ───────────────────────────────────────

/**
 * Main badge injection function.
 * Finds the correct response node by responseId, then:
 *   - Renders the overall score chip above the response
 *   - Underlines each claim with its color (green / yellow / red)
 *
 * @param {Object} result - { responseId, claims, overall }
 */
function injectBadges({ responseId, claims, overall }) {

  // Find the response node that triggered this audit
  const node = document.querySelector(`[data-ha-response-id="${responseId}"]`);
  if (!node) return;

  // Render the overall score chip first (appears above the text)
  renderScoreChip(node, overall, claims.length);

  // Underline each individual claim in the response text
  claims.forEach(claim => {
    highlightClaim(node, claim);
  });
}


// ── STEP 5: HIGHLIGHT A SINGLE CLAIM IN THE DOM ───────────────────────────────

/**
 * Finds the claim text inside the response node and wraps it in a
 * colored <mark> element for the underline badge effect.
 *
 * Uses TreeWalker to safely traverse text nodes without breaking
 * ChatGPT's own event listeners or React virtual DOM.
 *
 * @param {Element} container - The response's .markdown node
 * @param {Object}  claim     - { text, score, color, verdict, sourceUrl }
 */
function highlightClaim(container, claim) {
  const { text: claimText, color, score, verdict, sourceUrl } = claim;

  // Walk all text nodes inside the container
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  );

  let textNode;
  while (textNode = walker.nextNode()) {
    const nodeValue = textNode.nodeValue;
    const matchIndex = nodeValue.indexOf(claimText);

    // Claim text not in this text node — keep walking
    if (matchIndex === -1) continue;

    // Split the text node into three parts: [before | claim | after]
    const before = document.createTextNode(nodeValue.slice(0, matchIndex));
    const after  = document.createTextNode(nodeValue.slice(matchIndex + claimText.length));

    // Build the colored badge element
    const mark = document.createElement('mark');
    mark.className   = `ha-claim ha-${color}`;
    mark.textContent = claimText;

    // Store data attributes for the tooltip to read on hover
    mark.dataset.haScore   = score;
    mark.dataset.haVerdict = verdict;
    mark.dataset.haSource  = sourceUrl || '';

    // Replace the original text node with [before, mark, after]
    const parent = textNode.parentNode;
    parent.insertBefore(before, textNode);
    parent.insertBefore(mark, textNode);
    parent.insertBefore(after, textNode);
    parent.removeChild(textNode);

    // Attach the hover tooltip to this mark element
    attachTooltip(mark);

    // Only highlight the first occurrence of the claim
    break;
  }
}


// ── STEP 6: FLOATING OVERALL SCORE CHIP ──────────────────────────────────────

/**
 * Renders a small floating chip above the response showing the overall score.
 * e.g. "🛡️ 78% Verified · 4 claims checked"
 *
 * @param {Element} node        - The .markdown response node
 * @param {number}  overall     - 0–100 overall confidence score
 * @param {number}  claimCount  - How many claims were checked
 */
function renderScoreChip(node, overall, claimCount) {
  const colorClass = overall >= 75 ? 'green' : overall >= 40 ? 'yellow' : 'red';
  const label      = overall >= 75 ? 'Verified' : overall >= 40 ? 'Uncertain' : 'Disputed';

  const chip = document.createElement('div');
  chip.className = `ha-score-chip ha-chip-${colorClass}`;
  chip.innerHTML = `
    <span class="ha-chip-icon">🛡️</span>
    <span class="ha-chip-score">${overall}%</span>
    <span class="ha-chip-label">${label}</span>
    <span class="ha-chip-count">· ${claimCount} claim${claimCount !== 1 ? 's' : ''} checked</span>
  `;

  // Insert the chip just before the response text
  node.parentElement.insertBefore(chip, node);
}


// ── STEP 7: HOVER TOOLTIP ─────────────────────────────────────────────────────

/**
 * Attaches mouseenter / mouseleave handlers to a badge mark element.
 * On hover: creates and positions a tooltip card showing:
 *   - Confidence score %
 *   - Verdict text (e.g. "Verified by multiple sources")
 *   - Clickable source link (if available)
 *
 * @param {Element} mark - The <mark class="ha-claim"> element
 */
function attachTooltip(mark) {
  let tooltip = null;

  mark.addEventListener('mouseenter', () => {
    const score   = mark.dataset.haScore;
    const verdict = mark.dataset.haVerdict;
    const source  = mark.dataset.haSource;

    tooltip = document.createElement('div');
    tooltip.className = 'ha-tooltip';
    tooltip.innerHTML = `
      <div class="ha-tooltip-score">${score}% Confidence</div>
      <div class="ha-tooltip-verdict">${verdict}</div>
      ${source
        ? `<a class="ha-tooltip-link" href="${source}" target="_blank" rel="noopener">
             View Source →
           </a>`
        : '<span class="ha-tooltip-no-source">No source available</span>'
      }
    `;

    document.body.appendChild(tooltip);

    // Position tooltip above the mark element
    const rect    = mark.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();

    // Default: above the mark
    let top  = rect.top + window.scrollY - tipRect.height - 10;
    let left = rect.left + window.scrollX;

    // If tooltip would go off the top of the viewport, show it below instead
    if (top < window.scrollY + 8) {
      top = rect.bottom + window.scrollY + 8;
    }

    // If tooltip would overflow the right edge, shift it left
    if (left + tipRect.width > window.innerWidth - 12) {
      left = window.innerWidth - tipRect.width - 12;
    }

    tooltip.style.top  = `${top}px`;
    tooltip.style.left = `${left}px`;
  });

  mark.addEventListener('mouseleave', () => {
    tooltip?.remove();
    tooltip = null;
  });
}


// ── ERROR CHIP ────────────────────────────────────────────────────────────────

/**
 * Shows a small error chip when the audit pipeline fails.
 * e.g. "⚠️ Audit failed — Claude API key not set"
 *
 * @param {string} responseId - To find the correct response node
 * @param {string} message    - Human-readable error message from background.js
 */
function showErrorChip(responseId, message) {
  const node = document.querySelector(`[data-ha-response-id="${responseId}"]`);
  if (!node) return;

  const chip = document.createElement('div');
  chip.className = 'ha-score-chip ha-chip-error';
  chip.innerHTML = `<span>⚠️</span> <span>${message}</span>`;

  node.parentElement.insertBefore(chip, node);
}


// ── UTILITY ───────────────────────────────────────────────────────────────────

/**
 * Generates a unique ID for each response audit.
 * Used to tie an AUDIT_RESULT message back to the correct DOM node.
 *
 * @returns {string} e.g. "ha-1741354981234-x7k2m"
 */
function generateId() {
  return 'ha-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}