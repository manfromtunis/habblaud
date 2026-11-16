import { describe, expect, it } from 'vitest';
import type { PublicAgent, PublicFeed } from '../../shared/demo/public';
import { floorFeed, floorFromHash, floorsOf, ROOMS_PER_FLOOR } from './floors';
import { COLS } from './tower';

let n = 0;
const agent = (product: string, project: string | null, state: PublicAgent['state'] = 'running'): PublicAgent =>
  ({ id: `a${n++}`, parent: null, product, project, state, provider: 'Claude', label: 'Working' });

const projects = (product: string, count: number) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`${product}-p${i}`, { name: `P${i}`, product }]));

describe('floorsOf', () => {
  it('gives a product without projects one floor with its own room', () => {
    const feed: PublicFeed = { builtAt: '', products: { app: { name: 'App' } }, agents: [agent('app', null), agent('app', null, 'idle')] };
    const [f, ...rest] = floorsOf(feed);
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ key: 'app', index: 0, name: 'App', rooms: [{ agents: 2, working: 1 }], agents: 2, working: 1 });
  });

  it('keeps a hyphenated product key\'s loose agents on its first floor', () => {
    const feed: PublicFeed = {
      builtAt: '', products: { 'acme-app': { name: 'Acme' } }, projects: projects('acme-app', 1),
      agents: [agent('acme-app', null), agent('acme-app', 'acme-app-p0')],
    };
    const [f] = floorsOf(feed);
    expect(f!.agents).toBe(2);
    expect(floorFeed(feed, f!).agents).toHaveLength(2);
  });

  it('never needs more rooms than the tower has windows, the product room included', () => {
    const feed: PublicFeed = {
      builtAt: '', products: { app: { name: 'App' } }, projects: projects('app', ROOMS_PER_FLOOR * 2 + 1),
      agents: [agent('app', null), agent('app', 'app-p3')],
    };
    const floors = floorsOf(feed);
    expect(floors.map((f) => f.key)).toEqual(['app', 'app~2', 'app~3']);
    for (const f of floors) expect(f.rooms.length).toBeLessThanOrEqual(COLS);
    expect(floors[0]!.rooms.at(-1)).toEqual({ agents: 1, working: 1 }); // the product's own room
  });

  it('counts the same agents on the tower and in the floor view, an agent naming another product\'s project included', () => {
    const feed: PublicFeed = {
      builtAt: '', products: { x: { name: 'X' }, y: { name: 'Y' } }, projects: { py: { name: 'PY', product: 'y' } },
      agents: [agent('x', 'py'), agent('y', 'py'), agent('x', 'gone')],
    };
    for (const f of floorsOf(feed)) expect(floorFeed(feed, f).agents).toHaveLength(f.agents);
    expect(floorsOf(feed).find((f) => f.key === 'x')!.agents).toBe(2);
  });

  it('keys overflow floors apart from a product named like them', () => {
    const feed: PublicFeed = { builtAt: '', products: { a: { name: 'A' }, 'a-2': { name: 'A2' } }, projects: projects('a', ROOMS_PER_FLOOR + 1), agents: [] };
    const keys = floorsOf(feed).map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('floorFromHash', () => {
  it('reads the floor and survives a malformed or unrelated hash', () => {
    expect(floorFromHash('#f=app~2')).toBe('app~2');
    expect(floorFromHash('#x=1&f=a%20b')).toBe('a b');
    expect(floorFromHash('#f=%E0')).toBe('');
    expect(floorFromHash('#ref=x')).toBe('');
    expect(floorFromHash('')).toBe('');
  });
});
