import fs from 'node:fs/promises';
import path from 'node:path';
export async function filmOverlays(browser, origin, out) {
  const score = JSON.parse(
    await fs.readFile(
      'packages/choreo-test-app/app/lib/widget-quick-score.json',
      'utf8',
    ),
  );
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const escape = (s) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const files = [];
  try {
    for (const [i, chapter] of score.chapters.entries()) {
      await page.setContent(
        `<link rel="stylesheet" href="${origin}/@embroider/virtual/app.css"><style>html,body{margin:0!important;background:transparent!important;width:1920px;height:1080px;overflow:hidden}section{position:absolute;left:48px;right:48px;bottom:36px;min-height:150px;box-sizing:border-box;background:#19130f;border-top:1px solid #ff6a3a;padding:22px 28px;display:flex;gap:22px;color:#f3ece3;font-family:Archivo,sans-serif}b{font:500 44px Syne,sans-serif;color:#ff6a3a}small{display:block;font:9px 'IBM Plex Mono',monospace;color:#89735e;margin-top:6px}div{flex:1}span{font:9px 'IBM Plex Mono',monospace;letter-spacing:2px;color:#ffad83}h2{font:600 28px Syne,sans-serif;letter-spacing:-.4px;margin:7px 0 9px}p{font-size:17px;line-height:1.4;color:#dacbbb;margin:0}</style><section><b>0${i + 1}<small>/ 05</small></b><div><span>${escape(chapter.category)}</span><h2>${escape(chapter.title)}</h2><p>${escape(chapter.text)}</p></div></section>`,
      );
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(out, `film-overlay-${i}.png`);
      await page.screenshot({ path: file, omitBackground: true });
      files.push({
        file,
        at: chapter.at,
        end: score.chapters[i + 1]?.at ?? 50,
      });
    }
  } finally {
    await page.close();
  }
  return files;
}
