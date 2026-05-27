import { module, test } from 'qunit';

import {
  detectColorFormat,
  rgbaToFormatString,
} from '@cardstack/boxel-ui/helpers';

module('Unit | color tools helper', function () {
  test('format helper returns a hex string for hex format', function (assert) {
    let rgba = { r: 255, g: 0, b: 0, a: 1 };
    let formatted = rgbaToFormatString(rgba, 'hex');
    assert.strictEqual(formatted, '#ff0000');
  });

  test('format helper returns rgb string when alpha is 1', function (assert) {
    let rgba = { r: 255, g: 0, b: 0, a: 1 };
    let formatted = rgbaToFormatString(rgba, 'rgb');
    assert.strictEqual(formatted, 'rgb(255, 0, 0)');
  });

  test('format helper falls back to rgba string when alpha is below 1', function (assert) {
    let rgba = { r: 255, g: 165, b: 0, a: 0.25 };
    let formatted = rgbaToFormatString(rgba, 'rgb');
    assert.strictEqual(formatted, 'rgba(255, 165, 0, 0.25)');
  });

  test('format helper returns hsl string when alpha is 1 and hsl format is requested', function (assert) {
    let rgba = { r: 255, g: 0, b: 0, a: 1 };
    let formatted = rgbaToFormatString(rgba, 'hsl');
    assert.strictEqual(formatted, 'hsl(0, 100%, 50%)');
  });

  test('format helper returns hsla string when alpha is below 1 for hsl format', function (assert) {
    let rgba = { r: 255, g: 0, b: 0, a: 0.75 };
    let formatted = rgbaToFormatString(rgba, 'hsl');
    assert.strictEqual(formatted, 'hsla(0, 100%, 50%, 0.75)');
  });

  test('format helper returns hsb string for the hsb format', function (assert) {
    let rgba = { r: 255, g: 0, b: 0, a: 1 };
    let formatted = rgbaToFormatString(rgba, 'hsb');
    assert.strictEqual(formatted, 'hsb(0, 100%, 100%)');
  });

  test('format helper returns rgba string for css format', function (assert) {
    let rgba = { r: 255, g: 0, b: 0, a: 1 };
    let formatted = rgbaToFormatString(rgba, 'css');
    assert.strictEqual(formatted, 'rgba(255, 0, 0, 1.00)');
  });

  test('detectColorFormat recognizes all supported formats', function (assert) {
    let formats = [
      ['#abc', 'hex'],
      ['rgb(0,0,0)', 'rgb'],
      ['hsl(0, 100%, 50%)', 'hsl'],
      ['hsb(0, 0%, 0%)', 'hsb'],
      ['var(--custom)', 'css'],
    ] as const;

    for (let [input, expected] of formats) {
      assert.strictEqual(
        detectColorFormat(input),
        expected,
        `detectColorFormat returns ${expected} for ${input}`,
      );
    }
  });
});
