/* global document */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4600/film';
const output = resolve(process.argv[3] ?? 'out/first-film');
// Refuse to overwrite an earlier render.
mkdirSync(output);
mkdirSync(join(output, 'frames'));
const command = (name, args) => {
  const result = spawnSync(name, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`${name}: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
};
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1200 },
    deviceScaleFactor: 1,
  });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const frame = page.locator('[data-tutorial-film]');
  await frame.waitFor();
  const dimensions = await frame.boundingBox();
  assert.equal(dimensions.width, 1920);
  assert.equal(dimensions.height, 1080);
  for (let n = 0; n < 360; n++) {
    await frame.evaluate(async (el, time) => {
      await el.tutorialCapture.renderAt(time);
    }, n / 60);
    await frame.screenshot({
      path: join(output, 'frames', `${String(n).padStart(4, '0')}.png`),
    });
    if (n % 60 === 0) {
      console.log(`Captured ${n}/360`);
    }
  }
} finally {
  await browser.close();
}
command('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=0.2',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=660:duration=0.2',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=880:duration=0.2',
  '-filter_complex',
  '[0:a]volume=0.15,adelay=1000[a];[1:a]volume=0.15,adelay=3000[b];[2:a]volume=0.15,adelay=5000[c];[a][b][c]amix=inputs=3:normalize=0,apad,atrim=duration=6[out]',
  '-map',
  '[out]',
  join(output, 'cue.wav'),
]);
command('ffmpeg', [
  '-v',
  'error',
  '-framerate',
  '60',
  '-i',
  join(output, 'frames', '%04d.png'),
  '-i',
  join(output, 'cue.wav'),
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '20',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-movflags',
  '+faststart',
  '-t',
  '6',
  join(output, 'preview.mp4'),
]);
const info = JSON.parse(
  command('ffprobe', [
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    join(output, 'preview.mp4'),
  ]),
);
const video = info.streams.find((s) => s.codec_type === 'video');
assert.equal(video.width, 1920);
assert.equal(video.height, 1080);
assert.equal(video.r_frame_rate, '60/1');
assert.equal(video.pix_fmt, 'yuv420p');
assert(
  info.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac'),
);
assert(Math.abs(Number(info.format.duration) - 6) < 0.05);
console.log(
  `Verified 1920×1080, 60 fps, six seconds, AAC audio: ${join(output, 'preview.mp4')}`,
);
