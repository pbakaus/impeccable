/**
 * Browser-side durable session helpers for Impeccable live mode.
 *
 * Kept separate from live-browser.js so recovery state can be tested without
 * booting the full overlay UI. Served before live-browser.js and attached to
 * window.__IMPECCABLE_LIVE_SESSION__.
 */
(function (root) {
  'use strict';

  // crypto.randomUUID() exists only in secure contexts (HTTPS, localhost), so a
  // dev site on a LAN IP, a Tailscale address, or a custom hostname over plain
  // HTTP has no randomUUID at all (issue #1055). getRandomValues() is available
  // in every context; Math.random() covers runtimes with no crypto. Live ids
  // only have to be unique per session, not unguessable.
  function randomUUID(cryptoImpl) {
    const c = cryptoImpl === undefined ? root.crypto : cryptoImpl;
    try {
      if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    } catch { /* fall through to getRandomValues */ }
    const bytes = new Uint8Array(16);
    let filled = false;
    try {
      if (c && typeof c.getRandomValues === 'function') {
        c.getRandomValues(bytes);
        filled = true;
      }
    } catch { /* fall through to Math.random */ }
    if (!filled) {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16)
      + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function randomId8(cryptoImpl) {
    return randomUUID(cryptoImpl).replace(/-/g, '').slice(0, 8);
  }

  function createLiveBrowserSessionState({ prefix, storage, idFactory }) {
    if (!prefix) throw new Error('prefix required');
    let store = storage;
    if (!store) {
      try { store = root.localStorage; } catch { store = null; /* storage denied */ }
    }
    const makeId = idFactory || function () { return randomId8(); };
    const sessionKey = prefix + '-session';
    const handledKey = sessionKey + '-handled';
    const scrollKey = sessionKey + '-scroll';
    let checkpointRevision = 0;
    const owner = makeId();

    function safeRead(key) {
      try { return store.getItem(key); } catch { return null; }
    }

    function safeWrite(key, value) {
      try { store.setItem(key, value); } catch { /* quota exceeded or private mode */ }
    }

    function safeRemove(key) {
      try { store.removeItem(key); } catch { /* unavailable storage */ }
    }

    function loadSession() {
      try {
        const raw = safeRead(sessionKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Number.isInteger(parsed.checkpointRevision)) {
          checkpointRevision = Math.max(checkpointRevision, parsed.checkpointRevision);
        }
        return parsed;
      } catch { return null; }
    }

    function saveSession(session) {
      if (!session || !session.id) return;
      // Adopt a revision another tab stored so this write does not lower it.
      // localStorage has no compare-and-set, so a save from another tab that
      // lands between this read and the write below can still be overwritten.
      loadSession();
      const payload = {
        ...session,
        checkpointRevision,
      };
      safeWrite(sessionKey, JSON.stringify(payload));
    }

    function clearSession() {
      safeRemove(sessionKey);
    }

    function nextCheckpointRevision() {
      const existing = loadSession();
      checkpointRevision += 1;
      if (existing?.id) saveSession(existing);
      return checkpointRevision;
    }

    function seedCheckpointRevision(value) {
      if (Number.isInteger(value)) checkpointRevision = Math.max(checkpointRevision, value);
      return checkpointRevision;
    }

    function currentCheckpointRevision() {
      return checkpointRevision;
    }

    function readHandledIds() {
      const raw = safeRead(handledKey);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter(id => typeof id === 'string' && id);
        }
        if (typeof parsed === 'string' && parsed) return [parsed];
      } catch { /* legacy values were stored as a plain session id */ }
      return [raw];
    }

    function markHandled(id) {
      if (!id) return;
      const ids = readHandledIds().filter(existing => existing !== id);
      ids.push(id);
      safeWrite(handledKey, JSON.stringify(ids.slice(-8)));
    }

    function isHandled(id) {
      return !!id && readHandledIds().includes(id);
    }

    function clearHandled(id) {
      if (!id) {
        safeRemove(handledKey);
        return;
      }
      const remaining = readHandledIds().filter(existing => existing !== id);
      if (remaining.length > 0) safeWrite(handledKey, JSON.stringify(remaining));
      else safeRemove(handledKey);
    }

    function writeScrollY(y) {
      safeWrite(scrollKey, String(y));
    }

    function readScrollY() {
      const raw = safeRead(scrollKey);
      if (raw == null) return null;
      const n = parseFloat(raw);
      return isFinite(n) ? n : null;
    }

    function clearScrollY() {
      safeRemove(scrollKey);
    }

    return {
      owner,
      sessionKey,
      handledKey,
      scrollKey,
      saveSession,
      loadSession,
      clearSession,
      nextCheckpointRevision,
      seedCheckpointRevision,
      currentCheckpointRevision,
      markHandled,
      isHandled,
      clearHandled,
      writeScrollY,
      readScrollY,
      clearScrollY,
    };
  }

  root.__IMPECCABLE_LIVE_SESSION__ = { createLiveBrowserSessionState, randomUUID, randomId8 };
})(typeof window !== 'undefined' ? window : globalThis);
