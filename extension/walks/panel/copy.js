// Every word a person reads from walks, in one place: the side panel and the badge on the walked tab. The person
// sees a "workflow" and a "walk"; no internal name appears here.
//
// Voice: short and plain, a little human where nothing failed, never cute about a failure, said once.

const issues = (n) => (n === 1 ? '1 issue' : `${n} issues`);
const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };

export const COPY = {
  product: 'Impeccable',

  /** How a walk is started: the command as the web app publishes it. Change it there and here together. */
  command: 'npx @impeccable/reviews walk',

  /** No account to start from here (the store build): the terminal. */
  idle: { line: 'No walk running.', how: 'Start one from your terminal:' },
  copy: { action: 'Copy command', done: 'Copied' },

  signedOut: { line: 'You’re signed out.', pro: 'Impeccable Pro', failed: 'Sign-in didn’t finish. Try again.' },
  top: { walking: 'Walking', noSite: 'Open a web page to walk it.' },

  home: {
    ask: (name) => `What should ${name} try?`,
    who: 'Personas',
    send: 'Send',
    mic: 'Talk to type (coming in V2)',
    none: 'No personas yet.',
    failed: 'Couldn’t load your personas.',
  },
  why: {
    tab: 'This tab can’t be walked. Open a web page first.',
    unavailable: 'Walks from the extension aren’t available yet.',
    scope: 'Sign in again to start walks.',
    plan: 'That plan ran out. Send the task again.',
    failed: 'Couldn’t do that. Try again.',
  },
  plan: {
    reading: (name) => `${name} is reading the task…`,
    title: (name) => `${name}’s plan`,
    risky: 'Some steps can’t be undone. Go ahead?',
    edit: 'Edit the task',
    start: 'Start walk',
  },

  walking: {
    line: (name) => `${name || 'Your walker'} is on the way`,
    first: (name) => `${name || 'Your walker'} is taking a first look.`,
  },
  controls: { resume: 'Continue', handback: 'Hand back', stop: 'Stop' },

  paused: { line: (name) => `Paused. ${name || 'Your walker'} waits right here.` },
  /**
   * A walk that paused itself at a sign-in: the side panel says it, and so does the toolbar icon's hover text, which
   * Chrome draws and no page can fake. Exactly three facts: sign in yourself, then continue; we do not look while it
   * is paused; no screenshots are taken while it is paused.
   */
  signIn: 'Sign in yourself, then press Continue. While it’s paused, we don’t look at the page and take no screenshots.',
  /** Before a deed the server marked (delete, pay, send), or before another site, on a walk with no plan: nothing is done until Yes. */
  ask: {
    title: 'Are you sure?',
    go: (name, host) => `Let ${name || 'your walker'} go to ${host}?`,
    yes: 'Yes',
    no: 'No',
  },
  takeover: { line: (name) => `Your turn. ${name || 'Your walker'} picks up where you leave off.` },

  end: {
    done: (name) => `${name || 'Your walker'}’s done.`,
    stopped: (name) => `You stopped ${name || 'the walk'}.`,
    failed: 'The walk ended.',
    found: (name, n) => `${name || 'Your walker'} found ${issues(n)}`,
    beforeStop: 'before you stopped the walk',
    saidNo: (name, n) => `You said No at step ${n}, so ${name || 'your walker'} didn’t get it done.`,
    see: (name) => `See ${name ? `${name}’s` : 'the'} walk`,
  },

  failed: {
    'tab-closed': 'The tab was closed.',
    connection: 'The connection dropped.',
    'switched-off': 'Walks were switched off, so this one stopped.',
    'left-site': (site) => `The page left ${hostOf(site) || 'the allowed address'}.`,
  },

  badge: {
    here: (name) => `${name || 'Your walker'} is here`,
    paused: (name) => `${name || 'Your walker'} is paused`,
    yours: 'Your turn',
    step: (n) => (n > 0 ? `Step ${n}` : 'Starting'),
    stop: 'Stop',
  },

  tabGroup: (name) => `Impeccable · ${name}`,
};
