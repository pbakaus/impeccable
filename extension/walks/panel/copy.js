// Every word a person reads from journeys, in one place: the side panel and the badge on the journey's tab. The
// person sees a "workflow" and a "journey"; no internal name appears here.
//
// Voice: short and plain, a little human where nothing failed, never cute about a failure, said once.

const issues = (n) => (n === 1 ? '1 issue' : `${n} issues`);
const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };

export const COPY = {
  product: 'Impeccable',

  /** How a journey is started: the command as the web app publishes it. Change it there and here together. */
  command: 'npx @impeccable/reviews walk',

  /** No account to start from here (the store build): the terminal. */
  idle: { how: 'Start a journey from your terminal:' },
  copy: { action: 'Copy command', done: 'Copied' },

  /** Signed in, and the server says the account has no Impeccable Pro. */
  notPro: { line: 'This account doesn’t have Impeccable Pro.', getPro: 'Get Pro', other: 'Use another account' },
  /** Chrome's notice when an agent asks for a journey (account/waiting.js): who, where and what, in one line. */
  agent: {
    title: 'Your agent wants to start a journey',
    line: ({ persona, site, task }) => [`${persona || 'A persona'}${site ? ` on ${site}` : ''}`, task].filter(Boolean).join(': '),
    start: 'Start',
    later: 'Not now',
  },
  signedOut: { line: 'You’re signed out.', pro: 'Impeccable Pro', failed: 'Sign-in didn’t finish. Try again.', signingIn: 'Finish in the window Chrome opened.' },
  top: { walking: 'On', noSite: 'Open a web page to start a journey.', scan: 'Scan', back: 'Back' },
  /** The cog's popover: who is signed in, and Sign out. */
  account: { title: 'Account', signedIn: 'Signed in as', help: 'Having problems?', signOut: 'Sign out' },
  /** Your personas, from the cog: the person's own, each with Remove (asking `ask.title` first), and the six everyone has. */
  yours: {
    title: 'Your personas',
    remove: 'Remove',
    removeOne: (name) => `Remove ${name}`,
    default: 'Default',
    unremoved: (name) => `Couldn’t remove ${name}. Try again.`,
  },
  /** Just signed in: a moment, then the panel goes on. */
  connected: { line: 'You’re connected', who: 'Signed in as' },

  home: {
    ask: (name) => `What should ${name} try?`,
    who: 'Personas',
    send: 'Start',
    failed: 'Couldn’t load your personas.',
    retry: 'Try again',
    signIn: 'Sign in again',
    make: 'Create a persona',
    /** The width a journey runs at: the group, and each choice. */
    width: 'Screen',
    widths: { desktop: 'Desktop', tablet: 'Tablet', phone: 'Phone' },
    /** How the persona sees the page on this journey (../sight.js): the group, each choice, and what it means (the plan's line). */
    sight: 'Sees',
    sights: { normal: 'Normal eyes', older: 'Blurry, low-contrast vision', 'colour-blind': 'Colour-blind' },
    sees: { normal: 'Normal eyes: the page as it is', older: 'Blurry, low-contrast vision', 'colour-blind': 'Colour-blind: red and green look alike' },
    /**
     * Under each choice's name on hover: how common it is (panel.js `COMMON`). `share` reads "About 5 in 10"; `who` is
     * the persona's name when its card gives an age, else nothing and the figure is a general one. Colour-blind takes
     * `men` and `women`, each as 1 in so many.
     */
    common: {
      normal: (share, who) => `${share} ${who ? `people in the US ${who}’s age` : 'adults in the US'} wear glasses or contacts.`,
      older: (share, who) => `${share} ${who ? `people in the US ${who}’s age` : 'people in the US over 40'} have a cataract.`,
      'colour-blind': (men, women) => `About 1 in ${men} men and 1 in ${women} women of Northern European descent have red-green colour blindness.`,
    },
    share: { about: (n, of) => `About ${n} in ${of}`, fewer: (of) => `Fewer than 1 in ${of}` },
  },
  /** Create a persona's intro: these lines play above the box, one after another, and it stays on the last. */
  intro: ['Imagine you’re the persona.', 'How do you use the web each day?', 'What drives you mad in apps?', 'And what makes you smile?', 'Now tell us who you are.'],
  /** Make a persona: one description makes one (account/worker.js `create`). A refusal keys on the worker's reason. */
  make: {
    describe: 'Who are you, and what do you love or hate in apps?',
    action: 'Create',
    /** The persona's own device (`home.widths` names each), and one disability: each choice and its line. */
    device: 'Preferred device',
    disability: 'Disability',
    disabilities: {
      none: ['None', ''],
      'low-vision': ['Low vision', 'blurry, low contrast'],
      blind: ['Blind', 'uses a screen reader'],
      'colour-blind': ['Colour-blind', 'red and green look alike'],
    },
    /** On the + once the person has as many of their own as the server allows. */
    full: (max) => `You can make up to ${max || 3} personas for now`,
    making: 'Making your persona…',
    confirm: 'Confirm',
    /** Personas an app already has, instead of a new one: a modal. */
    fromApp: 'Use a persona from your app',
    pickApp: 'Pick an app',
    useThese: 'Use these personas',
    cancel: 'Cancel',
    close: 'Close',
    appNone: 'That app has no personas yet.',
    appFailed: 'Couldn’t load that app’s personas.',
    short: 'Say a bit more about them.',
    scope: 'Sign out and in again to make personas.',
    limit: (max) => `You can make up to ${max || 3} of your own.`,
    later: 'Couldn’t make it right now. Try again later.',
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
    full: 'That’s all the box holds. Edit it, then go on.',
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
    'too-many': 'That’s a lot of journeys for now. Try again later.',
    'no-plan': 'Couldn’t make a plan. Try again.',
    failed: 'Couldn’t do that. Try again.',
  },
  plan: {
    reading: (name) => `${name} is reading the task…`,
    title: (name) => `${name}’s plan`,
    risky: 'Some steps can’t be undone. Go ahead?',
    edit: 'Edit the task',
    start: 'Start journey',
    at: { tablet: 'At tablet width, 820 × 1180', phone: 'At phone width, 390 × 844' },
    /** The width picked, when the server could not be asked whether it takes one: the walk runs as the tab is. */
    atDesktop: 'At desktop width. Couldn’t check that your server takes another.',
  },

  walking: {
    line: (name) => `${name || 'Your persona'} is on the way`,
    first: (name) => `${name || 'Your persona'} is taking a first look.`,
  },
  /** `signedIn`: Continue at a sign-in pause. */
  controls: { resume: 'Continue', signedIn: 'I’ve signed in', handback: 'Hand back', stop: 'Stop' },

  paused: { line: (name) => `Paused. ${name || 'Your persona'} waits right here.` },
  /**
   * A journey that paused itself at a sign-in: the side panel says it, and so does the toolbar icon's hover text, which
   * Chrome draws and no page can fake. Exactly three facts: sign in yourself, then press I’ve signed in; we do not
   * look while it is paused; no screenshots are taken while it is paused.
   */
  signIn: 'Sign in yourself, then press I’ve signed in. While it’s paused, we don’t look at the page and take no screenshots.',
  /** The same, once the sign-in page was pictured, every field blank, as the walk paused (control.js `stillAtSignIn`): that one picture said first. */
  signInPictured: 'We kept one picture of the sign-in page, every field blank. Sign in yourself, then press I’ve signed in. While you do, we don’t look or take pictures.',
  /** At that sign-in, once the tab sent something the pause held back: a sign-in with no press or key in the tab (a passkey, a phone, another site's frame). */
  signInHeld: 'Signing in another way? Press Stop, sign in, then start the journey again.',
  /** Continue or Hand back refused (control.js `attempt`), by why; `go` is the button's own name. */
  refused: {
    'sign-in': (go) => `Still on the sign-in page. Finish signing in, then press ${go}.`,
    script: (go) => `Couldn’t switch off our page scripts yet. Press ${go} to try again.`,
    tab: (go) => `Something else has hold of that tab. Close it, then press ${go} again.`,
    closed: () => 'That tab closed. Press Stop to end the journey.',
  },
  /** Before a deed the server marked (delete, pay, send), or before another site, on a journey with no plan: nothing is done until Yes. */
  ask: {
    title: 'Are you sure?',
    go: (name, host) => `Let ${name || 'your persona'} go to ${host}?`,
    yes: 'Yes',
    no: 'No',
    /** The person's own agent asks for a site (agent.js). */
    site: (name, host) => `Let ${name || 'your agent'} use ${host}?`,
    once: 'Allow once',
    always: 'Always allow',
    notNow: 'Not now',
  },
  /** The person's own agent driving their browser (agent.js): its line, and each step in the live log. */
  yourAgent: {
    line: (name) => `${name || 'Your agent'} is using your browser`,
    wants: (name) => `${name || 'Your agent'} wants to use your browser`,
    /** Chrome's notice while a site question waits: the panel is where it's answered. */
    notice: (name, host) => `Let ${name || 'your agent'} use ${host}?`,
    noticeHow: 'Open the Impeccable side panel to answer.',
    first: (name) => `${name || 'Your agent'} is looking at the page.`,
    opened: (where) => `Opened ${where}`,
    back: 'Went back',
    viewport: (width, height) => `Set the page to ${width} × ${height}`,
    clicked: (what) => `Clicked “${what}”`,
    clickedAt: (x, y) => `Clicked at ${x}, ${y}`,
    typed: (what, into) => `Typed “${what}”${into ? ` into “${into}”` : ''}`,
    pressed: (key) => `Pressed ${key}`,
    scrolled: 'Scrolled',
  },
  takeover: { line: (name) => `Your turn. ${name || 'Your persona'} picks up where you leave off.` },

  end: {
    done: (name) => `${name || 'Your persona'}’s done.`,
    // The web's outcome words (src/app-rpc/walk-outcome.ts), REN-2331.
    through: (name) => `${name || 'Your persona'} got through.`,
    friction: (name) => `${name || 'Your persona'} got through, with friction.`,
    partway: (name) => `${name || 'Your persona'} got partway.`,
    stopped: (name) => `You stopped ${name || 'the journey'}.`,
    failed: 'The journey ended.',
    found: (name, n) => `${name || 'Your persona'} found ${issues(n)}`,
    beforeStop: 'before you stopped the journey',
    saidNo: (name, n) => `You said No at step ${n}, so ${name || 'your persona'} didn’t get it done.`,
    home: 'Done',
    see: (name) => `See ${name ? `${name}’s` : 'the'} journey`,
  },

  /** Every journey started from the extension, newest first: the button beside the cog, and the screen it opens. */
  history: {
    open: 'History',
    title: 'Your journeys',
    none: 'No journeys yet. Yours will show up here.',
    failed: 'Couldn’t load your journeys.',
    /** How a journey ended, as its end screen says it. */
    ended: {
      issues: (name, n) => `${name} found ${issues(n)}`,
      done: (name) => `${name}’s done`,
      stopped: (name) => `You stopped ${name}`,
      failed: (name) => `${name} didn’t finish`,
      running: (name) => `${name} is on the way`,
    },
    when: (at, now = Date.now()) => {
      const minutes = Math.floor((now - at) / 60_000);
      if (minutes < 1) return 'Just now';
      if (minutes < 60) return `${minutes} min ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours} h ago`;
      const days = Math.floor(hours / 24);
      if (days === 1) return 'Yesterday';
      if (days < 7) return `${days} days ago`;
      return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    },
  },

  failed: {
    'tab-closed': 'The tab was closed.',
    connection: 'The connection dropped.',
    'switched-off': 'Journeys were switched off, so this one stopped.',
    'left-site': (site) => `The page left ${hostOf(site) || 'the allowed address'}.`,
    unanswered: (site, name) => `${name || 'Your persona'} waited for your answer and stopped.`,
  },

  badge: {
    here: (name) => `${name || 'Your persona'} is here`,
    paused: (name) => `${name || 'Your persona'} is paused`,
    yours: 'Your turn',
    step: (n) => (n > 0 ? `Step ${n}` : 'Starting'),
    stop: 'Stop',
  },

  tabGroup: (name) => `Impeccable · ${name}`,

  /** The corner of every picture on a journey whose persona sees differently (../sight.js). */
  seenAs: { older: 'As seen with blurry, low-contrast vision', 'colour-blind': 'As seen with colour blindness' },

  /** The first time the panel is signed in: two screens, then the home. `points`: [icon, the fact, the fine print, a link after it: [words, url]]. */
  firstRun: {
    before: {
      title: 'Before you start',
      points: [
        ['cursor', 'It acts in your browser, signed in as you.', 'What it clicks and types counts as you.'],
        ['camera', 'It records the pages it visits.', 'Screenshots, video and steps go to Impeccable and its AI provider, and are kept for the replay. Keep it off private sites, like banking or health.', ['Privacy policy', 'https://impeccable.style/privacy']],
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
      next: 'Let’s go',
    },
  },
};
