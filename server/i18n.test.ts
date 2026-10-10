import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EN } from '../shared/i18n/en';
import { getLang, i18n, i18nN, locale, parseLang, setLang } from '../shared/i18n';

afterEach(() => setLang('pt-BR'));

describe('i18n', () => {
  it('o padrão é PT-BR e o texto do código sai como está', () => {
    expect(getLang()).toBe('pt-BR');
    const file = 'App.tsx';
    expect(i18n('Salas')).toBe('Salas');
    expect(i18n`Editando ${file}`).toBe('Editando App.tsx');
    expect(i18n`${1}/${undefined} concluídas`).toBe(`${1}/${undefined} concluídas`);
    expect(locale()).toBe('pt-BR');
  });

  it('parseLang: só "en" (e variantes) liga o inglês', () => {
    expect(['en', 'EN', 'en-US', 'en_GB', ' en '].map(parseLang)).toEqual(['en', 'en', 'en', 'en', 'en']);
    expect([undefined, null, '', 'pt-BR', 'pt', 'fr', 'english'].map(parseLang)).toEqual(Array(7).fill('pt-BR'));
  });

  it('inglês: traduz, interpola e cai no português quando falta a chave', () => {
    setLang('en');
    const file = 'App.tsx';
    expect(i18n('Salas')).toBe('Rooms');
    expect(i18n`Editando ${file}`).toBe('Editing App.tsx');
    expect(i18n('texto que não está no catálogo')).toBe('texto que não está no catálogo');
    expect(i18n`sem tradução: ${file}!`).toBe('sem tradução: App.tsx!');
    expect(i18n('toString')).toBe('toString');
    expect(locale()).toBe('en-GB');
  });

  it('a tradução pode mudar a ordem dos valores, e um valor com chaves não é reinterpretado', () => {
    setLang('en');
    expect(i18n`plano ${'Max'}`).toBe('Max plan');
    expect(i18n`Editando ${'{0}{1}'}`).toBe('Editing {0}{1}');
  });

  it('parâmetros nomeados: preenche os que vieram e deixa os outros para depois', () => {
    setLang('en');
    expect(i18n('Opa, {nome}! Beleza?', { nome: 'Ana' })).toBe("Hey, Ana! How's it going?");
    expect(i18n('Opa, {nome}! Beleza?')).toBe("Hey, {nome}! How's it going?");
  });

  it('plural: a forma sai de n', () => {
    expect(i18nN(1, '1 tarefa já concluída', '{n} tarefas já concluídas')).toBe('1 tarefa já concluída');
    expect(i18nN(3, '1 tarefa já concluída', '{n} tarefas já concluídas')).toBe('3 tarefas já concluídas');
    setLang('en');
    expect(i18nN(1, 'sessão', 'sessões')).toBe('session');
    expect(i18nN(0, 'sessão', 'sessões')).toBe('sessions');
  });
});

describe('catálogo em inglês', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'i18n') walk(p);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
        // Como o texto fica depois de avaliado: sem as barras de escape de aspas e quebras de linha.
        sources.push(readFileSync(p, 'utf8').replace(/\\n/g, '\n').replace(/\\(['"`])/g, '$1'));
      }
    }
  };
  for (const dir of ['client/src', 'shared', 'server']) walk(join(root, dir));
  const all = sources.join('\n');
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** A chave como aparece no código: literal, ou template com `${...}` no lugar de {0}, {1}... */
  const inSource = (key: string): boolean => {
    if (all.includes(key)) return true;
    const parts = key.split(/\{\d+\}/);
    return parts.length > 1 && new RegExp(parts.map(escape).join('\\$\\{[\\s\\S]{1,400}?\\}')).test(all);
  };

  it('toda chave ainda existe no código (chave velha falha aqui)', () => {
    expect(Object.keys(EN).filter((k) => !inSource(k))).toEqual([]);
  });

  it('a tradução usa os mesmos marcadores da chave e não tem travessão', () => {
    const marks = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();
    const bad = Object.entries(EN).filter(([k, v]) => marks(k).join() !== marks(v).join() || /—/.test(v.replace(/“—”/g, '')));
    expect(bad).toEqual([]);
  });
});
