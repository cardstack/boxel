import {
  fontStacksFromCss,
  googleFontImportsFor,
  googleFontImportUrl,
  webFontFamiliesFrom,
} from '@cardstack/boxel-ui/helpers';
import { module, test } from 'qunit';

module('Unit | theme-fonts | fontStacksFromCss', function () {
  test('extracts the values of --font-* custom properties', function (assert) {
    let css = `:root {
      --background: #fff;
      --font-sans: Geist, sans-serif;
      --font-mono: "Fira Code", monospace;
    }`;
    assert.deepEqual(fontStacksFromCss(css), [
      'Geist, sans-serif',
      '"Fira Code", monospace',
    ]);
  });

  test('returns an empty array when no font properties are present', function (assert) {
    assert.deepEqual(fontStacksFromCss(':root { --background: #fff; }'), []);
    assert.deepEqual(fontStacksFromCss(''), []);
  });
});

module('Unit | theme-fonts | webFontFamiliesFrom', function () {
  test('collects web font families from stacks, stripping quotes', function (assert) {
    assert.deepEqual(
      webFontFamiliesFrom(['Geist, sans-serif', '"Fira Code", monospace']),
      ['Geist', 'Fira Code'],
    );
  });

  test('skips generic keywords and ubiquitous system fonts case-insensitively', function (assert) {
    assert.deepEqual(
      webFontFamiliesFrom([
        'Oxanium, Helvetica Neue, Arial, sans-serif',
        '"Times New Roman", serif',
        'ui-monospace, Menlo, monospace',
      ]),
      ['Oxanium'],
    );
  });

  test('dedupes families and ignores null, undefined, and empty stacks', function (assert) {
    assert.deepEqual(
      webFontFamiliesFrom(['Lora, serif', 'Lora, Georgia, serif', null, '']),
      ['Lora'],
    );
  });

  test('skips var() references and their comma-split fragments', function (assert) {
    assert.deepEqual(
      webFontFamiliesFrom([
        'var(--font-sans)',
        'var(--font-display, sans-serif)',
        'Poppins, var(--font-fallback), sans-serif',
      ]),
      ['Poppins'],
    );
  });
});

module('Unit | theme-fonts | google font imports', function () {
  test('googleFontImportUrl requests the bare family with plus-encoded spaces', function (assert) {
    assert.strictEqual(
      googleFontImportUrl('Fira Code'),
      'https://fonts.googleapis.com/css2?family=Fira+Code&display=swap',
    );
  });

  test('googleFontImportsFor maps each web font family to a stylesheet URL', function (assert) {
    assert.deepEqual(
      googleFontImportsFor(['Geist, sans-serif', 'ui-serif, serif']),
      ['https://fonts.googleapis.com/css2?family=Geist&display=swap'],
    );
  });
});
