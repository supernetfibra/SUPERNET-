// Simple static server for the pre-built isolate/
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4173;
const ROOT = path.join(__dirname, 'isolate');

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

const server = http.createServer((req, res) => {
  let f = req.url.split('?')[0];
  if (f === '/') f = '/index.html';
  const fp = path.join(ROOT, f);

  fs.readFile(fp, (err, data) => {
    if (err) {
      // SPA fallback → serve index.html
      fs.readFile(path.join(ROOT, 'index.html'), (e2, d2) => {
        res.writeHead(e2 ? 500 : 200, { 'Content-Type': 'text/html' });
        res.end(e2 ? '500' : d2);
      });
      return;
    }
    const ext = path.extname(f);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Preview server listening on http://localhost:${PORT}`);
});
