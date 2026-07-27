import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { runBoxel } from '../helpers/run-boxel.ts';
import type { ParseRealmResult } from '../../src/commands/parse.ts';

// Drives `boxel parse --json` as a subprocess against the CLI binary
// selected by BOXEL_CLI_BIN (see tests/helpers/run-boxel.ts). Under the
// tarball / published contexts this runs the npm-hoisted install — the
// layout where `boxel parse`'s glint type-check silently resolves
// nothing, which no in-process, function-call test could reach.
//
// Each fixture is a plain realm-workspace directory of card code. parse
// defaults to type-checking the current working directory, so we point
// the subprocess `cwd` at the fixture — no copying, parse writes nothing
// to it.

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures/parse');

// Message the CLI emits when ember-tsc exits non-zero but produced zero
// TS diagnostics — glint resolved nothing and checked nothing: a "pass"
// that never actually type-checked. It surfaces when the parse
// workspace's node_modules can't resolve the CLI's deps. No fixture may
// produce it — if one does, the install layout is broken, not the card.
const NOTHING_CHECKED = 'produced no TS diagnostics';

async function parseFixture(name: string): Promise<ParseRealmResult> {
  let res = await runBoxel(['parse', '--json'], {
    cwd: resolve(FIXTURES_DIR, name),
  });
  return res.json<ParseRealmResult>();
}

// ---------------------------------------------------------------------------
// Primary behavior: glint runs against an npm install and the CLI's
// tsconfig aliases + bundled types resolve, so real cards type-check
// clean. Each fixture pins a distinct resolution surface:
//   - plain-glimmer: field value types (`@model.someNumberField` →
//     `number`), which resolve through the `primitive` symbol bundled
//     from @cardstack/runtime-common.
//   - runtime-common: the bare `@cardstack/runtime-common` import
//     (the `realmURL` symbol, the `Query` type).
//   - boxel-host-tools: the `@cardstack/boxel-host/tools/*` alias + the
//     bundled `tools/` source.
//   - helpers-and-fields: a `@cardstack/boxel-ui/helpers` call
//     (`formatDateTime` with its `format` named arg) plus direct
//     interpolation of `contains(NumberField)` / `contains(TextAreaField)`
//     field values.
// ---------------------------------------------------------------------------
const CLEAN_FIXTURES: { name: string; covers: string }[] = [
  {
    name: 'plain-glimmer',
    covers: 'field value types via the primitive symbol',
  },
  { name: 'runtime-common', covers: 'bare @cardstack/runtime-common import' },
  { name: 'boxel-host-tools', covers: '@cardstack/boxel-host/tools/* import' },
  {
    name: 'helpers-and-fields',
    covers: 'boxel-ui helper call + field interpolation',
  },
];

describe('boxel parse (against the installed CLI)', () => {
  describe.each(CLEAN_FIXTURES)('$name — $covers', ({ name }) => {
    it(
      'type-checks clean',
      async () => {
        let result = await parseFixture(name);
        // Surface the actual diagnostics on failure, not a bare count.
        expect(result.errors).toEqual([]);
        expect(result.status).toBe('passed');
        expect(result.filesChecked).toBeGreaterThanOrEqual(1);
      },
      { timeout: 180_000 },
    );
  });

  it(
    'type-checks a .test.gts using assert.dom clean (qunit-dom augmentation)',
    async () => {
      // parse checks every discovered `.gts`, including `.test.gts`. Those
      // call `assert.dom(...)` without importing qunit-dom, so the type
      // lib must be loaded or the test file fails to type-check.
      let result = await parseFixture('qunit-dom-test');
      expect(result.errors).toEqual([]);
      expect(result.status).toBe('passed');
      expect(result.filesChecked).toBeGreaterThanOrEqual(1);
    },
    { timeout: 180_000 },
  );

  it(
    'surfaces a real diagnostic for a genuine type error (proves glint ran)',
    async () => {
      let result = await parseFixture('deliberate-type-error');
      expect(result.status).toBe('failed');
      expect(result.errorCount).toBeGreaterThanOrEqual(1);

      let messages = result.errors.map((e) => e.message).join('\n');
      // A real TS2322 from a genuine type mismatch…
      expect(messages).toMatch(/not assignable to type 'number'/);
      // …and specifically NOT the environmental "nothing got checked"
      // message that masks a broken type-resolution setup as a pass.
      expect(messages).not.toContain(NOTHING_CHECKED);
    },
    { timeout: 180_000 },
  );
});

// ---------------------------------------------------------------------------
// Actionable diagnostics: `@tracked` (or any decorator) on a member of a
// format-class *expression* (`static isolated = class { … }`) can't
// type-check under TypeScript's legacy decorators — they're allowed only
// on class *declarations*. The code runs, but glint rejects it, and the
// raw "Decorators are not valid here" is cryptic. parse must both flag it
// (never silently pass) and explain the fix: move reactive state into a
// top-level component the format class renders.
// ---------------------------------------------------------------------------
describe('boxel parse — actionable diagnostics', () => {
  it(
    'flags a decorator in a format-class expression with guidance',
    async () => {
      let result = await parseFixture('tracked-format-class');
      expect(result.status).toBe('failed');

      let guided = result.errors.find((e) =>
        /format-class expression/.test(e.message),
      );
      expect(
        guided,
        'expected an actionable decorator diagnostic',
      ).toBeTruthy();
      // Keeps the underlying TS text and adds the fix.
      expect(guided!.message).toMatch(/Decorators are not valid here/);
      expect(guided!.message).toMatch(/top-level component/);
      // Located at the decorated member, not attributed to the wrong file.
      expect(guided!.file).toBe('toggle.gts');
      expect(guided!.line).toBeGreaterThan(0);
    },
    { timeout: 180_000 },
  );
});
