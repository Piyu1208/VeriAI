console.log('[VeriAI] content.js injected ✅');

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


function watchForResponses() {
  let debounceTimer = null;
  let lastAuditedNode = null;

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {

      const node = getLatestAssistantNode();


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
}


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
}


// ── STEP 3: LISTEN FOR AUDIT RESULTS FROM BACKGROUND.JS ──────────────────────


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


// ── ERROR CHIP ────────────────────────────────────────────────────────────────


function showErrorChip(responseId, message) {

  const node = document.querySelector(
    `[data-ha-response-id="${responseId}"]`
  );

  if (!node) return;

  const chip = document.createElement('div');

  chip.className = 'ha-score-chip ha-chip-error';

  chip.innerHTML = `<span>⚠️</span> <span>${message}</span>`;

  node.parentElement.insertBefore(chip, node);

}


// ── UTILITY ───────────────────────────────────────────────────────────────────


function generateId() {
  return 'ha-' + Date.now() + '-' +
    Math.random().toString(36).slice(2, 7);
}