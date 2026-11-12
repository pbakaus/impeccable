// The first-walk onboarding: what a persona does in your tab, what it never does, then adding the walk helper. It
// asks this extension's worker whether the helper is here (contact.js) every second, and moves on by itself once it
// answers. Its words are in ../popup/words.js.
import { BUILD } from '../shared/build.js';
import { HELPER_ID } from '../shared/ids.js';

const WORDS = globalThis.IMPECCABLE_WORDS.onboarding;
const STEPS = ['does', 'never', 'add'];
const ASK_MS = 1000;

const $ = (id) => document.getElementById(id);
let step = 'does';
let helper = 'missing';

for (const node of document.querySelectorAll('[data-word]')) node.textContent = WORDS[node.dataset.word];
for (const list of document.querySelectorAll('[data-list]')) {
  list.replaceChildren(...WORDS[list.dataset.list].map((text) => Object.assign(document.createElement('li'), { textContent: text })));
}

function show(next) {
  step = next;
  document.body.dataset.step = next;
  for (const screen of document.querySelectorAll('[data-screen]')) screen.hidden = screen.dataset.screen !== next;
  const at = STEPS.indexOf(next);
  $('kicker').textContent = at < 0 ? WORDS.title : `${WORDS.title} · ${WORDS.step(at + 1, STEPS.length)}`;
  document.querySelectorAll('.dots i').forEach((dot, n) => dot.classList.toggle('is-on', n === at));
  $('btn-back').hidden = at <= 0;
  $('btn-next').hidden = at < 0 || at === STEPS.length - 1;
  const old = helper === 'old';
  $('add-title').textContent = old ? WORDS.oldTitle : WORDS.addTitle;
  $('add-body').textContent = old ? WORDS.oldBody : WORDS.addBody;
  // A build loaded unpacked has no store page for the helper: the person loads its folder.
  const local = BUILD.devHosts || !HELPER_ID;
  $('local-steps').hidden = !local;
  $('btn-add').textContent = local ? WORDS.openExtensions : WORDS.add;
}

$('btn-next').addEventListener('click', () => show(STEPS[STEPS.indexOf(step) + 1]));
$('btn-back').addEventListener('click', () => show(STEPS[STEPS.indexOf(step) - 1]));
$('btn-add').addEventListener('click', () => {
  const url = BUILD.devHosts || !HELPER_ID ? 'chrome://extensions' : `https://chromewebstore.google.com/detail/${HELPER_ID}`;
  void chrome.tabs.create({ url });
});

async function ask() {
  const answer = await chrome.runtime.sendMessage({ walks: 'helper' }).catch(() => null);
  const was = helper;
  helper = answer?.state ?? 'missing';
  if (helper === 'ready') { show('ready'); return; }
  if (helper !== was) show(helper === 'old' ? 'add' : step);
  setTimeout(ask, ASK_MS);
}

show('does');
void ask();
