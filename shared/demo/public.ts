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
  state: 'running' | 'stalled' | 'done';
  provider: string;
  since?: string;
  label: string;
}

export interface PublicFeed {
  builtAt: string;
  products: Record<string, { name: string }>;
  agents: PublicAgent[];
}

/** Public feed -> the factory response shape: one room per product, no inbox, nothing to message. */
export function publicToFactory(feed: PublicFeed): FactoryOfficeResponse {
  const agents: FactoryApiAgent[] = feed.agents.map((a) => ({
    hc: a.id,
    parent: a.parent ?? undefined,
    product: a.product,
    project: a.product,
    state: a.state,
    provider: a.provider,
    since: a.since,
    task: a.label,
    title: a.label,
    activityText: a.label,
    thread: a.id,
    canReceive: false,
  }));
  return {
    builtAt: feed.builtAt,
    products: feed.products,
    projects: Object.entries(feed.products).map(([key, p]) => ({ id: key, product: key, name: p.name })),
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
  const used = new Set<string>();
  for (const a of snapshot.agents) {
    const person = pickName(a.id, used);
    used.add(person.name);
    a.name = person.name;
    a.look = person.look;
    a.model = undefined;
    a.gitBranch = undefined;
  }
  return snapshot;
}
