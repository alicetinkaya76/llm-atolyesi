// Yerel önizleme sunucusu: node serve.mjs  →  http://localhost:8933
// (GitHub Pages'in yaptığını yerelde yapar; hiçbir bağımlılık yok.)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8933;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    /* startsWith(ROOT) ayraç içermediği için yetmez: adı ROOT ile başlayan
       her kardeş klasör (llm-atolyesi-yedek, llm-atolyesi.bak …) kontrolü
       geçiyordu. relative() ile bakınca kök dışı yol ya '..' ile başlar ya
       da mutlaktır. */
    const bagil = relative(ROOT, file);
    if (bagil.startsWith('..') || isAbsolute(bagil)) throw new Error('kök dışı');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bulunamadı');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`atölye: http://localhost:${PORT}`));
