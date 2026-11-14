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
/** Words that stop coming mid-talk: Google's service can go quiet on a session without ending it. Then start anew. */
const STALL_MS = 8000;

/**
 * Listens until `stop()` is called, through pauses: when Chrome ends a session on its own, a new one starts and its
 * words follow the ones already in the box. `onText` gets the box's text with each interim and final transcript after
 * `base`; `onEnd` gets, once, null or the reason it failed (`not-allowed`, `network`, …), also after a long silence.
 * `onText` also says whether those words are final. Returns `stop`, which keeps what was heard, `drop`, which ends it
 * at once and calls nothing back, and `retype`, for words the person typed while listening.
 */
export function listen(Ctor, { base = '', lang = 'en-US', stallMs = STALL_MS, onStart = () => {}, onText, onEnd }) {
  // What earlier sessions heard stays; each session's words go after it.
  let kept = base.trim();
  let rec = null;
  let over = false;
  let stopping = false;
  let empty = 0;
  let timer = null;
  let late = null;
  // Words typed while listening: the box's text becomes what is kept, and only words heard after it follow.
  let retype = () => {};
  const quiet = (r) => { clearTimeout(timer); if (r) r.onstart = r.onresult = r.onerror = r.onend = null; };
  const finish = (error) => {
    if (over) return;
    over = true;
    clearTimeout(late);
    quiet(rec);
    onEnd(error && !QUIET.has(error) ? error : null);
  };
  const session = () => {
    let now;
    try { now = new Ctor(); } catch { finish('failed'); return; }
    rec = now;
    now.continuous = true;
    now.interimResults = true;
    now.lang = lang;
    now.maxAlternatives = 1;
    let said = '';
    let from = 0;
    let seen = 0;
    retype = (text) => { kept = text.trim(); said = ''; from = seen; };
    let failed = null;
    let stalled = false;
    now.onstart = () => onStart();
    now.onresult = (event) => {
      said = '';
      let settled = true;
      seen = event.results.length;
      for (let i = from; i < seen; i++) { said += event.results[i][0]?.transcript || ''; settled &&= event.results[i].isFinal === true; }
      said = said.trim();
      onText(`${kept} ${said}`.trim(), settled);
      // Once words come, more should follow: none for a while ends this session, and the next one listens.
      clearTimeout(timer);
      timer = setTimeout(() => { stalled = true; try { now.stop(); } catch { /* ended */ } timer = setTimeout(() => { try { now.abort(); } catch { /* ended */ } }, 1500); }, stallMs);
    };
    now.onerror = (event) => { failed = event.error || 'failed'; };
    now.onend = () => {
      quiet(now);
      // The last words shown stay, interim or not: Chrome can end a session before it marks them final.
      if (said) kept = `${kept} ${said}`.trim();
      empty = said ? 0 : empty + 1;
      if (stalled) failed = null;
      if (stopping || (failed && !AGAIN.has(failed)) || empty >= EMPTY) { finish(failed); return; }
      session();
    };
    try { now.start(); } catch { finish('failed'); }
  };
  session();
  return {
    stop: () => {
      stopping = true;
      try { rec.stop(); } catch { finish(null); }
      // A stop Chrome never answers must still free the mic button.
      late = setTimeout(() => { quiet(rec); try { rec.abort(); } catch { /* ended */ } finish(null); }, 2000);
    },
    retype: (text) => { if (!over) retype(text); },
    drop: () => { over = true; quiet(rec); try { rec.abort(); } catch { /* already ended */ } },
  };
}
