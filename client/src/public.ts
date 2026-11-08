// Public Office (PROTOTYPE): read-only scene for office.bakchich.cc.
// Only the canvas, a header, an empty state and a footer. No sidebar, drawer, feed, terminal, inbox,
// chat, permissions, room rename, settings, timeline or usage bars, and the store never connects.
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import './public.css';
import sample from './public-sample.json';
import { OfficeStore } from './net/store';
import { createWorld } from './world';
import { DEFAULT_WORLD_OPTIONS } from './world/api';
import { nextTick, publicSnapshot, type PublicFeed } from '../../shared/demo/public';

const TICK_MS = 20_000; // prototype: fast so the scene visibly moves (product: poll every 5 min)

export function startPublic(): void {
  const pristine = document.documentElement.outerHTML; // for the site-frame demo, before the page changes
  const canvas = document.getElementById('world') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  document.documentElement.lang = 'en';
  document.title = 'Bakchich Office, live';

  const store = new OfficeStore({ mock: true, factory: false, search: '' });
  const world = createWorld(canvas, store);
  world.setOptions({ ...DEFAULT_WORLD_OPTIONS, showNames: true, bubbles: 'all' });

  const el = (tag: string, cls: string, text?: string) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  const header = el('header', 'pub-head');
  const title = el('div', 'pub-title', 'Bakchich Office');
  const live = el('div', 'pub-live');
  header.append(title, live);

  const empty = el('section', 'pub-empty');
  const img = document.createElement('img');
  img.src = '/assets/illustrations/empty-office.png';
  img.alt = '';
  empty.append(img, el('h2', 'pub-empty__title', 'The team is off right now.'), el('p', 'pub-empty__text', 'Back soon.'));

  const footer = el('footer', 'pub-foot');
  const link = document.createElement('a');
  link.href = 'https://bakchich.me';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'AI agents building Bakchich, live';
  footer.append(link);

  // Click a character: a small read-only card (name, generic label, provider). Nothing else opens.
  const card = el('aside', 'pub-card');
  card.hidden = true;
  world.onSelect((sel) => {
    if (sel?.type !== 'agent') {
      card.hidden = true;
      if (sel) world.select(null);
      return;
    }
    const a = store.agent(sel.id);
    if (!a) return;
    card.replaceChildren(
      el('strong', 'pub-card__name', a.name),
      el('span', 'pub-card__label', a.activity?.text ?? ''),
      el('span', 'pub-card__meta', `${a.kind === 'sub' ? 'Helper agent' : 'Agent'} · ${a.account.replace(/^\./, '')}`),
    );
    card.hidden = false;
  });

  ui.append(header, empty, card, footer);

  let feed: PublicFeed = sample as PublicFeed;
  let emptyMode = false;
  let tick = 0;

  function render(): void {
    const shown: PublicFeed = emptyMode ? { ...feed, agents: [] } : feed;
    const snap = publicSnapshot(shown, store.snapshot, Date.now());
    store.showPublic(snap);
    const working = shown.agents.filter((a) => a.state === 'running').length;
    const total = shown.agents.filter((a) => a.state !== 'done').length;
    live.textContent = total ? `● LIVE  ${total} agents in the office, ${working} working` : '● LIVE  nobody in right now';
    empty.hidden = total > 0;
    if (!total) card.hidden = true;
  }

  render();
  world.overview();
  setInterval(() => {
    if (emptyMode) return;
    feed = nextTick(feed, ++tick);
    render();
  }, TICK_MS);

  protoToolbar({
    live() {
      emptyMode = false;
      document.body.classList.remove('pub-phone');
      render();
      requestAnimationFrame(() => world.overview());
    },
    empty() {
      emptyMode = true;
      render();
    },
    phone() {
      document.body.classList.toggle('pub-phone');
      dispatchEvent(new Event('resize'));
      requestAnimationFrame(() => world.overview());
    },
    frame() {
      showInFrame(pristine);
    },
  });
}

/** PROTOTYPE ONLY: buttons to look at each state. Not part of the product page. */
function protoToolbar(actions: Record<'live' | 'empty' | 'phone' | 'frame', () => void>): void {
  if (window.parent !== window) return; // inside the site-frame demo: no toolbar
  const bar = document.createElement('div');
  bar.className = 'proto-bar';
  const label = document.createElement('strong');
  label.textContent = 'PROTOTYPE';
  bar.append(label);
  const names: Array<[keyof typeof actions, string]> = [
    ['live', 'Live mix'],
    ['empty', 'Empty office'],
    ['phone', 'Phone width'],
    ['frame', 'Inside a site frame'],
  ];
  for (const [k, text] of names) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.onclick = actions[k];
    bar.append(b);
  }
  const hide = document.createElement('button');
  hide.type = 'button';
  hide.textContent = '×';
  hide.title = 'Hide the prototype bar';
  hide.onclick = () => bar.remove();
  bar.append(hide);
  document.body.append(bar);
}

/** PROTOTYPE ONLY: the page inside a mock company site, as the embed will look. */
function showInFrame(pristine: string): void {
  const overlay = document.createElement('div');
  overlay.className = 'proto-site';
  overlay.innerHTML = `
    <div class="proto-site__nav"><b>bakchich.me</b><span>Creators</span><span>Pricing</span><span>About</span>
      <button type="button" class="proto-site__close">Back to the page</button></div>
    <div class="proto-site__body">
      <h1>We build with an AI team</h1>
      <p>Every product here is built by AI agents, supervised by a small human team. Watch them work, live.</p>
      <iframe title="Bakchich Office, live" width="900" height="500"></iframe>
      <p class="proto-site__small">Embed: &lt;iframe src="https://office.bakchich.cc" width="900" height="500"&gt;</p>
    </div>`;
  document.body.append(overlay);
  const frame = overlay.querySelector('iframe') as HTMLIFrameElement;
  frame.srcdoc = pristine;
  (overlay.querySelector('.proto-site__close') as HTMLButtonElement).onclick = () => overlay.remove();
}
