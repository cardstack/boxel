#!/usr/bin/env node
/**
 * TEMPORARY heap snapshot helper for memory-leak investigation.
 * Connects to Chrome via CDP on localhost:9333; watches console for PROBE t=N
 * lines and at the configured indices writes a .heapsnapshot to /tmp/.
 *
 * Usage: node scripts/heap-snapshot-runner.js
 * SNAPSHOT_AT="2,20,40" (default)
 */
const http = require('http');
const fs = require('fs');

const TARGETS = (process.env.SNAPSHOT_AT || '2,20,40')
  .split(',')
  .map((n) => parseInt(n, 10))
  .filter((n) => !isNaN(n));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function findTestTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      let tabs = await httpJson('http://localhost:9333/json');
      let target = tabs.find(
        (t) =>
          t.type === 'page' &&
          t.url &&
          (t.url.includes('/tests/') || t.url.includes('tests/index.html')),
      );
      if (target) return target;
    } catch (_e) {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no test tab found on :9333');
}

let nextId = 1;
function cdpCall(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const idStr = `"id":${id}`;
    const onMessage = (event) => {
      if (typeof event.data !== 'string' || event.data.indexOf(idStr) === -1)
        return;
      let d = JSON.parse(event.data);
      if (d.id === id) {
        ws.removeEventListener('message', onMessage);
        if (d.error) reject(new Error(d.error.message));
        else resolve(d.result);
      }
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function takeSnapshot(ws, filename) {
  // Stream chunks straight to disk; joining them first blows V8's max string
  // length (~512MB) on snapshots past ~300MB.
  let fd = fs.openSync(filename, 'w');
  let chunkCount = 0;
  const listener = (event) => {
    let d = JSON.parse(event.data);
    if (d.method === 'HeapProfiler.addHeapSnapshotChunk') {
      fs.writeSync(fd, d.params.chunk);
      chunkCount++;
    }
  };
  ws.addEventListener('message', listener);
  await cdpCall(ws, 'HeapProfiler.enable', {});
  await cdpCall(ws, 'HeapProfiler.takeHeapSnapshot', {
    reportProgress: false,
    treatGlobalObjectsAsRoots: true,
  });
  ws.removeEventListener('message', listener);
  fs.closeSync(fd);
  console.log(
    `wrote ${filename} (${chunkCount} chunks, ${fs.statSync(filename).size} bytes)`,
  );
}

async function main() {
  console.log('waiting for test tab on localhost:9333...');
  let target = await findTestTarget();
  console.log('connecting to', target.webSocketDebuggerUrl);
  let ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  await cdpCall(ws, 'Runtime.enable', {});

  let taken = new Set();
  ws.addEventListener('message', async (event) => {
    if (
      typeof event.data !== 'string' ||
      event.data.indexOf('"method":"Runtime.consoleAPICalled"') === -1
    ) {
      return;
    }

    let d = JSON.parse(event.data);
    let args = d.params.args || [];
    let text = args.map((a) => a.value || '').join(' ');
    if (text.indexOf('MEMPROBE') !== -1) {
      console.log(text);
    }
    let m = text.match(/PROBE t=(\d+)/);
    if (m) {
      let n = parseInt(m[1], 10);
      if (TARGETS.includes(n) && !taken.has(n)) {
        taken.add(n);
        console.log(`taking snapshot at t=${n} ...`);
        try {
          await takeSnapshot(ws, `/tmp/snap-t${n}.heapsnapshot`);
        } catch (e) {
          console.error('snapshot failed', e);
        }
        if (taken.size === TARGETS.length) {
          console.log('all snapshots taken; exiting');
          process.exit(0);
        }
      }
    }
  });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
