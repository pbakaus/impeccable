// The check-in: while signed in with Impeccable Pro, every half minute (a Chrome alarm, which outlives the
// worker), once when the worker starts and once right after sign-in, the server is asked which journeys an agent asked
// for. The asking is the check-in: it is how the server knows Chrome is open. Each new journey is shown once, as a
// Chrome notice with Start and Not now. Start opens the journey's page, and only one of our app's outing pages
// (walks/handoff.js): the hand-off runs from there as it does for any journey. Not now tells the server, which tells
// the agent; so does a journey that can't be shown, so no agent is left waiting on a notice nobody saw.
import { isOutingPage } from '../walks/handoff.js';
import { COPY } from '../walks/panel/copy.js';

export const ALARM = 'check-in';
/** Chrome's shortest alarm: a journey waits only minutes for its browser. */
const PERIOD = 0.5;
const NOTICE = 'journey:';
/**
 * The journeys shown, for the server they came from: `{ server, journeys: { [id]: { page, decline? } } }`, the last
 * few. `page` is for a Start that lands on a worker started again; `decline` marks a Not now the server has yet to hear.
 */
const SHOWN = 'agentJourneys';
const KEEP = 20;

/** `issuer()` names the server in use; the shown list is that server's alone. */
export function checkIns({ session, chrome, issuer }) {
  let queue = Promise.resolve();
  let writes = Promise.resolve();
  /** Whether this worker has checked in: one woken by the alarm has, before its own start's check-in. */
  let ran = false;
  /** Moves on with every `forget`: a check-in still under way from before one shows and keeps nothing. */
  let generation = 0;
  const shown = async () => {
    const kept = (await chrome.storage.session.get(SHOWN).catch(() => ({})))[SHOWN];
    return kept?.server === issuer() && kept.journeys ? kept.journeys : {};
  };
  /** Changes the shown list one change at a time: `change` gets it and changes it in place. `live`: still worth doing. */
  const edit = (change, live = () => true) => {
    const done = writes.then(async () => {
      if (!live()) return undefined;
      const journeys = await shown();
      const result = change(journeys);
      const kept = Object.fromEntries(Object.entries(journeys).slice(-KEEP));
      await chrome.storage.session.set({ [SHOWN]: { server: issuer(), journeys: kept } });
      return result;
    });
    writes = done.catch(() => undefined);
    return done;
  };
  /** Tells the server No for `id`; until it hears, the next check-in asks again. */
  const decline = async (id) => {
    const { ok } = await session.decline(id).catch(() => ({ ok: false }));
    await edit((journeys) => { if (journeys[id]) journeys[id].decline = !ok; });
  };

  async function once() {
    // No notice to show (a build without the permission): no check-in, so no agent waits on one.
    if (!chrome.notifications) return;
    // The server asked, and this sign-in: an answer that comes after a sign-out or a switch is the old one's.
    const server = issuer();
    const at = generation;
    const live = () => at === generation && server === issuer();
    const journeys = await session.waiting().catch(() => null);
    if (!journeys || !live()) return;
    // Not nows the server has yet to hear.
    for (const [id, journey] of Object.entries(await shown())) if (journey.decline && live()) await decline(id);
    // Kept before the notice: a worker ended between the two never shows it a second time.
    const fresh = await edit((kept) => journeys.filter((journey) => !Object.hasOwn(kept, journey.id)).map((journey) => { kept[journey.id] = { page: journey.page }; return journey; }), live) ?? [];
    for (const journey of fresh) {
      if (!live()) return;
      const notice = `${NOTICE}${journey.id}`;
      const made = isOutingPage(journey.page) && await chrome.notifications.create(notice, {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon-128.png'), requireInteraction: true,
        title: COPY.agent.title, message: COPY.agent.line(journey), buttons: [{ title: COPY.agent.start }, { title: COPY.agent.later }],
      }).then(() => true, () => false);
      // Signed out or switched while it was made: it goes with the rest.
      if (!live()) { if (made) await chrome.notifications.clear(notice).catch(() => undefined); return; }
      if (!made) await decline(journey.id);
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

    /**
     * Keeps the alarm while signed in with Pro (`true`), drops it when signed out or not Pro (`false`), and leaves it as
     * it is when the server's word is unknown (`null`): a server out of reach for a moment does not stop the check-ins.
     */
    async keep(on) {
      if (!chrome.alarms || on === null) return;
      if (!on) { await chrome.alarms.clear(ALARM); return; }
      // Only when missing (or made at another pace): making it again would put the next check-in off every time the worker starts.
      if ((await chrome.alarms.get(ALARM))?.periodInMinutes !== PERIOD) await chrome.alarms.create(ALARM, { periodInMinutes: PERIOD });
    },

    /** Signed out, or another server: its notices go, and its list with them. */
    async forget() {
      generation += 1;
      const open = await Promise.resolve().then(() => chrome.notifications?.getAll()).catch(() => ({}));
      await Promise.all(Object.keys(open ?? {}).filter((notice) => notice.startsWith(NOTICE)).map((notice) => chrome.notifications.clear(notice).catch(() => undefined)));
      writes = writes.then(() => chrome.storage.session.remove(SHOWN)).catch(() => undefined);
      await writes;
    },

    /** A press on a notice of ours: `button` 0 (or the notice itself) is Start, 1 is Not now. */
    async pressed(notice, button = 0) {
      if (typeof notice !== 'string' || !notice.startsWith(NOTICE)) return;
      const id = notice.slice(NOTICE.length);
      await chrome.notifications.clear(notice).catch(() => undefined);
      const journey = (await shown())[id];
      if (!journey) return;
      if (button === 1) { await decline(id); return; }
      if (isOutingPage(journey.page)) await chrome.tabs.create({ url: journey.page, active: true });
    },
  };
}
