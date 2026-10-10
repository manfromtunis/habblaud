// Idioma da interface, estilo gettext: o texto em PT-BR fica no código e é a chave; os outros idiomas são
// catálogos "português -> tradução" (en.ts). Chave sem tradução cai no português. Código puro, sem dependências.
//
//   i18n('Salas')                                  texto fixo
//   i18n`Editando ${file}`                         template: a chave é "Editando {0}" e a tradução usa {0}, {1}...
//   i18n('Olá, {nome}!', { nome })                 parâmetros nomeados (opcional)
//   i18nN(n, '{n} agente', '{n} agentes')          plural (a forma é escolhida aqui; {n} é o número)
//
// O idioma vem de um lugar só: HABBLAUD_LANG no servidor (`pt-BR` é o padrão, `en`), que o servidor repassa à página
// no <html lang>. Por isso ele é lido aqui, na carga do módulo: assim vale também para as constantes de módulo.
import { EN } from './en';

export type Lang = 'pt-BR' | 'en';

const CATALOGS: Record<Lang, Readonly<Record<string, string>> | undefined> = { 'pt-BR': undefined, en: EN };

/** "en", "en-US", "EN_us" -> 'en'; qualquer outra coisa (ou nada) -> 'pt-BR'. */
export function parseLang(value: string | undefined | null): Lang {
  return /^en(?:[-_]|$)/i.test(value?.trim() ?? '') ? 'en' : 'pt-BR';
}

function detectLang(): Lang {
  const g = globalThis as { document?: { documentElement?: { lang?: string } }; process?: { env?: Record<string, string | undefined> } };
  return parseLang(g.document?.documentElement?.lang || g.process?.env?.HABBLAUD_LANG);
}

let lang: Lang = detectLang();

export function getLang(): Lang {
  return lang;
}

/** Só para testes: em produção o idioma é o do ambiente (ver o topo do arquivo). */
export function setLang(next: Lang): void {
  lang = next;
}

/**
 * Locale do Intl (datas e números) do idioma atual. Inglês usa en-GB para manter o relógio de 24 h que o layout
 * espera ("14:30", não "02:30 PM").
 */
export function locale(): string {
  return lang === 'en' ? 'en-GB' : 'pt-BR';
}

/** Troca {nome} / {0} pelo valor; marcador sem valor fica como está (ex.: os {nome} das falas, preenchidos depois). */
const fill = (text: string, has: (name: string) => boolean, get: (name: string) => unknown): string =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) => (has(name) ? String(get(name)) : whole));

const lookup = (catalog: Readonly<Record<string, string>> | undefined, key: string): string | undefined =>
  catalog && Object.hasOwn(catalog, key) ? catalog[key] : undefined;

export function i18n(key: string, params?: Readonly<Record<string, unknown>>): string;
export function i18n(strings: TemplateStringsArray, ...values: unknown[]): string;
export function i18n(key: string | TemplateStringsArray, ...rest: unknown[]): string {
  const catalog = CATALOGS[lang];
  if (typeof key === 'string') {
    const text = lookup(catalog, key) ?? key;
    const params = rest[0] as Readonly<Record<string, unknown>> | undefined;
    return params ? fill(text, (name) => name in params, (name) => params[name]) : text;
  }
  // Template: sem catálogo, monta como o template comum montaria (o padrão PT-BR não muda em nada).
  const translated = lookup(catalog, key.reduce((acc, part, i) => `${acc}{${i - 1}}${part}`));
  if (translated === undefined) return key.reduce((acc, part, i) => acc + String(rest[i - 1]) + part);
  return fill(translated, (name) => /^\d+$/.test(name) && Number(name) < rest.length, (name) => rest[Number(name)]);
}

/** Plural: escolhe a forma por `n` (1 = singular), traduz e troca `{n}` pelo número. */
export function i18nN(n: number, one: string, many: string, params?: Readonly<Record<string, unknown>>): string {
  return i18n(n === 1 ? one : many, { n, ...params });
}
