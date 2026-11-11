import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as LogLinesModule from '@cardstack/base/log-lines';

// A log's typed lines (`linksTo(JSONLFile, { of: LineType })`): `what` is
// checked against the line type and normalized by each field's family
// before `record` sends it (`packages/base/log-lines.ts`). The check is the
// operations client's; the server does not repeat it.

let loader: Loader;
let cardApi: typeof import('@cardstack/base/card-api');
let lines: typeof LogLinesModule;

module('Unit | log lines', function (hooks) {
  setupRenderingTest(hooks);
  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });
  hooks.beforeEach(async function () {
    cardApi = await loader.import('@cardstack/base/card-api');
    lines = await loader.import('@cardstack/base/log-lines');
  });

  async function lineType() {
    let { FieldDef, field, contains, containsMany, linksTo, CardDef } = cardApi;
    let { default: StringField } = await loader.import<
      typeof import('@cardstack/base/string')
    >('@cardstack/base/string');
    let { default: NumberField } = await loader.import<
      typeof import('@cardstack/base/number')
    >('@cardstack/base/number');
    let { default: BooleanField } = await loader.import<
      typeof import('@cardstack/base/boolean')
    >('@cardstack/base/boolean');
    let { default: DateField } = await loader.import<
      typeof import('@cardstack/base/date')
    >('@cardstack/base/date');
    let { default: DateTimeField } = await loader.import<
      typeof import('@cardstack/base/datetime')
    >('@cardstack/base/datetime');
    let { default: BigIntegerField } = await loader.import<
      typeof import('@cardstack/base/big-integer')
    >('@cardstack/base/big-integer');
    class Place extends FieldDef {
      @field city = contains(StringField);
    }
    class Post extends CardDef {}
    class Reaction extends FieldDef {
      @field action = contains(StringField);
      @field dwellMs = contains(NumberField);
      @field liked = contains(BooleanField);
      @field day = contains(DateField);
      @field seenAt = contains(DateTimeField);
      @field big = contains(BigIntegerField);
      @field where = contains(Place);
      @field tags = containsMany(StringField);
      @field post = linksTo(Post);
      @field shout = contains(StringField, {
        computeVia: function (this: Reaction) {
          return this.action?.toUpperCase();
        },
      });
    }
    return Reaction;
  }

  test('each field family normalizes its value', async function (assert) {
    let Reaction = await lineType();
    assert.deepEqual(
      lines.normalizeLine(Reaction, {
        action: 'like',
        dwellMs: '1200',
        liked: 'true',
        day: '2026-11-10',
        seenAt: '2026-11-10T10:00:00Z',
        big: 12,
        where: { city: 'Lisbon' },
        tags: ['a', 7],
      }),
      {
        action: 'like',
        dwellMs: 1200,
        liked: true,
        day: '2026-11-10',
        seenAt: '2026-11-10T10:00:00.000Z',
        big: '12',
        where: { city: 'Lisbon' },
        tags: ['a', '7'],
      },
    );
    assert.deepEqual(
      lines.normalizeLine(Reaction, { action: 5, liked: false, tags: null }),
      { action: '5', liked: false, tags: [] },
      'a number to text, a null list to an empty one',
    );
    assert.deepEqual(
      lines.normalizeLine(Reaction, { seenAt: '2026-11-10T10:00' }),
      { seenAt: '2026-11-10T10:00:00.000Z' },
      'a time with no zone is UTC, not the browser’s zone',
    );
    assert.deepEqual(
      lines.normalizeLine(Reaction, { action: null, where: undefined }),
      { action: null, where: null },
      'no value stays no value',
    );
  });

  test('a value of the wrong shape, an unknown key, a link or a computed is refused', async function (assert) {
    let Reaction = await lineType();
    let refused: [Record<string, unknown> | unknown, RegExp][] = [
      [{ dwellMs: 'slow' }, /dwellMs .* takes a number/],
      [{ dwellMs: '' }, /takes a number/],
      [{ liked: 'yes' }, /takes true or false/],
      [{ day: '10/11/2026' }, /YYYY-MM-DD/],
      [{ seenAt: 'soon' }, /ISO date and time/],
      [{ seenAt: 'March 7, 2026 10:00' }, /ISO date and time/],
      [{ big: 1.5 }, /takes an integer/],
      [{ action: { a: 1 } }, /takes text/],
      [{ where: 'Lisbon' }, /takes an object/],
      [{ where: { town: 'x' } }, /where\.town is not a field/],
      [{ tags: 'a' }, /tags is a list/],
      [{ post: 'https://x/Post/1' }, /is a link/],
      [{ shout: 'LIKE' }, /shout is not a field/],
      [{ bogus: 1 }, /bogus is not a field of Reaction/],
      ['like', /takes an object/],
      [['like'], /takes an object/],
      [null, /takes an object/],
    ];
    for (let [what, message] of refused) {
      assert.throws(
        () => lines.normalizeLine(Reaction, what),
        (e: Error) => e.name === 'LogLineError' && message.test(e.message),
        JSON.stringify(what),
      );
    }
  });

  test('record params are typed; every other operation passes as written', async function (assert) {
    let Reaction = await lineType();
    let paramsFor = lines.lineParamsFor(Reaction);
    assert.deepEqual(paramsFor('record', { what: { dwellMs: '3' }, x: 1 }), {
      what: { dwellMs: 3 },
      x: 1,
    });
    let other = { line: 'anything' };
    assert.strictEqual(paramsFor('appendLine', other), other);
    assert.strictEqual(paramsFor('record', null), null);
  });
});
