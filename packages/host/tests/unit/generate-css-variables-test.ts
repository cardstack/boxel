import { module, test } from 'qunit';

import { generateCssVariables } from '@cardstack/boxel-ui/helpers';

module('Unit | generate-css-variables', function () {
  test('it generates css rule blocks with normalized variables', function (assert) {
    const result = generateCssVariables([
      {
        blockname: ':root',
        vars: [
          { property: '  --primary  ', value: '  #336699  ' },
          { property: 'radius', value: '20px;' },
        ],
      },
      {
        blockname: '.dark',
        vars: [
          { property: '--background', value: '  #333;  ' },
          { property: ' foreground  ', value: '#fff' },
        ],
      },
    ]);

    assert.strictEqual(
      result,
      [
        [':root {', ' --primary: #336699;', ' --radius: 20px;', '}'].join('\n'),
        ['.dark {', ' --background: #333;', ' --foreground: #fff;', '}'].join(
          '\n',
        ),
      ].join('\n\n'),
    );
  });

  test('it skips variables without both property and value', function (assert) {
    const result = generateCssVariables([
      {
        blockname: ':root',
        vars: [
          { property: '--valid', value: '1rem' },
          { property: '--missing-value' },
          { property: '', value: '2rem' },
          // @ts-ignore-next-line purposefully inaccurate type
          { property: null, value: '2rem' },
          { property: '--null-value', value: null },
        ],
      },
    ]);

    assert.strictEqual(result, [':root {', ' --valid: 1rem;', '}'].join('\n'));
  });

  test('it omits blocks that produce no rules', function (assert) {
    const result = generateCssVariables([
      { blockname: ':root', vars: [] },
      { blockname: '.empty' },
    ]);

    assert.strictEqual(result, '');
  });
});
