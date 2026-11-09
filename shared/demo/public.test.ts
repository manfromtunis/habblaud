import { describe, expect, it } from 'vitest';
import { NAME_POOL } from '../names';
import { publicSnapshot, type PublicFeed } from './public';

const feed: PublicFeed = {
  builtAt: '2026-11-09T10:00:00Z',
  products: { bakchich: { name: 'Bakchich' }, clip2earn: { name: 'Clip2Earn' } },
  agents: [
    { id: 'aaaa000001', parent: null, product: 'bakchich', state: 'running', provider: 'Claude', since: '2026-11-09T09:00:00Z', label: 'Building a feature for Bakchich' },
    { id: 'aaaa000002', parent: 'aaaa000001', product: 'bakchich', state: 'running', provider: 'Claude', since: '2026-11-09T09:10:00Z', label: 'Building a feature for Bakchich' },
    { id: 'bbbb000001', parent: null, product: 'clip2earn', state: 'stalled', provider: 'OpenCode', since: '2026-11-09T09:20:00Z', label: 'Fixing a bug on Clip2Earn' },
  ],
};

describe('publicSnapshot', () => {
  const snap = publicSnapshot(feed, null, Date.parse('2026-11-09T10:00:00Z'));

  it('has one room per product, named by the product name', () => {
    const names = snap.rooms.map((r) => r.name).sort();
    expect(names).toEqual(['Bakchich', 'Clip2Earn']);
  });

  it('has no inbox and names the building Bakchich', () => {
    expect((snap as { inbox?: unknown }).inbox).toBeUndefined();
    expect(snap.meta.buildingName).toBe('Bakchich');
  });

  it('gives neutral names from the pool, never the public id', () => {
    const pool = new Set(NAME_POOL.map((p) => p.name));
    for (const a of snap.agents) {
      expect(pool.has(a.name)).toBe(true);
      expect(a.name).not.toContain(a.id.replace('factory:agent:', ''));
    }
  });

  it('shows only the generic label, no model, branch or messaging', () => {
    for (const a of snap.agents) {
      expect(a.activity?.text).toMatch(/^(Building a feature for Bakchich|Fixing a bug on Clip2Earn)$/);
      expect(a.model).toBeUndefined();
      expect(a.gitBranch).toBeUndefined();
      expect(a.canReceive).toBe(false);
      expect(a.canMessage).toBe(false);
    }
  });

  it('keeps subagents as helpers of their parent', () => {
    const sub = snap.agents.find((a) => a.kind === 'sub');
    expect(sub?.parentId).toBe('factory:agent:aaaa000001');
  });

  it('shows waiting agents waiting and stalled agents idle', () => {
    const t = Date.parse('2026-11-09T10:00:00Z');
    const agents = [
      { id: 'eeee000001', parent: null, product: 'bakchich', state: 'waiting' as const, provider: 'Claude', since: null, label: 'Building a feature for Bakchich' },
      { id: 'eeee000002', parent: null, product: 'bakchich', state: 'stalled' as const, provider: 'Claude', label: 'Building a feature for Bakchich' },
    ];
    const s = publicSnapshot({ ...feed, agents }, null, t);
    expect(s.agents.find((a) => a.id.endsWith('eeee000001'))?.status).toBe('waiting');
    expect(s.agents.find((a) => a.id.endsWith('eeee000002'))?.status).toBe('idle');
  });

  it('ignores products named after Object prototype keys', () => {
    const stray = { id: 'ffff000001', parent: null, product: 'constructor', state: 'running' as const, provider: 'Claude', label: 'x' };
    expect(publicSnapshot({ ...feed, agents: [stray] }, null, Date.now()).agents).toHaveLength(0);
  });

  it('empty agents gives an empty office', () => {
    expect(publicSnapshot({ ...feed, agents: [] }, null, Date.now()).agents).toHaveLength(0);
  });

  it('keeps names across polls when a newcomer arrives', () => {
    const t = Date.parse('2026-11-09T10:00:00Z');
    const first = publicSnapshot(feed, null, t);
    const names = new Map(first.agents.map((a) => [a.id, a.name]));
    const newcomer = { id: 'cccc000001', parent: null, product: 'bakchich', state: 'running' as const, provider: 'Claude', since: '2026-11-09T10:01:00Z', label: 'Fixing a bug on Bakchich' };
    const second = publicSnapshot({ ...feed, agents: [newcomer, ...feed.agents] }, first, t + 300_000);
    for (const [id, name] of names) expect(second.agents.find((a) => a.id === id)?.name).toBe(name);
    const all = second.agents.map((a) => a.name);
    expect(new Set(all).size).toBe(all.length);
  });

  it('drops an agent whose product is not in products', () => {
    const stray = { id: 'dddd000001', parent: null, product: 'secret-project', state: 'running' as const, provider: 'Claude', label: 'Working on X' };
    const snap = publicSnapshot({ ...feed, agents: [...feed.agents, stray] }, null, Date.now());
    expect(snap.agents.some((a) => a.id.endsWith('dddd000001'))).toBe(false);
    expect(snap.rooms.some((r) => r.name.includes('secret-project'))).toBe(false);
  });
});
