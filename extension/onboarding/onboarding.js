// The first-walk onboarding: what a persona does in your tab, and what it never does. Its words are in
// ../popup/words.js.
const WORDS = globalThis.IMPECCABLE_WORDS.onboarding;
const STEPS = ['does', 'never'];

const $ = (id) => document.getElementById(id);
let step = 'does';

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
  $('btn-next').hidden = at < 0;
}

$('btn-next').addEventListener('click', () => show(STEPS[STEPS.indexOf(step) + 1] ?? 'ready'));
$('btn-back').addEventListener('click', () => show(STEPS[STEPS.indexOf(step) - 1]));

show('does');
