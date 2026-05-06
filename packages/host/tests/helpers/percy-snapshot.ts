import { pauseTest, settled } from '@ember/test-helpers';

// eslint-disable-next-line @cardstack/host/no-percy-direct-import
import originalPercySnapshot from '@percy/ember';

import QUnit from 'qunit';

const PERCY_PAUSE_PARAMETER = 'percypause';

QUnit.config.urlConfig.push({
  id: PERCY_PAUSE_PARAMETER,
  label: 'Pause on Percy snapshot',
});

export default async function percySnapshot(
  ...args: Parameters<typeof originalPercySnapshot>
) {
  await settled();

  // Load every @font-face the page has declared, not just a hard-coded list.
  // This covers IBM Plex Sans, IBM Plex Mono (used by Monaco), IBM Plex Serif
  // and any future additions, without needing to keep the helper in sync.
  //
  // `allSettled` (not `all`) because Chrome rejects FontFace.load() with a
  // generic `DOMException: A network error occurred.` when the font fetch
  // fails — typically a transient hiccup pulling a non-critical font over the
  // wire in CI. Letting that bubble out turns the *whole* test red with no URL
  // attached. The hard-coded IBM Plex Sans `document.fonts.check` below stays
  // the load-bearing assertion: if the font that actually moves Percy pixels
  // is missing, fail there with a clear message.
  let fontResults = await Promise.allSettled(
    Array.from(document.fonts, (f) => f.load().then(() => f)),
  );
  await document.fonts.ready;

  let failedFonts = fontResults.flatMap((result, idx) => {
    if (result.status !== 'rejected') {
      return [];
    }
    let face = Array.from(document.fonts)[idx];
    let descriptor = face
      ? `${face.weight} ${face.style} "${face.family}"`
      : `<font#${idx}>`;
    let reason = describeFontLoadError(result.reason);
    return [`${descriptor}: ${reason}`];
  });
  if (failedFonts.length) {
    console.warn(
      `[percy-snapshot] ${failedFonts.length} @font-face load(s) failed; continuing snapshot. Failures:\n  ${failedFonts.join('\n  ')}`,
    );
  }

  // The hard-coded Sans check remains as a load-bearing assertion: this font
  // is the default body font, and a capture without it shifts every text
  // element by a fraction of a pixel and turns Percy red across the board.
  for (const weight of ['400', '500', '600', '700']) {
    const descriptor = `${weight} 1em IBM Plex Sans`;
    if (!document.fonts.check(descriptor, '')) {
      throw new Error(
        `Not ready: IBM Plex Sans font could not be loaded (${descriptor})`,
      );
    }
  }

  // Images (card icons, thumbnails, SVGs fetched from the icons server) can
  // still be loading even after `settled()` resolves, because their requests
  // aren't registered as Ember test waiters. Percy would then capture a frame
  // where some images have painted and others haven't — exactly the "card
  // icon inconsistencies" false-positive class.
  await Promise.all(
    Array.from(document.images)
      .filter((img) => !img.complete)
      .map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
      ),
  );

  // Give the browser one full paint after fonts/images settle. CSS custom
  // properties (e.g. --icon-color cascading from an ancestor) resolve at
  // paint time, and async stylesheet chunks can shift what the cascade
  // returns between otherwise-identical captures.
  await new Promise<void>((resolve) =>
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Percy snapshot must wait for paint, not Ember runloop
    requestAnimationFrame(() =>
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- second frame to cover the paint following layout
      requestAnimationFrame(() => resolve()),
    ),
  );

  if (window.location.search.includes(PERCY_PAUSE_PARAMETER)) {
    await pauseTest();
  }

  await originalPercySnapshot(...args);
}

function describeFontLoadError(reason: unknown): string {
  if (reason instanceof Error) {
    let header = reason.name
      ? `${reason.name}: ${reason.message}`
      : reason.message;
    return header || 'Unknown error';
  }
  if (typeof reason === 'string') {
    return reason;
  }
  return String(reason);
}
