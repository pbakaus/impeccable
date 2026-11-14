// The check-in (REN-1909): while signed in with Impeccable Pro, once a minute (a Chrome alarm, which outlives the
// worker) and once when the worker starts, the server is asked which journeys an agent asked for. The asking is the
// check-in: it is how the server knows Chrome is open. Each new journey is shown once, as a Chrome notice with Start
// and Not now. Start opens the journey's page, and only one of our app's outing pages (walks/handoff.js): the hand-off
// runs from there as it does for any journey. Not now tells the server, which tells the agent.
import { isOutingPage } from '../walks/handoff.js';
import { COPY } from '../walks/panel/copy.js';

export const ALARM = 'check-in';
const NOTICE = 'journey:';
/** The journeys shown, by id, with their pages (for a Start that lands on a worker started again): the last few. */
const SHOWN = 'agentJourneys';
const KEEP = 20;

export function checkIns({ session, chrome }) {
  let queue = Promise.resolve();
  /** Whether this worker has checked in: one woken by the alarm has, before its own start's check-in. */
  let ran = false;
  const shown = async () => (await chrome.storage.session.get(SHOWN).catch(() => ({})))[SHOWN] ?? {};

  async function once() {
    const journeys = await session.waiting().catch(() => null);
    if (!journeys) return;
    const was = await shown();
    const fresh = journeys.filter((journey) => !Object.hasOwn(was, journey.id) && isOutingPage(journey.page));
    if (!fresh.length) return;
    // Kept before the notice: a worker ended between the two never shows it a second time.
    await chrome.storage.session.set({ [SHOWN]: Object.fromEntries([...Object.entries(was), ...fresh.map((journey) => [journey.id, journey.page])].slice(-KEEP)) });
    for (const journey of fresh) {
      await chrome.notifications.create(`${NOTICE}${journey.id}`, {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon-128.png'), requireInteraction: true,
        title: COPY.agent.title, message: COPY.agent.line(journey), buttons: [{ title: COPY.agent.start }, { title: COPY.agent.later }],
      }).catch(() => undefined);
    }
  }

  return {
    /** Checks in now, one check-in at a time; for the worker's `start`, only if nothing has yet. */
    checkIn({ start = false } = {}) {
      if (start && ran) return queue;
      ran = true;
      queue = queue.then(once).catch(() => undefined);
      return queue;
    },

    /** Keeps the alarm while `on` (signed in, and Pro as the server last said), and drops it otherwise. */
    async keep(on) {
      if (!on) { await chrome.alarms.clear(ALARM); return; }
      // Only when missing: making it again would put the next check-in off by a minute every time the worker starts.
      if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
    },

    /** A press on a notice of ours: `button` 0 (or the notice itself) is Start, 1 is Not now. */
    async pressed(notice, button = 0) {
      if (typeof notice !== 'string' || !notice.startsWith(NOTICE)) return;
      const id = notice.slice(NOTICE.length);
      await chrome.notifications.clear(notice).catch(() => undefined);
      if (button === 1) { await session.decline(id); return; }
      const page = (await shown())[id];
      if (typeof page === 'string' && isOutingPage(page)) await chrome.tabs.create({ url: page, active: true });
    },
  };
}
