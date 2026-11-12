import {
  formatAge,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatFileSize,
  formatNumber,
  formatOrdinal,
  formatRelativeTime,
} from '@cardstack/boxel-ui/helpers';
import { module, test } from 'qunit';

type IntlConstructor =
  | 'DateTimeFormat'
  | 'DisplayNames'
  | 'NumberFormat'
  | 'PluralRules'
  | 'RelativeTimeFormat';

const CONSTRUCTORS: IntlConstructor[] = [
  'DateTimeFormat',
  'DisplayNames',
  'NumberFormat',
  'PluralRules',
  'RelativeTimeFormat',
];

// Runs `fn` with every Intl constructor the helpers use wrapped in a counter,
// and returns how many formatters it built. Calling an Intl constructor
// without `new` (`Intl.DateTimeFormat()`) also builds a formatter, so both
// traps count.
function constructionsDuring(fn: () => void): number {
  let intl = Intl as unknown as Record<IntlConstructor, object>;
  let originals = CONSTRUCTORS.map((name) => [name, intl[name]] as const);
  let count = 0;
  for (let [name, original] of originals) {
    intl[name] = new Proxy(original, {
      apply(target, thisArg, args) {
        count++;
        return Reflect.apply(
          target as (...a: unknown[]) => object,
          thisArg,
          args,
        );
      },
      construct(target, args, newTarget) {
        count++;
        return Reflect.construct(
          target as new (...a: unknown[]) => object,
          args,
          newTarget,
        );
      },
    });
  }
  try {
    fn();
  } finally {
    for (let [name, original] of originals) {
      intl[name] = original;
    }
  }
  return count;
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2024-05-03T09:30:00.000Z');

module('Unit | intl formatter reuse', function () {
  // Each test uses a locale no other test formats with, so the first call
  // in it is the one that builds the formatter.

  test('formatCurrency builds a formatter once per locale and options', function (assert) {
    let first = '';
    let firstCount = constructionsDuring(() => {
      first = formatCurrency(1234.5, { currency: 'NZD', locale: 'en-NZ' });
    });
    let second = '';
    let secondCount = constructionsDuring(() => {
      second = formatCurrency(1234.5, { currency: 'NZD', locale: 'en-NZ' });
    });

    assert.strictEqual(firstCount, 1, 'the first call builds one formatter');
    assert.strictEqual(secondCount, 0, 'the second call reuses it');
    assert.strictEqual(second, first, 'both calls format the same way');
    assert.strictEqual(first, '$1,234.50');
  });

  test('formatCurrency keeps sizes and currencies apart', function (assert) {
    assert.strictEqual(
      formatCurrency(1234.5, { currency: 'EUR', locale: 'en-IE' }),
      '€1,234.50',
    );
    assert.strictEqual(
      formatCurrency(1234.5, { currency: 'GBP', locale: 'en-IE' }),
      '£1,234.50',
    );
    assert.strictEqual(
      formatCurrency(1234.5, {
        currency: 'EUR',
        locale: 'en-IE',
        size: 'short',
      }),
      '€1,235',
    );
    assert.strictEqual(
      formatCurrency(1234.5, { currency: 'EUR', locale: 'en-IE' }),
      '€1,234.50',
      'the medium formatter is unchanged by the short one beside it',
    );
  });

  test('formatNumber reuses a formatter and keeps styles apart', function (assert) {
    assert.strictEqual(
      formatNumber(0.5, { locale: 'en-GB', style: 'percent' }),
      '50%',
    );
    assert.strictEqual(
      formatNumber(0.5, { locale: 'en-GB', size: 'long' }),
      '0.5000',
    );
    assert.strictEqual(
      constructionsDuring(() => {
        formatNumber(0.25, { locale: 'en-GB', style: 'percent' });
        formatNumber(0.25, { locale: 'en-GB', size: 'long' });
      }),
      0,
      'repeat calls build nothing',
    );
    assert.strictEqual(
      formatNumber(0.25, {
        locale: 'en-GB',
        maximumFractionDigits: 1,
        style: 'percent',
      }),
      '25%',
      'an added option is a different formatter',
    );
  });

  test('formatDateTime reuses its formatters and keys them on the time zone', function (assert) {
    // 20:00 UTC is already the next day in Tokyo and still the same day in
    // Honolulu.
    let evening = new Date('2024-05-01T20:00:00.000Z');
    let tokyo = formatDateTime(evening, {
      locale: 'en-AU',
      preset: 'long',
      timeZone: 'Asia/Tokyo',
    });
    let honolulu = formatDateTime(evening, {
      locale: 'en-AU',
      preset: 'long',
      timeZone: 'Pacific/Honolulu',
    });

    assert.ok(tokyo.includes('2 May'), `Tokyo reads 2 May: ${tokyo}`);
    assert.ok(honolulu.includes('1 May'), `Honolulu reads 1 May: ${honolulu}`);

    let weekLabel = () =>
      formatDateTime(evening, {
        kind: 'week',
        locale: 'en-AU',
        timeZone: 'Asia/Tokyo',
        weekFormat: 'label',
      });
    let label = weekLabel();

    assert.strictEqual(
      constructionsDuring(() => {
        formatDateTime(evening, {
          locale: 'en-AU',
          preset: 'long',
          timeZone: 'Asia/Tokyo',
        });
        assert.strictEqual(weekLabel(), label);
      }),
      0,
      "repeat calls build nothing, the week label's field name included",
    );
  });

  test('formatDateTime in the default time zone reuses its formatters', function (assert) {
    // No `timeZone`: the helper resolves the host's zone, which is the path
    // a bare `{{formatDateTime row.date}}` in a template takes.
    let medium = () =>
      formatDateTime(NOW, { locale: 'en-SG', preset: 'medium' });
    let tiny = () =>
      formatDateTime(NOW, { locale: 'en-SG', now: NOW, preset: 'tiny' });
    let first = medium();
    tiny();

    assert.ok(first.length > 0, `formats: ${first}`);
    assert.strictEqual(
      constructionsDuring(() => {
        assert.strictEqual(medium(), first);
        tiny();
      }),
      0,
      'repeat calls build nothing, including resolving the default time zone',
    );
  });

  test('formatRelativeTime reuses its formatters and keeps numeric styles apart', function (assert) {
    let twoDaysBefore = new Date(NOW.getTime() - 2 * DAY);
    let dayBefore = new Date(NOW.getTime() - DAY);
    let first = formatRelativeTime(twoDaysBefore, {
      locale: 'en-CA',
      now: NOW,
    });
    let count = constructionsDuring(() => {
      let second = formatRelativeTime(twoDaysBefore, {
        locale: 'en-CA',
        now: NOW,
      });
      assert.strictEqual(second, first, 'both calls format the same way');
    });

    assert.strictEqual(first, '2 days ago');
    assert.strictEqual(count, 0, 'the second call builds nothing');
    assert.strictEqual(
      formatRelativeTime(dayBefore, { locale: 'en-CA', now: NOW }),
      'yesterday',
    );
    assert.strictEqual(
      formatRelativeTime(dayBefore, {
        locale: 'en-CA',
        now: NOW,
        numeric: 'always',
      }),
      '1 day ago',
      "numeric 'always' gets its own formatter",
    );
  });

  test('the smaller formatting helpers reuse their formatters', function (assert) {
    let run = () => {
      formatAge(new Date('2000-01-01T00:00:00.000Z'), { locale: 'en-IN' });
      formatDuration(3725, { locale: 'en-IN' });
      formatFileSize(1536, { locale: 'en-IN' });
      formatOrdinal(3, { locale: 'en-IN' });
    };
    run();

    assert.strictEqual(constructionsDuring(run), 0);
  });

  test('the cache drops its oldest formatter once it holds 500 of a kind', function (assert) {
    // Private-use locale tags are valid and distinct, so each one keys a
    // formatter of its own, the way per-row locales from card data would.
    let tag = (n: number) => `en-x-cap${String(n).padStart(4, '0')}`;
    let format = (n: number) =>
      formatNumber(1.5, { locale: tag(n), style: 'percent' });
    for (let n = 0; n < 600; n++) {
      format(n);
    }

    assert.strictEqual(
      constructionsDuring(() => format(599)),
      0,
      'a recent formatter is still cached',
    );
    assert.strictEqual(
      constructionsDuring(() => format(0)),
      1,
      'the oldest formatter was dropped and is rebuilt',
    );
  });

  test('a formatter that fails to build is not cached', function (assert) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      assert.throws(
        () => formatCurrency(1, { currency: 'NOT-A-CODE', locale: 'en-US' }),
        RangeError,
        `attempt ${attempt} throws as new Intl.NumberFormat would`,
      );
    }
  });
});
