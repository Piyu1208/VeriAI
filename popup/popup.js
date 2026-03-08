// ─── popup/popup.js ───────────────────────────────────────────────────────────
//
// Removed: API key inputs, loadSavedKeys(), wireSaveButton()
// Added:   Backend health check — shows online/offline status in popup
// ──────────────────────────────────────────────────────────────────────────────

const DB_NAME    = 'HallucinationAuditor';
const STORE_NAME = 'audits';

// Must match BACKEND_URL in utils/api.js
const BACKEND_URL = 'https://veriai-isml.onrender.com';


// ── ON POPUP OPEN ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

  loadToggleState();
  checkBackendHealth();
  await loadAuditLog();

  wireToggle();
  wireClearButton();

});


// ── 1. BACKEND HEALTH CHECK ───────────────────────────────────────────────────

/**
 * Pings the backend GET / endpoint.
 * Updates the status dot + text in the popup to show online/offline.
 */
async function checkBackendHealth() {
  const dot     = document.getElementById('backendDot');
  const text    = document.getElementById('backendText');
  const urlEl   = document.getElementById('backendUrl');

  urlEl.textContent = BACKEND_URL;

  try {
    const res = await fetch(`${BACKEND_URL}/`, { method: 'GET' });

    if (res.ok) {
      dot.classList.add('online');
      dot.classList.remove('offline');
      text.innerHTML = '<span>Online</span> · Backend running';
    } else {
      throw new Error(`HTTP ${res.status}`);
    }

  } catch {
    dot.classList.add('offline');
    dot.classList.remove('online');
    text.innerHTML = '<span style="color:#f85149">Offline</span> · Start your backend server';
  }
}


// ── 2. LOAD TOGGLE STATE ──────────────────────────────────────────────────────

function loadToggleState() {
  chrome.storage.local.get('enabled', (result) => {
    const isEnabled = result.enabled !== false;
    document.getElementById('enableToggle').checked = isEnabled;
    updateToggleUI(isEnabled);
  });
}


// ── 3. WIRE THE TOGGLE ────────────────────────────────────────────────────────

function wireToggle() {
  document.getElementById('enableToggle').addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ enabled: isEnabled });
    updateToggleUI(isEnabled);
  });
}

function updateToggleUI(isEnabled) {
  document.getElementById('toggleText').textContent = isEnabled ? 'ON' : 'OFF';
  document.getElementById('statusDot').classList.toggle('off', !isEnabled);
}


// ── 4. LOAD AUDIT LOG ─────────────────────────────────────────────────────────

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

    const html = audits.map(audit => {
      const score      = audit.overall ?? 0;
      const colorClass = score >= 75 ? 'green' : score >= 40 ? 'yellow' : 'red';
      const claimCount = audit.claims?.length ?? 0;
      const time       = formatTime(audit.timestamp);
      const firstClaim = audit.claims?.[0]?.text ?? 'No claims detected';
      const preview    = firstClaim.length > 42 ? firstClaim.slice(0, 42) + '…' : firstClaim;

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


// ── 5. WIRE CLEAR BUTTON ──────────────────────────────────────────────────────

function wireClearButton() {
  document.getElementById('clearBtn').addEventListener('click', async () => {
    try {
      await clearAllAudits();
      await loadAuditLog();
    } catch (err) {
      console.warn('[Auditor Popup] Failed to clear history:', err);
    }
  });
}


// ── INDEXEDDB HELPERS ─────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess     = (e) => resolve(e.target.result);
    req.onerror       = (e) => reject(e.target.error);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

function getRecentAudits(n = 5) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_NAME)) { resolve([]); return; }

      const tx      = db.transaction(STORE_NAME, 'readonly');
      const index   = tx.objectStore(STORE_NAME).index('by_timestamp');
      const request = index.openCursor(null, 'prev');
      const results = [];

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < n) { results.push(cursor.value); cursor.continue(); }
        else resolve(results);
      };
      request.onerror = (e) => reject(e.target.error);
    } catch (err) { reject(err); }
  });
}

function clearAllAudits() {
  return new Promise(async (resolve, reject) => {
    try {
      const db  = await openDB();
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
    } catch (err) { reject(err); }
  });
}


// ── UTILITY ───────────────────────────────────────────────────────────────────

function formatTime(isoString) {
  if (!isoString) return 'Unknown time';
  const date    = new Date(isoString);
  const now     = new Date();
  const diffMin = Math.floor((now - date) / 60000);
  const diffHr  = Math.floor((now - date) / 3600000);

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