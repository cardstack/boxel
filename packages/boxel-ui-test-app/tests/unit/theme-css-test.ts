import { module, test } from 'qunit';

import {
  buildCssGroups,
  buildCssVariableName,
  entriesToCssRuleMap,
  normalizeCssRuleMap,
} from '@cardstack/boxel-ui/helpers';

module('Unit | theme-css | buildCssVariableName', function () {
  test('returns empty string when name argument is missing', function (assert) {
    assert.strictEqual(buildCssVariableName(undefined), '');
    assert.strictEqual(buildCssVariableName(), '');
  });

  test('builds css variable with only name provided', function (assert) {
    assert.strictEqual(buildCssVariableName('Spacing'), '--spacing');
    assert.strictEqual(buildCssVariableName('--spacing'), '--spacing');
  });

  test('builds css variable with prefix and name', function (assert) {
    assert.strictEqual(
      buildCssVariableName('Primary Color', { prefix: '_Theme' }),
      '--_theme-primary-color',
    );
    assert.strictEqual(
      buildCssVariableName('primaryColor', { prefix: '--brand' }),
      '--brand-primary-color',
    );
    assert.strictEqual(
      buildCssVariableName('shadow2xl', { prefix: 'Brand' }),
      '--brand-shadow-2xl',
    );
  });

  test('strips leading dashes and trims whitespace', function (assert) {
    assert.strictEqual(
      buildCssVariableName('  --Primary-Heading  ', { prefix: '  --Brand  ' }),
      '--brand-primary-heading',
    );
  });

  test('ignores prefix when name is missing', function (assert) {
    assert.strictEqual(
      buildCssVariableName(undefined, { prefix: 'brand' }),
      '',
    );
  });
});

module('Unit | theme-css | entriesToCssRuleMap', function () {
  test('normalizes property names and values', function (assert) {
    const map = entriesToCssRuleMap([
      { name: '  primary  ', value: '  #fff;;  ' },
      { name: '--secondary', value: '  #000; ; ' },
    ]);

    assert.deepEqual(
      [...map.entries()],
      [
        ['--primary', '#fff'],
        ['--secondary', '#000'],
      ],
    );
  });

  test('ignores entries missing name or value', function (assert) {
    const map = entriesToCssRuleMap([
      { name: undefined, value: '1rem' },
      { name: 'spacing' },
      { name: '', value: null },
    ]);

    assert.strictEqual(map.size, 0);
  });
});

module('Unit | theme-css | normalizeCssRuleMap', function () {
  test('revalidates an existing map', function (assert) {
    const raw = new Map<string, string | null>([
      ['primary', ' #fff;; '],
      ['--secondary', ''],
      ['--radius', '  4px'],
    ]);

    const normalized = normalizeCssRuleMap(
      raw as unknown as Map<string, string>,
    );

    assert.deepEqual(
      [...normalized.entries()],
      [
        ['--primary', '#fff'],
        ['--radius', '4px'],
      ],
    );
  });
});

module('Unit | theme-css | buildCssGroups', function () {
  test('builds groups from entries', function (assert) {
    const groups = buildCssGroups([
      {
        selector: 'root',
        entries: [
          { name: 'primary', value: '#fff' },
          { name: '--secondary', value: '#000' },
        ],
      },
      {
        selector: '.dark',
        entries: [{ name: 'primary', value: '#111' }],
      },
    ]);

    assert.deepEqual(
      [...groups.entries()].map(([selector, rules]) => [
        selector,
        [...rules.entries()],
      ]),
      [
        [
          ':root',
          [
            ['--primary', '#fff'],
            ['--secondary', '#000'],
          ],
        ],
        ['.dark', [['--primary', '#111']]],
      ],
    );
  });

  test('prefers provided rules map when present', function (assert) {
    const existing = new Map([
      ['--primary', '#fff'],
      ['radius', '8px;'],
    ]);

    const groups = buildCssGroups([
      { selector: ':root', rules: existing },
      { selector: '   ', entries: [{ name: 'ignored', value: '1' }] },
    ]);

    assert.deepEqual(
      [...groups.entries()].map(([selector, rules]) => [
        selector,
        [...rules.entries()],
      ]),
      [
        [
          ':root',
          [
            ['--primary', '#fff'],
            ['--radius', '8px'],
          ],
        ],
      ],
    );
  });

  test('skips invalid selectors', function (assert) {
    const groups = buildCssGroups([{ selector: null, entries: [] }]);
    assert.strictEqual(groups.size, 0);
  });
});
