import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const distClient = join(root, 'dist/client');
const publicAssets = join(root, 'client/public/assets');
const targetFile = resolve('/home/melek-code/factory-pages/proto-office/factory-office-v2.html');

console.log('Building standalone inline HTML for Factory Office v2...');

if (!existsSync(distClient)) {
  throw new Error(`dist/client does not exist. Run npm run build:client first.`);
}

// 1. Collect and base64-encode all assets
const mimeTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
};

const assetUrls = {};

function scanDir(dir, baseDir = dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath, baseDir);
    } else if (entry.isFile()) {
      const rel = relative(baseDir, fullPath).replace(/\\/g, '/');
      const ext = extname(entry.name).toLowerCase();
      const mime = mimeTypes[ext] || 'application/octet-stream';
      const buf = readFileSync(fullPath);
      const b64 = `data:${mime};base64,${buf.toString('base64')}`;

      assetUrls[`assets/${rel}`] = b64;
      assetUrls[rel] = b64;
      assetUrls[`/assets/${rel}`] = b64;
    }
  }
}

if (existsSync(publicAssets)) {
  scanDir(publicAssets, publicAssets);
}

// Process manifest.json
let assetsManifest = null;
const manifestPath = join(publicAssets, 'manifest.json');
if (existsSync(manifestPath)) {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // Update file references to use data URIs
  if (Array.isArray(raw.wallArt)) {
    for (const art of raw.wallArt) {
      if (art.file && assetUrls[art.file]) {
        art.file = assetUrls[art.file];
      }
      if (art.framed?.file && assetUrls[art.framed.file]) {
        art.framed.file = assetUrls[art.framed.file];
      }
    }
  }
  if (raw.brand) {
    if (raw.brand.signage?.file && assetUrls[raw.brand.signage.file]) {
      raw.brand.signage.file = assetUrls[raw.brand.signage.file];
    }
    if (raw.brand.mark?.file && assetUrls[raw.brand.mark.file]) {
      raw.brand.mark.file = assetUrls[raw.brand.mark.file];
    }
  }
  assetsManifest = raw;
}

// 2. Read index.html
const indexHtmlPath = join(distClient, 'index.html');
const indexHtml = readFileSync(indexHtmlPath, 'utf8');

// 3. Find and inline CSS
const bundleDir = join(distClient, 'bundle');
const bundleFiles = existsSync(bundleDir) ? readdirSync(bundleDir) : [];

const cssFile = bundleFiles.find((f) => f.startsWith('main-') && f.endsWith('.css'));
if (!cssFile) throw new Error('CSS bundle not found in dist/client/bundle/');

let cssContent = readFileSync(join(bundleDir, cssFile), 'utf8');

// Replace font url(...) in CSS with data URIs
cssContent = cssContent.replace(/url\(\s*['"]?(\/bundle\/[^'")]+)['"]?\s*\)/g, (match, urlPath) => {
  const fontFileName = urlPath.replace('/bundle/', '');
  const fontFilePath = join(bundleDir, fontFileName);
  if (existsSync(fontFilePath)) {
    const ext = extname(fontFileName).toLowerCase();
    const mime = mimeTypes[ext] || 'font/woff2';
    const b64 = readFileSync(fontFilePath).toString('base64');
    return `url("data:${mime};base64,${b64}")`;
  }
  return match;
});

// Also replace any other url(/assets/...) in CSS
cssContent = cssContent.replace(/url\(\s*['"]?(\/assets\/[^'")]+)['"]?\s*\)/g, (match, urlPath) => {
  const clean = urlPath.replace(/^\/+/, '');
  if (assetUrls[clean]) {
    return `url("${assetUrls[clean]}")`;
  }
  return match;
});

// 4. Find and inline JS
const jsFile = bundleFiles.find((f) => f.startsWith('main-') && f.endsWith('.js'));
if (!jsFile) throw new Error('JS bundle not found in dist/client/bundle/');

let jsContent = readFileSync(join(bundleDir, jsFile), 'utf8');

// Replace image string literals like "/assets/brand/bakchich.png" (in quotes or backticks)
jsContent = jsContent.replace(/[`"']\/assets\/([^`"']+)['"`]/g, (match, path) => {
  const clean = path.replace(/^\/+/, '');
  const uri = assetUrls[clean] || assetUrls[`assets/${clean}`] || assetUrls[`/assets/${clean}`];
  if (uri) {
    return JSON.stringify(uri);
  }
  return match;
});

// Also replace "assets/..."
jsContent = jsContent.replace(/[`"']assets\/([^`"']+)['"`]/g, (match, path) => {
  const clean = path.replace(/^\/+/, '');
  const uri = assetUrls[clean] || assetUrls[`assets/${clean}`] || assetUrls[`/assets/${clean}`];
  if (uri) {
    return JSON.stringify(uri);
  }
  return match;
});

// 5. Build final standalone HTML
// Ensure target directory exists
const targetDir = dirname(targetFile);
mkdirSync(targetDir, { recursive: true });

const favicon32 = assetUrls['brand/favicon-32.png'] || '';
const favicon16 = assetUrls['brand/favicon-16.png'] || '';
const appleTouch = assetUrls['brand/apple-touch-icon.png'] || '';

const standaloneHtml = `<!doctype html>
<html lang="en" data-mode="factory">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#12151d" />
    <meta name="description" content="Factory Office — virtual pixel-art office for software factory agents" />
    <title>Factory Office</title>
    ${favicon32 ? `<link rel="icon" href="${favicon32}" type="image/png" sizes="32x32" />` : ''}
    ${favicon16 ? `<link rel="icon" href="${favicon16}" type="image/png" sizes="16x16" />` : ''}
    ${appleTouch ? `<link rel="apple-touch-icon" href="${appleTouch}" />` : ''}
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #12151d; }
      #world { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; image-rendering: pixelated; }
      #ui { position: fixed; inset: 0; pointer-events: none; }
      #ui > * { pointer-events: auto; }
    </style>
    <style>
${cssContent}
    </style>
  </head>
  <body>
    <canvas id="world"></canvas>
    <div id="ui"></div>
    <script>
      window.__FACTORY_DEFAULT__ = true;
      window.__ASSET_URLS__ = ${JSON.stringify(assetUrls)};
      window.__ASSETS_MANIFEST__ = ${JSON.stringify(assetsManifest)};

      // Strict network guard: ensure no network calls leave the page
      const _origFetch = window.fetch;
      window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
        if (url.startsWith('data:') || url.startsWith('blob:')) {
          return _origFetch ? _origFetch.call(this, input, init) : Promise.reject(new Error('fetch unavailable'));
        }
        console.warn('[standalone guard] blocked request:', url);
        return Promise.reject(new Error('Network calls are disabled in standalone build: ' + url));
      };
    </script>
    <script type="module">
${jsContent}
    </script>
  </body>
</html>
`;

writeFileSync(targetFile, standaloneHtml, 'utf8');

const stats = statSync(targetFile);
const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
const sizeKb = (stats.size / 1024).toFixed(0);

console.log(`Successfully generated standalone HTML:`);
console.log(`  Path: ${targetFile}`);
console.log(`  Size: ${stats.size} bytes (${sizeKb} kB / ${sizeMb} MB)`);
