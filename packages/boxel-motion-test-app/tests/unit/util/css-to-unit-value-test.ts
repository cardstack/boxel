import { parse } from '@cardstack/boxel-motion/utils/css-to-unit-value';
import { module, test } from 'qunit';

module('Unit | Util | CssToUnitValue', function () {
  test('parses integers', function (assert) {
    let input = 0;
    let output = parse(input);

    assert.deepEqual(output, { value: 0, unit: '' });
  });

  test('parses floats', function (assert) {
    let input = 0.5;
    let output = parse(input);

    assert.deepEqual(output, { value: 0.5, unit: '' });
  });

  test('parses px', function (assert) {
    let input = '42px';
    let output = parse(input);

    assert.deepEqual(output, { value: 42, unit: 'px' });
  });

  test('parses negative values', function (assert) {
    let input = '-42px';
    let output = parse(input);

    assert.deepEqual(output, { value: -42, unit: 'px' });
  });

  test('parses percentages', function (assert) {
    let input = '-42%';
    let output = parse(input);

    assert.deepEqual(output, { value: -42, unit: '%' });
  });
});
