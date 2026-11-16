// Public Office (office.bakchich.cc): read-only scene fed by office-public.json.
// Imports nothing from ui/ and never connects the store: no chat, inbox, permissions, rename,
// settings, timeline or usage. Requests: the feed, plus the suggestions service under /suggest/
// (read ideas, send an idea, vote; see ./suggest).
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import './public.css';
import { PublicStore } from './net/public-store';
import { createWorld } from './world';
import { DEFAULT_WORLD_OPTIONS } from './world/api';
import { publicSnapshot, type PublicFeed } from '../../shared/demo/public';
import { SuggestManager, mergeSyntheticAgent } from './suggest';
import { Tower, type TowerRoom } from './tower';

const POLL_MS = 300_000;
const STALE_MS = 30 * 60_000; // two missed builds: stop claiming LIVE
const FOCUS_GAP_MS = 30_000;
const FEED_URL = 'office-public.json';

function el(tag: string, cls: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  return n;
}

const canvas = document.getElementById('world') as HTMLCanvasElement;
// One building per floor: changing floors builds a fresh scene (the old floor's rooms never linger).
let store = new PublicStore();
let world = createWorld(canvas, store);

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

function setupWorld(): void {
  world.setOptions({ ...DEFAULT_WORLD_OPTIONS, showNames: true, bubbles: 'all' });
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
}
setupWorld();

const footer = el('footer', 'pub-foot');
const link = document.createElement('a');
link.href = 'https://bakchich.me';
link.target = '_blank';
link.rel = 'noopener';
link.textContent = 'AI agents building Bakchich, live';
footer.append(link);

const uiContainer = document.getElementById('ui') as HTMLElement;
uiContainer.append(header, empty, card, footer);

let currentFeed: PublicFeed = { builtAt: '', products: {}, agents: [] };

const suggestManager = new SuggestManager({
  container: uiContainer,
  onSyntheticAgentUpdate: () => show(currentFeed),
  onFocusAgent: (agentId: string) => world.focusAgent(agentId, { follow: true }),
});

let first = true;

// Tower: one floor per product, its project rooms side by side (ROOMS_PER_FLOOR at most, then the
// product takes the next floor up). The panel switches floors; only the shown floor is simulated.
const ROOMS_PER_FLOOR = 8;
interface Floor { key: string; product: string; name: string; projects: string[]; rooms: TowerRoom[]; agents: number; working: number }
let floorKey = decodeURIComponent(location.hash.match(/f=([^&]+)/)?.[1] ?? '');
let shownFloor = '';
const floorNav = el('nav', 'pub-floors');
floorNav.setAttribute('aria-label', 'Floors');
uiContainer.append(floorNav);

function floorsOf(feed: PublicFeed): Floor[] {
  const out: Floor[] = [];
  for (const [product, p] of Object.entries(feed.products)) {
    const agents = feed.agents.filter((a) => a.product === product);
    const busy = (id: string) => agents.filter((a) => a.project === id).length;
    const ids = Object.entries(feed.projects ?? {}).filter(([, q]) => q.product === product).map(([id]) => id)
      .sort((a, b) => busy(b) - busy(a)); // busy rooms on the product's first floor
    const chunks: string[][] = [];
    for (let i = 0; i < Math.max(ids.length, 1); i += ROOMS_PER_FLOOR) chunks.push(ids.slice(i, i + ROOMS_PER_FLOOR));
    chunks.forEach((projects, i) => {
      const here = agents.filter((a) => (a.project && projects.includes(a.project)) || (i === 0 && !(a.project && ids.includes(a.project))));
      const count = (list: typeof agents): TowerRoom => ({ agents: list.length, working: list.filter((a) => a.state === 'running').length });
      const rooms = projects.map((id) => count(here.filter((a) => a.project === id)));
      const loose = here.filter((a) => !(a.project && projects.includes(a.project)));
      if (loose.length || !rooms.length) rooms.push(count(loose)); // the product's own room
      out.push({ key: i ? `${product}-${i + 1}` : product, product, name: i ? `${p.name} ${i + 1}` : p.name, projects, rooms, ...count(here) });
    });
  }
  return out;
}

function floorFeed(feed: PublicFeed, f: Floor): PublicFeed {
  const inFloor = (a: PublicFeed['agents'][number]) => a.product === f.product &&
    (a.project && feed.projects?.[a.project] ? f.projects.includes(a.project) : !f.key.includes('-'));
  return {
    ...feed,
    products: { [f.product]: feed.products[f.product] },
    projects: Object.fromEntries(f.projects.map((id) => [id, feed.projects![id]])),
    agents: feed.agents.filter(inFloor),
  };
}

// Opening view: the whole tower. A link with #f=<floor> skips it.
let floorList: Floor[] = [];
const tower = new Tower((i) => {
  const f = floorList[i];
  if (!f) return;
  tower.leave(i);
  floorNav.hidden = false;
  floorKey = '';
  goFloor(f.key);
});
tower.el.hidden = !!floorKey;
floorNav.hidden = !floorKey;
uiContainer.prepend(tower.el);

function renderFloors(floors: Floor[]): void {
  floorList = floors;
  if (tower.visible) tower.show(floors);
  const out = el('button', 'pub-floor pub-floor--tower', 'Whole building') as HTMLButtonElement;
  out.type = 'button';
  out.onclick = () => {
    floorNav.hidden = true;
    history.replaceState(null, '', location.pathname + location.search);
    tower.show(floorList);
  };
  floorNav.replaceChildren(out, el('div', 'pub-floors__title', 'Floors'));
  floors.map((f, i) => ({ f, n: i + 1 })).reverse().forEach(({ f, n }) => {
    const b = el('button', 'pub-floor') as HTMLButtonElement;
    b.type = 'button';
    b.classList.toggle('pub-floor--on', f.key === floorKey);
    b.setAttribute('aria-current', f.key === floorKey ? 'true' : 'false');
    b.append(el('span', 'pub-floor__n', String(n)), el('span', 'pub-floor__name', f.name), el('span', 'pub-floor__count', f.working ? `${f.working}/${f.agents}` : String(f.agents)));
    b.title = `${f.agents} ${f.agents === 1 ? 'agent' : 'agents'}, ${f.working} working`;
    b.onclick = () => goFloor(f.key);
    floorNav.append(b);
  });
}

function goFloor(key: string): void {
  if (key === floorKey) return;
  floorKey = key;
  history.replaceState(null, '', `#f=${encodeURIComponent(key)}`);
  show(currentFeed);
}

function show(feed: PublicFeed): void {
  currentFeed = feed;
  const floors = floorsOf(feed);
  if (!floors.some((f) => f.key === floorKey)) {
    floorKey = [...floors].sort((a, b) => b.working - a.working || b.agents - a.agents)[0]?.key ?? '';
  }
  tower.brand = feed.brand ?? null;
  renderFloors(floors);
  const floor = floors.find((f) => f.key === floorKey);
  const shown = floor ? floorFeed(feed, floor) : feed;
  const merged = mergeSyntheticAgent(shown, suggestManager.getSyntheticAgent());
  providers.clear();
  for (const a of merged.agents) providers.set(`factory:agent:${a.id}`, a.provider);
  const moved = shownFloor !== floorKey;
  if (moved && shownFloor) {
    card.hidden = true;
    cardFor = null;
    world.destroy();
    store = new PublicStore();
    world = createWorld(canvas, store);
    setupWorld();
  }
  store.show(publicSnapshot(merged, moved ? null : store.snapshot, Date.now()));
  if (moved && !first) requestAnimationFrame(() => world.overview());
  shownFloor = floorKey;
  const all = store.snapshot?.agents ?? [];
  // whole-building counts from the feed: the agent taking a visitor's suggestion is page-made, never counted
  const present = feed.agents.length;
  const working = feed.agents.filter((a) => a.state === 'running').length;
  const built = Date.parse(feed.builtAt);
  const stale = !Number.isFinite(built) || Date.now() - built > STALE_MS;
  const head = stale
    ? `Last update ${Number.isFinite(built) ? new Date(built).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unknown'}`
    : '● LIVE';
  live.textContent = present ? `${head}  ${present} ${present === 1 ? 'agent' : 'agents'} in the building, ${working} working` : `${head}  nobody in right now`;
  live.classList.toggle('pub-live--stale', stale);
  empty.hidden = present > 0 || all.length > 0;
  if (cardFor && !store.agent(cardFor)) {
    card.hidden = true; // that agent left the office
    cardFor = null;
  }
  suggestManager.updateFeed(feed);
  if (first) {
    first = false;
    requestAnimationFrame(() => world.overview());
  }
}

function isFeed(v: unknown): v is PublicFeed {
  const f = v as PublicFeed;
  return !!f && typeof f === 'object' && Array.isArray(f.agents) && !!f.products && typeof f.products === 'object';
}

let lastPoll = 0;

async function poll(): Promise<void> {
  lastPoll = Date.now();
  try {
    const proto = (window as { __PROTO_FEED__?: unknown }).__PROTO_FEED__;
    let data: unknown = proto;
    if (!proto) {
      const res = await fetch(FEED_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
    }
    if (!isFeed(data)) throw new Error('bad feed');
    show(data);
  } catch {
    // keep the current scene; with nothing shown yet, show the empty office
    if (!store.snapshot) show({ builtAt: '', products: {}, agents: [] });
  }
}

void poll();
setInterval(() => void poll(), POLL_MS);
addEventListener('focus', () => {
  if (Date.now() - lastPoll > FOCUS_GAP_MS) void poll();
});
