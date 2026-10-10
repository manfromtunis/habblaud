import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, intlLocale, normalizeLocale, setLocale, tr } from './i18n';
import { EN } from './locales/en';
import { FR } from './locales/fr';

const placeholders = (s: string) => new Set(s.match(/\{\w+\}/g) ?? []);

describe('i18n', () => {
  afterEach(() => setLocale('pt-BR'));

  it('os testes rodam em PT, qualquer que seja o idioma da máquina', () => {
    expect(getLocale()).toBe('pt-BR');
  });

  it('reconhece os formatos de idioma do navegador e do sistema', () => {
    expect(normalizeLocale('fr')).toBe('fr');
    expect(normalizeLocale('fr-CA')).toBe('fr');
    expect(normalizeLocale('fr_FR.UTF-8')).toBe('fr');
    expect(normalizeLocale('pt')).toBe('pt-BR');
    expect(normalizeLocale('pt_PT')).toBe('pt-BR');
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('en-GB')).toBe('en');
    expect(normalizeLocale('en_US.UTF-8')).toBe('en');
    expect(normalizeLocale('es-ES')).toBeUndefined();
    expect(normalizeLocale('')).toBeUndefined();
    expect(normalizeLocale(null)).toBeUndefined();
  });

  it('em PT devolve o próprio texto, com as lacunas preenchidas', () => {
    expect(tr('Lendo {0}', ['app.ts'])).toBe('Lendo app.ts');
    expect(tr('Texto que ninguém traduziu')).toBe('Texto que ninguém traduziu');
  });

  it('em francês traduz e pode reordenar as lacunas', () => {
    setLocale('fr');
    expect(tr('Lendo {0}', ['app.ts'])).toBe('Lit app.ts');
    expect(tr('Texto que ninguém traduziu')).toBe('Texto que ninguém traduziu');
    expect(intlLocale()).toBe('fr-FR');
  });

  it('em inglês traduz, com datas e números no relógio de 24 h', () => {
    setLocale('en');
    expect(tr('Lendo {0}', ['app.ts'])).toBe('Reading app.ts');
    expect(tr('Texto que ninguém traduziu')).toBe('Texto que ninguém traduziu');
    expect(intlLocale()).toBe('en-GB');
    expect(new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, 15, 5)))).toBe('15:05');
  });

  it('lacunas sem argumento ficam como estão (as nomeadas são preenchidas por quem chama)', () => {
    expect(tr('Ganhei de {a} a {b}! 🏆')).toBe('Ganhei de {a} a {b}! 🏆');
    expect(tr('{0} e {1}', ['um'])).toBe('um e {1}');
  });

  it.each([
    ['francesa', FR],
    ['inglesa', EN],
  ])('a tradução %s não inventa lacunas que o texto original não tem', (_nome, dict) => {
    for (const [pt, traduzido] of Object.entries(dict)) {
      expect(traduzido.trim(), pt).not.toBe('');
      const original = placeholders(pt);
      for (const p of placeholders(traduzido)) expect(original.has(p), `${pt} -> ${traduzido}`).toBe(true);
    }
  });
});
