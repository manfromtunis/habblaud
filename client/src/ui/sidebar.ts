// Barra lateral: busca, filtro por conta e a lista de agentes, agrupada por status (padrão) ou por sala
// (salas -> agentes -> subagentes).
import type { AccountInfo, AgentInfo } from '../../../shared/types';
import { roomTheme } from '../art';
import type { UiComponent, UiContext } from './context';
import { moveAgent, orderAgents } from './agentorder';
import { moveRoom, orderRooms } from './roomorder';
import { h, iconButton, KeyedList, setAttr, setHidden, setStyleVar, setText, setTitle } from './dom';
import { plural, shortPath } from './format';
import { ICONS } from './icons';
import { groupRooms, roleLabel, STATUS_LABEL, type AgentNode, type RoomGroup } from './model';
import { officeIsEmpty } from './overlays';
import { createAgentRow, updateAgentRow, type RowLead } from './rows';
import { DEFAULT_STATE, groupByStatus, isCollapsed, loadState, markSeen, saveState, settle, statusGroup, togglePin, type GroupKey, type SideState, type StatusGroup } from './statusgroups';
import { createAccountChip, createProgress, updateAccountChip, updateProgress } from './widgets';
import { i18n } from '../../../shared/i18n';

interface RoomRefs {
  head: HTMLButtonElement;
  name: HTMLElement;
  count: HTMLElement;
  path: HTMLElement;
  accs: KeyedList<AccountInfo | string>;
  tasks: HTMLElement;
  tasksBar: HTMLElement;
  tasksText: HTMLElement;
  nodes: KeyedList<AgentNode>;
}

const GROUP_LABEL: Record<GroupKey, string> = {
  pinned: i18n('Fixados'),
  input: i18n('Aguardando resposta'),
  review: i18n('Para revisar'),
  working: i18n('Trabalhando'),
  done: i18n('Terminados'),
};

interface GroupRefs {
  head: HTMLButtonElement;
  count: HTMLElement;
  list: HTMLElement;
  nodes: KeyedList<AgentNode>;
}

interface NodeRefs {
  row: HTMLButtonElement;
  /** Linha do agente: arrastável para reordenar os agentes da sala. */
  head: HTMLElement;
  /** Só na lista por status: "marcar como revisado" e "fixar". */
  tick?: HTMLButtonElement;
  pin?: HTMLButtonElement;
  subsWrap: HTMLElement;
  subsCaption: HTMLElement;
  subs: KeyedList<AgentInfo>;
}

export class Sidebar implements UiComponent {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private query = '';
  private filters: HTMLElement;
  private filterList: KeyedList<AccountInfo, HTMLButtonElement>;
  private scroller: HTMLElement;
  private rooms: KeyedList<RoomGroup>;
  /** Lista por status (ui/statusgroups.ts) e o estado dela neste quadro (visão, fixados, vistos). */
  private groups: KeyedList<StatusGroup>;
  private groupRefs = new WeakMap<HTMLElement, GroupRefs>();
  private state: SideState = DEFAULT_STATE;
  private viewBtns: Record<SideState['view'], HTMLButtonElement>;
  /** Sessões mostradas em "Para revisar" (para o "Marcar todos como revisados"). */
  private reviewing: string[] = [];
  private roomRefs = new WeakMap<HTMLElement, RoomRefs>();
  private nodeRefs = new WeakMap<HTMLElement, NodeRefs>();
  /** Agentes de cada sala na ordem mostrada (para arrastar e soltar). */
  private shown = new Map<string, AgentNode[]>();
  private dragging: { id: string; room: string } | null = null;
  /** Sala sendo arrastada (reordenar as salas) e a ordem mostrada agora. */
  private draggingRoom: string | null = null;
  private shownRooms: string[] = [];
  private empty: HTMLElement;
  private emptyText: HTMLElement;
  private clearBtn: HTMLButtonElement;
  private lastSelKey = '';

  constructor(private ctx: UiContext) {
    this.input = h('input', {
      class: 'ui-search__input',
      type: 'search',
      attrs: { placeholder: i18n('Buscar agente, projeto ou conta'), 'aria-label': i18n('Buscar agente, projeto ou conta'), autocomplete: 'off', spellcheck: 'false' },
    });
    this.input.addEventListener('input', () => {
      this.query = this.input.value;
      this.ctx.invalidate();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (this.input.value) {
          this.input.value = '';
          this.query = '';
          this.ctx.invalidate();
        } else {
          this.input.blur();
        }
      }
    });
    const searchIcon = h('span', { class: 'ui-search__icon', attrs: { 'aria-hidden': 'true' } });
    searchIcon.innerHTML = ICONS.search;
    const search = h('label', { class: 'ui-search' }, searchIcon, this.input, h('kbd', { class: 'ui-kbd', text: '/', title: i18n('Atalho: /') }));

    this.filters = h('div', { class: 'ui-acc-filters', role: 'group', attrs: { 'aria-label': i18n('Filtrar por conta') } });
    this.filterList = new KeyedList<AccountInfo, HTMLButtonElement>(this.filters, {
      animate: false,
      key: (a) => a.id,
      create: (a) => {
        const chip = createAccountChip('sm');
        const b = h('button', { class: 'ui-acc-filter', type: 'button' }, chip, h('span', { class: 'ui-acc-filter__name' }));
        b.addEventListener('click', () => this.toggleAccount(a.id));
        return b;
      },
      update: (b, a) => {
        const hidden = this.ctx.prefs.hiddenAccounts.includes(a.id);
        updateAccountChip(b.firstElementChild as HTMLElement, a);
        setText(b.lastElementChild!, a.name);
        setAttr(b, 'aria-pressed', String(!hidden));
        setTitle(b, hidden ? i18n`Mostrar a ${a.name} na lista, no feed e nos avisos` : i18n`Ocultar a ${a.name} na lista, no feed e nos avisos (o escritório continua mostrando todos)`);
        b.classList.toggle('is-off', hidden);
      },
    });

    const viewOpt = (view: SideState['view'], text: string) =>
      h('button', { class: 'ui-seg__opt', type: 'button', role: 'radio', text, on: { click: () => this.update((s) => ({ ...s, view })) } });
    this.viewBtns = { status: viewOpt('status', i18n('Status')), rooms: viewOpt('rooms', i18n('Salas')) };
    const views = h('div', { class: 'ui-seg', role: 'radiogroup', attrs: { 'aria-label': i18n('Agrupar por') } }, this.viewBtns.status, this.viewBtns.rooms);

    this.scroller = h('div', { class: 'ui-side__scroll' });
    const byStatus = h('div', { class: 'ui-rooms', role: 'list', attrs: { 'aria-label': i18n('Agentes por status') } });
    this.groups = new KeyedList<StatusGroup>(byStatus, {
      key: (g) => g.key,
      create: (g) => this.createGroup(g.key),
      update: (el, g) => this.updateGroup(el, g),
    });
    const list = h('div', { class: 'ui-rooms', role: 'list', attrs: { 'aria-label': i18n('Salas') } });
    this.scroller.append(byStatus, list);
    this.rooms = new KeyedList<RoomGroup>(list, {
      key: (g) => g.room.id,
      create: (g) => this.createRoom(g),
      update: (el, g) => this.updateRoom(el, g),
    });

    this.emptyText = h('p');
    this.clearBtn = h('button', {
      class: 'ui-link-btn',
      type: 'button',
      text: i18n('Limpar filtros'),
      on: {
        click: () => {
          this.input.value = '';
          this.query = '';
          this.ctx.updatePrefs({ hiddenAccounts: [] });
        },
      },
    });
    this.empty = h('div', { class: 'ui-side__empty', hidden: true }, this.emptyText, this.clearBtn);
    this.scroller.append(this.empty);

    const close = iconButton(ICONS.close, i18n('Fechar painel lateral'), () => ctx.togglePanel('sidebar', false), 'ui-side__close');
    this.el = h(
      'aside',
      { class: 'ui-panel ui-sidebar', attrs: { 'aria-label': i18n('Salas e agentes'), id: 'ui-sidebar' } },
      h('div', { class: 'ui-side__head' }, h('div', { class: 'ui-side__title' }, h('h2', { text: i18n('Escritório') }), close), search, views, this.filters),
      this.scroller,
    );
  }

  focusSearch(): void {
    this.input.focus();
    this.input.select();
  }

  render(): void {
    const snap = this.ctx.store.snapshot;
    const accounts = snap?.accounts ?? [];
    const hidden = new Set(this.ctx.prefs.hiddenAccounts);
    this.filterList.sync(accounts.length > 1 ? accounts : []);
    setHidden(this.filters, accounts.length <= 1);

    // Ao mudar a seleção (ex.: clique no canvas), traz o item para a área visível (no fim, com a lista pronta).
    const sel = this.ctx.selection();
    const selKey = sel ? `${sel.type}:${sel.id}` : '';
    const selChanged = selKey !== this.lastSelKey;
    this.lastSelKey = selKey;

    // Estado da lista por status, lido a cada quadro (outra aba pode ter mudado). Abrir um agente, pela lista ou
    // pelo escritório, conta como visto: ele sai de "Para revisar". No timelapse nada é gravado (é outro dia e hora).
    const saved = loadState();
    let state = saved;
    if (snap && !this.ctx.store.replaying) {
      state = settle(state, new Set(snap.agents.map((a) => a.sessionId)), this.ctx.now());
      const opened = selChanged && sel?.type === 'agent' ? this.ctx.agent(sel.id) : undefined;
      if (opened?.kind === 'main') state = markSeen(state, [opened.sessionId], this.ctx.now());
      if (state !== saved) saveState(state);
    }
    this.state = state;
    const byStatus = state.view === 'status';
    for (const [view, b] of Object.entries(this.viewBtns)) setAttr(b, 'aria-checked', String(view === state.view));

    // Ordem das salas escolhida pelo usuário (arrastando o cabeçalho da sala).
    const groups = orderRooms(groupRooms(snap, { query: this.query, hiddenAccounts: hidden }), (g) => g.room.id);
    const nodes = groups.flatMap((g) => g.nodes);
    this.shownRooms = groups.map((g) => g.room.id);
    this.rooms.sync(byStatus ? [] : groups);
    this.groups.sync(byStatus ? groupByStatus(nodes, state) : []);
    setHidden(this.rooms.container, byStatus);
    setHidden(this.groups.container, !byStatus);

    const filtering = this.query.trim().length > 0 || hidden.size > 0;
    const total = snap?.agents.length ?? 0;
    // Escritório vazio sem filtro: o cartão central já explica; a lista não repete o aviso.
    const showEmpty = (byStatus ? nodes : groups).length === 0 && (filtering || !officeIsEmpty(this.ctx));
    setHidden(this.empty, !showEmpty);
    if (showEmpty) {
      setText(
        this.emptyText,
        filtering && total > 0
          ? this.query.trim()
            ? i18n`Nenhum agente encontrado para “${this.query.trim()}”.`
            : i18n('Nenhum agente nas contas selecionadas.')
          : i18n('Nenhuma sessão aberta no momento.'),
      );
      setHidden(this.clearBtn, !(filtering && total > 0));
    }

    if (selChanged && sel) {
      const target =
        sel.type === 'agent'
          ? this.el.querySelector<HTMLElement>(`.ui-agent[data-id="${CSS.escape(sel.id)}"]`)
          : this.el.querySelector<HTMLElement>(`.ui-room[data-key="${CSS.escape(sel.id)}"] .ui-room__head`);
      target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /** Muda o estado guardado da lista por status (visão, grupos recolhidos, fixados, vistos) e redesenha. */
  private update(change: (state: SideState) => SideState): void {
    saveState(change(loadState()));
    this.ctx.invalidate();
  }

  // ---------------------------------------------------------------- grupos por status

  private createGroup(key: GroupKey): HTMLElement {
    const chevron = h('span', { class: 'ui-sgroup__chevron', attrs: { 'aria-hidden': 'true' } });
    chevron.innerHTML = ICONS.chevronDown;
    const count = h('span', { class: 'ui-room__count' });
    const head = h(
      'button',
      { class: 'ui-room__head', type: 'button', on: { click: () => this.update((s) => ({ ...s, collapsed: { ...s.collapsed, [key]: !isCollapsed(s, key) } })) } },
      h('span', { class: 'ui-room__line' }, h('span', { class: 'ui-room__name', text: GROUP_LABEL[key] }), count, chevron),
    );
    const all =
      key === 'review' &&
      h('button', {
        class: 'ui-link-btn ui-sgroup__all',
        type: 'button',
        text: i18n('Marcar todos como revisados'),
        on: { click: () => this.update((s) => markSeen(s, this.reviewing, this.ctx.now())) },
      });
    const list = h('ul', { class: 'ui-nodes' });
    const section = h('section', { class: `ui-room ui-sgroup is-${key}`, role: 'listitem' }, h('div', { class: 'ui-sgroup__bar' }, head, all), list);
    const nodes = new KeyedList<AgentNode>(list, {
      key: (n) => n.agent.id,
      create: (n) => this.createNode(n, true),
      update: (el, n) => this.updateNode(el, n),
    });
    this.groupRefs.set(section, { head, count, list, nodes });
    return section;
  }

  private updateGroup(section: HTMLElement, g: StatusGroup): void {
    const r = this.groupRefs.get(section)!;
    const collapsed = isCollapsed(this.state, g.key);
    setText(r.count, String(g.nodes.length));
    setAttr(r.head, 'aria-expanded', String(!collapsed));
    setAttr(r.head, 'aria-label', `${GROUP_LABEL[g.key]}, ${plural(g.nodes.length, i18n('agente'), i18n('agentes'))}`);
    section.classList.toggle('is-collapsed', collapsed);
    setHidden(r.list, collapsed);
    if (g.key === 'review') this.reviewing = g.nodes.map((n) => n.agent.sessionId);
    r.nodes.sync(collapsed ? [] : g.nodes);
  }

  private toggleAccount(id: string): void {
    const set = new Set(this.ctx.prefs.hiddenAccounts);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.ctx.updatePrefs({ hiddenAccounts: [...set] });
  }

  // ---------------------------------------------------------------- salas

  private createRoom(g: RoomGroup): HTMLElement {
    const name = h('span', { class: 'ui-room__name' });
    const count = h('span', { class: 'ui-room__count' });
    const accsEl = h('span', { class: 'ui-room__accs' });
    const path = h('span', { class: 'ui-room__path' });
    const tasksBar = createProgress(i18n('Progresso das tarefas da sala'));
    const tasksText = h('span', { class: 'ui-room__tasks-text' });
    const tasks = h('span', { class: 'ui-room__tasks' }, tasksBar, tasksText);
    const swatch = h('span', { class: 'ui-room__swatch', attrs: { 'aria-hidden': 'true' } });
    const head = h(
      'button',
      { class: 'ui-room__head', type: 'button' },
      swatch,
      h('span', { class: 'ui-room__line' }, name, count, accsEl),
      path,
      tasks,
    );
    head.addEventListener('click', () => this.ctx.select({ type: 'room', id: g.room.id }, { focus: true }));
    this.wireRoomDrag(head, g.room.id);
    // Botão direito: renomear a sala (ui/roomrename.ts).
    head.addEventListener('contextmenu', (e) => {
      if (!this.ctx.renameRoom) return;
      e.preventDefault();
      const r = head.getBoundingClientRect();
      this.ctx.renameRoom(g.room.id, { x: r.left + 12, y: r.bottom + 4 });
    });
    try {
      setStyleVar(head, '--room', roomTheme(g.room.seed).accent);
    } catch {
      // Sem tema: mantém a cor padrão do CSS.
    }
    const agentsEl = h('ul', { class: 'ui-nodes' });
    const section = h('section', { class: 'ui-room', role: 'listitem' }, head, agentsEl);
    const accs = new KeyedList<AccountInfo | string>(accsEl, {
      animate: false,
      key: (a) => (typeof a === 'string' ? a : a.id),
      create: () => createAccountChip('sm'),
      update: (chip, a) => (typeof a === 'string' ? updateAccountChip(chip, undefined, a) : updateAccountChip(chip, a)),
    });
    const nodes = new KeyedList<AgentNode>(agentsEl, {
      key: (n) => n.agent.id,
      create: (n) => this.createNode(n),
      update: (el, n) => this.updateNode(el, n),
    });
    this.roomRefs.set(section, { head, name, count, path, accs, tasks, tasksBar, tasksText, nodes });
    return section;
  }

  private updateRoom(section: HTMLElement, g: RoomGroup): void {
    const r = this.roomRefs.get(section)!;
    const sel = this.ctx.selection();
    setText(r.name, g.room.name);
    const present = g.agents.filter((a) => a.status !== 'offline').length;
    setText(r.count, String(present));
    setTitle(r.count, plural(present, i18n('agente'), i18n('agentes')));
    setText(r.path, shortPath(g.room.path));
    setTitle(r.head, i18n`${g.room.path}\nClique para ver a sala`);
    setAttr(r.head, 'aria-label', i18n`Sala ${g.room.name}, ${plural(present, i18n('agente'), i18n('agentes'))}`);
    r.accs.sync(g.accounts.map((id) => this.ctx.account(id) ?? id));
    const selected = sel?.type === 'room' && sel.id === g.room.id;
    r.head.classList.toggle('is-selected', selected);
    setAttr(r.head, 'aria-current', selected ? 'true' : null);
    section.classList.toggle('is-empty', present === 0);

    const t = g.tasks;
    setHidden(r.tasks, t.total === 0);
    if (t.total > 0) {
      updateProgress(r.tasksBar, t.completed, t.total, t.inProgress);
      setText(r.tasksText, i18n`${t.completed}/${t.total} tarefas`);
    }
    // Ordem escolhida pelo usuário (arrastando as linhas), guardada no navegador.
    const ordered = orderAgents(g.room.id, g.nodes, (n) => n.agent.sessionId);
    this.shown.set(g.room.id, ordered);
    r.nodes.sync(ordered);
  }

  /** Arrastar o cabeçalho de uma sala reordena as salas da lista. */
  private wireRoomDrag(head: HTMLElement, roomId: string): void {
    head.draggable = true;
    const after = (e: DragEvent) => {
      const rect = head.getBoundingClientRect();
      return e.clientY > rect.top + rect.height / 2;
    };
    const clear = () => {
      for (const el of this.el.querySelectorAll('.ui-room__head.is-drop-before, .ui-room__head.is-drop-after')) el.classList.remove('is-drop-before', 'is-drop-after');
    };
    head.addEventListener('dragstart', (e) => {
      this.draggingRoom = roomId;
      head.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', roomId);
      }
    });
    head.addEventListener('dragend', () => {
      this.draggingRoom = null;
      head.classList.remove('is-dragging');
      clear();
    });
    head.addEventListener('dragover', (e) => {
      const from = this.draggingRoom;
      if (!from || from === roomId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clear();
      head.classList.add(after(e) ? 'is-drop-after' : 'is-drop-before');
    });
    head.addEventListener('dragleave', () => head.classList.remove('is-drop-before', 'is-drop-after'));
    head.addEventListener('drop', (e) => {
      const from = this.draggingRoom;
      clear();
      if (!from || from === roomId) return;
      e.preventDefault();
      if (moveRoom(this.shownRooms, from, roomId, after(e))) this.ctx.invalidate();
    });
  }

  /** Arrastar a linha de um agente principal reordena os agentes da mesma sala. */
  private wireDrag(head: HTMLElement): void {
    head.draggable = true;
    const id = () => head.dataset.id ?? '';
    const room = () => head.dataset.room ?? '';
    const after = (e: DragEvent) => {
      const rect = head.getBoundingClientRect();
      return e.clientY > rect.top + rect.height / 2;
    };
    const clear = () => {
      for (const el of this.el.querySelectorAll('.ui-node__head.is-drop-before, .ui-node__head.is-drop-after')) el.classList.remove('is-drop-before', 'is-drop-after');
    };
    head.addEventListener('dragstart', (e) => {
      this.dragging = { id: id(), room: room() };
      head.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id());
      }
    });
    head.addEventListener('dragend', () => {
      this.dragging = null;
      head.classList.remove('is-dragging');
      clear();
    });
    head.addEventListener('dragover', (e) => {
      const d = this.dragging;
      if (!d || d.room !== room() || d.id === id()) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clear();
      head.classList.add(after(e) ? 'is-drop-after' : 'is-drop-before');
    });
    head.addEventListener('dragleave', () => head.classList.remove('is-drop-before', 'is-drop-after'));
    head.addEventListener('drop', (e) => {
      const d = this.dragging;
      clear();
      if (!d || d.room !== room() || d.id === id()) return;
      e.preventDefault();
      const shown = this.shown.get(d.room) ?? [];
      if (moveAgent(d.room, shown, (n) => n.agent.id, (n) => n.agent.sessionId, d.id, id(), after(e))) this.ctx.invalidate();
    });
  }

  // ---------------------------------------------------------------- agentes

  /** `byStatus`: nó da lista por status (botões de revisar e fixar, sem arrastar); senão, o da lista por sala. */
  private createNode(n: AgentNode, byStatus = false): HTMLElement {
    const row = createAgentRow(n.agent, (id) => this.pick(id));
    const subsCaption = h('span', { class: 'ui-subs__caption' });
    const subsList = h('ul', { class: 'ui-subs__list' });
    const subsWrap = h('div', { class: 'ui-subs', hidden: true }, subsCaption, subsList);
    const head = h('div', { class: 'ui-node__head' }, row);
    const session = () => head.dataset.session ?? '';
    const tick = byStatus ? iconButton(ICONS.check, i18n('Marcar como revisado'), () => this.update((s) => markSeen(s, [session()], this.ctx.now())), 'ui-icon-btn--sm') : undefined;
    const pin = byStatus ? iconButton(ICONS.pin, i18n('Fixar no topo'), () => this.update((s) => togglePin(s, session())), 'ui-icon-btn--sm ui-node__pin') : undefined;
    if (tick && pin) head.append(h('span', { class: 'ui-node__acts' }, pin, tick));
    else this.wireDrag(head);
    const li = h('li', { class: 'ui-node' }, head, subsWrap);
    const subs = new KeyedList<AgentInfo>(subsList, {
      key: (a) => a.id,
      create: (a) => h('li', { class: 'ui-subs__item' }, createAgentRow(a, (id) => this.pick(id), 'sm')),
      update: (li2, a) => this.updateRow(li2.firstElementChild as HTMLElement, a, byStatus ? { detail: roleLabel(a) } : undefined),
    });
    this.nodeRefs.set(li, { row, head, tick, pin, subsWrap, subsCaption, subs });
    return li;
  }

  private updateNode(li: HTMLElement, n: AgentNode): void {
    const r = this.nodeRefs.get(li)!;
    const a = n.agent;
    if (r.tick && r.pin) {
      // Fixado: o grupo não diz mais o status, então a linha ganha um selo colorido com ele.
      const own = statusGroup(a, this.state);
      const pinned = a.kind === 'main' && this.state.pins.includes(a.sessionId);
      const shell = a.status === 'shell';
      const pill = pinned ? { text: shell ? STATUS_LABEL.shell : GROUP_LABEL[own], tone: shell ? 'shell' : own } : undefined;
      this.updateRow(r.row, a, { detail: this.ctx.store.room(a.roomId)?.name ?? '', pill });
      const what = a.title?.trim() || a.name;
      r.head.dataset.session = a.sessionId;
      setHidden(r.tick, own !== 'review');
      setAttr(r.tick, 'aria-label', `${i18n('Marcar como revisado')}: ${what}`);
      // Só agentes principais são fixados (o subagente acompanha quem o disparou).
      setHidden(r.pin, a.kind !== 'main');
      setAttr(r.pin, 'aria-pressed', String(pinned));
      setTitle(r.pin, pinned ? i18n('Desafixar') : i18n('Fixar no topo'));
      setAttr(r.pin, 'aria-label', `${pinned ? i18n('Desafixar') : i18n('Fixar no topo')}: ${what}`);
    } else {
      this.updateRow(r.row, a);
    }
    r.head.dataset.id = n.agent.id;
    r.head.dataset.room = n.agent.roomId;
    const has = n.subTotal > 0;
    setHidden(r.subsWrap, !has);
    if (has) {
      const shown = n.subs.length;
      setText(r.subsCaption, shown === n.subTotal ? plural(n.subTotal, i18n('subagente'), i18n('subagentes')) : i18n`${shown} de ${plural(n.subTotal, i18n('subagente'), i18n('subagentes'))}`);
    }
    r.subs.sync(n.subs);
  }

  private updateRow(row: HTMLElement, a: AgentInfo, lead?: RowLead): void {
    const sel = this.ctx.selection();
    updateAgentRow(row, a, this.ctx.account(a.account), sel?.type === 'agent' && sel.id === a.id, this.ctx.now(), this.ctx.store.snapshot?.agents, lead);
  }

  private pick(id: string): void {
    // Clicar de novo no agente que já está aberto também conta como visto (a seleção não muda).
    const a = this.ctx.agent(id);
    if (a?.kind === 'main') this.update((s) => markSeen(s, [a.sessionId], this.ctx.now()));
    this.ctx.select({ type: 'agent', id }, { focus: true });
    if (this.ctx.isNarrow()) this.ctx.togglePanel('sidebar', false);
  }
}
