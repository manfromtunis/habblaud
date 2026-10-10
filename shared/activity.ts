// Tradução de chamadas de ferramenta do Claude Code em atividades legíveis (PT-BR).
// Código puro, usado pelo servidor (transcripts reais) e pelo simulador de demonstração.
import type { ActivityKind, AskQuestion } from './types';
import { i18n } from './i18n';

export interface ActivityDescription {
  kind: ActivityKind;
  icon: string;
  text: string;
  detail?: string;
  questions?: AskQuestion[];
}

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 6;

/** Perguntas de um AskUserQuestion para exibir no escritório (mascaradas e cortadas, como o resto). */
function askQuestions(raw: unknown): AskQuestion[] {
  const clean = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? truncate(maskSecrets(v.slice(0, n * 4)), n) : '');
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
  // As posições contam no original (com as entradas inválidas): a resposta pelo escritório volta por elas.
  const qs = Array.isArray(raw) ? raw.slice(0, MAX_QUESTIONS) : [];
  return qs.flatMap((q, index) => {
    if (!obj(q)) return [];
    const question = clean(q.question, 300);
    if (!question) return [];
    const opts = Array.isArray(q.options) ? q.options.slice(0, MAX_OPTIONS) : [];
    const options = opts.flatMap((o, index) => {
      if (!obj(o)) return [];
      const label = clean(o.label, 80);
      if (!label) return [];
      const description = clean(o.description, 200);
      return [{ index, label, ...(description ? { description } : {}) }];
    });
    const header = clean(q.header, 30);
    return [{ index, question, ...(header ? { header } : {}), ...(q.multiSelect === true ? { multiSelect: true } : {}), options }];
  });
}

const MAX_TEXT = 46;
const MAX_DETAIL = 300;

/** Colapsa espaços/quebras de linha e corta com reticências. */
export function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, Math.max(1, n - 1)).trimEnd()}…` : one;
}

export function basename(p: string): string {
  const clean = p.replace(/[\\/]+$/, '');
  const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return i >= 0 ? clean.slice(i + 1) : clean;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return truncate(url, 30);
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function make(kind: ActivityKind, icon: string, text: string, detail?: string): ActivityDescription {
  // Mascara antes de cortar (um segredo cortado ao meio vazaria o começo); o recorte prévio só
  // evita rodar as expressões sobre heredocs enormes.
  return {
    kind,
    icon,
    text: truncate(maskSecrets(text.slice(0, MAX_TEXT * 8)), MAX_TEXT),
    ...(detail ? { detail: truncate(maskSecrets(detail.slice(0, MAX_DETAIL * 4)), MAX_DETAIL) } : {}),
  };
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|heic)$/i;

// ------------------------------------------------------------------ segredos

/**
 * Padrões de segredos mascarados em textos e detalhes (comandos, prompts, respostas, erros).
 * Os detalhes vão para o navegador e para o feed: um token colado num `curl` não pode aparecer lá.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Blocos de chave privada (PEM).
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, i18n('[chave privada]')],
  // Cabeçalhos com credenciais: Authorization, Cookie, X-Api-Key...
  [/\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|private-token)(\s*:\s*)[^'"\n]+/gi, '$1$2***'],
  // Bearer/Basic/Token <valor> soltos.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g, '$1 ***'],
  // URL com usuário:senha.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"]+:)[^\s@/'"]+@/gi, '$1***@'],
  // curl -u usuario:senha / --user usuario:senha.
  [/((?:^|\s)(?:-u|--user)\s+['"]?[^\s:'"]+:)[^\s'"]+/g, '$1***'],
  // --token X, --password=X, --api-key X...
  [/((?:^|\s)--?(?:token|password|passwd|pass|secret|api-key|apikey|access-token|auth-token)(?:\s+|=))(['"]?)[^\s'"]+\2/gi, '$1$2***$2'],
  // NOME_SENSIVEL=valor / "password": "valor" (GITHUB_TOKEN, DB_PASSWORD, client_secret, api_key...).
  [
    /\b([A-Za-z0-9_.-]*?(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|private[_-]?key|_key|credentials?))(["']?\s*[=:]\s*)(["']?)([^\s"'&;|,}]+)\3/gi,
    '$1$2$3***$3',
  ],
  // Chaves com prefixo conhecido.
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, 'gh*_***'],
  [/\bgithub_pat_[A-Za-z0-9_]{16,}/g, 'github_pat_***'],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, 'glpat-***'],
  [/\bxox[abposr]-[A-Za-z0-9-]{8,}/g, 'xox*-***'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'AKIA***'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, 'AIza***'],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, 'sk_***'],
  // JWT.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, 'eyJ***'],
];

/** Mascara segredos comuns (tokens, senhas, chaves) num texto livre. */
export function maskSecrets(s: string): string {
  let out = s;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

// ------------------------------------------------------------------ shell

/**
 * Divide em palavras como o shell (aspas e barras invertidas), sem expandir nada. Substituições
 * `$(...)` e `` `...` `` ficam inteiras dentro da palavra (ex.: `NOW=$(date +%s)` é uma palavra só).
 */
export function shellWords(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let q: string | null = null;
  let depth = 0;
  let tick = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") {
      if (c === "'") q = null;
      else cur += c;
      continue;
    }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[++i];
      has = true;
    } else if (c === '`') {
      tick = !tick;
      cur += c;
      has = true;
    } else if (c === '$' && s[i + 1] === '(') {
      depth++;
      cur += '$(';
      i++;
      has = true;
    } else if (depth && c === '(') {
      depth++;
      cur += c;
    } else if (depth && c === ')') {
      depth--;
      cur += c;
    } else if (/\s/.test(c) && !depth && !tick) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

/** Divide uma linha nos operadores de nível superior (`|`, `||`, `&&`, `;`, `&`), fora de aspas e subshells. */
export function splitShell(line: string): string[] {
  const segs: string[] = [];
  let start = 0;
  let q: string | null = null;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\' && q !== "'") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      q = c;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if (depth) continue;
    let len = 0;
    if ((c === '&' && line[i + 1] === '&') || (c === '|' && line[i + 1] === '|')) len = 2;
    else if (c === '|' || c === ';') len = 1;
    else if (c === '&' && line[i - 1] !== '>' && line[i - 1] !== '<' && line[i + 1] !== '>') len = 1;
    if (!len) continue;
    segs.push(line.slice(start, i));
    i += len - 1;
    start = i + 1;
  }
  segs.push(line.slice(start));
  return segs.map((s) => s.trim()).filter(Boolean);
}

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
/**
 * Prefixos que só modificam como o comando roda (o comando "de verdade" vem depois), com as flags
 * de cada um que levam um valor separado (ex.: `nice -n 10`, `npx -p pacote`, `sudo -u fulano`).
 */
const WRAPPERS: Record<string, ReadonlySet<string>> = {
  sudo: new Set(['-u', '-g', '-p', '-C', '-h', '-U']),
  time: new Set(),
  nohup: new Set(),
  exec: new Set(['-a']),
  builtin: new Set(),
  nice: new Set(['-n']),
  caffeinate: new Set(['-t', '-w']),
  stdbuf: new Set(),
  unbuffer: new Set(),
  command: new Set(),
  npx: new Set(['-p', '--package', '-c', '--call']),
  bunx: new Set(['-p', '--package']),
  env: new Set(['-u', '-C', '-S', '--unset', '--chdir']),
};

/** Tira atribuições (`X=1`), prefixos (`nohup`, `npx -y`, `timeout 30`...) e devolve o comando real. */
function stripWrappers(words: string[]): string[] {
  let w = words.slice();
  for (let guard = 0; guard < 12 && w.length; guard++) {
    const head = w[0];
    if (ASSIGN.test(head)) {
      w = w.slice(1);
      continue;
    }
    if (head === '(' || head === '{' || head === '!') {
      w = w.slice(1);
      continue;
    }
    if (head === 'command' && (w[1] === '-v' || w[1] === '-V')) break;
    if (head === 'timeout' || head === 'gtimeout') {
      let i = 1;
      while (i < w.length && w[i].startsWith('-')) i += w[i] === '-s' || w[i] === '-k' ? 2 : 1;
      w = w.slice(i + 1);
      continue;
    }
    if ((head === 'pnpm' || head === 'yarn') && (w[1] === 'dlx' || w[1] === 'exec')) {
      w = w.slice(2);
      continue;
    }
    if (head === 'npm' && w[1] === 'exec') {
      w = w.slice(2);
      continue;
    }
    const valued = Object.hasOwn(WRAPPERS, head) ? WRAPPERS[head] : undefined;
    // Prefixo sozinho (`env`, `time`) é o próprio comando.
    if (!valued || w.length === 1) break;
    let i = 1;
    while (i < w.length && w[i].startsWith('-') && w[i] !== '--') i += valued.has(w[i]) ? 2 : 1;
    if (w[i] === '--') i++;
    w = w.slice(i);
  }
  while (w.length && /^[)}]$/.test(w[w.length - 1])) w = w.slice(0, -1);
  return w;
}

/** Arquivo que recebe a saída padrão (`> arquivo`, `>>arquivo`, `1> arquivo`), se houver. */
function stdoutTarget(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const m = /^1?(>>?)(.*)$/.exec(args[i]);
    if (m) return m[2] || args[i + 1];
  }
  return undefined;
}

/** Segmento que não diz o que o agente está fazendo (preparação): `cd`, `X=1`, `set -e`, `sleep 2`, `echo`... */
function isNoise(words: string[]): boolean {
  if (!words.length) return true;
  const [head] = words;
  if (words.every((x) => ASSIGN.test(x))) return true;
  if (head === 'export' || head === 'unset' || head === 'local' || head === 'readonly') return words.slice(1).every((x) => ASSIGN.test(x) || /^[A-Za-z_]\w*$/.test(x) || x.startsWith('-'));
  if ((head === 'echo' || head === 'printf') && stdoutTarget(words.slice(1))) return false;
  return /^(cd|pushd|popd|set|shopt|source|\.|true|false|:|trap|ulimit|umask|clear|sleep|echo|printf|do|done|then|fi|else|esac)$/.test(head);
}

/** Palavras que são redirecionamentos (e o alvo, quando separado) saem da lista de argumentos. */
function withoutRedirects(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^\d*(?:>>?|<<?<?|>&|&>)$/.test(a)) {
      i++;
      continue;
    }
    if (/^\d*(?:>>?|<<?<?|>&|&>)/.test(a)) continue;
    out.push(a);
  }
  return out;
}

/** Argumentos posicionais, pulando flags (e o valor das flags listadas em `valued`). */
function positionals(args: string[], valued: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  const clean = withoutRedirects(args);
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i];
    if (a === '--') {
      out.push(...clean.slice(i + 1));
      break;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (valued.has(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

const looksLikeFile = (t: string) => !!t && !t.includes('$') && !/^\d+$/.test(t) && t !== '-';

/** "a.ts", "a.ts e b.ts", "a.ts e mais 3" (ou undefined se não houver arquivo legível). */
function filesLabel(files: string[]): string | undefined {
  const names = files.filter(looksLikeFile).map((f) => basename(f) || f);
  if (!names.length) return undefined;
  if (names.length === 1) return names[0];
  if (names.length === 2) return i18n`${names[0]} e ${names[1]}`;
  return i18n`${names[0]} e mais ${names.length - 1}`;
}

const GREP_VALUED = new Set(['-e', '-f', '-A', '-B', '-C', '-m', '-d', '-D', '--regexp', '--file', '--max-count', '--context', '--include', '--exclude', '--exclude-dir', '-g', '-t', '-T', '--glob', '--type', '--type-not', '-j', '--threads', '-M', '--max-columns']);
const CURL_VALUED = new Set([
  '-H', '-d', '-X', '-o', '-u', '-A', '-e', '-b', '-c', '-F', '-T', '-w', '-m', '-x', '-K', '-r', '-E', '-U', '-Y', '-y', '-z', '-P', '-Q',
  '--header', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--json', '--request', '--output', '--user', '--user-agent',
  '--referer', '--cookie', '--cookie-jar', '--form', '--upload-file', '--write-out', '--max-time', '--connect-timeout', '--proxy',
  '--retry', '--retry-delay', '--cacert', '--cert', '--key', '--resolve', '--interface', '--limit-rate', '--range', '--config',
  // wget
  '-O', '-P', '-t', '-T', '--output-document', '--directory-prefix', '--tries', '--timeout', '--password', '--http-user', '--http-password',
]);

/** "Testando a API local (:4763/api/snapshot)" ou "Chamando api.github.com". */
function describeHttp(args: string[]): string {
  let target: string | undefined;
  const clean = withoutRedirects(args);
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i];
    if (a === '--url') {
      target = clean[i + 1];
      break;
    }
    if (a.startsWith('-')) {
      if (CURL_VALUED.has(a)) i++;
      continue;
    }
    if (/^(?:https?:\/\/)?(?:localhost|\[[0-9a-f:]+\]|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:[/?#]\S*)?$/i.test(a)) {
      target = a;
      break;
    }
  }
  if (!target) return i18n('Fazendo uma requisição HTTP');
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(target) ? target : `http://${target}`);
  } catch {
    return i18n('Fazendo uma requisição HTTP');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || /^127\./.test(host)) {
    const path = `${url.port ? `:${url.port}` : ''}${url.pathname === '/' && !url.port ? '/' : url.pathname}`;
    return `${url.pathname.startsWith('/api') ? i18n('Testando a API local') : i18n('Testando o servidor local')} (${truncate(path, 22)})`;
  }
  return i18n`Chamando ${host.replace(/^www\./, '')}`;
}

/** Descrições em português às vezes vêm prontas no `description` do Bash; em inglês, não servem como texto. */
export function looksPortuguese(s: string): boolean {
  const pt = (s.match(/\b(de|da|do|das|dos|para|pra|com|em|no|na|nos|nas|um|uma|os|as|que|por|sem|ao|aos|pelo|pela|e|o)\b/gi) ?? []).length;
  const accents = (s.match(/[ãõçáéíóúâêôà]/gi) ?? []).length;
  const gerund = (s.match(/\b\w+(?:ando|endo|indo)\b/gi) ?? []).length;
  const en = (s.match(/\b(the|of|to|for|with|and|in|on|from|an|by|into|all|its|is|are|run|check|start|stop|show|list|get|read|count|find|kill|build|test|verify|wait|open|print|fetch|install|update|create|remove|screenshot)\b/gi) ?? []).length;
  return pt + gerund + accents * 2 > en;
}

const LANG: Record<string, string> = { node: 'Node', python: 'Python', python3: 'Python', ruby: 'Ruby', php: 'PHP', deno: 'Deno', bun: 'Bun', tsx: 'TypeScript', 'ts-node': 'TypeScript', perl: 'Perl' };

const GIT_TEXT: Record<string, [string, string]> = {
  commit: ['📦', i18n('Fazendo commit')],
  push: ['🚀', i18n('Enviando commits (git push)')],
  pull: ['⬇️', i18n('Atualizando do remoto (git pull)')],
  fetch: ['⬇️', i18n('Buscando do remoto (git fetch)')],
  checkout: ['🌿', i18n('Trocando de branch')],
  switch: ['🌿', i18n('Trocando de branch')],
  merge: ['🔀', i18n('Fazendo merge')],
  rebase: ['🔀', i18n('Fazendo rebase')],
  status: ['🌿', i18n('Conferindo o git status')],
  diff: ['🌿', i18n('Conferindo as mudanças (diff)')],
  show: ['🌿', i18n('Olhando um commit (git show)')],
  log: ['🌿', i18n('Lendo o histórico do git')],
  add: ['🌿', i18n('Preparando arquivos (git add)')],
  stash: ['🌿', i18n('Guardando mudanças (stash)')],
  clone: ['⬇️', i18n('Clonando repositório')],
  branch: ['🌿', i18n('Conferindo as branches')],
  worktree: ['🌿', i18n('Mexendo nas worktrees')],
  reset: ['🌿', i18n('Desfazendo mudanças (git reset)')],
  restore: ['🌿', i18n('Restaurando arquivos (git restore)')],
  tag: ['🏷️', i18n('Mexendo nas tags')],
  blame: ['🌿', i18n('Vendo quem mudou cada linha')],
  'cherry-pick': ['🍒', i18n('Trazendo um commit (cherry-pick)')],
};

const READER_VALUED: Record<string, ReadonlySet<string>> = {
  head: new Set(['-n', '-c', '--lines', '--bytes']),
  tail: new Set(['-n', '-c', '-s', '--lines', '--bytes']),
  sed: new Set(['-e', '-f', '-l']),
  gsed: new Set(['-e', '-f', '-l']),
  awk: new Set(['-F', '-v', '-f']),
  gawk: new Set(['-F', '-v', '-f']),
  jq: new Set(['-f', '--indent', '--tab']),
  sort: new Set(['-k', '-t', '-o', '-S', '-T']),
  cut: new Set(['-d', '-f', '-c', '-b']),
  column: new Set(['-s', '-c', '-o']),
  bat: new Set(['-l', '--language', '-r', '--line-range', '-H', '--highlight-line', '--style']),
  less: new Set(['-p', '-x', '-y', '-z']),
};

/** Descreve um comando já sem prefixos. undefined = não reconhecido. */
function describeWords(w: string[], depth: number): ActivityDescription | undefined {
  if (!w.length) return undefined;
  const prog = basename(w[0]);
  const args = w.slice(1);
  const text = w.join(' ');
  const mk = (kind: ActivityKind, icon: string, t: string) => make(kind, icon, t);

  if (/\b(vitest|jest|pytest|phpunit|mocha|ava|rspec)\b|\b(go|cargo|deno|bun)\s+test\b|playwright\s+test|\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bnode\s+--test\b|-m\s+(pytest|unittest)\b/.test(text)) {
    return mk('test', '🧪', i18n('Rodando testes'));
  }
  if (prog === 'git') {
    let i = 0;
    while (i < args.length && args[i].startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1;
    const sub = args[i] ?? '';
    const [icon, t] = GIT_TEXT[sub] ?? ['🌿', sub ? `git ${sub}` : i18n('Usando o git')];
    return mk('git', icon, t);
  }
  if (prog === 'gh') return mk('git', '🐙', `GitHub CLI: gh ${args.slice(0, 2).join(' ')}`.trim());
  if (/\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcomposer\s+(install|require)\b|\bpoetry\s+(add|install)\b|\bcargo\s+add\b|\bgo\s+get\b|\buv\s+(add|sync|pip\s+install)\b/.test(text)) {
    return mk('run', '📦', i18n('Instalando dependências'));
  }
  if ((prog === 'tsc' && args.includes('--noEmit')) || /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(typecheck|type-check|check-types)\b/.test(text)) {
    return mk('run', '🔍', i18n('Conferindo os tipos (TypeScript)'));
  }
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\bvite\s+build\b|^tsc\b|\bwebpack\b|\bcargo\s+build\b|\bgo\s+build\b|^make\b|\bgradle\b|\bmvn\b|\besbuild\b|\brollup\b/.test(text)) {
    return mk('run', '🏗️', i18n('Compilando o projeto'));
  }
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b|^vite(\s|$)(?!build)|^(next|nuxt|astro)\s+dev\b|^expo\s+start\b|^nodemon\b|^tsx\s+watch\b/.test(text)) {
    return mk('run', '▶️', /\bpreview\b/.test(text) ? i18n('Subindo o preview do build') : i18n('Subindo o servidor de dev'));
  }
  if (/\b(eslint|prettier|ruff|black|biome|rubocop|phpcs|stylelint|oxlint)\b|\b(npm|pnpm|yarn)\s+(run\s+)?(lint|format)\b/.test(text)) {
    return mk('run', '🧹', i18n('Rodando o linter'));
  }
  if (/^(npm|pnpm|yarn|bun)$/.test(prog) && args[0] === 'run' && args[1]) return mk('run', '▶️', i18n`Rodando o script ${args[1]}`);
  if (prog === 'docker' || prog === 'docker-compose') return mk('run', '🐳', `Docker: ${args.filter((a) => !a.startsWith('-')).slice(0, 2).join(' ')}`.trim());
  if (/^(kubectl|helm|terraform|aws|gcloud|az|flyctl|fly|vercel|wrangler|netlify|railway)$/.test(prog)) return mk('run', '☁️', i18n`Mexendo na nuvem (${prog})`);
  if (/^(curl|wget|http|https|xh)$/.test(prog)) return mk('web', '🌐', describeHttp(args));
  if (/^(psql|mysql|sqlite3|redis-cli|mongosh|mongo|duckdb)$/.test(prog)) return mk('run', '🗄️', i18n('Consultando o banco de dados'));
  if (/^(rg|grep|egrep|fgrep|ag|ack|git-grep)$/.test(prog)) {
    const e = args.findIndex((a) => a === '-e' || a === '--regexp');
    const pat = e >= 0 ? args[e + 1] : positionals(args, GREP_VALUED)[0];
    const shown = pat?.replace(/\\\|/g, ' | ').replace(/\\([.()[\]{}+?*^$])/g, '$1');
    return mk('search', '🔎', shown ? i18n`Buscando “${truncate(shown, 24)}”` : i18n('Buscando no código'));
  }
  if (/^(ls|find|tree|fd|du|df|eza|exa)$/.test(prog)) return mk('read', '📂', i18n('Explorando pastas'));
  if (prog === 'cd' || prog === 'pushd') return mk('read', '📂', i18n('Mudando de pasta'));
  if (prog === 'cat' || prog === 'tee' || prog === 'echo' || prog === 'printf') {
    // `cat > arquivo <<EOF`, `cat <<'EOF' >> arquivo`, `echo x > arquivo`, `tee [-a] arquivo`: escrevendo.
    const written = prog === 'tee' ? positionals(args)[0] : stdoutTarget(args);
    if (written && looksLikeFile(written) && written !== '/dev/null') return mk('write', '📝', i18n`Escrevendo ${basename(written)}`);
    if (prog === 'tee') return mk('write', '📝', i18n('Escrevendo um arquivo'));
    if (prog !== 'cat') return mk('run', '💬', i18n('Mostrando texto no terminal'));
  }
  if (/^(sed|gsed|perl)$/.test(prog) && args.some((a) => /^-i|^--in-place|^-pi/.test(a))) {
    const last = positionals(args, new Set(['-e', '-f'])).pop();
    return mk('edit', '✏️', last && looksLikeFile(last) && /[./]/.test(last) ? i18n`Editando ${basename(last)}` : i18n('Editando via terminal'));
  }
  if (/^(cat|head|tail|less|more|bat|nl|sed|gsed|awk|gawk|jq|wc|strings|xxd|od|hexdump|column|sort|uniq|cut)$/.test(prog)) {
    // jq --arg nome valor: dois valores.
    const jqArgs = prog === 'jq' ? args.filter((_, i) => !/^--(arg|argjson|slurpfile|rawfile)$/.test(args[i - 1] ?? '') && !/^--(arg|argjson|slurpfile|rawfile)$/.test(args[i - 2] ?? '')) : args;
    let files = positionals(jqArgs, READER_VALUED[prog]);
    // sed/awk/jq: o primeiro posicional é o programa/filtro, não um arquivo.
    if (/^(sed|gsed|awk|gawk|jq)$/.test(prog) && !args.includes('-e') && !args.includes('-f')) files = files.slice(1);
    const label = filesLabel(files);
    if (prog === 'wc') {
      const n = files.filter(looksLikeFile).length;
      return mk('read', '🔢', n > 2 ? i18n`Contando linhas de ${n} arquivos` : label ? i18n`Contando linhas de ${label}` : i18n('Contando linhas'));
    }
    if (prog === 'tail' && args.some((a) => a === '-f' || a === '-F')) return mk('read', '📜', label ? i18n`Acompanhando ${label}` : i18n('Acompanhando um log'));
    if (prog === 'jq' && !label) return mk('read', '🔎', i18n('Filtrando JSON'));
    if (/^(sort|uniq|cut|column)$/.test(prog) && !label) return undefined;
    return mk('read', '📖', label ? i18n`Lendo ${label}` : i18n('Lendo arquivo'));
  }
  if (/^(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|ln|rsync|tar|zip|unzip|gzip|gunzip|xattr)$/.test(prog)) return mk('run', '🗂️', i18n('Organizando arquivos'));
  if (prog === 'sleep' || prog === 'wait') return mk('wait', '⏳', i18n('Aguardando um pouco'));
  if (prog === 'open' || prog === 'xdg-open') return mk('run', '🖥️', i18n('Abrindo no computador'));
  if (/^(code|cursor|subl|vim|nvim|nano|emacs)$/.test(prog)) return mk('edit', '✏️', i18n('Abrindo no editor'));
  if (/^(pkill|kill|killall)$/.test(prog)) return mk('run', '🛑', i18n('Parando um processo'));
  if (prog === 'lsof') {
    const port = args.map((a) => /^(?:-i)?(?:tcp)?:(\d{2,5})$/i.exec(a)?.[1]).find(Boolean);
    return mk('run', '🔌', port ? i18n`Conferindo quem usa a porta ${port}` : i18n('Conferindo processos e portas'));
  }
  if (/^(ps|pgrep|top|htop|jobs)$/.test(prog)) return mk('run', '🔍', i18n('Conferindo processos'));
  if (/^(which|whereis|type)$/.test(prog) || (prog === 'command' && /^-[vV]$/.test(args[0] ?? ''))) return mk('search', '🔎', i18n('Procurando um programa'));
  if (/^(diff|cmp|comm|colordiff|delta)$/.test(prog)) return mk('read', '🔀', i18n('Comparando arquivos'));
  if (prog === 'date') return mk('run', '🕒', i18n('Conferindo a data e a hora'));
  if (prog === 'env' || prog === 'printenv') return mk('run', '🔍', i18n('Conferindo variáveis de ambiente'));
  if (/^(stat|file|md5|md5sum|shasum|sha256sum|realpath|readlink)$/.test(prog)) return mk('read', '🔍', i18n('Conferindo um arquivo'));
  if (prog === 'claude') return mk('run', '🤖', i18n('Rodando o Claude Code'));
  if (/^(pbcopy|pbpaste)$/.test(prog)) return mk('run', '📋', i18n('Usando a área de transferência'));
  if (/^(bash|sh|zsh|fish)$/.test(prog)) {
    const c = args.indexOf('-c');
    if (c >= 0 && args[c + 1] && depth < 3) return describeLine(args[c + 1], depth + 1).desc;
    const script = positionals(args).find(looksLikeFile);
    return mk('run', '▶️', script ? i18n`Executando ${basename(script)}` : i18n('Executando um script de shell'));
  }
  if (/^(node|python3?|ruby|php|deno|bun|tsx|ts-node|perl|java)$/.test(prog) || (prog === 'go' && args[0] === 'run')) {
    // Ignora flags, redirecionamentos/heredoc e código inline (-e/-c '...').
    const list = withoutRedirects(prog === 'go' ? args.slice(1) : args);
    const script = list.find((t, i) => !t.startsWith('-') && !/^-[ecpr]$|^--(eval|print|import|require|loader)$/.test(list[i - 1] ?? '') && /[./]/.test(t) && !/^\d+(\.\d+)*$/.test(t));
    if (script && !/^(-m|-c)$/.test(list[0] ?? '')) return mk('run', '▶️', i18n`Executando ${basename(script)}`);
    if (list[0] === '-m' && list[1]) return mk('run', '▶️', i18n`Executando o módulo ${list[1]}`);
    return mk('run', '▶️', i18n`Executando um script ${LANG[prog] ?? prog}`);
  }
  if (/^(\.{0,2}\/|~\/)/.test(w[0]) || /\.(sh|bash|zsh|py|rb|mjs|js|ts)$/.test(w[0])) return mk('run', '▶️', i18n`Executando ${prog}`);
  return undefined;
}

interface LineDescription {
  desc?: ActivityDescription;
  /** Programa principal encontrado (para o texto genérico, quando não há descrição). */
  prog?: string;
}

/** Descreve a primeira linha "de verdade" de um trecho de shell. */
function describeLine(text: string, depth: number): LineDescription {
  const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line || line.startsWith('#')) continue;
    const segs = splitShell(line);
    let main: string[] | undefined;
    let mainIdx = -1;
    for (let i = 0; i < segs.length; i++) {
      let seg = segs[i];
      // Subshell `( ... )` ou grupo `{ ...; }` inteiro: olha dentro.
      if (/^\(.*\)$/.test(seg) && depth < 3) {
        const inner = describeLine(seg.slice(1, -1), depth + 1);
        if (inner.desc || inner.prog) return inner;
        continue;
      }
      seg = seg.replace(/^\{\s*/, '');
      const words = stripWrappers(shellWords(seg));
      if (isNoise(words)) continue;
      main = words;
      mainIdx = i;
      break;
    }
    if (!main) {
      // Só preparação nesta linha (ex.: `S=/tmp/x`, `cd pasta`): segue para a próxima — a não ser
      // que seja a última; aí descreve o que houver (ex.: `sleep 5` sozinho).
      if (lines.slice(li + 1).some((l) => l.trim() && !l.trim().startsWith('#'))) continue;
      const words = stripWrappers(shellWords(segs[0] ?? ''));
      return { desc: describeWords(words, depth), prog: words[0] };
    }
    // Laços e condicionais: o que importa é o corpo (`do ...` / `then ...`), na mesma linha ou na próxima.
    if (/^(for|while|until|if|select)$/.test(main[0]) && depth < 3) {
      const rest = segs.slice(mainIdx + 1).join('; ');
      const body = /^(?:do|then)\b\s*(.*)$/s.exec(rest.replace(/^.*?;\s*(?=(do|then)\b)/s, ''))?.[1]?.trim();
      const next = [body, ...lines.slice(li + 1)].filter((l) => l && l.trim() && !/^(done|fi|else|esac)\b/.test(l.trim())).join('\n');
      const inner = next ? describeLine(next, depth + 1) : {};
      return inner.desc ? inner : { desc: make('run', '🔁', i18n('Repetindo um comando em lote')) };
    }
    return { desc: describeWords(main, depth), prog: main[0] };
  }
  return {};
}

/**
 * Descreve um comando de shell (ferramenta Bash) em português. A heurística olha a primeira linha
 * com um comando de verdade (pula `X=1`, `cd`, `set -e`, comentários), o primeiro segmento útil
 * (antes de `|`, `&&`, `;`) e os argumentos. O `description` do Bash só vira texto se estiver em
 * português (o modelo costuma escrevê-lo em inglês); senão vai para o detalhe.
 */
export function describeCommand(command: string, description?: string): ActivityDescription {
  const detail = command.trim();
  let found: LineDescription = {};
  try {
    found = describeLine(detail.slice(0, 8_000), 0);
  } catch {
    found = {}; // comando estranho demais para a heurística: cai no texto genérico
  }
  if (found.desc) return make(found.desc.kind, found.desc.icon, found.desc.text, detail);
  const desc = description?.trim();
  if (desc && looksPortuguese(desc)) return make('run', '💻', desc, detail);
  const prog = basename(found.prog ?? '');
  const text = /^[A-Za-z][\w.+-]{0,23}$/.test(prog) ? i18n`Rodando ${prog}` : i18n('Rodando um comando no terminal');
  return make('run', '💻', text, desc ? `${desc} — ${detail}` : detail);
}

function humanize(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
}

function describeMcp(name: string, input: Record<string, unknown>): ActivityDescription {
  const [, server = '', ...rest] = name.split('__');
  const tool = rest.join('__');
  const srv = server.replace(/^claude_ai_/, '');
  if (/playwright|chrome|browser|puppeteer/i.test(srv)) {
    const url = str(input.url);
    if (/navigate/.test(tool)) return make('browser', '🧭', url ? i18n`Abrindo ${domainOf(url)}` : i18n('Navegando no navegador'), url);
    if (/screenshot/.test(tool)) return make('browser', '📸', i18n('Tirando print da página'));
    if (/click/.test(tool)) return make('browser', '🖱️', i18n('Clicando na página'));
    if (/type|fill|form/.test(tool)) return make('browser', '⌨️', i18n('Preenchendo formulário'));
    if (/snapshot|read|get_page|find/.test(tool)) return make('browser', '🧭', i18n('Lendo a página'));
    return make('browser', '🧭', i18n`Navegador: ${humanize(tool)}`);
  }
  if (/github/i.test(srv)) return make('mcp', '🐙', `GitHub: ${humanize(tool)}`);
  if (/gmail|mail/i.test(srv)) return make('mcp', '✉️', i18n`E-mail: ${humanize(tool)}`);
  if (/drive|docs|notion|confluence/i.test(srv)) return make('mcp', '📄', `${srv}: ${humanize(tool)}`);
  if (/sql|postgres|mysql|mongo|elastic|redis|db/i.test(srv)) return make('mcp', '🗄️', i18n`Banco (${srv}): ${humanize(tool)}`);
  return make('mcp', '🔌', `${srv}: ${humanize(tool)}`);
}

/** Descreve uma chamada de ferramenta do Claude Code. */
export function describeTool(name: string, rawInput: unknown): ActivityDescription {
  const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown>;
  const file = str(input.file_path) || str(input.notebook_path) || str(input.path);

  switch (name) {
    case 'Read':
      if (IMAGE_EXT.test(file)) return make('read', '🖼️', i18n`Olhando ${basename(file)}`, file);
      if (/\.pdf$/i.test(file)) return make('read', '📕', i18n`Lendo ${basename(file)}`, file);
      return make('read', '📖', file ? i18n`Lendo ${basename(file)}` : i18n('Lendo arquivo'), file);
    case 'Edit':
    case 'MultiEdit':
      return make('edit', '✏️', file ? i18n`Editando ${basename(file)}` : i18n('Editando arquivo'), file);
    case 'Write':
      return make('write', '📝', file ? i18n`Escrevendo ${basename(file)}` : i18n('Escrevendo arquivo'), file);
    case 'NotebookEdit':
      return make('edit', '📓', i18n`Editando notebook ${basename(file)}`, file);
    case 'Glob':
      return make('search', '🔎', i18n`Procurando ${truncate(str(input.pattern) || i18n('arquivos'), 30)}`, str(input.pattern));
    case 'Grep': {
      const pat = str(input.pattern);
      return make('search', '🔎', pat ? i18n`Buscando “${truncate(pat, 26)}”` : i18n('Buscando no código'), pat);
    }
    case 'LS':
      return make('read', '📂', i18n`Listando ${basename(file) || i18n('pasta')}`, file);
    case 'Bash':
      return describeCommand(str(input.command), str(input.description));
    case 'BashOutput':
    case 'TaskOutput':
      return make('run', '📟', i18n('Conferindo saída do terminal'));
    case 'Monitor':
      return make('run', '📟', i18n('Monitorando um processo'), str(input.description) || str(input.command));
    case 'KillShell':
    case 'KillBash':
    case 'TaskStop':
      return make('run', '🛑', i18n('Parando um processo'));
    case 'WebSearch': {
      const q = str(input.query);
      return make('web', '🌐', q ? i18n`Pesquisando “${truncate(q, 28)}”` : i18n('Pesquisando na web'), q);
    }
    case 'WebFetch': {
      const url = str(input.url);
      return make('web', '🌐', url ? i18n`Lendo ${domainOf(url)}` : i18n('Lendo uma página'), url);
    }
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? (input.todos as Array<Record<string, unknown>>) : [];
      const done = todos.filter((t) => t.status === 'completed').length;
      return make('plan', '🗒️', i18n('Atualizando a lista de tarefas'), todos.length ? i18n`${done}/${todos.length} concluídas` : undefined);
    }
    case 'TaskCreate':
      return make('plan', '🗒️', i18n`Nova tarefa: ${str(input.subject) || i18n('sem título')}`, str(input.description));
    case 'TaskUpdate': {
      const st = str(input.status);
      if (st === 'completed') return make('plan', '✅', i18n`Concluiu a tarefa #${str(input.taskId)}`);
      if (st === 'in_progress') return make('plan', '🗒️', i18n`Começou a tarefa #${str(input.taskId)}`);
      return make('plan', '🗒️', i18n`Atualizando a tarefa #${str(input.taskId)}`);
    }
    case 'TaskList':
    case 'TaskGet':
      return make('plan', '🗒️', i18n('Revisando as tarefas'));
    case 'EnterPlanMode':
      return make('plan', '🧭', i18n('Entrando no modo de planejamento'));
    case 'ExitPlanMode':
      return make('plan', '🧭', i18n('Apresentando o plano'));
    case 'Agent':
    case 'Task': {
      const d = str(input.description);
      const type = str(input.subagent_type);
      return make('delegate', '👥', d ? i18n`Delegando: ${d}` : i18n('Chamando um subagente'), [type, str(input.prompt)].filter(Boolean).join(' — '));
    }
    case 'Workflow':
      return make('delegate', '🕸️', i18n('Orquestrando um workflow'));
    case 'StructuredOutput':
      return make('communicate', '📤', i18n('Entregando o resultado'));
    case 'ListAgents':
      return make('communicate', '👥', i18n('Conferindo a equipe'));
    case 'SendMessage':
      return make('communicate', '💬', i18n`Mensagem para ${str(input.to) || i18n('outro agente')}`, str(input.message));
    case 'AskUserQuestion': {
      const qs = Array.isArray(input.questions) ? (input.questions as Array<Record<string, unknown>>) : [];
      const questions = askQuestions(qs);
      return { ...make('ask', '❓', i18n('Fazendo uma pergunta a você'), qs[0] ? str(qs[0].question) : undefined), ...(questions.length ? { questions } : {}) };
    }
    case 'Skill':
      return make('skill', '🧩', i18n`Usando a skill ${str(input.skill) || str(input.command)}`);
    case 'SlashCommand':
      return make('skill', '⌨️', i18n`Rodando ${str(input.command)}`);
    case 'ToolSearch':
      return make('other', '🧰', i18n('Procurando ferramentas'));
    case 'ListMcpResourcesTool':
    case 'ReadMcpResourceTool':
      return make('mcp', '🔌', i18n('Lendo recursos MCP'));
    case 'Artifact':
      return make('other', '🖼️', i18n('Publicando uma página'));
    case 'ArtifactData':
    case 'ArtifactComments':
      return make('other', '🖼️', i18n('Atualizando uma página publicada'));
    case 'CronCreate':
    case 'CronDelete':
    case 'CronList':
    case 'ScheduleWakeup':
    case 'RemoteTrigger':
      return make('plan', '⏰', i18n('Agendando uma tarefa'));
    case 'EnterWorktree':
    case 'ExitWorktree':
      return make('git', '🌿', i18n('Trocando de worktree'));
    case 'PushNotification':
    case 'SendUserFile':
      return make('communicate', '📣', i18n('Enviando algo para você'));
    default:
      if (name.startsWith('mcp__')) return describeMcp(name, input);
      return make('other', '🛠️', i18n`Usando ${name}`);
  }
}

/** Atividade para um prompt do usuário. */
export function describePrompt(text: string): ActivityDescription {
  return make('prompt', '📨', i18n`Nova tarefa: “${truncate(text, 30)}”`, text);
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min${s % 60 ? ` ${s % 60}s` : ''}`;
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ''}`;
}

// ------------------------------------------------------------------ shells (espera por comandos)

/** Marcador (Activity.tool) do fim de um shell em segundo plano: o mundo comemora (ou lamenta, com `error`). */
export const SHELL_DONE_TOOL = 'ShellDone';
/** Marcador (Activity.tool) do balão "Esperando o shell", sintetizado enquanto o status é 'shell'. */
export const SHELL_WAIT_TOOL = 'ShellWait';

/** Como um shell em segundo plano terminou. */
export type ShellOutcome = 'ok' | 'failed' | 'killed';

/** Atividade com marcador de ferramenta (pode ir direto num `Activity` com `...desc`). */
export type MarkedDescription = ActivityDescription & { tool: string; error?: boolean };

/**
 * Rótulo (≤ 46 caracteres) e comando (≤ 300) de um Bash/Monitor que o agente vai esperar, já mascarados.
 * O rótulo é o `description` da ferramenta; sem ele, o resumo do comando ("Rodando testes").
 */
export function describeShellJob(name: string, rawInput: unknown): { label: string; command?: string; kind: 'shell' | 'monitor' } {
  const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown>;
  const kind = name === 'Monitor' ? 'monitor' : 'shell';
  const ws = input.ws && typeof input.ws === 'object' ? str((input.ws as Record<string, unknown>).url) : '';
  const command = str(input.command).trim() || ws.trim();
  const description = str(input.description).trim();
  let label: string;
  if (description) label = truncate(maskSecrets(description.slice(0, MAX_TEXT * 8)), MAX_TEXT);
  else if (kind === 'monitor') label = ws ? i18n`Escutando ${domainOf(ws)}` : i18n('Monitorando um processo');
  else label = command ? describeCommand(command).text : i18n('Comando no terminal');
  const out: { label: string; command?: string; kind: 'shell' | 'monitor' } = { label, kind };
  if (command) out.command = truncate(maskSecrets(command.slice(0, MAX_DETAIL * 4)), MAX_DETAIL);
  return out;
}

/** "<prefixo><rótulo><sufixo>" cabendo em MAX_TEXT: só o rótulo é cortado (a duração nunca some). */
function fitLabel(prefix: string, label: string | undefined, suffix = ''): string {
  if (!label) return `${prefix.replace(/:\s*$/, '')}${suffix}`;
  const room = Math.max(8, MAX_TEXT - prefix.length - suffix.length);
  return `${prefix}${truncate(label, room)}${suffix}`;
}

export const SPECIAL = {
  think: (): ActivityDescription => make('think', '💭', i18n('Pensando…')),
  respond: (text?: string): ActivityDescription => make('respond', '💬', i18n('Escrevendo a resposta'), text),
  turnDone: (ms?: number): ActivityDescription => make('done', '✅', ms ? i18n`Concluiu em ${formatDuration(ms)}` : i18n('Concluiu')),
  error: (tool?: string, detail?: string): ActivityDescription => make('error', '⚠️', tool ? i18n`Erro em ${tool}` : i18n('Algo deu errado'), detail),
  interrupted: (): ActivityDescription => make('wait', '✋', i18n('Interrompido por você')),
  compact: (): ActivityDescription => make('compact', '🧹', i18n('Organizando a memória (compactando)')),
  waiting: (reason?: string): ActivityDescription => make('wait', '✋', reason ? i18n`Precisa de você: ${reason}` : i18n('Precisa de você')),
  backgroundResult: (summary?: string): ActivityDescription => make('other', '📬', i18n('Recebeu resultado em segundo plano'), summary),
  apiRetry: (): ActivityDescription => make('wait', '🔁', i18n('Instabilidade na API, tentando de novo')),
  rejected: (tool?: string): ActivityDescription => make('wait', '🚫', tool ? i18n`Você recusou: ${tool}` : i18n('Você recusou a ação')),
  cleared: (): ActivityDescription => make('compact', '🧽', i18n('Começou uma conversa nova (/clear)')),
  supervising: (): ActivityDescription => make('delegate', '👥', i18n('Acompanhando os subagentes')),
  answered: (question?: string): ActivityDescription => make('ask', '💬', i18n('Recebeu a sua resposta'), question),
  /** Balão do status 'shell': "Esperando o shell: <rótulo>" (ou "Esperando 2 shells: ..."). */
  waitingShell: (label?: string, n = 1, detail?: string): MarkedDescription => ({
    ...make('wait', '⏳', fitLabel(n > 1 ? i18n`Esperando ${n} shells: ` : i18n('Esperando o shell: '), label), detail),
    tool: SHELL_WAIT_TOOL,
  }),
  /**
   * Fim de um shell em segundo plano (marcador 'ShellDone'): sucesso "Shell terminou: <rótulo> (<duração>)",
   * falha "Shell falhou: <rótulo>" e morto "Shell interrompido: <rótulo>" (os dois com `error`).
   */
  shellDone: (label: string | undefined, outcome: ShellOutcome, ms?: number, detail?: string): MarkedDescription => {
    if (outcome === 'failed') return { ...make('run', '❌', fitLabel(i18n('Shell falhou: '), label), detail), tool: SHELL_DONE_TOOL, error: true };
    if (outcome === 'killed') return { ...make('run', '🛑', fitLabel(i18n('Shell interrompido: '), label), detail), tool: SHELL_DONE_TOOL, error: true };
    const took = ms !== undefined && ms >= 1_000 ? ` (${formatDuration(ms)})` : '';
    return { ...make('run', '✅', fitLabel(i18n('Shell terminou: '), label, took), detail), tool: SHELL_DONE_TOOL };
  },
} as const;

/** Traduz o `waitingFor` do registro de sessões do Claude Code. */
export function describeWaitingFor(raw: string | undefined): string {
  if (!raw) return i18n('responder no terminal');
  const r = raw.toLowerCase();
  if (r === 'input needed') return i18n('responder uma pergunta');
  if (r === 'worker request') return i18n('aprovar o pedido de um worker');
  if (r === 'sandbox request') return i18n('aprovar acesso do sandbox');
  if (r === 'dialog open') return i18n('fechar um diálogo aberto');
  if (/permission|approve|allow/.test(r)) return i18n('aprovar uma permissão');
  if (/trust/.test(r)) return i18n('confiar nesta pasta');
  return truncate(raw, 40);
}
