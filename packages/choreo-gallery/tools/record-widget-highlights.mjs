import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

import { filmOverlays } from './widget-film-overlays.mjs';
const fps = 60,
  duration = Number(process.env.CAPTURE_SECONDS ?? 50),
  frames = Math.round(duration * fps);
const out = path.resolve('videos/choreo-widget-room/renders');
await fs.mkdir(out, { recursive: true });
const name = process.env.CAPTURE_NAME ?? 'choreo-highlights-1080p60';
const target = path.join(out, name + '.mp4');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CAPTURE_BROWSER ?? process.env.CHROME_PATH,
  args: ['--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
let encoder;
try {
  const overlayFiles = await filmOverlays(
    browser,
    new URL(process.env.CAPTURE_URL ?? 'http://localhost:4590/_widgets').origin,
    out,
  );
  const overlayInputs = overlayFiles.flatMap(({ file }) => [
    '-loop',
    '1',
    '-framerate',
    '60',
    '-i',
    file,
  ]);
  let filter = '[0:v]scale=1920:1080:flags=lanczos,format=rgba[v0];';
  overlayFiles.forEach(({ at, end }, i) => {
    filter += `[v${i}][${i + 2}:v]overlay=enable='gte(t,${at})*lt(t,${end})':shortest=1[v${i + 1}];`;
  });
  filter += `[v${overlayFiles.length}]scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p[video]`;
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.addInitScript({ path: 'scripts/widget-capture-clock.js' });
  const captureUrl = new URL(
    process.env.CAPTURE_URL ?? 'http://localhost:4590/_widgets',
  );
  captureUrl.searchParams.set('film', '1');
  await page.goto(captureUrl.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelectorAll('.wr-live-canvas').length === 45,
  );
  // Warm only the featured demos before the capture clock starts. The room
  // retains their DOM while parked, so decoding cannot intrude into the film.
  const score = JSON.parse(
    await fs.readFile('test-app/app/lib/widget-quick-score.json', 'utf8'),
  );
  for (const id of [...new Set(score.actions.map((a) => a.demo))]) {
    await page
      .locator(`[data-widget-id="${id}"] .wr-live-hit`)
      .evaluate((el) => el.click());
    await page.waitForFunction((id) => {
      const e = document.querySelector(`[data-widget-id="${id}"]`);
      return (
        e.dataset.widgetReady === 'true' &&
        getComputedStyle(e).transform === 'none'
      );
    }, id);
    if (id === 'mockup') {
      await page
        .locator('[data-live-demo="mockup"] .mg-seg button')
        .last()
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-live-demo="mockup"] .mg-page')?.dataset
            .mode === '3d',
      );
    }
    await page.locator('.wr-brand').click();
  }
  await page.evaluate(async () => {
    let last = '',
      stable = 0;
    while (stable < 12) {
      await new Promise(requestAnimationFrame);
      const next = document.querySelector('.wr-world').style.transform;
      stable = next === last ? stable + 1 : 0;
      last = next;
    }
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((i) => i.decode().catch(() => {})),
    );
  });
  await page.addStyleTag({
    content:
      '.wr-guide-plane{visibility:hidden!important}.wr-navigation,.wr-header-actions,.wr-guide-controls,.wr-guide-copy>small,.dialkit-root,.drift-rail,.drift-tab{display:none!important}.wr-shell .wr-guide-plane{left:48px;right:48px;bottom:36px;grid-template-columns:72px minmax(0,1fr);padding:22px 28px}.wr-shell .wr-guide-copy{max-width:none}.wr-shell .wr-guide-copy p{font-size:17px;max-width:1500px;line-height:1.4}.wr-shell .wr-guide-copy h2{font-size:28px}.wr-shell .wr-header{left:48px;right:48px;top:32px}*{cursor:none!important}',
  });
  // Flush native compositor frames and deferred demo setup before freezing time.
  for (let warm = 0; warm < 30; warm++) {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  }
  const wall = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(wall + 1000);
  let origin = await page.evaluate(() => window.__captureBegin());
  await page.clock.runFor(32);
  // Settle mount/layout work before starting the tour's audio clock.
  for (let tick = 1; tick <= 60; tick++) {
    await page.clock.runFor(17);
    await page.evaluate(
      (t) => window.__captureStep(t),
      origin + (tick * 1000) / 60,
    );
  }
  origin += 1000;
  await page.evaluate(() => document.querySelector('.wr-primary').click());
  await page.evaluate(() => Promise.resolve());
  const cdp = await page.context().newCDPSession(page);
  // Let entrance animation and paint settle while the tour itself stays at zero.
  // Advancing only RAF at a frozen timestamp leaves opacity entrances invisible.
  await page.evaluate(() => window.__captureAudio.pause());
  for (let pass = 1; pass <= 60; pass++) {
    await page.clock.runFor(17);
    await page.evaluate(
      (t) => window.__captureStep(t),
      origin + (pass * 1000) / 60,
    );
  }
  origin += 1000;
  await page.evaluate(() => {
    window.__captureAudio.currentTime = 0;
    return window.__captureAudio.play();
  });
  for (let pass = 0; pass < 3; pass++) {
    await page.clock.runFor(17);
    await page.evaluate((t) => window.__captureStep(t), origin);
    await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      captureBeyondViewport: false,
    });
  }
  await page.waitForFunction(() => {
    const guide = document.querySelector('.wr-quick-guide');
    return (
      guide &&
      Number(getComputedStyle(guide).opacity) > 0.99 &&
      window.__captureAudio?.currentTime === 0
    );
  });

  encoder = spawn(
    '/opt/homebrew/bin/ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'warning',
      '-f',
      'image2pipe',
      '-framerate',
      String(fps),
      '-vcodec',
      'png',
      '-i',
      'pipe:0',
      '-i',
      'test-app/public/widget-tour/quick-george.mp3',
      ...overlayInputs,
      '-map',
      '[video]',
      '-map',
      '1:a:0',
      '-filter_complex',
      filter,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-b:v',
      '12M',
      '-maxrate',
      '18M',
      '-bufsize',
      '24M',
      '-profile:v',
      'high',
      '-level:v',
      '4.2',
      '-g',
      '30',
      '-bf',
      '2',
      '-flags',
      '+cgop',
      '-color_range',
      'tv',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-c:a',
      'aac',
      '-b:a',
      '384k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-af',
      'loudnorm=I=-16:TP=-1.5:LRA=11,apad',
      '-t',
      String(duration),
      '-movflags',
      '+faststart',
      target,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let encoderErrors = '';
  encoder.stderr.on('data', (data) => (encoderErrors += data));
  const encoded = once(encoder, 'close');
  const audit = [];
  let previousTick = 0;
  for (let i = 0; i < frames; i++) {
    const ms = (i * 1000) / fps,
      tick = Math.ceil(ms);
    if (tick > previousTick) {
      await page.clock.runFor(tick - previousTick);
    }
    previousTick = tick;
    await page.evaluate((t) => window.__captureStep(t), origin + ms);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    const bytes = Buffer.from(shot.data, 'base64');
    if (!encoder.stdin.write(bytes)) {
      await once(encoder.stdin, 'drain');
    }
    if (i % 300 === 0 || i === frames - 1) {
      const state = await page.evaluate(() => ({
        time: window.__captureAudio?.currentTime,
        actions: Number(
          document.querySelector('.wr-shell').dataset.quickActions,
        ),
        missed: document.querySelector('.wr-shell').dataset.quickMissed,
        chapter: document.querySelector('.wr-quick-guide h2')?.textContent,
        mockupMode: document.querySelector('[data-live-demo="mockup"] .mg-page')
          ?.dataset.mode,
      }));
      audit.push({ frame: i, ...state });
      await fs.writeFile(
        path.join(out, `${name}-${String(i).padStart(4, '0')}.png`),
        bytes,
      );
      console.log(JSON.stringify(audit.at(-1)));
    }
  }
  encoder.stdin.end();
  const [code] = await encoded;
  if (code !== 0) {
    throw Error(encoderErrors);
  }
  const final = await page.evaluate(() => ({
    actions: Number(document.querySelector('.wr-shell').dataset.quickActions),
    missed: document.querySelector('.wr-shell').dataset.quickMissed,
  }));
  await fs.writeFile(
    path.join(out, name + '-capture.json'),
    JSON.stringify(
      {
        width: 1920,
        height: 1080,
        captureWidth: 1920,
        captureHeight: 1080,
        deviceScaleFactor: 1,
        cameraSmoothing: 'sylva-two-stage-baked',
        fps,
        frames,
        duration,
        final,
        errors,
        audit,
      },
      null,
      2,
    ),
  );
  if (errors.length) {
    throw Error(errors.join('\n'));
  }
  if (duration >= 50 && (final.actions !== 23 || final.missed)) {
    throw Error('Capture missed tour actions ' + JSON.stringify(final));
  }
  console.log('EXPORTED', target);
} finally {
  encoder?.stdin.destroy();
  await browser.close();
}
