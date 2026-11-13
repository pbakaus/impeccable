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

  /** No walk running. With an account, it points at the popup's Personas, or signs in first. */
  idle: {
    line: 'No walk running.',
    how: 'Start one from your terminal:',
    also: 'Or start one from your terminal:',
    personas: 'Pick a persona from the Impeccable icon, then press Walk this tab.',
    open: 'Open personas',
    signIn: 'Sign in to walk a tab with a persona.',
    signInAction: 'Sign in',
    signInFailed: 'Sign-in didn’t finish. Try again.',
  },
  /** Once, on the first walk ever. */
  intro: {
    line: (name) => `${name || 'Your walker'} clicks, scrolls and types on your site, like a visitor.`,
    more: 'Pause, take over or stop it any time, right here.',
    ok: 'Got it',
  },
  copy: { action: 'Copy command', done: 'Copied' },

  waiting: { line: (name) => `${name || 'Your walker'} is on the way.` },

  who: {
    visit: { new: 'New here', returning: 'Has been here before' },
    device: { desktop: 'Desktop', mobile: 'Phone', tablet: 'Tablet' },
  },

  walking: {
    steps: 'Steps',
    follow: 'Follow along',
    checks: 'Done when',
    progress: (met, all) => `${met} of ${all} done`,
    first: (name) => `${name || 'Your walker'} is taking a first look.`,
    issue: 'Issue',
    now: 'Now',
    earlier: (n) => (n === 1 ? '1 earlier step' : `${n} earlier steps`),
    all: (n) => (n === 1 ? 'The 1 step so far' : `All ${n} steps so far`),
  },

  controls: { pause: 'Pause', resume: 'Continue', takeover: 'Take over', handback: 'Hand back', stop: 'Stop' },
  /** The same three, as one switch: who is driving the tab. */
  drive: { walker: (name) => `${name || 'Walker'} drives`, paused: 'Paused', you: 'You drive' },

  paused: { line: (name) => `Paused. ${name || 'Your walker'} waits right here.` },
  /**
   * A walk that paused itself at a sign-in: the side panel says it, and so does the toolbar icon's hover text, which
   * Chrome draws and no page can fake. Exactly three facts: sign in yourself, then continue; we do not look while it
   * is paused; no screenshots are taken while it is paused.
   */
  signIn: 'Sign in yourself, then press Continue. While it’s paused, we don’t look at the page and take no screenshots.',
  /** Before a deed the server marked (delete, pay, send), or before another site: nothing is done until Yes. */
  ask: {
    title: 'Are you sure?',
    go: (name, host) => `Let ${name || 'your walker'} go to ${host}?`,
    yes: 'Yes',
    no: 'No',
  },
  takeover: { line: (name) => `Your turn. ${name || 'Your walker'} picks up where you leave off.` },

  done: {
    clean: (name) => `${name || 'Your walker'} finished. No issues.`,
    issues: (name, n) => `${name || 'Your walker'} finished and found ${issues(n)}.`,
    unfinished: (name, n) => (n > 0 ? `${name || 'Your walker'} could not finish, and found ${issues(n)}.` : `${name || 'Your walker'} could not finish.`),
    /** The person said No at step `n`: the walk's page says it in these words. */
    saidNo: (name, n) => `You said No at step ${n}, so ${name || 'your walker'} didn’t get it done.`,
    plain: 'This walk is over.',
    again: 'Watch it again',
    step: (n) => `Step ${n}`,
  },

  stopped: { line: 'You stopped this walk.', how: 'Start another from your terminal:' },

  failed: {
    'tab-closed': 'The tab was closed, so the walk ended.',
    connection: 'The connection dropped, so the walk ended.',
    'switched-off': 'Walks were switched off, so this one stopped.',
    'left-site': (site) => `The page left ${hostOf(site) || 'the allowed address'}, so the walk ended.`,
    how: 'Start it again from your terminal:',
  },

  /** What the guard stopped, told in the feed where it happened. */
  kept: {
    navigation: (url) => (hostOf(url) ? `Kept on this site: ${hostOf(url)} was not opened.` : 'Kept on this site.'),
    popup: () => 'A new tab was closed.',
    download: () => 'A download was refused.',
    'file-picker': () => 'A file picker stayed shut.',
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
