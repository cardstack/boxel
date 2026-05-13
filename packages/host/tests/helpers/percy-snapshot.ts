import { pauseTest, settled } from '@ember/test-helpers';

// eslint-disable-next-line @cardstack/host/no-percy-direct-import
import originalPercySnapshot from '@percy/ember';

import QUnit from 'qunit';

const PERCY_PAUSE_PARAMETER = 'percypause';

// Cap how long we'll wait for the Percy upload inside a single test. Percy's
// local SDK retries page navigation on a 30 s budget per attempt, so a single
// flaky network hiccup can stack two 30 s retries inside one `await
// percySnapshot(...)` — well past QUnit's 60 s test budget. When QUnit times
// out the test, the still-pending `await` here eventually resolves, the lines
// of test code AFTER `await percySnapshot(...)` run, and any `assert.dom(...)`
// they push lands on a test QUnit already marked dead. QUnit surfaces that as
// "Assertion occurred after test finished" — attached to whichever test is
// currently running. That contaminates the next test (or two) and looks like a
// flake in unrelated tests, but the actual cause is always upstream: a slow
// Percy snapshot that overran the test budget. Capping well below 60 s lets
// the test continue and exit cleanly even when Percy is misbehaving.
const PERCY_SNAPSHOT_BUDGET_MS = 25_000;

QUnit.config.urlConfig.push({
  id: PERCY_PAUSE_PARAMETER,
  label: 'Pause on Percy snapshot',
});

export default async function percySnapshot(
  ...args: Parameters<typeof originalPercySnapshot>
) {
  const overallStart = performance.now();
  const settledStart = performance.now();
  await settled();
  const settledMs = Math.round(performance.now() - settledStart);

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
  let faces = Array.from(document.fonts);
  const fontStart = performance.now();
  let fontResults = await Promise.allSettled(
    faces.map((f) => f.load().then(() => f)),
  );
  await document.fonts.ready;
  const fontMs = Math.round(performance.now() - fontStart);

  let failedFonts = fontResults.flatMap((result, idx) => {
    if (result.status !== 'rejected') {
      return [];
    }
    let face = faces[idx];
    let descriptor = face
      ? `${face.weight} ${face.style} "${face.family}"`
      : `<font#${idx}>`;
    return [{ face, descriptor, reason: describeFontLoadError(result.reason) }];
  });

  // If IBM Plex Sans itself failed to load, fail loud here — `document.fonts
  // .check(..., '')` below cannot be relied on to catch this: per the WHATWG
  // spec, `FontFaceSet.check` treats faces in `error` status as settled, and
  // with empty text it can still return `true` while the required face is
  // actually unrenderable. Without this explicit guard, Percy would capture
  // the page with a fallback font silently substituted.
  let failedRequired = failedFonts.find(
    ({ face }) => face?.family === 'IBM Plex Sans',
  );
  if (failedRequired) {
    throw new Error(
      `Required font failed to load: ${failedRequired.descriptor}: ${failedRequired.reason}`,
    );
  }

  if (failedFonts.length) {
    let lines = failedFonts.map(
      ({ descriptor, reason }) => `${descriptor}: ${reason}`,
    );
    console.warn(
      `[percy-snapshot] ${failedFonts.length} @font-face load(s) failed; continuing snapshot. Failures:\n  ${lines.join('\n  ')}`,
    );
  }

  // Belt-and-suspenders: even if no Sans face entered the `error` status, the
  // page may still be missing a Sans weight (e.g. never declared, or evicted
  // after a teardown). A capture without it shifts every text element by a
  // fraction of a pixel and turns Percy red across the board.
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
  const imageStart = performance.now();
  const pendingImageCount = Array.from(document.images).filter(
    (img) => !img.complete,
  ).length;
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
  const imageMs = Math.round(performance.now() - imageStart);

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

  // Race the actual Percy upload against `PERCY_SNAPSHOT_BUDGET_MS`. Errors
  // that surface BEFORE the budget elapses are real upload failures (Percy
  // server unreachable, malformed call, etc.) — those propagate through
  // `Promise.race` and fail the test. The side `.catch` only swallows
  // rejections that arrive AFTER we've already abandoned the upload, so a
  // late rejection can't surface as an unhandled rejection in a later test.
  const snapshotName = describeSnapshot(args);
  const percyStart = performance.now();
  let abandoned = false;
  const upload = originalPercySnapshot(...args) as Promise<void>;
  upload.catch((err) => {
    if (abandoned) {
      console.warn(
        `[percy-snapshot] late rejection from abandoned snapshot "${snapshotName}":`,
        err,
      );
    }
    // If `abandoned` is false here, the rejection already surfaced via
    // `Promise.race` below — nothing more to do.
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      abandoned = true;
      resolve();
    }, PERCY_SNAPSHOT_BUDGET_MS);
  });
  try {
    await Promise.race([upload, timeoutPromise]);
  } finally {
    // Race settled (upload resolved, upload rejected, or budget fired). In
    // every case we no longer need the timer — leaving it would fire mid-way
    // through a later test, mutating a stale `abandoned` closure for no
    // benefit and holding the snapshot's locals live for 25 s longer.
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
  const timedOut = abandoned;
  const percyMs = Math.round(performance.now() - percyStart);
  const totalMs = Math.round(performance.now() - overallStart);

  if (timedOut) {
    console.warn(
      `[percy-snapshot] "${snapshotName}" abandoned after ${percyMs}ms ` +
        `(budget ${PERCY_SNAPSHOT_BUDGET_MS}ms; settled=${settledMs}ms, ` +
        `fonts=${fontMs}ms, images=${imageMs}ms over ${pendingImageCount} ` +
        `pending; total=${totalMs}ms). Percy is likely retrying internally — ` +
        `letting the test continue so it can exit cleanly before the QUnit ` +
        `timeout. The visual diff for this test may be missing.`,
    );
  } else if (totalMs > 5000) {
    console.log(
      `[percy-snapshot] "${snapshotName}" completed in ${totalMs}ms ` +
        `(settled=${settledMs}ms, fonts=${fontMs}ms, ` +
        `images=${imageMs}ms over ${pendingImageCount} pending, ` +
        `percy=${percyMs}ms)`,
    );
  }
}

function describeSnapshot(
  args: Parameters<typeof originalPercySnapshot>,
): string {
  const first = args[0] as unknown;
  if (first && typeof first === 'object') {
    const test = (
      first as { test?: { module?: { name?: string }; testName?: string } }
    ).test;
    if (test?.module?.name && test?.testName) {
      return `${test.module.name} | ${test.testName}`;
    }
  }
  if (typeof first === 'string') return first;
  return '<unnamed>';
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
