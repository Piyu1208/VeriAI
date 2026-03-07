// ─── popup/popup.js ───────────────────────────────────────────────────────────
//
// All logic for the extension toolbar popup.
// Runs in a separate context from background.js and content.js.
//
// Responsibilities:
//   1. Load saved API keys → pre-fill the input fields
//   2. Load the toggle state → reflect ON/OFF in UI
//   3. Save API keys to chrome.storage.local on button click
//   4. Handle ON/OFF toggle changes
//   5. Read recent audits from IndexedDB → render the history log
//   6. Handle "Clear history" button
//
// NOTE: popup.js CANNOT use ES module imports (import/export).
// Chrome popup scripts don't support type="module".
// So the IndexedDB read logic is written inline here instead of
// importing from utils/db.js. It's a known Chrome Extension limitation.
// ──────────────────────────────────────────────────────────────────────────────

// IndexedDB constants — must match utils/db.js exactly
const DB_NAME    = 'HallucinationAuditor';
const STORE_NAME = 'audits';


// ── ON POPUP OPEN ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

  // Load all saved state in parallel
  loadSavedKeys();
  loadToggleState();
  await loadAuditLog();

  // Wire up all interactive elements
  wireToggle();
  wireSaveButton();
  wireClearButton();

});


// ── 1. LOAD SAVED API KEYS ────────────────────────────────────────────────────

/**
 * Reads claudeKey and tavilyKey from chrome.storage.local.
 * Pre-fills the input fields if keys are already saved.
 * Shows a green border on each input to indicate it's populated.
 */
function loadSavedKeys() {
  chrome.storage.local.get(['claudeKey', 'tavilyKey'], (result) => {

    const claudeInput = document.getElementById('claudeKey');
    const tavilyInput = document.getElementById('tavilyKey');

    if (result.claudeKey) {
      claudeInput.value = result.claudeKey;
      claudeInput.classList.add('saved');
    }

    if (result.tavilyKey) {
      tavilyInput.value = result.tavilyKey;
      tavilyInput.classList.add('saved');
    }

  });
}


// ── 2. LOAD TOGGLE STATE ──────────────────────────────────────────────────────

/**
 * Reads the 'enabled' flag from chrome.storage.local.
 * Defaults to true (ON) if no value has been saved yet.
 * Updates the toggle checkbox, label text, and status dot color.
 */
function loadToggleState() {
  chrome.storage.local.get('enabled', (result) => {

    // Default to enabled if nothing is stored yet
    const isEnabled = result.enabled !== false;

    document.getElementById('enableToggle').checked = isEnabled;
    updateToggleUI(isEnabled);

  });
}


// ── 3. WIRE THE SAVE BUTTON ───────────────────────────────────────────────────

/**
 * On button click:
 *   - Reads both key inputs
 *   - Validates they're not empty
 *   - Saves them to chrome.storage.local
 *   - Shows a brief confirmation message
 */
function wireSaveButton() {
  const saveBtn      = document.getElementById('saveBtn');
  const savedConfirm = document.getElementById('savedConfirm');
  const claudeInput  = document.getElementById('claudeKey');
  const tavilyInput  = document.getElementById('tavilyKey');

  saveBtn.addEventListener('click', () => {
    const claudeKey = claudeInput.value.trim();
    const tavilyKey = tavilyInput.value.trim();

    // Save whatever is in the fields (even if empty — allows clearing keys)
    chrome.storage.local.set({ claudeKey, tavilyKey }, () => {

      // Visual feedback — green border on inputs
      claudeInput.classList.toggle('saved', claudeKey.length > 0);
      tavilyInput.classList.toggle('saved', tavilyKey.length > 0);

      // Show confirmation message briefly
      savedConfirm.classList.add('show');
      saveBtn.classList.add('saving');
      saveBtn.textContent = 'Saved ✓';

      setTimeout(() => {
        savedConfirm.classList.remove('show');
        saveBtn.classList.remove('saving');
        saveBtn.textContent = 'Save Keys';
      }, 2000);

    });
  });
}


// ── 4. WIRE THE TOGGLE ────────────────────────────────────────────────────────

/**
 * Listens for toggle changes and saves the new state immediately.
 * content.js reads 'enabled' from chrome.storage.local on every page load —
 * so the change takes effect on the next ChatGPT response.
 */
function wireToggle() {
  document.getElementById('enableToggle').addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ enabled: isEnabled });
    updateToggleUI(isEnabled);
  });
}

/**
 * Updates the toggle label text and header status dot to match current state.
 * @param {boolean} isEnabled
 */
function updateToggleUI(isEnabled) {
  // Label text: "Fact-checking is ON" / "Fact-checking is OFF"
  document.getElementById('toggleText').textContent = isEnabled ? 'ON' : 'OFF';

  // Green pulsing dot when active, grey when off
  const dot = document.getElementById('statusDot');
  dot.classList.toggle('off', !isEnabled);
}


// ── 5. LOAD AND RENDER AUDIT LOG ──────────────────────────────────────────────

/**
 * Reads the 5 most recent audit records from IndexedDB and renders them.
 * Each item shows: color bar, overall score %, claim count, and timestamp.
 */
async function loadAuditLog() {
  const container = document.getElementById('auditLog');

  try {
    const audits = await getRecentAudits(5);

    if (!audits || audits.length === 0) {
      container.innerHTML = `
        <div class="log-empty">
          <span class="empty-icon">📋</span>
          No audits yet.<br>Open ChatGPT and send a message!
        </div>
      `;
      return;
    }

    // Build the list HTML
    const html = audits.map(audit => {
      const score      = audit.overall ?? 0;
      const colorClass = score >= 75 ? 'green' : score >= 40 ? 'yellow' : 'red';
      const claimCount = audit.claims?.length ?? 0;
      const time       = formatTime(audit.timestamp);

      // Summarise the first claim for context (truncated)
      const firstClaim = audit.claims?.[0]?.text ?? 'No claims detected';
      const preview    = firstClaim.length > 42
        ? firstClaim.slice(0, 42) + '…'
        : firstClaim;

      return `
        <div class="log-item">
          <div class="log-bar ${colorClass}"></div>
          <div class="log-score ${colorClass}">${score}%</div>
          <div class="log-body">
            <div class="log-claims">${claimCount} claim${claimCount !== 1 ? 's' : ''} · ${preview}</div>
            <div class="log-time">${time}</div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="log-list">${html}</div>`;

  } catch (err) {
    container.innerHTML = `
      <div class="log-empty">
        <span class="empty-icon">⚠️</span>
        Could not load audit history.
      </div>
    `;
    console.warn('[Auditor Popup] Failed to load audit log:', err);
  }
}


// ── 6. WIRE CLEAR HISTORY BUTTON ─────────────────────────────────────────────

/**
 * Clears all IndexedDB audit records when the footer button is clicked.
 * Refreshes the log display to show the empty state.
 */
function wireClearButton() {
  document.getElementById('clearBtn').addEventListener('click', async () => {

    try {
      await clearAllAudits();
      await loadAuditLog(); // Refresh to show empty state
    } catch (err) {
      console.warn('[Auditor Popup] Failed to clear history:', err);
    }

  });
}


// ── INDEXEDDB HELPERS ─────────────────────────────────────────────────────────
// These duplicate the logic from utils/db.js because popup scripts
// cannot use ES module imports. Kept minimal — read + clear only.

/**
 * Opens the IndexedDB database (read-only for popup).
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);

    // If DB doesn't exist yet (no audits run), create it gracefully
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('by_timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * Returns the N most recent audit records, newest first.
 * @param {number} n
 * @returns {Promise<Array>}
 */
function getRecentAudits(n = 5) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();

      // If store doesn't exist yet — return empty array safely
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        resolve([]);
        return;
      }

      const tx      = db.transaction(STORE_NAME, 'readonly');
      const index   = tx.objectStore(STORE_NAME).index('by_timestamp');
      const request = index.openCursor(null, 'prev'); // newest first
      const results = [];

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < n) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = (e) => reject(e.target.error);

    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Clears all records from the audits store.
 * @returns {Promise<void>}
 */
function clearAllAudits() {
  return new Promise(async (resolve, reject) => {
    try {
      const db  = await openDB();
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}


// ── UTILITY ───────────────────────────────────────────────────────────────────

/**
 * Formats an ISO timestamp into a friendly relative time string.
 * e.g. "2 minutes ago", "Today at 14:23", "Yesterday at 09:41"
 *
 * @param {string} isoString - ISO 8601 timestamp from the audit record
 * @returns {string}
 */
function formatTime(isoString) {
  if (!isoString) return 'Unknown time';

  const date    = new Date(isoString);
  const now     = new Date();
  const diffMs  = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr  = Math.floor(diffMs / 3600000);

  if (diffMin < 1)  return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHr  < 24) return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}