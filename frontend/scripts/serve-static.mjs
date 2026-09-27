// Match GitHub Pages extensionless HTML and real 404 behavior in browser tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.xml':'application/xml','.txt':'text/plain','.json':'application/json'};
createServer(async (request,response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') pathname = '/index.html';
    else if (!extname(pathname)) pathname += '.html';
    const file = resolve(root, `.${pathname}`);
    if (!file.startsWith(root + '/')) { response.writeHead(400);response.end();return; }
    try {
      const content = await readFile(file);
      response.writeHead(200, {'Content-Type': mime[extname(file)] || 'application/octet-stream'});
      response.end(content);
    } catch {
      response.writeHead(404, {'Content-Type':'text/html; charset=utf-8','X-Robots-Tag':'noindex'});
      response.end(await readFile(resolve(root,'404.html')));
    }
  } catch { response.writeHead(400);response.end(); }
}).listen(4173, '127.0.0.1', () => console.log('Static preview: http://127.0.0.1:4173'));
