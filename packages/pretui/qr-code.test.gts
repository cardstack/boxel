// Pretui — runtime proof for qr-code.gts and the vendored qrcode encoder.
//
// A clean index proves a module evaluates; it proves nothing about what the
// template did, and for an encoder it proves nothing about whether the bits
// are right. So this file asserts three separate things:
//   1. the ENCODER, against the standard worked example (a golden matrix
//      pinned here, so a future rebuild of ./qrcode/index.js cannot drift
//      silently) plus the structural invariants any conforming symbol has;
//   2. the PURE HELPERS — path emission, colour parsing, contrast, href
//      safety — directly, without a renderer;
//   3. the COMPONENT, in a real browser render: quiet zone, error correction,
//      the contrast refusal, and the value-as-text/link requirement.
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';

import { create as createQr } from './qrcode/index.js';
import { QR_MIN_CONTRAST, QR_MIN_QUIET_ZONE, QrCode, qrContrastRatio, qrHexColor, qrLuminance, qrPathData, qrSafeHref } from './components/qr-code';
import type { QrRenderInfo } from './components/qr-code';

interface Modules {
  size: number;
  get(row: number, col: number): boolean;
}

// The standard worked example: 'HELLO WORLD' encoded alphanumeric at
// version 1, error-correction level Q, mask pattern 6. Published in every
// QR tutorial that walks the algorithm by hand, which is what makes it a
// vector rather than a snapshot of our own output.
const HELLO_WORLD_V1Q = [
  '#######....#..#######',
  '#.....#.##..#.#.....#',
  '#.###.#..#.##.#.###.#',
  '#.###.#.#####.#.###.#',
  '#.###.#.##.#..#.###.#',
  '#.....#..#..#.#.....#',
  '#######.#.#.#.#######',
  '........##.##........',
  '.#.####.##..###.##.#.',
  '#.####.#....####.###.',
  '..#.#.##...#..##.....',
  '#.##.#...#.##...##...',
  '##.########.###.#####',
  '........#...#..#.#...',
  '#######..##..##..####',
  '#.....#.#.#..#..#.###',
  '#.###.#.##.#..#...###',
  '#.###.#.#.###...#.#..',
  '#.###.#..#....#....##',
  '#.....#.###..###..##.',
  '#######..#.#.......#.',
];

function renderMatrix(modules: Modules): string[] {
  const rows: string[] = [];
  for (let r = 0; r < modules.size; r++) {
    let row = '';
    for (let c = 0; c < modules.size; c++) {
      row += modules.get(r, c) ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

class Recorder {
  @tracked value = 'https://boxel.ai';
  @tracked last: QrRenderInfo | undefined;
  record = (info: QrRenderInfo): void => {
    this.last = info;
  };
}

module('Pretui | QrCode', function (hooks) {
  setupCardTest(hooks);

  // ── 1. the encoder ────────────────────────────────────────────────────

  test('encodes the standard HELLO WORLD v1-Q vector exactly', function (assert) {
    const symbol = createQr('HELLO WORLD', {
      errorCorrectionLevel: 'Q',
      version: 1,
    }) as { modules: Modules; version: number; maskPattern: number };

    assert.strictEqual(symbol.version, 1, 'version 1');
    assert.strictEqual(symbol.modules.size, 21, '21 x 21 modules');
    assert.strictEqual(symbol.maskPattern, 6, 'mask pattern 6');
    assert.deepEqual(
      renderMatrix(symbol.modules),
      HELLO_WORLD_V1Q,
      'every module matches the published matrix',
    );
  });

  test('every symbol carries the structural invariants a scanner looks for', function (assert) {
    const finder = [
      '1111111',
      '1000001',
      '1011101',
      '1011101',
      '1011101',
      '1000001',
      '1111111',
    ].join('/');

    for (const [data, ecl] of [
      ['https://boxel.ai', 'M'],
      ['12345678901234567890', 'L'],
      ['Hello, World!', 'Q'],
      ['x'.repeat(300), 'H'],
    ] as const) {
      const symbol = createQr(data, { errorCorrectionLevel: ecl }) as {
        modules: Modules;
        version: number;
      };
      const m = symbol.modules;
      const n = m.size;
      const at = (r: number, c: number): string => (m.get(r, c) ? '1' : '0');
      const block = (r0: number, c0: number): string => {
        const rows: string[] = [];
        for (let r = 0; r < 7; r++) {
          let row = '';
          for (let c = 0; c < 7; c++) row += at(r0 + r, c0 + c);
          rows.push(row);
        }
        return rows.join('/');
      };

      assert.strictEqual(block(0, 0), finder, data + ': top-left finder');
      assert.strictEqual(block(0, n - 7), finder, data + ': top-right finder');
      assert.strictEqual(block(n - 7, 0), finder, data + ': bottom-left finder');
      assert.strictEqual(
        at(4 * symbol.version + 9, 8),
        '1',
        data + ': dark module at (4V+9, 8)',
      );
      // Timing pattern: alternating modules along row 6 between the finders.
      let timing = '';
      for (let c = 8; c < n - 8; c++) timing += at(6, c);
      assert.ok(
        /^(10)*1?$/.test(timing),
        data + ': row-6 timing pattern alternates (' + timing + ')',
      );
      assert.strictEqual(n, symbol.version * 4 + 17, data + ': size = 4V + 17');
    }
  });

  test('a higher error-correction level costs capacity', function (assert) {
    const payload = 'x'.repeat(120);
    const sizeAt = (ecl: 'L' | 'M' | 'Q' | 'H'): number =>
      (createQr(payload, { errorCorrectionLevel: ecl }) as { version: number })
        .version;
    assert.ok(sizeAt('L') <= sizeAt('M'), 'L fits in no more than M');
    assert.ok(sizeAt('M') <= sizeAt('Q'), 'M fits in no more than Q');
    assert.ok(sizeAt('Q') <= sizeAt('H'), 'Q fits in no more than H');
    assert.ok(sizeAt('H') > sizeAt('L'), 'H genuinely costs something');
  });

  test('overflow and empty input throw rather than producing a wrong symbol', function (assert) {
    assert.throws(
      () => createQr('', { errorCorrectionLevel: 'M' }),
      'empty string is not encodable',
    );
    assert.throws(
      () => createQr('x'.repeat(5000), { errorCorrectionLevel: 'H' }),
      'overflow raises instead of truncating',
    );
  });

  // ── 2. the pure helpers ───────────────────────────────────────────────

  test('qrPathData emits merged horizontal runs offset by the quiet zone', function (assert) {
    // . # #
    // # . #
    // # # #
    const grid = [
      [false, true, true],
      [true, false, true],
      [true, true, true],
    ];
    const modules: Modules = {
      size: 3,
      get: (r, c) => grid[r]![c]!,
    };
    assert.strictEqual(
      qrPathData(modules, 0),
      'M1 0h2v1h-2zM0 1h1v1h-1zM2 1h1v1h-1zM0 2h3v1h-3z',
      'runs merge and each is a closed unit-height rect',
    );
    assert.strictEqual(
      qrPathData(modules, 4),
      'M5 4h2v1h-2zM4 5h1v1h-1zM6 5h1v1h-1zM4 6h3v1h-3z',
      'the quiet zone shifts every subpath by exactly its width',
    );
    assert.strictEqual(
      qrPathData({ size: 2, get: () => false }, 0),
      '',
      'an all-light matrix emits no path',
    );
  });

  test('qrHexColor accepts only opaque hex, and expands the short form', function (assert) {
    assert.strictEqual(qrHexColor('#000'), '#000000');
    assert.strictEqual(qrHexColor('#AbC'), '#aabbcc');
    assert.strictEqual(qrHexColor('  #123456 '), '#123456');
    for (const rejected of [
      'var(--foreground)',
      'rgb(0 0 0)',
      'color-mix(in oklch, red 50%, blue)',
      'black',
      '#00000080',
      '#12345',
      '',
      undefined,
    ]) {
      assert.strictEqual(
        qrHexColor(rejected as string | undefined),
        undefined,
        JSON.stringify(rejected) + ' is refused',
      );
    }
  });

  test('luminance and contrast match the WCAG definitions', function (assert) {
    assert.strictEqual(qrLuminance('#000000'), 0, 'black is 0');
    assert.strictEqual(qrLuminance('#ffffff'), 1, 'white is 1');
    assert.strictEqual(
      Math.round(qrContrastRatio('#000000', '#ffffff') * 100) / 100,
      21,
      'black on white is 21:1',
    );
    assert.strictEqual(
      qrContrastRatio('#123456', '#123456'),
      1,
      'a colour against itself is 1:1',
    );
  });

  test('qrSafeHref admits http(s) only', function (assert) {
    assert.strictEqual(
      qrSafeHref('https://boxel.ai/x?y=1'),
      'https://boxel.ai/x?y=1',
    );
    assert.strictEqual(qrSafeHref('http://example.com/'), 'http://example.com/');
    for (const rejected of [
      'javascript:alert(1)',
      'data:text/html,<script></script>',
      'mailto:a@b.c',
      'ftp://example.com',
      'BEGIN:VCARD',
      '',
    ]) {
      assert.strictEqual(
        qrSafeHref(rejected),
        undefined,
        JSON.stringify(rejected) + ' never becomes an anchor',
      );
    }
  });

  // ── 3. the component, in a real render ────────────────────────────────

  test('renders one svg with one path, and reports what it drew', async function (assert) {
    const state = new Recorder();
    await render(<template>
      <QrCode @value={{state.value}} @onRender={{state.record}} />
    </template>);

    assert.dom('[data-test-pretui-qr-svg]').exists('the symbol renders');
    assert
      .dom('[data-test-pretui-qr-code]')
      .hasAttribute('data-state', 'ok')
      .hasAttribute('data-ecl', 'M', 'level M by default');

    const path = document
      .querySelector('[data-test-pretui-qr-svg] path')
      ?.getAttribute('d');
    assert.ok(path && path.length > 40, 'the path carries the module runs');

    assert.strictEqual(state.last?.ok, true, '@onRender reported success');
    assert.strictEqual(state.last?.errorCorrection, 'M');
    assert.strictEqual(state.last?.contrastRejected, false);
    assert.strictEqual(state.last?.foreground, '#000000');
  });

  test('the quiet zone lives in the viewBox and cannot go below the spec minimum', async function (assert) {
    await render(<template>
      <QrCode @value='https://boxel.ai' @margin={{0}} />
    </template>);

    const svg = document.querySelector('[data-test-pretui-qr-svg]')!;
    const box = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const modules = Number(
      document
        .querySelector('[data-test-pretui-qr-code]')!
        .getAttribute('data-quiet-zone'),
    );
    assert.strictEqual(
      modules,
      QR_MIN_QUIET_ZONE,
      'margin 0 is clamped up to the spec minimum',
    );
    // 25 modules for this payload at level M, plus 4 on each side.
    assert.strictEqual(
      box[2],
      25 + QR_MIN_QUIET_ZONE * 2,
      'the viewBox, not CSS padding, carries the quiet zone',
    );
    assert.strictEqual(box[2], box[3], 'the symbol is square');
  });

  test('a caller colour pair that would not scan is refused, loudly', async function (assert) {
    // Two mid-greys: ~1.5:1, well under the floor.
    await render(<template>
      <QrCode
        @value='https://boxel.ai'
        @foreground='#777777'
        @background='#999999'
      />
    </template>);

    assert
      .dom('[data-test-pretui-qr-code]')
      .hasAttribute('data-contrast', 'rejected');
    assert
      .dom('[data-test-pretui-qr-contrast-warning]')
      .exists('the refusal is visible, not silent');
    assert
      .dom('[data-test-pretui-qr-svg] path')
      .hasAttribute('fill', '#000000', 'falls back to a symbol that scans');
    assert.ok(
      qrContrastRatio('#777777', '#999999') < QR_MIN_CONTRAST,
      'the fixture really is under the floor',
    );
  });

  test('light-on-dark is refused even at high contrast', async function (assert) {
    await render(<template>
      <QrCode
        @value='https://boxel.ai'
        @foreground='#ffffff'
        @background='#000000'
      />
    </template>);
    assert
      .dom('[data-test-pretui-qr-code]')
      .hasAttribute(
        'data-contrast',
        'rejected',
        '21:1 inverted is still unscannable',
      );
  });

  test('a token colour is refused because its luminance is unknowable', async function (assert) {
    await render(<template>
      <QrCode @value='https://boxel.ai' @foreground='var(--foreground)' />
    </template>);
    assert
      .dom('[data-test-pretui-qr-code]')
      .hasAttribute('data-contrast', 'rejected');
  });

  test('a dark-on-light pair above the floor is honoured', async function (assert) {
    await render(<template>
      <QrCode
        @value='https://boxel.ai'
        @foreground='#0b1b3a'
        @background='#fdfdf7'
      />
    </template>);
    assert.dom('[data-test-pretui-qr-code]').doesNotHaveAttribute('data-contrast');
    assert
      .dom('[data-test-pretui-qr-svg] path')
      .hasAttribute('fill', '#0b1b3a');
  });

  test('the encoded value is always reachable as text or a link', async function (assert) {
    await render(<template>
      <QrCode @value='https://boxel.ai/tickets/42' />
    </template>);
    assert
      .dom('a[data-test-pretui-qr-value]')
      .hasAttribute('href', 'https://boxel.ai/tickets/42')
      .hasText('https://boxel.ai/tickets/42');

    await render(<template><QrCode @value='TESSAR-2026-0041' /></template>);
    assert
      .dom('code[data-test-pretui-qr-value]')
      .hasText('TESSAR-2026-0041', 'a non-URL stays selectable text');

    await render(<template>
      <QrCode @value='TESSAR-2026-0041' @valueDisplay='none' />
    </template>);
    assert
      .dom('[data-test-pretui-qr-value]')
      .exists('hidden means visually hidden, never absent')
      .hasClass('pretui-sr');
  });

  test('the symbol carries an accessible name', async function (assert) {
    await render(<template>
      <QrCode @value='https://boxel.ai' @label='Check-in code for Tessar' />
    </template>);
    assert
      .dom('[data-test-pretui-qr-svg]')
      .hasAttribute('role', 'img')
      .hasAttribute('aria-label', 'Check-in code for Tessar');
  });

  test('an overlay forces level H and renders only when declared', async function (assert) {
    await render(<template>
      <QrCode @value='https://boxel.ai' @errorCorrection='L' @overlay={{true}}>
        <:overlay><span>M</span></:overlay>
      </QrCode>
    </template>);
    assert
      .dom('[data-test-pretui-qr-code]')
      .hasAttribute('data-ecl', 'H', 'occlusion overrides the requested level');
    assert
      .dom('[data-test-pretui-qr-overlay]')
      .exists()
      .hasAttribute('aria-hidden', 'true');

    await render(<template>
      <QrCode @value='https://boxel.ai' @errorCorrection='L'>
        <:overlay><span>M</span></:overlay>
      </QrCode>
    </template>);
    assert
      .dom('[data-test-pretui-qr-overlay]')
      .doesNotExist('without @overlay the mark vanishes visibly, not silently');
    assert.dom('[data-test-pretui-qr-code]').hasAttribute('data-ecl', 'L');
  });

  test('overflow renders an error state instead of a broken symbol', async function (assert) {
    const payload = 'x'.repeat(5000);
    await render(<template><QrCode @value={{payload}} /></template>);
    assert.dom('[data-test-pretui-qr-code]').hasAttribute('data-state', 'error');
    assert.dom('[data-test-pretui-qr-error]').exists();
    assert.dom('[data-test-pretui-qr-svg]').doesNotExist();
  });

  test('an empty value is a resting state, not an error message about nothing', async function (assert) {
    await render(<template><QrCode /></template>);
    assert.dom('[data-test-pretui-qr-error]').hasText('No value to encode.');
    assert.dom('[data-test-pretui-qr-value]').doesNotExist();
  });

  test('re-encodes when the value changes', async function (assert) {
    const state = new Recorder();
    await render(<template>
      <QrCode @value={{state.value}} @onRender={{state.record}} />
    </template>);
    const first = document
      .querySelector('[data-test-pretui-qr-svg] path')!
      .getAttribute('d');

    state.value = 'https://boxel.ai/somewhere/else';
    await settled();
    const second = document
      .querySelector('[data-test-pretui-qr-svg] path')!
      .getAttribute('d');

    assert.notStrictEqual(first, second, 'the symbol actually changed');
    assert.strictEqual(state.last?.ok, true, '@onRender fired again');
  });

  test('no raw colour string can reach a style declaration', async function (assert) {
    await render(<template>
      <QrCode @value='https://boxel.ai' @foreground='#000;}body{display:none' />
    </template>);
    const root = document.querySelector('[data-test-pretui-qr-code]')!;
    assert.strictEqual(
      root.getAttribute('style'),
      '--pretui-qr-size:180px',
      'the only inline style is a clamped integer',
    );
    assert
      .dom('[data-test-pretui-qr-code]')
      .hasAttribute('data-contrast', 'rejected');
  });
});
