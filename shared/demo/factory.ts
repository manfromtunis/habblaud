// Factory Office simulator for prototype v2.
// Pure module (no Node/DOM APIs): runs in the browser and in tests.
// Generates the factory's world: 9 projects (rooms), ~18 agents (handles like 1a3f, 2b07, 3c11),
// providers Claude, Antigravity, OpenCode as accounts, and factory states mapped onto Habblaud states.

import type {
  AccountInfo,
  AccountUsage,
  Activity,
  AgentInfo,
  AgentStats,
  FeedItem,
  Notice,
  OfficeSnapshot,
  PermissionDecision,
  PermissionRequestInfo,
  RoomInfo,
  TaskItem,
} from '../types';
import { hash32, mulberry32 } from '../hash';
import type { DemoOptions, DemoTickResult } from './simulator';

export interface FactoryProject {
  id: string;
  product: 'bakchich' | 'aurastack' | 'clip2earn' | 'factory' | 'kick-yt';
  projectName: string;
  name: string;
  path: string;
  slot: number;
}

export const FACTORY_PROJECTS: readonly FactoryProject[] = [
  {
    id: 'factory:bakchich/new-fee-engine',
    product: 'bakchich',
    projectName: 'New fee engine',
    name: 'bakchich / New fee engine',
    path: '/home/melek-code/github/bakchich-monorepo/fee-engine',
    slot: 0,
  },
  {
    id: 'factory:bakchich/support-bot',
    product: 'bakchich',
    projectName: 'Support bot',
    name: 'bakchich / Support bot',
    path: '/home/melek-code/github/bakchich-monorepo/support-bot',
    slot: 1,
  },
  {
    id: 'factory:bakchich/black-friday-2026',
    product: 'bakchich',
    projectName: 'Black Friday 2026',
    name: 'bakchich / Black Friday 2026',
    path: '/home/melek-code/github/bakchich-monorepo/campaigns/bf26',
    slot: 2,
  },
  {
    id: 'factory:aurastack/aurastack-store',
    product: 'aurastack',
    projectName: 'AuraStack store',
    name: 'aurastack / AuraStack store',
    path: '/home/melek-code/github/aurastack/storefront',
    slot: 3,
  },
  {
    id: 'factory:clip2earn/clip2earn-v2',
    product: 'clip2earn',
    projectName: 'Clip2Earn V2',
    name: 'clip2earn / Clip2Earn V2',
    path: '/home/melek-code/github/clip2earn',
    slot: 4,
  },
  {
    id: 'factory:factory/release-manager',
    product: 'factory',
    projectName: 'Release manager',
    name: 'factory / Release manager',
    path: '/home/melek-code/github/software-factory/release-mgr',
    slot: 5,
  },
  {
    id: 'factory:factory/software-factory',
    product: 'factory',
    projectName: 'Software factory',
    name: 'factory / Software factory',
    path: '/home/melek-code/github/software-factory',
    slot: 6,
  },
  {
    id: 'factory:kick-yt/kick-to-youtube',
    product: 'kick-yt',
    projectName: 'Kick to YouTube',
    name: 'kick-yt / Kick to YouTube',
    path: '/home/melek-code/github/kick-to-youtube',
    slot: 7,
  },
  {
    id: 'factory:bakchich/design-system',
    product: 'bakchich',
    projectName: 'Design system',
    name: 'bakchich / Design system',
    path: '/home/melek-code/github/bakchich-monorepo/design-system',
    slot: 8,
  },
];

interface AgentSpec {
  handle: string;
  roomIndex: number;
  account: '.claude' | '.antigravity' | '.opencode';
  kind: 'main' | 'sub';
  parentHandle?: string;
  factoryState: 'running' | 'waiting' | 'failed' | 'stalled' | 'quota';
  activityText: string;
  activityKind: Activity['kind'];
  activityIcon: string;
  activityError?: boolean;
  model: string;
  gitBranch: string;
  title: string;
  waitingFor?: string;
  permission?: {
    id: string;
    tool: string;
    title: string;
    text: string;
    icon: string;
    questionHeader?: string;
    questionText?: string;
    options?: string[];
  };
}

const AGENT_SPECS: readonly AgentSpec[] = [
  // Room 0: bakchich / New fee engine
  {
    handle: '1a3f',
    roomIndex: 0,
    account: '.claude',
    kind: 'main',
    factoryState: 'running',
    activityText: 'Editing fee_calculator.py',
    activityKind: 'edit',
    activityIcon: '✏️',
    model: 'claude-sonnet-5-5',
    gitBranch: 'feat/fee-engine',
    title: 'New fee calculation engine',
  },
  {
    handle: '3c11',
    roomIndex: 0,
    account: '.claude',
    kind: 'sub',
    parentHandle: '1a3f',
    factoryState: 'running',
    activityText: 'Parsing tier_rates.json',
    activityKind: 'read',
    activityIcon: '📄',
    model: 'claude-opus-5-5',
    gitBranch: 'feat/fee-engine',
    title: 'Tier rate JSON parser',
  },
  {
    handle: '1q03',
    roomIndex: 0,
    account: '.opencode',
    kind: 'main',
    factoryState: 'quota',
    activityText: 'Hit OpenCode quota, reset in 1h 10m',
    activityKind: 'wait',
    activityIcon: '☕',
    model: 'deepseek-v4-pro',
    gitBranch: 'feat/fee-engine',
    title: 'Fee tier benchmarks',
  },

  // Room 1: bakchich / Support bot
  {
    handle: '2b07',
    roomIndex: 1,
    account: '.claude',
    kind: 'main',
    factoryState: 'waiting',
    activityText: 'Stripe webhook approval',
    activityKind: 'ask',
    activityIcon: '✋',
    model: 'claude-opus-5-5',
    gitBranch: 'fix/stripe-webhooks',
    title: 'Support bot webhook handler',
    waitingFor: 'Awaiting owner confirmation on Stripe webhook signature',
    permission: {
      id: 'perm-2b07',
      tool: 'Bash',
      title: 'Stripe webhook signature check',
      text: 'Stripe webhook signature check: accept legacy v1 header?',
      icon: '✋',
      questionHeader: 'Webhook signature',
      questionText: 'Accept legacy v1 header alongside v2?',
      options: [
        'Accept v1 and v2 simultaneously (Recommended)',
        'Reject v1, require v2 headers only',
        'Request more context from agent',
      ],
    },
  },
  {
    handle: '1d42',
    roomIndex: 1,
    account: '.opencode',
    kind: 'main',
    factoryState: 'running',
    activityText: 'Indexing faq_vectors.db',
    activityKind: 'run',
    activityIcon: '⚡',
    model: 'deepseek-v4-pro',
    gitBranch: 'feat/vector-faq',
    title: 'FAQ vector indexing',
  },

  // Room 2: bakchich / Black Friday 2026
  {
    handle: '2f18',
    roomIndex: 2,
    account: '.antigravity',
    kind: 'main',
    factoryState: 'running',
    activityText: 'Running stress test suite',
    activityKind: 'test',
    activityIcon: '🧪',
    model: 'gemini-3.8-flash-high',
    gitBranch: 'campaign/bf26',
    title: 'Black Friday stress test',
  },
  {
    handle: '1e90',
    roomIndex: 2,
    account: '.opencode',
    kind: 'main',
    factoryState: 'stalled',
    activityText: 'Silent 2 h+: awaiting Redis cluster response',
    activityKind: 'wait',
    activityIcon: '💤',
    model: 'deepseek-v4-pro',
    gitBranch: 'campaign/bf26',
    title: 'Redis cluster cache warmup',
  },

  // Room 3: aurastack / AuraStack store
  {
    handle: '2a14',
    roomIndex: 3,
    account: '.claude',
    kind: 'main',
    factoryState: 'running',
    activityText: 'Refactoring cart_store.ts',
    activityKind: 'edit',
    activityIcon: '✏️',
    model: 'claude-opus-5-5',
    gitBranch: 'refactor/cart-store',
    title: 'AuraStack cart overhaul',
  },
  {
    handle: '3b55',
    roomIndex: 3,
    account: '.antigravity',
    kind: 'sub',
    parentHandle: '2a14',
    factoryState: 'running',
    activityText: 'Generating mock products',
    activityKind: 'run',
    activityIcon: '✨',
    model: 'claude-opus-4-6-thinking',
    gitBranch: 'refactor/cart-store',
    title: 'Mock product generator',
  },
  {
    handle: '1c88',
    roomIndex: 3,
    account: '.claude',
    kind: 'main',
    factoryState: 'failed',
    activityText: 'Type mismatch in checkout.ts:42',
    activityKind: 'error',
    activityIcon: '❌',
    activityError: true,
    model: 'claude-sonnet-5-5',
    gitBranch: 'fix/checkout-types',
    title: 'Checkout type resolution',
  },

  // Room 4: clip2earn / Clip2Earn V2
  {
    handle: '1f33',
    roomIndex: 4,
    account: '.claude',
    kind: 'main',
    factoryState: 'running',
    activityText: 'Transcoding sample reels',
    activityKind: 'run',
    activityIcon: '🎬',
    model: 'claude-sonnet-5-5',
    gitBranch: 'feat/reels-transcode',
    title: 'Sample reel transcoding',
  },
  {
    handle: '2c44',
    roomIndex: 4,
    account: '.opencode',
    kind: 'main',
    factoryState: 'running',
    activityText: 'Writing ffmpeg filter graph',
    activityKind: 'edit',
    activityIcon: '✏️',
    model: 'beam-free',
    gitBranch: 'feat/ffmpeg-filters',
    title: 'FFmpeg filter graph pipeline',
  },

  // Room 5: factory / Release manager
  {
    handle: '1b62',
    roomIndex: 5,
    account: '.claude',
    kind: 'main',
    factoryState: 'running',
    activityText: 'Generating changelog.md',
    activityKind: 'write',
    activityIcon: '📝',
    model: 'claude-sonnet-5-5',
    gitBranch: 'release/v2.4',
    title: 'Release changelog generator',
  },
  {
    handle: '2e77',
    roomIndex: 5,
    account: '.claude',
    kind: 'main',
    factoryState: 'waiting',
    activityText: 'Deploy sign-off',
    activityKind: 'ask',
    activityIcon: '✋',
    model: 'claude-opus-5-5',
    gitBranch: 'release/v2.4',
    title: 'v2.4 release verification',
    waitingFor: 'Needs owner sign-off for v2.4 production deploy',
    permission: {
      id: 'perm-2e77',
      tool: 'Bash',
      title: 'Production deploy v2.4',
      text: 'Deploy factory v2.4 to production cluster?',
      icon: '✋',
      questionHeader: 'Deployment',
      questionText: 'Deploy factory v2.4 to production cluster?',
      options: [
        'Approve immediate deployment (Recommended)',
        'Hold deployment pending QA checks',
        'Cancel release',
      ],
    },
  },

  // Room 6: factory / Software factory
  {
    handle: '1a10',
    roomIndex: 6,
    account: '.claude',
    kind: 'main',
    factoryState: 'running',
    activityText: 'Building docker images',
    activityKind: 'run',
    activityIcon: '🐳',
    model: 'claude-opus-5-5',
    gitBranch: 'infra/containers',
    title: 'Container image build pipeline',
  },
  {
    handle: '3d88',
    roomIndex: 6,
    account: '.claude',
    kind: 'sub',
    parentHandle: '1a10',
    factoryState: 'running',
    activityText: 'Running linter checks',
    activityKind: 'test',
    activityIcon: '🔍',
    model: 'claude-opus-5-5',
    gitBranch: 'infra/containers',
    title: 'Linter check suite',
  },

  // Room 7: kick-yt / Kick to YouTube
  {
    handle: '2k89',
    roomIndex: 7,
    account: '.antigravity',
    kind: 'main',
    factoryState: 'running',
    activityText: 'Streaming rtmp chunk ingest',
    activityKind: 'run',
    activityIcon: '📡',
    model: 'gemini-3.8-flash-high',
    gitBranch: 'stream/rtmp-sync',
    title: 'RTMP stream ingestion pipeline',
  },
  {
    handle: '1k05',
    roomIndex: 7,
    account: '.claude',
    kind: 'main',
    factoryState: 'quota',
    activityText: 'Hit Claude rate limit, reset in 42m',
    activityKind: 'wait',
    activityIcon: '☕',
    model: 'claude-sonnet-5-5',
    gitBranch: 'stream/rtmp-sync',
    title: 'Stream sync health checks',
  },

  // Room 8: bakchich / Design system
  {
    handle: '2d91',
    roomIndex: 8,
    account: '.antigravity',
    kind: 'main',
    factoryState: 'running',
    activityText: 'Auditing token contrast ratios',
    activityKind: 'test',
    activityIcon: '🎨',
    model: 'gemini-3.8-flash-high',
    gitBranch: 'ds/tokens',
    title: 'Color token accessibility audit',
  },
];

const INITIAL_FEEDS: readonly string[] = [
  '2b07 opened PR #70',
  '1a3f is waiting on you',
  '2e77 is waiting on you',
  '2f18 opened PR #69',
  '1a10 completed build',
];

const TICK_ACTIVITIES: readonly {
  text: string;
  kind: Activity['kind'];
  icon: string;
  feedTemplate: (name: string) => string;
}[] = [
  { text: 'Editing digest.py', kind: 'edit', icon: '✏️', feedTemplate: (n) => `${n} edited digest.py` },
  { text: 'Running tests', kind: 'test', icon: '🧪', feedTemplate: (n) => `${n} started test runner` },
  { text: 'Refactoring auth handler', kind: 'edit', icon: '⚡', feedTemplate: (n) => `${n} updated auth handler` },
  { text: 'Reviewing pull request', kind: 'read', icon: '👀', feedTemplate: (n) => `${n} reviewed PR` },
  { text: 'Optimizing database queries', kind: 'edit', icon: '🚀', feedTemplate: (n) => `${n} optimized db query` },
];

export class FactorySimulator {
  private rng: () => number;
  private speed: number;
  private rev = 0;
  private dirty = true;
  private seq = 0;
  private startedAt: number;
  private rooms = new Map<string, RoomInfo>();
  private agents = new Map<string, AgentInfo>();
  private nextTickAt: number;
  private pendingFeed: FeedItem[] = [];
  private pendingNotices: Notice[] = [];
  private tickStep = 0;

  constructor(opts: DemoOptions = {}, now = Date.now()) {
    this.rng = mulberry32(opts.seed ?? hash32(`factory:${now}`));
    this.speed = opts.speed ?? 1;
    this.startedAt = now;
    this.nextTickAt = now + 20_000 / this.speed;

    // 1. Build the 9 rooms
    for (const p of FACTORY_PROJECTS) {
      const room: RoomInfo = {
        id: p.id,
        name: p.name,
        path: p.path,
        slot: p.slot,
        seed: hash32(p.id),
        createdAt: now,
      };
      this.rooms.set(p.id, room);
    }

    // 2. Build initial ~18 agents
    for (const spec of AGENT_SPECS) {
      const project = FACTORY_PROJECTS[spec.roomIndex];
      const agentId = `factory:agent:${spec.handle}`;
      const isSub = spec.kind === 'sub';
      const parentId = isSub && spec.parentHandle ? `factory:agent:${spec.parentHandle}` : undefined;

      // Status mapping
      let status: AgentInfo['status'] = 'working';
      if (spec.factoryState === 'waiting') status = 'waiting';
      else if (spec.factoryState === 'stalled' || spec.factoryState === 'quota') status = 'idle';
      else if (spec.factoryState === 'running' || spec.factoryState === 'failed') status = 'working';

      const activity: Activity = {
        id: `act-${++this.seq}`,
        kind: spec.activityKind,
        icon: spec.activityIcon,
        text: spec.activityText,
        at: now - Math.floor(this.rng() * 300_000),
        error: spec.activityError,
      };

      const tasks: TaskItem[] = [
        { id: '1', title: spec.title, status: status === 'idle' ? 'completed' : 'in_progress' },
      ];

      const stats: AgentStats = {
        toolCalls: 12 + Math.floor(this.rng() * 40),
        tokensIn: 80_000 + Math.floor(this.rng() * 300_000),
        tokensOut: 2_000 + Math.floor(this.rng() * 20_000),
        linesAdded: 45 + Math.floor(this.rng() * 120),
        linesRemoved: 10 + Math.floor(this.rng() * 40),
        subagents: isSub ? 0 : spec.handle === '1a3f' || spec.handle === '2a14' || spec.handle === '1a10' ? 1 : 0,
      };

      let permission: PermissionRequestInfo | undefined;
      if (spec.permission) {
        permission = {
          id: spec.permission.id,
          tool: spec.permission.tool,
          title: spec.permission.title,
          text: spec.permission.text,
          icon: spec.permission.icon,
          createdAt: now - 180_000,
          expiresAt: now + 600_000,
          questions: spec.permission.questionHeader && spec.permission.questionText && spec.permission.options
            ? [
                {
                  index: 0,
                  header: spec.permission.questionHeader,
                  question: spec.permission.questionText,
                  options: spec.permission.options.map((label, index) => ({ index, label })),
                },
              ]
            : undefined,
        };
      }

      const agent: AgentInfo = {
        id: agentId,
        kind: spec.kind,
        parentId,
        roomId: project.id,
        name: spec.handle,
        look: hash32(spec.handle) % 2 === 0 ? 'm' : 'f',
        role: isSub ? 'Subagent' : 'Main agent',
        title: spec.title,
        sessionId: `factory:sess:${spec.handle}`,
        account: spec.account,
        status,
        waitingFor: spec.waitingFor,
        permission,
        activity,
        recent: [activity],
        tasks,
        model: spec.model,
        gitBranch: spec.gitBranch,
        startedAt: now - (600_000 + Math.floor(this.rng() * 3_600_000)),
        lastEventAt: activity.at,
        statusSince: activity.at,
        stats,
        seed: hash32(spec.handle),
        background: isSub,
      };

      this.agents.set(agentId, agent);
    }

    // Clear initial pending feed/notices so opening tick doesn't replay them
    this.pendingFeed = [];
    this.pendingNotices = [];
    this.dirty = false;
  }

  snapshot(now = Date.now()): OfficeSnapshot {
    return {
      rev: this.rev,
      serverTime: now,
      rooms: [...this.rooms.values()].map((r) => ({ ...r })),
      agents: [...this.agents.values()].map((a) => structuredCloneAgent(a)),
      accounts: this.accountsInfo(now),
      meta: {
        demo: true,
        sources: [],
        startedAt: this.startedAt,
        version: 'factory',
      },
    };
  }

  tick(now: number): DemoTickResult {
    let changed = false;

    if (now >= this.nextTickAt) {
      this.nextTickAt = now + 20_000 / this.speed;
      changed = true;
      this.tickStep++;

      // Pick 1 or 2 agents to transition states or update activity
      const agentsList = [...this.agents.values()];
      const agent1 = agentsList[this.tickStep % agentsList.length];
      const agent2 = agentsList[(this.tickStep + 5) % agentsList.length];

      this.stepAgent(agent1, now);
      if (this.tickStep % 2 === 0) {
        this.stepAgent(agent2, now);
      }

      this.rev++;
      this.dirty = true;
    }

    const feed = this.pendingFeed;
    const notices = this.pendingNotices;
    this.pendingFeed = [];
    this.pendingNotices = [];

    return {
      changed: changed || this.dirty,
      feed,
      notices,
    };
  }

  private stepAgent(agent: AgentInfo, now: number): void {
    if (agent.status === 'waiting') {
      // Keep waiting agents stable unless clicked/decided, or transition occasionally
      return;
    }

    const actTemplate = TICK_ACTIVITIES[this.tickStep % TICK_ACTIVITIES.length];

    if (agent.status === 'idle') {
      // Idle agent starts working
      agent.status = 'working';
      agent.statusSince = now;
      agent.activity = {
        id: `act-${++this.seq}`,
        kind: actTemplate.kind,
        icon: actTemplate.icon,
        text: actTemplate.text,
        at: now,
      };
      agent.recent = [...agent.recent, agent.activity].slice(-30);
      agent.lastEventAt = now;
    } else {
      // Working agent either finishes or rotates activity
      if (this.tickStep % 4 === 0) {
        agent.status = 'idle';
        agent.statusSince = now;
        agent.activity = {
          id: `act-${++this.seq}`,
          kind: 'wait',
          icon: '☕',
          text: 'Resting between tasks',
          at: now,
        };
      } else {
        agent.activity = {
          id: `act-${++this.seq}`,
          kind: actTemplate.kind,
          icon: actTemplate.icon,
          text: actTemplate.text,
          at: now,
        };
      }
      agent.recent = [...agent.recent, agent.activity].slice(-30);
      agent.lastEventAt = now;
    }

    // Push English feed item
    const room = this.rooms.get(agent.roomId);
    const feedItem: FeedItem = {
      id: `feed-${++this.seq}`,
      agentId: agent.id,
      roomId: agent.roomId,
      agentName: agent.name,
      roomName: room?.name ?? '',
      account: agent.account,
      activity: agent.activity,
    };
    this.pendingFeed.push(feedItem);
  }

  decidePermission(requestId: string, d: PermissionDecision, now = Date.now()): boolean {
    const agent = [...this.agents.values()].find((a) => a.permission?.id === requestId);
    if (!agent || agent.status !== 'waiting') return false;

    delete agent.permission;
    agent.waitingFor = undefined;
    agent.status = 'working';
    agent.statusSince = now;

    const behavior = d.behavior;
    const actText = behavior === 'allow'
      ? 'Approved in Office'
      : behavior === 'answer'
        ? 'Answered in Office'
        : 'Declined in Office';
    const actIcon = behavior === 'deny' ? '🚫' : '✅';

    agent.activity = {
      id: `act-${++this.seq}`,
      kind: 'other',
      icon: actIcon,
      text: actText,
      detail: d.message,
      at: now,
    };
    agent.recent = [...agent.recent, agent.activity].slice(-30);
    agent.lastEventAt = now;

    const room = this.rooms.get(agent.roomId);
    this.pendingFeed.push({
      id: `feed-${++this.seq}`,
      agentId: agent.id,
      roomId: agent.roomId,
      agentName: agent.name,
      roomName: room?.name ?? '',
      account: agent.account,
      activity: agent.activity,
    });

    this.pendingNotices.push({
      id: `notice-${++this.seq}`,
      level: behavior === 'deny' ? 'warn' : 'success',
      text: `${actIcon} ${agent.name} resumed work (${actText})`,
      agentId: agent.id,
      roomId: agent.roomId,
      at: now,
    });

    this.rev++;
    this.dirty = true;
    return true;
  }

  receiveMessage(agentId: string, text: string, now = Date.now()): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.kind !== 'main') return false;

    agent.activity = {
      id: `act-${++this.seq}`,
      kind: 'communicate',
      icon: '💬',
      text: `Message: ${text.slice(0, 30)}`,
      detail: text,
      at: now,
    };
    agent.recent = [...agent.recent, agent.activity].slice(-30);
    agent.lastEventAt = now;
    this.rev++;
    this.dirty = true;
    return true;
  }

  private accountsInfo(now: number): AccountInfo[] {
    const countSessions = (accId: string) =>
      [...this.agents.values()].filter((a) => a.kind === 'main' && a.account === accId && a.status !== 'offline').length;

    const claudeUsage: AccountUsage = {
      fiveHour: { utilization: 48, resetsAt: now + 2.5 * 3_600_000 },
      sevenDay: { utilization: 65, resetsAt: now + 3 * 24 * 3_600_000 },
      source: 'statusline',
      fetchedAt: now,
    };

    const antigravityUsage: AccountUsage = {
      fiveHour: { utilization: 24, resetsAt: now + 1.8 * 3_600_000 },
      sevenDay: { utilization: 32, resetsAt: now + 4 * 24 * 3_600_000 },
      source: 'statusline',
      fetchedAt: now,
    };

    const opencodeUsage: AccountUsage = {
      noQuota: true,
      source: 'statusline',
      fetchedAt: now,
    };

    return [
      {
        id: '.claude',
        short: 'C',
        name: 'Claude',
        plan: 'Max',
        color: '#f08a3c',
        configDir: '~/.claude',
        sessions: countSessions('.claude'),
        usage: claudeUsage,
        usageStatus: 'ok',
      },
      {
        id: '.antigravity',
        short: 'AG',
        name: 'Antigravity',
        plan: 'Pro',
        color: '#4aa8e8',
        configDir: '~/.antigravity',
        sessions: countSessions('.antigravity'),
        usage: antigravityUsage,
        usageStatus: 'ok',
      },
      {
        id: '.opencode',
        short: 'OC',
        name: 'OpenCode',
        plan: 'Team',
        color: '#a77bf3',
        configDir: '~/.opencode',
        sessions: countSessions('.opencode'),
        usage: opencodeUsage,
        usageStatus: 'ok',
      },
    ];
  }
}

function structuredCloneAgent(a: AgentInfo): AgentInfo {
  const c: AgentInfo = {
    ...a,
    recent: a.recent.slice(),
    tasks: a.tasks.map((t) => ({ ...t })),
    stats: { ...a.stats },
    activity: a.activity ? { ...a.activity } : undefined,
  };
  if (a.shells) c.shells = a.shells.map((j) => ({ ...j }));
  if (a.permission) {
    c.permission = {
      ...a.permission,
      suggestions: a.permission.suggestions?.map((s) => ({ ...s, rules: s.rules.slice() })),
    };
    if (a.permission.questions) {
      c.permission.questions = a.permission.questions.map((q) => ({
        ...q,
        options: q.options.map((o) => ({ ...o })),
      }));
    }
  }
  return c;
}
