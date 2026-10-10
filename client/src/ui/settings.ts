// Configurações (popover): opções do escritório, avisos, modo demonstração e Sobre (versão).
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setAttr, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { notificationState, type Notifier } from './notify';
import type { UiPrefs } from './prefs';
import { SoundSettingsGroup } from './settings-sound';
import type { SoundControl } from './sound';
import { AboutGroup } from './version';
import { i18n } from '../../../shared/i18n';

type BoolPref = { [K in keyof UiPrefs]: UiPrefs[K] extends boolean ? K : never }[keyof UiPrefs];

interface SwitchRefs {
  btn: HTMLButtonElement;
  hint: HTMLElement;
}

function switchRow(label: string, hintText: string, onToggle: () => void): SwitchRefs & { row: HTMLElement } {
  const id = `ui-sw-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const btn = h('button', { class: 'ui-switch', type: 'button', role: 'switch', attrs: { 'aria-checked': 'false', 'aria-labelledby': id } }, h('span', { class: 'ui-switch__knob' }));
  btn.addEventListener('click', onToggle);
  const hint = h('span', { class: 'ui-set__hint', text: hintText });
  const row = h('div', { class: 'ui-set' }, h('div', { class: 'ui-set__text' }, h('span', { class: 'ui-set__label', text: label, attrs: { id } }), hint), btn);
  return { row, btn, hint };
}

function segmented<T extends string>(label: string, options: readonly [T, string][], onPick: (v: T) => void): { row: HTMLElement; set(v: T): void } {
  const group = h('div', { class: 'ui-seg', role: 'radiogroup', attrs: { 'aria-label': label } });
  const buttons = options.map(([value, text]) => {
    const b = h('button', { class: 'ui-seg__opt', type: 'button', role: 'radio', text, attrs: { 'aria-checked': 'false' } });
    b.addEventListener('click', () => onPick(value));
    b.addEventListener('keydown', (e) => {
      // Setas navegam entre as opções (padrão de radiogroup).
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      e.stopPropagation();
      const i = options.findIndex(([v]) => v === value);
      const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
      onPick(next[0]);
      buttons[options.indexOf(next)].focus();
    });
    group.append(b);
    return b;
  });
  const row = h('div', { class: 'ui-set ui-set--stack' }, h('span', { class: 'ui-set__label', text: label }), group);
  return {
    row,
    set(v: T) {
      options.forEach(([value], i) => {
        const on = value === v;
        setAttr(buttons[i], 'aria-checked', String(on));
        buttons[i].tabIndex = on ? 0 : -1;
      });
    },
  };
}

export class SettingsPopover implements UiComponent {
  readonly el: HTMLElement;
  private switches = new Map<BoolPref | 'demo', SwitchRefs>();
  private bubbles: ReturnType<typeof segmented<UiPrefs['bubbles']>>;
  private liveliness: ReturnType<typeof segmented<UiPrefs['liveliness']>>;
  private daylight: ReturnType<typeof segmented<UiPrefs['daylight']>>;
  private soundGroup: SoundSettingsGroup;
  private demoGroup: HTMLElement;
  private about: AboutGroup;
  private demoBusy = false;
  private anchor: HTMLElement | null = null;

  constructor(
    private ctx: UiContext,
    private notifier: Notifier,
    sound: SoundControl,
  ) {
    const sw = (key: BoolPref | 'demo', label: string, hint: string, onToggle: () => void) => {
      const r = switchRow(label, hint, onToggle);
      this.switches.set(key, r);
      return r.row;
    };
    const flip = (key: BoolPref) => () => ctx.updatePrefs({ [key]: !ctx.prefs[key] } as Partial<UiPrefs>);

    this.bubbles = segmented<UiPrefs['bubbles']>(
      i18n('Balões de atividade'),
      [
        ['all', i18n('Todos')],
        ['important', i18n('Importantes')],
        ['none', i18n('Nenhum')],
      ],
      (v) => ctx.updatePrefs({ bubbles: v }),
    );
    this.liveliness = segmented<UiPrefs['liveliness']>(
      i18n('Movimento pelo escritório'),
      [
        ['calm', i18n('Calmo')],
        ['normal', i18n('Normal')],
        ['lively', i18n('Agitado')],
      ],
      (v) => ctx.updatePrefs({ liveliness: v }),
    );
    this.daylight = segmented<UiPrefs['daylight']>(
      i18n('Ciclo dia/noite'),
      [
        ['auto', i18n('Automático')],
        ['day', i18n('Sempre dia')],
        ['night', i18n('Sempre noite')],
      ],
      (v) => ctx.updatePrefs({ daylight: v }),
    );
    this.daylight.row.append(h('span', { class: 'ui-set__hint', text: i18n('Automático: céu, luzes e sol nas janelas seguem a hora local.') }));
    this.soundGroup = new SoundSettingsGroup(ctx, sound);

    this.demoGroup = h(
      'div',
      { class: 'ui-set-group' },
      h('h3', { text: i18n('Dados') }),
      sw('demo', i18n('Modo demonstração'), i18n('Coloca agentes fictícios no escritório, junto com os reais.'), () => void this.toggleDemo()),
    );

    this.about = new AboutGroup(ctx);

    const close = iconButton(ICONS.close, i18n('Fechar configurações'), () => this.hide(), 'ui-icon-btn--sm');
    this.el = h(
      'div',
      { class: 'ui-popover ui-settings', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': i18n('Configurações'), id: 'ui-settings', popover: 'auto' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: i18n('Configurações') }), close),
      h(
        'div',
        { class: 'ui-set-group' },
        h('h3', { text: i18n('Escritório') }),
        sw('showNames', i18n('Mostrar nomes'), i18n('Etiqueta com o nome acima de cada personagem.'), flip('showNames')),
        this.bubbles.row,
        this.liveliness.row,
        this.daylight.row,
      ),
      h(
        'div',
        { class: 'ui-set-group' },
        h('h3', { text: i18n('Avisos') }),
        sw('browserNotifications', i18n('Notificações do navegador'), i18n('Avisa quando alguém precisa de você e a aba está em segundo plano.'), () => void this.toggleNotifications()),
      ),
      this.soundGroup.el,
      this.demoGroup,
      this.about.el,
    );
    this.el.addEventListener('toggle', () => {
      this.anchor?.setAttribute('aria-expanded', String(this.isOpen));
      this.syncRootClass();
      if (this.isOpen) this.render();
    });
  }

  get isOpen(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  toggle(anchor: HTMLElement): void {
    this.anchor = anchor;
    if (this.isOpen) return this.hide();
    const r = anchor.getBoundingClientRect();
    this.el.style.top = `${Math.round(r.bottom + 8)}px`;
    this.el.style.right = `${Math.max(8, Math.round(innerWidth - r.right - 4))}px`;
    if (typeof this.el.showPopover === 'function') this.el.showPopover();
    else this.el.classList.add('is-open');
    anchor.setAttribute('aria-expanded', 'true');
    this.syncRootClass();
    // Leva o foco para dentro do popover (sem anel de foco num controle específico).
    this.el.focus();
  }

  /** Abre (se fechado) e leva até a seção "Sobre". */
  showAbout(anchor: HTMLElement): void {
    if (!this.isOpen) this.toggle(anchor);
    this.render();
    requestAnimationFrame(() => this.about.highlight());
  }

  hide(): void {
    if (typeof this.el.hidePopover === 'function' && this.isOpen) this.el.hidePopover();
    this.el.classList.remove('is-open');
    this.anchor?.setAttribute('aria-expanded', 'false');
    this.syncRootClass();
  }

  /** Com o popover aberto, os avisos recolhem (não aparecem por trás nem ao lado dele). */
  private syncRootClass(): void {
    this.ctx.root.classList.toggle('has-popover', this.isOpen);
  }

  render(): void {
    const p = this.ctx.prefs;
    for (const [key, r] of this.switches) {
      const on = key === 'demo' ? !!this.ctx.store.liveSnapshot?.meta.demo : p[key];
      setAttr(r.btn, 'aria-checked', String(on));
      r.btn.disabled = key === 'demo' && this.demoBusy;
    }
    this.bubbles.set(p.bubbles);
    this.liveliness.set(p.liveliness);
    this.daylight.set(p.daylight);
    this.soundGroup.render();
    setHidden(this.demoGroup, this.ctx.store.mock);
    this.about.render();

    const notif = this.switches.get('browserNotifications')!;
    const state = notificationState();
    const hint =
      state === 'unsupported'
        ? i18n('Este navegador não oferece notificações.')
        : state === 'denied'
          ? i18n('Bloqueadas pelo navegador: libere nas permissões do site.')
          : i18n('Avisa quando alguém precisa de você e a aba está em segundo plano.');
    setText(notif.hint, hint);
    notif.btn.disabled = state === 'unsupported';
  }

  private async toggleNotifications(): Promise<void> {
    if (this.ctx.prefs.browserNotifications) {
      this.ctx.updatePrefs({ browserNotifications: false });
      return;
    }
    const state = await this.notifier.enableBrowserNotifications();
    this.ctx.updatePrefs({ browserNotifications: state === 'granted' });
    if (state === 'denied') this.ctx.announce(i18n('Notificações bloqueadas pelo navegador.'));
  }

  private async toggleDemo(): Promise<void> {
    if (this.demoBusy) return;
    this.demoBusy = true;
    this.render();
    const enable = !this.ctx.store.snapshot?.meta.demo;
    try {
      const ok = await this.ctx.store.setDemo(enable);
      this.ctx.announce(ok ? (enable ? i18n('Modo demonstração ligado.') : i18n('Modo demonstração desligado.')) : i18n('Não foi possível mudar o modo demonstração.'));
    } catch {
      this.ctx.announce(i18n('Não foi possível falar com o servidor.'));
    } finally {
      this.demoBusy = false;
      this.ctx.invalidate();
    }
  }
}
