// ─── utils/db.js ──────────────────────────────────────────────────────────────
//
// IndexedDB wrapper for storing audit history locally in the browser.
// No server. No account. No sync. Purely local persistence.
//
// Exported functions (all return Promises — use with async/await):
//   saveAudit(auditResult)     → writes one audit record to the DB
//   getRecentAudits(n)         → returns the N most recent records
//   clearAllAudits()           → wipes all stored records
//
// Used by:
//   background.js  → calls saveAudit() after every completed audit
//   popup.js       → calls getRecentAudits() to render the history log
//
// Why IndexedDB and not chrome.storage.local?
//   chrome.storage.local is designed for small config values (API keys, toggles).
//   IndexedDB handles structured records, supports sorting by index, and
//   can store far more data without hitting size limits.
// ──────────────────────────────────────────────────────────────────────────────

const DB_NAME    = 'HallucinationAuditor';
const DB_VERSION = 1;
const STORE_NAME = 'audits';
const MAX_RECORDS = 50; // Auto-prune oldest records beyond this limit


// ── OPEN / INITIALISE DB ──────────────────────────────────────────────────────

/**
 * Opens the IndexedDB database, creating it on first run.
 * Called internally before every read/write operation.
 * IndexedDB manages connection pooling — calling this repeatedly is safe.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // onupgradeneeded fires ONLY on first install or when DB_VERSION increases.
    // This is where we define the schema — the object store and its indexes.
    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Create the 'audits' store with auto-incrementing integer IDs
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        });

        // Index by timestamp so we can query "most recent N records" efficiently
        store.createIndex('by_timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror  = (event) => reject(event.target.error);
  });
}


// ── SAVE AUDIT ────────────────────────────────────────────────────────────────

/**
 * Saves one completed audit result to IndexedDB.
 * Automatically prunes the oldest records if the total exceeds MAX_RECORDS.
 *
 * The record stored looks like:
 * {
 *   id:        (auto-assigned integer),
 *   timestamp: "2025-03-07T14:23:01.000Z",
 *   site:      "chat.openai.com",
 *   overall:   78,
 *   claims: [
 *     { text, score, color, verdict, sourceUrl },
 *     ...
 *   ]
 * }
 *
 * @param {Object} auditResult - The scored result from processClaims()
 *   Expected shape: { overall, claims, responseId }
 * @returns {Promise<void>}
 */
export async function saveAudit(auditResult) {
  const db = await openDB();

  // Build the record — add metadata before storing
  const record = {
    timestamp: new Date().toISOString(),
    site:      'chat.openai.com',
    overall:   auditResult.overall,
    claims:    auditResult.claims,
    responseId: auditResult.responseId || null
  };

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.add(record);

    req.onsuccess = async () => {
      // After successfully saving, prune if we've gone over the limit
      await pruneOldRecords(db);
      resolve();
    };

    req.onerror = (event) => reject(event.target.error);
  });
}


// ── GET RECENT AUDITS ─────────────────────────────────────────────────────────

/**
 * Returns the N most recent audit records, newest first.
 * Used by popup.js to render the audit history list.
 *
 * @param {number} n - How many records to return (default: 5)
 * @returns {Promise<Array>} Array of audit records, newest first
 */
export async function getRecentAudits(n = 5) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('by_timestamp');

    // Open cursor in PREV (descending) direction = newest records first
    const request = index.openCursor(null, 'prev');
    const results = [];

    request.onsuccess = (event) => {
      const cursor = event.target.result;

      if (cursor && results.length < n) {
        results.push(cursor.value);
        cursor.continue(); // Move to next record
      } else {
        resolve(results);  // Done — return what we have
      }
    };

    request.onerror = (event) => reject(event.target.error);
  });
}


// ── CLEAR ALL AUDITS ──────────────────────────────────────────────────────────

/**
 * Deletes every record from the audits store.
 * Triggered by the "Clear History" button in popup.js.
 *
 * @returns {Promise<void>}
 */
export async function clearAllAudits() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).clear();

    req.onsuccess = () => resolve();
    req.onerror   = (event) => reject(event.target.error);
  });
}


// ── INTERNAL: PRUNE OLD RECORDS ───────────────────────────────────────────────

/**
 * Deletes the oldest records when the total exceeds MAX_RECORDS.
 * Called automatically after every saveAudit().
 * Uses a forward (ascending) cursor — oldest records have the lowest IDs
 * and are deleted first.
 *
 * @param {IDBDatabase} db - Already-open DB instance
 * @returns {Promise<void>}
 */
async function pruneOldRecords(db) {
  return new Promise((resolve) => {
    const tx         = db.transaction(STORE_NAME, 'readwrite');
    const store      = tx.objectStore(STORE_NAME);
    const countReq   = store.count();

    countReq.onsuccess = () => {
      const total       = countReq.result;
      const deleteCount = total - MAX_RECORDS;

      // Nothing to prune
      if (deleteCount <= 0) {
        resolve();
        return;
      }

      // Open ascending cursor (oldest first) and delete the excess
      let deleted = 0;
      const cursorReq = store.openCursor(); // ascending = oldest first

      cursorReq.onsuccess = (event) => {
        const cursor = event.target.result;

        if (cursor && deleted < deleteCount) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          resolve();
        }
      };

      cursorReq.onerror = () => resolve(); // Non-fatal — just stop pruning
    };

    countReq.onerror = () => resolve(); // Non-fatal
  });
}