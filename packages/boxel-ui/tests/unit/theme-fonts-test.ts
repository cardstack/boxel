import {
  fontStacksFromCss,
  googleFontImportsFor,
  googleFontImportUrl,
  webFontFamiliesFrom,
} from '@cardstack/boxel-ui/helpers';
import { module, test } from 'qunit';

module('Unit | theme fonts', function () {
  test('extracts font stacks from CSS', function (assert) {
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

  test('keeps web fonts while skipping system fonts and references', function (assert) {
    assert.deepEqual(
      webFontFamiliesFrom([
        'Oxanium, Helvetica Neue, Arial, sans-serif',
        'var(--font-display, serif)',
        '"Fira Code", ui-monospace, Menlo, monospace',
      ]),
      ['Oxanium', 'Fira Code'],
    );
  });

  test('builds Google Fonts stylesheet imports', function (assert) {
    assert.strictEqual(
      googleFontImportUrl('Fira Code'),
      'https://fonts.googleapis.com/css2?family=Fira+Code&display=swap',
    );
    assert.deepEqual(
      googleFontImportsFor(['Geist, sans-serif', 'ui-serif, serif']),
      ['https://fonts.googleapis.com/css2?family=Geist&display=swap'],
    );
  });
});
