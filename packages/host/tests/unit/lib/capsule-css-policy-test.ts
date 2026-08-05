import { module, test } from 'qunit';

import {
  validateCapsuleInlineStyle,
  validateCapsuleStylesheet,
} from '@cardstack/host/lib/capsule-css-policy';

module('Unit | Capsule CSS policy', function () {
  test('admits literal declarations and rejects network-bearing spellings', function (assert) {
    assert.strictEqual(
      validateCapsuleInlineStyle(
        'color: rgb(10 20 30); transform: translateX(1rem)',
      ),
      'color: rgb(10 20 30); transform: translateX(1rem)',
    );

    for (let style of [
      'background: url(https://attacker.example/pixel)',
      'background: u\\72l(https://attacker.example/escaped)',
      'background: image-set(url(https://attacker.example/a) 1x)',
      '@import "https://attacker.example/style.css"',
    ]) {
      assert.throws(
        () => validateCapsuleInlineStyle(style),
        /network-bearing value/,
        style,
      );
    }
  });

  test('admits compiled scoped CSS but denies global and network authority', function (assert) {
    let scoped = '.card[data-scopedcss-a1b2c3] { color: rgb(10 20 30); }';
    assert.strictEqual(validateCapsuleStylesheet(scoped), scoped);
    assert.throws(
      () => validateCapsuleStylesheet('.card { color: red; }'),
      /missing its compiled scope/,
    );
    assert.throws(
      () =>
        validateCapsuleStylesheet(
          '@import "https://attacker.example/x"; .card[data-scopedcss-a] {}',
        ),
      /network-bearing value/,
    );
    assert.throws(
      () =>
        validateCapsuleStylesheet(
          '.card[data-scopedcss-a] { background: u\\72l(https://attacker.example/x); }',
        ),
      /network-bearing value/,
    );
  });
});
