#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqlite } from '../core/sqlite.js';
import { BoxelNativeRuntime } from '../core/runtime.js';
import { seed } from '../core/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);

const db = createSqlite();
const runtime = new BoxelNativeRuntime(db);
runtime.bootstrap(seed);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const route = url.pathname.replace(/\/$/, '') || '/';
  if (req.method === 'GET' && route === '/api/state') {
    return json(res, 200, runtime.snapshot());
  }
  if (req.method === 'GET' && route === '/api/cards') {
    return json(res, 200, {
      cards: runtime.searchCards(url.searchParams.get('q') || ''),
    });
  }
  if (req.method === 'GET' && route.startsWith('/api/cards/')) {
    const alias = decodeURIComponent(route.slice('/api/cards/'.length));
    const card = runtime.getCard(alias);
    return card
      ? json(res, 200, { card })
      : json(res, 404, { error: 'card not found' });
  }
  if (req.method === 'POST' && route === '/api/cards') {
    const body = await readBody(req);
    const card = runtime.createPersonCard({
      firstName: String(body.firstName || '').trim() || 'Untitled',
      lastName: String(body.lastName || '').trim(),
    });
    return json(res, 201, { card, state: runtime.snapshot() });
  }
  if (req.method === 'GET' && route.startsWith('/api/rooms/')) {
    const roomId = decodeURIComponent(
      route.slice('/api/rooms/'.length).replace(/\/messages$/, ''),
    );
    const room = runtime.messenger.getRoom(roomId);
    if (!room) return json(res, 404, { error: 'room not found' });
    return json(res, 200, {
      room,
      messages: runtime.listMessages(roomId),
    });
  }
  if (req.method === 'POST' && /\/api\/rooms\/[^/]+\/messages$/.test(route)) {
    const roomId = decodeURIComponent(route.split('/')[3]);
    const body = await readBody(req);
    const message = runtime.sendMessage({
      roomId,
      body: String(body.body || '').trim(),
      cardAlias: body.cardAlias || null,
    });
    return json(res, 201, { message, state: runtime.snapshot() });
  }
  if (req.method === 'POST' && route === '/api/online') {
    const body = await readBody(req);
    return json(res, 200, runtime.setOnline(Boolean(body.online)));
  }
  if (req.method === 'GET' && route === '/api/sync') {
    return json(res, 200, {
      plan: runtime.previewSync(url.searchParams.get('prefer') || 'newest'),
      online: runtime.online,
      log: runtime.lastSyncLog,
    });
  }
  if (req.method === 'POST' && route === '/api/sync') {
    const body = await readBody(req);
    try {
      const result = runtime.sync({
        prefer: body.prefer || 'newest',
        deleteSync: Boolean(body.deleteSync),
      });
      return json(res, 200, result);
    } catch (err) {
      return json(res, 409, { error: err.message });
    }
  }
  return json(res, 404, { error: `no route ${req.method} ${route}` });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    const abs = path.normalize(path.join(__dirname, filePath));
    if (!abs.startsWith(__dirname)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    const data = await fs.promises.readFile(abs);
    const ext = path.extname(abs);
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404);
      return res.end('not found');
    }
    console.error(err);
    res.writeHead(500);
    res.end(String(err.message || err));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Boxel native prototype (iPhone chrome) → http://127.0.0.1:${PORT}/`);
  console.log('SQLite lite indexer is in-process via node:sqlite.');
});
