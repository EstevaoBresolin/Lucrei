import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const cfg = JSON.parse(fs.readFileSync('/home/claude/lucrei/vercel.json', 'utf8'))
const hs = Object.fromEntries(cfg.headers[0].headers.map((h) => [h.key, h.value.replace(/https:\/\/tsrayceuysteuhbnzxih\.supabase\.co/g, 'http://localhost:54321').replace(/wss:\/\/tsrayceuysteuhbnzxih\.supabase\.co/g, 'ws://localhost:54321').replace('; upgrade-insecure-requests', '')]))
const root = '/tmp/claude-0/e2e/app/dist'
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
http.createServer((q, r) => {
  let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html')
  r.writeHead(200, { ...hs, 'Content-Type': types[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(r)
}).listen(4174)
