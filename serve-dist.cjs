// Simple static server for the production build (dist/)
// Serves the built assets with SPA fallback AND proxies /api/* to the Convex
// HTTP site (mirrors vercel.json rewrites), so admin login, real-customer
// login and branding work in the preview like in production.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4173;
const ROOT = path.join(__dirname, 'dist');
// Production Convex HTTP site (matches vercel.json). Overridable via env.
const CONVEX_SITE = process.env.CONVEX_SITE_URL || 'https://small-sparrow-797.convex.site';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

async function handleApi(req, res) {
  const upstream = `${CONVEX_SITE}${req.url}`;
  const init = { method: req.method, headers: {} };
  // Forward cookies (session/auth) and content-type from the client
  if (req.headers.cookie) init.headers.cookie = req.headers.cookie;
  if (req.headers['content-type']) init.headers['content-type'] = req.headers['content-type'];

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length > 0) init.body = Buffer.concat(chunks);
  }

  try {
    const resp = await fetch(upstream, init);
    const buf = Buffer.from(await resp.arrayBuffer());
    const outHeaders = { 'Content-Type': resp.headers.get('content-type') || 'application/json' };
    // Forward Set-Cookie so session cookies set by the backend reach the browser
    const setCookie = resp.headers.get('set-cookie');
    if (setCookie) outHeaders['Set-Cookie'] = setCookie;
    res.writeHead(resp.status, outHeaders);
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
  }
}

const server = http.createServer((req, res) => {
  // Proxy API requests to the Convex backend
  if (req.url.startsWith('/api/')) {
    handleApi(req, res).catch((err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
    });
    return;
  }

  let f = req.url.split('?')[0];
  if (f === '/') f = '/index.html';
  const fp = path.join(ROOT, f);

  fs.readFile(fp, (err, data) => {
    if (err) {
      // SPA fallback → serve index.html
      fs.readFile(path.join(ROOT, 'index.html'), (e2, d2) => {
        if (e2) {
          res.writeHead(500);
          res.end('500');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(f);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Preview server listening on http://127.0.0.1:${PORT} (proxy: ${CONVEX_SITE})`);
});
