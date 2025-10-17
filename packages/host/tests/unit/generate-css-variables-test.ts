import { module, test } from 'qunit';

import {
  buildCssGroups,
  generateCssVariables,
} from '@cardstack/boxel-ui/helpers';

module('Unit | generate-css-variables', function () {
  test('it generates css rule blocks with normalized variables', function (assert) {
    const result = generateCssVariables(
      buildCssGroups([
        {
          selector: ':root',
          entries: [
            { name: '  --primary  ', value: '  #336699  ' },
            { name: 'radius', value: '20px;' },
          ],
        },
        {
          selector: '.dark',
          entries: [
            { name: '--background', value: '  #333;  ' },
            { name: ' foreground  ', value: '#fff' },
          ],
        },
      ]),
    );

    assert.strictEqual(
      result,
      [
        [':root {', '  --primary: #336699;', '  --radius: 20px;', '}'].join(
          '\n',
        ),
        ['.dark {', '  --background: #333;', '  --foreground: #fff;', '}'].join(
          '\n',
        ),
      ].join('\n\n'),
    );
  });

  test('it skips variables without both property and value', function (assert) {
    const result = generateCssVariables(
      buildCssGroups([
        {
          selector: ':root',
          entries: [
            { name: '--valid', value: '1rem' },
            { name: '--missing-value' },
            { name: '', value: '2rem' },
            // @ts-ignore-next-line purposefully inaccurate type
            { name: null, value: '2rem' },
            { name: '--null-value', value: null },
          ],
        },
      ]),
    );

    assert.strictEqual(result, [':root {', '  --valid: 1rem;', '}'].join('\n'));
  });

  test('it omits blocks that produce no rules', function (assert) {
    const result = generateCssVariables(
      buildCssGroups([
        { selector: ':root', entries: [] },
        { selector: '.empty' },
      ]),
    );

    assert.strictEqual(result, '');
  });
});
