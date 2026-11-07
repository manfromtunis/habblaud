// Tiny fake factory server for Office live mode verification.
// Serves dist/factory-office.html at /office and implements the 4 factory API endpoints.
// No hardcoded home paths. Free port by default (or passed via PORT / argv).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const HTML_FILE = path.join(REPO_ROOT, 'dist', 'factory-office.html');

export function createFakeFactoryServer(customFixtures = {}) {
  const recordedMessages = [];
  const recordedAnswers = [];

  const threadMessages = {
    'thread-2b07': [
      {
        role: 'user',
        text: 'Please investigate the Stripe webhook signature error.',
        at: Date.now() - 120_000,
      },
      {
        role: 'assistant',
        text: 'I found that legacy v1 signatures are being dropped. Should we support fallback?',
        at: Date.now() - 60_000,
      },
    ],
    'thread-1a3f': [
      {
        role: 'user',
        text: 'Implement transaction ledger idempotency.',
        at: Date.now() - 300_000,
      },
      {
        role: 'assistant',
        text: 'Working on idempotency keys and ledger table schema.',
        at: Date.now() - 180_000,
      },
    ],
  };

  const officeData = {
    builtAt: Date.now(),
    machine: {
      id: 'mac-1',
      label: 'office-live-1',
    },
    products: {
      bakchich: { name: 'Bakchich' },
      aurastack: { name: 'AuraStack' },
      factory: { name: 'Software Factory' },
    },
    projects: [
      { id: 'factory:bakchich/support-bot', product: 'bakchich', name: 'Support bot' },
      { id: 'factory:bakchich/new-fee-engine', product: 'bakchich', name: 'New fee engine' },
      { id: 'factory:aurastack/store', product: 'aurastack', name: 'AuraStack store' },
    ],
    agents: [
      {
        hc: '2b07',
        who: 'Agent 2b07',
        provider: 'claude',
        model: 'claude-sonnet-5-5',
        product: 'bakchich',
        project: 'Support bot',
        state: 'waiting',
        t3Status: 'Waiting on owner decision',
        waiting_for: 'Approve legacy Stripe webhook v1 fallback',
        thread: 'thread-2b07',
        parent: '2b07',
        canReceive: true,
        tokens: { today: 42_000 },
      },
      {
        hc: '1a3f',
        who: 'Agent 1a3f',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-high',
        product: 'bakchich',
        project: 'New fee engine',
        state: 'running',
        t3Status: 'Implementing transaction ledger',
        thread: 'thread-1a3f',
        parent: '1a3f',
        canReceive: true,
        tokens: { today: 18_000 },
      },
      {
        hc: '2b07.1',
        who: 'Subagent 2b07.1',
        provider: 'claude',
        model: 'claude-sonnet-5-5',
        product: 'bakchich',
        project: 'Support bot',
        state: 'running',
        t3Status: 'Checking migration scripts',
        thread: 'thread-2b07-sub',
        parent: '2b07',
        canReceive: false,
      },
      {
        hc: '1k05',
        who: 'Agent 1k05',
        provider: 'opencode',
        model: 'deepseek-v3',
        product: 'bakchich',
        project: 'Support bot',
        state: 'quota',
        t3Status: 'Rate limit reached',
        thread: 'thread-1k05',
        parent: '1k05',
        canReceive: true,
      },
    ],
    tokens: { today: 125_000 },
    provColors: {
      claude: '#f08a3c',
      antigravity: '#4aa8e8',
      opencode: '#a77bf3',
    },
    inbox: [
      {
        id: 'a538',
        kind: 'urgent',
        title: 'Approve legacy Stripe webhook v1 fallback',
        context:
          'Agent 2b07 needs confirmation on Stripe signature header.\nv1 header is deprecated but still received from older endpoints.',
        options: [
          { key: 'v1v2', label: 'Accept v1 and v2 simultaneously (Recommended)' },
          { key: 'v2only', label: 'Reject v1, require v2 headers only' },
        ],
        reco: 'v1v2',
        project: 'bakchich / Support bot',
        from: '2b07',
        thread: 'thread-2b07',
      },
    ],
    ...customFixtures,
  };

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Serve HTML at /office and /office/
    if (pathname === '/office' || pathname === '/office/' || pathname === '/') {
      try {
        const html = fs.readFileSync(HTML_FILE, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Failed to load factory-office.html: ${err.message}`);
      }
      return;
    }

    // 1. GET api/office
    if (
      (pathname === '/api/office' || pathname === '/office/api/office') &&
      req.method === 'GET'
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(officeData));
      return;
    }

    // 2. GET api/threads/<thread>/messages
    const threadMatch =
      pathname.match(/^\/api\/threads\/([^/]+)\/messages/) ||
      pathname.match(/^\/office\/api\/threads\/([^/]+)\/messages/);

    if (threadMatch && req.method === 'GET') {
      const threadId = decodeURIComponent(threadMatch[1]);
      const msgs = threadMessages[threadId] || [
        {
          role: 'assistant',
          text: `Thread ${threadId} initialized. Ready for instructions.`,
          at: Date.now() - 30_000,
        },
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(msgs));
      return;
    }

    // 3. POST api/messages
    if (
      (pathname === '/api/messages' || pathname === '/office/api/messages') &&
      req.method === 'POST'
    ) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          recordedMessages.push(parsed);

          // Append to thread messages so dynamic UI sees it
          if (parsed.thread && parsed.text) {
            if (!threadMessages[parsed.thread]) threadMessages[parsed.thread] = [];
            threadMessages[parsed.thread].push({
              role: 'user',
              text: parsed.text,
              at: Date.now(),
            });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 4. POST api/answers
    if (
      (pathname === '/api/answers' || pathname === '/office/api/answers') &&
      req.method === 'POST'
    ) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          recordedAnswers.push(parsed);

          // Drop answered items from inbox
          if (officeData.inbox && typeof parsed === 'object') {
            const answeredIds = new Set(Object.keys(parsed));
            officeData.inbox = officeData.inbox.filter((item) => !answeredIds.has(item.id));
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 404
    console.log(`[fake-factory 404] ${req.method} ${pathname}`);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Not found: ${pathname}`);
  });

  return {
    server,
    recordedMessages,
    recordedAnswers,
    officeData,
    threadMessages,
  };
}

export async function startFakeFactory(port = 0) {
  const instance = createFakeFactoryServer();
  return new Promise((resolve, reject) => {
    instance.server.listen(port, '127.0.0.1', () => {
      const addr = instance.server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        ...instance,
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}/office`,
        close: () => new Promise((res) => instance.server.close(res)),
      });
    });
    instance.server.on('error', reject);
  });
}

// Direct execution
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const chosenPort = parseInt(process.env.PORT || process.argv[2] || '0', 10);
  startFakeFactory(chosenPort).then(({ port, url }) => {
    console.log(`Fake Factory server listening on port ${port}:`);
    console.log(`  Office URL: ${url}`);
  });
}
