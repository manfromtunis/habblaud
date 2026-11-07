import { describe, expect, it } from 'vitest';
import {
  FactorySimulator,
  FACTORY_PROJECTS,
  mapFactoryDataToSnapshot,
  normalizeInboxOptions,
  type FactoryOfficeResponse,
} from './factory';

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

describe('normalizeInboxOptions', () => {
  it('handles the factory store shape: [key, label] pairs, reco first', () => {
    const opts = normalizeInboxOptions([['sendback', 'Send back'], ['merge', 'Merge it']], 'merge');
    expect(opts.map((o) => o.key)).toEqual(['merge', 'sendback']);
    expect(opts[0].label).toBe('Merge it');
  });
  it('handles options as string array with (Recommended) sorted first', () => {
    const raw = ['Option B', 'Option A (Recommended)', 'Option C'];
    const opts = normalizeInboxOptions(raw);
    expect(opts).toHaveLength(3);
    expect(opts[0].label).toBe('Option A (Recommended)');
    expect(opts[0].key).toBe('1');
    expect(opts[1].label).toBe('Option B');
    expect(opts[2].label).toBe('Option C');
  });

  it('handles options as dictionary key -> label with reco parameter', () => {
    const raw = {
      opt1: 'First Choice',
      opt2: 'Second Choice',
      opt3: 'Third Choice',
    };
    const opts = normalizeInboxOptions(raw, 'opt2');
    expect(opts).toHaveLength(3);
    expect(opts[0].key).toBe('opt2');
    expect(opts[0].label).toBe('Second Choice');
  });

  it('handles options as object array with key and label', () => {
    const raw = [
      { key: 'hold', label: 'Hold' },
      { key: 'merge', label: 'Merge (Recommended)' },
    ];
    const opts = normalizeInboxOptions(raw);
    expect(opts).toHaveLength(2);
    expect(opts[0].key).toBe('merge');
    expect(opts[1].key).toBe('hold');
  });
});

describe('mapFactoryDataToSnapshot', () => {
  it('maps live rows to OfficeSnapshot properly', () => {
    const data: FactoryOfficeResponse = {
      builtAt: 1714000000000,
      machine: { id: 'm1', label: 'factory-prod-1' },
      agents: [
        {
          hc: '1a3f',
          provider: 'claude',
          model: 'claude-sonnet-5-5',
          product: 'bakchich',
          project: 'New fee engine',
          state: 'running',
          task: 'Editing fee_calculator.py',
          branch: 'feat/fee-engine',
          canReceive: true,
          thread: 'thread-1a3f',
        },
        {
          hc: '2b07',
          provider: 'claude',
          model: 'claude-opus-5-5',
          product: 'bakchich',
          project: 'Support bot',
          state: 'waiting',
          waiting_for: 'Stripe signature check',
          parent: '1a3f',
          canReceive: false,
          thread: 'thread-2b07',
        },
        {
          hc: '1q03',
          provider: 'opencode',
          product: 'bakchich',
          project: 'New fee engine',
          state: 'quota',
        },
        {
          hc: '9z99',
          provider: 'claude',
          product: 'bakchich',
          project: 'New fee engine',
          state: 'done', // Should be omitted!
        },
      ],
      tokens: { today: 987654 },
      inbox: [
        {
          id: 'i1',
          kind: 'urgent',
          title: 'Approve legacy signature',
          context: 'Needs review',
          options: { opt1: 'Reject', opt2: 'Accept (Recommended)' },
          project: 'bakchich / Support bot',
          from: '2b07',
        },
      ],
    };

    const { snapshot, feedItems } = mapFactoryDataToSnapshot(data, null, 1714000000000);

    // 1. Building name from machine.label
    expect(snapshot.meta.buildingName).toBe('factory-prod-1');

    // 2. Agents in 'done' leave
    expect(snapshot.agents).toHaveLength(3);
    expect(snapshot.agents.some((a) => a.name === '9z99')).toBe(false);

    // 3. Subagents check
    const agent1a3f = snapshot.agents.find((a) => a.name === '1a3f')!;
    const agent2b07 = snapshot.agents.find((a) => a.name === '2b07')!;
    const agent1q03 = snapshot.agents.find((a) => a.name === '1q03')!;

    expect(agent1a3f.kind).toBe('main');
    expect(agent1a3f.status).toBe('working');
    expect(agent1a3f.canReceive).toBe(true);
    expect(agent1a3f.thread).toBe('thread-1a3f');

    expect(agent2b07.kind).toBe('sub');
    expect(agent2b07.parentId).toBe('factory:agent:1a3f');
    expect(agent2b07.status).toBe('waiting');
    expect(agent2b07.waitingFor).toBe('Stripe signature check');
    expect(agent2b07.canReceive).toBe(false);

    expect(agent1q03.status).toBe('idle');

    // 4. Accounts: one per provider present & no quota flag
    expect(snapshot.accounts.length).toBeGreaterThanOrEqual(2);
    const claudeAcc = snapshot.accounts.find((a) => a.name === 'Claude')!;
    const opencodeAcc = snapshot.accounts.find((a) => a.name === 'OpenCode')!;
    expect(claudeAcc).toBeDefined();
    expect(claudeAcc.usage?.noQuota).toBe(false);
    expect(opencodeAcc).toBeDefined();
    expect(opencodeAcc.usage?.noQuota).toBe(true); // 1q03 has state 'quota'
    expect(claudeAcc.tokensToday).toBe(987654);

    // 5. Rooms = projects
    expect(snapshot.rooms.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.rooms.some((r) => r.name === 'bakchich / New fee engine')).toBe(true);
    expect(snapshot.rooms.some((r) => r.name === 'bakchich / Support bot')).toBe(true);

    // 6. Inbox options normalized
    expect(snapshot.inbox).toHaveLength(1);
    expect(snapshot.inbox![0].options[0].label).toContain('(Recommended)');
  });

  it('generates feed items for state changes across polls and preserves room slots', () => {
    const prevData: FactoryOfficeResponse = {
      agents: [
        {
          hc: '1a3f',
          product: 'bakchich',
          project: 'New fee engine',
          state: 'running',
        },
        {
          hc: '2b07',
          product: 'bakchich',
          project: 'Support bot',
          state: 'running',
        },
      ],
    };
    const { snapshot: prevSnap } = mapFactoryDataToSnapshot(prevData, null, 10_000);
    const room0Slot = prevSnap.rooms.find((r) => r.name === 'bakchich / New fee engine')!.slot;

    // Next poll: 1a3f is done (leaves), 2b07 becomes waiting
    const nextData: FactoryOfficeResponse = {
      agents: [
        {
          hc: '1a3f',
          product: 'bakchich',
          project: 'New fee engine',
          state: 'done',
        },
        {
          hc: '2b07',
          product: 'bakchich',
          project: 'Support bot',
          state: 'waiting',
        },
        {
          hc: '3x10',
          product: 'clip2earn',
          project: 'Clip2Earn V2',
          state: 'running',
        },
      ],
    };
    const { snapshot: nextSnap, feedItems } = mapFactoryDataToSnapshot(nextData, prevSnap, 20_000);

    // Slot preserved
    const nextRoom0 = nextSnap.rooms.find((r) => r.name === 'bakchich / New fee engine')!;
    expect(nextRoom0.slot).toBe(room0Slot);

    // Feeds generated
    const finishedFeed = feedItems.find((f) => f.activity?.text.includes('1a3f finished'));
    const waitingFeed = feedItems.find((f) => f.activity?.text.includes('2b07 is waiting on you'));
    expect(finishedFeed).toBeDefined();
    expect(waitingFeed).toBeDefined();
  });
});
