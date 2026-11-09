// Public Office (office.bakchich.cc): read-only scene fed by office-public.json.
// Imports nothing from ui/ and never connects the store: no chat, inbox, permissions, rename,
// settings, timeline or usage, and no request other than the feed.
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import './public.css';
import { PublicStore } from './net/public-store';
import { createWorld } from './world';
import { DEFAULT_WORLD_OPTIONS } from './world/api';
import { publicSnapshot, type PublicFeed } from '../../shared/demo/public';

const POLL_MS = 300_000;
const FEED_URL = 'office-public.json';

function el(tag: string, cls: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  return n;
}

const store = new PublicStore();
const world = createWorld(document.getElementById('world') as HTMLCanvasElement, store);
world.setOptions({ ...DEFAULT_WORLD_OPTIONS, showNames: true, bubbles: 'all' });

const live = el('div', 'pub-live');
const header = el('header', 'pub-head');
header.append(el('div', 'pub-title', 'Bakchich Office'), live);

const empty = el('section', 'pub-empty');
empty.hidden = true;
const img = document.createElement('img');
img.src = '/assets/illustrations/empty-office.png';
img.alt = '';
empty.append(img, el('h2', 'pub-empty__title', 'The team is off right now.'), el('p', 'pub-empty__text', 'Back soon.'));

const card = el('aside', 'pub-card');
card.hidden = true;
let cardFor: string | null = null;
/** Provider names as the feed spells them (the scene lowercases them into account ids). */
const providers = new Map<string, string>();
world.onSelect((sel) => {
  if (sel?.type !== 'agent') {
    card.hidden = true;
    cardFor = null;
    if (sel) world.select(null);
    return;
  }
  const a = store.agent(sel.id);
  if (!a) return;
  const provider = providers.get(a.id) ?? 'AI agent';
  cardFor = a.id;
  card.replaceChildren(
    el('strong', 'pub-card__name', a.name),
    el('span', 'pub-card__label', a.activity?.text ?? ''),
    el('span', 'pub-card__meta', `${a.kind === 'sub' ? 'Helper agent' : 'Agent'} · ${provider}`),
  );
  card.hidden = false;
});

const footer = el('footer', 'pub-foot');
const link = document.createElement('a');
link.href = 'https://bakchich.me';
link.target = '_blank';
link.rel = 'noopener';
link.textContent = 'AI agents building Bakchich, live';
footer.append(link);

(document.getElementById('ui') as HTMLElement).append(header, empty, card, footer);

let first = true;

function show(feed: PublicFeed): void {
  providers.clear();
  for (const a of feed.agents) providers.set(`factory:agent:${a.id}`, a.provider);
  store.show(publicSnapshot(feed, store.snapshot, Date.now()));
  const present = feed.agents.filter((a) => a.state !== 'done');
  const working = present.filter((a) => a.state === 'running').length;
  live.textContent = present.length ? `● LIVE  ${present.length} agents in the office, ${working} working` : '● LIVE  nobody in right now';
  empty.hidden = present.length > 0;
  if (cardFor && !store.agent(cardFor)) {
    card.hidden = true; // that agent left the office
    cardFor = null;
  }
  if (first) {
    first = false;
    requestAnimationFrame(() => world.overview());
  }
}

function isFeed(v: unknown): v is PublicFeed {
  const f = v as PublicFeed;
  return !!f && typeof f === 'object' && Array.isArray(f.agents) && !!f.products && typeof f.products === 'object';
}

async function poll(): Promise<void> {
  try {
    const res = await fetch(FEED_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data: unknown = await res.json();
    if (!isFeed(data)) throw new Error('bad feed');
    show(data);
  } catch {
    // keep the current scene; with nothing shown yet, show the empty office
    if (!store.snapshot) show({ builtAt: '', products: {}, agents: [] });
  }
}

void poll();
setInterval(() => void poll(), POLL_MS);
addEventListener('focus', () => void poll());
