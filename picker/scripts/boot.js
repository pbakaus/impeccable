/** The boot contract: one fetch that tells the page how to start.
 *
 * Both scripts on the page read it, so it is fetched once and shared. A server
 * that predates the contract answers 404, and the page starts the way it always
 * did: a blank questionnaire.
 */

let bootPromise = null;

export function getBoot() {
  bootPromise ??= fetch('/boot.json')
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
    .then((data) => ({
      mode: data?.mode === 'doc' ? 'doc' : 'questionnaire',
      prior: data?.prior && typeof data.prior === 'object' && !Array.isArray(data.prior) ? data.prior : null,
      priorSource: data?.priorSource || null,
      doc: data?.doc || null,
    }));
  return bootPromise;
}

/* Restoring a previous run happens inside the questionnaire, which owns the
   state being restored. The document waits on this before it renders, so it
   never reads a form that is still half filled. It resolves either way: a run
   with nothing to restore is ready immediately. */
let settle;
export const hydrationReady = new Promise((resolve) => { settle = resolve; });

/* The attribute is the observable half: it drives the note on the start screen
   and gives anything watching the page one thing to wait for. */
export function markHydrated(source) {
  document.body.dataset.hydrated = source || 'none';
  settle(source || null);
}
