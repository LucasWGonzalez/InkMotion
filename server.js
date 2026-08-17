import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT) || 8080;
const mime = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.mind':'application/octet-stream' };

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const routeFile = pathname === '/' || pathname === '/crear' || /^\/ver\/[0-9a-f-]+$/i.test(pathname) ? '/index.html' : pathname;
  const filePath = path.resolve(root, `.${routeFile}`);
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); res.end('404 - Archivo no encontrado'); return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) { res.writeHead(500, { 'Content-Type':'text/plain; charset=utf-8' }); res.end('Error interno'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(content);
  });
}).listen(port, () => console.log(`InkMotion disponible en http://localhost:${port}`));
