/**
 * THE POSTER STILL — one frame of a film, for its gallery tile.
 *
 * A card cannot run a film: the grid mounts forty-odd demos at once and
 * these two are the most expensive things in the building, so the tile
 * wears a poster instead (see test-app/app/components/film-tile.gts).
 * The poster is not drawn — it is the film, one frame of it, read back
 * through the picture port's own `snapshot()`. That is the same call
 * every still join makes, so the still is graded exactly as the film
 * grades itself, and it can never drift from the scene.
 *
 * Headless and muted, which matters: this boots a narrated film.
 *
 *   pnpm --filter test-app start          # in another shell
 *   node scripts/film-poster.mjs towers gate 18 13
 *   cwebp -q 78 out/towers-gate.jpg -o test-app/public/towers-poster.webp
 *
 * A shot is a beat index (`?from=N`), or the word `gate`, which captures
 * the film's own door — the evening the construct dresses the poster
 * circuit in, art-directed for exactly this purpose. Both shipped
 * posters are `gate` and the Sagrada one is beat 24, its centenary
 * night; capture several and look at them before choosing.
 */
/* An authoring tool, not shipped code: it needs Node 22 for the built-in
   WebSocket it drives Chrome's debugging protocol over, and it is a CLI,
   so it exits with a status like one. The package's floor is Node 16
   because the LIBRARY has to run there; this file never does. */
/* eslint-disable n/no-process-exit */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const ORIGIN = process.env['FILM_ORIGIN'] ?? 'http://localhost:4200';
const OUT = process.env['FILM_OUT'] ?? 'out';
const FILM = process.argv[2];
const SHOTS = process.argv.slice(3);
/* the world has to load, the lens has to seat, and a beat has to apply */
const SETTLE = Number(process.env['FILM_SETTLE'] ?? 9000);

if (!FILM || SHOTS.length === 0) {
  console.error('usage: node scripts/film-poster.mjs <film> <shot…>');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  /* it is a narrated film and nobody asked to hear it */
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,720',
  '--hide-scrollbars',
  /* the scene is WebGL and headless has no GPU */
  '--enable-unsafe-swiftshader',
  '--user-data-dir=/tmp/cf-poster-profile',
  'about:blank',
]);
chrome.stderr.on('data', () => {});

let ws;
let id = 0;
const waiting = new Map();
const send = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => waiting.set(mid, { rej, res }));
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  let list;
  for (let i = 0; i < 60; i += 1) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list.length) {
        break;
      }
    } catch {
      /* the debugger is not up yet */
    }
    await sleep(250);
  }
  ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { rej, res } = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');

  for (const shot of SHOTS) {
    const url =
      shot === 'gate'
        ? `${ORIGIN}/${FILM}`
        : `${ORIGIN}/${FILM}?embed&from=${shot}`;
    await send('Page.navigate', { url });
    await sleep(SETTLE);
    /* the picture is a same-origin iframe; __film is its port */
    const { result } = await send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `(async () => {
        const f = document.querySelector('iframe');
        const w = f && f.contentWindow;
        const film = w && w.__film;
        if (!film) return 'NOFILM';
        await new Promise((r) =>
          w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
        return film.snapshot();
      })()`,
      returnByValue: true,
    });
    const data = result.value ?? '';
    if (!String(data).startsWith('data:image')) {
      console.log(`shot ${shot}: FAILED (${String(data).slice(0, 60)})`);
      continue;
    }
    const buf = Buffer.from(String(data).split(',')[1], 'base64');
    const file = `${OUT}/${FILM}-${shot}.jpg`;
    writeFileSync(file, buf);
    console.log(
      `shot ${shot}: ${(buf.length / 1024).toFixed(0)} KB -> ${file}`,
    );
  }
  chrome.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  chrome.kill();
  process.exit(1);
});
