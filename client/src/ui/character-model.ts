// Editor do personagem, parte pura (sem DOM): quando a gaveta oferece a edição, como as peças se agrupam, os rótulos
// em português e o que vai para o servidor em `parts`. A interface fica em character-editor.ts.
import { PART_KEYS, type AppearanceParts, type PartKey } from '../../../shared/appearance';
import { isDemoId } from '../../../shared/timeline';
import type { AgentInfo } from '../../../shared/types';
import type { Appearance } from '../art/api';
import { i18n } from '../../../shared/i18n';

export interface EditGate {
  /** O agente ainda está no escritório. */
  live: boolean;
  /** meta.terminal: o Habblaud só é acessível pelo próprio computador (bind local). */
  terminal: boolean;
  /** A página foi aberta por localhost/127.x (o servidor recusa o resto). */
  local: boolean;
  replaying: boolean;
  mock: boolean;
}

/**
 * O lápis "Editar personagem" aparece? Só para o principal real, ao vivo, que não está saindo (offline: o servidor
 * responderia 404) e com acesso local (a trava do terminal).
 */
export function canEditCharacter(a: Pick<AgentInfo, 'id' | 'kind' | 'status'>, g: EditGate): boolean {
  return a.kind === 'main' && a.status !== 'offline' && g.live && g.terminal && g.local && !g.replaying && !g.mock && !isDemoId(a.id);
}

/** Peças que diferem da aparência sorteada pela seed (o que vai em `parts`), na ordem de PART_KEYS. */
export function changedParts(base: Appearance, edited: Appearance): AppearanceParts {
  const out: Record<string, string> = {};
  for (const k of PART_KEYS) {
    const v = edited[k];
    if (v !== undefined && v !== base[k]) out[k] = v;
  }
  return out as AppearanceParts;
}

export interface EditorRow {
  key: PartKey;
  label: string;
  kind: 'style' | 'color';
}

export const EDITOR_GROUPS: readonly { title: string; rows: readonly EditorRow[] }[] = [
  { title: i18n('Pele'), rows: [{ key: 'skin', label: i18n('Tom'), kind: 'color' }] },
  {
    title: i18n('Cabelo'),
    rows: [
      { key: 'hairStyle', label: i18n('Estilo'), kind: 'style' },
      { key: 'hair', label: i18n('Cor'), kind: 'color' },
    ],
  },
  { title: i18n('Barba'), rows: [{ key: 'facialHair', label: i18n('Estilo'), kind: 'style' }] },
  { title: i18n('Olhos'), rows: [{ key: 'eyes', label: i18n('Cor'), kind: 'color' }] },
  {
    title: i18n('Parte de cima'),
    rows: [
      { key: 'topStyle', label: i18n('Estilo'), kind: 'style' },
      { key: 'top', label: i18n('Cor'), kind: 'color' },
      { key: 'topAccent', label: i18n('Detalhe'), kind: 'color' },
    ],
  },
  {
    title: i18n('Parte de baixo'),
    rows: [
      { key: 'bottomStyle', label: i18n('Estilo'), kind: 'style' },
      { key: 'bottom', label: i18n('Cor'), kind: 'color' },
    ],
  },
  { title: i18n('Sapatos'), rows: [{ key: 'shoes', label: i18n('Cor'), kind: 'color' }] },
  {
    title: i18n('Acessório'),
    rows: [
      { key: 'accessory', label: i18n('Tipo'), kind: 'style' },
      { key: 'accessoryColor', label: i18n('Cor'), kind: 'color' },
    ],
  },
];

const STYLE_LABELS: Partial<Record<PartKey, Readonly<Record<string, string>>>> = {
  hairStyle: {
    short: i18n('Curto'), buzz: i18n('Raspado'), spiky: i18n('Espetado'), side_part: i18n('Repartido'), curly: i18n('Cacheado'), afro: i18n('Black power'),
    bob: i18n('Chanel'), long: i18n('Longo'), ponytail: i18n('Rabo de cavalo'), bun: i18n('Coque'), pigtails: i18n('Maria-chiquinha'), mohawk: i18n('Moicano'),
    bald: i18n('Careca'), wavy: i18n('Ondulado'),
  },
  topStyle: {
    tshirt: i18n('Camiseta'), hoodie: i18n('Moletom'), shirt_tie: i18n('Camisa e gravata'), sweater: i18n('Suéter'), jacket: i18n('Jaqueta'),
    blouse: i18n('Blusa'), polo: i18n('Polo'),
  },
  bottomStyle: { pants: i18n('Calça'), shorts: i18n('Bermuda'), skirt: i18n('Saia') },
  accessory: {
    none: i18n('Nenhum'), glasses: i18n('Óculos'), sunglasses: i18n('Óculos escuros'), headphones: i18n('Fone'), cap: i18n('Boné'), beanie: i18n('Gorro'),
    earrings: i18n('Brincos'), bow: i18n('Laço'),
  },
  facialHair: { none: i18n('Sem barba'), stubble: i18n('Por fazer'), beard: i18n('Barba'), mustache: i18n('Bigode'), goatee: i18n('Cavanhaque') },
};

/** Rótulo em português de um estilo (cabelo, roupa, acessório...). */
export function styleLabel(key: PartKey, value: string): string {
  return STYLE_LABELS[key]?.[value] ?? value;
}

/** A linha aparece com esta aparência? (sem acessório, não há cor de acessório para escolher) */
export function rowVisible(r: EditorRow, a: Pick<Appearance, 'accessory'>): boolean {
  return !(r.key === 'accessoryColor' && a.accessory === 'none');
}
