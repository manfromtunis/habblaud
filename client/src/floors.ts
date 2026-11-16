// Tower floors: one floor per product, its project rooms side by side, then the product takes the
// next floor up. Pure, so the page and the tests share it.
import type { PublicFeed } from '../../shared/demo/public';
import type { TowerRoom } from './tower';

/** Projects per floor: with the product's own room that is the tower's 8 windows. */
export const ROOMS_PER_FLOOR = 7;

export interface Floor {
  key: string; // the product key on its first floor, `${product}~${n}` above it
  index: number; // 0 on the product's first floor
  product: string;
  name: string;
  projects: string[];
  rooms: TowerRoom[];
  agents: number;
  working: number;
}

type Agent = PublicFeed['agents'][number];

/** The agent's project when it is one of its own product's projects, else null: the product's own room. */
function projectOf(feed: PublicFeed, a: Agent): string | null {
  const p = a.project ? feed.projects?.[a.project] : undefined;
  return p && p.product === a.product ? a.project! : null;
}

function count(list: Agent[]): TowerRoom {
  return { agents: list.length, working: list.filter((a) => a.state === 'running').length };
}

export function floorsOf(feed: PublicFeed): Floor[] {
  const out: Floor[] = [];
  for (const [product, p] of Object.entries(feed.products)) {
    const agents = feed.agents.filter((a) => a.product === product);
    const busy = (id: string) => agents.filter((a) => projectOf(feed, a) === id).length;
    const ids = Object.entries(feed.projects ?? {}).filter(([, q]) => q.product === product).map(([id]) => id)
      .sort((a, b) => busy(b) - busy(a)); // busy rooms on the product's first floor
    const loose = agents.filter((a) => projectOf(feed, a) === null);
    for (let index = 0; index * ROOMS_PER_FLOOR < Math.max(ids.length, 1); index++) {
      const projects = ids.slice(index * ROOMS_PER_FLOOR, (index + 1) * ROOMS_PER_FLOOR);
      const rooms = projects.map((id) => count(agents.filter((a) => projectOf(feed, a) === id)));
      const own = index === 0 ? loose : [];
      if (own.length || !rooms.length) rooms.push(count(own));
      const here = agents.filter((a) => {
        const id = projectOf(feed, a);
        return id ? projects.includes(id) : index === 0;
      });
      out.push({ key: index ? `${product}~${index + 1}` : product, index, product, name: index ? `${p.name} ${index + 1}` : p.name, projects, rooms, ...count(here) });
    }
  }
  return out;
}

/** The feed narrowed to one floor: its product, its projects, the agents in its rooms. */
export function floorFeed(feed: PublicFeed, f: Floor): PublicFeed {
  return {
    ...feed,
    products: { [f.product]: feed.products[f.product]! },
    projects: Object.fromEntries(f.projects.map((id) => [id, feed.projects![id]!])),
    agents: feed.agents.filter((a) => {
      if (a.product !== f.product) return false;
      const id = projectOf(feed, a);
      return id ? f.projects.includes(id) : f.index === 0;
    }),
  };
}

/** The floor named by a `#f=<key>` link, '' for none or a malformed one. */
export function floorFromHash(hash: string): string {
  const m = hash.match(/(?:^#|&)f=([^&]*)/);
  try {
    return m ? decodeURIComponent(m[1]!) : '';
  } catch {
    return '';
  }
}
