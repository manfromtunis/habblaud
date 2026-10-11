import { describe, expect, it } from 'vitest';
import type { AgentInfo, AgentStatus } from '../../../shared/types';
import { groupRooms, type AgentNode } from './model';
import { DEFAULT_STATE, GONE_MS, groupByStatus, isCollapsed, markSeen, sanitizeState, settle, statusGroup, togglePin, type SideState } from './statusgroups';

function agent(id: string, status: AgentStatus, p: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    kind: 'main',
    roomId: 'api',
    name: id,
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${id}`,
    account: '.claude',
    status,
    recent: [],
    tasks: [],
    startedAt: 0,
    lastEventAt: 0,
    statusSince: 100,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: 1,
    ...p,
  };
}

const node = (a: AgentInfo, subs: AgentInfo[] = []): AgentNode => ({ agent: a, subs, subTotal: subs.length });
/** Estado de quem já usa o painel: `since` no passado e nada visto. */
const state = (p: Partial<SideState> = {}): SideState => ({ ...DEFAULT_STATE, since: 50, ...p });
const shape = (groups: ReturnType<typeof groupByStatus>) => groups.map((g) => [g.key, ...g.nodes.map((n) => n.agent.id)]);

describe('grupos por status', () => {
  it('cada status cai no seu grupo', () => {
    const of = (status: AgentStatus) => statusGroup(agent('a', status), state());
    expect(of('waiting')).toBe('input');
    expect(of('working')).toBe('working');
    expect(of('shell')).toBe('working');
    expect(of('idle')).toBe('review');
    expect(of('done')).toBe('review');
    // saindo: nunca pede revisão, mesmo tendo "mudado de status" agora
    expect(of('offline')).toBe('done');
  });

  it('para revisar x terminado: depende de ter terminado depois da última vez em que foi aberto', () => {
    const a = agent('a', 'idle', { statusSince: 100 });
    expect(statusGroup(a, state({ seen: { 's-a': 99 } }))).toBe('review');
    expect(statusGroup(a, state({ seen: { 's-a': 100 } }))).toBe('done');
    expect(statusGroup(a, state({ seen: { 's-a': 101 } }))).toBe('done');
    // terminou de novo depois de visto: volta para revisar
    expect(statusGroup({ ...a, statusSince: 200 }, state({ seen: { 's-a': 101 } }))).toBe('review');
    // marcar como visto move para terminados, e nunca anda para trás
    expect(statusGroup(a, markSeen(state(), ['s-a'], 150))).toBe('done');
    expect(markSeen(state({ seen: { 's-a': 150 } }), ['s-a'], 10).seen['s-a']).toBe(150);
  });

  it('primeira vez no navegador: quem já tinha terminado conta como visto', () => {
    const before = agent('antes', 'idle', { statusSince: 100 });
    const first = settle(DEFAULT_STATE, new Set(['s-antes']), 1_000);
    expect(first.since).toBe(1_000);
    expect(statusGroup(before, first)).toBe('done');
    // quem termina depois disso pede revisão
    expect(statusGroup(agent('depois', 'idle', { statusSince: 1_001 }), first)).toBe('review');
    // e o `since` não muda nas próximas vezes
    expect(settle(first, new Set(['s-antes']), 9_000)).toBe(first);
  });

  it('ordem dos grupos, sem os vazios; quem espera há mais tempo e quem terminou por último vêm primeiro', () => {
    const nodes = [
      node(agent('t1', 'idle', { statusSince: 10 })),
      node(agent('w', 'working')),
      node(agent('r', 'idle', { statusSince: 300 })),
      node(agent('i2', 'waiting', { statusSince: 90 })),
      node(agent('i1', 'waiting', { statusSince: 80 })),
      node(agent('s', 'shell')),
      node(agent('t2', 'idle', { statusSince: 20 })),
    ];
    expect(shape(groupByStatus(nodes, state()))).toEqual([
      ['input', 'i1', 'i2'],
      ['review', 'r'],
      ['working', 'w', 's'],
      ['done', 't2', 't1'],
    ]);
    expect(shape(groupByStatus([node(agent('w', 'working'))], state()))).toEqual([['working', 'w']]);
    expect(groupByStatus([], state())).toEqual([]);
  });

  it('fixar: o agente aparece só em Fixados, na ordem em que foi fixado, e continua lá quando o status muda', () => {
    let st = togglePin(togglePin(state(), 's-b'), 's-a');
    expect(st.pins).toEqual(['s-b', 's-a']);
    const nodes = (statusOfA: AgentStatus) => [node(agent('a', statusOfA)), node(agent('b', 'working')), node(agent('c', 'working'))];
    for (const status of ['working', 'waiting', 'idle', 'shell', 'offline'] as const) {
      expect(shape(groupByStatus(nodes(status), st))).toEqual([
        ['pinned', 'b', 'a'],
        ['working', 'c'],
      ]);
    }
    st = togglePin(st, 's-b');
    expect(shape(groupByStatus(nodes('waiting'), st))).toEqual([
      ['pinned', 'a'],
      ['working', 'b', 'c'],
    ]);
  });

  it('subagentes acompanham o agente principal, em qualquer grupo; subagente solto nunca é fixado nem pede revisão', () => {
    const snap = (status: AgentStatus) => ({
      rooms: [{ id: 'api', name: 'api', path: '/p/api', slot: 0, seed: 0, createdAt: 0 }],
      accounts: [],
      agents: [agent('pai', status), agent('sub', 'working', { kind: 'sub', parentId: 'pai', sessionId: 's-pai' }), agent('solto', 'done', { kind: 'sub', parentId: 'fora', sessionId: 's-pai' })],
    });
    const nodes = (status: AgentStatus) => groupRooms(snap(status)).flatMap((g) => g.nodes);
    for (const [status, key] of [['waiting', 'input'], ['idle', 'review'], ['working', 'working']] as const) {
      const g = groupByStatus(nodes(status), state()).find((x) => x.key === key)!;
      expect(g.nodes.find((n) => n.agent.id === 'pai')!.subs.map((s) => s.id)).toEqual(['sub']);
    }
    const pinned = groupByStatus(nodes('idle'), state({ pins: ['s-pai'] }));
    expect(shape(pinned)).toEqual([
      ['pinned', 'pai'],
      ['done', 'solto'],
    ]);
    expect(pinned[0].nodes[0].subs.map((s) => s.id)).toEqual(['sub']);
  });

  it('esquece fixados e vistos de sessões que sumiram, mas só depois da folga', () => {
    const st = state({ pins: ['s-a', 's-b'], seen: { 's-a': 5, 's-c': 6 } });
    const live = new Set(['s-a']);
    const t0 = settle(st, live, 1_000);
    expect(t0.gone).toEqual({ 's-b': 1_000, 's-c': 1_000 });
    expect(t0.pins).toEqual(['s-a', 's-b']);
    // dentro da folga nada some, e nada muda (mesmo objeto: não regrava o armazenamento)
    expect(settle(t0, live, 1_000 + GONE_MS)).toBe(t0);
    // a sessão voltou (servidor reiniciou, sessão retomada): a contagem zera
    expect(settle(t0, new Set(['s-a', 's-b']), 2_000).gone).toEqual({ 's-c': 1_000 });
    const late = settle(t0, live, 1_001 + GONE_MS);
    expect(late.pins).toEqual(['s-a']);
    expect(late.seen).toEqual({ 's-a': 5 });
    expect(late.gone).toEqual({});
  });

  it('só "Terminados" começa recolhido; a escolha do usuário vale', () => {
    expect(isCollapsed(DEFAULT_STATE, 'done')).toBe(true);
    expect(isCollapsed(DEFAULT_STATE, 'review')).toBe(false);
    expect(isCollapsed(state({ collapsed: { done: false, input: true } }), 'done')).toBe(false);
    expect(isCollapsed(state({ collapsed: { done: false, input: true } }), 'input')).toBe(true);
  });

  it('estado guardado em outro formato não quebra', () => {
    expect(sanitizeState(null)).toEqual(DEFAULT_STATE);
    expect(sanitizeState('x')).toEqual(DEFAULT_STATE);
    expect(sanitizeState({ view: 'rooms', pins: ['a', 3, 'a'], seen: { a: 1, b: 'x' }, collapsed: { done: false, x: 1 }, since: '7', gone: [] })).toEqual({
      view: 'rooms',
      collapsed: { done: false },
      pins: ['a'],
      seen: { a: 1 },
      since: 0,
      gone: {},
    });
  });
});
