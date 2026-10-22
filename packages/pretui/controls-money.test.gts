// Pretui — proof for MoneyInput and AmountInput.
//
// The pure layer is where money inputs actually go wrong, so it is tested
// hardest: the separator rule, the minor-unit rule, and the affix SIDE. All
// three are locale facts, and all three are the ones a hand-written money
// field gets wrong by assuming `en-US`.
//
// Nothing here reads the clock. The only probes are fixed numbers.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import {
  render,
  fillIn,
  blur,
  click,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { AmountInput } from './components/amount-input';
import { MoneyInput } from './components/money-input';
import { CURRENCIES, MASS_UNITS, amountAffixes, currencyUnit, describeAmount, formatAmountPlain, fractionDigitsFor, parseAmount, roundToUnit, separatorsFor } from './internal/money';
import { DEMOS_MONEY_INPUT } from './components/money-input.usage';
import { DEMOS_AMOUNT_INPUT } from './components/amount-input.usage';

// Pages are looked up by component name through the merged loadable registry,
// so this test does not care which module a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_MONEY_INPUT, ...DEMOS_AMOUNT_INPUT };
const DEMOS_CONTROLS_MONEY_NAMES = ['MoneyInput', 'AmountInput'];

const USD = currencyUnit('USD', 'US Dollar');
const EUR = currencyUnit('EUR', 'Euro');
const JPY = currencyUnit('JPY', 'Japanese Yen');
const BHD = currencyUnit('BHD', 'Bahraini Dinar');

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function box(): HTMLInputElement {
  return root().querySelector(
    '[data-test-pretui-amount-input]',
  ) as HTMLInputElement;
}
function readout(): string {
  let el = root().querySelector('[data-test-pretui-amount-readout]');
  return (el?.textContent ?? '').trim();
}

module('Pretui | controls-money | parseAmount', function () {
  test('plain numbers', function (assert) {
    assert.strictEqual(parseAmount('0'), 0, 'zero is a value, not nothing');
    assert.strictEqual(parseAmount('42'), 42);
    assert.strictEqual(parseAmount('42.5'), 42.5);
    assert.strictEqual(parseAmount('-7.25'), -7.25);
    assert.strictEqual(parseAmount(19.99), 19.99, 'a number passes through');
  });

  test('an empty or wordless box is nothing, never zero', function (assert) {
    assert.strictEqual(parseAmount(''), undefined);
    assert.strictEqual(parseAmount('   '), undefined);
    assert.strictEqual(parseAmount('abc'), undefined);
    assert.strictEqual(parseAmount(undefined), undefined);
    assert.strictEqual(parseAmount(null), undefined);
    assert.strictEqual(parseAmount('$'), undefined, 'a lone symbol is not 0');
  });

  test('currency symbols and codes anywhere in the string are noise', function (assert) {
    assert.strictEqual(parseAmount('$1,234.50'), 1234.5);
    assert.strictEqual(parseAmount('1234.50 USD'), 1234.5);
    assert.strictEqual(parseAmount('USD 1 234.50'), 1234.5);
    assert.strictEqual(parseAmount('€1.234,50', { locale: 'de-DE' }), 1234.5);
  });

  test('group spaces — the separator a French locale actually prints', function (assert) {
    // NARROW NO-BREAK SPACE is what modern ICU emits for fr-FR grouping, and
    // it is not the space key, so a naive `replace(/ /g,'')` misses it.
    assert.strictEqual(parseAmount('1 234,50', { locale: 'fr-FR' }), 1234.5);
    assert.strictEqual(parseAmount('1 234.50'), 1234.5, 'no-break space');
  });

  test('the both-separators rule: the last one is the decimal', function (assert) {
    assert.strictEqual(parseAmount('1,234.56'), 1234.56);
    assert.strictEqual(parseAmount('1.234,56', { locale: 'de-DE' }), 1234.56);
    assert.strictEqual(
      parseAmount('1.234,56'),
      1234.56,
      'and it holds even when the locale disagrees, because it is unambiguous',
    );
  });

  test('the one-separator rule, stated in the docs and pinned here', function (assert) {
    assert.strictEqual(
      parseAmount('1,5', { locale: 'de-DE' }),
      1.5,
      'the locale decimal is a decimal',
    );
    assert.strictEqual(
      parseAmount('1,500', { locale: 'de-DE' }),
      1.5,
      'even with three digits — in de-DE the comma IS the decimal',
    );
    assert.strictEqual(
      parseAmount('1.500', { locale: 'de-DE' }),
      1500,
      'the locale group with exactly three digits is grouping',
    );
    assert.strictEqual(
      parseAmount('1.5000', { locale: 'de-DE' }),
      1.5,
      'four digits is not a group, so it is a foreign decimal',
    );
    assert.strictEqual(parseAmount('1,500'), 1500, 'and the mirror in en-US');
    assert.strictEqual(parseAmount('1.500'), 1.5);
    assert.strictEqual(
      parseAmount('1,234,567'),
      1234567,
      'a repeated separator is always grouping',
    );
  });

  test('accounting negatives and unicode signs', function (assert) {
    assert.strictEqual(parseAmount('(1,234.50)'), -1234.5);
    assert.strictEqual(parseAmount('($1,234.50)'), -1234.5);
    assert.strictEqual(parseAmount('−1234.50'), -1234.5, 'MINUS SIGN');
    assert.strictEqual(parseAmount('1234.50-'), -1234.5, 'trailing minus');
    assert.strictEqual(parseAmount('()'), undefined, 'no digits, no value');
  });

  test('non-latin digits', function (assert) {
    assert.strictEqual(
      parseAmount('١٢٣٤', { locale: 'ar-EG' }),
      1234,
      'arabic-indic',
    );
    assert.strictEqual(
      parseAmount('१२३'),
      123,
      'devanagari, folded even when the locale never asked',
    );
  });

  test('round trip — every formatted value parses back to itself', function (assert) {
    let cases: Array<[number, string]> = [
      [1234.5, 'en-US'],
      [1234.5, 'de-DE'],
      [1234.5, 'fr-FR'],
      [-98765.43, 'en-US'],
      [0, 'de-DE'],
      [1000000, 'hi-IN'],
    ];
    for (let [value, locale] of cases) {
      let text = formatAmountPlain(value, USD, locale);
      assert.strictEqual(
        parseAmount(text, { locale }),
        value,
        locale + ' round-trips ' + text,
      );
    }
  });
});

module('Pretui | controls-money | locale facts', function () {
  test('separatorsFor asks Intl rather than guessing', function (assert) {
    assert.deepEqual(separatorsFor('en-US'), { group: ',', decimal: '.' });
    assert.deepEqual(separatorsFor('de-DE'), { group: '.', decimal: ',' });
    assert.strictEqual(separatorsFor('fr-FR').decimal, ',');
    assert.deepEqual(
      separatorsFor('!!not-a-tag!!'),
      { group: ',', decimal: '.' },
      'a malformed tag falls back instead of throwing',
    );
  });

  test('fraction digits come from the currency, not from the number 2', function (assert) {
    assert.strictEqual(fractionDigitsFor(USD), 2);
    assert.strictEqual(fractionDigitsFor(JPY), 0, 'yen has no minor unit');
    assert.strictEqual(fractionDigitsFor(BHD), 3, 'dinar has three');
    assert.strictEqual(
      fractionDigitsFor({ value: 'x', label: 'x' }),
      undefined,
      'a plain count leaves it to the caller',
    );
    assert.strictEqual(
      fractionDigitsFor({ ...USD, fractionDigits: 0 }),
      0,
      'an explicit declaration wins',
    );
  });

  test('the affix goes on the side the LOCALE puts it', function (assert) {
    assert.strictEqual(amountAffixes(USD, 'en-US').prefix, '$');
    assert.strictEqual(amountAffixes(USD, 'en-US').suffix, '');
    assert.strictEqual(
      amountAffixes(EUR, 'de-DE').suffix,
      '€',
      'German writes the euro sign after the number',
    );
    assert.strictEqual(amountAffixes(EUR, 'de-DE').prefix, '');
    assert.deepEqual(
      amountAffixes({ value: 'pt', label: 'pt', symbol: 'pt' }),
      { prefix: '', suffix: 'pt' },
      'a literal symbol is a suffix',
    );
    assert.deepEqual(amountAffixes(undefined), { prefix: '', suffix: '' });
  });

  test('rounding lands on the minor unit', function (assert) {
    assert.strictEqual(roundToUnit(12.345, USD), 12.35);
    assert.strictEqual(roundToUnit(12.345, JPY), 12, 'yen carries no fraction');
    assert.strictEqual(roundToUnit(1 / 3, USD), 0.33);
    assert.strictEqual(
      roundToUnit(1 / 3, { value: 'x', label: 'x' }),
      1 / 3,
      'with no declared precision nothing is lost',
    );
  });

  test('the spelled-out readout is what disambiguates a shared symbol', function (assert) {
    let usd = describeAmount(1234.5, USD, 'en-US');
    let cad = describeAmount(1234.5, currencyUnit('CAD'), 'en-US');
    assert.true(usd.toLowerCase().indexOf('dollar') !== -1, usd);
    assert.notStrictEqual(usd, cad, 'two $ currencies read differently: ' + cad);
    let kilos = describeAmount(3, MASS_UNITS[1], 'en-US');
    assert.true(kilos.toLowerCase().indexOf('kilogram') !== -1, kilos);
  });

  test('the shipped currency list carries the minor-unit edge cases', function (assert) {
    let codes = CURRENCIES.map((c) => c.value);
    for (let code of ['USD', 'EUR', 'JPY', 'BHD']) {
      assert.true(codes.indexOf(code) !== -1, code + ' is offered');
    }
  });
});

module('Pretui | controls-money | AmountInput', function (hooks) {
  setupCardTest(hooks);

  test('the box reformats to canonical on commit and never on keystroke', async function (assert) {
    await render(
      <template>
        <AmountInput @units={{CURRENCIES}} @defaultUnit='USD' @locale='en-US' />
      </template>,
    );
    await fillIn(box(), '1234.5');
    assert.strictEqual(
      box().value,
      '1234.5',
      'mid-typing the reader sees exactly what they typed',
    );
    await blur(box());
    assert.strictEqual(box().value, '1,234.50', 'commit groups and pads');
  });

  test('an empty box reports nothing, not zero — the source bug', async function (assert) {
    let seen: Array<number | undefined> = [];
    const capture = (value: number | undefined) => seen.push(value);
    await render(
      <template>
        <AmountInput
          @units={{CURRENCIES}}
          @defaultUnit='USD'
          @defaultValue={{25}}
          @onChange={{capture}}
        />
      </template>,
    );
    await fillIn(box(), '');
    await blur(box());
    assert.strictEqual(seen[seen.length - 1], undefined, 'nothing, not 0');
    assert.strictEqual(box().value, '', 'and the box stays blank');
  });

  test('a pasted foreign-formatted amount is understood', async function (assert) {
    let seen: Array<number | undefined> = [];
    const capture = (value: number | undefined) => seen.push(value);
    await render(
      <template>
        <AmountInput
          @units={{CURRENCIES}}
          @defaultUnit='USD'
          @onChange={{capture}}
        />
      </template>,
    );
    await fillIn(box(), '$1,234.50');
    assert.strictEqual(seen[seen.length - 1], 1234.5);
    await fillIn(box(), '(99.00)');
    assert.strictEqual(seen[seen.length - 1], -99, 'accounting negative');
  });

  test('switching currency keeps the amount and re-rounds it to the new minor unit', async function (assert) {
    let seen: Array<[number | undefined, string | undefined]> = [];
    const capture = (value: number | undefined, unit: string | undefined) =>
      seen.push([value, unit]);
    const TWO = [currencyUnit('USD', 'US Dollar'), currencyUnit('JPY', 'Yen')];
    await render(
      <template>
        <AmountInput
          @units={{TWO}}
          @defaultUnit='USD'
          @defaultValue={{12.34}}
          @onChange={{capture}}
        />
      </template>,
    );
    let radios = Array.from(
      root().querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    );
    let yen = radios.find((r) => r.value === 'JPY');
    assert.ok(yen, 'the two-unit case renders a segmented radio group');
    await click(yen as HTMLInputElement);
    let last = seen[seen.length - 1];
    assert.strictEqual(last?.[1], 'JPY', 'the unit is reported');
    assert.strictEqual(
      last?.[0],
      12,
      'and the amount survives, rounded to a currency with no minor unit',
    );
  });

  test('the range is reported while typing and clamped only on commit', async function (assert) {
    let seen: Array<number | undefined> = [];
    const capture = (value: number | undefined) => seen.push(value);
    await render(
      <template>
        <AmountInput
          @units={{CURRENCIES}}
          @defaultUnit='USD'
          @min={{10}}
          @max={{100}}
          @onChange={{capture}}
        />
      </template>,
    );
    await fillIn(box(), '1');
    assert.strictEqual(
      box().value,
      '1',
      'a reader passing through 1 on the way to 120 is not rewritten',
    );
    assert.true(
      readout().indexOf('minimum') !== -1,
      'but the readout says why: ' + readout(),
    );
    await blur(box());
    assert.strictEqual(seen[seen.length - 1], 10, 'commit clamps');
  });

  test('the readout names the unit in words and reserves its row', async function (assert) {
    await render(
      <template>
        <AmountInput @units={{CURRENCIES}} @defaultUnit='USD' @locale='en-US' />
      </template>,
    );
    assert.strictEqual(readout(), '', 'empty at rest, but the row is present');
    assert.ok(
      root().querySelector('[data-test-pretui-amount-readout]'),
      'the element exists so nothing reflows when it fills',
    );
    await fillIn(box(), '1234.5');
    assert.true(
      readout().toLowerCase().indexOf('dollar') !== -1,
      'the readout spells the currency out: ' + readout(),
    );
  });

  test('unparseable text is refused with a reason, not silently zeroed', async function (assert) {
    let seen: Array<number | undefined> = [];
    const capture = (value: number | undefined) => seen.push(value);
    await render(
      <template>
        <AmountInput
          @units={{CURRENCIES}}
          @defaultUnit='USD'
          @onChange={{capture}}
        />
      </template>,
    );
    await fillIn(box(), 'lots');
    assert.strictEqual(seen[seen.length - 1], undefined);
    assert.true(readout().indexOf('not a number') !== -1, readout());
  });

  test('blur keeps an unparseable draft and its reason in the box', async function (assert) {
    await render(
      <template>
        <AmountInput @units={{CURRENCIES}} @defaultUnit='USD' @defaultValue={{5}} />
      </template>,
    );
    await fillIn(box(), 'lots');
    await blur(box());
    assert.strictEqual(box().value, 'lots', 'the rejected text is still there to correct');
    assert.true(readout().indexOf('not a number') !== -1, readout());
  });

  test('arrow keys step by the unit and ⇧ takes ten', async function (assert) {
    let seen: Array<number | undefined> = [];
    const capture = (value: number | undefined) => seen.push(value);
    const STEPPED = [{ value: 'box', label: 'boxes', step: 1 }];
    await render(
      <template>
        <AmountInput
          @units={{STEPPED}}
          @defaultValue={{5}}
          @onChange={{capture}}
        />
      </template>,
    );
    await triggerKeyEvent(box(), 'keydown', 'ArrowUp');
    assert.strictEqual(seen[seen.length - 1], 6);
    await triggerKeyEvent(box(), 'keydown', 'ArrowDown', { shiftKey: true });
    assert.strictEqual(seen[seen.length - 1], -4, 'shift is ten steps');
  });

  test('one unit renders a static mark, not a picker', async function (assert) {
    const ONE = [{ value: 'kg', label: 'kg', unit: 'kilogram' }];
    await render(<template><AmountInput @units={{ONE}} /></template>);
    let unit = root().querySelector('[data-test-pretui-amount-unit]');
    assert.strictEqual((unit?.textContent ?? '').trim(), 'kg');
    assert.strictEqual(
      root().querySelectorAll('input[type="radio"]').length,
      0,
      'nothing to choose, so nothing to choose from',
    );
  });

  test('the control owns a label when no wrapper supplied an id', async function (assert) {
    await render(
      <template><AmountInput @units={{CURRENCIES}} @label='Price' /></template>,
    );
    let id = box().id;
    assert.true(id.length > 0, 'the control owns an id');
    let label = root().querySelector('label[for="' + id + '"]');
    assert.ok(label, 'and a real label points at it');
    assert.strictEqual((label?.textContent ?? '').trim(), 'Price');
    assert.strictEqual(
      box().getAttribute('aria-label'),
      null,
      'and never an aria-label alongside it (realm lint counts that as a second name)',
    );
    assert.strictEqual(
      box().getAttribute('placeholder'),
      null,
      'and never a placeholder, which would become the accessible name',
    );
  });
});

module('Pretui | controls-money | MoneyInput', function (hooks) {
  setupCardTest(hooks);

  test('the currency curry renders the general control with the ISO list', async function (assert) {
    await render(
      <template>
        <MoneyInput @defaultCurrency='EUR' @locale='de-DE' @defaultValue={{9.5}} />
      </template>,
    );
    assert.ok(
      root().querySelector('[data-test-pretui-money]'),
      'the wrapper marks itself',
    );
    assert.strictEqual(box().value, '9,50', 'German punctuation for a euro');
    assert.true(
      readout().indexOf('Euro') !== -1 || readout().indexOf('euro') !== -1,
      'and the readout names it: ' + readout(),
    );
  });
});

// The usage pages are part of the deliverable, and `boxel realm indexing-errors`
// is a module-evaluation gate rather than a render gate — so the only proof
// that a FreestyleUsage page renders is mounting it.
module('Pretui | controls-money | usage pages', function (hooks) {
  setupCardTest(hooks);

  test('every demo in the registry renders', async function (assert) {
    for (let name of DEMOS_CONTROLS_MONEY_NAMES) {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the
         DEMOS registries are Record<string, unknown> by contract; mounting
         one requires the cast, as usage-pages.test.gts does. */
      let Page = PAGES[name] as any;
      await render(<template><Page /></template>);
      assert.true(
        (root().textContent ?? '').indexOf(name) !== -1,
        name + ' renders and names itself',
      );
    }
  });
});
