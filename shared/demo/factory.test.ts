import { describe, expect, it } from 'vitest';
import {
  FactorySimulator,
  FACTORY_PROJECTS,
  mapFactoryDataToSnapshot,
  formatMachineLastSeen,
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
      'ClipHub V2',
      'Release manager',
      'Software factory',
      'ShopKit store',
      'Stream clipper',
      'Design system',
    ];

    for (const proj of expectedProjects) {
      const room = snap.rooms.find((r) => r.name.includes(proj));
      expect(room, `Room for project "${proj}" should exist`).toBeDefined();
    }

    // Verify room names carry the product (payapp, shopkit, cliphub, factory, clipper)
    const expectedProducts = ['payapp', 'shopkit', 'cliphub', 'factory', 'clipper'];
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

    // Applied items have real options (never hardcoded seen)
    for (const item of applied) {
      expect(item.options.length).toBeGreaterThanOrEqual(1);
      expect(item.options.some((o) => o.key === 'seen')).toBe(false);
    }

    // Items from waiting agents (2b07, 2e77)
    const from2b07 = snap.inbox!.find((i) => i.from === '2b07');
    const from2e77 = snap.inbox!.find((i) => i.from === '2e77');
    expect(from2b07).toBeDefined();
    expect(from2e77).toBeDefined();
  });

  it('answering frees the waiting agent and records answer in answers dictionary', () => {
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
    expect(snapAfter.answers!['a538']).toBeDefined();
    expect(snapAfter.answers!['a538'].choice).toBe('v1v2');
    expect(snapAfter.inbox!.find((i) => i.id === 'a538')).toBeDefined();

    // Agent freed
    const agentAfter = snapAfter.agents.find((a) => a.name === '2b07')!;
    expect(agentAfter.status).toBe('working');
    expect(agentAfter.permission).toBeUndefined();
  });

  it('applied items can be answered and recorded in answers', () => {
    const start = 10_000;
    const sim = new FactorySimulator({ seed: 42 }, start);

    const ok = sim.answerInbox('e204', 'ack', undefined, start + 1_000);
    expect(ok).toBe(true);

    const snapAfter = sim.snapshot(start + 1_000);
    expect(snapAfter.answers!['e204']).toBeDefined();
    expect(snapAfter.answers!['e204'].choice).toBe('ack');
    expect(snapAfter.inbox!.find((i) => i.id === 'e204')).toBeDefined();
  });
});

describe('normalizeInboxOptions', () => {
  it('handles the factory store shape: [key, label] pairs, reco first', () => {
    const opts = normalizeInboxOptions([['sendback', 'Send back'], ['merge', 'Merge it']], 'merge');
    expect(opts.map((o) => o.key)).toEqual(['merge', 'sendback']);
    expect(opts[0].label).toBe('Merge it');
  });
  it('handles options as string array with reco parameter', () => {
    const raw = ['Option B', 'Option A', 'Option C'];
    const opts = normalizeInboxOptions(raw, '1');
    expect(opts).toHaveLength(3);
    expect(opts[0].label).toBe('Option A');
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
      { key: 'merge', label: 'Merge' },
    ];
    const opts = normalizeInboxOptions(raw, 'merge');
    expect(opts).toHaveLength(2);
    expect(opts[0].key).toBe('merge');
    expect(opts[1].key).toBe('hold');
  });

  it('handles options as object array with id and label (real factory shape)', () => {
    const raw = [
      { id: 'v1v2', label: 'Accept v1 and v2 simultaneously' },
      { id: 'v2only', label: 'Reject v1, require v2 headers only' },
    ];
    const opts = normalizeInboxOptions(raw, 'v1v2');
    expect(opts).toHaveLength(2);
    expect(opts[0].key).toBe('v1v2');
    expect(opts[1].key).toBe('v2only');
  });
});

describe('mapFactoryDataToSnapshot', () => {
  it('maps live rows to OfficeSnapshot properly', () => {
    const data: FactoryOfficeResponse = {
      builtAt: '2026-11-07T16:20:02Z',
      machine: { id: 'm1', label: 'factory-prod-1' },
      projects: [
        { id: 'proj-fee', product: 'core', name: 'Billing engine' },
        { id: 'proj-supp', product: 'core', name: 'Support service' },
      ],
      agents: [
        {
          hc: '1a3f',
          provider: 'claude',
          model: 'claude-sonnet-5-5',
          product: 'core',
          project: 'proj-fee',
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
          product: 'core',
          project: 'proj-supp',
          state: 'waiting',
          waiting_for: 'Webhook signature check',
          parent: '1a3f',
          canReceive: false,
          thread: 'thread-2b07',
        },
        {
          hc: '1q03',
          provider: 'opencode',
          product: 'core',
          project: 'proj-fee',
          state: 'quota',
        },
        {
          hc: '9z99',
          provider: 'claude',
          product: 'core',
          project: 'proj-fee',
          state: 'done', // Should be omitted!
        },
        {
          hc: '4f44',
          provider: 'claude',
          product: 'core',
          project: 'proj-fee',
          state: 'failed', // a failed run: not working
          task: 'Old failed build',
        },
      ],
      tokens: { today: 987654 },
      inbox: [
        {
          id: 'i1',
          kind: 'urgent',
          title: 'Approve legacy signature',
          context: 'Needs review',
          options: [
            ['opt1', 'Reject'],
            ['opt2', 'Accept'],
          ],
          reco: 'opt2',
          project: 'proj-supp',
          from: '2b07',
          at: '2026-11-07T16:00:00Z',
        },
      ],
      answers: {
        i0: {
          choice: 'yes',
          note: 'Done',
          at: '2026-11-07T16:10:00Z',
        },
      },
    };

    const { snapshot, feedItems } = mapFactoryDataToSnapshot(data, null, 1714000000000);

    // failed runs are not counted as working; inbox items show the project name, not its id
    expect(snapshot.agents.find((a) => a.name === '4f44')?.status).toBe('idle');
    expect(snapshot.inbox?.[0].project).toBe('Support service');

    // 1. Building name from machine.label
    expect(snapshot.meta.buildingName).toBe('factory-prod-1');

    // 2. Agents in 'done' leave
    expect(snapshot.agents).toHaveLength(4);
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
    expect(agent2b07.waitingFor).toBe('Webhook signature check');
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
    expect(snapshot.rooms.some((r) => r.name === 'Billing engine')).toBe(true);
    expect(snapshot.rooms.some((r) => r.name === 'Support service')).toBe(true);

    // 6. Inbox options normalized
    expect(snapshot.inbox).toHaveLength(1);
    expect(snapshot.inbox![0].options[0].key).toBe('opt2');
    expect(snapshot.answers!['i0']).toBeDefined();
    expect(snapshot.answers!['i0'].choice).toBe('yes');
  });

  it('generates feed items for state changes across polls and preserves room slots', () => {
    const prevData: FactoryOfficeResponse = {
      projects: [
        { id: 'proj-fee', product: 'core', name: 'Billing engine' },
        { id: 'proj-supp', product: 'core', name: 'Support service' },
      ],
      agents: [
        {
          hc: '1a3f',
          product: 'core',
          project: 'proj-fee',
          state: 'running',
        },
        {
          hc: '2b07',
          product: 'core',
          project: 'proj-supp',
          state: 'running',
        },
      ],
    };
    const { snapshot: prevSnap } = mapFactoryDataToSnapshot(prevData, null, 10_000);
    const room0Slot = prevSnap.rooms.find((r) => r.name === 'Billing engine')!.slot;

    // Next poll: 1a3f is done (leaves), 2b07 becomes waiting
    const nextData: FactoryOfficeResponse = {
      projects: [
        { id: 'proj-fee', product: 'core', name: 'Billing engine' },
        { id: 'proj-supp', product: 'core', name: 'Support service' },
        { id: 'proj-media', product: 'media', name: 'Media processor' },
      ],
      agents: [
        {
          hc: '1a3f',
          product: 'core',
          project: 'proj-fee',
          state: 'done',
        },
        {
          hc: '2b07',
          product: 'core',
          project: 'proj-supp',
          state: 'waiting',
        },
        {
          hc: '3x10',
          product: 'media',
          project: 'proj-media',
          state: 'running',
        },
      ],
    };
    const { snapshot: nextSnap, feedItems } = mapFactoryDataToSnapshot(nextData, prevSnap, 20_000);

    // Slot preserved
    const nextRoom0 = nextSnap.rooms.find((r) => r.name === 'Billing engine')!;
    expect(nextRoom0.slot).toBe(room0Slot);

    // Feeds generated
    const finishedFeed = feedItems.find((f) => f.activity?.text.includes('1a3f finished'));
    const waitingFeed = feedItems.find((f) => f.activity?.text.includes('2b07 is waiting on you'));
    expect(finishedFeed).toBeDefined();
    expect(waitingFeed).toBeDefined();
  });

  describe('machine scoping and offline handling (v4)', () => {
    const testMachines = [
      { id: 'vps', label: 'vps', online: true },
      { id: 'laptop', label: 'laptop', online: true },
      { id: 'desktop', label: 'desktop', online: false, lastSeen: new Date(Date.now() - 7_200_000).toISOString() },
    ];

    const baseData: FactoryOfficeResponse = {
      machines: testMachines,
      projects: [
        { id: 'proj-fee', product: 'core', name: 'Billing engine' },
        { id: 'proj-supp', product: 'core', name: 'Support service' },
      ],
      agents: [
        {
          hc: '1a3f',
          provider: 'claude',
          product: 'core',
          project: 'proj-fee',
          state: 'running',
          machine: 'vps',
        },
        {
          hc: '2b07',
          provider: 'claude',
          product: 'core',
          project: 'proj-fee',
          state: 'running',
          machine: 'vps',
        },
        {
          hc: '3c11',
          provider: 'claude',
          product: 'core',
          project: 'proj-supp',
          state: 'running',
          machine: 'laptop',
        },
      ],
    };

    it('filter by machine: scopes agents, rooms, and buildingName', () => {
      const { snapshot } = mapFactoryDataToSnapshot(baseData, null, Date.now(), false, 'laptop');

      expect(snapshot.meta.buildingName).toBe('laptop');
      expect(snapshot.meta.selectedMachine).toBe('laptop');
      expect(snapshot.meta.offlineMachine).toBeNull();

      // Only laptop agent
      expect(snapshot.agents).toHaveLength(1);
      expect(snapshot.agents[0].name).toBe('3c11');
      expect(snapshot.agents[0].machine).toBe('laptop');

      // Rooms scoped to laptop projects
      expect(snapshot.rooms).toHaveLength(1);
      expect(snapshot.rooms[0].name).toBe('Support service');

      // Machine live agent counts calculated
      expect(snapshot.machines).toBeDefined();
      const vpsMachine = snapshot.machines!.find((m) => m.id === 'vps')!;
      const laptopMachine = snapshot.machines!.find((m) => m.id === 'laptop')!;
      const desktopMachine = snapshot.machines!.find((m) => m.id === 'desktop')!;

      expect(vpsMachine.agentCount).toBe(2);
      expect(laptopMachine.agentCount).toBe(1);
      expect(desktopMachine.agentCount).toBe(0);
    });

    it('offline machine: shows empty building, 0 agents, 0 rooms, and offlineMachine meta', () => {
      const { snapshot } = mapFactoryDataToSnapshot(baseData, null, Date.now(), false, 'desktop');

      expect(snapshot.meta.buildingName).toBe('desktop');
      expect(snapshot.meta.selectedMachine).toBe('desktop');
      expect(snapshot.meta.offlineMachine).toBeDefined();
      expect(snapshot.meta.offlineMachine?.id).toBe('desktop');
      expect(snapshot.meta.offlineMachine?.online).toBe(false);

      expect(snapshot.agents).toHaveLength(0);
      expect(snapshot.rooms).toHaveLength(0);
    });

    it('single-machine hides the switcher: snapshot.machines has 1 entry or none', () => {
      const singleMachineData: FactoryOfficeResponse = {
        machine: { id: 'vps', label: 'vps' },
        machines: [{ id: 'vps', label: 'vps', online: true }],
        projects: [{ id: 'proj-fee', product: 'core', name: 'Billing engine' }],
        agents: [{ hc: '1a3f', product: 'core', project: 'proj-fee', state: 'running' }],
      };

      const { snapshot } = mapFactoryDataToSnapshot(singleMachineData, null, Date.now());
      expect(snapshot.machines).toHaveLength(1);
      // Topbar hides switcher when machines <= 1
    });

    it('missing machine field: behaves backwards-compatibly as today', () => {
      const legacyData: FactoryOfficeResponse = {
        machine: { id: 'm1', label: 'legacy-host' },
        projects: [{ id: 'proj-fee', product: 'core', name: 'Billing engine' }],
        agents: [
          { hc: '1a3f', product: 'core', project: 'proj-fee', state: 'running' },
          { hc: '2b07', product: 'core', project: 'proj-fee', state: 'running' },
        ],
      };

      const { snapshot } = mapFactoryDataToSnapshot(legacyData, null, Date.now());
      expect(snapshot.meta.buildingName).toBe('legacy-host');
      expect(snapshot.agents).toHaveLength(2);
      expect(snapshot.rooms).toHaveLength(1);
      expect(snapshot.meta.selectedMachine).toBeNull();
      expect(snapshot.meta.offlineMachine).toBeNull();
    });

    it('room path fallback hyphenates whitespace in the project id', () => {
      const { snapshot } = mapFactoryDataToSnapshot(
        { agents: [{ hc: '1a3f', product: 'core', project: 'my project x', state: 'running' }] },
        null,
        1_000,
      );
      expect(snapshot.rooms[0].path).toBe('~/code/core/my-project-x');
    });

    it('rooms keep their slot across building switches and emptied rooms', () => {
      const data: FactoryOfficeResponse = {
        ...baseData,
        projects: [...baseData.projects!, { id: 'proj-c', product: 'core', name: 'C' }],
        agents: [
          { hc: 'a1', provider: 'claude', product: 'core', project: 'proj-fee', state: 'running', machine: 'vps' },
          { hc: 'b1', provider: 'claude', product: 'core', project: 'proj-supp', state: 'running', machine: 'vps' },
          { hc: 'c1', provider: 'claude', product: 'core', project: 'proj-c', state: 'running', machine: 'laptop' },
        ],
      };
      const slots = (snap: { rooms: { name: string; slot: number }[] }) => Object.fromEntries(snap.rooms.map((r) => [r.name, r.slot]));
      const { snapshot: all0 } = mapFactoryDataToSnapshot(data, null, 1_000, false, null);
      const { snapshot: vps1 } = mapFactoryDataToSnapshot(data, all0, 2_000, false, 'vps');
      const emptied = { ...data, agents: data.agents!.map((a) => (a.hc === 'a1' ? { ...a, state: 'done' } : a)) };
      const { snapshot: vps2 } = mapFactoryDataToSnapshot(emptied, vps1, 3_000, false, 'vps');
      const { snapshot: all3 } = mapFactoryDataToSnapshot(data, vps2, 4_000, false, null);
      expect(slots(vps2)['Support service']).toBe(slots(all0)['Support service']);
      expect(slots(all3)).toEqual(slots(all0));
    });

    it('feed stays factory-wide: switching machine emits no finished items', () => {
      const { snapshot: onVps } = mapFactoryDataToSnapshot(baseData, null, 1_000, false, 'vps');
      const { feedItems, snapshot } = mapFactoryDataToSnapshot(baseData, onVps, 2_000, false, 'laptop');
      expect(snapshot.agents.map((a) => a.name)).toEqual(['3c11']);
      expect(feedItems).toEqual([]);
    });

    it('feed stays factory-wide: an agent finishing on another machine still emits while a machine is selected', () => {
      const { snapshot: first } = mapFactoryDataToSnapshot(baseData, null, 1_000, false, 'laptop');
      const next: FactoryOfficeResponse = {
        ...baseData,
        agents: baseData.agents!.map((a) => (a.hc === '1a3f' ? { ...a, state: 'done' } : a.hc === '2b07' ? { ...a, state: 'waiting' } : a)),
      };
      const { feedItems, snapshot } = mapFactoryDataToSnapshot(next, first, 2_000, false, 'laptop');
      expect(snapshot.agents.map((a) => a.name)).toEqual(['3c11']);
      const texts = feedItems.map((f) => f.activity?.text);
      expect(texts).toContain('1a3f finished');
      expect(texts).toContain('2b07 is waiting on you');
      expect(feedItems.find((f) => f.agentName === '1a3f')?.roomName).toBe('Billing engine');
    });

    it('a subagent without a machine follows its parent: absent from a building without the parent', () => {
      const data: FactoryOfficeResponse = {
        ...baseData,
        agents: [...baseData.agents!, { hc: '9z99', provider: 'claude', product: 'core', project: 'proj-fee', state: 'running', parent: '1a3f' }],
      };
      const vps = mapFactoryDataToSnapshot(data, null, 1_000, false, 'vps').snapshot;
      const laptop = mapFactoryDataToSnapshot(data, null, 1_000, false, 'laptop').snapshot;
      expect(vps.agents.find((a) => a.name === '9z99')?.machine).toBe('vps');
      expect(laptop.agents.some((a) => a.name === '9z99')).toBe(false);
      expect(vps.machines!.find((m) => m.id === 'vps')!.agentCount).toBe(3);
    });

    it('unknown machine id is treated as All', () => {
      const { snapshot } = mapFactoryDataToSnapshot(baseData, null, 1_000, false, 'ghost');
      expect(snapshot.meta.selectedMachine).toBe('all');
      expect(snapshot.meta.offlineMachine).toBeNull();
      expect(snapshot.agents).toHaveLength(3);
      expect(snapshot.rooms).toHaveLength(2);
    });

    it('formatMachineLastSeen formats ISO strings and epoch ms as a relative age, and keeps legacy text', () => {
      const now = Date.parse('2026-11-08T12:00:00Z');
      expect(formatMachineLastSeen('2026-11-08T10:00:00Z', now)).toBe('2 h');
      expect(formatMachineLastSeen('2026-11-08T11:55:00Z', now)).toBe('5 min');
      expect(formatMachineLastSeen(now - 3 * 86_400_000, now)).toBe('3 d');
      expect(formatMachineLastSeen('2 h ago', now)).toBe('2 h');
      expect(formatMachineLastSeen('last seen 4 min ago', now)).toBe('4 min');
      expect(formatMachineLastSeen(null, now)).toBe('');
    });

    it('FactorySimulator simulator switcher integration: vps, laptop, desktop, all', () => {
      const sim = new FactorySimulator({ seed: 42 }, 10_000);

      // Default All
      const snapAll = sim.snapshot(10_000);
      expect(snapAll.machines).toHaveLength(3);
      expect(snapAll.meta.buildingName).toBe('office-sim-1');
      expect(snapAll.agents.length).toBeGreaterThanOrEqual(18);

      // Laptop
      sim.setMachine('laptop');
      const snapLaptop = sim.snapshot(10_000);
      expect(snapLaptop.meta.buildingName).toBe('laptop');
      expect(snapLaptop.agents).toHaveLength(4); // includes subagent 3b55, which follows its parent 2a14
      expect(snapLaptop.agents.some((a) => a.name === '3b55')).toBe(true);
      expect(snapLaptop.agents.every((a) => a.machine === 'laptop')).toBe(true);

      // Desktop (offline)
      sim.setMachine('desktop');
      const snapDesktop = sim.snapshot(10_000);
      expect(snapDesktop.meta.buildingName).toBe('desktop');
      expect(snapDesktop.agents).toHaveLength(0);
      expect(snapDesktop.rooms).toHaveLength(0);
      expect(snapDesktop.meta.offlineMachine?.id).toBe('desktop');

      // Reset to All
      sim.setMachine(null);
      const snapReset = sim.snapshot(10_000);
      expect(snapReset.meta.buildingName).toBe('office-sim-1');
      expect(snapReset.agents.length).toBeGreaterThanOrEqual(18);
    });
  });
});
