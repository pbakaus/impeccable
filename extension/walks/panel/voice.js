// Talk to type: the browser's speech recognition writes what the person says into the ask box, the way Impeccable
// live's voice steering does (skill/scripts/live-browser.js `startVoice`), with one difference: nothing is sent when
// the person stops talking. The words stay in the box to edit, and Send sends them.
//
// A side panel can't show Chrome's microphone prompt: until the extension has the microphone, recognition here fails
// at once with `not-allowed`. The ask comes from a page of its own in a tab (../mic/mic.html), once.

/** The browser's speech recognition, or null where there is none (then the panel shows no mic). */
export const speechCtor = (scope = globalThis) => scope.SpeechRecognition || scope.webkitSpeechRecognition || null;

/** Errors that end listening with nothing to say: silence, or the person stopping it. */
const QUIET = new Set(['no-speech', 'aborted']);

/**
 * Listens once, until the person stops talking or `stop()` is called. `onText` gets the box's text with each interim
 * and final transcript after `base`; `onEnd` gets, once, null or the reason it failed (`not-allowed`, `network`, …).
 * Returns `stop`, which keeps what was heard, and `drop`, which ends it at once and calls nothing back.
 */
export function listen(Ctor, { base = '', lang = 'en-US', onStart = () => {}, onText, onEnd }) {
  const lead = base.trim() ? `${base.trim()} ` : '';
  const rec = new Ctor();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = lang;
  rec.maxAlternatives = 1;
  let over = false;
  const finish = (error) => {
    if (over) return;
    over = true;
    rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
    onEnd(error && !QUIET.has(error) ? error : null);
  };
  rec.onstart = () => onStart();
  rec.onresult = (event) => {
    let said = '';
    for (let i = 0; i < event.results.length; i++) said += event.results[i][0]?.transcript || '';
    onText((lead + said).trim());
  };
  rec.onerror = (event) => finish(event.error || 'failed');
  rec.onend = () => finish(null);
  try { rec.start(); } catch { finish('failed'); }
  return {
    stop: () => { try { rec.stop(); } catch { finish(null); } },
    drop: () => { over = true; rec.onstart = rec.onresult = rec.onerror = rec.onend = null; try { rec.abort(); } catch { /* already ended */ } },
  };
}
