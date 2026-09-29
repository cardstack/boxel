/**
 * THE DETERMINISTIC RENDER — an exact film stood at a time, frame by
 * frame, and read back.
 *
 *   node scripts/film-render.mjs <url> <out-dir> <name> [fps] [from] [to] [port]
 *
 * This is the other half of `film-peek.mjs`. A peek watches the film run;
 * this one does not let it run at all. It calls `renderAt(t)` for every
 * frame in turn and captures what comes back, which only works because
 * `@seek='exact'` makes the whole film a pure function of one number —
 * the pose, the beat, the seam's progress, the type's run and the clip's
 * source time all derived, nothing accumulated.
 *
 * So the output is reproducible: the same URL and the same frame numbers
 * give the same pixels on any machine at any speed, where a live capture
 * gives whatever the machine managed that second. Compare the two and you
 * are testing the claim.
 */
/* eslint-disable n/no-process-exit, n/no-unsupported-features/node-builtins */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, out, name, fpsArg, fromArg, toArg, portArg, sizeArg] =
  process.argv.slice(2);
if (!url || !out || !name) {
  console.error(
    'usage: node scripts/film-render.mjs <url> <out-dir> <name> [fps] [from] [to] [port] [WxH]',
  );
  process.exit(2);
}
const fps = Number(fpsArg ?? 30);
const from = Number(fromArg ?? 0);
const port = Number(portArg ?? 9500);
/* the delivery size, forced rather than inherited: a render is a master,
   so it is 1920x1080 unless something says otherwise */
const [vw, vh] = String(sizeArg ?? '1920x1080')
  .split('x')
  .map((n) => Number(n));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  `--user-data-dir=/tmp/film-render-${port}`,
  `--window-size=${vw},${vh}`,
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
      /* not up yet */
    }
    await wait(500);
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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  const ev = (expression) =>
    send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

  await send('Runtime.enable');
  await send('Page.enable');
  /* forced, so the frame is the size asked for and not the size the
     headless window happened to give */
  await send('Emulation.setDeviceMetricsOverride', {
    deviceScaleFactor: 1,
    height: vh,
    mobile: false,
    width: vw,
  });
  await send('Page.navigate', { url });

  /* wait for the film to publish itself and for its picture to be seated */
  let total = 0;
  for (let i = 0; i < 60; i += 1) {
    await wait(500);
    const r = await ev(
      `(()=>{const f=window.__choreo&&window.__choreo[${JSON.stringify(name)}];
        return f?JSON.stringify({exact:f.exact,secs:f.seconds()}):''})()`,
    );
    const v = r.result?.value;
    if (v) {
      const info = JSON.parse(v);
      if (!info.exact) {
        console.error(
          `"${name}" is not an exact film; there is nothing to render deterministically`,
        );
        process.exit(3);
      }
      total = info.secs;
      break;
    }
  }
  if (!total) {
    console.error(`no film called "${name}" on that page`);
    process.exit(4);
  }
  const to = Math.min(Number(toArg ?? total), total);
  const frames = Math.max(1, Math.round((to - from) * fps));
  console.log(
    `${name}: ${total.toFixed(1)}s total, rendering ${from}..${to}s at ${fps}fps = ${frames} frames`,
  );

  /* let the scene settle before the first frame, or the first second
     records a picture that is still loading rather than one that is wrong */
  await ev(`window.__choreo[${JSON.stringify(name)}].renderAt(${from})`);
  await wait(2500);

  for (let i = 0; i < frames; i += 1) {
    const t = from + i / fps;
    await ev(`window.__choreo[${JSON.stringify(name)}].renderAt(${t})`);
    const shot = await send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 82,
    });
    writeFileSync(
      `${out}/f${String(i + 1).padStart(5, '0')}.jpg`,
      Buffer.from(shot.data, 'base64'),
    );
    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${frames}`);
    }
  }
  console.log(`wrote ${frames} frames to ${out}`);
} finally {
  ws?.close();
  chrome.kill();
}
