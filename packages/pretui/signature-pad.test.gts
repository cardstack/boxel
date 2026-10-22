// Pretui — runtime proof for signature-pad.gts and the vendored signature_pad.
//
// A canvas component is the worst case for the realm's gate chain: a broken
// engine inside a modifier throws where neither lint nor `boxel realm
// indexing-errors` can see it, and a clean index says nothing at all. So this
// file drives the real thing in a real browser and asserts, separately:
//   1. the PURE MATHS — Point distance/velocity/equality and the variable
//      width Bézier's control-point and length calculations — against values
//      computed by hand, so a bundle rebuild that changes the curve is caught;
//   2. the STROKE-DATA ROUND TRIP — draw → serialize → restore → identical —
//      which is the property the whole output contract rests on;
//   3. the CANVAS TRAPS — HiDPI backing store, redraw-preserving resize, and
//      the timer audit (`throttle: 0` must mean the engine schedules nothing);
//   4. the ACCESSIBILITY FLOOR — the typed alternative as a full peer, the
//      accessible name, the real Clear button, and Tab not being swallowed.
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, settled, fillIn, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';

import SignaturePadEngine, { Bezier, Point } from './sigpad/index.js';
import { SignaturePad, signatureInk } from './components/signature-pad';
import type { SignatureApi, SignatureStroke, SignatureValue } from './components/signature-pad';

/**
 * Test-only: lifts the yielded imperative handle out of the block so a test
 * can call toSVG()/toPNG() the way a real caller would. The side effect lives
 * on a plain (untracked) property, so it cannot cause a backtracking rerender.
 */
class GrabApi extends GlimmerComponent<{
  Args: { api: SignatureApi; into: (api: SignatureApi) => void };
}> {
  get capture(): string {
    this.args.into(this.args.api);
    return '';
  }
  <template>{{this.capture}}</template>
}

class ApiHolder {
  api: SignatureApi | undefined;
  set = (api: SignatureApi): void => {
    this.api = api;
  };
}

/** Drives the container width for the resize test. */
class Frame {
  @tracked width = 420;
  get style(): ReturnType<typeof htmlSafe> {
    return htmlSafe('width:' + this.width + 'px');
  }
}

/** Counts painted pixels — the only honest proof that a redraw happened. */
function inkPixels(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return 0;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! > 0) painted += 1;
  }
  return painted;
}

// NOTE: `time: 0` is a landmine — point.ts does `time || Date.now()`, so a
// zero stamp is silently replaced by the wall clock. Every fixture below uses
// non-zero times, which is also what makes these assertions deterministic.
function stroke(
  points: [number, number, number][],
  penColor = '#14161a',
): SignatureStroke {
  return {
    points: points.map(([x, y, t]) => ({ x, y, pressure: 0.5, time: t })),
    penColor,
    dotSize: 1.6,
    minWidth: 0.7,
    maxWidth: 2.4,
    velocityFilterWeight: 0.7,
    compositeOperation: 'source-over',
  };
}

const FIXTURE: SignatureStroke[] = [
  stroke([
    [10, 40, 1000],
    [30, 20, 1020],
    [50, 60, 1040],
    [70, 30, 1060],
    [90, 55, 1080],
  ]),
  stroke([
    [110, 30, 1200],
    [130, 50, 1220],
    [150, 25, 1240],
    [170, 45, 1260],
  ]),
];

function scratchCanvas(width = 400, height = 200): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

class Recorder {
  @tracked last: SignatureValue | undefined;
  @tracked count = 0;
  record = (value: SignatureValue): void => {
    this.last = value;
    this.count += 1;
  };
}

module('Pretui | SignaturePad', function (hooks) {
  setupCardTest(hooks);

  // ── 1. the pure maths ─────────────────────────────────────────────────

  test('Point distance, velocity and equality are exact', function (assert) {
    const a = new Point(0, 0, 0.5, 1000);
    const b = new Point(3, 4, 0.5, 1500);

    assert.strictEqual(b.distanceTo(a), 5, '3-4-5 triangle');
    assert.strictEqual(a.distanceTo(b), 5, 'distance is symmetric');
    assert.strictEqual(
      b.velocityFrom(a),
      5 / 500,
      'velocity is distance over elapsed time',
    );
    assert.strictEqual(
      a.velocityFrom(a),
      0,
      'zero elapsed time is zero velocity, not a division by zero',
    );
    assert.true(b.equals(new Point(3, 4, 0.5, 1500)));
    assert.false(b.equals(new Point(3, 4, 0.5, 1501)), 'time is part of identity');
    assert.throws(() => new Point(NaN, 0), 'a NaN coordinate is rejected');
  });

  test('the wall-clock fallback fires on a zero timestamp — fixtures must avoid it', function (assert) {
    const stamped = new Point(1, 1, 0.5, 1234);
    const zeroed = new Point(1, 1, 0.5, 0);
    assert.strictEqual(stamped.time, 1234, 'a non-zero stamp is preserved');
    assert.notStrictEqual(
      zeroed.time,
      0,
      'time 0 is falsy and gets replaced by the clock (upstream behaviour)',
    );
  });

  test('Bezier.fromPoints places control points and measures its own length', function (assert) {
    // A straight horizontal run: the control points must stay on the line and
    // the approximated length must equal the exact distance.
    const straight = Bezier.fromPoints(
      [
        new Point(0, 10, 0.5, 1000),
        new Point(10, 10, 0.5, 1010),
        new Point(20, 10, 0.5, 1020),
        new Point(30, 10, 0.5, 1030),
      ],
      { start: 1, end: 2 },
    );
    assert.strictEqual(straight.startPoint.x, 10, 'spans the middle segment');
    assert.strictEqual(straight.endPoint.x, 20);
    assert.strictEqual(straight.control1.y, 10, 'control 1 stays on the line');
    assert.strictEqual(straight.control2.y, 10, 'control 2 stays on the line');
    assert.ok(
      Math.abs(straight.length() - 10) < 1e-6,
      'a straight cubic measures its exact chord (' + straight.length() + ')',
    );
    assert.strictEqual(straight.startWidth, 1, 'the width taper is carried');
    assert.strictEqual(straight.endWidth, 2);

    // A curved run must be longer than its chord, and finite.
    const curved = Bezier.fromPoints(
      [
        new Point(0, 0, 0.5, 1000),
        new Point(10, 0, 0.5, 1010),
        new Point(20, 20, 0.5, 1020),
        new Point(30, 20, 0.5, 1030),
      ],
      { start: 1, end: 1 },
    );
    const chord = curved.endPoint.distanceTo(curved.startPoint);
    assert.ok(curved.length() > chord, 'an arc is longer than its chord');
    assert.ok(Number.isFinite(curved.length()));

    // Coincident points must not divide by zero (the l1 + l2 === 0 branch).
    const degenerate = Bezier.fromPoints(
      [
        new Point(5, 5, 0.5, 1000),
        new Point(5, 5, 0.5, 1010),
        new Point(5, 5, 0.5, 1020),
        new Point(5, 5, 0.5, 1030),
      ],
      { start: 1, end: 1 },
    );
    assert.ok(
      degenerate.length() < 1e-9,
      'a degenerate curve is zero-length to floating-point tolerance (' +
        degenerate.length() +
        ')',
    );
  });

  // ── 2. the stroke-data round trip ─────────────────────────────────────

  test('draw → serialize → restore → identical', function (assert) {
    const pad = new SignaturePadEngine(scratchCanvas(), { throttle: 0 });
    assert.true(pad.isEmpty(), 'a fresh pad is empty');

    pad.fromData(FIXTURE);
    assert.false(pad.isEmpty(), 'restoring data makes it non-empty');

    const roundTripped = pad.toData();
    assert.deepEqual(
      roundTripped,
      FIXTURE,
      'every point, pressure and timestamp survives the round trip',
    );

    // And again, from the round-tripped copy — a second pass must be a fixed
    // point, or repeated save/load would drift.
    const second = new SignaturePadEngine(scratchCanvas(), { throttle: 0 });
    second.fromData(roundTripped);
    assert.deepEqual(second.toData(), FIXTURE, 'the round trip is idempotent');

    pad.clear();
    assert.true(pad.isEmpty(), 'clear empties it');
    assert.deepEqual(pad.toData(), [], 'and drops the data');
    pad.off();
    second.off();
  });

  test('a restored signature exports SVG whose geometry follows the stroke data', function (assert) {
    const pad = new SignaturePadEngine(scratchCanvas(400, 200), {
      throttle: 0,
      // Deliberately different from the fixture's own penColor, to pin down
      // where the exported colour comes from.
      penColor: '#123456',
    });
    pad.fromData(FIXTURE);
    const svg = pad.toSVG({ includeBackgroundColor: false });

    assert.ok(svg.startsWith('<svg'), 'SVG, not a raster data URL');
    assert.ok(
      svg.includes('stroke="#14161a"'),
      'the ink travels WITH the stroke data, not with the live pad option — ' +
        'which is what makes a restored signature reproduce exactly',
    );
    assert.notOk(
      svg.includes('#123456'),
      'the pad-level penColor does not retro-colour restored strokes',
    );
    assert.ok(
      svg.includes('viewBox="0 0 ' + 400 / Math.max(devicePixelRatio, 1)),
      'the viewBox is the CSS-pixel box, derived from the same ratio we scale by',
    );
    assert.ok(
      svg.includes('<path') && svg.includes(' C '),
      'strokes export as cubic Bézier paths, not as a raster',
    );
    pad.off();
  });

  // ── 3. the canvas traps ───────────────────────────────────────────────

  test('the backing store is scaled by devicePixelRatio and the context matches', async function (assert) {
    // Honest limitation: headless Chromium reports devicePixelRatio 1, so
    // this cannot observe a 2x bitmap. What it CAN pin down is the mechanism —
    // that the backing store is the layout size times whatever ratio is in
    // force, and that the 2D context carries the same factor in its transform
    // (a 1x-only implementation would leave the transform at identity while
    // still writing the attributes, and that is the bug this catches).
    await render(<template>
      <SignaturePad @label='Signature' @height={{200}} />
    </template>);

    const canvas = document.querySelector(
      '[data-test-pretui-signature-canvas]',
    ) as HTMLCanvasElement;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);

    assert.ok(canvas.offsetWidth > 1, 'the canvas has a real laid-out size');
    assert.strictEqual(
      canvas.offsetHeight,
      200,
      'and honours @height without depending on a stylesheet',
    );
    assert.strictEqual(
      canvas.width,
      Math.round(canvas.offsetWidth * ratio),
      'backing-store width is the layout width times the pixel ratio',
    );
    assert.strictEqual(
      canvas.height,
      Math.round(canvas.offsetHeight * ratio),
      'backing-store height likewise',
    );

    const transform = canvas.getContext('2d')!.getTransform();
    assert.strictEqual(transform.a, ratio, 'the context is scaled in x');
    assert.strictEqual(transform.d, ratio, 'and in y');

    assert.strictEqual(
      getComputedStyle(canvas).touchAction,
      'none',
      'a finger draws instead of scrolling the page',
    );
  });

  test('a resize preserves the signature instead of wiping it', async function (assert) {
    const frame = new Frame();

    await render(<template>
      <div style={{frame.style}} data-test-frame>
        <SignaturePad
          @label='Signature'
          @defaultStrokes={{FIXTURE}}
          @height={{160}}
        />
      </div>
    </template>);

    const canvas = document.querySelector(
      '[data-test-pretui-signature-canvas]',
    ) as HTMLCanvasElement;
    const widthBefore = canvas.width;
    const inkBefore = inkPixels(canvas);
    assert.ok(widthBefore > 0, 'sized on install');
    assert.ok(
      inkBefore > 0,
      'the restored strokes were actually painted (' + inkBefore + ' px)',
    );

    frame.width = 260;
    await settled();
    // ResizeObserver delivery is asynchronous. Waiting on a second observer
    // registered after the component's yields the same delivery pass, so the
    // component's callback has already run — and it arms no timer of ours.
    await new Promise<void>((resolve) => {
      const observer = new ResizeObserver(() => {
        observer.disconnect();
        resolve();
      });
      observer.observe(canvas);
    });
    await settled();

    assert.notStrictEqual(
      canvas.width,
      widthBefore,
      'the backing store was rewritten, which is what wipes a canvas',
    );
    assert.ok(
      inkPixels(canvas) > 0,
      'and the signature was replayed onto it rather than lost',
    );
    assert
      .dom('[data-test-pretui-signature-pad]')
      .hasAttribute('data-empty', 'false');
  });

  test('the engine schedules no timer and no animation frame', async function (assert) {
    const realTimeout = window.setTimeout;
    const realInterval = window.setInterval;
    const realRaf = window.requestAnimationFrame;
    const scheduled: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- spies must
    // accept the platform's overloaded signatures to stand in for them.
    (window as any).setTimeout = (...args: any[]) => {
      scheduled.push('setTimeout');
      return (realTimeout as any)(...args);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).setInterval = (...args: any[]) => {
      scheduled.push('setInterval');
      return (realInterval as any)(...args);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).requestAnimationFrame = (...args: any[]) => {
      scheduled.push('requestAnimationFrame');
      return (realRaf as any)(...args);
    };

    try {
      const pad = new SignaturePadEngine(scratchCanvas(), { throttle: 0 });
      pad.fromData(FIXTURE);
      pad.toSVG();
      pad.toDataURL('image/png');
      pad.clear();
      pad.off();
    } finally {
      window.setTimeout = realTimeout;
      window.setInterval = realInterval;
      window.requestAnimationFrame = realRaf;
    }

    assert.deepEqual(
      scheduled,
      [],
      'throttle: 0 means the engine owns no handle at all',
    );
  });

  // ── 4. the accessibility floor ────────────────────────────────────────

  test('the canvas has an accessible name that tracks its state, and no tab stop', async function (assert) {
    await render(<template>
      <SignaturePad @label='Contractor signature' @defaultStrokes={{FIXTURE}} />
    </template>);

    assert
      .dom('[data-test-pretui-signature-canvas]')
      .hasAttribute('role', 'img')
      .hasAttribute(
        'aria-label',
        'Contractor signature — drawing area, signature drawn',
      )
      .doesNotHaveAttribute(
        'tabindex',
        'no tabindex, so the canvas can never trap the keyboard',
      );

    await render(<template>
      <SignaturePad @label='Contractor signature' />
    </template>);
    assert
      .dom('[data-test-pretui-signature-canvas]')
      .hasAttribute(
        'aria-label',
        'Contractor signature — drawing area, empty',
        'the empty state is exposed, not implied by a blank picture',
      );
  });

  test('the typed alternative is a full peer of drawing', async function (assert) {
    const state = new Recorder();
    await render(<template>
      <SignaturePad @label='Signature' @onChange={{state.record}} as |sig|>
        <output data-test-out>{{if sig.isEmpty 'empty' 'signed'}}</output>
      </SignaturePad>
    </template>);

    assert.dom('[data-test-pretui-signature-mode-type]').exists();
    await click('[data-test-pretui-signature-mode-type]');

    assert
      .dom('[data-test-pretui-signature-typed]')
      .exists('a real text input, reachable by Tab alone');
    assert
      .dom('label[for]')
      .exists('with a real label element pointing at it');
    assert.dom('[data-test-pretui-signature-canvas]').doesNotExist();

    await fillIn('[data-test-pretui-signature-typed]', 'Ada Lovelace');

    assert.strictEqual(state.last?.mode, 'type');
    assert.strictEqual(state.last?.typedName, 'Ada Lovelace');
    assert.false(state.last?.isEmpty, 'a typed name is a real signature');
    assert.dom('[data-test-out]').hasText('signed', 'the yielded API agrees');
    assert
      .dom('[data-test-pretui-signature-pad]')
      .hasAttribute('data-mode', 'type')
      .hasAttribute('data-empty', 'false');
    assert
      .dom('[data-test-pretui-signature-status]')
      .hasText('Signature captured as typed name.');
  });

  test('a typed signature exports SVG with real, selectable text and alt text', async function (assert) {
    const holder = new ApiHolder();

    await render(<template>
      <SignaturePad
        @label='Signature'
        @defaultMode='type'
        @defaultTypedName='Ada Lovelace'
        @signerName='Ada Lovelace'
        as |sig|
      >
        <GrabApi @api={{sig}} @into={{holder.set}} />
      </SignaturePad>
    </template>);

    const svg = holder.api!.toSVG()!;
    assert.ok(svg.startsWith('<svg'), 'SVG is the preferred output');
    assert.ok(
      svg.includes('<title>Typed signature of Ada Lovelace</title>'),
      'the rendered result carries alt text',
    );
    assert.ok(
      svg.includes('>Ada Lovelace</text>'),
      'the name is real text, not a picture of a word',
    );
    const png = holder.api!.toPNG()!;
    assert.ok(
      png.startsWith('data:image/png;base64,'),
      'PNG is offered where a raster is genuinely wanted',
    );
  });

  test('Clear is a real button, keyboard reachable, and announced as disabled when empty without losing focus', async function (assert) {
    const state = new Recorder();
    await render(<template>
      <SignaturePad
        @label='Signature'
        @defaultStrokes={{FIXTURE}}
        @onChange={{state.record}}
      />
    </template>);

    assert
      .dom('[data-test-pretui-signature-clear]')
      .hasTagName('button')
      .hasAttribute('type', 'button')
      .isNotDisabled();

    let clear = document.querySelector('[data-test-pretui-signature-clear]') as HTMLElement;
    clear.focus();
    await click(clear);

    assert.true(state.last?.isEmpty, 'clearing reports an empty value');
    assert.deepEqual(state.last?.strokes, [], 'and drops the strokes');
    assert
      .dom('[data-test-pretui-signature-clear]')
      .hasAttribute('aria-disabled', 'true', 'nothing left to clear')
      .isNotDisabled('but it stays focusable');
    assert.strictEqual(document.activeElement, clear, 'so focus stays where it was');
    let changes = state.count;
    await click(clear);
    assert.strictEqual(state.count, changes, 'and a second press does nothing');
    assert
      .dom('[data-test-pretui-signature-pad]')
      .hasAttribute('data-empty', 'true');
    assert
      .dom('[data-test-pretui-signature-status]')
      .hasText('No signature yet.');
  });

  test('@onChange emits stroke data, so the caller decides what to persist', async function (assert) {
    const state = new Recorder();
    await render(<template>
      <SignaturePad
        @label='Signature'
        @defaultStrokes={{FIXTURE}}
        @onChange={{state.record}}
      />
    </template>);

    await click('[data-test-pretui-signature-mode-type]');
    await click('[data-test-pretui-signature-mode-draw]');

    assert.strictEqual(state.last?.mode, 'draw');
    assert.deepEqual(
      state.last?.strokes,
      FIXTURE,
      'the payload is the point arrays, not an image',
    );
  });

  test('the typed alternative can be suppressed, but only deliberately', async function (assert) {
    await render(<template>
      <SignaturePad @label='Signature' @hideTypedAlternative={{true}} />
    </template>);
    assert.dom('[data-test-pretui-signature-modes]').doesNotExist();
    assert.dom('[data-test-pretui-signature-canvas]').exists();
  });

  test('signatureInk refuses anything that is not an unambiguous colour', function (assert) {
    assert.strictEqual(signatureInk('#123'), '#123');
    assert.strictEqual(signatureInk('#AABBCC'), '#aabbcc');
    assert.strictEqual(signatureInk('rgb(20, 22, 26)'), 'rgb(20, 22, 26)');
    for (const rejected of [
      'var(--foreground)',
      'red',
      'url(x)',
      '#000; background: url(x)',
      undefined,
    ]) {
      assert.strictEqual(
        signatureInk(rejected as string | undefined),
        undefined,
        JSON.stringify(rejected) + ' is refused',
      );
    }
  });
});
