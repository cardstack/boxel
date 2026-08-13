import QUnit from 'qunit';
const { module, test } = QUnit;
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FITTED_FORMATS } from '@cardstack/runtime-common';

// boxel-ui carries a hand-maintained copy of the fitted envelope specs,
// because as a standalone design-system package it must not depend on
// runtime-common. This test pins that copy to the canonical FITTED_FORMATS
// so an edit to either list fails loudly instead of letting the two drift.

const BOXEL_UI_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'boxel-ui',
  'src',
  'utils',
  'fitted-formats.ts',
);

// The copy lives in a v2-addon source file this suite cannot import, so we
// lift the array literal out of the source text and evaluate it. The literal
// is plain data — no identifiers — so the evaluation cannot reach anything
// else.
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

module(basename(import.meta.filename), function () {
  test("boxel-ui's FITTED_FORMATS copy matches runtime-common's", function (assert) {
    assert.deepEqual(
      extractArrayLiteral(BOXEL_UI_PATH, 'FITTED_FORMATS'),
      FITTED_FORMATS,
    );
  });
});
