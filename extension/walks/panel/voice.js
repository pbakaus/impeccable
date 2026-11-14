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
/** Errors after which a new session starts: silence, and a dropped connection to Google's speech service. */
const AGAIN = new Set(['no-speech', 'network']);
/** Chrome ends a session on its own after a pause or about a minute; after this many in a row with no words, stop. */
const EMPTY = 2;

/**
 * Listens until `stop()` is called, through pauses: when Chrome ends a session on its own, a new one starts and its
 * words follow the ones already in the box. `onText` gets the box's text with each interim and final transcript after
 * `base`; `onEnd` gets, once, null or the reason it failed (`not-allowed`, `network`, …), also after a long silence.
 * Returns `stop`, which keeps what was heard, and `drop`, which ends it at once and calls nothing back.
 */
export function listen(Ctor, { base = '', lang = 'en-US', onStart = () => {}, onText, onEnd }) {
  // What earlier sessions heard stays; each session's words go after it.
  let kept = base.trim();
  let rec = null;
  let over = false;
  let stopping = false;
  let empty = 0;
  const quiet = (r) => { if (r) r.onstart = r.onresult = r.onerror = r.onend = null; };
  const finish = (error) => {
    if (over) return;
    over = true;
    quiet(rec);
    onEnd(error && !QUIET.has(error) ? error : null);
  };
  const session = () => {
    const now = new Ctor();
    rec = now;
    now.continuous = true;
    now.interimResults = true;
    now.lang = lang;
    now.maxAlternatives = 1;
    let said = '';
    let failed = null;
    now.onstart = () => onStart();
    now.onresult = (event) => {
      said = '';
      for (let i = 0; i < event.results.length; i++) said += event.results[i][0]?.transcript || '';
      said = said.trim();
      onText(`${kept} ${said}`.trim());
    };
    now.onerror = (event) => { failed = event.error || 'failed'; };
    now.onend = () => {
      quiet(now);
      // The last words shown stay, interim or not: Chrome can end a session before it marks them final.
      if (said) kept = `${kept} ${said}`.trim();
      empty = said ? 0 : empty + 1;
      if (stopping || (failed && !AGAIN.has(failed)) || empty >= EMPTY) { finish(failed); return; }
      session();
    };
    try { now.start(); } catch { finish('failed'); }
  };
  session();
  return {
    stop: () => { stopping = true; try { rec.stop(); } catch { finish(null); } },
    drop: () => { over = true; quiet(rec); try { rec.abort(); } catch { /* already ended */ } },
  };
}
