import { module, test } from 'qunit';

// Outside a card nothing publishes the typography roles but theme.css, so a
// component that reads one with no fallback depends on these :root defaults.

const ROLES = [
  'heading',
  'section-heading',
  'subheading',
  'body',
  'caption',
  'ui-label',
  'eyebrow',
];
const PROPERTIES = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
];

function rootValue(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

module('Unit | theme-typography-roles', function () {
  test('every role token has a :root default', function (assert) {
    let missing = ROLES.flatMap((role) =>
      PROPERTIES.map((property) => `--boxel-${role}-${property}`),
    ).filter((name) => rootValue(name) === '');
    assert.deepEqual(missing, []);
  });

  test('body, caption and label tracking follow --tracking-normal', function (assert) {
    let tracking = rootValue('--tracking-normal');
    assert.strictEqual(rootValue('--boxel-body-letter-spacing'), tracking);
    assert.strictEqual(rootValue('--boxel-caption-letter-spacing'), tracking);
    assert.strictEqual(rootValue('--boxel-ui-label-letter-spacing'), tracking);
  });
});
