import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.env.BOXEL_ASSET_PORT);
const configuredRoot = process.env.BOXEL_ASSET_DIR;
if (
  !configuredRoot ||
  !path.isAbsolute(configuredRoot) ||
  !Number.isSafeInteger(port) ||
  port < 1 ||
  port > 65535
)
  throw new Error('Configure BOXEL_ASSET_DIR and BOXEL_ASSET_PORT');
const root = await realpath(configuredRoot);
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    let url = new URL(request.url ?? '/', 'http://localhost');
    let candidate = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      response.writeHead(400).end();
      return;
    }
    let file: string;
    try {
      file = await realpath(candidate);
      if (!(await stat(file)).isFile()) throw new Error('Not a file');
    } catch {
      if (path.extname(url.pathname)) {
        response.writeHead(404).end();
        return;
      }
      file = await realpath(path.join(root, 'index.html'));
    }
    if (!file.startsWith(`${root}${path.sep}`)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      'Content-Type',
      types[path.extname(file)] ?? 'application/octet-stream',
    );
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file)
      .on('error', () => response.destroy())
      .pipe(response);
  } catch {
    if (!response.headersSent) response.writeHead(404);
    response.end();
  }
});
server.listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
