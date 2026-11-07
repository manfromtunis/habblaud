import { describe, expect, it } from 'vitest';
import { FactorySimulator, FACTORY_PROJECTS } from './factory';

describe('FactorySimulator', () => {
  it('snapshot has 9 rooms representing the 9 factory projects with product in names', () => {
    const sim = new FactorySimulator({ seed: 42 }, 10_000);
    const snap = sim.snapshot(10_000);

    // 9 rooms
    expect(snap.rooms).toHaveLength(9);

    // Verify all 9 projects are present
    const expectedProjects = [
      'New fee engine',
      'Support bot',
      'Black Friday 2026',
      'Clip2Earn V2',
      'Release manager',
      'Software factory',
      'AuraStack store',
      'Kick to YouTube',
      'Design system',
    ];

    for (const proj of expectedProjects) {
      const room = snap.rooms.find((r) => r.name.includes(proj));
      expect(room, `Room for project "${proj}" should exist`).toBeDefined();
    }

    // Verify room names carry the product (bakchich, aurastack, clip2earn, factory, kick-yt)
    const expectedProducts = ['bakchich', 'aurastack', 'clip2earn', 'factory', 'kick-yt'];
    for (const prod of expectedProducts) {
      const hasProduct = snap.rooms.some((r) => r.name.toLowerCase().includes(prod));
      expect(hasProduct, `At least one room name should carry product "${prod}"`).toBe(true);
    }
  });

  it('snapshot has ~18 agents with handles as names, at least one waiting, one sub', () => {
    const sim = new FactorySimulator({ seed: 42 }, 10_000);
    const snap = sim.snapshot(10_000);

    // ~18 agents (17-20)
    expect(snap.agents.length).toBeGreaterThanOrEqual(17);
    expect(snap.agents.length).toBeLessThanOrEqual(20);

    // Handles like 1a3f, 2b07, 3c11
    expect(snap.agents.every((a) => /^[123][a-z0-9]{3}$/.test(a.name))).toBe(true);

    // At least one waiting agent
    const waiting = snap.agents.filter((a) => a.status === 'waiting');
    expect(waiting.length).toBeGreaterThanOrEqual(1);
    for (const w of waiting) {
      expect(w.waitingFor).toBeTruthy();
      expect(w.permission).toBeDefined();
    }

    // At least one subagent
    const subs = snap.agents.filter((a) => a.kind === 'sub');
    expect(subs.length).toBeGreaterThanOrEqual(1);

    // Subagents start with 3 and have parent in the same room
    for (const sub of subs) {
      expect(sub.name.startsWith('3')).toBe(true);
      expect(sub.parentId).toBeDefined();
      const parent = snap.agents.find((p) => p.id === sub.parentId);
      expect(parent).toBeDefined();
      expect(parent!.roomId).toBe(sub.roomId);
    }
  });

  it('accounts have Claude, Antigravity, OpenCode, and at least one is out of quota', () => {
    const sim = new FactorySimulator({ seed: 42 }, 10_000);
    const snap = sim.snapshot(10_000);

    expect(snap.accounts).toHaveLength(3);
    const names = snap.accounts.map((a) => a.name);
    expect(names).toContain('Claude');
    expect(names).toContain('Antigravity');
    expect(names).toContain('OpenCode');

    // At least one account out of quota
    const noQuotaAccounts = snap.accounts.filter((a) => a.usage?.noQuota === true);
    expect(noQuotaAccounts.length).toBeGreaterThanOrEqual(1);
    expect(noQuotaAccounts.some((a) => a.name === 'OpenCode')).toBe(true);
  });

  it('tick changes something (moves agents / generates feeds)', () => {
    const start = 10_000;
    const sim = new FactorySimulator({ seed: 42 }, start);

    // Tick before 20s
    const earlyTick = sim.tick(start + 5_000);
    expect(earlyTick.feed).toHaveLength(0);

    // Tick after 20s
    const tickResult = sim.tick(start + 25_000);
    expect(tickResult.changed).toBe(true);
    expect(tickResult.feed.length).toBeGreaterThan(0);
  });

  it('decidePermission resolves waiting agent to working', () => {
    const start = 10_000;
    const sim = new FactorySimulator({ seed: 42 }, start);
    const waiting = sim.snapshot(start).agents.find((a) => a.status === 'waiting');
    expect(waiting).toBeDefined();
    const permId = waiting!.permission!.id;

    const ok = sim.decidePermission(permId, { behavior: 'allow' }, start + 1_000);
    expect(ok).toBe(true);

    const updated = sim.snapshot(start + 1_000).agents.find((a) => a.id === waiting!.id)!;
    expect(updated.status).toBe('working');
    expect(updated.permission).toBeUndefined();
    expect(updated.activity?.text).toBe('Approved in Office');
  });
});
