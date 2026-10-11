// Lista lateral agrupada por status: Fixados, Aguardando resposta, Para revisar, Trabalhando e Terminados.
// O que é "visto" e o que está fixado fica no navegador, pela sessão do Claude Code (como a ordem de ui/agentorder.ts).
// As regras são funções puras (dados e relógio vêm de fora), testadas em ui/statusgroups.test.ts; o DOM fica em ui/sidebar.ts.
import type { AgentInfo } from '../../../shared/types';
import type { AgentNode } from './model';

const STATE_KEY = 'habblaud.sidebar.status';
/** Sessão que sumiu há mais tempo que isto é esquecida. A folga cobre o servidor reiniciando e a sessão retomada depois. */
export const GONE_MS = 7 * 24 * 3_600_000;

export type StatusKey = 'input' | 'review' | 'working' | 'done';
export type GroupKey = 'pinned' | StatusKey;

/** Ordem dos grupos na lista. */
export const GROUP_ORDER: readonly GroupKey[] = ['pinned', 'input', 'review', 'working', 'done'];

export interface SideState {
  view: 'status' | 'rooms';
  /** Grupos recolhidos ou abertos pelo usuário; sem escolha, só "Terminados" começa recolhido. */
  collapsed: Partial<Record<GroupKey, boolean>>;
  /** Sessões fixadas, na ordem em que foram fixadas. */
  pins: string[];
  /** Quando o usuário abriu (ou marcou como revisada) cada sessão pela última vez. */
  seen: Record<string, number>;
  /** Primeira vez neste navegador (0 = ainda não): quem terminou antes disto já conta como visto. */
  since: number;
  /** Sessões guardadas que não estão mais no escritório, e desde quando. */
  gone: Record<string, number>;
}

export const DEFAULT_STATE: SideState = { view: 'status', collapsed: {}, pins: [], seen: {}, since: 0, gone: {} };

export interface StatusGroup {
  key: GroupKey;
  nodes: AgentNode[];
}

export function isCollapsed(state: Pick<SideState, 'collapsed'>, key: GroupKey): boolean {
  return state.collapsed[key] ?? key === 'done';
}

/**
 * Grupo de um agente pelo status. Quem terminou ('idle' ou 'done') depois da última vez em que foi aberto fica em
 * "Para revisar"; só agentes principais (o resultado de um subagente é do agente que o disparou). Quem está saindo
 * ('offline') vai direto para "Terminados": a sessão foi encerrada, não há o que revisar.
 */
export function statusGroup(agent: Pick<AgentInfo, 'kind' | 'status' | 'statusSince' | 'sessionId'>, state: Pick<SideState, 'seen' | 'since'>): StatusKey {
  if (agent.status === 'waiting') return 'input';
  if (agent.status === 'working' || agent.status === 'shell') return 'working';
  if (agent.status === 'offline' || agent.kind !== 'main') return 'done';
  return agent.statusSince > Math.max(state.seen[agent.sessionId] ?? 0, state.since) ? 'review' : 'done';
}

const isPinned = (node: AgentNode, pins: readonly string[]) => node.agent.kind === 'main' && pins.includes(node.agent.sessionId);

/** Quem espera há mais tempo primeiro; quem terminou por último primeiro; trabalhando fica na ordem em que veio. */
const SORT: Partial<Record<StatusKey, (a: AgentNode, b: AgentNode) => number>> = {
  input: (a, b) => a.agent.statusSince - b.agent.statusSince,
  review: (a, b) => b.agent.statusSince - a.agent.statusSince,
  done: (a, b) => b.agent.statusSince - a.agent.statusSince,
};

/**
 * Agrupa os agentes de primeiro nível (os `nodes` de groupRooms, já filtrados e com os subagentes dentro) por status.
 * Um agente fixado aparece só em "Fixados", seja qual for o status. Grupos vazios não entram.
 */
export function groupByStatus(nodes: readonly AgentNode[], state: Pick<SideState, 'pins' | 'seen' | 'since'>): StatusGroup[] {
  const by: Record<GroupKey, AgentNode[]> = { pinned: [], input: [], review: [], working: [], done: [] };
  for (const n of nodes) by[isPinned(n, state.pins) ? 'pinned' : statusGroup(n.agent, state)].push(n);
  by.pinned.sort((a, b) => state.pins.indexOf(a.agent.sessionId) - state.pins.indexOf(b.agent.sessionId));
  for (const [key, cmp] of Object.entries(SORT)) by[key as StatusKey].sort(cmp);
  return GROUP_ORDER.filter((key) => by[key].length > 0).map((key) => ({ key, nodes: by[key] }));
}

/** Marca as sessões como vistas agora (abrir o agente, o ✓ da linha ou "Marcar todos como revisados"). */
export function markSeen(state: SideState, sessions: readonly string[], now: number): SideState {
  const seen = { ...state.seen };
  for (const id of sessions) seen[id] = Math.max(seen[id] ?? 0, now);
  return { ...state, seen };
}

export function togglePin(state: SideState, session: string): SideState {
  return { ...state, pins: state.pins.includes(session) ? state.pins.filter((id) => id !== session) : [...state.pins, session] };
}

/**
 * Acerta o estado com o escritório de agora (`live` = sessões presentes): na primeira vez fixa o `since`, e esquece
 * fixados e vistos de sessões que sumiram há mais de GONE_MS. Devolve o mesmo objeto quando nada muda.
 */
export function settle(state: SideState, live: ReadonlySet<string>, now: number): SideState {
  const gone: Record<string, number> = {};
  const dead = new Set<string>();
  for (const id of new Set([...state.pins, ...Object.keys(state.seen)])) {
    if (live.has(id)) continue;
    const at = state.gone[id] ?? now;
    if (now - at > GONE_MS) dead.add(id);
    else gone[id] = at;
  }
  const ids = Object.keys(gone);
  if (state.since && dead.size === 0 && ids.length === Object.keys(state.gone).length && ids.every((id) => id in state.gone)) return state;
  return {
    ...state,
    since: state.since || now,
    gone,
    pins: state.pins.filter((id) => !dead.has(id)),
    seen: Object.fromEntries(Object.entries(state.seen).filter(([id]) => !dead.has(id))),
  };
}

// ---------------------------------------------------------------- armazenamento

const record = <T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, T] => ok(e[1]))) : {};
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Só o formato esperado: um valor de outra versão (ou editado à mão) não pode quebrar a lista lateral. */
export function sanitizeState(raw: unknown): SideState {
  if (!raw || typeof raw !== 'object') return DEFAULT_STATE;
  const v = raw as Record<string, unknown>;
  return {
    view: v.view === 'rooms' ? 'rooms' : 'status',
    collapsed: record(v.collapsed, (x): x is boolean => typeof x === 'boolean'),
    pins: Array.isArray(v.pins) ? [...new Set(v.pins.filter((x): x is string => typeof x === 'string'))] : [],
    seen: record(v.seen, isNum),
    since: isNum(v.since) ? v.since : 0,
    gone: record(v.gone, isNum),
  };
}

export function loadState(): SideState {
  try {
    return sanitizeState(JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null'));
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveState(state: SideState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // sem armazenamento: vale só até recarregar
  }
}
