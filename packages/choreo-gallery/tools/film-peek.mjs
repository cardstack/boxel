/**
 * THE PEEK — load a URL in headless Chrome, print what its console said,
 * and write one PNG of it. Muted, windowless, disposable.
 *
 *   node packages/choreo-gallery/tools/film-peek.mjs 'http://localhost:4200/sagrada?embed' out/peek.png
 *   node packages/choreo-gallery/tools/film-peek.mjs <url> <png> [debug-port] [settle-ms]
 *
 * It exists because a film can pass every typecheck, lint and test in
 * the building and still throw at construction in the browser: Phase 2
 * of the film graph shipped exactly that, and nothing but loading the
 * page caught it. So no film URL is handed over without a peek of its
 * `?embed` document (the theater route mounts the film in an iframe;
 * `?embed` is the film itself), and two builds are compared for parity
 * by peeking the same `?embed&from=N` on each and reading the PNGs.
 *
 * Chris's standing rule — no visible browser from a session on the
 * films, because they are narrated — is why this is headless and muted.
 * `--enable-unsafe-swiftshader` because the scenes are WebGL and
 * headless has no GPU. Node 22+ for the built-in WebSocket.
 */
/* eslint-disable n/no-process-exit */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, out, portArg, settleArg] = process.argv.slice(2);
if (!url || !out) {
  console.error(
    'usage: node packages/choreo-gallery/tools/film-peek.mjs <url> <png> [port] [settle-ms]',
  );
  process.exit(2);
}
const port = Number(portArg ?? 9333);
const settle = Number(settleArg ?? 12000);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  `--user-data-dir=/tmp/film-peek-${port}`,
  '--window-size=1280,800',
  'about:blank',
]);
chrome.stderr.on('data', () => {});
chrome.stdout.on('data', () => {});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
try {
  let list;
  for (let i = 0; i < 80; i += 1) {
    try {
      list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list?.length) {
        break;
      }
    } catch {
      /* the debugger is not up yet */
    }
    await wait(500);
  }
  if (!list?.length) {
    throw new Error(`no debugging target on :${port}`);
  }
  const page = list.find((t) => t.type === 'page') ?? list[0];
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res) => {
      id += 1;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(
        `[${m.params.type}] ` +
          m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
      );
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${d.exception?.description ?? d.text}`);
    }
    if (m.method === 'Log.entryAdded') {
      const { level, text, url: at } = m.params.entry;
      logs.push(`[log:${level}] ${text} ${at ?? ''}`);
    }
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await wait(settle);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  const state = await send('Runtime.evaluate', {
    expression:
      'document.title + " | film page: " + !!document.querySelector(".cf-page") + " | door: " + !!document.querySelector(".cf-gate-in")',
    returnByValue: true,
  });
  console.log(state.result.value);
  console.log(
    logs
      .filter((l) => !/DEPRECATION|Binding style|\[debug\]|favicon/.test(l))
      .slice(0, 40)
      .join('\n'),
  );
} finally {
  ws?.close();
  chrome.kill();
}
