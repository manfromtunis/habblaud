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
        text: 'Please investigate the webhook signature error.',
        at: new Date(Date.now() - 120_000).toISOString(),
      },
      {
        role: 'assistant',
        text: 'I found that legacy v1 signatures are being dropped. Should we support fallback?',
        at: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
    'thread-1a3f': [
      {
        role: 'user',
        text: 'Implement transaction ledger idempotency.',
        at: new Date(Date.now() - 300_000).toISOString(),
      },
      {
        role: 'assistant',
        text: 'Working on idempotency keys and ledger table schema.',
        at: new Date(Date.now() - 180_000).toISOString(),
      },
    ],
  };

  const officeData = {
    builtAt: new Date().toISOString(),
    machine: {
      id: 'mac-1',
      label: 'office-live-1',
    },
    products: {
      core: { name: 'Core Engine' },
      shopkit: { name: 'ShopKit' },
      factory: { name: 'Software Factory' },
    },
    projects: [
      { id: 'factory:core/support-bot', product: 'core', name: 'Support bot' },
      { id: 'factory:core/ledger', product: 'core', name: 'Transaction ledger' },
      { id: 'factory:shopkit/store', product: 'shopkit', name: 'ShopKit store' },
    ],
    agents: [
      {
        hc: '2b07',
        who: 'Agent 2b07',
        provider: 'claude',
        model: 'claude-sonnet-5-5',
        product: 'core',
        project: 'factory:core/support-bot',
        state: 'waiting',
        task: 'Checking webhook signature fallback',
        t3Status: 'Waiting on owner decision',
        waiting_for: 'Approve legacy signature header fallback',
        thread: 'thread-2b07',
        parent: '2b07',
        canReceive: true,
        start_time: new Date(Date.now() - 3600_000).toISOString(),
        tokens: { today: 42_000 },
      },
      {
        hc: '1a3f',
        who: 'Agent 1a3f',
        provider: 'antigravity',
        model: 'gemini-3.8-flash-high',
        product: 'core',
        project: 'factory:core/ledger',
        state: 'running',
        task: 'Checking idempotency keys in ledger',
        t3Status: 'Implementing transaction ledger',
        thread: 'thread-1a3f',
        parent: '1a3f',
        canReceive: true,
        start_time: new Date(Date.now() - 1800_000).toISOString(),
        tokens: { today: 18_000 },
      },
      {
        hc: '2b07.1',
        who: 'Subagent 2b07.1',
        provider: 'claude',
        model: 'claude-sonnet-5-5',
        product: 'core',
        project: 'factory:core/support-bot',
        state: 'running',
        task: 'Running migration verification',
        t3Status: 'Checking migration scripts',
        thread: 'thread-2b07-sub',
        parent: '2b07',
        canReceive: false,
        start_time: new Date(Date.now() - 900_000).toISOString(),
      },
      {
        hc: '1k05',
        who: 'Agent 1k05',
        provider: 'opencode',
        model: 'deepseek-v3',
        product: 'core',
        project: 'factory:core/support-bot',
        state: 'quota',
        task: 'Waiting for quota refresh',
        t3Status: 'Rate limit reached',
        thread: 'thread-1k05',
        parent: '1k05',
        canReceive: true,
        start_time: new Date(Date.now() - 600_000).toISOString(),
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
        title: 'Approve legacy signature header fallback',
        context:
          'Agent 2b07 needs confirmation on signature header.\nv1 header is deprecated but still received from older endpoints.',
        options: [
          { id: 'v1v2', label: 'Accept v1 and v2 simultaneously' },
          { id: 'v2only', label: 'Reject v1, require v2 headers only' },
        ],
        reco: 'v1v2',
        project: 'factory:core/support-bot',
        from: '2b07',
        thread: 'thread-2b07',
        created_at: new Date(Date.now() - 600_000).toISOString(),
      },
    ],
    answers: {},
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

    // Redirect /office/ to /office
    if (pathname === '/office/') {
      res.writeHead(302, { Location: '/office' + (parsedUrl.search || '') });
      res.end();
      return;
    }

    // Serve HTML at /office
    if (pathname === '/office' || pathname === '/') {
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

    // 1. GET /api/office
    if (pathname === '/api/office' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(officeData));
      return;
    }

    // 2. GET /api/threads/:id/messages
    const threadMatch = pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
    if (threadMatch && req.method === 'GET') {
      const threadId = decodeURIComponent(threadMatch[1]);
      const msgs = threadMessages[threadId] || [
        {
          role: 'assistant',
          text: `Thread ${threadId} initialized. Ready for instructions.`,
          at: new Date(Date.now() - 30_000).toISOString(),
        },
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(msgs));
      return;
    }

    // 3. POST /api/messages
    if (pathname === '/api/messages' && req.method === 'POST') {
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
              at: new Date().toISOString(),
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

    // 4. POST /api/answers
    if (pathname === '/api/answers' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          recordedAnswers.push(parsed);

          if (!officeData.answers) officeData.answers = {};
          Object.assign(officeData.answers, parsed);

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
