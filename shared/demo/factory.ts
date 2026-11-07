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
  FactoryInboxItem,
  FactoryInboxKind,
  FactoryInboxOption,
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
    path: '~/code/bakchich-monorepo/fee-engine',
    slot: 0,
  },
  {
    id: 'factory:bakchich/support-bot',
    product: 'bakchich',
    projectName: 'Support bot',
    name: 'bakchich / Support bot',
    path: '~/code/bakchich-monorepo/support-bot',
    slot: 1,
  },
  {
    id: 'factory:bakchich/black-friday-2026',
    product: 'bakchich',
    projectName: 'Black Friday 2026',
    name: 'bakchich / Black Friday 2026',
    path: '~/code/bakchich-monorepo/campaigns/bf26',
    slot: 2,
  },
  {
    id: 'factory:aurastack/aurastack-store',
    product: 'aurastack',
    projectName: 'AuraStack store',
    name: 'aurastack / AuraStack store',
    path: '~/code/aurastack/storefront',
    slot: 3,
  },
  {
    id: 'factory:clip2earn/clip2earn-v2',
    product: 'clip2earn',
    projectName: 'Clip2Earn V2',
    name: 'clip2earn / Clip2Earn V2',
    path: '~/code/clip2earn',
    slot: 4,
  },
  {
    id: 'factory:factory/release-manager',
    product: 'factory',
    projectName: 'Release manager',
    name: 'factory / Release manager',
    path: '~/code/software-factory/release-mgr',
    slot: 5,
  },
  {
    id: 'factory:factory/software-factory',
    product: 'factory',
    projectName: 'Software factory',
    name: 'factory / Software factory',
    path: '~/code/software-factory',
    slot: 6,
  },
  {
    id: 'factory:kick-yt/kick-to-youtube',
    product: 'kick-yt',
    projectName: 'Kick to YouTube',
    name: 'kick-yt / Kick to YouTube',
    path: '~/code/kick-to-youtube',
    slot: 7,
  },
  {
    id: 'factory:bakchich/design-system',
    product: 'bakchich',
    projectName: 'Design system',
    name: 'bakchich / Design system',
    path: '~/code/bakchich-monorepo/design-system',
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

export const INITIAL_INBOX_SPECS: readonly Omit<FactoryInboxItem, 'at'>[] = [
  // 1. Urgent decision from waiting agent 2b07
  {
    id: 'a538',
    kind: 'urgent',
    title: 'Approve legacy Stripe webhook v1 fallback',
    context: 'Agent 2b07 needs confirmation on Stripe signature header.\nv1 header is deprecated but still received from older endpoints.\nRejecting may drop incoming payment callbacks.',
    options: [
      { key: 'v1v2', label: 'Accept v1 and v2 simultaneously (Recommended)' },
      { key: 'v2only', label: 'Reject v1, require v2 headers only' },
      { key: 'more_ctx', label: 'Request more context from agent' },
    ],
    project: 'bakchich / Support bot',
    from: '2b07',
  },
  // 2. Urgent decision (no agent)
  {
    id: 'c102',
    kind: 'urgent',
    title: 'Rotate staging API key for AuraStack',
    context: 'Sentry reported an exposed secret in staging logs.\nImmediate key rotation will invalidate active preview sessions.\nChoose key rotation window.',
    options: [
      { key: 'rotate_now', label: 'Rotate immediately and invalidate sessions (Recommended)' },
      { key: 'schedule', label: 'Schedule rotation in 30 minutes' },
    ],
    project: 'aurastack / AuraStack store',
    from: null,
  },
  // 3. Action item with numbered steps from waiting agent 2e77
  {
    id: 'd547',
    kind: 'action',
    title: 'Sign off v2.4 production deploy',
    context: '1. Verify migration idempotency on staging cluster\n2. Run smoke test suite on production cluster\n3. Promote docker image to live traffic',
    options: [
      { key: 'approve', label: 'Approve immediate deployment (Recommended)' },
      { key: 'hold', label: 'Hold deployment pending QA checks' },
      { key: 'cancel', label: 'Cancel release' },
    ],
    project: 'factory / Release manager',
    from: '2e77',
  },
  // 4. Action item with numbered steps (no agent)
  {
    id: 'b819',
    kind: 'action',
    title: 'Execute fee engine database backfill',
    context: '1. Lock tier_rates table for migration\n2. Backfill historical records for Q3 2026\n3. Validate checksums across 12 partitions',
    options: [
      { key: 'run_now', label: 'Execute backfill during off-peak window (Recommended)' },
      { key: 'dry_run', label: 'Run dry-run simulation only' },
    ],
    project: 'bakchich / New fee engine',
    from: null,
  },
  // 5. Merge ask
  {
    id: 'm701',
    kind: 'action',
    title: 'Merge factory#70: Support bot webhook handler',
    context: 'PR #70 passed all CI checks (3/3 passing).\nFixes Stripe signature verification bug and adds regression suite.\nReady to merge.',
    options: [
      { key: 'merge', label: 'Merge factory#70 into main (Recommended)' },
      { key: 'hold', label: 'Hold PR for manual review' },
    ],
    project: 'bakchich / Support bot',
    from: null,
  },
  // 6. Applied item (information, one option "Seen")
  {
    id: 'e204',
    kind: 'applied',
    title: 'Publish weekly support digest',
    context: 'Scanned 142 customer conversations in Chatwoot.\nTop 3 asks: dark mode fixes, invoice PDF export, webhook retries.\nDigest saved to factory data.',
    options: [{ key: 'seen', label: 'Seen' }],
    project: 'bakchich / Support bot',
    from: null,
  },
  // 7. Applied item (information, one option "Seen")
  {
    id: 'f311',
    kind: 'applied',
    title: 'Apply automated linter fixes',
    context: 'ESLint & Prettier formatted 38 files in docker/.\nAll commit hooks succeeded without syntax errors.\nNo manual intervention needed.',
    options: [{ key: 'seen', label: 'Seen' }],
    project: 'factory / Software factory',
    from: null,
  },
  // 8. Applied item (information, one option "Seen")
  {
    id: 'g452',
    kind: 'applied',
    title: 'Complete Redis cache warmup',
    context: 'Pre-loaded 45,000 product keys for Black Friday campaign.\nLatency dropped to 0.4ms across Europe-West nodes.\nMemory utilization at 34%.',
    options: [{ key: 'seen', label: 'Seen' }],
    project: 'bakchich / Black Friday 2026',
    from: null,
  },
];

export interface FactoryApiAgent {
  hc: string;
  who?: string;
  provider?: string;
  model?: string;
  via?: string;
  product?: string;
  project?: string;
  state?: string; // running, waiting, failed, quota, done, stalled, unknown
  t3Status?: string;
  since?: number;
  started_at?: number;
  tokens?: { today?: number } | number;
  task?: string;
  title?: string;
  branch?: string;
  waiting_for?: string;
  waitingFor?: string;
  thread?: string;
  parent?: string;
  canReceive?: boolean;
  can_receive?: boolean;
  activityText?: string;
  activityKind?: Activity['kind'];
  activityIcon?: string;
  activityError?: boolean;
  permission?: PermissionRequestInfo;
}

export interface FactoryApiInboxItem {
  id: string;
  kind: FactoryInboxKind;
  title: string;
  context: string;
  options: unknown; // string[] | FactoryInboxOption[] | Record<string, string>
  reco?: string | null;
  project: string;
  from?: string | null;
  thread?: string;
  at?: number;
}

export interface FactoryOfficeResponse {
  builtAt?: number;
  machine?: {
    id?: string;
    label?: string;
  };
  products?: Record<string, { name?: string }>;
  projects?: Array<{ id?: string; name?: string; product?: string; path?: string }>;
  agents?: FactoryApiAgent[];
  tokens?: { today?: number };
  provColors?: Record<string, string>;
  relayConfigured?: boolean;
  inbox?: FactoryApiInboxItem[];
}

export function normalizeInboxOptions(
  rawOptions: unknown,
  reco?: string | null,
): FactoryInboxOption[] {
  let list: FactoryInboxOption[] = [];
  if (Array.isArray(rawOptions)) {
    list = rawOptions.map((opt, i) => {
      if (typeof opt === 'string') {
        return { key: String(i), label: opt };
      } else if (Array.isArray(opt)) {
        // the factory stores options as [key, label] pairs
        return { key: String(opt[0] ?? i), label: String(opt[1] ?? opt[0] ?? i) };
      } else if (opt && typeof opt === 'object') {
        const o = opt as { key?: string; label?: string };
        const k = o.key !== undefined ? String(o.key) : String(i);
        const l = o.label !== undefined ? String(o.label) : String(o.key ?? i);
        return { key: k, label: l };
      }
      return { key: String(i), label: String(opt) };
    });
  } else if (rawOptions && typeof rawOptions === 'object') {
    list = Object.entries(rawOptions as Record<string, string>).map(([key, label]) => ({
      key,
      label: typeof label === 'string' ? label : String(label),
    }));
  }

  // Sort recommended first
  list.sort((a, b) => {
    const aReco = Boolean(
      (reco && (a.key === reco || a.label.includes(reco))) ||
      a.label.includes('(Recommended)')
    );
    const bReco = Boolean(
      (reco && (b.key === reco || b.label.includes(reco))) ||
      b.label.includes('(Recommended)')
    );
    if (aReco && !bReco) return -1;
    if (!aReco && bReco) return 1;
    return 0;
  });

  return list;
}

export function mapFactoryDataToSnapshot(
  data: FactoryOfficeResponse,
  prevSnapshot?: OfficeSnapshot | null,
  now = Date.now(),
): { snapshot: OfficeSnapshot; feedItems: FeedItem[]; notices: Notice[] } {
  const feedItems: FeedItem[] = [];
  const notices: Notice[] = [];
  let feedSeq = 0;

  // 1. Rooms
  const existingRooms = new Map<string, RoomInfo>();
  if (prevSnapshot?.rooms) {
    for (const r of prevSnapshot.rooms) {
      existingRooms.set(r.id, r);
    }
  }

  const roomMap = new Map<string, RoomInfo>();
  if (prevSnapshot?.rooms) {
    for (const r of prevSnapshot.rooms) {
      roomMap.set(r.id, r);
    }
  }

  const getOrCreateRoom = (product?: string, project?: string): RoomInfo => {
    const prod = product?.trim() || 'project';
    const proj = project?.trim();
    const name = proj ? `${prod} / ${proj}` : `${prod} / (no project)`;

    const matched = FACTORY_PROJECTS.find(
      (p) => p.name.toLowerCase() === name.toLowerCase() || (proj && p.projectName.toLowerCase() === proj.toLowerCase()),
    );
    const id = matched ? matched.id : `factory:${prod}/${proj ? proj.toLowerCase().replace(/\s+/g, '-') : '_default'}`;
    const path = matched ? matched.path : `~/code/${prod}/${proj ? proj.toLowerCase().replace(/\s+/g, '-') : ''}`;

    if (roomMap.has(id)) return roomMap.get(id)!;
    if (existingRooms.has(id)) {
      const existing = existingRooms.get(id)!;
      roomMap.set(id, existing);
      return existing;
    }

    const takenSlots = new Set<number>([
      ...Array.from(existingRooms.values()).map((r) => r.slot),
      ...Array.from(roomMap.values()).map((r) => r.slot),
    ]);
    let slot = matched?.slot;
    if (slot === undefined || takenSlots.has(slot)) {
      let nextSlot = 0;
      while (takenSlots.has(nextSlot)) nextSlot++;
      slot = nextSlot;
    }

    const room: RoomInfo = {
      id,
      name,
      path,
      slot,
      seed: hash32(id),
      createdAt: now,
    };
    roomMap.set(id, room);
    return room;
  };

  if (data.projects) {
    for (const p of data.projects) {
      getOrCreateRoom(p.product, p.name);
    }
  }
  if (data.agents) {
    for (const a of data.agents) {
      getOrCreateRoom(a.product, a.project);
    }
  }

  // 2. Agents (agents in done leave)
  const activeRows = (data.agents ?? []).filter((r) => r.state !== 'done');
  const agents: AgentInfo[] = [];

  for (const row of activeRows) {
    const room = getOrCreateRoom(row.product, row.project);
    const isSub = Boolean(row.parent && row.parent !== row.hc);
    const parentId = isSub ? (row.parent!.startsWith('factory:agent:') ? row.parent! : `factory:agent:${row.parent}`) : undefined;
    const agentId = `factory:agent:${row.hc}`;
    const prevAgent = prevSnapshot?.agents.find((a) => a.id === agentId);

    // Status
    let status: AgentInfo['status'] = 'working';
    if (row.state === 'waiting') status = 'waiting';
    else if (row.state === 'stalled' || row.state === 'quota') status = 'idle';
    else if (row.state === 'running' || row.state === 'failed') status = 'working';
    else if (row.state === 'unknown') status = 'idle';

    // Activity
    const actText = row.activityText || row.t3Status || row.task || (
      status === 'waiting' ? (row.waiting_for || row.waitingFor || 'Waiting for user input')
      : row.state === 'quota' ? 'Hit quota limit'
      : row.state === 'stalled' ? 'Stalled'
      : 'Working on task'
    );
    const actKind: Activity['kind'] = row.activityKind || (
      status === 'waiting' ? 'ask'
      : (row.state === 'quota' || row.state === 'stalled') ? 'wait'
      : 'edit'
    );
    const actIcon = row.activityIcon || (
      status === 'waiting' ? '✋'
      : row.state === 'quota' ? '☕'
      : row.state === 'stalled' ? '💤'
      : row.state === 'failed' ? '⚠️'
      : '✏️'
    );

    const activityAt = row.since ?? row.started_at ?? (prevAgent?.activity?.at ?? now);
    const activity: Activity = {
      id: `act-${hash32(row.hc + ':' + actText)}`,
      kind: actKind,
      icon: actIcon,
      text: actText,
      at: activityAt,
      error: row.activityError ?? (row.state === 'failed'),
    };

    let recent = prevAgent?.recent ? [...prevAgent.recent] : [];
    if (!recent.some((a) => a.text === activity.text && a.kind === activity.kind)) {
      recent = [...recent, activity].slice(-30);
    }
    if (recent.length === 0) {
      recent = [activity];
    }

    const tasks: TaskItem[] = [
      { id: '1', title: row.title || row.task || row.hc, status: status === 'idle' ? 'completed' : 'in_progress' },
    ];

    const stats: AgentStats = prevAgent?.stats ?? {
      toolCalls: 12 + (hash32(row.hc + ':calls') % 40),
      tokensIn: 80_000 + (hash32(row.hc + ':tin') % 300_000),
      tokensOut: 2_000 + (hash32(row.hc + ':tout') % 20_000),
      linesAdded: 45 + (hash32(row.hc + ':lines') % 120),
      linesRemoved: 10 + (hash32(row.hc + ':rem') % 40),
      subagents: isSub ? 0 : 1,
    };

    let permission = row.permission;
    if (!permission && status === 'waiting') {
      const waitReason = row.waiting_for || row.waitingFor || 'Waiting for user confirmation';
      permission = {
        id: `perm-${row.hc}`,
        tool: 'Bash',
        title: waitReason,
        text: waitReason,
        icon: '✋',
        createdAt: (row.since ?? now) - 180_000,
        expiresAt: now + 600_000,
      };
    }

    const provStr = row.provider ? (row.provider.startsWith('.') ? row.provider : `.${row.provider.toLowerCase()}`) : '.claude';
    const canRecv = row.canReceive ?? row.can_receive ?? true;

    const agent: AgentInfo = {
      id: agentId,
      kind: isSub ? 'sub' : 'main',
      parentId,
      roomId: room.id,
      name: row.hc,
      look: hash32(row.hc) % 2 === 0 ? 'm' : 'f',
      role: isSub ? 'Subagent' : 'Main agent',
      title: row.title || row.task || row.hc,
      sessionId: `factory:sess:${row.hc}`,
      account: provStr,
      status,
      waitingFor: row.waiting_for || row.waitingFor || (status === 'waiting' ? 'Waiting for owner decision' : undefined),
      permission,
      activity,
      recent,
      tasks,
      model: row.model,
      gitBranch: row.branch,
      startedAt: row.since ?? row.started_at ?? (prevAgent?.startedAt ?? now),
      lastEventAt: now,
      statusSince: prevAgent && prevAgent.status === status ? prevAgent.statusSince : now,
      stats,
      seed: hash32(row.hc),
      background: isSub,
      canReceive: canRecv,
      canMessage: canRecv,
      thread: row.thread ?? row.hc,
    };

    agents.push(agent);
  }

  // 3. Accounts: one per provider present
  const provMap = new Map<string, { color?: string; noQuota: boolean; sessions: number }>();
  for (const row of (data.agents ?? [])) {
    const p = (row.provider ?? 'claude').replace(/^\./, '').toLowerCase();
    const entry = provMap.get(p) ?? { noQuota: false, sessions: 0 };
    if (row.state === 'quota') entry.noQuota = true;
    provMap.set(p, entry);
  }
  for (const a of agents) {
    if (a.kind === 'main') {
      const p = a.account.replace(/^\./, '').toLowerCase();
      const entry = provMap.get(p);
      if (entry) entry.sessions++;
    }
  }

  if (provMap.size === 0) {
    provMap.set('claude', { noQuota: false, sessions: 0 });
    provMap.set('antigravity', { noQuota: false, sessions: 0 });
    provMap.set('opencode', { noQuota: false, sessions: 0 });
  }

  const accounts: AccountInfo[] = [];
  for (const [p, meta] of provMap.entries()) {
    const provName = p === 'claude' ? 'Claude'
      : p === 'antigravity' ? 'Antigravity'
      : p === 'opencode' ? 'OpenCode'
      : p === 'codex' ? 'Codex'
      : (p.charAt(0).toUpperCase() + p.slice(1));
    const provColor = data.provColors?.[p] || (
      p === 'claude' ? '#f08a3c'
      : p === 'antigravity' ? '#4aa8e8'
      : p === 'opencode' ? '#a77bf3'
      : p === 'codex' ? '#10a37f'
      : '#888888'
    );
    const short = p === 'claude' ? 'C'
      : p === 'antigravity' ? 'AG'
      : p === 'opencode' ? 'OC'
      : p === 'codex' ? 'X'
      : p.slice(0, 2).toUpperCase();

    const usage: AccountUsage = {
      noQuota: meta.noQuota,
      source: 'statusline',
      fetchedAt: now,
    };

    accounts.push({
      id: `.${p}`,
      short,
      name: provName,
      plan: 'Pro',
      color: provColor,
      configDir: `~/.${p}`,
      sessions: meta.sessions,
      tokensToday: data.tokens?.today,
      usage,
      usageStatus: 'ok',
    });
  }

  // 4. Inbox
  const inbox: FactoryInboxItem[] = (data.inbox ?? []).map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    context: item.context,
    options: normalizeInboxOptions(item.options, item.reco),
    project: item.project,
    from: item.from ?? null,
    at: item.at ?? now,
  }));

  // 5. Feed derived from state changes
  if (prevSnapshot) {
    const currentHcs = new Set(activeRows.map((r) => r.hc));
    for (const prevA of prevSnapshot.agents) {
      if (!currentHcs.has(prevA.name)) {
        const room = prevSnapshot.rooms.find((r) => r.id === prevA.roomId);
        feedItems.push({
          id: `feed-${now}-${++feedSeq}`,
          agentId: prevA.id,
          roomId: prevA.roomId,
          agentName: prevA.name,
          roomName: room?.name ?? '',
          account: prevA.account,
          activity: {
            id: `act-${now}-${++feedSeq}`,
            kind: 'done',
            icon: '🏁',
            text: `${prevA.name} finished`,
            at: now,
          },
        });
      }
    }
    for (const a of agents) {
      if (a.status === 'waiting') {
        const prevA = prevSnapshot.agents.find((prev) => prev.id === a.id);
        if (!prevA || prevA.status !== 'waiting') {
          const room = roomMap.get(a.roomId);
          feedItems.push({
            id: `feed-${now}-${++feedSeq}`,
            agentId: a.id,
            roomId: a.roomId,
            agentName: a.name,
            roomName: room?.name ?? '',
            account: a.account,
            activity: {
              id: `act-${now}-${++feedSeq}`,
              kind: 'ask',
              icon: '✋',
              text: `${a.name} is waiting on you`,
              at: now,
            },
          });
        }
      }
    }
  }

  const rooms = Array.from(roomMap.values());

  const snapshot: OfficeSnapshot = {
    rev: prevSnapshot ? prevSnapshot.rev + 1 : 0,
    serverTime: data.builtAt ?? now,
    rooms,
    agents,
    accounts,
    inbox,
    meta: {
      demo: Boolean(data.machine?.id?.includes('demo') || data.machine?.label?.includes('demo')),
      sources: [],
      startedAt: prevSnapshot?.meta?.startedAt ?? now,
      version: 'factory',
      buildingName: data.machine?.label,
    },
  };

  return { snapshot, feedItems, notices };
}

export function buildInitialFactoryOfficeResponse(): FactoryOfficeResponse {
  const agents: FactoryApiAgent[] = AGENT_SPECS.map((spec) => {
    const isSub = spec.kind === 'sub';
    const proj = FACTORY_PROJECTS[spec.roomIndex];
    return {
      hc: spec.handle,
      provider: spec.account.replace(/^\./, ''),
      model: spec.model,
      product: proj.product,
      project: proj.projectName,
      state: spec.factoryState,
      branch: spec.gitBranch,
      title: spec.title,
      waiting_for: spec.waitingFor,
      parent: isSub && spec.parentHandle ? spec.parentHandle : undefined,
      thread: `factory:thread:${spec.handle}`,
      canReceive: true,
      activityText: spec.activityText,
      activityKind: spec.activityKind,
      activityIcon: spec.activityIcon,
      activityError: spec.activityError,
      permission: spec.permission ? {
        id: spec.permission.id,
        tool: spec.permission.tool,
        title: spec.permission.title,
        text: spec.permission.text,
        icon: spec.permission.icon,
        createdAt: Date.now() - 180_000,
        expiresAt: Date.now() + 600_000,
        questions: spec.permission.questionHeader && spec.permission.questionText && spec.permission.options
          ? [{
              index: 0,
              header: spec.permission.questionHeader,
              question: spec.permission.questionText,
              options: spec.permission.options.map((label, index) => ({ index, label })),
            }]
          : undefined,
      } : undefined,
    };
  });

  const inbox: FactoryApiInboxItem[] = INITIAL_INBOX_SPECS.map((spec, i) => ({
    id: spec.id,
    kind: spec.kind,
    title: spec.title,
    context: spec.context,
    options: spec.options.map((o) => ({ ...o })),
    project: spec.project,
    from: spec.from,
    at: Date.now() - (180_000 + i * 60_000),
  }));

  return {
    builtAt: Date.now(),
    machine: { label: 'office-sim-1' },
    tokens: { today: 480_000 },
    agents,
    inbox,
  };
}

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
  private inbox: FactoryInboxItem[] = [];

  constructor(opts: DemoOptions = {}, now = Date.now()) {
    this.rng = mulberry32(opts.seed ?? hash32(`factory:${now}`));
    this.speed = opts.speed ?? 1;
    this.startedAt = now;
    this.nextTickAt = now + 20_000 / this.speed;

    // Build via shared mapping
    const initial = buildInitialFactoryOfficeResponse();
    const { snapshot } = mapFactoryDataToSnapshot(initial, null, now);
    for (const r of snapshot.rooms) {
      this.rooms.set(r.id, r);
    }
    for (const a of snapshot.agents) {
      this.agents.set(a.id, a);
    }
    this.inbox = snapshot.inbox ? snapshot.inbox.map((i) => ({ ...i, options: i.options.map((o) => ({ ...o })) })) : [];
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

    // 3. Build initial ~8 mock inbox items
    const offsets = [180_000, 360_000, 120_000, 420_000, 90_000, 600_000, 750_000, 900_000];
    this.inbox = INITIAL_INBOX_SPECS.map((spec, i) => ({
      ...spec,
      options: spec.options.map((o) => ({ ...o })),
      at: now - (offsets[i] ?? (100_000 + i * 50_000)),
    }));

    // Seed the activity feed with each agent's current activity (oldest first), so it is not empty on open.
    this.pendingFeed = [...this.agents.values()]
      .filter((a) => a.activity)
      .sort((a, b) => a.activity!.at - b.activity!.at)
      .slice(-10)
      .map((a) => ({
        id: `feed-${++this.seq}`,
        agentId: a.id,
        roomId: a.roomId,
        agentName: a.name,
        roomName: this.rooms.get(a.roomId)?.name ?? '',
        account: a.account,
        activity: a.activity!,
      }));
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
      inbox: this.inbox.map((item) => ({
        ...item,
        options: item.options.map((o) => ({ ...o })),
      })),
      meta: {
        demo: true,
        sources: [],
        startedAt: this.startedAt,
        version: 'factory',
        buildingName: 'office-sim-1',
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

    const inboxItem = this.inbox.find((it) => it.from === agent.name);
    if (inboxItem) {
      this.inbox = this.inbox.filter((it) => it.id !== inboxItem.id);
    }

    this.rev++;
    this.dirty = true;
    return true;
  }

  answerInbox(id: string, choiceKey: string, note?: string, now = Date.now()): boolean {
    const item = this.inbox.find((it) => it.id === id);
    if (!item) return false;

    const opt = item.options.find((o) => o.key === choiceKey) ?? item.options[0];
    const rawLabel = opt?.label ?? choiceKey;
    const cleanLabel = rawLabel.replace(/\s*\(Recommended\)/i, '').trim();

    // 1. Remove item from list
    this.inbox = this.inbox.filter((it) => it.id !== id);

    // 2. Free waiting agent if linked
    if (item.from) {
      const agent = [...this.agents.values()].find((a) => a.name === item.from || a.id === `factory:agent:${item.from}`);
      if (agent && agent.status === 'waiting') {
        delete agent.permission;
        agent.waitingFor = undefined;
        agent.status = 'working';
        agent.statusSince = now;
        agent.activity = {
          id: `act-${++this.seq}`,
          kind: 'other',
          icon: '✅',
          text: `Answered in Office (${item.id})`,
          detail: note,
          at: now,
        };
        agent.recent = [...agent.recent, agent.activity].slice(-30);
        agent.lastEventAt = now;

        this.pendingNotices.push({
          id: `notice-${++this.seq}`,
          level: 'success',
          text: `✅ ${agent.name} resumed work`,
          agentId: agent.id,
          roomId: agent.roomId,
          at: now,
        });
      }
    }

    // 3. Add feed item
    const room = [...this.rooms.values()].find((r) => r.name.includes(item.project) || item.project.includes(r.name)) ?? [...this.rooms.values()][0];
    const feedText = `You answered ${item.id}: ${cleanLabel}`;
    this.pendingFeed.push({
      id: `feed-${++this.seq}`,
      agentId: item.from ? `factory:agent:${item.from}` : 'user',
      roomId: room?.id ?? '',
      agentName: 'You',
      roomName: room?.name ?? item.project,
      account: '.claude',
      activity: {
        id: `act-${++this.seq}`,
        kind: 'communicate',
        icon: '📬',
        text: feedText,
        detail: note ? `Note: ${note}` : undefined,
        at: now,
      },
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
