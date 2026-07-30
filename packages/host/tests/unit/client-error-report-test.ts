import { module, test } from 'qunit';

import {
  reportFromErrorEvent,
  reportFromRejectionEvent,
  type ErrorReport,
} from '@cardstack/host/lib/client-error-report';

// Building an ErrorEvent / PromiseRejectionEvent without dispatching it: these
// are pure functions over the event object, so nothing here needs a window
// listener, a running instrument, or a realm.
function errorEvent(
  error: unknown,
  location: { filename?: string; lineno?: number; colno?: number } = {},
): ErrorEvent {
  let message = (error as { message?: unknown })?.message;
  return new ErrorEvent('error', {
    message: `Uncaught ${typeof message === 'string' ? message : String(error)}`,
    filename: location.filename ?? '',
    lineno: location.lineno ?? 0,
    colno: location.colno ?? 0,
    error,
  });
}

function rejectionEvent(reason: unknown): PromiseRejectionEvent {
  let promise = Promise.reject(reason);
  promise.catch(() => {});
  return new PromiseRejectionEvent('unhandledrejection', { promise, reason });
}

// An error carrying a stack this test wrote, so the parse and the bounds are
// asserted against known input rather than whatever the engine and build produce.
function errorWithStack(message: string, frames: string[]): Error {
  let error = new Error(message);
  error.stack = [`Error: ${message}`, ...frames].join('\n');
  return error;
}

function frames(count: number, width = 1): string[] {
  return Array.from(
    { length: count },
    (_, i) =>
      `    at frame${i} (https://realm.example/my-realm/${'d'.repeat(width)}.gts:${i + 1}:1)`,
  );
}

function reportOf(message: string, stackFrames: string[]): ErrorReport {
  return reportFromRejectionEvent(
    rejectionEvent(errorWithStack(message, stackFrames)),
  );
}

module('Unit | lib | client-error-report', function () {
  module('the throw site', function () {
    // Frames are engine- and bundler-specific in shape. Which delimiter splits
    // one is decided by the engine that wrote it, not by which character appears
    // first: a `@` inside a V8 location is part of the url, and a `(` can be too.
    let shapes: Array<[string, string, string, number, number]> = [
      [
        '    at compute (https://realm.example/my-realm/person.gts:12:34)',
        'compute',
        'https://realm.example/my-realm/person.gts',
        12,
        34,
      ],
      [
        '    at compute (webpack://app/(chunk%20a)/person.gts:12:34)',
        'compute',
        'webpack://app/(chunk%20a)/person.gts',
        12,
        34,
      ],
      [
        'compute@https://realm.example/my-realm/@cardstack/person.gts:12:34',
        'compute',
        'https://realm.example/my-realm/@cardstack/person.gts',
        12,
        34,
      ],
      [
        '    at https://realm.example/my-realm/person.gts:12:34',
        '',
        'https://realm.example/my-realm/person.gts',
        12,
        34,
      ],
      [
        '    at https://realm.example/assets/@cardstack/boxel-ui.js:1:2',
        '',
        'https://realm.example/assets/@cardstack/boxel-ui.js',
        1,
        2,
      ],
      [
        '@https://realm.example/my-realm/person.gts:12:34',
        '',
        'https://realm.example/my-realm/person.gts',
        12,
        34,
      ],
      [
        '    at async Store.reestablish (https://realm.example/my-realm/store.gts:7:9)',
        'async Store.reestablish',
        'https://realm.example/my-realm/store.gts',
        7,
        9,
      ],
    ];

    shapes.forEach(([frame, fn, url, line, col]) => {
      test(`parses ${frame.trim()}`, function (assert) {
        let report = reportOf('plain message', [frame]);
        assert.strictEqual(report.top_frame_function, fn, 'function name');
        assert.strictEqual(report.source_url, url, 'url');
        assert.strictEqual(report.line, line, 'line');
        assert.strictEqual(report.col, col, 'col');
      });
    });

    test('a message shaped like a frame is not mistaken for one', function (assert) {
      // The engine opens a stack with the message, which can carry a location of
      // its own. The throw site is the frame below it.
      let report = reportOf(
        'unable to load (https://realm.example/my-realm/other.gts:99:99)',
        ['    at compute (https://realm.example/my-realm/person.gts:12:34)'],
      );
      assert.strictEqual(report.top_frame_function, 'compute');
      assert.strictEqual(
        report.source_url,
        'https://realm.example/my-realm/person.gts',
      );
      assert.strictEqual(report.line, 12);
    });

    test('a location on the event wins over the stack', function (assert) {
      let report = reportFromErrorEvent(
        errorEvent(errorWithStack('boom', frames(1)), {
          filename: 'https://realm.example/my-realm/thrower.gts',
          lineno: 42,
          colno: 7,
        }),
      );
      assert.strictEqual(
        report.source_url,
        'https://realm.example/my-realm/thrower.gts',
      );
      assert.strictEqual(report.line, 42);
      assert.strictEqual(report.col, 7);
    });
  });

  module('the stack', function () {
    test('carries the frames verbatim, trimmed', function (assert) {
      let report = reportOf('rejected', [
        '    at reestablish (https://realm.example/my-realm/store.gts:9:15)',
        '    at caller (https://realm.example/my-realm/file.gts:3:1)',
      ]);
      assert.strictEqual(
        report.stack,
        'Error: rejected\n' +
          'at reestablish (https://realm.example/my-realm/store.gts:9:15)\n' +
          'at caller (https://realm.example/my-realm/file.gts:3:1)',
      );
    });

    test('is bounded by frame count, keeping the top', function (assert) {
      let lines = reportOf('deep', frames(40)).stack.split('\n');
      assert.strictEqual(lines.length, 17, '16 frames, plus the message');
      assert.strictEqual(lines[0], 'Error: deep');
      assert.strictEqual(
        lines[1],
        'at frame0 (https://realm.example/my-realm/d.gts:1:1)',
        'the throw site is the first frame kept',
      );
      assert.notOk(
        lines.some((line) => line.includes('frame20')),
        'the deep tail is what gets dropped',
      );
    });

    test('is bounded by character budget, still keeping the top', function (assert) {
      let stack = reportOf('wide', frames(40, 400)).stack;
      assert.true(stack.length <= 2000);
      assert.true(stack.startsWith('Error: wide\nat frame0 '));
    });

    // The message the engine writes above the frames is unbounded and can span
    // lines. Bounding it separately is what keeps it from taking the whole
    // allowance — dropping deep frames cannot shrink a message, so a header that
    // competes with the frames wins and the stack ships with none.
    let oversized: Array<[string, string]> = [
      ['plain', `failed to save: ${'x'.repeat(3000)}`],
      [
        'naming a scoped module',
        `cannot load @cardstack/boxel-ui/components: ${'x'.repeat(3000)}`,
      ],
      ['naming an account', `@user:localhost denied: ${'x'.repeat(3000)}`],
      [
        'spanning several lines',
        `failed to save\n${'y'.repeat(1200)}\n${'z'.repeat(1200)}`,
      ],
    ];

    oversized.forEach(([label, message]) => {
      test(`an oversized message ${label} keeps the frames`, function (assert) {
        let report = reportOf(message, frames(3));
        assert.true(report.stack.length <= 2000, 'within budget');
        assert.strictEqual(
          report.stack.split('\n').filter((l) => l.startsWith('at frame'))
            .length,
          3,
          'every frame survives',
        );
        assert.strictEqual(report.top_frame_function, 'frame0');
      });
    });

    // A message can be shaped exactly like a frame, down to a trailing
    // `url:line:col`, so which lines are the message is a guess. These are the
    // shapes that fool it, and they must still yield the real throw site — both
    // the frames in the stack and the location fields derived from them.
    let disguised: Array<[string, string]> = [
      [
        'a scoped module and a trailing location',
        `cannot load @cardstack/boxel-ui: ${'x'.repeat(3000)} (https://realm.example/my-realm/other.gts:14:3)`,
      ],
      [
        'an account and a trailing location',
        `@user:localhost denied: ${'x'.repeat(3000)} (https://realm.example/my-realm/other.gts:14:3)`,
      ],
      [
        'a bare trailing location',
        `cannot load @cardstack/x: ${'x'.repeat(3000)} https://realm.example/other.gts:14:3`,
      ],
    ];

    disguised.forEach(([label, message]) => {
      test(`a message with ${label} does not displace the frames`, function (assert) {
        let report = reportOf(message, frames(3));
        assert.strictEqual(
          report.stack.split('\n').filter((l) => l.startsWith('at frame'))
            .length,
          3,
          'every frame survives',
        );
        assert.strictEqual(
          report.top_frame_function,
          'frame0',
          'and the throw site is the frame, not the message',
        );
        assert.strictEqual(
          report.line,
          1,
          'the location comes from the frame too',
        );
      });
    });

    test('one enormous frame still leaves room for the next', function (assert) {
      // Capping each line is what guarantees this: no single line can spend the
      // whole budget, whichever line it is.
      let report = reportOf('x', [
        `    at huge (https://realm.example/${'d'.repeat(3000)}.js:1:1)`,
        '    at real (https://realm.example/my-realm/real.gts:2:2)',
      ]);
      assert.true(report.stack.length <= 2000);
      assert.true(
        report.stack.split('\n').length >= 2,
        'the frame below the enormous one survives',
      );
    });

    test('a frame contributes bounded fields', function (assert) {
      // They land in dashboard labels, so an unbounded value there is a 3KB label.
      let report = reportOf('x', [
        `    at ${'f'.repeat(900)} (https://realm.example/${'u'.repeat(900)}.js:1:1)`,
      ]);
      assert.true(report.top_frame_function.length <= 300);
      assert.true(report.source_url.length <= 300);
    });

    test('a stack of frames with no message keeps them all', function (assert) {
      // SpiderMonkey and JSC write no message line, so there is no header.
      let error = new Error('firefox shaped');
      error.stack = [
        'computeTitle@https://realm.example/my-realm/person.gts:12:34',
        'render@https://realm.example/my-realm/card.gts:3:1',
      ].join('\n');
      let report = reportFromRejectionEvent(rejectionEvent(error));
      assert.strictEqual(
        report.stack,
        'computeTitle@https://realm.example/my-realm/person.gts:12:34\n' +
          'render@https://realm.example/my-realm/card.gts:3:1',
      );
      assert.strictEqual(report.top_frame_function, 'computeTitle');
    });

    test('is empty when the throw carried nothing to take one from', function (assert) {
      let fromString = reportFromRejectionEvent(rejectionEvent('plain reason'));
      assert.strictEqual(fromString.message, 'plain reason');
      assert.strictEqual(fromString.stack, '', 'no stack is invented');
      assert.strictEqual(fromString.top_frame_function, '');
      assert.strictEqual(fromString.source_url, '');

      let fromShaped = reportFromRejectionEvent(
        rejectionEvent({ message: 'error shaped, no stack' }),
      );
      assert.strictEqual(fromShaped.message, 'error shaped, no stack');
      assert.strictEqual(fromShaped.stack, '');
    });
  });

  module('the message', function () {
    test('names the error class, which message alone never carries', function (assert) {
      let report = reportFromRejectionEvent(
        rejectionEvent(new TypeError('cannot read x')),
      );
      assert.strictEqual(report.message, 'TypeError: cannot read x');
    });

    test('takes no class name off a merely error-shaped object', function (assert) {
      // `name` is an ordinary field on a card instance, so prefixing with it
      // would read as a class that does not exist.
      let report = reportFromRejectionEvent(
        rejectionEvent({ name: 'Hassan', message: 'validation failed' }),
      );
      assert.strictEqual(report.message, 'validation failed');
    });

    test('survives a reason that cannot be converted to a string', function (assert) {
      let hostile = {
        get message() {
          return undefined as unknown as string;
        },
        toString() {
          throw new Error('nope');
        },
      };
      let report = reportFromRejectionEvent(rejectionEvent(hostile));
      assert.strictEqual(
        report.message,
        '',
        'reported empty rather than thrown',
      );
    });

    test('reports a cross-origin script error rather than dropping it', function (assert) {
      let report = reportFromErrorEvent(
        new ErrorEvent('error', { message: 'Script error.' }),
      );
      assert.strictEqual(report.message, 'Script error.');
      assert.strictEqual(report.stack, '');
    });

    test('is bounded, and says when it was cut', function (assert) {
      let report = reportOf('x'.repeat(4000), frames(1));
      assert.strictEqual(report.message.length, 300, 'the marker counts');
      assert.true(report.message.endsWith('…'));
    });
  });

  module('the grouping key', function () {
    test('collapses the ids a message varies by', function (assert) {
      let base = 'unable to fetch https://realm.example/my-realm/Person/';
      let one = reportOf(`${base}abc123: 404`, frames(2));
      let two = reportOf(`${base}def456: 404`, frames(2));
      assert.strictEqual(one.message_key, two.message_key, 'one key');
      assert.strictEqual(
        one.message_key,
        'Error: unable to fetch https://realm.example/my-realm/Person/*: 404',
        'the id collapses; the status code is short enough to survive',
      );
      assert.strictEqual(
        one.signature,
        two.signature,
        'so repeats of it coalesce',
      );
    });

    test('keeps a short or digit-free id distinct', function (assert) {
      // Nothing separates those from an ordinary word, so the key is a grouping
      // aid rather than a guarantee of one row per failure.
      let one = reportOf('missing card Person/abc', frames(2));
      let two = reportOf('missing card Person/xyz', frames(2));
      assert.notStrictEqual(one.message_key, two.message_key);
    });

    test('keeps two long messages sharing a prefix distinct', function (assert) {
      let prefix = `failed to save document ${'q'.repeat(400)}`;
      let one = reportOf(`${prefix} cause: network`, frames(2));
      let two = reportOf(`${prefix} cause: conflict`, frames(2));
      assert.notStrictEqual(
        one.message_key,
        two.message_key,
        'the digest tail distinguishes them past the key budget',
      );
      assert.strictEqual(
        one.message_key,
        reportOf(`${prefix} cause: network`, frames(2)).message_key,
        'and the same message always yields the same key',
      );
    });

    test('is bounded and single-line, being read in a table cell', function (assert) {
      let report = reportOf('failed\n  line two\n  line three', frames(1));
      assert.notOk(report.message_key.includes('\n'));
      assert.true(
        reportOf('z'.repeat(400), frames(1)).message_key.length <= 160,
      );
    });

    test('coalesces repeats of an error whose stack names no frame', function (assert) {
      // `at Array.forEach (<anonymous>)` parses no location, so the signature has
      // no throw site to include. Falling back to the stack's raw first line
      // would put the un-normalized message back in — carrying the very ids the
      // key exists to collapse — and repeats would stop coalescing.
      let stack = [
        '    at Array.forEach (<anonymous>)',
        '    at new Promise (<anonymous>)',
      ];
      let one = reportOf('cannot render Person/abc1234', stack);
      let two = reportOf('cannot render Person/xyz9876', stack);
      assert.strictEqual(one.message_key, two.message_key, 'one key');
      assert.strictEqual(
        one.signature,
        two.signature,
        'and one signature, so the repeats coalesce',
      );
    });

    test('normalizing is bounded, so message length cannot cost the main thread', function (assert) {
      // Message content is entirely data-controlled and the id scan is
      // superlinear over a long hyphenated run, which would otherwise be paid
      // once per occurrence inside the error handler.
      let start = performance.now();
      reportOf('a-'.repeat(32000), frames(1));
      assert.true(
        performance.now() - start < 200,
        'a 64KB hyphenated message keys in well under the wedge threshold',
      );
    });

    test('separates the two channels', function (assert) {
      let thrown = errorWithStack('same text', frames(1));
      let asError = reportFromErrorEvent(errorEvent(thrown));
      let asRejection = reportFromRejectionEvent(rejectionEvent(thrown));
      assert.strictEqual(asError.message_key, asRejection.message_key);
      assert.notStrictEqual(
        asError.signature,
        asRejection.signature,
        'an uncaught throw and a rejection of the same error are not one group',
      );
    });
  });
});
