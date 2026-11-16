// Public Office: the public feed (office-public.json) mapped onto the factory adapter.
// The public feed only carries id, parent, product, state, provider, since and a generic label:
// nothing here can name a session, a project, a thread or a person.
import type { OfficeSnapshot } from '../types';
import { mapFactoryDataToSnapshot, type FactoryApiAgent, type FactoryOfficeResponse } from './factory';
import { pickName } from '../names';

export interface PublicAgent {
  id: string;
  parent: string | null;
  product: string;
  state: 'running' | 'waiting' | 'stalled' | 'idle'; // idle: finished in the last hours, sitting at the desk
  provider: string;
  since?: string | null;
  label: string;
  project?: string | null; // a key of PublicFeed.projects; absent or unknown: the product's room
}

export interface PublicFeed {
  builtAt: string;
  products: Record<string, { name: string; voteUrl?: string }>;
  projects?: Record<string, { name: string; product: string }>; // absent: one room per product
  agents: PublicAgent[];
  brand?: { name: string; logo?: string }; // tower roof sign and flag (logo: an image data URI)
}

/** Public feed -> the factory response shape: one room per project (or per product), no inbox, nothing to message. */
export function publicToFactory(feed: PublicFeed): FactoryOfficeResponse {
  const projects = Object.entries(feed.projects ?? {}).filter(([, p]) => Object.hasOwn(feed.products, p.product));
  const known = new Map(projects);
  // a product's own room keeps the product key as its id (the id seeds the room's look) unless a project took it
  const ownRoom = (product: string) => (known.has(product) ? `${product}#own` : product);
  const agents: FactoryApiAgent[] = feed.agents.filter((a) => Object.hasOwn(feed.products, a.product)).map((a) => ({
    hc: a.id,
    parent: a.parent ?? undefined,
    product: a.product,
    project: a.project && known.get(a.project)?.product === a.product ? a.project : ownRoom(a.product),
    state: a.state,
    provider: a.provider,
    since: a.since ?? undefined,
    task: a.label,
    title: a.label,
    activityText: a.label,
    thread: a.id,
    canReceive: false,
  }));
  return {
    builtAt: feed.builtAt,
    products: feed.products,
    // project rooms, then a product's own room (named after the product) when it has none or someone sits there
    projects: [
      ...projects.map(([id, p]) => ({ id, product: p.product, name: p.name })),
      ...Object.entries(feed.products)
        .filter(([key]) => !projects.length || agents.some((a) => a.project === ownRoom(key)))
        .map(([key, p]) => ({ id: ownRoom(key), product: key, name: p.name, path: `~/code/${key}/` })),
    ],
    agents,
    inbox: [],
    answers: {},
  };
}

/** Maps the public feed to a snapshot and gives every character a neutral name keyed on its public id. */
export function publicSnapshot(feed: PublicFeed, prev: OfficeSnapshot | null, now: number): OfficeSnapshot {
  const { snapshot } = mapFactoryDataToSnapshot(publicToFactory(feed), prev, now, false);
  delete (snapshot as { inbox?: unknown }).inbox; // no inbox marker in the reception
  snapshot.meta.buildingName = 'Bakchich';
  // A character keeps the name it had on the previous poll; only newcomers draw from the pool.
  const before = new Map((prev?.agents ?? []).map((a) => [a.id, { name: a.name, look: a.look }]));
  const used = new Set<string>();
  for (const a of snapshot.agents) {
    const kept = before.get(a.id);
    if (kept) used.add(kept.name);
  }
  for (const a of snapshot.agents) {
    const person = before.get(a.id) ?? pickName(a.id, used);
    used.add(person.name);
    a.name = person.name;
    a.look = person.look;
    a.model = undefined;
    a.gitBranch = undefined;
  }
  return snapshot;
}
