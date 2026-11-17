// Asks for the microphone, once, for talk to type in the side panel: a side panel can't show Chrome's prompt, so the
// panel opens this page in a tab. Given, the tab closes itself and the panel starts listening; refused, it says so and
// points at Chrome's settings. Nothing is recorded here: the stream is stopped the moment Chrome hands it over.
import { COPY } from '../panel/copy.js';

const words = COPY.mic;
const app = document.getElementById('app');
const done = () => { show('on'); setTimeout(() => { chrome.tabs.getCurrent((tab) => { if (tab) void chrome.tabs.remove(tab.id).catch(() => undefined); }); }, 1200); };

function el(tag, props = {}, ...children) {
  const made = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') made.className = value;
    else if (key === 'text') made.textContent = value;
    else if (key.startsWith('on')) made.addEventListener(key.slice(2), value);
    else made.setAttribute(key, value);
  }
  made.append(...children.filter(Boolean));
  return made;
}

function show(state) {
  document.body.dataset.state = state;
  const line = { asking: words.asking, on: words.on, blocked: words.blocked, dismissed: words.dismissed, none: words.none }[state];
  const small = state === 'asking' ? words.why : state === 'blocked' ? words.how : null;
  const action = state === 'blocked'
    ? el('button', { class: 'btn btn-gold', type: 'button', 'data-act': 'settings', text: words.settings, onclick: () => { void chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=${encodeURIComponent(location.origin)}` }); } })
    : state === 'dismissed' ? el('button', { class: 'btn btn-gold', type: 'button', 'data-act': 'again', text: words.again, onclick: () => { void ask(); } }) : null;
  app.replaceChildren(el('div', { class: 'mid' },
    el('h2', { class: 'hd', text: words.title }),
    el('p', { class: 'act', role: 'status', text: line }),
    small ? el('p', { class: 'task', text: small }) : null,
    action));
}

async function ask() {
  show('asking');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    done();
  } catch (error) {
    if (error?.name === 'NotFoundError') { show('none'); return; }
    const mic = await navigator.permissions.query({ name: 'microphone' }).catch(() => null);
    show(mic?.state === 'denied' ? 'blocked' : 'dismissed');
    // Allowed later, in Chrome's settings: this page has done its job.
    if (mic) mic.onchange = () => { if (mic.state === 'granted') { mic.onchange = null; done(); } };
  }
}

void ask();
