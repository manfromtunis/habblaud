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

    // The first tick hands over the seeded feed (current activity of up to 10 agents)
    expect(sim.tick(start + 1_000).feed).toHaveLength(10);

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

  it('snapshot has ~8 inbox items with urgent, action, applied kinds, recommended first, waiting agent links', () => {
    const start = 10_000;
    const sim = new FactorySimulator({ seed: 42 }, start);
    const snap = sim.snapshot(start);

    expect(snap.inbox).toBeDefined();
    expect(snap.inbox!.length).toBe(8);

    const urgent = snap.inbox!.filter((i) => i.kind === 'urgent');
    const action = snap.inbox!.filter((i) => i.kind === 'action');
    const applied = snap.inbox!.filter((i) => i.kind === 'applied');

    expect(urgent).toHaveLength(2);
    expect(action).toHaveLength(3);
    expect(applied).toHaveLength(3);

    // Title <80 chars and verb-first
    for (const item of snap.inbox!) {
      expect(item.title.length).toBeLessThan(80);
      expect(/^[A-Z][a-z]+/.test(item.title)).toBe(true);
      // Context <= 3 lines
      const lines = item.context.split('\n');
      expect(lines.length).toBeLessThanOrEqual(3);
      // Options present with reco first
      expect(item.options.length).toBeGreaterThanOrEqual(1);
    }

    // Applied items have one option 'Seen'
    for (const item of applied) {
      expect(item.options).toHaveLength(1);
      expect(item.options[0].label).toBe('Seen');
    }

    // Items from waiting agents (2b07, 2e77)
    const from2b07 = snap.inbox!.find((i) => i.from === '2b07');
    const from2e77 = snap.inbox!.find((i) => i.from === '2e77');
    expect(from2b07).toBeDefined();
    expect(from2e77).toBeDefined();
  });

  it('answering removes the item, frees the waiting agent, adds a feed item', () => {
    const start = 10_000;
    const sim = new FactorySimulator({ seed: 42 }, start);
    const snapBefore = sim.snapshot(start);

    const item = snapBefore.inbox!.find((i) => i.id === 'a538')!;
    expect(item).toBeDefined();
    expect(item.from).toBe('2b07');

    const agentBefore = snapBefore.agents.find((a) => a.name === '2b07')!;
    expect(agentBefore.status).toBe('waiting');

    const ok = sim.answerInbox('a538', 'v1v2', 'Approved fallback', start + 1_000);
    expect(ok).toBe(true);

    const snapAfter = sim.snapshot(start + 1_000);
    expect(snapAfter.inbox!.find((i) => i.id === 'a538')).toBeUndefined();
    expect(snapAfter.inbox!.length).toBe(7);

    // Agent freed
    const agentAfter = snapAfter.agents.find((a) => a.name === '2b07')!;
    expect(agentAfter.status).toBe('working');
    expect(agentAfter.permission).toBeUndefined();

    // Feed item added
    const tickResult = sim.tick(start + 1_000);
    const feed = tickResult.feed.find((f) => f.activity?.text.includes('You answered a538'));
    expect(feed).toBeDefined();
  });

  it('applied "Seen" works', () => {
    const start = 10_000;
    const sim = new FactorySimulator({ seed: 42 }, start);

    const ok = sim.answerInbox('e204', 'seen', undefined, start + 1_000);
    expect(ok).toBe(true);

    const snapAfter = sim.snapshot(start + 1_000);
    expect(snapAfter.inbox!.find((i) => i.id === 'e204')).toBeUndefined();
    expect(snapAfter.inbox!.length).toBe(7);

    const tickResult = sim.tick(start + 1_000);
    const feed = tickResult.feed.find((f) => f.activity?.text.includes('You answered e204: Seen'));
    expect(feed).toBeDefined();
  });
});
