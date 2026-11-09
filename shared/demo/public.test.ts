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

  it('empty agents gives an empty office', () => {
    expect(publicSnapshot({ ...feed, agents: [] }, null, Date.now()).agents).toHaveLength(0);
  });
});
