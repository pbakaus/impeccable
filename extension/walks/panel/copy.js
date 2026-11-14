// Every word a person reads from journeys, in one place: the side panel and the badge on the journey's tab. The
// person sees a "workflow" and a "journey"; no internal name appears here.
//
// Voice: short and plain, a little human where nothing failed, never cute about a failure, said once.

const issues = (n) => (n === 1 ? '1 issue' : `${n} issues`);
const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };

export const COPY = {
  product: 'Impeccable',

  /** The server takes no sign-in, or is out of reach: where a journey still starts, and one more try. */
  idle: { line: 'No journey running.', how: 'Sign-in isn’t available yet. You can still start a journey from the Impeccable web app.', retry: 'Try again' },

  /** Signed in, and the server says the account has no Impeccable Pro. */
  notPro: { line: 'This account doesn’t have Impeccable Pro.' },
  signedOut: { line: 'You’re signed out.', pro: 'Impeccable Pro', failed: 'Sign-in didn’t finish. Try again.' },
  top: { walking: 'On', noSite: 'Open a web page to start a journey.', scan: 'Scan', settings: 'Settings', back: 'Back' },

  home: {
    ask: (name) => `What should ${name} try?`,
    who: 'Personas',
    send: 'Send',
    none: 'No personas yet.',
    failed: 'Couldn’t load your personas.',
    retry: 'Try again',
    signIn: 'Sign in again',
  },
  /** Talk to type: the mic in the ask box. A failure keys on the browser's error code; typing always still works. */
  voice: {
    talk: 'Talk to type',
    stop: 'Stop listening',
    listening: 'Listening…',
    'not-allowed': 'The microphone is blocked. You can still type.',
    'audio-capture': 'No microphone found. You can still type.',
    network: 'Talking needs an internet connection. You can still type.',
    failed: 'Couldn’t hear that. Try again, or type.',
  },
  /** The page that asks for the microphone, once, in a tab of its own (walks/mic). */
  mic: {
    title: 'Talk to type',
    asking: 'Chrome is asking for your microphone.',
    why: 'It’s used only while the mic in the side panel is on. Chrome turns your voice into text with Google’s speech service; Impeccable never gets the audio.',
    on: 'Microphone on. Talk in the side panel.',
    blocked: 'The microphone is blocked. You can still type.',
    how: 'To talk later, allow the microphone for Impeccable in Chrome’s settings.',
    settings: 'Open settings',
    dismissed: 'Chrome didn’t get an answer.',
    again: 'Ask again',
    none: 'No microphone found. You can still type.',
  },
  why: {
    tab: 'A journey can’t start on this tab. Open a web page first.',
    unavailable: 'Journeys from the extension aren’t available yet.',
    scope: 'Sign in again to start journeys.',
    'not-pro': 'This account doesn’t have Impeccable Pro.',
    plan: 'That plan ran out. Send the task again.',
    'too-many': 'That’s a lot of plans this hour. Try again later.',
    'no-plan': 'Couldn’t make a plan. Try again.',
    failed: 'Couldn’t do that. Try again.',
  },
  plan: {
    reading: (name) => `${name} is reading the task…`,
    title: (name) => `${name}’s plan`,
    risky: 'Some steps can’t be undone. Go ahead?',
    edit: 'Edit the task',
    start: 'Start journey',
  },

  walking: {
    line: (name) => `${name || 'Your persona'} is on the way`,
    first: (name) => `${name || 'Your persona'} is taking a first look.`,
  },
  controls: { resume: 'Continue', handback: 'Hand back', stop: 'Stop' },

  paused: { line: (name) => `Paused. ${name || 'Your persona'} waits right here.` },
  /**
   * A journey that paused itself at a sign-in: the side panel says it, and so does the toolbar icon's hover text, which
   * Chrome draws and no page can fake. Exactly three facts: sign in yourself, then continue; we do not look while it
   * is paused; no screenshots are taken while it is paused.
   */
  signIn: 'Sign in yourself, then press Continue. While it’s paused, we don’t look at the page and take no screenshots.',
  /** Before a deed the server marked (delete, pay, send), or before another site, on a journey with no plan: nothing is done until Yes. */
  ask: {
    title: 'Are you sure?',
    go: (name, host) => `Let ${name || 'your persona'} go to ${host}?`,
    yes: 'Yes',
    no: 'No',
  },
  takeover: { line: (name) => `Your turn. ${name || 'Your persona'} picks up where you leave off.` },

  end: {
    done: (name) => `${name || 'Your persona'}’s done.`,
    stopped: (name) => `You stopped ${name || 'the journey'}.`,
    failed: 'The journey ended.',
    found: (name, n) => `${name || 'Your persona'} found ${issues(n)}`,
    beforeStop: 'before you stopped the journey',
    saidNo: (name, n) => `You said No at step ${n}, so ${name || 'your persona'} didn’t get it done.`,
    home: 'Done',
    see: (name) => `See ${name ? `${name}’s` : 'the'} journey`,
  },

  failed: {
    'tab-closed': 'The tab was closed.',
    connection: 'The connection dropped.',
    'switched-off': 'Journeys were switched off, so this one stopped.',
    'left-site': (site) => `The page left ${hostOf(site) || 'the allowed address'}.`,
  },

  badge: {
    here: (name) => `${name || 'Your persona'} is here`,
    paused: (name) => `${name || 'Your persona'} is paused`,
    yours: 'Your turn',
    step: (n) => (n > 0 ? `Step ${n}` : 'Starting'),
    stop: 'Stop',
  },

  tabGroup: (name) => `Impeccable · ${name}`,

  /** The first time the panel is signed in: two screens, then the home. `points`: [icon, the fact, the fine print]. */
  firstRun: {
    before: {
      title: 'Before you start',
      points: [
        ['cursor', 'It acts in your browser, signed in as you.', 'What it clicks and types counts as you.'],
        ['camera', 'It records the pages it visits.', 'Screenshots, video and steps go to Impeccable and its AI provider, and are kept for the replay. Keep it off private sites, like banking or health.'],
        ['warn', 'Pages can hide instructions.', 'Text you can’t see can try to steer it somewhere you didn’t ask.'],
        ['shield', 'You approve the plan first.', 'Steps that can’t be undone are marked !. Anything risky that isn’t on the plan is skipped.'],
      ],
      next: 'Got it',
    },
    tabGroup: {
      title: 'Journeys get their own tab group',
      line: 'Each journey opens in its own tab group, named after the persona. They see the pages in that group, and none of your other tabs.',
      /** The picture's two tabs, and its persona while none is loaded. */
      site: 'Tidy',
      other: 'Your email',
      example: 'Mira',
      next: 'Start a journey',
    },
  },
};
