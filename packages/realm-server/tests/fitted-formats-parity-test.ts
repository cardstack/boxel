import QUnit from 'qunit';
const { module, test } = QUnit;
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FITTED_FORMATS } from '@cardstack/runtime-common';

// Two places in the repo carry a hand-maintained copy of the fitted envelope
// specs, because neither can import runtime-common's FITTED_FORMATS: the
// filedef-fixtures format-preview harness (a card module, loaded through the
// realm) and boxel-ui (which must not depend on runtime-common). These tests
// pin both copies — and the harness's paired .size-* CSS blocks — to the
// canonical list so an edit to any of them fails loudly instead of letting
// the copies drift.

const HARNESS_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'experiments-realm',
  'filedef-fixtures',
  'format-preview.gts',
);
const BOXEL_UI_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'boxel-ui',
  'src',
  'utils',
  'fitted-formats.ts',
);

// The copies live in modules this suite cannot import (a .gts card module and
// a v2-addon source file), so we lift the array literal out of the source
// text and evaluate it. The literals are plain data — no identifiers — so the
// evaluation cannot reach anything else.
function extractArrayLiteral(filePath: string, declaration: string): unknown {
  let source = readFileSync(filePath, 'utf8');
  let match = source.match(
    new RegExp(
      `^(?:export )?const ${declaration}[^=]*= (\\[[\\s\\S]*?^\\]);`,
      'm',
    ),
  );
  if (!match) {
    throw new Error(
      `could not find "const ${declaration} = [...]" in ${filePath}`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`return ${match[1]};`)();
}

type HarnessGroup = {
  label: string;
  formats: { key: string; name: string; w: number; h: number }[];
};

module(basename(import.meta.filename), function () {
  test('the format-preview harness envelopes match FITTED_FORMATS', function (assert) {
    let harnessGroups = extractArrayLiteral(
      HARNESS_PATH,
      'FORMAT_GROUPS',
    ) as HarnessGroup[];

    // The harness uses its own short keys for CSS class names, so parity is
    // asserted on everything except the key: group names, titles, and pixel
    // dimensions, in order.
    assert.deepEqual(
      harnessGroups.map((group) => ({
        label: group.label,
        formats: group.formats.map(({ name, w, h }) => ({ name, w, h })),
      })),
      FITTED_FORMATS.map((group) => ({
        label: group.name,
        formats: group.specs.map((spec) => ({
          name: spec.title,
          w: spec.width,
          h: spec.height,
        })),
      })),
    );
  });

  test('the format-preview .size-* CSS blocks match the envelope dimensions', function (assert) {
    let harnessGroups = extractArrayLiteral(
      HARNESS_PATH,
      'FORMAT_GROUPS',
    ) as HarnessGroup[];
    let source = readFileSync(HARNESS_PATH, 'utf8');

    let cssSizes = new Map<string, { w: number; h: number }>();
    for (let [, key, w, h] of source.matchAll(
      /\.size-([a-z0-9-]+)\s*\{\s*width:\s*(\d+)px;\s*height:\s*(\d+)px;\s*\}/g,
    )) {
      cssSizes.set(key, { w: Number(w), h: Number(h) });
    }

    let envelopeSizes = new Map(
      harnessGroups.flatMap((group) =>
        group.formats.map(({ key, w, h }) => [key, { w, h }] as const),
      ),
    );
    assert.deepEqual(
      Object.fromEntries(cssSizes),
      Object.fromEntries(envelopeSizes),
      'every envelope has a .size-* block with the same dimensions, and no extras',
    );
  });

  test("boxel-ui's FITTED_FORMATS copy matches runtime-common's", function (assert) {
    assert.deepEqual(
      extractArrayLiteral(BOXEL_UI_PATH, 'FITTED_FORMATS'),
      FITTED_FORMATS,
    );
  });
});
