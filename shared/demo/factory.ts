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
  FactoryMachine,
  FeedAgentRef,
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
  product: 'payapp' | 'shopkit' | 'cliphub' | 'factory' | 'clipper';
  projectName: string;
  name: string;
  path: string;
  slot: number;
}

export const FACTORY_PROJECTS: readonly FactoryProject[] = [
  {
    id: 'factory:payapp/new-fee-engine',
    product: 'payapp',
    projectName: 'New fee engine',
    name: 'payapp / New fee engine',
    path: '~/code/payapp-monorepo/fee-engine',
    slot: 0,
  },
  {
    id: 'factory:payapp/support-bot',
    product: 'payapp',
    projectName: 'Support bot',
    name: 'payapp / Support bot',
    path: '~/code/payapp-monorepo/support-bot',
    slot: 1,
  },
  {
    id: 'factory:payapp/black-friday-2026',
    product: 'payapp',
    projectName: 'Black Friday 2026',
    name: 'payapp / Black Friday 2026',
    path: '~/code/payapp-monorepo/campaigns/bf26',
    slot: 2,
  },
  {
    id: 'factory:shopkit/shopkit-store',
    product: 'shopkit',
    projectName: 'ShopKit store',
    name: 'shopkit / ShopKit store',
    path: '~/code/shopkit/storefront',
    slot: 3,
  },
  {
    id: 'factory:cliphub/cliphub-v2',
    product: 'cliphub',
    projectName: 'ClipHub V2',
    name: 'cliphub / ClipHub V2',
    path: '~/code/cliphub',
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
    id: 'factory:clipper/stream-clipper',
    product: 'clipper',
    projectName: 'Stream clipper',
    name: 'clipper / Stream clipper',
    path: '~/code/stream-clipper',
    slot: 7,
  },
  {
    id: 'factory:payapp/design-system',
    product: 'payapp',
    projectName: 'Design system',
    name: 'payapp / Design system',
    path: '~/code/payapp-monorepo/design-system',
    slot: 8,
  },
];

interface AgentSpec {
  handle: string;
  roomIndex: number;
  machine?: string;
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
  // Room 0: payapp / New fee engine
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

  // Room 1: payapp / Support bot
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

  // Room 2: payapp / Black Friday 2026
  {
    handle: '2f18',
    roomIndex: 2,
    machine: 'laptop',
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
    machine: 'laptop',
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

  // Room 3: shopkit / ShopKit store
  {
    handle: '2a14',
    roomIndex: 3,
    machine: 'laptop',
    account: '.claude',
    kind: 'main',
    factoryState: 'running',
    activityText: 'Refactoring cart_store.ts',
    activityKind: 'edit',
    activityIcon: '✏️',
    model: 'claude-opus-5-5',
    gitBranch: 'refactor/cart-store',
    title: 'ShopKit cart overhaul',
  },
  {
    handle: '3b55',
    roomIndex: 3,
    machine: 'laptop',
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

  // Room 4: cliphub / ClipHub V2
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

  // Room 7: clipper / Stream clipper
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

  // Room 8: payapp / Design system
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
    context:
      'Agent 2b07 needs confirmation on Stripe signature header.\nv1 header is deprecated but still received from older endpoints.\nRejecting may drop incoming payment callbacks.',
    options: [
      { key: 'v1v2', label: 'Accept v1 and v2 simultaneously (Recommended)' },
      { key: 'v2only', label: 'Reject v1, require v2 headers only' },
      { key: 'more_ctx', label: 'Request more context from agent' },
    ],
    project: 'payapp / Support bot',
    from: '2b07',
  },
  // 2. Urgent decision (no agent)
  {
    id: 'c102',
    kind: 'urgent',
    title: 'Rotate staging API key for ShopKit',
    context:
      'Sentry reported an exposed secret in staging logs.\nImmediate key rotation will invalidate active preview sessions.\nChoose key rotation window.',
    options: [
      { key: 'rotate_now', label: 'Rotate immediately and invalidate sessions (Recommended)' },
      { key: 'schedule', label: 'Schedule rotation in 30 minutes' },
    ],
    project: 'shopkit / ShopKit store',
    from: null,
    machine: 'laptop',
  },
  // 3. Action item with numbered steps from waiting agent 2e77
  {
    id: 'd547',
    kind: 'action',
    title: 'Sign off v2.4 production deploy',
    context:
      '1. Verify migration idempotency on staging cluster\n2. Run smoke test suite on production cluster\n3. Promote docker image to live traffic',
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
    context:
      '1. Lock tier_rates table for migration\n2. Backfill historical records for Q3 2026\n3. Validate checksums across 12 partitions',
    options: [
      { key: 'run_now', label: 'Execute backfill during off-peak window (Recommended)' },
      { key: 'dry_run', label: 'Run dry-run simulation only' },
    ],
    project: 'payapp / New fee engine',
    from: null,
  },
  // 5. Merge ask
  {
    id: 'm701',
    kind: 'action',
    title: 'Merge factory#70: Support bot webhook handler',
    context:
      'PR #70 passed all CI checks (3/3 passing).\nFixes Stripe signature verification bug and adds regression suite.\nReady to merge.',
    options: [
      { key: 'merge', label: 'Merge factory#70 into main (Recommended)' },
      { key: 'hold', label: 'Hold PR for manual review' },
    ],
    project: 'payapp / Support bot',
    from: null,
  },
  // 6. Applied item
  {
    id: 'e204',
    kind: 'applied',
    title: 'Publish weekly support digest',
    context:
      'Scanned 142 customer conversations.\nTop 3 asks: dark mode fixes, invoice export, webhook retries.\nDigest saved to factory data.',
    options: [
      { key: 'ack', label: 'Acknowledge summary (Recommended)' },
      { key: 'archive', label: 'Archive digest' },
    ],
    project: 'payapp / Support bot',
    from: null,
  },
  // 7. Applied item
  {
    id: 'f311',
    kind: 'applied',
    title: 'Apply automated linter fixes',
    context:
      'Linter formatted 38 files.\nAll commit hooks succeeded without syntax errors.\nNo manual intervention needed.',
    options: [
      { key: 'keep', label: 'Keep formatted changes (Recommended)' },
      { key: 'revert', label: 'Revert changes' },
    ],
    project: 'factory / Software factory',
    from: null,
  },
  // 8. Applied item
  {
    id: 'g452',
    kind: 'applied',
    title: 'Complete cache warmup',
    context:
      'Pre-loaded 45,000 product keys for campaign.\nLatency dropped to 0.4ms across nodes.\nMemory utilization at 34%.',
    options: [
      { key: 'done', label: 'Confirm warmup (Recommended)' },
      { key: 'purge', label: 'Purge cache' },
    ],
    project: 'payapp / Black Friday 2026',
    from: null,
    machine: 'laptop',
  },
];

/** Relative age of a machine's last heartbeat: "5 min", "2 h", "3 d". Accepts ISO strings, epoch ms, or an already formatted "2 h ago". */
export function formatMachineLastSeen(lastSeen?: string | number | null, now = Date.now()): string {
  if (lastSeen === null || lastSeen === undefined || lastSeen === '') return '';
  const text = String(lastSeen).trim();
  const at = typeof lastSeen === 'number' ? lastSeen : /^\d{4}-\d{2}-\d{2}/.test(text) ? Date.parse(text) : NaN;
  if (Number.isFinite(at)) {
    const min = Math.max(1, Math.floor((now - at) / 60_000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
  }
  return text.replace(/^last\s+seen\s+/i, '').replace(/\s+ago$/i, '');
}

export function parseTime(val: unknown, fallback: number = Date.now()): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export interface FactoryApiAgent {
  hc: string;
  who?: string;
  provider?: string;
  model?: string;
  via?: string;
  product?: string;
  project?: string | null;
  state?: string; // running, waiting, failed, quota, done, stalled, unknown
  t3Status?: string;
  since?: string | number;
  started_at?: string | number;
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
  stats?: AgentStats;
  machine?: string;
}

export interface FactoryApiInboxItem {
  id: string;
  kind: FactoryInboxKind;
  title: string;
  context: string;
  options: unknown; // string[] | FactoryInboxOption[] | Record<string, string> | [string, string][]
  reco?: string | null;
  project: string;
  from?: string | null;
  thread?: string;
  machine?: string;
  at?: string | number;
}

export interface FactoryOfficeResponse {
  builtAt?: string | number;
  machine?: {
    id?: string;
    label?: string;
  };
  machines?: FactoryMachine[];
  selectedMachine?: string | null;
  products?: Record<string, { name?: string }>;
  projects?: Array<{ id: string; name?: string; product?: string; path?: string; kind?: string }>;
  agents?: FactoryApiAgent[];
  tokens?: { today?: number; window?: string; scannedAt?: string | number; claudeAll?: number; note?: string };
  provColors?: Record<string, string>;
  relayConfigured?: boolean;
  inbox?: FactoryApiInboxItem[];
  answers?: Record<string, { choice: string; note?: string; at: string | number }>;
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
        const o = opt as { id?: string; key?: string; label?: string };
        const rawKey = o.id !== undefined ? o.id : o.key;
        const k = rawKey !== undefined ? String(rawKey) : String(i);
        const l = o.label !== undefined ? String(o.label) : String(rawKey ?? i);
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

  // Sort recommended first (key === reco only, drop substring matching)
  if (reco) {
    list.sort((a, b) => {
      const aReco = a.key === reco;
      const bReco = b.key === reco;
      if (aReco && !bReco) return -1;
      if (!aReco && bReco) return 1;
      return 0;
    });
  }

  return list;
}

export function mapFactoryDataToSnapshot(
  data: FactoryOfficeResponse,
  prevSnapshot?: OfficeSnapshot | null,
  now = Date.now(),
  isMock = false,
  selectedMachine?: string | null,
): { snapshot: OfficeSnapshot; feedItems: FeedItem[]; notices: Notice[] } {
  const feedItems: FeedItem[] = [];
  const notices: Notice[] = [];
  let feedSeq = 0;

  // A subagent runs where its parent runs.
  const machineByHc = new Map((data.agents ?? []).map((r) => [r.hc, r.machine]));
  const allRows = (data.agents ?? []).map((r) =>
    !r.machine && r.parent && r.parent !== r.hc && machineByHc.get(r.parent)
      ? { ...r, machine: machineByHc.get(r.parent) }
      : r,
  );

  // Compute live agent counts per machine
  const machineCounts = new Map<string, number>();
  for (const a of allRows) {
    if (a.state !== 'done' && a.machine) {
      machineCounts.set(a.machine, (machineCounts.get(a.machine) ?? 0) + 1);
    }
  }
  const machines: FactoryMachine[] = (data.machines ?? []).map((m) => ({
    ...m,
    agentCount: machineCounts.get(m.id) ?? 0,
  }));

  // An unknown machine id (stale ?machine= link) is treated as All.
  const targetMachineId = selectedMachine ?? data.selectedMachine ?? null;
  const currentMachine = machines.find((m) => m.id === targetMachineId) ?? null;

  let buildingName = data.machine?.label;
  let offlineMachine: FactoryMachine | null = null;
  if (currentMachine) {
    buildingName = currentMachine.label;
    if (!currentMachine.online) {
      offlineMachine = currentMachine;
    }
  } else if (machines.length === 1) {
    buildingName = machines[0].label;
  }

  // 1. Rooms: key by product + project id, display name from projects[].name
  // Every room ever seen, factory-wide, so a room keeps its slot whichever building is shown.
  const roomMap = new Map<string, RoomInfo>();
  for (const r of prevSnapshot?.knownRooms ?? prevSnapshot?.rooms ?? []) {
    roomMap.set(r.id, r);
  }

  const projectsById = new Map<string, { id: string; product?: string; name?: string; path?: string }>();
  if (data.projects) {
    for (const p of data.projects) {
      if (p.id) projectsById.set(p.id, p);
    }
  }

  const describeRoom = (product?: string, projectId?: string | null): Pick<RoomInfo, 'id' | 'name' | 'path'> => {
    const prod = product?.trim() || 'project';
    const projId = projectId?.trim() || null;

    let projectObj = projId ? projectsById.get(projId) : undefined;
    if (!projectObj && projId && data.projects) {
      projectObj = data.projects.find((p) => p.name === projId);
    }

    const finalProjId = projectObj ? projectObj.id : projId;
    const finalProduct = projectObj?.product?.trim() || prod;

    // key by product + project id; fallback _no_project if null
    const id = finalProjId ? `${finalProduct}:${finalProjId}` : `${finalProduct}:_no_project`;

    // display name from projects[].name (fallback the id; product / (no project) for null)
    const name = finalProjId ? (projectObj?.name?.trim() || finalProjId) : `${finalProduct} / (no project)`;
    const path = projectObj?.path ?? `~/code/${finalProduct}/${finalProjId ? finalProjId.replace(/\s+/g, '-') : ''}`;

    return { id, name, path };
  };

  const getOrCreateRoom = (product?: string, projectId?: string | null): RoomInfo => {
    const { id, name, path } = describeRoom(product, projectId);
    if (roomMap.has(id)) {
      const existing = roomMap.get(id)!;
      if (name && existing.name !== name) {
        existing.name = name;
      }
      return existing;
    }

    const takenSlots = new Set<number>(Array.from(roomMap.values()).map((r) => r.slot));
    let nextSlot = 0;
    while (takenSlots.has(nextSlot)) nextSlot++;

    const room: RoomInfo = {
      id,
      name,
      path,
      slot: nextSlot,
      seed: hash32(id),
      createdAt: now,
    };
    roomMap.set(id, room);
    return room;
  };

  // 2. Agents (agents in done leave)
  const allActive = allRows.filter((r) => r.state !== 'done');
  const activeRows = !currentMachine
    ? allActive
    : currentMachine.online ? allActive.filter((r) => r.machine === currentMachine.id) : [];

  for (const p of data.projects ?? []) getOrCreateRoom(p.product, p.id);
  const shownRoomIds = new Set(activeRows.map((a) => getOrCreateRoom(a.product, a.project).id));
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
    else if (row.state === 'failed') status = 'idle'; // a failed run is not working: the error activity marks it
    else if (row.state === 'running') status = 'working';
    else if (row.state === 'unknown') status = 'idle';

    // Activity: task before t3Status
    const actText = row.activityText || row.task || row.t3Status || (
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

    const activityAt = parseTime(row.since ?? row.started_at, prevAgent?.activity?.at ?? now);
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
      { id: '1', title: row.title || row.task || row.hc, status: status === 'idle' && row.state !== 'failed' ? 'completed' : 'in_progress' },
    ];

    const stats: AgentStats = row.stats ?? prevAgent?.stats ?? (isMock ? {
      toolCalls: 12 + (hash32(row.hc + ':calls') % 40),
      tokensIn: 80_000 + (hash32(row.hc + ':tin') % 300_000),
      tokensOut: 2_000 + (hash32(row.hc + ':tout') % 20_000),
      linesAdded: 45 + (hash32(row.hc + ':lines') % 120),
      linesRemoved: 10 + (hash32(row.hc + ':rem') % 40),
      subagents: isSub ? 0 : 1,
    } : {
      toolCalls: 0,
      tokensIn: 0,
      tokensOut: 0,
      subagents: 0,
    });

    let permission = row.permission;
    if (isMock && !permission && status === 'waiting') {
      const waitReason = row.waiting_for || row.waitingFor || 'Waiting for user confirmation';
      permission = {
        id: `perm-${row.hc}`,
        tool: 'Bash',
        title: waitReason,
        text: waitReason,
        icon: '✋',
        createdAt: parseTime(row.since, now) - 180_000,
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
      startedAt: parseTime(row.since ?? row.started_at, prevAgent?.startedAt ?? now),
      lastEventAt: now,
      statusSince: prevAgent && prevAgent.status === status ? prevAgent.statusSince : now,
      stats,
      seed: hash32(row.hc),
      background: isSub,
      canReceive: canRecv,
      canMessage: canRecv,
      thread: row.thread ?? row.hc,
      machine: row.machine,
    };

    agents.push(agent);
  }

  // 3. Accounts: one per provider present
  const provMap = new Map<string, { color?: string; noQuota: boolean; sessions: number }>();
  for (const row of allRows) {
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
    reco: item.reco ?? null,
    project: (item.project && projectsById.get(item.project)?.name) || item.project, // the name, like the rooms
    from: item.from ?? null,
    machine: item.machine,
    at: parseTime(item.at, now),
  }));

  // Answers
  const answers: Record<string, { choice: string; note?: string; at: number }> = {};
  if (data.answers) {
    for (const [id, ans] of Object.entries(data.answers)) {
      answers[id] = {
        choice: ans.choice,
        note: ans.note,
        at: parseTime(ans.at, now),
      };
    }
  }

  // 5. Feed derived from state changes. Factory-wide: diffed on every active row, not just the selected machine's.
  const feedAgents: FeedAgentRef[] = allActive.map((r) => {
    const room = describeRoom(r.product, r.project);
    return {
      id: `factory:agent:${r.hc}`,
      name: r.hc,
      roomId: room.id,
      roomName: room.name,
      account: r.provider ? (r.provider.startsWith('.') ? r.provider : `.${r.provider.toLowerCase()}`) : '.claude',
      waiting: r.state === 'waiting',
    };
  });
  if (prevSnapshot) {
    const prevAgents: FeedAgentRef[] = prevSnapshot.feedAgents ?? prevSnapshot.agents.map((a) => ({
      id: a.id,
      name: a.name,
      roomId: a.roomId,
      roomName: prevSnapshot.rooms.find((r) => r.id === a.roomId)?.name ?? '',
      account: a.account,
      waiting: a.status === 'waiting',
    }));
    const push = (ref: FeedAgentRef, kind: Activity['kind'], icon: string, text: string) =>
      feedItems.push({
        id: `feed-${now}-${++feedSeq}`,
        agentId: ref.id,
        roomId: ref.roomId,
        agentName: ref.name,
        roomName: ref.roomName,
        account: ref.account,
        activity: { id: `act-${now}-${++feedSeq}`, kind, icon, text, at: now },
      });
    const currentIds = new Set(feedAgents.map((a) => a.id));
    for (const prevA of prevAgents) {
      if (!currentIds.has(prevA.id)) push(prevA, 'done', '🏁', `${prevA.name} finished`);
    }
    for (const a of feedAgents) {
      if (a.waiting && !prevAgents.some((p) => p.id === a.id && p.waiting)) push(a, 'ask', '✋', `${a.name} is waiting on you`);
    }
  }

  const knownRooms = Array.from(roomMap.values());
  const rooms = currentMachine ? knownRooms.filter((r) => shownRoomIds.has(r.id)) : knownRooms;

  const snapshot: OfficeSnapshot = {
    rev: prevSnapshot ? prevSnapshot.rev + 1 : 0,
    serverTime: now,
    rooms,
    agents,
    accounts,
    inbox,
    answers,
    machines: machines.length > 0 ? machines : undefined,
    feedAgents,
    knownRooms,
    meta: {
      demo: Boolean(data.machine?.id?.includes('demo') || data.machine?.label?.includes('demo')),
      sources: [],
      startedAt: prevSnapshot?.meta?.startedAt ?? now,
      version: 'factory',
      buildingName,
      selectedMachine: machines.length === 0 ? null : (currentMachine?.id ?? (machines.length === 1 ? machines[0].id : 'all')),
      offlineMachine,
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
      machine: spec.machine ?? 'vps',
      provider: spec.account.replace(/^\./, ''),
      model: spec.model,
      product: proj.product,
      project: proj.id,
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
    machine: spec.machine ?? 'vps',
    at: Date.now() - (180_000 + i * 60_000),
  }));

  return {
    builtAt: new Date(Date.now()).toISOString(),
    machine: { label: 'office-sim-1' },
    machines: [
      { id: 'vps', label: 'vps', online: true, lastSeen: null },
      { id: 'laptop', label: 'laptop', online: true, lastSeen: null },
      { id: 'desktop', label: 'desktop', online: false, lastSeen: '2 h ago' },
    ],
    projects: FACTORY_PROJECTS.map((p) => ({
      id: p.id,
      product: p.product,
      name: p.name,
      path: p.path,
    })),
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
  private answers: Record<string, { choice: string; note?: string; at: number }> = {};
  private machines: FactoryMachine[] = [];
  private selectedMachine: string | null = null;

  constructor(opts: DemoOptions & { machine?: string } = {}, now = Date.now()) {
    this.rng = mulberry32(opts.seed ?? hash32(`factory:${now}`));
    this.speed = opts.speed ?? 1;
    this.startedAt = now;
    this.nextTickAt = now + 20_000 / this.speed;
    this.selectedMachine = opts.machine ?? null;

    // Build via shared mapping
    const initial = buildInitialFactoryOfficeResponse();
    this.machines = initial.machines ? initial.machines.map((m) => ({ ...m })) : [];
    const { snapshot } = mapFactoryDataToSnapshot(initial, null, now, true);
    for (const r of snapshot.rooms) {
      this.rooms.set(r.id, r);
    }
    for (const a of snapshot.agents) {
      this.agents.set(a.id, a);
    }
    this.inbox = snapshot.inbox ? snapshot.inbox.map((i) => ({ ...i, options: i.options.map((o) => ({ ...o })) })) : [];

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

  setMachine(id: string | null): void {
    this.selectedMachine = id === 'all' ? null : id;
    this.dirty = true;
    this.rev++;
  }

  private getMachinesWithCounts(): FactoryMachine[] {
    const liveCounts = new Map<string, number>();
    for (const a of this.agents.values()) {
      if (a.status !== 'done' && a.status !== 'offline' && a.machine) {
        liveCounts.set(a.machine, (liveCounts.get(a.machine) ?? 0) + 1);
      }
    }
    return this.machines.map((m) => ({
      ...m,
      agentCount: liveCounts.get(m.id) ?? 0,
    }));
  }

  snapshot(now = Date.now()): OfficeSnapshot {
    const machines = this.getMachinesWithCounts();
    const targetMachine = this.selectedMachine && this.selectedMachine !== 'all'
      ? machines.find((m) => m.id === this.selectedMachine)
      : null;

    let rooms: RoomInfo[];
    let agents: AgentInfo[];
    let buildingName = 'office-sim-1';
    let offlineMachine: FactoryMachine | null = null;

    if (targetMachine) {
      buildingName = targetMachine.label;
      if (!targetMachine.online) {
        rooms = [];
        agents = [];
        offlineMachine = targetMachine;
      } else {
        agents = [...this.agents.values()]
          .filter((a) => a.machine === targetMachine.id)
          .map((a) => structuredCloneAgent(a));
        const agentRoomIds = new Set(agents.map((a) => a.roomId));
        rooms = [...this.rooms.values()]
          .filter((r) => agentRoomIds.has(r.id))
          .map((r) => ({ ...r }));
      }
    } else {
      rooms = [...this.rooms.values()].map((r) => ({ ...r }));
      agents = [...this.agents.values()].map((a) => structuredCloneAgent(a));
      if (machines.length === 1) {
        buildingName = machines[0].label;
      }
    }

    return {
      rev: this.rev,
      serverTime: now,
      rooms,
      agents,
      accounts: this.accountsInfo(now),
      inbox: this.inbox.map((item) => ({
        ...item,
        options: item.options.map((o) => ({ ...o })),
      })),
      answers: { ...this.answers },
      machines: machines.length > 0 ? machines : undefined,
      meta: {
        demo: true,
        sources: [],
        startedAt: this.startedAt,
        version: 'factory',
        buildingName,
        selectedMachine: targetMachine?.id ?? (machines.length === 1 ? machines[0].id : 'all'),
        offlineMachine,
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

    // 1. Record answer (item stays in inbox until resolved by agent)
    this.answers[id] = { choice: choiceKey, note, at: now };

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
